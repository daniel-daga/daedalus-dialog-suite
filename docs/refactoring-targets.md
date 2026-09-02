# Refactoring Targets

Audit of god components, muddled concerns, and maintainability red flags.

---

## Deferred Architectural Splits

### 1. `editorStore.ts` — split into focused stores — done
**File:** `daedalus-dialog-editor/src/renderer/store/editorStore.ts`

Landed: `fileStore` (open/close/save, dirty tracking) and `historyStore`
(undo/redo state + snapshot helpers) are the stores; `editorStore.ts` is a
16-line barrel that keeps `useEditorStore` as an alias of `useFileStore` for
the consumers that only manage files.

---

### 2. `ThreeColumnLayout.tsx` — split layout into sub-components
**File:** `daedalus-dialog-editor/src/renderer/components/ThreeColumnLayout.tsx`

- Sub-components for NPC column, dialog-tree column, and editor column

---

### 3. InlineChoiceEditor sub-list does not re-render on target-function structural changes
**Files:** `daedalus-dialog-editor/src/renderer/components/ActionCard.tsx` (memo comparator),
`daedalus-dialog-editor/src/renderer/components/InlineChoiceEditor.tsx`

Surfaced during fix-05 §2.5. `ActionCard`'s `React.memo` comparator intentionally
ignores `semanticModel` (a deliberate perf guard — the model is large and changes on
every edit). For a `Choice` action, that means when the choice's *target function*
changes structurally (e.g. its actions are reordered) but the `ChoiceAction` itself is
unchanged, the `ActionCard` — and therefore the nested `InlineChoiceEditor` — does not
re-render, so the sub-list shows a stale order. Drag reorder inside a choice sub-list
dispatches and commits correctly (verified: the move handler runs with the right
source/dest under the single hoisted `DragDropContext`), but the UI does not reflect it.

This is pre-existing (not introduced by the context hoist) and out of scope for slice 5.
Fix option: have `InlineChoiceEditor` subscribe to its target function directly from the
store (a granular selector) instead of reading it from the memo-stale `semanticModel`
prop, so it re-renders on target-function changes without re-rendering all `ActionCard`s.
The fix-05 Playwright spec asserts the choice sub-list joins the single context and lifts
a drag; the visible-reorder assertion is deferred to this fix.

---

### 4. Native parser isolation — survive a hard tree-sitter crash (SIGSEGV)
**Files:** `daedalus-dialog-editor/src/main/services/ParserService.ts`,
`daedalus-dialog-editor/src/main/workers/parser.worker.ts`,
`daedalus-dialog-editor/src/main/workers/metadata.worker.ts`

Documented as the "Known limitation: native SIGSEGV" in
[`architecture/worker-reliability.md`](./architecture/worker-reliability.md). The parser
pools run tree-sitter in Node `worker_threads`, which are threads in the **same** process.
A hard native crash (SIGSEGV/abort) inside tree-sitter kills the entire Electron main
process — no `error`/`exit` event fires, so the slice-3 restart-with-replacement machinery
cannot help. Slice 3's defenses cover only the recoverable modes (JS exceptions escaping
the worker, OOM via `resourceLimits`, self-exit, timeout hangs); slice 8 added crash
*visibility* (`render-process-gone`/`child-process-gone` handlers + `LogService`) but not
recovery. So a malformed input that segfaults the native parser takes down the whole app.

Not a worker-reliability bug — an architecture boundary. Fix option: move the native
parser out of the main process into an isolated **`utilityProcess`** (or `child_process`),
so a native crash kills only that child and the existing pool can respawn it, instead of
`worker_threads` sharing the main process's fate. Larger effort (new process boundary + IPC
serialization for parse requests/results); deferred until a real segfault is observed in
practice. Note the NAPI `npmRebuild: false` invariant still applies to whatever process
loads the addon.

---

### 5. The world payload types live on both sides of the boundary
**Files:** `daedalus-dialog-editor/src/shared/worldTypes.ts`,
`zen-world/src/model/`

`VobIndex` is defined in `zen-world` and re-exported by the editor
(`worldTypes.ts:6-8`); `WaynetPayload` is defined in the editor instead
(`worldTypes.ts:71-82`), even though both are shapes the binding emits and the
domain reasons about. The split is historical, not designed.

