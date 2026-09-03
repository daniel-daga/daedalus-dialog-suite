# Production-Readiness Review — Findings

Review pass over the editor workspace covering production readiness, performance,
UI/UX, and a scoped decision analysis for the quest node viewer/editor
(deprecate vs. extract). Findings are ranked within each section; every claim
carries a file reference.

## Status (2026-08-23)

Review complete; the first remediation slice has landed on `master`
(branches `claude/production-readiness-review-dw28l0` and
`claude/remove-quest-flow-view-l47ye1`, both merged).

Landed:

| Commit | Change |
|---|---|
| `b352fb2` | Backup (`<name>.d.bak`) before force-on-errors saves; corrected encoding-error advice |
| `32a36f0` | Writable quest editing opt-in (flag default off) — §1 Option A |
| `b5c5e3d` | Deleted stale editor `pnpm-lock.yaml` (EOL Electron 29 pin) + unused npm shadow lockfiles |
| `44b1ff5` | Ctrl+S / AppBar Save button + Close Project → welcome screen (F1, F5) |
| (2026-08-23) | §1 Option B: quest Flow view removed (litegraph canvas + inspector + command write path, quest batch history, node-editor playground, `litegraph.js`/`dagre` deps, writable-quest flag). Codec promoted to `quest/domain/conditionExpressionCodec.ts`; quest surface is list/details/create. |
| `635cdd8` | §3 both P0 performance items: single-parse project open (metadata-worker model hand-off, `parsedFiles` LRU cap) + file-watcher change batching via `updateFileModels` |
| `1db5ce1` | §3 all three P1 performance items: Problems-panel scan deferral/debounce + per-file fact cache, `QuestList` single-pass batch analysis, fileStore coarse-selector coverage + memoized layouts |
| `6322a0b` | §3 all three P2 performance items: condition-subtree memo boundary + `conditionsExpanded` reset, `IngestedFilesDialog` virtualization + memoized row derivation, `ParserService` idle-worker dispatch |
| (2026-08-23) | Post-release fast-follows: **F2** dead source-view state machine deleted; **F6** Ctrl+F scoped to the dialog view; **CSP** strict `default-src 'self'` meta, with Monaco moved off the jsdelivr CDN to the app's own origin (and `DialogSourceViewDialog` lazied, closing part of §3 P3) |

Verified after the fast-follow slice: full Jest suite (**1065 tests in 160
suites** — current baseline), browser-harness Playwright suite (**166 tests**),
`build:main`, `typecheck:renderer`, `build:renderer` (no chunk-size or eval
warnings), and lint (0 errors; 7 pre-existing warnings in untouched files) all
green. Earlier counts in this document (1019 tests in 151 suites after Option B)
dropped because Option B deleted ~20 quest-flow Jest suites and 2 Playwright
specs along with the code they covered; the P0/P1 perf slices brought the guard
suites back up to 159/1059, and the P2 slice added
`tests/ConditionEditor.rerender.test.tsx` plus 6 tests across existing suites;
the native-runtime fix then added `tests/nativeParserModuleRegistry.test.ts`
(1068/161). The fast-follow slice then removed 10 tests and 2 suites with the
F2 state machine (5 banner, 2 marker, 2 saveSource-race, 1 conflict-diff — all
lost their premise with the code they covered) and added
`tests/contentSecurityPolicy.test.ts` (7 tests), plus 3 Playwright specs (2 for
F6, 1 asserting Monaco mounts under the CSP). **Lint is now 0 errors and 5
warnings, down from 7** — both dropped warnings were in the deleted
`SourceCodeEditor.tsx`; that drop is expected, not a regression.

**§3 Performance is now closed down to P3** — the P0, P1, and P2 items are all
done; only the §3 P3 measure-first items remain. **The §5 post-release
fast-follow list is now empty too** (F2, F6, and CSP landed 2026-08-23 — see
the table row below). What is still open: the §5 pre-release items, §3 P3, and
the §4 UI/UX findings from F8 onward. Owner decisions still outstanding: app
icons, the Dandelion vs. "Daedalus Dialog Editor" naming split, and code
signing.

### Environment note for a fresh session

The e2e suites run through `pnpm --filter daedalus-dialog-editor exec playwright`
(a bare `npx playwright` resolves a mismatched runner copy in the remote
container). In this container `/opt/pw-browsers` held Chromium rev 1194 while
Playwright 1.58.1 expected rev 1208. Never run `playwright install`
(`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` is set); bridge the revisions instead.
Note the two browsers need *different* treatment — the headless shell changed
its internal layout between revisions, so a plain directory symlink is not
enough for it:

```sh
ln -sfn /opt/pw-browsers/chromium-1194 /opt/pw-browsers/chromium-1208
mkdir -p /opt/pw-browsers/chromium_headless_shell-1208/chrome-headless-shell-linux64
ln -sf /opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell \
  /opt/pw-browsers/chromium_headless_shell-1208/chrome-headless-shell-linux64/chrome-headless-shell
```

Substitute the revision numbers the error message names.

