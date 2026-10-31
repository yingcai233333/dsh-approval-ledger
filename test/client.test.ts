/**
 * Client-half tests.
 *
 * `client.js` is a browser bundle with no exports: importing it only calls
 * `window.__ModuleLoader__.load({ id, factory })`. These tests fake that loader,
 * capture the entry, and drive the factory against a minimal React stand-in and
 * a hand-written Cordis-like context. Everything asserted here is reachable
 * through the public module contract (entry, `inject`, `apply`, slot
 * registrations) and through the registered components -- no test-only hooks
 * exist in `client.js`.
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { after, describe, it } from 'node:test'

type Props = Record<string, any>

interface FakeElement {
  readonly $$element: true
  readonly type: any
  readonly props: Props
}

interface SlotDescriptor {
  name: string
  id: string
  order?: number
  label?: () => string
}

interface Registration {
  descriptor: SlotDescriptor
  render: (props: Props) => any
}

interface ClientModule {
  inject: string[]
  apply: (ctx: any) => void
}

interface ModuleEntry {
  id: string
  factory: (require: (name: string) => any) => ClientModule
}

interface HarnessOptions {
  locale?: string
  statuses?: Record<string, any>
  sessionId?: string
  snapshot?: any
  failInjectAt?: string
  configForms?: any
}

interface FakeConfigFormCalls {
  sets: Array<[string, unknown]>
}

function makeConfigForm(options: {
  value?: Record<string, unknown>
  writable?: boolean
  status?: string
  setResult?: unknown
} = {}): { form: any; calls: FakeConfigFormCalls } {
  const calls: FakeConfigFormCalls = { sets: [] }
  const value = {
    notifications: true,
    autoAllowSessions: false,
    flashWindow: true,
    soundAlert: true,
    notifyOnPlan: true,
    notifyOnQuestion: true,
    notifyOnApproval: true,
    notifyOnTurnEnd: true,
    turnEndOnlyWhenAway: true,
    notifyRepeatSeconds: 0,
    turnBadgeSeconds: 120,
    ...options.value,
  }
  const snapshot = {
    status: options.status ?? 'ready',
    writable: options.writable ?? true,
    revision: 1,
    value,
  }
  let listener: (() => void) | undefined
  const form = {
    getSnapshot: () => snapshot,
    subscribe: (next: () => void) => {
      listener = next
      return () => {
        listener = undefined
      }
    },
    set: (field: string, next: unknown) => {
      calls.sets.push([field, next])
      if (options.setResult !== undefined) return options.setResult
      return Promise.resolve(true)
    },
    emit: () => {
      if (listener !== undefined) listener()
    },
  }
  return { form, calls }
}

function makeConfigForms(form: any, served = true): any {
  const calls = { gets: [] as string[], watched: [] as string[][] }
  return {
    calls,
    get(entryId: string) {
      calls.gets.push(entryId)
      return form
    },
    whileServed(namespaces: string[], register: (served: Set<string>) => any) {
      calls.watched.push(namespaces)
      if (!served) return () => undefined
      const disposer = register(new Set(namespaces))
      return typeof disposer === 'function' ? disposer : () => undefined
    },
  }
}

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

function findRepoRoot(): string {
  let directory = dirname(fileURLToPath(import.meta.url))
  for (let depth = 0; depth < 6; depth += 1) {
    if (existsSync(join(directory, 'package.json')) && existsSync(join(directory, 'client.js'))) {
      return directory
    }
    directory = dirname(directory)
  }
  throw new Error('could not locate the repository root from the compiled test file')
}

const REPO_ROOT = findRepoRoot()

// --- minimal React stand-in -------------------------------------------------

const FRAGMENT = Symbol('client-test-fragment')

function createElement(type: any, props: Props | null, ...children: any[]): FakeElement {
  const merged: Props = props === null ? {} : { ...props }
  if (children.length === 1) merged.children = children[0]
  else if (children.length > 1) merged.children = children
  return { $$element: true, type, props: merged }
}

function sameDeps(left: any[], right: any[]): boolean {
  return left.length === right.length && left.every((value, index) => Object.is(value, right[index]))
}

interface EffectSlot {
  deps?: any[]
  cleanup?: () => void
}

/**
 * Hook storage for one mounted tree. The client only uses useState/useEffect,
 * but useMemo/useCallback/useRef are provided so the fake peer stays honest.
 */
class HookRuntime {
  private readonly states: any[] = []
  private readonly memo: Array<{ deps?: any[]; value: any } | undefined> = []
  private readonly effects: Array<EffectSlot | undefined> = []
  private readonly refs: Array<{ current: any } | undefined> = []
  private stateCursor = 0
  private memoCursor = 0
  private effectCursor = 0
  private refCursor = 0
  private scheduled: Array<{ slot: EffectSlot; effect: () => void | (() => void); deps?: any[] }> = []
  private rerender: () => void = () => {}

  bindRerender(rerender: () => void): void {
    this.rerender = rerender
  }

  beginRender(): void {
    this.stateCursor = 0
    this.memoCursor = 0
    this.effectCursor = 0
    this.refCursor = 0
    this.scheduled = []
  }

