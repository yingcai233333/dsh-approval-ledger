import { buildApprovalDisplayReason } from '../approval/summary.js'
import { MemoryAuditStore } from '../audit/store.js'
import { toAuditJson } from '../audit/export.js'
import { replayAudit } from '../audit/replay.js'
import { renderAuditReport } from '../audit/report.js'
import { deriveAuditRecords, eventsToReplayFacts } from '../audit/session-facts.js'
import { flashApprovalWindow } from '../notify/flash.js'
import {
  isObserveOnly,
  planLimitsFromConfig,
  riskPolicyFromConfig,
} from '../config.js'
import type { PluginConfig } from '../config.js'
import { isPlainObject } from '../core/json.js'
import type { RiskAssessment } from '../core/types.js'
import { createNodePathProbe } from '../path/node-probe.js'
import type { PathPlatform, PathProbe } from '../path/types.js'
import { assessRisk } from '../risk/assess.js'
import { createPlanId } from '../plan/id.js'
import { buildPlanMeta } from '../plan/meta.js'
import { buildPlanReviewRequest, buildPlanSelectionQuestion, validatePlanReviewShape } from '../plan/review.js'
import {
  ASK_CHOICES_OUTPUT_SCHEMA,
  ASK_CHOICES_PARAMETERS,
  normalizeChoiceAnswers,
  parseAskChoicesArgs,
  toQuestionRequest,
} from '../choices/ask.js'
import {
  REQUEST_APPROVALS_OUTPUT_SCHEMA,
  REQUEST_APPROVALS_PARAMETERS,
} from '../plan/tool-schema.js'
import type { PlanDecision } from '../plan/meta.js'
import type { ValidatedPlan } from '../plan/types.js'
import { validatePlan } from '../plan/validate.js'
import { GrantStore } from '../grants/store.js'
import type { GrantMatchResult } from '../grants/types.js'
import { SessionTracker } from './session-tracker.js'
import type {
  Agent,
  ApprovalOutcome,
  ApprovalRequestEvent,
  AskUserQuestionAnswer,
  AskUserQuestionRequest,
  CommandInvocation,
  CommandResult,
  Context,
  JsonSchemaNode,
  JsonValue,
  Session,
  SessionEvent,
  ToolDefinition,
  ToolRunContext,
} from '../types/dsh-runtime.js'

type Mutable<T> = { -readonly [K in keyof T]: T[K] }

interface CachedPlan {
  plan: ValidatedPlan
  decision: PlanDecision
  selected?: ReadonlySet<string>
}

interface PreparedApproval {
  args: unknown
  mode?: string
  cwd?: string
  turn: number
  risk: RiskAssessment
  match?: GrantMatchResult
  platform: PathPlatform
  probe: PathProbe
}

export interface LedgerRuntime {
  config: PluginConfig
  tracker: SessionTracker
  grants: GrantStore
  audits: MemoryAuditStore
  plans: Map<string, CachedPlan>
  dispose(): void
}

export function createRuntime(config: PluginConfig): LedgerRuntime {
  const runtime: LedgerRuntime = {
    config,
    tracker: new SessionTracker(),
    grants: new GrantStore({
      mode: isObserveOnly(config) ? 'observe' : 'active',
      policy: riskPolicyFromConfig(config),
    }),
    audits: new MemoryAuditStore(),
    plans: new Map(),
    dispose(): void {
      runtime.grants.dispose()
      runtime.plans.clear()
      for (const sessionId of runtime.audits.sessions()) runtime.audits.clear(sessionId)
    },
  }
  return runtime
}

function currentPlatform(): PathPlatform {
  return process.platform === 'win32' ? 'win32' : 'posix'
}

function readTurn(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined
}

function modeFromReason(reason: unknown): string | undefined {
  if (typeof reason !== 'string') return undefined
  const match = /\bescalate sandbox to ([a-z-]+)\b/i.exec(reason)
  return match?.[1]
}

