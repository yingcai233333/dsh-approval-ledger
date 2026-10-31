/**
 * Delete-intent detection for the session-scope auto-allow guard.
 *
 * The guard must always send file-deleting requests to the official approval
 * card, even when the user enabled session auto-allow. Detection is deliberately
 * conservative: a delete-tool name is enough, and otherwise a bounded,
 * case-insensitive scan of the serialized request arguments is used. Any
 * serialization failure, or an argument blob too large to scan completely,
 * counts as delete intent (fail closed).
 *
 * This module has no DSH import and does not touch the filesystem.
 */

import { isDeleteTool } from '../core/tools.js'
import { DELETE_INTENT_PATTERN } from '../risk/commands.js'

/** Maximum serialized argument length that is scanned in full. */
export const DELETE_INTENT_MAX_LENGTH = 8192

/**
 * Whether a request deletes files or directories.
 *
 * `true` means "treat as deletion": the session-scope auto-allow must not
 * authorize the call. `false` is returned only when the tool is not a delete
 * tool and the complete, bounded argument serialization contains no delete
 * feature.
 */
export function hasDeleteIntent(tool: string, args: unknown): boolean {
  try {
    if (typeof tool === 'string' && isDeleteTool(tool.trim().toLowerCase())) return true
    const serialized = JSON.stringify(args)
    // No scannable payload (absent/function/symbol) means we cannot prove the
    // request is not a delete, so it stays manual like any other unscannable
    // argument blob.
    if (serialized === undefined) return true
    // A payload that cannot be scanned in full could hide a delete after the
    // cut-off, so it stays manual.
    if (serialized.length > DELETE_INTENT_MAX_LENGTH) return true
    return DELETE_INTENT_PATTERN.test(serialized)
  } catch {
    // Circular structures, BigInt, a throwing toJSON, etc.
    return true
  }
}
