# Editor review — 2026-11-01, slice 2: project load and the merged model

Slice: `src/main/services/ProjectService.ts`, `ProjectConfigService.ts`,
`ParserService.ts`, `MetadataWorkerPool.ts`, `ForkedWorker.ts`,
`workerPoolSize.ts`, `src/main/utils/` (`semanticMetadataUtils.ts`, `lruMap.ts`,
`pathKey.ts`, `encodingUtils.ts`), `src/renderer/store/projectStore.ts`, plus the
two callers that decide what reaches them (`src/renderer/hooks/useFileWatcher.ts`
for the incremental path, `src/main/main.ts` for the two IPC handlers).

Commit reviewed: `cff7c5a`. Date: 2026-11-01.

**Load assumed.** Project open over an 890-file mod (the Beppo corpus) and a
1,725-file one (the MDK tree), one index build per open at a worker count of
`min(cores - 1, 8)`, then background ingestion of every file at concurrency 20,
then a save re-parse per file, then a `git checkout`-sized external batch through
the watcher, and the renderer reading the merged model while the user types.
Judged against that: nothing here is per-keystroke, so the per-parse costs are
suggestions; the things that break at this size are the ones that make one file
answer twice, make the cache stop bounding itself, and leave a derived view stale
for the rest of the session.

**What this slice does.** `openProject` resolves a project descriptor, asks main
to scan the scripts root and index every `.d` file in a per-build worker pool,
adopts the resulting `ProjectIndex` as a set of flat maps (NPC → file, NPC →
dialogs, sites, error lists), and then starts a background ingestion that reads
each file's full semantic model into `parsedFiles`. The index pass primes the
models it already built so that ingestion is a cache read, not a second parse.
While the user works, a watcher batch replaces one file's model and its share of
the index, and the merged model — globals plus the selected NPC's files — is
re-derived on every such edit.

Checks run: the focused suites `tests/services/MetadataWorkerPool.test.ts`,
`tests/services/ParserService.test.ts`, `tests/services/workerPool.count.test.ts`,
`tests/ProjectService.test.ts`, `tests/ProjectService.modelHandoff.test.ts`,
`tests/mainLazyParserPool.test.ts`, `tests/projectStore.reindexRoutines.test.ts`,
`tests/projectStore.parsedFilesCap.test.ts`,
`tests/projectStore.updateFileModels.test.ts`, `tests/projectStore.mergeIdentity.test.ts`,
`tests/projectStore.incrementalMerge.test.ts`, `tests/projectStore.staleCacheWrite.test.ts`
and `tests/ingestion.test.ts` (126 tests, all pass). Findings 1–6 are reproduced,
not inferred: 1 by running the real parser and `buildProjectIndex` over a
two-file project in a scratch folder, 2–5 by driving the real store under `tsx`,
and 6 by scanning one small tree three times. No repo file was edited except this
report.

## What already holds, and the test that would fail if it broke