**Native tree-sitter runtime must load once per process (fixed 2026-08-23).**
An earlier revision of this note claimed intermittent `ProjectService` failures
were an environmental flake to be ignored. That was wrong, and the note is
corrected here: it was a real, reproducible bug that turned CI red on master.
`tree-sitter@0.21.1`'s JS wrapper is not idempotent — it reads the native
members off `Tree.prototype` and replaces them with accessors closing over what
it read. The `.node` addon is cached once per process but JS module registries
are not (Jest gives every test file its own), so a second evaluation reads
`rootNode` back through the first evaluation's accessor with
`this === Tree.prototype`, fails its `this instanceof Tree` guard, captures
`undefined`, and reinstalls the accessor over it — after which `tree.rootNode`
is `undefined` for every parse in the process, including parsers created
earlier. `ProjectService.buildProjectIndex` swallows the resulting per-file
errors into `metadataFailures`, so it surfaced as an inexplicably empty index.
Fixed in `daedalus-parser/src/core/parser.js` by anchoring the single
`require('tree-sitter')` on the daedalus native binding (a `Symbol.for` key on
the one genuinely process-global object), so the wrapper evaluates exactly once
per process. Guarded by `daedalus-parser/test/parser.test.js` ("native runtime
across module registries") and
`daedalus-dialog-editor/tests/nativeParserModuleRegistry.test.ts`, which uses
`jest.isolateModules` to reproduce it deterministically rather than depending on
how Jest packs files into workers.

Lesson for a fresh session: suite-ordering-dependent failures here are worth
root-causing, not writing off. A green full-suite run proves little on its own —
re-run it, and vary `--maxWorkers`/`--runInBand`, which is what exposed this.

---

## 1. Quest node viewer/editor — deprecate vs. extract

### Decision summary

**Recommendation: remove the Flow view (litegraph canvas + inspector + command
write path) from this package; keep quest list/details/create and the quest
domain analysis code. Do not extract the full quest editor into another package
first — the extraction cost is high and mostly wasted.** An immediate, nearly
free stopgap exists: flip the writable-quest-editor default to off, which turns
the Flow view read-only without touching anything else.

### Evidence for the decision

**Scope on disk.** Quest code totals ~8,200 LOC of source (~3,400 domain/app,
~1,600 canvas+inspector, ~830 `QuestFlow.tsx`, ~910 list/details/create,
plus playground entries) and ~6,100 LOC of tests (25 of 163 Jest files — 20% of
the Jest suite by LOC — plus 3 CI-sharded Playwright specs).

**What is cleanly separable today:**
- `quest/domain/` is genuinely pure: zero React/MUI/zustand/electron/litegraph
  imports, enforced by `tests/questDomainBoundary.test.ts`. Only deps: `dagre`,
  type-only imports of `types/global`, `utils/questIdentity`, and one physical
  inversion (`quest/domain/analysis.ts:2` imports the pure
  `components/actionTypes` module).
- `quest/application/QuestEditingService.ts` (74 LOC) is fully
  dependency-injected — no store imports.
- `QuestLiteGraphCanvas.tsx` imports only MUI `Box`, litegraph, and quest types.

**What is entangled (the real extraction cost):**
- `components/QuestFlow.tsx` (834 LOC) is the seam: direct reads of
  `fileStore` (8 imperative `getState()` calls), `historyStore` (7
  quest-specific actions), `projectStore`, `useNavigation`,
  `pendingEditFlushRegistry`, and `window.editorAPI.generateCode`. Extraction
  means designing a host-adapter interface for ~12 store operations.
- `historyStore.ts`: ~120 of 633 lines are quest-specific
  (`questBatchHistory`, `questNodePositions`, batch undo/redo API at
  `historyStore.ts:51-74`), and the *shared* snapshot type carries quest node
  positions (`historyStore.ts:98-103`). The documented direction of travel is
  *more* integration ("slice 5 replaces [the interim guard] with a unified
  per-file timeline" — `docs/architecture/quest-editor.md`), not less.
- The dialog simulator now depends on quest domain code:
  `simulator/domain/conditionEvaluator.ts:2` imports
  `parseConditionExpressionToConditions` from
  `quest/domain/commands/conditionExpressionCodec`. Any removal/extraction must
  first promote the codec (295 LOC) to a shared module.
- `QuestEditor.tsx` / `QuestList.tsx` / `QuestDetails.tsx` /
  `CreateQuestDialog.tsx` (911 LOC) sit at `components/` root, outside the
  documented boundary, wired straight into `projectStore` and
  `uiSelectionStore` (already flagged in
  `docs/plans/code-review-2026-07-remediation.md:238`).

**Why the Flow view specifically is the maintenance sink:**
- It rides on a pinned litegraph.js 0.7.18 and explicitly relies on that
  version's internals (`visible_links`, `link._pos`, `showLinkMenu` — see the
  Canvas Interaction Contract in `docs/architecture/quest-editor.md`).
  litegraph carries bespoke build machinery: two `manualChunks` entries and an
  `onwarn` eval filter (`vite.config.ts:6-10, 32-33, 39-44`) plus a CI eval
  whitelist (`.github/workflows/all-tests.yml:52-58`). `dagre` and
  `litegraph.js` are used nowhere else in the app.
- As an authoring surface it is incomplete (see §4/F3-F4): the command set is
  edit-and-remove only — no add-node/add-transition/add-condition — so a quest
  cannot be authored end-to-end in the graph; the canvas silently discards
  user-drawn edges and Delete-key removals
  (`QuestLiteGraphCanvas.tsx:286-379` wires no `onConnectionChange`);
  fit-to-view/zoom controls are test-gated (`:384`); the palette is hardcoded
  dark and breaks in the Light/Gothic themes (`QuestFlow.tsx:713-775`); the
  canvas is fully inaccessible (bare `<canvas>`, no keyboard path).
- It is not the active development front: the last quest-focused commit is
  `b0408f4`; ~12 subsequent feature commits touched no quest code. Open
  remediation items 4.4, 4.7-4.10, 5.2, 5.7, 6.1 in
  `docs/plans/code-review-2026-07-remediation.md` are all quest-flow debt.

**Why not outright full deprecation:** the quest list/details/create surface is
cheap, decoupled from litegraph, and load-bearing (`projectStore.createQuest`,
`getQuestUsage`, `loadQuestData`); `utils/questLogFiles` + `RegisterTopicDialog`
belong to the dialog editor and must survive regardless; quest analysis powers
the quest list; and the codec powers the simulator.

### Options ladder

1. **Option A — flag off (immediate, ~free). DONE 2026-08-23:** the default in
   `config/features.ts` is now **false** — writable quest editing is opt-in via
   `VITE_WRITABLE_QUEST_EDITOR` or the `feature.writableQuestEditor`
   localStorage key; write-path Playwright coverage opts in explicitly.
   Original rationale: `isWritableQuestEditorEnabled()`
   previously defaulted to **true** (`config/features.ts:40`); no `.env` or CI
   job sets `VITE_WRITABLE_QUEST_EDITOR`. Changing the default to false makes
   the Flow view read-only (write gate only — the canvas still mounts;
   read-only banner at `QuestFlow.tsx:768-772`, behavior already covered by
   `tests/features.test.ts` and `node-editor.spec.ts`). Buys: eliminates the
   multi-file write path (guardrails/batch-history/TOCTOU surface) from the
   first release. Costs: nothing removed; litegraph still ships.
2. **Option B — remove the Flow view (recommended). DONE 2026-08-23** (as
   specified below; `quest/domain/guardrails.ts` went with the write path it
   guarded, and `historyUtils.ts` was folded into `historyStore.ts`; the
   renderer bundle shrank from 1,663 kB to 962 kB). Delete `QuestFlow.tsx`,
   `components/QuestEditor/` (canvas + inspector), `quest/domain/commands/`
   (except `conditionExpressionCodec`, promoted to a shared location for the
   simulator), quest batch history in `historyStore` (~120 lines), the
   `node-editor.html` playground entry, `litegraph.js` + `dagre`, both
   `manualChunks` entries, the vite `onwarn` eval filter, and the CI eval
   whitelist. Keep: quest list/details/create, `quest/domain` analysis/graph
   inference (the list still needs `analyzeQuest`), `types/questGraph`.
   Removes ~4,500 LOC source + ~4,000 LOC tests and 100% of the exotic
   dependency surface. Also cancels the planned "unified per-file timeline"
   history work in its quest-batch form.
3. **Option C — extract to a workspace package (`daedalus-quest-graph`).**
   Realistic scope: ~8,200 LOC source + ~6,100 LOC tests to relocate; the hard
   parts are refactoring `QuestFlow` into a props-driven component behind a
   host adapter (~12 operations) and deciding the history story (extract quest
   batch history behind an interface vs. leaving it host-side). Precondition
   either way: shared types package for `SemanticModel` et al. (note
   `src/shared/types.ts` already duplicates these for the main process) and
   promoting `conditionExpressionCodec`. Only worth it if the graph editor has
   a product future — in which case a standalone tool consuming
   `daedalus-parser` directly (the `node-editor.html` playground proves the
   shape) is a better home than an embedded package.

Suggested sequencing: **A now (pre-release risk cut), B as the scope decision,
C only if a second consumer materializes.** The pure domain extracts cleanly at
any later date; nothing in B forecloses C.

---

## 2. Production readiness

### Blockers for a first release (ranked)

1. **No backup-on-save.** `FileService.ts` has no `.bak`/versioned-copy path.
   The `forceOnErrors` "Save anyway (drops unparsed content)" flow
   (`main.ts:255`) irreversibly destroys unparsed hand-written script content
   on disk. For modders editing irreplaceable scripts this is the top
   data-safety gap. (Atomic write itself is solid: temp+fsync+rename with
   Windows EPERM retry, `FileService.ts:72-103`, matching
   `docs/architecture/save-pipeline.md`.)
2. **Unsigned installer + live R1 hash tolerance on a single mutable tag.**
   `UpdaterService.ts:270-278` proceeds on missing `sha256` (warn only); no
   Authenticode/signature verification exists; `build.win` has no signing
   config; the feed is one mutable `windows-latest` tag with no versioned
   fallback. Combined: an unauthenticated path to
   `spawn(installer, ['/S'])`. All parked in `docs/release-checklist.md` —
   correctly sequenced (R1→R2), but it is the release-critical chain.
3. **Packaged app never exercises a real parse in CI.** The only packaged-app
   check is an 8-second liveness launch (`build-windows.yml:154-169`); the
   real-Electron E2E suite runs against unpackaged `dist/`
   (`playwright.electron.config.ts:5-11`). With `npmRebuild: false` and a
   hand-maintained `files` allowlist (`package.json:47-54`, asar check covers
   only `safe-buffer`/`safer-buffer`), native-module inclusion in the asar is
   asserted nowhere.
4. **No app icons; branding split.** `directories.buildResources: "assets"`
   points at a directory that does not exist; no `win.icon`/`linux.icon` — the
   installer ships the default Electron icon. `productName` is "Daedalus
   Dialog Editor" while the UI says "Dandelion" (`index.html:6`, welcome
   screen).
