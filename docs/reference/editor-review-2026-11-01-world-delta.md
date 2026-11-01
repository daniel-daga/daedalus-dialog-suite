# Editor review — 2026-11-01, slice 9: the world surface, the delta only

This is a **delta review**. It covers the eleven commits that landed in
`src/renderer/world/`, `src/renderer/components/world/` and
`src/renderer/store/worldStore.ts` after 2026-09-04, and nothing else:

`8498750` decals drawn with their alpha function's blend · `194d0a3` the
routine-mob hint (#318) · `3961772` a decal edit redrawn at once (#391) ·
`0fbd4b2` the memoised World property grid (#359) · `bf3d269` the asset browser
lists source assets by default (#399) · `4d0e7ec` marker occlusion separated
from camera range · `bfa76b7` marker shapes and waypoint facing · `acac637`
solid 3D waypoint arrows · `3457da5` keyboard precision and continuous movement
(#403) · `1094177` Q/E turns about the vertical (#404) · `f8bae88` one fixed fly
speed and Ctrl chords through (#405, #415).

**Everything else in those paths is unchanged since the 2026-09-04 review**
(`docs/plans/level-editor-review-2026-09-04.md`) and the two passes before it,
and is taken as read: the columnar index and its reader, the gizmo, the waynet
and spawn overlays' core drawing, `WorldScene`'s texture and instance
management, the scene and folder trees, the edit pipeline's commit/undo/refusal
machinery, the property grid's field catalogue, the scatter brush, the clipboard
and VOB folders. VOB folders landed before the cutoff and were reviewed as their
own feature (`docs/plans/vob-folders.md`). The routine-mob *rule* is slice 7's
ground (#496–#501); what is judged here is only the wiring the world side hands
it.

Commit reviewed: `b105f6c`. Date: 2026-11-01.

**Load assumed.** A retail world — NewWorld's 23,288 VOBs, 2,959 waypoints,
15,749 VOBs with no visual (the marker layer's count), 1,932 decals in 34
(texture, alpha-func) groups — with the World surface on screen behind the
Problems panel, a selection held with a nudge key down at 60 fps, right-drag
flying across the map, gizmo drags at 60 fps, the waynet and the markers both on
(the default), and a decal field edited from the grid. Judged against that:
a key or a control must move or pick exactly what the viewport draws, an edit
must reach the file, and the frame loop must not redo work it already has.

**What this delta does.** Three things, and they are independent. *Rendering*:
a decal's `decalAlphaFunc` became material state, so decal groups are keyed by
(texture, func) and each gets OpenGothic's blend; markers gained a shape per
class and the waynet gained solid instanced arrows; both marker layers gained a
camera-range filter independent of a three-way wall-occlusion mode, and the
picks follow both. *Input*: the fly lost its pivot-distance speed and its Ctrl
creep, Q/E yaw in either gizmo mode, a gesture's verb is fixed by its first key,
and free (unsnapped) movement starts continuously at once. *Reach*: a decal
field edit now re-reads the visuals; the property grid is memoised behind an
`appliedOps` identity; the asset browser holds source files by default; and the
Problems scan gained the open world's mob positions.

**Checks run.** The focused suites for what this delta touches —
`useWorldShortcuts`, `NavController`, `flyNav`, `WaynetOverlay`,
`VobMarkerLayer`, `DecalLayer`, `useWorldEditPipeline`, `worldStore.editing`
(8 files, 287 tests, all pass) — plus three throwaway probes in a scratch
directory for the timing claims in findings 2 and 3 (the marker compaction, the
arrow rebuild, the bounding-sphere recompute, `mobsOf`), and the PickController
and WorldSurface specs read rather than run. **The viewport's Jest suites stub
the renderer**, so every claim below about *what is drawn* is read from the code
and from the browser-harness spec (`tests/e2e/world-surface.spec.ts`, which
reads real framebuffer pixels) — not from a green suite. No repository file was
edited except this report; no app was launched and no native addon built.

## What already holds, and the test that would fail if it broke

| Holds | Test |
|---|---|
| the fly moves at one speed whatever the pivot, Shift ×4, and a Ctrl-modified move is declined so the app keeps Ctrl+S/A/W | `tests/flyNav.test.ts`, `tests/NavController.test.ts` |
| Q/E yaw in either gizmo mode, and a move key pressed into a turn waits for the gesture to end, so one gesture is one undo entry | `tests/useWorldShortcuts.test.ts`, `tests/WorldSurface.shortcuts.test.tsx` |
| every row of the keyboard-shortcuts sheet is really bound, and every chord the surface claims has a row | `tests/keyboardShortcuts.test.ts` (the Q/E probe drives the real `useWorldShortcuts`) |
| a fine tap is a millimetre with Ctrl, a hold moves continuously, and the whole gesture is one undo entry — in a real browser, against the real grid | `tests/e2e/world-surface.spec.ts` "keyboard movement permits fine taps and smooth holds with one undo (#403)" |
| an arrow is drawn along the stored direction in all three axes, is picked on its own geometry, and an end-on view still shows the cone | `tests/WaynetOverlay.test.ts`, `tests/e2e/world-surface.spec.ts` "…solid 3D waypoint arrows…" |
| the camera range and the three occlusion modes are independent, and both the draw and the pick obey them | `tests/VobMarkerLayer.test.ts`, `tests/WaynetOverlay.test.ts`, `tests/PickController.test.ts` |
| a prop in front of a marker blocks its pick, unless the view's class filter has hidden that prop | `tests/PickController.test.ts` "does not take an invisible marker behind a prop…" |
| a marker that moves across the range boundary is re-judged at once | `tests/VobMarkerLayer.test.ts` "rechecks the range when a marker moves across its boundary" |
| a decal is blended by its own `AlphaFunction`, and one texture carrying two funcs gets two materials | `tests/DecalLayer.test.ts` (one case per func, plus the two-func texture) |
| a decal size, weight or func edit redraws the quad at once, through the in-place column patch | `tests/useWorldEditPipeline.test.ts`, `zen-world/test/ops.test.ts` |
| the memoised grid redraws after an op written into the index in place, and skips a commit that changes none of its props | `tests/e2e/world-surface.spec.ts` (#403, reads the position inputs), `tests/WorldSurface.editing.properties.test.tsx` "skips one that changes none of its props" |
| the asset browser lists source files by default and widens in two steps, holding across a navigation | `tests/WorldAssetBrowser.test.tsx` "the files facet", `zen-world/test/browsableAssets.test.ts` |
| every alpha func retail uses reaches the renderer as a column | `zenkit-node/test/vobIndex.test.js` |

The two things this delta could plausibly have broken and did not: the waynet's
pick order (arrows, then the reticle projection, then markers, then props — the
arrow raycast now comes *before* the prop pass and the reticle fallback still
runs when no arrow is hit), and the Names toggle's label set (it now ranks only
the waypoints inside the range, which is the same "what is drawn, not what
exists" rule the spawn labels already followed).

## Must fix

None. Nothing in this delta can lose an edit, draw something the file does not
contain, or corrupt a world. Finding 1 is a wrong answer rather than a lost one;
it is the only one a user would report.

## Should fix

1. **`routine-mob-missing` never re-runs after the world edit that would fix it,
   and its waypoint half is frozen at the last waynet read**
   (`src/renderer/store/storeSync.ts:44-49`;
   `src/renderer/store/worldStore.ts:398-405`, `:429-455`, `:473-486`;
   `src/renderer/store/problemsStore.ts:115-118`;
   `src/renderer/problems/application/scanProject.ts:47-49`)
   - **What this is:** the Problems scan re-runs on four things: a file parse (or
     an ingestion step), the panel mounting, a change to the waynet's *name sets*,
     and the portal findings. That guard
     was written for rules that ask about names — a dangling waypoint site, a
     free point that does not exist — and both places that hold it say so in as
     many words: "a drag must not cost a project-wide re-scan"
     (`worldStore.ts:470-472`), and "a gizmo drag and an edge op both re-read the
     payload and neither reaches here" (`storeSync.ts:41-42`). `routine-mob-missing`
     is the first rule that asks about **positions**: this waypoint's position
     against every mob's position.
     A VOB drag, a waypoint drag, a placed bed and a deleted bench all change the
     answer and all leave the guard's two signals untouched, so no scan follows.
     The second half is the waypoint side of the same input:
     `waypointPositions` is built from a *copy* of the payload at read time
     (`worldStore.ts:400-404`) and only rebuilt when `waynetLoaded` runs again,
     while a `MoveWaypoint` is written straight into the payload's buffer by the
     viewport (`useWorldEditPipeline.ts:126-129`) with no re-read. So even the
     scan that eventually does run — after an unrelated file is saved — judges a
     moved waypoint at the position it had before the drag. The comment above the
     copy says "Kept on every read, a move included"; a move is not a read.
   - **Problem:** the two halves reinforce each other into a hint that is wrong
     in both directions. Drag a waypoint down to a bed and the hint stays on
     screen; delete the bed and it never appears. The only ways to refresh it are
     to reopen the world or touch a script, neither of which is what the user was
     doing. `mobsOf` itself is right — it reads the live columns on every scan,
     so a bed dragged closer *does* count, once somebody asks.
   - **What the user loses:** the trust that a hint is about the world in front of
     them. A hint you cannot clear by fixing it is worse than no hint, and this
     is the one rule the panel has that a user can fix with a single drag.
   - **Test that does not exist:** a scan-scheduling test that applies a
     `MoveVob` (or a `MoveWaypoint`) and asserts a further scan follows;
     `tests/problemsStore.scanScheduling.test.ts` covers ingestion, the debounce
     and the world-name subscription only, and `tests/worldStore.editing.test.ts`
     never looks at `waypointPositions`.
   - **Minimal fix:** two small pieces. (a) Make the waypoint half live rather
     than frozen, which also makes the store's claim true: keep the payload's
     `Float32Array` view plus a name→index `Map` instead of a `Map` of copied
     numbers, so a `MoveWaypoint` written into that buffer is what the next scan
     reads. (b) Give the store a counter that `applyEdit` and `indexRefreshed`
     bump, and add it to the guard in `storeSync` beside `waynetNames` and
     `portalFindings`; `requestScan` already debounces, and a commit is one per
     gesture, so a drag costs one scan, not one per frame.
   - **If we skip it:** the only gesture-shaped fix in the Problems panel keeps
     reporting a world state that no longer exists, and the panel's world-side
     inputs drift one rule at a time as more of them read positions.

2. **Both range filters re-compact and re-upload their whole buffers on every
   frame the camera moves, and while the layer they belong to is switched off**
   (`src/renderer/world/VobMarkerLayer.ts:281-288`, `:351-392`, `:322-325`;
   `src/renderer/world/WaynetOverlay.ts:209-216`, `:271-290`;
   `src/renderer/components/world/WorldViewport.tsx:1129-1142`, called at `:1149`)
   - **What this is:** `setView` guards on **exact** float equality of the camera
     position, so while flying, walking or orbiting it re-runs every frame, and
     it re-runs `setHidden`/`filterRange` unconditionally. `setHidden` recompacts
     all 15,749 markers (rewriting six floats and a shape per drawn marker),
     flags all three attributes `needsUpdate` — 430 KB of `bufferSubData` — and
     recomputes a bounding sphere over the whole attribute that nothing reads,
     because the layer sets `frustumCulled = false`. `filterRange` re-scans 2,959
     points and 3,000 edges and flags both index buffers (35 KB) even when the
     visible set did not change by one point. Neither takes its layer's
     visibility into account: the waynet is hidden rather than destroyed
     (`WorldSurface.tsx:756`), and markers-off still walks the whole set each
     frame to draw nothing.
   - **Problem:** measured in Node/V8 on this machine, not inferred: the marker
     compaction is 0.062 ms, the dead bounding sphere 0.116 ms, the waynet filter
     0.018 ms — about **0.2 ms of script plus ~465 KB of buffer uploads per
     frame**, proportionally more while a marker VOB is dragged, because
     `setPosition` takes the range path (`:322`) and compacts again. It is not a
     freeze and not a dropped frame on its own; it is work whose result is
     identical to the previous frame's, done 60 times a second, and the two
     ways to make it free are three lines each. The marker layer's own
     `drawnAt` already answers "did anything change".
   - **What the user loses:** frame-headroom in exactly the state the editor is
     used in — flying at shift speed over a dense part of the map with the
     markers and the waynet on. Nothing visible breaks.
   - **Test that does not exist:** none is needed for the speed-up itself; the
     guard is that `tests/VobMarkerLayer.test.ts` and `tests/WaynetOverlay.test.ts`
     keep passing, including the case where the drawn set really does change.
   - **Minimal fix:** in `setHidden`, track whether any slot's drawn-ness changed
     and skip the three `needsUpdate` flags and the `computeBoundingSphere` when
     none did (drop the sphere entirely — the comment already says nothing tests
     it). In `filterRange`, set the two index flags only when `visiblePoints` or
     the edge count changed. In `setView`, return early when the layer is not
     visible (`!enabled` for the markers, `!root.visible` for the waynet), and
     quantise the camera guard — a radius of 10,000 cm does not need millimetre
     equality.
   - **If we skip it:** a steady ~465 KB/frame of GPU uploads for no change, in
     the one loop where the whole surface's frame budget lives, and the marker
     layer keeps its dead bounding-sphere pass per frame.

3. **`pickWaypoint` has no caller — the solid arrows replaced it and its spec
   keeps it alive** (`src/renderer/world/pickWaypoint.ts:27-48`;
   `tests/pickWaypoint.test.ts`, 108 lines)
   - **What this is:** `WaynetOverlay.pick` now raycasts the arrows and falls back
     to `pickPoint` directly (`WaynetOverlay.ts:266`), and `SpawnOverlay` has its
     own method of the same name. The exported `pickWaypoint` — an 11-line
     forwarder to `pickPoint` with a `radius` default nobody passes — has **no
     call site in `src/`**. `NO_WAYPOINT` is still used, so the module stays; only
     the function goes. Its spec is 108 lines of cases for the forwarder, and
     every one of them is also covered through `WaynetOverlay.test.ts` and
     `VobMarkerLayer.test.ts`, which call `pickPoint` for real.
   - **Problem:** a green suite over dead code is the shape slice 8 is about. Eight
     comments across four files still describe the old world and will keep the next
     reader chasing a function that does nothing: `pickWaypoint.ts:53-57` ("The
     waynet's caller is `pickWaypoint`"), `waypointLabels.ts:3`, `:52`, `:91`,
     `WorldViewport.tsx:92`, `:1154`, `:1283`, and `VobMarkerLayer.test.ts:37`.
   - **What the user loses:** nothing at runtime; the next reviewer re-derives
     which pick is live, as I did.
   - **Test that does not exist:** not applicable — the deletion's guard is that
     `WaynetOverlay.test.ts` and `VobMarkerLayer.test.ts` stay green with the
     forwarder gone. `tests/pickWaypoint.test.ts` should keep its cases against
     `pickPoint` rather than be deleted: they are the projection's edge cases
     (behind the eye, ties, an exact pixel hit).
   - **Fix:** delete `pickWaypoint`, point the spec's cases at `pickPoint`, and
     correct those eight comments to say `pickPoint`.
   - **If we skip it:** one more function whose only reader is a test, and the
     comments keep pointing at it. **This one stays in the doc as a deletion
     rather than an issue**, as slice 4's `EditorColumn.tsx` did.

## Verdict

Verdict: ship, and fix 1 next time the world scan is touched. Nothing here is
dangerous: the decal blend, the arrows, the two range filters and the two
keyboard changes are each pinned by a test that would fail if they broke, and the
memoised grid is the one optimisation in the delta that has an end-to-end check
in a real browser rather than a stub. Finding 1 is the only one a user would
report, and it is a hint that argues with the world in front of it — the smallest
consequence class there is, in the rule that is cheapest to believe. Finding 2 is
measured and modest (0.2 ms and ~465 KB a frame); finding 3 is a deletion.

Lean: −11 lines in `pickWaypoint.ts` plus the eight comment corrections, and about
eight lines out of `setHidden`/`filterRange` if finding 2 is taken. `mobsOf` is
new and has a live caller that reads it per scan; measured at 1.0 ms over 23,288
VOBs, which is cheap for what it answers, so it stays. `isSourceAssetFile` and
`isCompiledAsset` repeat extension lists that `assetFormat.ts`'s `GROUPS` already
spell, but deriving one from the other needs a source/compiled tag `GROUPS` has
no place for — the split is the more honest shape, not a finding.

Not checked: no retail world is open on this machine, so the marker, waypoint and
VOB counts are the ones the code's own comments state, and the per-frame numbers
are a Node micro-benchmark of the loops — the GPU upload side of finding 2 is
inferred from the buffer sizes, not timed. The e2e evidence for the arrows and
the keyboard is read, not re-run (Playwright is CI's). The waypoint/edge
pixel-probe spec (`tests/e2e/world-surface.spec.ts`) was not re-executed, so its
"the click lands on the rendered head" claim is taken as it stands. The asset
browser's empty default listing on a retail install is a documented decision
(`level-editor.md`, the files facet) and is being investigated as **#406**; it is
not re-reported here.
