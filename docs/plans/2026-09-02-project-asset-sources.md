# Project Asset Sources Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Introduce the canonical `*.gothicproject.json` project file and let each project manage an ordered, unlimited list of asset folders used by world loading and the asset browser.

**Architecture:** A new main-process `ProjectConfigService` owns project-file discovery, validation, migration, atomic persistence, path resolution, and VFS mount expansion. The renderer receives a normalized project descriptor and edits sources through narrow IPC methods; `world:open` reads the active main-process descriptor instead of accepting renderer-selected asset paths. Existing folder opening migrates automatically and missing sources are skipped with visible warnings.

**Tech Stack:** Electron IPC and native dialogs, TypeScript, React 18, Zustand, MUI, Jest, Playwright Electron E2E, `zen-world.gothicAssetSources`.

---

### Task 1: Pin the migration and list-editing workflow with failing E2E tests

**Files:**
- Create: `daedalus-dialog-editor/tests/e2e-electron/project-asset-sources.spec.ts`
- Modify: `daedalus-dialog-editor/tests/e2e-electron/harness.ts`

**Step 1: Add a legacy-project migration scenario**

Create a temporary project folder with one `.d` file and no project file. Seed the Electron test profile's `settings.json` with `gothicInstallPath`, route the **Select Gothic Mod Project Folder** dialog to the project, and open it through the visible **Open Project** button.

Assert that `<folder-name>.gothicproject.json` appears and contains the stable initial shape:

```ts
expect(JSON.parse(await fs.readFile(projectFile, 'utf8'))).toEqual({
  version: 1,
  target: 'g2-notr',
  scriptsRoot: '.',
  worlds: [],
  assetSources: ['.', gothicInstall],
});
```

Also assert that `gothicInstallPath` is absent from `settings.json` after the project file exists.

**Step 2: Add an asset-source editing scenario**

Mock the native directory picker for an added source, open **Asset sources...**, add it, move it above/below another entry, save, and assert both the visible ordering and persisted JSON. Reopen the dialog and assert that the saved order is restored. Include assertions that the project root cannot be removed and that the dialog states “later sources override earlier sources.”

**Step 3: Add the missing-source warning scenario**

Put a nonexistent absolute path into the project file, open the project successfully, and assert a persistent warning names that path. Verify dialog editing remains usable.

**Step 4: Run the new E2E spec and confirm RED**

Run: `npm run test:e2e -- --grep "project asset sources"`

Expected: FAIL because migration IPC, the Asset sources dialog, and warnings do not exist.

**Step 5: Commit the red workflow tests**

```bash
git add daedalus-dialog-editor/tests/e2e-electron/project-asset-sources.spec.ts daedalus-dialog-editor/tests/e2e-electron/harness.ts
git commit -m "test(editor): specify project asset sources workflow"
```

### Task 2: Define and validate the project-file model

**Files:**
- Create: `daedalus-dialog-editor/src/shared/projectConfigTypes.ts`
- Create: `daedalus-dialog-editor/src/main/services/ProjectConfigService.ts`
- Create: `daedalus-dialog-editor/tests/ProjectConfigService.test.ts`

**Step 1: Write failing schema/discovery tests**

Cover:

- one `*.gothicproject.json` is discovered;
- none requests legacy migration;
- more than one is rejected as ambiguous;
- malformed JSON, unsupported versions, invalid targets, absolute `scriptsRoot`, missing/empty `assetSources`, non-string entries, and a list without `.` are rejected with field-specific errors;
- relative sources resolve against the project-file directory;
- absolute sources remain absolute;
- missing/unreadable sources produce `asset-source-unavailable` warnings and are omitted from resolved mounts;
- a Gothic install expands via `gothicAssetSources`, while an ordinary folder is mounted directly;
- expansion preserves entry order and later-wins precedence.

Use shared contracts shaped like:

```ts
export type GothicTarget = 'g1' | 'g2' | 'g2-notr';

export interface GothicProjectFileV1 {
  version: 1;
  target: GothicTarget;
  scriptsRoot: string;
  worlds: Array<{
    name: string;
    parts: Array<{ path: string; role: 'main' | 'part' }>;
  }>;
  assetSources: string[];
}

export interface ProjectConfigWarning {
  code: 'asset-source-unavailable';
  source: string;
  resolvedPath: string;
  message: string;
}

export interface OpenedProjectConfig {
  projectFilePath: string;
  projectRoot: string;
  scriptsRoot: string;
  config: GothicProjectFileV1;
  resolvedAssetSources: string[];
  warnings: ProjectConfigWarning[];
}
```

