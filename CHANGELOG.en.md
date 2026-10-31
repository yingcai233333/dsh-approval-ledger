# Changelog

> Language: [English](CHANGELOG.en.md) · [中文](CHANGELOG.md)

All notable changes to this project are documented here.

## [1.2.1] - 2026-10-31

### Fixed

- **Session-scope auto-allow did nothing in PTC sessions and for dsh-ops tools**: a PTC inner call writes only `tool/ptc-dispatch-start` and never a matching `tool/call`, so `SessionTracker` had no arguments and write/command calls were assessed as `unknown`; dsh-ops `ops_*` tools were absent from the risk policy and were assessed as `unknown-tool`. `SessionTracker` now reads the arguments from `tool/ptc-dispatch-start` (`subCallId` as the callId, `name` as the tool, `arguments` as an object or a JSON string, still dropped above 1 MB) and its history scan recognises that event too; `src/core/tools.ts` now covers the dsh-ops read/write/move/delete/command tools and `ops_job_kill` (`ops_batch`/`ops_load_sdk` keep failing closed because their semantics are unclear). `ops_bash`'s `{command}` goes through command risk assessment, `rm -rf` still hits the delete exemption, and `ops_remove` always stays manual; the `to` destination of `ops_copy`/`ops_move` is assessed too, so the risk is never derived from the source path alone.

### Tests

- Extended `test/session-tracker.test.ts`: a PTC dispatch resolves `args`/`tool`/`turn` through both `observe` and the history scan, with object and JSON-string arguments, a non-matching `subCallId`, no turn boundary, and the over-1 MB fail-closed case.
- New `test/tools.test.ts`: the dsh-ops read/write/command/move/delete/interface classification, `ops_batch`/`ops_load_sdk` staying `unknown`, and `ops_bash`'s `{command}` being recognised by command risk assessment.
- `test/session-auto.test.ts` gains integration cases: with dispatch arguments present, `ops_bash` is auto-allowed (`matchedBy: session-scope+risk-gate`), while `ops_bash` with `rm -rf` and `ops_remove` are still stopped by the delete exemption (`matchedBy: session-auto-delete-blocked`).
- 430 tests pass in total, `pnpm lint` reports 0 warnings, and `pnpm build` succeeds.

## [1.2.0] - 2026-10-31

### Added

- Session-scope auto-allow: `/approvals auto` shows the state, and `/approvals auto on|off` changes the current session only. The switch survives turn end and disappears on session end, plugin unload, or restart. In `active` mode low/medium/high calls are allowed directly while delete requests, `critical`, and `unknown` still require manual approval. Under `observe`/`auditOnly`, `auto on` is rejected with "observe mode does not allow".
- The settings panel gains an "Auto-allow" group and "New sessions auto-allow by default" (`autoAllowSessions`, default `false`, volatile). It only affects sessions that start afterwards; a running session keeps its start-up snapshot and must use `/approvals auto on|off`. `src/config-schema.ts`, `client.js`, and the zh/en copy were updated together.
- Delete-intent detection (`src/grants/delete-intent.ts`): a delete-tool name matches directly; otherwise the arguments are serialized with a bound (≤8,192 characters; a serialization failure or oversized payload counts as a delete, fail closed) and matched against delete features (`rm`/`rmdir`/`rd`/`del`/`erase`/`unlink`/`remove-item`/`trash`/`rimraf`, `git clean`, `find -delete`, `.delete(`, `shutil.rmtree`, `os.remove`, `fs.rm`). `src/risk/commands.ts` exports the same `DELETE_INTENT_PATTERN`, which the command risk engine reuses.
- Two new fixed `matchedBy` audit values: `session-scope+risk-gate` (session-scope allow) and `session-auto-delete-blocked` (delete exempted, official card used). No new field and no audit format v1 change.

### Security

- Session-scope allow only works while the store is `active`; `critical`/`unknown` are never automatic, deletes always use the official approval card, and any inspection/read failure fails closed to `next()`.
- `SessionAutoAllow` in `src/grants/session-auto.ts` keeps state per session, caps it at 64 and evicts the oldest, forgets one session on `session/disposed`, and clears everything on plugin `dispose()`.

