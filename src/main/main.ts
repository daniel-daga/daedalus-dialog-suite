import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import * as path from 'path';
import { FileService } from './services/FileService';
import { ParserService } from './services/ParserService';
import { CodeGeneratorService } from './services/CodeGeneratorService';
import { ValidationService } from './services/ValidationService';
import ProjectService from './services/ProjectService';
import { PathValidationService, PathValidationError } from './services/PathValidationService';

let mainWindow: BrowserWindow | null = null;
const fileService = new FileService();
const parserService = new ParserService();
const codeGeneratorService = new CodeGeneratorService();
const validationService = new ValidationService(parserService, codeGeneratorService);
const projectService = new ProjectService();
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

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
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
      return parserService.parseSource(sourceCode);
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

  // Validation handler - validates model without saving
  ipcMain.handle('validation:validate', async (_event, model: any, settings: any, options?: any) => {
    try {
      return validationService.validate(model, settings, options);
    } catch (error) {
      console.error('[IPC] validation:validate error:', error);
      throw new Error(`Validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle('generator:saveFile', async (_event, filePath: string, model: any, settings: any, options?: { skipValidation?: boolean; forceOnErrors?: boolean }) => {
    try {
      // Validate path before saving
      pathValidator.validatePath(filePath);

      // Validate model unless explicitly skipped
      if (!options?.skipValidation) {
        const validationResult = await validationService.validate(model, settings);

        // If validation failed and not forcing save, return validation result
        if (!validationResult.isValid && !options?.forceOnErrors) {
          return {
            success: false,
            validationResult
          };
        }

        // Use pre-generated code from validation if available
        if (validationResult.generatedCode) {
          const writeResult = await fileService.writeFile(filePath, validationResult.generatedCode);
          return {
            ...writeResult,
            validationResult
          };
        }
      }

      // Fallback: generate code directly
      const code = codeGeneratorService.generateCode(model, settings);
      return fileService.writeFile(filePath, code);
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

  ipcMain.handle('file:write', async (_event, filePath: string, content: string) => {
    try {
      // Validate path before writing
      pathValidator.validatePath(filePath);

      return fileService.writeFile(filePath, content);
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

      return projectService.buildProjectIndex(folderPath);
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
      return parserService.parseSource(content);
    } catch (error) {
      if (error instanceof PathValidationError) {
        console.error('[IPC] project:parseDialogFile - Path validation failed:', error.message);
        throw new Error(`Path validation failed: ${error.reason}`);
      }
      console.error('[IPC] project:parseDialogFile error:', error);
      throw new Error(`Failed to parse dialog file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });
}