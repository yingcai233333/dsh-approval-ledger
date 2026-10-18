import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DEFAULT_RISK_POLICY, HIGH_RISK_GRANTS_POLICY } from '../src/core/types.js'
import type { RiskPolicy } from '../src/core/types.js'
import { inferGrantKind, matchGrantScope } from '../src/grants/match.js'
import { GrantStore } from '../src/grants/store.js'
import type {
  CreateGrantsContext,
  GrantMatchReason,
  GrantMatchRequest,
  GrantMatchResult,
  GrantSet,
} from '../src/grants/types.js'
import type { PathProbe } from '../src/path/types.js'
import type { ValidatedPlan } from '../src/plan/types.js'
import { validatePlan } from '../src/plan/validate.js'

const CWD = 'C:\\ws'
const KNOWN = new Set(['write', 'edit', 'pwsh', 'delete', 'plugin_manager'])
const PLAN_ID = 'P-11111111'

interface ProbeEntry {
  canonical?: string
  isDirectory?: boolean
}

function fakeProbe(entries: Record<string, ProbeEntry> = {}): PathProbe {
  return {
    realpath(path: string): string | undefined {
      const entry = entries[path]
      if (entry === undefined) return undefined
      return entry.canonical ?? path
    },
    isDirectory(path: string): boolean | undefined {
      return entries[path]?.isDirectory
    },
  }
}

interface PlanOptions {
  policy?: RiskPolicy
  probe?: PathProbe
}

function makePlan(items: readonly unknown[], options: PlanOptions = {}): ValidatedPlan {
  const result = validatePlan(
    { summary: 'grant test plan', items },
    {
      cwd: CWD,
      platform: 'win32',
      knownTools: KNOWN,
      ...(options.policy === undefined ? {} : { policy: options.policy }),
      ...(options.probe === undefined ? {} : { probe: options.probe }),
    },
  )
  if (!result.ok) {
    assert.fail(`plan should validate: ${JSON.stringify(result.errors)}`)
  }
  return result.plan
}

function writeItem(
  id: string,
  path: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return { id, tool: 'write', title: `write ${id}`, scope: { paths: [path] }, ...extra }
}

function commandItem(
  id: string,
  command: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return { id, tool: 'pwsh', title: `run ${id}`, scope: { commands: [command] }, ...extra }
}

function register(
  store: GrantStore,
  plan: ValidatedPlan,
  context: Partial<CreateGrantsContext> = {},
): GrantSet {
  return store.createFromPlan(plan, {
    sessionId: 's1',
    turn: 1,
    planId: PLAN_ID,
    ...context,
  })
}

function request(overrides: Partial<GrantMatchRequest> = {}): GrantMatchRequest {
  return {
    sessionId: 's1',
    turn: 1,
    tool: 'write',
    mode: 'workspace-write',
    args: { path: 'C:\\ws\\out\\report.md' },
    cwd: CWD,
    platform: 'win32',
    ...overrides,
  }
}

function highDirectoryPlan(): ValidatedPlan {
  const probe = fakeProbe({ 'C:\\ws\\out': { isDirectory: true } })
  return makePlan([writeItem('A', 'C:\\ws\\out', { uses: 1 })], {
    probe,
    policy: HIGH_RISK_GRANTS_POLICY,
  })
}

function assertManual(result: GrantMatchResult, reason: GrantMatchReason): void {
  assert.equal(result.decision, 'manual')
  assert.equal(result.reason, reason)
}

