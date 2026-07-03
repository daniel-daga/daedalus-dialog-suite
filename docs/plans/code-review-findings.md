# Daedalus Dialog Suite — Production-Readiness Code Review

Date: 2026-07-02 · Scope: full monorepo (`daedalus-parser`, `daedalus-dialog-editor`), tests, CI, packaging.
Method: five parallel subsystem reviews (parser semantics/codegen, Electron main process, renderer state layer, renderer UI, QA/delivery). Parser findings marked "verified" were confirmed by running actual parse→generate roundtrips; the editor Jest suite (675 passed / 91 suites) and parser suite (199/201, 2 env-artifact failures) were executed in this environment.

---

## Verdict

**Not production-ready.** The architecture is genuinely good and the engineering culture is strong (deep behavioral unit tests, layered security design, pure domain layer, regression guards for past packaging failures). But the product's core promise — *open a real Gothic 2 script, edit it, save it, without damage* — is currently violated in several independent, confirmed ways, and the test/CI infrastructure is calibrated so these failures stay invisible (idempotence-not-fidelity corpus checks, browser-mock "E2E", corpus job disabled, releases not gated on tests).

Blocker themes, in order of severity:

1. **Silent data loss in the parser roundtrip** (confirmed by execution, not just reading).
2. **Silent data loss in the editor save pipeline** (dirty-tracking gaps, auto-save on partially-parsed files, non-atomic lossy writes).
3. **Reliability: worker crashes silently hang saving and project loading forever.**
4. **The quest editor's headline features are unreachable in the shipped app** (test-environment-only UI), plus a resource leak on every model change.
5. **Delivery/security: unsigned, hash-unverified auto-updates silently executed, on an Electron that has been EOL ~21 months, with zero crash reporting.**

---

## Critical findings

### 1. Parser: opening + saving a file silently corrupts it (confirmed by roundtrip execution)

| # | Finding | Location |
|---|---------|----------|
| P1 | `class` and `prototype` declarations are **deleted entirely** on regenerate (no slot in the semantic model or `declarationOrder`). | `daedalus-parser/src/semantic/visitors/declaration-visitor.ts:46-52` |
| P2 | Condition raw-mode fallback **discards already-collected conditions**: the ubiquitous idiom `func int Cond() { if (Npc_KnowsInfo(...)) { return TRUE; }; return FALSE; };` regenerates as a body containing only `return FALSE;` — the dialog would never appear in-game. The existing test (`test/condition-raw-fallback.test.js:126-151`) passes while this happens and effectively codifies the loss. | `daedalus-parser/src/semantic/visitors/linking-visitor.ts:547-555, 164-189, 432-437` |
| P3 | Numeric coercion (`parseInt(arg) \|\| default`) **replaces constant-name arguments and zeros with literals**: `CreateInvItems(self, ItMi_Gold, Gold_Amount)` → amount `1`; `B_GiveInvItems(..., 0)` → `1`; `Npc_SetRefuseTalk(self, RefuseSeconds)` → `300`. | `daedalus-parser/src/semantic/parsers/action-parsers.ts:198, 207, 216, 243, 261` |
| P4 | 2-arg `Npc_RemoveInvItem(npc, item)` fails a `minArgs: 3` check and the statement is **silently dropped** (recognized-but-arity-failing calls get no generic fallback). | `action-parsers.ts:324-333`, `linking-visitor.ts:479-482` |
| P5 | Argument quoting is not roundtrip-safe: several generators always re-quote (identifiers become string literals: `Npc_ExchangeRoutine(self, Routine_Var)` → `"Routine_Var"`) or always strip quotes (`"T_STAND"` → `T_STAND`). | `daedalus-parser/src/semantic/npcActions.ts:71, 138, 205, 228, 251` |
| P6 | **All comments inside function bodies and C_INFO instance bodies are dropped** on regenerate; a standalone comment on the line after an `AI_Output` is misparsed as its subtitle text. | `linking-visitor.ts:717-719`, `action-parsers.ts:355-387` |
| P7 | Generating from an errored parse silently drops unparseable content — nothing in the library guards `model.hasErrors` before codegen; safety depends entirely on callers. (See E3 for how the editor defeats its own caller-side guard.) | `src/codegen/generator.ts` (no guard), `error-visitor.ts` |

