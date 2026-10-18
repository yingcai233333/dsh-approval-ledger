import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isPathWithin, matchPathScope } from '../src/path/match.js'
import { normalizePath } from '../src/path/normalize.js'
import type { PathProbe } from '../src/path/types.js'

function probe(entries: Record<string, { canonical?: string; isDirectory?: boolean }>): PathProbe {
  return {
    realpath(path: string): string | undefined {
      const entry = entries[path]
      if (entry === undefined) return undefined
      return entry.canonical ?? path
    },
    isDirectory(path: string): boolean | undefined {
      return entries[path]?.isDirectory
    },
  }
}

describe('Windows path normalisation', () => {
  it('canonicalizes drive letters, separators, and comparison keys', () => {
    const result = normalizePath('C:/Work/Report.MD', { platform: 'win32' })
    assert.ok(result.ok)
    assert.equal(result.path.path, 'C:\\Work\\Report.MD')
    assert.equal(result.path.key, 'c:\\work\\report.md')
    assert.equal(result.path.resolution, 'lexical')
  })

  it('resolves dot segments without touching the filesystem', () => {
    const result = normalizePath('C:\\a\\..\\b\\.\\c', { platform: 'win32' })
    assert.ok(result.ok)
    assert.equal(result.path.path, 'C:\\b\\c')
  })

  it('collapses repeated separators and removes a trailing separator', () => {
    const result = normalizePath('C:\\a\\\\b\\', { platform: 'win32' })
    assert.ok(result.ok)
    assert.equal(result.path.path, 'C:\\a\\b')
  })

  it('keeps a drive root as a root', () => {
    const result = normalizePath('C:\\', { platform: 'win32' })
    assert.ok(result.ok)
    assert.equal(result.path.path, 'C:\\')
    assert.equal(result.path.key, 'c:\\')
  })

  it('rejects UNC paths', () => {
    const result = normalizePath('\\\\server\\share\\x', { platform: 'win32' })
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.code, 'unc')
  })

  it('rejects device namespace paths', () => {
    for (const value of ['\\\\?\\C:\\x', '\\\\.\\PhysicalDrive0']) {
      const result = normalizePath(value, { platform: 'win32' })
      assert.equal(result.ok, false)
      if (!result.ok) assert.equal(result.code, 'device-namespace')
    }
  })

  it('rejects drive-relative paths', () => {
    const result = normalizePath('C:foo', { platform: 'win32' })
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.code, 'drive-relative')
  })

  it('rejects root-relative paths', () => {
    const result = normalizePath('\\foo', { platform: 'win32' })
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.code, 'root-relative')
  })

  it('rejects alternate data streams', () => {
    for (const value of ['C:\\a\\b.txt:stream', 'C::stream']) {
      const result = normalizePath(value, { platform: 'win32' })
      assert.equal(result.ok, false)
      if (!result.ok) assert.equal(result.code, 'alternate-data-stream')
    }
  })

  it('rejects reserved device names, including with extensions', () => {
    for (const value of ['C:\\a\\CON', 'C:\\a\\CON.txt', 'C:\\a\\LPT1.log', 'C:\\a\\NUL.md']) {
      const result = normalizePath(value, { platform: 'win32' })
      assert.equal(result.ok, false)
      if (!result.ok) assert.equal(result.code, 'reserved-device-name')
    }
  })

  it('rejects 8.3 short names', () => {
    const result = normalizePath('C:\\PROGRA~1\\x', { platform: 'win32' })
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.code, 'short-name')
  })

  it('rejects trailing dots and spaces in components', () => {
    for (const value of ['C:\\a\\b.', 'C:\\a\\b ', 'C:\\a\\b. ']) {
      const result = normalizePath(value, { platform: 'win32' })
      assert.equal(result.ok, false)
      if (!result.ok) {
        assert.ok(
          result.code === 'trailing-dot-or-space' || result.code === 'surrounding-whitespace',
        )
      }
    }
  })

  it('rejects invalid Windows filename characters', () => {
    for (const value of ['C:\\a\\b<c', 'C:\\a\\b>c', 'C:\\a\\b|c', 'C:\\a\\b?c', 'C:\\a\\b*c']) {
      const result = normalizePath(value, { platform: 'win32' })
      assert.equal(result.ok, false)
      if (!result.ok) assert.equal(result.code, 'invalid-char')
    }
  })

  it('rejects surrounding whitespace, control characters, and empty paths', () => {
    assert.equal(normalizePath('C:\\a ', { platform: 'win32' }).ok, false)
    assert.equal(normalizePath('C:\\a\u0001b', { platform: 'win32' }).ok, false)
    assert.equal(normalizePath('', { platform: 'win32' }).ok, false)
    assert.equal(normalizePath('C:\\a'.repeat(20000), { platform: 'win32' }).ok, false)
  })

  it('rejects paths that escape the drive root', () => {
    const result = normalizePath('C:\\..\\a', { platform: 'win32' })
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.code, 'escapes-root')
  })

  it('resolves a relative path against a cwd', () => {
    const result = normalizePath('out\\report.md', { platform: 'win32', cwd: 'C:\\ws' })
    assert.ok(result.ok)
    assert.equal(result.path.path, 'C:\\ws\\out\\report.md')
  })

  it('rejects a relative path without a cwd', () => {
    const result = normalizePath('out\\report.md', { platform: 'win32' })
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.code, 'not-absolute')
  })

  it('rejects an invalid cwd', () => {
    const result = normalizePath('out\\report.md', { platform: 'win32', cwd: 'relative' })
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.code, 'invalid-cwd')
  })
})

