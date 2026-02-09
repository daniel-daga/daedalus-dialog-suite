import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
// All daedalus-parser operations run in main process (has access to native modules)
contextBridge.exposeInMainWorld('editorAPI', {
  // Parser API
  parseSource: (sourceCode: string) => ipcRenderer.invoke('parser:parseSource', sourceCode),

  // Validation API
  validateModel: (model: any, settings: any, options?: any) => ipcRenderer.invoke('validation:validate', model, settings, options),

  // Code Generator API
  generateCode: (model: any, settings: any) => ipcRenderer.invoke('generator:generateCode', model, settings),
  generateDialogCode: (model: any, dialogName: string, settings: any) => ipcRenderer.invoke('generator:generateDialogCode', model, dialogName, settings),
  saveFile: (filePath: string, model: any, settings: any, options?: { skipValidation?: boolean; forceOnErrors?: boolean }) =>
    ipcRenderer.invoke('generator:saveFile', filePath, model, settings, options),

  // File I/O API
  readFile: (filePath: string) => ipcRenderer.invoke('file:read', filePath),
  writeFile: (filePath: string, content: string) => ipcRenderer.invoke('file:write', filePath, content),
  openFileDialog: () => ipcRenderer.invoke('file:openDialog'),
  saveFileDialog: () => ipcRenderer.invoke('file:saveDialog'),

  // Project API
  openProjectFolderDialog: () => ipcRenderer.invoke('project:openFolderDialog'),
  buildProjectIndex: (folderPath: string) => ipcRenderer.invoke('project:buildIndex', folderPath),
  parseDialogFile: (filePath: string) => ipcRenderer.invoke('project:parseDialogFile', filePath),
  addAllowedPath: (folderPath: string) => ipcRenderer.invoke('project:addAllowedPath', folderPath),

  // Settings API
  getRecentProjects: () => ipcRenderer.invoke('settings:getRecentProjects'),
  addRecentProject: (projectPath: string, projectName: string) => ipcRenderer.invoke('settings:addRecentProject', projectPath, projectName),
});