> Language: [English](runtime-notes.en.md) · [中文](runtime-notes.md)

# Runtime notes (verified)

> These are facts confirmed during the design phase from the DSH 0.2.0-rc.2 install package/runtime; the current target has been raised to 0.2.1-rc.2, and after the upgrade they must be re-verified according to `docs/runtime-spike.md`.

## Approval

- Entry: `ctx.approval.request({ agent, toolName, callId?, reason?, displayReason?, signal? })`.
- Returns: `allowed-once` | `rejected` | `cancelled` | `unavailable`.
- The service appends `approval/asked` before the waterfall and `approval/decided` after it; auto-allows also leave a trace.
- sandbox escalation reason: `escalate sandbox to <mode>: <justification>`; `displayReason` is `{en, zh}`.
- When `tools/pre-execute` returns `{kind:'ask', reason, displayReason}`, it also goes through `approval.request`.

## Session-scope auto-allow (1.2.0)

- **State**: `SessionAutoAllow` in `src/grants/session-auto.ts` stores each session's value in `Map<sessionId, boolean>` and marks explicit overrides in a separate set. The first time a session is seen (`session/event`, or the first approval/status query) snapshots that session's `config.autoAllowSessions`; `/approvals auto on|off` writes an explicit value for the current session only. `turn/end` does not clear it, `session/disposed` calls `forget`, and plugin `dispose()` calls `clear()`. Capacity is 64 and the oldest insertion is evicted first.
- **Settings-panel semantics**: `autoAllowSessions` (default `false`, volatile) appears under the "Auto-allow" group. It only affects sessions that start afterwards — a running session keeps its start-up snapshot and must use `/approvals auto on|off`.
- **Decision order**: the `approval/request` hook checks the plan grant first. If that misses and the session switch is on, the store is `active`, `prepared.risk.level` is `low|medium|high`, and there is no delete intent, it returns `allowed-once` and audits `matchedBy: 'session-scope+risk-gate'`. `critical` and `unknown` are outside the allowed set; delete intent takes precedence over the risk level, always uses the official card, and audits `matchedBy: 'session-auto-delete-blocked'`.
- **Argument source**: PTC inner calls take their arguments from `tool/ptc-dispatch-start` (`subCallId` as the callId, `name` as the tool, `arguments` as an object or a JSON string), because such a call writes only the dispatch and never a `tool/call`; the dsh-ops `ops_*` tools are now part of the risk classification in `src/core/tools.ts` (`ops_batch`/`ops_load_sdk` stay `unknown` and fail closed because their semantics are unclear).
- **Delete intent**: `hasDeleteIntent` in `src/grants/delete-intent.ts`. A `DELETE_TOOLS` name is enough; otherwise `prepared.args` is serialized with `JSON.stringify`, and a payload over 8,192 characters or any serialization failure (cycle, BigInt, throwing `toJSON`, …) counts as a delete. The bounded string is matched against `DELETE_INTENT_PATTERN` exported by `src/risk/commands.ts` (`rm|rmdir|rd|del|erase|unlink|remove-item|trash|rimraf`, `git clean`, `find -delete`, `.delete(`, `shutil.rmtree`, `os.remove`, `fs.rm`, case-insensitive). The command risk engine reuses the same pattern.
- **observe/auditOnly**: nothing is allowed unless the store is `active`; `/approvals auto on` returns the "observe mode does not allow" error. Status output shows the current mode, the default/explicit source, and the exemptions.
- **Audit compatibility**: only the existing optional `matchedBy` string (max 160) is used; no field and no v1 schema change. Any exception fails closed to `next()`.
- **Tests**: `test/session-auto.test.ts` covers the switch, capacity, `forget`/`clear`, snapshot fallback, positive/negative delete detection, the observe rejection, the allow/exemption `matchedBy` values, and the exception fallback.

## Scheduling

- `dsh-agent-loop` schedules according to `tools.executionMode()`; tools that are not `isConcurrencySafe` are exclusive and run one at a time.
- While the first approval is stuck, the following exclusive calls have not started yet; therefore it is impossible to "wait until all approvals arrive".

## UI slots

- `conversation.approval.detail`: single slot, occupied by `dsh-client-ui-chat`'s `ApprovalCommand`; registering again throws `single slot ... already has a registration`.
- `conversation.input.dock`: in the default composer; it is not rendered when the approval card takes over the composer.
- `conversation.composer`: chain; `ui-approval` priority 1, `ui-user-questions` priority 1 (by kind), `ui-subagent` -10.
- `shell.overlay`: frame-wide, additive; suitable for red dots/overlays.
- `conversation.session.header.utilities`: the list on the right side of the session header; suitable for the "approval details" button.
- `conversation.plan-review.actions`: list; `ui-plan` provides "view full text"; without a callId it opens a temporary review document.

