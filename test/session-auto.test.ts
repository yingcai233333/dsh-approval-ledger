import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { apply } from '../src/index.js'
import { sanitizeConfig } from '../src/config.js'
import { hasDeleteIntent, DELETE_INTENT_MAX_LENGTH } from '../src/grants/delete-intent.js'
import { SessionAutoAllow } from '../src/grants/session-auto.js'
import { createRuntime, registerApprovalHook } from '../src/plugin/runtime.js'
import type {
  ApprovalOutcome,
  Context,
  Session,
  SessionEvent,
} from '../src/types/dsh-runtime.js'
import {
  FakeContext,
  makeAgent,
  makeEvent,
  makeSession,
} from './helpers/fake-context.js'

const IS_WIN = process.platform === 'win32'
const REPORT = IS_WIN ? 'C:\\ws\\out\\report.md' : '/ws/out/report.md'
const SCRIPT = IS_WIN ? 'C:\\ws\\out\\script.ps1' : '/ws/out/script.ps1'

interface Harness {
  ctx: FakeContext
  session: Session
  agent: ReturnType<typeof makeAgent>
  events: SessionEvent[]
}

function setup(config: Record<string, unknown> = {}): Harness {
  const ctx = new FakeContext()
  apply(ctx as unknown as Context, { mode: 'active', notifications: false, ...config })
  const events: SessionEvent[] = [makeEvent(1, 'turn/start', { turn: 1 })]
  const session = makeSession('session-auto', events)
  const agent = makeAgent(session)
  return { ctx, session, agent, events }
}

function runApprovals(ctx: FakeContext, agent: ReturnType<typeof makeAgent>, rawInput: string) {
  return ctx.runCommand('approvals', {
    commandId: `cmd-${rawInput.replace(/\s+/g, '-')}`,
    agent,
    rawInput,
    attachments: [],
    signal: new AbortController().signal,
  })
}

function auditRows(
  ctx: FakeContext,
  agent: ReturnType<typeof makeAgent>,
): Array<{ callId?: string; matchedBy?: string; decision?: string }> {
  const result = runApprovals(ctx, agent, 'audit --json')
  assert.equal(result.kind, 'success')
  if (result.kind !== 'success') throw new Error('audit failed')
  const parsed = JSON.parse(result.text ?? '{}') as {
    rows?: Array<{ callId?: string; matchedBy?: string; decision?: string }>
  }
  return parsed.rows ?? []
}

function rowFor(
  rows: Array<{ callId?: string; matchedBy?: string; decision?: string }>,
  callId: string,
): { callId?: string; matchedBy?: string; decision?: string } | undefined {
  return rows.find((row) => row.callId === callId)
}

interface CallInput {
  seq: number
  callId: string
  tool: string
  args: unknown
  reason?: string
}

async function callApproval(
  harness: Harness,
  input: CallInput,
  fallback: ApprovalOutcome = 'rejected',
): Promise<ApprovalOutcome> {
  const { ctx, agent, events } = harness
  events.push(
    makeEvent(input.seq, 'tool/call', {
      turn: 1,
      step: 1,
      callId: input.callId,
      name: input.tool,
      arguments: JSON.stringify(input.args),
    }),
  )
  events.push(
    makeEvent(input.seq + 1, 'approval/asked', {
      id: `ask-${input.callId}`,
      toolName: input.tool,
      callId: input.callId,
    }),
  )
  const request = {
    agent,
    toolName: input.tool,
    callId: input.callId,
    reason: input.reason,
    displayReason: { en: 'old', zh: '旧' },
  }
  const outcome = await ctx.emitApproval(request, fallback)
  events.push(
    makeEvent(input.seq + 2, 'approval/decided', {
      id: `ask-${input.callId}`,
      outcome,
    }),
  )
  return outcome
}