**Step 2: Run the focused tests and confirm RED**

Run: `npm test -- ProjectConfigService.test.ts`

Expected: FAIL because the types and service do not exist.

**Step 3: Implement strict parsing and normalization**

Implement `discoverProjectFile(projectRoot)`, `parseProjectFile(value)`, and `resolveProjectConfig(projectFilePath, config)`. Keep disk access injectable or isolated so tests use temporary directories. Treat only an install-shaped folder (known VDF/VDF-disabled files or `_work/Data/*/_compiled`) as an input to `gothicAssetSources`; pass every other existing directory through unchanged.

Do not silently normalize invalid persisted fields. Preserve configured strings in `config.assetSources`; place absolute/native paths only in the normalized descriptor.

**Step 4: Run the focused tests and confirm GREEN**

Run: `npm test -- ProjectConfigService.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add daedalus-dialog-editor/src/shared/projectConfigTypes.ts daedalus-dialog-editor/src/main/services/ProjectConfigService.ts daedalus-dialog-editor/tests/ProjectConfigService.test.ts
git commit -m "feat(editor): add project config model"
```

### Task 3: Implement failure-safe legacy migration and atomic saves

**Files:**
- Modify: `daedalus-dialog-editor/src/main/services/ProjectConfigService.ts`
- Modify: `daedalus-dialog-editor/src/main/services/SettingsService.ts`
- Modify: `daedalus-dialog-editor/tests/ProjectConfigService.test.ts`
- Modify: `daedalus-dialog-editor/tests/SettingsService.test.ts`

**Step 1: Write failing migration tests**

Cover these exact rules:

- no project file creates `<basename>.gothicproject.json` with version 1, `target: 'g2-notr'`, `scriptsRoot: '.'`, `worlds: []`, and `assetSources: ['.']`;
- a legacy install appends once after `.`;
- duplicate/equivalent root and install paths are de-duplicated using normalized platform path comparison;
- writing uses a sibling unique temporary file and rename, leaving either the old complete file or new complete file after failure;
- the legacy setting remains when project-file persistence fails;
- the legacy setting is removed only after the project-file rename succeeds;
- an existing project file is never overwritten or enriched from global settings.

Add a settings assertion for:

```ts
await settingsService.clearGothicInstallPath();
expect(await settingsService.getGothicInstallPath()).toBeNull();
```

**Step 2: Run focused tests and confirm RED**

Run: `npm test -- ProjectConfigService.test.ts SettingsService.test.ts`

Expected: FAIL on migration/save/cleanup behavior.

**Step 3: Implement minimal migration and save operations**

Add `SettingsService.clearGothicInstallPath()`. Add `ProjectConfigService.openOrMigrate(projectRoot, legacyInstallPath)` and `save(projectFilePath, config)`. Serialize service operations per project file and use the existing temp-file, fsync, rename, cleanup, and Windows rename-retry pattern from `SettingsService`; extract a shared atomic JSON writer only if doing so reduces real duplication without changing unrelated behavior.

Make the caller clear the setting only after `openOrMigrate` reports that migration committed successfully.

**Step 4: Run focused tests and confirm GREEN**

Run: `npm test -- ProjectConfigService.test.ts SettingsService.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add daedalus-dialog-editor/src/main/services/ProjectConfigService.ts daedalus-dialog-editor/src/main/services/SettingsService.ts daedalus-dialog-editor/tests/ProjectConfigService.test.ts daedalus-dialog-editor/tests/SettingsService.test.ts
git commit -m "feat(editor): migrate legacy projects atomically"
```

### Task 4: Expose narrow, validated project-config IPC

**Files:**
- Modify: `daedalus-dialog-editor/src/main/main.ts`
- Modify: `daedalus-dialog-editor/src/main/preload.ts`
- Modify: `daedalus-dialog-editor/src/main/ipcValidation.ts`
- Modify: `daedalus-dialog-editor/src/renderer/types/global.d.ts`
- Modify: `daedalus-dialog-editor/src/renderer/utils/mockAPI.ts`
- Modify: `daedalus-dialog-editor/tests/ipcValidation.test.ts`
- Create: `daedalus-dialog-editor/tests/projectConfigIpc.test.ts`

