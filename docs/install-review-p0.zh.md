> Language: [English](install-review-p0.md) · [中文](install-review-p0.zh.md)

# P0 安装审查 — dsh-approval-ledger 0.1.0-beta.1

> 状态：**已安装到临时 `approval-p0` profile 和用于 P0 的 `desktop` profile；尚未发布。** 本表记录审批关卡与已执行的操作。desktop 安装已获得用户明确批准。

## 1. 将要安装的内容

| 项目 | 值 |
|---|---|
| 包 | `dsh-approval-ledger` |
| 版本 | `0.1.0-beta.1`（本地，未发布） |
| 来源 | `D:\AIworkspace\dsh-approval-ledger` |
| 安装规格 | `link:D:\AIworkspace\dsh-approval-ledger` |
| 目标 DSH | `0.2.1-rc.2`（当前已安装的 desktop 构建） |
| 发布者/账号 | 本地检出，作者 `yingcai233333`；未从 registry/Git 获取 |

`package.json` 事实：
- `dependencies`：无。
- `peerDependencies` / `optionalDependencies`：无。
- 安装生命周期脚本：**无**（`preinstall` / `install` / `postinstall` / `prepare` / `prepublishOnly` 均不存在）。
- 其他脚本（`build`、`typecheck`、`test`、`lint`）仅供开发使用，不会由依赖安装运行。
- 作为依赖安装时不会安装 `devDependencies`。
- `lib/` 已构建（180 个文件，约 567 KB）；入口为 `lib/index.js`。
- Bundle 补丁 `cordis.patch.yml` 插入行 `approval-ledger` / 包 `dsh-approval-ledger`。

## 2. 两个可能的目标

### A. 当前 `desktop` profile（真实 GUI，影响所有会话）

当前运行的 profile 是 `C:\Users\36288\.dsh\profiles\desktop`，现有依赖为 `dsh-context`、`dsh-cost-meter`、`dsh-ops`，bundle 为 `dsh-base`、`dsh-web-app`、`dsh-ops`、`dsh-cost-meter`、`dsh-context`。

安装操作：`plugin_manager` → `install_bundle`，`target = link:D:\AIworkspace\dsh-approval-ledger`。

预期变更：
- `profiles\desktop\package.json`：添加依赖 `dsh-approval-ledger: link:...`；将 bundle 加入 `dsh.profile.bundles`。
- `profiles\desktop\pnpm-lock.yaml`：link 依赖条目。
- `profiles\desktop\node_modules\dsh-approval-ledger`：指向本检出的符号链接（symlink）。
- `.plugin-manager/run.json`：运行期间临时存在，结束后删除。
- `cordis.patch.yml`：预期不变（bundle 安装会通过 `package.json` 启用）；如果管理器写入启用覆盖项，将在操作前后列出。
- 运行中的组合会重新组合（或请求重启）。挂载期间，该 profile 中的所有会话都会受影响。

为什么这是唯一完全具代表性的 live P0：它使用当前 Electron GUI 和官方审批/计划卡片，因此 `displayReason` 和 plan-review 的渲染都是真实的。

### B. 新建 `approval-p0` profile（隔离，但需要单独的 Web UI）

内置 CLI 可用 Electron-as-Node 方式运行：
`DeepSeek Harness.exe` + `app.asar\dsh\node_modules\@deepseek-ai\dsh\lib\bin.js`。
临时 profile 可用 `dsh plugin --profile approval-p0 add link:D:\AIworkspace\dsh-approval-ledger` 创建（pnpm 必须通过进程内 shim 暴露；不修改系统 PATH）。它只会写入 `C:\Users\36288\.dsh\profiles\approval-p0`。

限制：
- `plugin_manager` 只管理当前 desktop profile，因此这条路径需要内置 CLI。
- 实时 UI 会是浏览器中的独立 `dsh --profile approval-p0 web` 服务器，而不是 Electron GUI；它能测试 plan-review/审批卡片，但无法测试仅 Electron 才有的行为。
- 当前 agent 无法驱动浏览器点击；需要用户打开 URL 并交互。

## 3. 运行时行为与风险

- 该插件是 Host 代码，在进程内运行，拥有完整 Node 访问权限。它注册 `request_approvals`、`/approvals`，并前置一个 `approval/request` 监听器；它读取 session/tool 元数据，并维护一个内存中的按调用账本。
- 默认配置为 **observe-only**：绝不返回 `allowed-once`；它把卡片的 `displayReason` 改写为真实 mode + 目标摘要，并记录 `would-allow`。
- 不发起网络请求，不发送遥测，不引入原生依赖，不新增 session 事件类型，也不替换官方 UI。
- 不修改系统环境；除现有工作区检出外，不在所选 profile 之外写入。
- **只有 live P0 才能回答的不确定项：** `displayReason` 改写后的实际卡片文本；plan 模式之外的 plan-review 渲染；`tool/result.meta` 的客户端往返；subagent 的 `DELEGATED_CALLER` 行为；同级 `approval/request` 的前置顺序；HMR/重新组合行为。
- 安装后的 profile/插件管理器是否接受本地 `link:` 尚未得到验证。如果管理器拒绝，则不会安装任何内容。

