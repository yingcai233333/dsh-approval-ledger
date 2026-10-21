# 变更日志

> Language: [English](CHANGELOG.en.md) · [中文](CHANGELOG.md)

本项目的所有重要变更都记录在此。

## [1.0.0] - 2026-10-21（已发布到 npm，`latest`）

本版本把审计记录格式 v1（[`schema/audit-v1.json`](schema/audit-v1.json)，说明见 [`docs/audit.md`](docs/audit.md)）与对外接口**标为稳定**：v1 自 0.3.0 起冻结，1.0.0 起承诺不再做破坏性改动；确需破坏性变更时，按 `docs/audit.md` 的 major 流程发布新格式，并继续读取 v1。0.3.0 之后的四项改动都进入本版本。

### 新增

- 每轮对话完成时也提醒：任务栏闪烁 + 任务栏绿色 overlay 徽标 + 两声短促「滴滴」（B5→E6）。`notifyOnTurnEnd`（默认 `true`）控制开关，`turnBadgeSeconds`（默认 `120`，`0` = 常驻到你回到窗口）控制徽标保留时长。子代理的 turn 与 aborted turn 不提醒。
- `src/plugin/session-log.ts`：会话历史读取收口到单点（上游已把 `snapshotEvents()` 标为 deprecated）；读不到时三态降级并 fail-closed——不建 grant、不自动放行，回落官方审批卡。
- `package.json` 声明 `engines.dsh: ">=0.2.1-rc.2 <0.3.0-0"`，安装与启动时真正拦截跨版本；`dshhub.compatibility.dsh` 同步同一范围。此前 `dsh.compatibility.dshReleases` 并不参与拦截。

### 修复

- 右下角「待审批说明」在没有待审批时不再挂载一个空的 fixed 容器（原来的 `content === null` 判断永远不会成立）。

### 测试

- 客户端半边测试（23 条）、审计格式 v1 冻结护栏、会话历史适配层与三态降级、turn 完成提醒、manifest 闸门；全量 357 个测试通过，`pnpm lint` 0 warning，`pnpm build` 通过。

## [0.3.0] - 2026-10-21（已发布到 npm，`latest`）

### 变更

- Sprint 3 的版本里程碑：0.3 规划的三项功能——high 风险 opt-in + 二次确认、`ask_choices` 结构化问题卡、跨会话只读列表（`/approvals sessions`）——都已在 0.2 线交付；本版本无新功能，仅做版本收口。
- 代码与 `0.2.0-beta.15` 相同，只把 `package.json` 的版本提升到 `0.3.0`。

### 验证

- 2026-10-21 完成 live 双插件同级 `approval/request` 顺序验证：2/2 样本通过，我们的 prepend 监听器先于两个探针 sibling 改写 `displayReason`；计划授权命中时短路返回 `allowed-once`，后续 sibling 不运行。

## [0.2.0-beta.15] - 2026-10-20（已发布到 npm，`next`）

### 文档

- README 中英文新增「截图」段落（计划审阅、官方审批卡 + 待审批说明、结构化问题卡），图片放在 `assets/`，用绝对 raw URL 引用。
- 本版本无代码变更，仅为刷新 npm 页面上的 README。

## [0.2.0-beta.14] - 2026-10-20（已发布到 npm，`next`）

### 修复

- 提醒完全不触发：`spawn` 带 `detached: true` / `windowsHide: true` 时，`powershell.exe` 会启动后立即退出，不执行 `-EncodedCommand`（`detached` 下 exit 0、`windowsHide` 下 `0xC0000142`），错误又被静默吞掉。现在只使用 `stdio: 'ignore'`，脚本可稳定执行。
- 提醒脚本不再用 `Get-Process` 查找窗口（那一步会记一条 `4100 系统错误` 警告），改为只按窗口标题查找。
- 右下角「待审批说明」恢复显示：`shell.overlay` 不提供 `sessionId`，浮层改为在当前会话没有 `sessionId` 时扫描会话状态里的待审批项。

### 变更