  useState = <T>(initial: T | (() => T)): [T, (next: T | ((previous: T) => T)) => void] => {
    const index = this.stateCursor
    this.stateCursor += 1
    if (!(index in this.states)) {
      this.states[index] = typeof initial === 'function' ? (initial as () => T)() : initial
    }
    const setState = (next: T | ((previous: T) => T)): void => {
      const value = typeof next === 'function' ? (next as (previous: T) => T)(this.states[index]) : next
      if (Object.is(value, this.states[index])) return
      this.states[index] = value
      this.rerender()
    }
    return [this.states[index], setState]
  }

  useMemo = <T>(factory: () => T, deps?: any[]): T => {
    const index = this.memoCursor
    this.memoCursor += 1
    const previous = this.memo[index]
    if (previous === undefined || deps === undefined || previous.deps === undefined || !sameDeps(previous.deps, deps)) {
      this.memo[index] = { deps, value: factory() }
    }
    return (this.memo[index] as { value: T }).value
  }

  useCallback = <T>(callback: T, deps?: any[]): T => this.useMemo(() => callback, deps)

  useEffect = (effect: () => void | (() => void), deps?: any[]): void => {
    const index = this.effectCursor
    this.effectCursor += 1
    let slot = this.effects[index]
    if (slot === undefined) {
      slot = {}
      this.effects[index] = slot
    }
    const changed = deps === undefined || slot.deps === undefined || !sameDeps(slot.deps, deps)
    if (changed) this.scheduled.push({ slot, effect, deps })
  }

  useRef = <T>(initial: T): { current: T } => {
    const index = this.refCursor
    this.refCursor += 1
    if (this.refs[index] === undefined) this.refs[index] = { current: initial }
    return this.refs[index] as { current: T }
  }

  commit(): void {
    const scheduled = this.scheduled
    this.scheduled = []
    for (const { slot, effect, deps } of scheduled) {
      if (typeof slot.cleanup === 'function') slot.cleanup()
      const cleanup = effect()
      slot.cleanup = typeof cleanup === 'function' ? cleanup : undefined
      slot.deps = deps
    }
  }

  unmount(): void {
    for (const slot of this.effects) {
      if (slot !== undefined && typeof slot.cleanup === 'function') slot.cleanup()
      if (slot !== undefined) slot.cleanup = undefined
    }
  }
}

function createFakeReact(runtime: HookRuntime) {
  return {
    createElement,
    Fragment: FRAGMENT,
    useState: runtime.useState,
    useMemo: runtime.useMemo,
    useCallback: runtime.useCallback,
    useEffect: runtime.useEffect,
    useRef: runtime.useRef,
  }
}

// --- rendered-tree helpers --------------------------------------------------

function expand(node: any): any {
  if (node === null || node === undefined || typeof node === 'boolean') return null
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(expand)
  if (node.$$element === true) {
    if (typeof node.type === 'function') return expand(node.type(node.props))
    if (node.type === FRAGMENT) return expand(node.props.children)
    return { type: node.type, props: { ...node.props, children: expand(node.props.children) } }
  }
  throw new Error(`unexpected rendered node: ${String(node)}`)
}

function isHost(node: any): boolean {
  return node !== null && typeof node === 'object' && !Array.isArray(node) && typeof node.type === 'string'
}

function findNode(node: any, predicate: (host: any) => boolean): any {
  if (node === null || node === undefined || typeof node === 'string') return undefined
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findNode(child, predicate)
      if (hit !== undefined) return hit
    }
    return undefined
  }
  if (predicate(node)) return node
  return findNode(node.props.children, predicate)
}

function findNodes(node: any, predicate: (host: any) => boolean, found: any[] = []): any[] {
  if (node === null || node === undefined || typeof node === 'string') return found
  if (Array.isArray(node)) {
    for (const child of node) findNodes(child, predicate, found)
    return found
  }
  if (predicate(node)) found.push(node)
  findNodes(node.props.children, predicate, found)
  return found
}

function texts(node: any): string[] {
  if (node === null || node === undefined) return []
  if (typeof node === 'string') return [node]
  if (Array.isArray(node)) return node.flatMap(texts)
  return texts(node.props.children)
}

const isDialog = (node: any): boolean => isHost(node) && node.props.role === 'dialog'
const isListItem = (node: any): boolean => isHost(node) && node.type === 'li'
const isPendingDot = (node: any): boolean => isHost(node) && node.type === 'span' && node.props['aria-hidden'] === true
const isInlineNote = (node: any): boolean =>
  isHost(node) && node.type === 'section' && node.props['aria-label'] === '待审批说明'

class RenderedTree {
  private readonly runtime: HookRuntime
  private root: any = null
  tree: any = null

  constructor(runtime: HookRuntime) {
    this.runtime = runtime
    runtime.bindRerender(() => this.rerender())
  }

  mount(element: any): any {
    this.root = element
    this.rerender()
    return this.tree
  }

  rerender(): void {
    if (this.root === null) return
    this.runtime.beginRender()
    this.tree = expand(this.root)
    this.runtime.commit()
  }

  unmount(): void {
    this.runtime.unmount()
    this.tree = null
    this.root = null
  }

  text(): string {
    return texts(this.tree).join('')
  }

