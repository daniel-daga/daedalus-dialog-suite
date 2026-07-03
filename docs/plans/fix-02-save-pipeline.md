# Fix Plan 02 — Save / Dirty-State / Data-Loss Pipeline

Slice 2 of the 2026-07-02 production-readiness remediation ([tracker](./code-review-remediation.md), findings in [code-review-findings.md](./code-review-findings.md)).

Status: plan-ready (deep-dive verified 2026-07-03). **Plan only — no implementation yet.**

All paths relative to `daedalus-dialog-editor/` unless stated otherwise. Cross-slice contracts:
[fix-01](./fix-01-parser-fidelity.md) (P7 `hasErrors` guard + `allowPartialModel`),
[fix-03](./fix-03-worker-reliability.md) (D4 encoding extraction, D5 `FileState.saveError` contract),
[fix-05](./fix-05-undo-debounce.md) (2.3 pending-edit flush registry; U6 handoff).

---

## 1. Scope & findings addressed

### Re-verified

| ID | Status after deep-dive |
|----|------------------------|
| E1 | **Confirmed.** No `beforeunload`, no `close`/`before-quit` handling anywhere (grep across both processes: zero hits). `main.ts:46-49` only cleans up the watcher *after* close. Everything since the last auto-save tick (≤2 s of model edits, plus everything listed under E2/N4 that auto-save never covers) is lost on window close. |
| E2 | **Confirmed at store level, but latent in the shipped UI (see N1).** `setWorkingCode` (`fileStore.ts:686-693`) never touches `isDirty`; all four listed loss paths verified: project switch (`App.tsx:92-95, 115-121` checks only `isDirty`), watcher reload (`useFileWatcher.ts:78` checks only `isDirty`; `openFile` rebuilds `FileState` without `workingCode`), never auto-saved (`useAutoSave.ts:29` reads only `isDirty`), wiped by every model mutation (9 sites in `fileStore.ts` set `workingCode = undefined`). |
| E3 | **Confirmed, with a sharpening.** All mutation paths set `fileState.hasErrors = false` (`fileStore.ts:283, 298, 323, 359, 384, 408, 449, 558, 593, 760`) and `useAutoSave.ts:29` gates only on that flag. Sharpening: `semanticModel.hasErrors` **stays true inside the model** — only the FileState copy is cleared. Pre-fix-01 the generator happily emits from the partial model (P7) and the generated code re-parses clean, so ValidationService passes and the write proceeds → silent permanent loss. Post-fix-01 (P7 guard), `ValidationService.validate`'s generate step (`ValidationService.ts:168`) will throw, be caught at `:169-175`, and the save fails with "Code generation failed" — silent corruption becomes a *visible, permanent* auto-save error with no UX to resolve it. The editor-side lifecycle redesign below is therefore required in the same release as fix-01 step 2 (as that plan already flags). |
| E4 | **Confirmed.** `useFileWatcher.ts:76-81` skips reload for dirty files with only a `console.log`; nothing records the conflict; `useAutoSave` then overwrites the external edit on the next tick. No prompt, no suspension. |
| E5 | **Confirmed.** `FileService.writeFile` (`FileService.ts:184-224`) is a plain in-place `fs.writeFile`. Crash/ENOSPC mid-write truncates. `acquireLock` serializes only *this process's* operations. |
| E6 | **Confirmed.** `iconv.encode(content, cachedEncoding)` (`FileService.ts:190-193`) silently substitutes `?` for unmappable characters; a chardet `ASCII` detection is cached and later writes of umlaut-bearing content are mangled; `clearEncodingCache` exists (`:239-245`) but has **zero callers** — never invalidated on watcher events. |
| E7 | **Confirmed.** `fileStore.saveFile` (`:623-668`) marks `isDirty = false` after the `await` with no model-reference check (the guard exists only in `useAutoSave.ts:73-83`). Edits landing during the IPC round-trip are marked clean but are not on disk; if no further edit arrives, they are never written. |
| U6 | **Underlying bug is fixed architecturally; the skipped test is stale; a live variant remains.** The `[BUG DEMO]` (`tests/ConditionSaving.test.tsx:20`) models `ThreeColumnLayout` callbacks doing whole-model spreads over a stale `semanticModel` closure. That pattern no longer exists: condition edits flow through store-level *updater* mutations that read current state inside the Immer draft (`ConditionEditor.tsx:82-98` passes updaters; `useDialogEditorCommands.ts:169-180` → `updateDialogConditionFunction`; `historyActions.updateModel` has **no remaining callers**). The live variant is N4: edits pending in the 300 ms `useConditionUpdate`/`ActionCard` debounce are in component-local state, not the store — a save (manual or auto) within that window serializes the model **without** the newest keystrokes, then reports "File saved successfully". Not permanent loss on its own (the flush lands and re-dirties), but it becomes permanent combined with E1 (close), E4 (conflict), or auto-save disabled. |

