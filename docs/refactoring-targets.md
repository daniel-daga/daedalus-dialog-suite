# Refactoring Targets

Audit of god components, muddled concerns, and maintainability red flags.

---

## Tier 1 — God Components (>1000 lines, 5+ distinct concerns)

### 1. `editorStore.ts` — ~~1,137~~ 1,046 lines (partially refactored)
**File:** `daedalus-dialog-editor/src/renderer/store/editorStore.ts`

Handles 8 unrelated concerns in a single Zustand store:

| Concern | Lines |
|---------|-------|
| File open/close lifecycle | 398–481 |
| Dialog/function update operations (`updateDialog`, `updateFunction`, `updateDialogConditionFunction`) | 484–675 |
| Undo/redo history helpers (`applyUndoForFile`, `applyRedoForFile`) | 138–204 |
| Batch quest history across files (`applyQuestModelsWithHistory`) | 786–831 |
| Quest node position (visual state) | 919–958 |
| Source code save/parse cycle (`saveSource`) | 713–752 |
| Validation + code generation (`validateFile`, `saveFile`, `generateCode`) | 619–712 |
| UI selection state (selected NPC, dialog, quest, action) | 992–1014 |

**Red flags:**
- `openFile()` (lines 398–447): 50-line function mixing I/O, parsing, and ID normalisation
- ~~Repeated store-sync pattern 4× with no abstraction~~ ✅ fixed: 13 inline sync blocks consolidated into `syncToProjectStore(filePath, get)`
- No single source of truth: both `editorStore` and `projectStore` hold a copy of `semanticModel`; updates are manually pushed between them
- ~~History helper functions live at module scope (lines 156–247) with 4-argument signatures instead of encapsulated context~~ ✅ fixed: `cloneSemanticModel`, `cloneQuestNodePositionsForFile`, `createQuestHistorySnapshot`, `normalizeBatchFilePaths` and all history types extracted to `utils/historyUtils.ts`

**Completed:**
- ✅ `utils/historyUtils.ts` — history types (`QuestNodePosition`, `QuestNodePositionMap`, `QuestHistorySnapshot`, `QuestHistoryState`, `QuestBatchHistoryState`) and 4 pure helper functions extracted from module scope
- ✅ `syncToProjectStore()` — single named helper replaces 13 inline repetitions of the cross-store sync pattern
- ✅ `store/uiSelectionStore.ts` — `selectedNPC`, `selectedDialog`, `selectedQuest`, `selectedFunctionName`, `selectedAction`, `activeView` and their 6 setters extracted to a standalone Zustand store; `editorStore.resetEditorSession()` delegates to `useUISelectionStore.getState().resetUISelection()`; 4 consumer files updated (`ThreeColumnLayout`, `MainLayout`, `QuestEditor`, `useNavigation`)

**Remaining suggested split (architectural, deferred):**
- `fileStore` — open/close/save, dirty tracking
- `historyStore` — undo/redo state + snapshot helpers (move `applyUndoForFile`/`applyRedoForFile` + store state)

---

---

### 2. `ThreeColumnLayout.tsx` — ~~1,111~~ ~~647~~ 366 lines ✅ DONE
**File:** `daedalus-dialog-editor/src/renderer/components/ThreeColumnLayout.tsx`

10 distinct concerns inside one React component:

| Concern | Lines | Status |
|---------|-------|--------|
| Dialog creation (`createDialogForNpc`) | 518–732 | ✅ extracted |
| Function tree building with LRU caching (`buildFunctionTree`) | 252–354 | ✅ extracted |
| Recent dialog tab management | 806–900 | ✅ extracted |
| NPC/dialog selection and navigation | 401–435, 783–804, 826–873 | ✅ extracted |
| Keyboard shortcuts (Ctrl+F, Escape) | 193–208 | ✅ extracted |
| Search panel integration | 949–1000 | ✅ extracted |
| Three-column layout rendering | 1013–1106 | deferred (architectural split) |
| Error display (syntax errors, operation errors) | 156–190, 1008–1072 | ✅ extracted |
| RAF-based state transition sequencing | 210–220, 441–449, 460–475 | ✅ extracted |
| Identifier/path utilities (8 pure functions) | 24–85 | ✅ extracted |

