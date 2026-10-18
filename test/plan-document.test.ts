import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { renderPlanReviewDocument, sanitizePlanText } from '../src/plan/document.js'
import { validatePlan } from '../src/plan/validate.js'
import type { PlanValidationOptions } from '../src/plan/types.js'

const CWD = 'C:\\ws'
const KNOWN = new Set(['write', 'edit', 'pwsh', 'delete'])

function options(extra: Partial<PlanValidationOptions> = {}): PlanValidationOptions {
  return {
    cwd: CWD,
    platform: 'win32',
    knownTools: KNOWN,
    ...extra,
  }
}

function makePlan(input: unknown) {
  const result = validatePlan(input, options())
  assert.ok(result.ok)
  if (!result.ok) throw new Error('unreachable')
  return result.plan
}

function validPlanInput() {
  return {
    summary: 'Write two files then run tests',
    items: [
      {
        id: 'A',
        tool: 'write',
        title: 'write report',
        scope: { paths: ['C:\\ws\\out\\report.md'] },
      },
      {
        id: 'B',
        tool: 'write',
        title: 'write data',
        scope: { paths: ['C:\\ws\\out\\data.json'] },
      },
      {
        id: 'C',
        tool: 'pwsh',
        title: 'run tests',
        scope: { commands: ['npm test'] },
        dependsOn: ['A', 'B'],
        uses: 2,
      },
    ],
  }
}

describe('plan review document: happy path', () => {
  it('renders a deterministic title, two-line summary, table, and details', () => {
    const plan = makePlan(validPlanInput())
    assert.equal(plan.items.length, 3)
    assert.deepEqual(plan.stages, [['A', 'B'], ['C']])
    assert.equal(plan.counts.medium, 2)
    assert.equal(plan.counts.high, 1)

    const document = renderPlanReviewDocument(plan)
    const lines = document.split('\n')

    assert.equal(lines[0], '# 审批计划 · 3 项 · 1 高 / 2 中')
    assert.equal(lines[1], '')
    assert.equal(lines[2], '本计划包含 3 项待审批操作：2 项可自动放行，1 项需手动确认。')
    assert.equal(lines[3], '风险分布：1 高 / 2 中；共 2 个执行阶段。')
    assert.equal(lines[4], '')
    assert.equal(lines[5], '| 项 | 操作 | 风险 | 依赖 | 次数 | 方式 |')

    const rows = lines.filter((line) => /^\| [ABC] \|/.test(line))
    assert.deepEqual(rows, [
      '| A | write · write report | 中 | — | 1 | 自动 |',
      '| B | write · write data | 中 | — | 1 | 自动 |',
      '| C | pwsh · run tests | 高 | A、B | 2 | 手动 |',
    ])

    assert.ok(document.includes('## 执行阶段\n\n- 阶段 1：A、B\n- 阶段 2：C'))
    assert.ok(document.includes('## 逐项详情'))
    assert.ok(document.includes('### A · write · 中'))
    assert.ok(
      document.includes(
        '- 是什么：工具 `write`；目标 `C:\\ws\\out\\report.md`',
      ),
    )
    assert.ok(document.includes('- 为什么：write report（模型文本，未验证）'))
    assert.ok(document.includes('- 批准后：自动放行 · 1 次 · 阶段 1'))
    assert.ok(document.includes('- 系统判断：中 · `data-file`：ordinary data file'))
    assert.ok(document.includes('- 建议：可自动放行'))

    assert.ok(document.includes('- 批准后：手动确认 · 2 次 · 阶段 2'))
    assert.ok(
      document.includes('- 系统判断：高 · `command-execution`：runs a command or script'),
    )
    assert.ok(document.includes('- 建议：建议手动确认（高风险默认不自动放行）'))
    assert.ok(document.includes('命令 `npm test`'))

    assert.ok(document.endsWith('\n'))
    assert.equal(document.endsWith('\n\n'), false)
    assert.equal(renderPlanReviewDocument(plan), document)
  })

  it('shows only the dependency stages declared in plan.stages order', () => {
    const plan = makePlan(validPlanInput())
    const document = renderPlanReviewDocument(plan)

    assert.ok(document.includes('- 阶段 1：A、B'))
    assert.ok(document.includes('- 阶段 2：C'))
    assert.equal(document.includes('阶段 3'), false)
    // Dependencies come from each item, not from a rendered stage guess.
    assert.ok(document.includes('| C | pwsh · run tests | 高 | A、B | 2 | 手动 |'))
  })

  it('renders system targets as backtick-free, truncated code spans', () => {
    const longPath = `C:\\ws\\out\\${'a-'.repeat(70)}.md`
    const longPlan = makePlan({
      summary: 'long target',
      items: [
        {
          id: 'A',
          tool: 'write',
          title: 'long path',
          scope: { paths: [longPath] },
        },
      ],
    })
    const longDocument = renderPlanReviewDocument(longPlan)
    assert.equal(longDocument.includes(longPath), false)
    assert.ok(longDocument.includes('…'))

    const tickPlan = makePlan({
      summary: 'literal backtick',
      items: [
        {
          id: 'A',
          tool: 'write',
          title: 'tick path',
          scope: { paths: ['C:\\ws\\out\\a`b.md'] },
        },
      ],
    })
    const tickDocument = renderPlanReviewDocument(tickPlan)
    assert.ok(tickDocument.includes("`C:\\ws\\out\\a'b.md`"))
  })
})

