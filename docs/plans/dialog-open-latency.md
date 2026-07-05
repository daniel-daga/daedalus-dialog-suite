# Plan: Fix dialog-open latency (1–2 s per dialog click)

**Status: active**

## Problem

Clicking a dialog entry in the dialog list takes 1–2 seconds even though the
project is fully indexed at load time. Two independent costs stack on every
click; the second one applies even when no parsing is needed.

### Cause 1 — cross-file clicks re-parse the whole file, ignoring both caches

`handleSelectDialog` (`useDialogNavigation.ts`) calls `fileStore.openFile`
whenever the dialog's file is not the active file. `openFile`
(`fileStore.ts:300`) unconditionally does `readFile` IPC → `parseSource` IPC
(full tree-sitter parse + two semantic passes in a worker, model
structured-cloned worker→main and main→renderer) → `ensureActionIds`. It never
consults:

- `projectStore.parsedFiles` — which already holds this file's model because
  `handleSelectNPC` parsed every file of the NPC via `getSemanticModel` when
  the NPC was selected. The **first dialog click after selecting an NPC always
  re-parses a file that was just parsed**.
- its own `openFiles` map — so switching between dialogs of two NPCs
  re-parses on **every** click, forever.

Measured on the real parser pipeline (generated realistic DIA files):
~130 ms for a 108 KB / 40-dialog file, ~530 ms for a 400 KB file (dominated by
the `pass2` linking visitor, linear in file size), plus 2× structured clone.

Each `openFile` additionally triggers `storeSync` →
`projectStore.updateFileModel` → full re-merge (`loadAndMergeNpcModels`) →
new `mergedSemanticModel` identity → global re-render (dialog tree, search
panel, every autocomplete option list).

### Cause 2 — every click unmounts and remounts the entire editor pane

`finalizeDialogSelection` (`useDialogTransition.ts`) sets
`isLoadingDialog = true`; while true, `EditorPane` renders only a spinner —
`DialogDetailsEditor` is **unmounted**. Two RAFs later the flag clears and the
editor **remounts from scratch in a synchronous high-priority render**. The
`startTransition` only ever commits the cheap spinner; the expensive mount
happens outside it, blocking the main thread.

The mount is expensive because `useVariableOptions` scans **all** project
constants/variables/instances/NPCs/dialogs and sorts them with
`localeCompare`, in a per-component-instance `useMemo` that is empty on mount.
Nearly every action renderer and condition field mounts a
`VariableAutocomplete` (28 files). Measured at realistic Gothic-project scale
(~11 k symbols, ~7 k dialogs): 6–20 ms per field, ~160 ms for 12 fields —
before MUI mount cost for 10–20 action cards.

---

## Phase 1 — Stop re-parsing on dialog click

### 1.1 Reuse already-open files (fixes repeat cross-file clicks)

In `useDialogNavigation.handleSelectDialog` and `handleSelectRecentDialog`:
when `openFiles` already contains the target file, call the existing
`setActiveFile(filePath)` (`fileStore.ts:990`, built exactly for
"focus an already-open file without re-reading") instead of `openFile`.

This also fixes a latent bug: `openFile` on an already-open **dirty** file
resets `isDirty`/`originalCode` and re-reads disk, silently discarding
in-flight edits inside the auto-save debounce window. `setActiveFile`
preserves the FileState (including any `externalConflict`, which the existing
conflict dialog flow handles).

**Tests first (Jest, store/hook level):**
- file already in `openFiles` + selection of a dialog in it → no
  `window.editorAPI.readFile`/`parseSource` calls (spy on mock `editorAPI`),
  `activeFile` updated.
- already-open **dirty** file keeps its model, `isDirty`, and `workingCode`.

### 1.2 Reuse the project index on first open (fixes first click after NPC select)

Extend `openFile` with an optional pre-parsed model:
`openFile(filePath, opts?: { model?: SemanticModel })`.

- Caller (`useDialogNavigation`, which already imports both stores — the
  fileStore↛projectStore layering from `storeSync.ts` stays intact) passes
  `projectStore` cached model for the path (via `getSemanticModel`, which
  returns the `parsedFiles` cache hit or parses once).
- With `opts.model`, `openFile` still does `readFile` (cheap; `originalCode`
  must be disk-true) but skips `parseSource` and applies `ensureActionIds`
  (verified copy-on-write, safe on the shared cache object) to the supplied
  model.
- Staleness: `parsedFiles` is invalidated by `FileWatcherService`, the same
  trust level the rest of the app already relies on.
- Do not pass a model when the cached entry `hasErrors` — fall back to the
  current parse path so error recovery behavior is unchanged.

**Tests first (Jest):**
- `openFile(path, { model })` → no `parseSource` IPC, `openFiles` entry has
  dialog-line action IDs, `activeFile` set, `originalCode` = disk content.
- `openFile(path)` without model → unchanged behavior (existing tests).