## 4. 备份与回滚

安装前（针对目标 A）：
- 将 `profiles\desktop\package.json`、`pnpm-lock.yaml` 和 `cordis.patch.yml` 复制到
  `D:\AIworkspace\dsh-approval-ledger\.p0-backup\desktop-*`（仅写入工作区）。

P0 之后：
1. `plugin_manager` → `remove_bundle`，目标为 `dsh-approval-ledger`。
2. 确认 `profiles\desktop\package.json` 不再列出该依赖/bundle，且 `node_modules\dsh-approval-ledger` 已消失。
3. 如果移除失败，恢复这三个备份文件并重启 DSH；该插件自身不添加持久数据。

目标 B：在单独明确批准后保留或移除 `profiles\approval-p0`；不修改 desktop。

## 5. 审批关卡

执行前必须完成：
- [ ] 选择目标 A（desktop）或 B（approval-p0）。
- [ ] 批准确切的本地 `link:` 规格和目标 profile。
- [ ] 确认备份/回滚计划。

本次审查未执行任何安装。

## 6. 执行日志（临时 profile 路径）

用户选择了隔离的临时 profile 路径。已执行：

- 通过内置 DSH CLI（Electron-as-Node）和进程内 pnpm shim 创建 `C:\Users\36288\.dsh\profiles\approval-p0`；未修改系统 PATH。
- 将 `dsh-approval-ledger@0.1.0-beta.1` 安装为 `link:D:/AIworkspace/dsh-approval-ledger`；profile manifest 现在列出该依赖和 bundle：
  - `@deepseek-ai/dsh-base`
  - `@deepseek-ai/dsh-web-app`
  - `dsh-approval-ledger`
- `node_modules\dsh-approval-ledger` 是指向工作区检出的 junction。
- 安装后重新读取 `desktop` profile，其中仍没有 `dsh-approval-ledger` 条目。
- 在 `http://127.0.0.1:3080/` 启动隔离 Web UI（一次性访问 token 未记录在此）；浏览器已自动打开。
- `--dump-config` 确认 `approval-ledger` 行已组合进该 profile。

仍待完成：在该 Web UI 中进行人工交互（计划卡片、审批卡片摘要、`/approvals audit`）；测试后必须停止临时服务器进程。

### 第一次 live 尝试（注册失败，已修复）

第一次 3080 启动没有暴露 `request_approvals`。在工具参数 schema 中找到根因：`scope.args` 声明了 `type: "object"`，但缺少 DSH 工具编译器需要的 `additionalProperties` 布尔值，导致 `ctx.tools.register` 抛出异常，而插件的 `apply` 捕获分支只发出警告。

已在 `src/plan/tool-schema.ts` 中修复（`additionalProperties: true`），新增了一个回归测试，断言每个对象 schema 节点都声明 `additionalProperties`，重新构建 `lib/`，并重启临时 Web UI。

该修复后出现第二个注册错误：输出 schema 的 `decision` 和条目 `risk` 枚举没有 `type`，DSH JSON-schema 编译器同样拒绝（`enum requires type or oneOf`）。已为两者添加 `type: "string"`，并新增针对枚举节点的回归测试。

第三次错误出现在模型 API 收到工具定义时：`Invalid schema for function 'request_approvals': true is not of type "array"`。根因：`ctx.tools.register()` 的 `parameters` 需要**原始 JSON Schema**（不同于 `defineTool`，后者编译作者 DSL），因此作者风格的 `required: true` 被传到了模型。已用 `required` 数组和显式 `additionalProperties` 布尔值重写参数 schema。

重新构建/重启后，临时诊断日志报告：

```
apply start
registerRuntime ok
```

工具 schema 现在是原始 JSON Schema，包含两个 `required` 数组，且没有布尔型 `required`。`src/index.ts` 中的诊断是临时的，已移除；P0 测试服务器在运行后已停止。

### 第二次 live 尝试：计划卡片可用；发现控制缺口

plan-review 卡片已渲染，`request_approvals` 可调用，计划已获批准。用户正确指出了控制缺口：官方 plan-review 卡片只提供整计划批准/修改，而 workspace-write 可能不会产生单独的审批卡片，因此在 A 执行前没有逐项选择/否决步骤。

在计划批准后新增了第二个官方**多选**问题（`buildPlanSelectionQuestion`）：只有勾选项才安装 grant；未勾选项保持 manual；全不选则取消整批。计划卡片的描述现在说明后面会跟一个选择问题。计划卡片本身仍无法多选（官方 plan-review 的限制），因此这是一个单独的问题，而不是替换该卡片。

重新构建并重启 3080；用下面的两步流程完成了重测。

### 自动化 live 运行（无人工点击）

在 `.p0-test/` 下新增了临时无头测试装置（已 gitignore）：内置 CLI 以 `--no-open` 启动 `approval-p0`，无头 Chrome 实例加载 token URL，一个小型 CDP 客户端在真实 Web UI 中点击/输入。它不触碰 `desktop`，也不安装其他任何东西。