## Plan review

`ui-user-questions`'s `planReviewOf` requires:

- `questions.length === 1`
- `intent.kind === 'plan-review'`
- `question.detail !== undefined`
- `multiSelect !== true`
- `options.length <= 2`
- an `option.label === intent.approve` exists

Once these are satisfied the plan card is rendered; the title/description are extracted from the first line/first paragraph of detail; "Discuss" calls `pending.dismiss()`:
- with `callId` → hide (the request is still there and can be reopened from the tool row);
- without `callId` → `ASK_CANCELLED` (the request ends).

## Client state

- `ctx.uiSession.sessionStatus`: `Map<SessionId, { running, pendingInteraction, completionUnread }>`.
- The `pendingInteraction` object has `kind` (approval/question/plan-review), `toolName`, `callId`, `reason`, `displayReason`, `answerable`, `answer()`.
- `useChat` can find the `argsRaw` of a `tool-call` node by callId; this is exactly how ui-chat's `ApprovalCommand` displays commands.

## Session log

- `tool/result` has `meta?: JsonValue`; `ToolExecutionResult.meta` is appended.
- `approval/asked` / `approval/decided` are durable; `user-question-reply` is durable.
- New event types cannot be appended live; unknown events require `ignorable: true` to be read, and live append cannot set it.

## Desktop

- `resources/app.asar`'s `main.js` uses `spawn` to start the `dsh-desktop-host` child process.
- The Host's `process.ppid` is the Electron main process; the window can be found by PID to call `FlashWindowEx`.
- The Electron main process only has `flashFrame`, which is used for update notifications; there is no general attention IPC exposed to plugins.

## Coexistence

- `dsh-experimental-auto-review` does per-call review in `tools/pre-execute` `{prepend:true}`.
- The ecosystem also contains `dsh-approval-gate`, `dsh-approval-review`, `dsh-approval-llm`, `dsh-approval-chime`, `dsh-approval-alert`, `dsh-approval-hotkeys`, `dsh-approval-explain`, and others.
- Multiple auto-approval/notification plugins may contend with each other; `audit-only` / `notifications:false` and compatibility documentation are needed.

## Live dual-plugin sibling approval/request ordering verification (2026-10-21)

