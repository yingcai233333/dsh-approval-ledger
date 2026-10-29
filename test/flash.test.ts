import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { inflateRawSync } from 'node:zlib'
import {
  alertPending,
  alertTurnEnd,
  buildAlertCommand,
  buildAlertScript,
  buildFlashScript,
  buildTurnEndScript,
  encodeAlertCommand,
  flashApprovalWindow,
  shouldAlert,
  shouldFlash,
  TURN_END_CHIME,
  APPROVAL_CHIME,
  WINDOWS_COMMAND_LINE_LIMIT,
} from '../src/notify/flash.js'

/** Unwrap the deflate stub a spawned `-EncodedCommand` argument carries. */
function decodeAlertCommand(encoded: string): string {
  const stub = Buffer.from(encoded, 'base64').toString('utf16le')
  const marker = "FromBase64String('"
  const start = stub.indexOf(marker) + marker.length
  const end = stub.indexOf("')", start)
  return inflateRawSync(Buffer.from(stub.slice(start, end), 'base64')).toString('utf8')
}

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
  return decodeAlertCommand(args[args.indexOf('-EncodedCommand') + 1] ?? '')
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
    const script = decodeAlertCommand(encoded)
    assert.match(script, /FlashWindowEx/)
    assert.match(script, /System\.Media\.SoundPlayer/)
  })

  it('keeps the stubbed command line far below the Windows ceiling', () => {
    // Regression for the 1.1.0 silent-alert bug: the raw turn-complete script
    // encoded to ~34,700 characters, over the 32,767 command-line limit, so
    // spawn threw ENAMETOOLONG and the best-effort wrapper swallowed it.
    for (const script of [
      buildAlertScript({ flash: true, sound: true, badge: true }),
      buildTurnEndScript({ onlyWhenAway: true }),
      buildTurnEndScript({ onlyWhenAway: false }),
    ]) {
      const encoded = encodeAlertCommand(script)
      assert.ok(
        encoded.length + 96 <= WINDOWS_COMMAND_LINE_LIMIT,
        `encoded alert command is ${encoded.length} chars`,
      )
      assert.ok(encoded.length < 20000, `encoded alert command is ${encoded.length} chars`)
      assert.equal(decodeAlertCommand(encoded), script)
    }
  })

  it('wraps the script in a single-line inflate stub', () => {
    const command = buildAlertCommand('Write-Output "hi"')
    assert.equal(command.includes('\n'), false)
    assert.ok(command.startsWith("Add-Type -AssemblyName System.IO.Compression;"))
    assert.match(command, /DeflateStream/)
    assert.match(command, /Invoke-Expression/)
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
    assert.match(decodeAlertCommand(encoded), /FlashWindowEx/)
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

  it('plays the chime before the badge watcher, not when the window returns', () => {
    // The badge part ends in a loop that waits for the window to come back, so a
    // chime emitted after it only plays on return (reported 2026-10-29 as "the
    // sound only fires when I open the window").
    const script = buildTurnEndScript({ flash: true, sound: true, badgeSeconds: 0 })
    const sound = script.indexOf('System.Media.SoundPlayer')
    assert.ok(sound > 0)
    assert.ok(script.indexOf('PlaySync') > sound)
    assert.ok(sound < script.indexOf('Start-Sleep -Milliseconds 450'), 'chime must precede the badge wait loop')
    assert.ok(sound < script.indexOf('[DshApprovalBadge]::ShowOverlay'), 'chime must precede the badge')
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
