> Language: [English](compatibility.en.md) · [中文](compatibility.md)

# 兼容性

## DSH

- 目标运行时：DSH `0.2.1-rc.3`（Windows 桌面，`@deepseek-ai/dsh-desktop-runtime`；`dsh/package.json:4`，build `be72761`）。插件版本 `1.1.1`。
- 核对基准：0.2.1-rc.3 安装包 `D:\software\DS-harness\resources\app.asar`（2026-10-26 复核；315 个 `@deepseek-ai/*` 包、18188 个文件）。rc.2（2026-10-21；306 个包、18309 个文件）的导出副本留在 `.p0-test/asar/`，两次导出可以逐文件对比：22 个可比包中 73 个 `.js` 有 71 个字节相同，2 个客户端 bundle 的差异只有构建路径（`D:\develop\…` → `D:\ci\runners\…`）和 CSS module 生成的哈希类名，接口实现零变化（详见 `.p0-test/rc3/drift-report.md`）。整个归档**没有任何 `.d.ts`**，profile 的 `node_modules` 下也没有 `@deepseek-ai/*`；所以静态核对用的是随包 JS 实现、包内嵌的类型声明字符串（`lib/typert.host.js`）和包 README。下文的 `dsh/...:行号` 都指归档内对应文件的正文行号（记法与 `docs/runtime-spike.md` 一致）。

### 验证到什么程度

| 项目 | 状态 | 证据 |
| --- | --- | --- |
| Windows + 0.2.1-rc.2 / rc.3 静态接口核对 | **完成**（12 组，见下；rc.3 复核无变化） | 本页「接口核对」；`.p0-test/rc3/drift-report.md` |
| Windows live P0：单条审批卡标题改写、详情浮层、允许/拒绝、原始 reason | **通过** | `docs/runtime-notes.md`「Live 双插件同级 approval/request 顺序验证（2026-10-21）」用例 A；`docs/install-review-p0.md` §8 |
| Windows live P0：plan-review 卡、逐项选择、grant、turn 结束撤销、拒绝 fail-closed、`DELEGATED_CALLER`、审计归属 | **通过** | `docs/install-review-p0.md` §6；`docs/runtime-notes.md` 同节用例 B |
| 同级 `approval/request` 顺序：prepend 先改写；命中 grant 时 claim 短路 | **通过**（A 2/2、B 1/1） | `docs/runtime-notes.md` 同节 |
| macOS / Linux | **未在真机验证** | — |
| 任务栏闪烁 / 提示音 | 仅 Windows 实现；脚本生成有单测，真机效果未 live 验证 | `src/notify/flash.ts`；`docs/install-review-p0.md` §8 |
| 0.2.1-rc.3 之后的 DSH | **未验证** | — |

> 关于 `engines.dsh` 与 `dsh.compatibility.dshReleases`：0.2.1-rc.2 的安装/启动闸门只读 `engines.dsh`（没有它时才看 `@deepseek-ai/dsh*` peer），判断用 `semver.satisfies(runtime, range, { includePrerelease: true })`（`dsh/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js:252,276-298,311-326`）。从 `1.0.0` 起（`0.3.0` 发布时还不包含此字段）本包声明 `"dsh": ">=0.2.1-rc.2 <0.3.0-0"`：接受 0.2.x 的补丁与预发布，拒绝整个 0.3 线。不满足**不是警告**：安装会在 pnpm 之前就 `installation rejected`（退出码 1）；启动时整个 bundle 被跳过（`dsh: skipping profile bundle …`），桌面仍能起来，但没有本插件的工具/命令/UI。上界必须写成 `<0.3.0-0`——`<0.3.0` 在 includePrerelease 下挡不住 `0.3.0-rc.1`，而 `>=0.2.1-rc.2-0` 会把 `0.2.1-rc.2` 自己拒掉。`dsh.compatibility.dshReleases` 仍是说明性元数据（没有代码读它）；`dshhub.compatibility.dsh` 与 `engines.dsh` 保持同一范围，避免「市场说兼容、安装被拒」。

### 接口核对（0.2.1-rc.2，2026-10-26 按 rc.3 复核：实现逐字节一致，行号未变）

