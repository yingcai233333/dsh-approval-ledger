import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { MemoryAuditStore } from '../src/audit/store.js'

describe('session audit store', () => {
  it('partitions records by session and lists them', () => {
    const store = new MemoryAuditStore()
    store.append('s1', {
      callId: 'c1',
      tool: 'write',
      risk: 'medium',
      outcome: 'allowed-once',
      time: 1000,
    })
    store.append('s2', {
      callId: 'c1',
      tool: 'write',
      risk: 'medium',
      outcome: 'rejected',
      time: 1001,
    })
    assert.equal(store.list('s1').length, 1)
    assert.equal(store.list('s2').length, 1)
    assert.equal(store.list('s1')[0]?.outcome, 'allowed-once')
    assert.equal(store.list('s2')[0]?.outcome, 'rejected')
    assert.deepEqual(store.sessions().sort(), ['s1', 's2'])
  })

  it('exposes the underlying ledger and clears one session', () => {
    const store = new MemoryAuditStore()
    store.append('s1', {
      callId: 'c1',
      tool: 'write',
      risk: 'medium',
      outcome: 'allowed-once',
      time: 1000,
    })
    const ledger = store.ledger('s1')
    assert.ok(ledger)
    assert.equal(ledger.size, 1)
    store.clear('s1')
    assert.equal(store.list('s1').length, 0)
    assert.equal(store.ledger('s1'), undefined)
  })

  it('rejects a duplicate callId in one session', () => {
    const store = new MemoryAuditStore()
    store.append('s1', {
      callId: 'c1',
      tool: 'write',
      risk: 'medium',
      outcome: 'allowed-once',
      time: 1000,
    })
    assert.throws(() =>
      store.append('s1', {
        callId: 'c1',
        tool: 'write',
        risk: 'medium',
        outcome: 'rejected',
        time: 1001,
      }),
    )
  })
})
