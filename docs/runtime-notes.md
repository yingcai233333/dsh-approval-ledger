# Runtime notes (verified)

> Language: [English](runtime-notes.en.md) · [中文](runtime-notes.md)

> 这些是设计阶段从 DSH 0.2.0-rc.2 的安装包/运行时确认过的事实；当前目标已升到 0.2.1-rc.2，升级后要按 `docs/runtime-spike.md` 重新验。

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

## Live 双插件同级 approval/request 顺序验证（2026-10-21）

**设置**：临时 profile `approval-p0`（`dsh-approval-ledger` 以 `link:D:/AIworkspace/dsh-approval-ledger` 安装，启用 base + web-app bundle），用 Electron-as-Node 启动 CLI：`DeepSeek Harness.exe app.asar\dsh\node_modules\@deepseek-ai\dsh\lib\bin.js --profile approval-p0 --patch <repo>\.p0-test\ordering\order.patch.yml --port 3080 --no-open`，env 为 `DSH_PERMISSION_MODE=read-only` 与 `APPROVAL_PROBE_LOG=<repo>\.p0-test\ordering\probe-*.ndjson`；patch overlay 把账本 row 设为 `mode: active, notifications: false`，并插入一个本地 sibling 探针插件（`./sibling-probe/index.js`，按 file:// URL 挂载；没有安装任何东西，没有改 profile 的 `package.json`）。探针注册**两个** `approval/request` 监听器、共用同一个 handler：一个 `{prepend: true}`，一个普通（append）；handler 先向 NDJSON 追加 `{toolName, callId, agentId, reason, displayReason}`，然后 `return next()`。驱动是无头 Chrome + CDP（`.p0-test/ordering/order-test.mjs`），操作真实 Web UI。

| 用例 | 操作 | 结果 |
| --- | --- | --- |
| A 手动审批 | 提示词让模型写 `D:\AIworkspace\dsh-approval-ledger\.p0-test\ordering\outside-test.txt`，带 `sandbox_permissions: "danger-full-access"` 和 justification（“P0 ordering approval rejection test”），并明确不用 `request_approvals` | 官方审批卡约 4.0 s 出现；两个监听器、两轮，共 4 条探针记录：run 1 `call_00_8ckGBdcGN3KGwEYZekj79211` 的 seq 2（prepend）/seq 3（plain），run 2 `call_00_ed4SenPiN2pxhuOoQCc28374` 的 seq 4（prepend）/seq 5（plain）；四条的 `reason` 都是 `escalate sandbox to danger-full-access: P0 ordering approval rejection test`，`displayReason.en` 都是我们的改写 `write · …\ordering\outside-test.txt · danger-full-access`，而不是 sandbox 原始的 `Allow this operation with danger-full-access permissions: …`；卡片文字相符：`写入文件 · …\ordering\outside-test.txt · 完全访问` 加右下角「待审批说明」。点「拒绝」后工具报 `the user rejected escalating this operation to "danger-full-access"`，文件不存在，`/approvals` 记到该拒绝（1 decision、1 audit record、0 unattributed）。 |
| B 计划授权 | 计划 P-55d23502，单项 A（write，风险中，auto）批准；逐项勾选卡只提交 A | 会话日志先后为 `approval/asked`（id `bd8dc357-808f-46e4-80dd-73c9287d3539`，callId `call_00_ET_VRDiqyCSxFdn48bOE4803052`，reason `escalate sandbox to workspace-write: 按你批准的批次 A 写入 .p0-test/ordering/a.md…`）与 `approval/decided`，结果为 **allowed-once**。探针对该 callId **零记录**（总共 5 行：1 条 apply + case A 的 2×2），说明授权在瀑布里提前短路，sibling 监听器根本没跑到；文件已创建（53 字节）于 `D:\AIworkspace\余烬余生\.p0-test\ordering\a.md`（临时实例的 session workspace 是「余烬余生」，不是本仓库），并且没有弹审批卡。 |

**解读**

- **顺序：PASS**（case A 2/2 样本）——我们的 prepend 监听器在两个探针监听器（prepend 与 plain）看到请求之前就改写了 `displayReason`；内置转发器 `api-remotes` 是排在本行之前的 sibling，所以这也说明 prepend 先于它生效。
- **短路：PASS**——计划授权匹配时，我们的监听器直接返回 `allowed-once` 且不调 `next()`，后续 sibling 全部不运行、也看不到那个 callId（case B 的零记录就是证据）。
- **瀑布语义**：这就是约定的 waterfall claim 语义。对 presenter/notifier 类 sibling 可接受；对“必须每次运行”的严格策略 sibling **不可接受**。共存注意：在本行之后挂载的 prepend sibling 可以反过来抢在我们前面。

**保留意见**

- Cordis 用 `Promise.all` 挂载 entry，所以 prepend sibling 之间的先后是**竞争**，不是保证；`api-remotes` 这类 sibling 的先后不能当契约。
- 样本量小：case A 只有 2 个、case B 只有 1 个。
- 临时实例的 session workspace 是「余烬余生」，所以 case B 的文件落在那里（测试残留）。
- 在更晚挂载的 prepend sibling 面前，我们不能保证自己的改写仍然先发生。

**证据路径**（相对 `.p0-test/ordering/`）：`summary.json`、`probe-20261021-131214.ndjson`、`A-card.png`、`B-plan.png`、`B-selection.png`、`B-done.png`；会话日志 `C:\Users\36288\.dsh\sessions\--D-AIworkspace-~4F59~70EC~4F59~751F--\session-dc3d8f41-60cb-491a-b125-a662b5e389a8`。

## 对话完成提醒与 Windows 限制（2026-10-21）

