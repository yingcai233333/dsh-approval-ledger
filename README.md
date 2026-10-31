# dsh-approval-ledger

<p>
  <a href="https://www.npmjs.com/package/dsh-approval-ledger"><img alt="npm version" src="https://img.shields.io/npm/v/dsh-approval-ledger?color=%234D6BFE"></a>
  <img alt="tests" src="https://img.shields.io/badge/tests-387%20passing-brightgreen">
  <img alt="node" src="https://img.shields.io/badge/node-%3E%3D22-339933">
  <a href="LICENSE"><img alt="license" src="https://img.shields.io/badge/license-MIT-blue"></a>
</p>

> Language: [English](README.en.md) · [中文](README.md)

文档索引：[docs/README.md](docs/README.md) · [docs/README.en.md](docs/README.en.md)

为 **DeepSeek Harness** 提供批量审批、风险门控和可追溯决策账本。

## 它能做什么

- **一次批准一批**：`request_approvals` 先把这批操作声明出来，走官方 plan-review 卡，不再一条条弹窗打断。
- **风险门控**：medium 可配置自动放行；high 需要 opt-in + 二次确认；critical 永不自动；解析不了的一律 manual。
- **会话级自动放行**：`/approvals auto on` 只对当前会话生效，low/medium/high 直接放行；删除文件、critical、unknown 仍然必须人工审批；设置面板可让新会话默认开启。
- **每笔决策可追溯**：`/approvals audit` 把审批、计划、拒绝和归属列清楚，审计格式 v1 已冻结（[`docs/audit.md`](docs/audit.md)）。
- **提醒可调**：计划卡、问题卡、审批卡、每轮对话完成各有开关；完成提醒带任务栏绿色徽标和专属提示音，窗口在前台时不打扰。
- **设置面板**：DSH 设置 → 「审批与提醒」，11 个开关即点即存，不用改 YAML。
- **fail-closed**：任何读不到、认不出、异常的情况都回落官方审批卡，插件不做猜测。

> **状态：1.1.3 已发布到 npm（`latest`）；desktop 安装 1.1.3（`mode: active`、`autoSelectAll: false`、`turnEndOnlyWhenAway: false`）。** 1.1.3 修掉完成提醒的**声音延迟**：声音以前排在任务栏徽标的等待循环之后，只有你点回窗口时才响；现在先响再挂徽标。1.1.2 修掉「完成提醒从 1.1.0 起从未执行」（`-EncodedCommand` 超过 Windows 32,767 字符上限，`spawn` 抛 `ENAMETOOLONG` 被吞掉）。

## 截图

**计划审阅**：批准前就能看到每项操作、风险、依赖和执行阶段，逐项可展开。

<img src="https://raw.githubusercontent.com/yingcai233333/dsh-approval-ledger/main/assets/plan-review.png" alt="计划审阅面板" width="520">

**官方审批卡**：标题是中文摘要（工具 · 目标 · 模式）；右下角还有只读的「待审批说明」。

<img src="https://raw.githubusercontent.com/yingcai233333/dsh-approval-ledger/main/assets/approval-card.png" alt="官方审批卡" width="480"> <img src="https://raw.githubusercontent.com/yingcai233333/dsh-approval-ledger/main/assets/approval-note.png" alt="待审批说明" width="300">

**结构化问题卡**：`ask_choices` 的选项和补充内容会原样回传给模型。

<img src="https://raw.githubusercontent.com/yingcai233333/dsh-approval-ledger/main/assets/question-card.png" alt="ask_choices 问题卡" width="520">

**对话完成提醒**：每轮对话结束时任务栏会闪烁、播两声「滴滴」，并留下这个绿色 overlay 徽标；你回到窗口后徽标即清除。`FlashWindowEx` 的闪烁颜色由系统「注意提示」配色决定、应用无法指定绿色，所以用绿色徽标表达「完成」。

<img src="https://raw.githubusercontent.com/yingcai233333/dsh-approval-ledger/main/assets/turn-end-badge.png" alt="对话完成时的任务栏绿色徽标" width="520">

