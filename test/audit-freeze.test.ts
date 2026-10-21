import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { toAuditJson, toAuditJsonExport } from '../src/audit/export.js'
import { canonicalTargetValue } from '../src/audit/record.js'
import { replayAudit } from '../src/audit/replay.js'
import { validateAuditRecord } from '../src/audit/schema.js'
import { APPROVAL_OUTCOMES, AUDIT_TARGET_KINDS } from '../src/audit/types.js'
import { sha256Tag } from '../src/core/hash.js'
import { RISK_RANK } from '../src/core/types.js'
import { MATCHER_VERSION, RISK_POLICY_VERSION, SCHEMA_VERSION } from '../src/core/version.js'

const FREEZE =
  'FROZEN v1 audit contract: changing this requires the major-version process ' +
  '(ship v2 and keep reading v1 records); see docs/audit.md.'

function frozen(what: string): string {
  return `${FREEZE} [${what}]`
}

interface SchemaNode {
  $schema?: string
  $id?: string
  $comment?: string
  title?: string
  type?: string
  additionalProperties?: boolean
  required?: string[]
  properties?: Record<string, SchemaNode>
  const?: unknown
  enum?: unknown[]
  minimum?: number
  minLength?: number
  maxLength?: number
  pattern?: string
}

const schema = JSON.parse(readFileSync('schema/audit-v1.json', 'utf8')) as SchemaNode
const properties = schema.properties ?? {}

const SCHEMA_ID = 'https://github.com/yingcai233333/dsh-approval-ledger/schema/audit-v1.json'
const REQUIRED_FIELDS = ['schemaVersion', 'sessionId', 'callId', 'tool', 'risk', 'outcome', 'time']
const OPTIONAL_FIELDS = [
  'seq',
  'planId',
  'itemId',
  'mode',
  'targetHash',
  'targetSummary',
  'matchedBy',
  'matcherVersion',
  'riskPolicyVersion',
]
const RISK_VALUES = ['critical', 'high', 'medium', 'low', 'unknown']
const DECISION_VALUES = ['allowed-once', 'rejected', 'cancelled', 'unavailable']
const TARGET_KINDS = ['path', 'command', 'args', 'unknown']

// Hard-coded canonical hash for {kind:'path', value:'C:\ws\out\report.md'}.
// Do not recompute it in the assertion: that would hide a change to the
// canonical form instead of catching it.
const LEGACY_TARGET_HASH =
  'sha256:980f84b3fbbdf821fd37c3488011bff1dae780e2b03eb37d138bc7810159fa2a'

const LEGACY_FULL_RECORD = {
  schemaVersion: 1,
  sessionId: 'session-legacy',
  seq: 7,
  callId: 'call-legacy-1',
  planId: 'P-legacy01',
  itemId: 'A',
  tool: 'write',
  risk: 'medium',
  mode: 'workspace-write',
  targetHash: LEGACY_TARGET_HASH,
  targetSummary: '…\\out\\report.md',
  matchedBy: 'plan-scope+risk-gate',
  outcome: 'allowed-once',
  matcherVersion: 1,
  riskPolicyVersion: 1,
  time: 1760000000000,
} as const

const LEGACY_FACTS = [
  {
    type: 'approval/asked',
    callId: 'call-legacy-1',
    toolName: 'write',
    seq: 1,
    time: 1759999999000,
    turn: 3,
  },
  {
    type: 'approval/decided',
    callId: 'call-legacy-1',
    decision: 'allowed-once',
    seq: 2,
    time: 1760000000000,
    turn: 3,
  },
] as const

const LEGACY_PLAN = {
  planId: 'P-legacy01',
  schemaVersion: 1,
  matcherVersion: 1,
  riskPolicyVersion: 1,
  decision: 'approved',
  items: [{ id: 'A', tool: 'write', risk: 'medium', uses: 1 }],
} as const

const LEGACY_MINIMAL_RECORD = {
  schemaVersion: 1,
  sessionId: 'session-legacy-min',
  callId: 'call-legacy-2',
  tool: 'pwsh',
  risk: 'high',
  outcome: 'rejected',
  time: 1760000001000,
} as const

const EXPECTED_LEGACY_ROW = {
  callId: 'call-legacy-1',
  tool: 'write',
  turn: 3,
  time: 1760000000000,
  decision: 'allowed-once',
  status: 'verified',
  issues: [],
  planId: 'P-legacy01',
  itemId: 'A',
  risk: 'medium',
  mode: 'workspace-write',
  targetHash: LEGACY_TARGET_HASH,
  targetSummary: '…\\out\\report.md',
  matchedBy: 'plan-scope+risk-gate',
}

const EXPECTED_LEGACY_COUNTS = {
  facts: 2,
  decisions: 1,
  records: 1,
  verified: 1,
  unattributed: 0,
  unverifiable: 0,
  mismatch: 0,
  orphans: 0,
  pending: 0,
  plans: 1,
}

