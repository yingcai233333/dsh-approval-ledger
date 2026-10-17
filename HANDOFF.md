# HANDOFF — dsh-approval-ledger

> 从设计会话迁移的交接文档。新会话先读这一份，再读 `docs/design.md` 和 `docs/runtime-notes.md`。

## 0. 当前状态

- 阶段：**Sprint 0**（脚手架 + 设计定稿），还没有可用的审批功能。
- 仓库：<https://github.com/yingcai233333/dsh-approval-ledger>
- 包名 / Loader row id：`dsh-approval-ledger` / `approval-ledger`
- License：MIT
- 作者：`yingcai233333`
- 目标 DSH：`0.2.0-rc.2`（Windows 桌面；macOS/Linux 只保证非闪烁功能）
- 工作区：`D:\AIworkspace\dsh-approval-ledger`

## 1. 要解决的问题

DSH 的写文件/跑命令审批是一个一个串行弹的：第一个审批卡住时，后面的工具调用还没开始。用户希望：

1. 一次看到这一批需要审批的操作，而不是逐个点；
2. 列表简明，能点开看“是什么 / 为什么 / 批准后会怎样 / 建议”；
3. 有明确承接关系的审批能按阶段/依赖展示；
4. 关键/危险操作要重点标出，避免漏看；
5. 需要审批时桌面图标能闪烁提醒；
6. 所有决策可追溯，像 DSH 的会话日志一样有迹可循。

## 2. 不可违反的硬约束

- **不新增 session 事件类型**。DSH 的 live `Session.append()` 不能设置 `ignorable: true`，新事件会让会话拒绝重开。决策审计只能基于现有事件 + `tool/result.meta` + 插件账本 + 派生投影。
- **不替换 `ui-approval`**。用官方审批卡，升级风险最低。
- **不占用 `conversation.approval.detail`**。它是 single 槽，已被 `ui-chat` 的 `ApprovalCommand` 占用；再注册会抛错。
- **不修改 Electron 主进程**、不改系统环境变量、不安装原生依赖。
- **日志/账本不记录密钥、完整参数、完整 reason**；只存 hash/摘要/等级/归属。
- 任何不确定、解析失败、异常，**一律回退到官方审批**（fail-closed）。
- `critical` 永不自动放行；`unknown` 一律 manual。

## 3. 已定方案（速查）

| 项 | 决定 |
|---|---|
| 名字 | `dsh-approval-ledger` |
| License | MIT |
| 官方 UI | 不替换 `ui-approval` |
| 批量批准 | 官方 **plan-review 卡** + 侧栏全文 |
| 单条审批 | 官方卡不动；标题摘要化 + 会话头部“审批详情”弹窗 |
| 授权 | 双门匹配；critical 永不；high 默认 manual；medium 仅数据类写入 |
| 审计 | `tool/result.meta` + 插件账本 + `approval-audit` 投影 |
| 提醒 | Host 侧 Win32 `FlashWindowEx` + 页面红点/标题 |
| 版本 | 0.1 observe → 0.2 grants → 0.3 high/ask_choices → 1.0 stable |

### 3.1 批量计划：`request_approvals`

工具参数（草案）：

```ts
{
  summary: string,
  items: Array<{
    id: string,              // A/B/C，短且唯一
    tool: string,            // write / edit / pwsh / plugin_manager …
    title: string,           // 一行人类可读
    mode?: string,           // escalation 的目标模式
    scope?: {
      paths?: string[],      // 绝对路径或相对 cwd；默认精确文件
      commands?: string[],   // 归一化后整串相等
      args?: Record<string, unknown> // 精确子集，兜底
    },
    uses?: number,           // 默认 1，上限 5
    dependsOn?: string[],    // 声明的承接关系
    note?: string            // 模型说明（未验证）
  }>
}
```

流程：

1. 校验 id 唯一、依赖无环、路径/命令合法、tool 已注册。
2. 用 `ctx.userQuestions.ask` 发一个 **plan-review** 问题：
   - `detail` = 计划 Markdown（简明清单 + 每项详情）；
   - `intent = { kind: 'plan-review', approve: '<label>' }`；
   - 只有 1–2 个 option；不要 `callId`（这样点“讨论”会取消请求，而不是留下悬挂卡）；
   - `multiSelect` 不能为 true（plan-review 会退回普通问题）。
3. 用户批准后生成 grants；取消/关闭则不生成。
4. 计划文档第一行是标题，第一段是两行摘要；其余内容进侧栏全文。
5. 依赖用阶段展示；匹配时按阶段门控。

### 3.2 双门匹配

`approval/request` 前置监听器（`{ prepend: true }`）：

```ts
ctx.on('approval/request', async (req, next) => {
  try {
    const grant = matchGrant(req)      // 计划门 + 风险门
    if (grant) return 'allowed-once'
  } catch { /* fall through */ }
  return next()
}, { prepend: true })
```