**Step 1: Write failing IPC and validation tests**

Specify these channels:

```ts
loadProjectConfig(projectRoot: string): Promise<OpenedProjectConfig>
selectAssetSourceFolder(defaultPath?: string): Promise<string | null>
saveProjectAssetSources(projectFilePath: string, assetSources: string[]): Promise<OpenedProjectConfig>
```

Assert that load validates the already-allowed project root, performs migration, clears the old setting only after success, and returns warnings. The picker must be the only way to introduce a new external folder during a session. Saving must reject malformed arrays, a missing `.`, unknown project files, and any newly supplied absolute path that was neither loaded from that same project file nor chosen through the native picker.

**Step 2: Run focused tests and confirm RED**

Run: `npm test -- ipcValidation.test.ts projectConfigIpc.test.ts`

Expected: FAIL because the channels and validators do not exist.

**Step 3: Implement IPC with main-owned project capability state**

Register loaded project files and their configured source strings in the main process. Let native directory selection add the chosen directory to the path validator and the current project's allowed edit candidates. On save, re-read/validate the project file, replace only `assetSources`, atomically persist, re-resolve, and refresh the registered descriptor.

Do not expose generic project-file writing. Do not accept resolved mounts from the renderer as authority.

**Step 4: Run focused tests and confirm GREEN**

Run: `npm test -- ipcValidation.test.ts projectConfigIpc.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add daedalus-dialog-editor/src/main/main.ts daedalus-dialog-editor/src/main/preload.ts daedalus-dialog-editor/src/main/ipcValidation.ts daedalus-dialog-editor/src/renderer/types/global.d.ts daedalus-dialog-editor/src/renderer/utils/mockAPI.ts daedalus-dialog-editor/tests/ipcValidation.test.ts daedalus-dialog-editor/tests/projectConfigIpc.test.ts
git commit -m "feat(editor): expose project config IPC"
```

### Task 5: Make the project store own the normalized descriptor and warnings

**Files:**
- Modify: `daedalus-dialog-editor/src/renderer/store/projectStore.ts`
- Modify: `daedalus-dialog-editor/tests/projectStore.openProjectError.test.ts`
- Create: `daedalus-dialog-editor/tests/projectStore.assetSources.test.ts`
- Modify: `daedalus-dialog-editor/tests/projectStore.closeProject.test.ts`

**Step 1: Write failing store tests**

Assert `openProject(folderPath)` calls `loadProjectConfig` before indexing, builds the index from `descriptor.scriptsRoot`, stores `projectConfig`, `projectWarnings`, and `projectPath = descriptor.projectRoot`, and does not begin indexing when config loading fails. Assert `saveAssetSources` replaces the descriptor/warnings with the IPC response. Assert close clears all project-config state.

**Step 2: Run focused tests and confirm RED**

Run: `npm test -- projectStore.assetSources.test.ts projectStore.openProjectError.test.ts projectStore.closeProject.test.ts`

Expected: FAIL on the missing descriptor state/actions.

**Step 3: Implement the store state and actions**

Add granular fields rather than asking deeply memoized consumers to subscribe to a large combined object:

```ts
projectFilePath: string | null;
projectConfig: GothicProjectFileV1 | null;
resolvedAssetSources: string[];
projectWarnings: ProjectConfigWarning[];
saveAssetSources(assetSources: string[]): Promise<void>;
dismissProjectWarning(resolvedPath: string): void;
```

Keep `projectPath` as the project root for existing watchers and UI. Use `scriptsRoot` only for dialog indexing and script file watching.

**Step 4: Run focused tests and confirm GREEN**

Run: `npm test -- projectStore.assetSources.test.ts projectStore.openProjectError.test.ts projectStore.closeProject.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add daedalus-dialog-editor/src/renderer/store/projectStore.ts daedalus-dialog-editor/tests/projectStore.assetSources.test.ts daedalus-dialog-editor/tests/projectStore.openProjectError.test.ts daedalus-dialog-editor/tests/projectStore.closeProject.test.ts
git commit -m "feat(editor): store project asset sources"
```

### Task 6: Build the project-level Asset Sources dialog

**Files:**
- Create: `daedalus-dialog-editor/src/renderer/components/AssetSourcesDialog.tsx`
- Modify: `daedalus-dialog-editor/src/renderer/App.tsx`
- Create: `daedalus-dialog-editor/tests/AssetSourcesDialog.test.tsx`
- Modify: `daedalus-dialog-editor/tests/App.projectOpeningLoader.test.tsx`

