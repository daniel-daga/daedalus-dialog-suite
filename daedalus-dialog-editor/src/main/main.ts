import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { gothicAssetSources, parseVobFolders } from 'zen-world';
import { PathValidationError } from './services/PathValidationService';
import { getServiceRegistry } from './services/serviceRegistry';
import { saveFileFlow, type SaveFileFlowOptions } from './services/SaveFileFlow';
import { runOpenWorldSmoke } from './openWorldSmoke';
import { applyWindowSecurity } from './windowSecurity';
import {
  assertModelShape,
  assertDialogName,
  assertParseSourcePayload,
  assertOpenWorldRequest,
  assertTextureRequest,
  assertVisualRequest,
  assertVobPropsRequest,
  assertApplyOpsRequest,
  assertSaveWorldRequest,
  assertVobFoldersGetRequest,
  assertVobFoldersSaveRequest,
  assertAppendInsertNpcRequest,
  sanitizeRendererErrorPayload,
} from './ipcValidation';
import { appendInsertNpcFlow } from './services/AppendInsertNpcFlow';

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
  logService,
  pathValidator,
} = getServiceRegistry();

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
  ipcMain.handle('world:openDialog', async () => {
    try {
      // Start where the worlds are. `.zen` files only exist loose in an
      // extracted install's `_work/Data/Worlds` (the same `_work/Data` tree
      // gothicAssetSources falls back to); a retail install keeps them inside
      // Worlds.vdf, so the install root is the best a picker can offer there.
      // With no install configured we pass nothing and Electron decides.
      const installPath = await settingsService.getGothicInstallPath();
      let defaultPath: string | undefined;
      if (installPath) {
        const worldsDir = path.join(installPath, '_work', 'Data', 'Worlds');
        defaultPath = fs.existsSync(worldsDir) ? worldsDir : installPath;
      }

      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        title: 'Open a ZenGin world',
        filters: [{ name: 'ZenGin world', extensions: ['zen'] }],
        ...(defaultPath ? { defaultPath } : {}),
      });
      if (result.canceled || result.filePaths.length === 0) return null;

      const worldPath = result.filePaths[0];
      pathValidator.addAllowedPath(path.dirname(worldPath));
      return worldPath;
    } catch (error) {
      console.error('[IPC] world:openDialog error:', error);
      throw new Error(`Failed to open world dialog: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle('world:selectGothicInstall', async () => {
    try {
      // Re-selecting an install starts at the one it replaces, the mirror of
      // world:openDialog above.
      const storedPath = await settingsService.getGothicInstallPath();

      const result = await dialog.showOpenDialog({
        properties: ['openDirectory'],
        title: 'Select the Gothic installation directory',
        ...(storedPath ? { defaultPath: storedPath } : {}),
      });
      if (result.canceled || result.filePaths.length === 0) return null;

      const installPath = result.filePaths[0];
      pathValidator.addAllowedPath(installPath);
      await settingsService.setGothicInstallPath(installPath);
      return installPath;
    } catch (error) {
      console.error('[IPC] world:selectGothicInstall error:', error);
      throw new Error(`Failed to select Gothic install: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle('world:getGothicInstall', async () => {
    const installPath = await settingsService.getGothicInstallPath();
    // A persisted install re-seeds the whitelist on launch, exactly as recent
    // projects do — the user already chose it through a main-process dialog.
    if (installPath) pathValidator.addAllowedPath(installPath);
    return installPath;
  });

  ipcMain.handle('world:open', async (_event, request: unknown) => {
    try {
      assertOpenWorldRequest(request);
      await pathValidator.validatePathResolved(request.worldPath);

      // An empty list means "derive them from the configured install". The
      // rule is `zen-world`'s and it is measured, not stylistic: archives beat
      // the equivalent loose trees 15 ms to 2,170 ms. It runs here because it
      // needs the filesystem and the persisted install path.
      let { assetSources } = request;
      if (assetSources.length === 0) {
        const installPath = await settingsService.getGothicInstallPath();
        if (!installPath) {
          throw new Error('No Gothic installation is configured — select one before opening a world.');
        }
        assetSources = gothicAssetSources(installPath, fs.existsSync);
        if (assetSources.length === 0) {
          throw new Error(`No Gothic assets found under ${installPath} — neither archives nor compiled asset directories.`);
        }
      }

      for (const source of assetSources) {
        await pathValidator.validatePathResolved(source);
      }
      return await worldService.openWorld({ ...request, assetSources });
    } catch (error) {
      if (error instanceof PathValidationError) {
        console.error('[IPC] world:open - Path validation failed:', error.message);
        throw new Error(error.message);
      }
      console.error('[IPC] world:open error:', error);
      throw new Error(`Failed to open world: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
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

      pathValidator.addAllowedPath(path.dirname(result.filePath));
      return result.filePath;
    } catch (error) {
      console.error('[IPC] world:saveDialog error:', error);
      throw new Error(`Failed to open save dialog: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle('world:save', async (_event, request: unknown) => {
    try {
      assertSaveWorldRequest(request);
      await pathValidator.validatePathResolved(request.targetPath);
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