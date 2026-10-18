/**
 * Best-effort secret scrubbing for short audit summaries.
 *
 * This is not a general-purpose redactor. It exists so the ledger never stores
 * a recognisable credential even when a caller passes a path or command that
 * happens to contain one. Callers must still avoid passing full parameters.
 */
const MAX_SCAN = 4096

interface Rule {
  pattern: RegExp
  replacement: string
}

const RULES: readonly Rule[] = [
  // Private key blocks. If the text was truncated mid-block, mask the tail.
  {
    pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*/gi,
    replacement: '<redacted-private-key>',
  },
  // Well-known token prefixes.
  { pattern: /\bsk-[A-Za-z0-9_-]{8,}\b/g, replacement: 'sk-***' },
  { pattern: /\bgh[pousr]_[A-Za-z0-9]{10,}\b/g, replacement: 'gh*_***' },
  { pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, replacement: 'github_pat_***' },
  { pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, replacement: 'xox*-***' },
  { pattern: /\bAKIA[0-9A-Z]{16}\b/g, replacement: 'AKIA***' },
  { pattern: /\bAIza[0-9A-Za-z_-]{20,}\b/g, replacement: 'AIza***' },
  {
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    replacement: '<redacted-jwt>',
  },
  // Authorization headers and key=value pairs.
  { pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, replacement: 'Bearer ***' },
  {
    pattern:
      /\b(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret|authorization)\b\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;]+)/gi,
    replacement: '$1=***',
  },
  {
    pattern:
      /\b(--?(?:password|passwd|token|secret|api[-_]?key|access[-_]?key))[= ](?:"[^"]*"|'[^']*'|\S+)/gi,
    replacement: '$1=***',
  },
  // Long opaque blobs. These also cover hashes; masking them is harmless here.
  { pattern: /\b[A-Fa-f0-9]{32,}\b/g, replacement: '***' },
  { pattern: /\b[A-Za-z0-9+/]{40,}={0,2}\b/g, replacement: '***' },
  // Home directories: keep the shape, drop the account name.
  { pattern: /\b[A-Za-z]:\\Users\\[^\\\s]+/gi, replacement: '%USERPROFILE%' },
  { pattern: /\b[A-Za-z]:\\Documents and Settings\\[^\\\s]+/gi, replacement: '%USERPROFILE%' },
  { pattern: /\/(?:home|Users)\/[^/\s]+/g, replacement: '~' },
]

export function scrubSecrets(value: unknown): string {
  if (typeof value !== 'string') return ''
  let text = value.length > MAX_SCAN ? value.slice(0, MAX_SCAN) : value
  for (const rule of RULES) {
    text = text.replace(rule.pattern, rule.replacement)
  }
  return text
}