Noticed while adding `MoveWaypoint` (2026-08-27) and deliberately not fixed
there: the op needed no cross-package type at all once its factory took the
payload's own columns — `(positions, names, waypoint, to)` — so moving
`WaynetPayload` would have been adjacent refactoring the change did not need.

**It was predicted to start costing something at the waypoint gizmo slice, and
it did not** (landed 2026-08-28). The prediction assumed the store would have to
name the type; it holds `selectedWaypoint: number | null` and names nothing, the
overlay and the viewport are both editor-side already, and the two `zen-world`
functions the slice uses take the payload's raw columns — `Float32Array` and
`string[]` — for the same reason `moveWaypoint`'s factory does. So the split is
still only a wart, with no slice yet identified that pays for it.

Fix direction, unchanged: `WaynetPayload` moves to `zen-world` beside `VobIndex`
and the editor re-exports it, matching what already happened for the VOB index.
Small, but it touches every waynet import, so it wants its own commit.

### 6. `ParserService.dispose()` leaves the service permanently dead, and now silently
**File:** `daedalus-dialog-editor/src/main/services/ParserService.ts`

`dispose()` terminates the pool and empties `workers`/`idleWorkers` with no path
to respawn. Making the pool lazy (2026-08-28) did not change that, but it did
change the failure mode: `started` stays `true` after a `dispose()`, so a later
`parseSource` now takes the `if (!this.started)` branch as already-started,
queues a request against an empty pool, and never settles — where before it
queued against an empty pool just as surely, but without a flag implying
otherwise.

Deliberately not fixed there. `dispose()` is documented as a test/teardown
helper and no production code calls it, so a `started = false` reset would have
been error handling for a case that cannot happen — which the repo's rules
forbid. It becomes a real defect the moment `dispose()` gets a production
caller, and the fix at that point is one line.

### 7. The property grid's uncontrolled fields are put right by an *incidental* render
**Files:** `daedalus-dialog-editor/src/renderer/components/world/WorldPropertyGrid.tsx`,
`WorldSurface.tsx`

`EditableField` is uncontrolled, and everything that shows a value in the grid
is corrected by **remounting** through a key that carries the value —
`` `class-${vob}-${field.key}-${text}-${refusals}` ``,
`` `position-${vob}-${axis}-${text}-${refusals}` ``, and the name and visual
fields the same way. `refusals` counts only the *local* refusals the field
decides itself (unparseable text, a number equal to the one already there).

The hole is the refusal that comes back from the **main process**: nothing in
the world changed, so `text` is what it always was, the key does not change, and
the input goes on showing the number the user typed as though it had been taken.

- **The class fields had this and were saved by a coincidence.** The re-read
  effect sets `classProps` to `null` before it fetches, which unmounts the
  section — but that `null` and the read that fills it back in are set a render
  apart in the same tick, so whether the `null` is ever *committed* depends on
  React happening to flush between them. Adding an unrelated MUI `Select` to the
  World bar (the snap step, 2026-08-28) changed that flush and the revert
  silently stopped happening; `WorldSurface`'s refusal path now sets
  `setClassProps(null)` itself, before the read is issued, so the revert is a
  rule rather than a coincidence. **Measured**, not reasoned: with the probe in
  place the failing order is `effect run → fetch resolved → one render`, against
  `effect run → render(null) → fetch resolved → render(props)` before.
- **The base fields had it too, and are fixed the first way (2026-08-28).** The
  measured bug: type `999` into position X, have `applyWorldOps` reject, and
  the field kept `999` while the world holds `10` — same for the name and the
  visual, which read out of the columnar index, never `null`, so no unmount
  saved them. The fix is the refusal generation: `WorldSurface` bumps
  `editRefusals` in `commitOps`' catch (beside the `setClassProps(null)` above)
  and the grid folds `refusalGeneration` into every editable field's key —
  position, name, visual, the class fields and the rotation angles — so a
  main-process refusal remounts them showing the world's own values, no value
  change required.

What remains of this entry: the fields are still uncontrolled and still
corrected by remount-by-key, with Escape a manual `target.value =`. Making them
controlled stays the honest long-term shape; the generation makes the current
one a rule rather than a coincidence.

---

