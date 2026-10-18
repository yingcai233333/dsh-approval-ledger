import { defaultPlatform } from '../path/normalize.js'
import type { PathPlatform } from '../path/types.js'
import { normalizeCommand } from './normalize.js'

export type CommandMismatchReason =
  | 'invalid-actual'
  | 'unsafe-actual'
  | 'invalid-scope'
  | 'unsafe-scope'
  | 'not-found'

export interface CommandScopeMatch {
  matched: boolean
  index?: number
  reason?: CommandMismatchReason
}

/**
 * Exact whole-string match after whitespace normalisation.
 *
 * An actual command that carries shell metacharacters, an interpreter, a
 * script file, or a download is never auto-matched, even if it is byte-for-byte
 * identical to an approved scope entry.
 */
export function matchCommandScope(
  actual: string,
  allowed: readonly string[],
  platform: PathPlatform = defaultPlatform(),
): CommandScopeMatch {
  const normalizedActual = normalizeCommand(actual, platform)
  if (!normalizedActual.ok) return { matched: false, reason: 'invalid-actual' }
  if (!normalizedActual.command.autoEligible) {
    return { matched: false, reason: 'unsafe-actual' }
  }

  let sawUnsafe = false
  let sawInvalid = false
  for (let index = 0; index < allowed.length; index += 1) {
    const candidate = allowed[index]
    if (candidate === undefined) continue
    const normalizedScope = normalizeCommand(candidate, platform)
    if (!normalizedScope.ok) {
      sawInvalid = true
      continue
    }
    if (!normalizedScope.command.autoEligible) {
      sawUnsafe = true
      continue
    }
    if (normalizedScope.command.text === normalizedActual.command.text) {
      return { matched: true, index }
    }
  }
  const reason: CommandMismatchReason = sawUnsafe
    ? 'unsafe-scope'
    : sawInvalid
      ? 'invalid-scope'
      : 'not-found'
  return { matched: false, reason }
}
