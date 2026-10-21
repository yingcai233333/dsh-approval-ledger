/**
 * dsh-approval-ledger — Sprint 1 Host plugin.
 *
 * The public exports below are dependency-free matching/risk/plan/audit
 * helpers. The plugin entry registers `request_approvals`, the `/approvals`
 * command, and the `approval/request` hook through the structural DSH surface
 * in `src/types/dsh-runtime.ts`. The only `@deepseek-ai/*` value import is the
 * lazily loaded `@deepseek-ai/schemastery` build used to declare the optional
 * reminder-settings form; when it cannot be resolved the plugin keeps working
 * from YAML alone.
 */
import { sanitizeConfig } from './config.js'
import { Config } from './config-schema.js'
import { applyVolatileUpdate, unwrapVolatileConfig } from './config-volatile.js'
import { registerRuntime } from './plugin/runtime.js'
import type { Context } from './types/dsh-runtime.js'

export * from './core/hash.js'
export * from './core/json.js'
export * from './core/redact.js'
export * from './core/tools.js'
export * from './core/types.js'
export * from './core/version.js'

export * from './path/match.js'
export * from './path/node-probe.js'
export * from './path/normalize.js'
export * from './path/probe.js'
export * from './path/types.js'

export * from './command/match.js'
export * from './command/normalize.js'

export * from './args/validate.js'

export * from './risk/assess.js'
export * from './risk/commands.js'
export * from './risk/paths.js'

export * from './approval/summary.js'
export * from './approval/target.js'

export * from './config.js'

export * from './plan/document.js'
export * from './plan/hash.js'
export * from './plan/id.js'
export * from './plan/meta.js'
export * from './plan/review.js'
export * from './plan/tool-schema.js'
export * from './plan/types.js'
export * from './plan/validate.js'

export * from './audit/export.js'
export * from './audit/from-call.js'
export * from './audit/ledger.js'
export * from './audit/record.js'
export * from './audit/replay.js'
export * from './audit/report.js'
export * from './audit/schema.js'
export * from './audit/session-facts.js'
export * from './audit/store.js'
export * from './audit/types.js'

export * from './grants/match.js'
export * from './grants/store.js'
export * from './grants/types.js'

export const name = 'approval-ledger'

export const inject = ['approval', 'tools', 'userQuestions', 'commands', 'workingDirectory'] as const

/**
 * Partial Schemastery schema for the reminder settings form. DSH exposes its
 * `.volatile()` fields through `configForms`; the client half renders them in
 * `settings.section`. `undefined` when the DSH-bundled Schemastery cannot be
 * resolved (plain-Node tests, unusual deployments) — Cordis then skips schema
 * validation and the YAML path stays authoritative.
 */
export { Config }

export function apply(ctx: Context, rawConfig: unknown): void {
  const { config, warnings } = sanitizeConfig(unwrapVolatileConfig(rawConfig))
  for (const warning of warnings) {
    ctx.logger.warn(`approval-ledger config: ${warning.field}: ${warning.message}`)
  }
  if (Config === undefined) {
    ctx.logger.warn(
      'approval-ledger: reminder settings form unavailable (@deepseek-ai/schemastery not resolved); configure via cordis.patch.yml',
    )
  }

  // The Loader commits a settings change into the running volatile references
  // and emits this event instead of remounting the plugin. Copy the new values
  // into the very object the notifier and turn-end closures already hold.
  ctx.on('loader/volatile-update', () => {
    try {
      applyVolatileUpdate(config, rawConfig)
    } catch (error) {
      ctx.logger.warn(`approval-ledger config hot-update failed: ${String(error)}`)
    }
  })

  ctx.effect(() => {
    try {
      return registerRuntime(ctx, config)
    } catch (error) {
      ctx.logger.warn(`approval-ledger failed to register: ${String(error)}`)
      return () => {}
    }
  })
}
