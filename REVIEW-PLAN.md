# Project Review Plan

A partition of the Daedalus Dialog Suite into **11 logically cohesive chunks** that can each
be reviewed independently. Chunks follow architectural boundaries (parser pipeline stages,
Electron process split, renderer feature areas) so a reviewer can hold one chunk in their head
without needing the rest.

Each chunk lists its **scope**, **paths**, **entry points**, **dependencies**, and a
**review focus**. Suggested review order is dependency-driven: foundational chunks first, the
code that consumes them after.

---

## Map at a glance

| # | Chunk | Workspace | Files (approx) | Depends on |
|---|-------|-----------|----------------|------------|
| 1 | Parser: semantic model & types | `daedalus-parser` | 7 | — |
| 2 | Parser: grammar & core | `daedalus-parser` | 3 + build cfg | 1 |
| 3 | Parser: semantic pipeline (visitors + AST parsers) | `daedalus-parser` | 10 | 1, 2 |
| 4 | Parser: code generation | `daedalus-parser` | 1 | 1 |
| 5 | Editor: main process & IPC contracts | `daedalus-dialog-editor` | 16 | parser pkg |
| 6 | Editor: state management (stores) & history | `daedalus-dialog-editor` | 11 | 5 |
| 7 | Editor: renderer shell, theming & composition | `daedalus-dialog-editor` | 14 | 5, 6 |
| 8 | Editor: action system (factory, renderers, conditions) | `daedalus-dialog-editor` | ~55 | 1, 6 |
| 9 | Editor: dialog tree & editing UI | `daedalus-dialog-editor` | ~25 | 6, 8 |
| 10 | Editor: quest editor (graph) | `daedalus-dialog-editor` | ~25 | 6 |
| 11 | Editor: nav, search, source view & misc dialogs | `daedalus-dialog-editor` | ~22 | 6, 7 |