  find(predicate: (host: any) => boolean): any {
    return findNode(this.tree, predicate)
  }

  findAll(predicate: (host: any) => boolean): any[] {
    return findNodes(this.tree, predicate)
  }

  click(label: string): void {
    const button = this.find(
      (node) => node.type === 'button' && node.props['aria-label'] === label,
    )
    assert.ok(button, `expected a button labelled ${label}`)
    button.props.onClick()
    this.rerender()
  }
}

// --- fake browser globals ---------------------------------------------------

const listeners = new Map<string, Set<(event: any) => void>>()

const fakeWindow = {
  __ModuleLoader__: {
    load(entry: ModuleEntry): void {
      loads.push(entry)
    },
  },
  addEventListener(type: string, listener: (event: any) => void): void {
    const bucket = listeners.get(type) ?? new Set()
    bucket.add(listener)
    listeners.set(type, bucket)
  },
  removeEventListener(type: string, listener: (event: any) => void): void {
    listeners.get(type)?.delete(listener)
  },
}

const fakeDocument = { title: 'DSH' }

function listenerCount(type: string): number {
  return listeners.get(type)?.size ?? 0
}

const previousWindow = (globalThis as any).window
const previousDocument = (globalThis as any).document
const loads: ModuleEntry[] = []

;(globalThis as any).window = fakeWindow
;(globalThis as any).document = fakeDocument

const clientUrl = pathToFileURL(join(REPO_ROOT, 'client.js')).href
// The entry is a side effect of importing the module, so this import must run
// before any test touches the captured factory.
await import(clientUrl)

if (loads.length !== 1) {
  throw new Error(`expected client.js to register exactly one module, got ${loads.length}`)
}

const moduleEntry = loads[0]
const factory = moduleEntry.factory

after(() => {
  if (previousWindow === undefined) delete (globalThis as any).window
  else (globalThis as any).window = previousWindow
  if (previousDocument === undefined) delete (globalThis as any).document
  else (globalThis as any).document = previousDocument
})

// --- harness ----------------------------------------------------------------

function makeSnapshot(statuses: Record<string, any>): any {
  const map = new Map(Object.entries(statuses))
  return {
    get: (sessionId: string) => map.get(sessionId),
    forEach: (visit: (status: any, sessionId: string) => void) => {
      for (const [sessionId, status] of map) visit(status, sessionId)
    },
  }
}

function status(pendingInteraction: any): { pendingInteraction: any } {
  return { pendingInteraction }
}

function approval(overrides: Props = {}): Props {
  return {
    kind: 'approval',
    toolName: 'write',
    callId: 'call-1',
    displayReason: { zh: '写入报告', en: 'Write report' },
    ...overrides,
  }
}

function makeHarness(options: HarnessOptions = {}) {
  fakeDocument.title = 'DSH'
  listeners.clear()

  const runtime = new HookRuntime()
  const React = createFakeReact(runtime)
  const registrations: Registration[] = []
  const injections: Array<{ name: string; install: () => any }> = []
  const serviceInjections: Array<{ names: readonly string[]; install: (scope: any) => any }> = []
  const effects: Array<{ label: string; dispose: any }> = []
  const dictionaries: Record<string, { zh: Record<string, string>; en: Record<string, string> }> = {}
  const localeId = options.locale ?? 'zh-CN'

  const ctx = {
    get: () => undefined,
    provide: () => undefined,
    on: () => () => undefined,
    inject(names: readonly string[], install: (scope: any) => any) {
      serviceInjections.push({ names, install })
    },
    effect(run: () => any, label: string) {
      effects.push({ label, dispose: run() })
    },
    locale: {
      register(namespace: string, dictionary: any) {
        dictionaries[namespace] = dictionary
        return () => undefined
      },
      bind(namespace: string) {
        return (key: string): string => {
          const dictionary = dictionaries[namespace]
          const table = localeId.toLowerCase().startsWith('zh') ? dictionary?.zh : dictionary?.en
          return table?.[key] ?? key
        }
      },
    },
    slots: {
      inject(name: string, install: () => any) {
        if (options.failInjectAt === name) throw new Error(`slots.inject failed: ${name}`)
        injections.push({ name, install })
      },
      register(descriptor: SlotDescriptor, render: (props: Props) => any) {
        registrations.push({ descriptor, render })
        return { descriptor, dispose: () => undefined }
      },
    },
  }

  const client = factory((name: string) => {
    assert.equal(name, 'react', 'the client half must only require the React peer')
    return React
  })

  client.apply(ctx)

  const snapshotValue = options.snapshot === undefined ? makeSnapshot(options.statuses ?? {}) : options.snapshot
  const useSessionStatus = (selector: (snapshot: any) => any): any => selector(snapshotValue)

  const install = (): void => {
    for (const injection of serviceInjections) {
      if (options.configForms === undefined) continue
      const scope = Object.assign(Object.create(ctx), { configForms: options.configForms })
      injection.install(scope)
    }
    for (const injection of injections) injection.install()
  }

  const mount = (slotName: string, props: Props = {}): RenderedTree => {
    const registration = registrations.find((entry) => entry.descriptor.name === slotName)
    assert.ok(registration, `slot ${slotName} is registered`)
    const element = registration.render({ sessionId: options.sessionId, useSessionStatus, ...props })
    const renderer = new RenderedTree(runtime)
    renderer.mount(element)
    return renderer
  }

  return {
    ctx,
    client,
    registrations,
    injections,
    effects,
    dictionaries,
    install,
    mount,
    runtime,
    React,
    useSessionStatus,
  }
}

