# Dump all window + child-control text for Spacer2/Gothic2 windows, so the
# "Assertion Failed" content can be read without a screenshot.
Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class W {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr h, EnumProc cb, IntPtr l);
  [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);

  public static List<string> Lines = new List<string>();
  static List<uint> Pids = new List<uint>();

  static string Text(IntPtr h) { var sb = new StringBuilder(8192); GetWindowText(h, sb, 8192); return sb.ToString(); }
  static string Cls(IntPtr h) { var sb = new StringBuilder(256); GetClassName(h, sb, 256); return sb.ToString(); }

  static bool OnChild(IntPtr c, IntPtr l) {
    string t = Text(c);
    if (t.Trim().Length > 0) Lines.Add("    [" + Cls(c) + "] " + t);
    return true;
  }
  static bool OnTop(IntPtr h, IntPtr l) {
    uint pid; GetWindowThreadProcessId(h, out pid);
    if (Pids.Contains(pid) && IsWindowVisible(h)) {
      Lines.Add("=== WINDOW [" + Cls(h) + "] '" + Text(h) + "'");
      EnumChildWindows(h, new EnumProc(OnChild), IntPtr.Zero);
    }
    return true;
  }
  public static void Run(uint[] pids) {
    Lines.Clear(); Pids.Clear(); Pids.AddRange(pids);
    EnumWindows(new EnumProc(OnTop), IntPtr.Zero);
  }
}
"@

$pids = @(Get-Process -Name Spacer2, Gothic2 -ErrorAction SilentlyContinue | ForEach-Object { [uint32]$_.Id })
if ($pids.Count -eq 0) { Write-Output "no Spacer2/Gothic2 process running"; exit }
[W]::Run($pids)
[W]::Lines | ForEach-Object { $_ }
Write-Output "--- lines: $([W]::Lines.Count) ---"
