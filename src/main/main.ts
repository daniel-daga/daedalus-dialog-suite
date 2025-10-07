import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { FileService } from './services/FileService';
import { ParserService } from './services/ParserService';
import { CodeGeneratorService } from './services/CodeGeneratorService';

let mainWindow: BrowserWindow | null = null;
const fileService = new FileService();
const parserService = new ParserService();
const codeGeneratorService = new CodeGeneratorService();

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
    return parserService.parseSource(sourceCode);
  });

  // Code generator handlers
  ipcMain.handle('generator:generateCode', async (_event, model: any, settings: any) => {
    return codeGeneratorService.generateCode(model, settings);
  });

  ipcMain.handle('generator:saveFile', async (_event, filePath: string, model: any, settings: any) => {
    console.log('Generating code for model:', JSON.stringify(model, null, 2));
    const code = codeGeneratorService.generateCode(model, settings);
    console.log('Generated code type:', typeof code);
    console.log('Generated code:', code);
    return fileService.writeFile(filePath, code);
  });

  // File I/O handlers
  ipcMain.handle('file:read', async (_event, filePath: string) => {
    return fileService.readFile(filePath);
  });

  ipcMain.handle('file:write', async (_event, filePath: string, content: string) => {
    return fileService.writeFile(filePath, content);
  });

  ipcMain.handle('file:openDialog', async () => {
    return fileService.openFileDialog();
  });

  ipcMain.handle('file:saveDialog', async () => {
    return fileService.saveFileDialog();
  });
}