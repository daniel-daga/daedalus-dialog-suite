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
  saveFile: (filePath: string, model: any, settings: any, options?: { skipValidation?: boolean; forceOnErrors?: boolean; overwriteExternal?: boolean; existingVoiceIds?: Record<string, Array<{ filePath: string; functionName: string }>> }) =>
    ipcRenderer.invoke('generator:saveFile', filePath, model, settings, options),

  // File I/O API
  readFile: (filePath: string) => ipcRenderer.invoke('file:read', filePath),
  writeFile: (filePath: string, content: string, options?: { overwriteExternal?: boolean }) =>
    ipcRenderer.invoke('file:write', filePath, content, options),
  openFileDialog: () => ipcRenderer.invoke('file:openDialog'),
  saveFileDialog: () => ipcRenderer.invoke('file:saveDialog'),

  // Project API
  openProjectFolderDialog: () => ipcRenderer.invoke('project:openFolderDialog'),
  buildProjectIndex: (folderPath: string) => ipcRenderer.invoke('project:buildIndex', folderPath),
  parseDialogFile: (filePath: string) => ipcRenderer.invoke('project:parseDialogFile', filePath),
  addAllowedPath: (folderPath: string) => ipcRenderer.invoke('project:addAllowedPath', folderPath),

  // Settings API
  getRecentProjects: () => ipcRenderer.invoke('settings:getRecentProjects'),

  // File Watcher API
  startFileWatcher: (projectPath: string) => ipcRenderer.invoke('fileWatcher:start', projectPath),
  stopFileWatcher: () => ipcRenderer.invoke('fileWatcher:stop'),
  onFileChanged: (callback: (event: { type: string; filePath: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: { type: string; filePath: string }) => callback(data);
    ipcRenderer.on('fileWatcher:changed', listener);
    // Return unsubscribe function
    return () => { ipcRenderer.removeListener('fileWatcher:changed', listener); };
  },

  // App info
  getAppVersion: () => ipcRenderer.invoke('app:getVersion'),

  // Crash logging (fix-08 §5)
  logRendererError: (payload: { message: string; stack?: string }) => ipcRenderer.invoke('log:rendererError', payload),
  getLogPath: () => ipcRenderer.invoke('app:getLogPath'),
  showLogFile: () => ipcRenderer.invoke('app:showLogFile'),

  // Window close guard (E1)
  onCloseRequested: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('app:closeRequested', listener);
    return () => { ipcRenderer.removeListener('app:closeRequested', listener); };
  },
  ackCloseRequest: () => ipcRenderer.send('app:ackCloseRequest'),
  approveClose: () => ipcRenderer.send('app:approveClose'),
  cancelClose: () => ipcRenderer.send('app:cancelClose'),

  // World API (level-editor.md §7). The world stays in the main process; what
  // crosses here is the lightweight VOB index and geometry/texture buffers.
  openWorldDialog: () => ipcRenderer.invoke('world:openDialog'),
  selectGothicInstall: () => ipcRenderer.invoke('world:selectGothicInstall'),
  getGothicInstall: () => ipcRenderer.invoke('world:getGothicInstall'),
  openWorld: (request: { worldPath: string; gameVersion: string; assetSources: string[] }) =>
    ipcRenderer.invoke('world:open', request),
  getWorldMesh: () => ipcRenderer.invoke('world:mesh'),
  getWorldVisuals: () => ipcRenderer.invoke('world:visuals'),
  listWorldAssets: (path: string) => ipcRenderer.invoke('world:assets', { path }),
  getWorldTexture: (name: string, maxSize: number) =>
    ipcRenderer.invoke('world:texture', { name, maxSize }),
  closeWorld: () => ipcRenderer.invoke('world:close'),

  // Updater API
  checkForUpdate: () => ipcRenderer.invoke('updater:checkForUpdate'),
  downloadUpdate: (url: string) => ipcRenderer.invoke('updater:downloadUpdate', url),
  installUpdate: (installerPath: string) => ipcRenderer.invoke('updater:installUpdate', installerPath),
  onDownloadProgress: (callback: (percent: number) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, percent: number) => callback(percent);
    ipcRenderer.on('updater:downloadProgress', listener);
    return () => { ipcRenderer.removeListener('updater:downloadProgress', listener); };
  },
});