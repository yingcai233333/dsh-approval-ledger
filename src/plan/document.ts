import { scrubSecrets } from '../core/redact.js'
import type { RiskLevel } from '../core/types.js'
import { modeLabel, reasonLabel, riskLabel as chineseRiskLabel, toolLabel } from '../approval/labels.js'
import type { ValidatedPlan, ValidatedPlanItem } from './types.js'

export interface PlanDocumentOptions {
  lang?: 'zh' | 'en'
  maxNoteLength?: number
}

type Lang = 'zh' | 'en'

const DEFAULT_MAX_NOTE_LENGTH = 300
const DEFAULT_MAX_TEXT_LENGTH = 1000

const MAX_ID = 32
const MAX_TOOL = 40
const MAX_TABLE_TITLE = 80
const MAX_WHY_TITLE = 120
const MAX_PATH = 120
const MAX_COMMAND = 120
const MAX_REASON = 160
const MAX_MODE = 40

/** Severity order used by the title/summary counts. */
const RISK_ORDER: readonly RiskLevel[] = ['critical', 'high', 'unknown', 'medium', 'low']

const RISK_LABELS: Record<Lang, Record<RiskLevel, string>> = {
  zh: { critical: '严重', high: '高', medium: '中', low: '低', unknown: '未知' },
  en: { critical: 'critical', high: 'high', medium: 'medium', low: 'low', unknown: 'unknown' },
}

const RISK_LEVELS: ReadonlySet<string> = new Set([
  'critical',
  'high',
  'medium',
  'low',
  'unknown',
])

function isRiskLevel(value: unknown): value is RiskLevel {
  return typeof value === 'string' && RISK_LEVELS.has(value)
}

function resolveMaxLength(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  const normalized = Math.floor(value)
  return normalized > 0 ? normalized : 0
}

function truncate(value: string, maxLength: number): string {
  if (maxLength <= 0) return ''
  if (value.length <= maxLength) return value
  return `${value.slice(0, Math.max(0, maxLength - 1))}…`
}

/**
 * Make untrusted model text safe for a Markdown approval document.
 *
 * Raw HTML, images, links (the URL is dropped, the label kept), bare URLs,
 * control characters and backticks are removed. The result is single-line,
 * whitespace-collapsed, and truncated. Non-string runtime input yields `''`.
 */
export function sanitizePlanText(value: string, maxLength?: number): string {
  if (typeof value !== 'string') return ''
  const limit = resolveMaxLength(maxLength, DEFAULT_MAX_TEXT_LENGTH)

  let text = value.replace(/\r\n?/g, '\n')

  // Raw HTML tags, including comments and tag-like autolinks.
  text = text.replace(/<[^>]*>/g, '')

  // Inline images/links: keep the label, drop the destination.
  text = text.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
  // Reference-style images/links.
  text = text.replace(/!?\[([^\]]*)\]\[[^\]]*\]/g, '$1')
  // Remaining image syntax without a destination.
  text = text.replace(/!\[([^\]]*)\]/g, '$1')
  // Link reference definitions.
  text = text.replace(/^[ \t]*\[[^\]]+\]:[^\n]*$/gm, '')
  // Bare URLs are not clickable content we want to show.
  text = text.replace(/\bhttps?:\/\/[^\s<>()[\]]+/gi, '')

  // Control characters (keep tab/newline until they are turned into spaces).
  // oxlint-disable-next-line no-control-regex
  text = text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u2028\u2029]/g, '')
  text = text.replace(/[\n\t]/g, ' ')
  text = text.replace(/\s+/g, ' ').trim()

  // Neutralize backticks so model text cannot open/close a code span.
  text = text.replace(/`/g, "'")

  return truncate(text, limit)
}

/** Scrub secrets and then apply the untrusted-text sanitizer. */
function cleanModelText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return ''
  return sanitizePlanText(scrubSecrets(value), maxLength)
}

/** Make a system-derived value safe inside a Markdown code span. */
function cleanSystemValue(value: unknown): string {
  if (typeof value !== 'string') return ''
  return scrubSecrets(value)
    // oxlint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/`/g, "'")
    .trim()
}

function codeSpan(value: unknown, maxLength: number): string {
  return `\`${truncate(cleanSystemValue(value), maxLength)}\``
}

function levelOf(item: ValidatedPlanItem): RiskLevel {
  const level: unknown = item.risk?.level
  return isRiskLevel(level) ? level : 'unknown'
}

