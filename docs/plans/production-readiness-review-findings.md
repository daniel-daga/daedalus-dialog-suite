# Production-Readiness Review — Findings

Review pass over the editor workspace covering production readiness, performance,
UI/UX, and a scoped decision analysis for the quest node viewer/editor
(deprecate vs. extract). Findings are ranked within each section; every claim
carries a file reference.

## Status (2026-08-23)

Review complete; the first remediation slice has landed. Branch:
`claude/production-readiness-review-dw28l0` (no PR opened yet).

Landed:

| Commit | Change |
|---|---|
| `b352fb2` | Backup (`<name>.d.bak`) before force-on-errors saves; corrected encoding-error advice |
| `32a36f0` | Writable quest editing opt-in (flag default off) — §1 Option A |
| `b5c5e3d` | Deleted stale editor `pnpm-lock.yaml` (EOL Electron 29 pin) + unused npm shadow lockfiles |
| `44b1ff5` | Ctrl+S / AppBar Save button + Close Project → welcome screen (F1, F5) |

Verified on the combined tree: full Jest suite (1138 tests), browser-harness
Playwright suite (171 tests), `build:main`, `typecheck:renderer`, and lint
(0 errors; 8 pre-existing warnings in untouched files) all green.

Everything else in this document is still open — §5 is the working priority
list. Owner decisions still outstanding: app icons, the Dandelion vs.
"Daedalus Dialog Editor" naming split, and code signing.

### Environment note for a fresh session

The e2e suites run through `pnpm --filter daedalus-dialog-editor exec playwright`
(a bare `npx playwright` resolves a mismatched runner copy in the remote
container). In this container `/opt/pw-browsers` held Chromium rev 1194 while
Playwright 1.58.1 expected rev 1208; the fix is symlinking the expected
revision directories to the installed binaries. Never run `playwright install`
(`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` is set).

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
2. **Option B — remove the Flow view (recommended).** Delete `QuestFlow.tsx`,
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
6. **No CSP; error-boundary gaps.** No CSP meta or `onHeadersReceived` handler
   anywhere (litegraph would need `unsafe-eval`, but `default-src 'self'` is
   still worth having for a `file://` renderer). The single React error
   boundary wraps only `MainLayout`/welcome (`App.tsx:401`); AppBar, close
   guard, conflict/update dialogs are outside it, and
   `ErrorBoundary.componentDidCatch` never writes to the log file.

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
- **Updater loose ends:** "View release notes" is a no-op
  (`UpdateNotification.tsx:160`; no `shell.openExternal` channel);
  `autoCheckOnStartup`/`dismissedVersion` are persisted but never read — the
  startup check is an unconditional 5s timer (`App.tsx:127-130`) and "Remind
  Me Later" re-prompts every launch.
- **Observability:** main-process fatal errors are log-only by design (no
  dialog/exit, `main.ts:50-59`); no crash reporter (stated privacy choice);
  hand-rolled 1 MiB log rotation. Save-error copy bug: the encoding failure
  message advises converting to UTF-8 (`saveError.ts:51`) while the pipeline
  deliberately writes windows-1252 (`FileService.ts:236`) — wrong advice for
  this toolchain.
- **Distribution:** no macOS target; Linux AppImage declared but never built
  (only `build-windows.yml` exists, dispatch-only); `GITHUB_RUN_NUMBER`-based
  versioning resets if the workflow file is renamed.

---

## 3. Performance

Baseline: `docs/architecture/render-performance.md` remains accurate for what
it covers (merge cache, ActionCard memo boundary, autocomplete pools,
subscription rules — all verified still in place and test-guarded). The
findings below are in paths the doc does not cover.

### P0 — Project open parses every file twice; models retained forever

- `ProjectService.buildProjectIndex` (`ProjectService.ts:68-96`) full-parses
  every `.d` file (metadata pass, model discarded);
  `startBackgroundIngestion` (`projectStore.ts:356-485`) then re-parses every
  file through a *different* worker pool and ships full semantic models over
  IPC. `semanticMetadataUtils.ts:46-69` additionally walks declarations twice
  per file.
