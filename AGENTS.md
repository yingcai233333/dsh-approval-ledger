# 工作区约束

> Language: [English](AGENTS.en.md) · [中文](AGENTS.md)

本文件记录用户在当前工作区口述的硬约束。修改只由用户在对话中明确提出。

## 阶段约束（Sprint 1）

- 当前只做 **Host 侧接线**：`request_approvals`、`/approvals`、`approval/request` 钩子、plan-review 文档、grants、session-log 审计投影；默认 observe-only。不替换官方审批/问题/计划 UI。
- **不要先安装插件**：不执行 `dsh plugin ... add`，不改 profile，不运行 `pnpm add` / `npm install` 安装新包。
- **不要先发布**：不打 tag、不 publish、不触发 release workflow；live P0 和安装安全审查完成前不发布。
- 安装/发布前必须按用户的安全审查规矩逐条确认：
  1. 来源（npm/GitHub 官方仓库、发布者身份、下载量与更新时间）；
  2. 版本与依赖树、peer 依赖兼容性；
  3. 所有安装脚本（`preinstall` / `install` / `postinstall` 等）逐条列出；
  4. 不能确认的点逐条写出风险，不以“应该没问题”带过；
  5. 列出“装什么、从哪装、会跑什么脚本、改哪些文件、影响范围”，等用户明确同意后才执行；
  6. 同意只对当次列出的那一个插件/版本有效，不顺延、不类推。
- 涉及 DSH peer 版本豁免时，必须按“可能崩溃、可能丢失数据”单独警告，并取得针对该确切插件 + 运行时版本的许可。

## 实现约束

- 不新增 session 事件类型；不替换 `ui-approval`；不占用 `conversation.approval.detail`。
- 不修改系统环境变量、不装原生依赖、不在工作区外写入。
- 账本/日志不记录密钥、完整参数、完整 reason；只存 hash/摘要/等级/归属。
- 任何异常、解析失败、不确定，一律 fail-closed（回退官方审批或标 unknown/manual）。
- `critical` 永不自动放行；`unknown` 一律 manual。

## 测试

- 本地测试使用 Node 自带测试运行器 + `tsc` 预编译，避免沙箱下的 esbuild 子进程限制。
- 不因为测试方便而放宽上述安全约束。
