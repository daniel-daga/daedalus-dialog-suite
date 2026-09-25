# The editor's own save is seen as an external change (#282)

Long form of issue #282. Two faces — a "File changed on disk" dialog every few
seconds, and characters vanishing while typing — from one defect: a write the
editor made itself is classified as an external change.

## Why the suppression leaks

`FileWatcherService.notifySelfWrite(path)` marks the path in a `Set` and
schedules a `delete` **2 000 ms** later; `handleEvent` suppresses one event and
deletes the mark. Three things are wrong with that, and all three are visible in
the code rather than inferred from the report:

1. **The expiry is a per-path timer, not a per-write one.** Two saves closer
   together than 2 s share the key, and the *first* save's timer deletes the
   *second* save's mark. `autoSaveInterval` is `2000`
   (`fileStore.ts:341`) — the same number.
2. **Nothing bounds chokidar's latency.** `awaitWriteFinish` adds ≥300 ms, and
   the stability poll restarts on every touch; a large Gothic script tree, a
   network path or an AV scan pushes the event past 2 s, and then the mark is
   already gone. `save-pipeline.md` names this as an accepted residual — the
   tester's report is that residual arriving.
3. **One mark suppresses exactly one event.** A second event for the same write
   (a Windows rename-over can emit more than one) passes straight through.

## Why a leaked event eats keystrokes

`useFileWatcher.flushChangedFiles` branches on `hasUnsavedChanges`:

- **dirty** → `markExternalConflict` → the conflict dialog. This is the "every
  few seconds" dialog.
- **clean** → `reloadFile`, which installs a freshly parsed model. `ActionCard`
  resyncs local state from its prop (`useEffect([action]) → setLocalAction`), so
  the field's typed text is replaced by the disk text. No dialog, characters
  simply disappear.

The clean branch is the likely one while typing: for the first 300 ms after each
keystroke the edit is still in `ActionCard`'s debounce and the store is *not*
dirty. `flushChangedFiles` never calls `flushAllPendingEdits()`, so it reads a
dirty flag that does not yet know about the keystroke it is about to discard.
That is a defect in its own right — a *genuine* external change silently eats
the in-flight burst too, instead of raising the conflict dialog.

## The fix, two layers

### 1. Main: identity, not a timer

Suppress by comparing file metadata with a signature captured from our staged
write. This is a metadata heuristic, not exact byte identity.

- In `writeFileAtomic`, after writing and syncing the temporary file, capture
  `{ mtimeMs, size }` through its open file handle, before closing and renaming
  it. Never derive the self-write signature from a post-rename lookup of the
  target: an external replacement may already occupy that path.
- Wire a main-process write observer into `FileService`, so all writes share
  the lifecycle below inside the existing per-path write lock. Remove the
  after-return `notifySelfWrite` calls from `SaveFileFlow` (both write sites),
  `main.ts`'s `file:write`, and `AppendInsertNpcFlow`. The public IPC write result
  need not acquire metadata fields.
- Immediately before the rename attempt, begin an in-flight write with the
  canonical path and staged signature. Return a token identifying this write
  and watcher generation. While it is pending, queue events for that path;
  do not classify them against the previous signature or forward them yet.
- On successful rename, commit that token's signature and drain queued events
  before awaiting the existing post-write cache refresh. Retain one committed
  signature per path, replacing the previous signature, with no expiry.
- On rename failure, abort the token without installing the staged signature,
  retain any previous committed signature, and drain queued events against
  the actual disk state. Every terminal path must release pending events;
  observer errors must not turn a completed disk write into a reported write
  failure. Failures before begin require no watcher cleanup.
- For each event with a committed signature, stat the reported path: equal
  `mtimeMs` **and** `size` suppresses the event and keeps the signature, so
  delayed and duplicate events are suppressed too. A mismatch or failed stat
  forwards the event through normal cache invalidation and drops the signature.
  With no committed signature, forward normally. Preserve event types when
  draining; do not silently drop a queued deletion or external replacement.
- Clear committed signatures and pending events unconditionally on
  `stopWatching`, and invalidate outstanding tokens. Completion from an old
  watcher generation must not populate or notify a new project subscription.

An external replacement between rename and the existing post-write stat cannot
be adopted as our signature because the signature came from the temporary
file. Events arriving before write completion are deferred, not leaked. Verify
that rename preserves the staged mtime/size in the supported filesystem tests.
Metadata equality still cannot distinguish different bytes with the same size
and mtime: coarse timestamps or timestamp-preserving external tools can cause
suppression until metadata changes or watching stops. If exact byte identity is
required, compare against the encoded bytes actually written; a target stat
after rename cannot provide that guarantee. The existing `expectUnchanged`
precondition remains a separate metadata-based guard.