function workingDirectoryOf(ctx: Context, session: Session): string | undefined {
  try {
    const value = ctx.workingDirectory.get(session)
    return typeof value === 'string' && value.length > 0 ? value : undefined
  } catch {
    return undefined
  }
}

function rewriteDisplayReason(
  req: ApprovalRequestEvent,
  prepared: Pick<PreparedApproval, 'args' | 'mode' | 'cwd' | 'platform' | 'probe'>,
): void {
  try {
    const summary = buildApprovalDisplayReason({
      tool: req.toolName,
      args: prepared.args,
      mode: prepared.mode,
      cwd: prepared.cwd,
      platform: prepared.platform,
      probe: prepared.probe,
    })
    ;(req as Mutable<ApprovalRequestEvent>).displayReason = summary
  } catch {
    // The card may be frozen or already serialized; the official reason stands.
  }
}

function rememberPlan(
  runtime: LedgerRuntime,
  planId: string,
  plan: ValidatedPlan,
  decision: PlanDecision,
  selected?: ReadonlySet<string>,
): void {
  runtime.plans.set(planId, { plan, decision, selected })
  if (runtime.plans.size > 20) {
    const oldest = runtime.plans.keys().next().value
    if (oldest !== undefined) runtime.plans.delete(oldest)
  }
}

function recordAudit(
  runtime: LedgerRuntime,
  input: {
    sessionId: string
    callId: string | undefined
    tool: string
    risk: RiskAssessment
    outcome: ApprovalOutcome
    mode?: string
    planId?: string
    itemId?: string
    matchedBy?: string
    args?: unknown
    cwd?: string
    platform: PathPlatform
    probe: PathProbe
    time?: number
  },
): void {
  if (input.callId === undefined) return
  try {
    runtime.audits.appendCall(input.sessionId, {
      callId: input.callId,
      tool: input.tool,
      risk: input.risk,
      outcome: input.outcome,
      mode: input.mode,
      planId: input.planId,
      itemId: input.itemId,
      matchedBy: input.matchedBy,
      args: input.args,
      cwd: input.cwd,
      platform: input.platform,
      probe: input.probe,
      time: input.time,
    })
  } catch {
    // Duplicate or malformed audit evidence must never block the approval.
  }
}

function prepareApproval(
  ctx: Context,
  runtime: LedgerRuntime,
  req: ApprovalRequestEvent,
): PreparedApproval | undefined {
  try {
    const session = req.agent.session
    const call = runtime.tracker.toolCall(session, req.callId)
    const args = call?.args
    const turn = call?.turn ?? runtime.tracker.currentTurn(session)
    const cwd = workingDirectoryOf(ctx, session)
    const mode = modeFromReason(req.reason)
    const platform = currentPlatform()
    const probe = createNodePathProbe()
    const risk = assessRisk({
      tool: req.toolName,
      args,
      mode,
      cwd,
      platform,
      probe,
    })
    let match: GrantMatchResult | undefined
    try {
      match = runtime.grants.match({
        sessionId: req.agent.id,
        turn,
        tool: req.toolName,
        mode,
        args,
        cwd,
        platform,
        probe,
        confirmedHighRisk: false,
      })
    } catch {
      match = undefined
    }
    return { args, mode, cwd, turn, risk, match, platform, probe }
  } catch {
    return undefined
  }
}

