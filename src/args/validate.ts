import { DANGEROUS_KEYS, hasOwn, isPlainObject, jsonEqual, stableStringify } from '../core/json.js'
import type { JsonObject, JsonValue } from '../core/types.js'

export interface ArgsLimits {
  maxDepth: number
  maxNodes: number
  maxKeys: number
  maxStringLength: number
  maxSerializedLength: number
}

export const DEFAULT_ARGS_LIMITS: ArgsLimits = {
  maxDepth: 8,
  maxNodes: 512,
  maxKeys: 64,
  maxStringLength: 2048,
  maxSerializedLength: 8192,
}

export type ArgsErrorCode =
  | 'not-object'
  | 'dangerous-key'
  | 'unsupported-type'
  | 'non-finite'
  | 'too-deep'
  | 'too-many-nodes'
  | 'too-many-keys'
  | 'string-too-long'
  | 'serialized-too-long'
  | 'circular'

export type ArgsValidation =
  | { ok: true; value: JsonObject; serialized: string }
  | { ok: false; code: ArgsErrorCode; message: string }

class ArgsError extends Error {
  readonly code: ArgsErrorCode

  constructor(code: ArgsErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

function cloneJson(input: unknown, depth: number, limits: ArgsLimits, state: { nodes: number; seen: WeakSet<object> }): JsonValue {
  state.nodes += 1
  if (state.nodes > limits.maxNodes) {
    throw new ArgsError('too-many-nodes', 'args contains too many values')
  }
  if (depth > limits.maxDepth) {
    throw new ArgsError('too-deep', 'args is nested too deeply')
  }

  if (input === null) return null
  switch (typeof input) {
    case 'string':
      if (input.length > limits.maxStringLength) {
        throw new ArgsError('string-too-long', 'args contains an over-long string')
      }
      return input
    case 'number':
      if (!Number.isFinite(input)) {
        throw new ArgsError('non-finite', 'args contains a non-finite number')
      }
      return input
    case 'boolean':
      return input
    case 'object':
      break
    default:
      throw new ArgsError('unsupported-type', 'args contains an unsupported value')
  }

  if (state.seen.has(input)) {
    throw new ArgsError('circular', 'args contains a circular reference')
  }
  state.seen.add(input)

  if (Array.isArray(input)) {
    const result: JsonValue[] = []
    for (const item of input) {
      result.push(cloneJson(item, depth + 1, limits, state))
    }
    return result
  }

  if (!isPlainObject(input)) {
    throw new ArgsError('unsupported-type', 'args contains a non-plain object')
  }
  const keys = Object.keys(input)
  if (keys.length > limits.maxKeys) {
    throw new ArgsError('too-many-keys', 'args object has too many keys')
  }
  const result: JsonObject = {}
  for (const key of keys) {
    if (DANGEROUS_KEYS.has(key)) {
      throw new ArgsError('dangerous-key', 'args contains a forbidden key')
    }
    if (!hasOwn(input, key)) continue
    result[key] = cloneJson(input[key], depth + 1, limits, state)
  }
  return result
}

export function validateArgs(value: unknown, limits: ArgsLimits = DEFAULT_ARGS_LIMITS): ArgsValidation {
  if (!isPlainObject(value)) {
    return { ok: false, code: 'not-object', message: 'args must be a plain object' }
  }
  try {
    const cloned = cloneJson(value, 0, limits, { nodes: 0, seen: new WeakSet() })
    if (!isPlainObject(cloned)) {
      return { ok: false, code: 'not-object', message: 'args must be a plain object' }
    }
    const serialized = stableStringify(cloned)
    if (serialized.length > limits.maxSerializedLength) {
      return { ok: false, code: 'serialized-too-long', message: 'args is too large' }
    }
    return { ok: true, value: cloned, serialized }
  } catch (error) {
    if (error instanceof ArgsError) {
      return { ok: false, code: error.code, message: error.message }
    }
    return { ok: false, code: 'unsupported-type', message: 'args could not be serialized' }
  }
}

function subset(allowed: JsonValue, actual: JsonValue): boolean {
  if (isPlainObject(allowed) && isPlainObject(actual)) {
    for (const key of Object.keys(allowed)) {
      if (!hasOwn(actual, key)) return false
      if (!subset(allowed[key] as JsonValue, actual[key] as JsonValue)) return false
    }
    return true
  }
  return jsonEqual(allowed, actual)
}

export type ArgsMatchReason =
  | 'invalid-actual'
  | 'invalid-scope'
  | 'empty-scope'
  | 'not-subset'

export interface ArgsMatch {
  matched: boolean
  reason?: ArgsMatchReason
}

/**
 * `allowed` must be a non-empty subset of `actual`.
 *
 * Arrays are compared exactly: a scope that approves `["a"]` never matches
 * `["a","b"]`.
 */
export function matchArgsScope(
  actual: unknown,
  allowed: unknown,
  limits: ArgsLimits = DEFAULT_ARGS_LIMITS,
): ArgsMatch {
  const actualResult = validateArgs(actual, limits)
  if (!actualResult.ok) return { matched: false, reason: 'invalid-actual' }
  const allowedResult = validateArgs(allowed, limits)
  if (!allowedResult.ok) return { matched: false, reason: 'invalid-scope' }
  if (Object.keys(allowedResult.value).length === 0) {
    return { matched: false, reason: 'empty-scope' }
  }
  return subset(allowedResult.value, actualResult.value)
    ? { matched: true }
    : { matched: false, reason: 'not-subset' }
}
