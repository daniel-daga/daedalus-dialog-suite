import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { parseAssetCatalog, parseVobFolders } from 'zen-world';
import { PathValidationError } from './services/PathValidationService';
import { getServiceRegistry } from './services/serviceRegistry';
import { saveFileFlow, type SaveFileFlowOptions } from './services/SaveFileFlow';
import { runOpenWorldSmoke } from './openWorldSmoke';
import { runParseSmoke } from './parseSmoke';
import { applyWindowSecurity } from './windowSecurity';
import {
  assertModelShape,
  assertDialogName,
  assertParseSourcePayload,
  assertOpenWorldRequest,
  assertTextureRequest,
  assertVisualRequest,
  assertThumbnailGetRequest,
  assertThumbnailPutRequest,
  assertAssetCatalogGetRequest,
  assertAssetCatalogSaveRequest,
  assertVobPropsRequest,
  assertApplyOpsRequest,
  assertSaveWorldRequest,
  assertVobFoldersGetRequest,
  assertVobFoldersSaveRequest,
  assertAppendInsertNpcRequest,
  sanitizeRendererErrorPayload,
  assertAssetSourcesPayload,
  assertOptionalFolderPath,
  assertExternalUrl,
} from './ipcValidation';
import { appendInsertNpcFlow } from './services/AppendInsertNpcFlow';
import { findInstallShaped, ProjectConfigService } from './services/ProjectConfigService';
import { startGmbtQuickTest } from './services/GmbtService';
import { readGmbtDefaultWorld } from './services/gmbtProject';
import { discoverWorlds } from './services/worldDiscovery';
import type { OpenedProjectConfig } from '../shared/projectConfigTypes';

// E2E userData isolation seam (fix-08 §2 / T9a). When the real-Electron E2E
// harness sets DDE_E2E_USER_DATA, redirect Electron's userData to a per-test
// temp dir BEFORE any service reads `app.getPath('userData')` — the
// SettingsService and LogService constructions below both resolve it eagerly.
// Inert in production: the env var is never set outside the E2E harness.
if (process.env.DDE_E2E_USER_DATA) {
  app.setPath('userData', process.env.DDE_E2E_USER_DATA);
}

let mainWindow: BrowserWindow | null = null;
// E1 window-close guard: main intercepts `close`, defers to the renderer, and
// only lets the window go once the renderer approves (or fails to ACK in time).
// Approval is per window — a window created after an approved close (macOS
// `activate`) has to ask the renderer again.
const closeApprovedWindows = new WeakSet<BrowserWindow>();
let closeGuardAckTimer: ReturnType<typeof setTimeout> | null = null;
// Every service is constructed by the composition root, which must be taken
// *after* the userData redirect above: SettingsService and LogService resolve
// that path in their constructors.
const {
  fileService,
  parserService,
  codeGeneratorService,
  validationService,
  projectService,
  settingsService,
  fileWatcherService,
  updaterService,
  worldService,
  worldFoldersService,
  thumbnailCacheService,
  assetCatalogService,
  logService,
  pathValidator,
} = getServiceRegistry();
const projectConfigService = new ProjectConfigService();

interface RegisteredProjectConfig {
  descriptor: OpenedProjectConfig;
  allowedAbsoluteSources: Set<string>;
}

const registeredProjectConfigs = new Map<string, RegisteredProjectConfig>();
let activeProjectFileKey: string | null = null;

/**
 * Every path `world:saveDialog` has handed back — the only targets `world:save`
 * will write to.
 *
 * The path whitelist cannot express this on its own, and that is the whole of
 * why this exists: the world the user opened is legitimately *readable*, so any
 * whitelist that lets the worker load it also lets a `saveWorld` call name it.
 * A write over a retail `.ZEN` has to be a thing the user chose in a save
 * dialog, not a thing the renderer decided — the overwrite prompt and the
 * `.edited.zen` suggestion are `WorldSurface`'s, which is the side the rule is
 * about. Reset with the handlers, like the registered configs above.
 */
const dialogChosenSaveTargets = new Set<string>();

/**
 * Make one world file reachable — the file itself and its `.folders.json`
 * sidecar, and nothing else in the folder it sits in.
 *
 * The script dialogs have always granted the exact file they opened
 * (`addAllowedFile`); the world ones granted `path.dirname(...)`, recursively,
 * which for a world listed out of a Gothic install is the whole of
 * `_work/Data/Worlds`. The sidecar is the one other path an open legitimately
 * reads or writes, and it is derived here rather than trusted from the
 * renderer, which is what keeps the pair exact.
 */
function allowWorldFile(worldPath: string): void {
  pathValidator.addAllowedFile(worldPath);
  pathValidator.addAllowedFile(worldFoldersService.sidecarPath(worldPath));
}

