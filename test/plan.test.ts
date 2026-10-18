import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { HIGH_RISK_GRANTS_POLICY } from '../src/core/types.js'
import { createPlanId, isPlanId } from '../src/plan/id.js'
import { validatePlan } from '../src/plan/validate.js'
import type { PlanValidationOptions, PlanValidationResult } from '../src/plan/types.js'

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

function expectOk(result: PlanValidationResult) {
  assert.ok(result.ok)
  return result.plan
}

function expectError(result: PlanValidationResult, code: string) {
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.ok(
    result.errors.some((error) => error.code === code),
    `expected ${code}, got ${result.errors.map((error) => error.code).join(', ')}`,
  )
}

function validPlan() {
  return {
    summary: 'Write a report then run tests',
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
        dependsOn: ['A'],
      },
      {
        id: 'C',
        tool: 'pwsh',
        title: 'run tests',
        scope: { commands: ['npm test'] },
        dependsOn: ['B'],
        uses: 2,
      },
    ],
  }
}

describe('plan ids', () => {
  it('creates opaque lowercase ids and validates them', () => {
    const id = createPlanId(() => 'ABCDEF12')
    assert.equal(id, 'P-abcdef12')
    assert.equal(isPlanId(id), true)
    assert.equal(isPlanId('P-xyz'), false)
    assert.throws(() => createPlanId(() => 'not-hex'))
  })
})

describe('plan validation: happy path', () => {
  it('validates items, risks, stages, and counts', () => {
    const plan = expectOk(validatePlan(validPlan(), options()))
    assert.equal(plan.items.length, 3)
    assert.deepEqual(plan.stages, [['A'], ['B'], ['C']])
    assert.equal(plan.counts.medium, 2)
    assert.equal(plan.counts.high, 1)
    assert.deepEqual(plan.autoItems, ['A', 'B'])
    assert.deepEqual(plan.manualItems, ['C'])
    assert.equal(plan.items[0]?.stage, 0)
    assert.equal(plan.items[2]?.stage, 2)
    assert.match(plan.planHash, /^sha256:[a-f0-9]{64}$/)
  })

  it('records declared uses and dependencies', () => {
    const plan = expectOk(validatePlan(validPlan(), options()))
    const itemC = plan.items.find((item) => item.id === 'C')
    assert.ok(itemC)
    assert.equal(itemC.uses, 2)
    assert.deepEqual(itemC.dependsOn, ['B'])
  })

  it('produces a stable hash and changes it when the plan changes', () => {
    const first = expectOk(validatePlan(validPlan(), options()))
    const second = expectOk(validatePlan(validPlan(), options()))
    assert.equal(first.planHash, second.planHash)

    const changed = validPlan()
    changed.summary = 'different summary'
    const third = expectOk(validatePlan(changed, options()))
    assert.notEqual(first.planHash, third.planHash)
  })

  it('treats an item with no scope as manual with a warning', () => {
    const result = validatePlan(
      {
        summary: 'one item',
        items: [{ id: 'A', tool: 'write', title: 'no scope' }],
      },
      options(),
    )
    const plan = expectOk(result)
    assert.equal(plan.items[0]?.manualOnly, true)
    assert.ok(result.warnings.some((warning) => warning.code === 'scope-missing'))
  })

  it('keeps unsafe commands manual with a warning', () => {
    const result = validatePlan(
      {
        summary: 'run a script',
        items: [
          {
            id: 'A',
            tool: 'pwsh',
            title: 'script',
            scope: { commands: ['powershell -c id'] },
          },
        ],
      },
      options(),
    )
    const plan = expectOk(result)
    assert.equal(plan.items[0]?.manualOnly, true)
    assert.ok(result.warnings.some((warning) => warning.code === 'unsafe-command'))
  })

  it('marks critical items manual and warns', () => {
    const result = validatePlan(
      {
        summary: 'write to system',
        items: [
          {
            id: 'A',
            tool: 'write',
            title: 'system file',
            scope: { paths: ['C:\\Windows\\System32\\x.txt'] },
          },
        ],
      },
      options(),
    )
    const plan = expectOk(result)
    assert.equal(plan.items[0]?.manualOnly, true)
    assert.equal(plan.counts.critical, 1)
    assert.ok(result.warnings.some((warning) => warning.code === 'critical-item'))
  })

  it('uses high-risk opt-in policy when supplied', () => {
    const plan = expectOk(
      validatePlan(validPlan(), options({ policy: HIGH_RISK_GRANTS_POLICY })),
    )
    const itemC = plan.items.find((item) => item.id === 'C')
    assert.ok(itemC)
    assert.equal(itemC.risk.autoEligible, true)
    assert.equal(itemC.autoEligible, true)
    assert.ok(plan.autoItems.includes('C'))
  })
})

