/**
 * Version stamps written into every audit record and plan hash.
 *
 * Bump these only when the matching / risk semantics change; the audit replay
 * marks records from other versions as `unverifiable` instead of guessing.
 */
export const SCHEMA_VERSION = 1 as const
export const MATCHER_VERSION = 1 as const
export const RISK_POLICY_VERSION = 1 as const
