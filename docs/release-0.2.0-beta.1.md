> Language: [English](release-0.2.0-beta.1.en.md) · [中文](release-0.2.0-beta.1.md)

# 发布审查 — 0.2.0-beta.1

> 状态：**已发布到 npm（2026-10-19）**。tarball：<https://registry.npmjs.org/dsh-approval-ledger/-/dsh-approval-ledger-0.2.0-beta.1.tgz>。`next` 和 `latest` 都指向 `0.2.0-beta.1`——首次发布时 npm 强制创建 `latest`，且不允许删除；等稳定版发布后再把 `latest` 移到稳定版。
>
> 后续：仅文档变更的 `0.2.0-beta.2` 已发布，`next`/`latest` 指向 beta.2；本页保留 beta.1 的历史记录。

## 包

| 项目 | 值 |
|---|---|
| 名称 | `dsh-approval-ledger` |
| 版本 | `0.2.0-beta.1` |
| 目标 DSH | `0.2.1-rc.2` |
| Node | `>=22` |
| 依赖 / peer 依赖 | 无 |
| 安装生命周期脚本 | 无 |
| 运行时导入 | 仅本地模块 + Node 内置模块 |
| 文件 | `lib`、`client.js`、`schema`、`locale`、`icon.svg`、`cordis.patch.yml`、README 文件、LICENSE、SECURITY |
| 默认模式 | `observe`；`mode: active` 需显式 opt-in |

## 已验证

- 273 个单元测试；`pnpm lint` 0 警告；`pnpm build` 通过。
- GitHub Actions：Ubuntu/Windows × Node 22/24（客户端改动前提交的运行编号为 `39135436206`）；最新的 client/flash 提交 CI 正在检查中。
- 在 `approval-p0` 和 desktop 中完成 live P0：plan-review、逐项选择、A/B 拆分、改写 `displayReason` 的高风险审批卡片、拒绝时 fail-closed、计划取消、subagent `DELEGATED_CALLER`、审计归属。
- Desktop 重启：Host `request_approvals` 已注册；客户端 slot `approval-ledger-details` 已激活。

## 已知缺口 / 注意事项

- Windows 的 `FlashWindowEx` 辅助模块已有单元测试，但实际窗口闪烁尚未在 Electron 中 live 验证。
- 同级 `approval/request` 顺序已有 FakeContext 覆盖；尚未做带第二个审批插件的 live 测试。
- 对于 DSH 在没有 `approval/asked` 事件的情况下允许的 workspace-write，只能显示为 `无法验证`（通过目标 hash 归属，但没有审批决定）；它不是已验证的审批。
- desktop profile 目前使用 `link:D:\AIworkspace\dsh-approval-ledger`；移动/删除该目录会破坏已安装的 profile。从 npm 发布/安装可解除这种耦合。

## 发布清单（需要明确批准）

1. 确认最终版本为 `0.2.0-beta.1`，且工作树干净。
2. 确认 npm 账号/2FA 和包所有权；不要把 token 粘贴到日志中。
3. `pnpm pack --dry-run`（或 `npm pack --dry-run`），检查 `lib/`、`client.js`、`schema/`、`locale/`、`cordis.patch.yml` 和文档均已包含，且没有包含 `.p0-*`/测试/密钥。
4. 用 beta tag 发布（`npm publish --tag next`）。首次发布时 npm 可能强制设置 `latest`；要记录实际 dist-tags，不要假设 `latest` 不存在。
5. 创建对应的 GitHub tag/release，并在安全审查后，在干净的 profile 中用 `dsh plugin add dsh-approval-ledger@0.2.0-beta.1` 验证已发布的 tarball。
6. 回滚：按 npm 政策 deprecate/unpublish；现有本地 profile 可以移除 bundle 或恢复 `.p0-backup`。

## 发布尝试日志

- 2026-10-19：本机登录后（`pnpm whoami` → `yingcai233`），最初 `pnpm publish` 返回 `E403 ... 2FA required`。根因是 pnpm 优先读取 `C:\Users\36288\AppData\Local\pnpm\config\auth.ini` 里的旧 token，而不是 `.npmrc` 里的新 bypass-2FA token。替换 `auth.ini` 后发布成功：`✅ Published package dsh-approval-ledger@0.2.0-beta.1`。
- 首次发布 npm 强制把 `latest` 也指向 `0.2.0-beta.1`，且 `pnpm dist-tag rm ... latest` 返回 `ERR_PNPM_DIST_TAG_RM_LATEST`（不允许删除）。`next` 同样指向该版本；稳定版发布后应把 `latest` 移到稳定版。
- 后续发布前仍需清理/轮换泄露过或过期的 token，不要把 token 或 OTP 发到聊天里。

## 禁止事项

- 不要手动把 beta 设成 `latest`；本次首次发布是 npm 自动设置且无法删除，稳定版发布时要显式把 `latest` 移到稳定版。
- 不要在未检查打包文件列表和未获得用户明确发布批准的情况下发布。
- 在已发布 tarball 经过检查之前，不要把 npm tarball 安装到 `desktop`。
