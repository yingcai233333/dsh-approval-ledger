import { createAuditRecord } from './record.js'
import { createCallAuditRecord } from './from-call.js'
import type { CallAuditInput } from './from-call.js'
import { validateAuditRecord } from './schema.js'
import type { AuditIssue, AuditRecord, CreateAuditRecordInput } from './types.js'

// oxlint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/

export interface AuditLedgerFromJsonlOptions {
  sessionId?: string
}

export interface AuditLedgerFromJsonlResult {
  ledger: AuditLedger
  issues: AuditIssue[]
}

/**
 * Append-only, in-memory ledger. There is deliberately no update or delete
 * method; persistence and retention belong to the host storage layer.
 */
export class AuditLedger {
  readonly sessionId: string
  private readonly records: AuditRecord[] = []
  private readonly startSeq: number
  private nextSeq: number

  constructor(sessionId: string, startSeq = 0) {
    if (
      typeof sessionId !== 'string' ||
      sessionId.length === 0 ||
      sessionId.length > 256 ||
      CONTROL.test(sessionId)
    ) {
      throw new Error('invalid session id')
    }
    if (!Number.isInteger(startSeq) || startSeq < 0) {
      throw new Error('invalid start sequence')
    }
    this.sessionId = sessionId
    this.startSeq = startSeq
    this.nextSeq = startSeq
  }

  get size(): number {
    return this.records.length
  }

  append(
    input: Omit<CreateAuditRecordInput, 'sessionId' | 'seq'> & { seq?: number },
  ): AuditRecord {
    if (input.seq !== undefined && input.seq !== this.nextSeq) {
      throw new Error('appended record sequence does not match the ledger')
    }
    if (this.records.some((record) => record.callId === input.callId)) {
      throw new Error('an audit record for this callId already exists')
    }
    const record = createAuditRecord({
      ...input,
      sessionId: this.sessionId,
      seq: this.nextSeq,
    })
    return this.push(record)
  }

  /** Append a record built from an actual tool call (hash + summary only). */
  appendCall(input: Omit<CallAuditInput, 'sessionId'>): AuditRecord {
    if (this.records.some((record) => record.callId === input.callId)) {
      throw new Error('an audit record for this callId already exists')
    }
    const record = createCallAuditRecord({
      ...input,
      sessionId: this.sessionId,
    })
    record.seq = this.nextSeq
    return this.push(record)
  }

  private push(record: AuditRecord): AuditRecord {
    const frozen = Object.freeze(record)
    this.records.push(frozen)
    this.nextSeq += 1
    return frozen
  }

  list(): readonly AuditRecord[] {
    return this.records.slice()
  }

  find(callId: string): AuditRecord | undefined {
    return this.records.find((record) => record.callId === callId)
  }

  toJSONL(): string {
    return this.records.map((record) => JSON.stringify(record)).join('\n')
  }

  verify(): AuditIssue[] {
    const issues: AuditIssue[] = []
    const seenCalls = new Set<string>()
    let lastTime = -1

    this.records.forEach((record, index) => {
      const validation = validateAuditRecord(record)
      if (!validation.ok) issues.push(...validation.issues)

      const expectedSeq = this.startSeq + index
      if (record.seq !== expectedSeq) {
        issues.push({
          code: 'seq-gap',
          message: `record ${index} has seq ${record.seq ?? 'missing'}, expected ${expectedSeq}`,
          seq: record.seq,
          callId: record.callId,
        })
      }

      if (record.sessionId !== this.sessionId) {
        issues.push({
          code: 'session-mismatch',
          message: 'record belongs to a different session',
          seq: record.seq,
          callId: record.callId,
        })
      }
      if (seenCalls.has(record.callId)) {
        issues.push({
          code: 'duplicate-call',
          message: 'duplicate callId in ledger',
          seq: record.seq,
          callId: record.callId,
        })
      }
      seenCalls.add(record.callId)

      if (record.time < lastTime) {
        issues.push({
          code: 'time-regression',
          message: 'record time goes backwards',
          seq: record.seq,
          callId: record.callId,
        })
      }
      lastTime = Math.max(lastTime, record.time)
    })

    return issues
  }

  static fromJSONL(
    text: string,
    options: AuditLedgerFromJsonlOptions = {},
  ): AuditLedgerFromJsonlResult {
    const issues: AuditIssue[] = []
    const valid: AuditRecord[] = []

    const lines = text.split(/\r?\n/)
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]
      if (line === undefined || line.trim().length === 0) continue
      let parsed: unknown
      try {
        parsed = JSON.parse(line)
      } catch {
        issues.push({ code: 'invalid-json', message: `line ${index + 1} is not valid JSON` })
        continue
      }
      const validation = validateAuditRecord(parsed)
      if (!validation.ok) {
        for (const issue of validation.issues) {
          issues.push({ ...issue, message: `line ${index + 1}: ${issue.message}` })
        }
        continue
      }
      if (options.sessionId !== undefined && validation.record.sessionId !== options.sessionId) {
        issues.push({
          code: 'session-mismatch',
          message: `line ${index + 1} belongs to a different session`,
          callId: validation.record.callId,
        })
        continue
      }
      valid.push(validation.record)
    }

    const sessionId = options.sessionId ?? valid[0]?.sessionId ?? 'unknown'
    const startSeq = valid[0]?.seq ?? 0
    const ledger = new AuditLedger(sessionId, startSeq)
    for (const record of valid) {
      ledger.records.push(Object.freeze(record))
    }
    ledger.nextSeq = (valid[valid.length - 1]?.seq ?? startSeq - 1) + 1
    issues.push(...ledger.verify())
    return { ledger, issues }
  }
}
