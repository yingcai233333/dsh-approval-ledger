/** Shared, dependency-free types for the Sprint 0 core. */

export type RiskLevel = 'critical' | 'high' | 'medium' | 'low' | 'unknown'

export type ApprovalMode = 'read-only' | 'workspace-write' | 'danger-full-access'

export const APPROVAL_MODES: readonly ApprovalMode[] = [
  'read-only',
  'workspace-write',
  'danger-full-access',
]

/** Higher number wins when several rules apply to one target. */
export const RISK_RANK: Readonly<Record<RiskLevel, number>> = {
  critical: 5,
  high: 4,
  unknown: 3,
  medium: 2,
  low: 1,
}

export function maxRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  return RISK_RANK[a] >= RISK_RANK[b] ? a : b
}

export interface RiskReason {
  /** Stable, non-secret rule identifier (e.g. `system-path`). */
  code: string
  level: RiskLevel
  /** Short human-readable explanation. Never contains the raw target. */
  message: string
}

export interface RiskAssessment {
  level: RiskLevel
  reasons: RiskReason[]
  /** Whether the *risk gate* alone would allow automatic approval. */
  autoEligible: boolean
  /** High-risk grants need an explicit second confirmation. */
  requiresSecondConfirm: boolean
  policyVersion: number
}

export interface RiskPolicy {
  version: number
  /** Levels that may be auto-approved by the risk gate. */
  autoLevels: readonly RiskLevel[]
  /** Opt-in for high-risk grants (Sprint 3, off by default). */
  allowHighRiskGrants: boolean
  /** When high-risk grants are on, require an explicit second confirmation. */
  requireSecondConfirmForHigh: boolean
}

export const DEFAULT_RISK_POLICY: RiskPolicy = {
  version: 1,
  autoLevels: ['low', 'medium'],
  allowHighRiskGrants: false,
  requireSecondConfirmForHigh: true,
}

export const HIGH_RISK_GRANTS_POLICY: RiskPolicy = {
  version: 1,
  autoLevels: ['low', 'medium'],
  allowHighRiskGrants: true,
  requireSecondConfirmForHigh: true,
}

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }
export type JsonObject = { [key: string]: JsonValue }
