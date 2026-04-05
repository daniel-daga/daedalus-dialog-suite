---
name: electron
description: Electron main/renderer process patterns for daedalus-dialog-editor
triggers:
  - "src/main/**"
  - "preload.ts"
  - "main.ts"
  - "ipcMain"
  - "ipcRenderer"
---

# Electron Architecture – daedalus-dialog-editor

## Process Boundaries

```
Main process (Node.js)          Renderer process (Chromium)
src/main/main.ts          <-->  src/renderer/
src/main/preload.ts             window.editorAPI  (contextBridge)
src/main/services/
```

- **Main process**: has Node.js and native module access. Owns all file I/O, parser calls, IPC handlers.
- **Renderer process**: React UI. No direct Node.js access. Communicates via `window.editorAPI` only.
- **Preload**: `src/main/preload.ts` — the only bridge. Uses `contextBridge.exposeInMainWorld`.

## `window.editorAPI` — the full surface

Exposed as `window.editorAPI` in the renderer. All methods return Promises.

```ts
// Parser
editorAPI.parseSource(sourceCode: string)

// Validation / Code Generation
editorAPI.validateModel(model, settings, options?)
editorAPI.generateCode(model, settings)
editorAPI.generateDialogCode(model, dialogName, settings)
editorAPI.saveFile(filePath, model, settings, options?)

// File I/O
editorAPI.readFile(filePath)
editorAPI.writeFile(filePath, content)
editorAPI.openFileDialog()
editorAPI.saveFileDialog()

// Project
editorAPI.openProjectFolderDialog()
editorAPI.buildProjectIndex(folderPath)
editorAPI.parseDialogFile(filePath)
editorAPI.addAllowedPath(folderPath)

// Settings
editorAPI.getRecentProjects()
editorAPI.addRecentProject(projectPath, projectName)

// File Watcher
editorAPI.startFileWatcher(projectPath)
editorAPI.stopFileWatcher()
editorAPI.notifySelfWrite(filePath)
editorAPI.onFileChanged(callback)   // returns unsubscribe fn

// App / Updater
editorAPI.getAppVersion()
editorAPI.checkForUpdate()
editorAPI.downloadUpdate(url)
editorAPI.installUpdate(installerPath)
editorAPI.onDownloadProgress(callback)  // returns unsubscribe fn
```

## Adding a New IPC Channel

**1. Preload** (`src/main/preload.ts`) — expose via `contextBridge`:
```ts
myNewFeature: (arg: string) => ipcRenderer.invoke('feature:myNew', arg),
```

**2. Main process** (`src/main/main.ts` or a service) — register handler:
```ts
ipcMain.handle('feature:myNew', async (_event, arg: string) => {
  return someService.doThing(arg);
});
```

**3. Renderer** — call through `window.editorAPI`:
```ts
const result = await window.editorAPI.myNewFeature('value');
```

Never call `ipcRenderer` directly from the renderer. Never expose `ipcRenderer` itself through `contextBridge`.

## Main Process Services

All live in `src/main/services/`:

| Service | Responsibility |
|---------|---------------|
| `ParserService.ts` | Wraps daedalus-parser, runs in main |
| `CodeGeneratorService.ts` | Code generation from semantic model |
| `ValidationService.ts` | Dialog/quest validation |
| `FileService.ts` | File read/write with path validation |
| `ProjectService.ts` | Project index building, multi-file parsing |
| `FileWatcherService.ts` | Watches project folder for changes |
| `SettingsService.ts` | Persists recent projects etc. |
| `PathValidationService.ts` | Guards allowed paths (security) |
| `UpdaterService.ts` | Auto-updater |
| `MetadataWorkerPool.ts` | Worker threads for metadata extraction |

## Security Rules

- Use `PathValidationService` before any file read/write in `FileService` — never skip allowed-path checks.
- `nodeIntegration` must remain `false` in `BrowserWindow` webPreferences.
- `contextIsolation` must remain `true`.
- Only add capabilities to `contextBridge` that the renderer genuinely needs.

## Event Listeners — Memory Management

`onFileChanged` and `onDownloadProgress` return an unsubscribe function. Always call it on component unmount:

```ts
useEffect(() => {
  const unsub = window.editorAPI.onFileChanged(handleChange);
  return unsub;
}, []);
```

## Build Notes

- Main process TS config: `tsconfig.main.json`
- Renderer bundled by Vite (`vite.config.ts`)
- `npm run build` compiles both
- In Codex sandbox, Vite esbuild spawning may throw `EPERM` — retry with elevated permissions
