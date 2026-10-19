# 变更日志

> Language: [English](CHANGELOG.en.md) · [中文](CHANGELOG.md)

本项目的所有重要变更都记录在此。

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
