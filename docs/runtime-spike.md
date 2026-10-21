> Language: [English](runtime-spike.en.md) · [中文](runtime-spike.md)

# 运行时探针（runtime spike）— DSH 0.2.1-rc.2（静态、只读）

> Sprint 1 集成前的事实。下文的每个路径都相对于已安装的检出目录
> `D:\software\DS-harness\resources\app.asar\`（这是一个 asar 归档，而不是目录），除非它以 `docs/` 或 `src/` 开头。
> 没有运行任何应用；没有在本仓库之外写入任何文件。
>
> **读取方式：** shell 命令和 `rg` 无法打开 asar，但 Host 侧的文件读取器可以，
> 因此 `package.json`/`lib/*.js`/README 都是通过 host reader 读取的，类型形状（type
> shape）则与在线的 Cordis Inspect provider（`Service`、`Event`、`Tool`、`Config`）
> 交叉核对过。行号对上面列出的 asar 构建是精确的。
>
> **版本注意事项：** 已安装的构建是 `@deepseek-ai/dsh-desktop-runtime` **0.2.1-rc.2**
> （`dsh/package.json:4`），而本仓库的目标也是 `0.2.1-rc.2`。请把这一切都按
> “0.2.1-rc.2”来对待，然后在目标发布版本上重新核验。

---

## 发现（Findings）

### 1. 插件入口：模块形态、`ctx`、服务 — 已验证

Host 插件是一个带具名导出（named exports）的普通 ESM 模块。树内（in-tree）的可用示例：

- `dsh/node_modules/@deepseek-ai/dsh-tool-todo/lib/index.js:11-12,20,78,95,196`
  （`name`、`inject`、`Config`、`function apply(ctx, config)`、`ctx.tools.register(...)`、exports）
- `dsh/node_modules/@deepseek-ai/dsh-user-approval/lib/index.js:72-90`
  （Service 子类、`static Config = z.object({...})`、`ctx.inject([...], scope => ...)`）

```js
const name = 'tool-todo'
const inject = ['tools', 'sessionProjections']
const Config = z.object({ allowParallelInProgress: z.boolean().required() })
function apply(ctx, config) { ... }
export { Config, apply, inject, name }
```

与 Sprint 1 相关、可用的 Host 服务（Inspect `Service` 目录，0.2.1-rc.2）：
`approval`、`userQuestions`、`tools`、`commands`、`sessionProjections`、`storageDomain`、
`storage`、`agents`、`sessions`（在 `inject` 中声明时通过 `ctx.<key>` 访问该 agent 作用域的实例，可选时用 `ctx.get('<key>')`）。`ctx.uiSession` 是**仅客户端（client-only）**
（`dsh-client-ui-approval/lib/client.js:275-281` 在 Client 上注入它）；Host 半边（Host half）无法
使用它。

**不要在运行时 require `@deepseek-ai/*`。** 该 profile 上已安装的第三方插件明确记录了这个原因：profile 加载器会提供这些名字，但每多一个值导入（value import）就是插件多一种加载失败的方式
（`C:\Users\36288\.dsh\profiles\desktop\node_modules\dsh-ops\lib\config.js:1-9`，以及
`.../dsh-ops/lib/shells.js:862-871` 注册了一个“普通对象 —— 没有 `@deepseek-ai/*` 值导入”）。因此 Sprint 1 可以做到**零运行时依赖**：注册一个普通的工具定义对象、一个普通的命令对象，并且不导出任何 Schemastery `Config`。

`Config` 的注意事项：一个什么都不导出的插件，其原始的“行配置（row config）”会直接传给 `apply`
（dsh-ops 依赖这一点并自行校验）。在我们加上 schema 之前，Loader 的配置 UI 不会知道我们的
字段。

### 2. Config schema 与读取 — 已验证

- 类式插件：`static Config = z.object({ policy: z.union(['ask','never']).default('ask') })`
  （`dsh-user-approval/lib/index.js:74`），按 `this.config.policy` 读取（`:152-154`）。
- 函数式插件：导出 `Config` + `apply(ctx, config)`；`config.allowParallelInProgress`
  （`dsh-tool-todo/lib/index.js:20,79`）。
- Schemastery 就是 `@deepseek-ai/schemastery`（`dsh-tool-todo/lib/index.js:1`）；zod 用于
  会话投影/领域（projections/domains），而不是用于插件 Config。
- 注意：Loader 会依据 `Config` 做校验，并把解析后的值传进来。如果我们不导出
  `Config`，校验就由我们自己负责。

### 3. `approval/request` — waterfall、prepend、结果 — 已验证

签名（Inspect `Event`，0.2.1-rc.2）：

```ts
'approval/request'(
  this: Scoped<Agent>,
  req: ApprovalRequestEvent,
  next: () => Promise<ApprovalOutcome>,
): Promise<ApprovalOutcome>
```

- 分发（dispatch）：`dsh-user-approval/lib/index.js:176` —
  `this.ctx.waterfall(scopeTarget(req.agent, req.agent), 'approval/request', req, () => Promise.resolve('unavailable'))`。
  没有任何应答者时的自然下穿（fall-through）结果是 `unavailable`（fail closed，失败即关闭）。
- `next()` 语义：`cordis/lib/index.js:317-324` — `next` 会切换到下一个监听器；某个监听器若不调用
  `next` 就返回，即视为认领（claim）了该请求。各监听器共享同一个参数数组/对象，因此原地
  （in-place）修改对下游可见。
- `{ prepend: true }`：`cordis/lib/index.js:371-375`（`on(name, listener, options)`，布尔值是
  `prepend` 的简写）。
- 允许的返回值：恰好是 `'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'`
  （`dsh-user-approval/lib/index.js:30-35`）。非法（rogue）的返回值会被归一化为 `'unavailable'`
  （`:176`）；抛异常的监听器会被收敛（contain）为 `'unavailable'`。
- `never` 策略会在 waterfall **之前**就拒绝（`:175`），因此前置（prepended）监听器无法
  绕过它。
- **请求对象没有被冻结（frozen）。** 它是一个新构建的对象字面量
  （`dsh-tools/lib/index.js:3551-3558`）；该流水线中唯一的 `Object.freeze` 冻结的是
  `ToolExecution` 视图（`dsh-tools/lib/index.js:3506`）。类型字段是 `readonly`
  （`dsh-tool-cordis/lib/types/api-catalog.js` 中的 `ApprovalRequestEvent`），所以运行时改写
  需要做类型转换（cast）。
- **`displayReason` 可以在前置监听器中被改写。** 流程：
  1. `dsh-tools` 构建 `{ agent, toolName, callId, reason?, displayReason?, signal }`
     （`:3551-3558`）。
  2. 审批服务把同一个对象传给 waterfall（`dsh-user-approval/lib/index.js:176`）。
  3. Remote 转发器保存该引用，并将其推送去做 JSON 序列化
     （`dsh-api-remotes/lib/index.js:165-175`、`:233-250`）。
  4. 客户端把 `request.displayReason` 复制进它的待处理交互（pending interaction）
     （`dsh-client-ui-approval/lib/client.js:287-293`），并渲染
     `displayReason ?? reason`（`:38-47`）。
  因此，一个 `{prepend:true}` 监听器若在 `next()` **之前**替换 `req.displayReason`，
  就会改变卡片显示的内容，而被记录的 `reason` 和 `approval/asked` 保持不变
  （ask 事件从不携带 `displayReason`，见 #4；`docs/runtime-notes.md:10` 已经
  为 0.2.0-rc.2 记录过 `{en, zh}` 这种形状）。置信度：修改/分发**已验证**；
  卡片上的实际像素需要在线 P0（live P0）。

### 4. `ctx.approval.request` 与自动审计 — 已验证

```ts
request(req: ApprovalRequest): Promise<ApprovalOutcome>
interface ApprovalRequest {
  readonly agent: Agent
  readonly toolName: string
  readonly callId?: ToolCallId
  readonly reason?: string
  readonly displayReason?: { readonly en: string; readonly [locale: string]: string }
  readonly signal?: AbortSignal
}
```

- 要求存在一个打开的 turn：`dsh-user-approval/lib/index.js:130` 会在追加任何内容之前抛错；
  `hasOpenTurn` 会在日志中向后扫描 `turn/start` / `turn/end`（`:49-56`）。
- 顺序是固定的（`:128-144`）：在 waterfall **之前**追加 `approval/asked`，然后
  在它**之后**无条件追加 `approval/decided`。
- 负载（payload）：
  - `approval/asked`：`{ id: ApprovalRequestId, toolName, callId?, reason? }`（`:132-137`）
  - `approval/decided`：`{ id, outcome }`（`:139-142`）
- **自动的 `allowed-once` 仍会追加这两个事件。** 一个前置监听器返回
  `'allowed-once'` 时永远不会到达应答者（answerer），但服务仍已写入 `asked`，并且会
  写入 `decided` —— 因此每种结果都保证有这一对审计事件，包括我们发放的授权。
- 该事件是一种*会话事件类型*（`approval/asked`、`approval/decided` 都在
  `KNOWN_SESSION_EVENT_TYPES` 中，`dsh-session/lib/types/known-event-types.js:24-26`），因此它是
  持久、可重放的；Sprint 1 不需要新增事件类型。

### 5. `ctx.userQuestions.ask` 与 plan-review — 已验证

```ts
ask(request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer>
interface AskUserQuestionRequest { questions: AskUserQuestionItem[]; agent?: Agent; signal?: AbortSignal; wait?: { callId: ToolCallId; timed?: boolean } }
interface AskUserQuestionItem { id: string; question: string; detail?: string; header?: string; options?: AskUserQuestionOption[]; multiSelect?: boolean; intent?: AskUserQuestionIntent }
interface AskUserQuestionIntent { kind: 'plan-review'; approve: string; callId?: ToolCallId }
interface AskUserQuestionOption { label: string; description?: string }
interface AskUserQuestionAnswer { answers: { id: string; selected: string[]; custom?: string }[] }
```

证据：服务方法 `dsh-user-questions/lib/index.js:668-691`；校验 `:673-678`；
item/option 的 schema `:26-47`；live-root 门控 `:531-535`。

- `intent` 校验（`:673-678`）：`approve` 必须指向**该问题自身**选项中的某一个，
  并且 `detail` 必须存在；否则抛出 `UserQuestionError` 的 `BAD_INTENT`。
- `agent` 若提供，必须是**确切的在线运行时根（live runtime root）**（`assertLiveRoot`，`:531-535`）。
  子代理（subagent）发起的调用会抛 `DELEGATED_CALLER`；无归属/无 agent 的调用没有人类应答者。
  因此 `request_approvals` 在子代理内部必须拒绝（fail closed）。
- `askTimed(request, callId, timeoutMs)`（`:613-651`）返回
  `AskUserQuestionAnswer | { pending: true; callId: ToolCallId }`（`:640-643`）；它要求一个
  live root，带定时的 `ask_user_question` 正是靠它让问题保持可回答。
- **`pending.dismiss()` 是 Client UI 的方法，不是 Host 服务 API。** 它属于
  客户端的待处理交互对象（`dsh-client-ui-user-questions/lib/client.js:413-422`）：
  - `dismissal === 'hide'`（卡片带 callId）→ 隐藏 composer 座位（composer seat），请求仍保持
    可回答，工具行可以重新打开它；
  - 否则（无 callId）→ 以 `ASK_CANCELLED` 拒绝该 waterfall。
  这与 `docs/runtime-notes.md:38-40` 一致。plan-review 页脚的 “Discuss” 按钮调用的正是它
  （`client.js:588`）。
- 随包发布的 `ask_user_question` 工具在其 schema 中**不**暴露 `detail` 或 `intent`
  （`dsh-tool-ask-user/lib/index.js:226-273`），因此 plan-review 必须由我们自己的
  `request_approvals` 工具直接调用该服务来产生。
- plan-review 卡片的要求（Client 侧，静态）：一个问题、`intent.kind === 'plan-review'`、
  `detail !== undefined`、`multiSelect !== true`、`options.length <= 2`，且存在一个 label
  等于 `intent.approve` 的选项（`dsh-client-ui-user-questions/lib/client.js:42-61`）。
- “查看全文（View full text）”：`ui-plan` 无条件注册 `conversation.plan-review.actions`
  （`dsh-client-ui-plan/lib/client.js:672-690`）；intent 上没有 `callId` 时会从 `review.plan`
  打开一个临时审阅文档，有 `callId` 则打开 `submitted-plan`（`:678-686`）。对
  `request_approvals` 不要设置 `intent.callId`。

### 6. 工具注册与 `tool/result.meta` — 已验证

- 注册一个定义对象：`ctx.tools.register(definition)` 返回一个释放函数（disposer）
  （`dsh-tool-todo/lib/index.js:95`；Inspect `Service.tools`）。同一层内的重复注册以及保留名
  `run_code` 都会抛错；一个带 `name/description/parameters/output/execute` 的普通对象
  即可被接受（无需导入 helper —— `defineTool` 只是包装 `output.render` /
  `presentationMeta`，`dsh-tools/lib/index.js:841-863`）。
- 定义形状（Inspect `Tool` / `Service.tools` 引用的类型）：

```ts
interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>   // 原始 JSON Schema；只有 defineTool() 才用作者 DSL
  output: {
    schema: JsonSchemaNode
    render(args: unknown, value: JsonValue): ContentBlock[]
    presentationMeta?(args: unknown, value: JsonValue): JsonValue
  }
  execute(args: unknown, exec: ToolRunContext): Promise<JsonValue>
  isConcurrencySafe?(args: unknown): boolean
  presentCall?(args: unknown): ToolCallView | undefined
  presentResult?(args: unknown, result: ToolResult): ToolResultView | undefined
  timeoutMs?: number
}
```

- `meta` 只由 `output.presentationMeta` 产生（`dsh-tools/lib/index.js:3648-3658`），
  并被深冻结（deep-frozen）、与原对象脱离（detached）（只允许无损 JSON，`:3636-3666`、
  `:3687-3705`）。
- agent loop 会原样（verbatim）持久化它：
  `session.append('tool/result', { turn, step, message, error?, meta? })`
  （`dsh-agent-loop/lib/index.js:697-703`）。它**不是**模型可见的工具内容的一部分。
- 作者 DSL（仅 `defineTool()` 路径）就是 `dsh-tool-todo/lib/index.js:98-119` 中的那一套：`type`、
  `required: true`、`properties`、`items`、`enum`、`description`；对象项使用 `additionalProperties: false`。
- 工具会收到 `exec.callId`、`exec.agent`、`exec.signal`、`exec.arguments`
  （`dsh-tool-ask-user/lib/index.js:180-199`）。`exec` 上没有 `turn`；见 #9。
- `output.schema` 必须是受支持的原始 JSON Schema 子集（`assertSupportedJsonSchema`，
  `dsh-tools/lib/index.js:2977-2978`）。`parameters` 分两条路：`ctx.tools.register()` 直接接收
  **原始 JSON Schema**，原样作为模型可见的 schema、不做参数校验（`dsh-tools/lib/types/index.js:468-488,674-685`；
  `docs/install-review-p0.md:111`）；只有 `defineTool()` 才把作者 DSL（`required: true` 那一套）编译成 JSON Schema。

### 7. `ctx.storageDomain` — 已验证，但**不是账本（ledger）**

确切接口面（surface）（Inspect `Service.storageDomain`；`dsh-storage-domain/lib/index.js:46-76`，
README `:36-58`）：

```ts
async open<S extends DomainSpec>(spec: S): Promise<Domain<S>>
get(name: string): DomainImpl | undefined
closeAll(): Promise<void>

interface Domain<S> {
  readonly name: string
  readonly global: DomainGlobalHandleOf<S>
  table<N>(name: N): KvTable<TableKeyOf<S,N>, TableValueOf<S,N>>
  close(): Promise<void>
}
interface KvTable<K, V> {
  get(key: K): V | undefined
  entries(): IterableIterator<[K, V]>
  keys(): IterableIterator<K>
  readonly size: number
  put(key: K, value: V): Promise<void>
  delete(key: K): Promise<boolean>
  update(key: K, fn: (current: V) => V): Promise<V>
}
interface DomainSpec {
  name: string; version: number; layout?: 'single' | 'per-record'
  compatibleVersions?: number[]; invalidRecords?: 'backup-and-skip'
  global?: { schema: ZodType; initial: unknown }
  tables: Record<string, { valueSchema: ZodType }>
}
```

- **它是一个经 schema 校验的 KV 存储，不是追加写（append-only）日志，也不按会话分区（partition）。**
  `put` 覆盖一条记录；`delete` 删除记录；没有 `append`/`read`；迭代是对单张表调用
  `entries()`。读取是从内存同步完成的；写入在一个每域（per-domain）的链上串行化，并在
  resolve 之前就已持久（README `:88-90`）。
- 会话隔离必须靠**键约定（key convention）**来实现，例如在一张表中使用键
  `` `${sessionId}:${seq.padStart(12,'0')}:${callId}` ``，因为键是任意字符串，没有按会话
  划分的表。每个域名只允许打开一次（`already-open`）是被强制执行的，因此每个 Host 插件只打开
  一次，并通过 `ctx.effect` 关闭。
- 记录需要 Zod schema（`valueSchema: ZodType`；README `:36`）。`zod` 可以从
  该 profile 解析（`C:\Users\36288\.dsh\profiles\desktop\node_modules\zod`），但这会成为我们的
  第一个运行时依赖，也是一个加载风险（见 #1）。该 profile 已经挂载了
  `storage-json`（`root: <DSH_HOME>/storages`）以及 `storage-domain`（`backend: json`）
  （`C:\Users\36288\.dsh\profiles\desktop\cordis.yml:111-118`），所以 `ctx.storageDomain` 是可用的。
- **建议：** 把现有的 `SessionAuditStore` 接口
  （`src/audit/store.ts:15-21`）保留为账本边界，并在 Sprint 1 使用 `MemoryAuditStore`
  （`src/audit/store.ts:23-50`）。一个 `storageDomain` 适配器可以通过为每条记录写入一个新的
  `${sessionId}:${seq}` 键（按约定而非按原语实现 append-only）并按键前缀扫描，来提供同样的
  append/list 语义；在 `zod` 打包问题定下来之前先推迟它。会话日志已经
  包含 `approval/asked` + `approval/decided` + `tool/call` + `tool/result.meta`；一个
  `/approvals audit` 处理器可以同步地折叠（fold）`agent.session.snapshotEvents()`，这既
  持久、可重放、无依赖，也不会与那对审计事件产生漂移（drift）。

### 8. 命令注册 — 已验证

`dsh-commands/lib/index.js` / README `:30-66`；Inspect `Service.commands`：

```ts
ctx.commands.register({
  name: 'approvals',                 // 小写；同一层内重复会抛错
  description: 'Inspect approval grants and decisions',
  input: { hint: '[audit [--json] | grants]' },
  handler: ({ agent, rawInput, attachments, signal, commandId }) =>
    ({ kind: 'success', text }) | { kind: 'error', text },
})
```

- 处理器直接在 agent 上运行；它的文本只是 UI 文本，**不是**模型消息
  （README `:117-125`）。`recordInput` 默认为 true；`command/run` 和 `command/done` 都会
  作为独立的、仅入日志（log-only）的事件被追加（`dsh-commands/lib/index.js:334-346`），因此每次
  `/approvals` 调用本身都是可审计的。
- 同一作用域内重复注册会抛错（README `:46`）；全局层与 agent 作用域层按名称相互
  遮蔽（shadow）。请从 Host 插件根以全局方式注册。
- 该 profile 中已有的命令名：`plan`、`permission`、`goal`、`feedback`、`compact`、
  `export`。**没有 `approvals`**（对全部随包发布的 `lib/index.js` 命令注册、
  以及该 profile 已安装的插件做了 grep）。`/approvals` 是空闲的。

### 9. 会话 / turn 相关事实 — 已验证

会话事件负载（`dsh-tool-cordis/lib/types/api-catalog.js`，`SessionEventMap`）：

```ts
'turn/start': { turn: number }
'turn/end':   { turn: number; reason: TurnEndReason }
'tool/call':  { turn: number; step: number; callId: ToolCallId; name: string; arguments: string }
'tool/result':{ turn: number; step: number; message: ToolResultMessage; error?: {name;code;reason?}; meta?: JsonValue }
'user/message': UserMessage
```

- `session/disposed(session: Session)` 是一个 Host 事件（Inspect `Event`），在某个已公告
  （announced）的会话离开存储时发出一次。
- `session/event(session, event)` 是提交后（post-commit）的追加流（Inspect `Event`），是做
  内存折叠的合适钩子。使用 `{ global: true }` 可观察所有 agent。
- **`user-question-reply` 不是事件类型。** 它是一个消息来源（message source）：
  `'user-question-reply': { kind: 'user-question-reply'; callId: ToolCallId; outcome: 'answered' }`
  （`dsh-llm/lib/typert.host.js`，`MessageSourceMap` 声明）。它以 `user/message` 的形式
  到达，其 `source.kind` 为 `user-question-reply`（`dsh-user-questions/lib/index.js:255-263`）。
- 当前会话 id：`req.agent.id` / `exec.agent.id` / `agent.session.id`。
- 当前 turn：`Agent`/`Session` 上没有任何访问器（accessor）。可以像
  审批服务那样折叠最后一个 `turn/start`（`dsh-user-approval/lib/index.js:49-56`），或者从
  `session/event` 流中缓存 `turn`。`exec` 携带的是 `callId`，不是 `turn`。
- `tool/result.meta` 是工具唯一能留下结构化、非模型可见、持久的决策数据的地方。
  这就是我们的计划级审计通道。

### 10. 名称与冲突清单 — 已验证

- `request_approvals`、`ask_choices`、`approvals`：不在在线工具列表中（Inspect
  `Tool.listTools`，即当前所有可调用工具），不在任何随包发布的 `lib/**/*.js` 中，也不在
  该 profile 已安装的插件（`dsh-ops`、`dsh-cost-meter`、`dsh-context`）中。
- `ask_user_question` 已被占用（随包发布的工具）；`run_code` 被注册表保留。
- `dsh-experimental-auto-review` 存在于 asar 中，但**未挂载**到该 profile
  （在 `cordis.yml` / `Config.listConfigs` 中不存在），所以目前没有前置冲突。如果用户
  启用了它，它和我们都会前置（prepend）`tools/pre-execute` / `approval/request`；记录下
  `audit-only` + `notifications:false`，并检测同级（sibling）授权。

### 11. Sprint 1 的打包约束 — 已验证

- 通过 profile 安装的插件位于
  `C:\Users\36288\.dsh\profiles\desktop\node_modules\<pkg>`；那里**没有**
  `node_modules/@deepseek-ai`。`zod` 存在（作为传递依赖）。
- 一个可正常工作的已安装插件明确避免对 `@deepseek-ai/*` 的值导入，“因为每多一个，
  就多一种插件加载失败的方式”
  （`dsh-ops/lib/config.js:5-9`）。另一个已安装插件确实导入了
  `@deepseek-ai/dsh-credentials` / `dsh-home-paths`（`dsh-cost-meter/lib/*.js`），所以解析
  是存在的，但带有加载风险。
- `tsconfig.json` 中有 `rootDir: "src"` 和 `include: ["src/**/*.ts"]`；顶层的 `types/`
  目录**不会**被编译。把本地声明放在 `src/types/dsh-runtime.ts`（仍匹配
  `src/**/*.ts`），这样无需改动 tsconfig。