- Windows 提示音改为合成的柔和「叮咚」（G5→C5，正弦波、逐音淡入淡出），不再依赖系统声音方案；系统 `Asterisk` 只作为兜底。
- 未知工具的审批标题优先显示 `action` 值（如 `插件管理 · list_plugins · 完全访问`），不再显示 `args{1}`。

### 测试

- 更新 `test/flash.test.ts`，覆盖新的 spawn 选项与合成提示音。

## [0.2.0-beta.13] - 2026-10-20（已发布到 npm，`next`）

### 新增

- 提醒覆盖所有需要你操作的卡片：计划卡、逐项勾选卡、`ask_choices` 问题卡、官方审批卡。此前只有官方审批卡会闪。
- 提醒可按来源开关：`notifyOnPlan`、`notifyOnQuestion`、`notifyOnApproval`；闪烁 `flashWindow` 与声音 `soundAlert` 可分别开关。
- `notifyRepeatSeconds`：卡片一直未处理时每 N 秒重复提醒；默认 `0`，只提醒一次。
- Windows 声音使用系统提示音（`SystemSounds`），不引入新依赖，仍是 best-effort 的隐藏 PowerShell 辅助进程。
- 闪烁标志改为 `FLASHW_ALL`，标题栏和任务栏都会闪；窗口在前台时 Windows 仍可能不闪，声音作为兜底。

### 修复

- `ask_choices` 现在把选中项文本返回给模型，模型能看到你选了哪一项。此前只返回“已收到 N 个问题的选择”，无法据此分支。

### 变更

- `autoSelectAll` 默认仍为 `false`；desktop 若要逐项勾选，需要把该配置移除或改成 `false`。

## [0.2.0-beta.12] - 2026-10-20（已发布到 npm，`next`）

### 修复

- 重新构建 `autoSelectAll` 的 Host 产物，确保计划批准后真正跳过第二次逐项勾选。
- beta.11 的发布包缺少该构建产物，已被 beta.12 取代。

## [0.2.0-beta.11] - 2026-10-20（已发布到 npm，`next`；已被 beta.12 取代）

### 新增

- `autoSelectAll` 配置：计划批准后直接授权所有可自动项，不再弹第二次逐项勾选；高/严重/未知项仍逐条官方确认。
- 适合“一次批准，连续执行”的批量场景；默认关闭。

### 说明

- 该版本的发布包缺少 `autoSelectAll` 的 Host 构建产物，功能实际不可用。

## [0.2.0-beta.10] - 2026-10-20（已发布到 npm，`next`）

### 修复

- 审批详情弹窗强制使用中文：工具名、摘要和提示不再因 locale 检测失败而显示英文。
- 提示列表不再包含英文兜底分支。

## [0.2.0-beta.9] - 2026-10-20（已发布到 npm，`next`）

### 新增

- `/approvals last`：查看最近一个计划及逐项结果，标注“自动/手动”和“已放行/已拒绝/未记录执行”。
- 结果来自计划缓存 + 审计归因；不展示范围、路径、命令或参数。

## [0.2.0-beta.8] - 2026-10-19（已发布到 npm，`next`/`latest`）

### 变更

- `request_approvals` 的返回摘要改为中文，并逐项列出“自动/手动”，便于确认哪些项获得授权。
- 工具描述强调：一次任务里有多个受控调用时，应先调用 `request_approvals` 提交整批。
- 同屏中文说明改为 `shell.overlay` 右下角面板，审批卡出现时自动显示；不添加允许/拒绝按钮。

## [0.2.0-beta.7] - 2026-10-19（已发布到 npm，`next`/`latest`）

### 新增

- 审批卡出现时，在输入框上方同屏显示“待审批说明”，不再需要先点右上角“审批详情”。
- 说明使用中文摘要和三条中文提示；**不添加允许/拒绝按钮**，批准/拒绝仍点下方官方审批卡。
- 右侧“审批详情”入口保留，作为查看完整信息的备用入口。
- 说明面板不展示原始英文 reason、完整参数或命令。

## [0.2.0-beta.6] - 2026-10-19（已发布到 npm，`next`/`latest`）

### 修复

