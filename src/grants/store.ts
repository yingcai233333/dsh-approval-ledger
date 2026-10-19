/**
 * Sprint 1 in-memory grant store.
 *
 * Design invariants:
 * - grants are keyed by `(sessionId, turn)` and never persist;
 * - child sessions never inherit grants; no method authorizes across sessions,
 *   only aggregate read-only summaries;
 * - only auto-eligible, unblocked plan items get an `active` grant;
 * - each successful match consumes at most one use, synchronously;
 * - `turn/end`, `session/disposed`, and `dispose()` remove grants;
 * - any malformed request or exception degrades to `manual` (fail closed).
 *
 * This module has no DSH imports and performs no filesystem access. Filesystem
 * facts are limited to the optional `PathProbe` in the match request.
 */

import { validateArgs } from '../args/validate.js'
import { isPlainObject } from '../core/json.js'
import { DEFAULT_RISK_POLICY } from '../core/types.js'
import type { JsonObject, RiskPolicy } from '../core/types.js'
import { defaultPlatform } from '../path/normalize.js'
import type { PathPlatform, PathProbe } from '../path/types.js'
import type { NormalizedPlanScope, ValidatedPlan, ValidatedPlanItem } from '../plan/types.js'
import { assessRisk } from '../risk/assess.js'
import {
  evaluateRiskGate,
  inferGrantKind,
  matchGrantScope,
  scopeHasTargets,
} from './match.js'
import type {
  CreateGrantsContext,
  GrantDecision,
  GrantKind,
  GrantMatchReason,
  GrantMatchRequest,
  GrantMatchResult,
  GrantSet,
  GrantSnapshot,
  GrantState,
  GrantStoreMode,
  GrantStoreOptions,
  SessionGrantSummary,
} from './types.js'

interface GrantRecord {
  planId: string
  sessionId: string
  turn: number
  itemId: string
  tool: string
  kind?: GrantKind
  mode?: string
  scope: NormalizedPlanScope
  usesLeft: number
  dependsOn: readonly string[]
  stage: number
  state: GrantState
}

interface PlanState {
  planId: string
  turn: number
  items: Map<string, GrantRecord>
}

interface SessionState {
  plans: Map<string, PlanState>
}

interface NormalizedMatchRequest {
  sessionId: string
  turn: number
  tool: string
  kind?: string
  mode?: string
  args?: unknown
  paths?: readonly string[]
  command?: string
  cwd?: string
  platform: PathPlatform
  probe?: PathProbe
  confirmedHighRisk: boolean
  observe: boolean
}

type NormalizedRequestResult =
  | { ok: true; request: NormalizedMatchRequest }
  | { ok: false; detail: string }

type EligibilityClass = 'auto' | 'manual' | 'blocked'

/**
 * Reason precedence when several grants fail for different reasons. Structural
 * mismatches are reported before per-grant state so a wrong-session/turn/tool
 * attempt never looks like an exhausted grant.
 */
const REASON_PRIORITY: readonly GrantMatchReason[] = [
  'turn-mismatch',
  'tool-mismatch',
  'kind-mismatch',
  'mode-mismatch',
  'grant-manual',
  'grant-blocked-by-manual',
  'grant-exhausted',
  'grant-revoked',
  'dependencies-not-ready',
  'scope-mismatch',
  'no-grant',
]

function manualResult(reason: GrantMatchReason, detail?: string): GrantMatchResult {
  const result: GrantMatchResult = { decision: 'manual', reason }
  if (detail !== undefined) result.detail = detail
  return result
}

function planKey(turn: number, planId: string): string {
  return `${turn}\u0000${planId}`
}

function defaultPolicy(): RiskPolicy {
  return {
    version: DEFAULT_RISK_POLICY.version,
    autoLevels: [...DEFAULT_RISK_POLICY.autoLevels],
    allowHighRiskGrants: DEFAULT_RISK_POLICY.allowHighRiskGrants === true,
    requireSecondConfirmForHigh: DEFAULT_RISK_POLICY.requireSecondConfirmForHigh !== false,
  }
}

