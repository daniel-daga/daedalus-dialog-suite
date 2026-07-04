# Fix Plan 07 — Rendering Performance at Mod Scale (PF1–PF3, PF5, C3, D-class subscriptions)

Status: **in-progress** — all 8 steps (§5) implemented and landed on branch
`claude/code-remediation-plans-y8f0ze` (TDD, failing-first Jest per step); suites
/ typecheck / lint green. Durable contracts extracted to
[`../architecture/render-performance.md`](../architecture/render-performance.md).
The §3.3 Playwright ingestion smoke is now landed
(`daedalus-dialog-editor/tests/e2e/ingestion-interactivity.spec.ts`): it opens a
mod-scale generated fixture (~50 NPCs × 3 files) and asserts the ingestion
progress overlay appears with determinate progress, ingestion completes, and the
NPC filter is then interactive — no timing/wall-clock assertions. (Deviation: the
app's full-screen `ProjectOpeningOverlay` blocks all interaction for the whole
`isIngesting` window by design, so the filter probe runs the instant the overlay
clears rather than mid-ingestion; a gated mock-only `mockapi_parse_delay_ms` seam
makes the ingestion window observable in the otherwise-synchronous mock parser.)
Outstanding before `done` (plan file kept): the §3.2 manual React Profiler
before/after evidence and the repo-mandated desktop smoke pass (no display in the
sandbox). See the tracker's slice-7 progress notes for commit refs and deviations.

Source findings: [`code-review-findings.md`](./code-review-findings.md) §7 (PF1, PF2, PF3, PF5) plus the renderer-UI sub-review's ActionCard stale-memo finding (C3) and selector-less store subscriptions (D1–D4 class).
Tracker: [`code-review-remediation.md`](./code-review-remediation.md) slice 7.

Scope: `daedalus-dialog-editor/src/renderer/store/projectStore.ts`, `store/storeSync.ts`, every renderer store subscription, `components/MainLayout.tsx`, `VariableManager.tsx`, `DialogTree.tsx` (+ `DialogTreeItem.tsx`, `dialogTreeUtils.ts`), `App.tsx`, `ThreeColumnLayout.tsx`, `hooks/useNavigation.ts`, `components/hooks/useVariableOptions.ts`, `ActionCard.tsx`.

Boundary with [`fix-04-quest-editor.md`](./fix-04-quest-editor.md): slice 4 owns the `QuestFlow`/`QuestEditor` `parsedFiles` subscription fixes and the canvas lifecycle (its step 7, PF3). Slice 7 owns everything store-side (merge strategy, `parseGeneration` mechanics if slice 4 has not landed it, remaining `parsedFiles` subscribers) and all non-quest component subscriptions. Whichever slice lands first implements `parseGeneration` in `projectStore`; the other consumes it.

---

## 1. Scope & findings

### The hot path (verified by reading, this is the core of PF1)

Every visual edit flows: `ActionCard` 300 ms debounce → `historyActions` → `fileStore.updateModel` (Immer; new `semanticModel` identity, untouched categories keep their refs) → `storeSync.ts` subscription (ref-equality guard is correct) → `projectStore.updateFileModel` → `loadAndMergeNpcModels(selectedNpc)` → `mergeSemanticModels([globals..., npcFiles...])` → **brand-new `mergedSemanticModel` with 8 freshly-built category objects** (`projectStore.ts:453-496`), sized O(all symbols in globals + NPC files). Since the file being edited is virtually always one of the selected NPC's files, the "skip when unrelated" guard at `updateFileModel` (`projectStore.ts:781-794`) does not help the editing hot path. Every `mergedSemanticModel` subscriber then re-renders and every `useMemo([mergedSemanticModel])` recomputes — including O(n log n) `localeCompare` sorts in `VariableManager` and `useVariableOptions`.

### Verified as reported