Why CI is green anyway: the roundtrip corpus harness measures **idempotence** (generated output reparses to the same model), not **fidelity to source** — a lossy first parse reparses identically, so P1–P6 are invisible to it. And the corpus job is disabled in CI (`.github/workflows/all-tests.yml`, `if: false`) because the real MDK corpus is gitignored.

Also confirmed (major, not data-loss): cross-reference/clustering lookups are case-sensitive in a case-insensitive language (`cross-references.ts:70, 94-108, 134-139`; `generator.ts:389`; `Choice.targetFunction` never normalized) — rename/remove cascades and dialog-function clustering misbehave with the case drift that is rampant in real scripts. `b_beklauen()` regenerates as `C_Beklauen(0, 0)` due to exact-case mode comparison (`action-parsers.ts:286-290`, `npcActions.ts:167`).

### 2. Editor: the save pipeline can lose user work

| # | Finding | Location |
|---|---------|----------|
| E1 | **No close guard at all**: no `beforeunload`, no `close`/`before-quit` dirty check. Closing the window with dirty files loses everything since the last auto-save tick. | `src/main/main.ts` (absent), renderer (absent) |
| E2 | **Source-editor edits are outside dirty tracking**: `setWorkingCode` never sets `isDirty`. Typed source is (a) discarded without prompt on project switch, (b) clobbered by file-watcher reloads, (c) never auto-saved, and (d) silently wiped by any visual edit (every model mutation sets `workingCode = undefined`). | `src/renderer/store/fileStore.ts:686-693, 281, 296`; `App.tsx:92-95`; `useFileWatcher.ts:78` |
| E3 | Every model mutation unconditionally sets `hasErrors = false`; `hasErrors` is the only thing stopping auto-save on a file that parsed with errors. One visual edit → auto-save (2s) writes **generated code from a partial model**, permanently dropping everything the parser failed to capture. Combines directly with parser finding P7. | `fileStore.ts:283, 298, 323, 359`; `useAutoSave.ts:29` |
| E4 | Auto-save overwrites external edits: watcher skips reload for dirty files, then auto-save writes the editor's model over the externally-modified file within 2s, no conflict prompt. | `useFileWatcher.ts:74-88`, `fileStore.ts:235-236` |
| E5 | Writes are in-place and non-atomic (no temp+rename, no backup); crash/ENOSPC mid-write truncates the user's script. | `src/main/services/FileService.ts:195` |
| E6 | Silent lossy encoding: content is encoded to the cached/detected encoding via iconv with `?` substitution and no roundtrip check; ASCII-detected files that gain umlauts get mangled; encoding cache never invalidated on external change. | `FileService.ts:25, 98, 190-193` |
| E7 | `saveFile` marks clean after `await` without checking whether the model changed mid-save (the reference-equality guard exists in `useAutoSave.ts:77-83` but not here); edits landing during the IPC save are marked clean though not on disk. | `fileStore.ts:653-661, 706-720` |

### 3. Reliability: one worker crash silently bricks the session

| # | Finding | Location |
|---|---------|----------|
| R1 | Parser workers are never restarted and pending requests never rejected on `error`/`exit`; no timeout. One native tree-sitter crash (realistic on pathological downloaded mod files) → the in-flight promise hangs forever and round-robin keeps feeding ~1/N of future requests to the dead worker. Since save awaits validation → parse, **saving silently hangs with no error** until restart. | `src/main/services/ParserService.ts:47-56, 69-77` |
| R2 | Same defect in the metadata pool: a crashed worker leaves `pendingRequests` unresolved → `Promise.all` in `buildProjectIndex` never settles → "open project" spinner hangs forever; `pool.terminate()` in `finally` never runs, leaking the remaining threads. | `MetadataWorkerPool.ts:96-104, 137-147`; `ProjectService.ts:82-84` |
| R3 | Per-file metadata parse failures resolve to empty metadata with no diagnostic — files the parser chokes on silently disappear from the project index. Metadata workers also read hard-coded UTF-8 while FileService detects windows-1250/1252 — non-ASCII identifiers corrupt in the index. | `MetadataWorkerPool.ts:78-81, 158`; `metadata.worker.ts:10` |

