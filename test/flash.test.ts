import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  alertPending,
  buildAlertScript,
  buildFlashScript,
  flashApprovalWindow,
  shouldAlert,
  shouldFlash,
} from '../src/notify/flash.js'

describe('Windows pending alerts', () => {
  it('is Windows-only and needs at least one channel', () => {
    assert.equal(shouldAlert({ flash: true, sound: false, platform: 'win32' }), true)
    assert.equal(shouldAlert({ flash: false, sound: true, platform: 'win32' }), true)
    assert.equal(shouldAlert({ flash: false, sound: false, platform: 'win32' }), false)
    assert.equal(shouldAlert({ flash: true, sound: true, platform: 'linux' }), false)
  })

  it('builds independent flash and sound scripts', () => {
    const flashOnly = buildAlertScript({ flash: true, sound: false })
    assert.match(flashOnly, /FlashWindowEx/)
    assert.doesNotMatch(flashOnly, /SystemSounds/)

    const soundOnly = buildAlertScript({ flash: false, sound: true })
    assert.doesNotMatch(soundOnly, /FlashWindowEx/)
    assert.match(soundOnly, /System\.Media\.SoundPlayer/)
    assert.match(soundOnly, /783\.99/)

    const both = buildAlertScript({ flash: true, sound: true })
    assert.match(both, /FlashWindowEx/)
    assert.match(both, /System\.Media\.SoundPlayer/)
    assert.doesNotMatch(both, /\$\{/)
  })

  it('does not spawn when both channels are off', () => {
    let calls = 0
    alertPending({
      flash: false,
      sound: false,
      platform: 'win32',
      spawnImpl: (() => {
        calls += 1
        return { on() {}, unref() {} } as never
      }) as never,
    })
    assert.equal(calls, 0)
  })

  it('spawns one hidden PowerShell for both channels', () => {
    let args: string[] = []
    let calls = 0
    alertPending({
      flash: true,
      sound: true,
      platform: 'win32',
      spawnImpl: ((_file: string, nextArgs: string[]) => {
        calls += 1
        args = nextArgs
        return { on() {}, unref() {} } as never
      }) as never,
    })
    assert.equal(calls, 1)
    const encoded = args[args.indexOf('-EncodedCommand') + 1] ?? ''
    const script = Buffer.from(encoded, 'base64').toString('utf16le')
    assert.match(script, /FlashWindowEx/)
    assert.match(script, /System\.Media\.SoundPlayer/)
  })
})

describe('Windows approval flash', () => {
  it('is opt-in and Windows-only', () => {
    assert.equal(shouldFlash({ enabled: true, platform: 'win32' }), true)
    assert.equal(shouldFlash({ enabled: false, platform: 'win32' }), false)
    assert.equal(shouldFlash({ enabled: true, platform: 'linux' }), false)
  })

  it('builds a self-contained FlashWindowEx script and sanitizes the process name', () => {
    const script = buildFlashScript('DeepSeek Harness')
    assert.match(script, /FlashWindowEx/)
    assert.match(script, /FindWindowByTitle/)
    assert.match(script, /EnumWindows/)
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
    assert.ok(args.includes('-WindowStyle'))
    // The child must not be detached or created with CREATE_NO_WINDOW: both
    // make powershell.exe exit before running `-EncodedCommand` on the desktop
    // runtime, which silently kills the alert.
    assert.equal((options as { windowsHide?: boolean }).windowsHide, undefined)
    assert.equal((options as { detached?: boolean }).detached, undefined)
    assert.equal((options as { stdio?: string }).stdio, 'ignore')
    const encoded = args[args.indexOf('-EncodedCommand') + 1] ?? ''
    assert.ok(encoded.length > 0)
    assert.match(Buffer.from(encoded, 'base64').toString('utf16le'), /FlashWindowEx/)
  })
})
