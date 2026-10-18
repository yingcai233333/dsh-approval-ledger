import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { scrubSecrets } from '../src/core/redact.js'
import { sha256Tag } from '../src/core/hash.js'
import { AuditLedger } from '../src/audit/ledger.js'
import { canonicalTargetValue, createAuditRecord } from '../src/audit/record.js'
import { replayAudit } from '../src/audit/replay.js'
import { renderAuditReport } from '../src/audit/report.js'
import { validateAuditRecord } from '../src/audit/schema.js'
import type { AuditRecord } from '../src/audit/types.js'

const SESSION = 'session-1'
const PLAN = 'P-7f3a2c91'

function makeRecord(overrides: Record<string, unknown> = {}): AuditRecord {
  return createAuditRecord({
    sessionId: SESSION,
    callId: 'call-1',
    tool: 'write',
    risk: 'medium',
    outcome: 'allowed-once',
    target: { kind: 'path', value: 'C:\\ws\\out\\report.md' },
    time: 1000,
    ...overrides,
  })
}

describe('secret scrubbing', () => {
  it('masks common credentials and keeps the shape', () => {
    const text = scrubSecrets(
      'token=sk-abcdefgh12345678 password=hunter2 Bearer abcdefghijklmnop AKIAABCDEFGHIJKLMNOP',
    )
    assert.equal(text.includes('sk-abcdefgh12345678'), false)
    assert.equal(text.includes('hunter2'), false)
    assert.equal(text.includes('abcdefghijklmnop'), false)
    assert.equal(text.includes('AKIAABCDEFGHIJKLMNOP'), false)
  })

  it('masks home directory account names', () => {
    assert.equal(scrubSecrets('C:\\Users\\alice\\secret\\a.txt').includes('alice'), false)
    assert.equal(scrubSecrets('/home/alice/secret/a.txt').includes('alice'), false)
  })

  it('does not throw on non-strings', () => {
    assert.equal(scrubSecrets(undefined), '')
    assert.equal(scrubSecrets(42), '')
  })
})

describe('audit records', () => {
  it('hashes the target and stores only a short summary', () => {
    const record = makeRecord()
    assert.match(record.targetHash ?? '', /^sha256:[a-f0-9]{64}$/)
    assert.equal(record.targetSummary, '…\\out\\report.md')
    assert.equal(JSON.stringify(record).includes('C:\\ws\\out\\report.md'), false)
  })

  it('summarizes commands without arguments and args without values', () => {
    const command = makeRecord({
      tool: 'pwsh',
      target: { kind: 'command', value: 'pwsh -c "token=sk-abcdefgh12345678"' },
    })
    assert.equal(command.targetSummary, 'pwsh …')
    assert.equal(JSON.stringify(command).includes('sk-'), false)

    const args = makeRecord({
      target: { kind: 'args', value: '{"password":"hunter2","path":"a"}' },
    })
    assert.equal(args.targetSummary, 'args{2}')
    assert.equal(JSON.stringify(args).includes('hunter2'), false)
  })

  it('is deterministic for the same target and time', () => {
    const first = makeRecord()
    const second = makeRecord()
    assert.equal(first.targetHash, second.targetHash)
    assert.equal(first.time, second.time)
  })

  it('does not let the summary influence the target hash', () => {
    const first = makeRecord({ target: { kind: 'path', value: 'C:\\ws\\a.md', summary: 'one' } })
    const second = makeRecord({ target: { kind: 'path', value: 'C:\\ws\\a.md', summary: 'two' } })
    assert.equal(first.targetHash, second.targetHash)
  })

  it('does not keep the account name in a home-directory summary', () => {
    const record = makeRecord({
      target: { kind: 'path', value: 'C:\\Users\\alice\\secret.txt' },
    })
    assert.equal(record.targetSummary, '%USERPROFILE%\\secret.txt')
    assert.equal((record.targetSummary ?? '').includes('alice'), false)
  })

  it('sanitizes control characters in a summary so the record still validates', () => {
    const record = makeRecord({ target: { kind: 'path', value: 'C:\\ws\\a\nb.md' } })
    const summary = record.targetSummary ?? ''
    const hasControl = [...summary].some((char) => {
      const code = char.charCodeAt(0)
      return code < 0x20 || code === 0x7f
    })
    assert.equal(hasControl, false)
    assert.equal(validateAuditRecord(record).ok, true)
  })

  it('rejects invalid inputs', () => {
    assert.throws(() => makeRecord({ sessionId: '' }))
    assert.throws(() => makeRecord({ risk: 'nope' }))
    assert.throws(() => makeRecord({ outcome: 'maybe' }))
    assert.throws(() => makeRecord({ target: { kind: 'nope', value: 'x' } }))
    assert.throws(() => makeRecord({ target: { kind: 'path', value: '' } }))
    assert.throws(() => makeRecord({ target: null }))
  })

  it('passes the published v1 schema validation', () => {
    const result = validateAuditRecord(makeRecord())
    assert.equal(result.ok, true)
  })
})