describe('grant creation', () => {
  it('creates active grants only for auto-eligible items', () => {
    const plan = makePlan([
      writeItem('A', 'C:\\ws\\out\\report.md'),
      writeItem('B', 'C:\\Windows\\System32\\blocked.txt'),
      { id: 'C', tool: 'write', title: 'no scope' },
    ])
    const store = new GrantStore()
    const set = register(store, plan)

    assert.deepEqual(set.auto, ['A'])
    assert.deepEqual(set.blocked, [])
    assert.deepEqual(set.manual, ['B', 'C'])
    assert.deepEqual(
      set.grants.map((grant) => grant.itemId),
      ['A'],
    )
    assert.equal(set.items.find((item) => item.itemId === 'A')?.state, 'active')
    assert.equal(set.items.find((item) => item.itemId === 'A')?.usesLeft, 1)
    assert.equal(set.items.find((item) => item.itemId === 'B')?.state, 'manual')
    assert.equal(set.items.find((item) => item.itemId === 'B')?.usesLeft, 0)
    assert.equal(set.items.find((item) => item.itemId === 'C')?.state, 'manual')
  })

  it('derives an opaque plan id from the plan hash when omitted', () => {
    const plan = makePlan([writeItem('A', 'C:\\ws\\out\\a.md')])
    const store = new GrantStore()
    const set = store.createFromPlan(plan, { sessionId: 's1', turn: 1 })

    assert.match(set.planId, /^P-[a-f0-9]{8}$/)
    assert.equal(set.planId, `P-${plan.planHash.slice(7, 15)}`)
  })

  it('does not mutate the store when a plan id is reused', () => {
    const plan = makePlan([writeItem('A', 'C:\\ws\\out\\a.md')])
    const store = new GrantStore()
    register(store, plan)

    assert.throws(() => register(store, plan), /already registered/)
    assert.equal(store.listGrants('s1').length, 1)
  })

  it('rejects malformed creation contexts without creating grants', () => {
    const plan = makePlan([writeItem('A', 'C:\\ws\\out\\a.md')])
    const store = new GrantStore()

    assert.throws(() => store.createFromPlan(plan, { sessionId: '', turn: 1 }))
    assert.throws(() => store.createFromPlan(plan, { sessionId: 's1', turn: 1.5 }))
    assert.deepEqual(store.listGrants('s1'), [])
  })
})

describe('plan gate', () => {
  it('allows a medium data write once, then reports exhaustion', () => {
    const plan = makePlan([writeItem('A', 'C:\\ws\\out\\report.md')])
    const store = new GrantStore()
    register(store, plan)

    const first = store.match(request())
    assert.equal(first.decision, 'allowed-once')
    assert.equal(first.reason, 'allowed')
    assert.deepEqual(first.grant, { planId: PLAN_ID, itemId: 'A', usesLeft: 0 })
    assert.equal(first.risk?.level, 'medium')
    assert.equal(store.getGrant('s1', PLAN_ID, 'A')?.state, 'exhausted')

    const second = store.match(request())
    assertManual(second, 'grant-exhausted')
    assert.equal(store.getGrant('s1', PLAN_ID, 'A')?.usesLeft, 0)
  })

  it('consumes exactly one use per successful match', () => {
    const plan = makePlan([writeItem('A', 'C:\\ws\\out\\a.md', { uses: 3 })])
    const store = new GrantStore()
    register(store, plan)

    for (const expected of [2, 1, 0]) {
      const result = store.match(request({ args: { path: 'C:\\ws\\out\\a.md' } }))
      assert.equal(result.decision, 'allowed-once')
      assert.equal(result.grant?.usesLeft, expected)
    }

    assertManual(store.match(request({ args: { path: 'C:\\ws\\out\\a.md' } })), 'grant-exhausted')
  })

  it('rejects wrong session, turn, tool, kind, and mode without consuming', () => {
    const plan = makePlan([
      writeItem('A', 'C:\\ws\\out\\report.md', {
        uses: 2,
        mode: 'workspace-write',
      }),
    ])
    const store = new GrantStore()
    register(store, plan)

    const wrong: ReadonlyArray<[string, GrantMatchRequest, GrantMatchReason]> = [
      ['session', request({ sessionId: 's2' }), 'no-grant'],
      ['turn', request({ turn: 2 }), 'turn-mismatch'],
      ['tool', request({ tool: 'edit' }), 'tool-mismatch'],
      ['kind', request({ kind: 'command' }), 'kind-mismatch'],
      ['mode', request({ mode: 'read-only' }), 'mode-mismatch'],
      ['missing mode', request({ mode: undefined }), 'mode-mismatch'],
    ]
    for (const [label, candidate, reason] of wrong) {
      const result = store.match(candidate)
      assert.equal(result.decision, 'manual', label)
      assert.equal(result.reason, reason, label)
    }
    assert.equal(store.getGrant('s1', PLAN_ID, 'A')?.usesLeft, 2)

    const allowed = store.match(request())
    assert.equal(allowed.decision, 'allowed-once')
    assert.equal(allowed.grant?.usesLeft, 1)
  })
})