## 为什么

DSH 的写文件/跑命令审批是一个一个弹的。写/命令类工具是独占调度，第一个审批会阻塞后面所有调用；插件不可能“等未来审批到齐”，所以必须让 agent 先把这一批操作声明出来。

这个插件做四件事：

- **一批一个计划**：agent 调用 `request_approvals` 交清单，你一次批准。
- **依赖阶段**：计划项可声明 `dependsOn`；依赖消耗完才解锁下游。
- **风险门控**：每次实际调用重新判风险；critical 永不自动；high 默认手动，显式开启后还要二次确认；unknown 一律手动。
- **决策账本**：自动/手动决定可通过 session log、计划级 `tool/result.meta` 和内存账本追溯；`/approvals audit` 对缺失记录从持久事实派生，不猜。
- **官方 UI 优先**：不替换自带的审批卡、问题卡、计划卡。

默认（observe-only）配置下，计划会被审查，但每次实际调用仍然走官方审批卡；grant 只做模拟并记为 `would-allow`。medium 自动放行只能在显式配置 `mode: active` 后启用，不是默认行为。

## 安全模型

- `critical` **永不**自动放行。
- `unknown` 一律手动。
- 自动放行要过 **两道门**：计划范围匹配 **且** 实际调用风险等级允许。
- 路径匹配会解析 symlink/junction 的真实目标；硬链接文件按高风险处理（手动）。
- grant 只在内存、按 session、按 turn；turn 结束、卸载、重启即失效。
- 任何异常、解析失败、不匹配，一律回退官方审批。
- 账本不记录完整参数、命令、reason 或密钥。

## 安装

npm 上 `latest` 指向 `1.1.3`，`next` 仍是 `0.2.0-beta.15`；desktop 安装 1.1.3 并启用 active，中/低风险可连续执行，高/严重/未知仍逐条。安装：

```sh
dsh plugin --profile <profile> add dsh-approval-ledger@1.1.3
```

显式开启 medium 自动放行：

```yaml
# cordis.patch.yml 中该插件行
- id: approval-ledger
  config:
    mode: active
```

`high` 仍需 opt-in + 二次确认；`critical` 永不自动放行；`unknown` 保持手动。

## 会话级自动放行

`active` 模式下，可以只对**当前会话**打开自动放行：

```sh
/approvals auto        # 查看开关、来源、当前模式和豁免
/approvals auto on     # 仅当前会话显式开启
/approvals auto off    # 仅当前会话显式关闭
```

- 生效条件是 store 处于 `active`；`mode: observe` 或 `auditOnly` 时 `/approvals auto on` 会被拒绝，并提示「观察模式不放行」。
- 开启后 **low / medium / high** 的调用直接放行；**删除文件或目录的指令、`critical`、`unknown` 永远走官方审批卡**。
- 开关只作用于当前会话：turn 结束不会清除，会话结束/插件卸载/重启即失效；不持久化、不跨会话。
- 删除意图既看工具名（`delete` / `remove` / `trash`），也看有界序列化后的参数（`rm`/`rmdir`/`rd`/`del`/`erase`/`unlink`/`remove-item`/`trash`/`rimraf`、`git clean`、`find -delete`、`.delete(`、`shutil.rmtree`、`os.remove`、`fs.rm` 等）；参数无法完整检查时按删除处理（fail-closed）。
- 审计沿用既有 `matchedBy` 字符串：放行是 `session-scope+risk-gate`，删除被豁免是 `session-auto-delete-blocked`；不新增字段，审计格式 v1 不变。

设置面板新增「自动放行」分组和「新会话默认自动放行」（`autoAllowSessions`，默认 `false`）。**这个开关只影响之后新起的会话**；已经在跑的会话要 `/approvals auto on`（或 `auto off`）才生效。

```yaml
- id: approval-ledger
  config:
    mode: active
    autoAllowSessions: true   # 只作新会话的默认值；删除/critical/unknown 仍人工
```

