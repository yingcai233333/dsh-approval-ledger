import { spawn } from 'node:child_process'
import type { SpawnOptions } from 'node:child_process'

export interface FlashDecision {
  enabled: boolean
  platform: NodeJS.Platform
}

/**
 * Flash only on Windows and only when explicitly enabled. Callers decide
 * *which* pending interaction is worth a flash; this helper only owns the
 * platform/opt-in gate.
 */
export function shouldFlash(decision: FlashDecision): boolean {
  return decision.platform === 'win32' && decision.enabled
}

export interface AlertScriptOptions {
  flash: boolean
  sound: boolean
  processName?: string
}

export interface AlertDecision {
  flash: boolean
  sound: boolean
  platform: NodeJS.Platform
}

/** A pending interaction is worth an alert when Windows can do at least one of the two. */
export function shouldAlert(decision: AlertDecision): boolean {
  return decision.platform === 'win32' && (decision.flash || decision.sound)
}

function sanitizeProcessName(processName: string): string {
  return processName.replace(/[^A-Za-z0-9 ._-]/g, '')
}

function buildFlashPart(processName: string): string {
  const safeName = sanitizeProcessName(processName)
  return `Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class DshApprovalFlash {
  [StructLayout(LayoutKind.Sequential)]
  public struct FLASHWINFO {
    public uint cbSize;
    public IntPtr hwnd;
    public uint dwFlags;
    public uint uCount;
    public uint dwTimeout;
  }
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")]
  public static extern bool FlashWindowEx(ref FLASHWINFO pwfi);
  [DllImport("user32.dll")]
  public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
  [DllImport("user32.dll")]
  public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")]
  public static extern int GetWindowTextLength(IntPtr hWnd);
  public static IntPtr FindWindowByTitle(string needle) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((hWnd, lParam) => {
      if (!IsWindowVisible(hWnd)) return true;
      int length = GetWindowTextLength(hWnd);
      if (length <= 0) return true;
      StringBuilder text = new StringBuilder(length + 1);
      GetWindowText(hWnd, text, text.Capacity);
      if (text.ToString().IndexOf(needle, StringComparison.OrdinalIgnoreCase) >= 0) {
        found = hWnd;
        return false;
      }
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
'@
$target = [IntPtr]::Zero
try { $target = [DshApprovalFlash]::FindWindowByTitle('${safeName}') } catch {}
if ($target -ne [IntPtr]::Zero) {
  $info = New-Object DshApprovalFlash+FLASHWINFO
  $info.cbSize = [uint32][System.Runtime.InteropServices.Marshal]::SizeOf($info)
  $info.hwnd = $target
  # FLASHW_ALL (caption + taskbar) until the window is foreground, five times.
  $info.dwFlags = 0x00000003 -bor 0x0000000C
  $info.uCount = 5
  $info.dwTimeout = 0
  [void][DshApprovalFlash]::FlashWindowEx([ref]$info)
}
`
}

