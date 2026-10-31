# 变更日志

> Language: [English](CHANGELOG.en.md) · [中文](CHANGELOG.md)

本项目的所有重要变更都记录在此。

## [1.2.2] - 2026-10-31

### 变更

- `dsh.compatibility.dshReleases` 增加 `0.2.1-rc.5: compatible`（纯说明性元数据，没有任何代码读它；`engines.dsh` 范围未变，本来就覆盖 rc.5）。同时记录：rc.5 已在本机做运行验证（审批钩子、`/approvals`、设置面板、会话级自动放行含 PTC inner call 与 dsh-ops 工具），**rc.4 未验证**，rc.3 → rc.5 的逐文件静态对比仍未做。

## [1.2.1] - 2026-10-31

### 修复

- 会话级自动放行在 PTC 会话和 dsh-ops 工具上完全不生效：PTC inner call 只写 `tool/ptc-dispatch-start`、没有对应的 `tool/call`，`SessionTracker` 取不到参数，写/命令类调用被判 `unknown`；dsh-ops 的 `ops_*` 工具不在风险分类里，被判 `unknown-tool`。现在 `SessionTracker` 从 `tool/ptc-dispatch-start` 取参数（`subCallId` 当 callId、`name` 当工具名、`arguments` 为对象或 JSON 字符串，超 1MB 仍丢弃），历史扫描同样识别该事件；`src/core/tools.ts` 补上 dsh-ops 的读/写/移动/删除/命令工具与 `ops_job_kill`（`ops_batch`/`ops_load_sdk` 语义不明，继续 fail-closed）。`ops_bash` 的 `{command}` 走命令风险评估，`rm -rf` 仍按删除例外、`ops_remove` 永远人工；`ops_copy`/`ops_move` 的目的地 `to` 也纳入路径评估，避免只按源路径判风险。

### 测试

- 扩展 `test/session-tracker.test.ts`：PTC dispatch 经 `observe` 与历史扫描取到 `args`/`tool`/`turn`，参数为对象与 JSON 字符串两种形态，`subCallId` 不匹配、无 turn 边界、超 1MB 仍按 fail-closed 处理。
- 新增 `test/tools.test.ts`：dsh-ops 工具的读/写/命令/移动/删除/接口分类，`ops_batch`/`ops_load_sdk` 保持 `unknown`，`ops_bash` 的 `{command}` 被命令风险评估识别。
- `test/session-auto.test.ts` 补充集成用例：PTC dispatch 提供参数后 `ops_bash` 自动放行（`matchedBy: session-scope+risk-gate`），`ops_bash` 带 `rm -rf` 与 `ops_remove` 仍被删除例外拦下（`matchedBy: session-auto-delete-blocked`）。
- 全量 430 个测试通过，`pnpm lint` 0 warning，`pnpm build` 通过。

## [1.2.0] - 2026-10-31

### 新增

- 会话级自动放行：`/approvals auto` 查看状态，`/approvals auto on|off` 只改当前会话。开关跨 turn 保留，会话结束/插件卸载/重启失效；`active` 模式下 low/medium/high 直接放行，删除文件或目录的指令、`critical`、`unknown` 仍然必须人工审批。`observe`/`auditOnly` 下 `auto on` 会被拒绝并提示「观察模式不放行」。
- 设置面板新增「自动放行」分组与「新会话默认自动放行」（`autoAllowSessions`，默认 `false`，volatile）。它只影响之后新起的会话；已在运行的会话保留启动时的快照，需要用 `/approvals auto on|off` 调整。`src/config-schema.ts`、`client.js` 与中英文案同步更新。
- 删除意图识别（`src/grants/delete-intent.ts`）：删除工具名直接命中；其他请求把参数有界序列化（≤8192 字符；序列化失败或超长按删除处理，fail-closed）后匹配删除特征（`rm`/`rmdir`/`rd`/`del`/`erase`/`unlink`/`remove-item`/`trash`/`rimraf`、`git clean`、`find -delete`、`.delete(`、`shutil.rmtree`、`os.remove`、`fs.rm`）。`src/risk/commands.ts` 导出同一份 `DELETE_INTENT_PATTERN`，命令风险引擎复用。
- 审计 `matchedBy` 新增两个固定值：`session-scope+risk-gate`（会话级放行）与 `session-auto-delete-blocked`（删除被豁免、回落官方卡）。不新增字段，审计格式 v1 不变。

