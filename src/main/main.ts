import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { SemanticParserService } from './services/SemanticParserService';
import { CodeGeneratorService } from './services/CodeGeneratorService';
import { FileService } from './services/FileService';

let mainWindow: BrowserWindow | null = null;
const parserService = new SemanticParserService();
const codeGeneratorService = new CodeGeneratorService();
const fileService = new FileService();

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
  // Parser handlers
  ipcMain.handle('parser:parseFile', async (_event, filePath: string) => {
    return parserService.parseFile(filePath);
  });

  ipcMain.handle('parser:parseSource', async (_event, sourceCode: string) => {
    return parserService.parseSource(sourceCode);
  });

  ipcMain.handle('parser:validate', async (_event, sourceCode: string) => {
    return parserService.validateSyntax(sourceCode);
  });

  // Code generator handlers
  ipcMain.handle('generator:generate', async (_event, model: any, settings: any) => {
    codeGeneratorService.updateSettings(settings);
    return codeGeneratorService.generate(model);
  });

  ipcMain.handle('generator:generateDialog', async (_event, dialog: any, settings: any) => {
    codeGeneratorService.updateSettings(settings);
    return codeGeneratorService.generateDialog(dialog);
  });

  ipcMain.handle('generator:generateFunction', async (_event, func: any, settings: any) => {
    codeGeneratorService.updateSettings(settings);
    return codeGeneratorService.generateFunction(func);
  });

  // File handlers
  ipcMain.handle('file:read', async (_event, filePath: string) => {
    return fileService.readFile(filePath);
  });

  ipcMain.handle('file:write', async (_event, filePath: string, content: string) => {
    return fileService.writeFile(filePath, content);
  });

  ipcMain.handle('file:save', async (_event, filePath: string, model: any, settings: any) => {
    codeGeneratorService.updateSettings(settings);
    const code = codeGeneratorService.generate(model);
    return fileService.writeFile(filePath, code);
  });

  ipcMain.handle('file:openDialog', async () => {
    return fileService.openFileDialog();
  });

  ipcMain.handle('file:saveDialog', async () => {
    return fileService.saveFileDialog();
  });
}