---

## 本地最小类型接口面（type surface）

创建 `src/types/dsh-runtime.ts`（由现有 tsconfig 包含）。不要导入 `@deepseek-ai/*`；
这就是真实运行时已经满足的结构化契约（structural contract）。

```ts
// src/types/dsh-runtime.ts — 仅限 Sprint 1。与 docs/runtime-spike.md 保持同步。
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }
export type JsonSchemaNode = {
  type?: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null'
  oneOf?: JsonSchemaNode[]
  properties?: Record<string, JsonSchemaNode>
  required?: string[]
  additionalProperties?: boolean
  items?: JsonSchemaNode
  enum?: (string | number | boolean | null)[]
  const?: string | number | boolean | null
  description?: string
  title?: string
  default?: JsonValue
}
export type TextBlock = { type: 'text'; text: string }
export type ContentBlock = TextBlock | { type: 'image'; [key: string]: unknown } | { type: 'file'; [key: string]: unknown }

export interface Session {
  readonly id: string
  readonly seq: number
  eventAt(seq: number): SessionEvent | undefined
  snapshotEvents(fromSeq?: number, toSeqExclusive?: number): readonly SessionEvent[]
}
export interface SessionEvent<T = unknown> { readonly type: string; readonly seq: number; readonly time: number; readonly data: T }
export interface Agent { readonly id: string; readonly session: Session }

export type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'
export interface ApprovalRequestEvent {
  readonly agent: Agent
  readonly toolName: string
  readonly callId?: string
  readonly reason?: string
  readonly displayReason?: { readonly en: string; readonly [locale: string]: string }
  readonly signal?: AbortSignal
}
export type ApprovalListener = (
  req: ApprovalRequestEvent,
  next: () => Promise<ApprovalOutcome>,
) => Promise<ApprovalOutcome>

export interface AskUserQuestionOption { label: string; description?: string }
export interface AskUserQuestionIntent { kind: 'plan-review'; approve: string; callId?: string }
export interface AskUserQuestionItem {
  id: string
  question: string
  detail?: string
  header?: string
  options?: AskUserQuestionOption[]
  multiSelect?: boolean
  intent?: AskUserQuestionIntent
}
export interface AskUserQuestionRequest {
  questions: AskUserQuestionItem[]
  agent?: Agent
  signal?: AbortSignal
  wait?: { callId: string; timed?: boolean }
}
export interface AskUserQuestionAnswer {
  answers: { id: string; selected: string[]; custom?: string }[]
}

export interface ToolRunContext {
  readonly callId: string
  readonly name: string
  readonly arguments: unknown
  readonly agent?: Agent
  readonly signal: AbortSignal
}
export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
  output: {
    schema: JsonSchemaNode
    render(args: unknown, value: JsonValue): ContentBlock[]
    presentationMeta?(args: unknown, value: JsonValue): JsonValue
  }
  execute(args: any, exec: ToolRunContext): Promise<JsonValue>
  isConcurrencySafe?(args: unknown): boolean
}

export interface CommandInvocation {
  readonly commandId: string
  readonly agent: Agent
  readonly rawInput: string
  readonly attachments: readonly ContentBlock[]
  readonly signal: AbortSignal
}
export type CommandResult = { kind: 'success'; text?: string } | { kind: 'error'; text: string }
export interface CommandDefinition {
  name: string
  description: string
  input?: { hint: string; attachments?: boolean }
  recordInput?: boolean
  handler(invocation: CommandInvocation): CommandResult | Promise<CommandResult>
}

export interface Context {
  readonly tools: { register(definition: ToolDefinition): () => void; get(name: string): ToolDefinition | undefined }
  readonly userQuestions: { ask(request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer> }
  readonly commands: { register(definition: CommandDefinition): () => void }
  get(name: string): unknown
  on(name: string, listener: (...args: any[]) => any, options?: { prepend?: boolean; global?: boolean }): () => void
  inject(names: readonly string[], fn: (ctx: Context) => void): void
  effect(fn: () => void | (() => void), label?: string): () => void
  readonly logger: { warn(message: string): void; info(message: string): void }
}
```

