# T6.5 engine batch: installs each candidate world, launches Spacer2, waits for
# either an assertion/error dialog (auto-dumped, Spacer killed) or Spacer
# exiting normally, then asks you for the verdict either way and restores the
# pristine backup. Run in YOUR OWN PowerShell window (it needs the keyboard):
#   powershell -ExecutionPolicy Bypass -File engine-batch.ps1
# Optional: -Only 01,06   (run only those candidate numbers)
# Optional: -Latest       (run ONLY the most recently written *.zen in -Dir)
# Optional: -Windowed     (run the engine in a framed window, restored on exit)
#
# -Latest is for the second pass over a candidate you have just rebuilt, when
# playing the rest of the batch again buys nothing. It skips the control, so the
# A/B is against a control run EARLIER rather than in the same session - fine
# for a row whose result is unmistakable on its own (a red screen), not fine for
# one you would have to compare side by side.
param([string[]]$Only = @(), [string]$Dir = 'cand', [ValidateSet('Spacer2', 'Gothic2', 'GothicStarter')][string]$Exe = 'Spacer2',
      [switch]$Windowed, [switch]$Latest)

$ErrorActionPreference = 'Stop'
$Gothic  = 'C:\Program Files (x86)\Steam\steamapps\common\Gothic II'
$Target  = Join-Path $Gothic '_work\Data\Worlds\NewWorld\NewWorld.zen'
$Backup  = "$Target.original-backup"
$Spacer  = Join-Path $Gothic "System\$Exe.exe"
# GothicStarter launches Gothic2.exe as a separate process; watch both.
$Watch   = @($Exe, 'Gothic2', 'Spacer2') | Select-Object -Unique
$CandDir = if ([System.IO.Path]::IsPathRooted($Dir)) { $Dir } else { Join-Path $PSScriptRoot $Dir }
$Log     = Join-Path $CandDir 'results.log'
$OrigSha = 'b4dac8674be44820d63e5bdaf63525b8e7ca1a0ad50d62a2e3e1fe905cb8d4b5'

Add-Type @"
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public class W {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr h, EnumProc cb, IntPtr l);
  [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  public static List<string> Lines = new List<string>(); static List<uint> Pids = new List<uint>();
  static string Text(IntPtr h) { var sb = new StringBuilder(8192); GetWindowText(h, sb, 8192); return sb.ToString(); }
  static string Cls(IntPtr h) { var sb = new StringBuilder(256); GetClassName(h, sb, 256); return sb.ToString(); }
  static bool OnChild(IntPtr c, IntPtr l) { string t = Text(c); if (t.Trim().Length > 0) Lines.Add("    [" + Cls(c) + "] " + t); return true; }
  static bool OnTop(IntPtr h, IntPtr l) { uint pid; GetWindowThreadProcessId(h, out pid);
    if (Pids.Contains(pid) && IsWindowVisible(h)) { Lines.Add("=== WINDOW [" + Cls(h) + "] '" + Text(h) + "'"); EnumChildWindows(h, new EnumProc(OnChild), IntPtr.Zero); } return true; }
  public static void Run(uint[] pids) { Lines.Clear(); Pids.Clear(); Pids.AddRange(pids); EnumWindows(new EnumProc(OnTop), IntPtr.Zero); }
}
"@

function Sha($p) { (Get-FileHash -Algorithm SHA256 $p).Hash.ToLower() }

