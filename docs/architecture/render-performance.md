# Render Performance at Mod Scale

Durable decisions from remediation slice 7 (fix-07, 2026-07-03). This covers the
editing hot path on mod-scale projects (tens of thousands of symbols): how the
merged semantic model stays cheap to recompute, which store subscriptions are
allowed to react to it, and the memo boundary that keeps model data out of
per-action render churn.

This is the concrete application of CLAUDE.md's editor performance rule —
*"`semanticModel` is large and recreated frequently; do not pass the full object
to deeply memoized components; prefer stable sub-properties and granular
comparisons with `React.memo`."*

## The hot path

Every visual edit flows: ActionCard 300 ms debounce → `historyActions` →
`fileStore.updateModel` (Immer) → `storeSync` subscription →
`projectStore.updateFileModel` → `loadAndMergeNpcModels` →
`mergeSemanticModels` → new `mergedSemanticModel`. On a mod-scale project the
merge inputs are the globals (thousands of constants/variables) plus the selected
NPC's files, so a naive full rebuild is O(all symbols) *per keystroke pause* and
hands every subscriber a fresh model identity.

## Flush dirty-guard

The cascade above must only fire when there is actually something to write.
`ActionCard`'s three flush paths — `flushUpdate` (invoked unconditionally on
Enter/Tab/Ctrl+Enter), the 300 ms debounce timer body, and the pending-edit
registry flusher — all skip the store write when
`shallowEqual(localActionRef.current, actionRef.current)`, the same guard the
unmount cleanup always used. Net effect: Ctrl+Enter/Tab on a clean card costs
zero store writes (the menu/focus behavior is unaffected), and Enter pays one
cascade instead of two when the line text is already synced. The timer body and
the registry flusher stay byte-identical (flush contract in
[save-pipeline.md](./save-pipeline.md)); the guard is part of that shared body.
Guarded by `tests/ActionCard.flushDirtyGuard.test.tsx`.

## Category-stable merge contract

`mergeSemanticModels` (`src/renderer/store/projectStore.ts`) merges exactly these
eight categories (`MERGE_CATEGORY_KEYS`), mirroring the historical set — it does
**not** merge classes/prototypes/declarationOrder/trailingComments:

```
dialogs, functions, constants, variables, instances, items, npcs, animations
```

Because `fileStore` mutations go through Immer, an action edit produces a model
where only `functions` (and sometimes `dialogs`) have new references; the other
six categories keep their refs. The merge exploits this with a **per-category
signature cache** held in the store closure:

- For each category, the *input signature* is the ordered array of that
  category's map references across the contributing input models.
- If a category's signature is unchanged (same length, all refs `===`), the
  **previous merged category object is reused verbatim** — no rebuild, identity
  preserved.
- Otherwise only that category is rebuilt (`Object.assign` over its inputs).
- `mergedSemanticModel` takes a **new top-level identity** whenever any category
  changed — `dialogs`/`functions` consumers must react — but untouched categories
  are referentially stable across merges.
- **No-op merge identity rule:** when *every* merged category is referentially
  identical to the current store model's category and the aggregate error state
  is unchanged, `mergeSemanticModels` returns **without calling `set()`** — the
  previous top-level object keeps its identity and whole-model subscribers do
  not wake at all. The comparison is against `get().mergedSemanticModel` (not a
  tracked closure ref) so it stays correct across `clearMergedModel`. Guarded by
  `tests/projectStore.mergeIdentity.test.ts`.

Result: the keystroke merge drops from O(all symbols) to O(dialogs+functions in
scope), and every `useMemo` keyed on `constants`/`variables`/`instances` stops
recomputing on unrelated edits.

**Reset points (mandatory).** The signature cache is store-closure state and
**must** be cleared (`resetMergeCache`) on `closeProject` and `clearCache`, or a
reopened project could reuse a previous project's category objects. The cache
lives next to the merge so the coupling is visible.

**Composition.** `loadQuestData` / `mergeUpdatedQuestFileModels` pass
`[currentMerged, ...updates]`; the previous merged categories are themselves refs
in the signature, so the cache composes with those callers unchanged.

**N2 companion.** `loadAndMergeNpcModels`' files-with-dialogs set is O(project) to
build; it is memoized per `dialogIndex` identity (`WeakMap`), so it is not rebuilt
per edit flush.