function projectFileKey(filePath: string): string {
  const normalized = path.normalize(path.resolve(filePath));
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function absoluteSourceKey(source: string): string {
  return projectFileKey(source);
}

function isConfiguredWorldMount(registered: RegisteredProjectConfig, mount: string): boolean {
  const mountKeys = new Set([absoluteSourceKey(mount)]);
  try { mountKeys.add(absoluteSourceKey(fs.realpathSync(mount))); } catch { /* source may be an archive path */ }
  const projectRoot = registered.descriptor.projectRoot;
  // The machine's installation is a configured mount too — it is configured in
  // the settings rather than the project file, and only main can write it.
  const configuredSources = registered.descriptor.gothicInstallPath === null
    ? registered.descriptor.config.assetSources
    : [...registered.descriptor.config.assetSources, registered.descriptor.gothicInstallPath];
  for (const configured of configuredSources) {
    const base = path.isAbsolute(configured) ? configured : path.resolve(projectRoot, configured);
    const bases = [base];
    try { bases.push(fs.realpathSync(base)); } catch { /* unavailable source is already omitted */ }
    for (const candidate of bases) {
      if (mountKeys.has(absoluteSourceKey(candidate))) return true;
      for (const mountKey of mountKeys) {
        const relative = path.relative(candidate, mountKey);
        if (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) return true;
      }
    }
  }
  return false;
}

/**
 * Re-resolve the active project against a changed machine install, so the
 * renderer sees the new mounts without reopening the project. Null when no
 * project is loaded — changing the setting is legal with none.
 */
async function reloadActiveProject(installPath: string | null): Promise<OpenedProjectConfig | null> {
  const registered = activeProjectFileKey ? registeredProjectConfigs.get(activeProjectFileKey) : undefined;
  if (!registered) return null;
  const reopened = await projectConfigService.openOrMigrate(registered.descriptor.projectRoot, installPath);
  registerProjectConfig(reopened.project);
  return reopened.project;
}

function registerProjectConfig(descriptor: OpenedProjectConfig): RegisteredProjectConfig {
  const key = projectFileKey(descriptor.projectFilePath);
  const existing = registeredProjectConfigs.get(key);
  const allowedAbsoluteSources = existing?.allowedAbsoluteSources ?? new Set<string>();
  // The GMBT folder rides along: it is written by the same dialog under the
  // same rule, and one already standing in the project file is as trusted as
  // an asset source standing there — otherwise re-saving the list would refuse
  // a path the file itself supplied.
  const configured = [
    ...descriptor.config.assetSources,
    ...(descriptor.config.gmbtProjectDir === undefined ? [] : [descriptor.config.gmbtProjectDir]),
    // What the detected GMBT project declares (§16.31). Main derived these
    // paths from the project file's own `.gmbt.yml`, so the dialog may save
    // them — they sit beside the project folder rather than inside it, and
    // without this a save of "Add from GMBT" would be refused as an escape.
    ...descriptor.gmbtAssetSources,
  ];
  for (const source of configured) {
    // Both spellings are granted: the absolute one because that is the key an
    // absolute save is checked against, and the resolved one because a
    // relative entry leaving the project folder is checked by where it lands.
    if (path.win32.isAbsolute(source) || path.posix.isAbsolute(source)) {
      allowedAbsoluteSources.add(absoluteSourceKey(source));
    } else {
      allowedAbsoluteSources.add(absoluteSourceKey(path.resolve(descriptor.projectRoot, source)));
    }
  }
  const registered = { descriptor, allowedAbsoluteSources };
  registeredProjectConfigs.set(key, registered);
  activeProjectFileKey = key;
  return registered;
}

// Crash visibility (fix-08 §5). Wire the process/app crash handlers before
// `app.whenReady()` so failures during startup are still captured. Deliberately
// log-only: no `process.exit`, no dialog — hard-fail semantics belong to the
// error-surfacing slices.
process.on('uncaughtException', (error) => {
  logService.log(
    'error',
    'main',
    `uncaughtException: ${error instanceof Error ? error.message : String(error)}`,
    error instanceof Error ? error.stack : undefined
  );
});

process.on('unhandledRejection', (reason) => {
  const error = reason instanceof Error ? reason : undefined;
  logService.log(
    'error',
    'main',
    `unhandledRejection: ${error ? error.message : String(reason)}`,
    error?.stack
  );
});

app.on('render-process-gone', (_event, _webContents, details) => {
  logService.log(
    'error',
    'renderer-process',
    `render-process-gone: reason=${details.reason} exitCode=${details.exitCode}`
  );
});

app.on('child-process-gone', (_event, details) => {
  logService.log(
    'error',
    'child-process',
    `child-process-gone: type=${details.type} reason=${details.reason} exitCode=${details.exitCode}`
  );
});

// Exported for the main-process tests, which drive the window lifecycle
// against a stubbed `electron` rather than a running app.
export function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Deny-by-default window-open / navigation before loading any content.
  applyWindowSecurity(mainWindow.webContents);

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    if (process.env.DEVTOOLS === '1') {
      mainWindow.webContents.openDevTools();
    }
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  // Register window with file watcher so it can send events to renderer
  fileWatcherService.setWindow(mainWindow);

  // Invalidate FileService caches when a file changes externally so the next
  // read re-detects encoding and the next expectUnchanged write re-checks
  // the disk mtime instead of trusting stale cached state.
  fileWatcherService.setOnExternalChange((filePath) => {
    fileService.clearEncodingCache(filePath);
    fileService.clearStatCache(filePath);
  });

  // E1: intercept the window close so the renderer can guard unsaved work.
  // `preventDefault` vetoes the close; we ask the renderer to flush pending
  // edits, list unsaved files, and choose. A safety timer force-destroys the
  // window if the renderer never acknowledges — this covers a hung/crashed
  // renderer (fix-03 R1 world), never a user still deciding (the ACK, sent
  // immediately on receipt, clears it).
  const win = mainWindow;
  win.on('close', (e) => {
    if (closeApprovedWindows.has(win)) {
      return;
    }
    e.preventDefault();
    win.webContents.send('app:closeRequested');
    closeGuardAckTimer = setTimeout(() => {
      closeApprovedWindows.add(win);
      win.destroy();
    }, 3000);
  });

  mainWindow.on('closed', () => {
    fileWatcherService.stopWatching();
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  // Packaged-app open-world smoke (build-windows.yml). CI launches the packaged
  // exe with these env vars set; no window is created, the world is opened
  // through the same WorldService call the world:open handler makes — which is
  // what loads the native addon in the packaged Electron — and the exit code is
  // the verdict. Inert in production: the env var is never set outside CI.
  if (process.env.DDE_SMOKE_OPEN_WORLD) {
    const result = await runOpenWorldSmoke(
      worldService,
      process.env.DDE_SMOKE_OPEN_WORLD,
      process.env.DDE_SMOKE_RESULT,
    );
    app.exit(result.ok ? 0 : 1);
    return;
  }

  // Packaged-app parse smoke (build-windows.yml), the same shape for the
  // tree-sitter bindings: no window, the fixture is parsed through the same
  // ParserService call the parser:parseSource handler makes — which is what
  // loads the bindings in the packaged Electron — and the exit code is the
  // verdict. Inert in production.
  if (process.env.DDE_SMOKE_PARSE) {
    const result = await runParseSmoke(
      parserService,
      process.env.DDE_SMOKE_PARSE,
      process.env.DDE_SMOKE_RESULT,
    );
    app.exit(result.ok ? 0 : 1);
    return;
  }

  // Initialize path validator with recent projects to allow opening them
  try {
    const recentProjects = await settingsService.getRecentProjects();
    recentProjects.forEach(project => {
      pathValidator.addAllowedPath(project.path);
    });
  } catch (error) {
    console.error('Failed to initialize path validator with recent projects:', error);
  }

  setupIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Exported for the main-process IPC tests, which register the handlers against
// a stubbed `electron` rather than a running app.
export function setupIpcHandlers() {
  registeredProjectConfigs.clear();
  activeProjectFileKey = null;
  dialogChosenSaveTargets.clear();
  // Parser handler (main process has access to native modules)
  ipcMain.handle('parser:parseSource', async (_event, sourceCode: unknown) => {
    try {
      assertParseSourcePayload(sourceCode);
      return await parserService.parseSource(sourceCode);
    } catch (error) {
      console.error('[IPC] parser:parseSource error:', error);
      throw new Error(`Failed to parse source: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  // Code generator handlers
  ipcMain.handle('generator:generateCode', async (_event, model: any, settings: any) => {
    try {
      assertModelShape(model);
      return codeGeneratorService.generateCode(model, settings);
    } catch (error) {
      console.error('[IPC] generator:generateCode error:', error);
      throw new Error(`Failed to generate code: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle('generator:generateDialogCode', async (_event, model: any, dialogName: string, settings: any) => {
    try {
      assertModelShape(model);
      assertDialogName(dialogName);
      return codeGeneratorService.generateDialogCode(model, dialogName, settings);
    } catch (error) {
      console.error('[IPC] generator:generateDialogCode error:', error);
      throw new Error(`Failed to generate dialog code: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  // Validation handler - validates model without saving
  ipcMain.handle('validation:validate', async (_event, model: any, settings: any, options?: any) => {
    try {
      assertModelShape(model);
      return validationService.validate(model, settings, options);
    } catch (error) {
      console.error('[IPC] validation:validate error:', error);
      throw new Error(`Validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle('generator:saveFile', async (_event, filePath: string, model: any, settings: any, options?: SaveFileFlowOptions) =>
    saveFileFlow(
      { pathValidator, validationService, codeGeneratorService, parserService, fileService, fileWatcherService },
      filePath,
      model,
      settings,
      options
    ));

  // File I/O handlers
  ipcMain.handle('file:read', async (_event, filePath: string) => {
    try {
      // Validate path before reading (symlink-resolved)
      await pathValidator.validatePathResolved(filePath);

      return fileService.readFile(filePath);
    } catch (error) {
      if (error instanceof PathValidationError) {
        console.error('[IPC] file:read - Path validation failed:', error.message);
        throw new Error(error.message);
      }
      console.error('[IPC] file:read error:', error);
      throw new Error(`Failed to read file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle('file:write', async (_event, filePath: string, content: string, options?: { overwriteExternal?: boolean }) => {
    try {
      // Validate path before writing (symlink-resolved, write mode)
      await pathValidator.validatePathResolved(filePath, { write: true });

      const writeResult = await fileService.writeFile(filePath, content, { expectUnchanged: !options?.overwriteExternal });
      // Arm self-write suppression only after an actual write succeeds
      fileWatcherService.notifySelfWrite(filePath);
      return writeResult;
    } catch (error) {
      if (error instanceof PathValidationError) {
        console.error('[IPC] file:write - Path validation failed:', error.message);
        throw new Error(error.message);
      }
      console.error('[IPC] file:write error:', error);
      throw new Error(`Failed to write file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle('file:openDialog', async () => {
    try {
      const filePath = await fileService.openFileDialog();

      // Whitelist only the exact file the user selected, not its directory.
      if (filePath) {
        pathValidator.addAllowedFile(filePath);
      }

      return filePath;
    } catch (error) {
      console.error('[IPC] file:openDialog error:', error);
      throw new Error(`Failed to open file dialog: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle('file:saveDialog', async () => {
    try {
      const filePath = await fileService.saveFileDialog();

      // Whitelist only the exact save target the user selected, not its directory.
      if (filePath) {
        pathValidator.addAllowedFile(filePath);
      }

      return filePath;
    } catch (error) {
      console.error('[IPC] file:saveDialog error:', error);
      throw new Error(`Failed to open save dialog: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  // Project handlers
  ipcMain.handle('project:openFolderDialog', async () => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openDirectory'],
        title: 'Select Gothic Mod Project Folder'
      });

      if (result.canceled || result.filePaths.length === 0) {
        return null;
      }

      const folderPath = result.filePaths[0];

      // When user selects a project folder, add it to allowed paths and
      // persist it as a recent project. This is the only place recents are
      // written — recents seed the path whitelist on next launch, so the
      // write must originate from a main-process-chosen path, never a
      // renderer-supplied one (see docs/architecture/security-model.md).
      pathValidator.addAllowedPath(folderPath);
      await settingsService.addRecentProject(folderPath, path.basename(folderPath));

      return folderPath;
    } catch (error) {
      console.error('[IPC] project:openFolderDialog error:', error);
      throw new Error(`Failed to open folder dialog: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle('project:loadConfig', async (_event, projectRoot: unknown) => {
    if (typeof projectRoot !== 'string' || projectRoot.trim() === '') {
      throw new Error('Invalid project root: expected a non-empty string');
    }
    await pathValidator.validatePathResolved(projectRoot);
    const installPath = await settingsService.getGothicInstallPath();
    let opened = await projectConfigService.openOrMigrate(projectRoot, installPath);
    // A project file written while the install lived in the list hands it to
    // the setting (§9): the entry stays where it is and mounts once, but from
    // now on it is machine state, and the next project inherits it.
    if (installPath === null) {
      const adopted = await findInstallShaped(opened.project.resolvedAssetRoots);
      if (adopted !== null) {
        try {
          await settingsService.setGothicInstallPath(adopted);
          opened = await projectConfigService.openOrMigrate(projectRoot, adopted);
        } catch (error) {
          console.warn('[IPC] project:loadConfig - could not adopt the configured Gothic install:', error);
        }
      }
    }
    registerProjectConfig(opened.project);
    return opened.project;
  });

  /**
   * The machine's Gothic installation (§9). Machine-local, so it is a setting
   * and not a project field — and written only here, from a main-process
   * folder dialog, which is what lets it seed the path whitelist.
   */
  ipcMain.handle('settings:selectGothicInstall', async () => {
    const current = await settingsService.getGothicInstallPath();
    const result = await dialog.showOpenDialog({
      ...(current === null ? {} : { defaultPath: current }),
      properties: ['openDirectory'],
      title: 'Select the Gothic installation folder',
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const selected = result.filePaths[0];
    pathValidator.addAllowedPath(selected);
    await settingsService.setGothicInstallPath(selected);
    return reloadActiveProject(selected);
  });

  ipcMain.handle('settings:clearGothicInstall', async () => {
    await settingsService.clearGothicInstallPath();
    return reloadActiveProject(null);
  });

  ipcMain.handle('project:selectAssetSourceFolder', async (_event, defaultPath: unknown) => {
    assertOptionalFolderPath(defaultPath);
    if (!activeProjectFileKey) throw new Error('Load a project before selecting an asset source folder');
    const projectKey = activeProjectFileKey;
    const registered = registeredProjectConfigs.get(projectKey);
    if (!registered) throw new Error('The active project is no longer loaded');
    const result = await dialog.showOpenDialog({
      ...(defaultPath === undefined ? {} : { defaultPath }),
      properties: ['openDirectory'],
      title: 'Select asset source folder',
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const selected = result.filePaths[0];
    // The dialog may stay open while another project becomes active. Grant the
    // selection to the project that launched it, never whichever project is
    // active when the promise settles. If that registration was replaced in
    // the meantime, it is stale and must not be revived by this late result.
    if (registeredProjectConfigs.get(projectKey) !== registered) return null;
    pathValidator.addAllowedPath(selected);
    registered.allowedAbsoluteSources.add(absoluteSourceKey(selected));
    return selected;
  });

  ipcMain.handle('project:saveAssetSources', async (
    _event, projectFilePath: unknown, assetSources: unknown, gmbtProjectDir: unknown,
  ) => {
    if (typeof projectFilePath !== 'string' || projectFilePath.trim() === '') {
      throw new Error('Invalid project file path: expected a non-empty string');
    }
    assertAssetSourcesPayload(assetSources);
    if (!assetSources.includes('.')) throw new Error('assetSources must include "."');
    if (gmbtProjectDir !== undefined && gmbtProjectDir !== null
      && (typeof gmbtProjectDir !== 'string' || gmbtProjectDir.trim() === '')) {
      throw new Error('Invalid GMBT project folder: expected a non-empty string or null');
    }
    const key = projectFileKey(projectFilePath);
    const registered = registeredProjectConfigs.get(key);
    if (!registered) throw new Error('Project file is not a loaded project');
    const root = path.dirname(path.resolve(projectFilePath));
    // The GMBT folder is written by the same dialog and reaches the disk the
    // same way, so it answers to the same rule the sources do: an absolute path
    // has to have come from the native picker (which is what whitelists it),
    // and a relative one has to stay inside the project.
    const configuredPaths = gmbtProjectDir === undefined || gmbtProjectDir === null
      ? assetSources : [...assetSources, gmbtProjectDir];
    for (const source of configuredPaths) {
      if (path.win32.isAbsolute(source) || path.posix.isAbsolute(source)) {
        if (!registered.allowedAbsoluteSources.has(absoluteSourceKey(source))) {
          throw new Error('External asset sources must be loaded from this project or chosen through the native folder picker');
        }
      } else {
        const resolved = path.resolve(root, source);
        const relative = path.relative(root, resolved);
        if ((relative.startsWith('..') || path.isAbsolute(relative))
          && !registered.allowedAbsoluteSources.has(absoluteSourceKey(resolved))) {
          throw new Error('Relative asset sources must stay within the project folder');
        }
      }
    }
    await pathValidator.validatePathResolved(projectFilePath, { write: true });
    const descriptor = await projectConfigService.updateProjectPaths(
      projectFilePath, assetSources, gmbtProjectDir as string | null | undefined,
      await settingsService.getGothicInstallPath(),
    );
    registerProjectConfig(descriptor);
    return descriptor;
  });

  ipcMain.handle('project:buildIndex', async (_event, folderPath: string) => {
    try {
      // Validate project folder path (symlink-resolved)
      await pathValidator.validatePathResolved(folderPath);

      return await projectService.buildProjectIndex(folderPath);
    } catch (error) {
      if (error instanceof PathValidationError) {
        console.error('[IPC] project:buildIndex - Path validation failed:', error.message);
        throw new Error(error.message);
      }
      console.error('[IPC] project:buildIndex error:', error);
      throw new Error(`Failed to build project index: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle('project:parseDialogFile', async (_event, filePath: string) => {
    try {
      // Validate file path before parsing (symlink-resolved)
      await pathValidator.validatePathResolved(filePath);

      // The index build already parsed this file and primed the model
      // (path+mtime checked); serve it instead of parsing a second time.
      const primed = await projectService.takeParsedModel(filePath);
      if (primed) {
        return primed;
      }

      const content = await fileService.readFile(filePath);
      return await parserService.parseSource(content);
    } catch (error) {
      if (error instanceof PathValidationError) {
        console.error('[IPC] project:parseDialogFile - Path validation failed:', error.message);
        throw new Error(error.message);
      }
      console.error('[IPC] project:parseDialogFile error:', error);
      throw new Error(`Failed to parse dialog file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle('project:addAllowedPath', async (_event, folderPath: string) => {
    try {
      // Security: the renderer may only re-whitelist a path the user has
      // already opened (persisted in recent projects). Brand-new folders are
      // whitelisted by the main-process folder dialog and addRecentProject —
      // not by the renderer — so unknown paths are silently ignored here.
      // This prevents a compromised renderer from whitelisting arbitrary
      // directories and defeating PathValidationService.
      if (await settingsService.isKnownRecentProject(folderPath)) {
        pathValidator.addAllowedPath(folderPath);
      } else {
        console.warn('[IPC] project:addAllowedPath - ignoring unknown path:', folderPath);
      }
    } catch (error) {
      console.error('[IPC] project:addAllowedPath error:', error);
      throw new Error(`Failed to add allowed path: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  // Settings handlers
  ipcMain.handle('settings:getRecentProjects', async () => {
    try {
      return settingsService.getRecentProjects();
    } catch (error) {
      console.error('[IPC] settings:getRecentProjects error:', error);
      throw new Error(`Failed to get recent projects: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  // File watcher handlers
  ipcMain.handle('fileWatcher:start', async (_event, projectPath: string) => {
    try {
      // Validate path before watching (symlink-resolved)
      await pathValidator.validatePathResolved(projectPath);

      await fileWatcherService.startWatching(projectPath);
    } catch (error) {
      if (error instanceof PathValidationError) {
        console.error('[IPC] fileWatcher:start - Path validation failed:', error.message);
        throw new Error(error.message);
      }
      console.error('[IPC] fileWatcher:start error:', error);
      throw new Error(`Failed to start file watcher: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle('fileWatcher:stop', async () => {
    try {
      await fileWatcherService.stopWatching();
    } catch (error) {
      console.error('[IPC] fileWatcher:stop error:', error);
      throw new Error(`Failed to stop file watcher: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  // App info
  ipcMain.handle('app:getVersion', () => app.getVersion());

  // Crash logging (fix-08 §5). Validate the renderer-forwarded payload at the
  // boundary: strings only, bounded lengths, drop anything else.
  ipcMain.handle('log:rendererError', (_event, payload: unknown) => {
    const sanitized = sanitizeRendererErrorPayload(payload);
    if (!sanitized) {
      return;
    }
    logService.log('error', 'renderer', sanitized.message, sanitized.stack);
  });

  ipcMain.handle('app:getLogPath', () => logService.getLogFilePath());

  ipcMain.handle('app:showLogFile', () => {
    shell.showItemInFolder(logService.getLogFilePath());
  });

  // Window close guard (E1). `before-quit` needs no extra handling — quitting
  // closes the window, and the `close` handler above runs and defers here.
  ipcMain.on('app:ackCloseRequest', () => {
    // The renderer is alive and handling the request — cancel the force-close
    // safety net. The user may now take as long as they like to decide.
    if (closeGuardAckTimer) {
      clearTimeout(closeGuardAckTimer);
      closeGuardAckTimer = null;
    }
  });

  ipcMain.on('app:approveClose', () => {
    if (closeGuardAckTimer) {
      clearTimeout(closeGuardAckTimer);
      closeGuardAckTimer = null;
    }
    if (mainWindow) {
      closeApprovedWindows.add(mainWindow);
      mainWindow.close();
    }
  });

  ipcMain.on('app:cancelClose', () => {
    // The user chose to stay. Nothing to do: the close was already vetoed and
    // the ACK cleared the safety timer.
  });

  // Updater handlers
  ipcMain.handle('updater:checkForUpdate', async () => {
    try {
      return await updaterService.checkForUpdate();
    } catch (error) {
      console.error('[IPC] updater:checkForUpdate error:', error);
      throw new Error(`Failed to check for update: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle('updater:downloadUpdate', async (_event, url: string) => {
    try {
      const installerPath = await updaterService.downloadUpdate(url, (percent) => {
        if (mainWindow) {
          mainWindow.webContents.send('updater:downloadProgress', percent);
        }
      });
      return installerPath;
    } catch (error) {
      console.error('[IPC] updater:downloadUpdate error:', error);
      throw new Error(`Failed to download update: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle('updater:dismissVersion', async (_event, version: string) => {
    try {
      await settingsService.setUpdaterDismissedVersion(typeof version === 'string' ? version : null);
    } catch (error) {
      console.error('[IPC] updater:dismissVersion error:', error);
    }
  });

  // "View release notes" and nothing else: the one channel that leaves the app
  // for the system browser, restricted to https at the boundary.
  ipcMain.handle('shell:openExternal', async (_event, url: unknown) => {
    assertExternalUrl(url);
    await shell.openExternal(url);
  });

  ipcMain.handle('updater:installUpdate', (_event, installerPath: string) => {
    try {
      updaterService.installUpdate(installerPath);
    } catch (error) {
      console.error('[IPC] updater:installUpdate error:', error);
      throw new Error(`Failed to install update: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  // World handlers (level-editor.md §7). The world itself never crosses this
  // boundary: the renderer gets the lightweight VobIndex plus geometry and
  // texture buffers, and the authoritative model stays in the worker.
  //
  // Both directory dialogs below are the only writers of a whitelisted path, in
  // the same pattern project:openFolderDialog uses — a compromised renderer
  // cannot reach outside what the user has actually opened.
  // The worlds the project's own asset sources hold (level-editor.md §16.31),
  // so opening one is a list rather than a native file dialog aimed at a single
  // install. Whitelisting the folders they sit in is safe for the same reason
  // registerProjectConfig whitelists an absolute asset source: the paths come
  // from the project file the user has already opened, not from the renderer.
  ipcMain.handle('world:listWorlds', async () => {
    try {
      const registered = activeProjectFileKey
        ? registeredProjectConfigs.get(activeProjectFileKey)
        : undefined;
      if (!registered) return [];
      const project = registered.descriptor;
      const defaultWorld = project.gmbtProjectDir === null
        ? null
        : await readGmbtDefaultWorld(project.gmbtProjectDir);
      const worlds = await discoverWorlds(project.resolvedAssetRoots, defaultWorld);
      for (const world of worlds) allowWorldFile(world.path);
      return worlds;
    } catch (error) {
      console.error('[IPC] world:listWorlds error:', error);
      throw new Error(`Failed to list worlds: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle('world:openDialog', async () => {
    try {
      // Start where the worlds are. `.zen` files only exist loose in an
      // extracted install's `_work/Data/Worlds` (the same `_work/Data` tree
      // Archives have no filesystem path to offer, so omit defaultPath when
      // the project has no configured loose world entry.
      let defaultPath: string | undefined;
      const registered = activeProjectFileKey
        ? registeredProjectConfigs.get(activeProjectFileKey)
        : undefined;
      const project = registered?.descriptor;
      const worldPart = project?.config.worlds
        .flatMap((world) => world.parts)
        .find((part) => {
          const candidate = path.isAbsolute(part.path)
            ? part.path
            : path.resolve(project!.projectRoot, part.path);
          return part.role === 'main' && fs.existsSync(candidate);
        });
      if (worldPart && project) {
        const candidate = path.isAbsolute(worldPart.path)
          ? worldPart.path
          : path.resolve(project.projectRoot, worldPart.path);
        defaultPath = fs.statSync(candidate).isDirectory() ? candidate : path.dirname(candidate);
      }

      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        title: 'Open a ZenGin world',
        filters: [{ name: 'ZenGin world', extensions: ['zen'] }],
        ...(defaultPath ? { defaultPath } : {}),
      });
      if (result.canceled || result.filePaths.length === 0) return null;

      const worldPath = result.filePaths[0];
      allowWorldFile(worldPath);
      return worldPath;
    } catch (error) {
      console.error('[IPC] world:openDialog error:', error);
      throw new Error(`Failed to open world dialog: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle('world:open', async (_event, request: unknown) => {
    try {
      assertOpenWorldRequest(request);
      await pathValidator.validatePathResolved(request.worldPath);

      const key = projectFileKey(request.projectFilePath);
      if (activeProjectFileKey !== key) {
        throw new Error('The requested project is not the active project');
      }
      const registered = registeredProjectConfigs.get(key);
      if (!registered) throw new Error('Load a project before opening a world');
      const refreshed = await projectConfigService.openOrMigrate(
        registered.descriptor.projectRoot, await settingsService.getGothicInstallPath(),
      );
      if (activeProjectFileKey !== key || registeredProjectConfigs.get(key) !== registered) {
        throw new Error('The active project changed while loading the project configuration');
      }
      const refreshedRegistration = registerProjectConfig(refreshed.project);
      const assetSources = refreshed.project.resolvedAssetSources;
      if (assetSources.length === 0) {
        throw new Error('Configure at least one available asset source before opening a world.');
      }
      // Without the retail assets a world opens white and empty — every visual
      // and texture a Gothic world names lives in the installation, not in the
      // mod (§16.31). Said here rather than left to be discovered on screen.
      if (refreshed.project.gothicInstallPath === null) {
        throw new Error('No Gothic installation is configured. Set it in Asset sources — the mod folders alone hold none of the retail meshes or textures a world draws.');
      }

      for (const source of assetSources) {
        if (!isConfiguredWorldMount(refreshedRegistration, source)) {
          throw new Error(`World asset mount is not configured for the active project: ${source}`);
        }
      }
      if (activeProjectFileKey !== key || registeredProjectConfigs.get(key) !== refreshedRegistration) {
        throw new Error('The active project changed while validating asset sources');
      }
      return await worldService.openWorld({
        worldPath: request.worldPath,
        gameVersion: request.gameVersion,
        assetSources,
      });
    } catch (error) {
      if (error instanceof PathValidationError) {
        console.error('[IPC] world:open - Path validation failed:', error.message);
        throw new Error(error.message);
      }
      console.error('[IPC] world:open error:', error);
      throw new Error(`Failed to open world: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  // The GMBT quick test (§16.29). No payload, and deliberately so: both halves
  // of the launch — the working directory and the `--world` filename — are read
  // from state this process already owns, so the renderer cannot name a folder
  // to run a program in or a file to hand it.
  ipcMain.handle('world:gmbtQuickTest', async () => {
    const registered = activeProjectFileKey === null
      ? undefined
      : registeredProjectConfigs.get(activeProjectFileKey);
    const gmbtProjectDir = registered?.descriptor.gmbtProjectDir ?? null;
    if (gmbtProjectDir === null) {
      throw new Error('Set "gmbtProjectDir" in the project file to a GMBT project folder to run a quick test');
    }
    startGmbtQuickTest(gmbtProjectDir, path.basename(worldService.openWorldPath()), {
      // Fire-and-forget, so this is the only record a failed launch leaves —
      // and the log file is the one the app can actually show.
      onError: (error) => logService.log(
        'error', 'main', `GMBT quick test failed to start: ${error.message}`, error.stack,
      ),
    });
  });

  ipcMain.handle('world:mesh', async () => worldService.getWorldMesh());
  ipcMain.handle('world:visuals', async () => worldService.getInstancedVisuals());

  ipcMain.handle('world:texture', async (_event, request: unknown) => {
    assertTextureRequest(request);
    return worldService.getTexture(request.name, request.maxSize);
  });

  ipcMain.handle('world:assets', async (_event, request: unknown) => {
    // The path is a position inside the *mounted VFS namespace*, not a
    // filesystem path, so it never reaches the disk and the path validator has
    // nothing to validate. The listing is bounded to one directory.
    const path = typeof request === 'object' && request !== null && 'path' in request
      && typeof (request as { path: unknown }).path === 'string'
      ? (request as { path: string }).path
      : '/';
    return worldService.listAssets(path);
  });

  ipcMain.handle('world:waynet', async () => worldService.getWaynet());
  // No payload, like `world:waynet`, so there is nothing to validate: the
  // findings are computed over the world the worker already holds.
  ipcMain.handle('world:portalFindings', async () => worldService.getPortalFindings());

  // One visual for the Assets panel's mesh preview — a name inside the mounted
  // VFS namespace like `world:texture`, never a filesystem path.
  ipcMain.handle('world:visual', async (_event, request: unknown) => {
    assertVisualRequest(request);
    return worldService.getVisual(request.name);
  });

  // The thumbnail cache (level-editor.md §16.26 row 1). A read answers the key
  // it was looked up under, so the renderer — the only process with a GPU —
  // can draw the missing image and hand it back under that same key. The key
  // is a digest and never a path; the bytes are checked as PNG before they
  // touch `userData`.
  ipcMain.handle('world:getThumbnail', async (_event, request: unknown) => {
    assertThumbnailGetRequest(request);
    const key = await thumbnailCacheService.keyFor(request.name, worldService.openAssetSources());
    return { key, dataUrl: await thumbnailCacheService.load(key) };
  });
  ipcMain.handle('world:putThumbnail', async (_event, request: unknown) => {
    assertThumbnailPutRequest(request);
    await thumbnailCacheService.store(request.key, request.dataUrl);
  });

  // A name inside the mounted VFS namespace, exactly like `world:assets` — it
  // never reaches the disk, so the path validator has nothing to validate.
  ipcMain.handle('world:visualBounds', async (_event, request: unknown) => {
    const name = typeof request === 'object' && request !== null && 'name' in request
      && typeof (request as { name: unknown }).name === 'string'
      ? (request as { name: string }).name
      : null;
    if (name === null || name.trim() === '') {
      throw new Error('Invalid visual bounds request: name must be a non-empty string');
    }
    return worldService.getVisualBounds(name);
  });

  // The per-class fields of one VOB. A read of the world the worker holds — the
  // columnar index carries none of this — and the address is a path down that
  // world's tree, not a filesystem path, so the whitelist has nothing to say
  // about it and the shape assertion is the whole boundary.
  ipcMain.handle('world:vobProps', async (_event, request: unknown) => {
    assertVobPropsRequest(request);
    return worldService.getVobProps(request.path);
  });

  // The VOB enumeration again, after a structural edit changed it. It reads the
  // world the worker already holds — nothing on disk is touched.
  ipcMain.handle('world:refreshIndex', async () => worldService.refreshIndex());

  // The first IPC that changes the world rather than reading a projection of
  // it (level-editor.md §7). The history is the service's, not the renderer's:
  // an op addresses a VOB by its index path down the world the worker holds.
  ipcMain.handle('world:applyOps', async (_event, request: unknown) => {
    assertApplyOpsRequest(request);
    await worldService.applyOps(request.ops);
  });

  // Saving (level-editor.md §5). Two handlers, because the target is chosen in
  // a main-process dialog and only then does the path exist: a renderer that
  // could name its own target could write anywhere the whitelist allows, and
  // the worlds this app opens are retail game files.
  ipcMain.handle('world:saveDialog', async (_event, request: unknown) => {
    try {
      const suggested = typeof request === 'object' && request !== null && 'suggested' in request
        && typeof (request as { suggested: unknown }).suggested === 'string'
        ? (request as { suggested: string }).suggested
        : 'world.zen';

      const result = await dialog.showSaveDialog({
        title: 'Save the world',
        defaultPath: suggested,
        filters: [{ name: 'ZenGin world', extensions: ['zen'] }],
        // Electron's own overwrite prompt is the confirmation for writing over
        // an existing file, and the suggested name is deliberately not the one
        // the world was opened under.
        properties: ['showOverwriteConfirmation', 'createDirectory'],
      });
      if (result.canceled || !result.filePath) return null;

      pathValidator.addAllowedFile(result.filePath);
      dialogChosenSaveTargets.add(path.normalize(result.filePath));
      return result.filePath;
    } catch (error) {
      console.error('[IPC] world:saveDialog error:', error);
      throw new Error(`Failed to open save dialog: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle('world:save', async (_event, request: unknown) => {
    try {
      assertSaveWorldRequest(request);
      // Ahead of the whitelist, because the whitelist cannot answer it: the
      // opened world is readable and would therefore be writable.
      if (!dialogChosenSaveTargets.has(path.normalize(request.targetPath))) {
        throw new Error('Choose where to save through the save dialog.');
      }
      await pathValidator.validatePathResolved(request.targetPath, { write: true });
      await worldService.saveWorld(request.targetPath);
    } catch (error) {
      if (error instanceof PathValidationError) {
        console.error('[IPC] world:save - Path validation failed:', error.message);
        throw new Error(error.message);
      }
      console.error('[IPC] world:save error:', error);
      // The binding's own refusal — a non-BinSafe world — is the message worth
      // showing, so it is passed through rather than replaced.
      throw new Error(error instanceof Error ? error.message : 'Failed to save the world');
    }
  });

  // The `<worldname>.folders.json` sidecar (VOB folders slice) — user-created,
  // editor-only VOB groupings, kept beside the world file rather than in it.
  // Stateless like `world:save`: the renderer already holds the open world's
  // path (`WorldSummary.worldPath`) and carries it on every call rather than
  // this process tracking a second one.
  ipcMain.handle('world:getVobFolders', async (_event, request: unknown) => {
    try {
      assertVobFoldersGetRequest(request);
      await pathValidator.validatePathResolved(worldFoldersService.sidecarPath(request.worldPath));
      return await worldFoldersService.load(request.worldPath);
    } catch (error) {
      if (error instanceof PathValidationError) {
        console.error('[IPC] world:getVobFolders - Path validation failed:', error.message);
        throw new Error(error.message);
      }
      console.error('[IPC] world:getVobFolders error:', error);
      throw new Error(`Failed to read VOB folders: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle('world:saveVobFolders', async (_event, request: unknown) => {
    try {
      assertVobFoldersSaveRequest(request);
      await pathValidator.validatePathResolved(
        worldFoldersService.sidecarPath(request.worldPath), { write: true },
      );
      // `folders` is untrusted regardless of the shape assertion above — it is
      // re-derived through `parseVobFolders` rather than written as given.
      await worldFoldersService.save(request.worldPath, parseVobFolders(request.folders));
    } catch (error) {
      if (error instanceof PathValidationError) {
        console.error('[IPC] world:saveVobFolders - Path validation failed:', error.message);
        throw new Error(error.message);
      }
      console.error('[IPC] world:saveVobFolders error:', error);
      throw new Error(`Failed to save VOB folders: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  // The `<project>.assets.json` sidecar (§16.26, "Wanted on top") — the asset
  // browser's favorites and categories, beside the project file. The same
  // shape as the folders sidecar above: stateless, path-validated against the
  // exact file, the payload re-derived rather than written as given.
  ipcMain.handle('project:getAssetCatalog', async (_event, request: unknown) => {
    try {
      assertAssetCatalogGetRequest(request);
      await pathValidator.validatePathResolved(assetCatalogService.sidecarPath(request.projectFilePath));
      return await assetCatalogService.load(request.projectFilePath);
    } catch (error) {
      if (error instanceof PathValidationError) {
        console.error('[IPC] project:getAssetCatalog - Path validation failed:', error.message);
        throw new Error(error.message);
      }
      console.error('[IPC] project:getAssetCatalog error:', error);
      throw new Error(`Failed to read asset catalog: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle('project:saveAssetCatalog', async (_event, request: unknown) => {
    try {
      assertAssetCatalogSaveRequest(request);
      await pathValidator.validatePathResolved(
        assetCatalogService.sidecarPath(request.projectFilePath), { write: true },
      );
      await assetCatalogService.save(request.projectFilePath, parseAssetCatalog(request.catalog));
    } catch (error) {
      if (error instanceof PathValidationError) {
        console.error('[IPC] project:saveAssetCatalog - Path validation failed:', error.message);
        throw new Error(error.message);
      }
      console.error('[IPC] project:saveAssetCatalog error:', error);
      throw new Error(`Failed to save asset catalog: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  // Append a `Wld_InsertNpc` to a `STARTUP_<world>` function on disk by text
  // splice (level-editor.md §16.19, slice 16 C). The shape check is here;
  // the flow parses the file itself and answers with a typed result.
  ipcMain.handle('script:appendInsertNpc', async (_event, request: unknown) => {
    assertAppendInsertNpcRequest(request);
    return appendInsertNpcFlow(
      { pathValidator, fileService, parserService, fileWatcherService },
      request.filePath, request.functionName, request.npcInstance, request.spawnPoint,
    );
  });

  ipcMain.handle('world:undo', async () => worldService.undo());
  ipcMain.handle('world:redo', async () => worldService.redo());
  // The stacks are private to the service (§7); this is the World bar's
  // undo/redo buttons' only way to know whether either has anything in it.
  ipcMain.handle('world:historyDepth', () => worldService.historyDepth());

  ipcMain.handle('world:close', () => {
    worldService.close();
  });
}
