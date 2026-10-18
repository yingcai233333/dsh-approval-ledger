import { createHash } from 'node:crypto'

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex')
}

/** `sha256:<hex>` form used by audit target hashes. */
export function sha256Tag(input: string): string {
  return `sha256:${sha256Hex(input)}`
}