**Escalation path (documented, not built).** If profiling ever shows the
`functions` category rebuild itself hot (it is O(all functions in scope) per
flush), add per-file contribution maps with a collision-count fallback. Not
expected: a single `Object.assign` pass over even 50k entries is single-digit
milliseconds. Per-symbol contribution tracking was rejected as the primary fix
because last-wins merge semantics make case-drift collisions (real in mod
corpora) correctness-sensitive. Same measure-first status applies to
`updateFileModels`' per-flush O(project) bookkeeping (`parsedFiles` Map clone,
one `dialogIndex` scan; the former second scan now hits the memoized
`getFilesWithDialogs`) and Enter's O(dialog functions) line-id scan
(`collectAllDialogLineActionsFromModel`) — likely single-digit ms; profile
against the perf fixture before touching either.

## Per-category selector rule

Consumers of merged model data subscribe to the specific category, not the whole
model: `useProjectStore(s => s.mergedSemanticModel.<category>)`. Whole-model
identity churns *by design* on every content edit; only category selectors stay
stable across unrelated edits, which is what makes the merge's identity
preservation observable. `VariableManager` (`constants`/`variables`) and
`useVariableOptions` (per-category deps) follow this rule; their sort+rebuild
memos now run only when the relevant category actually changes.
`useVariableOptions` additionally hoists the candidate-pool build itself out of
per-field memos into a module-level cache — see *Dialog-open latency* below.

## Subscription rules

Zustand actions are stable references; whole-state `useXStore()` subscriptions
re-render on *any* store change and are the default hazard. The rule applied
across the renderer:

- **Values read during render** → per-field selectors
  (`useEditorStore(s => s.openFiles.get(filePath))`), so the component reacts only
  to the field it uses.
- **Values read only inside event handlers** → `getState()` at call time, no
  subscription. Action-only consumers become non-reactive by construction.
- **Coarse-identity selectors** (a selector exists but the value churns) are
  narrowed to what is actually read: App selects `parsedFiles.size` and
  `canUndo`/`canRedo` booleans, not the whole `parsedFiles` Map or `editHistory`;
  `IngestedFilesDialog` gates its `parsedFiles` selector on `open`.
- **No whole-model subscriptions in the dialog-editing path.** `MainLayout`
  gates its merged-model selector on the active view (`null` while
  `view === 'dialog'` — the model is only threaded to the quest/variable
  panels). `ThreeColumnLayout` selects the `dialogs`/`functions` categories and
  reassembles a memoized model for its children, so unrelated-category churn
  and no-op merges never reach it and its `deleteDialogInfo`/
  `renameFunctionEntries`/`dialogsForNPC` memos are keyed on the categories,
  not whole-model identity. `InlineChoiceEditor` likewise subscribes to the two
  categories `useActionManagement` actually needs (`dialogs` + `functions` —
  not a single resolved function: sibling collection, unique-name generation
  and item seeding read across both maps). `RegisterTopicDialog` gates its
  model selector on `open` (the `IngestedFilesDialog` idiom). Render-count
  probes live in the respective component test files.

**Navigation-hook template.** `useNavigation` / `useDialogNavigation` are pure
event-handler hooks: they hold **no store subscriptions** and read
`useProjectStore.getState()` / `useFileStore.getState()` /
`useUISelectionStore.getState()` inside their callbacks, which are
`useCallback(..., [])` — permanently stable. This matters because `useNavigation`
is consumed by `VariableAutocomplete` and `ReferenceLink`, i.e. by every
autocomplete leaf in every mounted action/condition renderer; a subscription
there would re-render every leaf on every merge, bypassing ActionCard's memo (N1).
Deviation: `useDialogNavigation` keeps a single reactive `activeFile` per-field
selector because it is read during render.

## Memo-boundary invariant

`ActionCard` is `React.memo`-wrapped with a hand-written comparator. The
invariant, documented on the comparator itself:

> **All function props must be identity-stable; model data must not cross this
> boundary.**

Two mechanisms uphold it:

- **Model data → leaf subscriptions.** No renderer receives model-derived data
  through the memo boundary. The only renderer that *reads* the model
  (`ChoiceRenderer`, for a target-function badge) uses `useResolvedFunction(name,
  filePath)` — a file-store-first, merged-fallback hook that subscribes to a
  *single function reference*, so the card re-renders only when its own target
  function changes. `semanticModel` was removed from `ActionCardProps` /
  `BaseActionRendererProps` and ~16 renderers.