**Step 1: Write failing component tests**

Cover rendering in configured order, unavailable markers, later-wins help text, Add, Remove, Move up, Move down, Save, Cancel, save-error retention, root removal disabled, and a “reopen the world to apply changes” notice when a world is loaded. Verify list changes stay local until Save and accessible labels identify each source/action.

**Step 2: Run focused tests and confirm RED**

Run: `npm test -- AssetSourcesDialog.test.tsx App.projectOpeningLoader.test.tsx`

Expected: FAIL because the dialog/action do not exist.

**Step 3: Implement the minimal MUI dialog**

Use a local `string[]` draft reset each time the dialog opens. Add folders only via `selectAssetSourceFolder`; keep the configured spelling returned by main. Use explicit arrow buttons rather than drag-and-drop. Disable Save while unchanged or in flight. Render warnings inline beside their matching source and retain the app-level warning after dismissal only for the current session.

Add **Asset sources...** to the app bar only while a project is open. Pass whether a world summary exists to show the reopen notice; do not couple dialog saving to world teardown.

**Step 4: Run focused tests and confirm GREEN**

Run: `npm test -- AssetSourcesDialog.test.tsx App.projectOpeningLoader.test.tsx`

Expected: PASS.

**Step 5: Commit**

```bash
git add daedalus-dialog-editor/src/renderer/components/AssetSourcesDialog.tsx daedalus-dialog-editor/src/renderer/App.tsx daedalus-dialog-editor/tests/AssetSourcesDialog.test.tsx daedalus-dialog-editor/tests/App.projectOpeningLoader.test.tsx
git commit -m "feat(editor): add asset sources editor"
```

### Task 7: Drive world opening from the active project configuration

**Files:**
- Modify: `daedalus-dialog-editor/src/shared/worldTypes.ts`
- Modify: `daedalus-dialog-editor/src/main/main.ts`
- Modify: `daedalus-dialog-editor/src/main/preload.ts`
- Modify: `daedalus-dialog-editor/src/renderer/types/global.d.ts`
- Modify: `daedalus-dialog-editor/src/renderer/components/world/WorldSurface.tsx`
- Modify: `daedalus-dialog-editor/src/renderer/components/world/toolbar/WorldFileControls.tsx`
- Modify: `daedalus-dialog-editor/src/renderer/utils/mockAPI.ts`
- Modify: `daedalus-dialog-editor/tests/ipcValidation.test.ts`
- Modify: `daedalus-dialog-editor/tests/worldFixtures.ts`
- Modify: `daedalus-dialog-editor/tests/WorldSurface.toolbar.test.tsx`
- Modify: `daedalus-dialog-editor/tests/WorldSurface.editing.test.tsx`
- Modify: `daedalus-dialog-editor/tests/worldOpenDialogDefaultPath.test.ts`

**Step 1: Write failing world-wiring tests**

Assert the World toolbar no longer renders **Select/Change Gothic install** or its global path. Assert WorldSurface does not call `getGothicInstall` and opens with the active project's config identity rather than an empty renderer-selected mount array. Assert main resolves mounts from its registered project descriptor, preserves order, skips unavailable entries, and rejects world opening with “Configure at least one available asset source” when none resolve.

Keep the world file path validation independent: users still choose a loose `.zen` through the native dialog in this slice.

**Step 2: Run focused tests and confirm RED**

Run: `npm test -- WorldSurface.toolbar.test.tsx WorldSurface.editing.test.tsx worldOpenDialogDefaultPath.test.ts ipcValidation.test.ts`

Expected: FAIL on old install controls and old `assetSources` request behavior.

**Step 3: Remove renderer authority over VFS mounts**

Replace `OpenWorldRequest.assetSources` with a project-config identifier such as `projectFilePath`; main looks up/reloads the registered descriptor and supplies `resolvedAssetSources` to `WorldService.openWorld`. Keep `WorldService` and worker contracts unchanged: they should still receive the final `string[]` mount list.

Remove `world:selectGothicInstall` and `world:getGothicInstall` from IPC, preload, global types, mock API, `WorldSurface`, and `WorldFileControls`. Seed the world file dialog from configured loose world entries when one is available; otherwise omit `defaultPath` and let Electron choose.

**Step 4: Run focused tests and confirm GREEN**

