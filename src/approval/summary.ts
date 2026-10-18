import { scrubSecrets } from '../core/redact.js'
import type { RiskAssessment, RiskLevel } from '../core/types.js'
import { assessRisk } from '../risk/assess.js'
import { extractApprovalTarget } from './target.js'
import type { PathPlatform, PathProbe } from '../path/types.js'

export interface ApprovalSummaryInput {
  tool: string
  args?: unknown
  mode?: string
  cwd?: string
  platform?: PathPlatform
  probe?: PathProbe
}

export interface ApprovalSummary {
  /** One-line title for the official approval card. */
  title: string
  /** Read-only detail for the session-header modal. */
  detail: string
  /** Scrubbed short target; never a full command or argument blob. */
  targetSummary: string
  risk: RiskAssessment
  mode: string
}

const RISK_LABELS: Record<'zh' | 'en', Record<RiskLevel, string>> = {
  zh: { critical: '严重', high: '高', medium: '中', low: '低', unknown: '未知' },
  en: { critical: 'critical', high: 'high', medium: 'medium', low: 'low', unknown: 'unknown' },
}

const LABELS: Record<
  'zh' | 'en',
  {
    approval: string
    mode: string
    target: string
    risk: string
    recommendation: string
    after: string
    note: string
    afterText: string
    noteText: string
  }
> = {
  zh: {
    approval: '审批',
    mode: '模式',
    target: '目标',
    risk: '风险',
    recommendation: '建议',
    after: '批准后',
    note: '说明',
    afterText: '只允许本次调用；不会生成永久授权，turn 结束即失效。',
    noteText: '目标摘要由实际参数推导；模型文案不作为判断依据。',
  },
  en: {
    approval: 'Approval',
    mode: 'Mode',
    target: 'Target',
    risk: 'Risk',
    recommendation: 'Recommendation',
    after: 'After approval',
    note: 'Note',
    afterText: 'Allows this call only; no permanent grant, and it expires at turn end.',
    noteText: 'Target summary is derived from the actual request; model text is not a decision input.',
  },
}

// oxlint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/g

function sanitizeLine(value: unknown, max = 140): string {
  if (typeof value !== 'string') return ''
  return scrubSecrets(value).replace(CONTROL, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
}

function recommendation(risk: RiskAssessment, lang: 'zh' | 'en'): string {
  if (risk.level === 'critical') {
    return lang === 'zh'
      ? '建议拒绝；critical 永不自动放行。'
      : 'Recommend rejection; critical is never auto-approved.'
  }
  if (risk.level === 'unknown') {
    return lang === 'zh'
      ? '无法安全分类；保持手动。'
      : 'Cannot be classified safely; stay manual.'
  }
  if (risk.level === 'high') {
    return lang === 'zh'
      ? '默认手动；开启 high opt-in 后仍需二次确认。'
      : 'Manual by default; high opt-in still requires a second confirmation.'
  }
  if (risk.autoEligible) {
    return lang === 'zh'
      ? '风险门允许自动；本插件只应放行这一次。'
      : 'The risk gate allows auto-approval for this single call.'
  }
  return lang === 'zh' ? '风险门不允许自动；保持手动。' : 'The risk gate does not allow auto-approval.'
}

/**
 * Build a card title and read-only detail from the *actual* request.
 *
 * Model text is never used here. The title always contains the real tool,
 * normalized target summary, and the actual requested mode; the detail never
 * includes full arguments, content, or an un-scrubbed reason.
 */
export function describeApproval(
  input: ApprovalSummaryInput,
  lang: 'zh' | 'en' = 'zh',
): ApprovalSummary {
  try {
    const tool = sanitizeLine(input.tool, 48) || 'unknown'
    const mode = sanitizeLine(input.mode, 32) || (lang === 'zh' ? '模式未指定' : 'mode?')
    const target = extractApprovalTarget({
      args: input.args,
      cwd: input.cwd,
      platform: input.platform,
      probe: input.probe,
    })

    const risk = assessRisk({
      tool,
      args: target.riskArgs,
      mode: input.mode,
      cwd: input.cwd,
      platform: input.platform,
      probe: input.probe,
    })

    const labels = LABELS[lang]
    const riskLabel = RISK_LABELS[lang][risk.level]
    let targetSummary = target.summary
    if (lang === 'zh') {
      if (target.parseError === 'unparsed') targetSummary = '（无法解析）'
      else if (target.parseError === 'unsafe-path') targetSummary = '（不安全路径）'
      else if (target.parseError === 'invalid-command') targetSummary = '（无效命令）'
    }
    const title = sanitizeLine(
      `${risk.level === 'critical' ? `[${riskLabel}] ` : ''}${tool} · ${targetSummary} · ${mode}`,
      160,
    )
    const reasonCodes = risk.reasons.map((reason) => reason.code).join(', ') || 'none'
    const detail = [
      `${labels.approval}: ${tool}`,
      `${labels.mode}: ${mode}`,
      `${labels.target}: ${targetSummary}`,
      `${labels.risk}: ${riskLabel} (${reasonCodes})`,
      `${labels.recommendation}: ${recommendation(risk, lang)}`,
      `${labels.after}: ${labels.afterText}`,
      `${labels.note}: ${labels.noteText}`,
    ].join('\n')

    return { title, detail, targetSummary, risk, mode }
  } catch {
    const risk: RiskAssessment = {
      level: 'unknown',
      reasons: [{ code: 'summary-error', level: 'unknown', message: 'summary could not be built' }],
      autoEligible: false,
      requiresSecondConfirm: false,
      policyVersion: 0,
    }
    return {
      title: '[未知] approval · (unparsed) · mode?',
      detail: '无法解析审批请求；保持手动。',
      targetSummary: '(unparsed)',
      risk,
      mode: 'mode?',
    }
  }
}

/**
 * One-line bilingual title for `displayReason`; the raw reason remains in the
 * session log and the read-only detail modal.
 */
export function buildApprovalDisplayReason(input: ApprovalSummaryInput): {
  en: string
  zh: string
} {
  return {
    en: describeApproval(input, 'en').title,
    zh: describeApproval(input, 'zh').title,
  }
}
