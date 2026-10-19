import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { apply, inject } from '../src/index.js'
import type { Context, JsonValue, SessionEvent, ToolDefinition } from '../src/types/dsh-runtime.js'
import {
  FakeContext,
  makeAgent,
  makeEvent,
  makeSession,
  toolExec,
} from './helpers/fake-context.js'

const IS_WIN = process.platform === 'win32'
const REPORT = IS_WIN ? 'C:\\ws\\out\\report.md' : '/ws/out/report.md'

const PLAN = {
  summary: 'Write a report and run tests',
  items: [
    {
      id: 'A',
      tool: 'write',
      title: 'write report',
      scope: { paths: [REPORT] },
    },
    {
      id: 'B',
      tool: 'pwsh',
      title: 'run tests',
      dependsOn: ['A'],
      scope: { commands: ['npm test'] },
    },
  ],
}

function dummyTool(name: string): ToolDefinition {
  return {
    name,
    description: name,
    parameters: { type: 'object', properties: {} },
    output: {
      schema: { type: 'object', properties: {} },
      render: () => [{ type: 'text', text: name }],
    },
    execute: async () => ({}),
  }
}

function setup(config: unknown = { mode: 'active' }): {
  ctx: FakeContext
  session: ReturnType<typeof makeSession>
  agent: ReturnType<typeof makeAgent>
  events: SessionEvent[]
} {
  const ctx = new FakeContext()
  ctx.tools.register(dummyTool('write'))
  ctx.tools.register(dummyTool('pwsh'))
  apply(ctx as unknown as Context, config)
  const events: SessionEvent[] = [
    makeEvent(1, 'turn/start', { turn: 1 }),
    makeEvent(2, 'tool/call', {
      turn: 1,
      step: 0,
      callId: 'plan-call',
      name: 'request_approvals',
      arguments: JSON.stringify(PLAN),
    }),
  ]
  const session = makeSession('session-1', events)
  const agent = makeAgent(session)
  return { ctx, session, agent, events }
}

async function approvePlan(
  ctx: FakeContext,
  agent: ReturnType<typeof makeAgent>,
  events: SessionEvent[],
): Promise<{ result: Record<string, unknown>; meta: unknown }> {
  const result = (await ctx.runTool(
    'request_approvals',
    PLAN,
    toolExec(agent, 'plan-call', 'request_approvals', PLAN),
  )) as Record<string, unknown>
  const definition = ctx.toolDefs.get('request_approvals')
  assert.ok(definition?.output.presentationMeta)
  const meta = definition.output.presentationMeta(PLAN, result as unknown as JsonValue)
  events.push(
    makeEvent(3, 'tool/result', {
      turn: 1,
      step: 0,
      message: { toolCallId: 'plan-call' },
      meta,
    }),
  )
  return { result, meta }
}

async function callApproval(
  ctx: FakeContext,
  agent: ReturnType<typeof makeAgent>,
  events: SessionEvent[],
  input: {
    seq: number
    callId: string
    tool: string
    args: unknown
    reason?: string
  },
  fallback: 'allowed-once' | 'rejected' = 'rejected',
): Promise<{ outcome: string; displayReason: unknown }> {
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
  return { outcome, displayReason: request.displayReason }
}

