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

export interface AlertDecision {
  flash: boolean
  sound: boolean
  platform: NodeJS.Platform
}

/** A notification is worth an alert when Windows can do at least one channel. */
export function shouldAlert(decision: AlertDecision): boolean {
  return decision.platform === 'win32' && (decision.flash || decision.sound)
}

/** Which synthesized chime a script plays. */
export type AlertTone = 'approval' | 'turn-end'

export interface ChimeNote {
  /** Tone frequency in Hz. */
  readonly frequency: number
  /** Sounding length in seconds. */
  readonly duration: number
  /** Silence written after the note, in seconds. */
  readonly gap: number
}

export interface ChimeSpec {
  readonly sampleRate: number
  readonly amplitude: number
  /** Fade-in length in seconds. */
  readonly attack: number
  /** Fade-out length in seconds. */
  readonly release: number
  readonly notes: readonly ChimeNote[]
  /** System sound used only when the in-memory WAV cannot be played. */
  readonly fallback: 'Asterisk' | 'Exclamation'
}

/**
 * Pending interaction: a soft, falling "ding-dong" (G5 -> C5). Every note fades
 * in and out so it stays gentle, and it is synthesized in memory: no system
 * sound scheme and no new dependency.
 */
export const APPROVAL_CHIME: ChimeSpec = {
  sampleRate: 22050,
  amplitude: 3500,
  attack: 0.02,
  release: 0.07,
  notes: [
    { frequency: 783.99, duration: 0.15, gap: 0.03 },
    { frequency: 523.25, duration: 0.35, gap: 0.03 },
  ],
  fallback: 'Asterisk',
}

/**
 * Turn complete: two short, rising "di-di" beeps (B5 -> E6). Deliberately
 * shorter, higher, and rising where the approval chime is long, low, and
 * falling, so the two are never confused. Synthesized the same way; no
 * third-party audio file is shipped or read.
 */
export const TURN_END_CHIME: ChimeSpec = {
  sampleRate: 22050,
  amplitude: 5200,
  attack: 0.004,
  release: 0.035,
  notes: [
    { frequency: 988, duration: 0.09, gap: 0.03 },
    { frequency: 1319, duration: 0.09, gap: 0.02 },
  ],
  fallback: 'Exclamation',
}

/** Default window-title fragment used to find the DeepSeek Harness window. */
export const DEFAULT_WINDOW_TITLE = 'DeepSeek Harness'

/** Default lifetime of the green turn-complete overlay badge, in seconds. */
export const DEFAULT_BADGE_SECONDS = 120

export interface AlertScriptOptions {
  flash: boolean
  sound: boolean
  processName?: string
  /** Green taskbar overlay badge (turn complete only). */
  badge?: boolean
  /** Seconds before the badge clears itself; 0 keeps it until the window is foreground. */
  badgeSeconds?: number
  /** Chime to synthesize; defaults to the approval "ding-dong". */
  tone?: AlertTone
  /**
   * Turn complete only: skip the whole alert (flash, badge, sound) when the
   * harness window is already foreground. Approval alerts never set this.
   */
  foregroundGate?: boolean
}

function sanitizeProcessName(processName: string): string {
  return processName.replace(/[^A-Za-z0-9 ._-]/g, '')
}

/**
 * Turn-complete foreground gate. When the harness window exists and is already
 * the foreground window, the whole alert is skipped with `exit 0`: the user is
 * looking at the window, so flashing and beeping is noise.
 *
 * Deliberately self-contained and COM-free (user32 P/Invoke only) so it works
 * for every channel combination, including a sound-only alert where neither the
 * flash nor the badge type is emitted. A window that cannot be found — or any
 * failure of the check — must NOT silence the alert, because the chime is still
 * useful after the window is gone; only "found and foreground" exits.
 */
