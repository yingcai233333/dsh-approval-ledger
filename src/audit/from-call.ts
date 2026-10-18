import type { RiskAssessment } from '../core/types.js'
import { extractApprovalTarget } from '../approval/target.js'
import type { PathPlatform, PathProbe } from '../path/types.js'
import { createAuditRecord } from './record.js'
import type { AuditRecord, ApprovalOutcome } from './types.js'

export interface CallAuditInput {
  sessionId: string
  callId: string
  tool: string
  risk: RiskAssessment
  outcome: ApprovalOutcome
  mode?: string
  planId?: string
  itemId?: string
  matchedBy?: string
  args?: unknown
  cwd?: string
  platform?: PathPlatform
  probe?: PathProbe
  time?: number
}

/**
 * Build one ledger record from an actual tool call.
 *
 * Only a canonical target hash and a scrubbed summary are stored; file content
 * and full command arguments never reach the record.
 */
export function createCallAuditRecord(input: CallAuditInput): AuditRecord {
  const target = extractApprovalTarget({
    args: input.args,
    cwd: input.cwd,
    platform: input.platform,
    probe: input.probe,
  })

  return createAuditRecord({
    sessionId: input.sessionId,
    callId: input.callId,
    tool: input.tool,
    risk: input.risk.level,
    outcome: input.outcome,
    mode: input.mode,
    planId: input.planId,
    itemId: input.itemId,
    matchedBy: input.matchedBy,
    time: input.time,
    target:
      target.value === undefined
        ? undefined
        : { kind: target.kind, value: target.value, summary: target.summary },
  })
}
