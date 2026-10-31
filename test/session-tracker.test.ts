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

// PTC inner calls never append `tool/call`; the dispatch event carries the
// arguments and the `subCallId` the approval asks about.
function dispatchEvent(
  seq: number,
  subCallId: string,
  name: string,
  args: unknown,
): SessionEvent {
  return event(seq, 'tool/ptc-dispatch-start', {
    rootCallId: 'call_root',
    parentCallId: 'call_root',
    subCallId,
    name,
    arguments: args,
  })
}

describe('session tracker: PTC dispatch', () => {
  it('folds a dispatch event with object arguments and the observed turn', () => {
    const tracker = new SessionTracker()
    const s = session('s1', [])
    tracker.observe(s, event(1, 'turn/start', { turn: 4 }))
    tracker.observe(
      s,
      dispatchEvent(2, 'call_root:ptc:1', 'ops_inspect_local_file', {
        path: 'C:\\ws\\a.md',
        limit: 20,
      }),
    )
    const call = tracker.toolCall(s, 'call_root:ptc:1')
    assert.equal(call?.callId, 'call_root:ptc:1')
    assert.equal(call?.tool, 'ops_inspect_local_file')
    assert.deepEqual(call?.args, { path: 'C:\\ws\\a.md', limit: 20 })
    assert.equal(call?.turn, 4)
    assert.equal(call?.time, 20)
    // The approval only asks about the sub-call; the outer callId stays unknown.
    assert.equal(tracker.toolCall(s, 'call_root'), undefined)
  })

  it('folds a dispatch event whose arguments are a JSON string', () => {
    const tracker = new SessionTracker()
    const s = session('s1', [])
    tracker.observe(s, event(1, 'turn/start', { turn: 2 }))
    tracker.observe(
      s,
      dispatchEvent(2, 'call_root:ptc:2', 'ops_write_file', JSON.stringify({ path: 'C:\\ws\\b.md' })),
    )
    assert.deepEqual(tracker.toolCall(s, 'call_root:ptc:2')?.args, { path: 'C:\\ws\\b.md' })
  })

  it('scans history for a dispatch event matched by subCallId', () => {
    const tracker = new SessionTracker()
    const s = session('s1', [
      event(1, 'turn/start', { turn: 7 }),
      dispatchEvent(2, 'call_x:ptc:1', 'ops_bash', { command: 'npm test' }),
    ])
    const call = tracker.toolCall(s, 'call_x:ptc:1')
    assert.equal(call?.tool, 'ops_bash')
    assert.deepEqual(call?.args, { command: 'npm test' })
    assert.equal(call?.turn, 7)
  })

  it('scans history for a JSON string dispatch payload', () => {
    const tracker = new SessionTracker()
    const s = session('s1', [
      event(1, 'turn/start', { turn: 3 }),
      dispatchEvent(2, 'call_x:ptc:2', 'ops_read_files', '{"files":[{"path":"C:\\\\ws\\\\c.ts"}]}'),
    ])
    assert.deepEqual(tracker.toolCall(s, 'call_x:ptc:2')?.args, {
      files: [{ path: 'C:\\ws\\c.ts' }],
    })
  })

  it('returns undefined when no dispatch matches the requested callId', () => {
    const tracker = new SessionTracker()
    const s = session('s1', [
      event(1, 'turn/start', { turn: 1 }),
      dispatchEvent(2, 'call_x:ptc:1', 'ops_bash', { command: 'npm test' }),
    ])
    assert.equal(tracker.toolCall(s, 'call_x:ptc:2'), undefined)
  })

  it('never invents a turn for a dispatch observed outside a turn', () => {
    const tracker = new SessionTracker()
    const s = session('s1', [])
    tracker.observe(s, dispatchEvent(1, 'call_x:ptc:1', 'ops_bash', { command: 'npm test' }))
    assert.deepEqual(tracker.toolCall(s, 'call_x:ptc:1')?.args, { command: 'npm test' })
    assert.equal(tracker.toolCall(s, 'call_x:ptc:1')?.turn, undefined)
  })

  it('drops oversized dispatch arguments but keeps the call itself', () => {
    const tracker = new SessionTracker()
    const s = session('s1', [])
    tracker.observe(s, event(1, 'turn/start', { turn: 1 }))
    tracker.observe(
      s,
      dispatchEvent(2, 'call_x:ptc:1', 'ops_write_file', JSON.stringify({ content: 'a'.repeat(1_000_001) })),
    )
    const call = tracker.toolCall(s, 'call_x:ptc:1')
    assert.equal(call?.tool, 'ops_write_file')
    assert.equal(call?.args, undefined)
  })
})