function installedHarness(options: HarnessOptions = {}) {
  const harness = makeHarness(options)
  harness.install()
  return harness
}

const HEADER_SLOT = 'conversation.session.header.utilities'
const OVERLAY_SLOT = 'shell.overlay'

// --- module contract --------------------------------------------------------

const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
  name: string
  dsh: { client: { platform: string; immediately: boolean; inject: string[] } }
}

describe('client module registration', () => {
  it('registers exactly one module under the package id and exposes a factory', () => {
    assert.equal(loads.length, 1)
    assert.equal(moduleEntry.id, 'dsh-approval-ledger')
    assert.equal(moduleEntry.id, pkg.name)
    assert.equal(typeof moduleEntry.factory, 'function')
    assert.deepEqual(Object.keys(moduleEntry).sort(), ['factory', 'id'])
  })

  it('matches the dsh.client manifest and declares the runtime services it injects', () => {
    assert.equal(pkg.dsh.client.platform, 'web')
    assert.equal(pkg.dsh.client.immediately, true)
    assert.deepEqual(pkg.dsh.client.inject, ['@deepseek-ai/dsh-client-ui-conversation'])

    const client = factory(() => ({}))
    assert.deepEqual(client.inject, ['slots', 'locale', 'sessions'])
    assert.equal(typeof client.apply, 'function')
  })
})

// --- apply / slot registration ---------------------------------------------

describe('client apply registration', () => {
  it('registers the dictionaries through ctx.effect and subscribes both slots lazily', () => {
    const harness = makeHarness()

    assert.deepEqual(
      harness.injections.map((injection) => injection.name),
      [HEADER_SLOT, OVERLAY_SLOT],
      'slots are requested in a stable order',
    )
    assert.equal(harness.registrations.length, 0, 'register runs when the host installs the injection')
    assert.deepEqual(
      harness.effects.map((effect) => effect.label),
      ['approval-ledger: client dictionaries'],
    )

    harness.install()
    assert.equal(harness.registrations.length, 2)

    const [details, overlay] = harness.registrations
    assert.equal(details.descriptor.name, HEADER_SLOT)
    assert.equal(details.descriptor.id, 'approval-ledger-details')
    assert.equal(details.descriptor.order, 10)
    assert.equal(overlay.descriptor.name, OVERLAY_SLOT)
    assert.equal(overlay.descriptor.id, 'approval-ledger-inline')
    assert.equal(overlay.descriptor.order, 15)
    assert.deepEqual(Object.keys(harness.dictionaries), ['approvalLedger'])
  })

  it('keeps the zh/en dictionaries key-for-key and localizes slot labels', () => {
    const zhHarness = installedHarness({ locale: 'zh-CN' })
    const enHarness = installedHarness({ locale: 'en-US' })
    const zhDictionary = zhHarness.dictionaries.approvalLedger
    const enDictionary = enHarness.dictionaries.approvalLedger

    const zhKeys = Object.keys(zhDictionary.zh).sort()
    const approvalKeys = [
      'button',
      'callId',
      'close',
      'empty',
      'inlineLead',
      'inlineMissing',
      'inlineRisk',
      'inlineScope',
      'inlineTitle',
      'note',
      'reason',
      'summary',
      'title',
      'tool',
    ]
    for (const key of approvalKeys) assert.ok(zhKeys.includes(key), key)
    // The settings panel adds its own strings; they must stay paired too.
    const settingsKeys = [
      'groupEvents',
      'groupOther',
      'groupSwitches',
      'groupTurnEnd',
      'notificationsTitle',
      'saveFailed',
      'saving',
      'settingsLead',
      'settingsTitle',
      'turnBadgeSecondsTitle',
      'turnEndOnlyWhenAwayTitle',
      'unavailable',
    ]
    for (const key of settingsKeys) assert.ok(zhKeys.includes(key), key)
    assert.deepEqual(Object.keys(enDictionary.en).sort(), zhKeys)

    for (const key of zhKeys) {
      assert.equal(typeof enDictionary.en[key], 'string', key)
      assert.notEqual(enDictionary.en[key].length, 0, `${key} must be translated`)
      assert.notEqual(zhDictionary.zh[key], enDictionary.en[key], `${key} must actually differ by locale`)
    }

    const label = (harness: ReturnType<typeof makeHarness>, id: string): string => {
      const registration = harness.registrations.find((entry) => entry.descriptor.id === id)
      assert.ok(registration?.descriptor.label, `missing label for ${id}`)
      return registration.descriptor.label()
    }

    assert.equal(label(zhHarness, 'approval-ledger-details'), '审批详情')
    assert.equal(label(zhHarness, 'approval-ledger-inline'), '待审批说明')
    assert.equal(label(enHarness, 'approval-ledger-details'), 'Approval details')
    assert.equal(label(enHarness, 'approval-ledger-inline'), 'Approval note')
  })

  it('rethrows and logs a broken slots service instead of failing silently', () => {
    const logged: any[][] = []
    const originalError = console.error
    console.error = (...args: any[]) => {
      logged.push(args)
    }
    try {
      assert.throws(
        () => makeHarness({ failInjectAt: OVERLAY_SLOT }),
        /slots\.inject failed: shell\.overlay/,
      )
    } finally {
      console.error = originalError
    }
    assert.equal(logged.length, 1)
    assert.match(String(logged[0][0]), /client apply failed/)
    assert.match(String(logged[0][1]), /slots\.inject failed/)
  })
})

