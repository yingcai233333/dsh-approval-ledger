/**
 * Pure plan-scope matching and risk-gate helpers for the grant store.
 *
 * This module contains no I/O and no DSH imports. Every path fact comes from
 * the caller-supplied `PathProbe`; omitting it keeps matching exact/lexical.
 */

import { matchArgsScope } from '../args/validate.js'
import { matchCommandScope } from '../command/match.js'
import { isPlainObject } from '../core/json.js'
import type { RiskAssessment, RiskLevel, RiskPolicy } from '../core/types.js'
import { matchPathScope } from '../path/match.js'
import { normalizePath } from '../path/normalize.js'
import type { PathPlatform, PathProbe } from '../path/types.js'
import type { NormalizedPlanScope } from '../plan/types.js'
import type { GrantKind, GrantMatchReason } from './types.js'

const PATH_KEYS = [
  'file_path',
  'filePath',
  'path',
  'target',
  'destination',
  'source',
] as const

const COMMAND_KEYS = ['command', 'cmd', 'script', 'shell'] as const

const RISK_LEVELS: ReadonlySet<string> = new Set<RiskLevel>([
  'critical',
  'high',
  'medium',
  'low',
  'unknown',
])

/** Whether a normalized scope actually constrains anything. */
export function scopeHasTargets(scope: NormalizedPlanScope): boolean {
  if (scope.paths.length > 0) return true
  if (scope.commands.length > 0) return true
  return scope.args !== undefined && Object.keys(scope.args).length > 0
}

/**
 * Infer the target kind from the shape of a normalized scope.
 *
 * Only a single-kind scope gets a kind. Mixed scopes deliberately return
 * `undefined`, which disables the kind comparison instead of guessing.
 */
export function inferGrantKind(scope: NormalizedPlanScope): GrantKind | undefined {
  const hasPaths = scope.paths.length > 0
  const hasCommands = scope.commands.length > 0
  const hasArgs = scope.args !== undefined && Object.keys(scope.args).length > 0
  const count = Number(hasPaths) + Number(hasCommands) + Number(hasArgs)
  if (count !== 1) return undefined
  if (hasPaths) return 'path'
  if (hasCommands) return 'command'
  return 'args'
}

/**
 * Collect path-like values from raw tool arguments.
 *
 * Mirrors the risk engine's extraction so the plan gate and risk gate look at
 * the same targets. Values are de-duplicated; invalid entries are left for
 * `normalizePath` to reject.
 */
export function extractActualPaths(args: unknown): string[] {
  if (!isPlainObject(args)) return []
  const found: string[] = []
  for (const key of PATH_KEYS) {
    const value = args[key]
    if (typeof value === 'string' && value.length > 0) found.push(value)
  }
  for (const key of ['paths', 'files'] as const) {
    const value = args[key]
    if (!Array.isArray(value)) continue
    for (const item of value) {
      if (typeof item === 'string' && item.length > 0) {
        found.push(item)
      } else if (
        isPlainObject(item) &&
        typeof item.path === 'string' &&
        item.path.length > 0
      ) {
        found.push(item.path)
      }
    }
  }
  return [...new Set(found)]
}

/** Extract the actual command string, if the arguments contain one. */
export function extractActualCommand(args: unknown): string | undefined {
  if (!isPlainObject(args)) return undefined
  for (const key of COMMAND_KEYS) {
    const value = args[key]
    if (typeof value === 'string' && value.trim().length > 0) return value
  }
  const argv = args.argv
  if (Array.isArray(argv) && argv.length > 0 && argv.every((item) => typeof item === 'string')) {
    return argv.join(' ')
  }
  return undefined
}

/** The actual call facts the plan gate may use. */
export interface ActualCallScope {
  args?: unknown
  /** Explicit actual paths; when omitted they are extracted from `args`. */
  paths?: readonly string[]
  /** Explicit actual command; when omitted it is extracted from `args`. */
  command?: string
  platform: PathPlatform
  cwd?: string
  probe?: PathProbe
}

export type GrantScopeMismatch =
  | 'no-scope'
  | 'paths-missing'
  | 'invalid-path'
  | 'path-not-in-scope'
  | 'command-missing'
  | 'command-not-in-scope'
  | 'args-missing'
  | 'args-not-in-scope'

export interface GrantScopeMatch {
  matched: boolean
  reason?: GrantScopeMismatch
}