function buildForegroundGatePart(processName: string): string {
  const safeName = sanitizeProcessName(processName)
  return `$dshAwayReady = $false
try {
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class DshApprovalAway {
  public delegate bool DshEnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]
  public static extern bool EnumWindows(DshEnumWindowsProc callback, IntPtr lParam);
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
$dshAwayReady = $true
} catch {}
if ($dshAwayReady) {
  $dshAwayTarget = [IntPtr]::Zero
  try { $dshAwayTarget = [DshApprovalAway]::FindWindowByTitle('${safeName}') } catch {}
  # Foreground means the user is already looking at the window: no flash, no badge, no sound.
  if ($dshAwayTarget -ne [IntPtr]::Zero -and [DshApprovalAway]::GetForegroundWindow() -eq $dshAwayTarget) { exit 0 }
}
`
}

/**
 * Taskbar button flash. A flash cannot carry a colour on Windows, so this part
 * only draws attention; the colour lives in the overlay badge below.
 */
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

/**
 * Green taskbar overlay badge (`ITaskbarList3.SetOverlayIcon`), the only way to
 * put a colour on the taskbar button because `FlashWindowEx` cannot pick one.
 * The dot is drawn into a 32x32 alpha DIB, so no image file is shipped or read.
 * The script then polls the foreground window every 450 ms and clears the badge
 * when the window comes back, when its lifetime expires, or when the window
 * disappears. `badgeSeconds = 0` keeps it until the window is foreground.
 */
