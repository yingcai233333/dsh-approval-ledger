import type { JsonObject, RiskAssessment, RiskLevel, RiskPolicy } from '../core/types.js'
import type { NormalizedCommand } from '../command/normalize.js'
import type { NormalizedPath, PathPlatform, PathProbe } from '../path/types.js'

export interface PlanScopeInput {
  paths?: unknown
  commands?: unknown
  args?: unknown
}

export interface PlanItemInput {
  id?: unknown
  tool?: unknown
  title?: unknown
  mode?: unknown
  scope?: unknown
  uses?: unknown
  dependsOn?: unknown
  note?: unknown
}

export interface NormalizedPlanScope {
  paths: NormalizedPath[]
  commands: NormalizedCommand[]
  args?: JsonObject
  argsSerialized?: string
}

export interface ValidatedPlanItem {
  id: string
  tool: string
  /** Model-generated, untrusted display text. */
  title: string
  /** Model-generated, untrusted explanation. */
  note?: string
  mode?: string
  uses: number
  dependsOn: string[]
  stage: number
  scope: NormalizedPlanScope
  risk: RiskAssessment
  autoEligible: boolean
  manualOnly: boolean
}

export type PlanCounts = Record<RiskLevel, number>

export interface ValidatedPlan {
  summary: string
  items: ValidatedPlanItem[]
  /** Item ids grouped by dependency stage. */
  stages: string[][]
  counts: PlanCounts
  autoItems: string[]
  manualItems: string[]
  planHash: string
}

export interface PlanIssue {
  code: string
  message: string
  itemId?: string
  field?: string
}

export interface PlanValidationOptions {
  /** Absolute session workspace path. */
  cwd: string
  platform?: PathPlatform
  probe?: PathProbe
  /** Actual registered tool set. Falls back to a small conservative allow-list. */
  knownTools?: ReadonlySet<string>
  /** Allowed approval modes. */
  modes?: ReadonlySet<string>
  policy?: RiskPolicy
  maxItems?: number
  maxUsesPerItem?: number
  maxTotalUses?: number
  maxPathsPerItem?: number
  maxCommandsPerItem?: number
}

export interface PlanValidationSuccess {
  ok: true
  plan: ValidatedPlan
  errors: PlanIssue[]
  warnings: PlanIssue[]
}

export interface PlanValidationFailure {
  ok: false
  errors: PlanIssue[]
  warnings: PlanIssue[]
}

export type PlanValidationResult = PlanValidationSuccess | PlanValidationFailure

/** Display code must mark these fields as model text, never as system facts. */
export const PLAN_UNTRUSTED_FIELDS: readonly string[] = ['title', 'note']