让 `apply` 用这些类型来注入/标注（decorate），绝不要用真实的 DSH 类型：

```ts
import type { Context } from './types/dsh.js'
export function apply(ctx: Context, rawConfig: unknown): void { ... }
```

---

## 集成草图（integration sketch）

本草图所绑定的现有树内 helper：`buildApprovalDisplayReason`
（`src/approval/summary.ts:174-186`）、`buildPlanReviewRequest`（`src/plan/review.ts:57`）、
`SessionAuditStore` / `MemoryAuditStore`（`src/audit/store.ts:15-50`），以及 Sprint 0
的 plan/risk/grants 模块。

### 12. 挂钩 `approval/request`（Sprint 1 只观察，0.2 再发放授权）

```ts
// src/index.ts（Host 半边）
export const name = 'approval-ledger'
export const inject = ['tools', 'userQuestions', 'commands'] as const
// 不导出 Config：原始行配置在 readConfig() 中校验（沿用 dsh-ops 的先例）

export function apply(ctx: Context, rawConfig: unknown): void {
  const config = readConfig(rawConfig)
  const ledger = new SessionLedger()          // 纯内存折叠（fold）；无依赖

  ctx.on('session/event', (session, event) => ledger.observe(session, event), { global: true })
  ctx.on('session/disposed', (session) => ledger.forget(session))

  ctx.on('approval/request', async (req, next) => {
    try {
      if (!config.observeOnly) {
        const grant = matchGrant(ledger, req)      // 计划门控 + 风险门控（design.md 中的 #3）
        if (grant !== undefined) return 'allowed-once'
      }
      rewriteDisplayReason(req)                    // 仅摘要；绝不隐藏卡片
    } catch (error) {
      ctx.logger.warn(`approval-ledger: ${String(error)}`)   // 失败即放行（fail open）-> 走官方卡片
    }
    return next()
  }, { prepend: true })
}
```

