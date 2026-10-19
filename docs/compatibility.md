> Language: [English](compatibility.en.md) · [中文](compatibility.md)

# 兼容性

## DSH

- 主要目标：`0.2.1-rc.2`（Windows 桌面）。
- 当前安装包静态核对的是 `0.2.1-rc.2`；发布前要在目标版本做 live P0 复验 `docs/runtime-spike.md` 的接口。
- `package.json` 的 `dsh.compatibility.dshReleases` 先只写 `0.2.1-rc.2`。
- 升级 DSH 后先跑 P0 spike + 手工 smoke，再更新兼容表。

## 测试

- Node 22.8+ / 24；`pnpm test` 先编译到 `lib-test/`，再用 `node --test --test-isolation=none` 执行。
- 不使用 esbuild 子进程，因此在 DSH 沙箱（禁止命名管道）下也能跑。

## 操作系统

- Windows：完整功能（含任务栏闪烁）。
- macOS / Linux：审批/计划/审计可用；闪烁降级为页面提醒。
- 路径匹配按平台：Windows 大小写不敏感 + `realpath` 最近祖先；POSIX 大小写敏感。

## 已知冲突

- 其他 `approval/request` 应答方（answerer）——`dsh-approval-gate`、`dsh-approval-review`、`dsh-approval-llm`、`dsh-experimental-auto-review`：会抢占自动审批；不要叠加。
- 通知类（`dsh-approval-chime`、`dsh-approval-alert`、`dsh-approval-voice`）：可能双重提醒；配 `notifications:false`。
- 快捷键/详情类（`dsh-approval-hotkeys`、`dsh-approval-explain`）：可能与标题改写/弹窗重叠；README 写清楚。
- 命令/工具重名：`/approvals`、`request_approvals`、`ask_choices` 注册前要检查；冲突时降级为 `ledger_*` / `/ledger`。

## 冒烟检查清单

- 单条审批：标题摘要、详情弹窗、允许/拒绝、原始 reason 可见。
- 计划：plan-review 卡、侧栏全文、批准/讨论、grants 生效、turn 结束失效。
- 风险：critical 红点/建议拒绝；high 默认 manual；medium 数据写入自动。
- 审计：`/approvals audit` 有记录；未归属为 0。
- 卸载：官方审批行为恢复；无残留进程/状态。
