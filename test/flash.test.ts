import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  alertPending,
  alertTurnEnd,
  buildAlertScript,
  buildFlashScript,
  buildTurnEndScript,
  flashApprovalWindow,
  shouldAlert,
  shouldFlash,
  TURN_END_CHIME,
  APPROVAL_CHIME,
} from '../src/notify/flash.js'

function spawnedScript(onlyWhenAway: boolean): string {
  let args: string[] = []
  alertTurnEnd({
    flash: true,
    sound: true,
    badge: true,
    badgeSeconds: 120,
    onlyWhenAway,
    platform: 'win32',
    spawnImpl: ((_file: string, nextArgs: string[]) => {
      args = nextArgs
      return { on() {}, unref() {} } as never
    }) as never,
  })
  const encoded = args[args.indexOf('-EncodedCommand') + 1] ?? ''
  return Buffer.from(encoded, 'base64').toString('utf16le')
}

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

describe('Windows turn-complete alerts', () => {
  it('uses static helpers for the overlay icon instead of the COM object', () => {
    const script = buildTurnEndScript({ flash: true, badgeSeconds: 30 })
    // PowerShell cannot dispatch the ITaskbarList3 members through the
    // projected coclass, so the call must stay inside C#.
    assert.ok(script.includes('[DshApprovalBadge]::ShowOverlay($dshBadgeTarget, $dshBadgeIcon)'))
    assert.ok(script.includes('[DshApprovalBadge]::ClearOverlay($dshBadgeTarget)'))
    assert.equal(script.includes('$dshBadgeBar.SetOverlayIcon'), false)
    assert.ok(script.includes("Guid(\"ea1afb91-9e28-4b86-90e9-9e9f8a5eefaf\")"))
  })

  it('clears the badge when the window returns or the lifetime expires', () => {
    const script = buildTurnEndScript({ flash: true, badgeSeconds: 45 })
    assert.ok(script.includes('GetForegroundWindow'))
    assert.ok(script.includes('Start-Sleep -Milliseconds 450'))
    assert.ok(script.includes('$dshBadgeSeconds = 45'))
  })

  it('skips the badge when the look-here channel is off', () => {
    const script = buildTurnEndScript({ flash: false, sound: true })
    assert.equal(script.includes('SetOverlayIcon'), false)
  })

  it('keeps the completion chime short and rising, unlike the approval chime', () => {
    const approval = APPROVAL_CHIME.notes
    const turn = TURN_END_CHIME.notes
    assert.equal(turn.length, 2)
    assert.ok(turn[1].frequency > turn[0].frequency)
    assert.ok(approval[1].frequency < approval[0].frequency)
    for (const note of turn) assert.ok(note.duration <= 0.1)
    assert.ok(turn[0].duration + turn[1].duration < approval[0].duration + approval[1].duration)
  })

  it('skips the whole alert when the harness window is already foreground', () => {
    const script = buildTurnEndScript({ onlyWhenAway: true })
    assert.ok(script.includes('DshApprovalAway'))
    assert.ok(script.includes('exit 0'))
    assert.ok(script.includes('[DshApprovalAway]::GetForegroundWindow() -eq $dshAwayTarget'))
    // The gate must run before the flash, badge, and sound parts.
    const gate = script.indexOf('DshApprovalAway')
    for (const later of ['DshApprovalFlash', 'DshApprovalBadge', 'dshOk']) {
      assert.ok(script.indexOf(later) > gate, later)
    }
    // A missing window must keep alerting, so `exit 0` needs a found target.
    assert.ok(script.includes('$dshAwayTarget -ne [IntPtr]::Zero -and'))
    assert.match(
      script,
      /\[DshApprovalAway\]::GetForegroundWindow\(\) -eq \$dshAwayTarget\) \{ exit 0 \}/,
    )
  })

  it('alerts unconditionally when the foreground gate is off', () => {
    const script = buildTurnEndScript({ onlyWhenAway: false })
    assert.equal(script.includes('DshApprovalAway'), false)
    assert.equal(script.includes('exit 0'), false)
  })

  it('keeps the foreground gate for a sound-only completion alert', () => {
    const script = buildTurnEndScript({ flash: false, sound: true, onlyWhenAway: true })
    assert.ok(script.includes('DshApprovalAway'))
    assert.equal(script.includes('DshApprovalFlash'), false)
    assert.equal(script.includes('DshApprovalBadge'), false)
    assert.ok(script.includes('System.Media.SoundPlayer'))
  })

  it('never adds the foreground gate to approval alerts', () => {
    const script = buildAlertScript({ flash: true, sound: true })
    assert.equal(script.includes('DshApprovalAway'), false)
    assert.equal(script.includes('exit 0'), false)
  })

  it('passes onlyWhenAway through the spawned turn-end command', () => {
    assert.ok(spawnedScript(true).includes('exit 0'))
    assert.equal(spawnedScript(false).includes('exit 0'), false)
  })
})