### 2. Renderer: a reload may not discard newer keystrokes

`flushChangedFiles` calls `flushAllPendingEdits()` before it reads
`useFileStore.getState()`, exactly as `performAutoSave` does — it is a hook, the
UI layer, and the store still never flushes. A keystroke inside the 300 ms
debounce then counts as dirty, so a genuine external change raises the conflict
dialog instead of silently overwriting the buffer.

Residual left open deliberately: a keystroke landing *after* the flush and
before `reloadFile` applies (one `readFile` + parse, tens of ms) is still lost,
on genuine external changes only. Closing it means teaching `ActionCard`'s
prop-sync to keep a live local edit, which changes how every model swap (undo,
conflict resolution) behaves — out of scope here.

Rejected: a renderer-side content guard ("re-read and compare against what we
last wrote"). It needs a new `FileState` field mirroring `originalCode` —
`originalCode` itself cannot be updated on save, because `historyStore`'s
subscription reads a changed `originalCode` + clean file as a reload and would
clear undo history on every auto-save tick. Keep self-write classification in
main, with the metadata limitation stated above; do not describe it as an exact
content comparison.

## Steps

1. **Failing Jest (main).** `tests/FileWatcherService.test.ts`: a self-write
   whose event arrives after the old 2 s window is still suppressed; a second
   event for the same write is suppressed; a write with a *different* on-disk
   signature is forwarded; a failed stat is forwarded. Include consecutive
   writes less than 2 s apart, retaining only the latest signature. The existing "suppresses
   only the first event" and "does not keep the event loop alive" tests encode
   the old contract and are replaced — the second's rationale (an unref'd 2 s
   timer) disappears with the timer.
   → verify: red for the right reason, then green.
2. **Failing integration tests, then implement layer 1.** Extend the existing
   FileService atomic-write tests and watcher tests with controlled promises:
   replace the target externally between rename and post-write stat and assert
   that its event is forwarded; deliver an event while rename completion or
   post-write work is pending and assert that our echo is suppressed. Test a
   failed rename with queued external events, a pre-rename failure, consecutive
   serialized writes, and stop/restart while a token is outstanding. Assert
   that staged metadata matches the renamed file using a real temporary file.
   Implement staged signature capture, the write observer and token lifecycle,
   event draining, metadata comparison, and removal of caller-side registration.
   Keep the current successful-write semantics if the later cache stat fails.
   → verify: `tests/saveFileFlow.test.ts`, `tests/appendInsertNpcFlow.test.ts`
   green with suppression owned by FileService; cover the direct `file:write`
   route too. Run the new integration cases red before implementation, then green.
3. **Failing Jest (renderer).** `tests/useFileWatcher.batching.test.ts`: an
   event for an open file with a pending debounced edit registered through
   `registerPendingEditFlusher` marks a conflict rather than reloading.
   → verify: red, then green after adding the flush.
4. **Failing Playwright, real Electron.** A new case in
   `tests/e2e-electron/external-change-reload.spec.ts` — it is the only harness
   with the real chokidar watcher and real writes; the mocked-IPC browser
   harness cannot produce a self-write echo at all. Use a test-only delivery
   barrier after the real watcher receives an own-write event but before
   classification. Hold it beyond the old 2 s expiry, type a distinctive suffix
   into the real Text field, release the event, and assert that the complete
   value survives and no conflict appears. Synchronize release and processing
   with explicit harness signals; merely sleeping 3 s and typing again does
   not reproduce the defect. Keep fault injection out of normal app startup.
   The focused renderer test separately guarantees the pending-debounce case.
   → verify: run this regression red before implementation and green afterward;
   the old code must reload or conflict because of the deliberately delayed
   event, not because of an unrelated timeout. Confirm
   by hand that it drives the real field, per the editor's E2E rule.
5. **Docs.** `docs/architecture/save-pipeline.md`: replace the "2 s self-write
   suppression window / residual risk" sentence under *Atomic writes* and the
   watcher bullet under *External-modification conflicts* with the signature
   rule, in-flight lifecycle, and metadata-equality limitation. Document the
   separate renderer reload race still deferred below. While there, the *Dirty-state model*
   section still claims `hasUnsavedChanges` includes `isSourceDirty`; the code
   is `isDirty || !!externalConflict` since the source view was removed.
6. **Full checks.** `pnpm --filter daedalus-dialog-editor test`, `lint`,
   `typecheck` (main and renderer), and the Electron spec.
   Close with `Closes #282`.

## Not in scope

- The `3221226505` exits (#224) and anything else the watcher touches.
- `ActionCard`'s prop-sync policy (see the residual above).
- Whether auto-save should be 2 s at all. The fix removes the coupling between
  the interval and the suppression window, so the number stops mattering.
