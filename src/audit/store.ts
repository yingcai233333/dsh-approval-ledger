import { AuditLedger } from './ledger.js'
import type { CallAuditInput } from './from-call.js'
import type { AuditRecord, CreateAuditRecordInput } from './types.js'

export type AppendAuditInput = Omit<CreateAuditRecordInput, 'sessionId' | 'seq'> & {
  seq?: number
}

export type AppendCallAuditInput = Omit<CallAuditInput, 'sessionId'>

/**
 * Session-partitioned audit store.
 *
 * The Sprint 1 host adapter can implement this over `ctx.storageDomain`; this
 * in-memory version is the fallback and the test double. Records never cross a
 * session boundary, and there is no update/delete operation.
 */
export interface SessionAuditStore {
  append(sessionId: string, input: AppendAuditInput): AuditRecord
  appendCall(sessionId: string, input: AppendCallAuditInput): AuditRecord
  list(sessionId: string): readonly AuditRecord[]
  ledger(sessionId: string): AuditLedger | undefined
  clear(sessionId: string): void
  sessions(): string[]
}

export class MemoryAuditStore implements SessionAuditStore {
  private readonly ledgers = new Map<string, AuditLedger>()

  append(sessionId: string, input: AppendAuditInput): AuditRecord {
    let ledger = this.ledgers.get(sessionId)
    if (ledger === undefined) {
      ledger = new AuditLedger(sessionId)
      this.ledgers.set(sessionId, ledger)
    }
    return ledger.append(input)
  }

  appendCall(sessionId: string, input: AppendCallAuditInput): AuditRecord {
    let ledger = this.ledgers.get(sessionId)
    if (ledger === undefined) {
      ledger = new AuditLedger(sessionId)
      this.ledgers.set(sessionId, ledger)
    }
    return ledger.appendCall(input)
  }

  list(sessionId: string): readonly AuditRecord[] {
    return this.ledgers.get(sessionId)?.list() ?? []
  }

  ledger(sessionId: string): AuditLedger | undefined {
    return this.ledgers.get(sessionId)
  }

  clear(sessionId: string): void {
    this.ledgers.delete(sessionId)
  }

  sessions(): string[] {
    return [...this.ledgers.keys()]
  }
}
