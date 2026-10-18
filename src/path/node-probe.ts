import { realpathSync, statSync } from 'node:fs'
import type { PathProbe } from './types.js'

/**
 * Node-backed probe for production use.
 *
 * Node's native realpath may return a `\\?\` device path on Windows. We strip
 * the prefix for local drives so the pure validator can keep rejecting
 * user-supplied device paths; UNC canonical paths are rejected (undefined)
 * because automatic grants do not support UNC.
 */
export function createNodePathProbe(): PathProbe {
  return {
    realpath(path: string): string | undefined {
      try {
        let canonical = realpathSync.native(path)
        if (process.platform === 'win32') {
          if (/^\\\\\?\\UNC\\/i.test(canonical)) return undefined
          canonical = canonical.replace(/^\\\\\?\\/, '')
        }
        return canonical
      } catch {
        return undefined
      }
    },
    isDirectory(path: string): boolean | undefined {
      try {
        return statSync(path).isDirectory()
      } catch {
        return undefined
      }
    },
    linkCount(path: string): number | undefined {
      try {
        return statSync(path).nlink
      } catch {
        return undefined
      }
    },
  }
}