- **Callbacks → stable by construction.** `useStableHandlers(handlers)` returns
  wrappers whose identity is fixed for the component's lifetime (calling through a
  ref to the latest implementation), applied at the non-memoized owners
  (`DialogActionsSection`, `InlineChoiceEditor`). The comparator's "ignore
  functions" shortcut is thereby provably safe rather than accidentally
  load-bearing — and stale delete/add/move closures are fixed even for
  memo-blocked cards. A handler that is `undefined` stays `undefined` (presence is
  a genuine render input); the wrapper set's identity changes only when the set of
  defined keys changes.

Deviation: `VariableAutocomplete` **keeps** its `semanticModel` prop — it serves
quest-inspector and condition callers that pass a *different* model. Single-file
dialog mode folds the active file's own symbols into autocomplete via
`useVariableOptions`' per-category active-file reads (a deduped, benign superset).

**`VariableAutocomplete` call-site contract.** The leaf itself is
`React.memo`-wrapped, and that memo only holds if every call site passes
identity-stable props: static `sx` objects are hoisted to module-level consts
and `onChange`/`onFlush`/`onKeyDown` handlers are `useCallback`-wrapped with
complete deps (or module-level no-ops). All call sites (action renderers,
condition fields, `DialogPropertiesSection`, `QuestInspectorPanel`) follow
this; new call sites must too — an inline `sx={{…}}` or `onChange={(v) => …}`
silently defeats the memo. Render-probe precedent:
`tests/SetVariableActionRenderer.rerender.test.tsx`.

## Project open: single parse per file (P0, 2026-08-23)

Project open used to parse every `.d` file twice: `ProjectService.buildProjectIndex`
full-parsed each file in the metadata worker pool and discarded the model, then
`startBackgroundIngestion` re-parsed every file through the parser worker pool.
The metadata pass additionally walked top-level declarations twice per file
(instances and prototypes each called `extractDeclarations`). Fixed as:

- **Single declaration walk.** `semanticMetadataUtils.extractInstanceAndPrototypeDeclarations`
  calls `extractDeclarations` once and partitions the result. Guarded by
  `tests/ProjectService.modelHandoff.test.ts` (call-count assertion).