// --- header details component ----------------------------------------------

describe('header approval details', () => {
  it('stays closed by default, marks a pending approval, and opens the details dialog', () => {
    const harness = installedHarness({
      statuses: { s1: status(approval()) },
      sessionId: 's1',
    })
    const renderer = harness.mount(HEADER_SLOT)

    assert.equal(renderer.text(), '审批详情')
    assert.equal(renderer.find(isDialog), undefined, 'dialog is closed initially')
    assert.ok(renderer.find(isPendingDot), 'a pending approval renders the dot')

    const collapsed = renderer.find((node) => node.type === 'button')
    assert.equal(collapsed?.props['aria-expanded'], false)

    renderer.click('审批详情')

    const dialog = renderer.find(isDialog)
    assert.ok(dialog, 'clicking the button opens the dialog')
    assert.equal(dialog.props['aria-modal'], 'true')
    assert.equal(dialog.props['aria-label'], '待审批操作')

    const text = renderer.text()
    for (const expected of [
      '待审批操作',
      '工具: 写入文件',
      '调用: call-1',
      '摘要: 写入报告',
      '计划批准只登记授权；实际执行仍会重新判风险。',
      '自动表示可能直接放行；手动表示仍需在官方审批卡上确认。',
      '完全访问表示允许访问工作区外的文件或系统。',
      '严重风险永不自动放行；未知风险保持手动。',
      '这是只读详情。允许/拒绝仍请在官方审批卡上操作。计划批准只登记授权，实际调用还会重新判风险。',
    ]) {
      assert.ok(text.includes(expected), `dialog text is missing: ${expected}`)
    }
    assert.equal(renderer.findAll(isListItem).length, 4)

    const expanded = renderer.find(
      (node) => node.type === 'button' && node.props['aria-label'] === '审批详情',
    )
    assert.equal(expanded?.props['aria-expanded'], true)
  })

  it('shows the empty state and hides the dot when the pending interaction is not an approval', () => {
    const harness = installedHarness({
      statuses: { s1: status({ kind: 'question' }) },
      sessionId: 's1',
    })
    const renderer = harness.mount(HEADER_SLOT)
    assert.equal(renderer.find(isPendingDot), undefined)

    renderer.click('审批详情')
    assert.match(renderer.text(), /当前没有待审批的审批卡。/)
    assert.equal(renderer.findAll(isListItem).length, 0)
  })

  it('needs a sessionId: the header affordance never scans other sessions', () => {
    const harness = installedHarness({ statuses: { s1: status(approval()) } })
    const renderer = harness.mount(HEADER_SLOT)
    assert.equal(renderer.find(isPendingDot), undefined)

    renderer.click('审批详情')
    assert.match(renderer.text(), /当前没有待审批的审批卡。/)
  })

  it('localizes known tool names and keeps unknown or empty names explicit', () => {
    const cases: Array<[string | undefined, string]> = [
      ['write', '写入文件'],
      ['edit', '编辑文件'],
      ['pwsh', 'PowerShell 命令'],
      ['request_approvals', '提交审批计划'],
      ['apply_patch', '应用补丁'],
      ['frobnicate', '其他工具'],
      ['', '未知工具'],
      [undefined, '未知工具'],
    ]

    for (const [toolName, expected] of cases) {
      const harness = installedHarness({
        statuses: { s1: status(approval({ toolName })) },
        sessionId: 's1',
      })
      const renderer = harness.mount(HEADER_SLOT)
      renderer.click('审批详情')
      assert.ok(
        renderer.text().includes(`工具: ${expected}`),
        `toolName ${String(toolName)} should render ${expected}`,
      )
    }
  })

  it('falls back to an em dash when no readable summary exists', () => {
    const harness = installedHarness({
      statuses: { s1: status(approval({ displayReason: undefined })) },
      sessionId: 's1',
    })
    const renderer = harness.mount(HEADER_SLOT)
    renderer.click('审批详情')
    assert.ok(renderer.text().includes('摘要: —'))
  })

  it('accepts a plain-string reason and falls back to English when zh is absent', () => {
    const stringReason = installedHarness({
      statuses: { s1: status(approval({ displayReason: '原始原因文本' })) },
      sessionId: 's1',
    })
    const stringRenderer = stringReason.mount(HEADER_SLOT)
    stringRenderer.click('审批详情')
    assert.ok(stringRenderer.text().includes('摘要: 原始原因文本'))

    const englishOnly = installedHarness({
      statuses: { s1: status(approval({ displayReason: { en: 'Only English' } })) },
      sessionId: 's1',
    })
    const englishRenderer = englishOnly.mount(HEADER_SLOT)
    englishRenderer.click('审批详情')
    assert.ok(englishRenderer.text().includes('摘要: Only English'))
  })

  it('closes on Escape and detaches its keydown listener', () => {
    const harness = installedHarness({
      statuses: { s1: status(approval()) },
      sessionId: 's1',
    })
    const renderer = harness.mount(HEADER_SLOT)
    renderer.click('审批详情')
    assert.equal(listenerCount('keydown'), 1)

    const [handler] = [...(listeners.get('keydown') ?? [])]
    assert.ok(handler)
    handler({ key: 'Enter' })
    renderer.rerender()
    assert.ok(renderer.find(isDialog), 'other keys keep the dialog open')

    handler({ key: 'Escape' })
    renderer.rerender()
    assert.equal(renderer.find(isDialog), undefined)
    assert.equal(listenerCount('keydown'), 0)
  })

  it('marks the document title while pending and restores it on unmount', () => {
    const harness = installedHarness({
      statuses: { s1: status(approval()) },
      sessionId: 's1',
    })
    const renderer = harness.mount(HEADER_SLOT)
    assert.equal(fakeDocument.title, '● DSH')

    renderer.unmount()
    assert.equal(fakeDocument.title, 'DSH')
  })

  it('leaves the document title alone when nothing is pending', () => {
    const harness = installedHarness({ sessionId: 's1' })
    harness.mount(HEADER_SLOT)
    assert.equal(fakeDocument.title, 'DSH')
  })
})