**Red flags:**
- ~~`createDialogForNpc` (lines 518–732): **214-line function** with 7 levels of nesting~~ ✅ moved to `hooks/useDialogFactory.ts`
- ~~`buildFunctionTree` uses `JSON.stringify` for cache comparison on every call (line 281) — O(n) serialisation defeats the caching purpose~~ ✅ fixed: replaced with reference-equality only; misses rebuild and re-cache
- ~~`void isPending;` on line 128 — variable extracted but never read; leftover from "Bug #3 fix"~~ ✅ fixed: renamed to `_isPending`
- ~~`typeof infoFunction === 'string' ? infoFunction : (infoFunction as { name?: string })?.name` duplicated 5+ times~~ ✅ fixed: extracted to `extractFunctionName()` in `utils/pathAndIdentifierUtils.ts`
- ~~8 pure utility functions (`normalizeIdentifier`, `makeUniqueName`, `normalizePath`, `getDirectoryName`, `joinPath`, `escapeRegExp`, `createNpcInstanceTemplate`) defined inline in the component file~~ ✅ moved to `utils/pathAndIdentifierUtils.ts`

**Completed:**
- ✅ `utils/pathAndIdentifierUtils.ts` — 7 pure functions + `extractFunctionName()` extracted from component scope
- ✅ `hooks/useDialogFactory.ts` — `createDialogForNpc` + `resolveTargetFilePath` extracted (214-line function removed from component)
- ✅ `hooks/useFunctionTreeBuilder.ts` — LRU cache + `buildFunctionTree` recursive tree builder extracted
- ✅ `hooks/useRecentDialogTabs.ts` — recent-tab state (`addRecentDialog`, `closeRecentDialog`) extracted
- ✅ `hooks/useDialogTransition.ts` — RAF-based two-frame sequencing (`finalizeDialogSelection`), loading state, scroll ref, and RAF cleanup on unmount extracted
- ✅ `hooks/useNpcDialogErrors.ts` — NPC dialog parse-error computation (`npcDialogErrors`, `hasNpcDialogErrors`) and console.error logging effect extracted
- ✅ `hooks/useDialogNavigation.ts` — all NPC/dialog selection and navigation handlers (`handleSelectNPC`, `handleSelectDialog`, `handleSelectRecentDialog`, `handleCloseRecentDialog`, `navigateToDialogWithLoading`) extracted
- ✅ `hooks/useSearchNavigation.ts` — search panel open state, Ctrl+F / Escape keyboard shortcuts, and `handleSearchResultClick` extracted

**Remaining suggested split (architectural, deferred):**
- Three-column layout rendering — sub-components for NPC column, dialog-tree column, editor column

---

### 3. `questGraphUtils.tsx` — 1,104 lines ✅ DONE
**File:** `daedalus-dialog-editor/src/renderer/components/QuestEditor/questGraphUtils.tsx`

8 concerns in a single utility module:

| Concern | Lines |
|---------|-------|
| Quest node identification (`identifyQuestNodes`) | 316–588 |
| Edge building (`buildQuestEdges`) | 590–866 |
| Graph filtering/transformation | 868–952 |
| Dagre layout calculation (`calculateDagreLayout`) | 954–1104 |
| Node/edge data structure construction | scattered |
| Condition type inference helpers | 120–155 |
| Expression string generation | 156–188 |
| External entry point handling | 80–119 |

**Red flags:**
- `identifyQuestNodes` and `buildQuestEdges` are each ~275 lines with `forEach → forEach → forEach` nesting
- ~~`inferConditionType()` called 8+ times (lines 120, 157, 407, 535, 653, 757, 834, 908) without memoisation~~ ✅ fixed: `WeakMap` cache added; repeated calls with the same condition object skip the property-check walk entirely
- ~~`InternalNodeData` structure constructed twice with identical shape (lines 493–519 and 554–580) — copy/paste duplication~~ ✅ fixed: extracted to `buildInferredFunctionNodeData()` factory
- ~~Edge creation object literal repeated 6+ times with the same 10 properties (lines 628–648, 693–716, 772–794)~~ ✅ fixed: extracted to `buildChoiceEdge`, `buildConditionEdge`, `buildKnowsEdge`, `buildVariableEdge`, `buildExternalEntryEdge` factories
- ~~Magic colour strings inline throughout: `'#ff9800'`, `'#ffb74d'`, `'#2196f3'` (lines 15, 702, 740, 782, 842)~~ ✅ fixed: moved to `constants/questGraphConstants.ts`
- ~~Magic layout numbers: `NODE_WIDTH=280`, `NODE_HEIGHT=132`, `ranksep=180`, `nodesep=120` — no named constants~~ ✅ fixed: moved to `constants/questGraphConstants.ts`
- ~~Node IDs built via string concatenation — collision-prone (lines 103, 111)~~ ✅ fixed: extracted to `buildGeneratedConditionNodeId()` and `buildGeneratedExternalEntryNodeId()` with `toNodeToken()` sanitisation

