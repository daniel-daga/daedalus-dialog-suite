import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { gothicAssetSources } from 'zen-world';
import { FileService } from './services/FileService';
import { LogService } from './services/LogService';
import { ParserService } from './services/ParserService';
import { CodeGeneratorService } from './services/CodeGeneratorService';
import { ValidationService } from './services/ValidationService';
import ProjectService from './services/ProjectService';
import { PathValidationService, PathValidationError } from './services/PathValidationService';
import { SettingsService } from './services/SettingsService';
import { FileWatcherService } from './services/FileWatcherService';
import { UpdaterService } from './services/UpdaterService';
import { WorldService } from './services/WorldService';
import { applyWindowSecurity } from './windowSecurity';
import {
  assertModelShape,
  assertDialogName,
  assertSaveFileSettings,
  assertSaveFileOptions,
  assertOpenWorldRequest,
  assertTextureRequest,
  sanitizeRendererErrorPayload,
} from './ipcValidation';

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
let closeApproved = false;
let closeGuardAckTimer: ReturnType<typeof setTimeout> | null = null;
const fileService = new FileService();
const parserService = new ParserService();
const codeGeneratorService = new CodeGeneratorService();
const validationService = new ValidationService(parserService, codeGeneratorService);
const projectService = new ProjectService();
const settingsService = new SettingsService();
const fileWatcherService = new FileWatcherService();
const updaterService = new UpdaterService(settingsService);
// Constructed eagerly, but it does not spawn its worker — and therefore does
// not load the native addon — until a world is actually opened (§6).
const worldService = new WorldService();
const logService = new LogService(app.getPath('userData'), app.getVersion());
// Path validator starts empty - paths are added when user opens files/projects via dialogs
const pathValidator = new PathValidationService([]);

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

function createWindow() {
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
  mainWindow.on('close', (e) => {
    if (closeApproved) {
      return;
    }
    e.preventDefault();
    mainWindow?.webContents.send('app:closeRequested');
    closeGuardAckTimer = setTimeout(() => {
      closeApproved = true;
      mainWindow?.destroy();
    }, 3000);
  });

  mainWindow.on('closed', () => {
    fileWatcherService.stopWatching();
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
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

function setupIpcHandlers() {
  // Parser handler (main process has access to native modules)
  ipcMain.handle('parser:parseSource', async (_event, sourceCode: string) => {
    try {
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

  ipcMain.handle('generator:saveFile', async (_event, filePath: string, model: any, settings: any, options?: { skipValidation?: boolean; forceOnErrors?: boolean; overwriteExternal?: boolean; existingVoiceIds?: Record<string, Array<{ filePath: string; functionName: string }>> }) => {
    const expectUnchanged = !options?.overwriteExternal;
    // Force-on-errors overwrites drop content the parser could not read, so
    // FileService first snapshots the on-disk file to `<name>.d.bak`.
    const backupBeforeWrite = options?.forceOnErrors === true;
    try {
      // Validate payload shapes before touching services
      assertModelShape(model);
      assertSaveFileSettings(settings);
      assertSaveFileOptions(options);

      // Validate path before saving (symlink-resolved, write mode)
      await pathValidator.validatePathResolved(filePath, { write: true });

      // Validate model unless explicitly skipped
      if (!options?.skipValidation) {
        const validationResult = await validationService.validate(model, settings, {
          existingVoiceIds: options?.existingVoiceIds
        });

        // If validation failed and not forcing save, return validation result
        if (!validationResult.isValid && !options?.forceOnErrors) {
          console.warn(`[IPC] generator:saveFile - Validation failed for ${filePath}, skipping save.`);
          return {
            success: false,
            validationResult
          };
        }

        // Use pre-generated code from validation if available
        if (validationResult.generatedCode) {
          const writeResult = await fileService.writeFile(filePath, validationResult.generatedCode, { expectUnchanged, backupBeforeWrite });
          // Arm self-write suppression only after an actual write succeeds
          fileWatcherService.notifySelfWrite(filePath);
          return {
            ...writeResult,
            validationResult
          };
        }
      }

      // Fallback: generate code directly (only if validation skipped or didn't provide code)
      const code = codeGeneratorService.generateCode(model, settings, { allowPartialModel: options?.forceOnErrors === true });

      // Final sanity check for generated code - ALWAYS run this if we are falling back
      const syntaxResult = await parserService.parseSource(code);
      if (syntaxResult.hasErrors && !options?.forceOnErrors) {
          return {
              success: false,
              validationResult: {
                  isValid: false,
                  errors: syntaxResult.errors?.map((e: any) => ({
                      type: 'syntax_error' as const,
                      message: e.message || 'Syntax error',
                      position: e.position
                  })) || [{
                      type: 'syntax_error' as const,
                      message: 'Syntax error detected (sanity check)',
                  }],
                  warnings: []
              }
          };
      }

      const writeResult = await fileService.writeFile(filePath, code, { expectUnchanged, backupBeforeWrite });
      // Arm self-write suppression only after an actual write succeeds
      fileWatcherService.notifySelfWrite(filePath);
      return writeResult;
    } catch (error) {
      if (error instanceof PathValidationError) {
        console.error('[IPC] generator:saveFile - Path validation failed:', error.message);
        throw new Error(error.message);
      }
      console.error('[IPC] generator:saveFile error:', error);
      throw new Error(`Failed to save file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

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
    closeApproved = true;
    mainWindow?.close();
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
      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        title: 'Open a ZenGin world',
        filters: [{ name: 'ZenGin world', extensions: ['zen'] }],
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
      const result = await dialog.showOpenDialog({
        properties: ['openDirectory'],
        title: 'Select the Gothic installation directory',
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

  ipcMain.handle('world:close', () => {
    worldService.close();
  });
}