5. **Stale nested lockfile pins Electron 29.** `daedalus-dialog-editor/pnpm-lock.yaml`
   resolves `electron@29.4.6` (EOL) while `package.json` wants `^43.0.0`. CI
   installs from the workspace root (gets 43), but any install run inside the
   workspace dir pulls Electron 29 or fails `--frozen-lockfile`. The file
   should not exist in a pnpm workspace. Related hygiene: root
   `package-lock.json` + `daedalus-parser/package-lock.json` are unmaintained
   npm shadows; stray `debug_file.ts` (broken import) and `win1250.d` are
   git-tracked at the editor root.
6. **~~No CSP~~ (DONE 2026-08-23); error-boundary gaps (still open).**
   ~~No CSP meta or `onHeadersReceived` handler anywhere.~~ A strict
   `default-src 'self'` with no eval escape hatch now ships as a `<meta>` tag in
   `src/renderer/index.html`; documented in
   `docs/architecture/security-model.md`, guarded by
   `tests/contentSecurityPolicy.test.ts` and a Playwright spec that asserts
   Monaco actually mounts under it.

   Two corrections to this item as written. **(a)** The eval half of the claim
   was right and is now verified empirically (zero `eval(`/`new Function(` in
   every emitted chunk), but eval was never the blocker: `@monaco-editor/react`
   is used *without* a bundled `monaco-editor`, so it fetched Monaco from the
   jsdelivr CDN at runtime — the real blocker was a remote **`script-src`**
   origin. Resolved by serving Monaco from the app's own origin rather than by
   widening the policy, which also removes the offline stall. **(b)**
   `onHeadersReceived` was never a viable delivery mechanism here — it does not
   fire for `file://`, which is how production loads the renderer.

   ~~Still open: the single React error boundary wraps only `MainLayout`/welcome
   (`App.tsx`); AppBar, close guard, conflict/update dialogs are outside it, and
   `ErrorBoundary.componentDidCatch` never writes to the log file.~~ **FIXED
   2026-08-29** — `App` is now an outer `ErrorBoundary` around `AppContent`, so a
   throw in the chrome shows the fallback instead of blanking the window (the
   inner boundary still keeps the chrome alive when only `MainLayout` fails), and
   `componentDidCatch` forwards message + error stack + component stack through
   `logRendererError` — the only path that reaches the log file, since a boundary
   swallows the error before `window.onerror` sees it. Guarded by
   `tests/App.errorBoundary.test.tsx` and `tests/ErrorBoundary.logging.test.tsx`.

