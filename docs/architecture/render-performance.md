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
- `mergedSemanticModel` itself always takes a **new top-level identity** whenever
  any category changed — `dialogs`/`functions` consumers must react — but
  untouched categories are referentially stable across merges.

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
corpora) correctness-sensitive.

## Per-category selector rule

Consumers of merged model data subscribe to the specific category, not the whole
model: `useProjectStore(s => s.mergedSemanticModel.<category>)`. Whole-model
identity churns *by design* on every content edit; only category selectors stay
stable across unrelated edits, which is what makes the merge's identity
preservation observable. `VariableManager` (`constants`/`variables`) and
`useVariableOptions` (per-category deps) follow this rule; their sort+rebuild
memos now run only when the relevant category actually changes.

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
Manager, then type in a dialog → VariableManager does not re-render. These are the
before/after evidence attached to the PR, plus the repo-mandated desktop smoke
pass.