function normalizePolicy(policy: RiskPolicy | undefined): RiskPolicy {
  try {
    if (
      policy === undefined ||
      typeof policy !== 'object' ||
      policy === null ||
      typeof policy.version !== 'number' ||
      !Array.isArray(policy.autoLevels)
    ) {
      return defaultPolicy()
    }
    return {
      version: policy.version,
      autoLevels: [...policy.autoLevels],
      allowHighRiskGrants: policy.allowHighRiskGrants === true,
      requireSecondConfirmForHigh: policy.requireSecondConfirmForHigh !== false,
    }
  } catch {
    return defaultPolicy()
  }
}

function derivePlanId(plan: ValidatedPlan): string {
  let hash: unknown
  try {
    hash = plan.planHash
  } catch {
    hash = undefined
  }
  if (typeof hash === 'string') {
    const match = /^sha256:([a-f0-9]{8})/i.exec(hash)
    if (match !== null) return `P-${match[1]?.toLowerCase() ?? ''}`
  }
  throw new TypeError('planId is required when the validated plan has no usable planHash')
}

function readPlanItems(plan: ValidatedPlan): ValidatedPlanItem[] {
  if (!isPlainObject(plan)) {
    throw new TypeError('createFromPlan expects a ValidatedPlan object')
  }
  const rawItems: unknown = plan.items
  if (!Array.isArray(rawItems)) {
    throw new TypeError('validated plan items must be an array')
  }

  const items: ValidatedPlanItem[] = []
  for (const raw of rawItems) {
    if (!isPlainObject(raw)) throw new TypeError('plan item must be an object')
    const item = raw as unknown as ValidatedPlanItem
    if (typeof item.id !== 'string' || item.id.length === 0) {
      throw new TypeError('plan item id is missing')
    }
    if (typeof item.tool !== 'string' || item.tool.trim().length === 0) {
      throw new TypeError(`plan item ${item.id} tool is missing`)
    }
    if (!isPlainObject(item.scope)) {
      throw new TypeError(`plan item ${item.id} scope is malformed`)
    }
    if (!Array.isArray(item.scope.paths) || !Array.isArray(item.scope.commands)) {
      throw new TypeError(`plan item ${item.id} scope arrays are malformed`)
    }
    if (item.scope.args !== undefined && !isPlainObject(item.scope.args)) {
      throw new TypeError(`plan item ${item.id} args scope is malformed`)
    }
    if (!Array.isArray(item.dependsOn)) {
      throw new TypeError(`plan item ${item.id} dependencies are malformed`)
    }
    if (
      item.mode !== undefined &&
      (typeof item.mode !== 'string' || item.mode.trim().length === 0)
    ) {
      throw new TypeError(`plan item ${item.id} mode is malformed`)
    }
    if (typeof item.uses !== 'number' || !Number.isInteger(item.uses) || item.uses < 1) {
      throw new TypeError(`plan item ${item.id} uses is invalid`)
    }
    if (
      typeof item.stage !== 'number' ||
      !Number.isInteger(item.stage) ||
      item.stage < 0
    ) {
      throw new TypeError(`plan item ${item.id} stage is invalid`)
    }
    if (
      !isPlainObject(item.risk) ||
      typeof item.risk.level !== 'string' ||
      typeof item.risk.autoEligible !== 'boolean'
    ) {
      throw new TypeError(`plan item ${item.id} risk is malformed`)
    }
    items.push(item)
  }
  return items
}

function cloneArgs(args: JsonObject | undefined): JsonObject | undefined {
  if (args === undefined) return undefined
  const cloned = validateArgs(args)
  if (!cloned.ok) {
    throw new TypeError('plan args scope is not valid JSON')
  }
  return cloned.value
}

function cloneScope(scope: NormalizedPlanScope): NormalizedPlanScope {
  const cloned: NormalizedPlanScope = {
    paths: scope.paths.map((path) => ({ ...path })),
    commands: scope.commands.map((command) => ({
      text: command.text,
      autoEligible: command.autoEligible,
      reasons: [...command.reasons],
    })),
  }
  const args = cloneArgs(scope.args)
  if (args !== undefined) {
    cloned.args = args
    cloned.argsSerialized = scope.argsSerialized
  }
  return cloned
}

