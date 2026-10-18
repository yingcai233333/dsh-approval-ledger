import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { AuditLedger } from '../src/audit/ledger.js'
import { replayAudit } from '../src/audit/replay.js'
import { toAuditJson, toAuditJsonExport } from '../src/audit/export.js'

const SESSION = 'session-1'
const PLAN = 'P-7f3a2c91'

function replay() {
  const ledger = new AuditLedger(SESSION)
  ledger.append({
    callId: 'call-1',
    tool: 'write',
    risk: 'medium',
    outcome: 'allowed-once',
    planId: PLAN,
    itemId: 'A',
    target: { kind: 'path', value: 'C:\\ws\\out\\report.md' },
    time: 120,
  })
  return replayAudit({
    sessionId: SESSION,
    facts: [
      { type: 'approval/asked', callId: 'call-1', toolName: 'write', seq: 1, time: 110, turn: 1 },
      { type: 'approval/decided', callId: 'call-1', decision: 'allowed-once', seq: 2, time: 120, turn: 1 },
    ],
    ledger: ledger.list(),
    planMetas: [
      {
        planId: PLAN,
        schemaVersion: 1,
        matcherVersion: 1,
        riskPolicyVersion: 1,
        decision: 'approved',
        items: [{ id: 'A', tool: 'write', risk: 'medium', uses: 1 }],
      },
    ],
    now: 2000,
  })
}

describe('audit JSON export', () => {
  it('exports rows, plans, counts, and call references without duplicating rows', () => {
    const exported = toAuditJsonExport(replay())
    assert.equal(exported.schemaVersion, 1)
    assert.equal(exported.rows.length, 1)
    assert.equal(exported.plans[0]?.items[0]?.callId, 'call-1')
    assert.equal('record' in (exported.rows[0] ?? {}), false)
    assert.equal(JSON.stringify(exported).includes('C:\\\\ws\\\\out\\\\report.md'), false)
    assert.equal(JSON.stringify(exported).includes('report.md'), true)
  })

  it('produces valid compact and pretty JSON', () => {
    const compact = toAuditJson(replay())
    const pretty = toAuditJson(replay(), true)
    assert.equal(JSON.parse(compact).schemaVersion, 1)
    assert.equal(JSON.parse(pretty).schemaVersion, 1)
    assert.ok(pretty.includes('\n  '))
    assert.equal(compact.includes('\n'), false)
  })
})
