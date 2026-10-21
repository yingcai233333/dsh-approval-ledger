import type { PluginConfig } from '../config.js'
import { isPlainObject } from '../core/json.js'
import type { Session, SessionEvent } from '../types/dsh-runtime.js'
import { alertTurnEnd } from './flash.js'
import type { TurnEndRunOptions } from './flash.js'

/** Bound on remembered `(session, turn)` keys; the oldest are dropped first. */
const MAX_REMEMBERED_TURNS = 512

export interface TurnEndNotifierDependencies {
  platform?: NodeJS.Platform
  processName?: string
  spawnImpl?: TurnEndRunOptions['spawnImpl']
  /** Injection point for tests; production uses the PowerShell alert. */
  alert?: (options: TurnEndRunOptions) => void
}

export interface TurnEndNotifier {
  /** Alert for one committed session event. Returns whether it alerted. */
  observe(session: Session, event: SessionEvent): boolean
  forget(sessionId: string): void
  dispose(): void
}

/**
 * Turn-complete alerts are opt-out, but they stay behind the existing master
 * switch: `notifications: false` silences them, `flashWindow` gates the flash
 * and the green badge, and `soundAlert` gates the two-beep chime.
 */
export function turnEndAlertEnabled(config: PluginConfig): boolean {
  return (
    config.notifications && config.notifyOnTurnEnd && (config.flashWindow || config.soundAlert)
  )
}

/**
 * Whether the session was created by the delegation stack.
 *
 * DSH 0.2.1-rc.2 stamps `origin: 'subagent'` on every child session header, so
 * this is a positive signal rather than a guess. `parentSession` alone is not
 * enough: `session/fork` records it too, and a fork is still a session the user
 * is waiting on. A missing header is treated as a root session — the real store
 * always synthesizes one.
 */
export function isSubagentSession(session: Session): boolean {
  try {
    const header: unknown = session.header
    if (!isPlainObject(header)) return false
    if (header.origin === 'subagent') return true
    const depth = header.delegationDepth
    return typeof depth === 'number' && Number.isInteger(depth) && depth > 0
  } catch {
    return false
  }
}

/**
 * A cancelled turn has nothing to come back to (the user, or an ancestor,
 * already stopped it), so it stays silent instead of playing a "done" chime.
 */
export function isCancelledTurn(reason: unknown): boolean {
  if (!isPlainObject(reason)) return false
  return reason.kind === 'aborted'
}

/**
 * Dedupe key for one turn end. `turn/end` always carries `turn`; the `seq`
 * fallback only keeps a malformed duplicate of the same event from alerting
 * twice.
 */
function turnKey(
  sessionId: string,
  event: SessionEvent,
  data: Record<string, unknown> | undefined,
): string {
  const turn = data?.turn
  if (typeof turn === 'number' && Number.isInteger(turn) && turn >= 0) {
    return `${sessionId}#${turn}`
  }
  return `${sessionId}#seq:${String(event.seq)}`
}

/**
 * Best-effort alert on `turn/end`, for every session the Host can see.
 *
 * It is contained by construction: no throw escapes `observe`/`forget`, and no
 * event content is logged, persisted, or passed to the alert helper — the
 * script only receives constant flags and the badge lifetime.
 */
export function createTurnEndNotifier(
  config: PluginConfig,
  dependencies: TurnEndNotifierDependencies = {},
): TurnEndNotifier {
  const platform = dependencies.platform ?? process.platform
  const alert = dependencies.alert ?? alertTurnEnd
  const seen = new Set<string>()

  const remember = (key: string): void => {
    seen.add(key)
    if (seen.size <= MAX_REMEMBERED_TURNS) return
    const oldest = seen.values().next().value
    if (oldest !== undefined) seen.delete(oldest)
  }

  return {
    observe(session: Session, event: SessionEvent): boolean {
      try {
        if (!isPlainObject(event) || event.type !== 'turn/end') return false
        if (!turnEndAlertEnabled(config)) return false
        const data = isPlainObject(event.data) ? event.data : undefined
        if (isCancelledTurn(data?.reason)) return false
        if (isSubagentSession(session)) return false
        const key = turnKey(session.id, event, data)
        if (seen.has(key)) return false
        remember(key)
        alert({
          flash: config.flashWindow,
          sound: config.soundAlert,
          badge: config.flashWindow,
          badgeSeconds: config.turnBadgeSeconds,
          platform,
          processName: dependencies.processName,
          spawnImpl: dependencies.spawnImpl,
        })
        return true
      } catch {
        return false
      }
    },
    forget(sessionId: string): void {
      try {
        const prefix = `${sessionId}#`
        for (const key of seen) if (key.startsWith(prefix)) seen.delete(key)
      } catch {
        // Nothing here can change a turn outcome.
      }
    },
    dispose(): void {
      seen.clear()
    },
  }
}