/**
 * An item may become an auto grant only when the validated plan says it is
 * auto-eligible, it is not manual-only, its risk is low/medium/high, and it has
 * a real scope. This is defense in depth against a hand-built or inconsistent
 * `ValidatedPlan`: critical/unknown never get an active grant.
 */
function isAutoEligibleItem(item: ValidatedPlanItem): boolean {
  if (item.manualOnly === true) return false
  if (item.autoEligible !== true) return false
  if (!isPlainObject(item.risk)) return false
  if (item.risk.autoEligible !== true) return false
  const level = item.risk.level
  if (level !== 'low' && level !== 'medium' && level !== 'high') return false
  return scopeHasTargets(item.scope)
}

function classifyItems(items: readonly ValidatedPlanItem[]): Map<string, EligibilityClass> {
  const byId = new Map<string, ValidatedPlanItem>()
  for (const item of items) byId.set(item.id, item)

  const memo = new Map<string, EligibilityClass>()
  const visiting = new Set<string>()

  const classify = (id: string): EligibilityClass => {
    const cached = memo.get(id)
    if (cached !== undefined) return cached
    const item = byId.get(id)
    if (item === undefined) return 'blocked'
    if (!isAutoEligibleItem(item)) {
      memo.set(id, 'manual')
      return 'manual'
    }
    if (visiting.has(id)) {
      memo.set(id, 'blocked')
      return 'blocked'
    }

    visiting.add(id)
    let blocked = false
    for (const dependency of item.dependsOn) {
      if (dependency === id) {
        blocked = true
        break
      }
      if (classify(dependency) !== 'auto') {
        blocked = true
        break
      }
    }
    visiting.delete(id)

    const result: EligibilityClass = blocked ? 'blocked' : 'auto'
    memo.set(id, result)
    return result
  }

  const classes = new Map<string, EligibilityClass>()
  for (const item of items) classes.set(item.id, classify(item.id))
  return classes
}

function snapshot(grant: GrantRecord): GrantSnapshot {
  const result: GrantSnapshot = {
    planId: grant.planId,
    sessionId: grant.sessionId,
    turn: grant.turn,
    itemId: grant.itemId,
    tool: grant.tool,
    scope: cloneScope(grant.scope),
    usesLeft: grant.usesLeft,
    dependsOn: [...grant.dependsOn],
    stage: grant.stage,
    state: grant.state,
  }
  if (grant.kind !== undefined) result.kind = grant.kind
  if (grant.mode !== undefined) result.mode = grant.mode
  return result
}

function parseCreateContext(context: unknown): CreateGrantsContext {
  if (!isPlainObject(context)) throw new TypeError('grant context must be an object')
  const sessionId: unknown = context.sessionId
  if (typeof sessionId !== 'string' || sessionId.trim().length === 0) {
    throw new TypeError('grant context sessionId is invalid')
  }
  const turn: unknown = context.turn
  if (typeof turn !== 'number' || !Number.isInteger(turn) || turn < 0) {
    throw new TypeError('grant context turn is invalid')
  }
  let planId: string | undefined
  if (context.planId !== undefined) {
    if (typeof context.planId !== 'string' || context.planId.trim().length === 0) {
      throw new TypeError('grant context planId is invalid')
    }
    planId = context.planId
  }
  return planId === undefined ? { sessionId, turn } : { sessionId, turn, planId }
}