### 4. Quest editor: shipped features are dead code; tests pass against a jsdom-only UI

| # | Finding | Location |
|---|---------|----------|
| Q1 | Edge clicking never works in production: `graphCanvas.onLinkSelected` is assigned but litegraph.js 0.7.18 never invokes any such callback (verified against the vendored build). The whole edge-inspector workflow (edit transition text, remove transition, edit condition links) is unreachable. | `QuestLiteGraphCanvas.tsx:210`; `Inspector/QuestInspectorPanel.tsx:574-672` |
| Q2 | The condition-expression editing UI renders **only when `isJsdomEnvironment()` is true** — i.e., only under Jest. In production the IF panel is painted on canvas with no click handler; `setConditionExpression` is dead in the shipped app while green in tests. Direct violation of the repo's own "Playwright tests must exercise real UI" rule. | `QuestLiteGraphCanvas.tsx:547, 655, 101-142`; `QuestFlow.tsx:658-664` |
| Q3 | Canvas lifecycle leak: the init effect depends on callbacks that depend on `semanticModel` (recreated per edit/parse), so every model change tears down and recreates `LGraph`/`LGraphCanvas` — but cleanup never calls `unbindEvents()`/`graph.stop()`. Each re-init leaks a document `keyup` listener plus a perpetual rAF loop retaining the old graph. Also resets pan/zoom and drops visual selection on every rebuild. | `QuestLiteGraphCanvas.tsx:181-286, 463`; `QuestFlow.tsx:167-175`; `QuestEditor.tsx:35-43` |
| Q4 | Guardrails are enforced only in the UI dialog (`Apply` button disabled); `handleApplyDiff`/`applyQuestModelsWithHistory` perform no validation — blocking-warning graph states are structurally committable by any other caller. | `QuestFlow.tsx:293-300, 666-676`; `QuestDiffPreviewDialog.tsx:137` |
| Q5 | A 250ms `setInterval` forces 4 React renders/sec forever, positioning an overlay that only renders under jsdom. | `QuestLiteGraphCanvas.tsx:172-179` |

### 5. Undo/redo and edit-correctness hazards

| # | Finding | Location |
|---|---------|----------|
| U1 | Quest batch history and per-file edit history share stacks but batch entries record only file paths, not stack positions — interleaved dialog edits + quest batch undo revert the wrong things and permanently desync history from state. | `historyStore.ts:315-334, 201-231` |
| U2 | Quest commands `structuredClone` the entire model per command and those unshared clones fill the 50-deep history stack — tens of MB of pure history per large file. `moveNode` deep-clones the whole model just to check existence, per node drag. | `quest/domain/commands/shared.ts:1-6`; `historyStore.ts:82-90`; `moveNode.ts:33` |
| U3 | Condition editing corrupts under fast interleaving: `ConditionCard`s are keyed by index and the 300ms debounce captures the index lexically — editing condition #3 then deleting #1 within 300ms writes the edit to the wrong slot; deleting a condition with a pending edit can resurrect it as an appended condition. (ActionCard solved both problems with refs + a deletion guard; ConditionEditor didn't get the fix.) | `ConditionEditor.tsx:365, 90-92`; `useConditionUpdate.ts:34-40, 53-60` |
| U4 | Global Ctrl+Z races the 300ms ActionCard debounce: undo applies, then the pending timer re-applies the just-undone text as a new edit. | `MainLayout.tsx:55-76`; `ActionCard.tsx:79-85` |
| U5 | Non-DialogLine actions in the drag-reorderable list are keyed `${type}:${index}`; DialogLine keys use `action.id` from source, which can be duplicated in real mod files. Nested `DragDropContext`s (unsupported by react-beautiful-dnd) inside conditional branches. | `ActionsList.tsx:36-37, 125, 137` |
| U6 | A skipped test documents a known data-loss bug with no failing gate: `test.skip('[BUG DEMO] condition changes should not be lost when dialog is saved')`. | `tests/ConditionSaving.test.tsx:20` |

### 6. Security & delivery

