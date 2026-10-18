import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createCallAuditRecord } from '../src/audit/from-call.js'
import { RISK_RANK } from '../src/core/types.js'
import type { RiskAssessment } from '../src/core/types.js'

const CWD = 'C:\\ws'

function risk(level: RiskAssessment['level']): RiskAssessment {
  return {
    level,
    reasons: [{ code: 'test', level, message: 'test' }],
    autoEligible: level === 'medium',
    requiresSecondConfirm: false,
    policyVersion: 1,
  }
}

describe('call audit mapping', () => {
  it('stores a hash and summary for a path target, never content', () => {
    const record = createCallAuditRecord({
      sessionId: 's1',
      callId: 'c1',
      tool: 'write',
      risk: risk('medium'),
      outcome: 'allowed-once',
      mode: 'workspace-write',
      planId: 'P-12345678',
      itemId: 'A',
      matchedBy: 'plan-scope+risk-gate',
      cwd: CWD,
      platform: 'win32',
      args: { path: 'C:\\ws\\out\\report.md', content: 'token=sk-abcdefgh12345678' },
      time: 1000,
    })
    assert.match(record.targetHash ?? '', /^sha256:[a-f0-9]{64}$/)
    assert.match(record.targetSummary ?? '', /out\\report\.md/)
    assert.equal(JSON.stringify(record).includes('token='), false)
    assert.equal(JSON.stringify(record).includes('sk-abcdefgh'), false)
    assert.equal(record.planId, 'P-12345678')
    assert.equal(record.itemId, 'A')
    assert.equal(record.matchedBy, 'plan-scope+risk-gate')
    assert.equal(record.risk, 'medium')
  })

  it('normalizes path case into the hash', () => {
    const first = createCallAuditRecord({
      sessionId: 's1',
      callId: 'c1',
      tool: 'write',
      risk: risk('medium'),
      outcome: 'allowed-once',
      cwd: CWD,
      platform: 'win32',
      args: { path: 'C:\\WS\\Out\\Report.MD' },
      time: 1000,
    })
    const second = createCallAuditRecord({
      sessionId: 's1',
      callId: 'c2',
      tool: 'write',
      risk: risk('medium'),
      outcome: 'allowed-once',
      cwd: CWD,
      platform: 'win32',
      args: { path: 'c:/ws/out/report.md' },
      time: 1001,
    })
    assert.equal(first.targetHash, second.targetHash)
  })

  it('stores only the first command token and no arguments', () => {
    const record = createCallAuditRecord({
      sessionId: 's1',
      callId: 'c1',
      tool: 'pwsh',
      risk: risk('high'),
      outcome: 'rejected',
      cwd: CWD,
      platform: 'win32',
      args: { command: 'npm test --token sk-abcdefgh12345678' },
      time: 1000,
    })
    assert.equal(record.targetSummary, 'npm …')
    assert.equal(JSON.stringify(record).includes('sk-abcdefgh'), false)
  })

  it('does not invent a target for an unparseable args blob', () => {
    const record = createCallAuditRecord({
      sessionId: 's1',
      callId: 'c1',
      tool: 'mystery',
      risk: risk('unknown'),
      outcome: 'unavailable',
      cwd: CWD,
      platform: 'win32',
      args: { password: 'hunter2' },
      time: 1000,
    })
    assert.equal(record.targetHash, undefined)
    assert.equal(JSON.stringify(record).includes('hunter2'), false)
    assert.equal(RISK_RANK[record.risk], RISK_RANK.unknown)
  })
})
