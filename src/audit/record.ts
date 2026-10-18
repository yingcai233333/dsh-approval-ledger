import { sha256Tag } from '../core/hash.js'
import { stableStringify } from '../core/json.js'
import { scrubSecrets } from '../core/redact.js'
import { RISK_RANK } from '../core/types.js'
import type { RiskLevel } from '../core/types.js'
import { MATCHER_VERSION, RISK_POLICY_VERSION, SCHEMA_VERSION } from '../core/version.js'
import { APPROVAL_OUTCOMES, AUDIT_TARGET_KINDS } from './types.js'
import type {
  AuditRecord,
  AuditTarget,
  AuditTargetKind,
  ApprovalOutcome,
  CreateAuditRecordInput,
} from './types.js'

const MAX_TARGET_VALUE = 32768
const MAX_SUMMARY = 160

export class AuditRecordError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

function assertString(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) {
    throw new AuditRecordError(`invalid-${field}`, `${field} is invalid`)
  }
  // oxlint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    throw new AuditRecordError(`invalid-${field}`, `${field} contains a control character`)
  }
  return value
}

function assertRawString(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) {
    throw new AuditRecordError(`invalid-${field}`, `${field} is invalid`)
  }
  return value
}

function assertInteger(value: unknown, field: string, minimum: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum) {
    throw new AuditRecordError(`invalid-${field}`, `${field} is invalid`)
  }
  return value
}

export function canonicalTargetValue(target: AuditTarget): string {
  return stableStringify({ kind: target.kind, value: target.value })
}

export function summarizeTarget(kind: AuditTargetKind, value: string): string {
  if (kind === 'path') {
    const scrubbed = scrubSecrets(value)
    const separator = /^[A-Za-z]:\\/.test(scrubbed) || scrubbed.includes('\\') ? '\\' : '/'
    const parts = scrubbed.split(/[\\/]/).filter((part) => part.length > 0)
    const tail = parts.slice(-2).join(separator)
    const summary = parts.length > 2 ? `…${separator}${tail}` : tail
    return summary.slice(0, MAX_SUMMARY)
  }
  if (kind === 'command') {
    const scrubbed = scrubSecrets(value).trim()
    const first = scrubbed.split(/\s+/, 1)[0] ?? ''
    const summary = scrubbed.includes(' ') ? `${first} …` : first
    return summary.slice(0, MAX_SUMMARY)
  }
  if (kind === 'args') {
    let count = 0
    try {
      const parsed: unknown = JSON.parse(value)
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        count = Object.keys(parsed).length
      }
    } catch {
      count = 0
    }
    return `args{${count}}`
  }
  return '(unparsed)'
}

export interface CreateAuditRecordOptions {
  now?: () => number
}

/**
 * Create a ledger record.
 *
 * The target value is hashed, never stored. The summary is scrubbed and
 * truncated. Callers still must not pass full parameters or reasons.
 */
export function createAuditRecord(
  input: CreateAuditRecordInput,
  options: CreateAuditRecordOptions = {},
): AuditRecord {
  const sessionId = assertString(input.sessionId, 'sessionId', 256)
  const callId = assertString(input.callId, 'callId', 256)
  const tool = assertString(input.tool, 'tool', 128)
  if (!Object.prototype.hasOwnProperty.call(RISK_RANK, input.risk)) {
    throw new AuditRecordError('invalid-risk', 'risk is invalid')
  }
  const risk = input.risk as RiskLevel
  if (!APPROVAL_OUTCOMES.includes(input.outcome as ApprovalOutcome)) {
    throw new AuditRecordError('invalid-outcome', 'outcome is invalid')
  }
  const outcome = input.outcome as ApprovalOutcome

  const time =
    input.time !== undefined
      ? assertInteger(input.time, 'time', 0)
      : assertInteger((options.now ?? Date.now)(), 'time', 0)

  let targetHash: string | undefined
  let targetSummary: string | undefined
  if (input.target !== undefined) {
    if (typeof input.target !== 'object' || input.target === null) {
      throw new AuditRecordError('invalid-target', 'target is invalid')
    }
    if (!AUDIT_TARGET_KINDS.includes(input.target.kind)) {
      throw new AuditRecordError('invalid-target-kind', 'target kind is invalid')
    }
    const value = assertRawString(input.target.value, 'target-value', MAX_TARGET_VALUE)
    targetHash = sha256Tag(canonicalTargetValue({ kind: input.target.kind, value }))
    const summary = input.target.summary ?? summarizeTarget(input.target.kind, value)
    // oxlint-disable-next-line no-control-regex
    const scrubbed = scrubSecrets(summary).replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
    targetSummary = (scrubbed.length > 0 ? scrubbed : '(redacted)').slice(0, MAX_SUMMARY)
  }

  const record: AuditRecord = {
    schemaVersion: SCHEMA_VERSION,
    sessionId,
    callId,
    tool,
    risk,
    outcome,
    time,
    matcherVersion: input.matcherVersion ?? MATCHER_VERSION,
    riskPolicyVersion: input.riskPolicyVersion ?? RISK_POLICY_VERSION,
  }

  if (input.seq !== undefined) record.seq = assertInteger(input.seq, 'seq', 0)
  if (input.planId !== undefined) record.planId = assertString(input.planId, 'planId', 128)
  if (input.itemId !== undefined) record.itemId = assertString(input.itemId, 'itemId', 128)
  if (input.mode !== undefined) record.mode = assertString(input.mode, 'mode', 64)
  if (input.matchedBy !== undefined) {
    record.matchedBy = assertString(input.matchedBy, 'matchedBy', 160)
  }
  if (targetHash !== undefined) record.targetHash = targetHash
  if (targetSummary !== undefined) record.targetSummary = targetSummary

  return record
}
