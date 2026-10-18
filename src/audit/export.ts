import type { AuditReplay, ReplayPlan, ReplayRow } from './replay.js'

export interface AuditJsonExport {
  schemaVersion: 1
  generatedAt: number
  rows: ReplayRow[]
  plans: Array<Omit<ReplayPlan, 'items'> & {
    items: Array<{
      id: string
      tool?: string
      risk?: string
      uses?: number
      status: 'matched' | 'unused'
      callId?: string
    }>
  }>
  counts: AuditReplay['counts']
  issues: AuditReplay['issues']
}

/**
 * JSON-ready projection for `/approvals audit --json`.
 *
 * Plan items only reference `callId`; nested `ReplayRow` objects are not
 * duplicated, and no raw reason/argument/command fields are introduced.
 */
export function toAuditJsonExport(replay: AuditReplay): AuditJsonExport {
  return {
    schemaVersion: 1,
    generatedAt: replay.generatedAt,
    rows: replay.rows,
    plans: replay.plans.map((plan) => ({
      ...plan,
      items: plan.items.map((item) => ({
        id: item.id,
        tool: item.tool,
        risk: item.risk,
        uses: item.uses,
        status: item.status,
        callId: item.row?.callId,
      })),
    })),
    counts: replay.counts,
    issues: replay.issues,
  }
}

export function toAuditJson(replay: AuditReplay, pretty = false): string {
  return JSON.stringify(toAuditJsonExport(replay), null, pretty ? 2 : undefined)
}