function isAuto(item: ValidatedPlanItem): boolean {
  const level = levelOf(item)
  // Fail closed: never advertise automatic approval for critical/unknown.
  if (level === 'critical' || level === 'unknown') return false
  return item.autoEligible === true && item.manualOnly !== true
}

function riskLabel(level: RiskLevel, lang: Lang): string {
  return lang === 'zh' ? chineseRiskLabel(level) : RISK_LABELS[lang][level]
}

function countLevels(items: readonly ValidatedPlanItem[]): Record<RiskLevel, number> {
  const counts: Record<RiskLevel, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    unknown: 0,
  }
  for (const item of items) counts[levelOf(item)] += 1
  return counts
}

function riskCountSummary(counts: Record<RiskLevel, number>, lang: Lang): string {
  const parts = RISK_ORDER.filter((level) => counts[level] > 0).map(
    (level) => `${counts[level]} ${riskLabel(level, lang)}`,
  )
  if (parts.length > 0) return parts.join(' / ')
  return lang === 'zh' ? '无风险项' : 'no risks'
}

function stageNumber(item: ValidatedPlanItem): number {
  return typeof item.stage === 'number' && Number.isInteger(item.stage) && item.stage >= 0
    ? item.stage + 1
    : 1
}

function operationText(item: ValidatedPlanItem, lang: Lang): string {
  if (lang === 'zh') {
    return `${cleanModelText(toolLabel(item.tool), MAX_TOOL)} · ${targetSummary(item, 'zh')}`
  }
  const tool = cleanModelText(item.tool, MAX_TOOL)
  const title = cleanModelText(item.title, MAX_TABLE_TITLE)
  return title.length > 0 ? `${tool} · ${title}` : tool
}

function tableCell(value: string, maxLength: number): string {
  const singleLine = value.replace(/\r?\n/g, ' ')
  // Escape backslashes before pipes so a model-supplied `\|` cannot escape the
  // table separator we add.
  return truncate(singleLine, maxLength)
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
}

function dependencyText(item: ValidatedPlanItem, lang: Lang): string {
  const dependencies = Array.isArray(item.dependsOn)
    ? item.dependsOn.filter((dependency): dependency is string => typeof dependency === 'string')
    : []
  if (dependencies.length === 0) return '—'
  return dependencies
    .map((dependency) => cleanModelText(dependency, MAX_ID))
    .join(lang === 'zh' ? '、' : ', ')
}

function tableRow(item: ValidatedPlanItem, lang: Lang): string {
  const cells = [
    tableCell(cleanModelText(item.id, MAX_ID), MAX_ID),
    tableCell(operationText(item, lang), MAX_TABLE_TITLE + MAX_TOOL + 3),
    riskLabel(levelOf(item), lang),
    tableCell(dependencyText(item, lang), MAX_ID * 2),
    tableCell(String(item.uses), 8),
    isAuto(item) ? (lang === 'zh' ? '自动' : 'auto') : lang === 'zh' ? '手动' : 'manual',
  ]
  return `| ${cells.join(' | ')} |`
}

function tableBlock(items: readonly ValidatedPlanItem[], lang: Lang): string {
  const header =
    lang === 'zh'
      ? '| 项 | 操作 | 风险 | 依赖 | 次数 | 方式 |'
      : '| Item | Operation | Risk | Dependencies | Uses | Mode |'
  const separator = '|---|---|---|---|---|---|'
  const rows = items.map((item) => tableRow(item, lang))
  return [header, separator, ...rows].join('\n')
}

function stagesBlock(plan: ValidatedPlan, lang: Lang): string | undefined {
  const stages = Array.isArray(plan.stages) ? plan.stages : []
  if (stages.length === 0) return undefined

  const lines: string[] = [lang === 'zh' ? '## 执行阶段' : '## Execution stages', '']
  stages.forEach((group, index) => {
    const ids = Array.isArray(group)
      ? group
          .filter((id): id is string => typeof id === 'string')
          .map((id) => cleanModelText(id, MAX_ID))
      : []
    const joined = ids.join(lang === 'zh' ? '、' : ', ')
    lines.push(
      `- ${lang === 'zh' ? '阶段' : 'Stage'} ${index + 1}${lang === 'zh' ? '：' : ': '}${
        joined.length > 0 ? joined : '—'
      }`,
    )
  })
  return lines.join('\n')
}

