import { spawn as nodeSpawn } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync } from 'node:fs';
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
 * Detached and unref'd, so nothing waits on it and it outlives the editor. Its
 * output goes to a log file, and a non-zero exit is reported with the end of
 * that log (#266): a failed script reparse used to show nothing at all.
 */
export const QUICK_TEST_FLAGS = ['--nomenu', '-D', '--noupdatesubtitles'] as const;

export interface GmbtLaunchDeps {
  env?: NodeJS.ProcessEnv;
  exists?: (candidate: string) => boolean;
  spawn?: typeof nodeSpawn;
  platform?: NodeJS.Platform;
  /** A launch that failed after this call returned: a spawn that never
   *  happened, or a run gmbt ended with a non-zero code. Nothing awaits the
   *  quick test (§16.29), so there is no promise to reject — and a packaged
   *  build shows nobody its stdout. */
  onError?: (error: Error) => void;
}

export interface GmbtQuickTestDeps extends GmbtLaunchDeps {
  /** Where gmbt's output goes, emptied at each launch. A file rather than a
   *  pipe: the run outlives the editor, and a pipe would break under it. */
  logPath: string;
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

/**
 * `gmbt compile --full`: what turns a mod's `.3DS`/`.ASC`/`.TGA` sources into the
 * compiled files ZenKit — and so the editor — can read (#296).
 *
 * `--full` because only it converts everything: GMBT's `Compile.cs` passes
 * `-zconvertall -ztexconvert -zautoconvertdata` to the game in full mode only,
 * and a quick compile leaves meshes to be converted in game. `--noupdatesubtitles`
 * for the quick test's reason: GMBT 0.22 throws in `UpdateDialogs()` on the
 * retail script set. What it does to the install is GMBT's usual, and the
 * editor says so before it runs it: the project's asset folders are merged into
 * `<gothicRoot>/_work/Data`, then Gothic runs headless and compiles into
 * `_work/Data/*\/_compiled` (environment-hazards.md, "GMBT empties `_work`").
 */
export function compileAssetsArguments(): string[] {
  return ['compile', '--full', '--noupdatesubtitles'];
}

/** How much of GMBT's output a failure carries — its last lines are where it
 *  says what went wrong, and the whole log is minutes of progress lines. */
const COMPILE_OUTPUT_TAIL = 4000;
const QUICK_TEST_OUTPUT_TAIL = 2000;

/**
 * Run `gmbt compile --full` in the GMBT project folder and wait for it (#296).
 *
 * Awaited, unlike the quick test: the editor remounts its VFS once GMBT is done,
 * and a failure has to reach the person who pressed the button rather than a
 * log file. It rejects with GMBT's exit code and the end of what it printed.
 */
export function runGmbtCompile(gmbtProjectDir: string, deps: GmbtLaunchDeps = {}): Promise<void> {
  const executable = resolveGmbtExecutable(deps);
  if (executable === null) {
    return Promise.reject(new Error(
      'gmbt was not found on PATH or in %APPDATA%\\GMBT\\bin — install GMBT to compile assets',
    ));
  }
  const spawn = deps.spawn ?? nodeSpawn;
  return new Promise<void>((resolve, reject) => {
    let output = '';
    const keep = (chunk: Buffer | string) => {
      output = (output + chunk.toString()).slice(-COMPILE_OUTPUT_TAIL);
    };
    const child = spawn(executable, compileAssetsArguments(), {
      cwd: gmbtProjectDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    child.stdout?.on('data', keep);
    child.stderr?.on('data', keep);
    child.on('error', (error) => reject(error instanceof Error ? error : new Error(String(error))));
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`gmbt compile exited with code ${String(code)}:\n${output.trim()}`));
    });
  });
}

export function startGmbtQuickTest(
  gmbtProjectDir: string,
  worldPath: string,
  deps: GmbtQuickTestDeps,
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
  // The child gets its own copy of the descriptor, so this one is closed once
  // it is handed over.
  const log = openSync(deps.logPath, 'w');
  let child;
  try {
    child = spawn(executable, quickTestArguments(worldFileName), {
      cwd: gmbtProjectDir,
      detached: true,
      stdio: ['ignore', log, log],
    });
  } finally {
    closeSync(log);
  }
  // Nothing awaits the child, so a spawn failure arrives as an unhandled
  // 'error' event — which would take the main process down rather than the
  // quick test. It is reported through `onError` as well as the console: in a
  // packaged build nobody sees stdout, so a launch that never happened was
  // invisible on both sides of the IPC.
  child.on('error', (error) => {
    console.error('[GMBT] quick test failed to start:', error);
    deps.onError?.(error instanceof Error ? error : new Error(String(error)));
  });
  child.on('exit', (code) => {
    if (code === 0 || code === null) return;
    const tail = readFileSync(deps.logPath, 'utf8').slice(-QUICK_TEST_OUTPUT_TAIL).trim();
    deps.onError?.(new Error(
      `gmbt test exited with code ${code}. The end of its log (${deps.logPath}):\n\n${tail}`,
    ));
  });
  child.unref();
}