- **触发**：`session/event` 的 `turn/end`，负载 `{ turn, reason }`（`dsh-agent-loop/lib/index.js:1029-1032`）。`reason.kind` 共 7 个：`completed`、`aborted`（带 `reason`）、`blocked`、`error`（带 `LlmFailure`）、`max-tokens`、`interrupted`、`forked`（`dsh-session` 的 `TurnEndReasonMap`；前五个在 `dsh-agent-loop/lib/index.js:961,966,981,1013-1016,1019-1025` 产生）。插件只对 `aborted` 不提醒，其余都提醒；`interrupted`/`forked` 是 resume / fork 时补写的合成 closer（`dsh-agent-loop/lib/index.js:1992-1993`、`dsh-session/lib/types/repair.js:187`），发生在 session 发布之前，不会出现在 live `session/event` 上，因此实际收不到。
- **子代理判定**：`SessionHeader` 带 `origin?: 'subagent'` 与 `delegationDepth?: number`（`dsh-session/lib/index.js:1054` 校验，typert 的 `SessionHeader` 声明里有这两个字段）。`origin === 'subagent'` 或 `delegationDepth > 0` 视为子代理，不提醒；`parentSession` 不能单独用（fork 也会写它，而 fork 是用户在等的会话）。
- **前台闸门**：`turnEndOnlyWhenAway`（默认 `true`）时，脚本先用 `FindWindowByTitle` 找窗口；窗口存在且 `GetForegroundWindow()` 等于它，就在 flash/badge/sound 之前 `exit 0`，三者一起跳过。窗口找不到、或判定本身失败时照常提醒（声音仍然有用），不会静默。判定只用 user32 P/Invoke，不新增 COM 依赖；审批提醒不经过这个闸门。
- **闪烁颜色不可指定**：`FlashWindowEx` 的颜色由系统「注意提示」配色决定，应用无法要求绿色。绿色改用 `ITaskbarList3.SetOverlayIcon`（IID `ea1afb91-9e28-4b86-90e9-9e9f8a5eefaf`，需先 `HrInit`）叠一个 32×32 绿点 HICON。
- **徽标生命周期**：显示后每 450ms 查一次 `GetForegroundWindow()`；窗口回到前台、窗口消失或超过 `turnBadgeSeconds` 时清除并 `DestroyIcon`。`turnBadgeSeconds: 0` 表示不超时（常驻到你回到窗口）。
- **声音**：完成音 B5→E6、两声各 0.09s、上行；审批音 G5→C5、下行 0.15/0.35s。两者都用内存 WAV + `System.Media.SoundPlayer`，不随包分发音频文件，也不使用 QQ/微信的原始音频。
- **代价**：每次完成提醒会起一个隐藏 PowerShell 进程；带徽标时它最长存活 `turnBadgeSeconds` 秒（轮询期间不阻塞 turn，也不影响审批）。
- **命令行长度上限（2026-10-28 修，1.1.0/1.1.1 的静默 bug）**：Windows 单条命令行上限 32,767 字符。完成提醒脚本本身约 13,000 字符，`-EncodedCommand` 会把它扩成 UTF-16 base64 约 34,700 → `spawn` 直接抛 `ENAMETOOLONG`；而提醒是 best-effort，异常被 `try/catch` 和 `child.on('error')` 吞掉，于是"构建了、派发了、但从没执行过"。审批提醒约 30,100 字符，刚好在限内，所以只有完成提醒静默。现在脚本先 deflate，再交给单行 stub 解压执行，编码后约 12,000 字符；`spawnAlertScript` 另加了一道上限保护（超限不 spawn，不留下一个注定失败的进程），单测直接断言各种提醒形状的编码长度。

## 设置面板链路（2026-10-21）

- **Host schema**：`src/config-schema.ts` 用 DSH 安装闭包里的 `@deepseek-ai/schemastery`（**不是**本包的 dependency）导出 partial `Config`，只声明 10 个提醒/显示字段，全部 `.volatile().loose()`，默认值直接取 `DEFAULT_CONFIG`。未声明的键（`mode`、风险策略、限额、审计）由 Schemastery 原样透传，继续走 `sanitizeConfig`。Schemastery 解析不到时 `Config === undefined`：Cordis 跳过 schema 校验、设置页不出现，插件按 YAML 正常工作（`sanitizeConfig` 始终是最后兜底）。
- **表单投影**：`dsh-settings.describe()` 只暴露 volatile 字段，按 profile entry id（`approval-ledger`）分组，描述符带 `{schema, revision, writable, value, base, user}`；客户端用 `ctx.configForms.get('approval-ledger')` 拿到共享表单 `{getSnapshot, subscribe, set(field,value), unset, mutate, writable}`。
- **写链路**：客户端 `form.set` → `settings.mutate` → `@deepseek-ai/dsh-config-editor` 先用完整候选配置做 `resolveConfig` 校验、按 id 原子改写 profile 的 `cordis.patch.yml`（保留注释/`!!js`）→ Loader `reconcileProfilePatches` 热应用。只有 volatile 变化时走快路径，`_commitVolatile()` 就地更新运行中的引用并 `emit('loader/volatile-update')`。
- **插件不写文件**：持久化由 DSH 的编辑器负责；插件只在 `apply()` 时解引用 volatile 引用（`Symbol.for('cosmokit.volatile.write')` 判定，不 import cosmokit），并在 `loader/volatile-update` 时把新值 `Object.assign` 进运行时那个 config 对象——notifier / turn-end 闭包立即读到新开关，**不重挂、不重启**。
- **边界**：面板只覆盖提醒/显示开关；`mode`、`allowHighRiskGrants`、`max*`、`auditOnly`、`auditRetentionDays`、`auditNotices` 仍是 YAML-only，避免可视化误操作削弱审批策略。
