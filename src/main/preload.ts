import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('editorAPI', {
  // Parser API
  parseFile: (filePath: string) => ipcRenderer.invoke('parser:parseFile', filePath),
  parseSource: (sourceCode: string) => ipcRenderer.invoke('parser:parseSource', sourceCode),
  validateSyntax: (sourceCode: string) => ipcRenderer.invoke('parser:validate', sourceCode),

  // Code Generator API
  generateCode: (model: any, settings: any) => ipcRenderer.invoke('generator:generate', model, settings),
  generateDialog: (dialog: any, settings: any) => ipcRenderer.invoke('generator:generateDialog', dialog, settings),
  generateFunction: (func: any, settings: any) => ipcRenderer.invoke('generator:generateFunction', func, settings),

  // File API
  readFile: (filePath: string) => ipcRenderer.invoke('file:read', filePath),
  writeFile: (filePath: string, content: string) => ipcRenderer.invoke('file:write', filePath, content),
  saveFile: (filePath: string, model: any, settings: any) => ipcRenderer.invoke('file:save', filePath, model, settings),
  openFileDialog: () => ipcRenderer.invoke('file:openDialog'),
  saveFileDialog: () => ipcRenderer.invoke('file:saveDialog'),
});