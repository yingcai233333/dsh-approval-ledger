import { isPlainObject } from '../core/json.js'
import { sha256Tag } from '../core/hash.js'
import { RISK_RANK } from '../core/types.js'
import type { RiskLevel } from '../core/types.js'
import { extractApprovalTarget } from '../approval/target.js'
import { canonicalTargetValue } from './record.js'
import {
  MATCHER_VERSION,
  RISK_POLICY_VERSION,
  SCHEMA_VERSION,
} from '../core/version.js'
import { validateAuditRecord } from './schema.js'
import type { AuditIssue, AuditRecord, ApprovalOutcome } from './types.js'
import { APPROVAL_OUTCOMES } from './types.js'

export type ReplayStatus =
  | 'verified'
  | 'unattributed'
  | 'unverifiable'
  | 'mismatch'
  | 'orphan'
  | 'pending'

export interface ReplayRow {
  callId: string
  tool?: string
  turn?: number
  time?: number
  decision?: ApprovalOutcome
  planId?: string
  itemId?: string
  risk?: RiskLevel
  mode?: string
  targetHash?: string
  targetSummary?: string
  matchedBy?: string
  status: ReplayStatus
  issues: string[]
}

export interface ReplayPlanItem {
  id: string
  tool?: string
  risk?: RiskLevel
  uses?: number
  status: 'matched' | 'unused'
  row?: ReplayRow
}

export interface ReplayPlan {
  planId: string
  decision?: string
  schemaVersion?: number
  matcherVersion?: number
  riskPolicyVersion?: number
  items: ReplayPlanItem[]
  rows: ReplayRow[]
  status: 'verified' | 'unverifiable' | 'missing-meta'
  issues: string[]
}

export interface ReplayCounts {
  facts: number
  decisions: number
  records: number
  verified: number
  unattributed: number
  unverifiable: number
  mismatch: number
  orphans: number
  pending: number
  plans: number
}

export interface AuditReplay {
  rows: ReplayRow[]
  plans: ReplayPlan[]
  unattributed: ReplayRow[]
  orphans: ReplayRow[]
  issues: AuditIssue[]
  counts: ReplayCounts
  generatedAt: number
}

export interface ReplayVersions {
  schemaVersion?: number
  matcherVersion?: number
  riskPolicyVersion?: number
}

export interface ReplayInput {
  sessionId?: string
  facts: readonly unknown[]
  ledger: readonly unknown[]
  /** Extra plan metadata; tool/result.meta entries are also collected. */
  planMetas?: readonly unknown[]
  /** Session cwd used to canonicalize relative tool-call targets. */
  cwd?: string
  now?: number
  versions?: ReplayVersions
}

interface ParsedApproval {
  callId: string
  toolName?: string
  seq?: number
  time?: number
  turn?: number
  decision?: ApprovalOutcome
}

interface ParsedPlanMeta {
  planId: string
  decision?: string
  schemaVersion?: number
  matcherVersion?: number
  riskPolicyVersion?: number
  items: {
    id: string
    tool?: string
    risk?: RiskLevel
    uses?: number
    targetHash?: string
  }[]
}

interface ParsedCall {
  callId: string
  toolName?: string
  targetHash?: string
  seq?: number
  time?: number
  turn?: number
}

interface ParsedFacts {
  asked: ParsedApproval[]
  decided: ParsedApproval[]
  calls: ParsedCall[]
  toolNames: Map<string, string>
  planMetas: unknown[]
  turnRanges: { turn: number; start?: number; end?: number }[]
}

function readString(value: unknown, max = 256): string | undefined {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= max &&
    // oxlint-disable-next-line no-control-regex
    !/[\u0000-\u001f\u007f]/.test(value)
    ? value
    : undefined
}

function readInteger(value: unknown, minimum = 0): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= minimum
    ? value
    : undefined
}

function readRisk(value: unknown): RiskLevel | undefined {
  return typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(RISK_RANK, value)
    ? (value as RiskLevel)
    : undefined
}