由这些事实得出的规则：

- `req` 只在 `next()` 之前可变；把 `displayReason` 的改写放在那里，绝不要放在之后。
- **只有**在经过完整校验的授权下才返回 `allowed-once`；任何抛错 → `next()`。
- `allowed-once` 仍会产生 `approval/asked` + `approval/decided`；不要自己去追加它们。
- 对已经中止（aborted）的 `req.signal` 要予以尊重、自然下穿（fall through）（服务会把它映射为
  `cancelled`）。
- `displayReason` 改写（需要类型转换）：

```ts
import { buildApprovalDisplayReason } from './approval/summary.js'
type Mutable<T> = { -readonly [K in keyof T]: T[K] }
function rewriteDisplayReason(req: ApprovalRequestEvent): void {
  if (req.displayReason === undefined) return
  ;(req as Mutable<ApprovalRequestEvent>).displayReason = buildApprovalDisplayReason({
    tool: req.toolName,
    mode: /^escalate sandbox to (\S+):/.exec(req.reason ?? '')?.[1],
  })
}
```

### 13. 注册 `request_approvals`

```ts
type PlanResult = {
  planId: string
  decision: 'approved' | 'cancelled'
  items: { id: string; tool: string; risk: string; grantId?: string }[]
}

ctx.tools.register({
  name: 'request_approvals',
  description: 'Ask the user to approve a declared batch of upcoming tool actions …',
  parameters: { /* summary、items[]，如 HANDOFF §3.1 所述 */ },
  output: {
    schema: { type: 'object', additionalProperties: false, properties: { /* planId, decision, items */ } },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    // 计划级审计；以 tool/result.meta 持久化，绝不进入模型内容
    presentationMeta: (_args, value) => {
      const result = value as unknown as PlanResult
      return {
        schemaVersion: 1,
        matcherVersion: MATCHER_VERSION,
        riskPolicyVersion: RISK_POLICY_VERSION,
        planId: result.planId,
        decision: result.decision,
        items: result.items.map((item) => ({
          id: item.id, tool: item.tool, risk: item.risk, grantId: item.grantId,
        })),
      }
    },
  },
  // 省略 isConcurrencySafe => 独占（exclusive），这正是交互式询问所需要的
  async execute(args, exec) {
    if (exec.agent === undefined) throw new Error('request_approvals requires an owning agent session')
    if (!isRuntimeRoot(exec)) throw new Error('request_approvals is unavailable in a subagent; include the plan in your final result')
    const plan = validatePlan(args)                    // 现有的 Sprint 0 校验器
    const review = buildPlanReviewRequest(plan)        // 形状由 src/plan/review.ts 构造（不设 intent.callId）
    const answer = await ctx.userQuestions.ask({ ...review, agent: exec.agent, signal: exec.signal })
    const approveLabel = review.questions[0]!.intent.approve
    const approved = answer.answers[0]?.selected.includes(approveLabel) === true
    if (!approved) return { planId: plan.id, decision: 'cancelled', items: [] }
    const grants = grantStore.install(exec.agent, plan)  // 内存内、按会话作用域
    return { planId: plan.id, decision: 'approved', items: plan.items.map(/* … */) }
  },
})
```

