import { validateArgs } from '../args/validate.js'
import { normalizeCommand } from '../command/normalize.js'
import { isPlainObject } from '../core/json.js'
import { APPROVAL_MODES, DEFAULT_RISK_POLICY } from '../core/types.js'
import type { RiskAssessment, RiskPolicy } from '../core/types.js'
import { DEFAULT_KNOWN_TOOLS, isCommandTool, isWriteTool } from '../core/tools.js'
import { defaultPlatform, normalizePath } from '../path/normalize.js'
import type { PathPlatform, PathProbe } from '../path/types.js'
import { assessRisk, combineAssessments } from '../risk/assess.js'
import { computePlanHash } from './hash.js'
import type {
  NormalizedPlanScope,
  PlanIssue,
  PlanValidationOptions,
  PlanValidationResult,
  PlanCounts,
  ValidatedPlan,
  ValidatedPlanItem,
} from './types.js'

const MAX_SUMMARY = 1000
const MAX_TITLE = 120
const MAX_NOTE = 1000
const MAX_ID_LENGTH = 16
const MAX_TOOL_LENGTH = 64

const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,15}$/
// oxlint-disable-next-line no-control-regex
const CONTROL_MULTILINE = /[\u0000-\u0009\u000b-\u001f\u007f]/
// oxlint-disable-next-line no-control-regex
const CONTROL_SINGLE = /[\u0000-\u001f\u007f]/

const DEFAULT_MAX_ITEMS = 20
const DEFAULT_MAX_USES_PER_ITEM = 5
const DEFAULT_MAX_TOTAL_USES = 50
const DEFAULT_MAX_PATHS = 20
const DEFAULT_MAX_COMMANDS = 10
const MAX_DEPENDENCIES = 20

interface ResolvedOptions {
  cwd: string
  platform: PathPlatform
  probe?: PathProbe
  knownTools: ReadonlySet<string>
  modes: ReadonlySet<string>
  policy: RiskPolicy
  maxItems: number
  maxUsesPerItem: number
  maxTotalUses: number
  maxPaths: number
  maxCommands: number
}

interface DraftItem {
  id: string
  tool: string
  title: string
  note?: string
  mode?: string
  uses: number
  dependsOn: string[]
  scope: NormalizedPlanScope
  risk: RiskAssessment
  autoEligible: boolean
  manualOnly: boolean
  index: number
}

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback
}

function resolveOptions(
  options: unknown,
  errors: PlanIssue[],
): ResolvedOptions | undefined {
  if (!isPlainObject(options)) {
    errors.push({ code: 'invalid-options', message: 'plan validation options are missing' })
    return undefined
  }
  if (typeof options.cwd !== 'string' || options.cwd.trim().length === 0) {
    errors.push({ code: 'invalid-cwd', message: 'an absolute workspace cwd is required' })
    return undefined
  }

  const platform: PathPlatform =
    options.platform === 'win32' || options.platform === 'posix'
      ? options.platform
      : defaultPlatform()

  let probe: PathProbe | undefined
  if (options.probe !== undefined) {
    const candidate = options.probe
    if (
      !isPlainObject(candidate) ||
      typeof candidate.realpath !== 'function' ||
      typeof candidate.isDirectory !== 'function'
    ) {
      errors.push({ code: 'invalid-options', message: 'path probe is malformed' })
      return undefined
    }
    probe = candidate as unknown as PathProbe
  }

  let knownTools: ReadonlySet<string>
  if (options.knownTools === undefined) {
    knownTools = DEFAULT_KNOWN_TOOLS
  } else if (options.knownTools instanceof Set) {
    knownTools = options.knownTools as ReadonlySet<string>
  } else {
    errors.push({ code: 'invalid-options', message: 'knownTools must be a Set' })
    return undefined
  }

  let modes: ReadonlySet<string>
  if (options.modes === undefined) {
    modes = new Set(APPROVAL_MODES)
  } else if (options.modes instanceof Set) {
    modes = options.modes as ReadonlySet<string>
  } else {
    errors.push({ code: 'invalid-options', message: 'modes must be a Set' })
    return undefined
  }

  const policy =
    isPlainObject(options.policy) &&
    typeof options.policy.version === 'number' &&
    Array.isArray(options.policy.autoLevels)
      ? (options.policy as unknown as RiskPolicy)
      : DEFAULT_RISK_POLICY

  const cwdResult = normalizePath(options.cwd, { platform, probe })
  if (!cwdResult.ok) {
    errors.push({ code: 'invalid-cwd', message: 'workspace cwd is not a safe absolute path' })
    return undefined
  }
  if (cwdResult.path.isDirectory === false) {
    errors.push({ code: 'invalid-cwd', message: 'workspace cwd is not a directory' })
    return undefined
  }

  return {
    cwd: cwdResult.path.path,
    platform,
    probe,
    knownTools,
    modes,
    policy,
    maxItems: positiveInteger(options.maxItems, DEFAULT_MAX_ITEMS),
    maxUsesPerItem: positiveInteger(options.maxUsesPerItem, DEFAULT_MAX_USES_PER_ITEM),
    maxTotalUses: positiveInteger(options.maxTotalUses, DEFAULT_MAX_TOTAL_USES),
    maxPaths: positiveInteger(options.maxPathsPerItem, DEFAULT_MAX_PATHS),
    maxCommands: positiveInteger(options.maxCommandsPerItem, DEFAULT_MAX_COMMANDS),
  }
}

