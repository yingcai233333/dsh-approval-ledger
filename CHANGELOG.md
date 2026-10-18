# Changelog

All notable changes to this project are documented here.

## [0.1.0-beta.1] - 2026-10-18 (not published)

### Added

- Sprint 1 Host plugin: `request_approvals` tool, `/approvals [audit [--json] | grants]` command, and a prepended `approval/request` hook.
- Observe mode by default: grants are simulated and audited as `would-allow`, but never return `allowed-once`.
- Official plan-review card with a sanitized Markdown document, one approve/discuss question, and no `callId`.
- A second official multi-select question after plan approval: only checked items receive grants; unselected items stay manual. This is the per-item choice/veto point while the official plan card keeps its one-question shape.
- In-memory `(session, turn)` grant store with plan-scope and per-call risk gates, dependency stages, use consumption, manual/blocked bookkeeping, and turn/session revocation.
- `displayReason` rewrite with the real mode + target summary; original reason remains in the session log.
- `/approvals audit` folds durable session events + `tool/result.meta`, derives missing per-call records from `tool/call` arguments (`derived-session-log`), and never guesses.
- Structural DSH type surface (`src/types/dsh.d.ts`) and a read-only runtime spike (`docs/runtime-spike.md`); no `@deepseek-ai/*` runtime imports.
- Local config sanitizer with safe defaults: observe, high-risk grants off, second confirmation forced on, retention/limits bounds.
- 267 unit tests, including FakeContext plugin integration.

### Changed

- `package.json` version is `0.1.0-beta.1`; not published. Target DSH is `0.2.1-rc.2`.
- Installed into the temporary `approval-p0` profile and, after explicit user approval, into the live `desktop` profile for P0; still not published.
- Audit records use the per-session in-memory ledger plus session-log derivation. `ctx.storageDomain` is a KV store, not an append-only log, so cross-session retention is deferred.

## [0.0.2] - 2026-10-18

### Added

- Pure path matcher: Windows/POSIX normalization, realpath of the nearest existing ancestor, hard-link detection, UNC/ADS/8.3/device-name rejection, directory-only containment, and exact scope matching.
- Pure command matcher: whitespace normalization, shell-metacharacter/interpreter/script/download detection, and exact whole-string matching that refuses unsafe commands.
- Pure args matcher: bounded JSON validation and exact-subset matching with dangerous-key rejection.
- Advisory risk engine: deterministic path/command/tool/mode rules, medium auto-eligibility, high-risk opt-in with a second-confirmation interlock, and fail-closed `unknown`.
- Plan schema validation: unique ids, acyclic dependencies, stage computation, per-item/total use limits, normalized scopes, risk counts, and a stable plan hash.
- Audit ledger: metadata-only records, target hashing, secret-scrubbed summaries, append-only sequence verification, and JSONL round-trip.
- Audit replay/report: joins facts, plan metadata, and ledger records; marks `unattributed`, `unverifiable`, `mismatch`, `orphan`, and `pending` without guessing.
- 162 unit tests covering adversarial paths, command chains, argument edge cases, risk policy, plan validation, ledger integrity, and replay states.

### Changed

- Tests run on Node's built-in test runner after a `tsc` compile (`pnpm test`); no esbuild child process is required.
- The audit JSON Schema now constrains `targetHash`, summary lengths, and identifier lengths.

## [0.0.1] - 2026-10-18

### Added

- Initial repository scaffold.
- Design, threat model, audit, runtime notes, and compatibility documents.
- Host-only no-op Cordis plugin entry.
- CI workflow for typecheck, test, and build.