export function registerApprovalHook(ctx: Context, runtime: LedgerRuntime): () => void {
  return ctx.on(
    'approval/request',
    async (req: ApprovalRequestEvent, next: () => Promise<ApprovalOutcome>) => {
      const prepared = prepareApproval(ctx, runtime, req)
      const sessionId = req.agent.id
      if (prepared === undefined) {
        return next()
      }
      if (req.signal?.aborted === true) {
        return next()
      }

      rewriteDisplayReason(req, prepared)

      if (prepared.match?.decision === 'allowed-once') {
        recordAudit(runtime, {
          sessionId,
          callId: req.callId,
          tool: req.toolName,
          risk: prepared.match.risk ?? prepared.risk,
          outcome: 'allowed-once',
          mode: prepared.mode,
          planId: prepared.match.grant?.planId,
          itemId: prepared.match.grant?.itemId,
          matchedBy: 'plan-scope+risk-gate',
          args: prepared.args,
          cwd: prepared.cwd,
          platform: prepared.platform,
          probe: prepared.probe,
        })
        return 'allowed-once'
      }

      flashApprovalWindow({ enabled: runtime.config.flashWindow })

      let outcome: ApprovalOutcome
      try {
        outcome = await next()
      } catch (error) {
        recordAudit(runtime, {
          sessionId,
          callId: req.callId,
          tool: req.toolName,
          risk: prepared.match?.risk ?? prepared.risk,
          outcome: 'unavailable',
          mode: prepared.mode,
          planId: prepared.match?.grant?.planId,
          itemId: prepared.match?.grant?.itemId,
          matchedBy: prepared.match?.decision ?? 'manual',
          args: prepared.args,
          cwd: prepared.cwd,
          platform: prepared.platform,
          probe: prepared.probe,
        })
        throw error
      }

      recordAudit(runtime, {
        sessionId,
        callId: req.callId,
        tool: req.toolName,
        risk: prepared.match?.risk ?? prepared.risk,
        outcome,
        mode: prepared.mode,
        planId: prepared.match?.grant?.planId,
        itemId: prepared.match?.grant?.itemId,
        matchedBy:
          prepared.match?.decision === 'would-allow'
            ? 'observe-would-allow'
            : prepared.match?.decision === 'needs-confirmation'
              ? 'risk-needs-confirmation'
              : 'manual',
        args: prepared.args,
        cwd: prepared.cwd,
        platform: prepared.platform,
        probe: prepared.probe,
      })
      return outcome
    },
    { prepend: true },
  )
}

function knownToolsFor(
  ctx: Context,
  args: unknown,
  agent: Agent,
): ReadonlySet<string> | undefined {
  if (!isPlainObject(args) || !Array.isArray(args.items)) return undefined
  const known = new Set<string>()
  for (const raw of args.items) {
    if (!isPlainObject(raw) || typeof raw.tool !== 'string') continue
    try {
      if (ctx.tools.get(raw.tool, agent) !== undefined) known.add(raw.tool)
    } catch {
      // A failing lookup is treated as "not registered" (fail closed).
    }
  }
  return known
}

function planDecisionResult(
  plan: ValidatedPlan,
  planId: string,
  decision: PlanDecision,
  selected?: ReadonlySet<string>,
): JsonValue {
  const selectedSet = selected ?? new Set(plan.autoItems)
  return {
    planId,
    planHash: plan.planHash,
    decision,
    items: plan.items.map((item) => ({
      id: item.id,
      tool: item.tool,
      risk: item.risk.level,
      auto: decision === 'approved' && item.autoEligible && selectedSet.has(item.id),
      uses: item.uses,
    })),
  }
}

function cancelledResult(plan: ValidatedPlan, planId: string): JsonValue {
  return planDecisionResult(plan, planId, 'cancelled')
}

/**
 * Ask one or more official questions, translating the runtime cancel path into
 * `undefined` while keeping delegated/bad-intent failures loud.
 */
async function askQuestions(
  ctx: Context,
  agent: Agent,
  signal: AbortSignal,
  questions: AskUserQuestionRequest['questions'],
): Promise<AskUserQuestionAnswer | undefined> {
  try {
    return await ctx.userQuestions.ask({
      agent,
      signal,
      questions,
    } as AskUserQuestionRequest)
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? (error as { code?: unknown }).code
        : undefined
    const message = error instanceof Error ? error.message : String(error)
    if (code === 'DELEGATED_CALLER' || message.includes('DELEGATED_CALLER')) {
      throw new Error(
        'this tool requires the main session; include the question or plan in your final result instead',
      )
    }
    if (code === 'BAD_INTENT') {
      throw new Error('could not submit a valid official question card')
    }
    return undefined
  }
}