**Completed:**
- ✅ `constants/questGraphConstants.ts` — all colour constants (`CHOICE_EDGE_COLOR`, `CONDITION_EDGE_COLOR`, `KNOWS_EDGE_COLOR`, `VARIABLE_EDGE_COLOR`, `ENTRY_EDGE_COLOR`) and layout dimensions (`NODE_WIDTH`, `NODE_HEIGHT`, `DAGRE_LAYOUT`) extracted
- ✅ `buildInferredFunctionNodeData()` — factory replacing the duplicated `InternalNodeData` literal
- ✅ `buildChoiceEdge` / `buildConditionEdge` / `buildKnowsEdge` / `buildVariableEdge` / `buildExternalEntryEdge` — named edge factories replacing the 6+ repeated 10-property object literals
- ✅ `buildGeneratedConditionNodeId()` / `buildGeneratedExternalEntryNodeId()` — ID builders with `toNodeToken()` sanitisation replacing raw string concatenation
- ✅ `inferConditionType()` WeakMap memoisation — `_conditionTypeCache` skips repeated property-check walks for the same condition object

**Remaining suggested split (architectural, deferred):**
- `NodeIdentifier` class — node creation/identification
- `EdgeBuilder` class — edge construction
- `LayoutCalculator` class — Dagre layout

---

## Tier 2 — Muddled Interests (500–850 lines)

### 4. `projectStore.ts` — ~~850~~ 717 lines ✅ DONE
**File:** `daedalus-dialog-editor/src/renderer/store/projectStore.ts`

11 concerns in one store. Key issues:

- ~~`getQuestUsage()` (lines 447–563, **116 lines**): pure two-pass O(n²) computation — has no reason to live inside a store action~~ ✅ extracted to `utils/questAnalyzer.ts`; store action is now a one-liner delegate
- ~~File mutation template repeated 4× (lines 565–667, 669–713, 715–751): read → modify → write → clear cache → re-parse → merge~~ ✅ extracted to `mutateQuestFile()`
- ~~`invalidateCacheForFile()` inline boilerplate repeated 4×~~ ✅ consolidated into a shared `invalidateCacheForFile()` closure inside the store
- ~~Encoding bug at line 53: `// NPC ID Ã¢â€ â€™ dialogs`~~ ✅ fixed: `// NPC ID → dialogs`
- ~~IPC Map deserialisation block copy-pasted 3× (lines 175–178)~~ ✅ extracted to `utils/ipcSerialisation.ts` (`deserialiseIpcMap`)
- Magic concurrency constants not documented: `CONCURRENCY_LIMIT = 20` (line 253), `500` ms flush interval (line 247)

**Completed:**
- ✅ `utils/questAnalyzer.ts` — pure `getQuestUsage(parsedFiles, questName)` extracted; 116-line store action replaced with a one-liner
- ✅ `invalidateCacheForFile()` — shared closure helper replacing 4 inline cache-invalidation patterns
- ✅ `utils/ipcSerialisation.ts` — `deserialiseIpcMap<K, V>()` handles both Map and plain-object IPC payloads
- ✅ `mutateQuestFile(filePath, mutatorFn)` — shared read → transform → write → invalidate → re-parse helper replacing the 4 near-identical async sequences in `createQuest`, `addVariable`, `updateGlobalConstant`, and `deleteVariable`

---

### 5. `ConditionCard.tsx` — 765 lines ✅ DONE
**File:** `daedalus-dialog-editor/src/renderer/components/ConditionCard.tsx`

- `renderConditionFields()` (lines 204–695): **492-line function** — a switch statement with 9 nearly-identical branches, each rebuilding the full condition object inline
- Three separate switch statements on the same `conditionType` variable (lines 157–178, 181–202, 205–695) — could be one registry lookup
- Every `handleUpdate` call reconstructs the whole condition object spread: 30+ repetitions of `{ type: '...', field: value, ...rest }`
- 10 individual type-guard functions (lines 31–72) instead of a single discriminated union helper
- Debounce timeout hardcoded at `300` ms with no comment (line 116)
- Layout flex widths (`'1 1 30%'`, `'1 1 60%'`, `'1 1 35%'`) repeated without design tokens

