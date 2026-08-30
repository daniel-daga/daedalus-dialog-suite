# World surface UI improvements — interaction, toolbar, layout

## Context

The World surface works but is ergonomically bare: a monolithic text-only toolbar that wraps to 2–3 rows on narrow windows (pushing the viewport down), fixed non-resizable 280/300 px side panels, almost no keyboard support beyond W/E/copy/paste/undo, no context menus anywhere (production-readiness F10 is app-wide), no visible undo/redo on the bar, and a scene tree you can't drive with the keyboard. Daniel picked three tracks: **interaction quick wins**, **toolbar restructure**, **layout & panels**. The property-grid upgrade and the board's carded features (Insert NPC, scatter brush, model browser, first-person nav) stay out of scope.

All work is in `daedalus-dialog-editor/`. Central files: `src/renderer/components/world/WorldSurface.tsx` (2,412 lines — this plan shrinks it), `WorldSceneTree.tsx`, `WorldViewport.tsx`, `src/main/services/WorldService.ts`.

**Settled decisions that must survive untouched:** gizmo anchor asymmetry (translate=centroid, rotate=last-picked), no scale gizmo, selection rendering, one Problems panel, delete is single-selection and always confirms (barrier op clears undo stack), uncontrolled `EditableField` mechanism, no docking framework.

**Verified ground truth the plan relies on:**
- One window `keydown` handler in `WorldSurface.tsx:1458-1523` (W/E, Ctrl+C/V/Z/Y) with INPUT/TEXTAREA/SELECT/contentEditable guard, bound only when `summary && !hidden`. New keys join it.
- Right mouse button is free: `cameraNav.ts:76` sets `RIGHT: null`; no `contextmenu` handler exists in the renderer.
- `handleTranslateSelection(delta)` (`WorldSurface.tsx:787`) is the gizmo's commit path — one batch, one undo entry.
- VOB and waypoint selection are mutually exclusive in `worldStore` — Delete key can check waypoint first, then VOB.
- Undo depth is NOT exposed over IPC; `WorldService` holds the stacks privately. The app-bar undo/redo buttons (`App.tsx:74-76,248`) drive the **dialog** history unconditionally — only the keyboard path is view-guarded (`MainLayout.tsx:90`).
- Renderer view prefs persist via **localStorage** (theme pattern in `main.tsx`); `SettingsService` is for main-process/security-adjacent config → panel widths go to localStorage.
- `tests/WorldSurface.editing.test.tsx` (~179 cases, 3,660 lines) installs a module-level `window.editorAPI` mock — **any new API method WorldSurface calls unconditionally must be added there or the whole suite crashes**.
- The browser Playwright harness (`tests/e2e/world-surface.spec.ts` + `mockAPI.ts`) deliberately refuses to open a world — world-open E2E lives in `tests/e2e-electron/` (real Electron, `minimal.g2.zen` fixture, self-skips without the addon).

## Ordering

