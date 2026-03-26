# Refactoring Targets

Audit of god components, muddled concerns, and maintainability red flags.

---

## Tier 1 — God Components (>1000 lines, 5+ distinct concerns)

### 1. `editorStore.ts` — 1,137 lines
**File:** `daedalus-dialog-editor/src/renderer/store/editorStore.ts`

Handles 8 unrelated concerns in a single Zustand store:

| Concern | Lines |
|---------|-------|
| File open/close lifecycle | 398–481 |
| Dialog/function update operations (`updateDialog`, `updateFunction`, `updateDialogConditionFunction`) | 484–675 |
| Undo/redo history helpers (`applyUndoForFile`, `applyRedoForFile`, `createQuestHistorySnapshot`) | 171–247 |
| Batch quest history across files (`applyQuestModelsWithHistory`) | 847–892 |
| Quest node position (visual state) | 1004–1081 |
| Source code save/parse cycle (`saveSource`) | 774–812 |
| Validation + code generation (`validateFile`, `saveFile`, `generateCode`) | 677–763 |
| UI selection state (selected NPC, dialog, quest, action) | 1083–1105 |

**Red flags:**
- `openFile()` (lines 398–447): 50-line function mixing I/O, parsing, and ID normalisation
- Repeated store-sync pattern 4× with no abstraction: `useProjectStore.getState().updateFileModel(filePath, model)` (lines 477, 497, 528, 600)
- No single source of truth: both `editorStore` and `projectStore` hold a copy of `semanticModel`; updates are manually pushed between them
- History helper functions live at module scope (lines 156–247) with 4-argument signatures instead of encapsulated context

**Suggested split:**
- `fileStore` — open/close/save, dirty tracking
- `historyStore` — undo/redo state + snapshot helpers
- `uiSelectionStore` — selected NPC/dialog/quest/action
- `utils/historyUtils.ts` — pure helper functions extracted from module scope

---

### 2. `ThreeColumnLayout.tsx` — 1,111 lines
**File:** `daedalus-dialog-editor/src/renderer/components/ThreeColumnLayout.tsx`

10 distinct concerns inside one React component:

| Concern | Lines |
|---------|-------|
| Dialog creation (`createDialogForNpc`) | 518–732 |
| Function tree building with LRU caching (`buildFunctionTree`) | 252–354 |
| Recent dialog tab management | 806–900 |
| NPC/dialog selection and navigation | 401–435, 783–804, 826–873 |
| Keyboard shortcuts (Ctrl+F, Escape) | 193–208 |
| Search panel integration | 949–1000 |
| Three-column layout rendering | 1013–1106 |
| Error display (syntax errors, operation errors) | 156–190, 1008–1072 |
| RAF-based state transition sequencing | 210–220, 441–449, 460–475 |
| Identifier/path utilities (8 pure functions) | 24–85 |

**Red flags:**
- `createDialogForNpc` (lines 518–732): **214-line function** with 7 levels of nesting — mixes file I/O, semantic model construction, and NPC instance creation
- `buildFunctionTree` uses `JSON.stringify` for cache comparison on every call (line 281) — O(n) serialisation defeats the caching purpose
- `void isPending;` on line 128 — variable extracted but never read; leftover from "Bug #3 fix"
- `typeof infoFunction === 'string' ? infoFunction : (infoFunction as { name?: string })?.name` duplicated 5+ times (lines 392, 642, 909, 978…) — missing a `extractFunctionName()` helper
- 8 pure utility functions (`normalizeIdentifier`, `makeUniqueName`, `normalizePath`, `getDirectoryName`, `joinPath`, `escapeRegExp`, `createNpcInstanceTemplate`) defined inline in the component file

**Suggested split:**
- `useDialogFactory()` hook — creation logic
- `useFunctionTreeBuilder()` hook — tree building + LRU cache
- `useRecentDialogTabs()` hook — tab state
- `utils/pathAndIdentifierUtils.ts` — the 8 pure functions

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
- `inferConditionType()` called 8+ times (lines 120, 157, 407, 535, 653, 757, 834, 908) without memoisation
- `InternalNodeData` structure constructed twice with identical shape (lines 493–519 and 554–580) — copy/paste duplication
- Edge creation object literal repeated 6+ times with the same 10 properties (lines 628–648, 693–716, 772–794)
- Magic colour strings inline throughout: `'#ff9800'`, `'#ffb74d'`, `'#2196f3'` (lines 15, 702, 740, 782, 842)
- Magic layout numbers: `NODE_WIDTH=280`, `NODE_HEIGHT=132`, `ranksep=180`, `nodesep=120` — no named constants
- Node IDs built via string concatenation — collision-prone (lines 103, 111)

**Suggested split:**
- `NodeIdentifier` class — node creation/identification
- `EdgeBuilder` class — edge construction
- `LayoutCalculator` class — Dagre layout
- `constants/questGraphConstants.ts` — colours, dimensions, layout params

---

## Tier 2 — Muddled Interests (500–850 lines)

### 4. `projectStore.ts` — 850 lines
**File:** `daedalus-dialog-editor/src/renderer/store/projectStore.ts`

11 concerns in one store. Key issues:

- `getQuestUsage()` (lines 447–563, **116 lines**): pure two-pass O(n²) computation — has no reason to live inside a store action
- File mutation template repeated 4× (lines 565–667, 669–713, 715–751): read → modify → write → clear cache → re-parse → merge
- `invalidateCacheForFile()` inline boilerplate repeated 4× (lines 600–603, 650–653, 696–699, 734–737):
  ```ts
  const newCache = new Map(parsedFiles);
  newCache.delete(filePath);
  set({ parsedFiles: newCache });
  ```
- Encoding bug at line 53: `// NPC ID Ã¢â€ â€™ dialogs` — should be `// NPC ID → dialogs`
- IPC Map deserialisation block copy-pasted 3× (lines 175–178) — Maps sent as plain objects over IPC, converted back without a shared helper
- Magic concurrency constants not documented: `CONCURRENCY_LIMIT = 20` (line 253), `500` ms flush interval (line 247)

**Suggested split:**
- `questAnalyzer.ts` — pure function taking parsed files + quest name
- shared `invalidateCacheForFile()` helper called from all mutation actions
- `utils/ipcSerialisation.ts` — IPC Map round-trip helper

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

### 6. `semantic-model.ts` — 1,510 lines
**File:** `daedalus-parser/src/semantic/semantic-model.ts`

- 24 action classes + 8 condition classes, every one implementing the same 4-method boilerplate (`constructor`, `generateCode`, `toDisplayString`, `getTypeName`) — ~400 lines of structural repetition
- `ensureActionType()` (lines 857–891): 35-line if-else chain inferring class from property presence — fragile (order-dependent, similar properties can collide)
- `deserializeAction()` silently returns raw JSON when type is unknown (line 913) — swallows errors rather than throwing
- `Dialog.fromJSON()` (lines 1336–1380): mixes validation, property transformation, and function-reference linking in 45 lines
- `ACTION_DISCRIMINATOR` and `CONDITION_DISCRIMINATOR` are structurally identical patterns duplicated in parallel (lines 826–854 and 1232–1245)
- Deserialisation, code generation, and data model all coexist in one file

**Suggested split:**
- Domain files: `dialogActions.ts`, `inventoryActions.ts`, `npcActions.ts`, `conditionTypes.ts`
- `ActionDeserializer` / `ConditionDeserializer` classes
- Decouple `CodeGenerator` from model classes

---

## Tier 3 — Maintainability Red Flags

### 7. `useActionManagement.ts` — 354 lines
**File:** `daedalus-dialog-editor/src/renderer/components/hooks/useActionManagement.ts`

- `updateAction()` (lines 77–144): dialog line ID generation uses a 3-capture-group regex to preserve sequence numbers — completely undocumented
- `addActionAfter()` (lines 208–298): `visiblePaths` / `insertedIndex` calculation copy-pasted 3×
- `setFunction((prev) => ({...prev, actions: newActions}))` pattern repeated 6+×
- Nested `setFunction` inside the choice-creation path (lines 221–235) — hard to follow control flow
- No validation that the target action path is valid before mutation begins

---

### 8. `VariableAutocomplete.tsx` — 473 lines
**File:** `daedalus-dialog-editor/src/renderer/components/common/VariableAutocomplete.tsx`

Five concerns in one component: projectStore data fetching, option filtering, autocomplete state, TextField rendering, and variable-creation dialog. A `useVariableOptions()` hook would separate data from presentation.

---

### 9. `ValidationService.ts` — 551 lines
**File:** `daedalus-dialog-editor/src/main/services/ValidationService.ts`

Orchestrates parser, semantic analysis, and code-generator validation, and also handles file I/O for ingested files. Concurrency controls are magic numbers without documentation.

---

### 10. Cross-cutting: Store synchronisation anti-pattern

`editorStore` and `projectStore` both hold copies of the semantic model. Updates are propagated by calling `useProjectStore.getState().updateFileModel()` directly from inside `editorStore` actions at four separate locations. This creates invisible coupling: refactoring either store's interface silently breaks the sync, and there is no single source of truth for the model state.

---

## Priority Matrix

| Priority | Target | File | Lines | Key Smell |
|----------|--------|------|-------|-----------|
| HIGH | `editorStore.ts` | store/editorStore.ts | 1,137 | 8 concerns, manual cross-store sync |
| HIGH | `ThreeColumnLayout.tsx` | components/ | 1,111 | 214-line creation fn, inline utility soup |
| ~~HIGH~~ ✅ | ~~`questGraphUtils.tsx`~~ | ~~QuestEditor/~~ | ~~1,104~~ | ~~Duplicated node/edge builders, magic constants~~ |
| ~~HIGH~~ ✅ | ~~`ConditionCard.tsx`~~ | ~~components/~~ | ~~765~~ | ~~492-line render function, 30+ object rebuilds~~ |
| MEDIUM | `projectStore.ts` | store/ | 850 | 116-line pure computation inside store |
| MEDIUM | `semantic-model.ts` | parser/ | 1,510 | 24 boilerplate action classes |
| LOW | `useActionManagement.ts` | hooks/ | 354 | Duplicated path calculation, undocumented regex |
| LOW | `VariableAutocomplete.tsx` | common/ | 473 | Mixed data fetching + presentation |
| LOW | `ValidationService.ts` | main/services/ | 551 | Mixed I/O + validation concerns |
| ARCH | Store sync pattern | editorStore ↔ projectStore | — | No SSOT, invisible coupling |
