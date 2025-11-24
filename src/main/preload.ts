import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
// All daedalus-parser operations run in main process (has access to native modules)
contextBridge.exposeInMainWorld('editorAPI', {
  // Parser API
  parseSource: (sourceCode: string) => ipcRenderer.invoke('parser:parseSource', sourceCode),

  // Code Generator API
  generateCode: (model: any, settings: any) => ipcRenderer.invoke('generator:generateCode', model, settings),
  saveFile: (filePath: string, model: any, settings: any) => ipcRenderer.invoke('generator:saveFile', filePath, model, settings),

  // File I/O API
  readFile: (filePath: string) => ipcRenderer.invoke('file:read', filePath),
  writeFile: (filePath: string, content: string) => ipcRenderer.invoke('file:write', filePath, content),
  openFileDialog: () => ipcRenderer.invoke('file:openDialog'),
  saveFileDialog: () => ipcRenderer.invoke('file:saveDialog'),

  // Project API
  openProjectFolderDialog: () => ipcRenderer.invoke('project:openFolderDialog'),
  buildProjectIndex: (folderPath: string) => ipcRenderer.invoke('project:buildIndex', folderPath),
  parseDialogFile: (filePath: string) => ipcRenderer.invoke('project:parseDialogFile', filePath),
});