function normalizeMatchRequest(input: unknown): NormalizedRequestResult {
  if (!isPlainObject(input)) return { ok: false, detail: 'request-not-object' }

  const sessionId: unknown = input.sessionId
  if (typeof sessionId !== 'string' || sessionId.trim().length === 0) {
    return { ok: false, detail: 'session-id' }
  }
  const turn: unknown = input.turn
  if (typeof turn !== 'number' || !Number.isInteger(turn) || turn < 0) {
    return { ok: false, detail: 'turn' }
  }
  const rawTool: unknown = input.tool
  if (typeof rawTool !== 'string' || rawTool.trim().length === 0) {
    return { ok: false, detail: 'tool' }
  }
  const tool = rawTool.trim().toLowerCase()

  let kind: string | undefined
  if (input.kind !== undefined) {
    if (typeof input.kind !== 'string' || input.kind.trim().length === 0) {
      return { ok: false, detail: 'kind' }
    }
    kind = input.kind.trim().toLowerCase()
  }

  let mode: string | undefined
  if (input.mode !== undefined) {
    if (typeof input.mode !== 'string' || input.mode.trim().length === 0) {
      return { ok: false, detail: 'mode' }
    }
    mode = input.mode.trim()
  }

  let cwd: string | undefined
  if (input.cwd !== undefined) {
    if (typeof input.cwd !== 'string' || input.cwd.trim().length === 0) {
      return { ok: false, detail: 'cwd' }
    }
    cwd = input.cwd
  }

  let platform: PathPlatform
  if (input.platform !== undefined) {
    if (input.platform !== 'win32' && input.platform !== 'posix') {
      return { ok: false, detail: 'platform' }
    }
    platform = input.platform
  } else {
    platform = defaultPlatform()
  }

  let probe: PathProbe | undefined
  if (input.probe !== undefined) {
    if (typeof input.probe !== 'object' || input.probe === null) {
      return { ok: false, detail: 'probe' }
    }
    probe = input.probe as PathProbe
  }

  let paths: readonly string[] | undefined
  if (input.paths !== undefined) {
    if (!Array.isArray(input.paths)) return { ok: false, detail: 'paths' }
    const copy: string[] = []
    for (const value of input.paths) {
      if (typeof value !== 'string' || value.length === 0) {
        return { ok: false, detail: 'paths' }
      }
      copy.push(value)
    }
    paths = copy
  }

  let command: string | undefined
  if (input.command !== undefined) {
    if (typeof input.command !== 'string' || input.command.trim().length === 0) {
      return { ok: false, detail: 'command' }
    }
    command = input.command
  }

  let confirmedHighRisk = false
  if (input.confirmedHighRisk !== undefined) {
    if (typeof input.confirmedHighRisk !== 'boolean') {
      return { ok: false, detail: 'confirmed-high-risk' }
    }
    confirmedHighRisk = input.confirmedHighRisk
  }

  let observe = false
  if (input.observe !== undefined) {
    if (typeof input.observe !== 'boolean') return { ok: false, detail: 'observe' }
    observe = input.observe
  }

  const request: NormalizedMatchRequest = {
    sessionId,
    turn,
    tool,
    platform,
    confirmedHighRisk,
    observe,
  }
  if (kind !== undefined) request.kind = kind
  if (mode !== undefined) request.mode = mode
  if (cwd !== undefined) request.cwd = cwd
  if (probe !== undefined) request.probe = probe
  if (paths !== undefined) request.paths = paths
  if (command !== undefined) request.command = command
  if (input.args !== undefined) request.args = input.args
  return { ok: true, request }
}

/**
 * In-memory, turn-scoped grant store.
 *
 * Use `createFromPlan` after the user approves a validated plan, then call
 * `match(request)` from an `approval/request` listener. A successful match
 * consumes exactly one use synchronously; there are no async locks and no
 * awaits, so a single JavaScript turn cannot over-consume.
 */
export class GrantStore {
  private readonly sessions = new Map<string, SessionState>()
  private readonly policy: RiskPolicy
  private modeValue: GrantStoreMode
  private disposed = false
  private matching = false

  constructor(options: GrantStoreOptions = {}) {
    const observe = options.mode === 'observe' || options.observe === true
    this.modeValue = observe ? 'observe' : 'active'
    this.policy = normalizePolicy(options.policy)
  }

  /** Current store mode. Observe mode can never return `allowed-once`. */
  get mode(): GrantStoreMode {
    return this.modeValue
  }

  /**
   * Switch between enforcement and observe mode.
   *
   * Observe mode consumes uses too, so a sequence of calls behaves the same as
   * it would in active mode; only the returned decision changes.
   */
  setMode(mode: GrantStoreMode): void {
    if (mode === 'observe' || mode === 'active') this.modeValue = mode
  }