| Rule | Test |
|---|---|
| the index pass's models are handed to ingestion instead of re-parsed, at most once each, and not when the file moved on disk | `tests/ProjectService.modelHandoff.test.ts:115`, `:139`, `:149`, `:162` |
| a reindex drops the previous build's primed models | `tests/ProjectService.modelHandoff.test.ts:173` |
| concurrent reads of one path share a single parse | `tests/projectStore.getSemanticModelDedup.test.ts:33`, `tests/projectStore.raceCondition.test.ts:10` |
| a disk parse that resolves after an edit, a `clearCache` or a `closeProject` never lands in the cache | `tests/projectStore.staleCacheWrite.test.ts:43`, `:53`, `:66` |
| an aborted ingestion's final flush cannot write into the successor project | `tests/projectStore.ingestionAbort.test.ts:27` |
| one watcher batch is one `parsedFiles` clone, one generation bump and at most one re-merge | `tests/projectStore.updateFileModels.test.ts:36`, `:63`, `:104` |
| a file's share of the site index is replaced, its neighbours' kept, and an unreadable file keeps what it had | `tests/projectStore.reindexRoutines.test.ts:52`, `:153` |
| a removed file's sites, NPC mappings and routine variants are forgotten | `tests/projectStore.reindexRoutines.test.ts:169` |
| a merge rebuilds only the categories whose inputs changed, and a no-op merge keeps the model identity | `tests/projectStore.mergeIdentity.test.ts:28`, `:79` |
| editing a global file re-merges the selected NPC's model; an unrelated file does not | `tests/projectStore.incrementalMerge.test.ts:70`, `:44` |
| a worker that dies mid-task, dies cleanly, or times out settles its file and the pool drains | `tests/services/MetadataWorkerPool.test.ts:93`, `:102`, `:143` |
| past the restart cap every remaining task rejects, so the open fails visibly | `tests/services/MetadataWorkerPool.test.ts:185` |
| `ParserService` dispatches to an idle worker instead of queueing behind a busy one | `tests/services/ParserService.test.ts` |
| both pools compute their size with one rule | `tests/services/workerPool.count.test.ts` |
| the parser pool is not spawned until something parses | `tests/mainLazyParserPool.test.ts` |
| the descriptor's own validation, atomic write and migration | `tests/ProjectConfigService.test.ts`, `tests/projectConfigIpc.test.ts` |

The cache cap holds only while something is evictable — see finding 3.

## Must fix

1. **One NPC, two spellings, two index entries** (`daedalus-dialog-editor/src/main/services/ProjectService.ts:255`, `:258`, `:264`, `:268`; the incremental half at `src/renderer/store/projectStore.ts:1317-1321` and `:1397-1401`)
   - **What this is:** the index keys an NPC by the exact text it read: an `instance` declaration contributes `instance.name`, and each `C_INFO`'s `npc = …` contributes that property's value. Both go into `allNpcs`, and `dialogsByNpc` is keyed by the same raw text.
   - **Problem:** Daedalus is case-insensitive, and every other lookup in the suite normalises (`parser-fidelity.md`, "Case-insensitive references"; `normalizeIdentifier` in this same file). This one does not. Reproduced over a two-file project — `instance NPC_Onar(C_NPC)` in `NPC/Onar.d`, `npc = NPC_ONAR;` in `DIA/DIA_Onar.d` — `buildProjectIndex` returns `npcs: ['NPC_ONAR', 'NPC_Onar']`, two `dialogIndex` keys, and `npcFiles: { NPC_ONAR: …/Onar.d }`. In the NPC list that is two rows, both editable, both resolved through `npcFileIndex[npc.toUpperCase()]` to the same file (`NpcColumn.tsx:146`), and only one of them carrying the dialogs; clicking the other shows an empty dialog list and "Add dialog" plans a brand-new `DIA_NPC_Onar.d` in the project root instead of the NPC's own dialog file (`useDialogFactory.ts:63`). The same split is produced by the watcher, which rebuilds the key from `dialog.properties.npc` verbatim.
   - **What the user loses:** the NPC appears twice, half of it empty; a new dialog for it can land in a file nobody expected, next to the file that already holds that NPC's dialogs.
   - **Test that does not exist:** an index over a project whose dialog names its NPC in another case yields one NPC row and one `dialogIndex` key, with the dialog attached to it.
   - **Minimal fix:** key `dialogsByNpc`/`allNpcs`/`dialogIndex` on `normalizeIdentifier(npc)` and dedupe `npcList` case-insensitively (keep the spelling that has a declaring file); then upper-case at the `dialogIndex.get(...)` sites — `ThreeColumnLayout.tsx:166`, `NpcColumn.tsx:117`, `useDialogFactory.ts:63`, `:80`, `useNpcDialogErrors.ts:36`, `useDialogNavigation.ts:67`, `:120`, `:153`, `projectStore.ts:1210`, `:1382`, `getSelectedNpcDialogs`. `DialogMetadata.npc` keeps its source spelling, so nothing displayed changes.
   - **If we skip it:** a spelling the Gothic compiler accepts silently splits one NPC into two rows, and the fix has to be made in two places later instead of one.