describe('plan review document: manual recommendations', () => {
  it('never recommends auto-approval for critical or unknown items', () => {
    const plan = makePlan({
      summary: 'critical and unknown writes',
      items: [
        {
          id: 'X',
          tool: 'write',
          title: 'system file',
          scope: { paths: ['C:\\Windows\\System32\\evil.txt'] },
        },
        {
          id: 'Y',
          tool: 'write',
          title: 'mystery file',
          scope: { paths: ['C:\\ws\\out\\blob.xyz'] },
        },
      ],
    })

    assert.equal(plan.items[0]?.risk.level, 'critical')
    assert.equal(plan.items[1]?.risk.level, 'unknown')
    assert.equal(plan.items[0]?.manualOnly, true)
    assert.equal(plan.items[1]?.manualOnly, true)

    const document = renderPlanReviewDocument(plan)
    assert.equal(document.split('\n')[0], '# 审批计划 · 2 项 · 1 严重 / 1 未知')
    assert.ok(document.includes('| X | write · system file | 严重 | — | 1 | 手动 |'))
    assert.ok(document.includes('| Y | write · mystery file | 未知 | — | 1 | 手动 |'))
    assert.ok(document.includes('- 建议：建议拒绝（严重风险永不自动放行）'))
    assert.ok(document.includes('- 建议：建议手动确认（风险未知，一律手动）'))
    assert.equal(document.includes('- 批准后：自动放行'), false)
  })

  it('fails closed when an item flag claims auto but the risk is critical', () => {
    const plan = makePlan({
      summary: 'critical write',
      items: [
        {
          id: 'X',
          tool: 'write',
          title: 'system file',
          scope: { paths: ['C:\\Windows\\System32\\evil.txt'] },
        },
      ],
    })
    const item = plan.items[0]
    assert.ok(item)
    if (!item) return
    item.autoEligible = true
    item.manualOnly = false
    item.risk = { ...item.risk, autoEligible: true }

    const document = renderPlanReviewDocument(plan)
    assert.ok(document.includes('| X | write · system file | 严重 | — | 1 | 手动 |'))
    assert.ok(document.includes('- 批准后：手动确认 · 1 次 · 阶段 1'))
    assert.ok(document.includes('- 建议：建议拒绝（严重风险永不自动放行）'))
  })
})

describe('plan review document: untrusted model text', () => {
  it('strips HTML, links, images, backticks, and newlines from title and note', () => {
    const plan = makePlan(validPlanInput())
    const item = plan.items[0]
    assert.ok(item)
    if (!item) return
    item.title =
      '<b>bold</b> [link](https://evil.example/x) ![img](https://evil.example/y.png) `code`\nnext | pipe'
    item.note =
      '<script>alert(1)</script> [note](https://evil.example/n) ![n](https://evil.example/n.png) `tick`\nnext | pipe'

    const document = renderPlanReviewDocument(plan)
    const lines = document.split('\n')

    assert.equal(document.includes('https://evil.example'), false)
    assert.equal(document.includes('<b>'), false)
    assert.equal(document.includes('<script>'), false)
    assert.equal(document.includes('![img]'), false)
    assert.equal(document.includes('![n]'), false)

    // The table stays intact: header + separator + three item rows.
    assert.equal(lines.filter((line) => line.startsWith('|')).length, 5)

    const row = lines.find((line) => line.startsWith('| A |'))
    assert.ok(row)
    if (!row) return
    assert.equal(row.includes('`'), false)
    assert.ok(row.includes('bold link img \'code\' next \\| pipe'))

    const why = lines.find((line) => line.startsWith('- 为什么：'))
    assert.ok(why)
    if (!why) return
    okIncludes(why, 'bold link img')
    assert.equal(why.includes('`'), false)
    assert.equal(why.includes('https://'), false)

    const notes = lines.filter((line) => line.startsWith('- 模型说明（未验证）：'))
    assert.equal(notes.length, 1)
    const note = notes[0]
    assert.ok(note)
    if (!note) return
    assert.ok(note.includes('alert(1) note n \'tick\' next | pipe'))
    assert.equal(note.includes('`'), false)
    assert.equal(note.includes('<'), false)
  })

  it('truncates long notes with maxNoteLength', () => {
    const plan = makePlan(validPlanInput())
    const item = plan.items[0]
    assert.ok(item)
    if (!item) return
    item.note = `start ${'word '.repeat(40)}END`

    const document = renderPlanReviewDocument(plan, { maxNoteLength: 24 })
    const note = document
      .split('\n')
      .find((line) => line.startsWith('- 模型说明（未验证）：'))
    assert.ok(note)
    if (!note) return
    assert.ok(note.endsWith('…'))
    assert.equal(note.includes('END'), false)
    assert.equal(note.includes('word '.repeat(20)), false)
    assert.ok(note.length <= '- 模型说明（未验证）：'.length + 24)
  })
})

