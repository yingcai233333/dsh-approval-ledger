> Language: [English](design.en.md) · [中文](design.md)

# Design

> Goal: give DSH batch approval, risk hints, and a traceable decision ledger **without replacing the official UI** and **without adding new session event types**.

## Goals

- Approve a batch of declared operations at once, reducing serial interruptions.
- Keep the list concise, expandable to show reason/consequences/recommendation.
- Show dependencies by phase and gate them at execution time.
- Highlight critical operations; raise a desktop alert when approval is needed.
- Make decisions traceable and exportable.

## Non-goals

- No "always allow" or "approve everything".
- Do not automatically infer undeclared causal dependencies.
- Do not replace the official approval card / question card / plan card.
- Zero risk is not guaranteed; the aim is only "bounded, reversible, fail-closed".

## Architecture

```
agent
  └─ request_approvals (tool)
       └─ plan-review question (official UI)
            └─ user approves
                 └─ grants (session, turn-scoped)
                      └─ approval/request (prepend listener)
                           ├─ plan gate + risk gate → allowed-once
                           └─ otherwise → official approval UI
```

Audit:

```
session log (facts) + tool/result.meta (plan decision) + audit store (per-call rationale)
  └─ approval-audit projection
       ├─ /approvals audit
       └─ wire.view (plan doc / sidebar)
```

## Plan tool

The schema of `request_approvals` is documented in `HANDOFF.md`. Validation:

- ids unique, dependencies acyclic, tool registered;
- paths absolutized, realpath of the nearest existing ancestor, reject `..` escapes / UNC / ADS / 8.3 / device names / trailing dots and spaces; hard links (`nlink > 1`) treated as high/manual;
- command length limits, control characters / script markers; commands containing metacharacters / interpreters / scripts / downloads are not auto-matched;
- caps on total and per-item uses;
- only the main session is allowed (child sessions have no human answerer).

Plan document:

- first line is the title (including the risk counts);
- the first paragraph is a two-line summary;
- the item table (number / operation / risk / dependencies);
- per-item details (what / why / after approval / system judgment / model note / recommendation).

## Grants

- Per session, per turn; in-memory; not persisted.
- Fields: `planId`, `itemId`, `tool`, `kind`, `mode`, `scope`, `usesLeft`, `deps`, `state`.
- A successful match consumes one use synchronously; an item is ready only when all its dependencies are used.
- All grants are revoked on `turn/end`, `agent/disposed`, plugin unload, or restart.

## Risk policy

| Level | Automatic? |
|---|---|
| medium | Yes (data-class file writes only) |
| high | Manual; opt-in + second confirmation |
| critical | Never |
| unknown | Manual |

The risk engine is deterministic and advisory only; `unknown` is never guessed. See `docs/threat-model.md` for the detailed rules.

## Audit

See `docs/audit.md`. Core points: no new event types; `tool/result.meta` + in-memory ledger + projection; the ledger stores metadata only, never arguments/reason. `ctx.storageDomain` is a KV store, not an append-only log, so in Sprint 1 the durable facts come from the session log and cross-session retention is deferred.

## UI

- Single approval: official card + title summary + header detail popover; `conversation.approval.detail` is not modified.
- Batch: official plan-review + full text in the sidebar.
- Multiple choice: official question + structured `ask_choices` content.
- Alerts: Windows taskbar flash + synthesized "ding-dong" chime for plan review, per-item selection, `ask_choices`, and official approval cards; sources and both channels are configurable.
- The two client surfaces pick their pending approval differently: the header "Approval details" is strictly per session (no `sessionId`, nothing shown, no cross-session scan); the bottom-right "Approval note" is frame-wide and falls back to scanning every session for `kind === 'approval'` when the current one has none.

## Release plan

- 0.1.0-beta.1: observe (record what would have been allowed, without actually allowing it) + plans + audit (target DSH 0.2.1-rc.2; repository milestone, not published to npm).
- 0.2 line (`0.2.0-beta.1` → `0.2.0-beta.15`, 2026-10-19 → 2026-10-20): medium auto-allow + detail popover + flashing; high opt-in + second confirmation, `ask_choices`, and the cross-session read-only list also shipped on this line.
- 0.3.0 (2026-10-21, `latest`): no new features, version close-out only; the code is identical to `0.2.0-beta.15`.
- 1.0.0: declare the v1 audit format and the public interface stable (freeze details in `docs/audit.md`); the compatibility matrix and client tests are done; what remains open is whether to gate cross-version installs with `engines.dsh`, and migrating `Session.snapshotEvents()`, which upstream has marked deprecated.