  /**
   * Register grants for a validated plan.
   *
   * Every item gets a record. Only auto-eligible items whose dependencies are
   * also auto-eligible become `active` grants. Manual-only items stay `manual`,
   * and any item that transitively depends on a manual/blocked item becomes
   * `blocked-by-manual`, even if its own plan-time risk was auto-eligible.
   *
   * Throws on a malformed validated plan, an invalid context, a reused
   * `(session, turn, planId)`, or a disposed store. The store is not mutated
   * when this throws.
   */
  createFromPlan(plan: ValidatedPlan, context: CreateGrantsContext): GrantSet {
    if (this.disposed) throw new Error('grant store is disposed')
    const parsed = parseCreateContext(context)
    const planId = parsed.planId ?? derivePlanId(plan)
    const existing = this.sessions.get(parsed.sessionId)
    const key = planKey(parsed.turn, planId)
    if (existing?.plans.has(key) === true) {
      throw new Error(`plan ${planId} is already registered for this session and turn`)
    }

    const items = readPlanItems(plan)
    const seen = new Set<string>()
    for (const item of items) {
      if (seen.has(item.id)) throw new TypeError(`duplicate plan item id: ${item.id}`)
      seen.add(item.id)
    }

    const classes = classifyItems(items)
    const records = new Map<string, GrantRecord>()
    for (const item of items) {
      const classification = classes.get(item.id) ?? 'blocked'
      const state: GrantState =
        classification === 'auto'
          ? 'active'
          : classification === 'manual'
            ? 'manual'
            : 'blocked-by-manual'
      const record: GrantRecord = {
        planId,
        sessionId: parsed.sessionId,
        turn: parsed.turn,
        itemId: item.id,
        tool: item.tool.trim().toLowerCase(),
        scope: cloneScope(item.scope),
        usesLeft: state === 'active' ? item.uses : 0,
        dependsOn: [...item.dependsOn],
        stage: item.stage,
        state,
      }
      const kind = inferGrantKind(item.scope)
      if (kind !== undefined) record.kind = kind
      if (typeof item.mode === 'string' && item.mode.length > 0) record.mode = item.mode
      records.set(item.id, record)
    }

    const snapshots = [...records.values()].map((record) => snapshot(record))

    const session: SessionState = existing ?? { plans: new Map<string, PlanState>() }
    session.plans.set(key, { planId, turn: parsed.turn, items: records })
    if (existing === undefined) this.sessions.set(parsed.sessionId, session)

    return {
      planId,
      sessionId: parsed.sessionId,
      turn: parsed.turn,
      items: snapshots,
      grants: snapshots.filter(
        (item) => item.state === 'active' || item.state === 'exhausted',
      ),
      auto: snapshots.filter((item) => item.state === 'active').map((item) => item.itemId),
      blocked: snapshots
        .filter((item) => item.state === 'blocked-by-manual')
        .map((item) => item.itemId),
      manual: snapshots.filter((item) => item.state === 'manual').map((item) => item.itemId),
    }
  }

  /**
   * Match and (on success) consume one use.
   *
   * Observe mode returns `would-allow` instead of `allowed-once` but still
   * consumes a use, so the observed sequence mirrors enforcement.
   */
  match(request: GrantMatchRequest): GrantMatchResult {
    if (this.disposed) return manualResult('store-disposed')
    if (this.matching) return manualResult('reentrant')
    this.matching = true
    try {
      return this.matchUnsafe(request)
    } catch {
      return manualResult('internal-error')
    } finally {
      this.matching = false
    }
  }

  /** List grant records for one session only. Revoked records are removed. */
  listGrants(sessionId: string): GrantSnapshot[] {
    if (typeof sessionId !== 'string') return []
    const session = this.sessions.get(sessionId)
    if (session === undefined) return []
    const result: GrantSnapshot[] = []
    for (const plan of session.plans.values()) {
      for (const grant of plan.items.values()) result.push(snapshot(grant))
    }
    return result
  }

  /**
   * Read-only aggregate for the cross-session overview. It deliberately exposes
   * only counts: never scopes, paths, commands, args, or a way to match against
   * another session.
   */
  listSessionSummaries(): SessionGrantSummary[] {
    if (this.disposed) return []
    const summaries: SessionGrantSummary[] = []
    for (const [sessionId, session] of this.sessions) {
      const summary: SessionGrantSummary = {
        sessionId,
        plans: session.plans.size,
        grants: 0,
        active: 0,
        exhausted: 0,
        manual: 0,
        blocked: 0,
      }
      for (const plan of session.plans.values()) {
        for (const grant of plan.items.values()) {
          summary.grants += 1
          if (grant.state === 'active') summary.active += 1
          else if (grant.state === 'exhausted') summary.exhausted += 1
          else if (grant.state === 'manual') summary.manual += 1
          else if (grant.state === 'blocked-by-manual') summary.blocked += 1
        }
      }
      summaries.push(summary)
    }
    return summaries.sort((left, right) => left.sessionId.localeCompare(right.sessionId))
  }

