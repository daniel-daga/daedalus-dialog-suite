# One-off, unattended: does <Exe> reach a stable window without an error dialog?
# Modifies NOTHING in the install. Always kills the process it started.
# Answers only "does it crash at startup", not any checklist row.
param([ValidateSet('Gothic2', 'Spacer2')][string]$Exe = 'Gothic2', [int]$Seconds = 45)

$ErrorActionPreference = 'Stop'
$Gothic = 'C:\Program Files (x86)\Steam\steamapps\common\Gothic II'
$Path = Join-Path $Gothic "System\$Exe.exe"

Add-Type @"
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public class P {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr h, EnumProc cb, IntPtr l);
  [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  public static List<string> Lines = new List<string>(); static List<uint> Pids = new List<uint>();
  static string Text(IntPtr h) { var sb = new StringBuilder(4096); GetWindowText(h, sb, 4096); return sb.ToString(); }
  static string Cls(IntPtr h) { var sb = new StringBuilder(256); GetClassName(h, sb, 256); return sb.ToString(); }
  static bool OnChild(IntPtr c, IntPtr l) { string t = Text(c); if (t.Trim().Length > 0) Lines.Add("    [" + Cls(c) + "] " + t.Split('\n')[0]); return true; }
  static bool OnTop(IntPtr h, IntPtr l) { uint pid; GetWindowThreadProcessId(h, out pid);
    if (Pids.Contains(pid) && IsWindowVisible(h)) { Lines.Add("WINDOW [" + Cls(h) + "] '" + Text(h) + "'"); EnumChildWindows(h, new EnumProc(OnChild), IntPtr.Zero); } return true; }
  public static void Run(uint[] pids) { Lines.Clear(); Pids.Clear(); Pids.AddRange(pids); EnumWindows(new EnumProc(OnTop), IntPtr.Zero); }
}
"@

function Windows {
  $ids = @(Get-Process -Name Gothic2, Spacer2 -ErrorAction SilentlyContinue | ForEach-Object { [uint32]$_.Id })
  if ($ids.Count -eq 0) { return @() }
  [P]::Run($ids); return @([P]::Lines)
}

if (Get-Process -Name Gothic2, Spacer2 -ErrorAction SilentlyContinue) { throw "an engine process is already running" }

$proc = Start-Process -FilePath $Path -WorkingDirectory (Split-Path $Path) -PassThru
Write-Host "started $Exe pid $($proc.Id); watching $Seconds s"
$verdict = 'ran to timeout with no error dialog'
$seen = @()
try {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 2
    if ($proc.HasExited) { $verdict = "process exited on its own, code $($proc.ExitCode)"; break }
    $w = Windows
    foreach ($l in $w) { if ($seen -notcontains $l) { $seen += $l } }
    if ($w | Where-Object { $_ -like 'WINDOW*' -and $_ -match 'Assert|Exception|Access Violation|Fatal|Error' }) {
      Start-Sleep -Seconds 1
      $seen = @(); foreach ($l in (Windows)) { $seen += $l }
      $verdict = 'ERROR DIALOG'
      break
    }
  }
} finally {
  Get-Process -Name Gothic2, Spacer2 -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep -Seconds 1
}
Write-Host "`nVERDICT: $verdict"
Write-Host "windows seen:"
if ($seen.Count -eq 0) { Write-Host "  (none - no visible top-level window ever appeared)" }
else { $seen | Select-Object -First 25 | ForEach-Object { Write-Host "  $_" } }