function readOutcome(value: unknown): ApprovalOutcome | undefined {
  return typeof value === 'string' && APPROVAL_OUTCOMES.includes(value as ApprovalOutcome)
    ? (value as ApprovalOutcome)
    : undefined
}

function parseFacts(
  facts: readonly unknown[],
  issues: AuditIssue[],
  cwd?: string,
): ParsedFacts {
  const parsed: ParsedFacts = {
    asked: [],
    decided: [],
    calls: [],
    toolNames: new Map(),
    planMetas: [],
    turnRanges: [],
  }

  const turnEvents: { type: 'start' | 'end'; turn: number; seq: number }[] = []

  facts.forEach((raw, index) => {
    if (!isPlainObject(raw)) {
      issues.push({ code: 'invalid-fact', message: `fact ${index} is not an object` })
      return
    }
    const type = readString(raw.type, 64)
    if (type === undefined) {
      issues.push({ code: 'invalid-fact', message: `fact ${index} has no type` })
      return
    }
    const seq = raw.seq === undefined ? undefined : readInteger(raw.seq)
    const time = raw.time === undefined ? undefined : readInteger(raw.time)
    const turn = raw.turn === undefined ? undefined : readInteger(raw.turn)
    const callId = readString(raw.callId, 256)
    const toolName = readString(raw.toolName, 128)

    switch (type) {
      case 'approval/asked': {
        if (callId === undefined) {
          issues.push({ code: 'invalid-fact', message: `approval/asked fact ${index} has no callId` })
          return
        }
        parsed.asked.push({ callId, toolName, seq, time, turn })
        return
      }
      case 'approval/decided': {
        if (callId === undefined) {
          issues.push({ code: 'invalid-fact', message: `approval/decided fact ${index} has no callId` })
          return
        }
        const decision = readOutcome(raw.decision)
        if (decision === undefined) {
          issues.push({
            code: 'invalid-fact',
            message: `approval/decided fact ${index} has no valid decision`,
            callId,
          })
          return
        }
        parsed.decided.push({ callId, toolName, seq, time, turn, decision })
        return
      }
      case 'tool/call': {
        if (callId !== undefined) {
          if (toolName !== undefined) parsed.toolNames.set(callId, toolName)
          const target = extractApprovalTarget({ args: raw.args, cwd })
          const targetHash =
            target.value === undefined
              ? undefined
              : sha256Tag(canonicalTargetValue({ kind: target.kind, value: target.value }))
          parsed.calls.push({ callId, toolName, targetHash, seq, time, turn })
        }
        return
      }
      case 'tool/result': {
        if (raw.meta !== undefined) parsed.planMetas.push(raw.meta)
        return
      }
      case 'turn/start':
      case 'turn/end': {
        if (turn === undefined || seq === undefined) {
          issues.push({
            code: 'invalid-fact',
            message: `turn fact ${index} needs a turn and seq`,
          })
          return
        }
        turnEvents.push({ type: type === 'turn/start' ? 'start' : 'end', turn, seq })
        return
      }
      default:
        // Other durable session events are irrelevant but not errors.
        return
    }
  })

  turnEvents.sort((a, b) => a.seq - b.seq)
  let current: { turn: number; start?: number } | undefined
  for (const event of turnEvents) {
    if (event.type === 'start') {
      if (current !== undefined) parsed.turnRanges.push(current)
      current = { turn: event.turn, start: event.seq }
    } else if (current !== undefined && current.turn === event.turn) {
      parsed.turnRanges.push({ turn: current.turn, start: current.start, end: event.seq })
      current = undefined
    }
  }
  if (current !== undefined) parsed.turnRanges.push(current)

  // Deduplicate decisions by callId; a duplicate is a malformed log.
  const seen = new Set<string>()
  parsed.decided = parsed.decided.filter((item) => {
    if (seen.has(item.callId)) {
      issues.push({
        code: 'duplicate-decision',
        message: 'approval/decided appears more than once for one callId',
        callId: item.callId,
      })
      return false
    }
    seen.add(item.callId)
    return true
  })

  const seenAsked = new Set<string>()
  parsed.asked = parsed.asked.filter((item) => {
    if (seenAsked.has(item.callId)) {
      issues.push({
        code: 'duplicate-asked',
        message: 'approval/asked appears more than once for one callId',
        callId: item.callId,
      })
      return false
    }
    seenAsked.add(item.callId)
    return true
  })

  return parsed
}

