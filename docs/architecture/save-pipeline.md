# Save / Dirty-State Pipeline Architecture

Durable decisions from remediation slice 2 (fix-02, 2026-07-03). This covers
the full path from user intent to bytes on disk: dirty tracking, auto-save
gating, the write itself, external-change conflicts, and window close.

## Dirty-state model

`FileState.isDirty` records model edits. External conflicts are stored
separately in `externalConflict`. Every discard decision uses
`hasUnsavedChanges(fs) = fs.isDirty || !!fs.externalConflict`, exported from
`src/renderer/store/fileStore.ts`. The source-edit state described by earlier
versions of this document has been removed.

## `hasErrors` lifecycle

**`semanticModel.hasErrors` is the single source of truth for "this model is a
partial parse"; no editor mutation may clear it** — nothing a mutation does can
make a partial model whole. `fileState.hasErrors`/`errors` are a parse-state
mirror, set only where a fresh parse lands (`openFile`, `reloadFile`).
Validation failures live in the separate
`autoSaveError` field (cleared by the next mutation), never in `hasErrors`.

Auto-save candidacy (`isAutoSaveCandidate` in `useAutoSave.ts`):

```
isDirty && !semanticModel.hasErrors && !autoSaveError && !externalConflict
```

A parse-errored model can reach disk only through the **manual force path**
with informed consent: `ValidationService.validate` reports a `syntax_error`
("saving from the visual editor will drop the content the parser could not
read") and generates with `allowPartialModel: true` (the parser generator
otherwise throws on errored models — see
[parser-fidelity.md](./parser-fidelity.md)); the ValidationErrorDialog button
reads "Save anyway (drops unparsed content)"; `generator:saveFile` passes
`allowPartialModel: options?.forceOnErrors === true`. The dialog view shows a
persistent banner while editing a parse-errored file.

## Voice-ID validation (warnings only)

`ValidationService.validateVoiceIds` warns about duplicate and malformed
`AI_Output` voice IDs (`duplicate_voice_id`, `malformed_voice_id`) — the
in-game failure mode for a duplicate is a silently skipped line. These are
**warnings, never errors**: they must not block saves or flip `isValid`.
Comparison is case-insensitive (Daedalus is case-insensitive); expression-valued
ids (`idIsExpression`) are skipped, and empty ids are already covered by the
DialogLine required-field error.

Cross-file context comes from `ProjectIndex.voiceIds` — built by the metadata
pipeline (`extractFileMetadataFromSource` → metadata worker →
`ProjectService.buildProjectIndex`), keyed by UPPERCASED id. The renderer
(`fileStore.validateFile`/`saveFile`) passes it as
`ValidationOptions.existingVoiceIds`, excluding entries from the file being
validated; outside project mode the option is omitted and validation degrades
to intra-file checks. **Known staleness:** the index is built at project
load/reindex time, not refreshed on every save, so cross-file warnings can lag
until the next reindex.

## Atomic writes (FileService)

`FileService.writeFile` stages to a sibling temp file
`.<basename>.<pid>.<random>.tmp` — the name must **not** end in `.d`, so the
chokidar watcher (which only watches `.d`) never sees temp churn — then
`write → fsync → stat staged file → close → begin watcher write → rename`. The
rename retries 3× with 50 ms backoff for transient Windows `EPERM`/`EBUSY` (AV
locks). Every failure mode leaves the original file untouched and best-effort
unlinks the temp. `FileService` captures the staged `{ mtimeMs, size }` before
rename and begins an in-flight watcher write immediately before rename. Events
for that path are queued until rename succeeds or fails. Success commits the
staged signature and classifies queued events; failure aborts it and classifies
them against disk. The lifecycle lives in `FileService`, so
`generator:saveFile`, `file:write`, and `script:appendInsertNpc` share it.
There is no timer or event-count limit: repeated and delayed events are
suppressed while current mtime and size match. A mismatch or failed stat is
external and invalidates caches before notifying the renderer. Metadata
equality is a heuristic, not byte identity: different bytes with the same size
and mtime on a coarse-timestamp or timestamp-preserving filesystem/tool can
remain suppressed until metadata changes or watching stops.

**Backup before destructive force-save:** the force-on-errors path overwrites
the file with generated code that silently drops content the parser could not
read, so it is the one save that can destroy hand-written script. When
`generator:saveFile` runs with `forceOnErrors`, it passes
`backupBeforeWrite: true` to `FileService.writeFile`, which first copies the
current on-disk file verbatim to `<name>.d.bak` (raw byte copy via
`fs.copyFile` — no encode/decode roundtrip; the `.bak` suffix keeps it
invisible to the `.d`-only watcher and project scanner). A missing original is
skipped (nothing to lose); any other backup failure refuses the save with a
`BACKUP_FAILED` FileServiceError — better to refuse than to destroy without a
backup. Normal saves never write a backup.

## Encoding write policy

Before writing, `encodeWithRoundtripCheck` (in
`src/main/utils/encodingUtils.ts`) encodes and decodes back:

- Lossy + encoding was ASCII-detected or uncached → silently upgrade to
  `windows-1252` (byte-identical for pure ASCII; the encoding Gothic tooling
  expects), re-verify, update the cache.
- Still lossy → **refuse the write**: `ENCODING_LOSS:` error naming up to 5
  offending characters with positions. `?`-substitution never reaches disk.

The per-file encoding cache is invalidated on external changes:
`FileWatcherService.setOnExternalChange(cb)` fires after self-write
classification and `main.ts` wires it to `clearEncodingCache` (and the stat
cache below).

