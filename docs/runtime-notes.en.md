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