describe('audit schema validation', () => {
  it('rejects missing fields, unknown fields, bad enums, and bad hashes', () => {
    assert.equal(validateAuditRecord({}).ok, false)

    const extra = { ...makeRecord(), reason: 'because' }
    assert.equal(validateAuditRecord(extra).ok, false)

    const badRisk = { ...makeRecord(), risk: 'severe' }
    assert.equal(validateAuditRecord(badRisk).ok, false)

    const badOutcome = { ...makeRecord(), outcome: 'maybe' }
    assert.equal(validateAuditRecord(badOutcome).ok, false)

    const badHash = { ...makeRecord(), targetHash: 'sha256:xyz' }
    assert.equal(validateAuditRecord(badHash).ok, false)

    const badVersion = { ...makeRecord(), schemaVersion: 2 }
    assert.equal(validateAuditRecord(badVersion).ok, false)

    const badTime = { ...makeRecord(), time: -1 }
    assert.equal(validateAuditRecord(badTime).ok, false)
  })

  it('rejects a summary that still contains a secret', () => {
    const record = { ...makeRecord(), targetSummary: 'token=sk-abcdefgh12345678' }
    const result = validateAuditRecord(record)
    assert.equal(result.ok, false)
    if (!result.ok) assert.ok(result.issues.some((issue) => issue.code === 'secret-in-summary'))
  })
})

describe('audit ledger', () => {
  it('assigns monotonic sequence numbers and verifies cleanly', () => {
    const ledger = new AuditLedger(SESSION)
    const first = ledger.append({
      callId: 'call-1',
      tool: 'write',
      risk: 'medium',
      outcome: 'allowed-once',
      target: { kind: 'path', value: 'C:\\ws\\a.md' },
      time: 1000,
    })
    const second = ledger.append({
      callId: 'call-2',
      tool: 'write',
      risk: 'medium',
      outcome: 'allowed-once',
      target: { kind: 'path', value: 'C:\\ws\\b.md' },
      time: 1001,
    })
    assert.equal(first.seq, 0)
    assert.equal(second.seq, 1)
    assert.equal(ledger.size, 2)
    assert.deepEqual(ledger.verify(), [])
  })

  it('rejects duplicate callIds and explicit out-of-order sequences', () => {
    const ledger = new AuditLedger(SESSION)
    ledger.append({
      callId: 'call-1',
      tool: 'write',
      risk: 'medium',
      outcome: 'allowed-once',
    })
    assert.throws(() =>
      ledger.append({
        callId: 'call-1',
        tool: 'write',
        risk: 'medium',
        outcome: 'allowed-once',
      }),
    )
    assert.throws(() =>
      ledger.append({
        seq: 10,
        callId: 'call-2',
        tool: 'write',
        risk: 'medium',
        outcome: 'allowed-once',
      }),
    )
  })

  it('round-trips JSONL and reports bad lines', () => {
    const ledger = new AuditLedger(SESSION)
    ledger.append({
      callId: 'call-1',
      tool: 'write',
      risk: 'medium',
      outcome: 'allowed-once',
      target: { kind: 'path', value: 'C:\\ws\\a.md' },
      time: 1000,
    })
    const text = ledger.toJSONL()
    const restored = AuditLedger.fromJSONL(text, { sessionId: SESSION })
    assert.equal(restored.ledger.size, 1)
    assert.deepEqual(restored.issues, [])

    const broken = AuditLedger.fromJSONL(`${text}\nnot-json`)
    assert.equal(broken.ledger.size, 1)
    assert.ok(broken.issues.some((issue) => issue.code === 'invalid-json'))
  })

  it('detects sequence gaps in restored data', () => {
    const first = makeRecord({ callId: 'call-1', seq: 5, time: 1000 })
    const second = makeRecord({ callId: 'call-2', seq: 7, time: 1001 })
    const restored = AuditLedger.fromJSONL(
      `${JSON.stringify(first)}\n${JSON.stringify(second)}`,
      { sessionId: SESSION },
    )
    assert.equal(restored.ledger.size, 2)
    assert.ok(restored.issues.some((issue) => issue.code === 'seq-gap'))
  })
})