// --- overlay fallback -------------------------------------------------------

describe('overlay pending-approval selection', () => {
  it('finds an approval by scanning sessions when the overlay has no sessionId', () => {
    const harness = installedHarness({
      statuses: {
        question: status({ kind: 'question' }),
        pending: status(approval()),
      },
    })
    const renderer = harness.mount(OVERLAY_SLOT)

    const section = renderer.find(
      (node) => node.type === 'section' && node.props['aria-label'] === '待审批说明',
    )
    assert.ok(section, 'the inline note renders')
    assert.ok(renderer.text().includes('写入报告'))
    assert.equal(renderer.findAll(isListItem).length, 3)
  })

  it('prefers the approval of the given session over an earlier scanned one', () => {
    const harness = installedHarness({
      statuses: {
        first: status(approval({ displayReason: '第一个原因' })),
        current: status(approval({ displayReason: '当前会话原因' })),
      },
      sessionId: 'current',
    })
    const text = harness.mount(OVERLAY_SLOT).text()
    assert.ok(text.includes('当前会话原因'))
    assert.equal(text.includes('第一个原因'), false)
  })

  it('falls back to scanning when the given session has no approval pending', () => {
    // The overlay is frame-wide: a session whose pending interaction is a
    // question must not hide an approval that is pending elsewhere.
    const harness = installedHarness({
      statuses: {
        current: status({ kind: 'question' }),
        other: status(approval({ displayReason: '其他会话原因' })),
      },
      sessionId: 'current',
    })
    const text = harness.mount(OVERLAY_SLOT).text()
    assert.ok(text.includes('其他会话原因'))
  })

  it('falls back to scanning when the given sessionId is unknown', () => {
    const harness = installedHarness({
      statuses: { other: status(approval({ displayReason: '兜底原因' })) },
      sessionId: 'missing',
    })
    assert.ok(harness.mount(OVERLAY_SLOT).text().includes('兜底原因'))
  })

  it('takes the first approval encountered in snapshot order', () => {
    const harness = installedHarness({
      statuses: {
        a: status(approval({ displayReason: '第一个原因' })),
        b: status(approval({ displayReason: '第二个原因' })),
      },
    })
    const renderer = harness.mount(OVERLAY_SLOT)
    const text = renderer.text()
    assert.ok(text.includes('第一个原因'))
    assert.equal(text.includes('第二个原因'), false)
  })

  it('mounts nothing when there is no approval to show', () => {
    const nullSnapshot = installedHarness({ snapshot: null }).mount(OVERLAY_SLOT)
    assert.equal(
      nullSnapshot.tree,
      null,
      'the fixed wrapper must not be mounted without a note to render',
    )
    assert.equal(nullSnapshot.find(isInlineNote), undefined)

    const noForEach = installedHarness({ snapshot: { get: () => undefined } }).mount(OVERLAY_SLOT)
    assert.equal(noForEach.tree, null)

    const questionsOnly = installedHarness({
      statuses: { a: status({ kind: 'question' }), b: status({ kind: 'question' }) },
    }).mount(OVERLAY_SLOT)
    assert.equal(questionsOnly.tree, null)
  })

  it('still scans when the snapshot has forEach but no get', () => {
    const harness = installedHarness({
      sessionId: 's1',
      snapshot: {
        forEach(visit: (status: any, sessionId: string) => void) {
          visit(status(approval()), 's1')
        },
      },
    })
    const renderer = harness.mount(OVERLAY_SLOT)
    assert.ok(renderer.text().includes('写入报告'))
  })

  it('shows the missing-summary note and accepts a plain-string reason', () => {
    const missing = installedHarness({
      statuses: { s1: status(approval({ displayReason: undefined })) },
    })
    assert.ok(
      missing.mount(OVERLAY_SLOT).text().includes('系统未生成可读摘要，请以官方审批卡为准。'),
    )

    const stringReason = installedHarness({
      statuses: { s1: status(approval({ displayReason: '字符串原因' })) },
    })
    assert.ok(stringReason.mount(OVERLAY_SLOT).text().includes('字符串原因'))
  })
})