function grantPlanFor(plan: ValidatedPlan, selected: ReadonlySet<string>): ValidatedPlan {
  const items = plan.items.map((item) =>
    selected.has(item.id)
      ? item
      : {
          ...item,
          autoEligible: false,
          manualOnly: true,
          risk: { ...item.risk, autoEligible: false },
        },
  )
  const autoItems = plan.autoItems.filter((id) => selected.has(id))
  const manualItems = plan.items
    .filter((item) => !autoItems.includes(item.id))
    .map((item) => item.id)
  return { ...plan, items, autoItems, manualItems }
}

export function registerRequestApprovalsTool(
  ctx: Context,
  runtime: LedgerRuntime,
): () => void {
  const definition: ToolDefinition = {
    name: 'request_approvals',
    description:
      'Ask the user to approve a declared batch of upcoming tool actions in one plan-review card. ' +
      'Each item must declare the exact tool and scope; the host re-evaluates risk for every actual call. ' +
      'Critical operations are never auto-approved and unknown operations stay manual.',
    parameters: REQUEST_APPROVALS_PARAMETERS,
    output: {
      schema: REQUEST_APPROVALS_OUTPUT_SCHEMA as unknown as JsonSchemaNode,
      render: (_args, value) => {
        const record = isPlainObject(value) ? value : {}
        const decision = typeof record.decision === 'string' ? record.decision : 'unknown'
        const planId = typeof record.planId === 'string' ? record.planId : 'unknown'
        const items = Array.isArray(record.items) ? record.items.length : 0
        return [
          {
            type: 'text',
            text: `Plan ${planId}: ${decision}; ${items} item(s) recorded.`,
          },
        ]
      },
      presentationMeta: (_args, value) => {
        const record = isPlainObject(value) ? value : {}
        const planId = typeof record.planId === 'string' ? record.planId : ''
        const cached = planId.length > 0 ? runtime.plans.get(planId) : undefined
        if (cached === undefined) {
          return {
            schemaVersion: 1,
            planId,
            decision: typeof record.decision === 'string' ? record.decision : 'cancelled',
            items: [],
          }
        }
        return buildPlanMeta(
          cached.plan,
          planId,
          cached.decision,
          cached.selected,
        ) as unknown as JsonValue
      },
    },
    async execute(args: unknown, exec: ToolRunContext): Promise<JsonValue> {
      const agent = exec.agent
      if (agent === undefined) {
        throw new Error('request_approvals requires an owning agent session')
      }
      if (exec.signal.aborted) {
        throw new Error('request_approvals was cancelled')
      }
      const cwd = workingDirectoryOf(ctx, agent.session)
      if (cwd === undefined) {
        throw new Error('request_approvals cannot determine the session workspace')
      }

      const validation = validatePlan(args, {
        cwd,
        platform: currentPlatform(),
        probe: createNodePathProbe(),
        knownTools: knownToolsFor(ctx, args, agent),
        policy: riskPolicyFromConfig(runtime.config),
        ...planLimitsFromConfig(runtime.config),
      })
      if (!validation.ok) {
        const codes = [...new Set(validation.errors.map((error) => error.code))].join(', ')
        throw new Error(`request_approvals plan is invalid (${codes})`)
      }

      const plan = validation.plan
      const planId = createPlanId()
      const review = buildPlanReviewRequest(plan, { lang: 'zh', id: planId })
      const shape = validatePlanReviewShape(review)
      if (!shape.ok) {
        throw new Error('request_approvals could not build a valid plan-review card')
      }
      const question = review.questions[0]
      if (question === undefined) {
        throw new Error('request_approvals could not build a plan-review question')
      }

      const answer = await askQuestions(ctx, agent, exec.signal, review.questions)
      if (answer === undefined) {
        const cancelled = cancelledResult(plan, planId)
        rememberPlan(runtime, planId, plan, 'cancelled')
        return cancelled
      }

      const selected = answer.answers.find((entry) => entry.id === question.id)?.selected ?? []
      const approved = selected.includes(question.intent.approve)
      if (!approved) {
        const cancelled = cancelledResult(plan, planId)
        rememberPlan(runtime, planId, plan, 'cancelled')
        return cancelled
      }

      const selection = buildPlanSelectionQuestion(plan, { lang: 'zh' })
      let selectedItems: ReadonlySet<string>
      if (selection === undefined) {
        selectedItems = new Set()
      } else {
        const selectionAnswer = await askQuestions(ctx, agent, exec.signal, [selection])
        if (selectionAnswer === undefined) {
          const cancelled = cancelledResult(plan, planId)
          rememberPlan(runtime, planId, plan, 'cancelled')
          return cancelled
        }
        const picked = new Set(
          selectionAnswer.answers.find((entry) => entry.id === selection.id)?.selected ?? [],
        )
        selectedItems = new Set(plan.autoItems.filter((id) => picked.has(id)))
        if (selectedItems.size === 0) {
          const cancelled = cancelledResult(plan, planId)
          rememberPlan(runtime, planId, plan, 'cancelled')
          return cancelled
        }
      }

      const turn = runtime.tracker.currentTurn(agent.session)
      if (selectedItems.size > 0) {
        runtime.grants.createFromPlan(grantPlanFor(plan, selectedItems), {
          sessionId: agent.id,
          turn,
          planId,
        })
      }
      rememberPlan(runtime, planId, plan, 'approved', selectedItems)
      return planDecisionResult(plan, planId, 'approved', selectedItems)
    },
  }
  return ctx.tools.register(definition)
}

