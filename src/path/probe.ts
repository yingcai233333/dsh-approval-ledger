import type { PathProbe } from './types.js'

/** Probe that never resolves symlinks; use only for already-canonical paths. */
export const lexicalProbe: PathProbe = {
  realpath: () => undefined,
  isDirectory: () => undefined,
}
