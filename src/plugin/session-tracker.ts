import { isPlainObject } from '../core/json.js'
import { readSessionEvents } from './session-log.js'
import type { SessionEventLike } from './session-log.js'
import type { Session, SessionEvent } from '../types/dsh-runtime.js'

export interface ToolCallInfo {
  callId: string
  tool: string
  args?: unknown
  turn?: number
  time?: number
}

function readTurn(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined
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
 * Last known turn boundary in a historical log, or `undefined` when the log has
 * none. Never substitutes 0: an invented turn 0 would create a grant that the
 * real `turn/end` can never revoke, leaking it across turns.
 */
function lastTurn(events: readonly SessionEventLike[]): number | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event === undefined) continue
    if (event.type !== 'turn/start' && event.type !== 'turn/end') continue
    const data = isPlainObject(event.data) ? event.data : undefined
    const value = readTurn(data?.turn)
    if (value !== undefined) return value
  }
  return undefined
}

/**
 * Per-session cache of the current turn and tool-call arguments.
 *
 * DSH has no turn accessor on `Session`/`Agent`, so this folds `session/event`
 * and lazily scans a session's history through the single adapter
 * `src/plugin/session-log.ts` (the only place allowed to touch the deprecated
 * synchronous history reader). No filesystem, no persistence; session disposal
 * clears everything, and tool-call arguments stay in memory only.
 *
 * A failed history read is never treated as "no events": the session is marked
 * degraded (a sticky in-memory reason code) and turn lookups return `undefined`
 * so callers fail closed instead of binding grants to an invented turn.
 */
export class SessionTracker {
  private readonly turns = new Map<string, number>()
  private readonly calls = new Map<string, Map<string, ToolCallInfo>>()
  private readonly degraded = new Map<string, string>()

  observe(session: Session, event: SessionEvent): void {
    if (!isPlainObject(event) || typeof event.type !== 'string') return
    const data = isPlainObject(event.data) ? event.data : undefined
    if (data === undefined) return
    if (event.type === 'turn/start' || event.type === 'turn/end') {
      const turn = readTurn(data.turn)
      if (turn !== undefined) this.turns.set(session.id, turn)
      return
    }
    if (event.type !== 'tool/call') return
    const callId = typeof data.callId === 'string' ? data.callId : undefined
    const tool = typeof data.name === 'string' ? data.name : undefined
    if (callId === undefined || tool === undefined) return
    this.rememberCall(session.id, {
      callId,
      tool,
      args: parseArguments(data.arguments),
      turn: readTurn(data.turn),
      time: typeof event.time === 'number' ? event.time : undefined,
    })
  }

  forget(sessionId: string): void {
    this.turns.delete(sessionId)
    this.calls.delete(sessionId)
    this.degraded.delete(sessionId)
  }

  /**
   * Mark a session whose historical log could not be read.
   *
   * The first reason wins and stays until the session is forgotten: a later
   * successful read does not prove the earlier gap was empty history, so audits
   * must keep reporting that part of the history was unreadable.
   */
  markDegraded(sessionId: string, reason: string): void {
    if (typeof sessionId !== 'string' || sessionId.length === 0) return
    if (typeof reason !== 'string' || reason.length === 0) return
    if (!this.degraded.has(sessionId)) this.degraded.set(sessionId, reason)
  }

  isDegraded(sessionId: string): boolean {
    return this.degraded.has(sessionId)
  }

  degradedReason(sessionId: string): string | undefined {
    return this.degraded.get(sessionId)
  }

  /**
   * Current turn, or `undefined` when it cannot be determined.
   *
   * `undefined` covers both "the history could not be read" and "the readable
   * history has no turn boundary"; callers must fail closed (no grant, no
   * automatic allow, official approval card) rather than assume turn 0.
   */
  currentTurn(session: Session): number | undefined {
    const cached = this.turns.get(session.id)
    if (cached !== undefined) return cached
    const read = readSessionEvents(session)
    if (!read.ok) {
      this.markDegraded(session.id, read.reason)
      return undefined
    }
    const turn = lastTurn(read.events)
    if (turn === undefined) return undefined
    this.turns.set(session.id, turn)
    return turn
  }

  toolCall(session: Session, callId: string | undefined): ToolCallInfo | undefined {
    if (callId === undefined) return undefined
    const cached = this.calls.get(session.id)?.get(callId)
    if (cached !== undefined) return cached
    const read = readSessionEvents(session)
    if (!read.ok) {
      this.markDegraded(session.id, read.reason)
      return undefined
    }
    const events = read.events
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index]
      if (event === undefined || event.type !== 'tool/call') continue
      const data = isPlainObject(event.data) ? event.data : undefined
      if (data === undefined || data.callId !== callId) continue
      if (typeof data.name !== 'string') continue
      const info: ToolCallInfo = {
        callId,
        tool: data.name,
        args: parseArguments(data.arguments),
        turn: readTurn(data.turn),
        time: typeof event.time === 'number' ? event.time : undefined,
      }
      this.rememberCall(session.id, info)
      return info
    }
    return undefined
  }

  private rememberCall(sessionId: string, info: ToolCallInfo): void {
    let calls = this.calls.get(sessionId)
    if (calls === undefined) {
      calls = new Map()
      this.calls.set(sessionId, calls)
    }
    calls.set(info.callId, info)
    if (calls.size > 512) {
      const oldest = calls.keys().next().value
      if (oldest !== undefined) calls.delete(oldest)
    }
  }
}