describe('plan validation: shape and limits', () => {
  it('rejects non-object plans and malformed item arrays', () => {
    expectError(validatePlan(null, options()), 'plan-not-object')
    expectError(validatePlan({ summary: 'x', items: {} }, options()), 'invalid-items')
    expectError(validatePlan({ summary: 'x', items: [] }, options()), 'empty-items')

    const tooMany = {
      summary: 'many',
      items: Array.from({ length: 21 }, (_, index) => ({
        id: `I${index}`,
        tool: 'write',
        title: 'x',
        scope: { paths: [`C:\\ws\\${index}.md`] },
      })),
    }
    expectError(validatePlan(tooMany, options()), 'too-many-items')
    expectError(validatePlan({ summary: 'x', items: [42] }, options()), 'item-not-object')
  })

  it('rejects invalid summaries', () => {
    for (const summary of [undefined, '', 'x'.repeat(2000), 'bad\u0001summary']) {
      expectError(validatePlan({ summary, items: validPlan().items }, options()), 'invalid-summary')
    }
  })

  it('rejects invalid ids and duplicate ids', () => {
    expectError(
      validatePlan(
        {
          summary: 'x',
          items: [{ id: '1bad', tool: 'write', title: 'x', scope: { paths: ['C:\\ws\\a.md'] } }],
        },
        options(),
      ),
      'invalid-id',
    )

    expectError(
      validatePlan(
        {
          summary: 'x',
          items: [
            { id: 'A', tool: 'write', title: 'one', scope: { paths: ['C:\\ws\\a.md'] } },
            { id: 'a', tool: 'write', title: 'two', scope: { paths: ['C:\\ws\\b.md'] } },
          ],
        },
        options(),
      ),
      'duplicate-id',
    )
  })

  it('rejects unknown tools and invalid titles/notes/modes', () => {
    expectError(
      validatePlan(
        {
          summary: 'x',
          items: [{ id: 'A', tool: 'mystery', title: 'x', scope: { paths: ['C:\\ws\\a.md'] } }],
        },
        options(),
      ),
      'unknown-tool',
    )
    expectError(
      validatePlan(
        {
          summary: 'x',
          items: [{ id: 'A', tool: 'write', title: '', scope: { paths: ['C:\\ws\\a.md'] } }],
        },
        options(),
      ),
      'invalid-title',
    )
    expectError(
      validatePlan(
        {
          summary: 'x',
          items: [
            {
              id: 'A',
              tool: 'write',
              title: 'x',
              note: 'x'.repeat(2000),
              scope: { paths: ['C:\\ws\\a.md'] },
            },
          ],
        },
        options(),
      ),
      'invalid-note',
    )
    expectError(
      validatePlan(
        {
          summary: 'x',
          items: [
            {
              id: 'A',
              tool: 'write',
              title: 'x',
              mode: 'superuser',
              scope: { paths: ['C:\\ws\\a.md'] },
            },
          ],
        },
        options(),
      ),
      'invalid-mode',
    )
  })

  it('rejects invalid uses and excessive total uses', () => {
    for (const uses of [0, 6, 1.5, '2']) {
      expectError(
        validatePlan(
          {
            summary: 'x',
            items: [
              { id: 'A', tool: 'write', title: 'x', uses, scope: { paths: ['C:\\ws\\a.md'] } },
            ],
          },
          options(),
        ),
        'invalid-uses',
      )
    }

    const items = Array.from({ length: 11 }, (_, index) => ({
      id: `I${index}`,
      tool: 'write',
      title: 'x',
      uses: 5,
      scope: { paths: [`C:\\ws\\${index}.md`] },
    }))
    expectError(validatePlan({ summary: 'x', items }, options()), 'too-many-uses')
  })
})

describe('plan validation: dependencies', () => {
  it('rejects unknown, self, duplicate, and cyclic dependencies', () => {
    const base = (dependsOn: unknown) => ({
      summary: 'x',
      items: [
        { id: 'A', tool: 'write', title: 'x', dependsOn, scope: { paths: ['C:\\ws\\a.md'] } },
      ],
    })
    expectError(validatePlan(base(['Z']), options()), 'unknown-dependency')
    expectError(validatePlan(base(['A']), options()), 'self-dependency')
    expectError(validatePlan(base(['A', 'A']), options()), 'self-dependency')

    expectError(
      validatePlan(
        {
          summary: 'x',
          items: [
            { id: 'A', tool: 'write', title: 'x', dependsOn: ['B'], scope: { paths: ['C:\\ws\\a.md'] } },
            { id: 'B', tool: 'write', title: 'x', dependsOn: ['A'], scope: { paths: ['C:\\ws\\b.md'] } },
          ],
        },
        options(),
      ),
      'dependency-cycle',
    )
  })

  it('rejects duplicate non-self dependencies', () => {
    expectError(
      validatePlan(
        {
          summary: 'x',
          items: [
            { id: 'A', tool: 'write', title: 'x', scope: { paths: ['C:\\ws\\a.md'] } },
            {
              id: 'B',
              tool: 'write',
              title: 'x',
              dependsOn: ['A', 'A'],
              scope: { paths: ['C:\\ws\\b.md'] },
            },
          ],
        },
        options(),
      ),
      'duplicate-dependency',
    )
  })
})

