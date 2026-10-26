> Language: [English](compatibility.en.md) · [中文](compatibility.md)

# Compatibility

## DSH

- Target runtime: DSH `0.2.1-rc.3` (Windows desktop, `@deepseek-ai/dsh-desktop-runtime`; `dsh/package.json:4`, build `be72761`). Plugin version `1.1.1`.
- Verification baseline: the 0.2.1-rc.3 install package at `D:\software\DS-harness\resources\app.asar` (re-checked 2026-10-26; 315 `@deepseek-ai/*` packages, 18,188 files). The rc.2 export (2026-10-21; 306 packages, 18,309 files) is kept under `.p0-test/asar/`, so the two exports can be compared file by file: of 73 `.js` files in 22 comparable packages, 71 are byte-identical, and the two differing client bundles differ only in build paths (`D:\develop\…` → `D:\ci\runners\…`) and CSS-module hash class names — zero interface change (see `.p0-test/rc3/drift-report.md`). The whole archive contains **no `.d.ts` at all**, and the profile's `node_modules` has no `@deepseek-ai/*` either; the static check therefore used the shipped JS implementations, the type-declaration strings embedded in `lib/typert.host.js`, and the package READMEs. `dsh/...:line` below means a body line of that entry inside the archive (same convention as `docs/runtime-spike.md`).

### How far verification goes

| Item | Status | Evidence |
| --- | --- | --- |
| Windows + 0.2.1-rc.2 / rc.3 static interface check | **Done** (12 groups, below; the rc.3 re-check found no change) | "Interface check" below; `.p0-test/rc3/drift-report.md` |
| Windows live P0: single approval card title rewrite, detail note, allow/deny, raw reason | **Passed** | `docs/runtime-notes.md`, "Live 双插件同级 approval/request 顺序验证（2026-10-21）", case A; `docs/install-review-p0.md` §8 |
| Windows live P0: plan-review card, per-item selection, grants, revoke at turn end, fail-closed rejection, `DELEGATED_CALLER`, audit attribution | **Passed** | `docs/install-review-p0.md` §6; `docs/runtime-notes.md`, same section, case B |
| Sibling `approval/request` ordering: prepend rewrites first; a matched grant claims and short-circuits | **Passed** (A 2/2, B 1/1) | `docs/runtime-notes.md`, same section |
| macOS / Linux | **Not verified on real hardware** | — |
| Taskbar flash / sound | Windows-only implementation; unit tests cover script generation, the real effect is not live-verified | `src/notify/flash.ts`; `docs/install-review-p0.md` §8 |
| DSH versions after 0.2.1-rc.3 | **Not verified** | — |

> On `engines.dsh` and `dsh.compatibility.dshReleases`: the 0.2.1-rc.2 install/startup gate reads only `engines.dsh` (the `@deepseek-ai/dsh*` peers are consulted only when it is absent) and evaluates it with `semver.satisfies(runtime, range, { includePrerelease: true })` (`dsh/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js:252,276-298,311-326`). From `1.0.0` onward (`0.3.0` was published without this field) this package declares `"dsh": ">=0.2.1-rc.2 <0.3.0-0"`: it accepts 0.2.x patches and prereleases and rejects the whole 0.3 line. A miss is **not** a warning: an install is rejected before pnpm even runs (`installation rejected`, exit code 1), and at startup the whole bundle is skipped (`dsh: skipping profile bundle …`) so the desktop still starts but without this plugin's tools, command or UI. The upper bound must be `<0.3.0-0` — `<0.3.0` does not stop `0.3.0-rc.1` under `includePrerelease`, and `>=0.2.1-rc.2-0` rejects `0.2.1-rc.2` itself. `dsh.compatibility.dshReleases` remains descriptive metadata (no code reads it); `dshhub.compatibility.dsh` carries the same range as `engines.dsh` so the market and the installer cannot disagree.

### Interface check (0.2.1-rc.2; re-checked against rc.3 on 2026-10-26 — byte-identical implementations, same line numbers)

