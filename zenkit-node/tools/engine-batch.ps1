# T6.5 engine batch: installs each candidate world, launches Spacer2, waits for
# either an assertion/error dialog (auto-dumped, Spacer killed, FAIL recorded)
# or Spacer exiting normally (you are asked for the verdict), then restores the
# pristine backup. Run in YOUR OWN PowerShell window (it needs the keyboard):
#   powershell -ExecutionPolicy Bypass -File engine-batch.ps1
# Optional: -Only 01,06   (run only those candidate numbers)
param([string[]]$Only = @(), [string]$Dir = 'cand', [ValidateSet('Spacer2', 'Gothic2', 'GothicStarter')][string]$Exe = 'Spacer2')

$ErrorActionPreference = 'Stop'
$Gothic  = 'C:\Program Files (x86)\Steam\steamapps\common\Gothic II'
$Target  = Join-Path $Gothic '_work\Data\Worlds\NewWorld\NewWorld.zen'
$Backup  = "$Target.original-backup"
$Spacer  = Join-Path $Gothic "System\$Exe.exe"
# GothicStarter launches Gothic2.exe as a separate process; watch both.
$Watch   = @($Exe, 'Gothic2', 'Spacer2') | Select-Object -Unique
$CandDir = Join-Path $PSScriptRoot $Dir
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

try {
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
    while ($true) {
      Start-Sleep -Seconds 2
      if ($proc.HasExited -and -not (EngineRunning)) { break }
      $lines = DumpSpacerWindows
      # trigger only on top-level window TITLES (Spacer's file-open dialog is also a #32770)
      $hit = $lines | Where-Object { $_ -like '=== WINDOW*' -and $_ -match "'[^']*(Assert|Breakpoint|Exception|Access Violation|Fatal)" }
      if ($hit) {
        Start-Sleep -Seconds 1
        $dump = DumpSpacerWindows
        $outcome = 'FAIL (dialog captured)'
        foreach ($l in $dump) { Log "  $l" }
        Write-Host " dialog captured - killing the engine" -ForegroundColor Red
        Get-Process -Name $Watch -ErrorAction SilentlyContinue | Stop-Process -Force
        Start-Sleep -Seconds 2
        break
      }
    }
    if (-not $outcome) {
      $ans = Read-Host " $Exe exited without a captured dialog. Verdict for $($c.Name)? [ok / fail / unclear] + optional note"
      $outcome = "USER: $ans"
    }
    Log "RESULT $($c.Name): $outcome"
  }
} finally {
  Restore
  Log "=== engine batch end"
}
Write-Host ""
Write-Host "Done. Results in $Log" -ForegroundColor Green
