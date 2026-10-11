# Engine pass over candidate worlds, through GMBT: stages each selected
# candidate into the harness mod (tools/gmbt) AS NEWWORLD.ZEN, launches the
# game on it, prints what to look for (the candidate's <name>.txt, written by
# mutate.js next to the .zen), watches the engine's top-level windows for an
# assertion/error dialog (auto-dumped, engine killed), and asks you for the
# verdict either way. Run in YOUR OWN PowerShell window (it needs the keyboard):
#   powershell -ExecutionPolicy Bypass -File engine-batch.ps1 -Only 00,07
# Optional: -Dir tools/cand  candidates directory, relative to your shell (default tools/cand)
# Optional: -Only 00,07    run only those candidate numbers
# Optional: -Latest        run ONLY the most recently written *.zen in -Dir
# Optional: -Reinstall     gmbt --reinstall, after a change to .gmbt.yml or the
#                          asset dirs. Never --full: GMBT refuses it without a
#                          script reparse, and this harness never reparses.
# Optional: -Windowed      gmbt --windowed (crashes on this machine - hazards)
# Optional: -NoAudio       gmbt --noaudio
#
# Nothing in the install is written by this script. `gmbt test` merges
# tools/gmbt/{mdk,mod} into the install's _work\Data on every run and plays the
# loose files there (the .mod named in .gmbt.yml is what `gmbt build` would
# make, and nothing builds it); the retail Worlds*.vdf are never touched, so a
# Steam "verify integrity" cannot void a verdict and there is no backup to
# restore. Read environment-hazards.md, "GMBT empties _work", before changing
# the asset dirs: mdk/ must be a complete script tree.
#
# ONE candidate at a time, and always under the name NEWWORLD.ZEN. The engine
# spawns every NPC from a script function named after the world FILE -
# STARTUP_NEWWORLD - so a world played as 07A-FRAME-TORCH.ZEN has no NPCs at
# all, and a routine row "passes" on an empty world. The 2026-08-29 batch was
# run that way and every one of its rows is void (environment-hazards.md,
# GMBT). Which bytes the engine really gets is checked once GMBT has merged:
# _work\Data\Worlds\NEWWORLD.ZEN is hashed against the candidate.
#
# -Latest is for the second pass over a candidate you have just rebuilt, when
# playing the rest of the batch again buys nothing. It skips the control, so the
# A/B is against a control run EARLIER rather than in the same session - fine
# for a row whose result is unmistakable on its own (a red screen), not fine for
# one you would have to compare side by side.
param([string[]]$Only = @(), [string]$Dir = '',
      [switch]$Latest, [switch]$Reinstall, [switch]$Windowed, [switch]$NoAudio)

$ErrorActionPreference = 'Stop'
$GmbtDir   = Join-Path $PSScriptRoot 'gmbt'
$ModWorlds = Join-Path $GmbtDir 'mod\Worlds'
$Staged    = Join-Path $ModWorlds 'NEWWORLD.ZEN'
# Where GMBT merges the candidate to and the engine reads it from; the install
# path comes from the project file, the one place it lives.
$GothicRoot = (Select-String -Path (Join-Path $GmbtDir '.gmbt.yml') -Pattern '^\s*gothicRoot:\s*(.+?)\s*$').Matches[0].Groups[1].Value
$Played    = Join-Path $GothicRoot '_work\Data\Worlds\NEWWORLD.ZEN'
$Compiled  = Join-Path $GmbtDir 'mdk\Scripts\_compiled\GOTHIC.DAT'
# GMBT launches Gothic2.exe (or GothicMod.exe under some setups); watch every
# name the engine has run under, and never Spacer's - `gmbt spacer` is not this
# script's job.
$Watch     = @('Gothic2', 'GothicMod')
# A relative -Dir is relative to where you ran this from, not to the script;
# no -Dir means tools/cand, which is where mutate.js is told to build.
$CandDir   = if ($Dir -eq '') { Join-Path $PSScriptRoot 'cand' }
             elseif ([System.IO.Path]::IsPathRooted($Dir)) { $Dir }
             else { Join-Path (Get-Location).Path $Dir }