### Solid (verified against `docs/architecture/security-model.md` — claims true)

- `contextIsolation: true`, `nodeIntegration: false` (`main.ts:88-96`);
  window-open denied and navigation pinned (`windowSecurity.ts:10-22`,
  E2E-verified). `sandbox` is implicit (Electron ≥20 default) — worth setting
  explicitly and asserting.
- Preload surface is 22 `invoke`/`send` methods, no raw `ipcRenderer`;
  documented channel removals confirmed absent.
- IPC validation (`ipcValidation.ts`) matches the doc; one stray:
  `parser:parseSource` (`main.ts:174`) takes an unvalidated string (worker
  fails safe).
- `PathValidationService` symlink-aware containment, write-mode lstat
  rejection, recent-project-gated `addAllowedPath` — all verified.
- Settings: atomic temp+rename+fsync, mutex, corrupt-file preservation. Minor:
  fixed `.tmp` path collides across two app instances.
- Updater transport: HTTPS-only, URL pinning, streaming sha256 + size checks,
  unlink-on-fail, install-time re-hash, temp-dir containment.
- Release gating: `needs` on full test matrix, master-ref guard, concurrency
  group, stale-run `ls-remote` guard, post-publish digest re-verification —
  all present as documented (though the maintainer dispatch checklist proving
  the guards fire has never been executed).

### Gaps (non-blocking but real)

- **Encoding-detection false positive:** `detectCentralEuropeanPattern`
  (`encodingUtils.ts:18-48`) flips cp1252→cp1250 if any single byte from a
  27-byte list (including `è`, `È`, `Ø`, `Ý` in cp1252) appears in the first
  256 KB — one French/Nordic char reinterprets the whole file (display/codegen
  mojibake; disk bytes still round-trip). The false-positive direction is
  untested.
- **Windows junction blind spot:** `ProjectService.scanDirectory`
  (`ProjectService.ts:28-54`) recurses only on `isDirectory()` — junctions
  report `isSymbolicLink()`, so junctioned script trees are silently skipped
  and read errors are swallowed (`:47-49`). The release checklist expects a
  readable error here; the index path fails silently before
  `PathValidationService` ever runs.