| 接口 | 插件本地声明（`src/types/dsh-runtime.ts`） | 运行时实际 | 结论 | 证据 |
| --- | --- | --- | --- | --- |
| `approval/request` 监听器 | `(req, next) => Promise<ApprovalOutcome>`；`ctx.on(..., { prepend: true })` | `ctx.waterfall(scopeTarget(agent, agent), 'approval/request', req, () => 'unavailable')`；不调用 `next()` 即认领，后续监听器不运行；`prepend` 用 `unshift` | 一致 | `dsh-user-approval/lib/index.js:176`；`cordis/lib/index.js:317-324,335-345` |
| `ApprovalOutcome` | 四个字面量 | `OUTCOMES` 是同一组；非法返回值与抛错都归一为 `unavailable` | 一致 | `dsh-user-approval/lib/index.js:30,176` |
| `ApprovalRequestEvent` | `agent, toolName, callId?, reason?, displayReason?, signal?` | 同名字段由 `dsh-tools` 构造（`displayReason` 可选）；对象未冻结，live P0 已证明 prepend 改写会显示到卡片 | 一致 | `dsh-tools/lib/types/index.js:1116-1123`；`docs/runtime-notes.md` 用例 A |
| `ctx.tools.register` / `get` | 返回 disposer；`get(name, scope?)` | `register(definition)` 返回 effect disposer；`get(name, scope)` 按 agent 作用域解析 | 一致 | `dsh-tools/lib/types/index.js:468-488,624-626` |
| `ToolDefinition` / `ToolRunContext` | `name/description/parameters/output{schema,render,presentationMeta?}/execute/isConcurrencySafe?`；exec 有 `callId/name/arguments/agent?/signal` | 同一组字段；本地是子集（另有 `timeoutMs/finalizeContent/projectContent/presentCall/presentResult/deferLoading`、exec 的 `rootCallId/parent`）。`register()` 不编译 `parameters`：原始 JSON Schema 原样作为模型 schema；`defineTool` 才把作者 DSL 编译成 JSON Schema | 一致（本地是子集）。`docs/runtime-spike.md:190,215` 说「parameters 不是原始 JSON Schema」只适用于 `defineTool`，对 `register()` 已过期 | `dsh-tools/lib/types/index.js:468-488,674-685,777-783,959,1206-1216` |
| `ctx.commands` | `register`；invocation `{commandId, agent, rawInput, attachments, signal}`；result `success{text?}` / `error{text}` | 相同；`attachments` 精确类型是 `(ImageBlock \| FileBlock)[]`，success 另有可选 `sourceEventSeq` | 一致（本地 `ContentBlock[]` 更宽，插件未使用） | `dsh-commands/lib/types/index.js:235-237,357`；`dsh-commands/lib/typert.host.js:305,333` |
| `ctx.userQuestions.ask` + plan-review | `{questions, agent?, signal?, wait?}`；intent `{kind:'plan-review', approve, callId?}` | 字段逐字一致；`BAD_INTENT` / `DELEGATED_CALLER` 语义一致 | 一致 | `dsh-user-questions/lib/typert.host.js:268-292`；`dsh-user-questions/lib/types/index.js:294-338` |
| Session 读取 | `id/seq/eventAt/snapshotEvents` | 都在；但 `eventAt()` / `snapshotEvents()` / `ownEvents()` 已标记 **deprecated**（JSDoc 原文：`Existing logic may remain unmigrated for now, but new calls are prohibited.`） | **漂移（文档级，当前可用）** | `dsh-session/lib/types/index.js:552-578`；`dsh-session/README.md:62` |
| 会话事件 | `session/event(session, event)` 用 `{ global: true }`；`session/disposed(session)`；`turn/start` / `turn/end` / `tool/call` 负载 | 一致；`SessionEventMap` 内嵌声明给出同样的负载 | 一致 | `dsh-session/lib/types/index.js:1105-1106`；`dsh-session/lib/index.js:1587-1592`；`dsh-commands/lib/typert.host.js:705` |
| `Agent` / `workingDirectory` | `agent.id`、`agent.session`；`workingDirectory.get(session)` | 一致 | 一致 | `dsh-agent/lib/index.js:513-514`；`dsh-working-directory/lib/index.js:76-78` |
| Client 模块与槽位 | `__ModuleLoader__.load({ id, factory })`；`dsh.client.platform/inject/immediately`；`conversation.session.header.utilities`、`shell.overlay`；`register({ name, id, order, label })` | 解析器接受这些字段；两个槽位都在（前者 session/list，后者 root/list）；`id` 必填，`label` 可为 thunk | 一致 | `dsh-client-modules/lib/index.js:66-74`；槽位定义与注册在 rc.3 上 live 核实（本插件三个 occupant 均 active）；`dsh-cordis-client-runner` 的 rc.2 行号已不可信（副本版本未标注），不再引用 |
| Client 标准 props / 待处理交互 / locale | `sessionId`、`useSessionStatus(snapshot => snapshot.get(id)?.pendingInteraction)`；`kind/toolName/callId/displayReason`；`ctx.locale.register/bind` | 标准 props 含 `sessionId` 与 `useSessionStatus`（root 槽位没有 `sessionId`，插件用全表扫描兜底）；`PendingApproval` 有同名字段且 `kind='approval'`；locale 由 `ctx.provide('locale', …)` 提供 | 一致 | `dsh-client-ui-approval/lib/client.js:152-186,291,347`；`dsh-client-ui-session/lib/client.js:986,1124`；标准 props 由 rc.3 的 live 槽位核实（`sessionId`、`useSessionStatus` 都在） |