- Windows 闪烁增加窗口标题回退：`Get-Process` 拿不到 `MainWindowHandle` 时，用 `EnumWindows` 查找标题包含 `DeepSeek Harness` 的可见窗口。
- 真机验证：Harness 切到后台后，连续 3 组窗口/任务栏可见闪烁；前台窗口不闪是 Windows 的预期行为。
- 没有窗口、PowerShell/EDR 拒绝或非 Windows 时仍然静默跳过，不阻塞审批。

## [0.2.0-beta.5] - 2026-10-19（已发布到 npm，`next`/`latest`）

### 新增

- `/approvals sessions`：只读展示所有会话的授权摘要（计划数、有效/手动/依赖未完成/已用完计数）。
- 摘要不含范围、路径、命令或参数；不提供跨会话匹配，不允许使用其他会话的授权。
- `GrantStore.listSessionSummaries()` 只返回聚合计数，不改变会话隔离和 fail-closed 行为。

## [0.2.0-beta.4] - 2026-10-19（已发布到 npm，`next`/`latest`）

### 新增

- 新增 `ask_choices` Host 工具：通过官方问题卡提出结构化单选/多选问题。
- 支持 1-5 个问题、每题 2-10 个选项、选项说明、`recommended`（界面显示“（推荐）”）。
- 只收集选择，不执行操作、不修改授权；取消返回 `cancelled: true`。
- 问题和选项文本经过 `scrubSecrets` + 计划文档同款清洗。

## [0.2.0-beta.3] - 2026-10-19（已发布到 npm，`next`/`latest`）

### 变更

- 审批介绍改为中文：工具名（写入文件、PowerShell 命令等）、模式（只读、工作区写入、完全访问）、风险原因和状态都显示中文。
- 计划卡不再展示英文模型标题/英文说明；如果模型只给了英文，改为系统推导的中文描述。
- 计划卡新增“怎么读这份审批”，解释自动/手动、模式、风险和“计划批准不等于每次执行”的区别。
- 客户端审批详情弹窗移除原始英文 reason，改为中文说明要点。

## [0.2.0-beta.2] - 2026-10-19（已发布到 npm，`next`/`latest`）

### 变更

- 文档改为**简体中文主版本**：`README.md`、`CHANGELOG.md`、`SECURITY.md`、`CONTRIBUTING.md` 和 `docs/*.md` 默认中文；英文放在同名 `.en.md`。
- npm 页面默认显示中文 `README.md`；英文 `README.en.md` 随包提供。
- 新增 `docs/README.md` 中文索引、`docs/README.en.md` 英文索引，以及文档配对测试。
- 代码与 `0.2.0-beta.1` 相同，无功能变更。

## [0.2.0-beta.1] - 2026-10-19（已发布到 npm，`next` tag）

### 新增

- 客户端半部：会话头部新增本地化的“审批详情 / Approval details”按钮，待审批时显示红点；文档标题带 `● ` 前缀；另有一个只读弹窗，展示工具、调用、Host 改写后的摘要和原始原因。它永远不会代替你应答审批。
- best-effort 的 Windows 闪烁：由一个隐藏的、编码后的 PowerShell `FlashWindowEx` 辅助程序实现；可用 `flashWindow: false` 关闭，在非 Windows 上为空操作，不阻塞 waterfall。
- 为同级 `approval/request` 钩子的 prepend 顺序补充 FakeContext 用例覆盖。
- 双语文档：每篇面向用户的 Markdown 都有英文/简体中文成对版本、顶部 `Language` 切换，以及 `docs/README` 索引；`test/docs-i18n.test.ts` 负责校验配对。

### 变更

- 默认仍是 **observe**；`mode: active` 是启用 medium 自动审批的显式 opt-in。high/critical/unknown 仍为手动 / 永不自动。
- 版本为 `0.2.0-beta.1`；未发布。

## [0.1.0-beta.1] - 2026-10-18（未发布）

### 新增