describe('session auto-allow state', () => {
  it('tracks an explicit on/off choice for one session only', () => {
    const auto = new SessionAutoAllow()
    assert.equal(auto.isEnabled('s1'), false)
    assert.equal(auto.enable('s1'), true)
    assert.equal(auto.isEnabled('s1'), true)
    assert.equal(auto.hasOverride('s1'), true)
    assert.equal(auto.isEnabled('s2'), false)
    assert.deepEqual(auto.list(), ['s1'])

    assert.equal(auto.disable('s1'), true)
    assert.equal(auto.isEnabled('s1'), false)
    assert.equal(auto.hasOverride('s1'), true, 'explicit off is kept')
    assert.deepEqual(auto.list(), [])
    assert.equal(auto.enable('s1'), true, 'an explicit off can be switched back on')
    assert.equal(auto.isEnabled('s1'), true)
  })

  it('snapshots the config default at first sight and keeps a running session stable', () => {
    const auto = new SessionAutoAllow()
    assert.equal(auto.ensure('old', false), true)
    assert.equal(auto.ensure('new', true), true)
    assert.equal(auto.ensure('new', false), false, 'an existing snapshot is never overwritten')

    // A settings change after startup must not flip the running session.
    assert.equal(auto.isEnabled('old', true), false)
    assert.equal(auto.isEnabled('new', false), true)

    auto.disable('new')
    assert.equal(auto.isEnabled('new'), false)
    auto.forget('new')
    assert.equal(auto.isEnabled('new', true), true, 'forget falls back to the caller default')
  })

  it('evicts the oldest session beyond the capacity', () => {
    const auto = new SessionAutoAllow()
    for (let index = 0; index <= 64; index += 1) auto.enable(`s${index}`)
    assert.equal(auto.size, 64)
    assert.equal(auto.isEnabled('s0'), false)
    assert.equal(auto.isEnabled('s64'), true)
    assert.equal(auto.list().length, 64)
    assert.deepEqual(auto.list().slice(0, 2), ['s1', 's2'])

    const small = new SessionAutoAllow({ capacity: 2 })
    small.enable('a')
    small.enable('b')
    small.enable('c')
    assert.deepEqual(small.list(), ['b', 'c'])
  })

  it('forgets one session and clears everything on dispose', () => {
    const auto = new SessionAutoAllow()
    auto.enable('a')
    auto.enable('b')
    assert.equal(auto.forget('a'), true)
    assert.equal(auto.forget('a'), false)
    assert.deepEqual(auto.list(), ['b'])
    auto.clear()
    assert.equal(auto.size, 0)
    assert.deepEqual(auto.list(), [])
  })
})

describe('delete intent detection', () => {
  it('treats delete tools as deletion regardless of arguments', () => {
    for (const tool of ['delete', 'remove', 'trash', ' DELETE ']) {
      assert.equal(hasDeleteIntent(tool, undefined), true, tool)
    }
  })

  it('finds delete features in serialized arguments, case-insensitively', () => {
    for (const args of [
      { path: REPORT, content: 'rm -rf /' },
      { path: REPORT, content: 'RMDIR C:\\ws' },
      { path: REPORT, content: 'rd /s /q x' },
      { path: REPORT, content: 'del x.txt' },
      { path: REPORT, content: 'erase x.txt' },
      { path: REPORT, content: 'unlink x' },
      { path: REPORT, content: 'Remove-Item -Recurse x' },
      { path: REPORT, content: 'trash x' },
      { path: REPORT, content: 'rimraf dist' },
      { command: 'git clean -fd' },
      { command: 'find . -name x -delete' },
      { source: 'collection.delete({ id: 1 })' },
      { command: 'python -c "shutil.rmtree(\'build\')"' },
      { command: 'os.remove("x")' },
      { command: 'fs.rm("x")' },
    ]) {
      assert.equal(hasDeleteIntent('write', args), true, JSON.stringify(args))
    }
  })

  it('does not flag ordinary requests', () => {
    for (const [tool, args] of [
      ['write', { path: REPORT, content: 'hello world' }],
      ['read', { path: REPORT }],
      ['pwsh', { command: 'npm test' }],
      ['write', { path: IS_WIN ? 'C:\\ws\\src\\model.ts' : '/ws/src/model.ts' }],
    ] as const) {
      assert.equal(hasDeleteIntent(tool, args), false, tool)
    }
  })

  it('treats an absent payload as unscannable, so it stays manual', () => {
    assert.equal(hasDeleteIntent('write', undefined), true)
    assert.equal(hasDeleteIntent('pwsh', undefined), true)
  })

  it('fails closed when it cannot scan the whole payload', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    assert.equal(hasDeleteIntent('write', circular), true)

    assert.equal(hasDeleteIntent('write', { value: 1n }), true)
    assert.equal(
      hasDeleteIntent('write', { content: 'a'.repeat(DELETE_INTENT_MAX_LENGTH) }),
      true,
      'an oversized payload could hide a delete after the cut-off',
    )
    assert.equal(
      hasDeleteIntent('write', {
        payload: {
          toJSON() {
            throw new Error('boom')
          },
        },
      }),
      true,
    )
  })
})