function buildSoundPart(): string {
  // A soft synthesized "ding-dong" (G5 -> C5) generated as an in-memory WAV:
  // no system sound scheme, no new dependency, and every note fades in/out so
  // it stays gentle. The system asterisk is only a fallback.
  return `$dshOk = $false
try {
  $dshSr = 22050
  $dshNotes = @(@{ f = 783.99; d = 0.15 }, @{ f = 523.25; d = 0.35 })
  $dshTotal = 0
  foreach ($dshN in $dshNotes) { $dshTotal += [int]($dshSr * $dshN.d) }
  $dshMs = New-Object System.IO.MemoryStream
  $dshBw = New-Object System.IO.BinaryWriter($dshMs)
  $dshBw.Write([System.Text.Encoding]::ASCII.GetBytes('RIFF'))
  $dshBw.Write([int](36 + $dshTotal * 2))
  $dshBw.Write([System.Text.Encoding]::ASCII.GetBytes('WAVEfmt '))
  $dshBw.Write([int]16)
  $dshBw.Write([int16]1)
  $dshBw.Write([int16]1)
  $dshBw.Write([int]$dshSr)
  $dshBw.Write([int]($dshSr * 2))
  $dshBw.Write([int16]2)
  $dshBw.Write([int16]16)
  $dshBw.Write([System.Text.Encoding]::ASCII.GetBytes('data'))
  $dshBw.Write([int]($dshTotal * 2))
  foreach ($dshN in $dshNotes) {
    $dshCount = [int]($dshSr * $dshN.d)
    for ($dshI = 0; $dshI -lt $dshCount; $dshI++) {
      $dshT = $dshI / $dshSr
      $dshEnv = [Math]::Min(1.0, $dshI / ($dshSr * 0.02)) * [Math]::Min(1.0, ($dshCount - $dshI) / ($dshSr * 0.07))
      $dshV = [int](3500 * $dshEnv * [Math]::Sin(2 * [Math]::PI * $dshN.f * $dshT))
      $dshBw.Write([int16]$dshV)
    }
    for ($dshI = 0; $dshI -lt [int]($dshSr * 0.03); $dshI++) { $dshBw.Write([int16]0) }
  }
  $dshBw.Flush()
  $dshMs.Position = 0
  $dshPlayer = New-Object System.Media.SoundPlayer($dshMs)
  $dshPlayer.PlaySync()
  $dshPlayer.Dispose()
  $dshMs.Dispose()
  $dshOk = $true
} catch {}
if (-not $dshOk) { try { [System.Media.SystemSounds]::Asterisk.Play() } catch {} }
`
}

/**
 * Build one self-contained PowerShell script. Flash and sound are independent
 * switches; the process name is a constant and is sanitized before embedding.
 * No approval text, path, argument, or reason is interpolated.
 */
export function buildAlertScript(options: AlertScriptOptions): string {
  const parts = [`$ErrorActionPreference = 'SilentlyContinue'`]
  if (options.flash) parts.push(buildFlashPart(options.processName ?? 'DeepSeek Harness'))
  if (options.sound) parts.push(buildSoundPart())
  return `${parts.join('\n')}\n`
}

/** Flash-only script kept for callers (and tests) that only need the window part. */
export function buildFlashScript(processName = 'DeepSeek Harness'): string {
  return buildAlertScript({ flash: true, sound: false, processName })
}

function encodePowerShell(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64')
}

export interface AlertRunOptions extends AlertScriptOptions {
  platform?: NodeJS.Platform
  spawnImpl?: typeof spawn
}

/**
 * Fire-and-forget best-effort alert. It never throws and never blocks the
 * approval waterfall. A missing window, EDR policy, or PowerShell failure is
 * silently ignored; the official card remains the source of truth.
 */
export function alertPending(options: AlertRunOptions): void {
  const platform = options.platform ?? process.platform
  if (!shouldAlert({ flash: options.flash, sound: options.sound, platform })) return
  try {
    const script = buildAlertScript({
      flash: options.flash,
      sound: options.sound,
      processName: options.processName,
    })
    const spawnImpl = options.spawnImpl ?? spawn
    // Windows: `detached` (DETACHED_PROCESS) and `windowsHide`
    // (CREATE_NO_WINDOW) both make powershell.exe exit without running
    // `-EncodedCommand` on the desktop runtime, so the alert would silently
    // never fire. The console is kept out of sight by `-WindowStyle Hidden`.
    const spawnOptions: SpawnOptions = {
      stdio: 'ignore',
    }
    const child = spawnImpl(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-WindowStyle',
        'Hidden',
        '-EncodedCommand',
        encodePowerShell(script),
      ],
      spawnOptions,
    )
    child.on?.('error', () => {})
    child.unref?.()
  } catch {
    // Notification is optional; the official card is the source of truth.
  }
}

export interface FlashRunOptions {
  enabled: boolean
  platform?: NodeJS.Platform
  processName?: string
  spawnImpl?: typeof spawn
}

/** Backwards-compatible flash-only entry point. */
export function flashApprovalWindow(options: FlashRunOptions): void {
  alertPending({
    flash: options.enabled,
    sound: false,
    platform: options.platform,
    processName: options.processName,
    spawnImpl: options.spawnImpl,
  })
}