- **PF1** — `updateFileModel` re-merges synchronously per edit flush; `MainLayout` (`MainLayout.tsx:40-42`), `VariableManager` (`VariableManager.tsx:46`), `SourceCodeEditor` (`SourceCodeEditor.tsx:14`), `useNavigation` (`useNavigation.ts:21-31`) subscribe selector-less; `VariableManager` rebuilds + re-sorts every symbol per merge (`VariableManager.tsx:54-81`, dep `[mergedSemanticModel]`).
- **PF2** — `DialogTree.tsx:158-174` puts the whole `semanticModel` into react-window `itemData`; every merge gives it a new identity → every visible `Row` re-runs. `DialogTreeItem`'s hand-written comparator (`DialogTreeItem.tsx:79-108`) papers over it per row, but `Row` itself and `ChoiceTreeItem` reconciliation still run per model identity, and the comparator duplicates render logic (a maintenance trap).
- **PF3** — `QuestFlow.tsx:71-74` and `QuestEditor.tsx:21-26` subscribe to `parsedFiles` identity (changes per 500 ms ingestion flush). **Owned by slice 4**; see boundary note.
- **PF5a** — aborted-ingestion flush bleeds stale data: inside `startBackgroundIngestion`, the post-`await` success path (`projectStore.ts:342-346`) writes into `pendingUpdates` with **no abort check** (abort is only checked at loop top and in `catch`), and the `finally` block (`projectStore.ts:374-377`) calls `flushUpdates()` **unconditionally** — after `openProject` has already reset `parsedFiles` to a new Map for the *next* project, the old run's final flush merges stale entries from the previous project into the new project's cache.
- **PF5b** — `getSemanticModel` (`projectStore.ts:419-451`) has no in-flight dedup: concurrent callers for the same path (e.g. `useNavigation.navigateToDialog`'s `Promise.all` racing `handleSelectNPC`) each fire a full IPC parse.
- **C3** — `ActionCard`'s memo comparator (`ActionCard.tsx:397-412`) compares only `path`/`index`/`totalActions`/`npcName`/`dialogContextName`/`filePath`/`action` and **ignores `semanticModel` and every callback prop**. A memo-blocked card keeps rendering with a stale `semanticModel` (e.g. `ChoiceRenderer.tsx:40-43,133` reads `semanticModel.functions[targetFunction]` for the badge/expand) and stale callback closures (only the debounced-update path is ref-protected).

### Corrected

- The review implies the whole problem is selector-less subscriptions. Half of it is **coarse-identity subscriptions behind correct selectors**: `App.tsx:55-65` selects `parsedFiles` (needs only `.size`) and `editHistory` (needs two booleans) with `shallow` — the whole App tree re-renders per 500 ms ingestion flush and per history push. `ThreeColumnLayout.tsx:79-92` selects `parsedFiles` (only forwarded to `useNpcDialogErrors`) and `mergedSemanticModel`. Selector hygiene alone does not fix PF1; the merged-model identity churn must also be fixed (hence §2.1).
- `updateFileModel` already avoids the O(project) dialog-index rebuild on unchanged dialog sets (`projectStore.ts:734-773`) — the review's "on effectively every edit" applies to the *merge*, not the index.

### New findings

- **N1 (high impact)** — `useNavigation()` is selector-less on **three stores** (`useNavigation.ts:21,23,31`) and is consumed by `VariableAutocomplete.tsx:88` and `ReferenceLink.tsx:18` — i.e. by **every autocomplete field inside every mounted action/condition renderer**. Every merge, every `openFiles` change, every UI-selection change re-renders every autocomplete leaf, *bypassing* ActionCard's memo entirely (children rendered by the leaf's own subscription). Its callbacks also depend on `mergedSemanticModel` identity, so consumers' effects (`QuestFlow`'s `onNodeDoubleClick` chain, feeding fix-04's Q3) churn per merge.
- **N2** — `loadAndMergeNpcModels` recomputes the `globalFiles` set by iterating the entire `dialogIndex` (`projectStore.ts:689-698`) on every call — O(project) bookkeeping per edit flush before the merge even starts.
- **N3** — ingestion flushes (`flushUpdates`) only touch `parsedFiles`, **not** the merged model — the ingestion-time render storm is purely a `parsedFiles`-subscriber problem (App, ThreeColumnLayout, IngestedFilesDialog, QuestEditor/QuestFlow), not a merge problem. This makes the two workstreams (merge identity vs. `parsedFiles` narrowing) independent.
- **N4** — `useVariableOptions` subscribes per-field (good) but memoizes on whole `mergedSemanticModel` identity (`useVariableOptions.ts:52,242`) — the full option rebuild + sort runs per merge even when constants/variables/instances are untouched. The identity-stable merge (§2.1) is a prerequisite for fixing this.
- **N5** — Jest already has exact precedents for the regression guards this plan needs: `tests/useVariableOptions.subscription.test.tsx` (probe render-count vs. store mutation) and `tests/IngestedFilesDialog.rerender.test.tsx`.

