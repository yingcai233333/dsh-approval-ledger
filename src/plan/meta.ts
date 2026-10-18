import { canonicalTargetValue } from '../audit/record.js'
import { sha256Tag } from '../core/hash.js'
import { MATCHER_VERSION, RISK_POLICY_VERSION, SCHEMA_VERSION } from '../core/version.js'
import type { RiskLevel } from '../core/types.js'
import { extractApprovalTarget } from '../approval/target.js'
import type { AuditTargetKind } from '../audit/types.js'
import type { ValidatedPlan, ValidatedPlanItem } from './types.js'

export type PlanDecision = 'approved' | 'cancelled'

export interface PlanMetaItem {
  id: string
  tool: string
  risk: RiskLevel
  uses: number
  auto: boolean
  grantId?: string
  /** Canonical target hash only; no path, command, or arguments. */
  targetHash?: string
}

export interface PlanGrantMeta {
  item: string
  uses: number
  expires: 'turn'
}

export interface PlanMeta {
  schemaVersion: number
  matcherVersion: number
  riskPolicyVersion: number
  planId: string
  planHash: string
  decision: PlanDecision
  approved: string[]
  manual: string[]
  items: PlanMetaItem[]
  grants: PlanGrantMeta[]
}

/**
 * Hash one unambiguous plan target so the audit replay can attribute a tool
 * call that never produced an approval event. Ambiguous scopes stay unhashed.
 */
function planTargetHash(item: ValidatedPlanItem): string | undefined {
  let target: { kind: AuditTargetKind; value: string } | undefined
  if (item.scope.paths.length === 1) {
    const path = item.scope.paths[0]
    if (path !== undefined) target = { kind: 'path', value: path.key }
  } else if (item.scope.commands.length === 1) {
    const command = item.scope.commands[0]
    if (command !== undefined) target = { kind: 'command', value: command.text }
  } else if (item.scope.args !== undefined) {
    const extracted = extractApprovalTarget({ args: item.scope.args })
    if (extracted.value !== undefined) {
      target = { kind: extracted.kind, value: extracted.value }
    }
  }
  return target === undefined
    ? undefined
    : sha256Tag(canonicalTargetValue({ kind: target.kind, value: target.value }))
}

/**
 * Build the `tool/result.meta` plan decision.
 *
 * This is metadata only: no titles, notes, paths, commands, or arguments. It
 * is persisted verbatim and never enters the model context.
 */
export function buildPlanMeta(
  plan: ValidatedPlan,
  planId: string,
  decision: PlanDecision,
  selected?: ReadonlySet<string>,
): PlanMeta {
  const isSelected = (id: string): boolean => selected === undefined || selected.has(id)
  const approved =
    decision === 'approved' ? plan.autoItems.filter((id) => isSelected(id)) : []
  const approvedSet = new Set(approved)
  const manual = plan.items
    .filter((item) => !approvedSet.has(item.id))
    .map((item) => item.id)
  const items: PlanMetaItem[] = plan.items.map((item) => {
    const auto = decision === 'approved' && approvedSet.has(item.id)
    const targetHash = planTargetHash(item)
    return {
      id: item.id,
      tool: item.tool,
      risk: item.risk.level,
      uses: item.uses,
      auto,
      ...(targetHash === undefined ? {} : { targetHash }),
      ...(auto ? { grantId: `${planId}:${item.id}` } : {}),
    }
  })
  const grants: PlanGrantMeta[] =
    decision === 'approved'
      ? plan.items
          .filter((item) => approvedSet.has(item.id))
          .map((item) => ({ item: item.id, uses: item.uses, expires: 'turn' }))
      : []

  return {
    schemaVersion: SCHEMA_VERSION,
    matcherVersion: MATCHER_VERSION,
    riskPolicyVersion: RISK_POLICY_VERSION,
    planId,
    planHash: plan.planHash,
    decision,
    approved,
    manual,
    items,
    grants,
  }
}
