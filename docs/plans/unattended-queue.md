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

## 1. Correctness — a defect a user can hit

| # | Item | Where the diagnosis is | Accept | Size |
|---|---|---|---|---|
| ~~1~~ | ~~`getSemanticModel` writes a stale model over a fresh one~~ — **landed 2026-08-30**, per-file staleness stamp; the residual (an open file evicted by the 512 cap re-parses from disk) is recorded at 2026-07 **4.1** and is not a row | 2026-07 **4.1** | `projectStore.staleCacheWrite` green | M |
| ~~2~~ | ~~Auto-save calls `editorAPI.saveFile` directly~~ — **landed 2026-08-30**, the hook now calls `fileStore.saveFile`; the one cost is that the five-file autosave tick commits per file instead of once (`autoSavePerformance` pins the new count) | 2026-07 **3.1** | `useAutoSave.conflictRouting` green | M |
| ~~3~~ | ~~A background reparse discards a running simulator session~~ — **landed 2026-08-30**, the projection is pinned to the model the modal opened on | simulator **M2** | `simulatorDialog` › a model change while open keeps the session | S |
| ~~4~~ | ~~`clearSearch` does not cancel the in-flight search~~ — **landed 2026-08-30**, it bumps `currentSearchId` and clears `isSearching` | 2026-07 **4.3** | `searchStore` › clearSearch cancels an in-flight search | S |
| 5 | Comments inside a call become arguments — the argument split filters only `,` `(` `)` | 2026-07 **4.16**, `argument-parsing.ts:10`, `:38`, `condition-parsers.ts:297` | parser › `AI_Output(self, other, /* n */ "X")` has 3 arguments | S |
| 6 | A failed update check still stamps the rate limit, so one network blip costs the whole hour | 2026-07 **4.13**, `UpdaterService.ts` | updater › a failed check does not consume the rate limit | S |
| 7 | A worker exiting **0** is never reaped: its pending request waits out the 30 s timeout | 2026-07 **4.15**, `ParserService.ts:96`, `MetadataWorkerPool.ts:160` | worker pool › a clean exit settles the pending request | S |
| 8 | `closeApproved` is a module global, so approving one window's close disarms the guard for the next | 2026-07 **4.12**, `main.ts:33` | close guard › the guard resets per window | S |
| 9 | `FileService`'s caches and locks key on the raw path, so the watcher's spelling misses them on Windows | 2026-07 **4.11**, `FileService.ts:26`, `:33`, `:39` | `FileService.pathCanonicalization` › `C:\A\b.d` and `c:/a/b.d` are one key | M |
| 10 | A project-open failure is swallowed: the catch writes `loadError`, which nothing reads, and never rethrows | 2026-07 **2.1**, `projectStore.ts:427` | `projectStore.openProjectError` › openProject rethrows | S |
| 11 | `updateModel` and `_applyHistoryModelUpdate` are byte-identical and neither clears `saveError`, which every sibling does | 2026-07 **4.5**, `fileStore.ts:372`, `:932` | `fileStore` › updateModel clears saveError | S |
| 12 | Encoding detection flips a whole cp1252 file to cp1250 on one accented byte; untested in the false-positive direction | production-readiness §2, `encodingUtils.ts:18` | `encodingUtils` › a lone cp1252 accent does not flip the file | S |
| 13 | Two app instances share one settings temp path | production-readiness §2, `SettingsService.ts:77` | `SettingsService` › concurrent saves do not share a temp path | S |
| 14 | The project scan recurses only on `isDirectory()`, so a junctioned script tree is invisible — and a `readdir` failure is swallowed | production-readiness §2, `ProjectService.ts:73` | `ProjectService.scanDirectory` › follows a junctioned tree | M |
| 15 | `parser:parseSource` is the one IPC handler that takes an unvalidated payload | production-readiness §2, `main.ts:195` | `ipcValidation` › parseSource rejects a non-string payload | S |

## 2. Consistency — one source of truth where there are two