说明：

- `ask` 是阻塞路径；点击 “Discuss” 会以 `ASK_CANCELLED` 拒绝（无 callId）。把每一种拒绝都
  当作 `decision: 'cancelled'`，并不安装任何授权。这就是 fail-closed 路径。
- `ask` 在子代理中会抛 `DELEGATED_CALLER`；上面的检查会把它变成一个正常的工具
  错误，而不是一次丢失的审批。
- plan-review 卡片要求 `detail` 和 `approve` 完全如上所述；否则 `ask` 会抛
  `BAD_INTENT`。Client 还要求选项不超过 2 个且 `multiSelect !== true`
  （`dsh-client-ui-user-questions/lib/client.js:42-61`）—— 在调用前先校验，这样打错字的
  计划绝不会悄悄降级成一张通用问题卡片。
- `output.presentationMeta` 只能返回无损 JSON；注册表会对它做快照并冻结。

### 14. `/approvals` 命令

```ts
ctx.commands.register({
  name: 'approvals',
  description: 'Inspect approval decisions and active grants for this session',
  input: { hint: '[audit [--json] | grants]' },
  handler: ({ agent, rawInput }) => {
    const audit = buildAudit(agent.session.snapshotEvents(), grantStore.for(agent))
    if (rawInput.trim() === 'audit --json') return { kind: 'success', text: JSON.stringify(audit) }
    return { kind: 'success', text: renderAudit(audit) }
  },
})
```

