import type {
  Agent,
  ApprovalOutcome,
  ApprovalRequestEvent,
  AskUserQuestionAnswer,
  AskUserQuestionRequest,
  CommandDefinition,
  CommandInvocation,
  CommandResult,
  Context,
  Session,
  SessionEvent,
  ToolDefinition,
  ToolRunContext,
} from '../../src/types/dsh-runtime.js'

type Listener = (...args: any[]) => unknown

interface ListenerEntry {
  listener: Listener
  prepend: boolean
}

export class FakeContext {
  readonly toolDefs = new Map<string, ToolDefinition>()
  readonly commandDefs = new Map<string, CommandDefinition>()
  readonly warnings: string[] = []
  readonly askCalls: AskUserQuestionRequest[] = []
  readonly effects: Array<() => void> = []
  readonly cwd = 'C:\\ws'
  askError: unknown
  askHandler: (request: AskUserQuestionRequest) => Promise<AskUserQuestionAnswer> = async (request) => ({
    answers: request.questions.map((question) => ({
      id: question.id,
      selected: question.options?.[0] === undefined ? [] : [question.options[0].label],
    })),
  })

  private readonly listeners = new Map<string, ListenerEntry[]>()

  readonly logger = {
    warn: (message: string): void => {
      this.warnings.push(message)
    },
    info: (): void => {},
  }

  get tools(): Context['tools'] {
    return {
      register: (definition: ToolDefinition) => {
        if (this.toolDefs.has(definition.name)) throw new Error(`duplicate tool ${definition.name}`)
        this.toolDefs.set(definition.name, definition)
        return () => this.toolDefs.delete(definition.name)
      },
      get: (name: string) => this.toolDefs.get(name),
    }
  }

  get userQuestions(): Context['userQuestions'] {
    return {
      ask: async (request: AskUserQuestionRequest) => {
        this.askCalls.push(request)
        if (this.askError !== undefined) throw this.askError
        return this.askHandler(request)
      },
    }
  }

  get commands(): Context['commands'] {
    return {
      register: (definition: CommandDefinition) => {
        if (this.commandDefs.has(definition.name)) {
          throw new Error(`duplicate command ${definition.name}`)
        }
        this.commandDefs.set(definition.name, definition)
        return () => this.commandDefs.delete(definition.name)
      },
    }
  }

  get workingDirectory(): Context['workingDirectory'] {
    return {
      defaultDirectory: this.cwd,
      get: () => this.cwd,
    }
  }

  get(_name: string): unknown {
    return undefined
  }

  on(
    name: string,
    listener: (...args: any[]) => unknown,
    options?: { prepend?: boolean; global?: boolean },
  ): () => void {
    const entries = this.listeners.get(name) ?? []
    const entry: ListenerEntry = { listener, prepend: options?.prepend === true }
    if (entry.prepend) entries.unshift(entry)
    else entries.push(entry)
    this.listeners.set(name, entries)
    return () => {
      const current = this.listeners.get(name)
      if (current === undefined) return
      const index = current.indexOf(entry)
      if (index >= 0) current.splice(index, 1)
    }
  }

  inject(_names: readonly string[], fn: (ctx: Context) => void): void {
    fn(this as unknown as Context)
  }

  effect(fn: () => void | (() => void), _label?: string): () => void {
    const cleanup = fn()
    const disposer = typeof cleanup === 'function' ? cleanup : () => {}
    this.effects.push(disposer)
    return disposer
  }

  async emitApproval(
    request: ApprovalRequestEvent,
    fallback: ApprovalOutcome = 'rejected',
  ): Promise<ApprovalOutcome> {
    const entries = [...(this.listeners.get('approval/request') ?? [])]
    let index = 0
    const dispatch = async (): Promise<ApprovalOutcome> => {
      const entry = entries[index]
      index += 1
      if (entry === undefined) return fallback
      return (await entry.listener(request, dispatch)) as ApprovalOutcome
    }
    return dispatch()
  }

  emitSessionEvent(session: Session, event: SessionEvent): void {
    for (const entry of this.listeners.get('session/event') ?? []) {
      entry.listener(session, event)
    }
  }

  emitDisposed(session: Session): void {
    for (const entry of this.listeners.get('session/disposed') ?? []) {
      entry.listener(session)
    }
  }

  async runTool(
    name: string,
    args: unknown,
    exec: ToolRunContext,
  ): Promise<unknown> {
    const definition = this.toolDefs.get(name)
    if (definition === undefined) throw new Error(`tool not registered: ${name}`)
    return definition.execute(args, exec)
  }

  runCommand(name: string, invocation: CommandInvocation): CommandResult {
    const definition = this.commandDefs.get(name)
    if (definition === undefined) throw new Error(`command not registered: ${name}`)
    const result = definition.handler(invocation)
    if (result instanceof Promise) {
      throw new Error('test helper does not await async commands')
    }
    return result
  }
}

export function makeEvent(seq: number, type: string, data: unknown): SessionEvent {
  return { seq, type, time: 1000 + seq, data }
}

export function makeSession(id: string, events: SessionEvent[]): Session {
  return {
    id,
    seq: events.length,
    eventAt: (seq: number) => events.find((event) => event.seq === seq),
    snapshotEvents: () => events,
  }
}

export function makeAgent(session: Session): Agent {
  return { id: session.id, session }
}

export function toolExec(
  agent: Agent,
  callId: string,
  name: string,
  args: unknown,
): ToolRunContext {
  return {
    callId,
    name,
    arguments: args,
    agent,
    signal: new AbortController().signal,
  }
}
