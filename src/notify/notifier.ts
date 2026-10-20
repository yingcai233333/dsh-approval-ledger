import type { PluginConfig } from '../config.js'
import { alertPending } from './flash.js'
import type { AlertRunOptions } from './flash.js'

export type NotifyKind = 'plan' | 'question' | 'approval'

export interface NotifierDependencies {
  platform?: NodeJS.Platform
  processName?: string
  spawnImpl?: AlertRunOptions['spawnImpl']
  now?: () => number
  setIntervalImpl?: (handler: () => void, ms: number) => ReturnType<typeof setInterval>
  clearIntervalImpl?: (timer: ReturnType<typeof setInterval>) => void
}

export interface PendingReminder {
  stop(): void
}

export interface Notifier {
  notify(kind: NotifyKind): void
  /** Alert once, then keep reminding while the card stays pending (if configured). */
  remind(kind: NotifyKind): PendingReminder
  dispose(): void
}

/** Two cards can appear back-to-back (plan review, then item selection); avoid a double beep. */
const DEBOUNCE_MS = 3000

const NOOP_REMINDER: PendingReminder = { stop(): void {} }

export function notifyKindEnabled(config: PluginConfig, kind: NotifyKind): boolean {
  if (!config.notifications) return false
  const scoped =
    kind === 'plan'
      ? config.notifyOnPlan
      : kind === 'question'
        ? config.notifyOnQuestion
        : config.notifyOnApproval
  return scoped && (config.flashWindow || config.soundAlert)
}

/**
 * Map a pending interaction to a best-effort Windows alert. All failures stay
 * silent: the official card is always the source of truth.
 */
export function createNotifier(
  config: PluginConfig,
  dependencies: NotifierDependencies = {},
): Notifier {
  const platform = dependencies.platform ?? process.platform
  const now = dependencies.now ?? Date.now
  const setIntervalImpl = dependencies.setIntervalImpl ?? setInterval
  const clearIntervalImpl = dependencies.clearIntervalImpl ?? clearInterval
  const timers = new Set<ReturnType<typeof setInterval>>()
  let lastAlertAt = 0

  const fire = (kind: NotifyKind): void => {
    try {
      if (!notifyKindEnabled(config, kind)) return
      const at = now()
      if (at - lastAlertAt < DEBOUNCE_MS) return
      lastAlertAt = at
      alertPending({
        flash: config.flashWindow,
        sound: config.soundAlert,
        platform,
        processName: dependencies.processName,
        spawnImpl: dependencies.spawnImpl,
      })
    } catch {
      // Alerts are optional.
    }
  }

  return {
    notify(kind: NotifyKind): void {
      fire(kind)
    },
    remind(kind: NotifyKind): PendingReminder {
      fire(kind)
      if (!notifyKindEnabled(config, kind) || config.notifyRepeatSeconds <= 0) {
        return NOOP_REMINDER
      }
      const timer = setIntervalImpl(() => fire(kind), config.notifyRepeatSeconds * 1000)
      timers.add(timer)
      const unref = (timer as { unref?: () => void }).unref
      if (typeof unref === 'function') unref.call(timer)
      return {
        stop(): void {
          clearIntervalImpl(timer)
          timers.delete(timer)
        },
      }
    },
    dispose(): void {
      for (const timer of timers) clearIntervalImpl(timer)
      timers.clear()
    },
  }
}
