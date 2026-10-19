/**
 * Public types for the Sprint 1 in-memory grant store and two-gate matcher.
 *
 * The grant store is deliberately pure: it has no DSH imports, no persistence,
 * and no filesystem access. Path facts come only from the optional `PathProbe`
 * supplied by the caller (tests use a fake probe; production passes the Node
 * probe from `src/path/node-probe.ts`).
 *
 * Grants are scoped to one `(sessionId, turn)` pair. They are never inherited by
 * child sessions and cannot be looked up across sessions.
 */

import type { RiskAssessment, RiskPolicy } from '../core/types.js'
import type { NormalizedPlanScope } from '../plan/types.js'
import type { PathPlatform, PathProbe } from '../path/types.js'

/** Enforcement mode of a store. */
export type GrantStoreMode = 'active' | 'observe'

/**
 * Target kind inferred from an item's normalized scope.
 *
 * A pure path scope becomes `'path'`, a pure command scope `'command'`, and a
 * pure args scope `'args'`. Mixed or empty scopes have no kind.
 */
export type GrantKind = 'path' | 'command' | 'args'

/**
 * Lifecycle state of a grant record.
 *
 * Only `active` records are auto grants. `manual` and `blocked-by-manual`
 * records exist so dependency gating and auditing can be explained; they never
 * authorize anything. `exhausted` records have no uses left but still count as
 * fully consumed dependencies.
 */
export type GrantState = 'active' | 'exhausted' | 'manual' | 'blocked-by-manual'

export interface GrantStoreOptions {
  /**
   * `'active'` enforces grants; `'observe'` reports `would-allow` instead of
   * `allowed-once`. Defaults to `'active'`.
   */
  mode?: GrantStoreMode
  /**
   * Convenience alias for `mode: 'observe'`.
   *
   * `true` always forces observe mode. `false` never disables a store that was
   * constructed with `mode: 'observe'`; observe is a safe-state latch.
   */
  observe?: boolean
  /**
   * Risk policy used by the per-call risk gate at match time.
   *
   * Defaults to `DEFAULT_RISK_POLICY` (low/medium auto, high manual, critical
   * and unknown never automatic).
   */
  policy?: RiskPolicy
}

/** Identity of one approved plan within a session and turn. */
export interface CreateGrantsContext {
  /** Opaque session id. Grants never cross this boundary. */
  sessionId: string
  /** Monotonic turn number from the host. Grants never cross this boundary. */
  turn: number
  /**
   * Opaque plan id (normally `createPlanId()`). When omitted it is derived
   * from `plan.planHash` as `P-<first 8 hex chars>`.
   */
  planId?: string
}

/**
 * Immutable view of one grant record.
 *
 * `scope` is copied from the validated plan; it is never re-read from a file.
 */
export interface GrantSnapshot {
  planId: string
  sessionId: string
  turn: number
  itemId: string
  tool: string
  /** Inferred from the scope; absent for mixed/empty scopes. */
  kind?: GrantKind
  /** Approval mode the plan item declared, if any. */
  mode?: string
  /** Normalized paths/commands/args approved by the plan. */
  scope: NormalizedPlanScope
  /** Remaining uses. Only meaningful for `active`/`exhausted` records. */
  usesLeft: number
  /** Item ids that must be fully consumed before this record is ready. */
  dependsOn: readonly string[]
  /** Dependency stage from `ValidatedPlan` (0 is the first stage). */
  stage: number
  state: GrantState
}

/** Read-only aggregate for the cross-session overview. Never contains scope or arguments. */
export interface SessionGrantSummary {
  sessionId: string
  plans: number
  grants: number
  active: number
  exhausted: number
  manual: number
  blocked: number
}

/**
 * Result of registering a validated plan.
 *
 * `items` contains a record for every plan item, including manual and blocked
 * bookkeeping records. `auto`, `blocked`, and `manual` classify item ids.
 */