describe('path scope', () => {
  it('matches an exact file case-insensitively and rejects a sibling', () => {
    const plan = makePlan([writeItem('A', 'C:\\ws\\out\\Report.MD')])
    const scope = plan.items[0]?.scope
    assert.ok(scope)
    assert.equal(inferGrantKind(scope), 'path')

    const exact = matchGrantScope(scope, {
      args: { path: 'c:/WS/out/report.md' },
      platform: 'win32',
      cwd: CWD,
    })
    assert.equal(exact.matched, true)

    const sibling = matchGrantScope(scope, {
      args: { path: 'C:\\ws\\out\\other.md' },
      platform: 'win32',
      cwd: CWD,
    })
    assert.equal(sibling.matched, false)
    assert.equal(sibling.reason, 'path-not-in-scope')
  })

  it('contains descendants only when the approved path was observed as a directory', () => {
    const probe = fakeProbe({ 'C:\\ws\\out': { isDirectory: true } })
    const directoryPlan = makePlan([writeItem('A', 'C:\\ws\\out')], { probe })
    const directoryScope = directoryPlan.items[0]?.scope
    assert.ok(directoryScope)
    assert.equal(directoryScope.paths[0]?.isDirectory, true)

    const child = matchGrantScope(directoryScope, {
      args: { path: 'C:\\ws\\out\\nested\\a.md' },
      platform: 'win32',
      cwd: CWD,
    })
    assert.equal(child.matched, true)

    // No probe => no directory observation => exact match only.
    const lexicalPlan = makePlan([writeItem('A', 'C:\\ws\\out')])
    const lexicalScope = lexicalPlan.items[0]?.scope
    assert.ok(lexicalScope)
    const lexicalChild = matchGrantScope(lexicalScope, {
      args: { path: 'C:\\ws\\out\\nested\\a.md' },
      platform: 'win32',
      cwd: CWD,
    })
    assert.equal(lexicalChild.matched, false)
  })

  it('matches a directory grant for a child call in the store', () => {
    const plan = highDirectoryPlan()
    const store = new GrantStore({ policy: HIGH_RISK_GRANTS_POLICY })
    const set = register(store, plan)
    assert.equal(set.items[0]?.state, 'active')

    const result = store.match(request({ args: { path: 'C:\\ws\\out\\nested\\a.md' } }))
    assert.equal(result.decision, 'allowed-once')
    assert.equal(result.risk?.level, 'medium')
  })

  it('rejects a sibling path in the store without consuming', () => {
    const plan = makePlan([writeItem('A', 'C:\\ws\\out\\report.md')])
    const store = new GrantStore()
    register(store, plan)

    const result = store.match(request({ args: { path: 'C:\\ws\\out\\other.md' } }))
    assertManual(result, 'scope-mismatch')
    assert.equal(result.detail, 'path-not-in-scope')
    assert.equal(store.getGrant('s1', PLAN_ID, 'A')?.usesLeft, 1)
  })
})