describe('audit replay', () => {
  function setup(overrides: {
    record2?: Record<string, unknown>
    includePlanMeta?: boolean
    includeCall3?: boolean
  } = {}) {
    const ledger = new AuditLedger(SESSION)
    const record1 = ledger.append({
      callId: 'call-1',
      tool: 'write',
      risk: 'medium',
      outcome: 'allowed-once',
      planId: PLAN,
      itemId: 'A',
      target: { kind: 'path', value: 'C:\\ws\\out\\report.md' },
      time: 120,
    })
    const record2 = ledger.append({
      callId: 'call-2',
      tool: 'write',
      risk: 'medium',
      outcome: 'allowed-once',
      planId: PLAN,
      itemId: 'B',
      target: { kind: 'path', value: 'C:\\ws\\out\\data.json' },
      time: 130,
      ...overrides.record2,
    })

    const facts: unknown[] = [
      { type: 'turn/start', turn: 4, seq: 1, time: 100 },
      { type: 'approval/asked', callId: 'call-1', toolName: 'write', seq: 2, time: 110 },
      { type: 'approval/decided', callId: 'call-1', decision: 'allowed-once', seq: 3, time: 120 },
      { type: 'approval/asked', callId: 'call-2', toolName: 'write', seq: 4, time: 125 },
      { type: 'approval/decided', callId: 'call-2', decision: 'allowed-once', seq: 5, time: 130 },
    ]
    if (overrides.includeCall3 === true) {
      facts.push(
        { type: 'approval/asked', callId: 'call-3', toolName: 'write', seq: 6, time: 140 },
        { type: 'approval/decided', callId: 'call-3', decision: 'rejected', seq: 7, time: 150 },
      )
    }

    const planMetas =
      overrides.includePlanMeta === false
        ? []
        : [
            {
              planId: PLAN,
              schemaVersion: 1,
              matcherVersion: 1,
              riskPolicyVersion: 1,
              decision: 'approved',
              approved: ['A', 'B'],
              manual: [],
              items: [
                { id: 'A', tool: 'write', risk: 'medium', uses: 1 },
                { id: 'B', tool: 'write', risk: 'medium', uses: 1 },
              ],
            },
          ]

    return { ledger, record1, record2, facts, planMetas }
  }

  it('joins decisions, ledger records, and plans', () => {
    const { ledger, facts, planMetas } = setup()
    const replay = replayAudit({
      sessionId: SESSION,
      facts,
      ledger: ledger.list(),
      planMetas,
      now: 2000,
      versions: { schemaVersion: 1, matcherVersion: 1, riskPolicyVersion: 1 },
    })
    assert.equal(replay.rows.length, 2)
    assert.equal(replay.counts.verified, 2)
    assert.equal(replay.counts.unattributed, 0)
    assert.equal(replay.counts.plans, 1)
    assert.equal(replay.plans[0]?.status, 'verified')
    assert.equal(replay.plans[0]?.rows.length, 2)
    assert.equal(replay.plans[0]?.items[0]?.status, 'matched')
    assert.equal(replay.rows[0]?.turn, 4)
  })

  it('reports a decision without a ledger record as unattributed', () => {
    const { ledger, facts, planMetas } = setup({ includeCall3: true })
    const replay = replayAudit({
      sessionId: SESSION,
      facts,
      ledger: ledger.list(),
      planMetas,
    })
    assert.equal(replay.counts.decisions, 3)
    assert.equal(replay.counts.unattributed, 1)
    assert.equal(replay.unattributed[0]?.callId, 'call-3')
    assert.ok(replay.unattributed[0]?.issues.includes('missing-ledger-record'))
  })

  it('reports a tool call without any approval event as unattributed', () => {
    const { ledger, facts, planMetas } = setup()
    facts.push({
      type: 'tool/call',
      callId: 'call-no-approval',
      toolName: 'write',
      turn: 4,
      seq: 9,
      time: 900,
    })
    const replay = replayAudit({
      sessionId: SESSION,
      facts,
      ledger: ledger.list(),
      planMetas,
    })
    const row = replay.rows.find((candidate) => candidate.callId === 'call-no-approval')
    assert.equal(row?.status, 'unattributed')
    assert.equal(row?.tool, 'write')
    assert.ok(row?.issues.includes('no-approval-fact'))
  })

  it('attributes an unapproved call to a plan item by target hash', () => {
    const targetHash = sha256Tag(
      canonicalTargetValue({ kind: 'path', value: 'c:\\ws\\out\\report.md' }),
    )
    const planMeta = {
      planId: 'P-target',
      schemaVersion: 1,
      matcherVersion: 1,
      riskPolicyVersion: 1,
      decision: 'approved',
      approved: ['A'],
      manual: [],
      items: [
        { id: 'A', tool: 'write', risk: 'medium', uses: 1, auto: true, targetHash },
      ],
      grants: [{ item: 'A', uses: 1, expires: 'turn' }],
    }
    const facts = [
      {
        type: 'tool/call',
        callId: 'call-target',
        toolName: 'write',
        args: { file_path: 'C:\\ws\\out\\report.md' },
        turn: 1,
        seq: 1,
        time: 100,
      },
    ]
    const replay = replayAudit({
      sessionId: SESSION,
      cwd: 'C:\\ws',
      platform: 'win32',
      facts,
      ledger: [],
      planMetas: [planMeta],
    })
    const row = replay.rows.find((candidate) => candidate.callId === 'call-target')
    assert.equal(row?.planId, 'P-target')
    assert.equal(row?.itemId, 'A')
    assert.equal(row?.matchedBy, 'plan-item')
    assert.equal(row?.status, 'unverifiable')
    assert.ok(row?.issues.includes('no-approval-fact'))
  })

  it('attributes a decided call to a plan item by target hash', () => {
    const targetHash = sha256Tag(
      canonicalTargetValue({ kind: 'path', value: 'c:\\ws\\out\\report.md' }),
    )
    const planMeta = {
      planId: 'P-target',
      schemaVersion: 1,
      matcherVersion: 1,
      riskPolicyVersion: 1,
      decision: 'approved',
      approved: ['A'],
      manual: [],
      items: [
        { id: 'A', tool: 'write', risk: 'high', uses: 1, auto: false, targetHash },
      ],
      grants: [],
    }
    const record = makeRecord({
      callId: 'call-decided',
      tool: 'write',
      risk: 'high',
      outcome: 'rejected',
    })
    const facts = [
      {
        type: 'tool/call',
        callId: 'call-decided',
        toolName: 'write',
        args: { file_path: 'C:\\ws\\out\\report.md' },
        turn: 1,
        seq: 1,
        time: 100,
      },
      {
        type: 'approval/asked',
        id: 'ask-1',
        callId: 'call-decided',
        toolName: 'write',
        turn: 1,
        seq: 2,
        time: 110,
      },
      {
        type: 'approval/decided',
        id: 'ask-1',
        callId: 'call-decided',
        decision: 'rejected',
        turn: 1,
        seq: 3,
        time: 120,
      },
    ]
    const replay = replayAudit({
      sessionId: SESSION,
      cwd: 'C:\\ws',
      platform: 'win32',
      facts,
      ledger: [record],
      planMetas: [planMeta],
    })
    const row = replay.rows.find((candidate) => candidate.callId === 'call-decided')
    assert.equal(row?.planId, 'P-target')
    assert.equal(row?.itemId, 'A')
    assert.equal(row?.matchedBy, 'plan-item')
    assert.equal(row?.status, 'verified')
  })

  it('marks version drift as unverifiable', () => {
    const { ledger, facts, planMetas } = setup({ record2: { matcherVersion: 2 } })
    const replay = replayAudit({
      sessionId: SESSION,
      facts,
      ledger: ledger.list(),
      planMetas,
      versions: { schemaVersion: 1, matcherVersion: 1, riskPolicyVersion: 1 },
    })
    assert.equal(replay.counts.unverifiable, 1)
    const row = replay.rows.find((candidate) => candidate.callId === 'call-2')
    assert.equal(row?.status, 'unverifiable')
    assert.ok(row?.issues.includes('matcher-version-mismatch'))
  })

  it('marks outcome disagreements as mismatch', () => {
    const { ledger, facts, planMetas } = setup({ record2: { outcome: 'rejected' } })
    const replay = replayAudit({ sessionId: SESSION, facts, ledger: ledger.list(), planMetas })
    const row = replay.rows.find((candidate) => candidate.callId === 'call-2')
    assert.equal(row?.status, 'mismatch')
    assert.ok(row?.issues.includes('outcome-mismatch'))
  })

  it('marks a missing plan meta as unverifiable', () => {
    const { ledger, facts } = setup({ includePlanMeta: false })
    const replay = replayAudit({ sessionId: SESSION, facts, ledger: ledger.list() })
    const row = replay.rows.find((candidate) => candidate.callId === 'call-1')
    assert.equal(row?.status, 'unverifiable')
    assert.ok(row?.issues.includes('missing-plan-meta'))
    assert.equal(replay.plans[0]?.status, 'missing-meta')
  })

  it('reports ledger-only records as orphans', () => {
    const { ledger, facts, planMetas } = setup()
    ledger.append({
      callId: 'call-9',
      tool: 'pwsh',
      risk: 'high',
      outcome: 'allowed-once',
      target: { kind: 'command', value: 'npm test' },
      time: 160,
    })
    const replay = replayAudit({
      sessionId: SESSION,
      facts,
      ledger: ledger.list(),
      planMetas,
    })
    assert.equal(replay.counts.orphans, 1)
    assert.equal(replay.orphans[0]?.callId, 'call-9')
  })

  it('reports asked-but-undecided approvals as pending', () => {
    const { ledger, facts, planMetas } = setup()
    ledger.append({
      callId: 'call-4',
      tool: 'write',
      risk: 'medium',
      outcome: 'allowed-once',
      time: 170,
    })
    const replay = replayAudit({
      sessionId: SESSION,
      facts: [
        ...facts,
        { type: 'approval/asked', callId: 'call-4', toolName: 'write', seq: 8, time: 170 },
      ],
      ledger: ledger.list(),
      planMetas,
    })
    assert.equal(replay.counts.pending, 1)
    assert.equal(replay.rows.find((row) => row.callId === 'call-4')?.status, 'pending')
  })

  it('never copies reasons or display reasons into the replay', () => {
    const { ledger, facts, planMetas } = setup()
    const secret = 'sk-abcdefgh12345678'
    const withReason = facts.map((fact) => {
      if (typeof fact === 'object' && fact !== null && (fact as { type?: string }).type === 'approval/asked') {
        return { ...fact, reason: { raw: secret }, displayReason: { en: secret, zh: secret } }
      }
      return fact
    })
    const replay = replayAudit({
      sessionId: SESSION,
      facts: withReason,
      ledger: ledger.list(),
      planMetas,
    })
    assert.equal(JSON.stringify(replay).includes(secret), false)
  })

  it('reports malformed facts and ledger entries without throwing', () => {
    const replay = replayAudit({
      sessionId: SESSION,
      facts: [null, { type: 'approval/decided' }, { type: 'unknown' }],
      ledger: [{ bad: true }, null],
    })
    assert.ok(replay.issues.length > 0)
    assert.equal(replay.rows.length, 0)
  })

  it('deduplicates repeated asked facts', () => {
    const replay = replayAudit({
      sessionId: SESSION,
      facts: [
        { type: 'approval/asked', callId: 'call-1', toolName: 'write', seq: 1, time: 100 },
        { type: 'approval/asked', callId: 'call-1', toolName: 'write', seq: 2, time: 101 },
      ],
      ledger: [],
    })
    assert.ok(replay.issues.some((issue) => issue.code === 'duplicate-asked'))
    assert.equal(replay.rows.filter((row) => row.callId === 'call-1').length, 1)
  })

  it('returns an empty, fail-closed replay for invalid input', () => {
    const replay = replayAudit({ facts: null, ledger: null } as unknown as {
      facts: readonly unknown[]
      ledger: readonly unknown[]
    })
    assert.equal(replay.rows.length, 0)
    assert.ok(replay.issues.some((issue) => issue.code === 'invalid-input'))
  })
})