- `parsedFiles` grows without bound: `clearCache`/`clearMergedModel` have zero
  external callers; only `closeProject` shrinks it. A 500-file project ⇒
  ~1,000 parses + 500 full-model structured clones + 500 models resident for
  the session.
- Fix direction: single declaration walk; have the index pass return/persist
  the model (keyed path+mtime) so ingestion is a cache read — or drop eager
  ingestion behind `getSemanticModel`'s existing dedup; LRU-cap `parsedFiles`
  with merged-model contributors pinned.

### P0 — File-watcher changes unbatched; each costs O(project)

- Every `fileWatcher:changed` event immediately re-parses and calls
  `projectStore.updateFileModel` (`useFileWatcher.ts:31-63, 95-105`), which
  clones the whole `parsedFiles` Map, scans `dialogIndex` twice (including an
  un-memoized inline rebuild of `filesWithDialogs` at `projectStore.ts:927-930`
  duplicating the WeakMap-cached helper at `:207-217`), and re-merges.
- A `git checkout` touching 500 files fires 500 unbatched O(project) cascades
  with no concurrency cap ⇒ renderer freeze.
- Fix direction: ~250 ms buffer window in `useFileWatcher`, dedupe by path,
  batch store action doing clone/scan/merge once.

### P1

- **Problems panel full-corpus synchronous lint on every `parseGeneration`
  bump** (`ProblemsPanel.tsx:27-33`, `problemsStore.ts:46-64`): during
  ingestion that is every 500 ms over a growing file set — O(n²) across the
  ingestion window, blocking. Fix: debounce, skip while `isIngesting` + run
  once at completion, per-file rule-output cache keyed on model identity.
- **`QuestList` is O(quests × all functions)** (`QuestList.tsx:149-161`,
  `analysis.ts:88-116`), with `findCaseInsensitiveSymbol` falling back to
  `Object.entries` over ~15k constants per miss (`analysis.ts:33-42`), memoized
  on whole-model identity. 200 quests × large corpus ⇒ multi-second stall per
  merged-model identity change. Fix: invert to one pass over functions
  building a quest→signals Map; lazily-built lowercased symbol index; memo on
  category identities.
- **`App` subscribes to the whole `openFiles` Map** (`App.tsx:55-60`) — new Map
  identity per edit flush re-renders the entire tree; `MainLayout`/
  `ThreeColumnLayout` are not memo-wrapped. Contradicts the doc's
  coarse-selector rule (applied to projectStore/historyStore, not fileStore).
  Fix: per-active-file selector + derived conflict count + `React.memo`.

### P2

- **Condition-editing subtree defeats its memos**: `ConditionEditor`/
  `ConditionCard` are `React.memo` with default comparators but take the
  churning `semanticModel` prop (`ConditionEditor.tsx:12,17`,
  `ConditionCard.tsx:17-20`), forcing full ~11k-symbol option re-derivation +
  `localeCompare` sort per keystroke once conditions are expanded
  (`useVariableOptions.ts:677-680`); `conditionsExpanded` is never reset on
  dialog switch. Mirror-image of the ActionCard invariant the doc enshrines.
- **`IngestedFilesDialog`**: unvirtualized full-project `<List>` with in-render
  Map build + sort, subscribed to `parsedFiles` (replaced every 500 ms during
  ingestion — exactly when the dialog is watched)
  (`IngestedFilesDialog.tsx:52-94, 132-201`).
- **`ParserService` round-robin without idle tracking**
  (`ParserService.ts:154-177`): 20 concurrent ingestion requests pile onto ≤8
  workers; one big file head-of-line blocks its queue while others idle.
  `MetadataWorkerPool` already has the correct idle-set + queue pattern to
  port.

### P3

- Litegraph canvas render loop free-runs at 60 fps while the quest view is
  mounted (no `skip_render`; `QuestLiteGraphCanvas.tsx:281`) — moot under §1
  Option B.
- No failing bundle-size guard (rollup's 500 kB warning is grepped in
  `all-tests.yml` but list of lazied components is incomplete:
  `SimulatorDialog`, `DialogSourceViewDialog`, `ReviewChangesDialog` are
  static imports; `mockAPI.ts` (635 lines) ships in the production Electron
  bundle for the `!window.editorAPI` branch).
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
- **F2 — Source Code view commented out, its state machine still live.**
  `MainLayout.tsx:136-162` JSX is commented; `SourceCodeEditor.tsx` (228
  lines) is imported nowhere — but `SourceEditsPendingBanner`, `isSourceDirty`
  close-guard gating, and the app-bar warning icon all remain wired: an
  unreachable-but-blocking state.
