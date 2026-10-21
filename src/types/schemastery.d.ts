/**
 * Minimal ambient declaration for the Schemastery build shipped inside the DSH
 * installation (3.18.5).
 *
 * `@deepseek-ai/schemastery` is resolved at runtime by the DSH profile boot
 * (installation dependency closure, see `docs/runtime-notes.md`). It is
 * deliberately NOT a dependency of this package: no `package.json` entry, no
 * lockfile change. Only the members used by `src/config-schema.ts` are declared.
 */
declare module '@deepseek-ai/schemastery' {
  /** One schema node. The chain methods used by the reminder form are declarable here. */
  export interface Schema {
    default(value: unknown): Schema
    min(value: number): Schema
    max(value: number): Schema
    volatile(): Schema
    loose(): Schema
  }

  /** The object schema exported as `Config` (and serialized by `toJSON`). */
  export interface ObjectSchema extends Schema {
    readonly type: 'object'
    readonly dict: Record<string, Schema>
  }

  /** Public shape of the exported `Config` schema. */
  export type Config = ObjectSchema

  export interface SchemaFactory {
    object(dict: Record<string, Schema>): ObjectSchema
    boolean(): Schema
    number(): Schema
  }

  const Schema: SchemaFactory
  export default Schema
}