function validateSummary(value: unknown, errors: PlanIssue[]): string {
  if (typeof value !== 'string') {
    errors.push({ code: 'invalid-summary', message: 'summary must be a string', field: 'summary' })
    return ''
  }
  const text = value.trim()
  if (text.length === 0) {
    errors.push({ code: 'invalid-summary', message: 'summary is empty', field: 'summary' })
  } else if (text.length > MAX_SUMMARY) {
    errors.push({ code: 'invalid-summary', message: 'summary is too long', field: 'summary' })
  } else if (CONTROL_MULTILINE.test(text)) {
    errors.push({
      code: 'invalid-summary',
      message: 'summary contains a control character',
      field: 'summary',
    })
  }
  return text
}

function hasScope(scope: NormalizedPlanScope): boolean {
  return scope.paths.length > 0 || scope.commands.length > 0 || scope.args !== undefined
}

function validateScope(
  raw: unknown,
  itemId: string,
  resolved: ResolvedOptions,
  errors: PlanIssue[],
  warnings: PlanIssue[],
): NormalizedPlanScope {
  const scope: NormalizedPlanScope = { paths: [], commands: [] }
  if (raw === undefined || raw === null) return scope
  if (!isPlainObject(raw)) {
    errors.push({
      code: 'invalid-scope',
      message: 'scope must be an object',
      itemId,
      field: 'scope',
    })
    return scope
  }

  if (raw.paths !== undefined) {
    if (!Array.isArray(raw.paths)) {
      errors.push({
        code: 'invalid-paths',
        message: 'scope.paths must be an array',
        itemId,
        field: 'scope.paths',
      })
    } else {
      if (raw.paths.length === 0) {
        errors.push({
          code: 'empty-paths',
          message: 'scope.paths is empty',
          itemId,
          field: 'scope.paths',
        })
      }
      if (raw.paths.length > resolved.maxPaths) {
        errors.push({
          code: 'too-many-paths',
          message: 'too many paths in one item',
          itemId,
          field: 'scope.paths',
        })
      }
      const seen = new Set<string>()
      const pathCount = Math.min(raw.paths.length, resolved.maxPaths)
      for (let index = 0; index < pathCount; index += 1) {
        const value: unknown = raw.paths[index]
        if (typeof value !== 'string') {
          errors.push({
            code: 'invalid-path',
            message: 'path must be a string',
            itemId,
            field: `scope.paths[${index}]`,
          })
          continue
        }
        const normalized = normalizePath(value, {
          platform: resolved.platform,
          cwd: resolved.cwd,
          probe: resolved.probe,
        })
        if (!normalized.ok) {
          errors.push({
            code: 'invalid-path',
            message: `path is not safe (${normalized.code})`,
            itemId,
            field: `scope.paths[${index}]`,
          })
          continue
        }
        if (seen.has(normalized.path.key)) continue
        seen.add(normalized.path.key)
        scope.paths.push(normalized.path)
      }
    }
  }

  if (raw.commands !== undefined) {
    if (!Array.isArray(raw.commands)) {
      errors.push({
        code: 'invalid-commands',
        message: 'scope.commands must be an array',
        itemId,
        field: 'scope.commands',
      })
    } else {
      if (raw.commands.length === 0) {
        errors.push({
          code: 'empty-commands',
          message: 'scope.commands is empty',
          itemId,
          field: 'scope.commands',
        })
      }
      if (raw.commands.length > resolved.maxCommands) {
        errors.push({
          code: 'too-many-commands',
          message: 'too many commands in one item',
          itemId,
          field: 'scope.commands',
        })
      }
      const seen = new Set<string>()
      const commandCount = Math.min(raw.commands.length, resolved.maxCommands)
      for (let index = 0; index < commandCount; index += 1) {
        const value: unknown = raw.commands[index]
        if (typeof value !== 'string') {
          errors.push({
            code: 'invalid-command',
            message: 'command must be a string',
            itemId,
            field: `scope.commands[${index}]`,
          })
          continue
        }
        const normalized = normalizeCommand(value, resolved.platform)
        if (!normalized.ok) {
          errors.push({
            code: 'invalid-command',
            message: `command is invalid (${normalized.code})`,
            itemId,
            field: `scope.commands[${index}]`,
          })
          continue
        }
        if (!normalized.command.autoEligible) {
          warnings.push({
            code: 'unsafe-command',
            message: 'command contains shell metacharacters or an interpreter; it will stay manual',
            itemId,
            field: `scope.commands[${index}]`,
          })
        }
        if (seen.has(normalized.command.text)) continue
        seen.add(normalized.command.text)
        scope.commands.push(normalized.command)
      }
    }
  }

  if (raw.args !== undefined) {
    const validated = validateArgs(raw.args)
    if (!validated.ok) {
      errors.push({
        code: 'invalid-args',
        message: `args scope is invalid (${validated.code})`,
        itemId,
        field: 'scope.args',
      })
    } else if (Object.keys(validated.value).length === 0) {
      errors.push({
        code: 'empty-args-scope',
        message: 'args scope is empty and would match everything',
        itemId,
        field: 'scope.args',
      })
    } else {
      scope.args = validated.value
      scope.argsSerialized = validated.serialized
    }
  }

  return scope
}

