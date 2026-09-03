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
}

/**
 * `gmbt` off PATH, falling back to `%APPDATA%\GMBT\bin\gmbt.exe` — the same
 * two places the harness script looks, in the same order.
 */
export function resolveGmbtExecutable(deps: GmbtLaunchDeps = {}): string | null {
  const env = deps.env ?? process.env;
  const exists = deps.exists ?? existsSync;
  const platform = deps.platform ?? process.platform;
  const extensions = platform === 'win32'
    ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
    : [''];
  for (const directory of (env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = path.join(directory, `gmbt${extension}`);
      if (exists(candidate)) return candidate;
    }
  }
  const appData = env.APPDATA;
  if (appData) {
    const fallback = path.join(appData, 'GMBT', 'bin', 'gmbt.exe');
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

export function startGmbtQuickTest(
  gmbtProjectDir: string,
  worldFileName: string,
  deps: GmbtLaunchDeps = {},
): void {
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
  // quick test.
  child.on('error', (error) => {
    console.error('[GMBT] quick test failed to start:', error);
  });
  child.unref();
}