2. **The merged model is never re-derived while ingestion fills the cache** (`src/renderer/store/projectStore.ts:755-774`, against the re-merge every edit gets at `:1379-1391`)
   - **What this is:** the merged model is "globals plus the selected NPC's files", read out of `parsedFiles`. It is rebuilt on selection, on a dialog creation, and on every `updateFileModels` batch. `flushUpdates` — the 500 ms ingestion flush — only writes `parsedFiles` and bumps `parseGeneration`.
   - **Problem:** during an 890-file ingestion the cache fills over tens of seconds, and a global file (`Story_Globals.d`, any file with no `C_INFO`) is ingested in scan order, not first — `priorityFiles` is quest files only (`:749`). Select an NPC before its project's globals have been read and the merge has nothing to include; when they arrive nothing re-merges. Reproduced: with one NPC file and one globals file, select → `loadAndMergeNpcModels` → both files cached by ingestion → `mergedSemanticModel.constants` is still `{}`. It stays that way for the session; only a re-selection, a file edit or a watcher batch heals it.
   - **What the user loses:** for the rest of that session — constant and variable autocomplete (`useVariableOptions.ts:618-622`), the topic title in a log entry (`LogEntryRenderer.tsx:40`), choice-target resolution (`InlineChoiceEditor.tsx:56`, `useResolvedFunction.ts:27`), Variable Manager, QuestPicker and `RegisterTopicDialog`'s duplicate check all read a model with files missing from it. The user sees an editor that "doesn't know" symbols the project declares, with no indication why.
   - **Test that does not exist:** set `selectedNpc`, merge with the NPC file only, run `startBackgroundIngestion` with a globals file in the list, assert the constant is in `mergedSemanticModel`.
   - **Minimal fix:** in `flushUpdates`, if `selectedNpc` is set and any flushed path is a global or quest file (the two pin rules), call `loadAndMergeNpcModels(selectedNpc)` after the `set` — once per 500 ms batch, which is the same cadence the merged model already tolerates.
   - **If we skip it:** the panel shows a model that silently disagrees with the files, on every project large enough for ingestion to outlast the first click.

3. **`PARSED_FILES_CAP` stops capping once more than 512 files carry no dialog** (`src/renderer/store/projectStore.ts:347`, `:419-442`; the pin rule is `:427-429`)
   - **What this is:** the cache is capped at 512 entries, and the pin set is "quest files + every file in `allDialogFiles` that has no dialog + the selected NPC's files". `allDialogFiles` is filled from `rawIndex.allFiles` (`:623`) — every scanned `.d` file, not only dialog files.
   - **Problem:** the eviction loop only takes unpinned entries, so when more than 512 files are dialog-less the pin set alone exceeds the cap and the loop breaks immediately with the cache larger than the cap. Reproduced: 700 files, all listed in `allDialogFiles`, an empty `dialogIndex`, 700 `updateFileModel` calls → `parsedFiles.size === 700` with `PARSED_FILES_CAP === 512`. That is the shape of the 1,725-file MDK tree, where most files are AI/story/constant files with no `C_INFO`. Measured scale: a 41 KB dialog file's model serialises to 0.70 MB, about 17× its source, so "no cap" is a few hundred MB of live objects for the corpus, and #443 makes each of them bigger. The doc's "at most `PARSED_FILES_CAP` files" (`render-performance.md:274`) is therefore only true for dialog-heavy projects.
   - **What the user loses:** the memory the cap exists to bound, on exactly the biggest projects; the renderer grows with the project until the app is restarted.
   - **Test that does not exist:** `PARSED_FILES_CAP + 188` dialog-less files in `allDialogFiles` → `parsedFiles.size === PARSED_FILES_CAP`. `tests/projectStore.parsedFilesCap.test.ts:46` fills with `allDialogFiles: []`, so nothing is pinned.
   - **Minimal fix:** make pinning a preference, not an absolute — after the unpinned pass, if `cache.size > CAP`, evict the least-recently-touched *global* entries too, leaving quest files and the selected NPC's files alone. Ten lines in the same function.
   - **If we skip it:** the one guard against unbounded model memory is off on the corpus the tests do not cover.

