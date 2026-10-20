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
$p = Get-Process -Name '${safeName}' | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if ($null -ne $p) { $target = $p.MainWindowHandle }
if ($target -eq [IntPtr]::Zero) { $target = [DshApprovalFlash]::FindWindowByTitle('DeepSeek Harness') }
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
  // SystemSounds exists in Windows PowerShell 5.1; failures are swallowed so
  // the alert never blocks the approval waterfall.
  return `try { [System.Media.SystemSounds]::Exclamation.Play() } catch {}
Start-Sleep -Milliseconds 500
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
    const spawnOptions: SpawnOptions = {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
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