# --- windowed mode (-Windowed).
# There is no command-line switch for it: ZenGin reads zStartupWindowed from
# System\Gothic.ini, and this install also has SystemPack, whose SimpleWindow=1
# strips the window frame. Without a frame there is no title bar and no close
# button, and this script asks you to CLOSE the engine to record a verdict, so
# both keys are set. Resolution is left alone (already 800x600 here).
#
# These are files inside the Gothic install, so they get the same discipline as
# the world: a backup made once, and a restore in the finally. The .ini files are
# windows-1252, and are read and written as bytes so no PowerShell edition's
# default encoding can rewrite the rest of the file.
# SystemPack.ini is only read when SystemPack is actually installed, and a
# stale copy of that .ini can sit in an install where it is not -- editing it
# then is theatre. SystemPack hooks through its own build of Vdfs32g.dll (NOT
# ddraw.dll, and not Shw32.dll or the exe: measured, only Vdfs32g.dll carries
# the key names), so that DLL carrying the string is the sentinel.
$IniEdits = @(
  @{ File = Join-Path $Gothic 'System\Gothic.ini';     Key = 'zStartupWindowed'; Value = '1' }
  @{ File = Join-Path $Gothic 'System\SystemPack.ini'; Key = 'SimpleWindow';     Value = '0'
     NeedsMarker = @{ File = Join-Path $Gothic 'System\Vdfs32g.dll'; String = 'SystemPack.ini' } }
)
function HasMarker($m) {
  if (-not (Test-Path $m.File)) { return $false }
  $bytes = [System.IO.File]::ReadAllBytes($m.File)
  return [System.Text.Encoding]::GetEncoding(1252).GetString($bytes).Contains($m.String)
}
$IniTouched = $false
function ReadIni($p) { [System.Text.Encoding]::GetEncoding(1252).GetString([System.IO.File]::ReadAllBytes($p)) }
function WriteIni($p, $s) { [System.IO.File]::WriteAllBytes($p, [System.Text.Encoding]::GetEncoding(1252).GetBytes($s)) }
function EnableWindowed {
  foreach ($e in $IniEdits) {
    if (-not (Test-Path $e.File)) { Log "windowed: $($e.File) not present, skipped"; continue }
    if ($e.NeedsMarker -and -not (HasMarker $e.NeedsMarker)) {
      Log "windowed: $(Split-Path $e.File -Leaf) is inert (SystemPack not installed), skipped"
      continue
    }
    $backup = "$($e.File).engine-batch-backup"
    # Only if absent: a backup left by a killed run is the pristine one, and the
    # file beside it is already modified. Never overwrite it with that.
    if (-not (Test-Path $backup)) { Copy-Item $e.File $backup -Force }
    $text = ReadIni $e.File
    # Deliberately not `^\s*KEY\s*=.*$`: in .NET `\s` matches newlines, so a
    # leading `\s*` swallows the preceding blank line, and `.*$` consumes the
    # `\r` of a CRLF (multiline `$` anchors before the `\n`), silently rewriting
    # the line ending. That cost 3 bytes per file when measured.
    $pattern = "(?m)^[ \t]*$($e.Key)[ \t]*=[^\r\n]*"
    if ($text -notmatch $pattern) { Log "windowed: WARNING $($e.Key) not found in $(Split-Path $e.File -Leaf); left alone"; continue }
    WriteIni $e.File ([regex]::Replace($text, $pattern, "$($e.Key)=$($e.Value)"))
    $script:IniTouched = $true
    Log "windowed: $(Split-Path $e.File -Leaf) $($e.Key)=$($e.Value) (backup $(Split-Path $backup -Leaf))"
  }
}
function RestoreIni {
  if (-not $IniTouched) { return }
  foreach ($e in $IniEdits) {
    $backup = "$($e.File).engine-batch-backup"
    if (Test-Path $backup) { Copy-Item $backup $e.File -Force; Log "restored $(Split-Path $e.File -Leaf)" }
  }
}
function Log($s) { $line = "[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $s; Write-Host $line; Add-Content -Path $Log -Value $line -Encoding utf8 }
function Restore {
  Copy-Item $Backup $Target -Force
  if ((Sha $Target) -ne $OrigSha) { throw "RESTORE FAILED: NewWorld.zen hash mismatch after restore" }
  Log "restored pristine NewWorld.zen (hash verified)"
}
function DumpSpacerWindows {
  $pids = @(Get-Process -Name $Watch -ErrorAction SilentlyContinue | ForEach-Object { [uint32]$_.Id })
  if ($pids.Count -eq 0) { return @() }
  [W]::Run($pids); return @([W]::Lines)
}
function EngineRunning { [bool](Get-Process -Name $Watch -ErrorAction SilentlyContinue) }

# --- preconditions
if (-not (Test-Path $Backup)) { throw "backup missing: $Backup - refusing to touch the install" }
if ((Sha $Backup) -ne $OrigSha) { throw "backup hash mismatch - refusing to run" }
if (EngineRunning) { throw "an engine process ($($Watch -join '/')) is already running; close it first" }
Log "=== engine batch start; backup verified"

$cands = Get-ChildItem $CandDir -Filter '*.zen' | Sort-Object Name
if ($Only.Count -gt 0) { $cands = $cands | Where-Object { $n = $_.Name.Substring(0,2); $Only -contains $n } }
if ($Latest) {
  $cands = @($cands | Sort-Object LastWriteTime -Descending | Select-Object -First 1)
  Log "-Latest: $($cands[0].Name) only, written $($cands[0].LastWriteTime.ToString('s')) - NO control in this session"
  Write-Host " -Latest: running $($cands[0].Name) alone, with no control." -ForegroundColor Yellow
}
if ($cands.Count -eq 0) { throw "no candidates selected in $CandDir" }

try {
  # Inside the try: everything that modifies the install must be covered by the
  # finally that puts it back.
  if ($Windowed) { EnableWindowed }

  foreach ($c in $cands) {
    Write-Host ""
    Write-Host "================================================================" -ForegroundColor Cyan
    Write-Host " CANDIDATE $($c.Name)  ($($c.Length) bytes)" -ForegroundColor Cyan
    Write-Host "================================================================" -ForegroundColor Cyan
    Log "--- candidate $($c.Name) size=$($c.Length) sha=$((Sha $c.FullName).Substring(0,16))"
    Copy-Item $c.FullName $Target -Force
    Log "installed as NewWorld.zen"
    if ($Exe -eq 'Spacer2') {
      Write-Host " In Spacer: load NewWorld.zen TWICE (first load is always blank)." -ForegroundColor Yellow
    } else {
      Write-Host " In the game: start a NEW GAME and run the checklist rows." -ForegroundColor Yellow
    }
    Write-Host " If it crashes, do nothing - the dialog is captured automatically." -ForegroundColor Yellow
    Write-Host " When you are done, just CLOSE the engine and answer the prompt." -ForegroundColor Yellow
    $proc = Start-Process -FilePath $Spacer -WorkingDirectory (Split-Path $Spacer) -PassThru
    $outcome = $null
    $dialog = $false
    while ($true) {
      Start-Sleep -Seconds 2
      if ($proc.HasExited -and -not (EngineRunning)) { break }
      $lines = DumpSpacerWindows
      # trigger only on top-level window TITLES (Spacer's file-open dialog is also a #32770)
      $hit = $lines | Where-Object { $_ -like '=== WINDOW*' -and $_ -match "'[^']*(Assert|Breakpoint|Exception|Access Violation|Fatal)" }
      if ($hit) {
        Start-Sleep -Seconds 1
        $dump = DumpSpacerWindows
        $dialog = $true
        foreach ($l in $dump) { Log "  $l" }
        Write-Host " dialog captured - killing the engine" -ForegroundColor Red
        Get-Process -Name $Watch -ErrorAction SilentlyContinue | Stop-Process -Force
        Start-Sleep -Seconds 2
        break
      }
    }
    # A captured dialog is not by itself a failure: ZenGin raises an access
    # violation in its own exit path (zCRayTurboAdmin / zCMeshOctreeNode) after a
    # session that played fine, and the retail control has been seen to crash in
    # zCCSCamera::Unarchive on dialog start. The stack tells them apart and the
    # script cannot - so it always asks. See docs/reference/environment-hazards.md,
    # "Gothic II, as the engine oracle".
    if ($dialog) {
      Write-Host " Read the stack above: a crash inside exit()/CGameManager::Done is" -ForegroundColor Yellow
      Write-Host " a shutdown crash on a world that loaded and played - not a fail." -ForegroundColor Yellow
      $ans = Read-Host " Dialog captured for $($c.Name). Verdict? [ok / fail / unclear] + optional note"
      $outcome = "USER (dialog captured): $ans"
    } else {
      $ans = Read-Host " $Exe exited without a captured dialog. Verdict for $($c.Name)? [ok / fail / unclear] + optional note"
      $outcome = "USER: $ans"
    }
    Log "RESULT $($c.Name): $outcome"
  }
} finally {
  Restore
  RestoreIni
  Log "=== engine batch end"
}
Write-Host ""
Write-Host "Done. Results in $Log" -ForegroundColor Green
