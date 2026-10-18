import type { NormalizedPath } from './types.js'

export interface PathScopeMatch {
  matched: boolean
  index?: number
  via?: 'exact' | 'directory'
}

/**
 * Whether `child` is `parent` or a descendant of it.
 *
 * Comparison is case-insensitive on Windows and uses separator boundaries, so
 * `C:\ws` does not contain `C:\wsx`.
 */
export function isPathWithin(child: NormalizedPath, parent: NormalizedPath): boolean {
  if (child.platform !== parent.platform) return false
  if (child.key === parent.key) return true
  const separator = parent.platform === 'win32' ? '\\' : '/'
  if (parent.platform === 'win32' && /^[a-z]:\\$/.test(parent.key)) {
    return child.key.startsWith(parent.key)
  }
  if (parent.platform === 'posix' && parent.key === '/') {
    return child.key.startsWith('/')
  }
  return child.key.startsWith(parent.key + separator)
}

/**
 * Match an actual target against the approved scope.
 *
 * Directory containment only applies when the *approved* path was observed to
 * be a directory. A non-existent path or a file is exact-match only, so a
 * grant cannot silently broaden after the filesystem changes.
 */
export function matchPathScope(
  actual: NormalizedPath,
  allowed: readonly NormalizedPath[],
): PathScopeMatch {
  for (let index = 0; index < allowed.length; index += 1) {
    const candidate = allowed[index]
    if (candidate === undefined) continue
    if (actual.key === candidate.key) {
      return { matched: true, index, via: 'exact' }
    }
    if (candidate.isDirectory === true && isPathWithin(actual, candidate)) {
      return { matched: true, index, via: 'directory' }
    }
  }
  return { matched: false }
}