Quick wins first (small diffs inside the existing handler, immediate value, don't touch JSX Track B is about to move); toolbar restructure next (absorbs tooltips, hosts undo/redo buttons — the monolith is reshaped once); context menus and tree nav layered on the reduced surface; panels last (purely additive). Each slice independently shippable, TDD per slice.

## Slices

### Slice 0 — enabler: shared world test fixtures
Pure refactor, existing suite is the net. New `tests/worldFixtures.ts`: move the pure-data builders (`vobIndex`, `SUMMARY`, `waynetPayload`, `BASE_PROPS`, editorAPI mock factory as `makeWorldEditorApi()`) out of `WorldSurface.editing.test.tsx`. The `jest.mock('.../WorldViewport')` factory cannot move (hoisting) — each new test file declares its own lean stub.

### Slice 1 — Delete key opens the existing delete confirms
Tests first (new `tests/WorldSurface.shortcuts.test.tsx`): single VOB + Delete → `world-delete-warning` visible, confirm → `DeleteVob` op; multi-selection → nothing; selected waypoint → waypoint confirm; Delete in an input → nothing; `hidden` → nothing.
Impl: in the existing handler — waypoint selected → `setDeletingWaypoint(...)`, else `selection.length === 1` → `setDeleting(selection[0])`. Backspace stays unbound. The confirm dialog remains the commit gate.

### Slice 2 — Escape clears the selection
Tests: Escape clears VOB selection / waypoint selection; Escape while a dialog is open closes the dialog and selection **survives**; Escape in an input → untouched.
Impl: same handler; skipped while any surface dialog is open (`deleting`/`deletingWaypoint`/`placing`/`confirmingSave`/`addingWaypoint`) — otherwise Escape-closing a confirm would also discard the selection it was about.

### Slice 3 — Arrow-key nudge
Tests: ArrowRight → `MoveVob` batch delta `[10,0,0]` (default step 10 cm); snap 100 → `[100,0,0]`; Shift ×10; PageUp/Down → ±Y; empty selection or input focus → nothing; focus inside the tree → nothing.
Impl: same handler; world-axis nudge (ArrowLeft/Right ∓/± X, Up/Down ∓/± Z, PageUp/Down ± Y — ZenGin Y-up), step = `snapGrid > 0 ? snapGrid : 10`, Shift ×10, `preventDefault()`, then `handleTranslateSelection(delta)`. Guard `closest('[role="tree"]')` reserves arrows for slice 7. Decision: nudge step *is* the snap step (consistent with "snapping applies to deltas"); one keypress = one undo entry (no coalescing — main-process change explicitly out).

### Slice 4 — Undo/redo depth over IPC + World-bar buttons
Tests: extend `tests/WorldService.test.ts` (`historyDepth()` → `{undo,redo}` counts, barrier → `{0,0}`); new `tests/WorldSurface.toolbar.test.tsx` (`world-undo`/`world-redo` disabled at zero depth, enabled after a commit, click → `undoWorldEdit()` → `applied(ops)`).
Impl: `WorldService.historyDepth()` (stack lengths), IPC `world:historyDepth`, preload `getWorldHistoryDepth`; renderer refreshes depth at the end of `applied()` and after `openSucceeded`. Two `IconButton`s with tooltips. **Must extend**: the `api` mock in `WorldSurface.editing.test.tsx`, `mockAPI.ts`, `preload.ts`, `global.d.ts`.
Included sub-slice: the app-bar undo/redo **buttons** still drive dialog history while the World view is active (button-shaped hole of the already-settled keyboard rule) — disable them when `activeView === 'world'`, one test beside `MainLayout.worldUndo.test.tsx`.

### Slice 5 — Toolbar restructure (absorbs tooltips)
Tests first (new `tests/WorldToolbar.test.tsx`): group containers `world-toolbar-{file,overlays,edit,stats}` exist; every icon-converted action has aria-label + Tooltip; bar is `nowrap` + `overflow-x: auto`. Real safety net: the 179-case editing suite passes **unchanged**.
New files under `src/renderer/components/world/toolbar/`: `WorldToolbar.tsx` (Paper + scroll Stack + vertical Dividers), `WorldFileControls.tsx` (install/open/path/spinner/save), `WorldOverlayControls.tsx` (Waynet/Spawns/Time+slider+state/Names/Brightness/Hide), `WorldEditControls.tsx` (gizmo toggle, Snap, Drop, Align, Duplicate, Delete, Undo/Redo), `WorldStatsChips.tsx`. Props-down/callbacks-up; all state stays in WorldSurface; every testid, enablement rule and `{summary && …}` guard moves verbatim. WorldSurface loses lines ~1527-1858.
Overflow decision: single row with horizontal scroll — **rejected** a priority-"More" menu (needs ResizeObserver measurement jsdom can't exercise, and moving controls into a Menu breaks synchronous `getByTestId` in 179 cases).
Icon conversion for secondary actions (Drop/Align/Duplicate/Delete), text labels kept for primary toggles; tooltips carry shortcut hints ("Move (W)", "Delete VOB… (Del)"). Two commits: move-verbatim (green), then iconify (grep the test file for `getByText` on toolbar labels first — e.g. "Duplicate N VOBs" moves to aria-label/tooltip). Tooltip-around-ToggleButton inside ToggleButtonGroup: use `<Tooltip><ToggleButton/></Tooltip>` and cover with a test that the group's value plumbing survives.

### Slice 6 — Context menus (scene tree + viewport)
Tests: new `tests/WorldSurface.contextMenu.test.tsx` (right-click a tree row → `world-context-menu` with `world-context-{frame,duplicate,copy,paste,delete,drop,align,hide-class}`; delete item → existing confirm; right-click outside selection selects first; paste disabled with empty clipboard); extend `tests/WorldSceneTree.test.tsx` (`onContextMenu(vob, {left,top})` prop); new `tests/WorldViewport.contextMenu.test.tsx` (`contextmenu` on canvas runs the async pick, VOB hit → callback, miss → nothing, `preventDefault` in both cases).
Impl: new `src/renderer/components/world/WorldVobContextMenu.tsx` — MUI `Menu` `anchorReference="anchorPosition"`, dense, items only call existing handlers; enablement mirrors the toolbar (Delete: `selection.length === 1`). Thread `onContextMenu` through `WorldSceneTree` rows; add a `contextmenu` listener in `WorldViewport` beside `handleClick` reusing `picker.pickAsync` (VOB hits only; terrain right-click reserved). This is the app's **first** context menu — it becomes the F10 pattern; don't abstract prematurely.

### Slice 7 — Scene-tree keyboard navigation
Tests (extend `tests/WorldSceneTree.test.tsx`): tree container `tabIndex=0`; ArrowDown/Up move selection; ArrowRight expands/enters, ArrowLeft collapses/goes to parent; Enter frames; arrows in the filter field don't navigate; `aria-activedescendant` set. Plus in the shortcuts suite: arrows with focus in the tree produce no nudge ops.
Impl: `WorldSceneTree.tsx` only — container-level `onKeyDown` on the `role="tree"` Box (rows stay non-focusable; react-window unmounts offscreen rows, so roving tabindex is a trap). Movement calls existing `onSelect`; existing selection-follow effects handle expand+scroll. Rows get `id="world-vob-row-<n>"`. Don't bind Home/End (viewport owns Home).

### Slice 8 — Resizable side panels (+ collapse)
Tests (new `tests/WorldSurface.panels.test.tsx`): `world-splitter-left`/`-right` pointer-drag changes panel width state (left clamp 200–480, right 220–520), persists to localStorage on pointerup, restored on fresh render; collapse buttons `world-panel-collapse/expand-{left,right}` restore pre-collapse width. jsdom asserts style/state, not pixels.
Impl: new `src/renderer/components/world/PanelSplitter.tsx` — 6 px Box, `cursor: col-resize`, `setPointerCapture`, `onResize(width)` callback, clamping in the surface; replace the hard-coded widths at `WorldSurface.tsx` ~2017/~2086 with state initialised from localStorage. `userSelect: none` during drag. Viewport's ResizeObserver already handles the canvas. No docking framework.

### Slice 9 — Asset browser filter + breadcrumbs
Tests (extend `tests/WorldAssetBrowser.test.tsx`): `world-asset-filter` narrows rows case-insensitively (current directory only) with count/empty state, resets on navigation; `Breadcrumbs` segments (`world-asset-crumb-*`) navigate to path prefixes.
Impl: `WorldAssetBrowser.tsx` only — small filter TextField above the list; MUI `Breadcrumbs` with `Link component="button"` per segment replaces the static path caption; keep the up-button.

### Slice 10 — E2E coverage
- Extend `tests/e2e/world-surface.spec.ts` only with what its harness can reach: pre-open toolbar structure (`world-toolbar-file` contains `world-open`/`world-choose-install`) — a regression tripwire for the extraction. This harness cannot open a world **by design**; do not fake one into `mockAPI.ts`.
- New `tests/e2e-electron/world-editing-ui.spec.ts` modeled on `world-render.spec.ts` (fixture world, fake install, self-skips without the addon): open world → right-click a tree row → `world-context-menu` → Escape; Delete with a VOB selected → `world-delete-warning` → cancel; drag `world-splitter-left` 80 px → width changed. This is the honest home for the "new UI workflow gets a Playwright spec" rule.

## New testids (no existing ones change)
`world-undo`, `world-redo`, `world-toolbar-{file,overlays,edit,stats}`, `world-context-menu`, `world-context-{frame,duplicate,copy,paste,delete,drop,align,hide-class}`, `world-splitter-{left,right}`, `world-panel-collapse/expand-{left,right}`, `world-asset-filter`, `world-asset-crumb-*`, row ids `world-vob-row-<n>`.

## Verification
Per slice, from repo root:
```
pnpm --filter daedalus-dialog-editor test
pnpm --filter daedalus-dialog-editor lint
pnpm --filter daedalus-dialog-editor typecheck:renderer
```
Slice 10's electron spec needs the dev-build addon (already built on this machine). Manual pass at the end: open a retail world, exercise Delete/Escape/nudge/context menus/splitters on a real screen — several viewport behaviors (§16.12 territory) only a human eye can judge.

## End-of-session bookkeeping (per BOARD.md rules)
Commit per slice with reasoning in the message; update `docs/BOARD.md` at session end; if any slice reveals a forward fact, route it (plan §16 / refactoring-targets / environment-hazards). The toolbar split reduces `WorldSurface.tsx` by ~330 lines — note it against the god-component entry in `docs/refactoring-targets.md` if that file names WorldSurface.