// --- locale switching -------------------------------------------------------

describe('client locale switching', () => {
  it('renders the English shell around the Chinese tool/summary contract', () => {
    const harness = installedHarness({
      locale: 'en-US',
      statuses: { s1: status(approval()) },
      sessionId: 's1',
    })
    const renderer = harness.mount(HEADER_SLOT)
    assert.equal(renderer.text(), 'Approval details')
    renderer.click('Approval details')

    const text = renderer.text()
    assert.ok(text.includes('Pending approval'))
    assert.ok(text.includes('Tool: 写入文件'))
    assert.ok(text.includes('Call: call-1'))
    assert.ok(text.includes('Summary: 写入报告'))
    assert.ok(text.includes('Read-only details. Allow or reject on the official approval card.'))

    const overlay = installedHarness({
      locale: 'en-US',
      statuses: { s1: status(approval()) },
    }).mount(OVERLAY_SLOT)
    assert.ok(
      overlay.find((node) => node.type === 'section' && node.props['aria-label'] === 'Approval note'),
    )
    assert.ok(overlay.text().includes('Read this note, then choose Allow or Reject on the official card below.'))
    assert.ok(overlay.text().includes('写入报告'))
  })
})

// --- reminder settings panel ------------------------------------------------

const SETTINGS_SLOT = 'settings.section'

function settingsHarness(
  formOptions: Parameters<typeof makeConfigForm>[0] = {},
  options: { locale?: string; served?: boolean } = {},
) {
  const { form, calls } = makeConfigForm(formOptions)
  const configForms = makeConfigForms(form, options.served !== false)
  const harness = installedHarness({ locale: options.locale, configForms })
  return { harness, form, calls, configForms }
}

function findSwitch(tree: RenderedTree, field: string): any {
  return tree.find((node) => node.type === 'button' && node.props['data-field'] === field)
}

function findNumber(tree: RenderedTree, field: string): any {
  return tree.find((node) => node.type === 'input' && node.props['data-field'] === field)
}