## Should fix

4. **A file that stops declaring an NPC leaves the NPC in the list** (`src/renderer/store/projectStore.ts:282-322`, the list line at `:316`)
   - **What this is:** `withFileIndexes` replaces a changed file's share of the index. It removes the NPC from `npcFileIndex`, `npcIdIndex` and `routineNpcIndex` (via `declaredThere`/`kept`), then rebuilds `npcList` by *appending* — `[...state.npcList, ...added]` — and never removes.
   - **Problem:** Reproduced both ways: `dropFileFromIndex('/p/Onar.d')` leaves `npcList: ['BAU_900_Onar', 'BAU_901_Bauer']` with `npcFileIndex: { BAU_901_BAUER: … }`, and `reindexFiles(['/p/Onar.d'])` with a file index that declares no instances leaves the same phantom. So after an external delete or rename, or after the user removes an `instance` block, the NPC stays in the NPC list — uneditable (`canEditNPC` is false), carrying no dialogs (`handleFileRemoved` emptied its `dialogIndex` entry), alive until the project is reopened.
   - **What the user loses:** a dead row in the NPC list, and in the World surface's insert-NPC picker, that names an NPC no file declares; selecting it shows an empty panel with no explanation, and a spawn written for it references nothing.
   - **Test that does not exist:** `dropFileFromIndex` (or a reindex with zero instances) removes the NPC from `npcList`. `tests/projectStore.reindexRoutines.test.ts:170` asserts every other field of that result, `npcList` not among them.
   - **Minimal fix:** after the loop, filter `npcList` down to names that still have a `npcFileIndex` entry **or** a `dialogIndex` entry — those are the two ways the load learns an NPC (`ProjectService.ts:255`, `:264`) — and keep the sort.
   - **If we skip it:** every delete and every `git checkout` that removes an NPC file leaves a row behind, and the list drifts from the files until a reopen.

