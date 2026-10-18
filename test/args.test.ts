import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { matchArgsScope, validateArgs } from '../src/args/validate.js'
import { stableStringify } from '../src/core/json.js'

describe('args validation', () => {
  it('accepts a nested plain JSON object', () => {
    const result = validateArgs({
      path: 'out/a.md',
      nested: { a: [1, true, null, 'x'] },
    })
    assert.ok(result.ok)
    assert.equal(result.value.nested !== undefined, true)
  })

  it('rejects non-objects, non-plain objects, and unsupported values', () => {
    for (const value of [null, [], 'x', 1, new Date(), { f: () => 1 }, { n: BigInt(1) }]) {
      assert.equal(validateArgs(value).ok, false)
    }
  })

  it('rejects NaN and Infinity', () => {
    assert.equal(validateArgs({ a: Number.NaN }).ok, false)
    assert.equal(validateArgs({ a: Number.POSITIVE_INFINITY }).ok, false)
  })

  it('rejects dangerous keys', () => {
    const value = JSON.parse('{"__proto__":{"polluted":true}}') as unknown
    assert.equal(validateArgs(value).ok, false)
    assert.equal(validateArgs({ constructor: 'x' }).ok, false)
  })

  it('rejects over-deep, over-wide, and over-long values', () => {
    let deep: Record<string, unknown> = {}
    const root = deep
    for (let index = 0; index < 10; index += 1) {
      deep.next = {}
      deep = deep.next as Record<string, unknown>
    }
    assert.equal(validateArgs(root).ok, false)

    const manyKeys: Record<string, number> = {}
    for (let index = 0; index < 100; index += 1) manyKeys[`k${index}`] = index
    assert.equal(validateArgs(manyKeys).ok, false)

    assert.equal(validateArgs({ s: 'x'.repeat(3000) }).ok, false)
  })

  it('rejects circular references', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    assert.equal(validateArgs(circular).ok, false)
  })

  it('produces a stable serialized form', () => {
    const left = validateArgs({ b: 2, a: 1 })
    const right = validateArgs({ a: 1, b: 2 })
    assert.ok(left.ok && right.ok)
    assert.equal(left.serialized, right.serialized)
    assert.equal(stableStringify({ b: 2, a: 1 }), '{"a":1,"b":2}')
  })
})

describe('args scope matching', () => {
  it('matches a subset and ignores extra actual keys', () => {
    const match = matchArgsScope(
      { path: 'out/a.md', content: 'hello', mode: 0o600 },
      { path: 'out/a.md' },
    )
    assert.equal(match.matched, true)
  })

  it('matches nested subsets', () => {
    const match = matchArgsScope(
      { options: { recursive: true, depth: 3 }, path: 'x' },
      { options: { recursive: true } },
    )
    assert.equal(match.matched, true)
  })

  it('rejects missing keys, type changes, and value changes', () => {
    assert.equal(matchArgsScope({ path: 'a' }, { path: 'b' }).matched, false)
    assert.equal(matchArgsScope({ path: 1 }, { path: '1' }).matched, false)
    assert.equal(matchArgsScope({ other: 'a' }, { path: 'a' }).matched, false)
  })

  it('compares arrays exactly', () => {
    assert.equal(matchArgsScope({ paths: ['a'] }, { paths: ['a'] }).matched, true)
    assert.equal(matchArgsScope({ paths: ['a', 'b'] }, { paths: ['a'] }).matched, false)
    assert.equal(matchArgsScope({ paths: ['b', 'a'] }, { paths: ['a', 'b'] }).matched, false)
  })

  it('rejects an empty scope because it would match everything', () => {
    const match = matchArgsScope({ anything: true }, {})
    assert.equal(match.matched, false)
    assert.equal(match.reason, 'empty-scope')
  })

  it('rejects invalid actual or scope values', () => {
    assert.equal(matchArgsScope(null, { a: 1 }).reason, 'invalid-actual')
    assert.equal(matchArgsScope({ a: 1 }, new Date()).reason, 'invalid-scope')
  })
})