if (-not (Test-Path $CandDir)) { throw "candidate directory not found: $CandDir (run node tools/mutate.js tools/cand first)" }
$Log       = Join-Path $CandDir 'results.log'

$GmbtCmd = Get-Command gmbt -ErrorAction SilentlyContinue
$Gmbt = if ($GmbtCmd) { $GmbtCmd.Source } else { Join-Path $env:APPDATA 'GMBT\bin\gmbt.exe' }

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
function DumpEngineWindows {
  $pids = @(Get-Process -Name $Watch -ErrorAction SilentlyContinue | ForEach-Object { [uint32]$_.Id })
  if ($pids.Count -eq 0) { return @() }
  [W]::Run($pids); return @([W]::Lines)
}
function EngineRunning { [bool](Get-Process -Name $Watch -ErrorAction SilentlyContinue) }
function Sheet($c) {
  $f = [System.IO.Path]::ChangeExtension($c.FullName, '.txt')
  if (Test-Path $f) { Get-Content $f -Encoding utf8 } else { @("(no $([System.IO.Path]::GetFileName($f)) next to the candidate - rebuild with mutate.js to get the run sheet here)") }
}

# --- preconditions
if (-not (Test-Path $Gmbt)) { throw "gmbt not found (not on PATH, not at $Gmbt) - install GMBT, https://github.com/Szmyk/gmbt" }
if (-not (Test-Path $Compiled)) {
  throw "$Compiled missing: tools/gmbt/mdk must carry the whole script tree, or GMBT empties the install's _work (environment-hazards.md)"
}
if (EngineRunning) { throw "an engine process ($($Watch -join '/')) is already running; close it first" }
if (-not (Test-Path (Split-Path $Played))) { throw "$(Split-Path $Played) missing: gothicRoot in .gmbt.yml does not point at an install GMBT has set up" }

# `powershell -File x.ps1 -Only 00,07` delivers ONE string "00,07", not an
# array - and a PowerShell caller parses 00,07 as the integers 0 and 7. Split
# and pad here so both spellings select the same candidates.
$Only = @($Only | ForEach-Object { "$_" -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ } | ForEach-Object { $_.PadLeft(2, '0') })
$cands = Get-ChildItem $CandDir -Filter '*.zen' | Sort-Object Name
if ($Only.Count -gt 0) { $cands = $cands | Where-Object { $n = $_.Name.Substring(0,2); $Only -contains $n } }
if ($Latest) {
  $cands = @($cands | Sort-Object LastWriteTime -Descending | Select-Object -First 1)
  Write-Host " -Latest: running $($cands[0].Name) alone, with no control." -ForegroundColor Yellow
}
if ($cands.Count -eq 0) { throw "no candidates selected in $CandDir" }

Log "=== engine batch start via $Gmbt"
if ($Latest) { Log "-Latest: $($cands[0].Name) only, written $($cands[0].LastWriteTime.ToString('s')) - NO control in this session" }

Log "selected: $(($cands | ForEach-Object { $_.Name }) -join ', ')"

