import { sanitizePlanText, renderPlanReviewDocument } from './document.js'
import type { PlanDocumentOptions } from './document.js'
import type { ValidatedPlan } from './types.js'
import { modeLabel, riskLabel, toolLabel } from '../approval/labels.js'

export interface PlanReviewOption {
  label: string
  description?: string
}

export interface PlanReviewQuestion {
  id: string
  question: string
  detail: string
  options: PlanReviewOption[]
  /** Must not be true for plan-review; omitted is safest. */
  multiSelect?: boolean
  intent: {
    kind: 'plan-review'
    approve: string
  }
}

export interface PlanReviewRequest {
  questions: PlanReviewQuestion[]
}

/** A normal multi-select question used after plan approval to pick grants. */
export interface PlanSelectionQuestion {
  id: string
  question: string
  detail: string
  options: PlanReviewOption[]
  multiSelect: true
}

export interface PlanReviewOptions extends PlanDocumentOptions {
  id?: string
  approveLabel?: string
  discussLabel?: string
  question?: string
}

export interface PlanSelectionOptions {
  lang?: 'zh' | 'en'
  id?: string
}

export interface PlanReviewShapeIssue {
  code: string
  message: string
}

export interface PlanReviewValidation {
  ok: boolean
  issues: PlanReviewShapeIssue[]
}

function labels(lang: 'zh' | 'en'): { approve: string; discuss: string } {
  return lang === 'zh'
    ? { approve: '批准计划', discuss: '讨论并修改' }
    : { approve: 'Approve plan', discuss: 'Discuss and revise' }
}

/**
 * Build the single plan-review question accepted by the official question UI.
 *
 * Shape requirements (see docs/runtime-notes.md): exactly one question, a
 * non-empty `detail`, `multiSelect !== true`, at most two options, an intent
 * of `plan-review`, and an option whose label equals `intent.approve`.
 * Deliberately no `callId`: dismissing "discuss" cancels the request instead
 * of leaving a dangling approval card.
 */
export function buildPlanReviewRequest(
  plan: ValidatedPlan,
  options: PlanReviewOptions = {},
): PlanReviewRequest {
  const lang = options.lang ?? 'zh'
  const defaults = labels(lang)
  const approve = sanitizePlanText(options.approveLabel ?? defaults.approve, 48) || defaults.approve
  const discuss = sanitizePlanText(options.discussLabel ?? defaults.discuss, 48) || defaults.discuss
  const question =
    sanitizePlanText(options.question ?? plan.summary, 200) ||
    (lang === 'zh' ? '审批计划' : 'Approval plan')

  let detail = ''
  try {
    detail = renderPlanReviewDocument(plan, {
      lang,
      maxNoteLength: options.maxNoteLength,
    })
  } catch {
    detail = ''
  }
  if (detail.trim().length === 0) {
    detail = `# ${question}\n\n${sanitizePlanText(plan.summary, 500)}`
  }
  detail +=
    lang === 'zh'
      ? '\n\n> 批准计划后还会再问一次：本次要授权哪些项；未勾选的项不会自动放行。'
      : '\n\n> After approving the plan you will be asked which items to authorize; unchecked items stay manual.'

  return {
    questions: [
      {
        id: sanitizePlanText(options.id ?? 'plan-review', 64) || 'plan-review',
        question,
        detail,
        options: [
          { label: approve, description: lang === 'zh' ? '批准计划后选择本次授权的项' : 'Approve the plan, then choose which items to authorize' },
          { label: discuss, description: lang === 'zh' ? '取消并让模型重写计划' : 'Cancel and ask the agent to revise' },
        ],
        intent: { kind: 'plan-review', approve },
      },
    ],
  }
}

/**
 * Build a second, normal multi-select question after the plan-review card has
 * been approved. Only selected auto-eligible items receive grants; unselected
 * items stay manual. This is the user's per-item veto/selection point and does
 * not change the official plan-review card (which cannot be multi-select).
 */