Expected outcome after Phase 1: cross-file dialog clicks cost one `readFile`
IPC (~ms) instead of a full parse; repeat clicks cost nothing on the file
side. The first-open `storeSync` push still causes one re-merge per file
(new object identity from `ensureActionIds`) — acceptable; Phase 3 removes
most of the re-render cost that follows a merge.

---

## Phase 2 — Keep the editor mounted across dialog switches

### 2.1 Replace the RAF two-frame machinery

Rework `useDialogTransition`:
- `finalizeDialogSelection` = `startTransition(() => setSelection(...))`.
- Loading state = `isPending` from `useTransition` OR the explicit
  "async file open in flight" flag set by navigation handlers. Delete the
  RAF-id refs, cancellation bookkeeping, and transition-id guard — `isPending`
  is race-free by construction.
- Scroll-to-top moves to a `useEffect` keyed on
  `selectedDialog`/`selectedFunctionName` next to the scroll container.

### 2.2 Overlay instead of unmount

`EditorPane`: while loading, keep rendering `DialogDetailsEditor` (previous
content during the transition) and draw an absolutely-positioned spinner
overlay on top, instead of returning the spinner shell. Placeholder branches
(no dialog selected, missing function) stay as-is. Do **not** key
`DialogDetailsEditor` by dialog name — reconciliation must update in place;
action cards are already keyed by stable action ids.

### 2.3 Reset per-dialog UI state explicitly

Mounting used to implicitly reset `useDialogEditorUIState` (snackbar,
`propertiesExpanded`, source-view open) and focus refs. Review each field and
reset the ones that are per-dialog via an effect on `dialogName`;
`useFocusNavigation.trimRefs` already handles path pruning.

**Tests:**
- Jest: reworked `useDialogTransition` — pending during transition, cleared
  after commit; stale-selection race (two rapid finalize calls end on the
  second selection).
- Playwright (existing browser-harness suite covers dialog switching:
  `dialog-editing.spec.ts`, `view-switching.spec.ts`, `dialog-focus.spec.ts`;
  they must stay green). Add one spec: rapid double dialog switch ends with
  the second dialog's title/actions rendered — this guards the race the RAF
  cancellation used to guard, and must be written failing-first against the
  current implementation being replaced.

Expected outcome: same-file dialog clicks drop from "spinner + full remount"
to a single in-place transition render; all `useVariableOptions` memos and
MUI subtrees survive the switch.

---

## Phase 3 — Shared autocomplete option pool

### 3.1 Hoist pool building out of per-instance `useMemo`

Add a module-level cache (pattern mirrors `mergeCache` in `projectStore`):
key = identity tuple of the source records (project + local category refs,
`dialogIndex`, `npcList`, `routineList`). Value = the **unfiltered, sorted**
option pool, built once per model change instead of once per mounted field.

### 3.2 Per-field filtering without re-sorting

`useVariableOptions` derives its result from the pool by filtering
(`typeFilter`/`namePrefix`/`show*` flags); the pool is pre-sorted and
filtering preserves order, so the per-field `localeCompare` sort disappears.

Semantics caveat to preserve exactly: in the current code, name shadowing
(`seenNames`) only applies to options that pass the field's filters — a
constant excluded by `typeFilter` does not shadow a same-named variable. The
pool must therefore keep same-named entries from all sources (grouped or
ordered by source priority: constant → variable → instance → dialog), and
each field's pass dedups after filtering.

**Tests first (Jest):**
- identity stability: two calls with identical refs/config return the same
  array identity (no recompute);
- changed category ref → recompute;
- filter parity with the current implementation, including the shadowing
  case above (same name as filtered-out constant and matching variable).

---

## Phase 4 — Verification

1. Editor workspace: `npm test`, `npm run lint`, `npm run typecheck:renderer`
   + main-process typecheck, `npm run test:e2e` — all green.
2. Manual smoke in the dev app with a real project: select NPC → click
   through dialogs of the same NPC and across NPCs; verify sub-100 ms
   perceived open (React DevTools profiler / `console.time` around
   `handleSelectDialog` during the smoke pass only).
3. Update `docs/architecture/render-performance.md` (and
   `dialog-editor.md` if the selection flow is described there) with the
   durable decisions; then delete this plan file.

## Sequencing and risk

Order: 1 → 3 → 2. Phase 1 is lowest-risk/highest-win and independent.
Phase 3 is mechanical with clear test parity. Phase 2 changes UX sequencing
(loading overlay semantics, implicit state reset) and lands last with the
extra Playwright coverage.

## Non-goals (follow-ups, not this plan)

- Reducing `pass2` linking cost in `daedalus-parser` (linear but heavy —
  ~400 ms/400 KB; parser-side optimization is a separate effort).
- Minimizing the merge-rebuild cascade in `updateFileModel` beyond what
  Phases 1/3 already avoid.