| Interface | Plugin declaration (`src/types/dsh-runtime.ts`) | Runtime actual | Verdict | Evidence |
| --- | --- | --- | --- | --- |
| `approval/request` listener | `(req, next) => Promise<ApprovalOutcome>`; `ctx.on(..., { prepend: true })` | `ctx.waterfall(scopeTarget(agent, agent), 'approval/request', req, () => 'unavailable')`; not calling `next()` claims the request and stops later listeners; `prepend` uses `unshift` | Match | `dsh-user-approval/lib/index.js:176`; `cordis/lib/index.js:317-324,335-345` |
| `ApprovalOutcome` | Four literals | The same `OUTCOMES` set; invalid returns and thrown listeners normalize to `unavailable` | Match | `dsh-user-approval/lib/index.js:30,176` |
| `ApprovalRequestEvent` | `agent, toolName, callId?, reason?, displayReason?, signal?` | `dsh-tools` builds the same fields (`displayReason` optional); the object is not frozen, and live P0 proved a prepended rewrite reaches the card | Match | `dsh-tools/lib/types/index.js:1116-1123`; `docs/runtime-notes.md` case A |
| `ctx.tools.register` / `get` | Returns a disposer; `get(name, scope?)` | `register(definition)` returns an effect disposer; `get(name, scope)` resolves through the agent scope | Match | `dsh-tools/lib/types/index.js:468-488,624-626` |
| `ToolDefinition` / `ToolRunContext` | `name/description/parameters/output{schema,render,presentationMeta?}/execute/isConcurrencySafe?`; exec carries `callId/name/arguments/agent?/signal` | The same fields; the local surface is a subset (runtime also has `timeoutMs/finalizeContent/projectContent/presentCall/presentResult/deferLoading`, and `rootCallId/parent` on exec). `register()` does not compile `parameters`: a raw JSON Schema is passed through as the model schema; only `defineTool` compiles the author DSL into JSON Schema | Match (local surface is a subset). `docs/runtime-spike.md:190,215`'s claim that "parameters is not a raw JSON Schema" applies to `defineTool` only and is stale for `register()` | `dsh-tools/lib/types/index.js:468-488,674-685,777-783,959,1206-1216` |
| `ctx.commands` | `register`; invocation `{commandId, agent, rawInput, attachments, signal}`; result `success{text?}` / `error{text}` | Same; `attachments` is exactly `(ImageBlock \| FileBlock)[]` and success has an optional `sourceEventSeq` | Match (local `ContentBlock[]` is wider; unused by the plugin) | `dsh-commands/lib/types/index.js:235-237,357`; `dsh-commands/lib/typert.host.js:305,333` |
| `ctx.userQuestions.ask` + plan-review | `{questions, agent?, signal?, wait?}`; intent `{kind:'plan-review', approve, callId?}` | Identical fields; `BAD_INTENT` / `DELEGATED_CALLER` semantics match | Match | `dsh-user-questions/lib/typert.host.js:268-292`; `dsh-user-questions/lib/types/index.js:294-338` |
| Session readers | `id/seq/eventAt/snapshotEvents` | All present; `eventAt()` / `snapshotEvents()` / `ownEvents()` are **deprecated** (JSDoc verbatim: `Existing logic may remain unmigrated for now, but new calls are prohibited.`) | **Drift (docs-level, still works)** | `dsh-session/lib/types/index.js:552-578`; `dsh-session/README.md:62` |
| Session events | `session/event(session, event)` with `{ global: true }`; `session/disposed(session)`; `turn/start` / `turn/end` / `tool/call` payloads | Match; the embedded `SessionEventMap` declaration gives the same payloads | Match | `dsh-session/lib/types/index.js:1105-1106`; `dsh-session/lib/index.js:1587-1592`; `dsh-commands/lib/typert.host.js:705` |
| `Agent` / `workingDirectory` | `agent.id`, `agent.session`; `workingDirectory.get(session)` | Match | Match | `dsh-agent/lib/index.js:513-514`; `dsh-working-directory/lib/index.js:76-78` |
| Client module and slots | `__ModuleLoader__.load({ id, factory })`; `dsh.client.platform/inject/immediately`; `conversation.session.header.utilities`, `shell.overlay`; `register({ name, id, order, label })` | The parser accepts these fields; both slots exist (session/list and root/list respectively); `id` is required, `label` may be a thunk | Match | `dsh-client-modules/lib/index.js:66-74`; the slot definitions and registrations were verified live on rc.3 (all three of the plugin's occupants are active); the rc.2 line numbers for `dsh-cordis-client-runner` are no longer trustworthy (the retained copy is unversioned), so they are not cited |
| Client standard props / pending interaction / locale | `sessionId`, `useSessionStatus(snapshot => snapshot.get(id)?.pendingInteraction)`; `kind/toolName/callId/displayReason`; `ctx.locale.register/bind` | Standard props include `sessionId` and `useSessionStatus` (root slots have no `sessionId`; the plugin falls back to a full-map scan); `PendingApproval` has the same fields with `kind='approval'`; locale is provided via `ctx.provide('locale', …)` | Match | `dsh-client-ui-approval/lib/client.js:152-186,291,347`; `dsh-client-ui-session/lib/client.js:986,1124`; the standard props were verified through the live rc.3 slot (both `sessionId` and `useSessionStatus` are present) |

### Known drift

- `session.snapshotEvents()` is **deprecated** (since rc.2; unchanged in rc.3): the plugin needs a session's whole history synchronously, while the supported replacement is **async** — `ctx.sessionQuery.readSession(sessionId)` (returns `{ session, inheritedEventCount, events }`, the full raw log; `dsh-session-query/lib/index.js:1081-1089`), plus `listEvents()` (lightweight records) and `observeSession()` (a lease carrying `events`). `ctx.sessionQuery` is mounted in the default composition (`dsh-session-query-sqlite` keeps the service with `openAt: never`, `dsh-base/cordis.patch.yml:149-161`). Our fold is synchronous and answers inside the approval hook, so this cycle does not migrate. Every call is confined to the single adapter `src/plugin/session-log.ts`; when the history cannot be read (missing method / throws / non-array result) it returns a stable short code and **degrades fail-closed**: no grant, no automatic allow, back to the official approval card, and the session is marked degraded in memory. Migrating later (async prefetch + cache) touches that one file only; the trigger is recorded in the release plan in `docs/design.md`.
- Every other difference is "the local declaration is a subset": optional runtime fields (`timeoutMs`, `finalizeContent`, `presentCall`, `result.sourceEventSeq`, …) need no declaration and are not drift.

### After upgrading DSH

- Re-run the static check in `docs/runtime-spike.md`, then one live P0 run (single approval + plan) on the target version, and only then update this page, `engines.dsh` and `dshReleases`.
- Pay attention to the rows marked **drift** in the interface check above.
- The archive's JS can be compared with the previous export by SHA256: `extract` into `.p0-test/<version>/` first, then diff. If only build paths and hashed class names differ, it is the same source rebuilt in CI and the interface check does not need to be repeated (that is exactly what rc.2 → rc.3 turned out to be).
- Record: `0.2.1-rc.3` (2026-10-26) was re-checked against this page; the tools, the command and all three client slots are mounted on the live instance (see `.p0-test/rc3/live-verification.md`). Only docs and `dshReleases` changed — no code.

## Tests

- Node 22.8+ / 24; `pnpm test` first compiles to `lib-test/`, then runs with `node --test --test-isolation=none`.
- No esbuild subprocess is used, so the tests also run under the DSH sandbox (which forbids named pipes).
- `test/docs-i18n.test.ts` checks that this page and its Chinese counterpart stay paired and cross-linked.

## OS

- Windows: full functionality (including taskbar flash / sound; see the not-live-verified note in the table above).
- macOS / Linux: **not verified on real hardware**. The approval/plan/audit main path has no platform branch and is expected to behave like Windows; platform differences are limited to path matching (Windows is case-insensitive + `realpath` of the nearest ancestor, POSIX is case-sensitive) and notifications. Flash/sound are Windows-only, and `alertPending` is a no-op elsewhere, degrading to in-page reminders: a `● ` prefix on the document title, the red-dot "Approval details" affordance in the session header, and the pending-approval note overlay. POSIX path matching is unit-tested only; it has not run on real hardware.

## Self-check on another machine / platform

1. **Install and confirm the version**: install `1.1.1` on the target machine (desktop installer, or `dsh plugin add dsh-approval-ledger`), run `dsh plugin list`, and confirm the package name, version `1.1.1`, and enabled state.
2. **Confirm the DSH version and declaration**: `dsh --version` should be `0.2.1-rc.2` or `0.2.1-rc.3`; open `node_modules/dsh-approval-ledger/package.json` and confirm `engines.dsh` is `>=0.2.1-rc.2 <0.3.0-0` (that is the real install/startup gate); `dsh.compatibility.dshReleases` is descriptive metadata only (see above).
3. **Command surface**: in a new session run `/approvals audit`; it should print the "Approval decision ledger" report (not an unknown command). Then run `/approvals last` and `/approvals grants`.
4. **Single approval**: have the model perform a write that needs approval (for example a `danger-full-access` write outside the workspace) and confirm the official card title is the rewritten `写入文件 · <path> · 完全访问` with the pending-approval note at the lower right; reject it, then confirm the file does not exist and `/approvals audit` records the rejection.
5. **Plan surface**: submit two items with `request_approvals` (one file write, one command) and confirm the plan-review card plus the per-item selection card; approve only one item and confirm only that item runs, and that `/approvals grants` is empty after the turn ends.
6. **Uninstall regression**: remove the plugin and restart; confirm the official approval card title is back to its original text and no red dot/overlay/process remains.

## Known conflicts

- Other `approval/request` answerers (`dsh-approval-gate`, `dsh-approval-review`, `dsh-approval-llm`, `dsh-experimental-auto-review`): we are a `{ prepend: true }` listener and return `allowed-once` **without calling `next()`** on a grant, so later listeners never run; conversely, a prepend sibling mounted later can run before us (Cordis mounts with `Promise.all`, so prepend order is a race). Do not stack them.
- Notification plugins (`dsh-approval-chime`, `dsh-approval-alert`, `dsh-approval-voice`): may alert twice; set `notifications:false`.
- Hotkey/detail plugins (`dsh-approval-hotkeys`, `dsh-approval-explain`): we only register `conversation.session.header.utilities` (list) and `shell.overlay` (list) and never touch `conversation.approval.detail` (single, owned by `dsh-client-ui-chat`); visual overlap with title rewriting/popovers is still possible.
- Command/tool name clashes: check `/approvals`, `request_approvals`, and `ask_choices` before registering. There is **no automatic fallback** (no `ledger_*` / `/ledger` rename): any registration clash makes `registerRuntime` roll back every registration (`src/plugin/runtime.ts:838-846`), `apply` only logs a warning (`src/index.ts:73-79`), and the plugin stays inactive. Rename or disable the conflicting plugin by hand.
- A stale older copy in the same profile: the profile manifest decides which package loads; confirm the version in step 1 of the self-check.

## Smoke checklist

- Single approval: title summary, detail overlay, allow/deny, raw reason visible; after a rejection the file/command really did not run (fail-closed).
- Plans: plan-review card, full text in the sidebar, approve/discuss, per-item selection, grants take effect, expire at turn end.
- Risk: critical is never auto-approved; high defaults to manual; medium data writes are auto-approved only under `mode: active` with a matching grant (the default is `mode: observe`, which auto-approves nothing).
- Audit: `/approvals audit` has records; unattributed count is 0; `/approvals audit --json` parses.
- Ordering/coexistence: with another answerer plugin mounted, confirm our prepended rewrite still wins (check the card title) and that the other listener really did not run when a grant claims the request.
- Uninstall: official approval behavior is restored; no leftover processes/state.
