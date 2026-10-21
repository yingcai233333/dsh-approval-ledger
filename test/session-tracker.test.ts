import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { SessionTracker } from '../src/plugin/session-tracker.js'
import type { Session, SessionEvent } from '../src/types/dsh-runtime.js'

function session(id: string, events: SessionEvent[]): Session {
  return {
    id,
    seq: events.length,
    eventAt: (seq) => events.find((event) => event.seq === seq),
    snapshotEvents: () => events,
  }
}

function event(seq: number, type: string, data: unknown): SessionEvent {
  return { seq, type, time: seq * 10, data }
}

function bareSession(id: string): Session {
  return { id, seq: 0, eventAt: () => undefined } as unknown as Session
}

describe('session tracker', () => {
  it('folds turn and tool/call events', () => {
    const tracker = new SessionTracker()
    const s = session('s1', [])
    tracker.observe(s, event(1, 'turn/start', { turn: 3 }))
    tracker.observe(s, event(2, 'tool/call', {
      turn: 3,
      callId: 'c1',
      name: 'write',
      arguments: JSON.stringify({ path: 'C:\\ws\\a.md' }),
    }))
    assert.equal(tracker.currentTurn(s), 3)
    assert.deepEqual(tracker.toolCall(s, 'c1')?.args, { path: 'C:\\ws\\a.md' })
    assert.equal(tracker.toolCall(s, 'missing'), undefined)
  })

  it('lazily scans a session observed after load', () => {
    const tracker = new SessionTracker()
    const s = session('s1', [
      event(1, 'turn/start', { turn: 7 }),
      event(2, 'tool/call', { turn: 7, callId: 'c1', name: 'pwsh', arguments: '{"command":"npm test"}' }),
    ])
    assert.equal(tracker.currentTurn(s), 7)
    assert.deepEqual(tracker.toolCall(s, 'c1')?.args, { command: 'npm test' })
  })

  it('keeps unparseable arguments undefined', () => {
    const tracker = new SessionTracker()
    const s = session('s1', [
      event(1, 'tool/call', { turn: 1, callId: 'c1', name: 'write', arguments: '{bad' }),
    ])
    assert.equal(tracker.toolCall(s, 'c1')?.args, undefined)
  })

  it('forgets a session on disposal', () => {
    const tracker = new SessionTracker()
    const s = session('s1', [event(1, 'turn/start', { turn: 2 })])
    assert.equal(tracker.currentTurn(s), 2)
    tracker.forget('s1')
    assert.equal(tracker.currentTurn(s), 2)
  })

  it('returns undefined and marks the session degraded when history is unreadable', () => {
    const tracker = new SessionTracker()
    const s = bareSession('s1')
    assert.equal(tracker.currentTurn(s), undefined)
    assert.equal(tracker.isDegraded('s1'), true)
    assert.equal(tracker.degradedReason('s1'), 'no-snapshot-reader')
    assert.equal(tracker.toolCall(s, 'c1'), undefined)
    // A failed read must never look like a successful read of an empty log.
    assert.equal(tracker.currentTurn(s), undefined)
  })

  it('records a throwing reader as degraded instead of empty history', () => {
    const tracker = new SessionTracker()
    const s = {
      id: 's1',
      seq: 0,
      eventAt: () => undefined,
      snapshotEvents: () => {
        throw new Error('reader failed')
      },
    } as unknown as Session
    assert.equal(tracker.currentTurn(s), undefined)
    assert.equal(tracker.degradedReason('s1'), 'snapshot-threw')
    assert.equal(JSON.stringify(tracker.degradedReason('s1')).includes('failed'), false)
  })

  it('keeps the first degradation reason until the session is forgotten', () => {
    const tracker = new SessionTracker()
    const s = bareSession('s1')
    tracker.currentTurn(s)
    tracker.markDegraded('s1', 'snapshot-threw')
    assert.equal(tracker.degradedReason('s1'), 'no-snapshot-reader')
    tracker.forget('s1')
    assert.equal(tracker.isDegraded('s1'), false)
  })

  it('does not invent turn 0 for a readable history without turn boundaries', () => {
    const tracker = new SessionTracker()
    const s = session('s1', [
      event(1, 'tool/call', { turn: 5, callId: 'c1', name: 'write', arguments: '{}' }),
    ])
    assert.equal(tracker.currentTurn(s), undefined)
    // The reader worked, so the session is not degraded; the turn is simply unknown.
    assert.equal(tracker.isDegraded('s1'), false)
  })
})