**Implemented split:**
- 9 focused field components in `conditions/` — one per condition type (~30–50 lines each)
- `hooks/useConditionUpdate.ts` — debounce, immediate-update, flush, and unmount-cleanup
- `conditions/conditionRegistry.tsx` — single lookup table (`type → { icon, label, Fields }`), replacing all 3 switches and 10 type guards
- `ConditionCard.tsx` reduced from 765 → 90 lines, zero switch statements

---

### 6. `semantic-model.ts` — 1,510 lines (partially refactored)
**File:** `daedalus-parser/src/semantic/semantic-model.ts`

- 24 action classes + 8 condition classes, every one implementing the same 4-method boilerplate (`constructor`, `generateCode`, `toDisplayString`, `getTypeName`) — ~400 lines of structural repetition
- ~~`ensureActionType()` (lines 857–891): 35-line if-else chain inferring class from property presence — fragile (order-dependent, similar properties can collide)~~ ✅ documented: ordering rationale and collision-sensitive constraints explained in block comment
- ~~`deserializeAction()` silently returns raw JSON when type is unknown (line 913) — swallows errors rather than throwing~~ ✅ fixed: `console.warn` now emitted for unrecognised types with actionable hint
- `Dialog.fromJSON()` (lines 1336–1380): mixes validation, property transformation, and function-reference linking in 45 lines
- ~~`ACTION_DISCRIMINATOR` and `CONDITION_DISCRIMINATOR` are structurally identical patterns duplicated in parallel (lines 826–854 and 1232–1245)~~ ✅ fixed: shared `DiscriminatorConfig` interface extracted; both constants now typed against it
- Deserialisation, code generation, and data model all coexist in one file

**Completed:**
- ✅ `DiscriminatorConfig` interface — shared shape for `ACTION_DISCRIMINATOR` and `CONDITION_DISCRIMINATOR`, making the pattern explicit and TypeScript-checked
- ✅ `ensureActionType()` ordering comments — documents the fragile check order and what properties collide
- ✅ `deserializeAction()` unknown-type warning — `console.warn` with hint to add the type to `ACTION_DISCRIMINATOR.subTypes`

**Remaining suggested split (architectural, deferred):**
- Domain files: `dialogActions.ts`, `inventoryActions.ts`, `npcActions.ts`, `conditionTypes.ts`
- `ActionDeserializer` / `ConditionDeserializer` classes
- Decouple `CodeGenerator` from model classes

---

## Tier 3 — Maintainability Red Flags

### 7. `useActionManagement.ts` — ~~354~~ 354 lines ✅ DONE
**File:** `daedalus-dialog-editor/src/renderer/components/hooks/useActionManagement.ts`

- ~~`updateAction()` (lines 77–144): dialog line ID generation uses a 3-capture-group regex to preserve sequence numbers — completely undocumented~~ ✅ documented: ID format (`<prefix>_<speakerIndex>_<sequenceNumber>`) and speaker-change sequence-preservation logic explained
- ~~`addActionAfter()` (lines 208–298): `visiblePaths` / `insertedIndex` calculation copy-pasted 3×~~ ✅ extracted to `findInsertedPath(newActions, afterPath)` module-scope helper
- ~~`setFunction((prev) => ({...prev, actions: newActions}))` pattern repeated 6+×~~ ✅ extracted to `patchActions(transform)` useCallback helper; used in `deleteAction` and `moveAction`
- ~~Nested `setFunction` inside the choice-creation path (lines 221–235) — hard to follow control flow~~ ✅ refactored: early `return` removed, both branches now fall through to a single `if (nextPath) focusAction(...)` call
- No validation that the target action path is valid before mutation begins

**Completed:**
- ✅ `findInsertedPath()` — pure helper replacing 3 inline `flattenActionPaths` + `findIndex` + index-offset blocks
- ✅ Regex in `updateAction` documented with DialogLine ID format and speaker-change preservation rationale
- ✅ `patchActions()` — `useCallback` helper replacing the repeated `setFunction((prev) => { if (!prev) return prev; return { ...prev, actions: transform(prev.actions) }; })` boilerplate
- ✅ `addActionAfter` control flow — unified: both choice and non-choice branches now share a single `focusAction` call at the end; early `return` eliminated

---