**第一道门：计划门**
- 同 session、同 tool、同 kind、同 mode、有剩余 uses、依赖已满足；
- paths 用 `realpath` 最近已存在祖先 + 大小写归一 + 拒绝 UNC/ADS/8.3/设备名/尾点空格；
- commands 整串精确匹配；含控制符/换行/脚本/解释器的不自动放行；
- args 精确子集匹配。

**第二道门：风险门**
- 对**这次实际调用**重新判风险；
- medium 才可自动；high 需 opt-in + 二次确认；critical 永不；unknown 一律 manual；
- 这样“计划授权的是目录”也不会把目录里的 `.ps1` 自动放行。

### 3.3 风险分级

| 等级 | 默认 | 典型 |
|---|---|---|
| medium | 可批量自动放行 | 非系统/非凭据/非代码配置的数据类文件写入（`.md`/`.txt`/`.csv`/普通 `.json`） |
| high | 默认 manual；`allowHighRiskGrants` 开启后二次确认 | 删除、包安装、命令/脚本、网络下载、环境变量、权限变更、代码/配置写入 |
| critical | **永不自动** | 系统目录、凭据、DSH 自身配置/插件、磁盘/引导/服务/注册表、force push、publish、递归强删工作区外 |
| unknown | manual | 无法分类的工具/命令/解析失败 |

风险引擎只给建议，不自动拒绝；展示命中原因；`critical` 用红点/红条/“建议拒绝”。

### 3.4 审计账本

四层：

1. **session log（事实）**：`tool/call`、`tool/result`、`approval/asked`、`approval/decided`、`user-question-reply`、`turn/end`。自动放行也会留下 asked/decided。
2. **`tool/result.meta`（计划级决策）**：`request_approvals` 返回时写入 planId、approved/manual、items、grants、`schemaVersion`/`matcherVersion`/`riskPolicyVersion`。不进模型上下文，不花 token。
3. **插件审计账本（每次调用的理由）**：`ctx.storageDomain` 按 session 分区，append-only；只存 `callId`、`planId`、`itemId`、`tool`、`risk`、`mode`、`targetHash`、`targetSummary`、`outcome`、`matchedBy`、版本、时间。**不存完整参数/reason/命令。**
4. **`approval-audit` 投影 + 报告**：join 1–3 层，按 turn/plan 分组；`/approvals audit [--json]` 输出；`wire.view` 给客户端侧栏/计划文档。缺失记录标 `unattributed`，不猜。

可选第 5 层：`auditNotices: "plan"` 每个计划一条对话内提示；`"all"` 每次自动放行一条（默认关，避免刷屏和 token）。

### 3.5 UI

- **单条审批**：官方 `ui-approval` 卡完全不动。
  - Host 在 `approval/request` 里把 escalation 的 `displayReason` 改写成一句摘要（含真实 mode + 目标）；原始 `reason` 保留在日志和弹窗里。
  - 会话头部 `conversation.session.header.utilities` 加“审批详情”按钮（红点），打开 `shell.overlay` 只读弹窗：是什么 / 为什么 / 批准后 / 风险依据 / 建议 / 原始 reason+JSON。
  - 弹窗不放允许/拒绝，决定只在官方卡上。
- **批量**：官方 plan-review 卡；标题+两行摘要；“查看全文”由 `ui-plan` 打开侧栏 Markdown；按钮“批准/讨论”。讨论=取消并重写，不是逐项勾选。
- **多选问题**：官方 question 卡；用 `ask_choices` 工具生成结构化 `detail` + option `description` + 推荐标记（`（推荐）` 后缀），不改问题 UI。
- **不碰**：`conversation.approval.detail`、`ui-approval`、`ui-chat`、`ui-plan`、`ui-user-questions` 的代码。

### 3.6 提醒

- Host 维护待处理计数：`approval/request` 未命中 grant 时 begin/end；计划问题 ask 前后 begin/end。
- Windows：懒启动常驻 PowerShell，`Add-Type` 一次，按 `process.ppid`（Electron 主进程）找窗口调 `FlashWindowEx`，`FLASHW_TIMERNOFG`；失败降级为标题/favicon。
- 页面：红点/标题前缀；不要把聊天列表刷长。
- 非 Windows：无闪烁，仅页面提醒。

## 4. 运行时事实（已核）

