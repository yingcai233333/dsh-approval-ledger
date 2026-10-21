/**
 * Minimal structural DSH 0.2.1-rc.2 type surface for Sprint 1.
 *
 * These declarations exist so the Host plugin can be compiled without
 * depending on unpublished `@deepseek-ai/*` packages. They are type-only;
 * `import type` is erased at runtime. See docs/runtime-spike.md for evidence.
 *
 * This is a `.ts` module (not `.d.ts`) so `tsc` emits a declaration next to the
 * compiled plugin; a declaration-only input would not be copied to `lib/`.
 */

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue }

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
export type ContentBlock =
  | TextBlock
  | { type: 'image'; [key: string]: unknown }
  | { type: 'file'; [key: string]: unknown }

export interface SessionEvent<T = unknown> {
  readonly type: string
  readonly seq: number
  readonly time: number
  readonly data: T
}

/**
 * Detached, deep-frozen creation metadata. The store synthesizes one when a
 * `Session` is created without a store-owned header, so it is always present at
 * runtime; it is optional here so structural test doubles stay valid.
 *
 * Evidence: `dsh-session/lib/index.js:1340` (the `header` field) and
 * `:1051-1054` (validation: `parentSession` string, `origin` only `'subagent'`,
 * `delegationDepth` non-negative integer).
 */
export interface SessionHeader {
  readonly id?: string
  /** Set for a fork or a delegated child; a fork is still a root user session. */
  readonly parentSession?: string
  /** Stamped only by the delegation stack on a child session. */
  readonly origin?: 'subagent'
  readonly delegationDepth?: number
}

export interface Session {
  readonly id: string
  readonly header?: SessionHeader
  readonly seq: number
  eventAt(seq: number): SessionEvent | undefined
  snapshotEvents(fromSeq?: number, toSeqExclusive?: number): readonly SessionEvent[]
}

export interface Agent {
  readonly id: string
  readonly session: Session
}

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

export interface AskUserQuestionOption {
  label: string
  description?: string
}

export interface AskUserQuestionIntent {
  kind: 'plan-review'
  approve: string
  callId?: string
}

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
  execute(args: unknown, exec: ToolRunContext): Promise<JsonValue>
  isConcurrencySafe?(args: unknown): boolean
}

export interface CommandInvocation {
  readonly commandId: string
  readonly agent: Agent
  readonly rawInput: string
  readonly attachments: readonly ContentBlock[]
  readonly signal: AbortSignal
}

export type CommandResult =
  | { kind: 'success'; text?: string }
  | { kind: 'error'; text: string }

export interface CommandDefinition {
  name: string
  description: string
  input?: { hint: string; attachments?: boolean }
  recordInput?: boolean
  handler(invocation: CommandInvocation): CommandResult | Promise<CommandResult>
}

export interface Context {
  readonly tools: {
    register(definition: ToolDefinition): () => void
    get(name: string, scope?: unknown): ToolDefinition | undefined
  }
  readonly userQuestions: {
    ask(request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer>
  }
  readonly commands: {
    register(definition: CommandDefinition): () => void
  }
  readonly workingDirectory: {
    readonly defaultDirectory: string
    get(session: Session): string
  }
  get(name: string): unknown
  on(
    name: string,
    listener: (...args: any[]) => unknown,
    options?: { prepend?: boolean; global?: boolean },
  ): () => void
  inject(names: readonly string[], fn: (ctx: Context) => void): void
  effect(fn: () => void | (() => void), label?: string): () => void
  readonly logger: { warn(message: string): void; info(message: string): void }
}