### 8. The World surface loses its geometry when you navigate away from it — fixed
**Files:** `daedalus-dialog-editor/src/renderer/components/MainLayout.tsx`,
`components/world/WorldSurface.tsx`, `components/world/WorldViewport.tsx`

**Landed 2026-08-28.** `MainLayout` rendered `<WorldSurface>` under a
*conditional*, unlike the dialog view; `mesh`, `visuals` and `waynet` are local
`useState` filled only inside `openWorld` and there is no mount-time refetch, so
leaving the World view and coming back left `mesh === null`, the viewport guard
rendering nothing, and the world looking closed while `worldStore.status` still
said open.

Fixed the way Daniel decided: keep it mounted, with a display toggle — the
mechanism `MainLayout` already teaches for the dialog view — and mount it from
the **first visit** rather than the first render, so the lazy chunk that keeps
three.js out of a dialog-only session is still lazy.

Two things the display toggle does nothing about on its own, and both are the
change rather than a follow-up:

- **Hidden means the frame loop does not run.** `WorldViewport` takes `paused`
  and starts/stops the loop through a `start`/`stop` pair the scene effect
  publishes, so a hidden canvas schedules no frame at all. `paused` is
  deliberately not a dependency of the scene effect: rebuilding 31 MB of buffers
  on every tab switch is precisely the cost the mount was kept to avoid. The
  benchmark and `renderFrom` go through the same pair, since both stop the loop
  for the length of a fixed camera path.
- **A mounted surface's shortcuts are still window listeners.** `WorldSurface`
  binds Ctrl+Z/Y, Ctrl+C/V and W/E on `window`, and `WorldViewport` binds `.`
  and Home; bound while hidden, a Ctrl+Z in the dialog view would undo a world
  edit *as well as* the dialog edit `MainLayout` performs. Both handlers are
  off while hidden.

What remains is the shape, not a defect: the surface still holds the world's
buffers in local `useState` with no mount-time refetch, so it is the mount that
keeps them and nothing would restore them if it were ever unmounted again.

---

### 9. The viewport wants an imperative handle — fixed
**Files:** `daedalus-dialog-editor/src/renderer/components/world/WorldViewport.tsx`,
`components/world/WorldSurface.tsx`

**Landed 2026-08-28.** The scene-tree jump reached the framing closure through a
`frameRequest` prop — a fresh `{ vob }` object per double-click, watched by an
effect that hopped through `frameVobRef` — while the closure itself lives inside
the big scene effect.

**The third command arrived, and it did not arrive as W4.** This entry said to
wait for the caller that justifies the promotion and named W4, the script → world
jump, which is still unbuilt. What actually happened is that snapping's
`raycastDown` (2026-08-28) needed a query rather than a prop and *created* the
handle — so the wart stopped being "no handle" and became "one command on the
handle, one on a prop", which is the shape this entry existed to prevent. The
frame is now `WorldViewportHandle.frameVob`, the prop, its state and its effect
are gone, and the surface calls it beside the raycast it already calls.

**The hazard it named is the reason `frameVob` reads through the ref.** The
handle is alive whenever the component is, but `frameVobRef` is set by the scene
effect and cleared by its teardown, and that effect re-runs on
`[mesh, visuals, bbox]`. `frameVob` is `frameVobRef.current?.(vob)`, so a command
during a rebuild is a no-op — pinned by `WorldViewport.frameHandle.test.tsx`,
which asks for one from a parent layout effect, i.e. before the child's scene
effect has ever run.

---

### 10. The terrain bar reserves a hard-coded 31 px — fixed
**File:** `daedalus-dialog-editor/src/renderer/components/world/WorldSurface.tsx`

**Landed 2026-08-28.** The row reserved 31 px for the button its picked state
adds — MUI's small-button metrics, copied into a constant so the bar does not
shove when a point is picked. The number was right and unverifiable: a theme
that sets a button height moves it, and jsdom has no layout, so no test could
have caught the drift.