- **Model hand-off cache (main process).** The metadata worker already builds
  the full semantic model; it now returns it (plus the file's `mtimeMs`,
  stat'ed *before* the content read so any racing write invalidates the entry).
  `ProjectService` primes a `path → {mtimeMs, model}` map (cap 512 entries,
  oldest dropped; cleared on reindex), and the `project:parseDialogFile` IPC
  handler serves from it via `takeParsedModel` before falling back to
  `FileService.readFile` + `ParserService.parseSource`. Background ingestion is
  therefore a cache read, not a second parse.
- **Take semantics.** `takeParsedModel` removes the entry when served (and on
  mtime mismatch), so the main process does not duplicate the renderer's model
  cache at steady state. A second request for the same unchanged file re-parses
  — that was the status quo for every request before this change.
- **Error files are never primed** (`ParsedFileMetadata.semanticModel` is only
  set for clean, fully-linked parses): `parser.worker` returns an errors-only
  model without running the visitor passes, while the metadata pass builds a
  partial model even on errors — the parse path stays authoritative for the
  error shape.

## parsedFiles cap (P0, 2026-08-23)

`projectStore.parsedFiles` previously grew without bound — `clearCache`/
`clearMergedModel` had no external callers and only `closeProject` shrank it.
It is now capped at `PARSED_FILES_CAP` (512) entries:

- **Pinned (never evicted): the merged-model contributors** that
  `loadAndMergeNpcModels`/`loadQuestData` read from the cache — global
  (dialog-less) files in `allDialogFiles`, the selected NPC's dialog files, and
  quest files.
- **Eviction order**: least-recently-touched first. Recency lives in a
  store-closure map (`touchParsedFile`) updated on every cache write *and* on
  `getSemanticModel` cache hits, so reads refresh recency without churning
  store state. Reset on `openProject`/`clearCache`/`closeProject`.
- **Self-healing**: NPC selection always runs `getSemanticModel` over the
  NPC's files before merging (`useNavigation`/`useDialogNavigation`), so an
  evicted file is transparently re-parsed on demand.
- **Documented degradation**: on projects larger than the cap, whole-corpus
  consumers (Problems panel scan, `getQuestUsage`) see at most
  `PARSED_FILES_CAP` files.

Guarded by `tests/projectStore.parsedFilesCap.test.ts`.

## File-watcher change batching (P0, 2026-08-23)

Every `fileWatcher:changed` event used to trigger an immediate re-parse plus a
full `updateFileModel` cascade (Map clone, two `dialogIndex` scans, re-merge) —
a `git checkout` touching 500 files fired 500 unbatched O(project) cascades
with no concurrency cap. Now:

- **`useFileWatcher` buffers 'change' events** for `CHANGE_BATCH_WINDOW_MS`
  (250 ms), deduped by path. Open-file handling (conflict vs. reload) is
  decided per file *at flush time*; background files are re-parsed with
  bounded concurrency (8) and applied in one batch. An 'add'/'unlink' for a
  buffered path drops the queued change (the add parses anyway; the unlink
  must not resurrect the file). Buffered changes are discarded on unmount /
  project switch.
- **`projectStore.updateFileModels(updates)`** applies the whole batch with a
  single `parsedFiles` clone, a single dialog-set change scan (index rebuilt
  once, only for files whose `(dialogName, npc)` set changed — the
  `dialogSetChanged` guard survives batching), one `parseGeneration` bump, and
  at most one `loadAndMergeNpcModels` re-merge (skipped when no updated file
  participates in the selected NPC's model). Untouched cache entries and an
  unchanged `dialogIndex` keep their identities. It also uses the
  WeakMap-memoized `getFilesWithDialogs` instead of the former inline
  O(project) rebuild. `updateFileModel` (storeSync's per-edit-flush entry
  point) delegates with a single entry — the keystroke path is unchanged.

Guarded by `tests/useFileWatcher.batching.test.ts` (N events → one parse per
unique path, one cascade, one merge) and
`tests/projectStore.updateFileModels.test.ts`.

## PF5 ingestion / parse guards

**Ingestion abort + flush contract** (`startBackgroundIngestion`): the run
captures `ingestionProjectPath` and a `controller`. Every post-`await` success
path re-checks `controller.signal.aborted` before writing to `pendingUpdates`, and
`flushUpdates` discards the whole batch when
`controller.signal.aborted || get().projectPath !== ingestionProjectPath`. This
closes the aborted-run bleed: a previous project's final `finally` flush can no
longer merge stale entries into the successor project's cache. The project-path
check is belt-and-braces so the invariant does not depend on caller abort
ordering.

**In-flight parse dedup** (`getSemanticModel`): concurrent callers for the same
path share one IPC parse via a store-closure `inFlight` map (cached model → return
it; existing in-flight promise → return it; else parse, register, `finally`
remove). Invalidation must drop the path's in-flight entry so a stale parse is
never handed to a post-mutation caller: `invalidateCacheForFile`, `clearCache`,
and `closeProject` all clear `inFlight` (the read-modify-write-invalidate-reparse
sequence in `mutateQuestFile` depends on this).

**`parseGeneration`.** A monotonic counter bumped wherever `parsedFiles` is
replaced (`flushUpdates`, `getSemanticModel` cache write, `updateFileModel`,
`invalidateCacheForFile`, `clearCache`, `closeProject`). Ingestion-time
subscribers watch `parseGeneration`, not `parsedFiles` identity, so the
500 ms-flush render storm is bounded (consumed by the quest editor, slice 4).

## Dialog-open latency (dialog-click hot path)

Durable decisions from the dialog-open-latency work (2026-07-05). Clicking a
dialog in the list used to cost 1–2 s even on a fully-indexed project: two
independent costs stacked on every click. Fixed in three independent slices.

### Click-open reuses both caches (no re-parse on click)

`useDialogNavigation` (`handleSelectDialog` / `handleSelectRecentDialog`) no
longer re-parses on selection:

- **Already-open file** → `fileStore.setActiveFile(path)` (focus without a disk
  read or parse), never `openFile`. This also closes a latent data-loss bug:
  `openFile` on an already-open **dirty** file re-read disk and reset
  `isDirty`/`originalCode`, silently discarding edits still inside the auto-save
  debounce window; `setActiveFile` preserves the `FileState`.
- **Not-yet-open file** → reuse the `projectStore` cached model. `openFile`
  takes an optional `openFile(path, { model })`: it still does the `readFile`
  IPC (so `originalCode` is disk-true) but **skips `parseSource`**, running
  `ensureActionIds` on the supplied model instead. The caller passes the
  `getSemanticModel(path)` result (a `parsedFiles` cache hit after the NPC's
  files were parsed at NPC-select time), and **omits the model when it
  `hasErrors`** so the error-recovery parse path is unchanged. `ensureActionIds`
  is copy-on-write, so applying it to the shared cache object is safe.

Staleness is bounded by the same `FileWatcherService` invalidation the rest of
the app already trusts. Net: the first click after selecting an NPC no longer
re-parses a just-parsed file, and repeat cross-NPC clicks cost one `readFile`
instead of a full tree-sitter + two-pass parse every time.

### Editor stays mounted across dialog switches

`useDialogTransition` previously marked `isLoadingDialog`, unmounted the whole
editor to a spinner shell, then remounted it two RAFs later in a synchronous
high-priority render — paying the full `useVariableOptions` + MUI mount cost on
every click. It now uses `useTransition`:

- `finalizeDialogSelection` clears the async-open flag and commits the
  dialog/function selection inside `startTransition`; `isLoadingDialog =
  isPending || asyncOpenFlag`. The previously-committed selection keeps
  rendering until the new one is ready, and `isPending` is race-free by
  construction — two rapid finalize calls resolve to the latest selection, so
  the old RAF cancellation/`transitionId` guard is deleted.
- `EditorPane` keeps `DialogDetailsEditor` **mounted** (no `key={dialog}` —
  reconciliation updates in place; action cards are already keyed by stable
  action ids) and draws an absolutely-positioned, theme-aware spinner **overlay**
  while loading instead of returning a spinner shell. Placeholder branches (no
  dialog / missing function) are unchanged.
- Because the editor no longer remounts, per-dialog UI state that mounting used
  to reset for free is reset **explicitly** via an effect keyed on `dialogName`
  (`propertiesExpanded`, `sourceViewOpen`, `snackbar`, `validationDialog`);
  transient in-flight flags (`isSaving`/`isResetting`) are intentionally left
  alone. Scroll-to-top is an effect keyed on the committed selection.

The rapid-switch race the RAF guard used to cover is now guarded by
`tests/e2e/dialog-rapid-switch.spec.ts`.

### Shared autocomplete option pool

Assembling the full candidate list from ~11k project symbols and
`localeCompare`-sorting it used to happen inside **every** mounted
`VariableAutocomplete` field's own `useMemo` (28 call sites, 6–20 ms/field). The
assembly is identical for every field reading the same project + active-file
state, so it is hoisted into module-level caches built once per source-identity
change and reused by all fields. Each field then only filters + dedups the
(small) survivor set.

**Per-category sub-pool cache contract.** The pool is not one cache keyed on
all sources (that signature made *any* edit — always a `functions` churn —
rebuild the whole ~11k-symbol pool per keystroke pause). `buildOptionPool`
assembles the `OptionPool` from five independently cached sub-pools, each keyed
**only on the refs it derives from**:

- constants ← `localConstants`, `projectConstants`
- variables ← `localVariables`, `projectVariables`
- instances ← local/project `instances`, `npcs`, `animations`
- functions ← local/project `functions`, `routineList`
- dialogs ← `dialogIndex`, `npcList`

An action edit (functions-only churn) rebuilds only the functions sub-pool;
the other four keep `===` identity, and `buildOptionPool` keeps the top-level
pool identity when every sub-pool is unchanged. Guarded by
`tests/useVariableOptions.pool.test.tsx`.

**Gated functions subscriptions.** Fields whose policy config has neither
`showFunctions` nor `showRoutines` select `null` instead of
`mergedSemanticModel.functions` (and the file-store local functions), so they
never wake on functions churn at all — per edit flush, only
functions-consuming fields re-derive. Load-bearing constraint: the
`showFunctions`/`showRoutines` flags must be render-stable per mounted field
(they come from module-level `autocompletePolicies.ts`) because they gate hook
subscriptions. Gated fields short-circuit to a shared empty functions sub-pool
rather than passing `null` through the shared cache, so they cannot evict the
real functions sub-pool built by ungated fields. Guarded by
`tests/useVariableOptions.subscription.test.tsx`.

**Parity invariant (load-bearing):** the pool must **not** dedup by name — name
shadowing applies only to entries that pass a field's `typeFilter`/`namePrefix`/
`show*` gating, so a same-named entry excluded by a filter must not shadow a
later matching one. The pool keeps every same-named candidate in source-priority
order (constant → variable → instance → dialog; within each, local before
project); dedup happens only in the per-field pass via a fresh `seenNames`. The
optional per-field caller `semanticModel` is folded into the per-field pass (not
the shared pool) so the pool stays reusable across fields whose models differ.

## Dev-harness overhead

Dev-mode feel is ~2× worse than production by construction and that is
accepted: `StrictMode` stays (it is a correctness tool; it double-invokes
renders in dev), and the auto-opened DevTools used to add uniform overhead on
top. DevTools no longer auto-open on dev launch — set `DEVTOOLS=1` to get the
old behavior (`src/main/main.ts`). Judge latency in a packaged/production
build before reaching for further fixes.

**Monaco stays on the jsdelivr CDN (decision, 2026-07-12).** Bundling
`monaco-editor` locally via `loader.config({ monaco })` was implemented and
reverted: the static import grows the renderer entry chunk from ~374 kB to
~4.2 MB, tripping CI's chunk-size warning guard. Landing it requires either
`React.lazy` code-splitting of the two editor call sites
(`SourceCodeEditor.tsx`, `DialogSourceViewDialog.tsx` via `MainLayout.tsx` /
`DialogDetailsEditor.tsx`) or a `vite.config.ts` `manualChunks` entry plus a
warning-limit change — a deliberate trade-off against the guard, not a
mechanical fix. Until then, first Monaco open needs network and can stall for
seconds.

## Measurement tooling

The real MDK corpus is gitignored and cannot ship, so performance is measured
against a synthetic fixture:

- **`scripts/generate-perf-fixture.js`** — deterministic (seeded PRNG; no
  `Date.now`/`Math.random` in emitted content) project generator. Default profile
  mirrors Gothic 2 order of magnitude: 200 dialog files × 15 dialogs (one NPC per
  ~4 files → ~50 NPCs), 8–15 mixed actions per info function, `Story_Globals.d`
  (~5k `var int`), `Text_Constants.d` (~15k `const string`), ~2k item/NPC
  instances. Same seed + args ⇒ byte-identical output. Output defaults to the
  gitignored `perf-fixtures/`. Run: `npm run perf:fixture -- --files 200 --out
  <dir>` (or smaller `--files` for a quick parseable sample).
- **`scripts/bench-merge.js`** — informational micro-bench (never CI-wired, asserts
  nothing). Parses the fixture via the `daedalus-parser` package and times the
  editing hot path under full-rebuild vs category-stable merge. It re-implements
  both strategies locally (the renderer TS store cannot load from Node), mirroring
  `mergeSemanticModels` exactly. Run: `npm run perf:bench -- --dir <dir>`. On a
  20-file sample it already shows ~10× per-merge and six of eight categories
  reused by identity; the gap widens on the full profile where const/var copying
  dominates the full rebuild.

**Jest regression guards** assert *structure*, not wall-clock (CI variance):
identity-stability and render-count probes (precedent:
`tests/useVariableOptions.subscription.test.tsx`,
`tests/IngestedFilesDialog.rerender.test.tsx`). Merge work-avoidance is asserted
as category-identity reuse — the mechanism the speedup follows from.

**Manual profiler scenarios** remain a checklist (no honest automated form): with
React DevTools Profiler against the generated fixture, (a) type 20 characters into
a dialog line on a large NPC → only the edited card's subtree commits; (b) profile
the ingestion window → no App-rooted commits per 500 ms flush; (c) open Variable
Manager, then type in a dialog → VariableManager does not re-render. From the
interaction-latency work: (d) Ctrl+Enter on a clean card → no store write, menu
opens <100 ms; (e) Enter on a typed line → one cascade, not two; (f) typing with
pauses → no whole-layout commits, only functions-consuming autocomplete fields
re-derive; (g) dialog switch on a large NPC stays fluid. These are the
before/after evidence attached to the PR, plus the repo-mandated desktop smoke
pass (type, Enter, Ctrl+Enter, switch dialogs, undo/redo, drag-reorder, save).
