# Runtime spike — DSH 0.2.1-rc.2 (static, read-only)

> Sprint 1 pre-integration facts. Every path below is relative to the installed checkout
> `D:\software\DS-harness\resources\app.asar\` (an asar archive, not a directory) unless it starts with `docs/` or `src/`.
> No app was run; no file outside this repo was written.
>
> **How this was read:** shell commands and `rg` cannot open an asar, but the Host-side file
> reader can, so `package.json`/`lib/*.js`/READMEs were read with the host reader and type
> shapes were cross-checked against the live Cordis Inspect providers (`Service`, `Event`,
> `Tool`, `Config`). Line numbers are exact for the asar build listed above.
>
> **Version caveat:** the installed build is `@deepseek-ai/dsh-desktop-runtime` **0.2.1-rc.2**
> (`dsh/package.json:4`), while the repo targets `0.2.0-rc.2`. Treat all of this as
> "0.2.1-rc.2", then re-check on the target release.

---

## Findings

### 1. Plugin entry: module shape, `ctx`, services — verified

A Host plugin is a plain ESM module with named exports. Working examples in-tree:

- `dsh/node_modules/@deepseek-ai/dsh-tool-todo/lib/index.js:11-12,20,78,95,196`
  (`name`, `inject`, `Config`, `function apply(ctx, config)`, `ctx.tools.register(...)`, exports)
- `dsh/node_modules/@deepseek-ai/dsh-user-approval/lib/index.js:72-90`
  (Service subclass, `static Config = z.object({...})`, `ctx.inject([...], scope => ...)`)

```js
const name = 'tool-todo'
const inject = ['tools', 'sessionProjections']
const Config = z.object({ allowParallelInProgress: z.boolean().required() })
function apply(ctx, config) { ... }
export { Config, apply, inject, name }
```

Available Host services relevant to Sprint 1 (Inspect `Service` catalog, 0.2.1-rc.2):
`approval`, `userQuestions`, `tools`, `commands`, `sessionProjections`, `storageDomain`,
`storage`, `agents`, `sessions` (agent-scoped access through `ctx.<key>` when
declared in `inject`, or `ctx.get('<key>')` when optional). `ctx.uiSession` is **client-only**
(`dsh-client-ui-approval/lib/client.js:275-281` injects it on the Client); a Host half cannot
use it.

**Do not require `@deepseek-ai/*` at runtime.** The installed third-party plugin on this
profile documents the reason explicitly: the profile loader supplies those names, but every
extra value import is another way for the plugin to fail to load
(`C:\Users\36288\.dsh\profiles\desktop\node_modules\dsh-ops\lib\config.js:1-9`, and
`.../dsh-ops/lib/shells.js:862-871` registers a "plain object — no `@deepseek-ai/*` value
import"). Sprint 1 can therefore be **zero-runtime-dependency**: register a plain tool
definition object, a plain command object, and export no Schemastery `Config`.

Caveat for `Config`: a plugin that exports none gets its raw row config passed to `apply`
(dsh-ops relies on this and validates itself). The Loader's config UI will not know our
fields until we add a schema.

### 2. Config schema and reading — verified

- Class plugin: `static Config = z.object({ policy: z.union(['ask','never']).default('ask') })`
  (`dsh-user-approval/lib/index.js:74`), read as `this.config.policy` (`:152-154`).
- Function plugin: exported `Config` + `apply(ctx, config)`; `config.allowParallelInProgress`
  (`dsh-tool-todo/lib/index.js:20,79`).
- Schemastery is `@deepseek-ai/schemastery` (`dsh-tool-todo/lib/index.js:1`); zod is used for
  session projections/domains, not for plugin Config.
- Note: the Loader validates against `Config` and passes the resolved value. If we export
  no `Config`, validation is ours.

### 3. `approval/request` — waterfall, prepend, outcomes — verified

Signature (Inspect `Event`, 0.2.1-rc.2):

```ts
'approval/request'(
  this: Scoped<Agent>,
  req: ApprovalRequestEvent,
  next: () => Promise<ApprovalOutcome>,
): Promise<ApprovalOutcome>
```

- Dispatch: `dsh-user-approval/lib/index.js:176` —
  `this.ctx.waterfall(scopeTarget(req.agent, req.agent), 'approval/request', req, () => Promise.resolve('unavailable'))`.
  Fall-through with no answerer is `unavailable` (fail closed).
- `next()` semantics: `cordis/lib/index.js:317-324` — `next` shifts the next listener; a listener
  that returns without calling `next` claims the request. Listeners share the same argument
  array/object, so in-place mutation is visible downstream.
- `{ prepend: true }`: `cordis/lib/index.js:371-375` (`on(name, listener, options)`, boolean is
  shorthand for `prepend`).
- Allowed returns: exactly `'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'`
  (`dsh-user-approval/lib/index.js:30-35`). A rogue return is normalized to `'unavailable'`
  (`:176`); a throwing listener is contained to `'unavailable'`.
- The `never` policy rejects **before** the waterfall (`:175`), so a prepended listener cannot
  bypass it.
- **The request object is not frozen.** It is a freshly built object literal
  (`dsh-tools/lib/index.js:3551-3558`); the only `Object.freeze` in that pipeline freezes the
  `ToolExecution` view (`dsh-tools/lib/index.js:3506`). The type fields are `readonly`
  (`ApprovalRequestEvent` in `dsh-tool-cordis/lib/types/api-catalog.js`), so a runtime rewrite
  needs a cast.
- **`displayReason` can be rewritten in a prepended listener.** Flow:
  1. `dsh-tools` builds `{ agent, toolName, callId, reason?, displayReason?, signal }`
     (`:3551-3558`).
  2. The approval service passes that same object to the waterfall (`dsh-user-approval/lib/index.js:176`).
  3. The Remote forwarder stores the reference and pushes it for JSON serialization
     (`dsh-api-remotes/lib/index.js:165-175`, `:233-250`).
  4. The client copies `request.displayReason` into its pending interaction
     (`dsh-client-ui-approval/lib/client.js:287-293`) and renders
     `displayReason ?? reason` (`:38-47`).
  Therefore a `{prepend:true}` listener that replaces `req.displayReason` **before** `next()`
  changes what the card shows, while the logged `reason` and `approval/asked` stay unchanged
  (the ask event never carries `displayReason`, see #4; `docs/runtime-notes.md:10` already
  records the `{en, zh}` shape for 0.2.0-rc.2). Confidence: mutation/dispatch **verified**;
  actual card pixels need the live P0.

### 4. `ctx.approval.request` and automatic audit — verified

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

- Requires an open turn: `dsh-user-approval/lib/index.js:130` throws before appending anything;
  `hasOpenTurn` scans the log backwards for `turn/start` / `turn/end` (`:49-56`).
- Order is fixed (`:128-144`): append `approval/asked` **before** the waterfall, then
  `approval/decided` **after** it, unconditionally.
- Payloads:
  - `approval/asked`: `{ id: ApprovalRequestId, toolName, callId?, reason? }` (`:132-137`)
  - `approval/decided`: `{ id, outcome }` (`:139-142`)
- **Automatic `allowed-once` still appends both events.** A prepended listener returning
  `'allowed-once'` never reaches the answerer, but the service still wrote `asked` and will
  write `decided` — the audit pair is guaranteed for every outcome, including our grants.
- The event is a *session event type* (`approval/asked`, `approval/decided` are in
  `KNOWN_SESSION_EVENT_TYPES`, `dsh-session/lib/types/known-event-types.js:24-26`), so it is
  durable and replayable; no new event type is needed for Sprint 1.

### 5. `ctx.userQuestions.ask` and plan-review — verified

```ts
ask(request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer>
interface AskUserQuestionRequest { questions: AskUserQuestionItem[]; agent?: Agent; signal?: AbortSignal; wait?: { callId: ToolCallId; timed?: boolean } }
interface AskUserQuestionItem { id: string; question: string; detail?: string; header?: string; options?: AskUserQuestionOption[]; multiSelect?: boolean; intent?: AskUserQuestionIntent }
interface AskUserQuestionIntent { kind: 'plan-review'; approve: string; callId?: ToolCallId }
interface AskUserQuestionOption { label: string; description?: string }
interface AskUserQuestionAnswer { answers: { id: string; selected: string[]; custom?: string }[] }
```

Evidence: service method `dsh-user-questions/lib/index.js:668-691`; validation `:673-678`;
item/option schemas `:26-47`; live-root gate `:531-535`.

- `intent` validation (`:673-678`): `approve` must name one of **that question's** options,
  and `detail` must be present; otherwise `UserQuestionError` `BAD_INTENT`.
- `agent`, when supplied, must be the **exact live runtime root** (`assertLiveRoot`, `:531-535`).
  A subagent call throws `DELEGATED_CALLER`; an unowned/agentless call has no human answerer.
  `request_approvals` must therefore refuse (fail closed) inside a subagent.
- `askTimed(request, callId, timeoutMs)` (`:613-651`) returns
  `AskUserQuestionAnswer | { pending: true; callId: ToolCallId }` (`:640-643`); it requires a
  live root and is how the timed `ask_user_question` keeps a question answerable.
- **`pending.dismiss()` is a Client UI method, not a Host service API.** It belongs to the
  client's pending-interaction object (`dsh-client-ui-user-questions/lib/client.js:413-422`):
  - `dismissal === 'hide'` (the card has a callId) → hide the composer seat, request stays
    answerable and the tool row can reopen it;
  - otherwise (no callId) → reject the waterfall with `ASK_CANCELLED`.
  This matches `docs/runtime-notes.md:38-40`. The plan-review footer's "Discuss" button calls
  exactly this (`client.js:588`).
- The shipped `ask_user_question` tool does **not** expose `detail` or `intent` in its schema
  (`dsh-tool-ask-user/lib/index.js:226-273`), so plan-review must be produced by our own
  `request_approvals` tool calling the service directly.
- Plan-review card requirements (Client, static): one question, `intent.kind === 'plan-review'`,
  `detail !== undefined`, `multiSelect !== true`, `options.length <= 2`, an option whose label
  equals `intent.approve` (`dsh-client-ui-user-questions/lib/client.js:42-61`).
- "View full text": `ui-plan` registers `conversation.plan-review.actions` unconditionally
  (`dsh-client-ui-plan/lib/client.js:672-690`); no `callId` on the intent opens a temporary
  review document from `review.plan`, a `callId` opens `submitted-plan` (`:678-686`). Do not set
  `intent.callId` for `request_approvals`.

### 6. Tool registration and `tool/result.meta` — verified

- Register a definition object: `ctx.tools.register(definition)` returns a disposer
  (`dsh-tool-todo/lib/index.js:95`; Inspect `Service.tools`). Duplicates in one layer and the
  reserved `run_code` name throw; a plain object with `name/description/parameters/output/execute`
  is accepted (no helper import required — `defineTool` only wraps `output.render` /
  `presentationMeta`, `dsh-tools/lib/index.js:841-863`).
- Definition shape (Inspect `Tool` / `Service.tools` referenced types):

```ts
interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>   // schema DSL (required: true inside properties)
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

- `meta` is produced only by `output.presentationMeta` (`dsh-tools/lib/index.js:3648-3658`),
  deep-frozen and detached (lossless JSON only, `:3636-3666`, `:3687-3705`).
- It is persisted by the agent loop verbatim:
  `session.append('tool/result', { turn, step, message, error?, meta? })`
  (`dsh-agent-loop/lib/index.js:697-703`). It is **not** part of the model-visible tool content.
- The parameter DSL is the one in `dsh-tool-todo/lib/index.js:98-119`: `type`, `required: true`,
  `properties`, `items`, `enum`, `description`; object items use `additionalProperties: false`.
- The tool receives `exec.callId`, `exec.agent`, `exec.signal`, `exec.arguments`
  (`dsh-tool-ask-user/lib/index.js:180-199`). No `turn` is on `exec`; see #9.
- `output.schema` must be the supported raw-JSON-Schema subset (`assertSupportedJsonSchema`,
  `dsh-tools/lib/index.js:2977-2978`); `parameters` is the separate DSL, not raw JSON Schema.

### 7. `ctx.storageDomain` — verified, but **not a ledger**

Exact surface (Inspect `Service.storageDomain`; `dsh-storage-domain/lib/index.js:46-76`,
README `:36-58`):

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

- **It is a schema-validated KV store, not an append-only log and not session-partitioned.**
  `put` overwrites one record; `delete` removes; there is no `append`/`read`; iteration is
  `entries()` over one table. Reads are synchronous from memory; writes serialize on one
  per-domain chain and are durable before resolving (README `:88-90`).
- Session scoping must be done by **key convention**, e.g. key
  `` `${sessionId}:${seq.padStart(12,'0')}:${callId}` `` in one table, because keys are arbitrary
  strings and there is no per-session table. Single-open-per-domain-name is enforced
  (`already-open`), so open once per Host plugin and close via `ctx.effect`.
- Records require Zod schemas (`valueSchema: ZodType`; README `:36`). `zod` is resolvable from
  the profile (`C:\Users\36288\.dsh\profiles\desktop\node_modules\zod`), but this would be our
  first runtime dependency and a load-risk (see #1). The profile already mounts
  `storage-json` with `root: <DSH_HOME>/storages` and `storage-domain` with `backend: json`
  (`C:\Users\36288\.dsh\profiles\desktop\cordis.yml:111-118`), so `ctx.storageDomain` is live.
- **Recommendation:** keep the existing `SessionAuditStore` interface
  (`src/audit/store.ts:15-21`) as the ledger boundary and use `MemoryAuditStore`
  (`src/audit/store.ts:23-50`) for Sprint 1. A `storageDomain` adapter can present the same
  append/list semantics by writing one new `${sessionId}:${seq}` key per record (append-only by
  convention, not by primitive) and scanning by key prefix; defer it until the `zod` packaging
  question is settled. The session log already
  contains `approval/asked` + `approval/decided` + `tool/call` + `tool/result.meta`; a
  `/approvals audit` handler can fold `agent.session.snapshotEvents()` synchronously, which is
  durable, replayable, dependency-free, and cannot drift from the audit pair.

### 8. Command registration — verified

`dsh-commands/lib/index.js` / README `:30-66`; Inspect `Service.commands`:

```ts
ctx.commands.register({
  name: 'approvals',                 // lowercase; duplicate in one layer throws
  description: 'Inspect approval grants and decisions',
  input: { hint: '[audit [--json] | grants]' },
  handler: ({ agent, rawInput, attachments, signal, commandId }) =>
    ({ kind: 'success', text }) | { kind: 'error', text },
})
```

- Handler runs directly against the agent; its text is UI-only and is **not** a model message
  (README `:117-125`). `recordInput` defaults true; both `command/run` and `command/done` are
  appended as standalone log-only events (`dsh-commands/lib/index.js:334-346`), so every
  `/approvals` invocation is itself auditable.
- Duplicate registration in the same scope throws (README `:46`); global vs agent-scoped layers
  shadow by name. Register globally from the Host plugin root.
- Existing command names in this profile: `plan`, `permission`, `goal`, `feedback`, `compact`,
  `export`. **No `approvals`** (grep over all shipped `lib/index.js` command registrations and
  over the profile's installed plugins). `/approvals` is free.

### 9. Session / turn facts — verified

Session event payloads (`dsh-tool-cordis/lib/types/api-catalog.js`, `SessionEventMap`):

```ts
'turn/start': { turn: number }
'turn/end':   { turn: number; reason: TurnEndReason }
'tool/call':  { turn: number; step: number; callId: ToolCallId; name: string; arguments: string }
'tool/result':{ turn: number; step: number; message: ToolResultMessage; error?: {name;code;reason?}; meta?: JsonValue }
'user/message': UserMessage
```

- `session/disposed(session: Session)` is a Host event (Inspect `Event`), emitted once when an
  announced session leaves the store.
- `session/event(session, event)` is the post-commit append feed (Inspect `Event`), the right
  hook for an in-memory fold. Use `{ global: true }` to observe all agents.
- **`user-question-reply` is not an event type.** It is a message source:
  `'user-question-reply': { kind: 'user-question-reply'; callId: ToolCallId; outcome: 'answered' }`
  (`dsh-llm/lib/typert.host.js`, `MessageSourceMap` declaration). It arrives as a `user/message`
  whose `source.kind` is `user-question-reply` (`dsh-user-questions/lib/index.js:255-263`).
- Current session id: `req.agent.id` / `exec.agent.id` / `agent.session.id`.
- Current turn: there is no accessor on `Agent`/`Session`. Fold the last `turn/start` exactly as
  the approval service does (`dsh-user-approval/lib/index.js:49-56`), or cache `turn` from the
  `session/event` feed. `exec` carries `callId`, not `turn`.
- `tool/result.meta` is the only place a tool can leave structured, non-model, durable decision
  data. This is our plan-level audit channel.

### 10. Name and collision inventory — verified

- `request_approvals`, `ask_choices`, `approvals`: not present in the live tool list (Inspect
  `Tool.listTools`, all currently callable tools), not in any shipped `lib/**/*.js`, not in the
  profile's installed plugins (`dsh-ops`, `dsh-cost-meter`, `dsh-context`).
- `ask_user_question` is taken (shipped tool); `run_code` is reserved by the registry.
- `dsh-experimental-auto-review` exists in the asar but is **not mounted** in this profile
  (absent from `cordis.yml` / `Config.listConfigs`), so no prepend conflict today. If a user
  enables it, both it and we prepend `tools/pre-execute` / `approval/request`; document
  `audit-only` + `notifications:false` and detect sibling grants.

### 11. Packaging constraints for Sprint 1 — verified

- Profile-installed plugins live in
  `C:\Users\36288\.dsh\profiles\desktop\node_modules\<pkg>`; there is **no**
  `node_modules/@deepseek-ai` there. `zod` is present (transitively).
- A working installed plugin explicitly avoids `@deepseek-ai/*` value imports "because every
  extra one is another way for the plugin to fail to load"
  (`dsh-ops/lib/config.js:5-9`). A different installed plugin does import
  `@deepseek-ai/dsh-credentials` / `dsh-home-paths` (`dsh-cost-meter/lib/*.js`), so resolution
  exists but carries load risk.
- `tsconfig.json` has `rootDir: "src"` and `include: ["src/**/*.ts"]`; a top-level `types/`
  directory is **not** compiled. Put local declarations at `src/types/dsh-runtime.ts` (still matches
  `src/**/*.ts`) so no tsconfig change is needed.