The reservation is now a real small `Button`, hidden (`visibility: hidden`,
zero-width, `aria-hidden`, `tabIndex={-1}`) and rendered only in the branch that
has no buttons of its own. Only its *horizontal* metrics are taken away: the
vertical padding is the height being reserved, and it carries a `&nbsp;` so it
has a line box to be as tall as — an empty button would have reserved nothing,
which is the shove back again. It is the theme's own metric rather than a copy of
it, so it cannot disagree with the buttons it stands in for — which turns the
untestable claim into a structural one a jsdom test *can* make: the spacer is a
`MuiButton-sizeSmall`, and it gives way to the real ones on a pick
(`WorldSurface.editing.test.tsx`).

The one wart the fix carries: MUI's `Stack` spacing selector outranks a child's
`sx`, so the spacer overrides its own margin with `!important`.

---

### 11. `linking-visitor.ts` is a god class
**File:** `daedalus-parser/src/semantic/visitors/linking-visitor.ts`

1,016 lines and 48 methods carrying five concerns — reference resolution,
action extraction, condition extraction, call-site bookkeeping and comment
attachment — with a literal duplicate (`isCallInsideComparisonBinary` and
`hasComparisonBinaryAncestor` have byte-identical bodies) and a denormalized
mirror: every action is pushed to `currentFunction.actions` *and* to
`dialog.actions` (`:624-628`), which then has to be kept in step on removal
(`:733`). Fix direction: one visitor per concern behind the two-pass
orchestrator, and `Dialog.actions` derived from the information function rather
than stored twice. Surfaced by the 2026-07 review (item 6.2).

---

### 12. `setupIpcHandlers` is 600 lines of inline handler bodies
**File:** `daedalus-dialog-editor/src/main/main.ts` (`setupIpcHandlers`, `:205-809`)

`generator:saveFile` was lifted into `SaveFileFlow.ts` (the MCP plan's Phase 0)
and `script:appendInsertNpc` into `AppendInsertNpcFlow.ts`; the other 45
handlers still carry their orchestration inline — request shape checks, dialog
prompting, allow-listing the chosen directory, error wrapping — so the one
function that registers the IPC surface is also where most main-process flows
live. Fix direction: the two extracted flows are the template; a handler whose
body is more than a delegation moves out beside them, and `setupIpcHandlers`
becomes a registration table.

---

### 13. `deserializeSemanticModel` normalizes every action twice
**File:** `daedalus-parser/src/semantic/semantic-model.ts` (`:1017-1026`)

The function loop runs `ensureActionType` over `funcJson.actions`, then maps
the same array through `deserializeAction`, whose first line is
`ensureActionType(json)` again (`:716`). Harmless — the second pass finds the
discriminator already set — but the loop-level call is dead work on every model
crossing the IPC boundary, and a reader has to prove to themselves that the two
calls agree. Fix direction: drop the loop-level `ensureActionType`; the
per-action one inside `deserializeAction` is the one recursion into
`thenActions`/`elseActions` already depends on.

---

### 14. The quest UI sits flat at `components/` root
**Files:** `daedalus-dialog-editor/src/renderer/components/QuestEditor.tsx`,
`QuestList.tsx`, `QuestDetails.tsx`, `CreateQuestDialog.tsx`

The other surfaces with several files own a folder — `Problems/`,
`Simulator/`, `world/` — while the four quest files sit among some fifty
siblings at the root. `docs/architecture/quest-editor.md` (§Scope, §Internal
Boundaries) was aligned to the flat layout rather than the layout to a folder,
and `tests/questDomainBoundary.test.ts` guards only the domain side (domain
must not import UI); nothing names the UI files as one unit. Fix direction:
`components/QuestEditor/` holding the four, the doc's two file lists and the
boundary test's UI-tree path updated in the same change.

---

### 15. Cross-store wiring is split between `initStoreSync` and a module-level subscribe
**Files:** `daedalus-dialog-editor/src/renderer/store/storeSync.ts` (`initStoreSync`, `:36`),
`store/historyStore.ts` (`:263`)

`initStoreSync` is the documented home for store-to-store subscriptions —
editor → project model push, world → problems rescan — and returns the
unsubscribe that tests rely on. `historyStore.ts` wires itself to `fileStore`
by a `useFileStore.subscribe` at module scope instead, so it runs on import,
cannot be torn down, and is not visible from the one place that claims to hold
the wiring. Fix direction: move the history cleanup subscription into
`initStoreSync` beside the other two; `useAutoSave.ts:167` is a hook-scoped
subscription with its own lifecycle and stays where it is.
