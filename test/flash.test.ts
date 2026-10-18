import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildFlashScript, flashApprovalWindow, shouldFlash } from '../src/notify/flash.js'

describe('Windows approval flash', () => {
  it('is opt-in and Windows-only', () => {
    assert.equal(shouldFlash({ enabled: true, platform: 'win32' }), true)
    assert.equal(shouldFlash({ enabled: false, platform: 'win32' }), false)
    assert.equal(shouldFlash({ enabled: true, platform: 'linux' }), false)
  })

  it('builds a self-contained FlashWindowEx script and sanitizes the process name', () => {
    const script = buildFlashScript('DeepSeek Harness')
    assert.match(script, /FlashWindowEx/)
    assert.match(script, /DeepSeek Harness/)
    const injected = buildFlashScript("x'; Remove-Item C:\\\\temp -Recurse -Force #")
    assert.equal(injected.includes("x'; Remove-Item C:\\\\temp"), false)
    assert.equal(injected.includes("';"), false)
  })

  it('does not spawn when disabled or on a non-Windows platform', () => {
    let calls = 0
    flashApprovalWindow({
      enabled: false,
      platform: 'win32',
      spawnImpl: (() => {
        calls += 1
        return { on() {}, unref() {} } as never
      }) as never,
    })
    flashApprovalWindow({
      enabled: true,
      platform: 'linux',
      spawnImpl: (() => {
        calls += 1
        return { on() {}, unref() {} } as never
      }) as never,
    })
    assert.equal(calls, 0)
  })

  it('spawns a hidden encoded PowerShell command when enabled on Windows', () => {
    let args: string[] = []
    let options: unknown
    flashApprovalWindow({
      enabled: true,
      platform: 'win32',
      spawnImpl: ((_file: string, nextArgs: string[], nextOptions: unknown) => {
        args = nextArgs
        options = nextOptions
        return { on() {}, unref() {} } as never
      }) as never,
    })
    assert.ok(args.includes('-EncodedCommand'))
    assert.equal((options as { windowsHide?: boolean }).windowsHide, true)
    const encoded = args[args.indexOf('-EncodedCommand') + 1] ?? ''
    assert.ok(encoded.length > 0)
    assert.match(Buffer.from(encoded, 'base64').toString('utf16le'), /FlashWindowEx/)
  })
})