- **Updater loose ends:** ~~"View release notes" is a no-op
  (`UpdateNotification.tsx:160`; no `shell.openExternal` channel)~~ — **FIXED
  2026-09-03** (unattended-queue row 37): `shell:openExternal`, https-only at
  `assertExternalUrl`. ~~`autoCheckOnStartup`/`dismissedVersion` are persisted but never read
  — the startup check is an unconditional 5s timer (`App.tsx:127-130`) and
  "Remind Me Later" re-prompts every launch.~~ **FIXED 2026-08-29** — both are
  read in `UpdaterService.checkForUpdate` (the startup timer is its only
  caller, so the settings stay a main-process fact and need no getter channel):
  `autoCheckOnStartup: false` returns before the first HTTPS call, and a
  `latestVersion` equal to `dismissedVersion` is not offered while a newer build
  still is. The button that was "Remind Me Later" is now "Skip This Version" and
  writes the setting through the new `updater:dismissVersion` channel — the old
  label promised a re-prompt the persisted setting cannot express. Guarded by
  `tests/services/UpdaterService.test.ts` and
  `tests/UpdateNotification.dismiss.test.tsx`; documented in
  `docs/architecture/security-model.md`.
- **Observability:** main-process fatal errors are log-only by design (no
  dialog/exit, `main.ts:50-59`); no crash reporter (stated privacy choice);
  hand-rolled 1 MiB log rotation. ~~Save-error copy bug: the encoding failure
  message advises converting to UTF-8 (`saveError.ts:51`) while the pipeline
  deliberately writes windows-1252 (`FileService.ts:236`) — wrong advice for
  this toolchain.~~ **NOT REPRODUCIBLE 2026-08-29** — the copy bug was already
  gone when the card was picked up: `describeSaveError`'s `'encoding'` case
  names windows-1252 as the format Gothic tooling requires and advises removing
  or replacing the offending characters, and no "UTF-8" advice survives anywhere
  in `src/`. The finding was written against an older revision; no code changed
  for it.
- **Distribution:** no macOS target; Linux AppImage declared but never built
  (only `build-windows.yml` exists, dispatch-only); `GITHUB_RUN_NUMBER`-based
  versioning resets if the workflow file is renamed.

---

## 3. Performance

Baseline: `docs/architecture/render-performance.md` remains accurate for what
it covers (merge cache, ActionCard memo boundary, autocomplete pools,
subscription rules — all verified still in place and test-guarded). The
findings below are in paths the doc does not cover.

### P0 — Project open parses every file twice; models retained forever — **RESOLVED 2026-08-23**

- ~~`ProjectService.buildProjectIndex` full-parses every `.d` file (metadata
  pass, model discarded); `startBackgroundIngestion` then re-parses every file
  through a *different* worker pool; `semanticMetadataUtils` additionally walks
  declarations twice per file. `parsedFiles` grows without bound.~~
- **Fixed as suggested**: single declaration walk
  (`extractInstanceAndPrototypeDeclarations`); the metadata worker returns the
  model it already built plus the file's mtime, `ProjectService` primes a
  path+mtime hand-off cache (take-once semantics, cap 512, error files never
  primed), and `project:parseDialogFile` serves from it — background ingestion
  is now a cache read, so a 500-file open costs ~500 parses instead of ~1,000.
  `parsedFiles` is LRU-capped at `PARSED_FILES_CAP` (512) with merged-model
  contributors (globals, selected NPC files, quest files) pinned; eviction
  self-heals via NPC-select `getSemanticModel`. Guarded by
  `tests/ProjectService.modelHandoff.test.ts` and
  `tests/projectStore.parsedFilesCap.test.ts`; documented in
  `docs/architecture/render-performance.md`.

### P0 — File-watcher changes unbatched; each costs O(project) — **RESOLVED 2026-08-23**

- ~~Every `fileWatcher:changed` event immediately re-parses and calls
  `projectStore.updateFileModel`, which clones the whole `parsedFiles` Map,
  scans `dialogIndex` twice (including an un-memoized inline rebuild of
  `filesWithDialogs` duplicating the WeakMap-cached helper), and re-merges —
  500 unbatched O(project) cascades on a 500-file `git checkout`.~~
- **Fixed as suggested**: `useFileWatcher` buffers 'change' events for 250 ms,
  dedupes by path, re-parses with bounded concurrency (8), and applies the
  batch via the new `projectStore.updateFileModels` — one `parsedFiles` clone,
  one dialog-set scan, one `parseGeneration` bump, at most one re-merge; the
  inline `filesWithDialogs` rebuild now uses the WeakMap-cached helper.
  `updateFileModel` (the storeSync keystroke path) delegates with one entry.
  Guarded by `tests/useFileWatcher.batching.test.ts` and
  `tests/projectStore.updateFileModels.test.ts`; documented in
  `docs/architecture/render-performance.md`.

### P1

