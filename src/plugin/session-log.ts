/**
 * The plugin's single reading point for a session's historical event log.
 *
 * Why this exists: DSH 0.2.1-rc.2 deprecates `Session.snapshotEvents()` ("new
 * production calls are prohibited") but offers no supported synchronous
 * replacement for reading a session's full history — `session/event` does not
 * replay seed events, and the official seams (`ctx.sessionProjections` /
 * `ctx.sessionQuery`) are themselves backed by `snapshotEvents()`. The plugin
 * therefore keeps using the deprecated reader for now, but confines every call
 * to this one file so a future removal of the reader needs exactly one change
 * here. See the "known drift" subsection of `docs/compatibility.md` (and
 * `docs/compatibility.en.md`); a migration is tracked as a 1.0 item in
 * `docs/design.md`.
 *
 * Degrading is explicit, never silent: callers receive `{ ok: false, reason }`
 * with a stable short code and must fail closed (no grant, no automatic allow,
 * fall back to the official approval card). Treating an unreadable log as
 * "empty history" would bind a plan grant to turn 0 and leak it across turns.
 *
 * Nothing here persists, logs, or exposes event contents: events are only
 * handed back to the caller in memory.
 */

/** Minimal structural view of one session event; the runtime type is richer. */
export interface SessionEventLike {
  readonly type?: unknown
  readonly seq?: unknown
  readonly time?: unknown
  readonly data?: unknown
}

/** Stable short reason codes; they never carry stack traces or arguments. */
export type SessionEventsUnavailableReason =
  | 'no-snapshot-reader'
  | 'snapshot-unavailable'
  | 'snapshot-threw'
  | 'snapshot-malformed'

export type SessionEventsRead =
  | { ok: true; events: readonly SessionEventLike[] }
  | { ok: false; reason: SessionEventsUnavailableReason }

interface SnapshotCapable {
  snapshotEvents?: unknown
}

/**
 * Read a session's event history through the deprecated synchronous reader.
 *
 * - missing/non-object session or missing method → `no-snapshot-reader`;
 * - a throwing getter → `snapshot-unavailable`;
 * - a throwing reader → `snapshot-threw`;
 * - a non-array result → `snapshot-malformed`.
 *
 * On success the returned array is a frozen copy, so a caller cannot mutate the
 * runtime's own array through it. Event objects are passed by reference; they
 * are read-only to this plugin and must never be persisted.
 */
export function readSessionEvents(session: unknown): SessionEventsRead {
  if (session === null || typeof session !== 'object') {
    return { ok: false, reason: 'no-snapshot-reader' }
  }

  let reader: unknown
  try {
    reader = (session as SnapshotCapable).snapshotEvents
  } catch {
    return { ok: false, reason: 'snapshot-unavailable' }
  }
  if (typeof reader !== 'function') {
    return { ok: false, reason: 'no-snapshot-reader' }
  }

  let raw: unknown
  try {
    raw = (reader as (this: unknown) => unknown).call(session)
  } catch {
    return { ok: false, reason: 'snapshot-threw' }
  }
  if (!Array.isArray(raw)) {
    return { ok: false, reason: 'snapshot-malformed' }
  }

  const events = (raw as readonly SessionEventLike[]).slice()
  return { ok: true, events: Object.freeze(events) }
}