function assessItemRisk(
  tool: string,
  scope: NormalizedPlanScope,
  mode: string | undefined,
  resolved: ResolvedOptions,
): RiskAssessment {
  const assessments: RiskAssessment[] = []
  for (const path of scope.paths) {
    assessments.push(
      assessRisk(
        {
          tool,
          args: { path: path.path },
          mode,
          cwd: resolved.cwd,
          platform: resolved.platform,
          probe: resolved.probe,
        },
        resolved.policy,
      ),
    )
  }
  for (const command of scope.commands) {
    assessments.push(
      assessRisk(
        {
          tool,
          args: { command: command.text },
          mode,
          cwd: resolved.cwd,
          platform: resolved.platform,
          probe: resolved.probe,
        },
        resolved.policy,
      ),
    )
  }
  if (assessments.length === 0 && scope.args !== undefined) {
    assessments.push(
      assessRisk(
        {
          tool,
          args: scope.args,
          mode,
          cwd: resolved.cwd,
          platform: resolved.platform,
          probe: resolved.probe,
        },
        resolved.policy,
      ),
    )
  }
  if (assessments.length === 0) {
    assessments.push(
      assessRisk(
        {
          tool,
          mode,
          cwd: resolved.cwd,
          platform: resolved.platform,
          probe: resolved.probe,
        },
        resolved.policy,
      ),
    )
  }
  return combineAssessments(assessments, resolved.policy)
}

