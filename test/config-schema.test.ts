import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DEFAULT_CONFIG, sanitizeConfig } from '../src/config.js'
import {
  createConfigSchema,
  REMINDER_FIELDS,
  volatileFields,
} from '../src/config-schema.js'
import {
  applyVolatileUpdate,
  isVolatileRef,
  unwrapVolatileConfig,
} from '../src/config-volatile.js'

const EXPECTED_FIELDS = [
  'flashWindow',
  'notifications',
  'notifyOnApproval',
  'notifyOnPlan',
  'notifyOnQuestion',
  'notifyOnTurnEnd',
  'notifyRepeatSeconds',
  'soundAlert',
  'turnBadgeSeconds',
  'turnEndOnlyWhenAway',
]

interface FakeFieldState {
  kind: 'boolean' | 'number'
  min?: number
  max?: number
  defaultValue?: unknown
  volatile?: boolean
  loose?: boolean
}

interface FakeField {
  meta: Record<string, unknown>
  __state: FakeFieldState
  min(value: number): FakeField
  max(value: number): FakeField
  default(value: unknown): FakeField
  volatile(): FakeField
  loose(): FakeField
}

/** Recording stand-in for the DSH-bundled Schemastery, used only by these tests. */
function fakeSchemastery(): { factory: any; states: Map<string, FakeFieldState> } {
  const states = new Map<string, FakeFieldState>()
  const makeField = (kind: 'boolean' | 'number'): FakeField => {
    const state: FakeFieldState = { kind }
    const node: FakeField = {
      meta: {},
      __state: state,
      min(value) {
        state.min = value
        return node
      },
      max(value) {
        state.max = value
        return node
      },
      default(value) {
        state.defaultValue = value
        return node
      },
      volatile() {
        state.volatile = true
        node.meta.volatile = true
        return node
      },
      loose() {
        state.loose = true
        node.meta.loose = true
        return node
      },
    }
    return node
  }
  const factory = {
    boolean: () => makeField('boolean'),
    number: () => makeField('number'),
    object(dict: Record<string, FakeField>) {
      for (const [key, node] of Object.entries(dict)) states.set(key, node.__state)
      return { type: 'object', dict, meta: {} }
    },
  }
  return { factory, states }
}

function buildFakeSchema(): { schema: any; states: Map<string, FakeFieldState> } {
  const { factory, states } = fakeSchemastery()
  return { schema: createConfigSchema(factory), states }
}

const WRITE = Symbol.for('cosmokit.volatile.write')

function volatileRef(initial: unknown): any {
  let current = initial
  return {
    get: () => current,
    [WRITE]: (next: unknown) => {
      current = next
    },
  }
}

describe('reminder config schema', () => {
  it('projects exactly the ten reminder fields', () => {
    const { schema } = buildFakeSchema()
    const fields = volatileFields(schema)
    assert.ok(fields, 'the object schema has a volatile form')
    assert.deepEqual(Object.keys(fields).sort(), EXPECTED_FIELDS)
    assert.equal(REMINDER_FIELDS.length, 10)
    assert.deepEqual(
      REMINDER_FIELDS.map((field) => field.key).sort(),
      EXPECTED_FIELDS,
    )
  })

  it('uses DEFAULT_CONFIG for every default', () => {
    const { states } = buildFakeSchema()
    assert.equal(states.size, 10)
    for (const field of REMINDER_FIELDS) {
      const state = states.get(field.key)
      assert.ok(state, `${field.key} is declared`)
      assert.equal(
        state.defaultValue,
        DEFAULT_CONFIG[field.key],
        `${field.key} default matches DEFAULT_CONFIG`,
      )
      assert.equal(state.volatile, true, `${field.key} is volatile`)
      assert.equal(state.loose, true, `${field.key} is loose`)
    }
    assert.equal(states.get('notifications')?.kind, 'boolean')
    assert.equal(states.get('notifyRepeatSeconds')?.kind, 'number')
    assert.equal(states.get('turnBadgeSeconds')?.kind, 'number')
  })

  it('bounds the numeric fields to the documented ranges', () => {
    const { states } = buildFakeSchema()
    assert.deepEqual(
      { min: states.get('notifyRepeatSeconds')?.min, max: states.get('notifyRepeatSeconds')?.max },
      { min: 0, max: 600 },
    )
    assert.deepEqual(
      { min: states.get('turnBadgeSeconds')?.min, max: states.get('turnBadgeSeconds')?.max },
      { min: 0, max: 3600 },
    )
    assert.equal(states.get('notifications')?.min, undefined, 'booleans carry no range')
  })

  it('never exposes the YAML-only configuration keys', () => {
    const { schema, states } = buildFakeSchema()
    for (const key of [
      'mode',
      'allowHighRiskGrants',
      'requireSecondConfirmForHigh',
      'autoSelectAll',
      'showDetailsButton',
      'auditOnly',
      'auditRetentionDays',
      'auditNotices',
      'maxPlanItems',
      'maxUsesPerItem',
      'maxTotalUses',
    ]) {
      assert.equal(states.has(key), false, `${key} must stay YAML-only`)
      assert.equal(key in (schema as { dict: Record<string, unknown> }).dict, false, key)
    }
  })

  it('returns undefined when Schemastery is unavailable', () => {
    for (const value of [
      undefined,
      null,
      42,
      'schemastery',
      {},
      { object() {} },
      { object() {}, boolean() {} },
    ]) {
      assert.equal(createConfigSchema(value), undefined)
    }
  })

  it('accepts a callable factory and callable schema nodes (the real Schemastery shape)', () => {
    const { factory } = fakeSchemastery()
    const callableFactory = Object.assign(function schema() {}, factory)
    const schema = createConfigSchema(callableFactory)
    assert.equal(Object.keys(volatileFields(schema) ?? {}).length, 10)

    const child = Object.assign(function schema() {}, { type: 'boolean', meta: { volatile: true } })
    const node = Object.assign(function schema() {}, {
      type: 'object',
      meta: {},
      dict: { notifications: child },
    })
    assert.deepEqual(Object.keys(volatileFields(node) ?? {}), ['notifications'])
  })

  it('projects the volatile fields of any object schema, not the plain ones', () => {
    const { factory } = fakeSchemastery()
    const schema = factory.object({
      notifications: factory.boolean().default(true).volatile(),
      mode: factory.boolean().default(true),
    })
    const fields = volatileFields(schema)
    assert.ok(fields)
    assert.deepEqual(Object.keys(fields), ['notifications'])
    assert.equal(volatileFields(undefined), undefined)
    assert.equal(volatileFields({ type: 'string' }), undefined)
    assert.equal(volatileFields({ type: 'object', dict: {} }), undefined)
  })
})