- ~~**Problems panel full-corpus synchronous lint on every `parseGeneration`
  bump** (`ProblemsPanel.tsx:27-33`, `problemsStore.ts:46-64`): during
  ingestion that is every 500 ms over a growing file set — O(n²) across the
  ingestion window, blocking.~~ **RESOLVED 2026-08-23** — fixed as suggested
  with one refinement: scans are deferred while `isIngesting` (one scan at
  completion) and debounced 300 ms outside it (`problemsStore.requestScan`;
  manual Rescan stays synchronous), but the per-file cache holds *facts*
  (the expensive per-file walks, `problems/domain/fileFacts.ts`, WeakMap on
  model identity), not rule output — every rule has cross-file inputs, so
  cross-file aggregation re-runs per scan and results stay byte-identical.
  Guarded by `tests/problemsStore.scanScheduling.test.ts` and
  `tests/ProblemsPanel.scanScheduling.test.tsx`; documented in
  `docs/architecture/render-performance.md`. (F18 single-file-mode emptiness
  left as-is, per scope.)
- ~~**`QuestList` is O(quests × all functions)** — still open, and now the
  quest view's only perf risk since Option B (`QuestList.tsx:149-161`,
  `analysis.ts:88-116`), with `findCaseInsensitiveSymbol` falling back to
  `Object.entries` over ~15k constants per miss (`analysis.ts:33-42`), memoized
  on whole-model identity. 200 quests × large corpus ⇒ multi-second stall per
  merged-model identity change.~~ **RESOLVED 2026-08-23** — fixed as
  suggested: `analyzeQuests` batch API (one pass over functions, no dialog
  walk — the per-quest `getQuestReferences` fallback fed a provably
  unreachable `'implicit'` branch), WeakMap-cached lowercased symbol index,
  and QuestList memos keyed on `constants`/`variables`/`functions`
  identities. Guarded by `tests/questAnalysis.test.ts` (batch/per-quest
  equivalence + single-pass proxy counters) and
  `tests/QuestList.perf.test.tsx`; documented in
  `docs/architecture/render-performance.md`.
- ~~**`App` subscribes to the whole `openFiles` Map** (`App.tsx:55-60`) — new Map
  identity per edit flush re-renders the entire tree; `MainLayout`/
  `ThreeColumnLayout` are not memo-wrapped. Contradicts the doc's
  coarse-selector rule (applied to projectStore/historyStore, not fileStore).~~
  **RESOLVED 2026-08-23** — fixed as suggested, and widened to every other
  render-time whole-Map subscription that would have kept the tree
  re-rendering: App selects the active file's entry + a shallow-compared
  conflict-path array; `MainLayout`/`ThreeColumnLayout` are memo-wrapped
  behind the primitive `filePath` prop; `useAutoSave` moved to a transient
  `store.subscribe`, `useWindowCloseGuard` subscribes only while its dialog
  is open, `ExternalChangeConflictDialog`/`SourceEditsPendingBanner` use
  per-file selectors, `useDialogFactory` reads live `getFileState`. Guarded
  by render-count probes in `tests/App.fileStoreSubscription.test.tsx`,
  `tests/MainLayout.rerender.test.tsx`,
  `tests/ThreeColumnLayout.rerender.test.tsx`; documented in
  `docs/architecture/render-performance.md`.

### P2 — **RESOLVED 2026-08-23**

- ~~**Condition-editing subtree defeats its memos**: `ConditionEditor`/
  `ConditionCard` are `React.memo` with default comparators but take the
  churning `semanticModel` prop, forcing full ~11k-symbol option re-derivation +
  `localeCompare` sort per keystroke once conditions are expanded;
  `conditionsExpanded` is never reset on dialog switch. Mirror-image of the
  ActionCard invariant the doc enshrines.~~ **RESOLVED** — fixed per the
  ActionCard template: the `semanticModel` prop is removed from
  `ConditionEditor`/`ConditionCard`/`ConditionFieldsProps` and all condition
  field components (`ConditionSection` uses it only to resolve the condition
  function); the autocomplete leaves read model data via `useVariableOptions`'
  per-category pooled subscriptions; `conditionsExpanded` resets via an effect
  keyed on `dialogName` (the `propertiesExpanded` idiom). Guarded by
  `tests/ConditionEditor.rerender.test.tsx`; documented in
  `docs/architecture/render-performance.md`.
- ~~**`IngestedFilesDialog`**: unvirtualized full-project `<List>` with in-render
  Map build + sort, subscribed to `parsedFiles` (replaced every 500 ms during
  ingestion — exactly when the dialog is watched).~~ **RESOLVED** — virtualized
  with the `QuestList` `react-window` idiom (`AutoSizer` + `FixedSizeList`,
  memoized row, path-keyed); Map build + sort hoisted into `useMemo`s keyed on
  the identities read; open-gated subscription unchanged. Guarded by
  bounded-row-count and derivation-counter probes in
  `tests/IngestedFilesDialog.rerender.test.tsx`; documented in
  `docs/architecture/render-performance.md`.
- ~~**`ParserService` round-robin without idle tracking**: 20 concurrent
  ingestion requests pile onto ≤8 workers; one big file head-of-line blocks its
  queue while others idle. `MetadataWorkerPool` already has the correct
  idle-set + queue pattern to port.~~ **RESOLVED** — ported as suggested:
  idle-set + single shared FIFO queue; timeouts start at assignment; at most
  one in-flight request per worker so crash/timeout rejects only that request;
  crash/respawn, restart-cap degradation, and dispose semantics preserved.
  Guarded by a deterministic head-of-line-blocking test in
  `tests/services/ParserService.test.ts`; documented in
  `docs/architecture/render-performance.md`.

