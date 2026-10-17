# dsh-approval-ledger

为 **DeepSeek Harness** 提供批量审批、风险门控和可追溯决策账本。

> **状态：Sprint 0 脚手架。** 还没有可用的审批功能；第一个版本是 `0.1.0`（observe 模式，只记录不实际放行）。

## 为什么

DSH 的写文件/跑命令审批是一个一个弹的。写/命令类工具是独占调度，第一个审批会阻塞后面所有调用；插件不可能“等未来审批到齐”，所以必须让 agent 先把这一批操作声明出来。

这个插件做四件事：

- **一批一个计划**：agent 调用 `request_approvals` 交清单，你一次批准。
- **依赖阶段**：计划项可声明 `dependsOn`；依赖消耗完才解锁下游。
- **风险门控**：每次实际调用重新判风险；critical 永不自动；high 默认手动，显式开启后还要二次确认；unknown 一律手动。
- **决策账本**：自动/手动决定都能通过 session log + 元数据账本追溯。
- **官方 UI 优先**：不替换自带的审批卡、问题卡、计划卡。

## 安全模型

- `critical` **永不**自动放行。
- `unknown` 一律手动。
- 自动放行要过 **两道门**：计划范围匹配 **且** 实际调用风险等级允许。
- grant 只在内存、按 session、按 turn；turn 结束、卸载、重启即失效。
- 任何异常、解析失败、不匹配，一律回退官方审批。
- 账本不记录完整参数、命令、reason 或密钥。

## 安装

还没发布。`0.1.0` 会在 observe 模式实现和第一轮兼容验证之后发布。

```sh
# 计划中
dsh plugin --profile <profile> add dsh-approval-ledger
```

## 开发

要求：Node.js 22+、pnpm。

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

这是一个 Cordis bundle：`cordis.patch.yml` 插入 `approval-ledger` 行；`lib/index.js` 是 Host 半部。

## 文档

- [设计](docs/design.md)
- [威胁模型](docs/threat-model.md)
- [审计/决策账本](docs/audit.md)
- [运行时笔记](docs/runtime-notes.md)
- [兼容性](docs/compatibility.md)
- [交接文档](HANDOFF.md)

## License

MIT，见 [LICENSE](LICENSE)。

## 免责声明

非官方社区插件，与 DeepSeek 无隶属关系；不要用 DeepSeek 的名称或 logo 暗示官方背书。