### Tests

- New `test/session-auto.test.ts`: switch, capacity, `forget`/`clear`, config-default snapshot, positive/negative delete detection, the `observe` rejection, the allow/exemption `matchedBy` values, and the fail-closed exception path.
- 411 tests pass in total, `pnpm lint` reports 0 warnings, and `pnpm build` succeeds.

## [1.1.3] - 2026-10-29

### Fixed

- **The turn-complete chime waited for the window to come back**: the script emitted the sound after the badge watcher, and that watcher polls until the window is foreground again (or the badge lifetime ends) — so the flash and the green dot appeared on completion while the sound only played when you clicked back; with `turnBadgeSeconds: 0` (stay until you return) it effectively never played. The chime now runs before the badge, so it fires within ~2 s of completion (that ~2 s is PowerShell start-up + C# compilation + waveform synthesis, the same fixed cost approval alerts always had). A unit test asserts the chime precedes the badge wait loop.

## [1.1.2] - 2026-10-28

### Fixed

- **The turn-complete alert has never actually run since 1.1.0**: the script is ~13,000 characters and `-EncodedCommand` expands it to UTF-16 base64, ~34,700 — past Windows' 32,767-character command-line ceiling — so `spawn` threw `ENAMETOOLONG`. Alerts are best-effort, the failure was swallowed, and the alert was built, dispatched, and never executed: no flash, no green badge, no "di-di". Approval alerts encode to ~30,100 and stayed under the ceiling, which is why only the completion channel was silent. The script is now deflated and run from a single-line inflate stub (~12,000 encoded characters), an oversized command is no longer spawned at all, and unit tests assert the encoded length of every alert shape.
- This was not caused by the desktop update: `0.2.1-rc.3` and `rc.2` ship byte-identical interface implementations (see `docs/compatibility.md`); the 1.1.0 foreground-gate addition pushed the command line over the ceiling.

## [1.1.1] - 2026-10-21 (published to npm, `latest`)

### Fixed

- `dshhub.categories` in `package.json` had been mangled in the 1.1.0 package (`瀹夊叏` / `鏁堢巼`); restored to `安全` / `效率`. No functional impact — this only affects how the plugin's categories show up in the market.

## [1.1.0] - 2026-10-21 (published to npm, `latest`)

### Added

- `turnEndOnlyWhenAway` (default `true`): the turn-complete alert only fires while the DeepSeek Harness window is **not** foreground, skipping the taskbar flash, the green badge, and the sound together — no noise while you are watching, and it alerts when you switch away or minimize; if the window cannot be found it still alerts (the chime is still useful). Set it to `false` for unconditional alerts. It only affects the turn-complete alert; approval, plan, and question alerts are unchanged.
- Visual settings panel: DSH Settings gains an "Approvals & alerts" section (`settings.section`, entry `approval-ledger`) that edits the ten reminder/display switches click-to-save (master switch, flash, sound, the four alert sources, the turn-complete foreground gate and badge lifetime, the repeat interval). The write path is `configForms` → `settings.mutate` → the DSH `configEditor`, which atomically writes the profile's `cordis.patch.yml` and hot-applies it — no restart and no plugin remount; the plugin itself never writes a file. `mode`, high-risk grants, limits, and audit retention stay YAML-only.

## [1.0.0] - 2026-10-21 (published to npm, `latest`)

This release **marks audit record format v1** ([`schema/audit-v1.json`](schema/audit-v1.json), documented in [`docs/audit.md`](docs/audit.md)) **and the public interface as stable**: v1 has been frozen since 0.3.0, and 1.0.0 commits to no further breaking changes; if a breaking change is ever required, it must follow the major-version process in `docs/audit.md`, ship a new format, and keep reading v1. All four changes made after 0.3.0 are included in this release.

### Added

- A completed turn now alerts too: taskbar flash + a green taskbar overlay badge + two short "di-di" beeps (B5 -> E6). `notifyOnTurnEnd` (default `true`) switches it on or off; `turnBadgeSeconds` (default `120`, `0` = until you come back to the window) caps the badge lifetime. Subagent turns and aborted turns stay silent.
- `src/plugin/session-log.ts`: session history reads now go through a single point (upstream deprecated `snapshotEvents()`); when the log cannot be read it degrades through three states and fails closed — no grant is created, nothing is auto-allowed, and the official approval card decides.
- `package.json` declares `engines.dsh: ">=0.2.1-rc.2 <0.3.0-0"`, so installs and startups are actually gated on the DSH version; `dshhub.compatibility.dsh` carries the same range. Previously `dsh.compatibility.dshReleases` gated nothing.

### Fixed

- The bottom-right approval note no longer mounts an empty fixed container when nothing is pending (its old `content === null` check could never be true).

### Tests

- Client-half tests (23), the frozen audit-format guard, the session-history adapter and its three-state degradation, turn-complete alerts, and the manifest gate; 357 tests pass in total, `pnpm lint` reports 0 warnings, and `pnpm build` succeeds.

## [0.3.0] - 2026-10-21 (published to npm, `latest`)

### Changed

- Sprint 3 version milestone: all three features planned for 0.3 — high-risk opt-in with a second confirmation, the `ask_choices` structured question card, and the cross-session read-only list (`/approvals sessions`) — shipped on the 0.2 line. This release adds no new features; it only closes the version.
- The code is the same as `0.2.0-beta.15`; only the `package.json` version is bumped to `0.3.0`.

### Verification

- On 2026-10-21, live two-sibling `approval/request` ordering was verified: 2/2 samples passed, with our prepended listener rewriting `displayReason` before both probe siblings ran, and a matching plan grant short-circuited to `allowed-once` so later siblings never ran.

## [0.2.0-beta.15] - 2026-10-20 (published to npm, `next`)

### Documentation

- The Chinese and English READMEs now have a "Screenshots" section (plan review, official approval card + pending-approval note, structured question card); images live in `assets/` and use absolute raw URLs.
- No code changes; this release only refreshes the README shown on npm.

## [0.2.0-beta.14] - 2026-10-20 (published to npm, `next`)

### Fixed

- Alerts never fired: with `detached: true` / `windowsHide: true`, `powershell.exe` started and then exited without running `-EncodedCommand` (exit 0 with `detached`, `0xC0000142` with `windowsHide`), and the error was swallowed. The helper now spawns with `stdio: 'ignore'` only, so the script runs reliably.
- The alert helper no longer calls `Get-Process` to find the window (that step logged a `4100` warning); it now only searches by window title.
- The bottom-right pending-approval note renders again: `shell.overlay` does not receive a `sessionId`, so the overlay now falls back to scanning session status for a pending approval.

### Changed

- The Windows sound is now a soft synthesized "ding-dong" (G5 -> C5, sine with per-note fades) instead of the system sound; it no longer depends on the system sound scheme, and `SystemSounds.Asterisk` is only a fallback.
- Unknown-tool approval titles prefer the `action` value (e.g. `插件管理 · list_plugins · 完全访问`) instead of `args{1}`.

### Tests

- Updated `test/flash.test.ts` for the new spawn options and the synthesized sound.

## [0.2.0-beta.13] - 2026-10-20 (published to npm, `next`)

### Added

- Alerts now cover every card that needs your input: plan review, the per-item selection, `ask_choices`, and official approval cards. Previously only official approval cards flashed.
- Alerts are switchable per source: `notifyOnPlan`, `notifyOnQuestion`, `notifyOnApproval`; `flashWindow` and `soundAlert` are independent switches.
- `notifyRepeatSeconds`: repeat the alert every N seconds while the card stays pending; default `0` means once.
- Windows sound uses the system exclamation sound (`SystemSounds`) with no new dependency, still through the best-effort hidden PowerShell helper.
- Flash flags now use `FLASHW_ALL`, so both the caption and the taskbar button flash; Windows may still skip flashing while the window is foreground, and the sound is the fallback.

### Fixed

- `ask_choices` now returns the selected option text to the model, so it can see which option you picked. Previously it only returned "received N answers".

### Changed

- `autoSelectAll` still defaults to `false`; the desktop profile must remove it or set it to `false` to get the per-item selection back.

## [0.2.0-beta.12] - 2026-10-20 (published to npm, `next`)

### Fixed

- Rebuilt the Host artifact for `autoSelectAll`, so approving a plan actually skips the second per-item checklist.
- The beta.11 package was missing that build artifact and is superseded by beta.12.

## [0.2.0-beta.11] - 2026-10-20 (published to npm, `next`; superseded by beta.12)

### Added

- `autoSelectAll`: after plan approval, all auto-eligible items are authorized without a second per-item checklist; high/critical/unknown items still use the official card per call.
- Designed for the one-approval batch flow; off by default.

### Note

- The published package was missing the Host build artifact for `autoSelectAll`, so the feature did not work; it is superseded by beta.12.

## [0.2.0-beta.10] - 2026-10-20 (published to npm, `next`)

### Fixed

- The approval-details dialog is now forced to Chinese: tool names, summary, and hints no longer fall back to English when locale detection fails.
- Removed the English fallback branch from the hint list.

## [0.2.0-beta.9] - 2026-10-20 (published to npm, `next`)

### Added

- `/approvals last`: shows the most recent plan and each item's result, marking auto/manual and allowed/rejected/not recorded.
- The result comes from the plan cache plus audit attribution; it never shows scope, paths, commands, or arguments.

## [0.2.0-beta.8] - 2026-10-19 (published to npm, `next`/`latest`)

### Changed

- `request_approvals` now returns a Chinese summary listing each item as auto/manual, so it is clear which items received authorization.
- The tool description now tells the agent to call `request_approvals` first when a task has multiple privileged calls.
- The inline Chinese note now uses a `shell.overlay` lower-right panel that appears with the approval card; it adds no allow/reject buttons.

## [0.2.0-beta.7] - 2026-10-19 (published to npm, `next`/`latest`)

### Added

- When an approval card is pending, a Chinese "approval note" is shown inline above the composer; no need to click the header's "Approval details" first.
- The note shows a Chinese summary and three Chinese hints; it deliberately adds **no allow/reject buttons** — decisions stay on the official approval card below.
- The header "Approval details" entry remains as a fallback for the full view.
- The note does not show the raw English reason, full arguments, or commands.

## [0.2.0-beta.6] - 2026-10-19 (published to npm, `next`/`latest`)

### Fixed

- Windows flash now falls back to a window-title search: when `Get-Process` has no `MainWindowHandle`, `EnumWindows` finds a visible window whose title contains `DeepSeek Harness`.
- Live verification: with Harness in the background, three cycles were visibly flashed in the window/taskbar; a foreground window does not flash, which is Windows' expected behavior.
- Missing windows, PowerShell/EDR refusal, and non-Windows platforms still skip silently without blocking approval.

## [0.2.0-beta.5] - 2026-10-19 (published to npm, `next`/`latest`)

### Added

- `/approvals sessions`: read-only summaries of grants across sessions (plan count and active/manual/blocked/exhausted counts).
- Summaries contain no scope, paths, commands, or arguments; there is no cross-session match and other sessions' grants cannot be used.
- `GrantStore.listSessionSummaries()` returns aggregate counts only; session isolation and fail-closed behavior are unchanged.

## [0.2.0-beta.4] - 2026-10-19 (published to npm, `next`/`latest`)

### Added

- Added the `ask_choices` Host tool: structured single/multi-select questions through the official question card.
- Supports 1-5 questions, 2-10 options per question, option descriptions, and a `recommended` marker rendered as `（推荐）`.
- Only collects choices; never executes actions or changes grants. Cancellation returns `cancelled: true`.
- Question and option text goes through `scrubSecrets` and the same sanitizer as plan documents.

## [0.2.0-beta.3] - 2026-10-19 (published to npm, `next`/`latest`)

### Changed

- The approval intro is Chinese-first: tool names (write file, PowerShell command, etc.), modes (read-only, workspace-write, full access), risk reasons, and status labels are shown in Chinese.
- Plan cards no longer show English model titles/notes; when the model only supplied English, the card uses a system-derived Chinese description.
- Added a "How to read this approval" section explaining auto/manual, modes, risk, and why plan approval is not per-call execution.
- The client approval-details modal no longer shows the raw English reason; it shows Chinese explanation points instead.

## [0.2.0-beta.2] - 2026-10-19 (published to npm, `next`/`latest`)

### Changed

- Documentation now uses **Simplified Chinese as the primary language**: `README.md`, `CHANGELOG.md`, `SECURITY.md`, `CONTRIBUTING.md`, and `docs/*.md` default to Chinese; English lives in matching `.en.md` files.
- npm shows the Chinese `README.md` by default; `README.en.md` is included in the package.
- Added the Chinese `docs/README.md` and English `docs/README.en.md` indexes plus a documentation-pairing test.
- No code changes from `0.2.0-beta.1`.

## [0.2.0-beta.1] - 2026-10-19 (published to npm, `next` tag)

### Added

- Client half: a localized session-header "审批详情 / Approval details" button with a red dot for pending approvals, a `● ` document-title prefix, and a read-only modal showing tool, call, Host-rewritten summary, and original reason. It never answers the approval.
- Best-effort Windows flash via a hidden encoded PowerShell `FlashWindowEx` helper; opt-out with `flashWindow: false`, non-Windows no-op, no waterfall blocking.
- FakeContext coverage for sibling `approval/request` prepend ordering.
- Bilingual documentation: every user-facing Markdown document has an English/Simplified-Chinese pair, a top `Language` switch, and a `docs/README` index; `test/docs-i18n.test.ts` enforces the pairing.

### Changed

- Default remains **observe**; `mode: active` is the explicit opt-in for medium auto-approval. High/critical/unknown remain manual/never-auto.
- Version is `0.2.0-beta.1`; not published.

## [0.1.0-beta.1] - 2026-10-18 (not published)

### Added

- Sprint 1 Host plugin: `request_approvals` tool, `/approvals [audit [--json] | grants]` command, and a prepended `approval/request` hook.
- Observe mode by default: grants are simulated and audited as `would-allow`, but never return `allowed-once`.
- Official plan-review card with a sanitized Markdown document, one approve/discuss question, and no `callId`.
- A second official multi-select question after plan approval: only checked items receive grants; unselected items stay manual. This is the per-item choice/veto point while the official plan card keeps its one-question shape.
- In-memory `(session, turn)` grant store with plan-scope and per-call risk gates, dependency stages, use consumption, manual/blocked bookkeeping, and turn/session revocation.
- `displayReason` rewrite with the real mode + target summary; original reason remains in the session log.
- Client half: a localized session-header "审批详情 / Approval details" button with a red dot for pending approvals, a `● ` document-title prefix, and a read-only modal showing tool, call, Host-rewritten summary, and the original reason. It has no allow/reject controls.
- Best-effort Windows flash: when an official approval card is actually waiting, the Host spawns a hidden encoded PowerShell helper that calls `FlashWindowEx` for the DeepSeek Harness window. It is disabled by `flashWindow: false`, never runs on non-Windows, never blocks the waterfall, and silently ignores missing windows/EDR failures.
- `/approvals audit` folds durable session events + `tool/result.meta`, derives missing per-call records from `tool/call` arguments (`derived-session-log`), and never guesses.
- Structural DSH type surface (`src/types/dsh.d.ts`) and a read-only runtime spike (`docs/runtime-spike.md`); no `@deepseek-ai/*` runtime imports.
- Local config sanitizer with safe defaults: observe, high-risk grants off, second confirmation forced on, retention/limits bounds.
- 273 unit tests, including FakeContext plugin integration and bilingual documentation pairing checks.

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
