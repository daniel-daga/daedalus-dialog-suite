# Frontend Editor Review Fixes

Tracking document for fixes from the June 2026 general review of `daedalus-dialog-editor/`.
Each item is fixed TDD-style: failing test → minimal fix → green. Status values:
`todo`, `in-progress`, `done`, `deferred` (with reason).

## High priority — data integrity

| ID | Finding | Files | Status |
|----|---------|-------|--------|
| F1 | Dialog rename/delete BFS only scans top-level actions for `Choice`; misses Choices nested in `ConditionalAction` branches → dangling `targetFunction` refs after rename, wrong delete sets. Logic also duplicated in `ThreeColumnLayout` previews. | `store/fileStore.ts`, `components/ThreeColumnLayout.tsx`, `components/nestedActionUtils.ts` | done |
| F2 | Auto-save race: edits made while a save is in flight are marked clean (`isDirty: false`) although disk has pre-edit content. | `hooks/useAutoSave.ts` | done |
| F3 | Two independent undo systems (`editHistory` vs `questHistory`/`questBatchHistory`) restore full-model snapshots of the same file → undo on one surface silently reverts the other surface's edits. Also `editHistory.undo/redo` captured but never restored `nodePositions`. | `store/historyStore.ts` | done |

## Medium — security hardening

| ID | Finding | Files | Status |
|----|---------|-------|--------|
| F4a | `project:addAllowedPath` IPC lets the renderer whitelist arbitrary directories, defeating `PathValidationService`. Now only accepts paths already persisted as recent projects. | `main/main.ts` | done |
| F4b | `updater:downloadUpdate` accepted an arbitrary renderer-supplied URL; `updater:installUpdate` executed any file in temp. Download URL is now pinned in the main process by `checkForUpdate`; install path must match the last download. | `main/services/UpdaterService.ts`, `main/main.ts` | done |

## Medium — correctness & performance

| ID | Finding | Files | Status |
|----|---------|-------|--------|
| F5 | `deleteVariable` merges the old merged model additively, so deleted constants/variables stay visible in `mergedSemanticModel` (VariableManager) until an unrelated re-merge. | `store/projectStore.ts`, `components/VariableManager.tsx` | done |
| F6 | Every model edit triggers a full dialog-index rebuild + `loadAndMergeNpcModels` re-merge (O(project) per keystroke) via `storeSync` → `updateFileModel`. Re-merge now debounced. | `store/projectStore.ts` | todo |
| F7 | Zustand object-literal selectors without shallow equality re-render on every store change (`QuestFlow`, `QuestEditor`, `IngestedFilesDialog`); `App`/`ThreeColumnLayout` subscribe to whole stores. | renderer components | todo |

## Architecture drift & dead code

| ID | Finding | Files | Status |
|----|---------|-------|--------|
| F8 | `quest/domain/*` are re-export shims into `components/QuestEditor/*`, and the pipeline transitively imports reactflow — inverts the documented layering. Doc updated to describe the actual shim layout; physical move tracked in `docs/refactoring-targets.md`. | `docs/architecture/quest-editor.md`, `docs/refactoring-targets.md` | todo |
| F9 | Dead reactflow node renderers (`QuestEditor/Nodes/*.tsx`) unreferenced since the litegraph migration. | `components/QuestEditor/Nodes/` | todo |

## Low priority

| ID | Finding | Files | Status |
|----|---------|-------|--------|
| F10 | File-watcher hardening: chokidar `ignored` predicate broke on Windows backslash paths with dotted directory names; self-write suppression registered even when a save later failed validation (now registered by the main process at actual write time); paths compared case-sensitively on Windows. | `main/services/FileWatcherService.ts`, `main/main.ts`, renderer call sites | done |
| F11 | `FileService` lock released all waiters concurrently instead of queueing; files never read before writing defaulted to utf8 instead of windows-1252. | `main/services/FileService.ts` | done |
| F12 | `updateGlobalConstant` regex `[^;]+` breaks on string constants containing `;`. | `store/projectStore.ts` | done |
| F13 | `renameDialog` redundant `conditions` spread (no-op). | `store/fileStore.ts` | todo |
| F14 | Unbounded redirect recursion in updater `httpsGet`/`downloadUpdate`. | `main/services/UpdaterService.ts` | done |

## Deferred

| ID | Finding | Reason |
|----|---------|--------|
| D1 | History snapshots deep-clone the entire semantic model (up to 50× per file). Structural sharing is possible (immer freezes state) but aliasing risks need a dedicated change with its own test pass. | Needs focused follow-up |
| D2 | Physically move pure quest logic from `components/QuestEditor/*` into `quest/domain/` and remove the reactflow type dependency. | Large import-churn refactor; tracked in `docs/refactoring-targets.md` |
| D3 | `properties.information`/`condition` string-vs-object union should be encoded once in the model types instead of `as any` casts at call sites. | Type-model change touching parser + editor |