$first = $true
foreach ($c in $cands) {
  # --- stage: the mod carries exactly this candidate, as NEWWORLD.ZEN, and
  # nothing stale - every *.zen in mod/Worlds is packed, and a world is 75 MB.
  # UPPER-CASE on disk, or GMBT cannot find the world: it upper-cases --world
  # and compares it case-SENSITIVELY against the asset dir's on-disk names, and
  # then dies with a KeyNotFoundException in DetectIfWorldIsNotExists because
  # its own "file not found" message key is missing (environment-hazards.md).
  Get-ChildItem $ModWorlds -Filter '*.zen' -ErrorAction SilentlyContinue | Remove-Item -Force
  Copy-Item $c.FullName $Staged -Force
  $candSha = Sha $c.FullName
  Log "staged $($c.Name) as NEWWORLD.ZEN size=$($c.Length) sha=$($candSha.Substring(0,16))"

  Write-Host ""
  Write-Host "================================================================" -ForegroundColor Cyan
  Write-Host " CANDIDATE $($c.Name)  ($($c.Length) bytes)" -ForegroundColor Cyan
  Write-Host "================================================================" -ForegroundColor Cyan
  foreach ($l in (Sheet $c)) { Write-Host " $l" -ForegroundColor White }
  Write-Host ""
  Write-Host " If it crashes, do nothing - the dialog is captured automatically." -ForegroundColor Yellow
  Write-Host " When you are done, just CLOSE the engine and answer the prompt." -ForegroundColor Yellow

  # --noreparse: the harness loads worlds against the shipped retail .DATs and
  # never compiles scripts. --noupdatesubtitles: GMBT 0.22 throws in
  # UpdateDialogs() on this script set. --nomenu -D: straight into a new game,
  # marvin mode on. A plain `gmbt test` merges the asset dirs every run; --full
  # is refused ("Full test requires scripts reparse"), so -Reinstall is the
  # strongest thing offered, once per batch.
  $gmbtArgs = @('test', '--world=NEWWORLD.ZEN', '--noreparse', '--nomenu', '-D', '--noupdatesubtitles')
  if ($Reinstall -and $first) { $gmbtArgs += '--reinstall' }
  if ($Windowed) { $gmbtArgs += '--windowed' }
  if ($NoAudio) { $gmbtArgs += '--noaudio' }
  $first = $false
  Log "--- candidate $($c.Name): gmbt $($gmbtArgs -join ' ')"

  $proc = Start-Process -FilePath $Gmbt -ArgumentList $gmbtArgs -WorkingDirectory $GmbtDir -PassThru -NoNewWindow
  $dialog = $false
  $checked = $false
  while ($true) {
    Start-Sleep -Seconds 2
    # Once the engine is up GMBT has merged, so hash what it merged: a verdict
    # on bytes the engine never got is not a verdict. Logged loud either way,
    # while the game is still loading.
    if (-not $checked -and (EngineRunning)) {
      $checked = $true
      $playedSha = if (Test-Path $Played) { Sha $Played } else { '(missing)' }
      if ($playedSha -eq $candSha) { Log "staged check: $Played sha=$($playedSha.Substring(0,16)) = $($c.Name)" }
      else { Log "STAGED MISMATCH: $Played is $playedSha, candidate is $candSha - the engine is NOT playing $($c.Name); this verdict is void. Re-run with -Reinstall" }
    }
    # gmbt blocks while the game runs, so its exit is the session's end - but
    # the engine is checked too, in case gmbt is killed out from under it.
    if ($proc.HasExited -and -not (EngineRunning)) { break }
    $lines = DumpEngineWindows
    # trigger only on top-level window TITLES
    $hit = $lines | Where-Object { $_ -like '=== WINDOW*' -and $_ -match "'[^']*(Assert|Breakpoint|Exception|Access Violation|Fatal)" }
    if ($hit) {
      Start-Sleep -Seconds 1
      $dump = DumpEngineWindows
      $dialog = $true
      foreach ($l in $dump) { Log "  $l" }
      Write-Host " dialog captured - killing the engine" -ForegroundColor Red
      Get-Process -Name $Watch -ErrorAction SilentlyContinue | Stop-Process -Force
      Start-Sleep -Seconds 2
      break
    }
  }
  if ($proc.HasExited -and $proc.ExitCode -ne 0) { Log "gmbt exited with $($proc.ExitCode) - read its output above before trusting this row" }
  if (-not $checked) { Log "staged check skipped: the engine was never seen running - read gmbt's output above" }

  # The sheet again: the game has been on screen for minutes and the banner is
  # off the top of the console.
  Write-Host ""
  Write-Host " What $($c.Name) was supposed to show:" -ForegroundColor Cyan
  foreach ($l in (Sheet $c)) { Write-Host " $l" -ForegroundColor White }

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
    $ans = Read-Host " The engine exited without a captured dialog. Verdict for $($c.Name)? [ok / fail / unclear] + optional note"
    $outcome = "USER: $ans"
  }
  Log "RESULT $($c.Name): $outcome"
}
Log "=== engine batch end"
Write-Host ""
Write-Host "Done. Results in $Log" -ForegroundColor Green