Run: `npm test -- WorldSurface.toolbar.test.tsx WorldSurface.editing.test.tsx worldOpenDialogDefaultPath.test.ts ipcValidation.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add daedalus-dialog-editor/src/shared/worldTypes.ts daedalus-dialog-editor/src/main/main.ts daedalus-dialog-editor/src/main/preload.ts daedalus-dialog-editor/src/renderer/types/global.d.ts daedalus-dialog-editor/src/renderer/components/world/WorldSurface.tsx daedalus-dialog-editor/src/renderer/components/world/toolbar/WorldFileControls.tsx daedalus-dialog-editor/src/renderer/utils/mockAPI.ts daedalus-dialog-editor/tests/ipcValidation.test.ts daedalus-dialog-editor/tests/worldFixtures.ts daedalus-dialog-editor/tests/WorldSurface.toolbar.test.tsx daedalus-dialog-editor/tests/WorldSurface.editing.test.tsx daedalus-dialog-editor/tests/worldOpenDialogDefaultPath.test.ts
git commit -m "feat(editor): open worlds from project assets"
```

### Task 8: Finish E2E coverage and update durable documentation

**Files:**
- Modify: `daedalus-dialog-editor/tests/e2e-electron/project-asset-sources.spec.ts`
- Modify: `daedalus-dialog-editor/tests/e2e-electron/world-render.spec.ts`
- Modify: `daedalus-dialog-editor/tests/e2e-electron/world-folders.spec.ts`
- Modify: `daedalus-dialog-editor/tests/e2e-electron/world-editing-ui.spec.ts`
- Modify: `docs/architecture/level-editor.md`
- Modify: `docs/architecture/security-model.md`
- Modify: `docs/BOARD.md`

**Step 1: Update existing Electron fixtures**

Have each world E2E project create a version-1 project file whose asset list points at its fixture install. Remove handling for **Select the Gothic installation directory** and preserve the current world render/edit assertions.

**Step 2: Run the feature E2E tests**

Run: `npm run test:e2e -- --grep "project asset sources"`

Expected: PASS for migration, ordering/persistence, and missing-source warning scenarios.

**Step 3: Run all Electron E2E tests**

Run: `npm run test:e2e`

Expected: PASS.

**Step 4: Update canonical docs and board status**

Update level-editor architecture §9 with the implemented project-file schema, relative/absolute path rules, later-wins semantics, migration, and missing-source behavior. Update the security model with the main-owned project capability and native-picker rule. Mark §16.28 delivered on the board; do not introduce another planning document.

**Step 5: Commit**

```bash
git add daedalus-dialog-editor/tests/e2e-electron docs/architecture/level-editor.md docs/architecture/security-model.md docs/BOARD.md
git commit -m "test(editor): cover project asset sources end to end"
```

### Task 9: Run workspace verification

**Files:**
- Modify only files required by failures attributable to this feature.

**Step 1: Run the focused unit/integration set once more**

Run:

```bash
npm test -- ProjectConfigService.test.ts SettingsService.test.ts projectConfigIpc.test.ts projectStore.assetSources.test.ts AssetSourcesDialog.test.tsx WorldSurface.toolbar.test.tsx WorldSurface.editing.test.tsx ipcValidation.test.ts
```

Expected: PASS.

**Step 2: Run the recommended Windows baseline**

Run: `npm run test:stable:windows`

Expected: PASS with no new failures.

**Step 3: Run type checking**

Run: `npm run typecheck:renderer`

Expected: PASS with no TypeScript errors.

**Step 4: Run the production build**

Run: `npm run build --workspace daedalus-dialog-editor`

Expected: PASS. If Vite fails with the documented `spawn EPERM`, rerun the same command with elevated permissions.

**Step 5: Run all Electron E2E tests after the build**

Run: `npm run test:e2e`

Expected: PASS.

**Step 6: Review final scope and commit verification fixes**

Run: `git status --short` and `git diff --check`.

Expected: only intentional feature changes; no whitespace errors. If verification required code fixes, commit them separately:

```bash
git add <only-the-files-fixed-during-verification>
git commit -m "fix(editor): finish project asset sources verification"
```

After implementation is accepted, extract any remaining durable decisions into the canonical architecture/reference documents and delete both completed files:

```bash
git rm docs/plans/2026-09-02-project-asset-sources-design.md docs/plans/2026-09-02-project-asset-sources.md
git commit -m "docs: archive completed asset sources plan"
```
