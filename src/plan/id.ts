import { randomBytes } from 'node:crypto'

const PLAN_ID_PATTERN = /^[a-f0-9]{8}$/i

/** Plan ids are short and opaque, e.g. `P-7f3a2c91`. */
export function createPlanId(randomHex?: () => string): string {
  const value = randomHex === undefined ? randomBytes(4).toString('hex') : randomHex()
  if (typeof value !== 'string' || !PLAN_ID_PATTERN.test(value)) {
    throw new Error('plan id generator must return 8 hexadecimal characters')
  }
  return `P-${value.toLowerCase()}`
}

export function isPlanId(value: unknown): value is string {
  return typeof value === 'string' && /^P-[a-f0-9]{8}$/.test(value)
}