- 命令文本永远不会是模型消息，而 `command/run` + `command/done` 已经记录了
  这次调用。不产生会话事件，也不消耗模型 token。
- 读取 `agent.session.snapshotEvents()`；过滤出 `approval/asked`、`approval/decided`、
  `tool/call`、`tool/result`（meta）并按 `turn` 分组。连接（join）缺失 → 标为 `unattributed`，绝不要猜。
- 不要注册 `conversation.approval.detail`（这是 `dsh-client-ui-chat` 独占的单槽位
  （single slot），`dsh-client-ui-chat/lib/client.js:13329`；槽位类型（slot kind）为 `single`，
  见 `dsh-cordis-client-runner/lib/client.js:2436-2437`）。

### 15. Sprint 1 中账本所在的位置

| 层 | 机制 | 依赖 |
|---|---|---|
| 事实（Facts） | 会话事件（`approval/asked`、`approval/decided`、`tool/call`、`tool/result`） | 无 |
| 计划决策（Plan decision） | 通过 `presentationMeta` 写入 `tool/result.meta` | 无 |
| 派生视图（Derived view） | 对 `session/event` 的内存折叠 + 命令执行时的 `snapshotEvents()` | 无 |
| 跨会话保留（Cross-session retention） | `ctx.storageDomain` KV（键约定），**不是 append-only** | `zod`（推迟） |

