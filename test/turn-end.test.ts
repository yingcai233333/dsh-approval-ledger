import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { sanitizeConfig } from '../src/config.js'
import type { PluginConfig } from '../src/config.js'
import type { TurnEndRunOptions } from '../src/notify/flash.js'
import {
  createTurnEndNotifier,
  isCancelledTurn,
  isSubagentSession,
  turnEndAlertEnabled,
} from '../src/notify/turn-end.js'
import { registerRuntime } from '../src/plugin/runtime.js'
import type { Context, Session, SessionEvent } from '../src/types/dsh-runtime.js'
import { FakeContext, makeEvent } from './helpers/fake-context.js'

function config(overrides: Record<string, unknown> = {}): PluginConfig {
  return sanitizeConfig({ mode: 'active', ...overrides }).config
}

function session(id: string, header?: Session['header']): Session {
  return {
    id,
    seq: 0,
    header,
    eventAt: () => undefined,
    snapshotEvents: () => [],
  }
}

function recorder(): { alerts: TurnEndRunOptions[]; alert: (options: TurnEndRunOptions) => void } {
  const alerts: TurnEndRunOptions[] = []
  return {
    alerts,
    alert: (options) => {
      alerts.push(options)
    },
  }
}

function turnEnd(seq: number, turn: number, kind = 'completed'): SessionEvent {
  return makeEvent(seq, 'turn/end', { turn, reason: { kind } })
}