function legacyReplay() {
  return replayAudit({
    sessionId: 'session-legacy',
    facts: LEGACY_FACTS,
    ledger: [LEGACY_FULL_RECORD],
    planMetas: [LEGACY_PLAN],
    now: 1760000100000,
  })
}

describe('audit format v1 freeze', () => {
  it('pins the frozen v1 schema shape; changing it requires the major-version process', () => {
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema', frozen('$schema'))
    assert.equal(schema.$id, SCHEMA_ID, frozen('$id identifies audit-v1'))
    assert.match(schema.$comment ?? '', /\bFROZEN\b/, frozen('schema carries an explicit freeze marker'))
    assert.match(schema.title ?? '', /\(v1\)/, frozen('title names v1'))
    assert.equal(schema.type, 'object', frozen('a record is an object'))
    assert.equal(schema.additionalProperties, false, frozen('unknown fields are rejected'))

    assert.equal(SCHEMA_VERSION, 1, frozen('SCHEMA_VERSION'))
    assert.equal(MATCHER_VERSION, 1, frozen('MATCHER_VERSION'))
    assert.equal(RISK_POLICY_VERSION, 1, frozen('RISK_POLICY_VERSION'))
    assert.equal(
      properties.schemaVersion?.const,
      SCHEMA_VERSION,
      frozen('schemaVersion.const matches SCHEMA_VERSION'),
    )

    const required = schema.required ?? []
    assert.equal(new Set(required).size, required.length, frozen('required has no duplicates'))
    assert.deepEqual(
      [...required].sort(),
      [...REQUIRED_FIELDS].sort(),
      frozen('top-level required field set'),
    )
    for (const optional of OPTIONAL_FIELDS) {
      assert.equal(
        required.includes(optional),
        false,
        frozen(`${optional} stays optional (old records may omit it)`),
      )
    }
    assert.deepEqual(
      Object.keys(properties).sort(),
      [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS].sort(),
      frozen('property set (add only optional fields in a minor release)'),
    )

    assert.deepEqual(
      [...(properties.risk?.enum ?? [])].sort(),
      [...RISK_VALUES].sort(),
      frozen('risk enum'),
    )
    assert.deepEqual(
      Object.keys(RISK_RANK).sort(),
      [...RISK_VALUES].sort(),
      frozen('risk levels in code'),
    )

    // `decision` is the replay/export name for the ledger's `outcome`.
    assert.deepEqual(
      [...(properties.outcome?.enum ?? [])].sort(),
      [...DECISION_VALUES].sort(),
      frozen('outcome (decision) enum'),
    )
    assert.deepEqual(
      [...APPROVAL_OUTCOMES].sort(),
      [...DECISION_VALUES].sort(),
      frozen('outcome enum in code'),
    )
    assert.equal(properties.decision, undefined, frozen('v1 has no separate decision field'))

    // target.kind never appears in a record, but it seeds the target hash.
    assert.deepEqual(
      [...AUDIT_TARGET_KINDS].sort(),
      [...TARGET_KINDS].sort(),
      frozen('target.kind enum'),
    )
    assert.equal(properties.target, undefined, frozen('v1 stores targetHash/targetSummary, not target'))
    assert.equal(properties.targetKind, undefined, frozen('v1 does not store targetKind'))
    assert.equal(
      sha256Tag(canonicalTargetValue({ kind: 'path', value: 'C:\\ws\\out\\report.md' })),
      LEGACY_TARGET_HASH,
      frozen('targetHash canonicalization'),
    )

    assert.equal(properties.time?.minimum, 0, frozen('time is milliseconds since epoch, >= 0'))
    assert.equal(properties.targetHash?.pattern, '^sha256:[a-f0-9]{64}$', frozen('targetHash shape'))
    assert.equal(properties.seq?.minimum, 0, frozen('seq minimum'))
    assert.equal(properties.matcherVersion?.minimum, 1, frozen('matcherVersion minimum'))
    assert.equal(properties.riskPolicyVersion?.minimum, 1, frozen('riskPolicyVersion minimum'))
    for (const field of ['sessionId', 'callId']) {
      assert.equal(properties[field]?.minLength, 1, frozen(`${field} minLength`))
      assert.equal(properties[field]?.maxLength, 256, frozen(`${field} maxLength`))
    }
    assert.equal(properties.tool?.minLength, 1, frozen('tool minLength'))
    assert.equal(properties.tool?.maxLength, 128, frozen('tool maxLength'))
  })

  it('replays and exports a hard-coded v1 record stably', () => {
    const replay = legacyReplay()
    assert.deepEqual(replay.rows, [EXPECTED_LEGACY_ROW], frozen('legacy replay row shape'))
    assert.deepEqual(replay.counts, EXPECTED_LEGACY_COUNTS, frozen('legacy replay counts'))
    assert.deepEqual(replay.issues, [], frozen('legacy replay has no issues'))

    const exported = toAuditJsonExport(replay)
    assert.equal(exported.schemaVersion, 1, frozen('export schemaVersion'))
    assert.equal(
      exported.generatedAt,
      1760000100000,
      frozen('export timestamp is injected, not wall-clock'),
    )
    assert.deepEqual(exported.rows, [EXPECTED_LEGACY_ROW], frozen('exported row'))
    assert.deepEqual(exported.counts, EXPECTED_LEGACY_COUNTS, frozen('exported counts'))
    assert.deepEqual(exported.issues, [], frozen('exported issues'))

    const plan = exported.plans[0]
    assert.equal(plan?.planId, 'P-legacy01', frozen('exported planId'))
    assert.equal(plan?.decision, 'approved', frozen('exported plan decision'))
    assert.equal(plan?.status, 'verified', frozen('exported plan status'))
    assert.deepEqual(
      plan?.items,
      [
        {
          id: 'A',
          tool: 'write',
          risk: 'medium',
          uses: 1,
          status: 'matched',
          callId: 'call-legacy-1',
        },
      ],
      frozen('exported plan items reference callId only'),
    )
    assert.equal(plan?.rows.length, 1, frozen('exported plan rows'))

    const compact = toAuditJson(legacyReplay())
    assert.deepEqual(
      JSON.parse(compact),
      JSON.parse(toAuditJson(legacyReplay())),
      frozen('export is deterministic'),
    )
    assert.equal(compact.includes('C:'), false, frozen('raw targets never enter the export'))
  })

  it('accepts an old v1 record that omits every optional field', () => {
    const validation = validateAuditRecord(LEGACY_MINIMAL_RECORD)
    assert.equal(validation.ok, true, frozen('all v1 optional fields stay optional'))
    if (validation.ok) {
      assert.deepEqual(
        validation.record,
        { ...LEGACY_MINIMAL_RECORD },
        frozen('minimal record round-trips'),
      )
    }

    assert.equal(
      validateAuditRecord({ ...LEGACY_MINIMAL_RECORD, decision: 'allowed-once' }).ok,
      false,
      frozen('v1 keeps the decision in outcome, not decision'),
    )
    assert.equal(
      validateAuditRecord({
        ...LEGACY_MINIMAL_RECORD,
        target: { kind: 'path', value: 'C:\\ws\\a.md' },
      }).ok,
      false,
      frozen('v1 stores targetHash/targetSummary, not a target object'),
    )

    const replay = replayAudit({
      sessionId: 'session-legacy-min',
      facts: [
        {
          type: 'approval/asked',
          callId: 'call-legacy-2',
          toolName: 'pwsh',
          seq: 1,
          time: 1760000000900,
          turn: 1,
        },
        {
          type: 'approval/decided',
          callId: 'call-legacy-2',
          decision: 'rejected',
          seq: 2,
          time: 1760000001000,
          turn: 1,
        },
      ],
      ledger: [LEGACY_MINIMAL_RECORD],
      now: 1760000200000,
    })
    const row = replay.rows[0]
    assert.equal(row?.decision, 'rejected', frozen('decision survives the replay'))
    assert.equal(row?.status, 'unverifiable', frozen('missing optional versions fail closed'))
    assert.ok(
      row?.issues.includes('missing-matcher-version'),
      frozen('missing matcher version is reported'),
    )
    assert.equal(
      toAuditJsonExport(replay).rows.length,
      1,
      frozen('a minimal old row still exports'),
    )
  })

  it('keeps the frozen decision enum aligned across facts, records, and replay', () => {
    for (const outcome of APPROVAL_OUTCOMES) {
      const callId = `call-${outcome}`
      const record = { ...LEGACY_MINIMAL_RECORD, callId, outcome }
      assert.equal(
        validateAuditRecord(record).ok,
        true,
        frozen(`decision ${outcome} validates as outcome`),
      )

      const replay = replayAudit({
        sessionId: 'session-legacy-min',
        facts: [
          { type: 'approval/asked', callId, toolName: 'pwsh', seq: 1, time: 1, turn: 1 },
          { type: 'approval/decided', callId, decision: outcome, seq: 2, time: 2, turn: 1 },
        ],
        ledger: [record],
        now: 3,
      })
      assert.equal(
        replay.rows[0]?.decision,
        outcome,
        frozen(`decision ${outcome} reaches the replay row`),
      )
      assert.equal(
        replay.rows[0]?.status,
        'unverifiable',
        frozen('a row without matcherVersion stays unverifiable'),
      )
      assert.deepEqual(replay.issues, [], frozen(`decision ${outcome} is accepted without issues`))
    }

    assert.equal(
      validateAuditRecord({ ...LEGACY_MINIMAL_RECORD, outcome: 'maybe' }).ok,
      false,
      frozen('unknown decisions are rejected'),
    )
  })
})
