import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildPlanMeta } from '../src/plan/meta.js'
import {
  REQUEST_APPROVALS_OUTPUT_SCHEMA,
  REQUEST_APPROVALS_PARAMETERS,
} from '../src/plan/tool-schema.js'
import { validatePlan } from '../src/plan/validate.js'
import type { ValidatedPlan } from '../src/plan/types.js'

const CWD = 'C:\\ws'
const KNOWN = new Set(['write', 'pwsh'])

function plan(): ValidatedPlan {
  const result = validatePlan(
    {
      summary: 'Write a report then run tests',
      items: [
        {
          id: 'A',
          tool: 'write',
          title: 'write report',
          note: 'model note',
          scope: { paths: ['C:\\ws\\out\\report.md'] },
        },
        {
          id: 'B',
          tool: 'pwsh',
          title: 'run tests',
          dependsOn: ['A'],
          scope: { commands: ['npm test'] },
        },
      ],
    },
    { cwd: CWD, platform: 'win32', knownTools: KNOWN },
  )
  assert.ok(result.ok)
  return result.plan
}

describe('plan result metadata', () => {
  it('records only plan-level identifiers and decisions', () => {
    const source = plan()
    const meta = buildPlanMeta(source, 'P-12345678', 'approved')
    assert.equal(meta.schemaVersion, 1)
    assert.equal(meta.planId, 'P-12345678')
    assert.equal(meta.planHash, source.planHash)
    assert.deepEqual(meta.approved, ['A'])
    assert.deepEqual(meta.manual, ['B'])
    assert.equal(meta.grants.length, 1)
    assert.deepEqual(meta.grants[0], { item: 'A', uses: 1, expires: 'turn' })
    assert.equal(meta.items.find((item) => item.id === 'A')?.grantId, 'P-12345678:A')
    assert.match(meta.items.find((item) => item.id === 'A')?.targetHash ?? '', /^sha256:[a-f0-9]{64}$/)
    assert.equal(meta.items.find((item) => item.id === 'B')?.auto, false)
    const serialized = JSON.stringify(meta)
    assert.equal(serialized.includes('write report'), false)
    assert.equal(serialized.includes('C:\\\\ws'), false)
    assert.equal(serialized.includes('npm test'), false)
  })

  it('records only selected auto items in meta', () => {
    const source = plan()
    const selected = new Set(['A'])
    const meta = buildPlanMeta(source, 'P-12345678', 'approved', selected)
    assert.deepEqual(meta.approved, ['A'])
    assert.deepEqual(meta.grants, [{ item: 'A', uses: 1, expires: 'turn' }])
    assert.deepEqual(meta.manual, ['B'])
    assert.equal(meta.items.find((item) => item.id === 'A')?.auto, true)

    const none = buildPlanMeta(source, 'P-12345678', 'approved', new Set())
    assert.deepEqual(none.approved, [])
    assert.deepEqual(none.grants, [])
    assert.equal(none.items.every((item) => item.auto === false), true)
  })

  it('records no grants for a cancelled plan', () => {
    const meta = buildPlanMeta(plan(), 'P-12345678', 'cancelled')
    assert.deepEqual(meta.approved, [])
    assert.deepEqual(meta.grants, [])
    assert.equal(meta.items.every((item) => item.auto === false), true)
  })
})

describe('request_approvals schemas', () => {
  it('uses raw JSON Schema for the tool input', () => {
    const properties = REQUEST_APPROVALS_PARAMETERS.properties as Record<string, Record<string, unknown>>
    assert.deepEqual(REQUEST_APPROVALS_PARAMETERS.required, ['summary', 'items'])
    assert.equal(properties.summary?.type, 'string')
    assert.equal(properties.items?.type, 'array')
    const item = properties.items?.items as Record<string, unknown>
    assert.deepEqual(item.required, ['id', 'tool', 'title'])
  })

  it('gives every object schema node an explicit additionalProperties', () => {
    const walk = (node: unknown, path: string): void => {
      if (typeof node !== 'object' || node === null || Array.isArray(node)) return
      const record = node as Record<string, unknown>
      if (record.type === 'object') {
        assert.equal(
          typeof record.additionalProperties,
          'boolean',
          `${path} must set additionalProperties`,
        )
      }
      if (Array.isArray(record.enum)) {
        assert.ok(
          typeof record.type === 'string' || Array.isArray(record.oneOf),
          `${path} enum must declare type or oneOf`,
        )
      }
      if (record.properties !== undefined) {
        for (const [key, value] of Object.entries(record.properties as Record<string, unknown>)) {
          walk(value, `${path}.${key}`)
        }
      }
      if (record.items !== undefined) walk(record.items, `${path}[]`)
      if (Array.isArray(record.oneOf)) {
        record.oneOf.forEach((value, index) => walk(value, `${path}.oneOf[${index}]`))
      }
    }
    walk(REQUEST_APPROVALS_PARAMETERS, 'params')
    walk(REQUEST_APPROVALS_OUTPUT_SCHEMA, 'output')
  })

  it('declares a JSON-Schema output with plan items', () => {
    assert.equal(REQUEST_APPROVALS_OUTPUT_SCHEMA.type, 'object')
    assert.deepEqual(REQUEST_APPROVALS_OUTPUT_SCHEMA.required, ['planId', 'decision', 'items'])
    const properties = REQUEST_APPROVALS_OUTPUT_SCHEMA.properties as Record<string, Record<string, unknown>>
    const decision = properties.decision as { enum?: unknown[] } | undefined
    assert.equal(decision?.enum?.join(','), 'approved,cancelled')
    assert.equal(properties.items?.type, 'array')
  })
})
