import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  deriveAuditRecords,
  eventsToReplayFacts,
} from '../src/audit/session-facts.js'
import type { SessionEventLike } from '../src/audit/session-facts.js'

const CWD = 'C:\\ws'

function events(): SessionEventLike[] {
  return [
    { type: 'turn/start', seq: 1, time: 100, data: { turn: 4 } },
    {
      type: 'tool/call',
      seq: 2,
      time: 110,
      data: {
        turn: 4,
        step: 0,
        callId: 'call-1',
        name: 'write',
        arguments: JSON.stringify({ path: 'C:\\ws\\out\\report.md' }),
      },
    },
    {
      type: 'approval/asked',
      seq: 3,
      time: 120,
      data: { id: 'a-1', toolName: 'write', callId: 'call-1', reason: 'write file' },
    },
    {
      type: 'approval/decided',
      seq: 4,
      time: 130,
      data: { id: 'a-1', outcome: 'allowed-once' },
    },
    {
      type: 'tool/result',
      seq: 5,
      time: 140,
      data: {
        turn: 4,
        step: 0,
        message: { toolCallId: 'call-1' },
        meta: { planId: 'P-12345678' },
      },
    },
    { type: 'turn/end', seq: 6, time: 150, data: { turn: 4, reason: 'completed' } },
  ]
}

describe('session event adapter', () => {
  it('joins decided events through the asked id and parses tool arguments', () => {
    const facts = eventsToReplayFacts(events())
    const asked = facts.find((fact) => fact.type === 'approval/asked')
    const decided = facts.find((fact) => fact.type === 'approval/decided')
    const call = facts.find((fact) => fact.type === 'tool/call')
    const result = facts.find((fact) => fact.type === 'tool/result')
    assert.equal(asked?.callId, 'call-1')
    assert.equal(decided?.callId, 'call-1')
    assert.equal(decided?.decision, 'allowed-once')
    assert.deepEqual(call?.args, { path: 'C:\\ws\\out\\report.md' })
    assert.deepEqual(result?.meta, { planId: 'P-12345678' })
    assert.equal(result?.callId, 'call-1')
  })

  it('drops a decided event with no matching asked id', () => {
    const facts = eventsToReplayFacts([
      { type: 'approval/decided', seq: 1, time: 1, data: { id: 'missing', outcome: 'rejected' } },
    ])
    assert.equal(facts.length, 0)
  })

  it('keeps invalid JSON arguments as undefined rather than throwing', () => {
    const facts = eventsToReplayFacts([
      {
        type: 'tool/call',
        seq: 1,
        time: 1,
        data: { callId: 'c1', name: 'write', arguments: '{not json' },
      },
    ])
    assert.equal(facts[0]?.args, undefined)
  })
})

describe('derived audit records', () => {
  it('reconstructs a target and risk from durable facts', () => {
    const facts = eventsToReplayFacts(events())
    const records = deriveAuditRecords(facts, {
      sessionId: 's1',
      cwd: CWD,
      platform: 'win32',
    })
    assert.equal(records.length, 1)
    const record = records[0]
    assert.ok(record)
    assert.equal(record.callId, 'call-1')
    assert.equal(record.risk, 'medium')
    assert.equal(record.outcome, 'allowed-once')
    assert.equal(record.matchedBy, 'derived-session-log')
    assert.match(record.targetHash ?? '', /^sha256:[a-f0-9]{64}$/)
    assert.match(record.targetSummary ?? '', /out\\report\.md/)
  })

  it('does not derive a record from unparseable arguments', () => {
    const facts = eventsToReplayFacts([
      {
        type: 'tool/call',
        seq: 1,
        time: 1,
        data: { callId: 'c1', name: 'write', arguments: '{bad' },
      },
      {
        type: 'approval/asked',
        seq: 2,
        time: 2,
        data: { id: 'a1', toolName: 'write', callId: 'c1' },
      },
      {
        type: 'approval/decided',
        seq: 3,
        time: 3,
        data: { id: 'a1', outcome: 'allowed-once' },
      },
    ])
    assert.deepEqual(
      deriveAuditRecords(facts, { sessionId: 's1', cwd: CWD, platform: 'win32' }),
      [],
    )
  })
})
