export type PathPlatform = 'win32' | 'posix'

/** Filesystem facts needed by the pure path matcher. */
export interface PathProbe {
  /** Canonical real path of an existing path, or undefined when it does not exist. */
  realpath(path: string): string | undefined
  /** Whether an existing path is a directory; undefined when it does not exist. */
  isDirectory(path: string): boolean | undefined
  /** Hard-link count of an existing path; optional for simple probes. */
  linkCount?(path: string): number | undefined
}

export interface NormalizedPath {
  /** Canonical path using native separators (case preserved). */
  path: string
  /** Comparison key: lower-cased on Windows, exact on POSIX. */
  key: string
  platform: PathPlatform
  isDirectory?: boolean
  /** Present when the probe could observe the hard-link count. */
  linkCount?: number
  resolution: 'lexical' | 'realpath'
}

export type PathErrorCode =
  | 'not-a-string'
  | 'empty'
  | 'too-long'
  | 'nul'
  | 'control-char'
  | 'surrounding-whitespace'
  | 'device-namespace'
  | 'unc'
  | 'root-relative'
  | 'drive-relative'
  | 'alternate-data-stream'
  | 'invalid-char'
  | 'trailing-dot-or-space'
  | 'reserved-device-name'
  | 'short-name'
  | 'component-too-long'
  | 'escapes-root'
  | 'not-absolute'
  | 'invalid-cwd'
  | 'double-slash'
  | 'probe-error'
  | 'realpath-invalid'

export interface PathFailure {
  ok: false
  code: PathErrorCode
  message: string
}

export type PathResult = { ok: true; path: NormalizedPath } | PathFailure

export interface NormalizePathOptions {
  platform?: PathPlatform
  /** Required when the input may be relative. */
  cwd?: string
  /** Omit only for already-canonical paths; production callers must pass the Node probe. */
  probe?: PathProbe
}