function targetSummary(item: ValidatedPlanItem, lang: Lang): string {
  const parts: string[] = []
  const paths = Array.isArray(item.scope?.paths) ? item.scope.paths : []
  const commands = Array.isArray(item.scope?.commands) ? item.scope.commands : []

  if (paths.length > 0) {
    const rendered = paths
      .map((path) => codeSpan(path?.path, MAX_PATH))
      .join(lang === 'zh' ? '、' : ', ')
    parts.push(`${lang === 'zh' ? '目标' : 'paths'} ${rendered}`)
  }
  if (commands.length > 0) {
    const rendered = commands
      .map((command) => codeSpan(command?.text, MAX_COMMAND))
      .join(lang === 'zh' ? '、' : ', ')
    parts.push(`${lang === 'zh' ? '命令' : 'commands'} ${rendered}`)
  }
  if (item.scope?.args !== undefined) {
    const args = item.scope.args
    const count = args !== null && typeof args === 'object' ? Object.keys(args).length : 0
    parts.push(
      lang === 'zh'
        ? `参数（${count} 个字段，不展开）`
        : `args (${count} field${count === 1 ? '' : 's'}, not expanded)`,
    )
  }
  if (parts.length === 0) {
    return lang === 'zh' ? '未声明可匹配范围' : 'no matching scope declared'
  }
  return parts.join(lang === 'zh' ? '；' : '; ')
}

function reasonSummary(item: ValidatedPlanItem, lang: Lang): string {
  const reasons = Array.isArray(item.risk?.reasons) ? item.risk.reasons : []
  if (reasons.length === 0) return lang === 'zh' ? '未给出系统原因' : 'no system reasons given'
  if (lang === 'zh') {
    return [...new Set(reasons.map((reason) => reasonLabel(reason?.code)))].join('、')
  }
  return reasons
    .map((reason) => {
      const code = codeSpan(reason?.code, MAX_ID)
      const message = cleanModelText(reason?.message, MAX_REASON)
      return message.length > 0 ? `${code}: ${message}` : code
    })
    .join('; ')
}

function whySummary(item: ValidatedPlanItem, lang: Lang): string {
  const title = cleanModelText(item.title, MAX_WHY_TITLE)
  if (lang === 'zh') {
    return /[\u4e00-\u9fff]/.test(title)
      ? `${title}（模型文本，未验证）`
      : '系统按实际参数推导；模型未提供中文说明。'
  }
  const shown = title.length > 0 ? title : '(not provided)'
  return `${shown} (model text, unverified)`
}

function recommendation(item: ValidatedPlanItem, lang: Lang): string {
  const level = levelOf(item)
  const auto = isAuto(item)

  if (level === 'critical') {
    return lang === 'zh'
      ? '建议拒绝（严重风险永不自动放行）'
      : 'Reject recommended (critical risk is never auto-approved)'
  }
  if (level === 'unknown') {
    return lang === 'zh'
      ? '建议手动确认（风险未知，一律手动）'
      : 'Manual confirmation (unknown risk is always manual)'
  }
  if (level === 'high') {
    if (auto) {
      return lang === 'zh'
        ? '可自动放行，但需二次确认'
        : 'Auto-approve with a second confirmation'
    }
    return lang === 'zh'
      ? '建议手动确认（高风险默认不自动放行）'
      : 'Manual confirmation (high risk is manual by default)'
  }
  if (auto) {
    return lang === 'zh' ? '可自动放行' : 'Auto-approve'
  }
  return lang === 'zh' ? '建议手动确认' : 'Manual confirmation'
}