## External-modification conflicts

Policy: **suspend auto-save AND prompt** — suspension is the safety mechanism
(a prompt alone loses the race with the 2 s auto-save tick).

- Before handling a batched change, the renderer flushes registered pending
  component edits. A change for a file with `hasUnsavedChanges` then sets
  `FileState.externalConflict { detectedAt, fileMissing? }` (which excludes it
  from auto-save) instead of reloading; `unlink` on a dirty file marks a
  `fileMissing` conflict instead of destroying the FileState. Clean files
  reload via `reloadFile(filePath)`, which reuses the FileState slot and
  preserves `activeFile` (no focus steal); `openFile` keeps activate-on-open
  for genuine opens.
  A keystroke made after this flush but before a clean-file reload completes
  can still be replaced by the loaded model; preserving that local component
  state across model replacement is a separate behavior change.
- `ExternalChangeConflictDialog` resolves: **Keep mine** =
  `saveFile(fp, { overwriteExternal: true })`; **Reload from disk** =
  `reloadFile(fp)` (fileMissing variant: Restore / Discard). Background-file
  conflicts surface as an App-bar chip.
- Main-side backstop (closes the watcher-latency window): `FileService` keeps
  an mtime stat cache; writes default to `expectUnchanged` and reject with
  `EXTERNAL_MODIFICATION:` when disk mtime differs from the cached value,
  unless the renderer passed `overwriteExternal`. The renderer maps that
  rejection back to the same conflict state. Residual: coarse mtime
  granularity (FAT/network shares) can miss a same-second write; the watcher
  path catches it moments later.

## Save-error classification

Extends the fix-03 contract (see
[worker-reliability.md](./worker-reliability.md)) in
`src/renderer/utils/saveError.ts`:

| kind                | message prefix           | source                    |
|---------------------|--------------------------|---------------------------|
| `timeout`           | `PARSE_TIMEOUT:`         | worker pool               |
| `worker-crashed`    | `PARSER_CRASHED:`        | worker pool               |
| `encoding`          | `ENCODING_LOSS:`         | FileService write refusal |
| `external-conflict` | `EXTERNAL_MODIFICATION:` | FileService mtime guard   |

`fileStore.saveFile`'s catch is the one place that classifies a rejection:
`external-conflict` routes to `markExternalConflict` (the conflict dialog),
every other kind populates `FileState.saveError`, and a failed save never
clears `isDirty`. Auto-save has no write path of its own — it calls
`saveFile` (2026-07 3.1) and only adds `autoSaveError` for a validation
refusal. The App-bar indicator renders `describeSaveError` (actionable copy
per kind).

## Mid-save race guards

`saveFile` captures the model reference before the IPC await and only clears
`isDirty` if the file's current `semanticModel` is still reference-equal
(compared outside `set()` — Immer drafts are never reference-equal). Edits
landing mid-save stay dirty for the next tick.

## Pending-edit flush registry

Debounced component-local edits (condition fields, ActionCard, 300 ms) are
invisible to the store until their timer fires. The registry
`src/renderer/utils/pendingEditFlushRegistry.ts`
(`registerPendingEditFlusher(fn): unregister`, `flushAllPendingEdits()`) is
co-owned with slice 5. Rule: **every save/discard *and undo/redo* decision entry
point calls `flushAllPendingEdits()` first, including the watcher before it
decides whether to reload, always at the UI layer — the store
never flushes.** A flusher no-ops unless its timer is pending, then runs the exact
timer body (ref-resolved), so flush and natural fire are byte-identical. The
shared body also no-ops when the local edit shallow-equals the store value (the
flush dirty-guard — see
[render-performance.md](./render-performance.md)); a clean flush writes nothing.
Call sites:

- **Save/discard:** `handleSave`, `performAutoSave`, `App.confirmDiscardChanges`,
  the window-close guard (slice 2).
- **Undo/redo (slice 5):** the `MainLayout` Ctrl+Z/Ctrl+Y keydown handler,
  wrapped in `flushSync` so the flushed edit
  commits *before* the undo runs (otherwise a same-batch flush+undo leaves stale
  local text in the edited card). This makes the first Ctrl+Z after typing revert
  the in-flight burst rather than a late timer clobbering the redo stack — see the
  undo/redo contract in [dialog-editor.md](./dialog-editor.md).

## Window-close guard

`beforeunload` cannot work here (synchronous; cannot await save IPC; Chromium
ignores dialogs in it), so close is intercepted in the **main process**:
`close` → `preventDefault` → `app:closeRequested` to the renderer → renderer
ACKs, flushes pending edits, computes the unsaved set via
`hasUnsavedChanges`. Empty → approve; else a dialog offers **Save and close**
(awaits real saves; any failure keeps the window open with the classified
error — never approve on a failed save; external conflicts must be resolved
first), **Close without saving**, **Cancel**. A 3 s ACK safety timer in main
force-destroys if the renderer is hung/crashed (it covers renderer
unresponsiveness, never user thinking time — the timer is cleared on ACK,
before the dialog waits). `before-quit` needs no extra handling: quitting
closes the window.

## Test-coverage boundaries

Mock-harness Playwright specs cover the conflict dialog and close-guard dialog
via injected watcher/close events (`external-conflict.spec.ts`,
`close-guard.spec.ts`). Real-Electron coverage of actual window close and
atomic-write crash behavior is owned by slice 8's `_electron` critical-path
suite, as is crash logging for the force-destroy path.