describe('volatile config references', () => {
  it('identifies the shared reference protocol without importing cosmokit', () => {
    assert.equal(isVolatileRef(volatileRef(true)), true)
    assert.equal(isVolatileRef({ get: () => true }), false)
    assert.equal(isVolatileRef(false), false)
    assert.equal(isVolatileRef(null), false)
  })

  it('dereferences refs once and keeps every plain key untouched', () => {
    const raw = {
      mode: 'active',
      autoSelectAll: false,
      notifications: volatileRef(false),
      notifyRepeatSeconds: volatileRef(0),
      turnBadgeSeconds: volatileRef(120),
    }
    const resolved = unwrapVolatileConfig(raw)
    assert.deepEqual(resolved, {
      mode: 'active',
      autoSelectAll: false,
      notifications: false,
      notifyRepeatSeconds: 0,
      turnBadgeSeconds: 120,
    })
    // The refs themselves are untouched.
    assert.equal(raw.notifications.get(), false)
  })

  it('skips broken references instead of failing the whole config', () => {
    const raw = {
      mode: 'observe',
      missing: { get: () => undefined, [WRITE]: () => {} },
      noGetter: { [WRITE]: () => {} },
      throwing: {
        get() {
          throw new Error('boom')
        },
        [WRITE]: () => {},
      },
    }
    assert.deepEqual(unwrapVolatileConfig(raw), { mode: 'observe' })
    assert.deepEqual(unwrapVolatileConfig(undefined), {})
    assert.deepEqual(unwrapVolatileConfig([1, 2]), {})
  })

  it('never lets a parsed __proto__ key change the result prototype', () => {
    const raw = JSON.parse('{"__proto__":{"polluted":true},"mode":"active"}') as Record<
      string,
      unknown
    >
    const resolved = unwrapVolatileConfig(raw)
    assert.equal(resolved.mode, 'active')
    assert.equal(Object.getPrototypeOf(resolved), Object.prototype)
    assert.equal('polluted' in resolved, false)
  })

  it('keeps undeclared keys when the config goes through sanitizeConfig again', () => {
    const raw = {
      mode: 'active',
      autoSelectAll: false,
      allowHighRiskGrants: true,
      notifications: volatileRef(true),
    }
    const before = sanitizeConfig({ mode: 'active', autoSelectAll: false, allowHighRiskGrants: true })
    const after = sanitizeConfig(unwrapVolatileConfig(raw))
    assert.deepEqual(after.config, before.config)
    assert.deepEqual(after.warnings, before.warnings)
  })

  it('still warns and falls back when a volatile value is invalid', () => {
    // The real schema's `.loose()` normally drops an invalid value before apply;
    // this guard keeps the YAML fallback honest if a bad value still arrives.
    const { config, warnings } = sanitizeConfig(
      unwrapVolatileConfig({ notifications: volatileRef('yes'), turnBadgeSeconds: volatileRef(-1) }),
    )
    assert.equal(config.notifications, true)
    assert.equal(config.turnBadgeSeconds, 120)
    assert.ok(warnings.some((warning) => warning.field === 'notifications'))
    assert.ok(warnings.some((warning) => warning.field === 'turnBadgeSeconds'))
  })

  it('copies a volatile update into the same runtime object', () => {
    const notifications = volatileRef(true)
    const badgeSeconds = volatileRef(120)
    const raw = {
      mode: 'active',
      autoSelectAll: false,
      notifications,
      turnBadgeSeconds: badgeSeconds,
    }
    const config = sanitizeConfig(unwrapVolatileConfig(raw)).config
    const sameObject = config

    notifications[WRITE](false)
    badgeSeconds[WRITE](45)
    assert.equal(applyVolatileUpdate(config, raw), true)
    assert.equal(config, sameObject, 'the runtime keeps the same object reference')
    assert.equal(config.notifications, false)
    assert.equal(config.turnBadgeSeconds, 45)
    assert.equal(config.mode, 'active')
    assert.equal(config.autoSelectAll, false)

    assert.equal(applyVolatileUpdate(config, raw), false, 'a no-op update reports no change')
  })
})
