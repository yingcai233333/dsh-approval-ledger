import { isPlainObject } from '../core/json.js'
import type { RiskPolicy } from '../core/types.js'
import type { PathPlatform, PathProbe } from '../path/types.js'
import { assessRisk } from '../risk/assess.js'
import { createCallAuditRecord } from './from-call.js'
import type { AuditRecord, ApprovalOutcome } from './types.js'

export interface SessionEventLike {
  readonly type?: unknown
  readonly seq?: unknown
  readonly time?: unknown
  readonly data?: unknown
}

export interface SessionReplayFact {
  type: string
  callId?: string
  toolName?: string
  decision?: ApprovalOutcome
  seq?: number
  time?: number
  turn?: number
  meta?: unknown
  args?: unknown
}

export interface DerivedAuditOptions {
  sessionId: string
  cwd?: string
  platform?: PathPlatform
  probe?: PathProbe
  policy?: RiskPolicy
}

function readString(value: unknown, max = 256): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= max
    ? value
    : undefined
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined
}

function readOutcome(value: unknown): ApprovalOutcome | undefined {
  return value === 'allowed-once' ||
    value === 'rejected' ||
    value === 'cancelled' ||
    value === 'unavailable'
    ? value
    : undefined
}

function parseArguments(value: unknown): unknown {
  if (typeof value !== 'string' || value.length > 1_000_000) return undefined
  try {
    return JSON.parse(value) as unknown
  } catch {
    return undefined
  }
}

/**
 * Convert durable DSH session events into the flat facts consumed by
 * `replayAudit`. `approval/decided` has no callId, so it is joined through the
 * preceding `approval/asked.id`; `tool/result` joins through
 * `message.toolCallId`.
 */
export function eventsToReplayFacts(events: readonly SessionEventLike[]): SessionReplayFact[] {
  const facts: SessionReplayFact[] = []
  const askedCallIds = new Map<string, string>()

  for (const event of events) {
    if (!isPlainObject(event)) continue
    const type = readString(event.type, 64)
    if (type === undefined) continue
    const seq = readNumber(event.seq)
    const time = readNumber(event.time)
    const data = isPlainObject(event.data) ? event.data : undefined
    if (data === undefined) continue

    switch (type) {
      case 'turn/start':
      case 'turn/end': {
        const turn = readNumber(data.turn)
        if (turn !== undefined) facts.push({ type, turn, seq, time })
        break
      }
      case 'tool/call': {
        const callId = readString(data.callId)
        const toolName = readString(data.name)
        const turn = readNumber(data.turn)
        if (callId !== undefined) {
          facts.push({
            type,
            callId,
            toolName,
            turn,
            seq,
            time,
            args: parseArguments(data.arguments),
          })
        }
        break
      }
      case 'tool/result': {
        const message = isPlainObject(data.message) ? data.message : undefined
        const callId = readString(message?.toolCallId) ?? readString(data.callId)
        const turn = readNumber(data.turn)
        if (callId !== undefined) {
          facts.push({ type, callId, turn, seq, time, meta: data.meta })
        }
        break
      }
      case 'approval/asked': {
        const id = readString(data.id)
        const callId = readString(data.callId) ?? id
        const toolName = readString(data.toolName)
        if (callId !== undefined) {
          if (id !== undefined) askedCallIds.set(id, callId)
          facts.push({ type, callId, toolName, seq, time })
        }
        break
      }
      case 'approval/decided': {
        const id = readString(data.id)
        const outcome = readOutcome(data.outcome)
        const callId = id === undefined ? undefined : askedCallIds.get(id)
        if (callId !== undefined && outcome !== undefined) {
          facts.push({ type, callId, decision: outcome, seq, time })
        }
        break
      }
      default:
        break
    }
  }

  return facts
}

/**
 * Reconstruct per-call audit records from durable facts when the in-memory
 * ledger is empty (for example after a restart). These are marked
 * `derived-session-log` and use the current risk policy; a missing or invalid
 * tool-call argument string yields no record rather than a guessed one.
 */
export function deriveAuditRecords(
  facts: readonly SessionReplayFact[],
  options: DerivedAuditOptions,
): AuditRecord[] {
  const calls = new Map<
    string,
    { tool: string; args: unknown; turn?: number; time?: number }
  >()
  for (const fact of facts) {
    if (fact.type !== 'tool/call') continue
    if (fact.callId === undefined || fact.toolName === undefined) continue
    if (fact.args === undefined) continue
    calls.set(fact.callId, {
      tool: fact.toolName,
      args: fact.args,
      turn: fact.turn,
      time: fact.time,
    })
  }

  const records: AuditRecord[] = []
  for (const fact of facts) {
    if (fact.type !== 'approval/decided') continue
    if (fact.callId === undefined || fact.decision === undefined) continue
    const call = calls.get(fact.callId)
    if (call === undefined) continue
    try {
      const risk = assessRisk(
        {
          tool: call.tool,
          args: call.args,
          cwd: options.cwd,
          platform: options.platform,
          probe: options.probe,
        },
        options.policy,
      )
      records.push(
        createCallAuditRecord({
          sessionId: options.sessionId,
          callId: fact.callId,
          tool: call.tool,
          risk,
          outcome: fact.decision,
          args: call.args,
          cwd: options.cwd,
          platform: options.platform,
          probe: options.probe,
          matchedBy: 'derived-session-log',
          time: fact.time ?? call.time,
        }),
      )
    } catch {
      // A malformed historical call stays unattributed; never guess.
    }
  }
  return records
}
