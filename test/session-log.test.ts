import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readSessionEvents } from '../src/plugin/session-log.js'

interface EventLike {
  type: string
  seq: number
  time: number
  data: unknown
}

function event(seq: number, type: string, data: unknown): EventLike {
  return { seq, type, time: seq * 10, data }
}

function sessionWith(events: EventLike[]): { id: string; snapshotEvents: () => EventLike[] } {
  return { id: 's1', snapshotEvents: () => events }
}

describe('session log adapter', () => {
  it('reads the event history through the single snapshot reader', () => {
    const events = [event(1, 'turn/start', { turn: 2 })]
    const read = readSessionEvents(sessionWith(events))
    assert.deepEqual(read, { ok: true, events })
  })

  it('returns a frozen copy so callers cannot mutate the runtime array', () => {
    const source = [event(1, 'turn/start', { turn: 2 })]
    const read = readSessionEvents(sessionWith(source))
    assert.equal(read.ok, true)
    if (!read.ok) return

    assert.notEqual(read.events, source)
    assert.equal(Object.isFrozen(read.events), true)
    assert.throws(() => {
      ;(read.events as unknown as EventLike[]).push(event(2, 'turn/end', { turn: 2 }))
    }, TypeError)
    assert.equal(source.length, 1)
    assert.equal(Object.isFrozen(source), false)
  })

  it('calls the reader with the session as its receiver', () => {
    const events = [event(1, 'turn/start', { turn: 4 })]
    const session = {
      id: 's1',
      history: events,
      snapshotEvents(this: { history: EventLike[] }) {
        return this.history
      },
    }
    const read = readSessionEvents(session)
    assert.equal(read.ok, true)
    if (read.ok) assert.deepEqual(read.events, events)
  })

  it('reports a missing reader for non-objects and objects without the method', () => {
    for (const value of [null, undefined, 42, 'session', {}, { snapshotEvents: 'not-a-function' }]) {
      assert.deepEqual(readSessionEvents(value), { ok: false, reason: 'no-snapshot-reader' })
    }
  })

  it('reports a throwing reader with a stable code and no error text', () => {
    const read = readSessionEvents({
      id: 's1',
      snapshotEvents: () => {
        throw new Error('boom: C:\\ws\\secret.txt')
      },
    })
    assert.deepEqual(read, { ok: false, reason: 'snapshot-threw' })
    assert.equal(JSON.stringify(read).includes('boom'), false)
    assert.equal(JSON.stringify(read).includes('secret'), false)
  })

  it('reports a throwing property getter', () => {
    const session = Object.defineProperty({}, 'snapshotEvents', {
      get() {
        throw new Error('getter failed')
      },
    })
    assert.deepEqual(readSessionEvents(session), { ok: false, reason: 'snapshot-unavailable' })
  })

  it('reports a non-array result instead of treating it as empty history', () => {
    for (const value of [undefined, null, {}, 'events']) {
      assert.deepEqual(
        readSessionEvents({ id: 's1', snapshotEvents: () => value }),
        { ok: false, reason: 'snapshot-malformed' },
      )
    }
  })
})
