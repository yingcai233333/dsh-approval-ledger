import { defaultPlatform } from '../path/normalize.js'
import type { PathPlatform } from '../path/types.js'

export const COMMAND_MAX_LENGTH = 2048

export type CommandReason =
  | 'multiline'
  | 'control-char'
  | 'unbalanced-quote'
  | 'shell-meta'
  | 'redirection'
  | 'command-substitution'
  | 'variable-expansion'
  | 'delayed-expansion'
  | 'escape-char'
  | 'comment'
  | 'wildcard'
  | 'splatting'
  | 'path-expansion'
  | 'backslash-escape'
  | 'interpreter'
  | 'script-file'
  | 'download'
  | 'encoded-command'
  | 'invoke-expression'
  | 'wrapper'

export interface NormalizedCommand {
  /** Whitespace-normalised command text. */
  text: string
  autoEligible: boolean
  reasons: CommandReason[]
}

export type CommandFailureCode = 'not-a-string' | 'empty' | 'too-long' | 'nul'

export type CommandResult =
  | { ok: true; command: NormalizedCommand }
  | { ok: false; code: CommandFailureCode; message: string }

const INTERPRETERS = new Set([
  'powershell',
  'powershell_ise',
  'pwsh',
  'cmd',
  'bash',
  'sh',
  'zsh',
  'fish',
  'csh',
  'ksh',
  'python',
  'python3',
  'py',
  'node',
  'nodejs',
  'deno',
  'bun',
  'perl',
  'ruby',
  'php',
  'lua',
  'wscript',
  'cscript',
  'mshta',
  'rundll32',
  'regsvr32',
  'osascript',
  'java',
  'dotnet',
])

const DOWNLOADERS = new Set([
  'curl',
  'wget',
  'iwr',
  'invoke-webrequest',
  'start-bitstransfer',
  'bitsadmin',
  'certutil',
  'ftp',
  'scp',
  'rsync',
])

const SCRIPT_EXTENSION =
  /\.(ps1|psm1|psd1|cmd|bat|sh|bash|zsh|fish|py|pyw|js|jsx|mjs|cjs|mts|cts|ts|tsx|vbs|vbe|hta|msi|exe|dll|scr|jar)\b/i

function stripQuoted(text: string): string {
  let out = ''
  let quote: '"' | "'" | null = null
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] as string
    if (quote === null) {
      if (char === '"' || char === "'") {
        quote = char
        out += ' '
        continue
      }
      out += char
      continue
    }
    if (char === quote) {
      if (text[index + 1] === quote) {
        out += '  '
        index += 1
        continue
      }
      quote = null
    }
    out += ' '
  }
  return out
}

function firstToken(text: string): string {
  let token = ''
  let quote: '"' | "'" | null = null
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] as string
    if (quote === null) {
      if (char === ' ' || char === '\t') break
      if (char === '"' || char === "'") {
        quote = char
        continue
      }
      token += char
      continue
    }
    if (char === quote) {
      if (text[index + 1] === quote) {
        token += quote
        index += 1
        continue
      }
      quote = null
      continue
    }
    token += char
  }
  return token
}

function executableName(text: string): string {
  const token = firstToken(text)
  const base = token.split(/[\\/]/).pop() ?? token
  return base.toLowerCase().replace(/\.(exe|cmd|bat|com)$/i, '')
}

function normalizeWhitespace(
  raw: string,
  platform: PathPlatform,
  reasons: Set<CommandReason>,
): string {
  let text = ''
  let quote: '"' | "'" | null = null
  let pendingSpace = false

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index] as string
    if (char === '\n') {
      pendingSpace = true
      continue
    }

    if (quote === null) {
      if (char === ' ' || char === '\t') {
        pendingSpace = true
        continue
      }
      if (pendingSpace && text.length > 0) text += ' '
      pendingSpace = false

      if (char === '"' || char === "'") {
        quote = char
        text += char
        continue
      }
      if (platform === 'posix' && char === '\\' && index + 1 < raw.length) {
        reasons.add('backslash-escape')
        text += char + (raw[index + 1] as string)
        index += 1
        continue
      }
      if (char.charCodeAt(0) < 0x20 || char === '\u007f') {
        reasons.add('control-char')
        text += ' '
        continue
      }
      text += char
      continue
    }

    if (char === quote) {
      if (raw[index + 1] === quote) {
        text += char + quote
        index += 1
        continue
      }
      quote = null
      text += char
      continue
    }
    if (platform === 'posix' && char === '\\' && index + 1 < raw.length) {
      reasons.add('backslash-escape')
      text += char + (raw[index + 1] as string)
      index += 1
      continue
    }
    if (char.charCodeAt(0) < 0x20 || char === '\u007f') {
      reasons.add('control-char')
      text += ' '
      continue
    }
    text += char
  }

  if (quote !== null) reasons.add('unbalanced-quote')
  return text.trim()
}