### Full enumeration — selector-less store subscriptions (audit checklist)

Every call of the form `useXStore()` (whole-state subscription; re-renders on *any* store change) in `src/renderer`. Zustand actions are stable references, so action-only rows never need reactivity — `getState()` or per-field selectors both work.

| # | Location | Store | Fields destructured | Fix |
|---|---|---|---|---|
| 1 | `components/MainLayout.tsx:40` | editor | `openFiles` | `useEditorStore(s => filePath ? s.openFiles.get(filePath) : null)` — it only needs the one file state |
| 2 | `components/MainLayout.tsx:41` | uiSelection | `activeView`, `setActiveView` | per-field selectors |
| 3 | `components/MainLayout.tsx:42` | project | `projectPath`, `mergedSemanticModel`, `loadQuestData` | per-field selectors; see §2.2 for `mergedSemanticModel` |
| 4 | `components/VariableManager.tsx:46` | project | `mergedSemanticModel`, `deleteVariable` | `s.mergedSemanticModel.constants`, `s.mergedSemanticModel.variables`, `s.deleteVariable` (§2.4) |
| 5 | `components/CreateQuestDialog.tsx:32` | project | `mergedSemanticModel`, `createQuest`, `isLoading` | `.constants` + `.variables` selectors (that is all it reads: lines 47, 53, 105, 109) |
| 6 | `components/QuestDetails.tsx:40` | project | `addVariable`, `updateGlobalConstant`, `isLoading` | actions via selectors; `isLoading` per-field |
| 7 | `components/DialogDetailsEditor.tsx:43` | editor | `openFiles`, `saveFile` | `s.openFiles.get(filePath)`-style selector + action selector |
| 8 | `components/DialogDetailsEditor.tsx:58` | history | `undo`, `redo` | actions → `getState()` or selectors (never re-render) |
| 9 | `components/SourceCodeEditor.tsx:14` | editor | `openFiles`, `setWorkingCode`, `saveSource`, `codeSettings` | file-state selector + actions. Note: only mount point is commented out in `MainLayout.tsx:120-122`; fix anyway (cheap) since the component ships |
| 10 | `components/DialogSourceViewDialog.tsx:34` | editor | `codeSettings` | `s.codeSettings` |
| 11 | `components/SearchResults.tsx:126` | search | `searchQuery`, `searchResults`, `isSearching` | per-field selectors |
| 12 | `components/SearchPanel.tsx:36` | search | `performSearch`, `clearSearch` | actions only → selectors |
| 13 | `components/SearchBar.tsx:26` | search | `searchQuery`, `setSearchQuery`, `clearSearch` | per-field selectors |
| 14 | `components/NPCList.tsx:53` | search | `npcFilter`, `setNpcFilter`, `filterNpcs` | per-field selectors |
| 15 | `components/DialogTree.tsx:115` | search | `dialogFilter`, `setDialogFilter`, `filterDialogs` | per-field selectors |
| 16 | `components/common/VariableCreationDialog.tsx:35` | project | `addVariable`, `questFiles`, `allDialogFiles`, `isLoading` | per-field selectors |
| 17 | `hooks/useNavigation.ts:21` | project | `dialogIndex`, `selectNpc`, `getSemanticModel`, `loadAndMergeNpcModels`, `projectPath`, `mergedSemanticModel` | **remove subscription entirely** — imperative `getState()` (§2.3) |
| 18 | `hooks/useNavigation.ts:23` | editor | `openFile`, `openFiles`, `activeFile` | same (§2.3) |
| 19 | `hooks/useNavigation.ts:31` | uiSelection | 5 setters | same (§2.3) |
| 20 | `components/hooks/useDialogNavigation.ts:53` | project | `dialogIndex`, `selectNpc`, `getSemanticModel`, `loadAndMergeNpcModels` | event-handler hook → `getState()` inside callbacks |
| 21 | `components/hooks/useDialogNavigation.ts:54` | editor | `activeFile`, `openFile` | `activeFile` per-field selector (reactive), `openFile` via `getState()` |
| 22 | `components/hooks/useDialogNavigation.ts:55` | uiSelection | 3 setters | `getState()` |
| 23 | `components/hooks/useDialogTransition.ts:30` | uiSelection | 2 setters | `getState()` |
| 24 | `components/hooks/useSearchNavigation.ts:32` | uiSelection | `setSelectedFunctionName` | `getState()` |

