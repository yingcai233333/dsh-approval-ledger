import type { RiskLevel } from '../core/types.js'
import type { AuditReplay, ReplayPlan, ReplayRow, ReplayStatus } from './replay.js'

export interface AuditReportOptions {
  lang?: 'zh' | 'en'
  generatedAt?: number
}

const RISK_LABELS: Record<'zh' | 'en', Record<RiskLevel, string>> = {
  zh: { critical: '严重', high: '高', medium: '中', low: '低', unknown: '未知' },
  en: { critical: 'critical', high: 'high', medium: 'medium', low: 'low', unknown: 'unknown' },
}

const STATUS_LABELS: Record<'zh' | 'en', Record<ReplayStatus, string>> = {
  zh: {
    verified: '已核对',
    unattributed: '未归属',
    unverifiable: '无法验证',
    mismatch: '不一致',
    orphan: '孤立记录',
    pending: '待决定',
  },
  en: {
    verified: 'verified',
    unattributed: 'unattributed',
    unverifiable: 'unverifiable',
    mismatch: 'mismatch',
    orphan: 'orphan',
    pending: 'pending',
  },
}

const OUTCOME_LABELS: Record<'zh' | 'en', Record<string, string>> = {
  zh: {
    'allowed-once': '允许一次',
    rejected: '拒绝',
    cancelled: '取消',
    unavailable: '不可用',
  },
  en: {
    'allowed-once': 'allowed once',
    rejected: 'rejected',
    cancelled: 'cancelled',
    unavailable: 'unavailable',
  },
}

const PLAN_STATUS_LABELS: Record<'zh' | 'en', Record<ReplayPlan['status'], string>> = {
  zh: { verified: '已核对', unverifiable: '无法验证', 'missing-meta': '缺少计划元数据' },
  en: { verified: 'verified', unverifiable: 'unverifiable', 'missing-meta': 'missing plan metadata' },
}

function escapeCell(value: string, max = 120): string {
  const singleLine = value.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|')
  return singleLine.length > max ? `${singleLine.slice(0, max)}…` : singleLine
}

function formatTime(value: number | undefined): string {
  if (value === undefined) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toISOString()
}

function hashPrefix(value: string | undefined): string {
  if (value === undefined) return '—'
  const hex = value.startsWith('sha256:') ? value.slice(7) : value
  return `${hex.slice(0, 12)}…`
}

function rowTarget(row: ReplayRow): string {
  if (row.targetSummary !== undefined && row.targetSummary.length > 0) return row.targetSummary
  return hashPrefix(row.targetHash)
}

function tableHeader(lang: 'zh' | 'en'): string {
  return lang === 'zh'
    ? '| 项 | 工具 | 风险 | 目标 | 状态 | 决定 | 时间 |\n|---|---|---|---|---|---|---|'
    : '| Item | Tool | Risk | Target | Status | Decision | Time |\n|---|---|---|---|---|---|---|'
}

function rowLine(row: ReplayRow, lang: 'zh' | 'en'): string {
  const decision = row.decision === undefined ? '—' : OUTCOME_LABELS[lang][row.decision] ?? row.decision
  return `| ${escapeCell(row.itemId ?? '—', 32)} | ${escapeCell(row.tool ?? '—', 48)} | ${
    row.risk === undefined ? '—' : RISK_LABELS[lang][row.risk]
  } | ${escapeCell(rowTarget(row))} | ${STATUS_LABELS[lang][row.status]} | ${decision} | ${formatTime(
    row.time,
  )} |`
}

function issueLine(codes: readonly string[], lang: 'zh' | 'en'): string {
  if (codes.length === 0) return ''
  const unique = [...new Set(codes)]
  return lang === 'zh'
    ? `  校验问题：${unique.join(', ')}`
    : `  Issues: ${unique.join(', ')}`
}

/**
 * Render a deterministic Markdown report. Only scrubbed summaries and hashes
 * are shown; raw reasons, parameters, and commands are never included.
 */
export function renderAuditReport(
  replay: AuditReplay,
  options: AuditReportOptions = {},
): string {
  const lang = options.lang ?? 'zh'
  const generatedAt = options.generatedAt ?? replay.generatedAt
  const lines: string[] = []

  lines.push(lang === 'zh' ? '## 审批决策记录' : '## Approval decision ledger')
  lines.push('')
  lines.push(
    lang === 'zh'
      ? `生成时间：${formatTime(generatedAt)}`
      : `Generated: ${formatTime(generatedAt)}`,
  )
  lines.push('')

  for (const plan of replay.plans) {
    lines.push(
      `### ${lang === 'zh' ? '计划' : 'Plan'} ${plan.planId} · ${
        PLAN_STATUS_LABELS[lang][plan.status]
      }`,
    )
    if (plan.decision !== undefined) {
      lines.push(`${lang === 'zh' ? '决策' : 'Decision'}：${escapeCell(plan.decision, 40)}`)
    }
    if (plan.rows.length === 0) {
      lines.push(lang === 'zh' ? '无调用记录。' : 'No calls recorded.')
    } else {
      lines.push('')
      lines.push(tableHeader(lang))
      for (const row of plan.rows) lines.push(rowLine(row, lang))
    }
    const planIssues = issueLine(plan.issues, lang)
    if (planIssues.length > 0) lines.push(planIssues)
    lines.push('')
  }

  const planless = replay.rows.filter(
    (row) =>
      row.planId === undefined &&
      row.status !== 'orphan' &&
      row.status !== 'unattributed',
  )
  if (planless.length > 0) {
    lines.push(lang === 'zh' ? '### 无计划决定' : '### Decisions without a plan')
    lines.push('')
    lines.push(tableHeader(lang))
    for (const row of planless) lines.push(rowLine(row, lang))
    lines.push('')
  }

  if (replay.unattributed.length > 0) {
    lines.push(lang === 'zh' ? '### 未归属决定' : '### Unattributed decisions')
    lines.push('')
    lines.push(tableHeader(lang))
    for (const row of replay.unattributed) lines.push(rowLine(row, lang))
    lines.push('')
  }

  if (replay.orphans.length > 0) {
    lines.push(lang === 'zh' ? '### 孤立账本记录（无审批事实）' : '### Orphan ledger records')
    lines.push('')
    lines.push(tableHeader(lang))
    for (const row of replay.orphans) lines.push(rowLine(row, lang))
    lines.push('')
  }

  if (replay.rows.length === 0) {
    lines.push(lang === 'zh' ? '无记录。' : 'No records.')
    lines.push('')
  }

  const counts = replay.counts
  lines.push(
    lang === 'zh'
      ? `校验：${counts.decisions} 条审批决定，${counts.records} 条审计记录，${counts.unattributed} 条未归属，${counts.unverifiable} 条无法验证，${counts.mismatch} 条不一致，${counts.orphans} 条孤立记录。`
      : `Check: ${counts.decisions} decisions, ${counts.records} records, ${counts.unattributed} unattributed, ${counts.unverifiable} unverifiable, ${counts.mismatch} mismatched, ${counts.orphans} orphan.`,
  )

  if (replay.issues.length > 0) {
    const codes = [...new Set(replay.issues.map((issue) => issue.code))].slice(0, 10)
    lines.push(
      lang === 'zh'
        ? `解析问题：${codes.join(', ')}`
        : `Parse issues: ${codes.join(', ')}`,
    )
  }

  return `${lines.join('\n')}\n`
}