describe('command scope', () => {
  it('matches an exact command and rejects different or unsafe commands', () => {
    const plan = makePlan([commandItem('C', 'git status', { uses: 3 })], {
      policy: HIGH_RISK_GRANTS_POLICY,
    })
    const store = new GrantStore({ policy: HIGH_RISK_GRANTS_POLICY })
    const set = register(store, plan)
    assert.deepEqual(set.auto, ['C'])
    assert.equal(set.items[0]?.kind, 'command')

    const commandRequest = (
      command: string,
      extra: Partial<GrantMatchRequest> = {},
    ): GrantMatchRequest =>
      request({
        tool: 'pwsh',
        args: { command },
        mode: 'workspace-write',
        confirmedHighRisk: true,
        ...extra,
      })

    const allowed = store.match(commandRequest('git status'))
    assert.equal(allowed.decision, 'allowed-once')
    assert.equal(allowed.risk?.level, 'high')

    const different = store.match(commandRequest('git status --short'))
    assertManual(different, 'scope-mismatch')
    assert.equal(different.detail, 'command-not-in-scope')

    const unsafe = store.match(commandRequest('git status && whoami'))
    assertManual(unsafe, 'scope-mismatch')
    assert.equal(unsafe.detail, 'command-not-in-scope')

    assert.equal(store.getGrant('s1', PLAN_ID, 'C')?.usesLeft, 2)
  })
})

describe('args scope', () => {
  it('matches a subset and compares arrays exactly', () => {
    const plan = makePlan([
      {
        id: 'A',
        tool: 'write',
        title: 'args scope',
        uses: 2,
        scope: { args: { path: 'C:\\ws\\out\\data.json', tags: ['a'] } },
      },
    ])
    const store = new GrantStore()
    const set = register(store, plan)
    assert.equal(set.items[0]?.kind, 'args')

    const subset = store.match(
      request({
        args: { path: 'C:\\ws\\out\\data.json', tags: ['a'], extra: true },
      }),
    )
    assert.equal(subset.decision, 'allowed-once')
    assert.equal(store.getGrant('s1', PLAN_ID, 'A')?.usesLeft, 1)

    const widerArray = store.match(
      request({
        args: { path: 'C:\\ws\\out\\data.json', tags: ['a', 'b'] },
      }),
    )
    assertManual(widerArray, 'scope-mismatch')
    assert.equal(widerArray.detail, 'args-not-in-scope')
    assert.equal(store.getGrant('s1', PLAN_ID, 'A')?.usesLeft, 1)
  })
})

describe('dependency gating', () => {
  it('does not ready a dependent item until every dependency use is consumed', () => {
    const plan = makePlan([
      writeItem('A', 'C:\\ws\\a.md', { uses: 2 }),
      writeItem('B', 'C:\\ws\\b.md', { dependsOn: ['A'] }),
    ])
    const store = new GrantStore()
    const set = register(store, plan)

    assert.deepEqual(set.auto, ['A', 'B'])
    assert.equal(set.items.find((item) => item.itemId === 'B')?.stage, 1)

    const requestA = request({ args: { path: 'C:\\ws\\a.md' } })
    const requestB = request({ args: { path: 'C:\\ws\\b.md' } })

    assertManual(store.match(requestB), 'dependencies-not-ready')

    assert.equal(store.match(requestA).decision, 'allowed-once')
    assertManual(store.match(requestB), 'dependencies-not-ready')

    assert.equal(store.match(requestA).decision, 'allowed-once')
    assert.equal(store.match(requestB).decision, 'allowed-once')
  })

  it('never activates a dependent of a manual item, transitively', () => {
    const plan = makePlan([
      writeItem('A', 'C:\\Windows\\System32\\x.txt'),
      writeItem('B', 'C:\\ws\\b.md', { dependsOn: ['A'] }),
      writeItem('C', 'C:\\ws\\c.md', { dependsOn: ['B'] }),
    ])
    const store = new GrantStore()
    const set = register(store, plan)

    assert.deepEqual(set.auto, [])
    assert.deepEqual(set.grants, [])
    assert.deepEqual(set.manual, ['A'])
    assert.deepEqual(set.blocked, ['B', 'C'])

    assertManual(store.match(request({ args: { path: 'C:\\Windows\\System32\\x.txt' } })), 'grant-manual')
    assertManual(store.match(request({ args: { path: 'C:\\ws\\b.md' } })), 'grant-blocked-by-manual')
    assertManual(store.match(request({ args: { path: 'C:\\ws\\c.md' } })), 'grant-blocked-by-manual')
  })
})