describe('audit report', () => {
  it('renders plans, statuses, and counts without raw targets', () => {
    const ledger = new AuditLedger(SESSION)
    ledger.append({
      callId: 'call-1',
      tool: 'write',
      risk: 'medium',
      outcome: 'allowed-once',
      planId: PLAN,
      itemId: 'A',
      target: { kind: 'path', value: 'C:\\Users\\alice\\secret\\a.md' },
      time: 120,
    })
    const replay = replayAudit({
      sessionId: SESSION,
      facts: [
        { type: 'approval/asked', callId: 'call-1', toolName: 'write', seq: 2, time: 110, turn: 1 },
        { type: 'approval/decided', callId: 'call-1', decision: 'allowed-once', seq: 3, time: 120, turn: 1 },
        { type: 'approval/decided', callId: 'call-2', decision: 'rejected', seq: 4, time: 130, turn: 1 },
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
    const report = renderAuditReport(replay, { lang: 'zh' })
    assert.match(report, /P-7f3a2c91/)
    assert.match(report, /未归属/)
    assert.match(report, /已核对/)
    assert.equal(report.includes('alice'), false)
    assert.equal(report.includes('C:\\Users'), false)
    assert.match(report, /校验：/)
    assert.match(report, /secret\\a\.md/)
  })

  it('escapes table separators and renders English labels', () => {
    const ledger = new AuditLedger(SESSION)
    ledger.append({
      callId: 'call-1',
      tool: 'write',
      risk: 'medium',
      outcome: 'allowed-once',
      target: { kind: 'path', value: 'C:\\ws\\a.md' },
      time: 120,
      matchedBy: 'plan-scope+risk-gate',
    })
    const replay = replayAudit({
      sessionId: SESSION,
      facts: [
        { type: 'approval/decided', callId: 'call-1', decision: 'allowed-once', seq: 1, time: 120, turn: 1 },
      ],
      ledger: ledger.list(),
      now: 2000,
    })
    const report = renderAuditReport(replay, { lang: 'en' })
    assert.match(report, /Approval decision ledger/)
    assert.match(report, /verified/)
  })
})
