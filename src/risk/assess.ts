import { isPlainObject } from '../core/json.js'
import {
  APPROVAL_MODES,
  DEFAULT_RISK_POLICY,
  RISK_RANK,
  maxRisk,
} from '../core/types.js'
import type {
  ApprovalMode,
  RiskAssessment,
  RiskLevel,
  RiskPolicy,
  RiskReason,
} from '../core/types.js'
import {
  INTERFACE_TOOLS,
  NETWORK_TOOLS,
  isCommandTool,
  isDeleteTool,
  isMoveTool,
  isPluginTool,
  isReadTool,
  isWriteTool,
} from '../core/tools.js'
import { normalizePath } from '../path/normalize.js'
import type { PathPlatform, PathProbe } from '../path/types.js'
import { assessCommandRisk } from './commands.js'
import { assessPathRisk } from './paths.js'
import { normalizeCommand } from '../command/normalize.js'

export interface RiskInput {
  tool: string
  args?: unknown
  mode?: string
  cwd?: string
  platform?: PathPlatform
  probe?: PathProbe
}

const PLUGIN_READ_ACTIONS = new Set([
  'list_plugins',
  'list_bundles',
  'list_version_exemptions',
])

const PATH_VALUE_KEYS = [
  'file_path',
  'filePath',
  'path',
  'target',
  'destination',
  'source',
  // dsh-ops `ops_copy`/`ops_move` spell the destination `to`; both ends of a
  // move/copy must be assessed, or a destination outside the workspace would
  // inherit the source's lower risk level.
  'to',
] as const

function reason(code: string, level: RiskLevel, message: string): RiskReason {
  return { code, level, message }
}

function mergeReasons(reasons: readonly RiskReason[]): RiskReason[] {
  const byCode = new Map<string, RiskReason>()
  for (const item of reasons) {
    const existing = byCode.get(item.code)
    if (existing === undefined || RISK_RANK[item.level] > RISK_RANK[existing.level]) {
      byCode.set(item.code, item)
    }
  }
  return [...byCode.values()].sort((a, b) => {
    const rank = RISK_RANK[b.level] - RISK_RANK[a.level]
    return rank !== 0 ? rank : a.code.localeCompare(b.code)
  })
}

function effectivePolicy(policy: RiskPolicy | undefined): RiskPolicy {
  if (
    policy === undefined ||
    typeof policy.version !== 'number' ||
    !Array.isArray(policy.autoLevels)
  ) {
    return DEFAULT_RISK_POLICY
  }
  return policy
}

function finalize(
  level: RiskLevel,
  reasons: readonly RiskReason[],
  policy: RiskPolicy,
): RiskAssessment {
  const merged = mergeReasons(reasons)
  let finalLevel = level
  for (const item of merged) finalLevel = maxRisk(finalLevel, item.level)
  if (merged.length === 0) {
    merged.push(reason('unclassified', 'unknown', 'no applicable risk rule'))
    finalLevel = 'unknown'
  }

  const allowHigh = policy.allowHighRiskGrants === true
  const requireSecond = policy.requireSecondConfirmForHigh === true
  const requiresSecondConfirm = finalLevel === 'high' && allowHigh

  let autoEligible: boolean
  switch (finalLevel) {
    case 'critical':
    case 'unknown':
      autoEligible = false
      break
    case 'high':
      autoEligible = allowHigh && requireSecond
      break
    case 'medium':
    case 'low':
      autoEligible = policy.autoLevels.includes(finalLevel)
      break
  }

  return {
    level: finalLevel,
    reasons: merged,
    autoEligible,
    requiresSecondConfirm,
    policyVersion: policy.version,
  }
}

function extractPathValues(args: unknown): string[] {
  if (!isPlainObject(args)) return []
  const found: string[] = []
  for (const key of PATH_VALUE_KEYS) {
    const value = args[key]
    if (typeof value === 'string' && value.length > 0) found.push(value)
  }
  for (const key of ['paths', 'files']) {
    const value = args[key]
    if (!Array.isArray(value)) continue
    for (const item of value) {
      if (typeof item === 'string' && item.length > 0) {
        found.push(item)
      } else if (isPlainObject(item) && typeof item.path === 'string' && item.path.length > 0) {
        found.push(item.path)
      }
    }
  }
  return [...new Set(found)]
}

