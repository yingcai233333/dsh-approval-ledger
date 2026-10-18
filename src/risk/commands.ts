import { maxRisk } from '../core/types.js'
import type { RiskLevel, RiskReason } from '../core/types.js'
import type { NormalizedCommand } from '../command/normalize.js'
import type { NormalizedPath } from '../path/types.js'

export interface CommandRiskContext {
  cwd?: NormalizedPath
}

export interface CommandRisk {
  level: RiskLevel
  reasons: RiskReason[]
}

function add(reasonList: RiskReason[], code: string, level: RiskLevel, message: string): void {
  reasonList.push({ code, level, message })
}

export function assessCommandRisk(
  command: NormalizedCommand,
  context: CommandRiskContext = {},
): CommandRisk {
  const reasons: RiskReason[] = []
  let level: RiskLevel = 'low'
  const record = (code: string, reasonLevel: RiskLevel, message: string): void => {
    add(reasons, code, reasonLevel, message)
    level = maxRisk(level, reasonLevel)
  }

  record('command-execution', 'high', 'runs a command or script')

  if (!command.autoEligible) {
    let unsafe = false
    for (const reason of command.reasons) {
      if (reason === 'encoded-command' || reason === 'invoke-expression') {
        record('obfuscated-command', 'critical', 'encoded or dynamically evaluated command')
        continue
      }
      if (reason === 'interpreter' || reason === 'script-file') {
        record('interpreter-or-script', 'high', 'interpreter or script file')
        continue
      }
      if (reason === 'download') {
        record('network-download', 'high', 'network download')
        continue
      }
      if (reason === 'wrapper') {
        record('command-wrapper', 'high', 'command wrapper')
        continue
      }
      unsafe = true
    }
    if (unsafe) {
      record('unsafe-command', 'high', 'command contains shell metacharacters or escaping')
    }
  }

  const text = command.text.toLowerCase()
  const firstExecutable = (() => {
    const token = text.trim().split(/\s+/, 1)[0] ?? ''
    const base = token.split(/[\\/]/).pop() ?? token
    return base.replace(/\.(exe|cmd|bat|com)$/, '')
  })()
  const diskExecutables = new Set([
    'format',
    'diskpart',
    'bcdedit',
    'bootrec',
    'clear-disk',
    'initialize-disk',
    'new-partition',
    'remove-partition',
  ])
  const deleteCommand = /\b(rm|rmdir|rd|del|erase)\b/.test(text)
  const recursiveFlag = /\s-(?:[a-z]*r[a-z]*|r)\b|--recursive\b|\s\/s\b/.test(text)
  const forceFlag = /\s-(?:[a-z]*f[a-z]*|f)\b|--force\b|\s\/f\b/.test(text)

  // Catastrophic / system-wide operations.
  if (
    diskExecutables.has(firstExecutable) ||
    /\b(?:cmd|powershell|pwsh)\b.*\b(?:format|diskpart|bcdedit|bootrec)\b/.test(text)
  ) {
    record('disk-or-boot', 'critical', 'disk, partition, or boot configuration')
  }
  if (/\b(reg(\.exe)?\s+(add|delete|import|load|restore)|regedit(\.exe)?)\b/.test(text)) {
    record('registry-write', 'critical', 'registry modification')
  }
  if (
    /\b(sc(\.exe)?\s+(delete|config)|schtasks(\.exe)?\s+\/(create|delete|change)|wmic\s+.*delete)\b/.test(
      text,
    )
  ) {
    record('service-change', 'critical', 'service or scheduled-task modification')
  }
  if (
    /\bfind\b.*\s-delete\b/.test(text) ||
    (deleteCommand && (recursiveFlag || forceFlag)) ||
    /\bremove-item\b.*(-recurse|-force)/.test(text)
  ) {
    record('recursive-delete', 'critical', 'recursive or forced delete')
  }
  if (/\bgit\s+push\b.*(--force\b|--force-with-lease\b|\s-f\b|--mirror\b|\s\+\S+)/.test(text)) {
    record('force-push', 'critical', 'force push')
  }
  if (/\bgit\s+(reset\s+--hard|clean\s+-[a-z]*f)/.test(text)) {
    record('git-destructive', 'critical', 'destructive git operation')
  }
  if (
    /\b(npm|pnpm|yarn|bun)\s+publish\b|\bcargo\s+publish\b|\btwine\s+upload\b|\b(docker|podman)\s+push\b|\bgh\s+release\s+create\b/.test(
      text,
    )
  ) {
    record('publish', 'critical', 'publishes or releases an artifact')
  }
  if (/\b(kubectl|helm)\s+(delete|uninstall)\b|\bterraform\s+destroy\b/.test(text)) {
    record('infrastructure-destroy', 'critical', 'destroys remote infrastructure')
  }
  if (/\b(shutdown|restart-computer|stop-computer|logoff)\b/.test(text)) {
    record('power-state', 'critical', 'changes machine power state')
  }
  if (
    /\b(set-executionpolicy|enable-psremoting|set-mppreference|add-mppreference)\b/.test(
      text,
    )
  ) {
    record('security-policy', 'critical', 'changes an execution or security policy')
  }
  if (/\b(sudo|runas|doas)\b/.test(text)) {
    record('privilege-elevation', 'critical', 'privilege elevation')
  }
  if (
    /\b(curl|wget|iwr|invoke-webrequest)\b.*\|\s*(sh|bash|pwsh|powershell|cmd)\b/.test(
      text,
    )
  ) {
    record('pipe-to-shell', 'critical', 'downloads and pipes code into a shell')
  }
  if (/\bcertutil\b.*\s-(decode|urlcache)\b/.test(text)) {
    record('decoded-payload', 'critical', 'decodes a downloaded payload')
  }

  // High-risk but common operations.
  if (
    /\b(npm|pnpm|yarn|bun)\s+(install|i|ci|add|update|upgrade)\b|\byarn\s+global\s+add\b|\b(pip|pip3|python\s+-m\s+pip|pipx)\s+install\b|\b(winget|choco|scoop|apt|apt-get|dnf|yum|brew|pacman|zypper)\s+(install|add|upgrade|update)\b|\b(cargo|go|gem|nuget)\s+install\b|\bdotnet\s+tool\s+install\b/.test(
      text,
    )
  ) {
    if (/\s(-g|--global)\b|\byarn\s+global\s+add\b/.test(text)) {
      record('global-package-install', 'critical', 'global package installation')
    } else {
      record('package-install', 'high', 'package installation')
    }
  }
  if (/\bsetx\b.*\s\/m\b|\breg\s+add\s+hklm\b/.test(text)) {
    record('system-environment-change', 'critical', 'system-wide environment change')
  } else if (
    /\b(setx|\[environment\]::setenvironmentvariable)\b|\bexport\s+[a-z_][a-z0-9_]*=|\$env:[a-z_]/.test(
      text,
    )
  ) {
    record('environment-change', 'high', 'environment variable change')
  }
  if (/\b(chmod|chown|chgrp|icacls|attrib|cacls)\b/.test(text)) {
    record('permission-change', 'high', 'permission or attribute change')
  }
  if (
    /\b(curl|wget|iwr|invoke-webrequest|start-bitstransfer|git\s+clone|scp|rsync|ftp)\b/.test(
      text,
    )
  ) {
    record('network-download', 'high', 'network download')
  }
  if (/\b(rm|del|remove-item|rd|rmdir|erase|unlink)\b/.test(text)) {
    record('delete', 'high', 'deletes files')
  }
  if (/\b(mv|move|rename|ren(\.exe)?)\b/.test(text)) {
    record('move', 'high', 'moves or renames files')
  }
  if (/\b(sc|netsh|schtasks|wmic|takeown|icacls)\b/.test(text)) {
    record('system-tool', 'high', 'system management tool')
  }
  if (/\b(docker|podman)\s+(run|rm|rmi|system\s+prune|volume\s+rm|image\s+rm)\b/.test(text)) {
    record('container-change', 'high', 'container or image change')
  }
  if (/\bgit\s+(push|clean|checkout|branch\s+-d|reset)\b/.test(text)) {
    record('git-write', 'high', 'modifies git state')
  }
  if (/\b(start-process|invoke-item|find\b.*-delete)\b/.test(text)) {
    record('wrapper-or-delete', 'high', 'starts another process or deletes matches')
  }

  void context
  return { level, reasons }
}
