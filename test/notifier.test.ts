import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { sanitizeConfig } from '../src/config.js'
import type { PluginConfig } from '../src/config.js'
import type { PendingReminder } from '../src/notify/notifier.js'
import { createNotifier, notifyKindEnabled } from '../src/notify/notifier.js'

function config(overrides: Record<string, unknown> = {}): PluginConfig {
  return sanitizeConfig({ mode: 'active', ...overrides }).config
}

function countingSpawn(): { spawn: never; calls: () => number } {
  let calls = 0
  return {
    spawn: (() => {
      calls += 1
      return { on() {}, unref() {} } as never
    }) as never,
    calls: () => calls,
  }
}

describe('pending-interaction notifier', () => {
  it('respects the master switch and per-kind switches', () => {
    const spawn = countingSpawn()
    const allOff = createNotifier(config({ notifications: false }), {
      platform: 'win32',
      spawnImpl: spawn.spawn,
    })
    allOff.notify('plan')
    assert.equal(spawn.calls(), 0)

    const planOnly = createNotifier(config({ notifyOnQuestion: false, notifyOnApproval: false }), {
      platform: 'win32',
      spawnImpl: spawn.spawn,
      now: () => 100_000,
    })
    planOnly.notify('question')
    planOnly.notify('approval')
    assert.equal(spawn.calls(), 0)
    planOnly.notify('plan')
    assert.equal(spawn.calls(), 1)
  })

  it('disables the alert when both channels are off or the platform is not Windows', () => {
    const spawn = countingSpawn()
    const silent = createNotifier(config({ flashWindow: false, soundAlert: false }), {
      platform: 'win32',
      spawnImpl: spawn.spawn,
    })
    silent.notify('approval')
    assert.equal(spawn.calls(), 0)

    const linux = createNotifier(config(), { platform: 'linux', spawnImpl: spawn.spawn })
    linux.notify('approval')
    assert.equal(spawn.calls(), 0)
  })

  it('debounces cards that appear back-to-back', () => {
    const spawn = countingSpawn()
    let now = 500_000
    const notifier = createNotifier(config(), {
      platform: 'win32',
      spawnImpl: spawn.spawn,
      now: () => now,
    })
    notifier.notify('plan')
    notifier.notify('question')
    assert.equal(spawn.calls(), 1)
    now += 3000
    notifier.notify('question')
    assert.equal(spawn.calls(), 2)
  })

  it('repeats while pending only when an interval is configured, and stops cleanly', () => {
    const spawn = countingSpawn()
    let now = 700_000
    let tick: (() => void) | undefined
    let cleared = 0
    const notifier = createNotifier(config({ notifyRepeatSeconds: 15 }), {
      platform: 'win32',
      spawnImpl: spawn.spawn,
      now: () => now,
      setIntervalImpl: ((handler: () => void) => {
        tick = handler
        return { unref() {} } as never
      }) as never,
      clearIntervalImpl: (() => {
        cleared += 1
      }) as never,
    })
    const reminder: PendingReminder = notifier.remind('approval')
    assert.equal(spawn.calls(), 1)
    assert.ok(tick !== undefined)
    now += 15_000
    tick?.()
    assert.equal(spawn.calls(), 2)
    reminder.stop()
    assert.equal(cleared, 1)
    notifier.dispose()
  })

  it('does not create a timer when repetition is off', () => {
    const spawn = countingSpawn()
    let timers = 0
    const notifier = createNotifier(config({ notifyRepeatSeconds: 0 }), {
      platform: 'win32',
      spawnImpl: spawn.spawn,
      now: () => 900_000,
      setIntervalImpl: (() => {
        timers += 1
        return { unref() {} } as never
      }) as never,
    })
    notifier.remind('plan').stop()
    assert.equal(timers, 0)
  })

  it('reports kind eligibility for documentation and tests', () => {
    assert.equal(notifyKindEnabled(config(), 'plan'), true)
    assert.equal(notifyKindEnabled(config({ notifyOnPlan: false }), 'plan'), false)
    assert.equal(notifyKindEnabled(config({ flashWindow: false, soundAlert: false }), 'approval'), false)
  })
})