interface ExtractedCommand {
  text: string
  argvJoined: boolean
}

function extractCommand(args: unknown): ExtractedCommand | undefined {
  if (!isPlainObject(args)) return undefined
  for (const key of ['command', 'cmd', 'script', 'shell']) {
    const value = args[key]
    if (typeof value === 'string' && value.trim().length > 0) {
      return { text: value, argvJoined: false }
    }
  }
  const argv = args.argv
  if (Array.isArray(argv) && argv.length > 0 && argv.every((item) => typeof item === 'string')) {
    return { text: argv.join(' '), argvJoined: true }
  }
  return undefined
}

function assessRiskUnsafe(input: RiskInput, policy: RiskPolicy): RiskAssessment {
  const tool = typeof input.tool === 'string' ? input.tool.trim().toLowerCase() : ''
  const platform: PathPlatform =
    input.platform === 'win32' || input.platform === 'posix'
      ? input.platform
      : process.platform === 'win32'
        ? 'win32'
        : 'posix'

  if (tool.length === 0) {
    return finalize('unknown', [reason('unknown-tool', 'unknown', 'tool name is missing')], policy)
  }

  const cwdResult =
    input.cwd === undefined
      ? undefined
      : normalizePath(input.cwd, { platform, probe: input.probe })
  const cwd =
    cwdResult?.ok === true && cwdResult.path.isDirectory !== false
      ? cwdResult.path
      : undefined

  const reasons: RiskReason[] = []
  let level: RiskLevel = 'low'
  const record = (code: string, reasonLevel: RiskLevel, message: string): void => {
    reasons.push(reason(code, reasonLevel, message))
    level = maxRisk(level, reasonLevel)
  }

  if (input.mode !== undefined) {
    if (
      typeof input.mode !== 'string' ||
      input.mode.trim().length === 0 ||
      !APPROVAL_MODES.includes(input.mode as ApprovalMode)
    ) {
      record('unknown-mode', 'high', 'unrecognised approval mode')
    } else {
      if (input.mode === 'danger-full-access') {
        record('mode-full-access', 'high', 'requests full filesystem access')
      }
      if (
        input.mode === 'read-only' &&
        (isWriteTool(tool) || isDeleteTool(tool) || isMoveTool(tool) || isCommandTool(tool))
      ) {
        record('mode-conflict', 'high', 'write operation under read-only mode')
      }
    }
  }

  if (isReadTool(tool)) {
    record('read-only-tool', 'low', 'read-only tool')
    return finalize(level, reasons, policy)
  }

  if (INTERFACE_TOOLS.has(tool)) {
    record('interface-tool', 'low', 'interaction or orchestration tool')
    return finalize(level, reasons, policy)
  }

  if (NETWORK_TOOLS.has(tool)) {
    record('network-read', 'low', 'read-only network access')
    return finalize(level, reasons, policy)
  }

  if (isPluginTool(tool)) {
    const action =
      isPlainObject(input.args) && typeof input.args.action === 'string'
        ? input.args.action
        : undefined
    if (action !== undefined && PLUGIN_READ_ACTIONS.has(action)) {
      record('plugin-read', 'low', 'read-only plugin profile inspection')
    } else {
      record('dsh-plugin-config', 'critical', 'modifies the DSH profile or installed plugins')
    }
    return finalize(level, reasons, policy)
  }

  if (isWriteTool(tool)) {
    const paths = extractPathValues(input.args)
    if (paths.length === 0) {
      record('unparsed-target', 'unknown', 'write target could not be parsed')
      return finalize(level, reasons, policy)
    }
    for (const path of paths) {
      const normalized = normalizePath(path, {
        platform,
        cwd: input.cwd,
        probe: input.probe,
      })
      if (!normalized.ok) {
        record('invalid-path', 'unknown', 'write target is not a safe absolute path')
        continue
      }
      const pathRisk = assessPathRisk(normalized.path, { cwd })
      for (const item of pathRisk.reasons) reasons.push(item)
      level = maxRisk(level, pathRisk.level)
    }
    return finalize(level, reasons, policy)
  }

  if (isDeleteTool(tool)) {
    record('delete', 'high', 'deletes files')
    if (isPlainObject(input.args)) {
      if (
        input.args.recursive === true ||
        input.args.recurse === true ||
        input.args.force === true
      ) {
        record('recursive-delete', 'critical', 'recursive or forced delete')
      }
    }
    const paths = extractPathValues(input.args)
    for (const path of paths) {
      const normalized = normalizePath(path, {
        platform,
        cwd: input.cwd,
        probe: input.probe,
      })
      if (!normalized.ok) {
        record('invalid-path', 'unknown', 'delete target is not a safe absolute path')
        continue
      }
      const pathRisk = assessPathRisk(normalized.path, { cwd })
      for (const item of pathRisk.reasons) reasons.push(item)
      level = maxRisk(level, pathRisk.level)
    }
    return finalize(level, reasons, policy)
  }

  if (isMoveTool(tool)) {
    record('move', 'high', 'moves or renames files')
    const paths = extractPathValues(input.args)
    for (const path of paths) {
      const normalized = normalizePath(path, {
        platform,
        cwd: input.cwd,
        probe: input.probe,
      })
      if (!normalized.ok) {
        record('invalid-path', 'unknown', 'move target is not a safe absolute path')
        continue
      }
      const pathRisk = assessPathRisk(normalized.path, { cwd })
      for (const item of pathRisk.reasons) reasons.push(item)
      level = maxRisk(level, pathRisk.level)
    }
    return finalize(level, reasons, policy)
  }

  if (isCommandTool(tool)) {
    const command = extractCommand(input.args)
    if (command === undefined) {
      record('unparsed-command', 'unknown', 'command could not be parsed')
      return finalize(level, reasons, policy)
    }
    const normalized = normalizeCommand(command.text, platform)
    if (!normalized.ok) {
      record('invalid-command', 'unknown', 'command is empty or malformed')
      return finalize(level, reasons, policy)
    }
    if (command.argvJoined) {
      record('argv-joined', 'high', 'argv was joined without shell quoting')
    }
    const commandRisk = assessCommandRisk(normalized.command, { cwd })
    for (const item of commandRisk.reasons) reasons.push(item)
    level = maxRisk(level, commandRisk.level)
    return finalize(level, reasons, policy)
  }

  record('unknown-tool', 'unknown', 'tool is not in the risk policy')
  return finalize(level, reasons, policy)
}