describe('turn-complete reminders', () => {
  it('alerts once for a root session turn and ignores a duplicate of the same turn', () => {
    const { alerts, alert } = recorder()
    const notifier = createTurnEndNotifier(config(), { platform: 'win32', alert })
    const root = session('s1')

    assert.equal(notifier.observe(root, turnEnd(1, 1)), true)
    assert.equal(notifier.observe(root, turnEnd(2, 1)), false)
    assert.equal(notifier.observe(root, turnEnd(3, 2)), true)
    assert.equal(alerts.length, 2)
  })

  it('dedupes per session, not per turn number', () => {
    const { alerts, alert } = recorder()
    const notifier = createTurnEndNotifier(config(), { platform: 'win32', alert })
    notifier.observe(session('a'), turnEnd(1, 1))
    notifier.observe(session('b'), turnEnd(1, 1))
    assert.equal(alerts.length, 2)
  })

  it('never alerts for a subagent session', () => {
    const { alerts, alert } = recorder()
    const notifier = createTurnEndNotifier(config(), { platform: 'win32', alert })
    const child = session('child', { parentSession: 'root', origin: 'subagent', delegationDepth: 1 })
    assert.equal(isSubagentSession(child), true)
    assert.equal(notifier.observe(child, turnEnd(1, 1)), false)
    assert.equal(alerts.length, 0)
  })

  it('treats a delegation depth without an origin as a subagent too', () => {
    const { alerts, alert } = recorder()
    const notifier = createTurnEndNotifier(config(), { platform: 'win32', alert })
    assert.equal(notifier.observe(session('child', { delegationDepth: 2 }), turnEnd(1, 1)), false)
    assert.equal(alerts.length, 0)
  })

  it('still alerts for a fork, which has a parent but is a root user session', () => {
    const { alerts, alert } = recorder()
    const notifier = createTurnEndNotifier(config(), { platform: 'win32', alert })
    const forked = session('fork', { parentSession: 'root', isSeeded: true } as Session['header'])
    assert.equal(isSubagentSession(forked), false)
    assert.equal(notifier.observe(forked, turnEnd(1, 1)), true)
    assert.equal(alerts.length, 1)
  })

  it('treats a session without a header as a root session', () => {
    const notifier = createTurnEndNotifier(config(), {
      platform: 'win32',
      alert: () => {},
    })
    assert.equal(isSubagentSession(session('plain')), false)
    assert.equal(notifier.observe(session('plain'), turnEnd(1, 1)), true)
  })

  it('honours notifyOnTurnEnd and the notifications master switch', () => {
    const off = recorder()
    const disabled = createTurnEndNotifier(
      config({ notifyOnTurnEnd: false }),
      { platform: 'win32', alert: off.alert },
    )
    assert.equal(disabled.observe(session('s1'), turnEnd(1, 1)), false)

    const silent = recorder()
    const masterOff = createTurnEndNotifier(
      config({ notifications: false }),
      { platform: 'win32', alert: silent.alert },
    )
    assert.equal(masterOff.observe(session('s1'), turnEnd(1, 1)), false)
    assert.equal(off.alerts.length + silent.alerts.length, 0)
    assert.equal(turnEndAlertEnabled(config({ notifications: false })), false)
  })

  it('stays silent when both output channels are off', () => {
    const { alerts, alert } = recorder()
    const notifier = createTurnEndNotifier(
      config({ flashWindow: false, soundAlert: false }),
      { platform: 'win32', alert },
    )
    assert.equal(notifier.observe(session('s1'), turnEnd(1, 1)), false)
    assert.equal(alerts.length, 0)
  })

  it('drops the badge but keeps the sound when flashWindow is off', () => {
    const { alerts, alert } = recorder()
    const notifier = createTurnEndNotifier(config({ flashWindow: false }), {
      platform: 'win32',
      alert,
    })
    notifier.observe(session('s1'), turnEnd(1, 1))
    assert.deepEqual(
      { flash: alerts[0]?.flash, badge: alerts[0]?.badge, sound: alerts[0]?.sound },
      { flash: false, badge: false, sound: true },
    )
  })

  it('passes the badge lifetime and uses the configured channels', () => {
    const { alerts, alert } = recorder()
    const notifier = createTurnEndNotifier(config({ turnBadgeSeconds: 0 }), {
      platform: 'win32',
      alert,
    })
    notifier.observe(session('s1'), turnEnd(1, 1))
    assert.deepEqual(
      {
        flash: alerts[0]?.flash,
        badge: alerts[0]?.badge,
        sound: alerts[0]?.sound,
        badgeSeconds: alerts[0]?.badgeSeconds,
        platform: alerts[0]?.platform,
      },
      { flash: true, badge: true, sound: true, badgeSeconds: 0, platform: 'win32' },
    )
  })

  it('skips cancelled turns', () => {
    const { alerts, alert } = recorder()
    const notifier = createTurnEndNotifier(config(), { platform: 'win32', alert })
    assert.equal(isCancelledTurn({ kind: 'aborted', reason: { kind: 'user' } }), true)
    assert.equal(notifier.observe(session('s1'), turnEnd(1, 1, 'aborted')), false)
    assert.equal(alerts.length, 0)
  })

  it('ignores other events and malformed payloads without throwing', () => {
    const { alerts, alert } = recorder()
    const notifier = createTurnEndNotifier(config(), { platform: 'win32', alert })
    assert.equal(notifier.observe(session('s1'), makeEvent(1, 'turn/start', { turn: 1 })), false)
    assert.equal(
      notifier.observe(session('s1'), makeEvent(2, 'turn/end', null)),
      true,
      'a payload without a turn still alerts once',
    )
    assert.equal(
      notifier.observe(session('s1'), makeEvent(2, 'turn/end', null)),
      false,
      'the seq fallback still dedupes the same event',
    )
    assert.equal(alerts.length, 1)
  })

  it('swallows a failing alert sink', () => {
    const notifier = createTurnEndNotifier(config(), {
      platform: 'win32',
      alert: () => {
        throw new Error('powershell exploded')
      },
    })
    assert.equal(notifier.observe(session('s1'), turnEnd(1, 1)), false)
  })

  it('forgets a disposed session and clears on dispose', () => {
    const { alerts, alert } = recorder()
    const notifier = createTurnEndNotifier(config(), { platform: 'win32', alert })
    notifier.observe(session('s1'), turnEnd(1, 1))
    notifier.forget('s1')
    notifier.observe(session('s1'), turnEnd(2, 1))
    assert.equal(alerts.length, 2)
    notifier.dispose()
  })

  it('is wired into the session/event listener without touching the approval flow', () => {
    const alerts: TurnEndRunOptions[] = []
    const ctx = new FakeContext()
    const dispose = registerRuntime(ctx as unknown as Context, config(), {
      turnEndAlert: (options) => alerts.push(options),
    })
    const root = session('session-root')
    ctx.emitSessionEvent(root, makeEvent(1, 'turn/start', { turn: 1 }))
    ctx.emitSessionEvent(root, turnEnd(2, 1))
    ctx.emitSessionEvent(root, turnEnd(3, 1))
    ctx.emitSessionEvent(
      session('session-child', { origin: 'subagent', delegationDepth: 1 }),
      turnEnd(4, 1),
    )
    assert.equal(alerts.length, 1)

    ctx.emitDisposed(root)
    dispose()
  })
})