describe('risk gate', () => {
  it('keeps high risk manual by default', () => {
    const plan = highDirectoryPlan()
    const store = new GrantStore()
    register(store, plan)

    const result = store.match(request({ args: { path: 'C:\\ws\\out\\script.ps1' } }))
    assertManual(result, 'risk-high-disabled')
    assert.equal(result.risk?.level, 'high')
    assert.equal(result.grant?.usesLeft, 1)
    assert.equal(store.getGrant('s1', PLAN_ID, 'A')?.usesLeft, 1)
  })

  it('requires a second confirmation when high-risk grants are enabled', () => {
    const plan = highDirectoryPlan()
    const store = new GrantStore({ policy: HIGH_RISK_GRANTS_POLICY })
    register(store, plan)

    const pending = store.match(request({ args: { path: 'C:\\ws\\out\\script.ps1' } }))
    assert.equal(pending.decision, 'needs-confirmation')
    assert.equal(pending.reason, 'risk-needs-confirmation')
    assert.equal(store.getGrant('s1', PLAN_ID, 'A')?.usesLeft, 1)

    const allowed = store.match(
      request({ args: { path: 'C:\\ws\\out\\script.ps1' }, confirmedHighRisk: true }),
    )
    assert.equal(allowed.decision, 'allowed-once')
    assert.equal(allowed.grant?.usesLeft, 0)
  })

  it('never allows critical risk, even with confirmation', () => {
    const probe = fakeProbe({ 'C:\\ws': { isDirectory: true } })
    const plan = makePlan([writeItem('A', 'C:\\ws', { uses: 1 })], {
      probe,
      policy: HIGH_RISK_GRANTS_POLICY,
    })
    const store = new GrantStore({ policy: HIGH_RISK_GRANTS_POLICY })
    register(store, plan)

    const result = store.match(
      request({ args: { path: 'C:\\ws\\.env' }, confirmedHighRisk: true }),
    )
    assertManual(result, 'risk-critical')
    assert.equal(result.risk?.level, 'critical')
    assert.equal(store.getGrant('s1', PLAN_ID, 'A')?.usesLeft, 1)
  })

  it('never allows unknown risk, even with confirmation', () => {
    const plan = highDirectoryPlan()
    const store = new GrantStore({ policy: HIGH_RISK_GRANTS_POLICY })
    register(store, plan)

    const result = store.match(
      request({ args: { path: 'C:\\ws\\out\\data.zzz' }, confirmedHighRisk: true }),
    )
    assertManual(result, 'risk-unknown')
    assert.equal(result.risk?.level, 'unknown')
    assert.equal(store.getGrant('s1', PLAN_ID, 'A')?.usesLeft, 1)
  })

  it('respects a policy that removes medium from auto levels', () => {
    const policy: RiskPolicy = { ...DEFAULT_RISK_POLICY, autoLevels: ['low'] }
    const plan = makePlan([writeItem('A', 'C:\\ws\\out\\a.md')])
    const store = new GrantStore({ policy })
    register(store, plan)

    const result = store.match(request({ args: { path: 'C:\\ws\\out\\a.md' } }))
    assertManual(result, 'risk-not-auto')
    assert.equal(result.risk?.level, 'medium')
  })
})

