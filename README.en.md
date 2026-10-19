# dsh-approval-ledger

> Language: [English](README.en.md) · [中文](README.md)

Documentation index: [docs/README.md](docs/README.md) · [docs/README.en.md](docs/README.en.md)

Batch approvals with a risk gate and an auditable decision ledger for **DeepSeek Harness**.

> **Status: Sprint 2 client slice and Windows flash are implemented; live-P0 verified in an isolated profile and the desktop profile.** `request_approvals`, the `/approvals` command, the `approval/request` hook, plan-review rendering, per-item selection, the session-log audit fold, the header approval-details panel, and the best-effort Windows flash are implemented and covered by tests. Approval text is Chinese and published as `0.2.0-beta.5` (`next`/`latest`), including `ask_choices`, the high-risk fallback test, and the cross-session read-only list. The default config is observe-only.

## Why

DSH asks for privileged operations one at a time. Because write/command tools are scheduled exclusively, the first approval blocks everything after it: you cannot collect future approvals without letting the agent declare them first.

This plugin adds:

- **One plan for a batch.** The agent submits `request_approvals`; you review a concise list and approve once.
- **Dependency stages.** Plan items can declare `dependsOn`; the matcher only unlocks a dependent item after its dependencies are consumed.
- **Risk gate.** Every actual call is re-classified. Critical operations are never auto-approved; high-risk ones need an explicit opt-in and a second confirmation; unknown ones stay manual.
- **Decision ledger.** Every auto/manual decision is traceable through the session log, plan-level `tool/result.meta`, and an in-memory per-call ledger; `/approvals audit` derives missing records from durable facts instead of guessing.
- **Official UI first.** The shipped approval card, question card, and plan card are not replaced.

In the current observe-only configuration the plan is reviewed, but each actual call still uses the official approval card; grants are simulated and audited as `would-allow`. Medium auto-approval is available only with an explicit `mode: active` config; it is not the default.

## Safety model

- `critical` is **never** auto-approved.
- `unknown` is always manual.
- Auto-approval requires **two gates**: the plan scope matches **and** the actual call is risk-eligible.
- Path matching resolves symlinks/junctions to the real target and treats hard-linked files as high risk (manual).
- Grants are in-memory, session-scoped, and turn-scoped; they disappear on turn end, unload, or restart.
- Any exception, parse failure, or mismatch falls back to the official approval UI.
- The audit store never records full arguments, commands, reasons, or secrets.

## Install

Published to npm as `0.2.0-beta.5` (`next`/`latest`); the temporary profile and desktop profile were also live-P0 tested. `latest` currently points at the beta and will move when a stable release ships. Install:

```sh
dsh plugin --profile <profile> add dsh-approval-ledger@0.2.0-beta.5
```

To opt into medium auto-approval explicitly:

```yaml
# the plugin row in cordis.patch.yml
- id: approval-ledger
  config:
    mode: active
```

`high` still needs opt-in plus the second-confirmation interlock; `critical` is never auto-approved; `unknown` stays manual.

## Sprint 0 core

The host-side core is dependency-free and does not import DSH types:

- `normalizePath` / `matchPathScope` — case-normalized absolute paths, realpath of the nearest existing ancestor, hard-link detection, UNC/ADS/8.3/device-name rejection, and directory-only containment.
- `normalizeCommand` / `matchCommandScope` — whitespace normalization plus hard rejection of shell metacharacters, interpreters, script files, downloads, and encoded commands from automatic matching.
- `matchArgsScope` — bounded JSON validation and exact-subset matching; arrays must match exactly.
- `assessRisk` — deterministic, advisory levels and reasons; `critical` and `unknown` never auto-approve.
- `validatePlan` — unique ids, acyclic dependencies, stage computation, use limits, normalized scopes, risk counts, and a stable plan hash.
- `AuditLedger` / `replayAudit` / `renderAuditReport` — metadata-only records, hash/scrub summaries, append-only sequencing, and replay that marks missing or conflicting evidence instead of guessing.

## Sprint 1 Host wiring

- `request_approvals` registers a plain DSH tool definition and asks one official plan-review question; after approval it asks a second multi-select question so you can authorize only the items you want. Unchecked items stay manual.
- The client half adds a localized **Approval details** button to the session header, with a red dot for a pending approval and a read-only modal showing the Host-rewritten summary and original reason. It never answers the approval.
- On Windows, the Host can flash the DeepSeek Harness window when an official approval card is actually waiting. It is best-effort, opt-out (`flashWindow: false`), and never blocks or changes the decision.
- Grants are installed in memory per `(session, turn)`; the prepended `approval/request` hook applies the plan gate and the per-call risk gate, and rewrites the card's `displayReason` to a real mode + target summary.
- Observe mode (the default) consumes the simulated grant and records `would-allow`, but never returns `allowed-once`.
- `/approvals [audit [--json] | grants]` folds durable session events plus plan metadata; missing per-call records are derived from `tool/call` arguments and marked `derived-session-log`, never guessed.
- `ctx.storageDomain` is a schema-validated KV store, not an append-only log; Sprint 1 deliberately uses the session log + in-memory ledger instead. Cross-session retention is deferred.

## Sprint 3

- `ask_choices`: structured single/multi-select questions through the official question card, with option descriptions and a `（推荐）` marker. It only collects choices; it never executes actions or changes grants.
- `/approvals sessions`: read-only counts of grants across sessions; it exposes no scope, paths, or commands, provides no cross-session match, and cannot use another session's grants.

## Development

Requirements: Node.js 22+, pnpm.

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

`pnpm test` compiles `src/` and `test/` to `lib-test/` and runs Node's built-in test runner. `pnpm build` emits the Host half to `lib/`.

The package is a Cordis bundle: `cordis.patch.yml` inserts the `approval-ledger` row; `lib/index.js` is the Host half.

## Documentation

- [Design](docs/design.en.md)
- [Threat model](docs/threat-model.en.md)
- [Audit / decision ledger](docs/audit.en.md)
- [Runtime notes](docs/runtime-notes.en.md)
- [Runtime spike (0.2.1-rc.2)](docs/runtime-spike.en.md)
- [Compatibility](docs/compatibility.en.md)
- [Handoff](HANDOFF.en.md)

## License

MIT. See [LICENSE](LICENSE).

## Disclaimer

Unofficial community plugin. Not affiliated with DeepSeek. Do not use the DeepSeek name or logo to imply endorsement.
