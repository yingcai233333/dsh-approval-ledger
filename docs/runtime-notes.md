# Runtime notes (verified)

> 这些是设计阶段从 DSH 0.2.0-rc.2 的安装包/运行时确认过的事实。升级后要重新验。

## Approval

- 入口：`ctx.approval.request({ agent, toolName, callId?, reason?, displayReason?, signal? })`。
- 返回：`allowed-once` | `rejected` | `cancelled` | `unavailable`。
- 服务在 waterfall 之前 append `approval/asked`，之后 append `approval/decided`；自动放行也留痕。
- sandbox escalation 的 reason：`escalate sandbox to <mode>: <justification>`；`displayReason` 为 `{en, zh}`。
- `tools/pre-execute` 返回 `{kind:'ask', reason, displayReason}` 时也会走 `approval.request`。

## Scheduling

- `dsh-agent-loop` 按 `tools.executionMode()` 调度；非 `isConcurrencySafe` 的工具是 exclusive，逐个执行。
- 第一个审批卡住时，后续 exclusive 调用还没开始；所以不能“等所有审批到齐”。

## UI slots

- `conversation.approval.detail`：single 槽，被 `dsh-client-ui-chat` 的 `ApprovalCommand` 占用；再注册会抛 `single slot ... already has a registration`。
- `conversation.input.dock`：在默认 composer 里；审批卡接管 composer 时不会渲染。
- `conversation.composer`：chain；`ui-approval` priority 1，`ui-user-questions` priority 1（按 kind），`ui-subagent` -10。
- `shell.overlay`：frame-wide，additive；适合红点/浮层。
- `conversation.session.header.utilities`：session header 右侧列表；适合“审批详情”按钮。
- `conversation.plan-review.actions`：list；`ui-plan` 提供“查看全文”；无 callId 打开临时 review 文档。

## Plan review

`ui-user-questions` 的 `planReviewOf` 要求：

- `questions.length === 1`
- `intent.kind === 'plan-review'`
- `question.detail !== undefined`
- `multiSelect !== true`
- `options.length <= 2`
- 存在 `option.label === intent.approve`

满足后渲染计划卡；标题/描述从 detail 的第一行/第一段提取；“讨论”会 `pending.dismiss()`：
- 有 `callId` → hide（请求还在，可从工具行重开）；
- 无 `callId` → `ASK_CANCELLED`（请求结束）。

## Client state

- `ctx.uiSession.sessionStatus`：`Map<SessionId, { running, pendingInteraction, completionUnread }>`。
- `pendingInteraction` 对象有 `kind`（approval/question/plan-review）、`toolName`、`callId`、`reason`、`displayReason`、`answerable`、`answer()`。
- `useChat` 可按 callId 找到 `tool-call` 节点的 `argsRaw`；ui-chat 的 `ApprovalCommand` 就是这么显示命令的。

## Session log

- `tool/result` 有 `meta?: JsonValue`；`ToolExecutionResult.meta` 会被 append。
- `approval/asked` / `approval/decided` 是 durable；`user-question-reply` 是 durable。
- 不能 live append 新事件类型；未知事件需要 `ignorable: true` 才能读，live append 不能设置。

## Desktop

- `resources/app.asar` 的 `main.js` 用 `spawn` 启动 `dsh-desktop-host` 子进程。
- Host 的 `process.ppid` 是 Electron 主进程；可按 PID 找窗口调 `FlashWindowEx`。
- Electron 主进程只有更新提示用的 `flashFrame`，没有对插件开放的通用 attention IPC。

## Coexistence

- `dsh-experimental-auto-review` 在 `tools/pre-execute` `{prepend:true}` 做逐调用 review。
- 生态里还有 `dsh-approval-gate`、`dsh-approval-review`、`dsh-approval-llm`、`dsh-approval-chime`、`dsh-approval-alert`、`dsh-approval-hotkeys`、`dsh-approval-explain` 等。
- 多个 auto-approval/notification 插件可能互相抢占；需要 `audit-only` / `notifications:false` 和兼容说明。
