import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  DEFAULT_RISK_POLICY,
  HIGH_RISK_GRANTS_POLICY,
} from '../src/core/types.js'
import { assessRisk } from '../src/risk/assess.js'
import type { PathProbe } from '../src/path/types.js'

const CWD = 'C:\\ws'

function assess(tool: string, args?: unknown, extra: Record<string, unknown> = {}) {
  return assessRisk({ tool, args, cwd: CWD, platform: 'win32', ...extra })
}

describe('risk engine: file writes', () => {
  it('marks ordinary data inside the workspace as medium and auto-eligible', () => {
    const risk = assess('write', { path: 'C:\\ws\\out\\report.md' })
    assert.equal(risk.level, 'medium')
    assert.equal(risk.autoEligible, true)
    assert.ok(risk.reasons.some((reason) => reason.code === 'data-file'))
  })

  it('marks ordinary JSON as data', () => {
    const risk = assess('write', { path: 'C:\\ws\\out\\data.json' })
    assert.equal(risk.level, 'medium')
    assert.equal(risk.autoEligible, true)
  })

  it('marks source code and project config as high and manual', () => {
    for (const path of ['C:\\ws\\src\\index.ts', 'C:\\ws\\package.json', 'C:\\ws\\cordis.patch.yml']) {
      const risk = assess('write', { path })
      assert.ok(risk.level === 'high' || risk.level === 'critical', path)
      assert.equal(risk.autoEligible, false, path)
    }
  })

  it('marks outside-workspace writes as high', () => {
    const risk = assess('write', { path: 'D:\\other\\report.md' })
    assert.equal(risk.level, 'high')
    assert.equal(risk.autoEligible, false)
    assert.ok(risk.reasons.some((reason) => reason.code === 'outside-workspace'))
  })

  it('marks system paths as critical', () => {
    for (const path of [
      'C:\\Windows\\System32\\drivers\\etc\\hosts',
      'C:\\Program Files\\app\\config.json',
      'C:\\ProgramData\\x.json',
    ]) {
      const risk = assess('write', { path })
      assert.equal(risk.level, 'critical', path)
      assert.equal(risk.autoEligible, false, path)
      assert.ok(risk.reasons.some((reason) => reason.code === 'system-path'), path)
    }
  })

  it('marks credentials and DSH config as critical', () => {
    for (const path of [
      'C:\\Users\\me\\.ssh\\id_rsa',
      'C:\\ws\\.env',
      'C:\\ws\\secrets.json',
      'C:\\Users\\me\\.dsh\\profiles\\default.yml',
      'C:\\ws\\.git\\config',
      'C:\\ws\\.github\\workflows\\ci.yml',
    ]) {
      const risk = assess('write', { path })
      assert.equal(risk.level, 'critical', path)
      assert.equal(risk.autoEligible, false, path)
    }
  })

  it('treats an existing directory target as high', () => {
    const probe: PathProbe = {
      realpath: (path) => path,
      isDirectory: (path) => (path === 'C:\\ws\\out' ? true : undefined),
    }
    const risk = assess('write', { path: 'C:\\ws\\out' }, { probe })
    assert.equal(risk.level, 'high')
  })

  it('treats a symlink escape as outside the workspace', () => {
    const probe: PathProbe = {
      realpath: (path) => (path === 'C:\\ws\\link' ? 'C:\\outside' : undefined),
      isDirectory: (path) => (path === 'C:\\ws\\link' ? true : undefined),
    }
    const risk = assess('write', { path: 'C:\\ws\\link\\report.md' }, { probe })
    assert.equal(risk.level, 'high')
    assert.ok(risk.reasons.some((reason) => reason.code === 'outside-workspace'))
  })

  it('treats a hard-linked file as high', () => {
    const probe: PathProbe = {
      realpath: (path) => path,
      isDirectory: (path) => path === 'C:\\ws',
      linkCount: () => 2,
    }
    const risk = assess('write', { path: 'C:\\ws\\report.md' }, { probe })
    assert.equal(risk.level, 'high')
    assert.ok(risk.reasons.some((reason) => reason.code === 'hardlink-target'))
  })

  it('does not flag an ordinary single-link file', () => {
    const probe: PathProbe = {
      realpath: (path) => path,
      isDirectory: (path) => path === 'C:\\ws',
      linkCount: () => 1,
    }
    const risk = assess('write', { path: 'C:\\ws\\report.md' }, { probe })
    assert.equal(risk.level, 'medium')
  })

  it('marks workspace tooling directories and config JSON as high', () => {
    for (const path of [
      'C:\\ws\\.vscode\\settings.json',
      'C:\\ws\\node_modules\\pkg\\index.js',
      'C:\\ws\\config.json',
      'C:\\ws\\tsconfig.build.json',
      'C:\\ws\\.eslintrc.json',
      'C:\\ws\\schema\\audit-v1.json',
      'C:\\ws\\.github\\dependabot.yml',
    ]) {
      const risk = assess('write', { path })
      assert.equal(risk.level, 'high', path)
      assert.equal(risk.autoEligible, false, path)
    }
  })

  it('marks credential text files as critical', () => {
    for (const path of ['C:\\ws\\credentials.txt', 'C:\\ws\\passwords.txt']) {
      const risk = assess('write', { path })
      assert.equal(risk.level, 'critical', path)
    }
  })

  it('fails closed for missing, unparseable, or unsafe targets', () => {
    for (const args of [undefined, {}, { path: 123 }, { path: '\\\\server\\share\\x' }]) {
      const risk = assess('write', args)
      assert.equal(risk.autoEligible, false)
      assert.ok(risk.level === 'unknown' || risk.level === 'high')
    }
  })

  it('takes the maximum risk across multiple paths', () => {
    const risk = assess('write', {
      paths: ['C:\\ws\\out\\a.md', 'C:\\ws\\src\\b.ts'],
    })
    assert.equal(risk.level, 'high')
    assert.equal(risk.autoEligible, false)
  })
})