/**
 * Structured multiple-choice questions through the official question UI.
 *
 * This tool never executes anything and never changes grants. It only adds
 * Chinese detail, option descriptions, and a `（推荐）` marker so the model can
 * ask a clear question without replacing the official question card.
 */
export function registerAskChoicesTool(ctx: Context): () => void {
  const definition: ToolDefinition = {
    name: 'ask_choices',
    description:
      '向用户提出结构化选择问题（单选或多选），使用官方问题卡。' +
      '最多 5 个问题、每题 2-10 个选项；可以用 description 解释选项，用 recommended 标记推荐项。' +
      '这个工具只收集选择，不执行操作、不修改授权。',
    parameters: ASK_CHOICES_PARAMETERS,
    output: {
      schema: ASK_CHOICES_OUTPUT_SCHEMA as unknown as JsonSchemaNode,
      render: (_args, value) => {
        const record = isPlainObject(value) ? value : {}
        if (record.cancelled === true) {
          return [{ type: 'text', text: '用户取消了选择。' }]
        }
        const answers = Array.isArray(record.answers) ? record.answers.length : 0
        return [{ type: 'text', text: `已收到 ${answers} 个问题的选择。` }]
      },
    },
    async execute(args: unknown, exec: ToolRunContext): Promise<JsonValue> {
      const agent = exec.agent
      if (agent === undefined) throw new Error('ask_choices requires an owning agent session')
      if (exec.signal.aborted) throw new Error('ask_choices was cancelled')
      const questions = parseAskChoicesArgs(args)
      const answer = await askQuestions(ctx, agent, exec.signal, toQuestionRequest(questions))
      if (answer === undefined) return { cancelled: true, answers: [] }
      return {
        cancelled: false,
        answers: normalizeChoiceAnswers(questions, answer) as unknown as JsonValue,
      }
    },
  }
  return ctx.tools.register(definition)
}

function grantsText(runtime: LedgerRuntime, sessionId: string): string {
  const grants = runtime.grants.listGrants(sessionId)
  if (grants.length === 0) return 'No grants recorded for this session.'
  return grants
    .map((grant) => {
      const uses = grant.state === 'manual' || grant.state === 'blocked-by-manual' ? '—' : String(grant.usesLeft)
      return `${grant.planId}/${grant.itemId} · ${grant.tool} · ${grant.state} · uses ${uses} · stage ${grant.stage}`
    })
    .join('\n')
}

