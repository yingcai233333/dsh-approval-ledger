# dsh-approval-ledger

> Language: [English](README.en.md) · [中文](README.md)

文档索引：[docs/README.md](docs/README.md) · [docs/README.en.md](docs/README.en.md)

为 **DeepSeek Harness** 提供批量审批、风险门控和可追溯决策账本。

> **状态：0.2.0-beta.15 已发布到 npm（`next`）并安装到 desktop（`autoSelectAll: false`）。** 计划卡、逐项勾选卡、`ask_choices` 问题卡和官方审批卡都会提醒；闪烁与声音可分别开关，提示音是合成的「叮咚」。beta.14 修复了提醒完全静默的根因（`spawn` 的 `detached`/`windowsHide`）、`4100` 警告和右下角「待审批说明」不显示。`request_approvals`、`/approvals` 命令、`approval/request` 钩子、plan-review 文档、逐项授权选择、session-log 审计投影、头部审批详情面板和 best-effort Windows 提醒已实现并有用例。

## 截图

**计划审阅**：批准前就能看到每项操作、风险、依赖和执行阶段，逐项可展开。

<img src="https://raw.githubusercontent.com/yingcai233333/dsh-approval-ledger/main/assets/plan-review.png" alt="计划审阅面板" width="520">

**官方审批卡**：标题是中文摘要（工具 · 目标 · 模式）；右下角还有只读的「待审批说明」。

<img src="https://raw.githubusercontent.com/yingcai233333/dsh-approval-ledger/main/assets/approval-card.png" alt="官方审批卡" width="480"> <img src="https://raw.githubusercontent.com/yingcai233333/dsh-approval-ledger/main/assets/approval-note.png" alt="待审批说明" width="300">

**结构化问题卡**：`ask_choices` 的选项和补充内容会原样回传给模型。

<img src="https://raw.githubusercontent.com/yingcai233333/dsh-approval-ledger/main/assets/question-card.png" alt="ask_choices 问题卡" width="520">

## 为什么

DSH 的写文件/跑命令审批是一个一个弹的。写/命令类工具是独占调度，第一个审批会阻塞后面所有调用；插件不可能“等未来审批到齐”，所以必须让 agent 先把这一批操作声明出来。

这个插件做四件事：

- **一批一个计划**：agent 调用 `request_approvals` 交清单，你一次批准。
- **依赖阶段**：计划项可声明 `dependsOn`；依赖消耗完才解锁下游。
- **风险门控**：每次实际调用重新判风险；critical 永不自动；high 默认手动，显式开启后还要二次确认；unknown 一律手动。
- **决策账本**：自动/手动决定可通过 session log、计划级 `tool/result.meta` 和内存账本追溯；`/approvals audit` 对缺失记录从持久事实派生，不猜。
- **官方 UI 优先**：不替换自带的审批卡、问题卡、计划卡。

当前 observe-only 配置下，计划会被审查，但每次实际调用仍然走官方审批卡；grant 只做模拟并记为 `would-allow`。medium 自动放行只能在显式配置 `mode: active` 后启用，不是默认行为。

## 安全模型

- `critical` **永不**自动放行。
- `unknown` 一律手动。
- 自动放行要过 **两道门**：计划范围匹配 **且** 实际调用风险等级允许。
- 路径匹配会解析 symlink/junction 的真实目标；硬链接文件按高风险处理（手动）。
- grant 只在内存、按 session、按 turn；turn 结束、卸载、重启即失效。
- 任何异常、解析失败、不匹配，一律回退官方审批。
- 账本不记录完整参数、命令、reason 或密钥。

## 安装

npm 上 `next` 指向 `0.2.0-beta.15`，`latest` 仍是 `0.2.0-beta.12`；desktop 已安装 beta.14 并启用 active，中/低风险可连续执行，高/严重/未知仍逐条。安装：

```sh
dsh plugin --profile <profile> add dsh-approval-ledger@0.2.0-beta.15
```

显式开启 medium 自动放行：

```yaml
# cordis.patch.yml 中该插件行
- id: approval-ledger
  config:
    mode: active
```

`high` 仍需 opt-in + 二次确认；`critical` 永不自动放行；`unknown` 保持手动。

## 提醒配置

计划卡、逐项勾选卡、`ask_choices` 问题卡和官方审批卡出现时，Windows 下会闪烁任务栏并播放一段合成的柔和「叮咚」提示音（不依赖系统声音方案）。每一项都可以单独关闭：

