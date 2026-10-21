> Language: [English](audit.en.md) · [中文](audit.md)

# Audit / Decision Ledger

## Why

DSH's session log already records actions and approval facts:

- `tool/call` / `tool/result`: each step's execution;
- `approval/asked` / `approval/decided`: each approval (including automatic allows);
- `user-question-reply`: the user's answers to plans/questions;
- `turn/start` / `turn/end`: boundaries.

What is missing is **attribution and rationale**: which plan item did this automatic allow belong to? What was the risk level? Why could it be allowed automatically?

## Why no new event type

DSH does not allow live-appending unknown event types: an unknown event can only be read if it was stored with `ignorable: true`, and `Session.append()` cannot set that flag, so the session refuses to reopen. Therefore:

- no new events such as `approval-ledger/decision`;
- decision content goes into `tool/result.meta` + the plugin ledger, and is then joined by a projection.

## Layers

1. **session log (facts)**: already exists, not duplicated.
2. **`tool/result.meta` (plan level)**:

```json
{
  "planId": "P-7f3a",
  "schemaVersion": 1,
  "matcherVersion": 1,
  "riskPolicyVersion": 1,
  "decision": "approved",
  "approved": ["A", "B"],
  "manual": ["C"],
  "items": [{ "id": "A", "tool": "write", "risk": "medium", "uses": 1 }],
  "grants": [{ "item": "A", "uses": 1, "expires": "turn" }]
}
```

3. **Plugin ledger (per call)**: Sprint 1 uses the **in-memory** `MemoryAuditStore`, partitioned by session; records live only until the session unloads/restarts. `ctx.storageDomain` is a schema-validated KV (`put/delete/entries`), **not** an append-only log; cross-session persistence is deferred so that no `zod` runtime dependency is introduced just for the KV.

```json
{
  "schemaVersion": 1,
  "sessionId": "…",
  "seq": 1234,
  "callId": "call_…",
  "planId": "P-7f3a",
  "itemId": "A",
  "tool": "write",
  "risk": "medium",
  "mode": "danger-full-access",
  "targetHash": "sha256:…",
  "targetSummary": "out/report.md",
  "matchedBy": "plan-scope+risk-gate",
  "outcome": "allowed-once",
  "matcherVersion": 1,
  "time": 1760000000000
}
```

- Full arguments/reason/commands are not stored; only hash/summary/level/attribution.
- The full content is in the session log and can be inspected by authorized readers.

4. **`approval-audit` projection**: joins layers 1–2 + the in-memory ledger, matching by `callId`/`seq`; a missing per-call record is derived from the persisted `tool/call.arguments` + the current risk policy and tagged `derived-session-log`; if it cannot be parsed, it becomes `unattributed`. Output via `/approvals audit [--json]`; no guessing.

## Replay states

| State | Meaning |
|---|---|
| `verified` | approval facts, ledger record, versions, outcome, and tool all agree |
| `unattributed` | there is an approval decision but no matching ledger record; attribution is not guessed |
| `unverifiable` | the record exists, but a version mismatches/is missing, the session does not match, or plan metadata is missing |
| `mismatch` | the ledger outcome or tool disagrees with the approval facts |
| `orphan` | the ledger has a record, but the session log has no corresponding approval fact |
| `pending` | `approval/asked` exists but there is no `approval/decided` |

- If a version field (`schemaVersion` / `matcherVersion` / `riskPolicyVersion`) mismatches or is missing, the state is always `unverifiable`.
- After a restart, records derived from `tool/call` arguments get `matchedBy = derived-session-log`; the risk is recomputed with the current policy, which is explanatory evidence, not proof of the historical policy.
- The report shows only summaries and hash prefixes; raw reason, arguments, and commands never enter the report.
- Facts/ledger rows that fail to parse are recorded as an issue and skipped, so the whole report does not crash.

## Report

```md
## Approval decision record · 2026-10-15 10:12

Plan P-7f3a (4 items, approved at 10:12:03, turn 4)
| Item | Operation | Risk | Grant | Uses | Outcome |
|---|---|---|---|---|---|
| A | write out/report.md | medium | 1 use | 1/1 | auto-allowed 10:12:31 |
| B | write out/data.json | medium | 1 use | 0/1 | unused |
| C | pwsh npm test | high | manual | — | manually allowed 10:13:02 |
| D | write C:\...\config.json | critical | manual | — | manually denied 10:14:10 |

Check: 4 approval events, 4 audit records, 0 unattributed.
```

## Format stability / v1 freeze

Starting with **0.3.0**, audit record format v1 ([`schema/audit-v1.json`](../schema/audit-v1.json)) is **frozen**: no more breaking changes; a genuinely breaking change requires a v2 release that keeps reading v1.

- **Version identifiers**: `$id` ends with `/schema/audit-v1.json`, `properties.schemaVersion.const` is `1`, and `SCHEMA_VERSION` in `src/core/version.ts` is `1`; these three must agree. The top-level `$comment` additionally marks the format `FROZEN` as an explicit freeze marker.
- **v1 fields**: the top level requires `schemaVersion`, `sessionId`, `callId`, `tool`, `risk`, `outcome`, and `time`; it optionally accepts `seq`, `planId`, `itemId`, `mode`, `targetHash`, `targetSummary`, `matchedBy`, `matcherVersion`, and `riskPolicyVersion`. Unknown fields are rejected (`additionalProperties: false`).
- **`target.kind`**: v1 records do not store a `target` object; they store only `targetHash` and `targetSummary`. The `target.kind` enum (`path` / `command` / `args` / `unknown`) only feeds `targetHash` canonicalization, but it is still part of the frozen contract: changing it invalidates every historical hash.
- **`decision` vs `outcome`**: the ledger record field is `outcome`, with the enum `allowed-once` / `rejected` / `cancelled` / `unavailable`; the `decision` in replay rows and exports is that same value. A v1 record has no separate `decision` field.
- **Guardrail**: `test/audit-freeze.test.ts` pins the required set, the enums, `$id`, and the version constants above; changing any of them requires updating that test and following the major-version process below.

### Compatible changes (minor)

- Adding an **optional** field: old records that lack it stay valid and readable, with no migration.
- Widening validation, or adding metadata that does not change the meaning of existing fields.
- A reader upgrade that keeps interpreting old records the same way; historical records are never rewritten.

### Breaking changes (major, requires v2)

- Deleting or renaming a field (including renaming `outcome` to `decision`).
- Changing a field's meaning or unit (for example `time` from milliseconds to seconds, or a different meaning for `outcome`).
- Adding a required field, or turning an optional field into a required one.
- Tightening validation: narrowing an enum, lowering a length/number bound, or rejecting records that were previously valid.
- Changing the `targetHash` canonicalization algorithm or the `target.kind` values.

Any of these requires a v2 schema and **continued v1 read support**; the same `schemaVersion: 1` must never silently change meaning.

### Old records stay readable

- After v2 exists, readers must still parse `schemaVersion: 1` records and select the validation/interpretation path by `schemaVersion`.
- v1 records must not be silently reinterpreted as v2; upgrades are explicit and one-way, and historical records stay untouched.
- If a version is unknown or a field is outside the known contract, stay fail-closed: record an issue / `unverifiable`, never guess or drop.

## Privacy / lifecycle

- The ledger stores metadata only; no secrets/arguments/reason.
- Retention is configurable (default 30 days); cleaned up on `session/disposed`.
- fork/resume: the ledger is keyed by session id; a fork copies the log, the ledger reads the parent session read-only, and the new session records anew.
- When version fields mismatch, mark it "unverifiable"; no guessing.