function inferTurn(
  ranges: readonly { turn: number; start?: number; end?: number }[],
  seq: number | undefined,
  explicit: number | undefined,
): number | undefined {
  if (explicit !== undefined) return explicit
  if (seq === undefined) return undefined
  let found: number | undefined
  for (const range of ranges) {
    if (range.start !== undefined && seq >= range.start && (range.end === undefined || seq <= range.end)) {
      found = range.turn
    }
  }
  return found
}

function parsePlanMeta(raw: unknown, issues: AuditIssue[]): ParsedPlanMeta | undefined {
  if (!isPlainObject(raw)) return undefined
  const planId = readString(raw.planId, 128)
  if (planId === undefined) return undefined
  const meta: ParsedPlanMeta = {
    planId,
    decision: readString(raw.decision, 64),
    schemaVersion: raw.schemaVersion === undefined ? undefined : readInteger(raw.schemaVersion, 1),
    matcherVersion:
      raw.matcherVersion === undefined ? undefined : readInteger(raw.matcherVersion, 1),
    riskPolicyVersion:
      raw.riskPolicyVersion === undefined
        ? undefined
        : readInteger(raw.riskPolicyVersion, 1),
    items: [],
  }
  if (Array.isArray(raw.items)) {
    for (const item of raw.items) {
      if (!isPlainObject(item)) continue
      const id = readString(item.id, 128)
      if (id === undefined) continue
      meta.items.push({
        id,
        tool: readString(item.tool, 128),
        risk: readRisk(item.risk),
        uses: item.uses === undefined ? undefined : readInteger(item.uses, 1),
        targetHash: readString(item.targetHash, 128),
      })
    }
  } else if (raw.items !== undefined) {
    issues.push({
      code: 'invalid-plan-meta',
      message: `plan ${planId} has an invalid items field`,
    })
  }
  return meta
}

function emptyReplay(generatedAt: number, issues: AuditIssue[]): AuditReplay {
  return {
    rows: [],
    plans: [],
    unattributed: [],
    orphans: [],
    issues,
    counts: {
      facts: 0,
      decisions: 0,
      records: 0,
      verified: 0,
      unattributed: 0,
      unverifiable: 0,
      mismatch: 0,
      orphans: 0,
      pending: 0,
      plans: 0,
    },
    generatedAt,
  }
}

/**
 * Join session-log facts, plan metadata, and the plugin ledger.
 *
 * The join key is `callId`. Missing evidence is reported, never guessed:
 * missing ledger rows are `unattributed`, version drift is `unverifiable`,
 * and disagreements are `mismatch`.
 */