function detectReasons(text: string, platform: PathPlatform): Set<CommandReason> {
  const reasons = new Set<CommandReason>()
  const outside = stripQuoted(text)

  if (/[;]|&&|\|\||[|&]/.test(outside)) reasons.add('shell-meta')
  if (/[<>]/.test(outside)) reasons.add('redirection')
  if (/`|\$\(|\$\{/.test(outside)) reasons.add('command-substitution')
  if (/%[^%\s]+%|\$[A-Za-z_{]/.test(outside)) reasons.add('variable-expansion')
  if (/!/.test(outside)) reasons.add('delayed-expansion')
  if (/\^/.test(outside)) reasons.add('escape-char')
  if (/#|::/.test(outside)) reasons.add('comment')
  if (/[*?]/.test(outside)) reasons.add('wildcard')
  if (/@\(|@\{/.test(outside)) reasons.add('splatting')
  if (/(^|\s)~[\\/]/.test(outside)) reasons.add('path-expansion')

  const executable = executableName(text)
  const baseExecutable = executable.replace(/\d+(?:\.\d+)*$/, '')
  if (INTERPRETERS.has(executable) || INTERPRETERS.has(baseExecutable)) {
    reasons.add('interpreter')
  }
  if (/\b(start-process|invoke-item|call)\b/i.test(outside)) reasons.add('wrapper')
  if (SCRIPT_EXTENSION.test(text)) reasons.add('script-file')
  if (DOWNLOADERS.has(executable) || /\bgit\s+clone\b/i.test(outside)) {
    reasons.add('download')
  }
  if (/(?:^|\s)-(?:enc|encodedcommand)\b|frombase64string/i.test(outside)) {
    reasons.add('encoded-command')
  }
  if (/(?:^|\s)-(?:e|ec)\s+[A-Za-z0-9+/=]{20,}/.test(outside)) {
    reasons.add('encoded-command')
  }
  if (/\b(iex|invoke-expression|eval)\b/i.test(outside)) {
    reasons.add('invoke-expression')
  }
  if (/\bcertutil\b.*\s-(decode|urlcache)\b/i.test(outside)) {
    reasons.add('encoded-command')
  }

  // The platform only affects quoting/escaping, not the final reason set.
  void platform
  return reasons
}

export function normalizeCommand(
  input: string,
  platform: PathPlatform = defaultPlatform(),
): CommandResult {
  if (typeof input !== 'string') {
    return { ok: false, code: 'not-a-string', message: 'command must be a string' }
  }
  if (input.includes('\u0000')) {
    return { ok: false, code: 'nul', message: 'command contains a NUL character' }
  }
  if (input.length > COMMAND_MAX_LENGTH) {
    return { ok: false, code: 'too-long', message: 'command exceeds the length limit' }
  }
  if (input.trim().length === 0) {
    return { ok: false, code: 'empty', message: 'command is empty' }
  }

  const raw = input.replace(/\r\n?/g, '\n')
  const reasons = new Set<CommandReason>()
  if (raw.includes('\n')) reasons.add('multiline')

  const text = normalizeWhitespace(raw, platform, reasons)
  if (text.length === 0) {
    return { ok: false, code: 'empty', message: 'command is empty after normalisation' }
  }
  for (const reason of detectReasons(text, platform)) reasons.add(reason)

  const ordered = [...reasons].sort()
  return {
    ok: true,
    command: {
      text,
      autoEligible: ordered.length === 0,
      reasons: ordered,
    },
  }
}
