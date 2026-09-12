import { spawn as nodeSpawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * The GMBT quick test (level-editor.md §16.29): `gmbt test` over the open
 * world, launched from the project's GMBT folder.
 *
 * The command is the one `zenkit-node/tools/engine-batch.ps1` already drives,
 * minus its `--noreparse`: that harness never compiles scripts, and this one is
 * used beside dialogs edited in this app, so a quick test recompiles them every
 * run. `--full` is never passed — GMBT refuses it without a prior reparse, and
 * dropping `--noreparse` already gets one.
 *
 * Fire-and-forget by decision: the child is detached and unref'd, nothing
 * watches it, and its exit code is nobody's business here.
 */
export const QUICK_TEST_FLAGS = ['--nomenu', '-D', '--noupdatesubtitles'] as const;

export interface GmbtLaunchDeps {
  env?: NodeJS.ProcessEnv;
  exists?: (candidate: string) => boolean;
  spawn?: typeof nodeSpawn;
  platform?: NodeJS.Platform;
  /** A launch that failed after this call returned. The quick test is
   *  fire-and-forget by design (§16.29), so there is no promise to reject —
   *  and a packaged build shows nobody its stdout. */
  onError?: (error: Error) => void;
}

/**
 * `gmbt` off PATH, falling back to `%APPDATA%\GMBT\bin\gmbt.exe` — the same
 * two places the harness script looks, in the same order.
 */
export function resolveGmbtExecutable(deps: GmbtLaunchDeps = {}): string | null {
  const env = deps.env ?? process.env;
  const exists = deps.exists ?? existsSync;
  const platform = deps.platform ?? process.platform;
  const isWindows = platform === 'win32';
  // Windows paths are parsed as Windows paths whatever the host is: the tests
  // run on Linux in CI, where `path.delimiter` would split `C:\tools` in two.
  const paths = isWindows ? path.win32 : path.posix;
  // A batch file is not a candidate, whatever PATHEXT says: Node >= 20.12
  // refuses to spawn one without `shell: true` (the CVE-2024-27980 fix), and
  // `shell: true` is not the way out — the arguments would then go through
  // cmd's own parsing, which is the thing an argv array exists to avoid.
  // Resolving one would mean resolving something this service cannot launch.
  const unspawnable = new Set(['.BAT', '.CMD']);
  const extensions = isWindows
    ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
      .filter((extension) => !unspawnable.has(extension.toUpperCase()))
    : [''];
  for (const directory of (env.PATH ?? env.Path ?? '').split(paths.delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = paths.join(directory, `gmbt${extension}`);
      if (exists(candidate)) return candidate;
    }
  }
  const appData = env.APPDATA;
  if (appData) {
    const fallback = paths.join(appData, 'GMBT', 'bin', 'gmbt.exe');
    if (exists(fallback)) return fallback;
  }
  return null;
}

/**
 * `<NAME>` is the world's own on-disk filename — nothing is copied or renamed,
 * unlike the harness's forced `NEWWORLD.ZEN` staging. GMBT upper-cases the
 * argument and then compares it case-sensitively against the file on disk, so
 * the casing that works is a property of the mod folder, not of this call.
 */
export function quickTestArguments(worldFileName: string): string[] {
  return ['test', `--world=${worldFileName}`, ...QUICK_TEST_FLAGS];
}

/**
 * Whether the open world is a file GMBT would actually play.
 *
 * The launch is a *basename* plus a working directory, so `gmbt test` always
 * loads the GMBT project's own copy of that filename. A world opened from the
 * Gothic install and saved back therefore reads clean in this app while the
 * engine shows different bytes — the one failure mode a quick test cannot
 * report, because both halves succeeded.
 *
 * Case is folded on Windows: the folder is typed into the project file and the
 * world arrives from the open dialog, so their casing routinely disagrees on a
 * filesystem that does not care.
 */
export function worldIsInsideGmbtProject(
  gmbtProjectDir: string,
  worldPath: string,
  deps: { platform?: NodeJS.Platform } = {},
): boolean {
  const isWindows = (deps.platform ?? process.platform) === 'win32';
  const paths = isWindows ? path.win32 : path.posix;
  const fold = (candidate: string) => (isWindows ? candidate.toLowerCase() : candidate);
  const relative = paths.relative(fold(gmbtProjectDir), fold(worldPath));
  return relative !== '' && !relative.startsWith('..') && !paths.isAbsolute(relative);
}

export function startGmbtQuickTest(
  gmbtProjectDir: string,
  worldPath: string,
  deps: GmbtLaunchDeps = {},
): void {
  if (!worldIsInsideGmbtProject(gmbtProjectDir, worldPath, deps)) {
    throw new Error(
      'This world is not inside the GMBT project folder, and a quick test plays that folder\'s own copy:\n\n'
      + `Open world:\n${worldPath}\n\nGMBT project folder:\n${gmbtProjectDir}\n\n`
      + 'gmbt would load a file of the same name from the project folder instead, so the test would not show these edits. '
      + 'Open the world from inside the GMBT project folder, or point the project file at the folder this world belongs to.',
    );
  }
  const worldFileName = (deps.platform ?? process.platform) === 'win32'
    ? path.win32.basename(worldPath)
    : path.posix.basename(worldPath);
  const executable = resolveGmbtExecutable(deps);
  if (executable === null) {
    throw new Error('gmbt was not found on PATH or in %APPDATA%\\GMBT\\bin — install GMBT to run a quick test');
  }
  const spawn = deps.spawn ?? nodeSpawn;
  const child = spawn(executable, quickTestArguments(worldFileName), {
    cwd: gmbtProjectDir,
    detached: true,
    stdio: 'ignore',
  });
  // Nothing awaits the child, so a spawn failure arrives as an unhandled
  // 'error' event — which would take the main process down rather than the
  // quick test. It is reported through `onError` as well as the console: in a
  // packaged build nobody sees stdout, so a launch that never happened was
  // invisible on both sides of the IPC.
  child.on('error', (error) => {
    console.error('[GMBT] quick test failed to start:', error);
    deps.onError?.(error instanceof Error ? error : new Error(String(error)));
  });
  child.unref();
}
