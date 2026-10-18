import { isPlainObject } from '../core/json.js'
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
 * Per-session cache of the current turn and tool-call arguments.
 *
 * DSH has no turn accessor on `Session`/`Agent`, so this folds `session/event`
 * and lazily scans `snapshotEvents()` for sessions observed after load. No
 * filesystem, no persistence; session disposal clears everything.
 */
export class SessionTracker {
  private readonly turns = new Map<string, number>()
  private readonly calls = new Map<string, Map<string, ToolCallInfo>>()

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
  }

  currentTurn(session: Session): number {
    const cached = this.turns.get(session.id)
    if (cached !== undefined) return cached
    let turn = 0
    const events = session.snapshotEvents()
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index]
      if (event === undefined) continue
      if (event.type !== 'turn/start' && event.type !== 'turn/end') continue
      const data = isPlainObject(event.data) ? event.data : undefined
      const value = readTurn(data?.turn)
      if (value !== undefined) {
        turn = value
        break
      }
    }
    this.turns.set(session.id, turn)
    return turn
  }

  toolCall(session: Session, callId: string | undefined): ToolCallInfo | undefined {
    if (callId === undefined) return undefined
    const cached = this.calls.get(session.id)?.get(callId)
    if (cached !== undefined) return cached
    const events = session.snapshotEvents()
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