| # | Item | Where the diagnosis is | Accept | Size |
|---|---|---|---|---|
| 16 | The two worker pools compute their size differently; `worker-reliability.md` already names which is canon | 2026-07 **4.14**, `ParserService.ts:61` vs `MetadataWorkerPool.ts:101` | `workerPool.count` › both pools agree for 1/2/4/32 cores | S |
| 17 | Validation types are declared three times and have already drifted (`invalid_string_content` is emitted but not in the shared type) | 2026-07 **3.4**, `ValidationService.ts:8`, `shared/types.ts:583` | `typecheck:renderer` + `build:main` green with one shared type | S |
| 18 | Action types are listed in three places — labels, menu items and an icon switch — and disagree | 2026-07 **3.2**, `actionRenderers/index.tsx`, `ActionTypeMenu.tsx:30`, `ActionCard.tsx:244` | `actionTypeRegistry` › no two sites disagree on a label | M |
| 19 | Two add-action flows seed companions differently | 2026-07 **3.3**, `useDialogEditorCommands.ts:79` vs `useActionManagement.ts:285` | › addActionToEnd matches addActionAfter | M |
| 20 | The condition menu is a nine-case switch beside the registry that already describes them | 2026-07 **3.5**, `ConditionEditor.tsx:164` | `conditionRegistry.menu` › one item per registry key | M |
| 21 | Dead code: `pendingValidation`, `setUpdaterAutoCheck`, the unread quest `adjacency` map, stale `daedalus-parser/bin/bin`, and an `examples/` file importing paths that no longer exist | 2026-07 **6.1** | `typecheck:renderer` + parser `test` + `lint`, with `examples/` in the parser typecheck | M |
| 22 | Two stray tracked files at the editor root: `debug_file.ts` (broken import) and `win1250.d` | production-readiness §2 #5 | repo-hygiene guard › neither path is tracked | S |
| 23 | `mockAPI.ts` — a 635-line dev shim — ships in the production bundle | production-readiness §3 P3, `main.tsx:6` | `bundleContents` › mockAPI is not in the built renderer | S |
| 24 | `ReviewChangesDialog` and `SimulatorDialog` are still statically imported; the lazy idiom is already used by `DialogSourceViewDialog` | production-readiness §3 P3, `DialogDetailsEditor.tsx:25`, `:35` | the entry chunk shrinks and the lazy-boundary test passes | M |
| 25 | `ensureActionIds` re-walks every function on every `openFile`, cache hit included | production-readiness §3 P3, `fileStore.ts:69` | `fileStore` › re-opening a normalized file does not re-walk | M |
| 26 | `fileEncodingCache` / `fileStatCache` are uncapped; the LRU idiom exists in `ProjectService` | production-readiness §3 P3, `FileService.ts:26`, `:33` | `FileService` › the encoding cache is LRU-capped | S |
| 27 | Five known refactoring targets are not in `docs/refactoring-targets.md` (and one of its paths is stale) | 2026-07 **6.2** | the five headings exist; `lint` green | S |

## 3. UI, where the shape is already decided

Nothing here needs a design call: each has a template already in the tree.

| # | Item | Where the diagnosis is | Accept | Size |
|---|---|---|---|---|
| 28 | The delete-confirm dialog focuses **Confirm**, so Escape-then-Enter deletes an action | 2026-07 **2.5**, `ActionCard.tsx:237`, `DeleteConfirmDialog.tsx` | › DeleteConfirmDialog focuses Cancel | S |
| 29 | Native `confirm()`/`alert()` where `DeleteConfirmDialog` is the house idiom | 2026-07 **5.3**, `App.tsx:156`, `VariableManager.tsx:132`, `:137` | e2e › switching projects with unsaved changes shows the in-app guard | M |
| 30 | The Problems panel is silently empty in single-file mode and never renders `isScanning`, which the store already publishes | production-readiness §4 **F18**, `ProblemsPanel.tsx` | `ProblemsPanel` › explains the single-file empty state | S |
| 31 | A zero-NPC project renders an empty box: the guidance is behind `npcFilter &&` | 2026-07 **5.6**, `NPCList.tsx:136` | `NPCList` › empty project shows the drop guidance | S |
| 32 | The diff view and the source dialog hardcode a dark palette and ignore the theme | production-readiness §4 **F13**, `common/CodeDiffView.tsx:128`, `DialogSourceViewDialog.tsx:105` | `CodeDiffView` › uses theme tokens in light mode | M |
| 33 | A `Typography variant="h6"` inside `DialogTitle` — a heading inside a heading | 2026-07 **5.7a**, `DialogSourceViewDialog.tsx:82` | › no `validateDOMNesting` warning | S |
| 34 | Copy-to-clipboard gives no feedback | 2026-07 **5.7b**, same file, `:85` | › copy shows a confirmation | S |
| 35 | The a11y mechanical half: no `autoFocus`, no `aria-describedby`, clickable `Box` headers without button semantics | production-readiness §4 **F19-F22** | e2e › the close guard focuses its default action | M |
| 36 | No Alt+Up/Down action reorder; `moveAction` is already a prop and the e2e harness exists | 2026-07 **5.4** (the Alt half only) | `keyboard-dnd-reorder` -g "Alt+Arrow" | M |
| 37 | "View release notes" is a dead `href="#"`; there is no `shell.openExternal` channel | production-readiness §2, `UpdateNotification.tsx:169` | › rejects a non-https URL, and the link opens the release URL | M |

## 4. Coverage — a test that should exist

| # | Item | Where the diagnosis is | Accept | Size |
|---|---|---|---|---|
| 38 | No simulator test is fed real parser output; two landed fixes (H1, H2) have no regression lock. Fixture: `daedalus-parser/test/fixtures/corpus/condition-idioms.d` | simulator, test-coverage observations | `simulatorParserIntegration` green under `--runInBand` **and** default workers | M |
| 39 | The packaged-app asar check asserts the ZenKit addon but **not** the tree-sitter binding, and no packaged smoke parses a `.d` | production-readiness §2 blocker 3, `build-windows.yml:153` | the smoke entry's Jest test and the asar assertion; the workflow step itself needs a dispatch | L |

