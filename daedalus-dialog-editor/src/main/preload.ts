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
  loadProjectConfig: (projectRoot: string) => ipcRenderer.invoke('project:loadConfig', projectRoot),
  selectAssetSourceFolder: (defaultPath?: string) => ipcRenderer.invoke('project:selectAssetSourceFolder', defaultPath),
  saveProjectAssetSources: (projectFilePath: string, assetSources: string[]) =>
    ipcRenderer.invoke('project:saveAssetSources', projectFilePath, assetSources),

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
  openWorld: (request: { worldPath: string; gameVersion: string; projectFilePath: string }) =>
    ipcRenderer.invoke('world:open', request),
  getWorldMesh: () => ipcRenderer.invoke('world:mesh'),
  getWorldVisuals: () => ipcRenderer.invoke('world:visuals'),
  listWorldAssets: (path: string) => ipcRenderer.invoke('world:assets', { path }),
  getWorldWaynet: () => ipcRenderer.invoke('world:waynet'),
  getWorldPortalFindings: () => ipcRenderer.invoke('world:portalFindings'),
  getVisualBounds: (name: string) => ipcRenderer.invoke('world:visualBounds', { name }),
  getWorldVisual: (name: string) => ipcRenderer.invoke('world:visual', { name }),
  getAssetThumbnail: (name: string) => ipcRenderer.invoke('world:getThumbnail', { name }),
  getAssetCatalog: (projectFilePath: string) =>
    ipcRenderer.invoke('project:getAssetCatalog', { projectFilePath }),
  saveAssetCatalog: (projectFilePath: string, catalog: unknown) =>
    ipcRenderer.invoke('project:saveAssetCatalog', { projectFilePath, catalog }),
  putAssetThumbnail: (key: string, dataUrl: string) =>
    ipcRenderer.invoke('world:putThumbnail', { key, dataUrl }),
  getVobProps: (path: string) => ipcRenderer.invoke('world:vobProps', { path }),
  refreshWorldIndex: () => ipcRenderer.invoke('world:refreshIndex'),
  getWorldTexture: (name: string, maxSize: number) =>
    ipcRenderer.invoke('world:texture', { name, maxSize }),
  applyWorldOps: (ops: unknown[]) => ipcRenderer.invoke('world:applyOps', { ops }),
  saveWorldDialog: (suggested: string) => ipcRenderer.invoke('world:saveDialog', { suggested }),
  saveWorld: (targetPath: string) => ipcRenderer.invoke('world:save', { targetPath }),
  // VOB folders (VOB folders slice) — a virtual grouping kept beside the
  // world file, never in it; see zen-world's vobFolders.ts.
  getVobFolders: (worldPath: string) => ipcRenderer.invoke('world:getVobFolders', { worldPath }),
  saveVobFolders: (worldPath: string, folders: unknown) =>
    ipcRenderer.invoke('world:saveVobFolders', { worldPath, folders }),
  appendInsertNpc: (filePath: string, functionName: string, npcInstance: string, spawnPoint: string) =>
    ipcRenderer.invoke('script:appendInsertNpc', { filePath, functionName, npcInstance, spawnPoint }),
  undoWorldEdit: () => ipcRenderer.invoke('world:undo'),
  redoWorldEdit: () => ipcRenderer.invoke('world:redo'),
  getWorldHistoryDepth: () => ipcRenderer.invoke('world:historyDepth'),
  closeWorld: () => ipcRenderer.invoke('world:close'),

  // Updater API
  checkForUpdate: () => ipcRenderer.invoke('updater:checkForUpdate'),
  downloadUpdate: (url: string) => ipcRenderer.invoke('updater:downloadUpdate', url),
  installUpdate: (installerPath: string) => ipcRenderer.invoke('updater:installUpdate', installerPath),
  dismissUpdateVersion: (version: string) => ipcRenderer.invoke('updater:dismissVersion', version),
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  onDownloadProgress: (callback: (percent: number) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, percent: number) => callback(percent);
    ipcRenderer.on('updater:downloadProgress', listener);
    return () => { ipcRenderer.removeListener('updater:downloadProgress', listener); };
  },
});
