/**
 * Session-scoped auto-allow switches.
 *
 * A switch applies to exactly one session id, survives turn boundaries, and
 * disappears on `session/disposed` or plugin dispose. There is no persistence,
 * no cross-session lookup, and no DSH import: the runtime owns the lifecycle and
 * this module only remembers each session's value plus whether the user set it
 * explicitly.
 *
 * Two values coexist per session:
 * - the value captured when the session was first seen (the config default
 *   `autoAllowSessions` at that moment), and
 * - an explicit `/approvals auto on|off` choice, which always wins.
 *
 * A session that is already running keeps its captured value, so toggling the
 * settings panel only changes sessions that start afterwards.
 */

export const DEFAULT_SESSION_AUTO_CAPACITY = 64

export interface SessionAutoAllowOptions {
  /** Maximum number of remembered sessions; the oldest entry is evicted first. */
  capacity?: number
}

function validSessionId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function normalizeCapacity(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : DEFAULT_SESSION_AUTO_CAPACITY
}

/**
 * In-memory map of session ids to auto-allow values.
 *
 * `overrides` marks the sessions whose value came from `/approvals auto on|off`;
 * every other entry is the default captured when the session was first seen.
 * Insertion order is the eviction order: when the capacity is exceeded, the
 * oldest session is forgotten first. Re-enabling an already enabled session is
 * idempotent and does not refresh its position.
 */
export class SessionAutoAllow {
  private readonly sessions = new Map<string, boolean>()
  private readonly overrides = new Set<string>()
  private readonly capacity: number

  constructor(options: SessionAutoAllowOptions = {}) {
    this.capacity = normalizeCapacity(options.capacity)
  }

  /** Number of tracked sessions. */
  get size(): number {
    return this.sessions.size
  }

  /** Configured capacity. */
  get limit(): number {
    return this.capacity
  }

  /**
   * Capture the config default for a session the first time it is seen.
   *
   * Returns whether a new entry was created. An existing entry — explicit or a
   * previous capture — is never overwritten, which is what keeps a running
   * session on the setting it started with.
   */
  ensure(sessionId: string, defaultEnabled: boolean): boolean {
    if (!validSessionId(sessionId)) return false
    if (this.sessions.has(sessionId)) return false
    this.sessions.set(sessionId, defaultEnabled === true)
    this.evict()
    return true
  }

  /** Explicitly turn the switch on for one session. */
  enable(sessionId: string): boolean {
    if (!validSessionId(sessionId)) return false
    if (this.overrides.has(sessionId) && this.sessions.get(sessionId) === true) return false
    this.sessions.set(sessionId, true)
    this.overrides.add(sessionId)
    this.evict()
    return true
  }

  /**
   * Explicitly turn the switch off for one session.
   *
   * The explicit marker is preserved so an `autoAllowSessions: true` default
   * cannot re-enable the session.
   */
  disable(sessionId: string): boolean {
    if (!validSessionId(sessionId)) return false
    if (this.overrides.has(sessionId) && this.sessions.get(sessionId) === false) return false
    this.sessions.set(sessionId, false)
    this.overrides.add(sessionId)
    this.evict()
    return true
  }

  /** Lifecycle removal on session disposal; forgets both the capture and the override. */
  forget(sessionId: string): boolean {
    if (!validSessionId(sessionId)) return false
    this.overrides.delete(sessionId)
    return this.sessions.delete(sessionId)
  }

  /**
   * Whether this exact session is allowed.
   *
   * The fallback is only consulted when the session has never been seen; an
   * existing captured value (even `false`) wins over a newer config value.
   */
  isEnabled(sessionId: string, fallback = false): boolean {
    if (!validSessionId(sessionId)) return false
    return this.sessions.get(sessionId) ?? (fallback === true)
  }

  /** Whether the current value came from `/approvals auto on|off`. */
  hasOverride(sessionId: string): boolean {
    return validSessionId(sessionId) && this.overrides.has(sessionId)
  }

  /** Copy of the session ids that are currently enabled, oldest first. */
  list(): string[] {
    const result: string[] = []
    for (const [sessionId, enabled] of this.sessions) {
      if (enabled) result.push(sessionId)
    }
    return result
  }

  /** Remove every session state (plugin dispose). */
  clear(): void {
    this.sessions.clear()
    this.overrides.clear()
  }

  private evict(): void {
    while (this.sessions.size > this.capacity) {
      const oldest = this.sessions.keys().next().value
      if (oldest === undefined) break
      this.sessions.delete(oldest)
      this.overrides.delete(oldest)
    }
  }
}