describe('observe mode', () => {
  it('returns would-allow and consumes uses instead of allowing', () => {
    const plan = makePlan([writeItem('A', 'C:\\ws\\out\\report.md', { uses: 2 })])
    const store = new GrantStore({ observe: true })
    register(store, plan)
    assert.equal(store.mode, 'observe')

    const first = store.match(request())
    assert.equal(first.decision, 'would-allow')
    assert.notEqual(first.decision, 'allowed-once')
    assert.equal(first.grant?.usesLeft, 1)

    const second = store.match(request())
    assert.equal(second.decision, 'would-allow')
    assert.equal(second.grant?.usesLeft, 0)

    assertManual(store.match(request()), 'grant-exhausted')
  })

  it('honours per-call observe and never lets a request disable store observe', () => {
    const plan = makePlan([writeItem('A', 'C:\\ws\\out\\report.md', { uses: 2 })])

    const active = new GrantStore()
    register(active, plan)
    assert.equal(active.match(request({ observe: true })).decision, 'would-allow')

    const observing = new GrantStore({ mode: 'observe' })
    register(observing, plan)
    assert.equal(observing.match(request({ observe: false })).decision, 'would-allow')
  })

  it('switches to observe with setMode', () => {
    const plan = makePlan([writeItem('A', 'C:\\ws\\out\\a.md')])
    const store = new GrantStore()
    register(store, plan)
    assert.equal(store.mode, 'active')

    store.setMode('observe')
    assert.equal(store.mode, 'observe')
    assert.equal(
      store.match(request({ args: { path: 'C:\\ws\\out\\a.md' } })).decision,
      'would-allow',
    )

    store.setMode('active')
    assert.equal(store.mode, 'active')
  })

  it('keeps needs-confirmation as a separate decision in observe mode', () => {
    const plan = highDirectoryPlan()
    const store = new GrantStore({
      policy: HIGH_RISK_GRANTS_POLICY,
      mode: 'observe',
    })
    register(store, plan)

    const pending = store.match(request({ args: { path: 'C:\\ws\\out\\script.ps1' } }))
    assert.equal(pending.decision, 'needs-confirmation')

    const confirmed = store.match(
      request({ args: { path: 'C:\\ws\\out\\script.ps1' }, confirmedHighRisk: true }),
    )
    assert.equal(confirmed.decision, 'would-allow')
  })
})

describe('revocation', () => {
  it('revokes only the ended turn', () => {
    const plan = makePlan([writeItem('A', 'C:\\ws\\out\\a.md')])
    const store = new GrantStore()
    register(store, plan, { turn: 1 })
    register(store, plan, { turn: 2 })

    assert.equal(store.revokeTurn('s1', 1), 1)
    assert.equal(store.getGrant('s1', PLAN_ID, 'A', 1), undefined)
    assertManual(store.match(request({ turn: 1 })), 'turn-mismatch')

    const secondTurn = store.match(
      request({ turn: 2, args: { path: 'C:\\ws\\out\\a.md' } }),
    )
    assert.equal(secondTurn.decision, 'allowed-once')
  })

  it('does not consume a grant revoked during matching', () => {
    const plan = makePlan([writeItem('A', 'C:\\ws\\out\\a.md')])
    const store = new GrantStore()
    register(store, plan)

    let revoked = false
    const probe: PathProbe = {
      realpath(): string | undefined {
        return undefined
      },
      isDirectory(): boolean | undefined {
        if (!revoked) {
          revoked = true
          store.revokeTurn('s1', 1)
        }
        return undefined
      },
    }

    const result = store.match(
      request({ args: { path: 'C:\\ws\\out\\a.md' }, probe }),
    )
    assertManual(result, 'grant-revoked')
    assert.deepEqual(store.listGrants('s1'), [])
  })

  it('revokes a whole session', () => {
    const plan = makePlan([writeItem('A', 'C:\\ws\\out\\a.md')])
    const store = new GrantStore()
    register(store, plan)

    assert.equal(store.revokeSession('s1'), 1)
    assertManual(store.match(request()), 'no-grant')
    assert.deepEqual(store.listGrants('s1'), [])
  })

  it('disposes the store and rejects new plans', () => {
    const plan = makePlan([writeItem('A', 'C:\\ws\\out\\a.md')])
    const store = new GrantStore()
    register(store, plan)

    assert.equal(store.dispose(), 1)
    assertManual(store.match(request()), 'store-disposed')
    assert.throws(() => register(store, plan), /disposed/)
    assert.deepEqual(store.listGrants('s1'), [])
  })

  it('keeps sessions isolated', () => {
    const plan = makePlan([writeItem('A', 'C:\\ws\\out\\a.md')])
    const store = new GrantStore()
    register(store, plan, { sessionId: 's1' })

    assertManual(store.match(request({ sessionId: 's2' })), 'no-grant')
    assert.deepEqual(store.listGrants('s2'), [])
  })
})