- Sprint 1 Host 插件：`request_approvals` 工具、`/approvals [audit [--json] | grants]` 命令，以及一个前置的 `approval/request` 钩子。
- 默认 observe 模式：grant 会被模拟并以 `would-allow` 记入审计，但绝不返回 `allowed-once`。
- 官方 plan-review 卡片：文档为经过清理的 Markdown，只有一个批准/讨论问题，且不含 `callId`。
- 计划批准后再发一条官方多选问题：只有被勾选的条目才会获得 grant，未勾选的条目保持 manual。这是在官方计划卡保持单问题形态的同时，提供逐项选择/否决的环节。
- 内存中的 `(session, turn)` grant 存储，带计划范围与逐调用风险门、依赖阶段、使用次数消耗、manual/blocked 记账，以及按 turn/session 的撤销。
- 重写 `displayReason`，写入真实 mode 与目标摘要；原始原因仍保留在 session log 中。
- 客户端半部：会话头部新增本地化的“审批详情 / Approval details”按钮，待审批时显示红点；文档标题带 `● ` 前缀；另有一个只读弹窗，展示工具、调用、Host 改写后的摘要和原始原因。它没有允许/拒绝控件。
- best-effort 的 Windows 闪烁：当官方审批卡确实在等待时，Host 会启动一个隐藏的、编码后的 PowerShell 辅助程序，为 DeepSeek Harness 窗口调用 `FlashWindowEx`。它可由 `flashWindow: false` 禁用，在非 Windows 上从不运行，从不阻塞 waterfall，并静默忽略窗口不存在或 EDR 失败。
- `/approvals audit` 折叠持久 session 事件 + `tool/result.meta`，从 `tool/call` 参数派生缺失的逐调用记录（`derived-session-log`），并且从不猜测。
- 结构化的 DSH 类型表面（`src/types/dsh.d.ts`）以及只读的运行时核对（`docs/runtime-spike.md`）；不引入任何 `@deepseek-ai/*` 运行时导入。
- 本地配置清理器，带安全默认值：observe、高风险 grant 关闭、强制开启二次确认、留存期与各项上限受约束。
- 273 个单元测试，包括 FakeContext 插件集成和中英文文档配对检查。

### 变更

- `package.json` 的版本为 `0.1.0-beta.1`；未发布。目标 DSH 为 `0.2.1-rc.2`。
- 已安装到临时的 `approval-p0` profile，并在用户明确批准后为 P0 安装到线上 `desktop` profile；仍未发布。
- 审计记录使用按会话的内存账本加上 session-log 派生。`ctx.storageDomain` 是 KV 存储而非 append-only 日志，因此跨会话留存推迟。

## [0.0.2] - 2026-10-18

### 新增

- 纯路径匹配器：Windows/POSIX 归一化、对最近的已存在祖先取 realpath、硬链接检测、拒绝 UNC/ADS/8.3/设备名、仅目录包含检查，以及精确的作用域匹配。
- 纯命令匹配器：空白归一化、shell 元字符/解释器/脚本/下载检测，以及拒绝不安全命令的整串精确匹配。
- 纯参数匹配器：有界 JSON 校验，以及拒绝危险键的精确子集匹配。
- 建议性风险引擎：确定性的路径/命令/工具/mode 规则、medium 自动资格、带二次确认联锁的高风险 opt-in，以及 fail-closed 的 `unknown`。
- 计划 schema 校验：id 唯一、依赖无环、阶段计算、逐条/总量使用上限、归一化的范围、风险计数，以及稳定的计划哈希。
- 审计账本：仅含元数据的记录、目标哈希化、已擦除密钥的摘要、append-only 序号校验，以及 JSONL 往返。
- 审计回放/报告：关联事实、计划元数据与账本记录；在不猜测的前提下标记 `unattributed`、`unverifiable`、`mismatch`、`orphan` 和 `pending`。
- 162 个单元测试，覆盖对抗性路径、命令链、参数边界情况、风险策略、计划校验、账本完整性与回放状态。

### 变更

- 测试在 `tsc` 编译后使用 Node 内置的测试运行器执行（`pnpm test`）；不需要 esbuild 子进程。
- 审计 JSON Schema 现在约束 `targetHash`、摘要长度和标识符长度。

## [0.0.1] - 2026-10-18

### 新增

- 初始仓库脚手架。
- 设计、威胁模型、审计、运行时笔记与兼容性文档。
- 仅 Host 侧的空操作 Cordis 插件入口。
- 用于 typecheck、test 和 build 的 CI 工作流。