### 安全

- 会话级放行只在 store 为 `active` 时生效；`critical`/`unknown` 永不自动，删除永远走官方审批卡；判断或读取异常一律 fail-closed 回落 `next()`。
- 会话状态由 `src/grants/session-auto.ts` 的 `SessionAutoAllow` 管理：按 session 隔离、上限 64、超限丢最旧，`session/disposed` 清理单会话，插件 `dispose()` 全清。

### 测试

- 新增 `test/session-auto.test.ts`：开关、容量、`forget`/`clear`、配置默认快照、删除识别正反例、`observe` 拒绝、放行与豁免的 `matchedBy`、异常 fail-closed。
- 全量 411 个测试通过，`pnpm lint` 0 warning，`pnpm build` 通过。

## [1.1.3] - 2026-10-29

### 修复

- **完成提醒的声音以前要等窗口回到前台才响**：脚本把声音排在徽标的等待循环之后，而那个循环会一直轮询到窗口回到前台（或徽标到期）才退出——所以任务栏闪烁和绿点在完成时就出现，声音却要等你点回窗口才播；`turnBadgeSeconds: 0`（常驻到回窗口）时等于永远不响。现在声音先于徽标执行，完成时约 2 秒内就响（那 2 秒是 PowerShell 启动 + C# 编译 + 波形合成的固定开销，审批提醒一直如此），单测断言「声音片段必须在徽标等待循环之前」。

## [1.1.2] - 2026-10-28

### 修复

- **完成提醒从 1.1.0 起其实从未执行过**：完成提醒脚本本身约 13,000 字符，`-EncodedCommand` 把它扩成 UTF-16 base64 约 34,700，超过 Windows 单条命令行 32,767 的上限，`spawn` 直接抛 `ENAMETOOLONG`；提醒是 best-effort，异常被吞掉，于是构建了、派发了、但从没跑起来——任务栏不闪、没有绿色徽标、也没有「滴滴」。审批提醒约 30,100 字符，刚好在限内，所以只有完成提醒静默，看起来像是「只有对话结束没提示」。现在脚本先 deflate、再交给单行 stub 解压执行（编码后约 12,000 字符），并且超过上限时宁可不 spawn 也不留下一个注定失败的进程；单测直接断言各种提醒形状的编码长度，防止再犯。
- 这次故障与桌面端升级无关：`0.2.1-rc.3` 与 `rc.2` 的接口实现逐字节相同（见 `docs/compatibility.md`），问题出在 1.1.0 新增的前台静音片段把命令行顶过了上限。

## [1.1.1] - 2026-10-21（已发布到 npm，`latest`）

### 修复

- `package.json` 的 `dshhub.categories` 在 1.1.0 的发布包里被写成了乱码（`瀹夊叏` / `鏁堢巼`），恢复为 `安全` / `效率`。不影响任何功能，只影响插件市场里的分类显示。

## [1.1.0] - 2026-10-21（已发布到 npm，`latest`）

### 新增

- `turnEndOnlyWhenAway`（默认 `true`）：完成提醒只在 DeepSeek Harness 窗口**不是**前台窗口时触发，任务栏闪烁、绿色徽标、声音一起跳过——你盯着屏幕时不打扰，切走或最小化才提醒；窗口找不到时仍会提醒（声音还有用）。设为 `false` 恢复无条件提醒。只作用于完成提醒，审批/计划/问题提醒不受影响。
- 可视化设置面板：DSH 设置新增「审批与提醒」分区（`settings.section`，entry `approval-ledger`），可即点即存地修改 10 个提醒/显示开关（总开关、闪烁、提示音、四类事件提醒、完成提醒的前台静音与徽标时长、重复提醒间隔）。写链路为 `configForms` → `settings.mutate` → DSH `configEditor` 原子写入 profile 的 `cordis.patch.yml` 并热应用，不重启、不重挂插件；插件自己不写文件。`mode`、高风险授权、上限与审计保留期仍只在 YAML。

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
