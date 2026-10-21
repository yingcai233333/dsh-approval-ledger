> Language: [English](runtime-notes.en.md) · [中文](runtime-notes.md)

# Runtime notes (verified)

> These are facts confirmed during the design phase from the DSH 0.2.0-rc.2 install package/runtime; the current target has been raised to 0.2.1-rc.2, and after the upgrade they must be re-verified according to `docs/runtime-spike.md`.

## Approval

- Entry: `ctx.approval.request({ agent, toolName, callId?, reason?, displayReason?, signal? })`.
- Returns: `allowed-once` | `rejected` | `cancelled` | `unavailable`.
- The service appends `approval/asked` before the waterfall and `approval/decided` after it; auto-allows also leave a trace.
- sandbox escalation reason: `escalate sandbox to <mode>: <justification>`; `displayReason` is `{en, zh}`.
- When `tools/pre-execute` returns `{kind:'ask', reason, displayReason}`, it also goes through `approval.request`.

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
