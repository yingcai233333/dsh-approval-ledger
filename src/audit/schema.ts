import { scrubSecrets } from '../core/redact.js'
import { RISK_RANK } from '../core/types.js'
import type { RiskLevel } from '../core/types.js'
import { APPROVAL_OUTCOMES } from './types.js'
import type { AuditIssue, AuditRecord, ApprovalOutcome } from './types.js'

const ALLOWED_KEYS = new Set<keyof AuditRecord>([
  'schemaVersion',
  'sessionId',
  'seq',
  'callId',
  'planId',
  'itemId',
  'tool',
  'risk',
  'mode',
  'targetHash',
  'targetSummary',
  'matchedBy',
  'outcome',
  'matcherVersion',
  'riskPolicyVersion',
  'time',
])

// oxlint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/
const RISK_LEVELS = new Set<RiskLevel>(['critical', 'high', 'medium', 'low', 'unknown'])

export type AuditValidation =
  | { ok: true; record: AuditRecord }
  | { ok: false; issues: AuditIssue[] }

function issue(code: string, message: string): AuditIssue {
  return { code, message }
}

function readString(
  value: unknown,
  field: string,
  max: number,
  required: boolean,
  issues: AuditIssue[],
): string | undefined {
  if (value === undefined) {
    if (required) issues.push(issue(`missing-${field}`, `${field} is required`))
    return undefined
  }
  if (typeof value !== 'string') {
    issues.push(issue(`invalid-${field}`, `${field} must be a string`))
    return undefined
  }
  if (value.length === 0 || value.length > max || CONTROL.test(value)) {
    issues.push(issue(`invalid-${field}`, `${field} is empty, too long, or contains a control character`))
    return undefined
  }
  return value
}

function readInteger(
  value: unknown,
  field: string,
  minimum: number,
  required: boolean,
  issues: AuditIssue[],
): number | undefined {
  if (value === undefined) {
    if (required) issues.push(issue(`missing-${field}`, `${field} is required`))
    return undefined
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum) {
    issues.push(issue(`invalid-${field}`, `${field} must be an integer >= ${minimum}`))
    return undefined
  }
  return value
}

/**
 * Validate an untrusted ledger record against the published v1 contract.
 *
 * Extra properties are rejected so a future writer cannot silently smuggle
 * parameters or reasons into the ledger.
 */
export function validateAuditRecord(input: unknown): AuditValidation {
  const issues: AuditIssue[] = []
  try {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      return { ok: false, issues: [issue('not-an-object', 'audit record must be an object')] }
    }
    const raw = input as Record<string, unknown>
    for (const key of Object.keys(raw)) {
      if (!ALLOWED_KEYS.has(key as keyof AuditRecord)) {
        issues.push(issue('unknown-field', `unexpected audit field: ${key}`))
      }
    }

    const schemaVersion = readInteger(raw.schemaVersion, 'schemaVersion', 1, true, issues)
    if (schemaVersion !== undefined && schemaVersion !== 1) {
      issues.push(issue('unsupported-version', `unsupported schemaVersion ${schemaVersion}`))
    }
    const sessionId = readString(raw.sessionId, 'sessionId', 256, true, issues)
    const seq = readInteger(raw.seq, 'seq', 0, false, issues)
    const callId = readString(raw.callId, 'callId', 256, true, issues)
    const planId = readString(raw.planId, 'planId', 128, false, issues)
    const itemId = readString(raw.itemId, 'itemId', 128, false, issues)
    const tool = readString(raw.tool, 'tool', 128, true, issues)
    const mode = readString(raw.mode, 'mode', 64, false, issues)
    const targetHash = readString(raw.targetHash, 'targetHash', 128, false, issues)
    const targetSummary = readString(raw.targetSummary, 'targetSummary', 200, false, issues)
    const matchedBy = readString(raw.matchedBy, 'matchedBy', 160, false, issues)
    const matcherVersion = readInteger(raw.matcherVersion, 'matcherVersion', 1, false, issues)
    const riskPolicyVersion = readInteger(
      raw.riskPolicyVersion,
      'riskPolicyVersion',
      1,
      false,
      issues,
    )
    const time = readInteger(raw.time, 'time', 0, true, issues)

    let risk: RiskLevel | undefined
    if (typeof raw.risk !== 'string' || !RISK_LEVELS.has(raw.risk as RiskLevel)) {
      issues.push(issue('invalid-risk', 'risk must be a known risk level'))
    } else {
      risk = raw.risk as RiskLevel
      if (RISK_RANK[risk] === undefined) {
        issues.push(issue('invalid-risk', 'risk must be a known risk level'))
      }
    }

    let outcome: ApprovalOutcome | undefined
    if (
      typeof raw.outcome !== 'string' ||
      !APPROVAL_OUTCOMES.includes(raw.outcome as ApprovalOutcome)
    ) {
      issues.push(issue('invalid-outcome', 'outcome must be a known approval outcome'))
    } else {
      outcome = raw.outcome as ApprovalOutcome
    }

    if (targetHash !== undefined && !/^sha256:[a-f0-9]{64}$/.test(targetHash)) {
      issues.push(issue('invalid-targetHash', 'targetHash must be a sha256 tag'))
    }
    if (targetSummary !== undefined && targetSummary !== scrubSecrets(targetSummary)) {
      issues.push(issue('secret-in-summary', 'targetSummary contains a recognisable secret'))
    }

    if (issues.length > 0) return { ok: false, issues }
    if (
      schemaVersion === undefined ||
      sessionId === undefined ||
      callId === undefined ||
      tool === undefined ||
      risk === undefined ||
      outcome === undefined ||
      time === undefined
    ) {
      return { ok: false, issues: [issue('incomplete', 'audit record is incomplete')] }
    }

    const record: AuditRecord = {
      schemaVersion,
      sessionId,
      callId,
      tool,
      risk,
      outcome,
      time,
    }
    if (seq !== undefined) record.seq = seq
    if (planId !== undefined) record.planId = planId
    if (itemId !== undefined) record.itemId = itemId
    if (mode !== undefined) record.mode = mode
    if (targetHash !== undefined) record.targetHash = targetHash
    if (targetSummary !== undefined) record.targetSummary = targetSummary
    if (matchedBy !== undefined) record.matchedBy = matchedBy
    if (matcherVersion !== undefined) record.matcherVersion = matcherVersion
    if (riskPolicyVersion !== undefined) record.riskPolicyVersion = riskPolicyVersion
    return { ok: true, record }
  } catch {
    return { ok: false, issues: [issue('validation-error', 'audit record could not be validated')] }
  }
}