- 审批入口：`ctx.approval.request()`；`approval/asked` 在 waterfall 之前 append，`approval/decided` 之后 append；自动放行也留痕。
- escalation 的 reason：`escalate sandbox to <mode>: <justification>`；`displayReason` 是 `{en, zh}`。
- `approval/request` 是 waterfall，插件可 `{ prepend: true }`；返回 `allowed-once` 即放行。
- `dsh-agent-loop` 对非 `isConcurrencySafe` 工具逐个调度；第一个审批会阻塞后续，所以“等所有审批到齐”不可能，必须让 agent 先交计划。
- `conversation.approval.detail` 是 single 槽，被 `dsh-client-ui-chat` 的 `ApprovalCommand` 占用；再注册会抛 `single slot ... already has a registration`。
- `conversation.input.dock` 在默认 composer 里；审批卡接管 composer 时不会渲染，不能把审批详情放 dock。
- `ui-user-questions` 的 plan-review 需要：1 个 question、`detail` 非空、`multiSelect !== true`、`options.length <= 2`、`intent.kind === 'plan-review'`、`option.label === intent.approve`。
- `conversation.plan-review.actions` 由 `ui-plan` 提供“查看全文”；没有 `callId` 时打开临时 review 文档，有 `callId` 时打开 `submitted-plan`。
- `ctx.uiSession.sessionStatus` 暴露每个 session 的 `pendingInteraction`（approval/question/plan-review）。
- `tool/result` 支持 `meta?: JsonValue`，可放结构化决策，不进入模型内容。
- `dsh-desktop-host` 由 Electron 主进程 `spawn` 为子进程；宿主 `process.ppid` 是 Electron 主进程，可按 PID 找窗口。
- `dsh-experimental-auto-review` 用 `tools/pre-execute` `{prepend:true}`；我们的 `approval/request` 也会 prepend，多个自动审批插件会互相抢占，需要兼容说明/检测。

## 5. P0 spike 清单（实现前先验）

1. `displayReason` 在 `approval/request` 前置监听器里改写，客户端卡片是否显示新文案；对象是否被冻结。
2. plan-review intent 在**非 plan 模式**是否渲染；`查看全文` 是否打开侧栏临时文档。
3. `conversation.approval.detail` 单槽冲突（已知会抛错，确认即可）。
4. 客户端 `useChat` 能否按 callId 取到 `argsRaw`；`useSessionStatus` 能否拿到 pending approval。
5. `tool/result.meta` 是否持久化、投影是否可读；`ctx.storageDomain` 账本读写。
6. `request_approvals` / `ask_choices` / `/approvals` 是否与现有插件重名。
7. `approval/request` prepend + `next()` 的行为；`allowed-once` 是否仍写 asked/decided。
8. Windows flash helper：PowerShell 常驻、EDR/ConstrainedLanguage 下是否失败、失败降级。

## 6. 目录与下一步

```
dsh-approval-ledger/
  package.json
  cordis.patch.yml
  README.md / README.zh.md
  LICENSE / SECURITY.md / CONTRIBUTING.md / CHANGELOG.md
  HANDOFF.md
  icon.svg
  locale/{en,zh}.json
  docs/{design,threat-model,audit,runtime-notes,compatibility}.md
  schema/audit-v1.json
  src/
  test/
  .github/workflows/ci.yml
```

下一步：

1. **Sprint 0**：纯匹配器（path/command/args）、风险引擎、计划 schema/校验、审计 schema/回放 + 单测。无 UI、无安装。
2. **Sprint 1**：observe 模式、`request_approvals`、plan-review 文档、审计账本/投影、`/approvals` 命令；发 `0.1.0-beta.1`（`next` tag）。
3. **Sprint 2**：medium 自动放行、头部详情按钮/弹窗、Windows 闪烁；发 `0.2.0`。
4. **Sprint 3**：high opt-in + 二次确认、`ask_choices`、跨会话只读列表；发 `0.3.0`。
5. **1.0.0**：API/审计格式冻结、兼容矩阵。

## 7. 环境

- Git：`C:\Program Files\Git\cmd\git.exe`（2.55.0.5）
- GitHub CLI：`C:\Program Files\GitHub CLI\gh.exe`（2.102.0）
- 已登录账号：`yingcai233333`
- 仓库：<https://github.com/yingcai233333/dsh-approval-ledger>
- 旧会话工作区：`D:\AIworkspace\LocalModel`；`.dsh-research` 是只读调研产物，**没有迁入仓库**。
- Node/pnpm：用 DSH 运行时自带的，不装新环境、不改系统 PATH。
- 发布：2FA + GitHub Actions OIDC trusted publishing + `--provenance`；不要在 CI 日志打印 token。

## 8. 不做

- 不替换官方审批/问题/计划 UI。
- 不新增 session 事件类型。
- 不做“永久允许”“整个工具允许”。
- 不自动放行 critical / unknown。
- 不做跨会话授权继承。
- 不持久化 grants。
- 不把完整参数/reason/密钥写进账本或日志。
- 不修改系统环境变量、不装原生依赖。

## 9. 给新会话的第一句话

> 先读 `HANDOFF.md` 和 `docs/design.md`；项目在 Sprint 0，先把纯匹配器/风险引擎/审计回放和单测做出来，不要先装插件。安装/发布前按用户的插件安全审查规矩逐条确认。