export interface GrantSet {
  planId: string
  sessionId: string
  turn: number
  /** Every item record, including manual/blocked bookkeeping records. */
  items: readonly GrantSnapshot[]
  /**
   * Auto grants only (states `active`/`exhausted`). Manual and
   * `blocked-by-manual` bookkeeping records are never listed here.
   */
  grants: readonly GrantSnapshot[]
  /** Item ids that received an active auto grant. */
  auto: readonly string[]
  /** Auto-eligible items that depend on a manual/blocked item. */
  blocked: readonly string[]
  /** Items that are manual-only (critical, unknown, no scope, policy). */
  manual: readonly string[]
}

/** Outcome of one match attempt. */
export type GrantDecision =
  /** The call may proceed once. A use was consumed. */
  | 'allowed-once'
  /** Observe mode: the call would have been allowed once, but was not. */
  | 'would-allow'
  /** No automatic grant applies; fall back to the official approval card. */
  | 'manual'
  /** High-risk grant is allowed by policy but needs an explicit re-confirm. */
  | 'needs-confirmation'

/**
 * Stable decision reason codes. Human-facing UI should translate these rather
 * than parse the optional `detail` field.
 */
export type GrantMatchReason =
  | 'allowed'
  | 'would-allow'
  | 'invalid-request'
  | 'store-disposed'
  | 'reentrant'
  | 'no-grant'
  | 'turn-mismatch'
  | 'tool-mismatch'
  | 'kind-mismatch'
  | 'mode-mismatch'
  | 'grant-manual'
  | 'grant-blocked-by-manual'
  | 'grant-exhausted'
  | 'grant-revoked'
  | 'dependencies-not-ready'
  | 'scope-mismatch'
  | 'risk-critical'
  | 'risk-unknown'
  | 'risk-high-disabled'
  | 'risk-needs-confirmation'
  | 'risk-not-auto'
  | 'assessment-error'
  | 'internal-error'

/**
 * One actual approval request to test against the store.
 *
 * `args` is the authoritative raw argument object: it drives both scope
 * extraction and the per-call risk re-assessment. `paths` and `command` are
 * optional explicit overrides for the scope gate; they never replace `args` for
 * risk assessment.
 */
export interface GrantMatchRequest {
  sessionId: string
  turn: number
  /** Tool name; matched case-insensitively after trimming. */
  tool: string
  /** Actual target kind (`path`/`command`/`args`) when the host knows it. */
  kind?: string
  /** Actual approval/escalation mode. */
  mode?: string
  /** Raw tool arguments. */
  args?: unknown
  /** Explicit actual paths; when omitted, extracted from `args`. */
  paths?: readonly string[]
  /** Explicit actual command; when omitted, extracted from `args`. */
  command?: string
  /** Absolute session workspace path. */
  cwd?: string
  /** Path platform override. Defaults to the host platform. */
  platform?: PathPlatform
  /** Optional filesystem facts. Omitting it keeps matching lexical/exact. */
  probe?: PathProbe
  /**
   * Explicit second confirmation for a high-risk grant.
   *
   * High risk can only be auto-approved when the policy opts in *and* this is
   * exactly `true`. Any other value is treated as not confirmed.
   */
  confirmedHighRisk?: boolean
  /**
   * Per-call observe override. `true` forces observe for this call; `false`
   * cannot disable a store that is already in observe mode.
   */
  observe?: boolean
}

/** Minimal grant identity returned with a decision. */
export interface GrantMatchGrantInfo {
  planId: string
  itemId: string
  /**
   * Uses remaining. For `allowed-once`/`would-allow` this is the value after
   * this match consumed one use; for `manual`/`needs-confirmation` it is the
   * unchanged current value.
   */
  usesLeft: number
}

/**
 * Structured match result.
 *
 * `grant` is present whenever a grant record passed the plan header; it is
 * returned even for `manual` and `needs-confirmation` risk-gate outcomes so
 * the UI/audit layer can explain which plan item was considered.
 */
export interface GrantMatchResult {
  decision: GrantDecision
  reason: GrantMatchReason
  /** Optional non-secret diagnostic (for example a scope mismatch code). */
  detail?: string
  grant?: GrantMatchGrantInfo
  risk?: RiskAssessment
}