describe('reminder settings panel', () => {
  it('registers settings.section only while the Host serves the entry', () => {
    const { harness, configForms } = settingsHarness()
    const registration = harness.registrations.find(
      (entry) => entry.descriptor.name === SETTINGS_SLOT,
    )
    assert.ok(registration, 'the settings section is registered')
    assert.equal(registration.descriptor.id, 'approval-ledger')
    assert.equal(registration.descriptor.order, 40)
    const label = registration.descriptor.label
    assert.ok(label, 'the section has a label')
    assert.equal(label(), '审批与提醒')
    assert.deepEqual(configForms.calls.watched, [['approval-ledger']])
    assert.deepEqual(configForms.calls.gets, ['approval-ledger'])

    const absent = settingsHarness({}, { served: false })
    assert.equal(
      absent.harness.registrations.find((entry) => entry.descriptor.name === SETTINGS_SLOT),
      undefined,
      'no panel when the namespace is not served',
    )
  })

  it('renders the five groups and keeps other settings in cordis.patch.yml', () => {
    const tree = settingsHarness().harness.mount(SETTINGS_SLOT)
    const text = tree.text()
    for (const expected of [
      '审批与提醒',
      '自动放行',
      '新会话默认自动放行',
      '提醒开关',
      '哪些事件提醒',
      '完成提醒',
      '其它',
      '启用提醒',
      '任务栏闪烁',
      '提示音',
      '计划审阅卡',
      '问题与逐项勾选卡',
      '官方审批卡',
      '每轮对话完成',
      '窗口在前台时不提醒',
      '绿色徽标保留时长',
      '未处理时重复提醒',
      'cordis.patch.yml',
    ]) {
      assert.ok(text.includes(expected), `panel text is missing: ${expected}`)
    }
    assert.ok(findSwitch(tree, 'notifications'), 'master switch')
    assert.ok(findSwitch(tree, 'autoAllowSessions'), 'new-session auto-allow switch')
    assert.ok(findNumber(tree, 'turnBadgeSeconds'), 'badge lifetime input')
    assert.ok(findNumber(tree, 'notifyRepeatSeconds'), 'repeat interval input')
  })

  it('writes each toggle through form.set with the exact field and value', async () => {
    const { harness, calls } = settingsHarness()
    const tree = harness.mount(SETTINGS_SLOT)

    const flash = findSwitch(tree, 'flashWindow')
    assert.equal(flash.props['aria-checked'], true)
    flash.props.onClick()
    await flushPromises()
    assert.deepEqual(calls.sets, [['flashWindow', false]])

    const sound = findSwitch(tree, 'soundAlert')
    sound.props.onClick()
    await flushPromises()
    assert.deepEqual(calls.sets[1], ['soundAlert', false])

    const master = findSwitch(tree, 'notifications')
    master.props.onClick()
    await flushPromises()
    assert.deepEqual(calls.sets[2], ['notifications', false])

    const autoAllow = findSwitch(tree, 'autoAllowSessions')
    assert.equal(autoAllow.props['aria-checked'], false)
    autoAllow.props.onClick()
    await flushPromises()
    assert.deepEqual(calls.sets[3], ['autoAllowSessions', true])
  })

  it('disables every other control when the master switch is off', () => {
    const tree = settingsHarness({ value: { notifications: false } }).harness.mount(SETTINGS_SLOT)

    const master = findSwitch(tree, 'notifications')
    assert.equal(master.props['aria-checked'], false)
    assert.equal(master.props.disabled, false)
    for (const field of [
      'flashWindow',
      'soundAlert',
      'notifyOnPlan',
      'notifyOnQuestion',
      'notifyOnApproval',
      'notifyOnTurnEnd',
      'turnEndOnlyWhenAway',
    ]) {
      assert.equal(findSwitch(tree, field).props.disabled, true, field)
      // The stored value is kept, only the interaction is blocked.
      assert.equal(findSwitch(tree, field).props['aria-checked'], true, field)
    }
    for (const field of ['turnBadgeSeconds', 'notifyRepeatSeconds']) {
      assert.equal(findNumber(tree, field).props.disabled, true, field)
    }
    // Auto-allow is an approval behavior, not an alert: the reminder master
    // switch must not lock it.
    const autoAllow = findSwitch(tree, 'autoAllowSessions')
    assert.equal(autoAllow.props.disabled, false)
    assert.equal(autoAllow.props['aria-checked'], false)
  })

  it('keeps the whole panel read-only when the form is not writable', async () => {
    const { harness, calls } = settingsHarness({ writable: false })
    const tree = harness.mount(SETTINGS_SLOT)

    assert.match(tree.text(), /只读/)
    assert.equal(findSwitch(tree, 'flashWindow').props.disabled, true)
    assert.equal(findNumber(tree, 'turnBadgeSeconds').props.disabled, true)
    const flash = findSwitch(tree, 'flashWindow')
    if (typeof flash.props.onClick === 'function') flash.props.onClick()
    await flushPromises()
    assert.deepEqual(calls.sets, [])
  })

  it('clamps numeric input to the documented range on blur or Enter', async () => {
    const { harness, calls } = settingsHarness({ value: { notifyRepeatSeconds: 30 } })
    const tree = harness.mount(SETTINGS_SLOT)

    const badge = findNumber(tree, 'turnBadgeSeconds')
    assert.equal(badge.props.min, 0)
    assert.equal(badge.props.max, 3600)
    badge.props.onChange({ target: { value: '9999' } })
    findNumber(tree, 'turnBadgeSeconds').props.onBlur()
    await flushPromises()
    assert.deepEqual(calls.sets, [['turnBadgeSeconds', 3600]])

    const repeat = findNumber(tree, 'notifyRepeatSeconds')
    assert.equal(repeat.props.min, 0)
    assert.equal(repeat.props.max, 600)
    repeat.props.onChange({ target: { value: '-5' } })
    findNumber(tree, 'notifyRepeatSeconds').props.onKeyDown({
      key: 'Enter',
      preventDefault() {},
    })
    await flushPromises()
    assert.deepEqual(calls.sets[1], ['notifyRepeatSeconds', 0])
  })

  it('shows saving and saved feedback', async () => {
    let settle: (accepted: boolean) => void = () => {}
    const pending = new Promise<boolean>((resolve) => {
      settle = resolve
    })
    const { harness } = settingsHarness({ setResult: pending })
    const tree = harness.mount(SETTINGS_SLOT)

    findSwitch(tree, 'turnEndOnlyWhenAway').props.onClick()
    assert.ok(tree.text().includes('保存中'), 'a pending write is visible')

    settle(true)
    await flushPromises()
    assert.ok(tree.text().includes('已保存'))
  })

  it('rolls back the shown value when the Host rejects the write', async () => {
    const { harness } = settingsHarness({ setResult: Promise.resolve(false) })
    const tree = harness.mount(SETTINGS_SLOT)

    findSwitch(tree, 'flashWindow').props.onClick()
    assert.equal(findSwitch(tree, 'flashWindow').props['aria-checked'], false, 'optimistic value')

    await flushPromises()
    assert.equal(findSwitch(tree, 'flashWindow').props['aria-checked'], true, 'rolled back')
    assert.match(tree.text(), /保存失败/)
  })

  it('localizes the panel and its navigation label', () => {
    const { harness } = settingsHarness({}, { locale: 'en-US' })
    const tree = harness.mount(SETTINGS_SLOT)
    assert.ok(tree.text().includes('Approvals & alerts'))
    assert.ok(tree.text().includes('Stay quiet while in front'))
    assert.ok(tree.text().includes('cordis.patch.yml'))

    const registration = harness.registrations.find(
      (entry) => entry.descriptor.name === SETTINGS_SLOT,
    )
    const label = registration?.descriptor.label
    assert.ok(label, 'the section has a label')
    assert.equal(label(), 'Approvals & alerts')
  })
})