function validateItem(
  raw: unknown,
  index: number,
  resolved: ResolvedOptions,
  errors: PlanIssue[],
  warnings: PlanIssue[],
): DraftItem | undefined {
  if (!isPlainObject(raw)) {
    errors.push({
      code: 'item-not-object',
      message: 'plan item must be an object',
      itemId: `#${index}`,
    })
    return undefined
  }

  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  if (id.length === 0 || id.length > MAX_ID_LENGTH || !ID_PATTERN.test(id)) {
    errors.push({
      code: 'invalid-id',
      message: 'item id must be 1-16 letters/digits/_/- and start with a letter',
      itemId: id.length > 0 ? id : `#${index}`,
      field: 'id',
    })
    return undefined
  }

  const tool = typeof raw.tool === 'string' ? raw.tool.trim().toLowerCase() : ''
  if (tool.length === 0 || tool.length > MAX_TOOL_LENGTH || CONTROL_SINGLE.test(tool)) {
    errors.push({
      code: 'invalid-tool',
      message: 'tool name is missing or invalid',
      itemId: id,
      field: 'tool',
    })
  } else if (!resolved.knownTools.has(tool)) {
    errors.push({
      code: 'unknown-tool',
      message: `tool "${tool}" is not registered`,
      itemId: id,
      field: 'tool',
    })
  }

  const title = typeof raw.title === 'string' ? raw.title.trim() : ''
  if (title.length === 0 || title.length > MAX_TITLE || CONTROL_SINGLE.test(title)) {
    errors.push({
      code: 'invalid-title',
      message: 'title must be 1-120 characters without control characters',
      itemId: id,
      field: 'title',
    })
  }

  let note: string | undefined
  if (raw.note !== undefined) {
    if (typeof raw.note !== 'string') {
      errors.push({
        code: 'invalid-note',
        message: 'note must be a string',
        itemId: id,
        field: 'note',
      })
    } else {
      const text = raw.note.trim()
      if (text.length > MAX_NOTE || CONTROL_MULTILINE.test(text)) {
        errors.push({
          code: 'invalid-note',
          message: 'note is too long or contains a control character',
          itemId: id,
          field: 'note',
        })
      } else if (text.length > 0) {
        note = text
      }
    }
  }

  let mode: string | undefined
  if (raw.mode !== undefined) {
    if (typeof raw.mode !== 'string' || !resolved.modes.has(raw.mode.trim())) {
      errors.push({
        code: 'invalid-mode',
        message: 'mode is not recognised',
        itemId: id,
        field: 'mode',
      })
    } else {
      mode = raw.mode.trim()
    }
  }

  let uses = 1
  if (raw.uses !== undefined) {
    if (
      typeof raw.uses !== 'number' ||
      !Number.isInteger(raw.uses) ||
      raw.uses < 1 ||
      raw.uses > resolved.maxUsesPerItem
    ) {
      errors.push({
        code: 'invalid-uses',
        message: `uses must be an integer between 1 and ${resolved.maxUsesPerItem}`,
        itemId: id,
        field: 'uses',
      })
    } else {
      uses = raw.uses
    }
  }

  const dependsOn: string[] = []
  if (raw.dependsOn !== undefined) {
    if (!Array.isArray(raw.dependsOn)) {
      errors.push({
        code: 'invalid-dependencies',
        message: 'dependsOn must be an array',
        itemId: id,
        field: 'dependsOn',
      })
    } else {
      if (raw.dependsOn.length > MAX_DEPENDENCIES) {
        errors.push({
          code: 'too-many-dependencies',
          message: 'too many dependencies',
          itemId: id,
          field: 'dependsOn',
        })
      }
      const dependencyCount = Math.min(raw.dependsOn.length, MAX_DEPENDENCIES)
      for (let depIndex = 0; depIndex < dependencyCount; depIndex += 1) {
        const dependency: unknown = raw.dependsOn[depIndex]
        if (typeof dependency !== 'string' || !ID_PATTERN.test(dependency)) {
          errors.push({
            code: 'invalid-dependency',
            message: 'dependency id is invalid',
            itemId: id,
            field: `dependsOn[${depIndex}]`,
          })
          continue
        }
        if (dependency === id) {
          errors.push({
            code: 'self-dependency',
            message: 'item cannot depend on itself',
            itemId: id,
            field: 'dependsOn',
          })
          continue
        }
        if (dependsOn.includes(dependency)) {
          errors.push({
            code: 'duplicate-dependency',
            message: 'dependency is listed twice',
            itemId: id,
            field: 'dependsOn',
          })
          continue
        }
        dependsOn.push(dependency)
      }
    }
  }

  const scope = validateScope(raw.scope, id, resolved, errors, warnings)
  const risk = assessItemRisk(tool, scope, mode, resolved)
  const scoped = hasScope(scope)
  if (!scoped) {
    warnings.push({
      code: 'scope-missing',
      message: 'item has no matching scope and will remain manual',
      itemId: id,
    })
  }
  if (risk.level === 'critical') {
    warnings.push({
      code: 'critical-item',
      message: 'critical operation is never auto-approved',
      itemId: id,
    })
  } else if (risk.level === 'high') {
    warnings.push({
      code: 'high-risk-item',
      message: 'high-risk operation stays manual by default',
      itemId: id,
    })
  } else if (risk.level === 'unknown') {
    warnings.push({
      code: 'unknown-risk-item',
      message: 'risk cannot be classified; item stays manual',
      itemId: id,
    })
  }
  if (scope.commands.length > 0 && !isCommandTool(tool)) {
    warnings.push({
      code: 'scope-tool-mismatch',
      message: 'command scope declared for a non-command tool',
      itemId: id,
    })
  }
  if (scope.paths.length > 0 && isWriteTool(tool) === false && isCommandTool(tool)) {
    warnings.push({
      code: 'scope-tool-mismatch',
      message: 'path scope declared for a command tool',
      itemId: id,
    })
  }

  const autoEligible = scoped && risk.autoEligible
  return {
    id,
    tool,
    title,
    note,
    mode,
    uses,
    dependsOn,
    scope,
    risk,
    autoEligible,
    manualOnly: !autoEligible,
    index,
  }
}