**Setup**: temp profile `approval-p0` (`dsh-approval-ledger` installed as `link:D:/AIworkspace/dsh-approval-ledger`, with the base + web-app bundles), CLI launched with Electron-as-Node: `DeepSeek Harness.exe app.asar\dsh\node_modules\@deepseek-ai\dsh\lib\bin.js --profile approval-p0 --patch <repo>\.p0-test\ordering\order.patch.yml --port 3080 --no-open`, with env `DSH_PERMISSION_MODE=read-only` and `APPROVAL_PROBE_LOG=<repo>\.p0-test\ordering\probe-*.ndjson`; the patch overlay set the ledger row to `mode: active, notifications: false` and inserted a local sibling probe plugin (`./sibling-probe/index.js`, mounted as a file:// URL; nothing was installed and the profile's `package.json` was not edited). The probe registers **two** `approval/request` listeners sharing one handler — one `{prepend: true}` and one plain/append — which appends `{toolName, callId, agentId, reason, displayReason}` to NDJSON and then `return next()`. The driver was headless Chrome + CDP (`.p0-test/ordering/order-test.mjs`) operating the real web UI.

| Case | Action | Result |
| --- | --- | --- |
| A manual approval | The prompt asked the model to write `D:\AIworkspace\dsh-approval-ledger\.p0-test\ordering\outside-test.txt` with `sandbox_permissions: "danger-full-access"` and justification "P0 ordering approval rejection test", explicitly without `request_approvals` | The official approval card appeared (~4.0 s). Two listeners, two runs, four probe records in total: run 1 `call_00_8ckGBdcGN3KGwEYZekj79211` seq 2 (prepend) / seq 3 (plain), run 2 `call_00_ed4SenPiN2pxhuOoQCc28374` seq 4 (prepend) / seq 5 (plain). All four `reason` values are `escalate sandbox to danger-full-access: P0 ordering approval rejection test`, and all four `displayReason.en` values are our rewrite `write · …\ordering\outside-test.txt · danger-full-access`, not the sandbox original `Allow this operation with danger-full-access permissions: …`. The card text matched: `写入文件 · …\ordering\outside-test.txt · 完全访问` plus the bottom-right 待审批说明. Clicking 拒绝 produced the tool error `the user rejected escalating this operation to "danger-full-access"`; the file was absent; `/approvals` showed the rejection (1 decision, 1 audit record, 0 unattributed). |
| B plan grant | Plan P-55d23502, one item A (write, risk medium, auto), approved; the per-item selection card was submitted with only A | The session log shows `approval/asked` (id `bd8dc357-808f-46e4-80dd-73c9287d3539`, callId `call_00_ET_VRDiqyCSxFdn48bOE4803052`, reason `escalate sandbox to workspace-write: 按你批准的批次 A 写入 .p0-test/ordering/a.md…`) followed by `approval/decided` with outcome **allowed-once**. The probe has **zero** records for that callId (5 lines total: 1 apply + the 2×2 case-A request records), so the grant short-circuited the waterfall before the sibling listeners ran. The file was created (53 bytes) at `D:\AIworkspace\余烬余生\.p0-test\ordering\a.md` (the temp instance's session workspace was 余烬余生, not this repo), and no approval card was shown. |

**Interpretation**

- **Ordering: PASS** (2/2 case-A samples) — our prepended listener rewrote `displayReason` before both probe listeners (prepend and plain) saw the request; the built-in forwarder `api-remotes` is a sibling placed before our row, so this also shows that prepend beats it.
- **Short-circuit: PASS** — when a plan grant matches, our listener returns `allowed-once` without calling `next()`, so later siblings never run and never see that callId (the zero records in case B are the evidence).
- **Waterfall semantics**: this is the defined waterfall claim semantics. Acceptable for presenter/notifier siblings; **not** acceptable for a stricter policy sibling that must always run. Coexistence caveat: a prepend sibling that mounts after us can preempt us.

**Caveats**

- Cordis mounts entries with `Promise.all`, so the order among prepend siblings is a **race**, not a guarantee; the relative position of a sibling such as `api-remotes` cannot be treated as a contract.
- Small sample: only 2 case-A samples and 1 case-B sample were collected.
- The temp instance's session workspace was 余烬余生, so the case-B file landed there (test artifact).
- Against a prepend sibling mounted later, we cannot guarantee that our rewrite still happens first.

**Evidence** (relative to `.p0-test/ordering/`): `summary.json`, `probe-20261021-131214.ndjson`, `A-card.png`, `B-plan.png`, `B-selection.png`, `B-done.png`; session log `C:\Users\36288\.dsh\sessions\--D-AIworkspace-~4F59~70EC~4F59~751F--\session-dc3d8f41-60cb-491a-b125-a662b5e389a8`.

## Turn-complete alerts and Windows limits (2026-10-21)

- **Trigger**: `turn/end` on `session/event`, payload `{ turn, reason }` (`dsh-agent-loop/lib/index.js:1029-1032`). `reason.kind` has seven values: `completed`, `aborted` (with `reason`), `blocked`, `error` (with `LlmFailure`), `max-tokens`, `interrupted`, `forked` (`TurnEndReasonMap` in `dsh-session`; the first five are produced at `dsh-agent-loop/lib/index.js:961,966,981,1013-1016,1019-1025`). The plugin stays silent only for `aborted` and alerts for the rest; `interrupted` and `forked` are synthetic closers appended on resume/fork (`dsh-agent-loop/lib/index.js:1992-1993`, `dsh-session/lib/types/repair.js:187`) before the session is published, so they never reach the live `session/event` feed.
- **Subagent detection**: `SessionHeader` carries `origin?: 'subagent'` and `delegationDepth?: number` (validated at `dsh-session/lib/index.js:1054`, declared in the typert `SessionHeader`). `origin === 'subagent'` or `delegationDepth > 0` means a subagent session, so no alert; `parentSession` alone is not enough (forks record it too, and a fork is a session the user waits on).
- **Foreground gate**: with `turnEndOnlyWhenAway` (default `true`) the script first finds the window with `FindWindowByTitle`; if the window exists and `GetForegroundWindow()` equals it, the script runs `exit 0` before flash/badge/sound, skipping all three. A window that cannot be found — or a failing check — still alerts (the chime is still useful) instead of going silent. The check uses user32 P/Invoke only and adds no COM dependency; approval alerts never pass through this gate.
- **The flash colour cannot be chosen**: `FlashWindowEx` takes its colour from the system attention setting, so an app cannot ask for green. Green uses `ITaskbarList3.SetOverlayIcon` (IID `ea1afb91-9e28-4b86-90e9-9e9f8a5eefaf`, `HrInit` first) with a 32x32 green-dot HICON.
- **Badge lifetime**: after showing it, the helper polls `GetForegroundWindow()` every 450ms; it clears the overlay and calls `DestroyIcon` when the window comes back, when the window disappears, or after `turnBadgeSeconds`. `turnBadgeSeconds: 0` means no timeout (it stays until you return).
- **Sound**: turn-complete is B5 -> E6, two 0.09s notes, rising; approval is G5 -> C5, falling, 0.15/0.35s. Both are in-memory WAV through `System.Media.SoundPlayer`, so no audio file ships and no QQ/WeChat recording is used.
- **Cost**: each turn-complete alert spawns a hidden PowerShell process; with a badge it lives up to `turnBadgeSeconds` seconds (polling never blocks the turn or an approval).
- **Command-line ceiling (fixed 2026-10-28; the silent 1.1.0/1.1.1 bug)**: one Windows command line is capped at 32,767 characters. The turn-complete script is ~13,000 characters and `-EncodedCommand` expands it to UTF-16 base64, ~34,700, so `spawn` threw `ENAMETOOLONG`; because alerts are best-effort, that failure was swallowed by `try/catch` and `child.on('error')` — built, dispatched, never executed. Approval alerts encode to ~30,100, just under the cap, which is why only the turn-complete channel went silent. The script is now deflated and handed to a single-line stub that inflates and runs it (~12,000 encoded characters), `spawnAlertScript` refuses to spawn above the ceiling instead of starting a doomed process, and unit tests assert the encoded length of every alert shape.

## Settings-panel chain (2026-10-21)

- **Host schema**: `src/config-schema.ts` exports a partial `Config` built with the `@deepseek-ai/schemastery` from the DSH installation closure (it is **not** a dependency of this package). It declares only the ten reminder/display fields, all `.volatile().loose()`, with defaults taken straight from `DEFAULT_CONFIG`. Undeclared keys (`mode`, risk policy, limits, audit) pass through Schemastery untouched and keep flowing into `sanitizeConfig`. When Schemastery cannot be resolved, `Config === undefined`: Cordis skips schema validation, the settings section does not appear, and the plugin works from YAML (`sanitizeConfig` remains the final fallback).
- **Form projection**: `dsh-settings.describe()` exposes only volatile fields, grouped by profile entry id (`approval-ledger`), with descriptors carrying `{schema, revision, writable, value, base, user}`; the client gets the shared form via `ctx.configForms.get('approval-ledger')` — `{getSnapshot, subscribe, set(field,value), unset, mutate, writable}`.
- **Write path**: client `form.set` → `settings.mutate` → `@deepseek-ai/dsh-config-editor` validates the complete candidate with `resolveConfig`, rewrites the profile's `cordis.patch.yml` by id atomically (comments/`!!js` preserved) → Loader `reconcileProfilePatches` hot-applies. A volatile-only change takes the fast path: `_commitVolatile()` updates the live references in place and emits `loader/volatile-update`.
- **The plugin writes no files**: persistence belongs to the DSH editor. The plugin only dereferences the volatile references in `apply()` (detected with `Symbol.for('cosmokit.volatile.write')`, no cosmokit import) and `Object.assign`s the new values into the same runtime config object on `loader/volatile-update`, so the notifier / turn-end closures see a toggle immediately — **no remount, no restart**.
- **Boundary**: the panel covers reminder/display switches only; `mode`, `allowHighRiskGrants`, `max*`, `auditOnly`, `auditRetentionDays`, and `auditNotices` stay YAML-only so a visual misclick cannot weaken the approval policy.

## The PTC approval deadline (investigated 2026-10-28)

- **Symptom**: approval cards "stay far too short — gone before I can react", only in some sessions; the turn-complete alert was silent at the same time (a separate bug, see above).
- **Not an approval timeout**: `dsh-user-approval` / `dsh-client-ui-approval` contain no approval timer, and the logs show no `unavailable`; of 359 approvals in two days, the 14 that ended early all ended `cancelled`.
- **Real cause**: the `ptc` preset presents tools through `run_code` (`dsh-agent-tool-presentation: mode: ptc`), and `@deepseek-ai/dsh-ptc-runtime-node` defaults to an execution deadline of **`timeoutMs: 120000`, documented as "including nested tool and approval waits"** (`maxTimeoutMs: 600000`). Once a nested approval exceeds that deadline the run is cancelled and the call becomes `tool/result ERROR`. The logs match: cancellations land at 119.7 / 239.7 / 299.7 / 499.7 / 599.7 seconds — the 120/240/300/500/600 s deadlines — while `standard`/`cordis` presets call tools directly with no approval deadline (one approval waited 2165 s).
- **Local handling**: the desktop profile's `cordis.patch.yml` now overrides `ptc-runtime` (`timeoutMs: 600000`, `maxTimeoutMs: 1800000`), raising the `run_code` default deadline to 10 minutes and the per-call cap to 30. This is DSH configuration; the plugin is not involved and must not set approval deadlines itself.
