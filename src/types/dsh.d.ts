/**
 * Compatibility shim: the emitted structural type surface lives in
 * `dsh-runtime.ts` so `tsc` writes a declaration next to the compiled plugin.
 *
 * @deprecated import from `./dsh-runtime.js` instead.
 */
export * from './dsh-runtime.js'