## 提醒配置

计划卡、逐项勾选卡、`ask_choices` 问题卡和官方审批卡出现时，Windows 下会闪烁任务栏并播放一段合成的柔和「叮咚」提示音（不依赖系统声音方案）。每轮对话完成时也会提醒：任务栏闪烁 + 绿色徽标 + 两声短促的「滴滴」。每一项都可以单独关闭：

```yaml
- id: approval-ledger
  config:
    mode: active
    notifications: true     # 总开关
    notifyOnPlan: true      # 计划卡
    notifyOnQuestion: true  # ask_choices / 逐项勾选
    notifyOnApproval: true  # 官方审批卡
    notifyOnTurnEnd: true   # 每轮对话完成（子代理的 turn 不提醒）
    turnEndOnlyWhenAway: true # 只看前台：你盯着屏幕时不打扰；切走或最小化才提醒
    flashWindow: true       # 任务栏/标题闪烁
    soundAlert: true        # 合成「叮咚」提示音
    notifyRepeatSeconds: 0  # >0 时每 N 秒重复，0 = 只提醒一次
    turnBadgeSeconds: 120   # 完成徽标最长保留秒数；0 = 常驻到你回到窗口
```

提醒是 best-effort：找不到窗口、PowerShell/EDR 拒绝或系统静音时静默跳过，不影响审批本身。窗口在前台时 Windows 可能不闪，声音仍会响。`turnEndOnlyWhenAway: true`（默认）时，完成提醒只在 Harness 窗口**不是**前台窗口时触发——你盯着屏幕时不打扰，切走或最小化才提醒；窗口找不到时仍会提醒（声音还有用）。审批提醒不受影响，始终无条件。

完成提醒与审批提醒是两条独立通道：审批提醒在卡片出现时触发，完成提醒在 `turn/end` 时触发。完成提醒的「绿色」用**任务栏 overlay 徽标**表达：`FlashWindowEx` 的闪烁颜色由系统「注意提示」配色决定，应用无法指定绿色。徽标在你回到该窗口时清除，最长保留 `turnBadgeSeconds` 秒（`0` 表示不超时、常驻到回窗口）。完成音是合成的两声短促「滴滴」（B5→E6，上行），审批音是「叮咚」（G5→C5，下行），两者不会混淆。子代理的内部 turn 不触发提醒；turn 被取消（`aborted`）时也不响。`turn/end` 的其余结束原因（`completed`、`blocked`、`max-tokens`、`error`）都会提醒——`error` 也提醒，因为那一轮通常需要你看一眼；`interrupted`/`forked` 是恢复或 fork 时补写的合成结束，不会产生提醒。

`ask_choices` 会把选中的选项文本返回给模型；此前只返回“已收到 N 个问题的选择”。

## 设置面板

DSH 设置里新增「审批与提醒」分区（`settings.section`，entry id 为 `approval-ledger`），可以直接可视化修改 11 个开关：总开关、任务栏闪烁、提示音、四类事件的提醒（计划卡 / 问题与逐项勾选卡 / 官方审批卡 / 每轮对话完成）、完成提醒的「窗口在前台时不提醒」与绿色徽标保留时长、未处理时的重复提醒间隔，以及「自动放行」分组里的「新会话默认自动放行」（`autoAllowSessions`，只影响之后新起的会话；已在运行的会话用 `/approvals auto on|off`）。

<img src="https://raw.githubusercontent.com/yingcai233333/dsh-approval-ledger/main/assets/settings-panel.png" alt="审批与提醒设置面板" width="520">

<img src="https://raw.githubusercontent.com/yingcai233333/dsh-approval-ledger/main/assets/settings-panel-bottom.png" alt="设置面板下半部分：完成提醒与实时保存" width="520">

改动**即点即存**：客户端通过 `configForms` 调 `settings.mutate`，由 DSH 的配置编辑器原子写入当前 profile 的 `cordis.patch.yml` 并热应用——不重启、不重挂插件。插件自己不写任何 profile 文件；首次保存会在该行追加 `config:` 并把当前值合并进去。

