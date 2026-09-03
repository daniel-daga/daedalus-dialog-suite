# The unattended queue

**Work a run can take with nobody at the keyboard.** One ordered list, picked
top-down, so an unattended session needs one board card instead of forty.

Everything here was triaged on **2026-08-30** against the tree — each item was
checked to be still open, and the file:line or symbol it names was confirmed to
exist. The *diagnosis* is not repeated here: every row points at the file that
already holds it, and that file is what you read before starting.

**What "unattended" means.** No Gothic engine, no Spacer, no human judging a
rendered frame, no new external asset, no code-signing certificate, and no
decision that is the repo owner's — a taste call, a scope call, a product call.
Items that fail that test are **not** in this file; they stay in their own
review documents, where their "needs a decision" note is the point.

**The rules that still apply.** TDD: a failing test first, and it must genuinely
exercise the thing. A row's *accept* column is its finish line, and a row is not
done until the workspace's `test`, `lint` and `typecheck` are green. Take one
row, land it, cross it off here in the same commit. A run may not add rows —
this file is a human's triage, and growing it is a human's call.

**One machine-local caveat.** Rows marked **(corpus)** read the extracted world
corpus in `zenkit-node/worlds/`, which is gitignored and rebuilt by
`node scripts/extract-worlds.js` from a retail install. They run on Daniel's
machine and in no CI. Everything else runs anywhere.

Sizes: **S** under ~50 changed lines, **M** a few files, **L** a build-toolchain
or cross-workspace change.

---

**Section 5 is picked first — Daniel, 2026-08-30.** The level editor is where
the attention is, so its rows come before the editor-defect backlog below; the
rest of the order is untouched, and a run resumes at section 1 when section 5
is empty. The section keeps its original number so the cross-references hold.

## 5. Level editor — measurements and domain work

Sources are `level-editor.md` §16 and §14. **Nothing here needs the engine or
Spacer**; the measurements are the archetype of unattended work, because they
run headless and produce a number.