### P3

- ~~Litegraph canvas render loop free-runs at 60 fps while the quest view is
  mounted.~~ **RESOLVED 2026-08-23** by §1 Option B (canvas deleted).
- No failing bundle-size guard (rollup's 500 kB warning is grepped in
  `all-tests.yml` but list of lazied components is incomplete:
  `SimulatorDialog` and `ReviewChangesDialog` are
  static imports; `mockAPI.ts` (635 lines) ships in the production Electron
  bundle for the `!window.editorAPI` branch). **Partially addressed
  2026-08-23**: `DialogSourceViewDialog` is now `React.lazy` + `open`-gated
  (entry chunk 416 kB → 397 kB), landed alongside the CSP work. Measured while
  doing it, and worth recording against the assumption in the old Monaco note:
  lazy-splitting does **not** satisfy the chunk-size guard for an over-size
  dependency — the limit is per emitted chunk, so a bundled Monaco simply became
  a 3,825 kB lazy chunk. That is why Monaco ships as static assets instead of
  being bundled at all (see `docs/architecture/render-performance.md`).
- `ensureActionIds` is O(functions × dialogs) on every `openFile`
  (`fileStore.ts:88-97, 367-372`), including cache-hit opens.
- Unbounded module-level `fileEncodingCache`/`fileStatCache` in `FileService`
  (trivial at current scale).
- Verified clean: search chunking + virtualization, undo snapshots
  (reference-shared, 50-cap), autosave debounce, history memory model.

---

## 4. UI/UX

### P0

- **F1 — No user-invocable save.** No Ctrl+S handler exists in any mounted
  component; the only one lives in dead code (`SourceCodeEditor.tsx:139`).
  Persistence is autosave-only (`useAutoSave`, 2 s), which *refuses* to run
  exactly when the user most needs to force a save (`hasErrors`,
  `autoSaveError`, `externalConflict` — `useAutoSave.ts:19-25`). The app-bar
  tooltip advertises "Ctrl+S to save" (`App.tsx:268`) and Ctrl+S does nothing.
- ~~**F2 — Source Code view commented out, its state machine still live.**
  `MainLayout.tsx:136-162` JSX is commented; `SourceCodeEditor.tsx` (228
  lines) is imported nowhere — but `SourceEditsPendingBanner`, `isSourceDirty`
  close-guard gating, and the app-bar warning icon all remain wired: an
  unreachable-but-blocking state.~~ **RESOLVED 2026-08-23** — the state machine
  was deleted rather than the view restored (the view was deliberately commented
  out, and read-only source viewing already exists via
  `DialogSourceViewDialog`). Gone: `SourceCodeEditor.tsx`,
  `SourceEditsPendingBanner.tsx`, `sourceEditorMarkers.ts` (orphaned by the
  first), `fileStore`'s `workingCode` / `blockedBySourceEdit` / `isSourceDirty` /
  `refuseMutationIfSourceDirty` (10 guard sites + 10 buffer resets) /
  `setWorkingCode` / `adoptWorkingCode` / `saveSource`, the `saveSource` branches
  in `useManualSave` and `useWindowCloseGuard`, App's source-dirty tooltip/icon
  branches, and the `'source'` `activeView` variant. `hasUnsavedChanges` is now
  `isDirty || externalConflict`. Guarded by the removal assertions in
  `tests/fileStore.dirtyTracking.test.ts`.
- **F3 — Quest canvas silently discards user-drawn edges and Delete-key node
  removals** (no `onConnectionChange`, no key handling;
  `QuestLiteGraphCanvas.tsx:286-379`) — the link exists until the next rebuild
  wipes it. (Resolved by §1 Option B.)
- **F4 — Quest editor cannot author end-to-end**: command set was
  edit-and-remove only (no add-node/add-transition/add-condition); fit/zoom
  test-gated; every mutation routed through a per-field "Preview Diff" modal;
  most inspector fields rendered one of four read-only excuses. (Fed the §1
  decision; **RESOLVED 2026-08-23** by Option B — the half-built authoring
  surface is gone rather than finished.)
- **F5 — A project can never be closed.** Nothing clears `projectPath`
  (`App.tsx:402`); welcome screen, recent-projects list, and single-file open
  are unreachable after the first open; recent projects can never be used to
  switch.

### P1

- ~~**F6** — Ctrl+F outside the dialog view opens the search panel in a
  `display:none` subtree (`useSearchNavigation.ts:36` on the always-mounted
  `ThreeColumnLayout`): no feedback, panel surprises the user later.~~
  **RESOLVED 2026-08-23** — the handler reads `activeView` live (`getState`, not
  a subscription, so a view switch does not re-run the effect) and ignores
  Ctrl+F outside the dialog view. Guarded by two specs in
  `tests/e2e/search.spec.ts`: the regression asserts the panel is absent both
  while another view is active *and* after switching back (that second
  assertion is the one that was red — the "surprises the user later" half), plus
  a positive control that the shortcut still works after a view round-trip.
- ~~**F7** — Two undo stacks, one binding: Ctrl+Z always drives *file* history
  even in the quest view, where the visible Undo button drives *quest-batch*
  history.~~ **RESOLVED 2026-08-23** by §1 Option B: quest batch history was
  deleted, so Ctrl+Z and the per-file history are the single undo model.
