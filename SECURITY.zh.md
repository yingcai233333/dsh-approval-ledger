# 安全策略

> Language: [English](SECURITY.md) · [中文](SECURITY.zh.md)

## 报告漏洞

请使用 GitHub 的**私有漏洞报告**（Security → Advisories → Report a vulnerability），而不要开公开 issue。

请包含：

- 插件版本与 DSH 版本。
- 操作系统。
- 最小复现步骤。
- 影响评估（攻击者能够做什么）。
- 任何相关日志，但需先隐去 token、路径和用户数据。

## 范围

本插件是一个拥有完整 Node.js 访问能力的 Host Cordis 插件。它会读取会话/工具元数据，注册 `request_approvals`、`/approvals` 命令以及 `approval/request` 监听器，并维护一个仅含元数据的内存逐调用账本。持久化的证据仍然是 session log 与计划级的 `tool/result.meta`。

它**不会**（截至 0.1.0-beta.1）：

- 新增 session 事件类型；
- 替换官方的审批/问题/计划 UI；
- 修改 Electron 主进程；
- 修改系统环境变量；
- 安装原生依赖；
- 发送遥测或网络请求；
- 启动 PowerShell/通知辅助程序（计划在 Sprint 2 实现）。

## 设计原则

- Fail closed：任何非预期状态都会回退到官方审批路径。
- critical 操作永远不会被自动批准。
- unknown 操作一律 manual。
- grant 按 turn 作用域、仅存于内存，且绝不会被子会话继承。
- 日志与审计存储绝不包含完整的命令、参数、原因或密钥。

完整的威胁模型见 [docs/threat-model.md](docs/threat-model.md)。