describe('risk engine: commands', () => {
  it('marks any command as high by default', () => {
    const risk = assess('pwsh', { command: 'npm test' })
    assert.equal(risk.level, 'high')
    assert.equal(risk.autoEligible, false)
    assert.ok(risk.reasons.some((reason) => reason.code === 'command-execution'))
  })

  it('marks destructive recursive deletes as critical', () => {
    for (const command of [
      'rm -rf C:\\ws',
      'rm -r -f C:\\ws',
      'rm -fr /tmp/x',
      'del /s C:\\ws\\x',
      'Remove-Item -Recurse -Force C:\\ws',
    ]) {
      const risk = assess('pwsh', { command })
      assert.equal(risk.level, 'critical', command)
      assert.equal(risk.autoEligible, false, command)
    }
  })

  it('does not mistake a format script for the disk formatter', () => {
    assert.equal(assess('pwsh', { command: 'npm run format' }).level, 'high')
    assert.equal(assess('pwsh', { command: 'format C:' }).level, 'critical')
    assert.equal(assess('pwsh', { command: 'cmd /c format C:' }).level, 'critical')
  })

  it('marks force push, publish, and global installs as critical', () => {
    for (const command of [
      'git push --force origin main',
      'git push origin +main',
      'git push --mirror origin',
      'npm publish',
      'pnpm publish --access public',
      'pnpm add -g evil',
      'yarn global add evil',
      'cargo publish',
    ]) {
      const risk = assess('pwsh', { command })
      assert.equal(risk.level, 'critical', command)
    }
  })

  it('marks broad find-delete and scheduled-task deletion as critical', () => {
    assert.equal(assess('pwsh', { command: 'find . -name x -delete' }).level, 'critical')
    assert.equal(assess('pwsh', { command: 'schtasks /delete /tn x' }).level, 'critical')
  })

  it('marks package installs and downloads as high', () => {
    for (const command of [
      'npm install left-pad',
      'npm ci',
      'cargo install ripgrep',
      'pip install requests',
      'curl https://example.com/x',
    ]) {
      const risk = assess('pwsh', { command })
      assert.equal(risk.level, 'high', command)
      assert.equal(risk.autoEligible, false, command)
    }
  })

  it('marks registry, service, and environment changes as critical or high', () => {
    assert.equal(assess('pwsh', { command: 'reg add HKCU\\Environment /v PATH /d x' }).level, 'critical')
    assert.equal(assess('pwsh', { command: 'setx PATH C:\\evil' }).level, 'high')
    assert.equal(assess('pwsh', { command: 'setx PATH C:\\evil /M' }).level, 'critical')
    assert.equal(assess('pwsh', { command: 'schtasks /create /tn x /tr y' }).level, 'critical')
  })

  it('marks privilege elevation and security policy changes as critical', () => {
    for (const command of ['sudo rm x', 'runas /user:admin cmd', 'Set-ExecutionPolicy Bypass']) {
      assert.equal(assess('pwsh', { command }).level, 'critical', command)
    }
  })

  it('marks pipe-to-shell and encoded commands as critical', () => {
    for (const command of [
      'curl https://x | sh',
      'iwr https://x | iex',
      'powershell -EncodedCommand AAAA',
    ]) {
      assert.equal(assess('pwsh', { command }).level, 'critical', command)
    }
  })

  it('fails closed when the command cannot be parsed', () => {
    for (const args of [undefined, {}, { command: 1 }, { command: '   ' }]) {
      const risk = assess('pwsh', args)
      assert.equal(risk.autoEligible, false)
      assert.equal(risk.level, 'unknown')
    }
  })

  it('marks an argv array as high because quoting was lost', () => {
    const risk = assess('pwsh', { argv: ['echo', 'hello'] })
    assert.equal(risk.level, 'high')
    assert.ok(risk.reasons.some((reason) => reason.code === 'argv-joined'))
  })
})