- **F8** — `window.confirm` for the project-switch dirty guard
  (`App.tsx:132-145`) vs. the excellent window-close guard
  (`useWindowCloseGuard.tsx`); `VariableManager` uses raw `confirm()`/
  `alert()`.
- **F9** — Dirty state is a color-only icon with a tooltip; no per-file dirty
  indicators; background dirty files invisible.
- **F10/F11** — Zero context menus (`onContextMenu` grep: 0 hits); no Electron
  application menu or accelerators; the rich action-card keyboard grammar
  (`ActionCard.tsx:211-238`) is entirely undiscoverable.
- **F12** — No settings dialog; `autoSaveEnabled`/`autoSaveInterval` and
  `codeSettings` are persisted or defined but have no UI. (The quest feature
  flag that was also listed here was deleted with Option B.)

### P2/P3

- **F13** — `CodeDiffView` + `DialogSourceViewDialog` hardcode a dark palette;
  visually broken in the shipped Light and Gothic themes. (Narrowed by Option
  B — the quest flow palette went with the view; these two remain.)
- **F14/F15** — Narrowed by Option B to two editing paradigms (forms /
  read-only Monaco) and one undo model; the node canvas and its separate undo
  model are gone. Still open: duplicate conflict-resolution UIs with different
  labels, and three parse-error surfaces.
- **F16** — Feedback is inconsistent: two Snackbars, 18 components with inline
  Alerts, hover-only error surfaces (`App.tsx:245-266`), one native `alert()`.
- ~~**F17** — Developer vocabulary leaks into product copy ("ComfyUI-style
  node editor defaults", "disabled by feature flag", "only VariableCondition
  fields are editable").~~ **RESOLVED 2026-08-23** by §1 Option B — all three
  strings lived in the Flow view / inspector; none survives in `src/`.
- **F18** — Problems panel silently empty in single-file mode (scans
  `projectStore.parsedFiles` only) with no explanation; `isScanning` tracked
  but never rendered.
- **F19-F22 (a11y)** — the inaccessible litegraph canvas (no
  role/label/tabIndex/keyboard path) went with Option B; the rest stands:
  global `html { fontSize: 80% }` (`theme.ts:9-16`) shrinks `body2` to
  ~11px with explicit 9px labels on top; highest-stakes dialogs (close guard,
  conflict, delete confirm) lack `autoFocus`/`aria-describedby`; clickable
  `Box` headers without button semantics.

### Genuinely well-built (the quality bar to hold)

Window-close guard (flushes debounced edits, lists dirty files with causes,
inline conflict resolution, never approves close on failed save);
external-change conflict dialog with real before/after diff; determinate
project-open progress; parse-error honesty (autosave hard-refuses on
`hasErrors`, banner states data-loss consequence plainly); action-card keyboard
grammar; Problems panel matching its spec.

---

## 5. Suggested priority order

Pre-release (gates first public build):
1. **DONE 2026-08-23** — Backup-on-save for the `forceOnErrors` path
   (`<name>.d.bak`, refuse save on backup failure; see
   `docs/architecture/save-pipeline.md`).
2. **DONE 2026-08-23** — Ctrl+S + actionable AppBar Save button
   (`useManualSave`, honest tooltips) and Close Project → welcome screen
   (`closeProject` now also resets `questFiles`) (F1 + F5).
3. Quest decision §1: Option A **done**; Option B **done 2026-08-23**.
4. Icons + naming decision (Dandelion vs. Daedalus Dialog Editor) — still
   open. **DONE 2026-08-23**: stale editor `pnpm-lock.yaml` and npm shadow
   lockfiles deleted.
5. Signing + R1 release sequencing per the existing release checklist.
6. Packaged-app smoke that opens a real project and parses (closes the
   asar/native-module blind spot).

Post-release fast follows: ~~watcher batching + double-parse collapse (P0
perf)~~ **DONE 2026-08-23** (both §3 P0 items — single-parse project open with
model hand-off + `parsedFiles` cap, and watcher batching via
`updateFileModels`), ~~Problems-panel debounce, `App` `openFiles` selector~~
**DONE 2026-08-23** (all three §3 P1 items — Problems-panel scan
deferral/debounce + fact cache, QuestList single-pass batch analysis, and
fileStore coarse-selector coverage with memoized layouts), ~~§3 P2 perf
items~~ **DONE 2026-08-23** (condition-subtree memo boundary +
`conditionsExpanded` reset, IngestedFilesDialog virtualization, ParserService
idle-worker dispatch), ~~F2 dead source-view cleanup, F6/F7 shortcut scoping,
CSP~~ **DONE 2026-08-23** (F2: the source-editing state machine deleted, not
restored; F6: Ctrl+F scoped to the dialog view — F7 was already closed by
Option B; CSP: strict `default-src 'self'` meta, which required moving Monaco
off the jsdelivr CDN to the app's own origin).

**The post-release fast-follow list is now empty.** What remains in this
document is the pre-release list above (icons + naming, signing + R1
sequencing, packaged-app parse smoke), §3's P3 measure-first items, and the
§4 P1-P3 UI/UX findings from F8 onward.