describe('fail closed', () => {
  it('returns manual for malformed requests', () => {
    const plan = makePlan([writeItem('A', 'C:\\ws\\out\\a.md')])
    const store = new GrantStore()
    register(store, plan)

    for (const bad of [null, undefined, {}, { sessionId: 's1', turn: 1 }]) {
      const result = store.match(bad as unknown as GrantMatchRequest)
      assert.equal(result.decision, 'manual')
      assert.equal(result.reason, 'invalid-request')
    }

    const wrongConfirm = store.match(
      request({ confirmedHighRisk: 1 as unknown as boolean }),
    )
    assertManual(wrongConfirm, 'invalid-request')
    assert.equal(store.getGrant('s1', PLAN_ID, 'A')?.usesLeft, 1)
  })

  it('returns manual when request inspection throws', () => {
    const plan = makePlan([writeItem('A', 'C:\\ws\\out\\a.md')])
    const store = new GrantStore()
    register(store, plan)

    const hostile = { ...request() }
    Object.defineProperty(hostile, 'tool', {
      get() {
        throw new Error('boom')
      },
    })
    assertManual(store.match(hostile), 'internal-error')
  })

  it('returns manual when the risk assessment cannot read the actual args', () => {
    const plan = makePlan([writeItem('A', 'C:\\ws\\out\\report.md')])
    const store = new GrantStore()
    register(store, plan)

    let reads = 0
    const args: Record<string, unknown> = {}
    Object.defineProperty(args, 'path', {
      enumerable: true,
      configurable: true,
      get() {
        reads += 1
        if (reads > 1) throw new Error('boom')
        return 'C:\\ws\\out\\report.md'
      },
    })

    const result = store.match(request({ args }))
    assertManual(result, 'risk-unknown')
    assert.equal(result.risk?.level, 'unknown')
    assert.equal(store.getGrant('s1', PLAN_ID, 'A')?.usesLeft, 1)
  })

  it('rejects re-entrant matching and consumes only one use', () => {
    const plan = makePlan([writeItem('A', 'C:\\ws\\out\\a.md', { uses: 1 })])
    const store = new GrantStore()
    register(store, plan)

    let inner: GrantMatchResult | undefined
    let reentered = false
    const probe: PathProbe = {
      realpath(): string | undefined {
        return undefined
      },
      isDirectory(): boolean | undefined {
        if (!reentered) {
          reentered = true
          inner = store.match(request({ args: { path: 'C:\\ws\\out\\a.md' }, probe }))
        }
        return undefined
      },
    }

    const outer = store.match(request({ args: { path: 'C:\\ws\\out\\a.md' }, probe }))
    assert.equal(reentered, true)
    assert.ok(inner)
    assertManual(inner, 'reentrant')
    assert.equal(outer.decision, 'allowed-once')
    assert.equal(store.getGrant('s1', PLAN_ID, 'A')?.usesLeft, 0)
  })
})