/**
 * Match the actual call against the normalized scope approved by the plan.
 *
 * Semantics:
 * - paths: every actual path must normalize successfully and land inside one
 *   approved path (exact file match, or directory containment only when the
 *   approved path was observed to be a directory);
 * - commands: whole-string exact after normalization, and unsafe actual
 *   commands never match;
 * - args: the approved args object must be a non-empty subset of the actual
 *   args; arrays are compared exactly.
 *
 * Every declared scope kind must match. A scope with no targets never matches.
 */
export function matchGrantScope(
  scope: NormalizedPlanScope,
  actual: ActualCallScope,
): GrantScopeMatch {
  if (!scopeHasTargets(scope)) return { matched: false, reason: 'no-scope' }

  if (scope.paths.length > 0) {
    const actualPaths =
      actual.paths !== undefined ? actual.paths : extractActualPaths(actual.args)
    if (actualPaths.length === 0) return { matched: false, reason: 'paths-missing' }
    for (const raw of actualPaths) {
      const normalized = normalizePath(raw, {
        platform: actual.platform,
        cwd: actual.cwd,
        probe: actual.probe,
      })
      if (!normalized.ok) return { matched: false, reason: 'invalid-path' }
      const result = matchPathScope(normalized.path, scope.paths)
      if (!result.matched) return { matched: false, reason: 'path-not-in-scope' }
    }
  }

  if (scope.commands.length > 0) {
    const command =
      actual.command !== undefined ? actual.command : extractActualCommand(actual.args)
    if (command === undefined) return { matched: false, reason: 'command-missing' }
    const allowed = scope.commands.map((entry) => entry.text)
    const result = matchCommandScope(command, allowed, actual.platform)
    if (!result.matched) return { matched: false, reason: 'command-not-in-scope' }
  }

  if (scope.args !== undefined && Object.keys(scope.args).length > 0) {
    if (actual.args === undefined) return { matched: false, reason: 'args-missing' }
    const result = matchArgsScope(actual.args, scope.args)
    if (!result.matched) return { matched: false, reason: 'args-not-in-scope' }
  }

  return { matched: true }
}

export type RiskGateOutcome = 'allow' | 'manual' | 'needs-confirmation'

export interface RiskGateResult {
  outcome: RiskGateOutcome
  reason: GrantMatchReason
}

function isRiskAssessment(value: unknown): value is RiskAssessment {
  if (!isPlainObject(value)) return false
  if (typeof value.level !== 'string' || !RISK_LEVELS.has(value.level)) return false
  if (typeof value.autoEligible !== 'boolean') return false
  if (!Array.isArray(value.reasons)) return false
  return true
}

/**
 * Apply the per-call risk policy to one re-assessed actual call.
 *
 * - `critical` and `unknown` are never automatic;
 * - `high` requires `allowHighRiskGrants` *and* an explicit
 *   `confirmedHighRisk === true`, regardless of
 *   `requireSecondConfirmForHigh` (stricter is safer);
 * - `medium`/`low` must be listed in `policy.autoLevels` and the assessment
 *   must itself be auto-eligible.
 *
 * Any malformed assessment is treated as an assessment error (manual).
 */
export function evaluateRiskGate(
  risk: unknown,
  policy: RiskPolicy,
  confirmedHighRisk: boolean,
): RiskGateResult {
  try {
    if (!isRiskAssessment(risk)) {
      return { outcome: 'manual', reason: 'assessment-error' }
    }

    const autoLevels = Array.isArray(policy.autoLevels) ? policy.autoLevels : []
    const allowHigh = policy.allowHighRiskGrants === true

    switch (risk.level) {
      case 'critical':
        return { outcome: 'manual', reason: 'risk-critical' }
      case 'unknown':
        return { outcome: 'manual', reason: 'risk-unknown' }
      case 'high':
        if (!allowHigh) return { outcome: 'manual', reason: 'risk-high-disabled' }
        if (confirmedHighRisk !== true) {
          return { outcome: 'needs-confirmation', reason: 'risk-needs-confirmation' }
        }
        return { outcome: 'allow', reason: 'allowed' }
      case 'medium':
      case 'low':
        if (risk.autoEligible !== true || !autoLevels.includes(risk.level)) {
          return { outcome: 'manual', reason: 'risk-not-auto' }
        }
        return { outcome: 'allow', reason: 'allowed' }
      default:
        return { outcome: 'manual', reason: 'assessment-error' }
    }
  } catch {
    return { outcome: 'manual', reason: 'assessment-error' }
  }
}