export function buildPlanSelectionQuestion(
  plan: ValidatedPlan,
  options: PlanSelectionOptions = {},
): PlanSelectionQuestion | undefined {
  const lang = options.lang ?? 'zh'
  const selectable = plan.items.filter((item) => item.autoEligible && !item.manualOnly)
  if (selectable.length === 0) return undefined

  const labels = selectable.map((item) => sanitizePlanText(item.id, 32))
  const optionList: PlanReviewOption[] = selectable.map((item, index) => ({
    label: labels[index] ?? item.id,
    description: sanitizePlanText(
      lang === 'zh'
        ? `${toolLabel(item.tool)} · ${riskLabel(item.risk.level)} · ${
            /[\u4e00-\u9fff]/.test(item.title) ? item.title : '已声明操作'
          }${item.mode === undefined ? '' : ` · ${modeLabel(item.mode)}`}`
        : `${item.tool} · ${item.risk.level} · ${item.title}`,
      160,
    ),
  }))

  return {
    id: sanitizePlanText(options.id ?? 'items', 64) || 'items',
    question:
      lang === 'zh'
        ? `本次要授权哪些项？（已选 ${selectable.length} 项可自动匹配）`
        : `Which items should be authorized? (${selectable.length} auto-eligible)`,
    detail:
      lang === 'zh'
        ? '只给勾选项安装授权；未勾选项保持手动，不会自动放行。高风险/未知项仍会逐次走官方审批。'
        : 'Only checked items receive grants; unchecked items stay manual. High/unknown items still use the official approval card per call.',
    options: optionList,
    multiSelect: true,
  }
}

/**
 * Returns issues instead of throwing so the caller can fall back to the
 * official approval path.
 */
export function validatePlanReviewShape(value: unknown): PlanReviewValidation {
  const issues: PlanReviewShapeIssue[] = []
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, issues: [{ code: 'not-object', message: 'plan-review request must be an object' }] }
  }
  const questions = (value as { questions?: unknown }).questions
  if (!Array.isArray(questions) || questions.length !== 1) {
    issues.push({ code: 'question-count', message: 'plan-review needs exactly one question' })
  }
  const question = Array.isArray(questions) ? (questions[0] as Record<string, unknown> | undefined) : undefined
  if (question === undefined || typeof question !== 'object' || question === null) {
    issues.push({ code: 'question-missing', message: 'question object is missing' })
    return { ok: false, issues }
  }
  if (typeof question.id !== 'string' || question.id.length === 0) {
    issues.push({ code: 'id-missing', message: 'question id must be a non-empty string' })
  }
  if (typeof question.detail !== 'string' || question.detail.trim().length === 0) {
    issues.push({ code: 'detail-empty', message: 'detail must be a non-empty string' })
  }
  if (question.multiSelect === true) {
    issues.push({ code: 'multi-select', message: 'plan-review cannot be multi-select' })
  }
  const options = question.options
  if (!Array.isArray(options) || options.length === 0 || options.length > 2) {
    issues.push({ code: 'option-count', message: 'plan-review needs one or two options' })
  }
  const intent = question.intent
  if (typeof intent !== 'object' || intent === null) {
    issues.push({ code: 'intent-missing', message: 'intent is missing' })
  } else {
    const intentRecord = intent as Record<string, unknown>
    if (intentRecord.kind !== 'plan-review') {
      issues.push({ code: 'intent-kind', message: 'intent.kind must be plan-review' })
    }
    if (Array.isArray(options)) {
      const labels = options
        .map((option) =>
          typeof option === 'object' && option !== null
            ? (option as { label?: unknown }).label
            : undefined,
        )
        .filter((label): label is string => typeof label === 'string')
      if (typeof intentRecord.approve !== 'string' || !labels.includes(intentRecord.approve)) {
        issues.push({
          code: 'approve-label',
          message: 'intent.approve must equal one option label',
        })
      }
    }
  }
  if ('callId' in question && question.callId !== undefined) {
    issues.push({ code: 'call-id', message: 'plan-review must not set callId' })
  }
  return { ok: issues.length === 0, issues }
}