function buildBadgePart(processName: string, seconds: number): string {
  const safeName = sanitizeProcessName(processName)
  const badgeSeconds = Math.max(0, Math.trunc(seconds))
  return `$dshBadgeReady = $false
try {
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
[StructLayout(LayoutKind.Sequential)]
public struct DshIconInfo {
  [MarshalAs(UnmanagedType.Bool)]
  public bool fIcon;
  public int xHotspot;
  public int yHotspot;
  public IntPtr hbmMask;
  public IntPtr hbmColor;
}
[StructLayout(LayoutKind.Sequential)]
public struct DshBitmapInfoHeader {
  public uint biSize;
  public int biWidth;
  public int biHeight;
  public ushort biPlanes;
  public ushort biBitCount;
  public uint biCompression;
  public uint biSizeImage;
  public int biXPelsPerMeter;
  public int biYPelsPerMeter;
  public uint biClrUsed;
  public uint biClrImportant;
}
[StructLayout(LayoutKind.Sequential)]
public struct DshBitmapInfo {
  public DshBitmapInfoHeader bmiHeader;
}
[ComImport, Guid("ea1afb91-9e28-4b86-90e9-9e9f8a5eefaf"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface DshTaskbarList3 {
  void HrInit();
  void AddTab(IntPtr hwnd);
  void DeleteTab(IntPtr hwnd);
  void ActivateTab(IntPtr hwnd);
  void SetActiveAlt(IntPtr hwnd);
  void MarkFullscreenWindow(IntPtr hwnd, [MarshalAs(UnmanagedType.Bool)] bool fFullscreen);
  void SetProgressValue(IntPtr hwnd, ulong ullCompleted, ulong ullTotal);
  void SetProgressState(IntPtr hwnd, int tbpFlags);
  void RegisterTab(IntPtr hwndTab, IntPtr hwndMDI);
  void UnregisterTab(IntPtr hwndTab);
  void SetTabOrder(IntPtr hwndTab, IntPtr hwndInsertBefore);
  void SetTabActive(IntPtr hwndTab, IntPtr hwndMDI, uint dwReserved);
  void ThumbBarAddButtons(IntPtr hwnd, uint cButtons, IntPtr pButtons);
  void ThumbBarUpdateButtons(IntPtr hwnd, uint cButtons, IntPtr pButtons);
  void ThumbBarSetImageList(IntPtr hwnd, IntPtr himl);
  void SetOverlayIcon(IntPtr hwnd, IntPtr hIcon, [MarshalAs(UnmanagedType.LPWStr)] string pszDescription);
  void SetThumbnailTooltip(IntPtr hwnd, [MarshalAs(UnmanagedType.LPWStr)] string pszTip);
  void SetThumbnailClip(IntPtr hwnd, IntPtr prcClip);
}
[ComImport, Guid("56fdf344-fd6d-11d0-958a-006097c9a090")]
public class DshTaskbarListClass {
}
public static class DshApprovalBadge {
  public delegate bool DshEnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]
  public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool EnumWindows(DshEnumWindowsProc callback, IntPtr lParam);
  [DllImport("user32.dll")]
  public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")]
  public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool DestroyIcon(IntPtr hIcon);
  [DllImport("user32.dll")]
  public static extern IntPtr CreateIconIndirect(ref DshIconInfo piconinfo);
  [DllImport("gdi32.dll")]
  public static extern IntPtr CreateDIBSection(IntPtr hdc, ref DshBitmapInfo pbmi, uint usage, out IntPtr ppvBits, IntPtr hSection, uint offset);
  [DllImport("gdi32.dll")]
  public static extern IntPtr CreateBitmap(int nWidth, int nHeight, uint nPlanes, uint nBitCount, IntPtr lpBits);
  [DllImport("gdi32.dll")]
  public static extern bool DeleteObject(IntPtr ho);
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
  public static bool ShowOverlay(IntPtr hwnd, IntPtr icon) {
    try {
      DshTaskbarList3 bar = (DshTaskbarList3)new DshTaskbarListClass();
      bar.HrInit();
      bar.SetOverlayIcon(hwnd, icon, "turn complete");
      return true;
    } catch {
      return false;
    }
  }
  public static bool ClearOverlay(IntPtr hwnd) {
    try {
      DshTaskbarList3 bar = (DshTaskbarList3)new DshTaskbarListClass();
      bar.HrInit();
      bar.SetOverlayIcon(hwnd, IntPtr.Zero, "");
      return true;
    } catch {
      return false;
    }
  }
  public static IntPtr CreateGreenDotIcon(int size) {
    DshBitmapInfo info = new DshBitmapInfo();
    info.bmiHeader.biSize = (uint)Marshal.SizeOf(typeof(DshBitmapInfoHeader));
    info.bmiHeader.biWidth = size;
    info.bmiHeader.biHeight = -size;
    info.bmiHeader.biPlanes = 1;
    info.bmiHeader.biBitCount = 32;
    info.bmiHeader.biCompression = 0;
    IntPtr bits = IntPtr.Zero;
    IntPtr color = CreateDIBSection(IntPtr.Zero, ref info, 0, out bits, IntPtr.Zero, 0);
    if (color == IntPtr.Zero || bits == IntPtr.Zero) return IntPtr.Zero;
    double center = size / 2.0;
    double radius = center - 1.5;
    byte[] pixels = new byte[size * size * 4];
    for (int y = 0; y < size; y++) {
      for (int x = 0; x < size; x++) {
        double dx = x + 0.5 - center;
        double dy = y + 0.5 - center;
        double coverage = radius - Math.Sqrt(dx * dx + dy * dy) + 0.5;
        int alpha = 0;
        if (coverage >= 1.0) alpha = 255;
        else if (coverage > 0.0) alpha = (int)(coverage * 255.0);
        int offset = (y * size + x) * 4;
        pixels[offset] = 80;
        pixels[offset + 1] = 204;
        pixels[offset + 2] = 46;
        pixels[offset + 3] = (byte)alpha;
      }
    }
    Marshal.Copy(pixels, 0, bits, pixels.Length);
    int maskStride = ((size + 15) / 16) * 2;
    byte[] mask = new byte[maskStride * size];
    IntPtr maskBits = Marshal.AllocHGlobal(mask.Length);
    Marshal.Copy(mask, 0, maskBits, mask.Length);
    IntPtr maskBitmap = CreateBitmap(size, size, 1, 1, maskBits);
    Marshal.FreeHGlobal(maskBits);
    DshIconInfo icon = new DshIconInfo();
    icon.fIcon = true;
    icon.hbmMask = maskBitmap;
    icon.hbmColor = color;
    IntPtr hIcon = CreateIconIndirect(ref icon);
    if (maskBitmap != IntPtr.Zero) DeleteObject(maskBitmap);
    if (color != IntPtr.Zero) DeleteObject(color);
    return hIcon;
  }
}
'@
$dshBadgeReady = $true
} catch {}
if ($dshBadgeReady) {
  $dshBadgeSeconds = ${badgeSeconds}
  $dshBadgeTarget = [IntPtr]::Zero
  try { $dshBadgeTarget = [DshApprovalBadge]::FindWindowByTitle('${safeName}') } catch {}
  if ($dshBadgeTarget -ne [IntPtr]::Zero) {
    $dshBadgeIcon = [IntPtr]::Zero
    $dshBadgeShown = $false
    try {
      $dshBadgeIcon = [DshApprovalBadge]::CreateGreenDotIcon(32)
      if ($dshBadgeIcon -ne [IntPtr]::Zero -and [DshApprovalBadge]::ShowOverlay($dshBadgeTarget, $dshBadgeIcon)) {
        $dshBadgeShown = $true
        $dshBadgeWatch = [System.Diagnostics.Stopwatch]::StartNew()
        while ($true) {
          Start-Sleep -Milliseconds 450
          if ([DshApprovalBadge]::GetForegroundWindow() -eq $dshBadgeTarget) { break }
          if (-not [DshApprovalBadge]::IsWindow($dshBadgeTarget)) { $dshBadgeShown = $false; break }
          if ($dshBadgeSeconds -gt 0 -and $dshBadgeWatch.Elapsed.TotalSeconds -ge $dshBadgeSeconds) { break }
        }
      }
    } catch {
    } finally {
      try { if ($dshBadgeShown) { [void][DshApprovalBadge]::ClearOverlay($dshBadgeTarget) } } catch {}
      try { if ($dshBadgeIcon -ne [IntPtr]::Zero) { [void][DshApprovalBadge]::DestroyIcon($dshBadgeIcon) } } catch {}
    }
  }
}
`
}