function countRisks(items: readonly ValidatedPlanItem[]): PlanCounts {
  const counts: PlanCounts = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    unknown: 0,
  }
  for (const item of items) counts[item.risk.level] += 1
  return counts
}

export function validatePlan(
  input: unknown,
  options: PlanValidationOptions,
): PlanValidationResult {
  try {
    return validatePlanUnsafe(input, options)
  } catch {
    return {
      ok: false,
      errors: [{ code: 'validation-error', message: 'plan validation failed unexpectedly' }],
      warnings: [],
    }
  }
}

function validatePlanUnsafe(
  input: unknown,
  options: PlanValidationOptions,
): PlanValidationResult {
  const errors: PlanIssue[] = []
  const warnings: PlanIssue[] = []
  const resolved = resolveOptions(options, errors)
  if (resolved === undefined) return { ok: false, errors, warnings }

  if (!isPlainObject(input)) {
    errors.push({ code: 'plan-not-object', message: 'plan must be an object' })
    return { ok: false, errors, warnings }
  }

  const summary = validateSummary(input.summary, errors)
  if (!Array.isArray(input.items)) {
    errors.push({ code: 'invalid-items', message: 'items must be an array', field: 'items' })
    return { ok: false, errors, warnings }
  }
  if (input.items.length === 0) {
    errors.push({ code: 'empty-items', message: 'plan has no items', field: 'items' })
    return { ok: false, errors, warnings }
  }
  if (input.items.length > resolved.maxItems) {
    errors.push({
      code: 'too-many-items',
      message: `plan exceeds ${resolved.maxItems} items`,
      field: 'items',
    })
    return { ok: false, errors, warnings }
  }

  const drafts: DraftItem[] = []
  for (let index = 0; index < input.items.length; index += 1) {
    const draft = validateItem(input.items[index], index, resolved, errors, warnings)
    if (draft !== undefined) drafts.push(draft)
  }

  // Duplicate ids are case-insensitive for display safety.
  const byId = new Map<string, DraftItem>()
  const byLowerId = new Map<string, DraftItem>()
  for (const draft of drafts) {
    const lower = draft.id.toLowerCase()
    const existing = byLowerId.get(lower)
    if (existing !== undefined) {
      errors.push({
        code: 'duplicate-id',
        message: `item id "${draft.id}" duplicates "${existing.id}"`,
        itemId: draft.id,
        field: 'id',
      })
      continue
    }
    byLowerId.set(lower, draft)
    byId.set(draft.id, draft)
  }

  for (const draft of byId.values()) {
    for (const dependency of draft.dependsOn) {
      if (!byId.has(dependency)) {
        errors.push({
          code: 'unknown-dependency',
          message: `dependency "${dependency}" does not exist`,
          itemId: draft.id,
          field: 'dependsOn',
        })
      }
    }
  }

  // Cycle detection (iterative DFS colouring).
  const colour = new Map<string, 0 | 1 | 2>()
  let cycle = false
  const visit = (id: string): boolean => {
    const state = colour.get(id) ?? 0
    if (state === 1) return true
    if (state === 2) return false
    colour.set(id, 1)
    const item = byId.get(id)
    if (item !== undefined) {
      for (const dependency of item.dependsOn) {
        if (byId.has(dependency) && visit(dependency)) return true
      }
    }
    colour.set(id, 2)
    return false
  }
  for (const id of byId.keys()) {
    if (!colour.has(id) && visit(id)) {
      cycle = true
      break
    }
  }
  if (cycle) {
    errors.push({ code: 'dependency-cycle', message: 'dependency graph contains a cycle' })
  }

  if (errors.length > 0) return { ok: false, errors, warnings }

  const totalUses = drafts.reduce((sum, draft) => sum + draft.uses, 0)
  if (totalUses > resolved.maxTotalUses) {
    errors.push({
      code: 'too-many-uses',
      message: `plan exceeds ${resolved.maxTotalUses} total uses`,
    })
    return { ok: false, errors, warnings }
  }

  const stageMemo = new Map<string, number>()
  const stageOf = (id: string): number => {
    const memo = stageMemo.get(id)
    if (memo !== undefined) return memo
    const item = byId.get(id)
    let stage = 0
    if (item !== undefined) {
      for (const dependency of item.dependsOn) {
        stage = Math.max(stage, stageOf(dependency) + 1)
      }
    }
    stageMemo.set(id, stage)
    return stage
  }

  const items: ValidatedPlanItem[] = []
  const stages: string[][] = []
  for (const draft of drafts) {
    const stage = stageOf(draft.id)
    while (stages.length <= stage) stages.push([])
    stages[stage]?.push(draft.id)
    items.push({
      id: draft.id,
      tool: draft.tool,
      title: draft.title,
      note: draft.note,
      mode: draft.mode,
      uses: draft.uses,
      dependsOn: draft.dependsOn,
      stage,
      scope: draft.scope,
      risk: draft.risk,
      autoEligible: draft.autoEligible,
      manualOnly: draft.manualOnly,
    })
  }

  const counts = countRisks(items)
  const plan: ValidatedPlan = {
    summary,
    items,
    stages,
    counts,
    autoItems: items.filter((item) => item.autoEligible).map((item) => item.id),
    manualItems: items.filter((item) => !item.autoEligible).map((item) => item.id),
    planHash: '',
  }
  plan.planHash = computePlanHash(plan)
  return { ok: true, plan, errors, warnings }
}