---

## Minimal local type surface

Create `src/types/dsh-runtime.ts` (included by the existing tsconfig). No `@deepseek-ai/*` imports;
this is the structural contract the real runtime already satisfies.

```ts
// src/types/dsh-runtime.ts — Sprint 1 only. Keep in sync with docs/runtime-spike.md.
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

Keep `apply` injected/decorated with these types, never with real DSH types:

```ts
import type { Context } from './types/dsh.js'
export function apply(ctx: Context, rawConfig: unknown): void { ... }
```

---

## Integration sketch

Existing in-tree helpers this sketch binds to: `buildApprovalDisplayReason`
(`src/approval/summary.ts:174-186`), `buildPlanReviewRequest` (`src/plan/review.ts:57`),
`SessionAuditStore` / `MemoryAuditStore` (`src/audit/store.ts:15-50`), and the Sprint 0
plan/risk/grants modules.

### 12. Hook `approval/request` (observe in Sprint 1, grants in 0.2)

```ts
// src/index.ts (Host half)
export const name = 'approval-ledger'
export const inject = ['tools', 'userQuestions', 'commands'] as const
// no exported Config: raw row config is validated in readConfig() (dsh-ops precedent)

export function apply(ctx: Context, rawConfig: unknown): void {
  const config = readConfig(rawConfig)
  const ledger = new SessionLedger()          // pure in-memory fold; no deps

  ctx.on('session/event', (session, event) => ledger.observe(session, event), { global: true })
  ctx.on('session/disposed', (session) => ledger.forget(session))

  ctx.on('approval/request', async (req, next) => {
    try {
      if (!config.observeOnly) {
        const grant = matchGrant(ledger, req)      // plan gate + risk gate (#3 in design.md)
        if (grant !== undefined) return 'allowed-once'
      }
      rewriteDisplayReason(req)                    // summary only; never hides the card
    } catch (error) {
      ctx.logger.warn(`approval-ledger: ${String(error)}`)   // fail open -> official card
    }
    return next()
  }, { prepend: true })
}
```

Rules that follow from the facts:

- `req` is mutable only before `next()`; do the `displayReason` rewrite there and never after.
- Return `allowed-once` **only** from a fully validated grant; any throw → `next()`.
- `allowed-once` still produces `approval/asked` + `approval/decided`; do not append them yourself.
- Respect an already-aborted `req.signal` by falling through (the service maps it to `cancelled`).
- `displayReason` rewrite (type cast is required):

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

### 13. Register `request_approvals`

```ts
type PlanResult = {
  planId: string
  decision: 'approved' | 'cancelled'
  items: { id: string; tool: string; risk: string; grantId?: string }[]
}