describe('POSIX path normalisation', () => {
  it('resolves dot segments and preserves case', () => {
    const result = normalizePath('/tmp/a/../b/./c', { platform: 'posix' })
    assert.ok(result.ok)
    assert.equal(result.path.path, '/tmp/b/c')
    assert.equal(result.path.key, '/tmp/b/c')
  })

  it('resolves a relative path against a cwd', () => {
    const result = normalizePath('out/report.md', { platform: 'posix', cwd: '/workspace' })
    assert.ok(result.ok)
    assert.equal(result.path.path, '/workspace/out/report.md')
  })

  it('rejects double-slash prefixes and root escapes', () => {
    const doubleSlash = normalizePath('//server/share', { platform: 'posix' })
    assert.equal(doubleSlash.ok, false)
    if (!doubleSlash.ok) assert.equal(doubleSlash.code, 'double-slash')

    const escape = normalizePath('/../etc/passwd', { platform: 'posix' })
    assert.equal(escape.ok, false)
    if (!escape.ok) assert.equal(escape.code, 'escapes-root')
  })

  it('keeps a trailing space because POSIX permits it', () => {
    const result = normalizePath('/tmp/a ', { platform: 'posix' })
    assert.ok(result.ok)
    assert.equal(result.path.path, '/tmp/a ')
  })

  it('is case-sensitive', () => {
    const result = normalizePath('/Tmp/Report.MD', { platform: 'posix' })
    assert.ok(result.ok)
    assert.equal(result.path.key, '/Tmp/Report.MD')
  })

  it('rejects control characters', () => {
    const result = normalizePath('/tmp/a\nb', { platform: 'posix' })
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.code, 'control-char')
  })
})