export function replayAudit(input: ReplayInput): AuditReplay {
  const generatedAt = input.now ?? Date.now()
  try {
    if (
      typeof input !== 'object' ||
      input === null ||
      !Array.isArray(input.facts) ||
      !Array.isArray(input.ledger)
    ) {
      return emptyReplay(generatedAt, [
        { code: 'invalid-input', message: 'replay input needs facts and ledger arrays' },
      ])
    }

    const issues: AuditIssue[] = []
    const versions = {
      schemaVersion: input.versions?.schemaVersion ?? SCHEMA_VERSION,
      matcherVersion: input.versions?.matcherVersion ?? MATCHER_VERSION,
      riskPolicyVersion: input.versions?.riskPolicyVersion ?? RISK_POLICY_VERSION,
    }

    const parsed = parseFacts(input.facts, issues, input.cwd)

    const recordsByCall = new Map<string, AuditRecord>()
    for (const raw of input.ledger) {
      const validation = validateAuditRecord(raw)
      if (!validation.ok) {
        issues.push(...validation.issues)
        continue
      }
      const record = validation.record
      if (input.sessionId !== undefined && record.sessionId !== input.sessionId) {
        issues.push({
          code: 'session-mismatch',
          message: 'ledger record belongs to a different session',
          callId: record.callId,
        })
      }
      if (recordsByCall.has(record.callId)) {
        issues.push({
          code: 'duplicate-record',
          message: 'ledger contains more than one record for one callId',
          callId: record.callId,
        })
        continue
      }
      recordsByCall.set(record.callId, record)
    }

    const metas: ParsedPlanMeta[] = []
    const metaIds = new Set<string>()
    const allMetaInputs = [...(input.planMetas ?? []), ...parsed.planMetas]
    for (const raw of allMetaInputs) {
      const candidate = isPlainObject(raw) && isPlainObject(raw.approvalLedger)
        ? raw.approvalLedger
        : raw
      const meta = parsePlanMeta(candidate, issues)
      if (meta === undefined) continue
      if (metaIds.has(meta.planId)) {
        issues.push({
          code: 'duplicate-plan-meta',
          message: `plan ${meta.planId} has more than one metadata record`,
        })
        continue
      }
      metaIds.add(meta.planId)
      metas.push(meta)
    }

    const plansById = new Map<string, ParsedPlanMeta>()
    for (const meta of metas) plansById.set(meta.planId, meta)

    const planTargets = new Map<string, { planId: string; itemId: string; risk?: RiskLevel }>()
    for (const meta of metas) {
      for (const item of meta.items) {
        if (item.targetHash === undefined) continue
        planTargets.set(`${item.tool ?? ''}|${item.targetHash}`, {
          planId: meta.planId,
          itemId: item.id,
          risk: item.risk,
        })
      }
    }
    const callFactsById = new Map(parsed.calls.map((call) => [call.callId, call]))

    const rows: ReplayRow[] = []
    const decidedCallIds = new Set(parsed.decided.map((item) => item.callId))
    const askedCallIds = new Set(parsed.asked.map((item) => item.callId))

    for (const fact of parsed.decided) {
      const record = recordsByCall.get(fact.callId)
      const callFact = callFactsById.get(fact.callId)
      const matched =
        callFact?.toolName === undefined || callFact.targetHash === undefined
          ? undefined
          : planTargets.get(`${callFact.toolName}|${callFact.targetHash}`)
      const tool =
        fact.toolName ?? parsed.toolNames.get(fact.callId) ?? record?.tool
      const turn = inferTurn(parsed.turnRanges, fact.seq, fact.turn)
      const rowIssues: string[] = []
      if (!askedCallIds.has(fact.callId)) rowIssues.push('missing-asked-fact')
      const row: ReplayRow = {
        callId: fact.callId,
        tool,
        turn,
        time: fact.time ?? record?.time,
        decision: fact.decision,
        status: 'unattributed',
        issues: rowIssues,
      }

      if (record === undefined) {
        rowIssues.push('missing-ledger-record')
        if (matched !== undefined) {
          row.planId = matched.planId
          row.itemId = matched.itemId
          row.risk = matched.risk
          row.matchedBy = 'plan-item'
        }
      } else {
        row.planId = record.planId
        row.itemId = record.itemId
        row.risk = record.risk
        row.mode = record.mode
        row.targetHash = record.targetHash
        row.targetSummary = record.targetSummary
        row.matchedBy = record.matchedBy

        if (row.planId === undefined && matched !== undefined) {
          row.planId = matched.planId
          row.itemId = matched.itemId
          row.risk ??= matched.risk
          row.matchedBy = 'plan-item'
        }

        if (record.schemaVersion !== versions.schemaVersion) {
          row.status = 'unverifiable'
          rowIssues.push('schema-version-mismatch')
        } else if (record.matcherVersion !== versions.matcherVersion) {
          row.status = 'unverifiable'
          rowIssues.push(
            record.matcherVersion === undefined
              ? 'missing-matcher-version'
              : 'matcher-version-mismatch',
          )
        } else if (record.riskPolicyVersion !== versions.riskPolicyVersion) {
          row.status = 'unverifiable'
          rowIssues.push(
            record.riskPolicyVersion === undefined
              ? 'missing-risk-policy-version'
              : 'risk-policy-version-mismatch',
          )
        } else if (record.sessionId !== (input.sessionId ?? record.sessionId)) {
          row.status = 'unverifiable'
          rowIssues.push('session-mismatch')
        } else if (record.outcome !== fact.decision) {
          row.status = 'mismatch'
          rowIssues.push('outcome-mismatch')
        } else if (tool !== undefined && record.tool !== tool) {
          row.status = 'mismatch'
          rowIssues.push('tool-mismatch')
        } else {
          row.status = 'verified'
        }

        if (record.planId !== undefined && !plansById.has(record.planId)) {
          if (row.status === 'verified') row.status = 'unverifiable'
          rowIssues.push('missing-plan-meta')
        }
      }
      rows.push(row)
    }

    const askedOnly = parsed.asked.filter((item) => !decidedCallIds.has(item.callId))
    for (const fact of askedOnly) {
      const record = recordsByCall.get(fact.callId)
      const tool = fact.toolName ?? parsed.toolNames.get(fact.callId)
      const row: ReplayRow = {
        callId: fact.callId,
        tool,
        turn: inferTurn(parsed.turnRanges, fact.seq, fact.turn),
        time: fact.time ?? record?.time,
        status: 'pending',
        issues: ['pending-decision'],
      }
      if (record !== undefined) {
        row.planId = record.planId
        row.itemId = record.itemId
        row.risk = record.risk
        row.mode = record.mode
        row.targetHash = record.targetHash
        row.targetSummary = record.targetSummary
        row.matchedBy = record.matchedBy
      }
      rows.push(row)
    }

    const knownCallIds = new Set([
      ...parsed.asked.map((item) => item.callId),
      ...parsed.decided.map((item) => item.callId),
    ])

    // Calls that never produced an approval event are still evidence of an
    // execution. Report them as unattributed instead of silently dropping them.
    for (const call of parsed.calls) {
      if (knownCallIds.has(call.callId)) continue
      const record = recordsByCall.get(call.callId)
      const matched =
        call.toolName === undefined || call.targetHash === undefined
          ? undefined
          : planTargets.get(`${call.toolName}|${call.targetHash}`)
      rows.push({
        callId: call.callId,
        tool: call.toolName ?? record?.tool,
        turn: inferTurn(parsed.turnRanges, call.seq, call.turn),
        time: call.time ?? record?.time,
        planId: record?.planId ?? matched?.planId,
        itemId: record?.itemId ?? matched?.itemId,
        risk: record?.risk ?? matched?.risk,
        mode: record?.mode,
        targetHash: record?.targetHash ?? call.targetHash,
        targetSummary: record?.targetSummary,
        matchedBy: record?.matchedBy ?? (matched === undefined ? undefined : 'plan-item'),
        status: matched === undefined ? 'unattributed' : 'unverifiable',
        issues: ['no-approval-fact'],
      })
      knownCallIds.add(call.callId)
    }

    for (const record of recordsByCall.values()) {
      if (knownCallIds.has(record.callId)) continue
      rows.push({
        callId: record.callId,
        tool: record.tool,
        time: record.time,
        planId: record.planId,
        itemId: record.itemId,
        risk: record.risk,
        mode: record.mode,
        targetHash: record.targetHash,
        targetSummary: record.targetSummary,
        matchedBy: record.matchedBy,
        status: 'orphan',
        issues: ['no-approval-fact'],
      })
    }

    rows.sort((a, b) => {
      const turnA = a.turn ?? Number.MAX_SAFE_INTEGER
      const turnB = b.turn ?? Number.MAX_SAFE_INTEGER
      if (turnA !== turnB) return turnA - turnB
      const timeA = a.time ?? 0
      const timeB = b.time ?? 0
      if (timeA !== timeB) return timeA - timeB
      return a.callId.localeCompare(b.callId)
    })

    const rowsByPlan = new Map<string, ReplayRow[]>()
    for (const row of rows) {
      if (row.planId === undefined) continue
      const group = rowsByPlan.get(row.planId)
      if (group === undefined) rowsByPlan.set(row.planId, [row])
      else group.push(row)
    }

    const plans: ReplayPlan[] = []
    for (const meta of metas) {
      const planIssues: string[] = []
      let status: ReplayPlan['status'] = 'verified'
      if (meta.schemaVersion !== versions.schemaVersion) {
        status = 'unverifiable'
        planIssues.push(
          meta.schemaVersion === undefined
            ? 'missing-schema-version'
            : 'schema-version-mismatch',
        )
      }
      if (meta.matcherVersion !== versions.matcherVersion) {
        status = 'unverifiable'
        planIssues.push(
          meta.matcherVersion === undefined
            ? 'missing-matcher-version'
            : 'matcher-version-mismatch',
        )
      }
      if (meta.riskPolicyVersion !== versions.riskPolicyVersion) {
        status = 'unverifiable'
        planIssues.push(
          meta.riskPolicyVersion === undefined
            ? 'missing-risk-policy-version'
            : 'risk-policy-version-mismatch',
        )
      }
      const planRows = rowsByPlan.get(meta.planId) ?? []
      const items: ReplayPlanItem[] = meta.items.map((item) => {
        const row = planRows.find((candidate) => candidate.itemId === item.id)
        return {
          id: item.id,
          tool: item.tool,
          risk: item.risk,
          uses: item.uses,
          status: row === undefined ? 'unused' : 'matched',
          row,
        }
      })
      plans.push({
        planId: meta.planId,
        decision: meta.decision,
        schemaVersion: meta.schemaVersion,
        matcherVersion: meta.matcherVersion,
        riskPolicyVersion: meta.riskPolicyVersion,
        items,
        rows: planRows,
        status,
        issues: planIssues,
      })
    }

    for (const [planId, planRows] of rowsByPlan) {
      if (plansById.has(planId)) continue
      plans.push({
        planId,
        items: planRows
          .filter((row) => row.itemId !== undefined)
          .map((row) => ({
            id: row.itemId as string,
            tool: row.tool,
            risk: row.risk,
            status: 'matched' as const,
            row,
          })),
        rows: planRows,
        status: 'missing-meta',
        issues: ['missing-plan-meta'],
      })
    }

    plans.sort((a, b) => {
      const timeA = a.rows[0]?.time ?? Number.MAX_SAFE_INTEGER
      const timeB = b.rows[0]?.time ?? Number.MAX_SAFE_INTEGER
      if (timeA !== timeB) return timeA - timeB
      return a.planId.localeCompare(b.planId)
    })

    const unattributed = rows.filter((row) => row.status === 'unattributed')
    const orphans = rows.filter((row) => row.status === 'orphan')
    const counts: ReplayCounts = {
      facts: input.facts.length,
      decisions: parsed.decided.length,
      records: recordsByCall.size,
      verified: rows.filter((row) => row.status === 'verified').length,
      unattributed: unattributed.length,
      unverifiable: rows.filter((row) => row.status === 'unverifiable').length,
      mismatch: rows.filter((row) => row.status === 'mismatch').length,
      orphans: orphans.length,
      pending: rows.filter((row) => row.status === 'pending').length,
      plans: plans.length,
    }

    return {
      rows,
      plans,
      unattributed,
      orphans,
      issues,
      counts,
      generatedAt,
    }
  } catch {
    return emptyReplay(generatedAt, [
      { code: 'replay-error', message: 'audit replay failed' },
    ])
  }
}