```yaml
- id: approval-ledger
  config:
    mode: active
    notifications: true     # 总开关
    notifyOnPlan: true      # 计划卡
    notifyOnQuestion: true  # ask_choices / 逐项勾选
    notifyOnApproval: true  # 官方审批卡
    flashWindow: true       # 任务栏/标题闪烁
    soundAlert: true        # 合成「叮咚」提示音
    notifyRepeatSeconds: 0  # >0 时每 N 秒重复，0 = 只提醒一次
```

提醒是 best-effort：找不到窗口、PowerShell/EDR 拒绝或系统静音时静默跳过，不影响审批本身。窗口在前台时 Windows 可能不闪，声音仍会响。

`ask_choices` 会把选中的选项文本返回给模型；此前只返回“已收到 N 个问题的选择”。

## Sprint 0 纯核心

Host 侧核心本身不依赖 DSH 类型；插件入口在它之上注册：

- `normalizePath` / `matchPathScope`：大小写归一、realpath 最近已存在祖先、硬链接检测；拒绝 UNC/ADS/8.3/设备名；目录范围只在确认是目录时生效。
- `normalizeCommand` / `matchCommandScope`：空白归一；含 shell 元字符、解释器、脚本、下载、编码命令的调用不参与自动匹配。
- `matchArgsScope`：有界 JSON 校验 + 精确子集匹配；数组必须完全一致。
- `assessRisk`：确定性、只给建议；`critical` 和 `unknown` 永不自动。
- `validatePlan`：id 唯一、依赖无环、阶段计算、使用次数上限、范围归一、风险计数、稳定 plan hash。
- `AuditLedger` / `replayAudit` / `renderAuditReport`：只存元数据；目标只存 hash/摘要；append-only 序号校验；回放对缺失/冲突证据标状态，不猜。

## Sprint 1 Host 接线

- `request_approvals` 注册普通 DSH 工具定义，只发一条官方 plan-review 问题；批准后再发一条官方多选问题，让你只授权想授权的项，未勾选项保持 manual。
- 客户端半会在会话头部加一个本地化“审批详情”按钮：有待审批时显示红点，点开是只读弹窗，展示 Host 改写后的摘要和原始 reason；它不会替你做允许/拒绝决定。
- Windows 下，官方审批卡真正在等待时，Host 可以闪烁 DeepSeek Harness 窗口。它是 best-effort、可用 `flashWindow: false` 关闭，不阻塞也不改变决定。
- grants 按 `(session, turn)` 存在内存；前置 `approval/request` 钩子执行计划门 + 每次调用的风险门，并把卡片的 `displayReason` 改写成真实 mode + 目标摘要。
- 默认 observe：消费模拟的 grant 并记录 `would-allow`，但绝不返回 `allowed-once`。
- `/approvals [audit [--json] | grants]` 折叠持久 session 事件 + 计划元数据；缺失的每次调用记录由 `tool/call` 参数派生并标记 `derived-session-log`，不猜。
- `ctx.storageDomain` 是 schema 校验的 KV，不是 append-only 日志；Sprint 1 有意使用 session log + 内存账本，跨会话留存推迟。

## Sprint 3

- `ask_choices`：通过官方问题卡提出结构化单选/多选问题；支持选项说明和“（推荐）”标记，只收集选择，不执行操作、不修改授权。
- `/approvals sessions`：只读展示所有会话的授权计数；不展示范围/路径/命令，不提供跨会话匹配，不允许使用其他会话的授权。

## 开发

要求：Node.js 22+、pnpm。

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

`pnpm test` 先把 `src/` 和 `test/` 编译到 `lib-test/`，再用 Node 自带测试运行器执行；`pnpm build` 把 Host 半部输出到 `lib/`。

这是一个 Cordis bundle：`cordis.patch.yml` 插入 `approval-ledger` 行；`lib/index.js` 是 Host 半部。

## 文档

- [设计](docs/design.md)
- [威胁模型](docs/threat-model.md)
- [审计/决策账本](docs/audit.md)
- [运行时笔记](docs/runtime-notes.md)
- [运行时核对（0.2.1-rc.2）](docs/runtime-spike.md)
- [兼容性](docs/compatibility.md)
- [交接文档](HANDOFF.md)

## License

MIT，见 [LICENSE](LICENSE)。

## 免责声明

非官方社区插件，与 DeepSeek 无隶属关系；不要用 DeepSeek 的名称或 logo 暗示官方背书。