describe('host plugin integration', () => {
  it('declares the required services and registers tool, command, and hook', () => {
    const { ctx } = setup()
    assert.ok(inject.includes('tools'))
    assert.ok(inject.includes('userQuestions'))
    assert.ok(inject.includes('commands'))
    assert.ok(inject.includes('workingDirectory'))
    assert.ok(ctx.toolDefs.has('request_approvals'))
    assert.ok(ctx.toolDefs.has('ask_choices'))
    assert.ok(ctx.commandDefs.has('approvals'))
  })

  it('keeps high-risk opt-in behind the official approval card', async () => {
    const { ctx, agent, events } = setup({ mode: 'active', allowHighRiskGrants: true })
    const highPlan = {
      summary: 'high-risk script write',
      items: [
        {
          id: 'H',
          tool: 'write',
          title: '写脚本',
          scope: { paths: [IS_WIN ? 'C:\\ws\\out\\script.ps1' : '/ws/out/script.ps1'] },
        },
      ],
    }
    const result = (await ctx.runTool(
      'request_approvals',
      highPlan,
      toolExec(agent, 'plan-call', 'request_approvals', highPlan),
    )) as Record<string, unknown>
    assert.equal(result.decision, 'approved')
    assert.equal(ctx.askCalls.length, 2)

    const approval = await callApproval(
      ctx,
      agent,
      events,
      {
        seq: 20,
        callId: 'high-call',
        tool: 'write',
        args: { path: IS_WIN ? 'C:\\ws\\out\\script.ps1' : '/ws/out/script.ps1' },
        reason: 'write a script',
      },
      'rejected',
    )
    assert.equal(approval.outcome, 'rejected')
    const display = approval.displayReason as { zh?: string }
    assert.match(display.zh ?? '', /^写入文件 · /)
    assert.equal(display.zh?.includes('旧'), false)
  })

  it('approves a plan, installs grants, auto-allows a medium write, and rewrites the card summary', async () => {
    const { ctx, agent, events } = setup()
    const { result } = await approvePlan(ctx, agent, events)
    assert.equal(result.decision, 'approved')
    assert.equal(typeof result.planId, 'string')

    const approval = await callApproval(
      ctx,
      agent,
      events,
      {
        seq: 10,
        callId: 'write-call',
        tool: 'write',
        args: { path: REPORT },
        reason: 'write a report',
      },
      'rejected',
    )
    assert.equal(approval.outcome, 'allowed-once')
    const display = approval.displayReason as { en?: string; zh?: string }
    assert.match(display.en ?? '', /write · /)
    assert.match(display.zh ?? '', /写入文件 · /)
    assert.equal(display.en === 'old', false)
  })

  it('keeps a high-risk command manual and records it', async () => {
    const { ctx, agent, events } = setup()
    await approvePlan(ctx, agent, events)
    const approval = await callApproval(ctx, agent, events, {
      seq: 20,
      callId: 'pwsh-call',
      tool: 'pwsh',
      args: { command: 'npm test' },
      reason: 'run tests',
    })
    assert.equal(approval.outcome, 'rejected')
  })

  it('observe mode never allows and records would-allow', async () => {
    const { ctx, agent, events } = setup({ mode: 'observe' })
    await approvePlan(ctx, agent, events)
    const approval = await callApproval(
      ctx,
      agent,
      events,
      {
        seq: 30,
        callId: 'write-call',
        tool: 'write',
        args: { path: REPORT },
      },
      'rejected',
    )
    assert.equal(approval.outcome, 'rejected')

    const command = ctx.runCommand('approvals', {
      commandId: 'cmd-1',
      agent,
      rawInput: 'audit',
      attachments: [],
      signal: new AbortController().signal,
    })
    assert.equal(command.kind, 'success')
    if (command.kind === 'success') {
      assert.match(command.text ?? '', /observe-would-allow|未归属|已核对/)
    }
  })

  it('supports /approvals audit, --json, and grants', async () => {
    const { ctx, agent, events } = setup()
    await approvePlan(ctx, agent, events)
    await callApproval(
      ctx,
      agent,
      events,
      {
        seq: 40,
        callId: 'write-call',
        tool: 'write',
        args: { path: REPORT },
      },
      'rejected',
    )

    const audit = ctx.runCommand('approvals', {
      commandId: 'cmd-1',
      agent,
      rawInput: 'audit',
      attachments: [],
      signal: new AbortController().signal,
    })
    assert.equal(audit.kind, 'success')
    if (audit.kind === 'success') {
      assert.match(audit.text ?? '', /审批决策记录/)
      assert.match(audit.text ?? '', /A/)
    }

    const json = ctx.runCommand('approvals', {
      commandId: 'cmd-2',
      agent,
      rawInput: 'audit --json',
      attachments: [],
      signal: new AbortController().signal,
    })
    assert.equal(json.kind, 'success')
    if (json.kind === 'success') {
      const parsed = JSON.parse(json.text ?? '{}') as { schemaVersion?: number }
      assert.equal(parsed.schemaVersion, 1)
    }

    const grants = ctx.runCommand('approvals', {
      commandId: 'cmd-3',
      agent,
      rawInput: 'grants',
      attachments: [],
      signal: new AbortController().signal,
    })
    assert.equal(grants.kind, 'success')
    if (grants.kind === 'success') assert.match(grants.text ?? '', /A · write/)
  })

  it('lets the user veto every item at the per-item selection step', async () => {
    const { ctx, agent, events } = setup()
    const original = ctx.askHandler
    ctx.askHandler = async (request) => {
      const question = request.questions[0]
      if (question?.multiSelect === true) {
        return { answers: [{ id: question.id, selected: [] }] }
      }
      return original(request)
    }
    const { result } = await approvePlan(ctx, agent, events)
    assert.equal(result.decision, 'cancelled')

    const grants = ctx.runCommand('approvals', {
      commandId: 'cmd-veto',
      agent,
      rawInput: 'grants',
      attachments: [],
      signal: new AbortController().signal,
    })
    assert.equal(grants.kind, 'success')
    if (grants.kind === 'success') assert.match(grants.text ?? '', /No grants/)
  })

  it('treats a cancelled plan review as no grants', async () => {
    const { ctx, agent } = setup()
    ctx.askError = { code: 'ASK_CANCELLED' }
    const result = (await ctx.runTool(
      'request_approvals',
      PLAN,
      toolExec(agent, 'plan-call', 'request_approvals', PLAN),
    )) as Record<string, unknown>
    assert.equal(result.decision, 'cancelled')
  })

  it('fails closed in a subagent-like ask rejection', async () => {
    const { ctx, agent } = setup()
    ctx.askError = { code: 'DELEGATED_CALLER' }
    await assert.rejects(
      () =>
        ctx.runTool(
          'request_approvals',
          PLAN,
          toolExec(agent, 'plan-call', 'request_approvals', PLAN),
        ),
      /main session/,
    )
  })

  it('revokes grants at turn end', async () => {
    const { ctx, session, agent, events } = setup()
    await approvePlan(ctx, agent, events)
    ctx.emitSessionEvent(session, makeEvent(50, 'turn/end', { turn: 1, reason: 'completed' }))
    events.push(makeEvent(51, 'turn/end', { turn: 1, reason: 'completed' }))
    const approval = await callApproval(
      ctx,
      agent,
      events,
      {
        seq: 52,
        callId: 'write-call',
        tool: 'write',
        args: { path: REPORT },
      },
      'rejected',
    )
    assert.equal(approval.outcome, 'rejected')
  })

  it('prepends its approval hook before an earlier sibling listener', async () => {
    const ctx = new FakeContext()
    let siblingSummary = ''
    ctx.on('approval/request', async (request, next) => {
      const reason = request.displayReason as { en?: string } | undefined
      siblingSummary = reason?.en ?? ''
      return next()
    })
    apply(ctx as unknown as Context, { mode: 'observe' })
    const session = makeSession('session-order', [makeEvent(1, 'turn/start', { turn: 1 })])
    const agent = makeAgent(session)
    const outcome = await ctx.emitApproval({
      agent,
      toolName: 'write',
      callId: 'call-order',
      reason: 'escalate sandbox to danger-full-access: order test',
      displayReason: { en: 'original', zh: '原始' },
    } as never)
    assert.equal(outcome, 'rejected')
    assert.notEqual(siblingSummary, 'original')
    assert.match(siblingSummary, /write/)
  })

  it('rejects an invalid plan without calling ask', async () => {
    const { ctx, agent } = setup()
    await assert.rejects(
      () =>
        ctx.runTool(
          'request_approvals',
          { summary: 'bad', items: [] },
          toolExec(agent, 'plan-call', 'request_approvals', {}),
        ),
      /invalid/,
    )
    assert.equal(ctx.askCalls.length, 0)
  })
})