ctx.tools.register({
  name: 'request_approvals',
  description: 'Ask the user to approve a declared batch of upcoming tool actions …',
  parameters: { /* summary, items[] as in HANDOFF §3.1 */ },
  output: {
    schema: { type: 'object', additionalProperties: false, properties: { /* planId, decision, items */ } },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    // plan-level audit; persisted as tool/result.meta, never enters model content
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
  // omit isConcurrencySafe => exclusive, which is what an interactive ask needs
  async execute(args, exec) {
    if (exec.agent === undefined) throw new Error('request_approvals requires an owning agent session')
    if (!isRuntimeRoot(exec)) throw new Error('request_approvals is unavailable in a subagent; include the plan in your final result')
    const plan = validatePlan(args)                    // existing Sprint 0 validators
    const review = buildPlanReviewRequest(plan)        // shaped by src/plan/review.ts (no intent.callId)
    const answer = await ctx.userQuestions.ask({ ...review, agent: exec.agent, signal: exec.signal })
    const approveLabel = review.questions[0]!.intent.approve
    const approved = answer.answers[0]?.selected.includes(approveLabel) === true
    if (!approved) return { planId: plan.id, decision: 'cancelled', items: [] }
    const grants = grantStore.install(exec.agent, plan)  // in-memory, session-scoped
    return { planId: plan.id, decision: 'approved', items: plan.items.map(/* … */) }
  },
})
```

Notes:

- `ask` is the blocking path; a "Discuss" click rejects with `ASK_CANCELLED` (no callId). Treat
  every rejection as `decision: 'cancelled'` and install no grants. This is the fail-closed path.
- `ask` throws `DELEGATED_CALLER` in a subagent; the check above turns that into a normal tool
  error instead of a lost approval.
- The plan-review card requires `detail` and `approve` exactly as above; otherwise `ask` throws
  `BAD_INTENT`. The Client additionally requires ≤2 options and `multiSelect !== true`
  (`dsh-client-ui-user-questions/lib/client.js:42-61`) — validate before calling, so a mistyped
  plan never silently degrades to a generic question card.
- `output.presentationMeta` must return lossless JSON only; the registry snapshots and freezes it.

### 14. `/approvals` command

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

- Command text is never a model message, and `command/run` + `command/done` already record the
  invocation. No session event and no model tokens.
- Read `agent.session.snapshotEvents()`; filter `approval/asked`, `approval/decided`,
  `tool/call`, `tool/result` (meta) and group by `turn`. Missing joins → `unattributed`, never guess.
- Do not register `conversation.approval.detail` (single slot owned by `dsh-client-ui-chat`,
  `dsh-client-ui-chat/lib/client.js:13329`; slot kind `single` in
  `dsh-cordis-client-runner/lib/client.js:2436-2437`).

### 15. Where the ledger lives in Sprint 1

| Layer | Mechanism | Dependency |
|---|---|---|
| Facts | session events (`approval/asked`, `approval/decided`, `tool/call`, `tool/result`) | none |
| Plan decision | `tool/result.meta` via `presentationMeta` | none |
| Derived view | in-memory fold of `session/event` + `snapshotEvents()` on command | none |
| Cross-session retention | `ctx.storageDomain` KV (key convention), **not append-only** | `zod` (defer) |

Do not call `storageDomain` before the packaging question is settled; the session log already
satisfies "auditable and replayable" for 0.1.

### 16. Follow-up: the `ctx.storage` hub (not `storageDomain`)

```ts
interface Storage {
  readonly backend: BackendRegistry           // register(name, backend) / get(name) / names()
  mount(form, facility): () => void           // duplicate-mount throws
  form(form): facility                        // throws form-not-mounted
  readonly domain: DomainFacility             // getter -> form('domain')
}
```

Evidence: `dsh-storage/lib/index.js:104-137`; Inspect `Service.storage` (`BackendRegistry`,
`StorageBackend { kv?: KvFacet }`, `KvFacet.open(descriptor): Promise<KvUnit>`,
`KvUnit { loadAll, putRecord, deleteRecord, setGlobal, close }`). `StorageForms` is augmented
only by the domain form, so `ctx.storage.form('kv')` does not exist in this build; the only
mounted form is `domain`, also reachable as `ctx.storageDomain`.

**Can it persist a per-session `callId → {planId,itemId,risk,target}` map without zod?**
Technically yes, but only by dropping below the domain layer to the backend kv facet:

```ts
const backend = ctx.storage.backend.get('json')      // throws if not mounted; profile mounts it
const unit = await backend.kv!.open({
  name: 'approval_ledger', version: 1, tables: ['calls'], hasGlobal: false, layout: 'per-record',
})
await unit.putRecord('calls', `${sessionId}:${callId}`, value)   // unknown; no schema validation
const all = await unit.loadAll()                                 // { tables: { calls: {...} }, global }
```

Caveats: bypasses domain routing/validation and `domain/changed`; the storage-domain README says
consumers should never touch backends directly; `KvUnit` does **not** serialize concurrent writes
(caller owns ordering); a stored version mismatch rejects with no migration; every value must be
lossless JSON. Verdict: dependency-free but layering-violating — prefer `MemoryAuditStore` +
the session-log fold for 0.1; use this only if cross-restart persistence is mandatory before the
`zod` question is settled.

### 17. Follow-up: can the audit fold join calls and results?

- `tool/call.arguments` is **always a string** — the raw model-emitted text, not a parsed object
  and **not guaranteed valid JSON**. `appendToolCall` passes `block.arguments` verbatim
  (`dsh-agent-loop/lib/index.js:681-688`); `ToolCallBlock.arguments: string`. Guard `JSON.parse`
  and mark the record `unattributed` on failure; never throw from the fold.
- `tool/result.message` carries the call id **twice**: `message.toolCallId` and
  `message.source.callId` (`ToolResultMessage` / `ToolMessageSource` declarations). An existing
  consumer reads `event.data.message.toolCallId` (`dsh-user-questions/lib/index.js:217`), so the
  join is direct and stable.
- `approval/asked` has no `turn`; join it to a turn through the enclosing `tool/call` (match
  `toolName`, plus `callId` when present — it is optional and absent for non-tool asks) or fold
  turn state from `turn/start`.

### 18. Follow-up: is there a durable channel for plugin-private metadata?

**No.** `SessionEventMap` is closed, `KNOWN_SESSION_EVENT_TYPES` enumerates it
(`dsh-session/lib/types/known-event-types.js:21-84`), and an unknown type needs
`ignorable: true`, which live `append()` cannot set.

- `hook/invoked` / `hook/result` are known types, but no shipped package appends them (only
  catalogs, the session-format migrations, and client catalogs mention them) — not a sanctioned
  extension point.
- `deliverables/presented` is owned by `dsh-tool-present` (`{turn, callId, files}`,
  `dsh-tool-present/lib/types/index.js:96-98`); `todo/write` is owned by the todo tool. Do not
  hijack either.
- Therefore `tool/result.meta` on our own `request_approvals` result is the only sanctioned
  structured channel in Sprint 1. `command/done.text` is durable but is UI text for `/approvals`,
  not metadata; `approval/asked.reason` must remain the honest official reason.

---

## Open questions — need a live P0

1. **Card copy after rewrite.** Mutating `displayReason` in a prepended `approval/request`
   listener is statically sound (#3), but only a live approval card proves the client shows the
   new `en`/`zh` text and that no later listener re-reads `reason`.
2. **Freeze at runtime.** No `Object.freeze` exists on the request path, but confirm with a live
   listener that `req.displayReason = …` does not throw (TypeScript `readonly` is erased).
3. **Plan-review outside plan mode.** Code shows the card is intent-only (`planReviewOf` checks
   no plan-mode state) and `ui-plan` registers the actions slot unconditionally, while the
   `plan-mode` row is currently `inactive`. Confirm a review asked by `request_approvals`
   renders with the "view full text" button and a temporary document.
4. **`ask` lifetime.** A plan review has no timer by default. Confirm the UX when the user
   navigates away: does the tool call stay blocked (expected) and does "Discuss" reject promptly?
   If a timeout is wanted, `askTimed` returns `pending` — but a pending plan is not an approval,
   so decide explicitly.
5. **Subagent call.** Confirm `ctx.userQuestions.ask` reliably throws `DELEGATED_CALLER` for
   `request_approvals` under `subagent`/workflow, and that the tool error is actionable.
6. **`tool/result.meta` round-trip.** Confirm `approval`/session replay keeps `meta` across
   restart and that the Client can read it from the tool-result node (same JSON snapshot path as
   `argsRaw`, `dsh-client-ui-trajectory/lib/client.js:2272`).
7. **Sibling prepend order.** If `dsh-experimental-auto-review` or a third-party approval plugin
   is enabled, confirm listener order and that returning `allowed-once` from ours does not
   starve theirs (waterfall claims are first-return-wins, `cordis/lib/index.js:317-324`).
8. **Command collision at load.** `commands.register` throws on a duplicate name in one layer;
   confirm the Loader contains a plugin load failure instead of taking down the Host.
9. **Windows flash helper** (Sprint 2): PowerShell resident process, EDR/ConstrainedLanguage
   failure, fallback to title/favicon. Untouched by this spike.
10. **Version pin.** Re-verify the inspected shapes on the targeted `0.2.0-rc.2` before release;
    this checkout is `0.2.1-rc.2`.

---

## Confidence summary (P0 items from `HANDOFF.md` §5)

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | `displayReason` rewrite in prepend listener / frozen? | **likely** (mutation + dispatch verified; card pixels unverified) | §3 |
| 2 | Plan-review intent outside plan mode; "view full text" | **verified static** (render unverified) | §5, `ui-plan:672-686` |
| 3 | `conversation.approval.detail` single-slot conflict | **verified static** (throw text unverified) | §14 |
| 4 | Client `argsRaw` / pending approval | **likely** (trajectory nodes expose `argsRaw`; `uiSession` pending interaction is Client-only) | §1, §5 |
| 5 | `tool/result.meta` persistence; `storageDomain` ledger | **verified** (meta persists; storageDomain is KV, not append-only) | §6, §7 |
| 6 | Tool/command name collisions | **verified static** | §8, §10 |
| 7 | Prepend + `next()`; `allowed-once` audit pair | **verified** | §3, §4 |
| 8 | Windows flash helper | **unverified** (Sprint 2) | — |