在打包问题定下来之前，不要调用 `storageDomain`；对于 0.1 来说，会话日志已经满足
“可审计、可重放”的要求。

### 16. 后续：`ctx.storage` 枢纽（hub）（不是 `storageDomain`）

```ts
interface Storage {
  readonly backend: BackendRegistry           // register(name, backend) / get(name) / names()
  mount(form, facility): () => void           // duplicate-mount 会抛错
  form(form): facility                        // 抛错 form-not-mounted
  readonly domain: DomainFacility             // getter -> form('domain')
}
```

证据：`dsh-storage/lib/index.js:104-137`；Inspect `Service.storage`（`BackendRegistry`、
`StorageBackend { kv?: KvFacet }`、`KvFacet.open(descriptor): Promise<KvUnit>`、
`KvUnit { loadAll, putRecord, deleteRecord, setGlobal, close }`）。`StorageForms` 只被 domain
这一种 form 增强，因此在此构建中 `ctx.storage.form('kv')` 并不存在；唯一挂载的 form 是
`domain`，也可以通过 `ctx.storageDomain` 到达。

**它能在不用 zod 的情况下持久化一个按会话划分的 `callId → {planId,itemId,risk,target}` 映射吗？**
技术上可以，但只能下穿到领域层之下的后端 kv facet（backend kv facet）：

```ts
const backend = ctx.storage.backend.get('json')      // 未挂载则抛错；该 profile 已挂载它
const unit = await backend.kv!.open({
  name: 'approval_ledger', version: 1, tables: ['calls'], hasGlobal: false, layout: 'per-record',
})
await unit.putRecord('calls', `${sessionId}:${callId}`, value)   // unknown；无 schema 校验
const all = await unit.loadAll()                                 // { tables: { calls: {...} }, global }
```

注意事项：绕过了 domain 的路由/校验以及 `domain/changed`；storage-domain 的 README 说
使用方绝不应当直接触碰后端；`KvUnit` **不**会串行化并发写入（顺序由调用方负责）；存储的
版本不匹配会直接拒绝，没有迁移；每个值都必须是无损 JSON。结论：无依赖但违反分层 ——
对 0.1 而言优先用 `MemoryAuditStore` + 会话日志折叠；只有在 `zod` 问题定下来之前就必须
跨重启持久化时才用它。

### 17. 后续：审计折叠能否把调用与结果连接起来？

- `tool/call.arguments` **始终是字符串** —— 它是模型原始输出的文本，不是已解析的对象，
  且**不保证是合法 JSON**。`appendToolCall` 会原样传递 `block.arguments`
  （`dsh-agent-loop/lib/index.js:681-688`）；`ToolCallBlock.arguments: string`。要给
  `JSON.parse` 加防护，失败时把该记录标为 `unattributed`；绝不要在折叠中抛错。
- `tool/result.message` **两次**携带 call id：`message.toolCallId` 和
  `message.source.callId`（`ToolResultMessage` / `ToolMessageSource` 声明）。已有
  消费者读取 `event.data.message.toolCallId`（`dsh-user-questions/lib/index.js:217`），因此这个
  连接是直接且稳定的。
