import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  COMMAND_TOOLS,
  DEFAULT_KNOWN_TOOLS,
  DELETE_TOOLS,
  INTERFACE_TOOLS,
  MOVE_TOOLS,
  READ_TOOLS,
  WRITE_TOOLS,
  isCommandTool,
  isDeleteTool,
  isMoveTool,
  isReadTool,
  isWriteTool,
} from '../src/core/tools.js'
import { assessRisk } from '../src/risk/assess.js'

const IS_WIN = process.platform === 'win32'
const CWD = IS_WIN ? 'C:\\ws' : '/ws'
const REPORT = IS_WIN ? 'C:\\ws\\out\\report.md' : '/ws/out/report.md'

/** The `dsh-ops@0.4.1` tools the risk policy must classify by name. */
const OPS_READ = [
  'ops_read_files',
  'ops_stat',
  'ops_diff',
  'ops_glob',
  'ops_read_docx',
  'ops_read_pdf',
  'ops_read_table',
  'ops_job_list',
  'ops_job_output',
  'ops_discover_tools',
]

const OPS_WRITE = ['ops_write_file', 'ops_edit_file', 'ops_replace', 'ops_copy']
const OPS_MOVE = ['ops_move']
const OPS_DELETE = ['ops_remove']
const OPS_COMMAND = ['ops_bash', 'ops_run', 'ops_run_background']
const OPS_INTERFACE = ['ops_job_kill']

/** Deliberately unclassified: unclear semantics, so they must stay fail-closed. */
const OPS_UNKNOWN = ['ops_batch', 'ops_load_sdk']

describe('dsh-ops tool classification', () => {
  it('classifies every read tool', () => {
    for (const tool of OPS_READ) {
      assert.equal(isReadTool(tool), true, tool)
      assert.equal(READ_TOOLS.has(tool), true, tool)
      assert.equal(DEFAULT_KNOWN_TOOLS.has(tool), true, tool)
    }
  })

  it('classifies every write tool', () => {
    for (const tool of OPS_WRITE) {
      assert.equal(isWriteTool(tool), true, tool)
      assert.equal(WRITE_TOOLS.has(tool), true, tool)
      assert.equal(DEFAULT_KNOWN_TOOLS.has(tool), true, tool)
    }
  })

  it('classifies every command tool', () => {
    for (const tool of OPS_COMMAND) {
      assert.equal(isCommandTool(tool), true, tool)
      assert.equal(COMMAND_TOOLS.has(tool), true, tool)
      assert.equal(DEFAULT_KNOWN_TOOLS.has(tool), true, tool)
    }
  })

  it('classifies move, delete, and the low-risk interface tool', () => {
    for (const tool of OPS_MOVE) {
      assert.equal(isMoveTool(tool), true, tool)
      assert.equal(MOVE_TOOLS.has(tool), true, tool)
    }
    for (const tool of OPS_DELETE) {
      assert.equal(isDeleteTool(tool), true, tool)
      assert.equal(DELETE_TOOLS.has(tool), true, tool)
    }
    for (const tool of OPS_INTERFACE) {
      assert.equal(INTERFACE_TOOLS.has(tool), true, tool)
    }
  })

  it('keeps the ambiguous ops_batch and ops_load_sdk fail-closed', () => {
    for (const tool of OPS_UNKNOWN) {
      assert.equal(DEFAULT_KNOWN_TOOLS.has(tool), false, tool)
      const risk = assessRisk({ tool, args: {} })
      assert.equal(risk.level, 'unknown', tool)
      assert.equal(risk.autoEligible, false, tool)
      assert.ok(
        risk.reasons.some((reason) => reason.code === 'unknown-tool'),
        tool,
      )
    }
  })
})

describe('risk engine: dsh-ops argument shapes', () => {
  it('reads the ops_bash command field instead of failing as unknown', () => {
    const risk = assessRisk({ tool: 'ops_bash', args: { command: 'npm test' } })
    assert.notEqual(risk.level, 'unknown')
    assert.ok(risk.reasons.some((reason) => reason.code === 'command-execution'))
  })

  it('still treats an ops_bash call without a command as unknown (manual)', () => {
    const risk = assessRisk({ tool: 'ops_bash', args: {} })
    assert.equal(risk.level, 'unknown')
    assert.equal(risk.autoEligible, false)
    assert.ok(risk.reasons.some((reason) => reason.code === 'unparsed-command'))
  })

  it('extracts the write target of ops_write_file', () => {
    const risk = assessRisk({
      tool: 'ops_write_file',
      args: { path: REPORT, content: 'hello' },
      cwd: CWD,
      platform: process.platform === 'win32' ? 'win32' : 'posix',
    })
    assert.equal(risk.level, 'medium')
    assert.ok(risk.reasons.some((reason) => reason.code === 'data-file'))
  })

  it('marks ops_remove as a delete and a delete command as critical', () => {
    const remove = assessRisk({
      tool: 'ops_remove',
      args: { path: REPORT },
      cwd: CWD,
      platform: process.platform === 'win32' ? 'win32' : 'posix',
    })
    assert.equal(remove.level, 'high')
    assert.ok(remove.reasons.some((reason) => reason.code === 'delete'))

    const recursive = assessRisk({
      tool: 'ops_bash',
      args: { command: 'rm -rf /ws' },
    })
    assert.equal(recursive.level, 'critical')
  })

  it('assesses both ends of ops_copy and ops_move (`path` and `to`)', () => {
    const systemTarget = IS_WIN ? 'C:\\Windows\\System32\\x.txt' : '/etc/x.txt'
    for (const tool of ['ops_copy', 'ops_move']) {
      const risk = assessRisk({
        tool,
        args: { path: REPORT, to: systemTarget },
        cwd: CWD,
        platform: IS_WIN ? 'win32' : 'posix',
      })
      assert.equal(risk.level, 'critical', tool)
      assert.ok(
        risk.reasons.some((reason) => reason.code === 'system-path'),
        tool,
      )
    }
  })
})
