import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import * as path from 'path';
import { FileService } from './services/FileService';
import { ParserService } from './services/ParserService';
import { CodeGeneratorService } from './services/CodeGeneratorService';
import { ValidationService } from './services/ValidationService';
import ProjectService from './services/ProjectService';
import { PathValidationService, PathValidationError } from './services/PathValidationService';
import { SettingsService } from './services/SettingsService';
import { FileWatcherService } from './services/FileWatcherService';
import { UpdaterService } from './services/UpdaterService';

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
// Path validator starts empty - paths are added when user opens files/projects via dialogs
const pathValidator = new PathValidationService([]);

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

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
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
      return codeGeneratorService.generateCode(model, settings);
    } catch (error) {
      console.error('[IPC] generator:generateCode error:', error);
      throw new Error(`Failed to generate code: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle('generator:generateDialogCode', async (_event, model: any, dialogName: string, settings: any) => {
    try {
      return codeGeneratorService.generateDialogCode(model, dialogName, settings);
    } catch (error) {
      console.error('[IPC] generator:generateDialogCode error:', error);
      throw new Error(`Failed to generate dialog code: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  // Validation handler - validates model without saving
  ipcMain.handle('validation:validate', async (_event, model: any, settings: any, options?: any) => {
    try {
      return validationService.validate(model, settings, options);
    } catch (error) {
      console.error('[IPC] validation:validate error:', error);
      throw new Error(`Validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle('generator:saveFile', async (_event, filePath: string, model: any, settings: any, options?: { skipValidation?: boolean; forceOnErrors?: boolean; overwriteExternal?: boolean }) => {
    const expectUnchanged = !options?.overwriteExternal;
    try {
      // Validate path before saving
      pathValidator.validatePath(filePath);

      // Validate model unless explicitly skipped
      if (!options?.skipValidation) {
        const validationResult = await validationService.validate(model, settings);

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
          const writeResult = await fileService.writeFile(filePath, validationResult.generatedCode, { expectUnchanged });
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

      const writeResult = await fileService.writeFile(filePath, code, { expectUnchanged });
      // Arm self-write suppression only after an actual write succeeds
      fileWatcherService.notifySelfWrite(filePath);
      return writeResult;
    } catch (error) {
      if (error instanceof PathValidationError) {
        console.error('[IPC] generator:saveFile - Path validation failed:', error.message);
        throw new Error(`Path validation failed: ${error.reason}`);
      }
      console.error('[IPC] generator:saveFile error:', error);
      throw new Error(`Failed to save file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  // File I/O handlers
  ipcMain.handle('file:read', async (_event, filePath: string) => {
    try {
      // Validate path before reading
      pathValidator.validatePath(filePath);

      return fileService.readFile(filePath);
    } catch (error) {
      if (error instanceof PathValidationError) {
        console.error('[IPC] file:read - Path validation failed:', error.message);
        throw new Error(`Path validation failed: ${error.reason}`);
      }
      console.error('[IPC] file:read error:', error);
      throw new Error(`Failed to read file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle('file:write', async (_event, filePath: string, content: string, options?: { overwriteExternal?: boolean }) => {
    try {
      // Validate path before writing
      pathValidator.validatePath(filePath);

      const writeResult = await fileService.writeFile(filePath, content, { expectUnchanged: !options?.overwriteExternal });
      // Arm self-write suppression only after an actual write succeeds
      fileWatcherService.notifySelfWrite(filePath);
      return writeResult;
    } catch (error) {
      if (error instanceof PathValidationError) {
        console.error('[IPC] file:write - Path validation failed:', error.message);
        throw new Error(`Path validation failed: ${error.reason}`);
      }
      console.error('[IPC] file:write error:', error);
      throw new Error(`Failed to write file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle('file:openDialog', async () => {
    try {
      const filePath = await fileService.openFileDialog();

      // When user selects a file via dialog, add its directory to allowed paths
      if (filePath) {
        const fileDir = path.dirname(filePath);
        pathValidator.addAllowedPath(fileDir);
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

      // When user selects a save location via dialog, add its directory to allowed paths
      if (filePath) {
        const fileDir = path.dirname(filePath);
        pathValidator.addAllowedPath(fileDir);
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

      // When user selects a project folder, add it to allowed paths
      pathValidator.addAllowedPath(folderPath);

      return folderPath;
    } catch (error) {
      console.error('[IPC] project:openFolderDialog error:', error);
      throw new Error(`Failed to open folder dialog: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle('project:buildIndex', async (_event, folderPath: string) => {
    try {
      // Validate project folder path
      pathValidator.validatePath(folderPath);

      return await projectService.buildProjectIndex(folderPath);
    } catch (error) {
      if (error instanceof PathValidationError) {
        console.error('[IPC] project:buildIndex - Path validation failed:', error.message);
        throw new Error(`Path validation failed: ${error.reason}`);
      }
      console.error('[IPC] project:buildIndex error:', error);
      throw new Error(`Failed to build project index: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle('project:parseDialogFile', async (_event, filePath: string) => {
    try {
      // Validate file path before parsing
      pathValidator.validatePath(filePath);

      const content = await fileService.readFile(filePath);
      return await parserService.parseSource(content);
    } catch (error) {
      if (error instanceof PathValidationError) {
        console.error('[IPC] project:parseDialogFile - Path validation failed:', error.message);
        throw new Error(`Path validation failed: ${error.reason}`);
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

  ipcMain.handle('settings:addRecentProject', async (_event, projectPath: string, projectName: string) => {
    try {
      await settingsService.addRecentProject(projectPath, projectName);
      // When adding a recent project, also add it to allowed paths for safety
      pathValidator.addAllowedPath(projectPath);
    } catch (error) {
      console.error('[IPC] settings:addRecentProject error:', error);
      throw new Error(`Failed to add recent project: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  // File watcher handlers
  ipcMain.handle('fileWatcher:start', async (_event, projectPath: string) => {
    try {
      await fileWatcherService.startWatching(projectPath);
    } catch (error) {
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

  ipcMain.handle('fileWatcher:notifySelfWrite', (_event, filePath: string) => {
    fileWatcherService.notifySelfWrite(filePath);
  });

  // App info
  ipcMain.handle('app:getVersion', () => app.getVersion());

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
}