### 已知漂移

- `session.snapshotEvents()` 已 **deprecated**（rc.2 起，rc.3 未变）：插件需要同步读取整段会话历史；受支持的替代是**异步**的 `ctx.sessionQuery.readSession(sessionId)`（返回 `{ session, inheritedEventCount, events }` 全量原始日志，`dsh-session-query/lib/index.js:1081-1089`）、`listEvents()`（轻量记录）和 `observeSession()`（带 `events` 的租约）。默认组合里 `ctx.sessionQuery` 是挂着的（`dsh-session-query-sqlite` 以 `openAt: never` 保留服务，`dsh-base/cordis.patch.yml:149-161`）。因为我们的折叠是同步的、并且要在审批钩子里同步作答，本期不迁移。全部调用已收口到唯一适配层 `src/plugin/session-log.ts`；读不到时（缺方法/抛错/返回非数组）返回稳定短码并 **fail-closed 降级**：不建 grant、不自动放行、回落官方审批卡，并在内存里把该会话标为 degraded。将来迁移（异步预取 + 缓存）只需改这一个文件；迁移触发条件见 `docs/design.md` 的发布计划。
- 其余差异都是「本地声明是运行时的子集」：运行时多出的可选字段（`timeoutMs`、`finalizeContent`、`presentCall`、`result.sourceEventSeq` 等）插件不需要声明，不构成漂移。

### 升级 DSH 之后

- 先按 `docs/runtime-spike.md` 做静态核对，再在目标版本跑一次 live P0（单条审批 + 计划），最后更新本页、`engines.dsh` 与 `dshReleases`。
- 重点看本页「接口核对」中标为 **漂移** 的行。
- 归档里的 JS 可以直接和上一次的导出副本逐文件比 SHA256：先 `extract` 到 `.p0-test/<version>/`，再对比。若只有构建路径/哈希类名不同，就是同一份源码的 CI 重建，不需要重新核对接口（rc.2 → rc.3 即如此）。
- 记录：`0.2.1-rc.3`（2026-10-26）已按本页复核，工具、命令、三个客户端槽位在 live 实例上都正常挂在（见 `.p0-test/rc3/live-verification.md`）；改动只在文档与 `dshReleases`，未改代码。

## 测试

- Node 22.8+ / 24；`pnpm test` 先编译到 `lib-test/`，再用 `node --test --test-isolation=none` 执行。
- 不使用 esbuild 子进程，因此在 DSH 沙箱（禁止命名管道）下也能跑。
- `test/docs-i18n.test.ts` 校验本页与英文版成对、且互相链接。

## 操作系统

- Windows：完整功能（含任务栏闪烁/提示音；实际闪烁效果见上表的未 live 验证说明）。
- macOS / Linux：**未在真机验证**。审批/计划/审计主路径没有平台分支，预期与 Windows 相同；平台差异只在路径匹配（Windows 大小写不敏感 + 最近祖先 `realpath`，POSIX 大小写敏感）和通知。闪烁/提示音仅 Windows 实现，其它平台 `alertPending` 直接 no-op，降级为页面提醒：会话标题加 `● ` 前缀、头部「审批详情」红点、待审批说明浮层。POSIX 路径匹配只有单测，没有真机跑过。

