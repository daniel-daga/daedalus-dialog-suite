# Fix Plan 04 — Quest Editor Stack (Q1–Q5, U1–U2, PF3)

Source findings: [`code-review-findings.md`](./code-review-findings.md) §4 (Q1–Q5), §5 (U1–U2), §7 (PF3).
Tracker: [`code-review-remediation.md`](./code-review-remediation.md) slice 4.

Scope: `daedalus-dialog-editor/src/renderer/components/QuestEditor/` (esp. `QuestLiteGraphCanvas.tsx`), `components/QuestFlow.tsx`, `components/QuestEditor.tsx`, `QuestEditor/Inspector/`, `src/renderer/quest/domain/` + `quest/application/`, quest batch history in `store/historyStore.ts`. Verified against the vendored `node_modules/litegraph.js/build/litegraph.js` (0.7.18).

---

## 1. Findings — confirmations, corrections, and new findings from reading litegraph source

### What litegraph 0.7.18 actually supports for link clicks (Q1 ground truth)

- **`onLinkSelected` does not exist anywhere in the vendored build.** The assignment at `QuestLiteGraphCanvas.tsx:210-228` is dead code; the entire edge workflow (transition text edit, transition removal, condition-link edit in `Inspector/QuestInspectorPanel.tsx:560-672`) is unreachable in production. Confirmed.
- The **real** mechanism (`build/litegraph.js:6240-6261`, inside `processMouseDown`): on left mousedown that is *not* over a node and with `read_only == false`, litegraph iterates `this.visible_links` and hit-tests an **8×8 px box (±4 px) around `link._pos`** (the link's center point, computed during `drawConnections`). On hit it calls **`this.showLinkMenu(link, e)`** — a prototype method (`litegraph.js:10980`) that by default opens a built-in ContextMenu with "Add Node"/"Delete". It is **instance-overridable**: assigning `graphCanvas.showLinkMenu = (link, e) => { …; return false; }` intercepts link clicks with the full `LLink` (which carries `link.id`, already mapped in `linkIdToEdgeRef`).
- Supporting mechanisms that exist and are usable:
  - `graphCanvas.onMouse(e)` (`litegraph.js:5989-5993`) is called at the top of `processMouseDown` with `e.canvasX/canvasY` populated; returning `true` consumes the event. Combined with `graphCanvas.visible_links[i]._pos`, this allows a **custom hit test with a larger radius** than the stock ±4 px.
  - Hover feedback exists: mousemove sets `graphCanvas.over_link_center` with the same ±4 px box (`litegraph.js:6610-6631`), and `render_link_tooltip` / `onDrawLinkTooltip` draw a dot + tooltip at the center (`litegraph.js:8971-9009`).
  - Callbacks the component already uses **do** exist and fire: `onSelectionChange` (7548), `onNodeDblClicked` (7477), `onNodeMoved` (6927), `onMouse` (5991), plus per-node `node.onMouseDown(e, localPos, canvas)` (6203). Only `onLinkSelected` is fictional.

### New findings (not in the original review)

- **N1 — Stale canvases keep receiving input.** The init effect re-runs on every `semanticModel` change (via callback deps) but reuses the **same `<canvas>` element**. Each `new LGraphCanvas(...)` → `setCanvas()` → `bindEvents()` adds a *new* set of `pointerdown/move/up`, `keydown`, wheel, drag listeners to that same element plus a `document`-level `keyup` (`litegraph.js:5702-5761`). Cleanup calls only `stopRendering()`/`clear()` — never `unbindEvents()`/`setCanvas(null)` — so **old LGraphCanvas instances stay wired to the live canvas and still process mouse events** (they can open the built-in search box or link menu on a cleared, stale graph). This is worse than a pure memory leak.
- **N2 — 0.7.18 `unbindEvents()` bug.** `litegraph.js:5778-5779` removes the "move" and "up" listeners using `this._mousedown_callback` (wrong reference), so even a correct teardown leaves canvas-level move/up listeners attached. The `document keyup` removal *is* correct. Consequence: teardown must rely on init-once-per-mount (the canvas element itself is discarded on unmount), not on `unbindEvents` being complete.
- **N3 — `graph.start()` is unnecessary.** It launches a perpetual rAF *execution* loop (`litegraph.js:977-1020`) for `onExecute` node logic; our nodes have none. Rendering is driven by `LGraphCanvas.startRendering()` (started by the constructor), not by `graph.start()`. `graph.clear()` calls `stop()` internally (`litegraph.js:867-868`), so mid-life syncs don't stack loops — but the final loop leaks on unmount, retaining the graph. Fix: **delete `graph.start()`** (QuestLiteGraphCanvas.tsx:463) instead of managing `graph.stop()`.
- **N4 — `moveNode`'s clone is 100 % waste.** `QuestFlow.runQuestCommandWithPreview` discards `commandResult.updatedModel` for `moveNode` (position-only history path, `QuestFlow.tsx:359-365`), yet `executeMoveNodeCommand` deep-clones the entire model per drag just to check `functions[nodeId]` existence (`moveNode.ts:29-30`).
- **N5 — U2 root cause is in the domain, not the history store.** `historyStore.ts:76-90` stores snapshot models **by reference** (Immer structural sharing) — the store itself is fine. The blowup comes from every domain command doing `cloneModel(context.model)` (`commands/shared.ts`) and returning a fully **unshared** model that then becomes the fileStore model and is referenced by all later snapshots. Fix belongs in `quest/domain/commands/`.
- **N6 — Guardrail TOCTOU on top of Q4.** Blocking warnings are computed at *preview* time against then-current file state (`QuestFlow.tsx:289-302`); `handleApplyDiff` (666-676) applies later with zero revalidation, and `historyStore.applyQuestModelsWithHistory` (265-301) validates nothing. Any state change between preview and apply bypasses even the disabled-button enforcement.
- **N7 — Unwanted built-in litegraph UX is live in prod:** double-click on empty canvas opens litegraph's node **search box** (`allow_searchbox` defaults true, `litegraph.js:6278-6282`); the stock link menu's "Delete" would remove the runtime link without touching the semantic model (silent graph/model desync). Both must be disabled/overridden.
- **N8 — Existing coverage is not real.** `tests/QuestLiteGraphCanvas.test.tsx` exercises only the jsdom-only overlay DOM (Q2); `tests/e2e/quest-editor.spec.ts` only asserts view switching/rendering — **no Playwright test touches the canvas** even though Playwright runs real Chromium where the canvas fully initializes.
- **N9 — A writable-quest-editor feature flag already exists**: `src/renderer/config/features.ts` (`VITE_WRITABLE_QUEST_EDITOR`, localStorage `feature.writableQuestEditor`, default **true**), threaded as `writableEnabled` through QuestEditor → QuestFlow → Inspector. The "flag it off for v1" option is a one-line default change, not new work.

### Confirmed as reported

- **Q2**: condition-expression editing UI (IF chip button + inline editor, `QuestLiteGraphCanvas.tsx:547-686`) renders only when `isJsdomEnvironment()` — Jest-only. In production the IF panel is canvas-paint with no click handler; `setConditionExpression` is dead in the shipped app.
- **Q3**: init effect deps `[onEdgeClick, onNodeClick, onNodeDoubleClick, onNodeMove, onPaneClick]` (line 286) — `onNodeDoubleClick` closes over `semanticModel` in QuestFlow (167-175), which is recreated per edit/parse → full canvas teardown/recreate per model change, resetting pan/zoom (`ds` lives on the discarded LGraphCanvas) and selection; leaks per N1/N3.
- **Q5**: 250 ms `setInterval` → `setOverlayTick` (lines 172-179) forces 4 renders/sec forever to position overlays that only render under jsdom.
- **U1**: `questBatchHistory` entries are **file-path arrays only** (`historyStore.ts:289-293`); `undoLastQuestBatch` (315-334) pops the *top* of each per-file `editHistory` stack — if a dialog edit was pushed on the same file after the quest batch, quest-undo reverts the dialog edit instead, and stacks desync permanently.
- **PF3**: `QuestFlow` subscribes to `parsedFiles` (Map identity changes per parsed file, `QuestFlow.tsx:71-74`) but only reads it inside `resolveFilePathForFunction`; `QuestEditor.tsx:21-43` also subscribes and recomputes `activeModel = getQuestUsage(...)` per parse → new `semanticModel` prop → new callbacks → Q3 teardown, per file, during ingestion.

---

## 2. Fix design per finding

### Q3 + Q5 — Canvas lifecycle redesign (do first; everything else builds on it)

Files: `components/QuestEditor/QuestLiteGraphCanvas.tsx` (all changes local to this file).

**Init effect — mount-once.**
- Deps become `[]` (one LGraph/LGraphCanvas per mounted `<canvas>`). React guarantees the canvas element is stable for the component lifetime.
- Callback props are moved into a `callbacksRef = useRef({...})` kept current by a tiny effect (`callbacksRef.current = { onNodeClick, onNodeDoubleClick, onEdgeClick, onNodeMove, onPaneClick, onSetConditionExpression }`). All litegraph handlers read `callbacksRef.current.*`, so prop churn never touches the canvas.
- Configure once: `allow_searchbox = false` (N7), `allow_dragcanvas = true`, `bgcolor`, and the Q1/Q2 handlers below.

**Teardown (effect cleanup):**
- `graphCanvas.stopRendering()` (kills the draw rAF loop — `is_rendering = false`).
- `graphCanvas.setCanvas(null)` → internally calls `unbindEvents()`, removing the `document keyup` listener and the mousedown/wheel/keydown listeners. The move/up listeners survive due to the 0.7.18 bug (N2) but die with the canvas element on unmount — acceptable because init now runs once per mount, so no accumulation while alive.
- Null out `graphRef`/`graphCanvasRef`/lookup maps.
- **No `graph.stop()` needed** because `graph.start()` at line 463 is deleted (N3). Nothing starts the exec loop anymore.

**Model sync effect (`[nodes, edges]`) — incremental where it matters:**
- Keep the existing rebuild (`graph.clear()` + re-add) as the baseline: with the canvas no longer recreated, **pan/zoom (`graphCanvas.ds`) survives automatically** and rebuild cost is per-graph, not per-canvas. Delete `graph.start()`.
- Preserve selection across rebuild: after re-adding nodes, re-select `selectedNodeId`'s runtime node (reuse the existing lines 467-483 logic by extracting a `syncSelection()` helper called from both effects; the selection effect gains the rebuild as a trigger via a `graphVersion` ref/state bump).
- Optional follow-up (only if profiling of mod-scale graphs demands it): diff nodes by quest id — update `pos`/`title`/`size` in place, add/remove deltas, rebuild links only when `edges` changed. Not required for correctness; note it in code as the escalation path.

**Q5:** delete the 250 ms interval, `overlayTick`, and `data-overlay-tick` outright (lines 167-179, 544). The overlays it positioned are removed by Q2.

Size: **M**.

### Q1 — Real link-click selection

Files: `QuestLiteGraphCanvas.tsx`; no litegraph patching, no version bump.

- Delete the dead `onLinkSelected` block (lines 210-228 — keep the linkId→edge mapping logic, relocated).
- **Primary mechanism — override `showLinkMenu`:**
  ```ts
  graphCanvas.showLinkMenu = (link: { id: number }) => {
    const edge = linkIdToEdgeRef.current.get(link.id);
    if (edge) callbacksRef.current.onEdgeClick(syntheticEvent, edge);
    return false; // suppress built-in Add Node / Delete menu (N7)
  };
  ```
  This is invoked by litegraph's own `processMouseDown` link hit test and simultaneously removes the dangerous stock "Delete" menu item.
- **Enlarged hit target — custom test in `onMouse`:** the stock ±4 px box is too small for a primary interaction. In the existing `onMouse` handler (which already does the pane-click test), before falling through: on left mousedown not over a node, scan `graphCanvas.visible_links`, pick the link whose `_pos` is within **12 px** (squared-distance compare) of `(e.canvasX, e.canvasY)`; if found, fire `onEdgeClick` and `return true` to consume the event (prevents canvas-drag start). `showLinkMenu` override remains as belt-and-braces for the 4–12 px overlap ordering.
- Selected-edge visual feedback: track the selected link id in a ref; in `graphCanvas.onDrawForeground`, stroke that link's center marker (arc at `link._pos`, radius ~6) in the selection color. Hover affordance comes free from `render_link_tooltip` (already default-on).
- `onPaneClick` must only fire when neither a node **nor a link** was hit (adjust the existing `onMouse` logic accordingly).

Size: **S–M**.

### Q2 — Remove the jsdom-only parallel UI; production interaction via inspector + canvas chip hit test

Files: `QuestLiteGraphCanvas.tsx`, `Inspector/QuestInspectorPanel.tsx`, `QuestFlow.tsx`, `tests/QuestLiteGraphCanvas.test.tsx`.

Options evaluated:
- *(a) Canvas hit test on the painted IF chip:* viable — `node.onMouseDown(e, localPos, canvas)` gives node-local coordinates and the `attachConditionPreviewRenderer` panel rect is known (`panelX=10`, computed `panelY`, `panelHeight=40`). But hosting a **text editor** on canvas is not; the editor itself must be real DOM.
- *(b) Node double-click:* already taken (navigate-to-dialog), would be a conflicting overload.
- *(c) Inspector panel field:* the inspector is real DOM, already the home of every other edit control (MIS state, topic status, log entry, transition text, condition links), Playwright-testable, accessible, and needs no canvas coordinate math.

**Chosen design: (c) as the editing surface, (a) as a selection affordance.**
1. Delete from `QuestLiteGraphCanvas.tsx`: `isJsdomEnvironment()` and **both** of its uses (the render-guard at 547/655 **and** the inverted guard at 405 so the painted IF preview also renders under jsdom), the entire overlay JSX (lines 547-686), the expression-editor state/handlers (168-170, 516-541), `getOverlayPosition`, `conditionCapsuleNodes`/`conditionDetailNodes` memos. The canvas-painted IF panel (`attachConditionPreviewRenderer`) stays — it is production-real and becomes the single preview rendering path.
2. Add to `QuestInspectorPanel.tsx`: when the selected node is a `dialog` node, render a "Condition expression" section — multiline TextField seeded from `node.data.conditionExpression`, syntax-checked with the existing `validateConditionExpressionSyntax` (domain codec), plus a "Preview Diff" button invoking a new `onSetConditionExpression` prop. `QuestFlow.tsx` already has `handleSetConditionExpression` (658-664) → pass it to the inspector (it currently goes only to the canvas). The command path (`setConditionExpression` → `parseConditionExpressionToConditions` → diff preview) is unchanged.
3. Add to `QuestLiteGraphCanvas.tsx`: per-dialog-node `runtimeNode.onMouseDown = (e, pos) => { if (pos inside the IF panel rect) { callbacksRef.current.onNodeClick(evt, questNode); return true; } return false; }` — clicking the painted IF chip selects the node (opening the inspector section) and blocks node-drag for that click. No canvas-hosted editor.

Size: **M**.

### Q4 — Guardrail enforcement in the application layer (single choke point)

Files: new logic in `quest/application/QuestEditingService.ts`, callers in `QuestFlow.tsx`; `historyStore.ts` untouched except docs.

- Domain already exposes the pure checks (`getQuestGuardrailDeltaWarnings`, `isQuestGuardrailWarningBlocking` in `quest/domain/guardrails.ts`) — enforcement belongs one layer up, where fileStore state is reachable, per the architecture doc (`docs/architecture/quest-editor.md`: UI → application → domain; historyStore is a generic store and must not learn quest semantics).
- Add `QuestEditingService.applyQuestUpdates(questName, updates, deps)`:
  1. For each update, **recompute** delta warnings against the *current* `fileStore` model (closes the N6 TOCTOU — validation happens at apply time, not preview time).
  2. If any warning is blocking → return `{ ok: false, blockingWarnings }`; nothing is applied.
  3. Otherwise call `useHistoryStore.getState().applyQuestModelsWithHistory(updates)` (injected as a dep to keep the service testable).
- `QuestFlow.handleApplyDiff` becomes a thin call into this service and surfaces `blockingWarnings` via `commandError`/dialog. The `Apply`-button disabling in `QuestDiffPreviewDialog.tsx:137` stays as UX, no longer as the only gate.
- Document on `applyQuestModelsWithHistory` that it is the raw, validation-free primitive and quest UI must route through the service.

Size: **S**.

### U2 — Kill per-command whole-model clones (domain copy-on-write)

Files: `quest/domain/commands/shared.ts`, `moveNode.ts`, and each command executor (`setMisState`, `addTopicStatus`, `addLogEntry`, `connectCondition`, `removeTransition`, `updateTransitionText`, `updateConditionLink`, `addKnowsInfoRequirement`, `removeKnowsInfoRequirement`, `setConditionExpression`).

- Replace `cloneModel(context.model)` with a structural-sharing helper in `shared.ts`:
  ```ts
  withUpdatedFunction(model, name, update: (fnClone) => void): SemanticModel
  // shallow-copies model + model.functions, deep-clones ONLY functions[name], applies update
  ```
  Every command mutates exactly one (occasionally two) function entries; all other subtrees stay reference-shared with the input model. Since fileStore/history treat models as immutable-by-reference (`historyStore.ts:76-81`), this alone collapses history memory from O(50 × full model) to O(50 × one function) (N5).
- `moveNode.ts`: remove the clone entirely — validate existence against `context.model` and return `{ ok: true, updatedModel: context.model, ... }` (its result model is discarded by QuestFlow anyway, N4).
- Keep `cloneModel` for the single-function deep copy only.

Size: **S–M**.

### U1 — Quest batch history desync: guard here, redesign in slice 5

Boundary proposal (coordinate with `fix-05-undo-debounce.md`):
- **Slice 5 owns the real fix**: a unified per-file timeline where every entry (dialog edit, quest command, position change) is one tagged step, so "undo last quest batch" is "undo these specific steps", with interleaving handled by design.
- **Slice 4 owns the batch mechanism and ships a correctness guard now** (`store/historyStore.ts`):
  - Batch entries record **snapshot identity**, not just paths: `Array<{ filePath: string; snapshot: EditSnapshot }>` (the exact snapshot object pushed by `pushUncoalescedSnapshot`, reference-comparable because snapshots are immutable).
  - `undoLastQuestBatch`: for each entry, verify `editHistory.get(filePath).past.at(-1) === entry.snapshot`. If **any** file's top-of-stack is not the batch's snapshot (a dialog edit landed on top), the batch undo **refuses as a whole** and surfaces a message ("Undo the newer edits in <file> first (Ctrl+Z), then retry quest undo") instead of reverting the wrong thing. `canUndoLastQuestBatch` applies the same check so the button disables truthfully. Mirror for redo.
  - This is fail-safe (never corrupts), small, and slice 5 replaces it wholesale.

Size: **M** (guard) — full redesign excluded (slice 5).

### PF3 — Stop feeding the teardown from ingestion

Files: `QuestFlow.tsx`, `QuestEditor.tsx`, `store/projectStore.ts`.

- `QuestFlow`: drop `parsedFiles` from the subscription (71-74); `resolveFilePathForFunction` reads `useProjectStore.getState().parsedFiles` imperatively at call time (it already does the same with `useFileStore.getState()`).
- `QuestEditor`: replace the `parsedFiles` subscription with a coarse invalidation signal — add a monotonically increasing `parseGeneration: number` to `projectStore` (bumped where `parsedFiles` is replaced), and while `isIngesting` is true, defer `activeModel` recomputation (compute once on ingestion end). `getQuestUsage(selectedQuest)` then runs per generation/quest change, not per parsed file.
- Note: with Q3's mount-once canvas this no longer *recreates* the canvas, but it still rebuilds the graph and re-runs `analyzeQuestGuardrails` per parsed file during ingestion — still worth fixing here. Deeper `mergeSemanticModels` work stays in slice 7 (PF1).

Size: **S** (QuestFlow) + **S–M** (QuestEditor/projectStore).

---

## 3. Alternative: feature-flag the quest editor off for v1

The flag already exists (N9, `src/renderer/config/features.ts`). Flipping the default to `false` (one line + test updates) ships v1 with a **read-only quest viewer** (graph + read-only inspector), removing the broken editing surfaces Q1/Q2/Q4/U1/U2 from the release path.

Caveats:
- **Q3/Q5/PF3 must be fixed regardless** — the leaks, render-storm, and stale-canvas input handling occur in read-only mode too. Q1 is also arguably read-only UX (edge *inspection*).
- Even read-only, litegraph's built-in searchbox/link menu (N7) can mutate the runtime graph; either set `graphCanvas.read_only = true` in the flagged-off configuration or land the N7 overrides anyway.
- Recommendation: land Q3/Q5/PF3 + N7 hardening first (small, mandatory either way); then decide per release timeline whether Q1/Q2/Q4/U-fixes make v1 or the default flips to `false` until they do. Given the sizes above (everything S/M, no L), completing the slice is realistic; the flag is the contingency, not the plan.

---

## 4. Test plan (failing tests first — jsdom must NOT be the only coverage)

The canvas never initializes under jsdom (init effect bails, and litegraph needs a real 2D context). Therefore: **Jest covers domain/store/wiring; Playwright (real Chromium via the Vite harness) covers every canvas interaction; a manual smoke pass per repo rules covers what automation can't.** A green jsdom suite alone does not close any Q-finding — that is exactly the failure mode Q2 codified.

### Failing tests to write before each fix

Jest (logic/store/wiring — legitimate jsdom scope):
1. **U2**: for each command, `result.updatedModel.functions[<untouched>] === context.model.functions[<untouched>]` (reference equality) and `updatedModel.dialogs === context.model.dialogs`; `moveNode` performs no clone (`updatedModel === context.model`). Fails today (structuredClone breaks all sharing).
2. **Q4/N6**: `QuestEditingService.applyQuestUpdates` with an update that introduces a `failure-status-regression` delta → returns not-ok, injected `applyQuestModelsWithHistory` spy **not called**; non-blocking warnings → applied. Include a TOCTOU case: fileStore model mutated between preview and apply → blocked on apply-time state.
3. **U1**: push quest batch on file A → push a coalesced dialog snapshot on file A → `canUndoLastQuestBatch()` is false / `undoLastQuestBatch()` no-ops and the dialog edit survives. Fails today (reverts the dialog edit).
4. **Q3 (unit-level)**: mock `litegraph.js` module; render `QuestLiteGraphCanvas`, change `nodes`/callback props 5× → `LGraphCanvas` constructor called **once**, `graph.start` never called; unmount → `setCanvas(null)` and `stopRendering` called. Fails today.
5. **Q2 wiring**: `QuestInspectorPanel` with a selected dialog node exposes the expression field; valid submit calls `onSetConditionExpression` with trimmed expression; codec-invalid input shows the error and does not call it. (Rewrites `tests/QuestLiteGraphCanvas.test.tsx`, which currently asserts the deleted overlay DOM and must be removed/replaced in the same change.)
6. **PF3**: `QuestFlow` render-count harness — replacing `parsedFiles` identity in projectStore (same content) does not re-render QuestFlow.

Playwright E2E (`tests/e2e/quest-editor.spec.ts` — real Chromium, canvas fully live; per repo rules each spec must be manually verified to drive the real feature, not merely pass):
7. **Q1**: seed a two-dialog quest with a transition; click the link center (expose a test-only `window.__questGraphDebug = { getLinkCenterScreenPos(edgeId) }` hook from `QuestLiteGraphCanvas` under `import.meta.env.DEV`/test builds — canvas pixels are otherwise unaddressable); assert the inspector shows the edge section (`Edge: transitions`, Transition Text field) and that **no** litegraph ContextMenu ("Add Node"/"Delete") appeared.
8. **Q2**: click the IF chip region of a dialog node (same debug hook exposing node screen rects) → node selected, inspector expression field visible; edit expression → Preview Diff dialog shows the regenerated condition function; Apply → graph reflects it.
9. **Q3/Q5**: open quest flow, pan/zoom the canvas (mouse drag + wheel), perform an edit that changes the model (e.g. apply a topic-status) → assert pan/zoom offset unchanged (via debug hook exposing `ds.scale/offset`) and selection retained; assert no 4 Hz re-render (e.g. counter in the debug hook stays flat over 1 s idle).
10. **Q4**: drive an edit whose diff has a blocking warning → Apply disabled *and* (via a test seam that force-enables the button or calls the service directly) apply is refused with the guardrail message.

### Manual smoke checklist (required by repo rules for node-editor UI changes)

Run `npm run dev:node-editor`, open `http://localhost:5173/node-editor.html`:
- [ ] `data-testid="node-editor-quest-select"` renders; select a quest; graph draws.
- [ ] Node click selects (inspector updates); double-click navigates; node drag persists position.
- [ ] Click a link center dot: inspector edge section opens; **no** litegraph context menu; double-click empty canvas does **not** open the litegraph search box.
- [ ] IF chip click on a dialog node opens the inspector expression editor; edit → preview → apply round-trips.
- [ ] Pan and zoom, then trigger a model edit: viewport and selection survive.
- [ ] DevTools Performance/Memory: with the flow open idle, no recurring 250 ms activity; after 10 model edits, heap snapshot shows a single LGraphCanvas/LGraph pair and `getEventListeners(document)` shows one `keyup` from litegraph.
- [ ] Undo/redo buttons: quest batch undo after an interleaved dialog edit refuses with the explanatory message instead of reverting the dialog edit.

Also run the full Electron app (`npm run dev`) once for the same link-click/IF-chip/pan-zoom pass — the Vite harness shares the renderer but the repo's own review found mock-E2E blindspots (slice 8); real-browser here means at minimum Playwright Chromium **plus** this manual Electron pass.

---

## 5. Ordering, dependencies, risks, sizes

| Step | Fix | Size | Depends on |
|---|---|---|---|
| 1 | Q3 + Q5 + N7 lifecycle redesign (mount-once, callbacksRef, teardown, delete `graph.start()`, delete interval, disable searchbox) | M | — |
| 2 | Q1 link clicks (`showLinkMenu` override + `onMouse` 12 px hit test + selected-edge marker) | S–M | 1 (callbacksRef, onMouse restructure) |
| 3 | Q2 remove jsdom UI; inspector expression editor + IF-chip `node.onMouseDown` | M | 1 |
| 4 | Q4 `QuestEditingService.applyQuestUpdates` enforcement (+ TOCTOU revalidation) | S | — (parallel ok) |
| 5 | U2 domain copy-on-write (`withUpdatedFunction`, moveNode no-clone) | S–M | — (parallel ok) |
| 6 | U1 batch-undo snapshot-identity guard | M | coordinate with slice 5 plan |
| 7 | PF3 subscription fixes (`parseGeneration`, imperative `parsedFiles` reads) | S–M | 1 (to observe the win) |
| 8 | Playwright specs + debug hook + manual smoke + docs update (`docs/architecture/quest-editor.md` gains the litegraph interaction contract; delete this plan when done) | M | 1–7 |

Risks:
- **litegraph internals coupling** (`visible_links`, `_pos`, `showLinkMenu` signature) — mitigated: the library is vendored/pinned at 0.7.18 and the contract is now documented + covered by Playwright specs; any future upgrade re-runs spec 7-10.
- `visible_links`/`_pos` are only populated for links inside the viewport after a draw — hit tests must tolerate empty arrays (first click before first frame); acceptable, mousedown always follows a draw in practice.
- Mount-once canvas relies on callbacks-via-ref discipline; a lint-level guard (comment + test 4) protects against someone re-adding reactive deps.
- U1 guard changes batch-entry shape — `clearHistoryForFile`/`resetBatchHistory`/`normalizeBatchFilePaths` call sites must be updated together; slice 5 will replace the structure, so keep the guard minimal.
- Playwright coordinate-based canvas clicks can be flaky under HiDPI/scroll — the debug hook returns CSS-pixel page coordinates computed from `ds` + canvas bounding rect to avoid guesswork.

Cross-slice notes: U1 full redesign → slice 5 (`fix-05-undo-debounce.md`); deeper merge/subscription performance → slice 7; making Playwright cover real Electron → slice 8. Q4's service seam is also where slice 5's unified history apply-path will plug in.