| # | Item | Where the diagnosis is | Accept | Size |
|---|---|---|---|---|
| ~~40~~ | ~~**(corpus)** Re-measure spawn-index coverage~~ — **landed 2026-08-30**: 3,976 of 3,978, and the two missed are `Externals.d`'s prototype declarations. `countSpawnCalls` now strips comments, so the old 4,087 denominator counted 111 commented-out calls as lost ones | §16.19 | `check-spawn-occupancy.js` reports the new coverage; §16.19's paragraph and the occupancy table are updated with it | S |
| ~~41~~ | ~~**(corpus)** Which visual extension retail attaches to which VOB class~~ — **landed 2026-08-30**: `scripts/check-visual-types.js` reproduces every figure §7 quotes, including 15,749 `UNKNOWN` of 41,393 (38.0 %) and `.3DS` as the only ambiguous extension | §14.1 1.7 (the measurement only; the feature stays a decision) | a script tabulating extension × class, with a fixture test of the tabulation | M |
| 42 | **blocked, in the board's Triage 2026-08-30 — a run may not take it.** There is no BINARY `.zen` on this machine to classify (the whole install was enumerated), and the container instrument has no BINARY walker, so the table would read `struct-only` on every row; §14.3 3.1 carries the enumeration and the three pieces it decomposes into. **(corpus)** The BINARY fidelity baseline: `extract-worlds.js` already takes directories, so point it at the install's loose `_work/Data/Worlds` and classify — BINARY has had no fidelity work at all | §14.3 3.1 | a per-world classification table; each defect it names then lands fixture-backed, as `0045`–`0048` did | M |
| ~~43~~ | ~~**(corpus)** What `oCWorld`/`zCWorld` actually carries~~ — **landed 2026-08-30**: `worldProperties` + `scripts/check-world-properties.js`. Sky, time and the cutscene player are save-game members and are absent from all four retail worlds; the start position is the one world-level thing a `.zen` carries, and it is a `zCVobStartpoint`, a `START` waypoint, both (NewWorld) or neither (AddonWorld) | §14.3 3.5 | `test/worldProperties.test.js` against the golden fixture, plus the readout | M |
| ~~44~~ | ~~Size the free-point widening~~ — **landed 2026-08-30**: `check-free-point-sites.js`. The 33 + 35 are grep lines; **61 are call sites**, all passing a literal, and **59 resolve against NewWorld** — but only 2 exactly, 45 needing the infix rule. The 2 that resolve in no world are both `WASH`. The widening itself stays a decision | world-editor review, finding 6 *Forward* | a count, recorded beside that finding | S |
| ~~45~~ | ~~Catalogue the four classes whose only fields are enums~~ — **landed 2026-08-30**: `zCTriggerList` (`mode` + the inherited `VTrigger` twelve), `zCMessageFilter` (both actions), `oCTouchDamage` (all twelve, so the class is complete) and `zCCodeMaster` — which has **no enum at all**, its three booleans having been held out with the `slaves` list they steer. Swept: every retail value is inside its set (mode ALL on 44, collision BOX on 51, the 26 filters using five of six actions on each field). Only classes that declare no field at all are authorable-with-nothing-catalogued now | §16.3 / §14.1 1.4 | `vobClasses.test.ts` › `oCTouchDamage` is no longer authorable with nothing catalogued, plus a per-key round-trip on a placed VOB and a retail value sweep (the I3/I4 rule) | M |
| ~~46~~ | ~~A copy carries its class **properties**~~ — **landed 2026-08-30**: one `SetVobClassProp` per *copy* rather than per field (the op takes the whole record, and one op is one round trip and one entry in the batch), `from` = `to` because a freshly constructed VOB holds the binding's defaults and nothing on this side knows them. `commitOps`' all-adds exception widened to adds-and-class-props. Two drops, both "lossy beats refused": no class on the copy means no class fields, and a value outside its catalogue bounds is left behind rather than refusing the copy at the IPC boundary. Ctrl+C is asynchronous now — it fetches before it fills the clipboard | §14.1 1.2 | `ops.test.ts` › a duplicate of a `zCVobLight` carries its range and colour | M |
| ~~47~~ | ~~**(corpus)** `verify-world-pipeline.js` writes no enum~~ — **landed 2026-08-30**: `verifyEnumWrite`, two rows on retail NewWorld — `zCVobLight.lightType` POINT → SPOT and `oCMobInter.soundMaterial` STONE → WOOD — each read back with `getVobProps` and undone, the target picked as the first catalogue value the VOB does not hold. Suppressing the write was run as a negative control and fails all four checks. The default `--world` was stale on the way past (a stock install has no loose `_work\Data\Worlds`) and the header now points at the extracted corpus | §16.2 | the script writes and reads back `zCVobLight.lightType` and `oCMOB.soundMaterial` | S |
| ~~48~~ | ~~The `--counts` fuzz sweep only ever runs against `minimal.g2.zen`~~ — **landed 2026-08-30**: `--fixture <variant>` authors a binding fixture variant and sweeps that. All three swept clean — `npc` 76 INTEGER entries, `camera` 29, `corrupt-mesh` 21 (the minimal fixture's set; its corruption is chunk bytes, not an entry) — with **no hit to bound**. The five counts the checked-in fixture could never reach are reached and each throws its own guard, and the test asserts that rather than the empty summary line | §16.11 | `fuzz-world.js --counts --fixture npc\|camera\|corrupt-mesh` reports per entry, and every hit lands bounded and covered | M |

## 1. Correctness — a defect a user can hit

| # | Item | Where the diagnosis is | Accept | Size |
|---|---|---|---|---|
| ~~1~~ | ~~`getSemanticModel` writes a stale model over a fresh one~~ — **landed 2026-08-30**, per-file staleness stamp; the residual (an open file evicted by the 512 cap re-parses from disk) is recorded at 2026-07 **4.1** and is not a row | 2026-07 **4.1** | `projectStore.staleCacheWrite` green | M |
| ~~2~~ | ~~Auto-save calls `editorAPI.saveFile` directly~~ — **landed 2026-08-30**, the hook now calls `fileStore.saveFile`; the one cost is that the five-file autosave tick commits per file instead of once (`autoSavePerformance` pins the new count) | 2026-07 **3.1** | `useAutoSave.conflictRouting` green | M |
| ~~3~~ | ~~A background reparse discards a running simulator session~~ — **landed 2026-08-30**, the projection is pinned to the model the modal opened on | simulator **M2** | `simulatorDialog` › a model change while open keeps the session | S |
| ~~4~~ | ~~`clearSearch` does not cancel the in-flight search~~ — **landed 2026-08-30**, it bumps `currentSearchId` and clears `isSearching` | 2026-07 **4.3** | `searchStore` › clearSearch cancels an in-flight search | S |
| ~~5~~ | ~~Comments inside a call become arguments~~ — **landed 2026-08-30**, all three extractors share `isArgumentNode`, which also excludes `comment`; a comment inside an argument list is now dropped from regeneration rather than shifting every argument after it | 2026-07 **4.16** | `comment-preservation` › a comment inside an argument list is not collected as an argument | S |
| ~~6~~ | ~~A failed update check still stamps the rate limit~~ — **landed 2026-08-30**, the timestamp is written only once the check reaches a conclusion; a release that fetched but carries no assets still stamps, a failed fetch of either body does not | 2026-07 **4.13** | `UpdaterService` › does not consume the rate limit when the release fetch fails | S |
| ~~7~~ | ~~A worker exiting **0** is never reaped~~ — **landed 2026-08-30**, both pools reap on any `exit`; the membership checks the death paths already had are what keep a deliberate `terminate()` quiet | 2026-07 **4.15** | both pools › a clean exit settles the pending request | S |
| ~~8~~ | ~~`closeApproved` is a module global~~ — **landed 2026-08-30**, approval is a `WeakSet` of windows, so a window created after an approved close asks the renderer again | 2026-07 **4.12** | `closeGuardPerWindow` › re-arms the guard for a window created after an approved close | S |
| ~~9~~ | ~~`FileService`'s caches and locks key on the raw path~~ — **landed 2026-08-30**, all three maps key on `canonicalPathKey` (`src/main/utils/pathKey.ts`), which is now the watcher's self-write key too rather than a second copy of the same four lines | 2026-07 **4.11** | `FileService.pathCanonicalization` › `C:\A\b.d` and `c:/a/b.d` are one key | M |
| ~~10~~ | ~~A project-open failure is swallowed~~ — **landed 2026-08-30**, `openProject` rethrows after recording `loadError`, so `App`'s `openProjectWithReset` catch fires and the user sees the message; `loadError` stays write-only and is still the second half of 2026-07 **2.1** | 2026-07 **2.1** | `projectStore.openProjectError` › openProject rethrows | S |
| ~~11~~ | ~~`updateModel` and `_applyHistoryModelUpdate` are byte-identical and neither clears `saveError`~~ — **landed 2026-08-30**, `updateModel` clears it and `_applyHistoryModelUpdate` delegates, so there is one body | 2026-07 **4.5** | `fileStore.updateModelSaveError` green | S |
| ~~12~~ | ~~Encoding detection flips a whole cp1252 file to cp1250 on one accented byte~~ — **landed 2026-08-30**, three bytes cp1252 leaves unassigned decide alone, the ambiguous rest needs two distinct hits | production-readiness §2 | `metadataEncoding` › a lone cp1252 accent does not flip the file | S |
| ~~13~~ | ~~Two app instances share one settings temp path~~ — **landed 2026-09-01**: the temp name carries `pid` + a module counter (two instances in one process share a pid), and a failed write unlinks its own file. The shared name was the *smaller* half — the test found that two renames onto one destination fail **EPERM on Windows about one run in three**, so a contended rename is now retried 4× over 100 ms and a save survives it | production-readiness §2, `SettingsService.ts:77` | `SettingsService` › concurrent saves do not share a temp path | S |
| ~~14~~ | ~~The project scan recurses only on `isDirectory()`, so a junctioned script tree is invisible — and a `readdir` failure is swallowed~~ — **landed 2026-09-01**: links are `stat`ed and followed (a dangling one is skipped), a realpath visited set cuts a junction back into an ancestor, an unreadable subdirectory is `console.warn`ed and skipped rather than hiding the rest of the tree, and only the root itself failing rejects the scan | production-readiness §2, `ProjectService.ts:73` | `ProjectService.scanDirectory` › follows a junctioned tree | M |
| ~~15~~ | ~~`parser:parseSource` is the one IPC handler that takes an unvalidated payload~~ — **landed 2026-09-01**: `assertParseSourcePayload` in `ipcValidation.ts`, the handler's parameter is `unknown` until it passes | production-readiness §2, `main.ts:195` | `ipcValidation` › parseSource rejects a non-string payload | S |

## 2. Consistency — one source of truth where there are two

| # | Item | Where the diagnosis is | Accept | Size |
|---|---|---|---|---|
| ~~16~~ | ~~The two worker pools compute their size differently; `worker-reliability.md` already names which is canon~~ — **landed 2026-09-01**: the doc's rule is `workerPoolSize()` in one module and both pools call it, so `ParserService` on a 1- or 2-core machine now runs one worker where it ran two | 2026-07 **4.14**, `ParserService.ts:61` vs `MetadataWorkerPool.ts:101` | `workerPool.count` › both pools agree for 1/2/4/32 cores | S |
| ~~17~~ | ~~Validation types are declared three times and have already drifted (`invalid_string_content` is emitted but not in the shared type)~~ — **landed 2026-09-01**: `shared/types.ts` is the one declaration (`ValidationErrorType` now carries `invalid_string_content`), `ValidationService` and `CodeGeneratorService` import it, and the private `CodeGeneratorSettings` copies are gone in favour of the shared `CodeGenerationSettings` | 2026-07 **3.4**, `ValidationService.ts:8`, `shared/types.ts:583` | `typecheck:renderer` + `build:main` green with one shared type | S |
| ~~18~~ | ~~Action types are listed in three places — labels, menu items and an icon switch — and disagree~~ — **landed 2026-09-02**: `actionTypeRegistry.tsx` is the one `Record<ActionTypeId, { label, icon, addable? }>`; the card tooltip, the add-action menu and the card icon all read it, `customAction` is "Custom Action" everywhere, and `commentAction` is the one `addable: false` | 2026-07 **3.2**, `actionRenderers/index.tsx`, `ActionTypeMenu.tsx:30`, `ActionCard.tsx:244` | `actionTypeRegistry` › no two sites disagree on a label | M |
| ~~19~~ | ~~Two add-action flows seed companions differently~~ — **landed 2026-09-02**: append is insert-after-last. `useActionManagement.insertAction(path \| null, type)` is the one seeding path, `addActionAfter` and the new `addActionToEnd` both call it, and `useDialogEditorCommands` lost its 80-line copy (and the three params only it read). The one visible change: a line appended from the Add-action button now toggles the speaker off the last line, as inserting after it always did | 2026-07 **3.3**, `useDialogEditorCommands.ts:79` vs `useActionManagement.ts:285` | › addActionToEnd matches addActionAfter | M |
| ~~20~~ | ~~The condition menu is a nine-case switch beside the registry that already describes them~~ — **landed 2026-09-02**: `RegistryEntry` gained `menuLabel` and `createDefault()`, the menu is `Object.entries(CONDITION_REGISTRY)` and `addCondition` is one lookup; the nine `MenuItem`s and the nine-case switch are gone, labels and defaults unchanged, and `FALLBACK_ENTRY` is the `Condition` entry rather than a copy of it | 2026-07 **3.5**, `ConditionEditor.tsx:164` | `conditionRegistry.menu` › one item per registry key | M |
| ~~21~~ | ~~Dead code: `pendingValidation`, `setUpdaterAutoCheck`, the unread quest `adjacency` map, stale `daedalus-parser/bin/bin`, and an `examples/` file importing paths that no longer exist~~ — **landed 2026-09-02**: all five gone (`bin/src/` went with `bin/bin/`, both stale output of the pre-`src/{core,semantic,codegen,utils}` layout, and their eslint ignores with them). The three `examples/` were kept, not deleted: their imports are now the package-facing subpaths the README already teaches, `tsconfig.json` maps those three subpaths to their sources so `examples/**` is in `typecheck`, and all three run end to end (`condition-example.js` also read `dialog.conditions`, which moved to the condition function years ago). `saveRace`'s stale-dialog test went with the field it asserted | 2026-07 **6.1** | `typecheck:renderer` + parser `test` + `lint`, with `examples/` in the parser typecheck | M |
| ~~22~~ | ~~Two stray tracked files at the editor root: `debug_file.ts` (broken import) and `win1250.d`~~ — **landed 2026-09-02**: `debug_file.ts` deleted (its `./src/main/utils/metadataUtils` import had no target); `win1250.d` is a real cp1250 sample the standalone `tests/encoding.test.ts` script reads, so it moved to `tests/fixtures/` and the script follows it. `tests/repoHygiene.test.ts` asks `git ls-files` that neither name is tracked at the workspace root | production-readiness §2 #5 | repo-hygiene guard › neither path is tracked | S |
| ~~23~~ | ~~`mockAPI.ts` — a 635-line dev shim — ships in the production bundle~~ — **landed 2026-09-02**: `main.tsx` installs the shim through a dynamic `import()` behind `import.meta.env.DEV`, so the production build drops it (entry chunk 436 kB → 423 kB) while the Vite-dev-server harness keeps it. The test builds the renderer itself (~40 s) into a scratch dir with `NODE_ENV=production` — Jest's `test` leaves `DEV` true — and the Monaco copy now follows the resolved `outDir` instead of a hard-coded `dist/renderer` | production-readiness §3 P3, `main.tsx:6` | `bundleContents` › mockAPI is not in the built renderer | S |
| ~~24~~ | ~~`ReviewChangesDialog` and `SimulatorDialog` are still statically imported; the lazy idiom is already used by `DialogSourceViewDialog`~~ — **landed 2026-09-02**: both are `React.lazy` + mounted only while open, the way the source view already was; entry chunk 423 kB → 403 kB, with the two as their own chunks fetched on first press. The one visible change is the same one the source view took: a closed modal unmounts at once instead of fading out | production-readiness §3 P3, `DialogDetailsEditor.tsx:25`, `:35` | `DialogDetailsEditor.lazyDialogs` › loads each only when opened | M |
| ~~25~~ | ~~`ensureActionIds` re-walks every function on every `openFile`, cache hit included~~ — **landed 2026-09-02**: a `WeakMap` keyed on the model object that went in (and the one that came out) memoizes the walk, so the projectStore's cached model is walked once however often it is re-opened; a fresh parse is a fresh object and still walks | production-readiness §3 P3, `fileStore.ts:69` | `fileStore` › re-opening a normalized file does not re-walk | M |
| ~~26~~ | ~~`fileEncodingCache` / `fileStatCache` are uncapped; the LRU idiom exists in `ProjectService`~~ — **landed 2026-09-02**: the idiom is `LruMap` in `src/main/utils/lruMap.ts` (a `Map` whose `get`/`set` move to the tail and evict past the cap); both `FileService` caches use it at `FILE_CACHE_CAP = 1024` and `primedModels` uses it at its existing 512, losing its inline loop | production-readiness §3 P3, `FileService.ts:26`, `:33` | `FileService` › the encoding cache is LRU-capped | S |
| ~~27~~ | ~~Five known refactoring targets are not in `docs/refactoring-targets.md` (and one of its paths is stale)~~ — **landed 2026-09-02**: entries 11–15 (linking-visitor god class, `setupIpcHandlers` inline bodies, the double `ensureActionType` in `deserializeSemanticModel`, the flat quest UI, the module-level `historyStore` subscribe), each re-checked against the tree rather than copied from 6.2 — the quest entry in particular, since `quest-editor.md` now documents the flat layout the review measured it against. The stale item was #1: the `editorStore` split it asks for landed long ago (the file is a 16-line barrel), so it is marked done; `worldTypes.ts` line refs in #5 refreshed | 2026-07 **6.2** | the five headings exist; `lint` green | S |

## 3. UI, where the shape is already decided

Nothing here needs a design call: each has a template already in the tree.

| # | Item | Where the diagnosis is | Accept | Size |
|---|---|---|---|---|
| ~~28~~ | ~~The delete-confirm dialog focuses **Confirm**, so Escape-then-Enter deletes an action~~ — **landed 2026-09-03**: the ref moved to Cancel, Delete stays one Tab away. Whether Escape should open a delete confirm at all (2.5's second half) is a keyboard-grammar call and stays open | 2026-07 **2.5**, `ActionCard.tsx:237`, `DeleteConfirmDialog.tsx` | `DeleteConfirmDialog` › focuses Cancel; e2e `action-deletion` › Escape then Enter backs out | S |
| ~~29~~ | ~~Native `confirm()`/`alert()` where `DeleteConfirmDialog` is the house idiom~~ — **landed 2026-09-03**: `DeleteConfirmDialog` took a `confirmLabel`; App's guard is `withDiscardConfirmed(context, proceed)` parking `proceed` behind an "Unsaved changes" dialog ("Discard and continue"), and the variable delete states that the file is written at once and cannot be undone, its failure a Snackbar. 5.3's usage count is not here — nothing indexes variable references yet, so it would be a new search, not a dialog | 2026-07 **5.3**, `App.tsx:156`, `VariableManager.tsx:132`, `:137` | e2e `close-project` › switching projects with unsaved changes shows the in-app guard; `VariableManager.deleteConfirm` | M |
| ~~30~~ | ~~The Problems panel is silently empty in single-file mode and never renders `isScanning`, which the store already publishes~~ — **landed 2026-09-03**: with no `projectPath` the summary says problems come from scanning a project rather than "0 errors, 0 warnings", and `isScanning` reads "Scanning…" — which in practice never paints, since `runScan` sets and clears it in one synchronous call; rendering it costs nothing and the store's flag now has a reader | production-readiness §4 **F18**, `ProblemsPanel.tsx` | `ProblemsPanel.emptyState` › explains the single-file empty state | S |
| ~~31~~ | ~~A zero-NPC project renders an empty box: the guidance is behind `npcFilter &&`~~ — **landed 2026-09-03**: the empty box always says something — the filter that matched nothing, or, unfiltered, that NPCs get in by placing an NPC `.d` file in the project (the workflow the removed "Add NPC" button's comment already described). 5.6's other half — auto-created EXIT dialogs notifying nobody — is a `useFileWatcher` change, not this row | 2026-07 **5.6**, `NPCList.tsx:136` | `NPCList.emptyState` › empty project shows the drop guidance | S |
| ~~32~~ | ~~The diff view and the source dialog hardcode a dark palette and ignore the theme~~ — **landed 2026-09-03**: `CodeDiffView` reads `background.default` / `text.primary` / `divider`, and the source dialog picks Monaco's `light` or `vs-dark` off `palette.mode` — Gothic is a dark palette, so it keeps `vs-dark`; a Monaco theme in Gothic's colours would be a design call | production-readiness §4 **F13**, `common/CodeDiffView.tsx:128`, `DialogSourceViewDialog.tsx:105` | `CodeDiffView.theme` › uses theme tokens in light mode | M |
| ~~33~~ | ~~A `Typography variant="h6"` inside `DialogTitle` — a heading inside a heading~~ — **landed 2026-09-03**: `component="span"`, same look, one heading | 2026-07 **5.7a**, `DialogSourceViewDialog.tsx:82` | `DialogSourceViewDialog` › no `validateDOMNesting` warning | S |
| ~~34~~ | ~~Copy-to-clipboard gives no feedback~~ — **landed 2026-09-03**: a two-second "Copied to clipboard" Snackbar inside the dialog | 2026-07 **5.7b**, same file, `:85` | `DialogSourceViewDialog` › copy shows a confirmation | S |
| 35 | The a11y mechanical half: no `autoFocus`, no `aria-describedby`, clickable `Box` headers without button semantics | production-readiness §4 **F19-F22** | e2e › the close guard focuses its default action | M |
| 36 | No Alt+Up/Down action reorder; `moveAction` is already a prop and the e2e harness exists | 2026-07 **5.4** (the Alt half only) | `keyboard-dnd-reorder` -g "Alt+Arrow" | M |
| 37 | "View release notes" is a dead `href="#"`; there is no `shell.openExternal` channel | production-readiness §2, `UpdateNotification.tsx:169` | › rejects a non-https URL, and the link opens the release URL | M |

## 4. Coverage — a test that should exist

| # | Item | Where the diagnosis is | Accept | Size |
|---|---|---|---|---|
| ~~38~~ | ~~No simulator test is fed real parser output; two landed fixes (H1, H2) have no regression lock. Fixture: `daedalus-parser/test/fixtures/corpus/condition-idioms.d`~~ — **landed 2026-09-02**: `tests/simulatorParserIntegration.test.ts` parses the fixture with the real parser in a child process (the binding-per-registry idiom `teacherDialogTemplate` uses), appends the three C_INFO instances the corpus file deliberately lacks, and runs `createSimulatorModel` → `getDialogAvailability`: both raw-mode shapes come out unknown with the "not structurally analyzable" reason, and the `!Npc_KnowsInfo` gate is true on a fresh session and false once `DIA_Foo` is known. Reverting either fix by hand turns three of the four cases red; green in band and under the default workers | simulator, test-coverage observations | `simulatorParserIntegration` green under `--runInBand` **and** default workers | M |
| 39 | The packaged-app asar check asserts the ZenKit addon but **not** the tree-sitter binding, and no packaged smoke parses a `.d` | production-readiness §2 blocker 3, `build-windows.yml:153` | the smoke entry's Jest test and the asar assertion; the workflow step itself needs a dispatch | L |

## 6. Larger, and worth knowing before you start

| # | Item | Where the diagnosis is | Accept | Size |
|---|---|---|---|---|
| ~~49~~ | ~~The grammar takes C-style string escapes, `parser-roundtrip-scope.md` says Daedalus has none, and the generator agrees with the doc~~ — **landed 2026-09-02**: `string` is now `"` + `[^"]*` + `"`, so a backslash is literal and `"Ja\"` ends at its quote; `src/parser.c` regenerated and the binding rebuilt in the same change. The two tests that asserted `\"` as an escape were rewritten to the settled semantics. The fixture corpus carries no backslash at all, so no corpus parse changed (11 files, 0 drift under `--strict`). Forward: the editor mirrors nothing — it has no Monaco tokenizer for Daedalus, and `ValidationService` already states the no-escapes rule | 2026-07 **4.18**, `grammar.js:233` | parser › a trailing-backslash string round-trips, then `npm run test:roundtrip-corpus` | L |

---

## Deliberately not here

These are open and **not** for an unattended run. Each one's own document says
why, and the short version is that a person has to decide something first:

- **2.3** make save state visible, **2.4** the parse-error dead end, **4.7**
  quest case-sensitivity (fix or delete — `buildQuestGraph` has no production
  caller), **4.17** `allowPartialModel` generating from an empty model, **5.1**
  search that does not search what it claims, **5.4**'s Tab half (it would
  change the documented keyboard grammar), **5.7c** the Dandelion /
  Daedalus Dialog Editor name split.
- production-readiness **F9, F10-F12, F14-F16** — each needs its surface
  designed first — and the `html { fontSize: 80% }` question.
- Release work: signing, icons, the dispatch checklist, Linux/macOS targets,
  a crash reporter.
- The simulator's two deliberately-uncovered condition shapes: reopening a
  recorded scope decision is the owner's call.
- Anything whose acceptance is *"does it look right"* or *"does the engine
  play it"* — the World-surface feedback in `level-editor.md` §16.24, and every
  row of the Gate 2 sheets. Also §16.12's four viewport constants (a human eye
  and a real GPU; jsdom has no WebGL) and §16.4's Euler order, which needs
  Spacer and nothing in the format can settle.

**And one that a survey found automatable but a person has already ruled on.**
It is omitted deliberately, and needs one word from Daniel to join:

- **The ASCII writer's signed `bool:`** (§16.9): **deferred 2026-08-28**, with
  the other two ASCII items. The editor does not save through that path.

Three more used to sit here — portal orientation (§16.22 q3), the pairing and
planarity checks (q1, q2) and `checkPortalMaterials`' consumer (§16.20 slice
3). Daniel filed them as one card on 2026-09-02 and it landed the same day:
`git log` and §16.20 slice 3.