describe('plan validation: scopes', () => {
  it('rejects unsafe paths and empty scope arrays', () => {
    expectError(
      validatePlan(
        {
          summary: 'x',
          items: [
            {
              id: 'A',
              tool: 'write',
              title: 'x',
              scope: { paths: ['\\\\server\\share\\x'] },
            },
          ],
        },
        options(),
      ),
      'invalid-path',
    )
    expectError(
      validatePlan(
        {
          summary: 'x',
          items: [{ id: 'A', tool: 'write', title: 'x', scope: { paths: [] } }],
        },
        options(),
      ),
      'empty-paths',
    )
    expectError(
      validatePlan(
        {
          summary: 'x',
          items: [{ id: 'A', tool: 'pwsh', title: 'x', scope: { commands: [] } }],
        },
        options(),
      ),
      'empty-commands',
    )
  })

  it('rejects oversized path and command scopes', () => {
    expectError(
      validatePlan(
        {
          summary: 'x',
          items: [
            {
              id: 'A',
              tool: 'write',
              title: 'x',
              scope: { paths: Array.from({ length: 21 }, (_, i) => `C:\\ws\\${i}.md`) },
            },
          ],
        },
        options(),
      ),
      'too-many-paths',
    )

    expectError(
      validatePlan(
        {
          summary: 'x',
          items: [
            {
              id: 'A',
              tool: 'pwsh',
              title: 'x',
              scope: { commands: Array.from({ length: 11 }, (_, i) => `echo ${i}`) },
            },
          ],
        },
        options(),
      ),
      'too-many-commands',
    )
  })

  it('de-duplicates normalized paths and commands', () => {
    const plan = expectOk(
      validatePlan(
        {
          summary: 'x',
          items: [
            {
              id: 'A',
              tool: 'write',
              title: 'x',
              scope: { paths: ['C:\\ws\\a.md', 'c:/WS/A.MD'] },
            },
          ],
        },
        options(),
      ),
    )
    assert.equal(plan.items[0]?.scope.paths.length, 1)
  })

  it('rejects invalid args scopes', () => {
    expectError(
      validatePlan(
        {
          summary: 'x',
          items: [
            {
              id: 'A',
              tool: 'write',
              title: 'x',
              scope: { args: JSON.parse('{"__proto__":{"x":1}}') },
            },
          ],
        },
        options(),
      ),
      'invalid-args',
    )
    expectError(
      validatePlan(
        {
          summary: 'x',
          items: [{ id: 'A', tool: 'write', title: 'x', scope: { args: {} } }],
        },
        options(),
      ),
      'empty-args-scope',
    )
  })

  it('warns when the scope kind does not match the tool', () => {
    const result = validatePlan(
      {
        summary: 'x',
        items: [
          {
            id: 'A',
            tool: 'pwsh',
            title: 'x',
            scope: { paths: ['C:\\ws\\a.md'] },
          },
        ],
      },
      options(),
    )
    expectOk(result)
    assert.ok(result.warnings.some((warning) => warning.code === 'scope-tool-mismatch'))
  })
})

describe('plan validation: options', () => {
  it('rejects malformed options', () => {
    expectError(validatePlan(validPlan(), undefined as unknown as PlanValidationOptions), 'invalid-options')
    expectError(validatePlan(validPlan(), { cwd: '' }), 'invalid-cwd')
    expectError(
      validatePlan(validPlan(), {
        cwd: CWD,
        platform: 'win32',
        knownTools: ['write'] as unknown as ReadonlySet<string>,
      }),
      'invalid-options',
    )
  })

  it('uses the default known-tool allow-list when omitted', () => {
    const plan = expectOk(validatePlan(validPlan(), { cwd: CWD, platform: 'win32' }))
    assert.equal(plan.items.length, 3)
  })

  it('fails closed when the plan object throws during inspection', () => {
    const hostile = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error('boom')
        },
      },
    )
    const result = validatePlan(hostile, options())
    assert.equal(result.ok, false)
    if (!result.ok) assert.ok(result.errors.some((error) => error.code === 'validation-error'))
  })

  it('accepts a relative path when a cwd is supplied', () => {
    const plan = expectOk(
      validatePlan(
        {
          summary: 'x',
          items: [
            {
              id: 'A',
              tool: 'write',
              title: 'x',
              scope: { paths: ['out\\a.md'] },
            },
          ],
        },
        options(),
      ),
    )
    assert.equal(plan.items[0]?.scope.paths[0]?.path, 'C:\\ws\\out\\a.md')
  })
})
