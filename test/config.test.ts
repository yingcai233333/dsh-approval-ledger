import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  DEFAULT_CONFIG,
  isObserveOnly,
  planLimitsFromConfig,
  riskPolicyFromConfig,
  sanitizeConfig,
} from '../src/config.js'

describe('plugin config', () => {
  it('uses safe defaults for missing or null input', () => {
    for (const input of [undefined, null, {}]) {
      const { config, warnings } = sanitizeConfig(input)
      assert.deepEqual(config, DEFAULT_CONFIG)
      assert.deepEqual(warnings, [])
    }
  })

  it('accepts valid values', () => {
    const { config, warnings } = sanitizeConfig({
      mode: 'active',
      allowHighRiskGrants: true,
      requireSecondConfirmForHigh: true,
      notifications: false,
      auditOnly: false,
      auditRetentionDays: 90,
      maxPlanItems: 10,
      maxUsesPerItem: 3,
      maxTotalUses: 30,
      showDetailsButton: false,
      flashWindow: false,
      auditNotices: 'plan',
    })
    assert.equal(config.mode, 'active')
    assert.equal(config.allowHighRiskGrants, true)
    assert.equal(config.auditRetentionDays, 90)
    assert.equal(config.maxPlanItems, 10)
    assert.equal(config.maxUsesPerItem, 3)
    assert.equal(config.auditNotices, 'plan')
    assert.deepEqual(warnings, [])
  })

  it('falls back safely for invalid types and ranges', () => {
    const { config, warnings } = sanitizeConfig({
      mode: 'superuser',
      notifications: 'yes',
      auditRetentionDays: 0,
      maxPlanItems: 100,
      maxUsesPerItem: 9,
      maxTotalUses: -1,
      auditNotices: 'sometimes',
    })
    assert.equal(config.mode, 'observe')
    assert.equal(config.notifications, true)
    assert.equal(config.auditRetentionDays, 30)
    assert.equal(config.maxPlanItems, 20)
    assert.equal(config.maxUsesPerItem, 5)
    assert.equal(config.maxTotalUses, 50)
    assert.equal(config.auditNotices, 'off')
    assert.ok(warnings.some((warning) => warning.field === 'mode'))
    assert.ok(warnings.some((warning) => warning.field === 'notifications'))
  })

  it('forces the high-risk second confirmation back on', () => {
    const { config, warnings } = sanitizeConfig({
      allowHighRiskGrants: true,
      requireSecondConfirmForHigh: false,
    })
    assert.equal(config.requireSecondConfirmForHigh, true)
    assert.ok(warnings.some((warning) => warning.code === 'second-confirm-required'))
  })

  it('auditOnly never enables auto-approval', () => {
    const { config, warnings } = sanitizeConfig({
      mode: 'active',
      auditOnly: true,
      allowHighRiskGrants: true,
    })
    assert.equal(isObserveOnly(config), true)
    assert.equal(riskPolicyFromConfig(config).allowHighRiskGrants, false)
    assert.ok(warnings.some((warning) => warning.code === 'audit-only-forces-observe'))
  })

  it('maps active high-risk opt-in to the risk policy', () => {
    const { config } = sanitizeConfig({
      mode: 'active',
      allowHighRiskGrants: true,
      requireSecondConfirmForHigh: true,
    })
    const policy = riskPolicyFromConfig(config)
    assert.equal(policy.allowHighRiskGrants, true)
    assert.equal(policy.requireSecondConfirmForHigh, true)
    assert.deepEqual(policy.autoLevels, ['low', 'medium'])
  })

  it('maps plan limits', () => {
    const { config } = sanitizeConfig({ maxPlanItems: 8, maxUsesPerItem: 2, maxTotalUses: 12 })
    assert.deepEqual(planLimitsFromConfig(config), {
      maxItems: 8,
      maxUsesPerItem: 2,
      maxTotalUses: 12,
    })
  })

  it('never throws on hostile input', () => {
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error('boom')
        },
        getPrototypeOf() {
          throw new Error('boom')
        },
      },
    )
    const result = sanitizeConfig(hostile)
    assert.deepEqual(result.config, DEFAULT_CONFIG)
    assert.ok(result.warnings.length > 0)
  })
})