describe('/approvals auto', () => {
  it('reports the switch, source, mode, and exemptions', () => {
    const { ctx, agent } = setup()
    const off = runApprovals(ctx, agent, 'auto')
    assert.equal(off.kind, 'success')
    if (off.kind === 'success') {
      assert.match(off.text ?? '', /会话级自动放行：已关闭/)
      assert.match(off.text ?? '', /默认（配置：关）/)
      assert.match(off.text ?? '', /当前模式：active/)
      assert.match(off.text ?? '', /删除/)
      assert.match(off.text ?? '', /critical/)
      assert.match(off.text ?? '', /unknown/)
    }

    const on = runApprovals(ctx, agent, 'auto on')
    assert.equal(on.kind, 'success')
    if (on.kind === 'success') {
      assert.match(on.text ?? '', /会话级自动放行：已开启/)
      assert.match(on.text ?? '', /本会话显式：开/)
    }

    const explicitOff = runApprovals(ctx, agent, 'auto off')
    assert.equal(explicitOff.kind, 'success')
    if (explicitOff.kind === 'success') {
      assert.match(explicitOff.text ?? '', /本会话显式：关/)
    }
  })

  it('normalizes whitespace and rejects unknown subcommands', () => {
    const { ctx, agent } = setup()
    const spaced = runApprovals(ctx, agent, '  auto   on ')
    assert.equal(spaced.kind, 'success')
    const unknown = runApprovals(ctx, agent, 'auto maybe')
    assert.equal(unknown.kind, 'error')
    if (unknown.kind === 'error') assert.match(unknown.text, /用法/)
  })

  it('refuses to enable in observe mode', () => {
    const { ctx, agent } = setup({ mode: 'observe' })
    const rejected = runApprovals(ctx, agent, 'auto on')
    assert.equal(rejected.kind, 'error')
    if (rejected.kind === 'error') assert.match(rejected.text, /观察模式不放行/)

    const status = runApprovals(ctx, agent, 'auto')
    assert.equal(status.kind, 'success')
    if (status.kind === 'success') {
      assert.match(status.text ?? '', /已关闭/)
      assert.match(status.text ?? '', /观察模式不放行/)
    }
  })
})

interface PtcDispatchInput {
  seq: number
  callId: string
  tool: string
  args: unknown
  /** Push the dispatch only into the log, without observing it live. */
  historyOnly?: boolean
}

/**
 * A PTC inner call: the session log carries `tool/ptc-dispatch-start` with the
 * real `arguments`, and no `tool/call` for the `subCallId` at all — exactly the
 * shape that used to leave `prepareApproval` with `args === undefined`.
 */
async function callApprovalViaPtc(
  harness: Harness,
  input: PtcDispatchInput,
  fallback: ApprovalOutcome = 'rejected',
): Promise<ApprovalOutcome> {
  const { ctx, agent, session, events } = harness
  const dispatch = makeEvent(input.seq, 'tool/ptc-dispatch-start', {
    rootCallId: 'call_root',
    parentCallId: 'call_root',
    subCallId: input.callId,
    name: input.tool,
    arguments: input.args,
  })
  events.push(dispatch)
  if (input.historyOnly !== true) ctx.emitSessionEvent(session, dispatch)
  events.push(
    makeEvent(input.seq + 1, 'approval/asked', {
      id: `ask-${input.callId}`,
      toolName: input.tool,
      callId: input.callId,
    }),
  )
  const outcome = await ctx.emitApproval(
    {
      agent,
      toolName: input.tool,
      callId: input.callId,
      displayReason: { en: 'old', zh: '旧' },
    },
    fallback,
  )
  events.push(
    makeEvent(input.seq + 2, 'approval/decided', { id: `ask-${input.callId}`, outcome }),
  )
  return outcome
}