## 在另一台机器/另一个平台自检

1. **装并确认版本**：在目标机器安装 `1.1.1`（desktop 安装器，或 `dsh plugin add dsh-approval-ledger`），跑 `dsh plugin list`，确认包名、版本 `1.1.1`、状态 enabled。
2. **确认 DSH 版本与声明**：`dsh --version` 应为 `0.2.1-rc.2` 或 `0.2.1-rc.3`；打开 `node_modules/dsh-approval-ledger/package.json`，确认 `engines.dsh` 是 `>=0.2.1-rc.2 <0.3.0-0`（它才是真正的安装/启动闸门），`dsh.compatibility.dshReleases` 只是说明性元数据（见上）。
3. **命令面**：新会话执行 `/approvals audit`，应输出「审批决策记录」报告（而不是 unknown command）；再跑 `/approvals last`、`/approvals grants`。
4. **单条审批**：让模型做一次需要审批的写操作（例如 `danger-full-access` 写工作区外文件），确认官方卡片标题是改写后的 `写入文件 · <路径> · 完全访问`，右下角有「待审批说明」；点「拒绝」后文件不存在，`/approvals audit` 有该拒绝记录。
5. **计划面**：用 `request_approvals` 提交两项（一项写文件、一项命令），确认 plan-review 卡 + 逐项选择卡；只勾一项批准后只有该项执行，`/approvals grants` 在 turn 结束后清空。
6. **卸载回归**：移除插件并重启，确认官方审批卡标题恢复原文，无残留红点/浮层/进程。

## 已知冲突

- 其他 `approval/request` 应答方（answerer）——`dsh-approval-gate`、`dsh-approval-review`、`dsh-approval-llm`、`dsh-experimental-auto-review`：我们都是 `{ prepend: true }` 监听器，命中 grant 时直接返回 `allowed-once` 且**不调用 `next()`**，排在后面的监听器不会运行；反过来，更晚挂载的 prepend sibling 可以抢在我们前面（Cordis 用 `Promise.all` 挂载，prepend 之间是竞争）。不要叠加。
- 通知类（`dsh-approval-chime`、`dsh-approval-alert`、`dsh-approval-voice`）：可能双重提醒；配 `notifications:false`。
- 快捷键/详情类（`dsh-approval-hotkeys`、`dsh-approval-explain`）：我们只注册 `conversation.session.header.utilities`（list）和 `shell.overlay`（list），不碰 `conversation.approval.detail`（single，被 `dsh-client-ui-chat` 占用）；仍可能与标题改写/弹窗视觉重叠。
- 命令/工具重名：`/approvals`、`request_approvals`、`ask_choices` 注册前要检查。**没有自动降级**（不存在 `ledger_*` / `/ledger` 回退）：任一注册冲突会让 `registerRuntime` 回滚全部注册（`src/plugin/runtime.ts:838-846`），`apply` 只写一条 warn（`src/index.ts:73-79`），插件保持不生效。需要手动改名或停用冲突插件。
- 同一 profile 里残留旧版本：加载的是 profile manifest 解析到的那个包；自检第 1 步先确认版本。

## 冒烟检查清单

- 单条审批：标题摘要、详情浮层、允许/拒绝、原始 reason 可见；拒绝后文件/命令确实没有执行（fail-closed）。
- 计划：plan-review 卡、侧栏全文、批准/讨论、逐项选择、grants 生效、turn 结束失效。
- 风险：critical 永不自动放行；high 默认 manual；`mode: active` 且命中 grant 时 medium 数据写入才自动放行（默认 `mode: observe`，什么都不自动放行）。
- 审计：`/approvals audit` 有记录；未归属为 0；`/approvals audit --json` 可解析。
- 顺序/共存：与另一个 answerer 插件同挂时，确认我们 prepend 的改写仍先生效（看卡片标题），且命中 grant 时对方的监听器确实没运行。
- 卸载：官方审批行为恢复；无残留进程/状态。