Coarse-identity subscriptions (selector exists but the selected value churns):

| # | Location | Selected | Fix |
|---|---|---|---|
| A | `App.tsx:55-64` | `parsedFiles` (whole Map) | select `s.parsedFiles.size` (that is all App reads: lines 85, 89) |
| B | `App.tsx:65` | `editHistory` (whole Map) | select `canUndo`/`canRedo` booleans directly (two small selectors keyed on `activeFile`) |
| C | `ThreeColumnLayout.tsx:79-92` | `parsedFiles`, `mergedSemanticModel` | drop `parsedFiles` (move derivation into `useNpcDialogErrors` with its own narrow selector, §2.5); `mergedSemanticModel` stays (it *is* the dialog editor's model) but benefits from §2.1 |
| D | `QuestEditor.tsx:21-26` / `QuestFlow.tsx:71-74` | `parsedFiles` | **slice 4 owns** (parseGeneration + imperative reads) — do not duplicate |
| E | `IngestedFilesDialog.tsx:28` | `parsedFiles` | acceptable while open; gate the selector on `open` (`open ? s.parsedFiles : EMPTY`) so a closed dialog doesn't re-render per flush |

---

## 2. Fix design

### 2.1 Merged-model strategy: category-stable incremental merge (the recommendation)

Options evaluated:

- *(a) Debounce/batch the re-merge* — rejected as the primary fix: the merge is already downstream of ActionCard's 300 ms debounce; adding another timer trades latency for the same O(all symbols) rebuild and the same identity churn when it fires. (A trailing 50–100 ms coalesce for multi-file bursts — quest-file mutations, watcher storms — is a cheap add-on, noted below.)
- *(b) Per-file incremental merge (drop old contributions, fold in new)* — rejected: merging is last-wins `Object.assign`, so removing a file's previous symbols can wrongly delete or wrongly expose another file's same-named symbol (case drift makes collisions real in mod corpora, per the review's §1 note). Correctness requires per-symbol contribution tracking with collision fallback — complexity out of proportion.
- *(c) Category-stable identity merge + per-category consumer selectors* — **chosen.** `fileStore` mutations go through Immer, so an action edit produces a model where only `functions` (and sometimes `dialogs`) have new references; `constants`/`variables`/`instances`/`items`/`npcs`/`animations` keep their refs. Exploit that:

**`mergeSemanticModels` rework (`projectStore.ts:453-496`):**
- For each of the 8 categories, record the *input signature*: the ordered array of that category's map references from the input models. Cache the previous signature + previous merged category object (store-closure state, reset on `closeProject`/`clearCache`).
- If a category's signature is unchanged (same length, all refs `===`), **reuse the previous merged category object** — no rebuild, identity preserved.
- Otherwise rebuild only that category (`Object.assign` over inputs, as today).
- `mergedSemanticModel` itself still gets a new top-level identity whenever any category changed (correct: `dialogs`/`functions` consumers must react), but untouched categories are now referentially stable across merges.
- Result for the keystroke hot path: merge cost drops from O(all symbols) to O(functions+dialogs in scope), and — the bigger win — every `useMemo` keyed on `constants`/`variables`/`instances` (VariableManager sort, `useVariableOptions` option build) stops recomputing.
- Existing callers are unaffected: `loadQuestData`/`mergeUpdatedQuestFileModels` pass `[currentMerged, ...updates]` — the previous merged categories are themselves refs in the signature, so this composes.

**`loadAndMergeNpcModels` (N2):** memoize the `globalFiles` array keyed on `dialogIndex` identity (module-scope `WeakMap<dialogIndexMap, string[]>` or a store field recomputed where `dialogIndex` is replaced). Removes the per-edit O(project) set rebuild.

**CLAUDE.md compliance:** this is exactly the "prefer stable sub-properties and granular comparisons" rule — consumers migrate from `s.mergedSemanticModel` to `s.mergedSemanticModel.<category>` selectors (§2.2, §2.4, N4), which the identity-stable merge makes meaningful.

**Escalation path (document in code, do not build now):** if profiling on the synthetic fixture still shows the `functions` category rebuild hot (it is O(all functions in globals + NPC files) per edit flush), add per-file contribution maps with collision-count fallback. Not expected to be needed: a single `Object.assign` pass over even 50k entries is single-digit milliseconds.

Size: **M**.

### 2.2 Per-component selector fixes

Apply the checklist in §1 (items 1–24, A–E). Mechanics:
- zustand is v4.5 (`useStore(selector, shallow)` supported). Prefer one selector per primitive/action; use `shallow` only where a tuple is genuinely needed.
- Action-only subscriptions become non-reactive by construction (stable refs).
- `MainLayout` after fixes re-renders only on: its file's state, `activeView`, `projectPath`, and (when quest/variable view is active) the model it forwards. Note `MainLayout.tsx:46` passes `mergedSemanticModel` into `QuestEditor` — after §2.1 this prop still churns per merge, but `QuestEditor` is mounted only in quest view, and slice 4's mount-once canvas absorbs the rest.

Size: **S per item, M total** (mechanical; batch by store).

### 2.3 `useNavigation` — remove subscriptions entirely (N1)

`navigateToDialog`/`navigateToSymbol` are event handlers; nothing in the hook needs render-time reactivity. Rewrite to read `useProjectStore.getState()` / `useFileStore.getState()` / `useUISelectionStore.getState()` **inside** the callbacks (the file already does this pattern at `useNavigation.ts:83`). Both callbacks become `useCallback(..., [])` — permanently stable.

Effects:
- `VariableAutocomplete` and `ReferenceLink` (mounted per action row) stop re-rendering on every projectStore/fileStore/uiSelection change.
- `QuestFlow.onNodeDoubleClick`'s dependency chain stops churning per merge (supports fix-04 Q3).

Size: **S–M** (careful review that no call site relied on re-render-on-model-change; none found — all consumers use the functions in event handlers only).

### 2.4 VariableManager + `useVariableOptions` — category selectors (PF1 tail, N4)

- `VariableManager.tsx`: subscribe to `s.mergedSemanticModel.constants`, `s.mergedSemanticModel.variables`, `s.deleteVariable`; the `variables` memo deps become `[constants, variables]`. With §2.1, the O(n log n) rebuild+sort now runs only when a constant/variable actually changes (add/delete/value edit), not per keystroke in a dialog. No further incrementalism needed — sorting ~30k entries once per *actual* symbol change is fine; note merge-sort-per-category as escalation only.
- `useVariableOptions.ts`: replace the `mergedSemanticModel` subscription with per-category subscriptions (`constants`, `variables`, `instances`, `npcs`, `animations`, `functions`) and use those as the memo deps. Same win for every autocomplete.

Size: **S**.

### 2.5 DialogTree itemData narrowing (PF2)

- `dialogTreeUtils.ts`: `flattenDialogs` already reads each dialog's `description`/`information` — bake them into `DialogRowData` (`description: string | undefined`, `infoFuncName: string | null`).
- `DialogTree.tsx`: drop `semanticModel` from `ItemData` (`DialogTree.tsx:41-49,158-174`); `Row` reads `item.description`/`item.infoFuncName`. Narrow `flatItems`/`sortedDialogs` memo deps from `semanticModel` to `semanticModel.dialogs` (+ `buildFunctionTree`, already keyed on deferred `functions`) — `flattenDialogs` uses nothing else.
- `DialogTreeItem.tsx`: replace the `semanticModel` prop with `description`/`infoFuncName` primitives; **delete the hand-written comparator** (`DialogTreeItem.tsx:79-108`) — default shallow `memo` is now exact. Rows re-render only when their own row data changes.
- With §2.1 + this change, a keystroke in the action editor re-renders zero DialogTree rows unless the edited function changes the tree shape.

Size: **S–M**.

### 2.6 PF5 — ingestion flush guard + `getSemanticModel` in-flight dedup

**Flush guard (`startBackgroundIngestion`):**
- Add an abort check in the success path before `pendingUpdates.set` (`projectStore.ts:342`), mirroring the existing check in the `catch`.
- Make `flushUpdates` a no-op when `controller.signal.aborted` (covers both the interval and the `finally` flush) — pending entries from an aborted run are discarded, never written into a successor project's cache.
- Belt-and-braces for future call sites: capture `projectPath` at ingestion start and have `flushUpdates` drop the batch if `get().projectPath` differs (guards the "same controller not yet aborted but project swapped" window; `openProject` currently aborts first, but the invariant should not depend on caller ordering).

**In-flight dedup (`getSemanticModel`):**
- Store-closure `inFlight = new Map<string, Promise<SemanticModel>>()`. On call: return cached model; else return existing in-flight promise; else start the parse, register the promise, and `finally` remove it.
- Invalidation hooks: `invalidateCacheForFile`, `clearCache`, and `closeProject` must also drop the path's in-flight entry so a parse of stale content is not handed to post-mutation callers (`mutateQuestFile` invalidates then immediately re-parses — the dedup map must not return the pre-write parse).

Size: **S**.

### 2.7 QuestEditor/QuestFlow `parsedFiles` — boundary only

Owned by fix-04 (its step 7: `parseGeneration` bump in `projectStore` where `parsedFiles` is replaced, imperative `getState().parsedFiles` reads, defer `getQuestUsage` during ingestion). Slice 7's only obligations:
- If slice 7 lands first, implement the `parseGeneration: number` field (bumped in `flushUpdates`, `getSemanticModel`'s cache write, `updateFileModel`, `invalidateCacheForFile`, `clearCache`) so slice 4 can consume it — one field, no consumers changed here.
- Apply the same recipe to the **non-quest** `parsedFiles` subscribers this slice owns: App (item A — `.size`), ThreeColumnLayout (item C — `useNpcDialogErrors` gets its own selector over only the selected NPC's file entries, compared with `shallow`), IngestedFilesDialog (item E).

Size: **S**.

### 2.8 ActionCard stale-`semanticModel` memo (C3) — comparator strategy

The dilemma: the comparator ignores `semanticModel` *on purpose* — including its identity would re-render every mounted card per merge (i.e. per keystroke pause), which is the exact anti-pattern CLAUDE.md forbids. But ignoring it means memo-blocked cards render stale model data (`ChoiceRenderer`'s target-function badge/expansion) and hold stale callback closures.

Options:
- *(i) Add `semanticModel` identity to the comparator* — rejected: defeats the memo; 50-action functions would re-render 50 cards + autocomplete trees per keystroke.
- *(ii) Compare narrowed per-action model slices in the comparator* (e.g. resolve `functions[targetFunction]` for choices) — rejected: comparator must replicate every renderer's data needs per action type; silently rots.
- *(iii) Stop passing model-derived data through the memo boundary; make the comparator honest* — **chosen.** Props that remain on a memoized component must be its true render inputs:
  1. **Model data → store subscriptions at the leaf.** The only renderer that *reads* `semanticModel` (rest just forward it to `VariableAutocomplete`, which already self-subscribes via `useVariableOptions`) is `ChoiceRenderer` (`functions[targetFunction]`). Replace with a narrow subscription: `useProjectStore(s => s.mergedSemanticModel.functions[targetFunction])` in project mode / `useFileStore(s => ...openFiles.get(filePath)?.semanticModel.functions[targetFunction])` in single-file mode (a tiny `useResolvedFunction(name, filePath)` hook hides the mode split). The card re-renders only when *its* target function's reference changes — stale data eliminated without identity storms. Then remove `semanticModel` from `ActionCardProps`/`BaseActionRendererProps` threading (single-file mode: `VariableAutocomplete`'s optional local-model prop is likewise replaced by the same hook reading the active file's model).
  2. **Callbacks → stable by construction.** The owner (`ActionsList`/function editor) wraps each handler in a stable-identity function (existing ref pattern generalized: one `useStableHandlers(handlers)` helper returning permanently-stable wrappers that call `ref.current.*`). With all function props stable, the comparator's "ignore functions" shortcut becomes provably safe rather than accidentally load-bearing — and the stale-closure half of C3 (delete/add/move handlers) is fixed even for memo-blocked cards.
  3. The comparator then legitimately compares: `path` key, `index`, `totalActions`, `npcName`, `dialogContextName`, `filePath`, shallow `action` — unchanged code, now honest. Document the invariant ("all function props must be identity-stable; model data must not cross this boundary") on the comparator.

Coordinate with slice 5: fix-05 touches ActionCard's flush/registry (`fix-05` §2.3–2.4) — land 2.8 after or rebase onto it; the stable-handlers helper is also useful to ConditionCard there.

Size: **M–L** (touches `BaseActionRendererProps` and ~20 renderer files mechanically, plus the two hooks).

---

## 3. Measurement plan

The real MDK corpus is gitignored and cannot ship. Add a **synthetic fixture generator** instead:

- `daedalus-dialog-editor/scripts/generate-perf-fixture.js` — emits a project folder into a temp/gitignored dir: `N` dialog files × `M` dialogs each (default 200 × 15, one NPC per ~4 files → ~50 NPCs), each dialog with an info function of 8–15 mixed actions (AI_Output, choices, log entries), plus `Story_Globals.d` (~5,000 `var int`), `Text_Constants.d` (~15,000 `const string`), and ~2,000 item/NPC instances across a handful of instance files. Deterministic (seeded) so numbers are comparable across runs. Symbol counts mirror the Gothic 2 base game order of magnitude.
- Reuse it in three places:
  1. **Merge micro-benchmark (Node, informational):** a small script (`scripts/bench-merge.js` or a `test:perf`-tagged Jest file excluded from CI timing assertions) that loads the fixture's parsed models and times `mergeSemanticModels` full vs. category-stable rebuild, and `updateFileModel` end-to-end. Report numbers; do **not** assert wall-clock in CI (flaky) — assert *structural* facts instead (see §4).
  2. **React Profiler scenarios (manual, before/after evidence for the PR):** run `npm run dev` against the generated fixture; with React DevTools Profiler record: (a) select a large NPC, type 20 characters into a dialog line, stop — count commits and which components rendered (before: MainLayout/VariableAutocomplete×rows/DialogTree rows per flush; after: only the edited card's subtree); (b) open project and profile the ingestion window (before: App-rooted commits every 500 ms; after: only the progress indicator and IngestedFilesDialog-if-open); (c) open Variable Manager, then type in a dialog — VariableManager must not re-render. Attach profiler screenshots/flamegraph numbers to the PR.
  3. **Playwright sanity (optional, no timing asserts):** an E2E spec that opens the generated fixture and asserts the UI stays interactive during ingestion (types into the NPC filter and sees results within a generous timeout) — a smoke guard against re-introducing a main-thread storm, not a benchmark.

### What is a realistic Jest regression guard

Render-count and identity-stability assertions via @testing-library probes are reliable in jsdom (they count React commits, not time) and have in-repo precedent (`tests/useVariableOptions.subscription.test.tsx`, `tests/IngestedFilesDialog.rerender.test.tsx`) — use exactly that pattern. Wall-clock/timing assertions in Jest are **not** realistic (CI variance); anything speed-shaped stays in the manual profiler/bench scripts. Merge *work avoidance* is asserted structurally (identity reuse), which is the mechanism the speedup follows from.

---

## 4. Test plan (failing first where feasible)

Jest — write these before the corresponding fix; each fails on current code:

1. **§2.1 identity stability (`tests/projectStore.mergeIdentity.test.ts`):** seed `parsedFiles` with two models; `loadAndMergeNpcModels`; capture `mergedSemanticModel.constants`. Call `updateFileModel` with a model whose `constants`/`variables` refs are unchanged but `functions` ref is new (mimic an Immer edit). Assert: new `mergedSemanticModel` identity, `merged.constants`/`variables`/`instances` are `===` the previous objects, `merged.functions` is not, and `merged.functions` contains the update. Also: `closeProject` then re-open must not reuse stale cached categories.
2. **PF5a (`tests/projectStore.ingestionAbort.test.ts`):** mock `window.editorAPI.parseDialogFile` with a deferred promise; `startBackgroundIngestion`; abort (simulate `openProject` reset: new `parsedFiles` Map, new path); resolve the deferred parse; flush timers. Assert the new `parsedFiles` does **not** contain the old project's file. Fails today (finally-flush writes it).
3. **PF5b:** call `getSemanticModel(p)` twice synchronously → `parseDialogFile` called once, both callers get the same model. Then `invalidateCacheForFile(p)` while a parse is in flight → next `getSemanticModel(p)` triggers a fresh parse (dedup entry dropped). Fails today (two IPC calls).
4. **PF2 (`tests/DialogTree.rerender.test.tsx`):** render `DialogTree` with a model; capture per-row render counts (probe wrapper or spy on `DialogTreeItem`); re-render with a new model identity whose dialogs' `description`/`information` refs are unchanged → zero row re-renders. Fails today (itemData identity changes → Rows run; comparator saves `DialogTreeItem` but the test also asserts `itemData` no longer contains `semanticModel` — an API-shape assertion that fails pre-fix).
5. **§2.4 (`tests/VariableManager.rerender.test.tsx`):** render VariableManager; `act(() => useProjectStore.setState({ mergedSemanticModel: { ...prev } }))` with same `constants`/`variables` refs → component does not re-render / the memoized list identity is stable (probe pattern from `useVariableOptions.subscription.test.tsx`). Fails today (selector-less).
6. **N1 (`tests/useNavigation.subscription.test.tsx`):** probe component calling `useNavigation()`; mutate `mergedSemanticModel`, `openFiles`, and a uiSelection field → zero probe re-renders; the returned `navigateToDialog` identity is stable across mutations. Fails today on all counts.
7. **§2.2 spot checks:** one probe test per store family (e.g. MainLayout: flipping `isIngesting` or an unrelated project field does not re-render it; App: replacing `parsedFiles` with same `.size` does not re-render the toolbar probe). Keep to 3–4 representative tests, not all 24 — the pattern is mechanical and full coverage would be trivially-passing boilerplate.
8. **C3 (`tests/ActionCard.staleModel.test.tsx`):** render a Choice action row; update the store's `functions[targetFunction]` (action count changes) *without* changing the card's own props → the badge count updates. Fails today (memo-blocked stale `semanticModel`). Second assertion: with stable-handler wrappers, a swapped `deleteActionAtPath` implementation is picked up by a memo-blocked card's delete button.
9. **Behavioral non-regression:** existing suites already cover merge correctness (`mergeUpdatedQuestFileModels`, quest creation, navigation) — they must stay green; §2.1 must not change merge *results*, only identities.

Needs profiling instead of tests (be honest): the absolute merge cost (§3.1 bench, informational), ingestion-window smoothness, and the end-to-end "typing feels instant on a mod-scale project" claim (§3.2 profiler scenarios + the repo-mandated manual smoke pass). No Jest test can honestly assert those.

---

## 5. Ordering, dependencies, risks, sizes

| Step | Fix | Size | Depends on |
|---|---|---|---|
| 1 | PF5 flush guard + in-flight dedup (§2.6) + `parseGeneration` field if slice 4 hasn't landed it | S | — |
| 2 | Category-stable merge + `globalFiles` memo (§2.1) | M | — |
| 3 | `useNavigation` imperative rewrite (§2.3) | S–M | — (biggest single fan-out win; can land before 2) |
| 4 | Selector checklist items 1–24, A–C, E (§2.2, §2.7) | M (batched) | 2 (for the `mergedSemanticModel.<cat>` selectors to pay off) |
| 5 | VariableManager + useVariableOptions category deps (§2.4) | S | 2 |
| 6 | DialogTree itemData narrowing (§2.5) | S–M | — (independent; better after 2) |
| 7 | ActionCard C3 honest-comparator refactor (§2.8) | M–L | 3 (leaf subscriptions), coordinate with slice 5's ActionCard changes |
| 8 | Fixture generator + bench script + profiler evidence + docs (§3; extract the "stable sub-properties / per-category selector" contract into `docs/architecture/`, delete this plan) | M | 1–7 |

Risks:
- **Category-identity cache correctness** — the signature cache must be invalidated on `closeProject`/`clearCache` and must key on the *ordered input list* (NPC switch changes the file set even when no model changed). Covered by test 1's re-open assertion; keep the cache inside the store closure next to the merge so the coupling is visible.
- **Consumers accidentally relying on whole-model identity churn** — e.g. a memo that today recomputes per merge and happens to pick up unrelated changes. Mitigation: tests 4/5/8 assert the new behavior explicitly; run the full Jest suite (675 tests) after step 2 before any consumer migration, isolating merge-identity fallout from selector fallout.
- **`getState()`-in-callback conversions** can hide a genuine reactive need (a component that *should* re-render when `activeFile` changes). Rule applied in the checklist: values read during render stay reactive (per-field selector); values read only inside event handlers move to `getState()`. Each conversion reviewed against that rule.
- **Slice collisions:** slice 4 (QuestFlow/QuestEditor files, `parseGeneration`), slice 5 (ActionCard flush registry). Sequencing: land step 1's `parseGeneration` early and tell slice 4; do step 7 after slice 5's ActionCard patch or rebase.
- **Single-file mode** paths (no project) must keep working where props are replaced by store reads (§2.8's `useResolvedFunction` mode split); covered by running the existing single-file-mode suites.