function auditText(ctx: Context, runtime: LedgerRuntime, agent: Agent): string {
  const events = agent.session.snapshotEvents()
  const facts = eventsToReplayFacts(events)
  const recorded = runtime.audits.list(agent.id)
  const existing = new Set(recorded.map((record) => record.callId))
  const derived = deriveAuditRecords(facts, {
    sessionId: agent.id,
    cwd: workingDirectoryOf(ctx, agent.session),
    platform: currentPlatform(),
    probe: createNodePathProbe(),
    policy: riskPolicyFromConfig(runtime.config),
  }).filter((record) => !existing.has(record.callId))
  const replay = replayAudit({
    sessionId: agent.id,
    cwd: workingDirectoryOf(ctx, agent.session),
    platform: currentPlatform(),
    facts,
    ledger: [...recorded, ...derived],
  })
  return renderAuditReport(replay, { lang: 'zh' })
}

export function registerApprovalsCommand(
  ctx: Context,
  runtime: LedgerRuntime,
): () => void {
  return ctx.commands.register({
    name: 'approvals',
    description: 'Inspect approval decisions and active grants for this session',
    input: { hint: '[audit [--json] | grants]' },
    handler: (invocation: CommandInvocation): CommandResult => {
      try {
        const raw = invocation.rawInput.trim()
        if (raw === 'grants') {
          return { kind: 'success', text: grantsText(runtime, invocation.agent.id) }
        }
        if (raw === 'audit --json') {
          const events = invocation.agent.session.snapshotEvents()
          const facts = eventsToReplayFacts(events)
          const recorded = runtime.audits.list(invocation.agent.id)
          const existing = new Set(recorded.map((record) => record.callId))
          const derived = deriveAuditRecords(facts, {
            sessionId: invocation.agent.id,
            cwd: workingDirectoryOf(ctx, invocation.agent.session),
            platform: currentPlatform(),
            probe: createNodePathProbe(),
            policy: riskPolicyFromConfig(runtime.config),
          }).filter((record) => !existing.has(record.callId))
          const replay = replayAudit({
            sessionId: invocation.agent.id,
            cwd: workingDirectoryOf(ctx, invocation.agent.session),
            platform: currentPlatform(),
            facts,
            ledger: [...recorded, ...derived],
          })
          return { kind: 'success', text: toAuditJson(replay, true) }
        }
        return { kind: 'success', text: auditText(ctx, runtime, invocation.agent) }
      } catch (error) {
        return { kind: 'error', text: `approvals failed: ${String(error)}` }
      }
    },
  })
}

export function registerRuntime(ctx: Context, config: PluginConfig): () => void {
  const runtime = createRuntime(config)
  const disposers: Array<() => void> = []
  try {
    disposers.push(
      ctx.on(
        'session/event',
        (session: Session, event: SessionEvent) => {
          runtime.tracker.observe(session, event)
          if (event.type === 'turn/end') {
            const data = isPlainObject(event.data) ? event.data : undefined
            const turn = readTurn(data?.turn)
            if (turn !== undefined) runtime.grants.revokeTurn(session.id, turn)
          }
        },
        { global: true },
      ),
    )
    disposers.push(
      ctx.on('session/disposed', (session: Session) => {
        runtime.tracker.forget(session.id)
        runtime.grants.revokeSession(session.id)
        runtime.audits.clear(session.id)
      }),
    )
    disposers.push(registerApprovalHook(ctx, runtime))
    disposers.push(registerRequestApprovalsTool(ctx, runtime))
    disposers.push(registerAskChoicesTool(ctx))
    disposers.push(registerApprovalsCommand(ctx, runtime))
  } catch (error) {
    for (let index = disposers.length - 1; index >= 0; index -= 1) disposers[index]?.()
    runtime.dispose()
    throw error
  }
  return () => {
    for (let index = disposers.length - 1; index >= 0; index -= 1) disposers[index]?.()
    runtime.dispose()
  }
}