其余配置（`mode`、`allowHighRiskGrants`、上限、`auditOnly`、审计保留期等）**不在面板里**，仍只在 `cordis.patch.yml` 维护，避免一次误操作削弱审批策略。若运行环境解析不到 DSH 附带的 Schemastery，面板不会出现，插件继续按 YAML 工作。

## Sprint 0 纯核心（已交付：0.0.2）

Host 侧核心本身不依赖 DSH 类型；插件入口在它之上注册：

- `normalizePath` / `matchPathScope`：大小写归一、realpath 最近已存在祖先、硬链接检测；拒绝 UNC/ADS/8.3/设备名；目录范围只在确认是目录时生效。
- `normalizeCommand` / `matchCommandScope`：空白归一；含 shell 元字符、解释器、脚本、下载、编码命令的调用不参与自动匹配。
- `matchArgsScope`：有界 JSON 校验 + 精确子集匹配；数组必须完全一致。
- `assessRisk`：确定性、只给建议；`critical` 和 `unknown` 永不自动。
- `validatePlan`：id 唯一、依赖无环、阶段计算、使用次数上限、范围归一、风险计数、稳定 plan hash。
- `AuditLedger` / `replayAudit` / `renderAuditReport`：只存元数据；目标只存 hash/摘要；append-only 序号校验；回放对缺失/冲突证据标状态，不猜。

## Sprint 1 Host 接线（已交付：0.1.0-beta.1）

- `request_approvals` 注册普通 DSH 工具定义，只发一条官方 plan-review 问题；批准后再发一条官方多选问题，让你只授权想授权的项，未勾选项保持 manual。
- 客户端半会在会话头部加一个本地化“审批详情”按钮：有待审批时显示红点，点开是只读弹窗，展示 Host 改写后的摘要和原始 reason；它不会替你做允许/拒绝决定。
- Windows 下，官方审批卡真正在等待时，Host 可以闪烁 DeepSeek Harness 窗口。它是 best-effort、可用 `flashWindow: false` 关闭，不阻塞也不改变决定。
- grants 按 `(session, turn)` 存在内存；前置 `approval/request` 钩子执行计划门 + 每次调用的风险门，并把卡片的 `displayReason` 改写成真实 mode + 目标摘要。
- 默认 observe：消费模拟的 grant 并记录 `would-allow`，但绝不返回 `allowed-once`。
- `/approvals [audit [--json] | grants]` 折叠持久 session 事件 + 计划元数据；缺失的每次调用记录由 `tool/call` 参数派生并标记 `derived-session-log`，不猜。
- `ctx.storageDomain` 是 schema 校验的 KV，不是 append-only 日志；Sprint 1 有意使用 session log + 内存账本，跨会话留存推迟。

## Sprint 3（已交付：三项功能在 0.2 线完成，1.0.0 为稳定收口）

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

## 项目形象

<img src="https://raw.githubusercontent.com/yingcai233333/dsh-approval-ledger/main/assets/avatar.png" alt="项目头像" width="160" align="right">

头像用的是社区「DeepSeek 娘 / 鲸鱼娘」表情包（编号 `027`「骂我也算 token 哦~」），来自非营利整理站 [梗鲸 aigengtu.com](https://aigengtu.com/zh/whale-chan)。

角色设定出自社区二创：女仆鲸鱼娘原型为上善无形 2025 年 6 月的 OC「溟月」，女仆装与首版表情包由 ZipZipPipe 设计；「溟月」以 CC BY-NC-SA 4.0 开放二创。**头像仅作用于本仓库的个人化展示，不随代码授权**，原图版权归原作者，商用请自行联系授权。

## License

MIT，见 [LICENSE](LICENSE)。

## 免责声明

非官方社区插件，与 DeepSeek 无隶属关系；不要用 DeepSeek 的名称或 logo 暗示官方背书。
