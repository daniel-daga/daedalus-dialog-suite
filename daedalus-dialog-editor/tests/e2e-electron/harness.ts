import { _electron as electron, test, type ElectronApplication, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import DaedalusParser from 'daedalus-parser';
import { SemanticModelBuilderVisitor } from 'daedalus-parser/semantic-visitor';

/**
 * Real-Electron E2E harness (fix-08 §2).
 *
 * Launches the built app with an isolated, per-test userData dir so no state
 * bleeds between tests, and provides call-time dialog stubs plus fixture
 * seeding. Keep every launch flag centralized here — the Electron upgrade
 * (29 -> latest) should touch only this file.
 *
 * PREREQUISITE: the editor must be built first (`npm run build`), producing
 * `dist/main/main.js` and `dist/renderer/index.html`. We launch with
 * `NODE_ENV=production`, which is the branch of `main.ts` that loads the built
 * renderer from disk. CI builds before invoking this config.
 */

// tests/e2e-electron -> daedalus-dialog-editor
const EDITOR_DIR = path.resolve(__dirname, '..', '..');
const FIXTURES_DIR = path.join(EDITOR_DIR, 'tests', 'fixtures');

export interface AppFixture {
  app: ElectronApplication;
  page: Page;
  /** Isolated userData dir; the main-process log lives at `logs/main.log` under it. */
  userDataDir: string;
  /** Close the app and remove the temp userData dir. */
  cleanup: () => Promise<void>;
}

export interface LaunchAppOptions {
  /** Initial settings persisted before Electron starts and constructs SettingsService. */
  settings?: Record<string, unknown>;
}

const tempDirs: string[] = [];

function mkTemp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

/** Launch the built Electron app against a fresh, isolated userData dir. */
export async function launchApp(options: LaunchAppOptions = {}): Promise<AppFixture> {
  const userDataDir = mkTemp('dde-e2e-userdata-');

  if (options.settings) {
    fs.writeFileSync(
      path.join(userDataDir, 'settings.json'),
      JSON.stringify(options.settings, null, 2),
      'utf8',
    );
  }

  const app = await electron.launch({
    // `.` loads the app at cwd (reads `main` from package.json -> dist/main/main.js).
    // `--no-sandbox` mirrors the `dev:electron` script and is required on CI runners.
    args: ['.', '--no-sandbox'],
    cwd: EDITOR_DIR,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      DDE_E2E_USER_DATA: userDataDir,
    },
  });

  // Keep the main process's own output. Its IPC handlers report failures with
  // `console.error` and the renderer awaits few of those calls, so a refused
  // write is silent from the page's side — the test sees only the effect that
  // never happened. Nothing else preserves this: CI keeps the Playwright report
  // but not the Electron process output, which is how a path-validation refusal
  // of every `<world>.folders.json` write read as an unexplained timeout.
  const mainOutput: string[] = [];
  app.process().stdout?.on('data', (chunk: Buffer) => mainOutput.push(chunk.toString()));
  app.process().stderr?.on('data', (chunk: Buffer) => mainOutput.push(chunk.toString()));

  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');

  /** Print the main process output, but only for a test that did not pass. */
  const reportMainOutput = () => {
    if (mainOutput.length === 0) return;
    let title: string;
    try {
      const info = test.info();
      if (info.status === 'passed') return;
      title = info.title;
    } catch {
      return; // Called outside a test; nothing to report against.
    }
    console.log(
      `\n--- Electron main process output for "${title}" ---\n`
      + `${mainOutput.join('')}\n--- end main process output ---\n`,
    );
  };

  const cleanup = async () => {
    reportMainOutput();
    // Destroy windows directly before closing: `destroy()` skips the `close`
    // event, so the window-close guard (which shows a modal dialog and waits
    // for the user when a file is dirty) can never block teardown. Without
    // this, a test ending with a dirty file hangs `app.close()` forever
    // (observed as CI worker-teardown timeouts). The app may already have
    // quit (e.g. the force-destroy spec) — ignore evaluate failures.
    try {
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows().forEach((w) => w.destroy());
      });
    } catch {
      // app already gone
    }
    // Belt and braces: never let close() hang the worker; kill after a bound.
    await Promise.race([
      app.close().catch(() => {}),
      new Promise<void>((resolve) => setTimeout(resolve, 10000)),
    ]);
    try {
      app.process().kill();
    } catch {
      // process already exited
    }
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      // best-effort temp cleanup
    }
  };

  return { app, page, userDataDir, cleanup };
}