> Tests and CI/build infra are reviewed **within each chunk** alongside the code they cover
> (parser `test/*.test.js`, editor `tests/e2e/*.spec.ts`, workflows, configs). See
> [Cross-cutting concerns](#cross-cutting-concerns) at the end.

**Suggested review order:** 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11

---

# Parser (`daedalus-parser/`)

## Chunk 1 — Parser: semantic model & types

**Scope:** The data structures and type contracts every other parser stage produces or consumes.
Pure declarations; no parsing or traversal logic. The natural foundation.

**Paths:**
- `src/semantic/semantic-model.ts` — core model classes (`Dialog`, `DialogFunction`, …)
- `src/semantic/semanticModelInterfaces.ts` — `SemanticModel` and related type definitions
- `src/semantic/conditionTypes.ts` — condition type definitions
- `src/semantic/dialogActions.ts` — `DialogLine`, `Choice` action types
- `src/semantic/inventoryActions.ts` — inventory action types
- `src/semantic/npcActions.ts` — NPC behavior action types
- `src/semantic/cross-references.ts` — cross-reference resolution helpers

**Entry points:** `SemanticModel` shape; model class constructors.

**Dependencies:** None internal. Everything else depends on this.

**Review focus:** Type soundness and discriminants (action `type` fields), optionality on the
`SemanticModel` shape, whether model classes leak parsing concerns, naming consistency across
the action/condition unions.

---

## Chunk 2 — Parser: grammar & core

**Scope:** The Tree-sitter grammar and the entry point that turns source text into a parse tree,
plus parser build tooling.

**Paths:**
- `grammar.js` — Tree-sitter grammar definition
- `src/core/parser.js` — main parser entry point
- `src/utils/parser-utils.ts` — shared parsing utilities
- Build/tooling: `tsconfig.json`, `tsconfig.build.json`, `eslint.config.js`, `package.json`,
  `bindings/node`
- Tests: grammar/roundtrip-level specs in `test/`

**Entry points:** `parse()` in `src/core/parser.js`; the generated parser regenerated via
`npm run build`.

**Dependencies:** Produces the AST consumed by Chunk 3.

**Review focus:** Grammar ambiguities and precedence, error-recovery behavior, whether
`grammar.js` changes are accompanied by a regenerated parser, exported subpath correctness in
`package.json` (`.`, `./types`, `./semantic-visitor`, `./semantic-model`,
`./semantic-code-generator`, `./bindings/node`).

---

## Chunk 3 — Parser: semantic pipeline (visitors + AST parsers)

**Scope:** The two-pass visitor that walks the AST and builds the semantic model, the error pass,
and the AST-extraction helpers that decode individual nodes.

**Paths:**
- `src/semantic/semantic-visitor.ts` — visitor orchestrator
- `src/semantic/semantic-visitor-index.ts` — visitor re-exports
- `src/semantic/visitors/declaration-visitor.ts` — pass 1: skeleton objects
- `src/semantic/visitors/linking-visitor.ts` — pass 2: link references, resolve symbols
- `src/semantic/visitors/error-visitor.ts` — syntax-error collection
- `src/semantic/parsers/action-parsers.ts`
- `src/semantic/parsers/condition-parsers.ts`
- `src/semantic/parsers/argument-parsing.ts`
- `src/semantic/parsers/literal-parsing.ts`
- `src/semantic/parsers/ast-constants.ts`
- Tests: `test/linking-visitor.test.js`, `test/semantic-error-handling.test.js`,
  `test/case-sensitivity.test.js`, and other visitor/parser specs

**Entry points:** `SemanticModelBuilderVisitor` (exported via `./semantic-visitor`).

**Dependencies:** AST from Chunk 2; types/classes from Chunk 1.

**Review focus:** Two-pass ordering correctness (declaration before linking), case-insensitive
dispatch of action/condition calls, error-position accuracy, completeness of node coverage in the
AST parsers, and how unrecognized constructs degrade.

---

## Chunk 4 — Parser: code generation

**Scope:** Emitting Daedalus source back out of the semantic model (the roundtrip direction).

**Paths:**
- `src/codegen/generator.ts` — `SemanticCodeGenerator`
- Tests: roundtrip-corpus specs (`npm run test:roundtrip-corpus`, CI job disabled but runnable)

**Entry points:** `SemanticCodeGenerator` (exported via `./semantic-code-generator`).

**Dependencies:** Model/types from Chunk 1.

**Review focus:** String-template fidelity, that generation is fully model-driven (no AST
reach-through), roundtrip stability (parse → generate → parse), formatting/indentation
consistency.

---

# Editor (`daedalus-dialog-editor/`)

## Chunk 5 — Editor: main process & IPC contracts

**Scope:** The Electron main process — file I/O, project loading/indexing, parsing/codegen
orchestration, validation, settings, updater, file watching, and the worker pool. Includes the
shared type contracts that cross the IPC boundary.

**Paths:**
- `src/main/main.ts`, `src/main/preload.ts`
- `src/main/services/` — `FileService`, `ParserService`, `ProjectService`,
  `CodeGeneratorService`, `FileWatcherService`, `MetadataWorkerPool`, `ValidationService`,
  `PathValidationService`, `SettingsService`, `UpdaterService`
- `src/main/utils/semanticMetadataUtils.ts`
- `src/main/workers/metadata.worker.ts`, `src/main/workers/parser.worker.ts`
- `src/shared/types.ts`, `src/shared/updater-types.ts`
- `src/renderer/utils/ipcSerialisation.ts` (renderer side of the boundary — review here)

**Entry points:** IPC handler registration in `main.ts`; `preload.ts` bridge surface.

**Dependencies:** Consumes the `daedalus-parser` package. Defines contracts consumed by Chunks 6–11.

**Review focus:** IPC surface safety (path validation, no arbitrary FS access), serialization of
the large `semanticModel` across the boundary, worker-pool lifecycle and back-pressure, updater
download/verification, settings persistence.

---

## Chunk 6 — Editor: state management (stores) & history

**Scope:** The Zustand + Immer stores and the undo/redo machinery — the renderer's single source
of truth.

**Paths:**
- `src/renderer/store/editorStore.ts` — active dialog/function editing state
- `src/renderer/store/fileStore.ts` — file I/O and project loading
- `src/renderer/store/historyStore.ts`, `historyActions.ts` — undo/redo
- `src/renderer/store/projectStore.ts` — project index/metadata
- `src/renderer/store/searchStore.ts` — search state
- `src/renderer/store/uiSelectionStore.ts` — UI selection state
- `src/renderer/store/storeSync.ts` — cross-store synchronization
- `src/renderer/utils/historyUtils.ts`, `debounce.ts`, `shallowEqual.ts`
- `doc/undo-redo-architecture.md`

**Entry points:** Store hooks/selectors consumed by every renderer component.

**Dependencies:** IPC contracts from Chunk 5.

**Review focus:** Immer draft correctness, selector granularity (the perf rule: never pass the
whole `semanticModel` to memoized components), undo/redo invariants and history coalescing,
cross-store sync ordering, debounce flush correctness.

---

## Chunk 7 — Editor: renderer shell, theming & composition

**Scope:** App bootstrap, layout scaffolding, theming, the node-editor playground entry, and
top-level lifecycle hooks (autosave, file-watch wiring, navigation).

**Paths:**
- `src/renderer/App.tsx`, `src/renderer/main.tsx`, `src/renderer/index.html`
- `src/renderer/theme.ts`, `src/renderer/themeContext.tsx`
- `src/renderer/NodeEditorPlayground.tsx`, `node-editor.html`, `node-editor.main.tsx`
- `src/renderer/config/`
- `components/MainLayout.tsx`, `ThreeColumnLayout.tsx`, `EditorPane.tsx`, `EditorColumn.tsx`
- `components/ErrorBoundary.tsx`, `ProjectOpeningOverlay.tsx`
- `src/renderer/hooks/useAutoSave.ts`, `useFileWatcher.ts`, `useNavigation.ts`

**Entry points:** `App.tsx` (main app), `node-editor.main.tsx` (playground).

**Dependencies:** Stores (Chunk 6), IPC (Chunk 5).

**Review focus:** Layout composition and prop drilling vs. store access, theme/dark-mode wiring,
error-boundary coverage, autosave/file-watch race conditions, the two HTML entry points staying
in sync.

---

## Chunk 8 — Editor: action system (factory, renderers, conditions)

**Scope:** Everything that defines, creates, and renders dialog **actions** and **conditions** —
the largest and most extension-prone area. The action renderer registry and the shared action
field primitives live here.

**Paths:**
- `components/actionFactory.ts`, `actionTemplates.ts`, `actionTypes.ts`, `nestedActionUtils.ts`
- `components/actionRenderers/` — registry `index.tsx`, `types.ts`, and 24 per-action renderers
  (DialogLine, Choice, ConditionalAction, inventory/NPC/log/etc.)
- `components/conditions/` — `conditionRegistry.tsx` + per-condition field components
- `components/ConditionEditor.tsx`, `ConditionCard.tsx`, `ConditionSection.tsx`
- `components/common/` — `ActionTextField`, `ActionFieldContainer`, `ActionDeleteButton`,
  `ActionTypeMenu`, `VariableAutocomplete`, `autocompletePolicies.ts`, `ExpressionText`,
  `ReferenceLink`, `VariableCreationDialog`, `DeleteConfirmDialog`, `searchablePaneStyles.ts`
- Tests: `tests/e2e/action-types.spec.ts`, `action-content-types.spec.ts`,
  `conditional-action.spec.ts`, `choice-editing.spec.ts`

**Entry points:** `getRendererForAction` / `ACTION_TYPE_LABELS` registry; `createAction` factory.

**Dependencies:** Parser action/condition types (Chunk 1), stores (Chunk 6).

**Review focus:** Single-source-of-truth for the action-type registry (no duplicated label
lists), discriminant-based type detection (vs. property sniffing), the renderer `as`-cast
pattern, factory completeness vs. templates, condition registry parity with parser condition
types. Cross-reference the findings already logged in `REVIEW-dialog-editor.md`.

---

## Chunk 9 — Editor: dialog tree & editing UI

**Scope:** The dialog/function browsing tree and the per-dialog editing surface that hosts the
action list. The dialog-editing custom hooks (command, focus, navigation, action management)
belong here.

**Paths:**
- Tree: `components/DialogTree.tsx`, `DialogTreeItem.tsx`, `DialogTreeColumn.tsx`,
  `ChoiceTreeItem.tsx`, `dialogTreeUtils.ts`
- Editor surface: `components/DialogDetailsEditor.tsx`, `DialogPropertiesSection.tsx`,
  `DialogActionsSection.tsx`, `dialogTypes.ts`, `dialogUtils.ts`
- Action list host: `components/ActionsList.tsx`, `ActionCard.tsx`, `InlineChoiceEditor.tsx`
- Hooks: `components/hooks/` — `useDialogEditorCommands`, `useDialogEditorUIState`,
  `useActionManagement`, `useFocusNavigation`, `useDialogNavigation`, `useDialogTransition`,
  `useDialogFactory`, `useFunctionTreeBuilder`, `useConditionUpdate`, `useNpcDialogErrors`,
  `useRecentDialogTabs`, `useSearchNavigation`, `useVariableOptions`
- Tests: `tests/e2e/dialog-editing.spec.ts`, `dialog-creation.spec.ts`, `dialog-focus.spec.ts`,
  `dialog-properties.spec.ts`, `action-reorder.spec.ts`, `action-deletion.spec.ts`,
  `content-persistence.spec.ts`

**Entry points:** `DialogDetailsEditor` (editing surface), `DialogTree` (navigation).

**Dependencies:** Action renderers (Chunk 8), stores (Chunk 6).

**Review focus:** `ActionCard` debounce/unmount-flush race during reorder, memo comparators
(`ActionsList` / `ActionCard`) not swallowing nested updates, focus-deferral approach
(`pendingFocusRequests` vs. `setTimeout`), path-comparison performance (`actionPathToKey`),
nested action-path tree handling.

---

## Chunk 10 — Editor: quest editor (graph)

**Scope:** The Reactflow-based quest graph editor and its three-layer domain/application/UI
boundary (per `docs/architecture/quest-editor.md`).

**Paths:**
- UI: `components/QuestEditor/` — `QuestFlow` host, `Nodes/`, `Inspector/`, `commands/`,
  `constants/`; plus `components/QuestFlow.tsx`, `QuestEditor.tsx`, `QuestList.tsx`,
  `QuestDetails.tsx`, `CreateQuestDialog.tsx`
- Domain (pure logic): `src/renderer/quest/domain/`
- Application (orchestration): `src/renderer/quest/application/` (`QuestEditingService.ts`)
- Types: `src/renderer/types/questGraph.ts`
- Utils: `src/renderer/utils/questAnalyzer.ts`, `questIdentity.ts`
- Docs: `docs/architecture/quest-editor.md`
- Tests: `tests/e2e/quest-editor.spec.ts`, `node-editor.spec.ts`

**Entry points:** `QuestFlow` (graph host); `QuestEditingService` (orchestration).

**Dependencies:** Stores (Chunk 6).

**Review focus:** **Import direction** must stay one-way (UI → application → domain); domain must
have no React/MUI/Electron imports. Graph command validation/guardrails, node identity stability,
graph ↔ semantic-model mapping in `questAnalyzer`.

---

## Chunk 11 — Editor: nav, search, source view & misc dialogs

**Scope:** Remaining renderer surfaces — NPC navigation, search, raw source/Monaco view,
validation/error surfaces, the in-app updater UI, and one-off confirmation/info dialogs, plus
leftover utilities and renderer mocks.

**Paths:**
- NPC nav: `components/NPCList.tsx`, `NpcColumn.tsx`
- Search: `components/SearchPanel.tsx`, `SearchBar.tsx`, `SearchResults.tsx`
- Variables: `components/VariableManager.tsx`
- Source/validation: `components/SourceCodeEditor.tsx`, `DialogSourceViewDialog.tsx`,
  `SyntaxErrorsDisplay.tsx`, `ValidationErrorDialog.tsx`
- Dialogs/notifications: `components/UpdateNotification.tsx`, `IngestedFilesDialog.tsx`,
  `RenameDialogConfirmDialog.tsx`, `DeleteDialogConfirmDialog.tsx`
- Utils/mocks: `src/renderer/utils/pathAndIdentifierUtils.ts`, `mockAPI.ts`,
  `src/renderer/mocks/`
- Tests: `tests/e2e/search.spec.ts`, `source-view.spec.ts`, `variable-manager.spec.ts`,
  `file-opening.spec.ts`, `reload-confirmation.spec.ts`, `theme-switching.spec.ts`,
  `view-switching.spec.ts`, `project-mode-editing.spec.ts`, `undo-redo.spec.ts`

**Entry points:** Individual feature panels/dialogs, mostly mounted from the shell (Chunk 7).

**Dependencies:** Stores (Chunk 6), shell (Chunk 7).

**Review focus:** Search correctness/performance over the project index, Monaco integration and
read-only source view fidelity, updater UX states, consistent notification mechanism (snackbar
vs. native `alert`), mock API parity with the real preload surface.

---

# Cross-cutting concerns

These span chunks and are reviewed alongside the code they touch rather than as a standalone
chunk:

- **Tests** — parser `test/*.test.js` (22 files) map onto Chunks 1–4; editor `tests/e2e/*.spec.ts`
  (22 specs) and Jest suites map onto Chunks 8–11 as listed above.
- **CI/build infra** — `.github/workflows/all-tests.yml`, `build-windows.yml`,
  `deploy-pages.yml`; root `package.json`, `pnpm-workspace.yaml`, lockfiles. Review when touching
  the chunk whose build/test it governs.
- **Docs** — `docs/architecture/`, `docs/reference/`, `docs/plans/`, `gh-pages/`, the root and
  workspace `AGENTS.md` / `CLAUDE.md`. Keep in sync with the chunk being changed.
- **Prior review** — `REVIEW-dialog-editor.md` already covers much of Chunks 8–9; treat its
  Fix Log as the baseline so the same issues aren't re-reported.
