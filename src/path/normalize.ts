import type {
  NormalizedPath,
  NormalizePathOptions,
  PathErrorCode,
  PathFailure,
  PathPlatform,
  PathProbe,
  PathResult,
} from './types.js'

const MAX_PATH_LENGTH = 32767
const MAX_COMPONENT_LENGTH = 255
const MAX_PROBE_DEPTH = 512

const WINDOWS_RESERVED = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'COM0',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9',
  'LPT0',
  'CLOCK$',
  'CONIN$',
  'CONOUT$',
])

// Control characters are rejected on purpose.
// oxlint-disable-next-line no-control-regex
const WINDOWS_INVALID_CHARS = /[\u0000-\u001f\u007f<>:"|?*]/
// oxlint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/

export function defaultPlatform(): PathPlatform {
  return typeof process !== 'undefined' && process.platform === 'win32' ? 'win32' : 'posix'
}

function fail(code: PathErrorCode, message: string): PathFailure {
  return { ok: false, code, message }
}

function checkCommon(input: unknown, platform: PathPlatform): PathFailure | undefined {
  if (typeof input !== 'string') return fail('not-a-string', 'path must be a string')
  if (input.length === 0) return fail('empty', 'path is empty')
  if (input.length > MAX_PATH_LENGTH) return fail('too-long', 'path exceeds the length limit')
  if (input.includes('\u0000')) return fail('nul', 'path contains a NUL character')
  if (CONTROL_CHARS.test(input)) return fail('control-char', 'path contains a control character')
  if (platform === 'win32' && input !== input.trim()) {
    return fail('surrounding-whitespace', 'path has leading or trailing whitespace')
  }
  return undefined
}

function validateWindowsComponent(component: string): PathFailure | undefined {
  if (component.length === 0) return undefined
  if (WINDOWS_INVALID_CHARS.test(component)) {
    return fail('invalid-char', 'path contains a character Windows does not allow')
  }
  if (component.endsWith('.') || component.endsWith(' ')) {
    return fail('trailing-dot-or-space', 'path component ends with a dot or space')
  }
  if (component.length > MAX_COMPONENT_LENGTH) {
    return fail('component-too-long', 'path component exceeds the length limit')
  }
  const base = component.split('.', 1)[0]?.toUpperCase() ?? ''
  if (WINDOWS_RESERVED.has(base)) {
    return fail('reserved-device-name', 'path uses a reserved Windows device name')
  }
  if (/~[0-9]/.test(component)) {
    return fail('short-name', 'path uses a Windows 8.3 short name')
  }
  return undefined
}

function dirname(path: string, platform: PathPlatform): string {
  if (platform === 'win32') {
    if (/^[A-Za-z]:\\$/.test(path)) return path
    const index = path.lastIndexOf('\\')
    if (index < 0) return path
    if (index === 2) return path.slice(0, 3)
    return path.slice(0, index)
  }
  if (path === '/') return '/'
  const index = path.lastIndexOf('/')
  return index <= 0 ? '/' : path.slice(0, index)
}

function basename(path: string, platform: PathPlatform): string {
  if (platform === 'win32') {
    if (/^[A-Za-z]:\\$/.test(path)) return ''
    return path.slice(path.lastIndexOf('\\') + 1)
  }
  if (path === '/') return ''
  return path.slice(path.lastIndexOf('/') + 1)
}

function isAbsolute(path: string, platform: PathPlatform): boolean {
  if (platform === 'win32') return /^[A-Za-z]:[\\/]/.test(path)
  return path.startsWith('/') && !path.startsWith('//')
}

function join(base: string, tail: readonly string[], platform: PathPlatform): string {
  if (tail.length === 0) return base
  const separator = platform === 'win32' ? '\\' : '/'
  const trimmed = base.endsWith(separator) ? base.slice(0, -1) : base
  return `${trimmed}${separator}${tail.join(separator)}`
}

function windowsDrive(input: string): { drive: string; rest: string } | PathFailure {
  const match = /^([A-Za-z]):/.exec(input)
  if (!match) return fail('drive-relative', 'path is not absolute')
  const drive = match[1] as string
  const rest = input.slice(2)
  if (rest.startsWith(':')) {
    return fail('alternate-data-stream', 'path uses an alternate data stream')
  }
  if (!rest.startsWith('\\') && !rest.startsWith('/')) {
    return fail('drive-relative', 'path is relative to the current directory on a drive')
  }
  if (rest.includes(':')) {
    return fail('alternate-data-stream', 'path uses an alternate data stream')
  }
  return { drive: drive.toUpperCase(), rest }
}

function normalizeWindowsLexical(input: string): PathResult {
  if (/^[\\/]{2}[?.][\\/]/.test(input)) {
    return fail('device-namespace', 'path uses the Windows device namespace')
  }
  if (/^[\\/]{2}/.test(input)) {
    return fail('unc', 'UNC paths are not supported for automatic grants')
  }
  if (/^[\\/]/.test(input)) {
    return fail('root-relative', 'path is relative to the current drive')
  }

  let absolute = input
  const driveResult = windowsDrive(absolute)
  if ('ok' in driveResult) return driveResult
  const { drive, rest } = driveResult
  absolute = `${drive}:${rest}`
  absolute = absolute.replace(/\//g, '\\')
  const root = `${drive}:\\`
  const parts: string[] = []

  for (const component of absolute.slice(2).split('\\')) {
    if (component === '' || component === '.') continue
    if (component === '..') {
      if (parts.length === 0) return fail('escapes-root', 'path escapes the drive root')
      parts.pop()
      continue
    }
    const invalid = validateWindowsComponent(component)
    if (invalid) return invalid
    parts.push(component)
  }

  return { ok: true, path: makePath(root + parts.join('\\'), 'win32') }
}

function normalizePosixLexical(input: string): PathResult {
  if (input.startsWith('//')) {
    return fail('double-slash', 'paths beginning with // are ambiguous on POSIX')
  }
  if (!input.startsWith('/')) {
    return fail('not-absolute', 'path is not absolute')
  }
  const parts: string[] = []
  for (const component of input.split('/')) {
    if (component === '' || component === '.') continue
    if (component === '..') {
      if (parts.length === 0) return fail('escapes-root', 'path escapes the filesystem root')
      parts.pop()
      continue
    }
    if (CONTROL_CHARS.test(component)) {
      return fail('control-char', 'path contains a control character')
    }
    if (component.length > MAX_COMPONENT_LENGTH) {
      return fail('component-too-long', 'path component exceeds the length limit')
    }
    parts.push(component)
  }
  return { ok: true, path: makePath(`/${parts.join('/')}`, 'posix') }
}

function makePath(path: string, platform: PathPlatform): NormalizedPath {
  return {
    path,
    key: platform === 'win32' ? path.toLowerCase() : path,
    platform,
    resolution: 'lexical',
  }
}

interface ProbeSuccess {
  ok: true
  path: NormalizedPath
}

function resolveWithProbe(
  lexical: NormalizedPath,
  probe: PathProbe,
): ProbeSuccess | PathFailure {
  const platform = lexical.platform
  let isDirectory: boolean | undefined
  try {
    isDirectory = probe.isDirectory(lexical.path)
  } catch {
    return fail('probe-error', 'filesystem probe failed')
  }

  let linkCount: number | undefined
  if (probe.linkCount !== undefined) {
    try {
      linkCount = probe.linkCount(lexical.path)
    } catch {
      return fail('probe-error', 'filesystem probe failed')
    }
  }

  let candidate = lexical.path
  const tail: string[] = []
  for (let depth = 0; depth < MAX_PROBE_DEPTH; depth += 1) {
    let real: string | undefined
    try {
      real = probe.realpath(candidate)
    } catch {
      return fail('probe-error', 'filesystem probe failed')
    }

    if (real !== undefined) {
      if (
        typeof real !== 'string' ||
        real.length === 0 ||
        !isAbsolute(real, platform) ||
        real.includes('\u0000')
      ) {
        return fail('realpath-invalid', 'filesystem returned an unsupported canonical path')
      }
      const combined = join(real, tail, platform)
      const canonical = normalizePath(combined, { platform })
      if (!canonical.ok) {
        return fail('realpath-invalid', 'filesystem returned an unsupported canonical path')
      }
      return {
        ok: true,
        path: {
          ...canonical.path,
          isDirectory,
          linkCount,
          resolution: 'realpath',
        },
      }
    }

    const parent = dirname(candidate, platform)
    if (parent === candidate) break
    tail.unshift(basename(candidate, platform))
    candidate = parent
  }

  return {
    ok: true,
    path: {
      ...lexical,
      isDirectory,
      linkCount,
      resolution: 'lexical',
    },
  }
}

export function normalizePath(input: string, options: NormalizePathOptions = {}): PathResult {
  const platform = options.platform ?? defaultPlatform()
  const common = checkCommon(input, platform)
  if (common) return common

  let absoluteInput = input
  if (platform === 'win32') {
    const hasDrive = /^[A-Za-z]:/.test(input)
    const isAbsoluteWindows = /^[A-Za-z]:[\\/]/.test(input)
    const isRootRelative = /^[\\/]/.test(input)
    if (hasDrive && !isAbsoluteWindows) {
      // `C:foo` / `C::stream` are drive-relative or alternate data streams;
      // let the Windows lexical pass produce the precise error.
      return normalizeWindowsLexical(input)
    }
    if (!isAbsoluteWindows && !isRootRelative) {
      if (options.cwd === undefined) return fail('not-absolute', 'relative path without a cwd')
      const cwd = normalizePath(options.cwd, { platform })
      if (!cwd.ok) return fail('invalid-cwd', 'cwd is not a usable absolute path')
      absoluteInput = join(cwd.path.path, [input.replace(/\//g, '\\')], 'win32')
    }
  } else if (!input.startsWith('/')) {
    if (options.cwd === undefined) return fail('not-absolute', 'relative path without a cwd')
    const cwd = normalizePath(options.cwd, { platform })
    if (!cwd.ok) return fail('invalid-cwd', 'cwd is not a usable absolute path')
    absoluteInput = join(cwd.path.path, [input], 'posix')
  }

  const lexical =
    platform === 'win32'
      ? normalizeWindowsLexical(absoluteInput)
      : normalizePosixLexical(absoluteInput)
  if (!lexical.ok) return lexical

  if (options.probe === undefined) return lexical
  return resolveWithProbe(lexical.path, options.probe)
}
