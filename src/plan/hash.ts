import { sha256Tag } from '../core/hash.js'
import { stableStringify } from '../core/json.js'
import {
  MATCHER_VERSION,
  RISK_POLICY_VERSION,
  SCHEMA_VERSION,
} from '../core/version.js'
import type { ValidatedPlan } from './types.js'

/**
 * Bind the approved plan to exact normalized scopes, uses, and dependencies.
 * The audit layer can later prove that a grant belongs to this plan version.
 */
export function computePlanHash(
  plan: Pick<ValidatedPlan, 'summary' | 'items'>,
): string {
  const payload = {
    schemaVersion: SCHEMA_VERSION,
    matcherVersion: MATCHER_VERSION,
    riskPolicyVersion: RISK_POLICY_VERSION,
    summary: plan.summary,
    items: plan.items.map((item) => ({
      id: item.id,
      tool: item.tool,
      mode: item.mode ?? null,
      uses: item.uses,
      dependsOn: item.dependsOn,
      risk: item.risk.level,
      paths: item.scope.paths.map((path) => path.key),
      commands: item.scope.commands.map((command) => command.text),
      args: item.scope.args ?? null,
    })),
  }
  return sha256Tag(stableStringify(payload))
}