- **F3 — Quest canvas silently discards user-drawn edges and Delete-key node
  removals** (no `onConnectionChange`, no key handling;
  `QuestLiteGraphCanvas.tsx:286-379`) — the link exists until the next rebuild
  wipes it. (Resolved by §1 Option B.)
- **F4 — Quest editor cannot author end-to-end**: command set is
  edit-and-remove only (no add-node/add-transition/add-condition); fit/zoom
  test-gated; every mutation routes through a per-field "Preview Diff" modal;
  most inspector fields render one of four read-only excuses. (Feeds the §1
  decision.)
- **F5 — A project can never be closed.** Nothing clears `projectPath`
  (`App.tsx:402`); welcome screen, recent-projects list, and single-file open
  are unreachable after the first open; recent projects can never be used to
  switch.

### P1

- **F6** — Ctrl+F outside the dialog view opens the search panel in a
  `display:none` subtree (`useSearchNavigation.ts:36` on the always-mounted
  `ThreeColumnLayout`): no feedback, panel surprises the user later.
- **F7** — Two undo stacks, one binding: Ctrl+Z always drives *file* history
  (`MainLayout.tsx:97-98`) even in the quest view, where the visible Undo
  button drives *quest-batch* history. Three Undo buttons, two meanings.
- **F8** — `window.confirm` for the project-switch dirty guard
  (`App.tsx:132-145`) vs. the excellent window-close guard
  (`useWindowCloseGuard.tsx`); `VariableManager` uses raw `confirm()`/
  `alert()`.
- **F9** — Dirty state is a color-only icon with a tooltip; no per-file dirty
  indicators; background dirty files invisible.
- **F10/F11** — Zero context menus (`onContextMenu` grep: 0 hits); no Electron
  application menu or accelerators; the rich action-card keyboard grammar
  (`ActionCard.tsx:211-238`) is entirely undiscoverable.
- **F12** — No settings dialog; `autoSaveEnabled`/`autoSaveInterval`,
  `codeSettings`, and the quest feature flag are all persisted or defined but
  have no UI.

### P2/P3

- **F13** — Quest flow + `CodeDiffView` + `DialogSourceViewDialog` hardcode a
  dark palette; visually broken in the shipped Light and Gothic themes.
- **F14/F15** — Three editing paradigms (forms / read-only Monaco / node
  canvas) with no hand-off in one direction and three separate undo models;
  duplicate conflict-resolution UIs with different labels; three parse-error
  surfaces.
- **F16** — Feedback is inconsistent: two Snackbars, 18 components with inline
  Alerts, hover-only error surfaces (`App.tsx:245-266`), one native `alert()`.
- **F17** — Developer vocabulary leaks into product copy ("ComfyUI-style node
  editor defaults", "disabled by feature flag", "only VariableCondition fields
  are editable").
- **F18** — Problems panel silently empty in single-file mode (scans
  `projectStore.parsedFiles` only) with no explanation; `isScanning` tracked
  but never rendered.
- **F19-F22 (a11y)** — litegraph canvas has no role/label/tabIndex/keyboard
  path; global `html { fontSize: 80% }` (`theme.ts:9-16`) shrinks `body2` to
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
3. Quest decision §1: Option A **done**; schedule Option B.
4. Icons + naming decision (Dandelion vs. Daedalus Dialog Editor) — still
   open. **DONE 2026-08-23**: stale editor `pnpm-lock.yaml` and npm shadow
   lockfiles deleted.
5. Signing + R1 release sequencing per the existing release checklist.
6. Packaged-app smoke that opens a real project and parses (closes the
   asar/native-module blind spot).

Post-release fast follows: watcher batching + double-parse collapse (P0 perf),
Problems-panel debounce, `App` `openFiles` selector, F2 dead source-view
cleanup, F6/F7 shortcut scoping, CSP.
