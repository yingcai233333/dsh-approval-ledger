/**
 * dsh-approval-ledger — Sprint 0 scaffold.
 *
 * DSH packages are peers, not installed in CI (some internal packages are not
 * published to npm). Keep the scaffold free of DSH type imports until a
 * local type surface or a DSH checkout is wired in.
 */
export const name = 'approval-ledger'

export const inject = [] as const

export function apply(_ctx: unknown): void {
  // No activation yet. Keep the plugin loadable so the bundle row is valid.
}