/**
 * Synthesize one chime as an in-memory WAV and play it with
 * `System.Media.SoundPlayer`. The tone is data-only, so a second sound adds no
 * dependency and no media file.
 */
function buildSoundPart(tone: AlertTone): string {
  const chime = tone === 'turn-end' ? TURN_END_CHIME : APPROVAL_CHIME
  const notes = chime.notes
    .map((note) => `@{ f = ${note.frequency}; d = ${note.duration}; g = ${note.gap} }`)
    .join(', ')
  return `$dshOk = $false
try {
  $dshSr = ${chime.sampleRate}
  $dshAmp = ${chime.amplitude}
  $dshAttack = ${chime.attack}
  $dshRelease = ${chime.release}
  $dshNotes = @(${notes})
  $dshTotal = 0
  foreach ($dshN in $dshNotes) { $dshTotal += [int]($dshSr * $dshN.d) + [int]($dshSr * $dshN.g) }
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
      $dshEnv = [Math]::Min(1.0, $dshI / ($dshSr * $dshAttack)) * [Math]::Min(1.0, ($dshCount - $dshI) / ($dshSr * $dshRelease))
      $dshV = [int]($dshAmp * $dshEnv * [Math]::Sin(2 * [Math]::PI * $dshN.f * $dshT))
      $dshBw.Write([int16]$dshV)
    }
    for ($dshI = 0; $dshI -lt [int]($dshSr * $dshN.g); $dshI++) { $dshBw.Write([int16]0) }
  }
  $dshBw.Flush()
  $dshMs.Position = 0
  $dshPlayer = New-Object System.Media.SoundPlayer($dshMs)
  $dshPlayer.PlaySync()
  $dshPlayer.Dispose()
  $dshMs.Dispose()
  $dshOk = $true
} catch {}
if (-not $dshOk) { try { [System.Media.SystemSounds]::${chime.fallback}.Play() } catch {} }
`
}