function okIncludes(value: string, expected: string): void {
  assert.ok(value.includes(expected), `expected ${JSON.stringify(value)} to include ${expected}`)
}

describe('plan review document: secret handling', () => {
  it('never prints args values or a secret fixture', () => {
    const plan = makePlan({
      summary: 'write a note',
      items: [
        {
          id: 'A',
          tool: 'write',
          title: 'write note',
          note: 'token=sk-abcdefgh12345678',
          scope: {
            paths: ['C:\\ws\\out\\a.md'],
            args: {
              password: 'hunter2',
              apiKey: 'sk-live-abcdefgh12345678',
            },
          },
        },
      ],
    })

    const document = renderPlanReviewDocument(plan)
    for (const secret of [
      'hunter2',
      'sk-live-abcdefgh12345678',
      'sk-abcdefgh12345678',
    ]) {
      assert.equal(document.includes(secret), false)
    }
    assert.equal(document.includes('password'), false)
    assert.equal(document.includes('apiKey'), false)
    assert.ok(document.includes('参数（2 个字段，不展开）'))
    assert.ok(document.includes('token=***'))
  })
})

describe('plan review document: English output', () => {
  it('uses English labels, stage groups, and the unverified marker', () => {
    const plan = makePlan(validPlanInput())
    const document = renderPlanReviewDocument(plan, { lang: 'en' })
    const lines = document.split('\n')

    assert.equal(lines[0], '# Approval plan · 3 items · 1 high / 2 medium')
    assert.equal(lines[2], 'This plan contains 3 items: 2 auto-approved, 1 manual.')
    assert.equal(lines[3], 'Risk: 1 high / 2 medium; 2 execution stages.')
    assert.ok(document.includes('| Item | Operation | Risk | Dependencies | Uses | Mode |'))
    assert.ok(document.includes('## Execution stages'))
    assert.ok(document.includes('- Stage 1: A, B'))
    assert.ok(document.includes('- Stage 2: C'))
    assert.ok(document.includes('## Item details'))
    assert.ok(document.includes('### C · pwsh · high'))
    assert.ok(document.includes('- Why: run tests (model text, unverified)'))
    assert.ok(document.includes('- After approval: manual · 2 uses · Stage 2'))
    assert.ok(
      document.includes(
        '- Recommendation: Manual confirmation (high risk is manual by default)',
      ),
    )
    assert.equal(document.includes('审批'), false)
    assert.equal(document.includes('自动放行'), false)
  })
})

describe('sanitizePlanText', () => {
  it('removes raw HTML, images, links, control characters, and backticks', () => {
    const input =
      '<b>x</b> [label](https://evil.example/a) ![img](https://evil.example/b.png) `code`\u0000\u0007\nnext'
    assert.equal(sanitizePlanText(input), "x label img 'code' next")
  })

  it('handles reference links and bare URLs', () => {
    assert.equal(sanitizePlanText('[label][ref] ![alt][pic]'), 'label alt')
    assert.equal(sanitizePlanText('see https://evil.example/x now'), 'see now')
  })

  it('neutralizes backticks and truncates deterministically', () => {
    assert.equal(sanitizePlanText('a`b`c'), "a'b'c")
    assert.equal(sanitizePlanText('abcdef', 4), 'abc…')
    assert.equal(sanitizePlanText('abcdef', 1), '…')
    assert.equal(sanitizePlanText('abcdef', 0), '')
    assert.equal(sanitizePlanText('abc', 100), 'abc')
  })

  it('never throws on non-string runtime input', () => {
    for (const value of [undefined, null, 42, {}, [], true, Symbol('x')] as unknown[]) {
      assert.equal(sanitizePlanText(value as string), '')
    }
  })
})