5. **A prototype introduced by a changed file never reaches the incremental index, so its NPCs stay invisible** (`src/renderer/store/projectStore.ts:296-308` against the load's rule at `src/main/services/ProjectService.ts:183-216`; the shape gap is `FileIndex` in `src/shared/types.ts:118-123`)
   - **What this is:** at load, an instance is an NPC when its parent chain reaches `C_NPC`, resolved through a project-wide `parentByType` map built from every file's prototypes. The incremental path has no prototypes at all — `FileIndex` carries `instances` only — so `withFileIndexes` can only accept a parent that is `C_NPC` or already in `npcPrototypes`.
   - **Problem:** Reproduced: `npcPrototypes: ['NPC_DEFAULT']`, then a reindex of a file declaring `prototype SLD_New(C_NPC)` and `instance SLD_Foo(SLD_New)` with no `daily_routine` → `npcList: []`, `npcFileIndex: {}`. The drop-in workflow #141 exists for — put an NPC `.d` into the project — produces an NPC nobody can select or edit until the project is reopened, unless the instance happens to set `daily_routine` (the only other way past the filter). The same happens for an NPC whose prototype is added in the same change as the instance.
   - **What the user loses:** a newly added NPC of a new type does not exist as far as the editor is concerned, and the reason is invisible.
   - **Test that does not exist:** reindex a file whose instances' parent is a prototype that file declares; assert the NPC is listed and maps to the file.
   - **Minimal fix:** if it is not worth carrying prototypes per file (a second map in the store, resolved transitively like `chainEnd`), say so in `npc-editor.md` §6 and have the watcher's `add` path fall back to an index rebuild for files that declare a prototype. The cheap containment is to treat an instance whose parent is *not* a known non-NPC type as an NPC — wrong in the other direction, so it needs the decision.
   - **If we skip it:** the incremental index silently applies a weaker rule than the load, and the gap only shows on the one workflow the feature is for.

6. **The scan hands the index filesystem-completion order, so "last writer wins" is not reproducible** (`src/main/services/ProjectService.ts:89-135`, the race at `:109`; consumers at `:256`, `:186`, `:268`)
   - **What this is:** `scanDirectory` pushes each file as its `readdir` returns and recurses into subdirectories concurrently (`Promise.all` over `scanSubdirectory` futures), so the returned array is ordered by I/O completion, not by path. That array is `allFiles`, which is also `allDialogFiles`.
   - **Problem:** Verified: one tree with `DIA/` and `NPC/`, each with one file, scanned three times, gave `[A.d, B.d]`, `[A.d, B.d]`, `[B.d, A.d]` — and `readdir` listed `DIA` first each time. Everything the index builds by "later wins" therefore differs between two opens of the same project: `npcFiles` for a name declared twice (`:256`), `parentByType` for a duplicated prototype (`:186`), and — on every project, duplicates or not — the order of an NPC's dialogs when they live in two folders (`:268`), which is rendered unsorted as the NPC's dialog list (`ThreeColumnLayout.tsx:163-171`).
   - **What the user loses:** an NPC's dialog list that reshuffles between opens, and, for a mod that declares a name twice (`#447` explains why that happens), an index that points at a different file each time — so "which file owns this NPC" is a coin toss.
   - **Test that does not exist:** `scanDirectory` returns the same order twice on one tree, and two files declaring a name leave a deterministic owner.
   - **Minimal fix:** `return files.sort();` at the end of `scanDirectory` — one line, and it makes every derived ordering stable (dialog lists then follow path order).
   - **If we skip it:** any two runs of the editor can disagree about the project, which makes every other ordering finding in this doc unreproducible.

7. **`openProject` skips three of the four resets `closeProject` does, and the app never calls `closeProject` on open** (`src/renderer/store/projectStore.ts:583-648` against `:860-871` and the stamps at `:367-372`; caller `src/renderer/App.tsx:240-257`)
   - **What this is:** the stale-write guard is "a parse may not be cached if its stamp moved". `closeProject` runs `inFlight.clear()`, `stampAllFiles()`, `resetMergeCache()` and `resetParsedFileRecency()`; `openProject` runs only the last, and `App`'s open path is `resetEditorSession()` (editor state only, `fileStore.ts:1045-1052`) followed by `openProject(path)` — File ▸ Open and the Reload button both go through it.
   - **Problem:** the resets that `tests/projectStore.mergeIdentity.test.ts:101` and `tests/projectStore.getSemanticModelDedup.test.ts:70` pin are therefore exercised only by File ▸ Close, which is not how a project is replaced. A `getSemanticModel` in flight when the user hits Reload still sees an unchanged stamp, so it writes its pre-reload parse into the new session's cache; ingestion then skips that path because it is already cached (`:796`), so the stale model wins over the freshly primed one. Narrow window (one parse, tens of milliseconds), but the guard it defeats has no witness on the real path.
   - **What the user loses:** after a Reload, a file can keep the model parsed a few seconds earlier, which is the opposite of what Reload means; a file changed externally in that window stays stale until something else touches it.
   - **Test that does not exist:** `openProject` twice on one path, with a `getSemanticModel` resolving across the second call, leaves the cache without the first call's model.
   - **Minimal fix:** call `inFlight.clear(); stampAllFiles(); resetMergeCache();` at the top of `openProject` beside `resetParsedFileRecency()` — the same three lines, at the point the session actually changes.
   - **If we skip it:** the invariant "a stale parse never lands in the cache" holds on the path the tests drive and not on the path the user takes.

8. **A failed ingestion is cached as the file's model for the rest of the session** (`src/renderer/store/projectStore.ts:821-839`)
   - **What this is:** any rejection from `parseDialogFile` — a 30 s timeout, a worker that died, or every file after the parser pool hits its restart cap — is stored as an empty model with `hasErrors: true` and an `ingestion_error` entry, and `getSemanticModel` returns cache hits without ever retrying.
   - **Problem:** the stored shape is indistinguishable from a file that really cannot be parsed. `parseErrorIndex`, which is what the Problems panel's `parse-error` rule reads, comes from the index pass and never learns of it, so the file quietly contributes nothing to any merged model; opening it shows the pool's message ("Metadata worker timed out") as a parse error with no way to retry. When the pool degrades, every remaining file is poisoned this way in one pass, and the only cure is reopening the project (which clears `parsedFiles`) or restarting the app (which clears `ParserService.degraded`).
   - **What the user loses:** a transient worker failure reads as "this file is broken" forever, and after a crash-loop the project looks mostly empty with no retry anywhere.
   - **Test that does not exist:** a `parseDialogFile` that rejects once and succeeds the second time leaves the file cached with its content; a message classified as `timeout`/`worker-crashed` is retried once before it is stored.
   - **Minimal fix:** on the error path, retry once when `saveError.ts`'s classifier puts the message in the transient kinds, and otherwise keep the current behaviour but store it as `null` rather than an empty model — an uncached path re-parses on the next read instead of answering with emptiness.
   - **If we skip it:** the difference between "the parser is having a bad minute" and "this file is broken" is erased at the one point where it is still known.

## Nice to have

9. **Every changed file is parsed twice** (`src/renderer/hooks/useFileWatcher.ts:200` and `:221` → `src/main/main.ts:676-683`)
   - **What this is:** a watcher flush parses each background path through `project:parseDialogFile` for its model, and then `reindexFiles` asks main to read and parse the same path again for its `FileIndex` — two independent `ParserService` requests for one file, which cannot share the primed-model hand-off (that cache is filled only by the index build).
   - **Problem:** "one parse per file" is the invariant, and the incremental path spends two. Measured here: 15 ms for a 10 KB dialog file, 57 ms for a 41 KB one, so a 200-file `git checkout` costs about 6–23 s of worker time instead of 3–12 s. `routineSave.ts:63`/`:120` pay the same double after a save, on top of the save's own validation parse.
   - **Fix:** have `project:indexFile` return the model it parsed beside the `FileIndex`, and let the flush use that one call. If that is more than the win is worth, say in `render-performance.md` that the watcher path parses twice by design.
   - **If we skip it:** nothing breaks; the batch just takes twice as long as it needs to on the load this slice assumes.

10. **`worker-reliability.md` still describes the parser pool as started at module load** (`docs/architecture/worker-reliability.md:9-17` against `src/main/services/ParserService.ts:70-85`)
    - **What this is:** the doc's "Pool lifecycle" says `ParserService` is keep-alive and contrast it with the per-build metadata pool; the code now starts it on the first request (`startPool`, pinned by `tests/mainLazyParserPool.test.ts`), while `MetadataWorkerPool` still spawns its workers in the constructor. That asymmetry — one lazy, one eager — is exactly what the section is for and is not in it.
    - **Fix:** three sentences in "Pool lifecycle": the parser pool is lazy so a dialog-only session holds no children, and the metadata pool is eager because it is created only when a build is already under way.
    - **If we skip it:** the next reader takes the doc's "keep-alive" as the current design and the lazy start looks like a regression to be reverted.

## Verdict

Verdict: fix 1, 2 and 3 first. Finding 2 costs every user of a large project the symbols a later-ingested file declares, for the whole session, and the fix is four lines in the flush that already runs every 500 ms. Finding 1 breaks "one owner per symbol" on the only key the whole dialog tree uses, and has to be fixed in one place (the index) plus its readers. Finding 3 switches off the only memory bound on the corpus this review was asked to judge. Findings 4–8 are each cheap and each leaves a derived view disagreeing with the files; 9 and 10 are a measured double parse and three sentences of doc.

Lean: no deletions worth the churn. Finding 3's fix rewrites the eviction loop, so it is the one place a net loss of lines is possible.

Not checked: the 890-file Beppo corpus and the 1,725-file MDK tree are not on this machine, so the load was proved with synthetic trees, the real parser and the real store, not with a corpus open; the watcher double parse is measured per file rather than end to end in a running app; and I ran no Playwright or real-Electron suite, so findings 2 and 4 are read from the store and its probes rather than from a click.
