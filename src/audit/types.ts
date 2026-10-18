import type { RiskLevel } from '../core/types.js'

export type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'

export type AuditTargetKind = 'path' | 'command' | 'args' | 'unknown'

export interface AuditTarget {
  kind: AuditTargetKind
  /** Canonical target value. Only its hash is stored. */
  value: string
  /** Optional pre-computed short summary; still scrubbed before storage. */
  summary?: string
}

export interface AuditRecord {
  schemaVersion: number
  sessionId: string
  seq?: number
  callId: string
  planId?: string
  itemId?: string
  tool: string
  risk: RiskLevel
  mode?: string
  targetHash?: string
  targetSummary?: string
  matchedBy?: string
  outcome: ApprovalOutcome
  matcherVersion?: number
  riskPolicyVersion?: number
  time: number
}

export interface CreateAuditRecordInput {
  sessionId: string
  seq?: number
  callId: string
  planId?: string
  itemId?: string
  tool: string
  risk: RiskLevel
  mode?: string
  target?: AuditTarget
  matchedBy?: string
  outcome: ApprovalOutcome
  matcherVersion?: number
  riskPolicyVersion?: number
  time?: number
}

export interface AuditIssue {
  code: string
  message: string
  seq?: number
  callId?: string
}

export const APPROVAL_OUTCOMES: readonly ApprovalOutcome[] = [
  'allowed-once',
  'rejected',
  'cancelled',
  'unavailable',
]

export const AUDIT_TARGET_KINDS: readonly AuditTargetKind[] = [
  'path',
  'command',
  'args',
  'unknown',
]