  /** Look up one grant record within a session, optionally constrained to a turn. */
  getGrant(
    sessionId: string,
    planId: string,
    itemId: string,
    turn?: number,
  ): GrantSnapshot | undefined {
    if (
      typeof sessionId !== 'string' ||
      typeof planId !== 'string' ||
      typeof itemId !== 'string'
    ) {
      return undefined
    }
    if (turn !== undefined && typeof turn !== 'number') return undefined
    const session = this.sessions.get(sessionId)
    if (session === undefined) return undefined
    for (const plan of session.plans.values()) {
      if (plan.planId !== planId) continue
      if (turn !== undefined && plan.turn !== turn) continue
      const grant = plan.items.get(itemId)
      if (grant !== undefined) return snapshot(grant)
    }
    return undefined
  }

  /**
   * Revoke every grant for one `(sessionId, turn)`. Returns the number of
   * records removed. A match after revocation is manual.
   */
  revokeTurn(sessionId: string, turn: number): number {
    if (typeof sessionId !== 'string' || typeof turn !== 'number') return 0
    const session = this.sessions.get(sessionId)
    if (session === undefined) return 0
    let removed = 0
    for (const [key, plan] of session.plans) {
      if (plan.turn !== turn) continue
      removed += plan.items.size
      session.plans.delete(key)
    }
    if (session.plans.size === 0) this.sessions.delete(sessionId)
    return removed
  }

  /** Revoke every grant for one session. Returns the number of records removed. */
  revokeSession(sessionId: string): number {
    if (typeof sessionId !== 'string') return 0
    const session = this.sessions.get(sessionId)
    if (session === undefined) return 0
    let removed = 0
    for (const plan of session.plans.values()) removed += plan.items.size
    this.sessions.delete(sessionId)
    return removed
  }

  /**
   * Revoke every grant in every session and mark the store disposed.
   * Returns the number of records removed.
   */
  dispose(): number {
    if (this.disposed) return 0
    let removed = 0
    for (const session of this.sessions.values()) {
      for (const plan of session.plans.values()) removed += plan.items.size
    }
    this.sessions.clear()
    this.disposed = true
    return removed
  }