describe('realpath resolution', () => {
  it('resolves the nearest existing ancestor and appends the missing tail', () => {
    const fs = probe({
      'C:\\ws': { isDirectory: true },
      'C:\\ws\\link': { canonical: 'C:\\outside', isDirectory: true },
    })
    const result = normalizePath('C:\\ws\\link\\secret.txt', {
      platform: 'win32',
      probe: fs,
    })
    assert.ok(result.ok)
    assert.equal(result.path.path, 'C:\\outside\\secret.txt')
    assert.equal(result.path.resolution, 'realpath')
    assert.equal(result.path.isDirectory, undefined)
  })

  it('reports whether the full target exists as a directory', () => {
    const fs = probe({ 'C:\\ws': { isDirectory: true } })
    const result = normalizePath('C:\\ws', { platform: 'win32', probe: fs })
    assert.ok(result.ok)
    assert.equal(result.path.isDirectory, true)
    assert.equal(result.path.resolution, 'realpath')
  })

  it('resolves a POSIX symlink target', () => {
    const fs = probe({
      '/workspace': { isDirectory: true },
      '/workspace/link': { canonical: '/outside', isDirectory: true },
    })
    const result = normalizePath('/workspace/link/file.txt', { platform: 'posix', probe: fs })
    assert.ok(result.ok)
    assert.equal(result.path.path, '/outside/file.txt')
    assert.equal(result.path.resolution, 'realpath')
  })

  it('fails closed when the probe throws', () => {
    const fs: PathProbe = {
      realpath: () => {
        throw new Error('boom')
      },
      isDirectory: () => undefined,
    }
    const result = normalizePath('C:\\a', { platform: 'win32', probe: fs })
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.code, 'probe-error')
  })

  it('fails closed when realpath returns an unsupported path', () => {
    const fs = probe({ 'C:\\a': { canonical: 'relative\\path' } })
    const result = normalizePath('C:\\a', { platform: 'win32', probe: fs })
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.code, 'realpath-invalid')
  })
})

describe('path scope matching', () => {
  it('matches a file exactly, never by prefix', () => {
    const file = normalizePath('C:\\ws\\a.md', { platform: 'win32' })
    const other = normalizePath('C:\\ws\\a.md.bak', { platform: 'win32' })
    assert.ok(file.ok && other.ok)
    const match = matchPathScope(other.path, [file.path])
    assert.equal(match.matched, false)
  })

  it('allows descendants only when the approved path is a directory', () => {
    const fs = probe({ 'C:\\ws': { isDirectory: true } })
    const root = normalizePath('C:\\ws', { platform: 'win32', probe: fs })
    const child = normalizePath('C:\\ws\\out\\a.md', { platform: 'win32' })
    assert.ok(root.ok && child.ok)
    assert.equal(matchPathScope(child.path, [root.path]).matched, true)
    assert.equal(matchPathScope(child.path, [root.path]).via, 'directory')
  })

  it('does not treat a non-existent directory as a directory scope', () => {
    const missing = normalizePath('C:\\ws\\out', { platform: 'win32' })
    const child = normalizePath('C:\\ws\\out\\a.md', { platform: 'win32' })
    assert.ok(missing.ok && child.ok)
    assert.equal(matchPathScope(child.path, [missing.path]).matched, false)
  })

  it('uses separator boundaries, not raw prefixes', () => {
    const fs = probe({ 'C:\\ws': { isDirectory: true } })
    const root = normalizePath('C:\\ws', { platform: 'win32', probe: fs })
    const sibling = normalizePath('C:\\wsx\\a.md', { platform: 'win32' })
    assert.ok(root.ok && sibling.ok)
    assert.equal(matchPathScope(sibling.path, [root.path]).matched, false)
  })

  it('handles the drive root boundary', () => {
    const fs = probe({ 'C:\\': { isDirectory: true } })
    const root = normalizePath('C:\\', { platform: 'win32', probe: fs })
    const child = normalizePath('C:\\a.md', { platform: 'win32' })
    assert.ok(root.ok && child.ok)
    assert.equal(isPathWithin(child.path, root.path), true)
    assert.equal(matchPathScope(child.path, [root.path]).matched, true)
  })

  it('does not match across platforms', () => {
    const win = normalizePath('C:\\ws\\a', { platform: 'win32' })
    const posix = normalizePath('/ws/a', { platform: 'posix' })
    assert.ok(win.ok && posix.ok)
    assert.equal(isPathWithin(win.path, posix.path), false)
  })
})