| # | Finding | Location |
|---|---------|----------|
| S1 | Auto-updater downloads an installer with **no hash/signature verification, no content-length check**, and runs it silently (`spawn(installer, ['/S'])`). Builds are **unsigned** (no signing config). Integrity rests entirely on TLS-to-GitHub of a mutable rolling release tag. | `UpdaterService.ts:149-208`; `package.json` build block |
| S2 | **Electron 29.4.6 — EOL since Oct 2024** (~21 months of unpatched Chromium/Node CVEs at review date). | `daedalus-dialog-editor/package.json` |
| S3 | Path validation is purely lexical — symlinks are never resolved (`fs.realpath` unused), so a malicious project folder with a symlink escapes the write whitelist. Whitelist granularity: opening one file whitelists its **entire parent directory** for the session. | `PathValidationService.ts:88-125`; `main.ts:222-254` |
| S4 | No `setWindowOpenHandler`/`will-navigate` guard, while the renderer calls `window.open`. (Baseline is otherwise good: contextIsolation on, nodeIntegration off, narrow preload.) | `main.ts:29-33`; `DialogSourceViewDialog.tsx:65` |
| S5 | `build-windows.yml` runs **no tests** before publishing to the public rolling release — releasing from a red main is possible. No crash reporter, no `uncaughtException` handler, no file logging: production failures vanish. | `.github/workflows/build-windows.yml`; `main.ts` |
| S6 | Settings writes are non-atomic read-modify-write with swallowed errors; corrupt settings silently reset — and settings seed the path-validation whitelist, so integrity matters beyond convenience. | `SettingsService.ts:30-47, 59-110` |

### 7. Performance

| # | Finding | Location |
|---|---------|----------|
| PF1 | `updateFileModel` re-runs the full O(all-files) `mergeSemanticModels` synchronously on effectively every edit action; several components subscribe to whole stores with no selector (`MainLayout`, `VariableManager`, `SourceCodeEditor`, `useNavigation`, …) so every merge re-renders large trees. `VariableManager` re-sorts every symbol in the merged model per merge. | `projectStore.ts:781-794`; `MainLayout.tsx:40-46`; `VariableManager.tsx:46-81` |
| PF2 | `DialogTree` puts the full `semanticModel` into react-window `itemData`, defeating row memoization on every model recreation — the exact anti-pattern CLAUDE.md warns about. | `DialogTree.tsx:51, 147-174` |
| PF3 | Quest editor subscribes to `parsedFiles` (identity changes per parsed file): during ingestion every parsed file recomputes quest usage and re-renders the whole quest subtree, feeding the Q3 teardown leak. | `QuestFlow.tsx:71-74`; `QuestEditor.tsx:43` |
| PF4 | Parser: `findDialogForFunction` caches hits but not misses and is called per action → O(actions × dialogs) full scans on mod-scale files. A fresh metadata worker pool (cpus−1 threads, each loading the native parser) is spawned per index build. | `linking-visitor.ts:798-819`; `ProjectService.ts:79` |
| PF5 | Aborted project ingestion still flushes stale updates into the new project's cache (cross-project data bleed), and `getSemanticModel` has no in-flight dedup. | `projectStore.ts:374-382, 419-451` |

### 8. QA infrastructure — why the suite is green anyway

