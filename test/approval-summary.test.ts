import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildApprovalDisplayReason, describeApproval } from '../src/approval/summary.js'
import type { PathProbe } from '../src/path/types.js'

const CWD = 'C:\\ws'

describe('approval summary', () => {
  it('derives a title from the actual tool, target, and mode', () => {
    const summary = describeApproval({
      tool: 'write',
      mode: 'workspace-write',
      cwd: CWD,
      platform: 'win32',
      args: { path: 'C:\\ws\\out\\report.md', content: 'hello' },
    })
    assert.equal(summary.risk.level, 'medium')
    assert.match(summary.title, /^写入文件 · .*out\\report\.md · 工作区写入$/)
    assert.match(summary.detail, /审批：写入文件/)
    assert.match(summary.detail, /模式：工作区写入/)
    assert.match(summary.detail, /风险：中（普通数据文件）/)
    assert.match(summary.detail, /只允许本次调用/)
    assert.equal(summary.detail.includes('hello'), false)
  })

  it('summarizes commands without echoing arguments', () => {
    const summary = describeApproval({
      tool: 'pwsh',
      mode: 'danger-full-access',
      cwd: CWD,
      platform: 'win32',
      args: { command: 'pwsh -File build.ps1 -Token sk-abcdefgh12345678' },
    })
    assert.equal(summary.risk.level, 'high')
    assert.match(summary.title, /^PowerShell 命令 · pwsh … · 完全访问$/)
    assert.equal(summary.detail.includes('sk-'), false)
    assert.equal(summary.detail.includes('build.ps1'), false)
  })

  it('marks critical targets and recommends rejection', () => {
    const summary = describeApproval({
      tool: 'write',
      mode: 'danger-full-access',
      cwd: CWD,
      platform: 'win32',
      args: { path: 'C:\\Windows\\System32\\drivers\\etc\\hosts' },
    })
    assert.equal(summary.risk.level, 'critical')
    assert.match(summary.title, /^\[严重\]/)
    assert.match(summary.detail, /建议拒绝/)
    assert.match(summary.detail, /风险：严重/)
  })

  it('keeps unknown tools manual', () => {
    const summary = describeApproval({
      tool: 'mystery_tool',
      cwd: CWD,
      platform: 'win32',
      args: { foo: 'bar' },
    })
    assert.equal(summary.risk.level, 'unknown')
    assert.match(summary.detail, /无法安全分类/)
  })

  it('scrubs secrets from a target and never includes content', () => {
    const secret = 'sk-abcdefgh12345678'
    const summary = describeApproval({
      tool: 'write',
      mode: 'workspace-write',
      cwd: CWD,
      platform: 'win32',
      args: {
        path: `C:\\ws\\${secret}.md`,
        content: `token=${secret}`,
      },
    })
    assert.equal(summary.title.includes(secret), false)
    assert.equal(summary.detail.includes(secret), false)
    assert.equal(summary.targetSummary.includes(secret), false)
  })

  it('resolves a symlink in the target summary', () => {
    const probe: PathProbe = {
      realpath: (path) => (path === 'C:\\ws\\link' ? 'C:\\outside' : undefined),
      isDirectory: (path) => (path === 'C:\\ws\\link' ? true : undefined),
    }
    const summary = describeApproval({
      tool: 'write',
      mode: 'danger-full-access',
      cwd: CWD,
      platform: 'win32',
      probe,
      args: { path: 'C:\\ws\\link\\report.md' },
    })
    assert.equal(summary.risk.level, 'high')
    assert.ok(summary.detail.includes('工作区外'))
    assert.match(summary.targetSummary, /outside\\report\.md/)
  })

  it('fails closed for malformed args', () => {
    const summary = describeApproval({
      tool: 'write',
      cwd: CWD,
      platform: 'win32',
      args: null,
    })
    assert.equal(summary.risk.level, 'unknown')
    assert.match(summary.detail, /无法解析/)
  })

  it('supports English labels', () => {
    const summary = describeApproval(
      {
        tool: 'write',
        mode: 'workspace-write',
        cwd: CWD,
        platform: 'win32',
        args: { path: 'C:\\ws\\a.md' },
      },
      'en',
    )
    assert.match(summary.detail, /^Approval: write/m)
    assert.match(summary.detail, /Recommendation:/)
  })

  it('builds a bilingual one-line displayReason', () => {
    const reason = buildApprovalDisplayReason({
      tool: 'write',
      mode: 'workspace-write',
      cwd: CWD,
      platform: 'win32',
      args: { path: 'C:\\ws\\a.md' },
    })
    assert.match(reason.zh, /^写入文件 · /)
    assert.match(reason.en, /^write · /)
    assert.equal(reason.zh.includes('\n'), false)
    assert.equal(reason.en.includes('\n'), false)
  })
})