describe('risk engine: tools and mode', () => {
  it('treats read and interaction tools as low', () => {
    assert.equal(assess('read', { path: 'C:\\ws\\x' }).level, 'low')
    assert.equal(assess('web_fetch', { url: 'https://x' }).level, 'low')
    assert.equal(assess('request_approvals', {}).level, 'low')
  })

  it('treats plugin profile changes as critical and list actions as low', () => {
    assert.equal(assess('plugin_manager', { action: 'install_bundle', target: 'x' }).level, 'critical')
    assert.equal(assess('plugin_manager', { action: 'list_plugins' }).level, 'low')
    assert.equal(assess('plugin_manager', undefined).level, 'critical')
  })

  it('treats unknown tools as unknown and manual', () => {
    const risk = assess('mystery_tool', {})
    assert.equal(risk.level, 'unknown')
    assert.equal(risk.autoEligible, false)
  })

  it('raises a danger-full-access request to high', () => {
    const risk = assess('write', { path: 'C:\\ws\\out\\a.md' }, { mode: 'danger-full-access' })
    assert.equal(risk.level, 'high')
    assert.equal(risk.autoEligible, false)
    assert.ok(risk.reasons.some((reason) => reason.code === 'mode-full-access'))
  })

  it('raises a read-only write conflict to high', () => {
    const risk = assess('write', { path: 'C:\\ws\\a.md' }, { mode: 'read-only' })
    assert.equal(risk.level, 'high')
    assert.ok(risk.reasons.some((reason) => reason.code === 'mode-conflict'))
  })

  it('fails closed for an unknown mode', () => {
    const risk = assess('write', { path: 'C:\\ws\\a.md' }, { mode: 'superuser' })
    assert.equal(risk.level, 'high')
    assert.ok(risk.reasons.some((reason) => reason.code === 'unknown-mode'))
  })

  it('treats delete as high and recursive delete as critical', () => {
    assert.equal(assess('delete', { path: 'C:\\ws\\a.md' }).level, 'high')
    assert.equal(assess('delete', { path: 'C:\\ws\\a', recursive: true }).level, 'critical')
  })
})

describe('risk policy', () => {
  it('never auto-approves critical or unknown', () => {
    const critical = assessRisk(
      { tool: 'write', args: { path: 'C:\\Windows\\x' }, cwd: CWD, platform: 'win32' },
      HIGH_RISK_GRANTS_POLICY,
    )
    assert.equal(critical.autoEligible, false)

    const unknown = assessRisk(
      { tool: 'mystery', args: {}, cwd: CWD, platform: 'win32' },
      HIGH_RISK_GRANTS_POLICY,
    )
    assert.equal(unknown.autoEligible, false)
  })

  it('does not auto-approve high risk by default', () => {
    const risk = assessRisk(
      { tool: 'write', args: { path: 'C:\\ws\\src\\x.ts' }, cwd: CWD, platform: 'win32' },
      DEFAULT_RISK_POLICY,
    )
    assert.equal(risk.autoEligible, false)
    assert.equal(risk.requiresSecondConfirm, false)
  })

  it('allows high risk only with opt-in and a second confirmation', () => {
    const risk = assessRisk(
      { tool: 'write', args: { path: 'C:\\ws\\src\\x.ts' }, cwd: CWD, platform: 'win32' },
      HIGH_RISK_GRANTS_POLICY,
    )
    assert.equal(risk.autoEligible, true)
    assert.equal(risk.requiresSecondConfirm, true)
  })

  it('refuses high-risk auto when the second-confirmation interlock is off', () => {
    const risk = assessRisk(
      { tool: 'write', args: { path: 'C:\\ws\\src\\x.ts' }, cwd: CWD, platform: 'win32' },
      {
        version: 1,
        autoLevels: ['low', 'medium'],
        allowHighRiskGrants: true,
        requireSecondConfirmForHigh: false,
      },
    )
    assert.equal(risk.autoEligible, false)
  })

  it('is deterministic and de-duplicates reasons', () => {
    const first = assess('pwsh', { command: 'npm install x' })
    const second = assess('pwsh', { command: 'npm   install   x' })
    assert.deepEqual(
      first.reasons.map((reason) => reason.code),
      second.reasons.map((reason) => reason.code),
    )
    const codes = first.reasons.map((reason) => reason.code)
    assert.equal(new Set(codes).size, codes.length)
  })

  it('never includes raw path or command text in reasons', () => {
    const secret = 'sk-1234567890abcdef'
    const risk = assess('pwsh', { command: `curl https://x?token=${secret}` })
    const serialized = JSON.stringify(risk)
    assert.equal(serialized.includes(secret), false)
  })
})
