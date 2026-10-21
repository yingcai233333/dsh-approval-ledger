/**
 * Helpers for the Cordis volatile-config protocol.
 *
 * A Cordis plugin exports `Config`; fields marked `.volatile()` are resolved by
 * the Loader into frozen reference objects `{ get(), [Symbol.for('cosmokit.volatile.write')] }`.
 * The settings UI writes through `configEditor`, the Loader commits the new value
 * into the *running* references and emits `loader/volatile-update` — without
 * remounting the plugin. These helpers turn that protocol into the plain config
 * object the runtime already uses, and copy updates into it in place.
 *
 * No cosmokit import is needed: the reference protocol is identified by its
 * well-known symbol (`Symbol.for('cosmokit.volatile.write')`).
 */
import { DANGEROUS_KEYS } from './core/json.js'
import { sanitizeConfig } from './config.js'

const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write')

interface VolatileRef {
  get?: () => unknown
}

/** Whether a parsed config value is a Cordis volatile reference. */
export function isVolatileRef(value: unknown): boolean {
  return typeof value === 'object' && value !== null && VOLATILE_WRITE in value
}

/**
 * Resolve a Cordis-parsed config into a plain object: volatile references are
 * dereferenced once, everything else is copied as-is. Undeclared (YAML-only)
 * keys therefore survive untouched, which is what keeps `mode`, the risk
 * policy, and the limits working exactly as before.
 */
export function unwrapVolatileConfig(raw: unknown): Record<string, unknown> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (DANGEROUS_KEYS.has(key)) continue
    if (isVolatileRef(value)) {
      const read = (value as VolatileRef).get
      if (typeof read !== 'function') continue
      let current: unknown
      try {
        current = read.call(value)
      } catch {
        continue
      }
      // `false`/`0` are real values; only a missing value is skipped.
      if (current !== undefined) result[key] = current
      continue
    }
    result[key] = value
  }
  return result
}

/**
 * Copy the newest volatile values into the running runtime config object.
 *
 * The plugin keeps one `PluginConfig` object alive for its notifier and
 * turn-end closures; mutating it in place is what makes a settings change take
 * effect without remounting the plugin. Returns whether anything changed.
 */
export function applyVolatileUpdate(target: object, raw: unknown): boolean {
  if (target === null || typeof target !== 'object') return false
  const record = target as Record<string, unknown>
  const next = sanitizeConfig(unwrapVolatileConfig(raw)).config
  let changed = false
  for (const [key, value] of Object.entries(next)) {
    if (record[key] !== value) changed = true
    record[key] = value
  }
  return changed
}