## 5. Level editor — measurements and domain work

Sources are `level-editor.md` §16 and §14. **Nothing here needs the engine or
Spacer**; the measurements are the archetype of unattended work, because they
run headless and produce a number.

| # | Item | Where the diagnosis is | Accept | Size |
|---|---|---|---|---|
| 40 | **(corpus)** Re-measure spawn-index coverage — the 71 % (2,909/4,087) predates the nested-call-sites fix and §16.19 says so outright | §16.19 | `check-spawn-occupancy.js` reports the new coverage; §16.19's paragraph and the occupancy table are updated with it | S |
| 41 | **(corpus)** Which visual extension retail attaches to which VOB class, and the 15,749-of-41,393 `UNKNOWN` figure reproduced — the number the visual-assignment row has never had | §14.1 1.7 (the measurement only; the feature stays a decision) | a script tabulating extension × class, with a fixture test of the tabulation | M |
| 42 | **(corpus)** The BINARY fidelity baseline: `extract-worlds.js` already takes directories, so point it at the install's loose `_work/Data/Worlds` and classify — BINARY has had no fidelity work at all | §14.3 3.1 | a per-world classification table; each defect it names then lands fixture-backed, as `0045`–`0048` did | M |
| 43 | **(corpus)** What `oCWorld`/`zCWorld` actually carries — start position, sky, time — across the corpus. Which become *editable* is a scoping call; measuring them is not | §14.3 3.5 | `test/worldProperties.test.js` against the golden fixture, plus the readout | M |
| 44 | Size the free-point widening: how many of the 33 `Wld_IsFPAvailable` + 35 `AI_GotoFP` retail sites resolve against a world's `zCVobSpot` set. The widening itself stays a decision | world-editor review, finding 6 *Forward* | a count, recorded beside that finding | S |
| 45 | Catalogue the four classes whose only fields are enums, now that enums have landed — `oCTouchDamage.collision`, `zCTriggerList.mode`, `zCCodeMaster`/`zCMessageFilter`'s `onTrigger`/`onUntrigger`. `vobClasses.ts`'s comment still says the catalogue holds no enum, which is stale | §16.3 / §14.1 1.4 | `vobClasses.test.ts` › `oCTouchDamage` is no longer authorable with nothing catalogued, plus a per-key round-trip on a placed VOB and a retail value sweep (the I3/I4 rule) | M |
| 46 | A copy carries its class **properties**, not just its class — `AddVob` then one `SetVobClassProp` per catalogued field, one batch, one undo entry, no new op. `physicsEnabled` stays out (A6 is deferred) | §14.1 1.2 | `ops.test.ts` › a duplicate of a `zCVobLight` carries its range and colour | M |
| 47 | `verify-world-pipeline.js` writes no enum, so the eight enum keys have no file-level end-to-end coverage either — independent of the engine, which stays open | §16.2 | the script writes and reads back `zCVobLight.lightType` and `oCMOB.soundMaterial` | S |
| 48 | The `--counts` fuzz sweep only ever runs against `minimal.g2.zen`; the `npc`, `camera` and `corrupt-mesh` variants exist and §16.11 says a field the sweep cannot reach has no coverage | §16.11 | `fuzz-world.js --counts --fixture npc\|camera\|corrupt-mesh` reports per entry, and every hit lands bounded and covered | M |

## 6. Larger, and worth knowing before you start

| # | Item | Where the diagnosis is | Accept | Size |
|---|---|---|---|---|
| 49 | The grammar takes C-style string escapes, `parser-roundtrip-scope.md` says Daedalus has none, and the generator agrees with the doc. The reference doc is the settled semantics, so this is making the grammar agree — but it needs `tree-sitter generate` and a native rebuild in the same change | 2026-07 **4.18**, `grammar.js:233` | parser › a trailing-backslash string round-trips, then `npm run test:roundtrip-corpus` | L |

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

**And four that a survey found automatable but a person has already ruled on.**
They are omitted deliberately, and each needs one word from Daniel to join:

- **Portal orientation (§16.22 q3)** is not missing — it is a **board card
  already**, and duplicating it here would let a run take it twice.
- **`checkPortalPairing` and `checkPortalPlanarity`** (§16.22 q1, q2): the
  measurements are done and the thresholds settled — 100 % paired, tolerance
  ≥ 12.1 units — and the code needs no decision, but §16.22 reserves *filing
  the card* to Daniel. It also lands unplumbed, as slice 1 did.
- **`checkPortalMaterials`' consumer** (§16.20 slice 3): **deferred 2026-08-29**
  by Daniel, and the reason still holds — a binding readout, a thirteenth
  worker op with its IPC chain, and an undefined part (what framing a polygon
  means). Three workspaces.
- **The ASCII writer's signed `bool:`** (§16.9): **deferred 2026-08-28**, with
  the other two ASCII items. The editor does not save through that path.