### New findings from this pass (N-series, scoped to this plan)

| ID | Finding | Location |
|----|---------|----------|
| N1 | **SourceCodeEditor is unreachable in the shipped app** — its only mount and its sidebar toggle are commented out. `workingCode`/`saveSource` store paths are live (and tested) but no user can currently reach them. E2's user-facing severity drops to *latent*; the store semantics must still be fixed **before** the view is re-enabled, and this plan makes that a hard prerequisite. | `MainLayout.tsx:104-108, 119-122` |
| N2 | **`saveSource` has the same mid-save race as E7, worse:** after `await writeFile` + re-parse it unconditionally sets `workingCode = undefined`, `isDirty = false` and swaps the model — keystrokes typed during the await (already in `workingCode` via the 500 ms Monaco debounce, or still pending in it) are wiped from the store, and `SourceCodeEditor`'s sync effect (`SourceCodeEditor.tsx:36-39`) can then reset the visible buffer to the just-saved (older) `originalCode`. | `fileStore.ts:695-726`, `SourceCodeEditor.tsx:26-59` |
| N3 | **Watcher reload steals focus and identity:** `handleFileModified` reloads via `fileStore.openFile`, which unconditionally sets `activeFile = filePath` (`fileStore.ts:255-258`) — an external change to a *background* open file yanks the user's active file/selection. It also rebuilds `FileState` from scratch (drops `workingCode`, `lastValidationResult`). | `useFileWatcher.ts:83-88`, `fileStore.ts:240-263` |
| N4 | **Pending debounced edits are invisible to every save and every guard** (see U6 above). The flush-on-unmount in `useConditionUpdate.ts:53-60` does not help: window close and IPC saves do not unmount components. | `useConditionUpdate.ts:34-40`, `ActionCard.tsx` |
| N5 | **External deletion of a dirty file destroys unsaved work with no prompt:** watcher `unlink` → `closeFile` unconditionally (`useFileWatcher.ts:199-203`) → FileState (the only copy of the user's edits) is discarded. Externally *renaming* a file you are editing (common with mod tooling) loses everything. | `useFileWatcher.ts:195-218`, `fileStore.ts:265-273` |
| N6 | **`hasErrors` conflates two unrelated states:** parse errors from open (`fileStore.openFile`) and validation failures from auto-save (`useAutoSave.ts:106-121` sets `hasErrors: !validationResult.isValid` and overwrites `errors` with validation output). Clearing logic can't distinguish them; part of the E3 redesign. | `useAutoSave.ts:106-121`, `fileStore.ts:245-253` |
| N7 | **Auto-save swallows IPC rejections** into `console.error` with no per-file state (`useAutoSave.ts:66-68, 130-136`). fix-03 D5 defines the `FileState.saveError` field and classifiable rejection prefixes; this slice owns rendering it and the equivalent `catch` in `fileStore.saveFile`. | `useAutoSave.ts`, `fileStore.ts:664-667` |
| N8 | **Self-write suppression is one-shot with a 2 s expiry** (`FileWatcherService.ts:61-67, 126-133`): a write whose chokidar event stabilizes >2 s after `notifySelfWrite` (large file + AV scan) is misclassified as external → clean-file reload → history wipe (via the `originalCode` subscription, `historyStore.ts:494-506`) + focus steal (N3). E5's atomic rename shortens the event window; residual risk accepted and noted. | `FileWatcherService.ts` |
| N9 | **An external change to any *clean* open file wipes quest batch history globally** — the reload path trips the same `resetBatchHistory()` defect fix-05 owns as F-B. No work here; referenced so slice 5 keeps it in scope. | `historyStore.ts:494-506` |

### Corrections to the original findings

- **E2** is real but currently unreachable by users (N1). Do not treat as a shipped-data-loss blocker; treat as a hard prerequisite for re-enabling the source view.
- **U6** as literally documented (stale whole-model closures) is already fixed; the test is stale evidence. The plan replaces it with (a) a regression pin on the updater-based flow and (b) a genuinely red test for the live debounce-vs-save variant (N4).
- **E3** is worse than "auto-save writes a partial model": after fix-01 lands, it silently *degrades* into a permanently failing auto-save unless this slice ships the lifecycle + UX in the same release.

### Complete loss-scenario inventory (user intent → bytes on disk)

For traceability, every distinct loss path found; each maps to a fix:

1. Close window with model-dirty files → lost (E1).
2. Close/switch project/reload with source-dirty (`workingCode`) files → lost without prompt (E2 + N1-latent).
3. Close/save within 300 ms of typing in a condition/action card → newest keystrokes not serialized (N4/U6).
4. Edit a file that opened with parse errors → auto-save writes partial model, unparsed content gone (E3 + P7).
5. External edit to a dirty open file → auto-save overwrites it ≤2 s later (E4).
6. External edit landing in the watcher-latency window during a save → same, no watcher event yet (E4 phase 2).
7. Crash/ENOSPC/kill mid-write → truncated file on disk (E5).
8. Save content unmappable in the cached/detected encoding → `?`-mangled bytes (E6).
9. Edit landing while `saveFile`/`saveSource` IPC is in flight → marked clean, never written (E7/N2).
10. External delete/rename of a dirty open file → FileState destroyed (N5).
11. Save-path parse hang (worker crash) → save never completes; with E1 absent, close then loses everything (fix-03 R1 + E1 here).

---

## 2. Fix design per finding

### E1 — Window-close dirty guard (main `close` handler + renderer confirm over IPC) — size M

**Decision: main-process `close` interception with a renderer-driven confirm/save flow — not `beforeunload`.**
Justification: `beforeunload` is synchronous — it cannot await the final `saveFile`/`saveSource` IPC round-trips, and Chromium ignores `window.confirm` inside it, so the only possible behavior is silently vetoing the close with no dialog. The close flow needs async saves (which can also *fail* — validation, encoding loss, parse timeout per fix-03), a real three-way choice, and it must also cover Cmd+Q/`before-quit`. The renderer owns the dialog (reuses MUI + the existing save paths); main owns the veto.

Files: `src/main/main.ts`, `src/main/preload.ts`, `src/renderer/hooks/useWindowCloseGuard.ts` (new), `src/renderer/App.tsx`, `src/renderer/types/global.d.ts`.

Protocol:

1. `main.ts`: module-level `let closeApproved = false`. In `createWindow`:
   ```ts
   mainWindow.on('close', (e) => {
     if (closeApproved) return;
     e.preventDefault();
     mainWindow!.webContents.send('app:closeRequested');
     // Safety net: renderer hung/crashed (fix-03 R1 world) — force close if no ACK
     closeGuardAckTimer = setTimeout(() => { closeApproved = true; mainWindow?.destroy(); }, 3000);
   });
   ```
   IPC handlers: `app:ackCloseRequest` (clears the ack timer — the timer covers *renderer unresponsive*, never *user thinking*), `app:approveClose` (sets `closeApproved = true`, `mainWindow.close()`), `app:cancelClose` (resets nothing else; user stays). `before-quit` needs no extra handling — quitting closes the window and this handler runs.
2. `preload.ts`: expose `onCloseRequested(cb)`, `ackCloseRequest()`, `approveClose()`, `cancelClose()`.
3. `useWindowCloseGuard` (mounted once in `App`): on `closeRequested` → `ackCloseRequest()` → `flushAllPendingEdits()` (N4; registry from fix-05 §2.3) → compute unsaved set via the E2 helper (`hasUnsavedChanges(fileState)` = model-dirty ∨ source-dirty ∨ external-conflict). If empty → `approveClose()`. Else render a MUI dialog listing the files:
   - **Save and close**: for each model-dirty file `await saveFile(fp)`; source-dirty `await saveSource(fp, workingCode)`; on any failure (validation, `ENCODING_LOSS`, `PARSE_TIMEOUT` per fix-03) keep the window open and show the failure inline — never approve close on a failed save.
   - **Close without saving**: `approveClose()`.
   - **Cancel**: `cancelClose()`.
4. Files in `externalConflict` state (E4) are listed as unsaved with "Keep mine"/"Discard" resolution required before "Save and close" proceeds.

Interlock with fix-03: a save-path parse hang would previously have made "Save and close" hang forever; fix-03 D1's 30 s timeout bounds it, and its `saveError` classification is what the dialog renders on failure. This ordering dependency is why slice 3 lands first (tracker order 3 → 2).

### E2 — `workingCode` in dirty tracking + source-edit vs model-edit reconciliation — size M (split E2a/E2b)

**E2a (store semantics — do now):** files `src/renderer/store/fileStore.ts`, `src/renderer/App.tsx`, `src/renderer/hooks/useFileWatcher.ts`.

1. Derived helpers exported from `fileStore.ts` (no new stored flag — derive, so it can never desync):
   ```ts
   export const isSourceDirty = (fs: FileState) =>
     fs.workingCode !== undefined && fs.workingCode !== fs.originalCode;
   export const hasUnsavedChanges = (fs: FileState) =>
     fs.isDirty || isSourceDirty(fs) || !!fs.externalConflict;
   ```
2. All discard-guard consumers switch to `hasUnsavedChanges`: `App.tsx:92-95` (`hasUnsavedChanges` memo), the E1 close guard, `useFileWatcher.ts:78` (skip-reload check), `handleReload`.
3. **Auto-save policy for source-dirty files: excluded (deliberate).** Auto-writing half-typed source every 2 s would persist syntactically broken intermediate states and, via the `originalCode`-change subscription (`historyStore.ts:494-506`), wipe undo history on every tick. Instead the App-bar save indicator (`App.tsx:220-243`) gains a "unsaved source changes — Ctrl+S to save" state driven by `isSourceDirty`. Documented as a decision; revisit if/when the source view returns.
4. **Visual edit while source-dirty — policy: refuse-and-reconcile, never silently wipe.** The current "every mutation sets `workingCode = undefined`" rule destroys typed source. New store rule: every model-mutation site first checks `isSourceDirty(fileState)`; if true the mutation **no-ops** and sets a transient `fileState.blockedBySourceEdit = true` (UI hint). Reconciliation is explicit via a new store action:
   ```ts
   adoptWorkingCode(filePath): Promise<{ ok: boolean; errors?: ParseError[] }>
   ```
   — parses `workingCode` (`parseSourceWithIds`); on success: `semanticModel = parsed`, `isDirty = true` (model now differs from disk), `workingCode = undefined`; on parse errors: keep `workingCode`, return errors. Mutation sites keep clearing `workingCode` when it is **not** dirty (i.e. equal to `originalCode` — clearing is then lossless and keeps today's behavior).
   Interlock: the no-op path must not push phantom undo snapshots — fix-05 §2.2's transactional `pushSnapshot` covers this; until it lands, `withHistory`'s pre-push is an accepted cosmetic defect (one dead undo step), not data loss.

**E2b (UI reconciliation — prerequisite for re-enabling the source view, N1):** when `MainLayout.tsx:104-122` is uncommented, `ThreeColumnLayout`/`QuestFlow` render a banner for source-dirty files: "Source edits pending — **Apply** (parse & adopt) / **Discard**" wired to `adoptWorkingCode` / `setWorkingCode(fp, undefined)`. This plan implements E2a fully (guards + action + tests) and ships the banner component; flipping the source view back on is a separate product decision with E2a/E2b + N2 as its checklist.

### E3 — `hasErrors` lifecycle (align with fix-01 P7 / `allowPartialModel`) — size M

Files: `src/renderer/store/fileStore.ts`, `src/renderer/hooks/useAutoSave.ts`, `src/main/services/ValidationService.ts`, `src/main/services/CodeGeneratorService.ts`, `src/main/main.ts`, `src/renderer/components/ValidationErrorDialog.tsx`, `src/renderer/components/hooks/useDialogEditorCommands.ts`.

**Principle: `semanticModel.hasErrors` is the single source of truth for "this model is a partial parse"; nothing an editor mutation does can make a partial model whole, so no mutation may clear it.**

1. Delete the `fileState.hasErrors = false` line from all 10 mutation sites (`fileStore.ts:283, 298, 323, 359, 384, 408, 449, 558, 593, 760`). `fileState.hasErrors`/`errors` become parse-state only, set exclusively where a fresh parse lands: `openFile`, `saveSource`, `adoptWorkingCode`. (They mirror `semanticModel.hasErrors`; keep the mirror for cheap selector access but treat the model as authoritative.)
2. Split N6's conflation: `useAutoSave`'s failure branch (`useAutoSave.ts:106-121`) stops writing `hasErrors`/`errors`; it sets only `autoSaveError` (validation result). Auto-save gating becomes:
   ```ts
   fileState.isDirty && !fileState.semanticModel.hasErrors && !fileState.autoSaveError && !fileState.externalConflict
   ```
   (`autoSaveError` is still cleared by every mutation — an edit may fix validation — that existing behavior stays.)
3. **When may auto-save write a file that opened with parse errors? Never.** A parse-errored model may only reach disk through the *manual* force path with explicit consent:
   - `ValidationService.validate`: add a pre-check — `if (model.hasErrors) errors.push({ type: 'syntax_error', message: 'File was opened with N parse errors; saving from the visual editor will drop the content the parser could not read.' })` — and perform its generate step with `allowPartialModel: true` (so `generatedCode` exists for the forced path and validation reports the real problem instead of fix-01's throw).
   - `CodeGeneratorService.generateCode` gains `options?: { allowPartialModel?: boolean }` passed through to `SemanticCodeGenerator` (fix-01 P7 contract). `main.ts` `generator:saveFile` fallback path (`main.ts:150`) passes `allowPartialModel: options?.forceOnErrors === true`.
   - `ValidationErrorDialog`: when the validation result contains the parse-error entry, the "Save anyway" button copy changes to "Save anyway (drops unparsed content)" — consent is informed.
   - Renderer: dialog view shows a persistent warning banner when `semanticModel.hasErrors` ("Opened with N parse errors — visual edits cannot see all of this file").
4. **Release coupling (from fix-01 §risks):** fix-01 step 2 (P7 throw) and this fix land in the same release. Order-safe either way: this fix alone stops auto-save on errored files (renderer gate); P7 alone turns residual corruption into failed saves; together they are complete.

### E4 — External-change conflict policy — size M

**Decision: suspend auto-save for conflicted files AND prompt — suspension is the safety mechanism (immediate, automatic), the prompt is the resolution UX. A prompt alone loses the race with the 2 s auto-save tick; disabling alone strands the user silently.**

Files: `src/renderer/store/fileStore.ts`, `src/renderer/hooks/useFileWatcher.ts`, `src/renderer/hooks/useAutoSave.ts`, `src/renderer/components/` (new `ExternalChangeConflictDialog.tsx`), `src/renderer/App.tsx`, `src/main/services/FileService.ts`, `src/main/main.ts`, `src/main/preload.ts`.

Phase 1 — renderer conflict state (watcher-driven):

1. `FileState.externalConflict?: { detectedAt: string }`. New store actions `markExternalConflict(filePath)` / `resolveExternalConflict(filePath, resolution: 'keepMine' | 'reloadTheirs')`.
2. `useFileWatcher.handleFileModified`: if the open file `hasUnsavedChanges` (E2a helper — covers model- and source-dirty) → `markExternalConflict` instead of the silent skip at `:76-81`. `unlink` events (N5): if dirty → do **not** `closeFile`; mark `externalConflict` with a `fileMissing: true` variant so the dialog offers "Restore file (write my version back)" / "Discard".
3. `useAutoSave`: skip conflicted files (gate in E3.2). `fileStore.saveFile` on a conflicted file refuses unless called with `{ overwriteExternal: true }`.
4. UI: `ExternalChangeConflictDialog` (auto-opens for the active file; App-bar error chip for background files): "*<file>* changed on disk while you have unsaved changes." → **Keep mine (overwrite disk)** = `saveFile(fp, { overwriteExternal: true })`; **Reload from disk (discard my changes)** = `reloadFile(fp)`; both clear the conflict.
5. Clean-file reloads keep happening automatically, but via a new `reloadFile(filePath)` that preserves `activeFile` and reuses the existing `FileState` slot (fixes N3 focus-steal). `openFile` keeps its activate-on-open behavior for genuine opens.

Phase 2 — main-side mtime precondition (closes the watcher-latency gap, loss scenario 6):

6. `FileService` maintains `fileStatCache: Map<path, mtimeMs>` updated after every successful `readFile`/`writeFile` (inside the existing `acquireLock`). `writeFile(filePath, content, opts?: { expectUnchanged?: boolean })`: when `expectUnchanged` and a cached mtime exists and disk mtime differs → throw `FileServiceError('EXTERNAL_MODIFICATION')` without writing.
7. `main.ts` `generator:saveFile` and `file:write` pass `expectUnchanged: !options?.overwriteExternal`; the renderer maps an `EXTERNAL_MODIFICATION` rejection to `markExternalConflict` (same dialog). Preload: thread the `overwriteExternal` option through `saveFile`/`writeFile`.

### E5 — Atomic write via temp + rename — size S

Files: `src/main/services/FileService.ts`, `tests/FileWatcherService.test.ts` (extend).

Inside `writeFile`'s `acquireLock`, replace the in-place write:

1. Temp path: `path.join(dir, `.${basename}.${process.pid}.${random}.tmp`)` — **must not end in `.d`**: the chokidar ignore predicate (`FileWatcherService.ts:81-88`) only watches `.d` files, so temp churn emits no watcher events by construction.
2. `open(tmp, 'w')` → `write` encoded buffer → `fsync` → `close` → `fs.rename(tmp, filePath)`. `rename` is atomic on POSIX and maps to `MoveFileExW(MOVEFILE_REPLACE_EXISTING)` on Windows; retry the rename up to 3× with 50 ms backoff for transient Windows `EPERM`/`EBUSY` (AV locks), then throw. On any failure, best-effort unlink the temp file; the original is untouched in every failure mode.
3. `notifySelfWrite` stays armed by the callers after the write resolves, as today. The rename produces a single fast `change` event well inside the 2 s suppression window (shrinks N8's residual risk).
4. Error mapping (`ENOSPC`, `EACCES`, …) preserved on both the temp-write and rename steps.

### E6 — Encoding roundtrip check + cache invalidation — size S–M

Files: `src/main/services/FileService.ts` (or `src/main/utils/encodingUtils.ts` if fix-03 D4 has landed — **sequence with D4: whoever lands second rebases; the roundtrip check belongs in the shared helper**), `src/main/services/FileWatcherService.ts`, `src/main/main.ts`, renderer error surfacing via E3/N7 fields.

1. **Roundtrip verification before writing** (in `writeFile`, before E5's temp write):
   ```ts
   const buffer = iconv.encode(content, encoding);
   if (iconv.decode(buffer, encoding) !== content) { /* lossy */ }
   ```
2. **Lossy-write policy:**
   - If the cached/derived encoding is `ASCII`/`ISO-8859-1`-detected-as-ASCII or there is no cache entry: silently upgrade to `windows-1252` (byte-identical for pure-ASCII content; the encoding Gothic tooling expects — same rationale as the existing new-file default at `FileService.ts:190`) and re-verify; update the cache.
   - If still lossy (e.g. Polish characters into a 1252 file, emoji anywhere): **refuse the write** — throw `FileServiceError('ENCODING_LOSS')` whose message names up to 5 offending characters with positions. Never silently write `?`.
3. Renderer: `ENCODING_LOSS` rejections keep `isDirty` and land in `FileState.saveError` (fix-03 D5's field; kind `'encoding'` added to its union — coordinate the shape with slice 3 before either lands), rendered by the App-bar error indicator with actionable copy ("remove the characters or convert the file to UTF-8 externally").
4. **Cache invalidation on external change:** `FileWatcherService` gains `setOnExternalChange(cb: (filePath, type) => void)`; `handleEvent` invokes it *after* the self-write suppression check (so self-writes don't nuke their own fresh cache). `main.ts` wires it to `fileService.clearEncodingCache(filePath)` (and E4 phase 2's stat-cache eviction). Next read re-detects; next blind write of a never-re-read file falls back to the documented `windows-1252` default.

### E7 (+ N2) — Mid-save race guards in `saveFile` / `saveSource` — size S

Files: `src/renderer/store/fileStore.ts`.

1. `saveFile`: capture `savedModel = fileState.semanticModel` before the IPC call. After success, compare **outside** `set()` (Immer drafts are never reference-equal — same technique and comment as `useAutoSave.ts:73-83`): `const stillCurrent = get().openFiles.get(filePath)?.semanticModel === savedModel;` — only then `isDirty = false` / `lastSaved`. Always update `lastValidationResult` and clear `pendingValidation`. A not-current save simply leaves the file dirty; the next auto-save tick covers it.
2. `saveSource`: after the `await`s, read the current state: if `workingCode !== undefined && workingCode !== code` (the user typed during the save), apply the model/`originalCode`/`errors` updates from the parse **but keep `workingCode`** and leave the file source-dirty (E2a semantics) instead of wiping it. `isDirty` stays false (the *model* matches disk). If `workingCode` is `undefined` or equals `code`: current behavior (full clean).
3. Also capture-and-compare in `saveFile`'s failure branch: `pendingValidation` should not be set for a model that has already been superseded (prevents a stale validation dialog).
4. N7 (contract with fix-03 D5): both `saveFile`'s `catch` and `useAutoSave`'s per-file `catch` populate `FileState.saveError` (classified via the `PARSE_TIMEOUT:`/`PARSER_CRASHED:`/`ENCODING_LOSS` prefixes) before rethrow/continue; App-bar indicator renders it (fix-03 D5 explicitly hands the rendering to this slice).

### U6 (+ N4) — Un-skip and fix `ConditionSaving`; flush-before-save — size S

Files: `tests/ConditionSaving.test.tsx` (rewrite), `src/renderer/utils/pendingEditFlushRegistry.ts` (from fix-05 §2.3 — **whichever slice lands first creates the module at this exact path with the agreed API** `registerPendingEditFlusher(fn): unregister` / `flushAllPendingEdits()`), `src/renderer/components/hooks/useDialogEditorCommands.ts`, `src/renderer/hooks/useAutoSave.ts`, `src/renderer/hooks/useWindowCloseGuard.ts` (E1), `src/renderer/App.tsx` (project-switch confirm).

1. Wire `flushAllPendingEdits()` at every save/discard-decision entry point, all UI-layer per fix-05's layering rule (the store never flushes): `handleSave` (`useDialogEditorCommands.ts:182`, before `saveFile`), `performAutoSave` (`useAutoSave.ts:23`, first statement), the E1 close guard, `App.confirmDiscardChanges` (before evaluating dirtiness).
2. Rewrite `tests/ConditionSaving.test.tsx`:
   - Delete the skipped `[BUG DEMO]` and the hand-rolled closure simulations (both model an architecture that no longer exists).
   - **Regression pin (green immediately):** store-level integration — seed `fileStore` with a dialog + condition function; interleave `updateDialogConditionFunction` (updater), `updateDialogWithNormalizedProperties`, `updateFunction` exactly as `useDialogEditorCommands` dispatches them; assert the final model contains all three edits.
   - **Red test (drives the fix):** render `ConditionEditor` inside a harness with fake timers; type into a condition field (pending 300 ms debounce); invoke the save entry (the `handleSave` path with `window.editorAPI.saveFile` mocked); assert the model passed to `saveFile` contains the edited value. Fails today; green once flush-wiring lands (and once fix-05 §2.4 makes the condition flusher ref-resolved — if fix-05 hasn't landed, the flusher registration for `useConditionUpdate` is added here using its existing `flushUpdate`).

---

## 3. Test plan (failing tests first, per repo TDD rules)

Renderer (Jest, jsdom, existing patterns from `tests/autoSave.test.ts` / `tests/editorStore.test.ts`):

1. **`tests/fileStore.saveRace.test.ts` (new — E7/N2, red):** mock `editorAPI.saveFile` with a manually-resolved deferred; start `saveFile`, dispatch `updateFunction` mid-flight, resolve → assert `isDirty` remains `true` (fails today). `saveSource` variant: `setWorkingCode` during the await → assert `workingCode` preserved and file reports source-dirty (fails today).
2. **`tests/fileStore.dirtyTracking.test.ts` (new — E2a, red):** `isSourceDirty`/`hasUnsavedChanges` derivation; model mutation on a source-dirty file no-ops and does not wipe `workingCode` (fails today: it currently wipes); `adoptWorkingCode` success adopts model + sets `isDirty`; parse-error path keeps `workingCode` and returns errors.
3. **`tests/fileStore.hasErrorsLifecycle.test.ts` (new — E3, red):** open a file whose mocked parse has `hasErrors: true`; apply a visual mutation; assert the auto-save candidacy predicate still excludes it (fails today: mutation clears the gate); `autoSaveError` blocks and is cleared by the next mutation; validation-failure path no longer writes `fileState.errors` (N6).
4. **`tests/autoSave.test.ts` (extend — E4/N4/N7):** conflicted file skipped by `performAutoSave` (red); registered pending-edit flusher runs before serialization and the flushed value is in the saved model (red); IPC rejection populates `FileState.saveError` and keeps `isDirty` (red; shared assertion shape with fix-03 §test 5 — coordinate to avoid double-writing).
5. **`tests/useFileWatcher.conflict.test.ts` (new — E4/N3/N5, red):** `change` on a dirty open file → `externalConflict` set, no reload; `change` on a clean *background* file → reloaded **and** `activeFile` unchanged (fails today); `unlink` on a dirty file → FileState retained with `fileMissing` conflict (fails today: closed/discarded); resolutions `keepMine`/`reloadTheirs` behave.
6. **`tests/ConditionSaving.test.tsx` (rewrite — U6):** as §2/U6 above; the debounce-flush case is the red driver.
7. **`tests/closeGuard.test.tsx` (new — E1, red):** mount `useWindowCloseGuard` with mocked `editorAPI` close channels; clean state → immediate `approveClose`; dirty state → dialog rendered, "Save and close" awaits saves then approves, save failure keeps window open and shows the error, "Cancel" calls `cancelClose`; pending debounced edit is flushed and included in the save.

Main process (Jest, `@jest-environment node`, **real fs in temp dirs** — precedent: `tests/ProjectService.test.ts`; note `tests/encoding.test.ts` is a manual `npx tsx` script, not in the Jest suite — the new files below are proper Jest):

8. **`tests/FileService.atomicWrite.test.ts` (new — E5, red):** happy path byte-compare + no temp residue in the directory; inject a half-writing failure (stub the temp-write step to write partial bytes then throw) → assert the **target file still holds its original content** (fails today: in-place write leaves a truncated target); rename-retry: stub `fs.rename` to fail `EPERM` once → succeeds on retry; fail persistently → error thrown, original intact, temp cleaned up.
9. **`tests/FileService.encodingRoundtrip.test.ts` (new — E6, red):** windows-1252 fixture + content containing `ł` → `writeFile` rejects `ENCODING_LOSS` naming the character, disk unchanged (fails today: writes `?`); pure-ASCII fixture + content gaining `ü` → silently upgraded to windows-1252, decode-back equals content (fails today); after `clearEncodingCache`, a blind write uses the windows-1252 default.
10. **`tests/FileService.conflictGuard.test.ts` (new — E4 phase 2, red):** read file (caches mtime) → external `fs.writeFile` bump → `writeFile(..., { expectUnchanged: true })` rejects `EXTERNAL_MODIFICATION` without writing; with `overwriteExternal` semantics (no `expectUnchanged`) it writes.
11. **`tests/FileWatcherService.test.ts` (extend — E5/E6):** temp-file names produce no watcher events (ignore predicate); `setOnExternalChange` fires for external events and **not** for self-suppressed ones.

Playwright (mock-E2E harness, `tests/e2e/`): the repo rule requires E2E-first for UI workflows, but the mock harness cannot exercise real window close or real disk conflict. Honest split: add `tests/e2e/external-conflict.spec.ts` driving the conflict dialog (mockAPI gains a test hook to emit a `fileWatcher:changed` event) and asserting Keep-mine/Reload flows against the visible UI; the close guard's renderer dialog gets a spec triggered via the same event-injection pattern (`app:closeRequested`). Real-Electron coverage of close + atomic write is explicitly deferred to slice 8's `_electron` critical-path suite — record it in that plan's checklist. Manual smoke before completion: real app — close with dirty file (all three dialog choices), external edit via a second editor, kill -9 during a large save (file intact).

Verification gate: `npm test`, `npm run typecheck:renderer`, `npm run build:main` in `daedalus-dialog-editor/` (editor still has no lint script — slice 8).

---

## 4. Ordering, dependencies, risks

| Step | Fix | Size | Depends on |
|------|-----|------|-----------|
| 1 | E7/N2 mid-save race guards + N7 `saveError` plumbing | **S** | fix-03 D5 field shape agreed (not necessarily landed) |
| 2 | E3 `hasErrors` lifecycle + force-path consent | **M** | pairs with fix-01 step 2 (P7); same release, either order safe |
| 3 | E5 atomic write | **S** | sequence FileService edits with fix-03 D4 |
| 4 | E6 encoding roundtrip + invalidation | **S–M** | 3 (same function); fix-03 D4 helper location |
| 5 | E2a `workingCode` dirty semantics + `adoptWorkingCode` | **M** | — (latent per N1, but E1 needs its helper) |
| 6 | E4 conflict policy (phase 1 renderer, phase 2 mtime guard) | **M** | 5 (`hasUnsavedChanges`), 3–4 (FileService), fix-03 D5 |
| 7 | U6/N4 flush registry wiring + `ConditionSaving` rewrite | **S** | fix-05 §2.3 module contract (create-if-first at agreed path) |
| 8 | E1 close guard | **M** | 1, 5, 7; fix-03 D1 (bounded save hangs) strongly recommended first |
| 9 | E2b reconciliation banner (source-view re-enable prerequisite) | **S** | 5; ships dark until N1 is reversed |

Steps 1–5 are mutually independent apart from the noted FileService sequencing; 6–8 build on them.

Cross-slice dependencies (explicit):

- **Slice 1 (parser fidelity):** E3 ↔ P7/`allowPartialModel` is a same-release pair (fix-01 §risks already flags it). Additionally, until slice 1's fidelity work lands, *every* editor save of a parsed file rewrites it through the lossy generator (P1–P6) — this slice makes saves safe *procedurally* (no unintended saves, atomic, right encoding), but byte-content fidelity is slice 1's; do not claim "save is lossless" until both are done.
- **Slice 3 (workers):** D1's timeout bounds "Save and close" (E1); D4 shares FileService edit territory with E5/E6; D5 defines `FileState.saveError` that steps 1/4/6 render — agree the field shape (`kind: 'timeout' | 'worker-crashed' | 'encoding' | 'external-conflict'`-style union) before either slice finalizes.
- **Slice 5 (undo/debounce):** flush registry co-owned (§2.3 there, step 7 here); N9/F-B (`resetBatchHistory` on reload) stays in slice 5; fix-05 §2.2 transactional snapshots absorb E2a's new no-op mutation path.
- **Slice 8:** real-Electron E2E for close/atomic-write; crash logging for the E1 force-close path.

Risks:

- **Close-guard deadlock/force-close:** a hung renderer would make close impossible — mitigated by the 3 s ACK safety timer (force-`destroy`), which itself risks losing data in exactly the situation where nothing better is possible; log it (slice 8).
- **Windows rename semantics (E5):** AV/indexer locks can fail `rename` transiently — bounded retries; if a platform issue survives QA, the fallback is *not* in-place write (reintroduces truncation) but surfacing the error and keeping the file dirty.
- **Encoding refusal UX (E6):** refusing lossy writes turns previously "successful" saves into errors for users with mixed-locale content — the error copy must be actionable; the ASCII→1252 upgrade removes the most common case (German umlauts in ASCII-detected files).
- **E2a mutation refusal** changes store semantics for a currently-unreachable path (N1) — cheap now; risky later if the source view is re-enabled without E2b. The re-enable checklist in §2/E2b is the guard.
- **`expectUnchanged` mtime guard (E4 phase 2):** mtime granularity on FAT/network shares can be coarse (2 s) — a same-stamp external write in the same second slips through; the watcher path (phase 1) still catches it moments later. Accepted residual.
- **Behavioral churn in `useAutoSave` gating (E3):** files that previously auto-saved (errored-then-edited) now visibly refuse until forced — this is the *point*, but release notes must say so.