- `approval/asked` 没有 `turn`；要通过包围它的 `tool/call` 把它连接到某个 turn（匹配
  `toolName`，并且在存在时再匹配 `callId` —— `callId` 是可选的，非工具发起的 ask 没有它），或者从
  `turn/start` 折叠出 turn 状态。

### 18. 后续：是否存在用于插件私有元数据的持久通道？

**没有。** `SessionEventMap` 是封闭的，`KNOWN_SESSION_EVENT_TYPES` 枚举了它
（`dsh-session/lib/types/known-event-types.js:21-84`），而未知类型需要
`ignorable: true`，在线的 `append()` 无法设置该标志。

- `hook/invoked` / `hook/result` 是已知类型，但没有任何随包发布的包会追加它们（只有
  目录、会话格式迁移和客户端目录提到它们）—— 这不是一个被批准的扩展点。
- `deliverables/presented` 归 `dsh-tool-present` 所有（`{turn, callId, files}`，
  `dsh-tool-present/lib/types/index.js:96-98`）；`todo/write` 归 todo 工具所有。不要
  劫持其中任何一个。
- 因此，在我们自己 `request_approvals` 结果上的 `tool/result.meta` 是 Sprint 1 中唯一
  被批准的结构化通道。`command/done.text` 是持久的，但它是 `/approvals` 的 UI 文本，
  不是元数据；`approval/asked.reason` 必须保持为诚实的官方 reason。

---

## 未决问题 —— 需要一个在线 P0（live P0）

1. **改写后的卡片文案（copy）。** 在前置的 `approval/request`
   监听器里修改 `displayReason` 在静态上是成立的（#3），但只有真实的审批卡片才能证明客户端
   显示的是新的 `en`/`zh` 文本，并且后续没有监听器重新读取 `reason`。
2. **运行时的冻结。** 请求路径上不存在 `Object.freeze`，但仍要用一个在线
   监听器确认 `req.displayReason = …` 不会抛错（TypeScript 的 `readonly` 会被擦除）。
3. **计划模式之外的 plan-review。** 代码显示该卡片仅依赖 intent（`planReviewOf` 不检查
   任何 plan-mode 状态），且 `ui-plan` 无条件注册该 actions 槽位，而
   `plan-mode` 那一行当前是 `inactive`。确认由 `request_approvals` 发起的审阅
   会带着“查看全文”按钮和一份临时文档渲染出来。
4. **`ask` 的生命周期。** plan review 默认没有计时器。确认用户离开页面时的用户体验：
   工具调用是否会保持阻塞（这是预期行为），“Discuss” 是否会及时拒绝？
   如果想要超时，`askTimed` 会返回 `pending` —— 但一个待定（pending）的计划并不是一次审批，
   所以要明确决定。
5. **子代理调用。** 确认在 `subagent`/workflow 之下，`ctx.userQuestions.ask` 对
   `request_approvals` 会可靠地抛出 `DELEGATED_CALLER`，并且该工具错误是可据以行动的
   （actionable）。
6. **`tool/result.meta` 往返（round-trip）。** 确认 `approval`/会话重放在重启后仍保留 `meta`，
   并确认 Client 能从工具结果节点读到它（与 `argsRaw` 相同的 JSON 快照路径，
   `dsh-client-ui-trajectory/lib/client.js:2272`）。
7. **同级前置顺序。** 如果启用了 `dsh-experimental-auto-review` 或某个第三方审批插件，
   确认监听器顺序，并确认我们从自己这里返回 `allowed-once` 不会让它们的监听器
   得不到机会（waterfall 的认领是先返回者胜，`cordis/lib/index.js:317-324`）。
8. **加载时的命令冲突。** `commands.register` 在同一层遇到重复名称会抛错；
   确认 Loader 会把插件加载失败限制在内部（contain），而不是把 Host 拖垮。
9. **Windows 闪烁辅助（flash helper）**（Sprint 2）：PowerShell 常驻进程、EDR/ConstrainedLanguage
   失败、回退到标题/图标（title/favicon）。本次探针未触碰。
10. **版本锁定（version pin）。** 发布前在目标 `0.2.1-rc.2` 上重新核验所检查过的形状；
    本次检出就是 `0.2.1-rc.2`。

---

## 置信度汇总（来自 `HANDOFF.md` §5 的 P0 条目）

| # | 条目 | 状态 | 证据 |
|---|---|---|---|
| 1 | 前置监听器中改写 `displayReason` / 是否被冻结？ | **可能（likely）**（修改 + 分发已验证；卡片像素未验证） | §3 |
| 2 | 计划模式之外的 plan-review intent；“查看全文” | **静态已验证（verified static）**（渲染未验证） | §5，`ui-plan:672-686` |
| 3 | `conversation.approval.detail` 单槽位冲突 | **静态已验证（verified static）**（抛错文本未验证） | §14 |
| 4 | Client 的 `argsRaw` / 待处理审批 | **可能（likely）**（轨迹节点暴露 `argsRaw`；`uiSession` 待处理交互仅在 Client） | §1, §5 |
| 5 | `tool/result.meta` 持久化；`storageDomain` 账本 | **已验证（verified）**（meta 会持久化；storageDomain 是 KV，不是 append-only） | §6, §7 |
| 6 | 工具/命令名称冲突 | **静态已验证（verified static）** | §8, §10 |
| 7 | prepend + `next()`；`allowed-once` 审计对 | **已验证（verified）** | §3, §4 |
| 8 | Windows 闪烁辅助 | **未验证（unverified）**（Sprint 2） | — |