  private matchUnsafe(input: GrantMatchRequest): GrantMatchResult {
    const parsed = normalizeMatchRequest(input)
    if (!parsed.ok) return manualResult('invalid-request', parsed.detail)
    const request = parsed.request
    const observe = this.modeValue === 'observe' || request.observe

    const session = this.sessions.get(request.sessionId)
    if (session === undefined) return manualResult('no-grant')

    // Two buckets: reasons from grants that the actual call actually targets
    // (scope matched) outrank reasons from unrelated grants. This prevents a
    // sibling path's manual/exhausted grant from masking the targeted grant's
    // real state.
    let targetedReason: GrantMatchReason | undefined
    let targetedDetail: string | undefined
    let headerReason: GrantMatchReason | undefined
    let headerDetail: string | undefined
    const note = (
      bucket: 'targeted' | 'header',
      reason: GrantMatchReason,
      detail?: string,
    ): void => {
      const current =
        bucket === 'targeted'
          ? { reason: targetedReason, detail: targetedDetail }
          : { reason: headerReason, detail: headerDetail }
      if (current.reason === undefined) {
        if (bucket === 'targeted') {
          targetedReason = reason
          targetedDetail = detail
        } else {
          headerReason = reason
          headerDetail = detail
        }
        return
      }
      const next = REASON_PRIORITY.indexOf(reason)
      const previous = REASON_PRIORITY.indexOf(current.reason)
      if (next >= 0 && (previous < 0 || next < previous)) {
        if (bucket === 'targeted') {
          targetedReason = reason
          targetedDetail = detail
        } else {
          headerReason = reason
          headerDetail = detail
        }
      }
    }

    for (const plan of session.plans.values()) {
      for (const grant of plan.items.values()) {
        if (grant.turn !== request.turn) {
          note('header', 'turn-mismatch')
          continue
        }
        if (grant.tool !== request.tool) {
          note('header', 'tool-mismatch')
          continue
        }
        if (
          grant.kind !== undefined &&
          request.kind !== undefined &&
          grant.kind !== request.kind
        ) {
          note('header', 'kind-mismatch')
          continue
        }
        if (grant.mode !== undefined && request.mode !== grant.mode) {
          note('header', 'mode-mismatch')
          continue
        }

        const scope = matchGrantScope(grant.scope, {
          args: request.args,
          paths: request.paths,
          command: request.command,
          platform: request.platform,
          cwd: request.cwd,
          probe: request.probe,
        })
        if (!scope.matched) {
          note('header', 'scope-mismatch', scope.reason)
          continue
        }

        // The call targets this grant's scope; report its state before any
        // unrelated header mismatch.
        if (grant.state === 'manual') {
          note('targeted', 'grant-manual')
          continue
        }
        if (grant.state === 'blocked-by-manual') {
          note('targeted', 'grant-blocked-by-manual')
          continue
        }
        if (grant.state !== 'active' || grant.usesLeft <= 0) {
          note('targeted', 'grant-exhausted')
          continue
        }
        if (!this.dependenciesReady(grant)) {
          note('targeted', 'dependencies-not-ready')
          continue
        }

        const risk = assessRisk(
          {
            tool: request.tool,
            args: request.args,
            mode: request.mode,
            cwd: request.cwd,
            platform: request.platform,
            probe: request.probe,
          },
          this.policy,
        )
        const gate = evaluateRiskGate(risk, this.policy, request.confirmedHighRisk)
        const grantInfo = {
          planId: grant.planId,
          itemId: grant.itemId,
          usesLeft: grant.usesLeft,
        }

        if (gate.outcome === 'manual') {
          return {
            decision: 'manual',
            reason: gate.reason,
            grant: grantInfo,
            risk,
          }
        }
        if (gate.outcome === 'needs-confirmation') {
          return {
            decision: 'needs-confirmation',
            reason: gate.reason,
            grant: grantInfo,
            risk,
          }
        }

        if (!this.isGrantCurrent(grant)) return manualResult('grant-revoked')
        this.consume(grant)
        const after = {
          planId: grant.planId,
          itemId: grant.itemId,
          usesLeft: grant.usesLeft,
        }
        const decision: GrantDecision = observe ? 'would-allow' : 'allowed-once'
        const reason: GrantMatchReason = observe ? 'would-allow' : 'allowed'
        return { decision, reason, grant: after, risk }
      }
    }

    if (targetedReason !== undefined) {
      return manualResult(targetedReason, targetedDetail)
    }
    return manualResult(headerReason ?? 'no-grant', headerDetail)
  }

  private isGrantCurrent(grant: GrantRecord): boolean {
    const session = this.sessions.get(grant.sessionId)
    const plan = session?.plans.get(planKey(grant.turn, grant.planId))
    return plan?.items.get(grant.itemId) === grant
  }

  private dependenciesReady(grant: GrantRecord): boolean {
    if (grant.dependsOn.length === 0) return true
    const session = this.sessions.get(grant.sessionId)
    if (session === undefined) return false
    const plan = session.plans.get(planKey(grant.turn, grant.planId))
    if (plan === undefined) return false
    for (const dependency of grant.dependsOn) {
      const dep = plan.items.get(dependency)
      if (dep === undefined) return false
      // Only a fully consumed auto grant satisfies a dependency. Manual and
      // blocked records are never "used", so they never satisfy anything.
      if (dep.state !== 'exhausted' || dep.usesLeft !== 0) return false
    }
    return true
  }

  private consume(grant: GrantRecord): void {
    if (grant.state !== 'active' || grant.usesLeft <= 0) return
    grant.usesLeft -= 1
    if (grant.usesLeft <= 0) {
      grant.usesLeft = 0
      grant.state = 'exhausted'
    }
  }
}
