import { spawn } from 'node:child_process'
import type { SpawnOptions } from 'node:child_process'

export interface FlashDecision {
  enabled: boolean
  platform: NodeJS.Platform
}

/**
 * Flash only on Windows, only when explicitly enabled, and only for a real
 * official approval card (callers invoke this after the auto-allow branch).
 */
export function shouldFlash(decision: FlashDecision): boolean {
  return decision.platform === 'win32' && decision.enabled
}

/**
 * Build a self-contained PowerShell script that finds the Desktop window and
 * asks Win32 to flash it. The process name is a constant; no approval text,
 * path, argument, or reason is interpolated into the script.
 */
export function buildFlashScript(processName = 'DeepSeek Harness'): string {
  const safeName = processName.replace(/[^A-Za-z0-9 ._-]/g, '')
  return `$ErrorActionPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @'
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
  $info.dwFlags = 0x00000002 -bor 0x0000000C
  $info.uCount = 3
  $info.dwTimeout = 0
  [void][DshApprovalFlash]::FlashWindowEx([ref]$info)
}
`
}

function encodePowerShell(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64')
}

export interface FlashRunOptions {
  enabled: boolean
  platform?: NodeJS.Platform
  processName?: string
  spawnImpl?: typeof spawn
}

/**
 * Fire-and-forget best-effort flash. It never throws and never blocks the
 * approval waterfall. A missing/renamed window, EDR policy, or PowerShell
 * failure is silently ignored.
 */
export function flashApprovalWindow(options: FlashRunOptions): void {
  const platform = options.platform ?? process.platform
  if (!shouldFlash({ enabled: options.enabled, platform })) return
  try {
    const script = buildFlashScript(options.processName)
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