/**
 * Build one self-contained PowerShell script. Flash, badge, and sound are
 * independent switches; the turn-complete foreground gate, when enabled, comes
 * first so `exit 0` runs before any other part. The process name is a constant
 * and is sanitized before embedding. No approval text, path, argument, or reason
 * is interpolated.
 */
export function buildAlertScript(options: AlertScriptOptions): string {
  const processName = options.processName ?? DEFAULT_WINDOW_TITLE
  const parts = [`$ErrorActionPreference = 'SilentlyContinue'`]
  if (options.foregroundGate === true) parts.push(buildForegroundGatePart(processName))
  if (options.flash) parts.push(buildFlashPart(processName))
  if (options.badge === true) {
    parts.push(buildBadgePart(processName, options.badgeSeconds ?? DEFAULT_BADGE_SECONDS))
  }
  if (options.sound) parts.push(buildSoundPart(options.tone ?? 'approval'))
  return `${parts.join('\n')}\n`
}

/** Flash-only script kept for callers (and tests) that only need the window part. */
export function buildFlashScript(processName = DEFAULT_WINDOW_TITLE): string {
  return buildAlertScript({ flash: true, sound: false, processName })
}

export interface TurnEndScriptOptions {
  processName?: string
  /** Flash and badge; both are the Windows "look here" channel. */
  flash?: boolean
  sound?: boolean
  badgeSeconds?: number
  /**
   * Skip the alert entirely when the harness window is already foreground.
   * Defaults to true (the product default); `false` restores unconditional
   * alerts.
   */
  onlyWhenAway?: boolean
}

/** Turn-complete script: foreground gate + flash + green badge + the two-beep "di-di". */
export function buildTurnEndScript(options: TurnEndScriptOptions = {}): string {
  const flash = options.flash ?? true
  return buildAlertScript({
    flash,
    sound: options.sound ?? true,
    badge: flash,
    badgeSeconds: options.badgeSeconds ?? DEFAULT_BADGE_SECONDS,
    tone: 'turn-end',
    processName: options.processName,
    foregroundGate: options.onlyWhenAway ?? true,
  })
}

function encodePowerShell(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64')
}

/**
 * Spawn one hidden PowerShell. Never throws: a missing window, EDR policy, or
 * PowerShell failure is silently ignored.
 */
function spawnAlertScript(script: string, spawnImpl: typeof spawn): void {
  try {
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
    // Notifications are optional; the official card is the source of truth.
  }
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
  spawnAlertScript(
    buildAlertScript({
      flash: options.flash,
      sound: options.sound,
      processName: options.processName,
      badge: options.badge,
      badgeSeconds: options.badgeSeconds,
      tone: options.tone,
    }),
    options.spawnImpl ?? spawn,
  )
}

export interface TurnEndRunOptions {
  flash: boolean
  sound: boolean
  /** Green overlay badge; the Host pairs it with `flash`. */
  badge: boolean
  /** Badge lifetime in seconds; 0 keeps it until the window is foreground. */
  badgeSeconds: number
  /**
   * Skip the whole alert (flash, badge, sound) when the harness window is
   * already foreground. Only the turn-complete alert uses this; approval alerts
   * stay unconditional.
   */
  onlyWhenAway: boolean
  platform?: NodeJS.Platform
  processName?: string
  spawnImpl?: typeof spawn
}

/**
 * Fire-and-forget turn-complete alert. Same containment as `alertPending`:
 * every failure is swallowed and never changes a turn or an approval outcome.
 */
export function alertTurnEnd(options: TurnEndRunOptions): void {
  const platform = options.platform ?? process.platform
  if (!shouldAlert({ flash: options.flash, sound: options.sound, platform })) return
  spawnAlertScript(
    buildAlertScript({
      flash: options.flash,
      sound: options.sound,
      badge: options.badge,
      badgeSeconds: options.badgeSeconds,
      tone: 'turn-end',
      processName: options.processName,
      foregroundGate: options.onlyWhenAway,
    }),
    options.spawnImpl ?? spawn,
  )
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
