import { isPlainObject } from '../core/json.js'
import { summarizeTarget } from '../audit/record.js'
import type { AuditTargetKind } from '../audit/types.js'
import { normalizeCommand } from '../command/normalize.js'
import { normalizePath } from '../path/normalize.js'
import type { PathPlatform, PathProbe } from '../path/types.js'

export interface ApprovalTargetInput {
  args?: unknown
  cwd?: string
  platform?: PathPlatform
  probe?: PathProbe
}

export interface ApprovalTarget {
  kind: AuditTargetKind
  /** Canonical value for hashing; undefined when the target could not be parsed. */
  value?: string
  /** Minimal args used for risk assessment; never includes file content. */
  riskArgs: unknown
  /** Scrubbed short display summary. */
  summary: string
  parseError?: 'unsafe-path' | 'invalid-command' | 'unparsed'
}

const PATH_KEYS = ['file_path', 'filePath', 'path', 'target', 'destination', 'source'] as const
const COMMAND_KEYS = ['command', 'cmd', 'script', 'shell'] as const

/**
 * Extract a display/hash target from tool args without reading file content.
 * Paths are normalized (including symlink resolution when a probe is given);
 * commands are normalized; everything else is reduced to a key count.
 */
export function extractApprovalTarget(input: ApprovalTargetInput): ApprovalTarget {
  const args = input.args
  if (!isPlainObject(args)) {
    return { kind: 'unknown', riskArgs: args, summary: '(unparsed)', parseError: 'unparsed' }
  }

  for (const key of PATH_KEYS) {
    const value = args[key]
    if (typeof value === 'string' && value.length > 0) {
      return pathTarget(value, input)
    }
  }
  const paths = args.paths
  if (Array.isArray(paths)) {
    const first = paths.find((item): item is string => typeof item === 'string' && item.length > 0)
    if (first !== undefined) return pathTarget(first, input)
  }
  const files = args.files
  if (Array.isArray(files)) {
    for (const item of files) {
      if (typeof item === 'string' && item.length > 0) return pathTarget(item, input)
      if (isPlainObject(item) && typeof item.path === 'string' && item.path.length > 0) {
        return pathTarget(item.path, input)
      }
    }
  }

  for (const key of COMMAND_KEYS) {
    const value = args[key]
    if (typeof value === 'string' && value.length > 0) {
      return commandTarget(value, input)
    }
  }
  const argv = args.argv
  if (Array.isArray(argv) && argv.length > 0 && argv.every((item) => typeof item === 'string')) {
    return commandTarget(argv.join(' '), input)
  }

  const action = args.action
  if (typeof action === 'string' && action.length > 0) {
    return {
      kind: 'args',
      riskArgs: args,
      summary: summarizeTarget('command', action),
    }
  }

  return {
    kind: 'args',
    riskArgs: args,
    summary: `args{${Object.keys(args).length}}`,
  }
}

function pathTarget(value: string, input: ApprovalTargetInput): ApprovalTarget {
  const normalized = normalizePath(value, {
    platform: input.platform,
    cwd: input.cwd,
    probe: input.probe,
  })
  if (!normalized.ok) {
    return {
      kind: 'unknown',
      riskArgs: { path: value },
      summary: '(unsafe path)',
      parseError: 'unsafe-path',
    }
  }
  return {
    kind: 'path',
    value: normalized.path.key,
    riskArgs: { path: normalized.path.path },
    summary: summarizeTarget('path', normalized.path.path),
  }
}

function commandTarget(value: string, input: ApprovalTargetInput): ApprovalTarget {
  const normalized = normalizeCommand(value, input.platform)
  if (!normalized.ok) {
    return {
      kind: 'unknown',
      riskArgs: { command: value },
      summary: '(invalid command)',
      parseError: 'invalid-command',
    }
  }
  return {
    kind: 'command',
    value: normalized.command.text,
    riskArgs: { command: normalized.command.text },
    summary: summarizeTarget('command', normalized.command.text),
  }
}
