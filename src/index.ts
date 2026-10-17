/**
 * dsh-approval-ledger — Sprint 0 scaffold.
 *
 * This entry intentionally does nothing yet. The observe-only implementation
 * (plan tool, audit ledger, approval listener) lands in Sprint 1.
 *
 * Read HANDOFF.md and docs/design.md before changing this file.
 */
import type { Context } from '@deepseek-ai/cordis'

export const name = 'approval-ledger'

export const inject = [] as const

export function apply(_ctx: Context): void {
  // No activation yet. Keep the plugin loadable so the bundle row is valid.
}