- The Playwright "E2E" suite (25 specs) **never launches Electron**: it runs the Vite dev server against `mockAPI.ts`, a localStorage-backed fake of the whole main process. Zero automated coverage of real IPC, preload, disk writes with encoding, watching, or save→parse→generate fidelity in the shipped app. The only packaged-app test is an 8-second "did it start" smoke.
- The roundtrip corpus measures idempotence, not fidelity (see §1), and is disabled in CI.
- The editor has **no ESLint config or lint script at all** (CLAUDE.md's "run lint" is unsatisfiable there); CI lints only the parser.
- On the positive side: unit/integration suites are deep and behavioral (real concurrency tests, real parser, regression guards), the PR gate (typecheck + Jest + Playwright + parser tests/lint) is real, and no `.only`/`fixme` abuse exists.

---

## What's genuinely good

- Clean staged architecture in the parser (two-pass visitors, verbatim `sourceText` for globals, generic `Action` fallback for unknown calls) — the fidelity *machinery* exists; the losses are at specific edges.
- Electron security baseline: context isolation, no node integration, narrow preload, path whitelist concept, pinned updater URLs/paths, IPC handlers uniformly try/caught (a bad model rejects a promise, it doesn't crash main), and save re-parses generated code before writing.
- Quest domain layer is verifiably pure (no React/MUI/Electron imports) with one-way import direction, as the architecture doc mandates.
- Store design is sound in shape (clean split, correct one-way sync bridge, carefully documented snapshot discipline); dialog-surface Immer history is efficient.
- Test culture is real: 675 editor Jest tests + ~5,200 lines of behavioral parser tests, race-condition tests, packaging regression guards.

---

## Recommended second-pass deep reviews

Grouped so each pass is a coherent slice with one question to answer:

1. **Roundtrip fidelity (parser)** — `visitors/*`, `parsers/*` (esp. `action-parsers.ts`, `argument-parsing.ts`), `codegen/generator.ts`, `npcActions.ts`/`inventoryActions.ts`, `scripts/roundtrip-corpus.js`, `test/condition-raw-fallback.test.js`. Question: enumerate every construct that doesn't survive parse→generate byte-comparably (or semantically), and redesign the corpus check to measure *source fidelity*, then re-enable it in CI (fixtures if the MDK corpus can't ship). Findings P1–P7, M1–M5.

2. **Save/dirty/data-loss pipeline (cross-process)** — `fileStore.ts` + `useAutoSave.ts` + `useFileWatcher.ts` (renderer) together with `FileService.ts` + `FileWatcherService.ts` + `main.ts` save/watch handlers (main). Question: trace every path from "user has unsaved intent" to "bytes on disk" and prove none loses data (close guard, workingCode, hasErrors clearing, mid-save races, atomic writes, encoding roundtrip, watcher conflicts). Findings E1–E7, plus the skipped `[BUG DEMO]` test.

3. **Worker lifecycle & process reliability** — `ParserService.ts`, `MetadataWorkerPool.ts`, `src/main/workers/*`, `ProjectService.ts`. Question: what happens on worker crash/timeout at every call site; add restart + reject + timeout semantics. Findings R1–R3, PF4 (pool-per-build).

4. **Quest editor stack** — `QuestLiteGraphCanvas.tsx`, `QuestFlow.tsx`, `QuestEditor.tsx`, `Inspector/`, `quest/domain/commands/*`, quest batch history in `historyStore.ts`. Question: which interactions actually work in real Chromium (vs jsdom), litegraph lifecycle/leaks, guardrail enforcement location, batch-history coherence. Findings Q1–Q5, U1–U2, PF3. This one needs manual smoke testing in the real app, not just reading.

5. **Undo/redo + edit debouncing** — `historyStore.ts`/`historyActions.ts` with `ActionCard.tsx`, `ConditionEditor.tsx`/`useConditionUpdate.ts`, `ActionsList.tsx` keys/DnD, `MainLayout` Ctrl+Z handler. Question: interleaved-edit correctness (debounce vs undo vs delete vs reorder). Findings U1, U3–U6.

6. **Security & update chain** — `PathValidationService.ts` (symlinks, granularity), `main.ts` IPC surface + window-open handling, `UpdaterService.ts` + `update-meta.json` schema (add sha256), signing + `build-windows.yml` gating, Electron upgrade path off 29. Findings S1–S6.

7. **Rendering performance under mod-scale data** — store subscription audit (selector-less `useXStore()` calls), `mergedSemanticModel` rebuild strategy in `projectStore.ts`, `DialogTree`/`VariableManager`/`MainLayout` memoization, ingestion-time render storms. Findings PF1–PF3, PF5. Best done with a profiler against a real Gothic 2 script base.

8. **Test truthfulness & release gating** — decide the real-Electron E2E strategy (Playwright `_electron` launcher for a critical-path subset), wire `build-windows.yml` to the test gate, add crash logging (`uncaughtException` + file log at minimum), add editor ESLint. §8 findings.

### Suggested order to reach production

Fix in this order: (3) worker hangs → (2) save-pipeline data loss → (1) parser fidelity (+ fidelity-corpus in CI) → (6) update integrity + signing + Electron upgrade → (4) quest editor (or feature-flag it off for v1) → (8) release gating/crash logging → (5)/(7) as fast-follow hardening.