describe('session auto-allow integration', () => {
  it('auto-allows a medium write once enabled and records the matchedBy code', async () => {
    const harness = setup()
    runApprovals(harness.ctx, harness.agent, 'auto on')
    const outcome = await callApproval(harness, {
      seq: 10,
      callId: 'write-medium',
      tool: 'write',
      args: { path: REPORT },
    })
    assert.equal(outcome, 'allowed-once')
    const row = rowFor(auditRows(harness.ctx, harness.agent), 'write-medium')
    assert.equal(row?.matchedBy, 'session-scope+risk-gate')
    assert.equal(row?.decision, 'allowed-once')
  })

  it('also auto-allows high risk, but never critical or unknown', async () => {
    const harness = setup()
    runApprovals(harness.ctx, harness.agent, 'auto on')

    const high = await callApproval(harness, {
      seq: 20,
      callId: 'write-high',
      tool: 'write',
      args: { path: SCRIPT },
    })
    assert.equal(high, 'allowed-once')

    const critical = await callApproval(harness, {
      seq: 23,
      callId: 'write-critical',
      tool: 'write',
      args: { path: IS_WIN ? 'C:\\Windows\\System32\\x.txt' : '/etc/x.txt' },
    })
    assert.equal(critical, 'rejected')

    const unknown = await callApproval(harness, {
      seq: 26,
      callId: 'mystery-call',
      tool: 'mystery_tool',
      args: { path: REPORT },
    })
    assert.equal(unknown, 'rejected')

    const rows = auditRows(harness.ctx, harness.agent)
    assert.equal(rowFor(rows, 'write-high')?.matchedBy, 'session-scope+risk-gate')
    assert.notEqual(rowFor(rows, 'write-critical')?.matchedBy, 'session-scope+risk-gate')
    assert.notEqual(rowFor(rows, 'mystery-call')?.matchedBy, 'session-scope+risk-gate')
  })

  it('always sends deletes to the official card and records the delete exemption', async () => {
    const harness = setup()
    runApprovals(harness.ctx, harness.agent, 'auto on')

    // A delete tool has delete intent by name.
    const deleteTool = await callApproval(harness, {
      seq: 30,
      callId: 'delete-tool',
      tool: 'delete',
      args: { path: REPORT },
    })
    assert.equal(deleteTool, 'rejected')

    // A command tool hides the delete in its arguments.
    const deleteCommand = await callApproval(harness, {
      seq: 33,
      callId: 'delete-command',
      tool: 'pwsh',
      args: { command: IS_WIN ? `rm ${REPORT}` : `rm ${REPORT}` },
    })
    assert.equal(deleteCommand, 'rejected')

    // Even a critical recursive delete stays manual, with the same code.
    const recursive = await callApproval(harness, {
      seq: 36,
      callId: 'delete-recursive',
      tool: 'pwsh',
      args: { command: IS_WIN ? 'rm -rf C:\\ws' : 'rm -rf /ws' },
    })
    assert.equal(recursive, 'rejected')

    const rows = auditRows(harness.ctx, harness.agent)
    for (const callId of ['delete-tool', 'delete-command', 'delete-recursive']) {
      assert.equal(rowFor(rows, callId)?.matchedBy, 'session-auto-delete-blocked', callId)
    }
  })

  it('blocks a delete hidden in write arguments too', async () => {
    const harness = setup()
    runApprovals(harness.ctx, harness.agent, 'auto on')
    const outcome = await callApproval(harness, {
      seq: 40,
      callId: 'write-delete-content',
      tool: 'write',
      args: { path: REPORT, content: 'shutil.rmtree("build")' },
    })
    assert.equal(outcome, 'rejected')
    const row = rowFor(auditRows(harness.ctx, harness.agent), 'write-delete-content')
    assert.equal(row?.matchedBy, 'session-auto-delete-blocked')
  })

  it('keeps the switch across turn end and forgets it on session disposal', async () => {
    const harness = setup()
    runApprovals(harness.ctx, harness.agent, 'auto on')
    const turnEnd = makeEvent(50, 'turn/end', { turn: 1, reason: 'completed' })
    harness.events.push(turnEnd)
    harness.ctx.emitSessionEvent(harness.session, turnEnd)

    const status = runApprovals(harness.ctx, harness.agent, 'auto')
    assert.equal(status.kind, 'success')
    if (status.kind === 'success') assert.match(status.text ?? '', /已开启/)

    const afterTurn = await callApproval(harness, {
      seq: 51,
      callId: 'write-next-turn',
      tool: 'write',
      args: { path: REPORT },
    })
    assert.equal(afterTurn, 'allowed-once')

    harness.ctx.emitDisposed(harness.session)
    const afterDispose = await callApproval(harness, {
      seq: 54,
      callId: 'write-after-dispose',
      tool: 'write',
      args: { path: REPORT },
    })
    assert.equal(afterDispose, 'rejected')
  })

  it('applies the config default to a new session', async () => {
    const harness = setup({ autoAllowSessions: true })
    harness.ctx.emitSessionEvent(harness.session, harness.events[0] as SessionEvent)
    const status = runApprovals(harness.ctx, harness.agent, 'auto')
    assert.equal(status.kind, 'success')
    if (status.kind === 'success') assert.match(status.text ?? '', /默认（配置：开）/)

    const outcome = await callApproval(harness, {
      seq: 60,
      callId: 'write-default',
      tool: 'write',
      args: { path: REPORT },
    })
    assert.equal(outcome, 'allowed-once')
  })

  it('never uses the config default in observe mode', async () => {
    const harness = setup({ mode: 'observe', autoAllowSessions: true })
    harness.ctx.emitSessionEvent(harness.session, harness.events[0] as SessionEvent)
    const outcome = await callApproval(harness, {
      seq: 63,
      callId: 'write-observe',
      tool: 'write',
      args: { path: REPORT },
    })
    assert.equal(outcome, 'rejected')
    assert.notEqual(
      rowFor(auditRows(harness.ctx, harness.agent), 'write-observe')?.matchedBy,
      'session-scope+risk-gate',
    )
  })

  it('fails closed to the official card when the switch lookup throws', async () => {
    const config = sanitizeConfig({ mode: 'active', notifications: false }).config
    const runtime = createRuntime(config)
    const ctx = new FakeContext()
    const events: SessionEvent[] = [
      makeEvent(1, 'turn/start', { turn: 1 }),
      makeEvent(2, 'tool/call', {
        turn: 1,
        step: 1,
        callId: 'write-boom',
        name: 'write',
        arguments: JSON.stringify({ path: REPORT }),
      }),
    ]
    const session = makeSession('session-boom', events)
    const agent = makeAgent(session)
    runtime.sessionAuto.enable(agent.id)
    const dispose = registerApprovalHook(ctx as unknown as Context, runtime)
    try {
      ;(runtime.sessionAuto as unknown as { isEnabled: () => boolean }).isEnabled = () => {
        throw new Error('boom')
      }
      const outcome = await ctx.emitApproval(
        {
          agent,
          toolName: 'write',
          callId: 'write-boom',
          displayReason: { en: 'old', zh: '旧' },
        },
        'rejected',
      )
      assert.equal(outcome, 'rejected')
    } finally {
      dispose()
      runtime.dispose()
    }
  })

  it('auto-allows an ops_bash PTC inner call once dispatch arguments are known', async () => {
    const harness = setup()
    runApprovals(harness.ctx, harness.agent, 'auto on')

    // Live dispatch event (the production path: session/event is observed).
    const live = await callApprovalViaPtc(harness, {
      seq: 70,
      callId: 'call_root:ptc:1',
      tool: 'ops_bash',
      args: { command: 'npm test' },
    })
    assert.equal(live, 'allowed-once')

    // The dispatch only exists in the history (plugin started after the event).
    const scanned = await callApprovalViaPtc(harness, {
      seq: 73,
      callId: 'call_root:ptc:2',
      tool: 'ops_bash',
      args: { command: 'pnpm build' },
      historyOnly: true,
    })
    assert.equal(scanned, 'allowed-once')

    const rows = auditRows(harness.ctx, harness.agent)
    for (const callId of ['call_root:ptc:1', 'call_root:ptc:2']) {
      assert.equal(rowFor(rows, callId)?.matchedBy, 'session-scope+risk-gate', callId)
      assert.equal(rowFor(rows, callId)?.decision, 'allowed-once', callId)
    }
  })

  it('keeps a PTC ops_bash delete and an ops_remove on the official card', async () => {
    const harness = setup()
    runApprovals(harness.ctx, harness.agent, 'auto on')

    const recursive = await callApprovalViaPtc(harness, {
      seq: 80,
      callId: 'call_root:ptc:3',
      tool: 'ops_bash',
      args: { command: IS_WIN ? 'rm -rf C:\\ws' : 'rm -rf /ws' },
    })
    assert.equal(recursive, 'rejected')

    const remove = await callApprovalViaPtc(harness, {
      seq: 83,
      callId: 'call_root:ptc:4',
      tool: 'ops_remove',
      args: { path: REPORT },
    })
    assert.equal(remove, 'rejected')

    const rows = auditRows(harness.ctx, harness.agent)
    for (const callId of ['call_root:ptc:3', 'call_root:ptc:4']) {
      assert.equal(rowFor(rows, callId)?.matchedBy, 'session-auto-delete-blocked', callId)
    }
  })
})