/**
 * Deterministic, advisory risk assessment.
 *
 * The engine never rejects anything by itself; it only recommends a level and
 * whether the *risk gate* would allow an automatic grant. Any unexpected input
 * or exception degrades to `unknown` (manual).
 */
export function assessRisk(
  input: RiskInput,
  policy?: RiskPolicy,
): RiskAssessment {
  const effective = effectivePolicy(policy)
  try {
    return assessRiskUnsafe(input, effective)
  } catch {
    return {
      level: 'unknown',
      reasons: [reason('assessment-error', 'unknown', 'risk assessment failed')],
      autoEligible: false,
      requiresSecondConfirm: false,
      policyVersion: effective.version,
    }
  }
}

/** Combine several assessments (e.g. multiple paths in one plan item). */
export function combineAssessments(
  assessments: readonly RiskAssessment[],
  policy?: RiskPolicy,
): RiskAssessment {
  const effective = effectivePolicy(policy)
  if (assessments.length === 0) {
    return finalize('unknown', [reason('unclassified', 'unknown', 'no targets')], effective)
  }
  const reasons: RiskReason[] = []
  let level: RiskLevel = 'low'
  for (const assessment of assessments) {
    reasons.push(...assessment.reasons)
    level = maxRisk(level, assessment.level)
  }
  return finalize(level, reasons, effective)
}