自动验证：

1. plan-review 卡片渲染出 A/B、风险、依赖、阶段，以及“选择随后进行”的说明；
2. 点击“同意执行”会打开第二个多选卡片，包含 A/B 选项和禁用的“提交”按钮；
3. 仅选择 A 并提交，生成计划元数据 `approved: ["A"]`、`manual: ["B"]`；
4. A 已写入，B 不存在；agent 不执行 B；
5. turn 结束后 `/approvals grants` 报告没有活动 grant（按 turn 范围撤销是设计使然）。

**P0 结果（自动运行，最终构建）：** 计划 `P-6451e5af` 仅选择 A 后获批；A 已写入，B 不存在。审计通过计划项的 `targetHash` 将 A 匹配到计划项 A，并在计划表中显示一次，状态为 `无法验证`（没有 `approval/asked` 事件）；其他普通调用保持 `未归属`。计划元数据只存储目标 hash，不存储路径/命令。

同时自动验证了：

- 高风险的 `danger-full-access` 写入产生了官方审批卡片，标题改写为 `write · …\p0-approval-test.md · danger-full-access`；拒绝后文件不存在，审计记录了一行已验证的拒绝记录，并关联到计划 `P-536e4a5d`；
- 计划卡片上的 `要求修改` 返回 `cancelled`，未创建文件，审计显示计划 `P-73b32c5a` 已取消；
- 调用 `request_approvals` 的 subagent 收到 `request_approvals requires the main session; include the plan in your final result instead`（`DELEGATED_CALLER`）。

目前只剩同级 `approval/request` 的前置顺序尚未在 live 中测试（需要同一 profile 中有第二个审批插件）。FakeContext 测试套件现在断言：插件的前置监听器会在更早的同级监听器之前改写 `displayReason`。

## 8. Sprint 2 客户端部分

新增了 `client.js`、`dsh.client` 元数据和 header slot 注册。在隔离 Web UI 中，会话头部会显示本地化的“审批详情”按钮并带一个红点；打开后会显示只读弹窗，包含待处理的工具、callId、Host 改写后的摘要（`write · …\p0-a.md · danger-full-access`）、原始 reason 和关闭操作。待审批期间，文档标题会加上前缀 `● `。弹窗没有允许/拒绝控件。Host 现在还提供了一个 best-effort 的 Windows 闪烁辅助模块（`src/notify/flash.ts`）；单元测试覆盖脚本生成和 no-spawn 路径，但实际的 `FlashWindowEx` 效果尚未 live 验证，因为当前 desktop 会话没有重启。可通过 `flashWindow: false` 关闭。尚未实现：active 下默认放行 medium 的策略，以及 live 的 desktop 重启验证。

之前在 desktop 会话中对 `p0-test/a.md` 的写入是一次**手动/对话式**写入，不是插件 grant；不能作为 P0 证据。

## 7. Desktop 安装（已执行）

用户明确批准了经审查的 desktop 安装。通过 `plugin_manager` → `install_bundle` 执行，target 为 `link:D:\AIworkspace\dsh-approval-ledger`。

| 项目 | 值 |
|---|---|
| 目标 profile | `C:\Users\36288\.dsh\profiles\desktop` |
| 安装规格 | `link:D:\AIworkspace\dsh-approval-ledger` |
| 包/版本 | `dsh-approval-ledger@0.1.0-beta.1`（本地构建） |
| 依赖 / peer 依赖 | 包内无 |
| 安装生命周期脚本 | 无 |
| 网络 | 无（本地 link；没有新增 registry 包） |
| 默认值 | `mode: observe`、`allowHighRiskGrants: false`、`requireSecondConfirmForHigh: true`；无自动批准 |

结果：
- `profiles\desktop\package.json` 现在包含该依赖，且 `dsh.profile.bundles` 中有 `dsh-approval-ledger`；
- `node_modules\dsh-approval-ledger` 是指向工作区的 junction；
- `cordis.patch.yml` 未变；`cordis.yml` 重新组合后包含 `- id: approval-ledger / name: dsh-approval-ledger`；
- 当前会话的工具 schema 现在暴露 `request_approvals`；
- `pnpm peers check` 报告 `dsh-context` 和 `dsh-cost-meter` 已有的缺失 peer；本包不声明 peer/依赖，也不会新增这些警告。

备份（仅工作区）：`.p0-backup\desktop-preinstall\`，包含 `package.json`、`pnpm-lock.yaml`、`cordis.patch.yml`、`cordis.yml`。

回滚：
1. `plugin_manager` → `remove_bundle`，target 为 `dsh-approval-ledger`；验证 manifest/node_modules。
2. 如果移除失败，恢复四个备份文件并重启 DSH。
3. 该插件除 session 日志外不存储持久数据。

来自隔离 profile 的 live P0 证据包括：计划卡片、逐项选择、A 执行/B 不执行、改写 `displayReason` 的高风险审批卡片、拒绝时 fail-closed、计划取消、subagent `DELEGATED_CALLER` 以及审计归属。唯一未测试项是同级前置顺序。