/**
 * Stub `dialog.showOpenDialog` to return the given paths (a file for "Open
 * Single File", a directory for "Open Project").
 *
 * INVARIANT: this works only because `FileService`/`main.ts` reach for
 * `dialog.showOpenDialog` at CALL TIME on the shared `electron` module object.
 * A refactor that captures `dialog.showOpenDialog` into a const at import time
 * would silently break these stubs — keep dialog access lazy.
 */
export async function stubOpenDialog(app: ElectronApplication, filePaths: string[]): Promise<void> {
  await app.evaluate(({ dialog }, paths) => {
    (dialog as { showOpenDialog: unknown }).showOpenDialog = async () => ({
      canceled: false,
      filePaths: paths,
    });
  }, filePaths);
}

/** Route native open-directory/file dialogs by their user-visible title. */
export async function stubOpenDialogsByTitle(
  app: ElectronApplication,
  routes: Record<string, string[]>,
): Promise<void> {
  await app.evaluate(({ dialog }, dialogRoutes) => {
    (dialog as { showOpenDialog: (options: { title?: string }) => unknown }).showOpenDialog = async (
      options: { title?: string },
    ) => {
      const filePaths = options.title ? dialogRoutes[options.title] : undefined;
      if (!filePaths) throw new Error(`unexpected dialog: ${options.title ?? '<untitled>'}`);
      return { canceled: false, filePaths };
    };
  }, routes);
}

/** Stub `dialog.showSaveDialog` to return the given target path. Same call-time invariant as above. */
export async function stubSaveDialog(app: ElectronApplication, filePath: string): Promise<void> {
  await app.evaluate(({ dialog }, fp) => {
    (dialog as { showSaveDialog: unknown }).showSaveDialog = async () => ({
      canceled: false,
      filePath: fp,
    });
  }, filePath);
}

/**
 * Create a per-test temp project dir seeded by copying the named fixtures from
 * `tests/fixtures/`. Disk assertions read bytes directly from the returned dir.
 */
export function seedProjectDir(fixtureNames: string[]): string {
  const dir = mkTemp('dde-e2e-project-');
  for (const name of fixtureNames) {
    fs.copyFileSync(path.join(FIXTURES_DIR, name), path.join(dir, name));
  }
  return dir;
}

/** Read the main-process log file for a launched app, or null if it does not exist yet. */
export function readMainLog(userDataDir: string): string | null {
  const logPath = path.join(userDataDir, 'logs', 'main.log');
  try {
    return fs.readFileSync(logPath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Reparse Daedalus source with the real `daedalus-parser` package in the test
 * process (the same native parser + semantic visitor the app runs), returning
 * whether the model has syntax errors. Used to assert saved bytes are clean.
 */
export function reparse(source: string): { hasErrors: boolean; model: { dialogs: Record<string, unknown> } } {
  const wrapper = new DaedalusParser();
  const { tree } = wrapper.parse(source);
  const visitor = new SemanticModelBuilderVisitor();
  visitor.checkForSyntaxErrors(tree.rootNode, source);
  if (!visitor.semanticModel.hasErrors) {
    visitor.pass1_createObjects(tree.rootNode);
    visitor.pass2_analyzeAndLink(tree.rootNode);
  }
  return { hasErrors: !!visitor.semanticModel.hasErrors, model: visitor.semanticModel };
}