### 8. `VariableAutocomplete.tsx` — ~~473~~ 287 lines ✅ DONE
**File:** `daedalus-dialog-editor/src/renderer/components/common/VariableAutocomplete.tsx`

~~Five concerns in one component: projectStore data fetching, option filtering, autocomplete state, TextField rendering, and variable-creation dialog. A `useVariableOptions()` hook would separate data from presentation.~~

**Completed:**
- ✅ `hooks/useVariableOptions.ts` — all data fetching and option-building logic extracted; component reduced from 473 → 287 lines

---

### 9. `ValidationService.ts` — ~~551~~ 421 lines ✅ DONE
**File:** `daedalus-dialog-editor/src/main/services/ValidationService.ts`

~~Orchestrates parser, semantic analysis, and code-generator validation, and also handles file I/O for ingested files. Concurrency controls are magic numbers without documentation.~~

**Completed:**
- ✅ `ACTION_REQUIRED_FIELD_VALIDATORS` registry — replaces the 180-line `validateActions` switch statement; each action type maps to a single-line validator function returning an error suffix or null
- ✅ `ACTION_DISPLAY_NAMES` map — centralises human-readable labels previously scattered as string literals across the switch cases
- ✅ `validateActions` reduced from ~180 lines to ~45 lines; `PickpocketAction` kept inline due to its mode-dependent nested check

---

### 10. Cross-cutting: Store synchronisation anti-pattern

`editorStore` and `projectStore` both hold copies of the semantic model. Updates are propagated by calling `useProjectStore.getState().updateFileModel()` directly from inside `editorStore` actions at four separate locations. This creates invisible coupling: refactoring either store's interface silently breaks the sync, and there is no single source of truth for the model state.

---

## Priority Matrix

| Priority | Target | File | Lines | Key Smell |
|----------|--------|------|-------|-----------|
| HIGH 🔄 | `editorStore.ts` | store/editorStore.ts | ~~1,137~~ 1,046 | 8 concerns (sync pattern ✅, history types ✅, uiSelectionStore ✅) |
| ~~HIGH~~ ✅ | ~~`ThreeColumnLayout.tsx`~~ | ~~components/~~ | ~~1,111~~ → 366 | ~~214-line creation fn~~ (utils ✅, cache fix ✅, useDialogFactory ✅, useFunctionTreeBuilder ✅, useRecentDialogTabs ✅, extractFunctionName ✅, void isPending ✅, useDialogTransition ✅, useNpcDialogErrors ✅, useDialogNavigation ✅, useSearchNavigation ✅) |
| ~~HIGH~~ ✅ | ~~`questGraphUtils.tsx`~~ | ~~QuestEditor/~~ | ~~1,104~~ | ~~Duplicated node/edge builders, magic constants~~ (constants ✅, buildInferredFunctionNodeData ✅, edge factories ✅, ID builders ✅, inferConditionType WeakMap ✅) |
| ~~HIGH~~ ✅ | ~~`ConditionCard.tsx`~~ | ~~components/~~ | ~~765~~ | ~~492-line render function, 30+ object rebuilds~~ |
| ~~MEDIUM~~ ✅ | ~~`projectStore.ts`~~ | ~~store/~~ | ~~850~~ → 717 | (questAnalyzer ✅, invalidateCacheForFile ✅, ipcSerialisation ✅, mutateQuestFile ✅) |
| MEDIUM 🔄 | `semantic-model.ts` | parser/ | 1,510 | (DiscriminatorConfig ✅, ensureActionType comments ✅, deserializeAction warn ✅) domain split + boilerplate reduction deferred |
| ~~LOW~~ ✅ | ~~`useActionManagement.ts`~~ | ~~hooks/~~ | ~~354~~ | (findInsertedPath ✅, regex documented ✅, patchActions ✅, addActionAfter control flow ✅) |
| ~~LOW~~ ✅ | ~~`VariableAutocomplete.tsx`~~ | ~~common/~~ | ~~473~~ → 287 | ~~Mixed data fetching + presentation~~ (useVariableOptions ✅) |
| ~~LOW~~ ✅ | ~~`ValidationService.ts`~~ | ~~main/services/~~ | ~~551~~ → 421 | (ACTION_REQUIRED_FIELD_VALIDATORS registry ✅, ACTION_DISPLAY_NAMES map ✅, validateActions ~180 → ~45 lines ✅) |
| ARCH | Store sync pattern | editorStore ↔ projectStore | — | No SSOT, invisible coupling |
