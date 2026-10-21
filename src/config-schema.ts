/**
 * Host-side partial config schema for the reminder settings panel.
 *
 * DSH turns the volatile fields of a plugin's exported `Config` into a settings
 * form (`dsh-settings` → `configForms` in the client half). Only the ten
 * reminder/display switches are declared: `mode`, the risk policy, plan limits,
 * and audit retention stay YAML-only, so the panel can never weaken the
 * approval policy. Undeclared keys pass through Schemastery untouched and keep
 * flowing into `sanitizeConfig` exactly as before.
 *
 * The schema is built lazily: `@deepseek-ai/schemastery` is provided by the DSH
 * installation at runtime (see `docs/runtime-notes.md`) and is not a dependency
 * of this package, so plain-Node tests simply get `Config === undefined` and the
 * plugin falls back to the YAML path.
 */
import { DEFAULT_CONFIG } from './config.js'
import type { PluginConfig } from './config.js'

export type ReminderFieldKind = 'boolean' | 'number'

/** One settings-panel field: key, kind, default, and optional numeric range. */
export interface ReminderField {
  key: keyof PluginConfig & string
  kind: ReminderFieldKind
  default: boolean | number
  min?: number
  max?: number
}

/**
 * The exact fields the panel exposes, in declaration order. Every default is
 * read from `DEFAULT_CONFIG`, so the schema and the YAML fallback can never
 * disagree.
 */
export const REMINDER_FIELDS: readonly ReminderField[] = [
  { key: 'notifications', kind: 'boolean', default: DEFAULT_CONFIG.notifications },
  { key: 'flashWindow', kind: 'boolean', default: DEFAULT_CONFIG.flashWindow },
  { key: 'soundAlert', kind: 'boolean', default: DEFAULT_CONFIG.soundAlert },
  { key: 'notifyOnPlan', kind: 'boolean', default: DEFAULT_CONFIG.notifyOnPlan },
  { key: 'notifyOnQuestion', kind: 'boolean', default: DEFAULT_CONFIG.notifyOnQuestion },
  { key: 'notifyOnApproval', kind: 'boolean', default: DEFAULT_CONFIG.notifyOnApproval },
  { key: 'notifyOnTurnEnd', kind: 'boolean', default: DEFAULT_CONFIG.notifyOnTurnEnd },
  {
    key: 'turnEndOnlyWhenAway',
    kind: 'boolean',
    default: DEFAULT_CONFIG.turnEndOnlyWhenAway,
  },
  {
    key: 'notifyRepeatSeconds',
    kind: 'number',
    default: DEFAULT_CONFIG.notifyRepeatSeconds,
    min: 0,
    max: 600,
  },
  {
    key: 'turnBadgeSeconds',
    kind: 'number',
    default: DEFAULT_CONFIG.turnBadgeSeconds,
    min: 0,
    max: 3600,
  },
]

interface FieldSchema {
  min(value: number): FieldSchema
  max(value: number): FieldSchema
  default(value: unknown): FieldSchema
  volatile(): FieldSchema
  loose(): FieldSchema
}

interface SchemaFactoryLike {
  object(dict: Record<string, FieldSchema>): unknown
  boolean(): FieldSchema
  number(): FieldSchema
}

function isSchemaFactory(value: unknown): value is SchemaFactoryLike {
  if (value === null) return false
  // The real Schemastery default export is a callable function carrying static
  // builders (`Schema.object`, `Schema.boolean`, ...), so functions are valid.
  if (typeof value !== 'object' && typeof value !== 'function') return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.object === 'function' &&
    typeof candidate.boolean === 'function' &&
    typeof candidate.number === 'function'
  )
}

/**
 * Build the partial `Config` from a Schemastery factory. Returns `undefined`
 * when the runtime module is unavailable, which makes Cordis skip schema
 * validation and keeps the plugin working from YAML alone.
 */
export function createConfigSchema(factory: unknown): unknown {
  if (!isSchemaFactory(factory)) return undefined
  const Schema = factory
  const dict: Record<string, FieldSchema> = {}
  for (const field of REMINDER_FIELDS) {
    let node = field.kind === 'boolean' ? Schema.boolean() : Schema.number()
    if (field.kind === 'number') {
      node = node.min(field.min ?? 0).max(field.max ?? 0)
    }
    node = node.default(field.default).volatile().loose()
    dict[field.key] = node
  }
  return Schema.object(dict)
}

interface SchemaNodeLike {
  meta?: { volatile?: unknown }
  type?: unknown
  dict?: Record<string, unknown>
}

/**
 * Schemastery schemas are callable functions carrying static properties, so a
 * node is anything non-null that is an object *or* a function.
 */
function isSchemaNode(value: unknown): value is SchemaNodeLike {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
}

/**
 * Project the volatile fields of a schema, mirroring the rule `dsh-settings`
 * uses to decide what the settings form offers. Exported so the schema contract
 * (exactly ten fields, nothing else) is testable without the DSH runtime.
 */
export function volatileFields(schema: unknown): Record<string, unknown> | undefined {
  if (!isSchemaNode(schema)) return undefined
  const node = schema
  if (node.meta?.volatile === true) return undefined
  if (node.type !== 'object' || node.dict === undefined) return undefined
  const fields: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(node.dict)) {
    if (isSchemaNode(child) && child.meta?.volatile === true) fields[key] = child
  }
  return Object.keys(fields).length === 0 ? undefined : fields
}

async function loadSchemastery(): Promise<unknown> {
  try {
    const module = (await import('@deepseek-ai/schemastery')) as { default?: unknown }
    return module.default ?? module
  } catch {
    // Plain-Node tests and any deployment without the DSH closure: YAML only.
    return undefined
  }
}

/**
 * The exported schema Cordis validates the plugin config with. `undefined` when
 * Schemastery is unresolvable; Cordis then skips validation (the YAML path).
 */
export const Config: unknown = createConfigSchema(await loadSchemastery())