function detailBlock(
  item: ValidatedPlanItem,
  lang: Lang,
  maxNoteLength: number,
): string {
  const level = levelOf(item)
  const colon = lang === 'zh' ? '：' : ': '
  const lines: string[] = []

  lines.push(
    `### ${cleanModelText(item.id, MAX_ID)} · ${cleanModelText(
      lang === 'zh' ? toolLabel(item.tool) : item.tool,
      MAX_TOOL,
    )} · ${riskLabel(level, lang)}`,
  )
  lines.push('')
  lines.push(
    `- ${lang === 'zh' ? '是什么' : 'What'}${colon}${
      lang === 'zh' ? '工具' : 'tool'
    } ${cleanModelText(lang === 'zh' ? toolLabel(item.tool) : item.tool, MAX_TOOL)}${lang === 'zh' ? '；' : '; '}${targetSummary(item, lang)}`,
  )
  lines.push(`- ${lang === 'zh' ? '为什么' : 'Why'}${colon}${whySummary(item, lang)}`)

  const afterParts: string[] = [
    isAuto(item)
      ? lang === 'zh'
        ? '自动放行'
        : 'auto-approved'
      : lang === 'zh'
        ? '手动确认'
        : 'manual',
  ]
  const uses =
    typeof item.uses === 'number' && Number.isInteger(item.uses) && item.uses > 0 ? item.uses : 1
  afterParts.push(
    lang === 'zh' ? `${uses} 次` : `${uses} use${uses === 1 ? '' : 's'}`,
  )
  afterParts.push(
    `${lang === 'zh' ? '阶段' : 'Stage'} ${stageNumber(item)}`,
  )
  if (typeof item.mode === 'string' && item.mode.length > 0) {
    afterParts.push(
      `${lang === 'zh' ? '模式' : 'mode'} ${lang === 'zh' ? modeLabel(item.mode) : codeSpan(item.mode, MAX_MODE)}`,
    )
  }
  lines.push(
    `- ${lang === 'zh' ? '批准后' : 'After approval'}${colon}${afterParts.join(' · ')}`,
  )

  lines.push(
    `- ${
      lang === 'zh' ? '系统判断' : 'System assessment'
    }${colon}${riskLabel(level, lang)} · ${reasonSummary(item, lang)}`,
  )

  const note = cleanModelText(item.note, maxNoteLength)
  if (note.length > 0 && (lang === 'en' || /[\u4e00-\u9fff]/.test(note))) {
    lines.push(
      `- ${
        lang === 'zh' ? '模型说明（未验证）' : 'Model note (unverified)'
      }${colon}${note}`,
    )
  }

  lines.push(
    `- ${lang === 'zh' ? '建议' : 'Recommendation'}${colon}${recommendation(item, lang)}`,
  )

  return lines.join('\n')
}

/**
 * Render the plan-review Markdown shown to the user before a batch of
 * approvals. The output is deterministic: items keep plan order and stages
 * keep `plan.stages` order. Only sanitized model text, system-derived scope
 * values, and risk reasons are shown; argument values are never printed.
 */
export function renderPlanReviewDocument(
  plan: ValidatedPlan,
  options?: PlanDocumentOptions,
): string {
  const lang: Lang = options?.lang === 'en' ? 'en' : 'zh'
  const maxNoteLength = resolveMaxLength(options?.maxNoteLength, DEFAULT_MAX_NOTE_LENGTH)

  const items = Array.isArray(plan?.items) ? plan.items : []
  const stages = Array.isArray(plan?.stages) ? plan.stages : []
  const counts = countLevels(items)
  const risks = riskCountSummary(counts, lang)
  const autoCount = items.filter((item) => isAuto(item)).length
  const manualCount = items.length - autoCount

  const title =
    lang === 'zh'
      ? `# 审批计划 · ${items.length} 项 · ${risks}`
      : `# Approval plan · ${items.length} item${items.length === 1 ? '' : 's'} · ${risks}`

  const summaryFirst =
    lang === 'zh'
      ? `本计划包含 ${items.length} 项待审批操作：${autoCount} 项可自动放行，${manualCount} 项需手动确认。`
      : `This plan contains ${items.length} item${items.length === 1 ? '' : 's'}: ${autoCount} auto-approved, ${manualCount} manual.`
  const summarySecond =
    lang === 'zh'
      ? `风险分布：${risks}；共 ${stages.length} 个执行阶段。`
      : `Risk: ${risks}; ${stages.length} execution stage${stages.length === 1 ? '' : 's'}.`

  const sections: string[] = [title, `${summaryFirst}\n${summarySecond}`, tableBlock(items, lang)]

  const stagesSection = stagesBlock(plan, lang)
  if (stagesSection !== undefined) sections.push(stagesSection)

  if (items.length > 0) {
    const details = items.map((item) => detailBlock(item, lang, maxNoteLength)).join('\n\n')
    sections.push(`${lang === 'zh' ? '## 逐项详情' : '## Item details'}\n\n${details}`)
  }

  if (lang === 'zh') {
    sections.push(
      [
        '## 怎么读这份审批',
        '',
        '- **自动**：计划范围匹配且本次调用风险允许时，插件才可能直接放行；不等于整份计划里的所有操作都会自动执行。',
        '- **手动**：不会自动放行；仍需在官方审批卡上逐次确认。',
        '- **模式**：只读 / 工作区写入 / 完全访问。完全访问影响最大，通常需要单独确认。',
        '- **风险**：严重永不自动；高默认手动；未知一律手动。',
        '- **计划批准**只登记授权，实际调用还会重新判风险；计划批准不等于每次执行都放行。',
      ].join('\n'),
    )
  }

  return `${sections.join('\n\n')}\n`
}
