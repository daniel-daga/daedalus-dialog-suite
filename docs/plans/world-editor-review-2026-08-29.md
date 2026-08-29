# World editor review — 2026-08-29

*Board cards cite these sections as* **first pass** *(1-10 below),* **binding**,
**renderer** *and* **ops/main** *(the three second-pass sections).*

A `/code-review high` pass over the world-editor feature. **Coverage is partial:**
the pass that ran covered the board-loop-4 waynet / Problems work and the world
surface around it. A second pass over `zenkit-node` (`src/*.cc`, `lib/`,
`tools/mutate.js`), `zen-world` ops and `validate/`, the main process
(`WorldService`, `zenkit.worker`, `assertApplyOpsRequest`) and the renderer's
scene/picking/undo surface was launched and died to a session limit before any
finder reported. **That scope is unreviewed, not clean.**

Ranked most severe first. Each finding is marked **FIXED** as it lands, with
the test that holds it; everything unmarked is still open.

## Correctness

1. **A waynet fetch failure discards a fully loaded world.** — **FIXED
   2026-08-29**, with renderer finding 1 below: the two are one shape. The
   waynet read moved out of the open's `try` into one of its own, and reports
   through `editFailed` — the warning over a world that is still open — leaving
   `waynet` null, which is already read as "nothing is known". Held by
   *"keeps the opened world when the waynet read fails"*
   (`WorldSurface.editing.test.tsx`).
   `WorldSurface.tsx:222` — the waynet await now sits inside the same `try` as
   `openSucceeded` (line 209, already `status: 'ready'`), so the catch at 223–225
   routes to `openFailed`, which resets to `{...EMPTY, status: 'error'}`. A
   transient worker/IPC error throws away the summary, the ~31 MB mesh and the
   visuals; recovery is re-paying the whole open, while the main process still
   holds the world. Before the diff the lazy waynet fetch could not do this.

2. **Stale waynet renders and is pickable over the next world.** — **FIXED
   2026-08-29**: `openWorld` now calls `setWaynet(null)` beside the mesh,
   visuals and terrain-point resets, so the overlay draws nothing until the new
   payload lands and a failed open leaves nothing behind. Held by *"drops the
   previous world's waynet when the next world opens"*
   (`WorldSurface.editing.test.tsx`), which asserts the payload the viewport is
   given, not the store — the store is reset by `beginOpen` either way, and the
   disagreement between the two was the defect.
   `WorldSurface.tsx:196` — `openWorld` resets mesh/visuals/terrainPoint but not
   the local `waynet` state, and the viewport mounts on `mesh && visuals &&
   summary` alone. With the overlay on, world A's waypoints draw over world B
   until the new fetch lands at 222; a drag committed in that window builds
   `moveWaypointTo` from A's names against B's waynet, producing a binding
   name-guard refusal the user cannot explain. A failed open leaves A's payload
   in place forever. Fix: `setWaynet(null)` beside the line-194 resets.

3. **An empty waynet is treated as full knowledge.** — **FIXED 2026-08-29**:
   `waynetLoaded` stores null for a 0-name payload, on the same branch as a
   null one. Held by *"reads an empty waynet as nothing known, not as an empty
   world"* (`problemsWaypointWorldInput.test.ts`).
   `worldStore.ts:145` — a 0-name payload stores `{all: [], freePoints: []}`
   rather than `null`, so the rule's `if (!world) return []` guard does not fire
   and every waypoint site in the project is flagged. Reachable: `normalize.cc`
   (1379–1386) deliberately returns an empty point list for a world with no
   waynet chunk instead of throwing. The rule's "absent means nothing is known"
   contract has no equivalent for open-but-empty.

4. **`waynetLoaded`'s identity guard ignores the flags column.** — **FIXED
   2026-08-29**: `freePoints` is derived before the guard and compared with the
   names, so an edge removal that promotes an endpoint is a real change. Held by
   *"re-derives the free points when a re-read changed only the flags"*
   (`problemsWaypointWorldInput.test.ts`).
   `worldStore.ts:143` — it compares names only (`sameNames`), but the stored
   object also derives `freePoints` from flags. `removeWaypointEdge` promoting an
   endpoint to a free point (documented at `lib/index.d.ts:468`) is exactly the
   case `WorldSurface.tsx:486` re-reads for, and the re-read is early-returned:
   `freePoints` stays stale and a site naming the promoted point keeps a false
   warning until an unrelated name change churns the set.

5. **Duplicate `Problem.id`s.** — **FIXED 2026-08-29**: the rule dedupes by the
   id it is about to emit, so a function naming the same missing waypoint twice
   is one problem. Held by *"emits one problem for a function naming the same
   waypoint twice"* (`problemsWaypointNotInWorld.test.ts`).
   `waypointNotInWorld.ts:43` — the id is
   `…:${filePath}:${functionName}:${NAME}`, but `extractWaypointSites` pushes one
   entry per call site with no dedupe (`semanticMetadataUtils.ts:185`). One
   `Rtn_` function naming the same missing waypoint twice — the normal Gothic
   routine shape — yields two identical ids; `ProblemsList` keys on it. The
   existing "one problem per site" test only covers sites in *different* files.

6. **Free-point suppression may be too narrow** (PLAUSIBLE — engine semantics not
   provable from this repo). `waypointNotInWorld.ts:39` uses `startsWith`, but
   ZenGin's free-point search matches by substring, and retail scripts pass infix
   fragments (`Wld_IsFPAvailable(self, 'ROAM')` → `FP_ROAM_…`). Every free point
   starts with `FP_`, so a non-prefix fragment fails the guard and the rule emits
   the invented finding that branch exists to avoid. The 84.3%/98.0% measurement
   would absorb infix misses, so it does not distinguish the two. `includes()` is
   the conservative form.

7. **Clicking a waypoint problem is usually a no-op.** — **FIXED 2026-08-29**:
   when neither navigator resolves, the click falls back to `problem.filePath`
   — the one thing every problem carries — opening that file, selecting the
   function and switching to the dialog view, because Problems is the whole
   main area and a click that resolves to nothing shows nothing. Held by two
   tests in `ProblemsPanel.navigation.test.tsx`: *"opens the file the problem
   names when the symbol is not in the merged model"* and *"leaves a resolved
   navigation alone — no second jump"*.
   `ProblemsPanel.tsx:50` — `handleSelect` routes `functionName` through
   `navigateToSymbol`, which searches only the merged semantic model, and drops
   its `false` return with no fallback to `problem.filePath`. This rule is the
   first whose sites routinely come from the index's whole-project pass, so a
   warning in a never-opened routines file clicks nowhere and says nothing. The
   path is pre-existing (voiceId, orphanedFunction can hit it); this rule makes it
   the common case.

## Conventions and cleanup

8. **`docs/architecture/problems-panel.md` is stale** — **FIXED 2026-08-29**:
   the rule table has its sixth row, the scan-input section names
   `waypointSiteIndex` and `worldStore.waynetNames` and what their absence
   means, and Navigation records the `filePath` fallback of finding 7. It still says "All five
   read only structured, typed data" (line 41) and "The single scan input is
   `projectStore.parsedFiles`" (line 29). There are six rules and two new scan
   inputs. Same-change doc hygiene is a hard rule in `CLAUDE.md`.

9. **The waynet free-point flag bit exists in three private copies** — **FIXED
   2026-08-29**: `WAYNET_FLAG_FREE_POINT` and `WAYNET_FLAG_UNDER_WATER` are
   exported from `shared/worldTypes.ts` beside the `flags` field they describe,
   and the store, the overlay and both tests read them. Nothing asserts the
   packing beyond the existing classification tests, which is the point: they
   now fail together rather than one silently disagreeing.
   Was:
   `worldStore.ts:33`, `WaynetOverlay.ts:21`, and the new test; the packing is
   documented only as a comment on `WaynetPayload.flags`
   (`shared/worldTypes.ts:68`). A packing change fails silently as
   misclassification. Export one constant beside the field.

10. **`problemsStore.ts:97` rebuilds a ~3,000-entry Set per scan** — **FIXED
    2026-08-29**: `waynetLoaded` stores the `WorldWaynetView` itself
    (`pointNameKeys` + `freePointNames`), the scan passes it straight through,
    and `WaynetNames` is gone. The identity guard compares the key set and the
    free-point list, so a re-read that changed nothing still early-returns.
    Held by *"hands the scan the stored view instead of rebuilding it per
    scan"* (`problemsWaypointWorldInput.test.ts`), which asserts the object the
    scan is given is the one in the store. Was: — i.e. on every
    debounced keystroke re-parse — to convert `WaynetNames` into the near-twin
    `WorldWaynetView`. `waynetLoaded` already runs only on a real change; build
    `pointNameKeys` there and pass the stored object through, deleting the
    conversion and one of the two types.

---

# Second pass — **binding** (`zenkit-node`: C++, JS surface, mutate.js)

Reviewed 2026-08-29 after the first attempt died to a session limit. Six
substantiated findings; areas found clean are named at the end rather than
padded.

1. **The six waynet mutators never mark the handle mutated, so `container` is a
   lie.** `lib/index.js:75-80` — `module.exports = {...addon, …}` wraps only the
   VOB ops with `markMutated`; `setWaypointPosition`, `setWaypointName`,
   `addWaypoint`, `removeWaypoint`, `addWaypointEdge` and `removeWaypointEdge`
   come straight off the addon. `sourcePaths` still holds the load path, so
   `normalizeWorld` (line 29) re-reads the *original file* and attaches its
   hashes. After `removeWaypoint`, the dump shows 2,894 waypoints beside the
   2,895-waypoint file's hash table, frame sequence and RAW/BOOL digests,
   presented as this handle's container facts. `classifyDumps` treats container
   as byte-level truth, so drift is attributed to the writer and a before/after
   comparison of the same handle reports the container unchanged. The README's
   invariant ("`null` for a handle that has been mutated") holds for VOB ops
   only. `markMutated` has no test at all. — **FIXED 2026-08-29**: `lib/index.js`
   now wraps the six waynet mutators with `markMutated` too, and
   `waynetMutation.test.js` asserts a null `container` after each of the six.

2. **Waypoint names cross the boundary as UTF-8 while everything else is
   windows-1252.** — **FIXED 2026-08-29**: the five argument reads go through a
   new `RequiredCp1252Arg` (the positional twin of `RequiredCp1252String`, which
   now delegates to it), so a name argument is the same bytes as the name the
   world holds. The messages that quote a stored name decode it back for
   display — `Windows1252ToUtf8` in `encoding.cc`, new — because N-API reads a
   `std::string` as UTF-8 and the raw bytes would reach the user as mojibake in
   exactly the refusal that exists to name the waypoint they meant. Held by three
   tests in `encoding.test.js`: *"a waypoint name getWaynet emits still addresses
   its own waypoint"*, *"an authored waypoint name round-trips through the file
   as windows-1252"* (which asserts the cp1252 bytes in the saved file and that
   the duplicate refusal catches the collision after a reload) and *"a waypoint
   name windows-1252 cannot represent is refused, not mangled"*.
   `src/binding.cc:569, 612-613, 671, 746, 837` all use
   `Utf8Value()`, but `getWaynet` emits names via `Str()` →
   `Windows1252ToUtf16` (`normalize.cc:1419`) and every other write path uses
   `RequiredCp1252String`. For a waypoint stored as `WP_K\xF6NIG`: the name read
   back and passed to any waypoint op arrives as different bytes, the name guard
   mismatches, and the op is permanently refused as "the waynet has changed under
   this op" for a waynet that did not change. `addWaypoint` with a non-ASCII name
   writes UTF-8 bytes into a cp1252 field, so it does not round-trip and the
   engine shows mojibake; and the duplicate-name refusal (678-683) compares UTF-8
   against cp1252, so it misses a genuine collision — defeating the uniqueness
   the by-name script lookup depends on. `encoding.test.js` covers only
   `vobNames`, and all four fixture waypoints are ASCII.

3. **`std::stoull` can escape the N-API callback and kill the process.**
   — **FIXED 2026-08-29**: `ParseIndexPath` catches `std::out_of_range` and
   refuses the segment as `invalid <label>` — the same refusal a segment of
   letters gets, since no index that long can name a vob. Held by *"an index
   path segment too large to be an index is refused, not fatal"*
   (`mutations.test.js`), which also asserts the handle still resolves after it.
   `src/binding.cc:461` — `ParseIndexPath`'s segment validator rejects non-digits
   but not magnitude, so a long all-digit segment reaches `stoull` and can throw
   `std::out_of_range`. `binding.gyp` defines `NAPI_CPP_EXCEPTIONS` but not
   `NODE_ADDON_API_CPP_EXCEPTIONS_ALL`, and node-addon-api's `WrapCallback`
   catches `const Error&` only; no caller wraps `ParseIndexPath`. So
   `setVobPosition(h, '99999999999999999999999', [0,0,0])` unwinds out of the
   callback into `std::terminate`, killing the process holding the world.
   `assertApplyOpsRequest` validates op shape, not segment magnitude.

4. **`compareContainer` throws on the one "no container" value the library
   produces.** — **FIXED 2026-08-29**: `null` and `undefined` both read as "no
   container" in `compareContainer`, the way `covers()` already read them — so a
   mutated handle classifies, with `containerCoverage: false` and the one-sided
   case still `semantic-drift`. Two tests in `classify.test.js`.
   `lib/classify.js:182` — the early return tests `=== undefined`,
   but `strip` destructures its argument, so `container: null` throws
   `Cannot destructure property 'header' of 'null'`. `covers()` four lines below
   handles `null` explicitly — the same file anticipates it on one path and not
   the other. `classifyDumps` on a mutated handle therefore throws instead of
   producing findings plus `containerCoverage: false`. The test only covers the
   missing-key case.

5. **`extractWorldMesh` uses file-supplied indices with no bounds check.**
   — **FIXED 2026-08-29**: every corner's vertex and feature index is checked
   against `mesh.vertices` / `mesh.features` before it is dereferenced, and a
   world that fails it is refused the way an out-of-range wedge already was.
   `corner` itself is *not* checked and does not need to be: `Mesh::load` pushes
   exactly `index_count` corners per polygon, so `index_offset + i` is inside the
   index arrays by construction — the vertex and feature indices *inside* them
   are the only part a file controls. Held by *"extractWorldMesh refuses a
   polygon corner pointing outside the vertex list"* against a new
   `corrupt-mesh` fixture variant (`src/fixture.cc CorruptMeshIndices`).
   `src/mesh_extract.cc:65-82, 159-161` — `Chunk::Corner` indexes
   `mesh.vertices[vertex]` / `mesh.features[feature]` verbatim from the polygon
   index arrays, which are themselves read at `polygon.index_offset + b` with no
   size check, and upstream `Mesh.cc:187-189` pushes them straight from the
   stream. The same file bounds-checks the visuals path (`AppendSubMeshChunks`,
   line 257, throws on an out-of-range wedge). A truncated, corrupt or hostile
   `.zen` gives an out-of-bounds read — access violation, or garbage silently
   written into the transferred ArrayBuffers. Unlike the `zen-roundtrip` paths
   this runs in-process in the editor's `zenkit.worker`.

6. **`decodeTexture` narrows the mipmap level before range-checking it.**
   — **FIXED 2026-08-29**: the level is checked for finiteness, integrality and
   the `uint32_t` range *before* the cast, so `NaN`, `1e20` and `0.5` are refused
   instead of silently returning mipmap 0. Held by *"decodeTexture refuses a
   mipmap level that is not a whole number in range"* (`assets.test.js`).
   `src/assets.cc:268-273` — only `requested < 0` is tested before the cast to
   `uint32_t`; the `level >= texture.mipmaps()` check then runs on the narrowed
   value. `NaN` and `1e20` both cast to 0 and return mipmap 0 reporting success,
   where `OptionalInt32`/`OptionalWholeInt` elsewhere in the binding refuse
   non-integral and out-of-range doubles precisely because the cast is the hazard.

**Found clean, explicitly:** ArrayBuffer transfer (every buffer is copied into a
fresh V8-owned `ArrayBuffer`; no `External` buffer, nothing aliases a C++ vector
across the worker boundary); object lifetime and leaks (both `External`s pair
`release()` with a deleting finalizer; `InsertVob`/`ReparentVob`'s
`&temp->children` is co-owned, not dangling); `reparentVob`'s index arithmetic
(descendant refusal, same-list slot decrement, post-erase bounds check and
rollback all correct across root/nested and before/after-source cases);
`setVobProp`/`setVobClassProp` validate-then-write (no path leaves a
half-mutated VOB); and `saveWorld`'s serialize → temp file → checked stream →
rename-with-rollback. `WorldHandle::root_version` and `root_class_name` are
captured at load and never used on save — dead fields, not a defect.

---

# Second pass — **renderer** world surface

Reviewed 2026-08-29. Scope was `renderer/world/` (WorldScene, VobPicker,
BvhBuilder, cameraNav, snapping, DampedTransformControls, TerrainMarker,
vobModel, pickIds), `components/world/` (viewport, scene tree, property grid,
asset preview/browser) and `worldStore` — the waynet overlay and fetch excluded
as already covered above.

1. **A post-commit projection failure is misreported as a refusal, and three
   layers end up disagreeing.** — **FIXED 2026-08-29**: `applied(ops)` is in its
   own `try` after the commit, and a failure there says the edit *was* applied
   and the view is stale — no `invertOp`, no re-key, nothing put back. Held by
   *"says the placement was applied when the index re-read fails, and leaves it
   drawn"* (`WorldSurface.editing.test.tsx`).
   `WorldSurface.tsx:522-556` — `await applied(ops)`
   sits inside the same `try` as `await applyWorldOps(ops)`, but `applied` runs
   four fallible steps *after* the main process has committed: `applyEdit`,
   `applyWaypointPositions`, and three IPC calls (`getWorldWaynet`,
   `refreshWorldIndex`, `getWorldVisuals`). Any rejection lands in the catch,
   which calls `editFailed`, bumps `editRefusals`, nulls `classProps` and hands
   the viewport `ops.map(invertOp)`. Place a VOB, then have the worker restart so
   `refreshWorldIndex()` rejects: the banner says refused, the scene visibly
   snaps back, the store's columns were already written and are *not* reverted,
   and the main process still holds the op — on the undo stack, and written on
   save. Same shape as finding 1 of the first pass: a `try` that spans past the
   commit point.

2. **A renamed VOB keeps its old label in the scene tree indefinitely.** —
   **FIXED 2026-08-29**: the tree takes the applied ops as a prop, and they are
   a dependency of both the `itemData` the memoised rows compare and the
   `matches` the filter is memoised on. Held by *"re-labels the row of a VOB
   that was renamed"* and *"re-runs an active filter, so a rename adds and drops
   rows"* (`WorldSceneTree.test.tsx`), plus *"re-labels the scene tree row when
   the name is committed"* (`WorldSurface.editing.test.tsx`) for the wiring —
   which is the half a component test cannot see, and which fails without the
   prop being passed.
   `WorldSceneTree.tsx:424-444` with `:129-211` — `applyOps`
   (`zen-world/src/model/ops.ts:1977`) writes `SetVobProp`'s name/visual into the
   summary's columns in place, deliberately preserving `summary` identity. `Row`
   is `memo`'d, react-window passes it only `{index, style, data}`, and none of
   `itemData`'s deps change on a property edit — while the label is read *inside*
   `Row`. So the grid updates and the world holds the new name, but the row does
   not, until an unrelated change breaks `itemData`'s identity. The same cause
   makes an active filter stale: `matches` (line 278) is memoised on
   `[summary.vobIndex, query]`, so a rename never adds or drops a row.

3. **The scene tree's `expanded` set holds flat VOB indices and survives a
   renumber.** — **FIXED 2026-08-29**: the same prop carries it. The set is
   dropped when the applied ops renumber *and* the summary's identity changed —
   only a committed structural op replaces the summary (`indexRefreshed`), so a
   refused one no longer collapses a tree over an edit that did not happen.
   Dropped rather than remapped, for the reason the selection is. Held by
   *"forgets which VOBs were expanded when an op renumbers them"*
   (`WorldSceneTree.test.tsx`), which deletes a two-VOB subtree so the stale
   index lands on a *different* root with children — the case where keeping it
   opens a row nobody touched.
   `WorldSceneTree.tsx:261` — `WorldSurface` renders the tree without
   a `key` (`:1580`) and a structural op keeps `summary` truthy, so the component
   is not remounted; only `tree` and `reader` are rebuilt. `applied` clears the
   *selection* on `renumbersPaths`, but nothing touches `expanded`. Expand VOB
   100, delete VOB 5 with a 4-VOB subtree: the VOB the user opened is now 96 and
   renders collapsed, while an unrelated VOB at 100 renders expanded. Same for
   `ReparentVob` and for `AddVob` under a parent. Opening a different world is
   safe — `beginOpen` nulls `summary`, unmounting the panel.

4. **`bvhReady` never settles after a scene rebuild.** — **FIXED 2026-08-29**:
   `dispose()` resolves every outstanding build before clearing the map —
   resolved, not rejected, because the caller's scene is being torn down and
   that is not an error it can act on; it finds a geometry with no tree, which
   is the truth. The worker's construction moved to `bvhWorker.ts` so
   `BvhBuilder` is importable by a test at all: `new Worker(new URL(…,
   import.meta.url))` is Vite's worker form and the CommonJS Jest transform
   cannot parse `import.meta`. Held by *"settles the builds it will never
   finish, so an awaiting caller does not hang"* (`bvhBuilderDispose.test.ts`).
   `WorldViewport.tsx:1183-1187` — `BvhBuilder.dispose()` (`BvhBuilder.ts:261`)
   terminates the worker and calls `this.pending.clear()` without resolving the
   outstanding promises, and the scene effect's cleanup calls it on every
   rebuild. `renderFrom`/`benchmark` await `Promise.all([bvhReady,
   texturesReady])`; a structural op mid-await leaves the promise unresolved, so
   the `finally` restoring `controls.enabled` and `startDraw()` never runs and
   the caller hangs instead of failing. Harness-only reach, hence the rank, but a
   genuine never-settling promise.

**Found clean, explicitly:** ArrayBuffer detachment (nothing in scope transfers
or neuters a payload buffer — `BvhBuilder.build` transfers `.slice()` copies and
`threeIndexOrder` returns a fresh buffer, so `MeshBVH.deserialize` writes into
the scene's own index); picking against a moved or turned VOB (the picker shares
the drawn mesh's `instanceMatrix`, hidden attribute and bounding-sphere *object*,
and three r0.180 mutates that sphere in place, so move/rotate/hide reach the pick
pass without a rebuild; a reparent is structural and rebuilds it); Three.js
resource lifecycle (geometries, materials, cloned pick geometries, render target,
overlay, marker, gizmo helper, ResizeObserver and all listeners released in the
scene-effect cleanup; the texture cache is disposed exactly once on unmount); and
undo op construction (every builder reads `from` pre-mutation, both class/base
prop handlers refuse on a `classProps.vob` mismatch, and the refusal path filters
barrier ops before inverting).

---

# Second pass — **ops/main**: `zen-world` ops and the main process

Reviewed 2026-08-29. Traced end to end: `ipcValidation.ts` → `main.ts` world
handlers → `WorldService` → `zenkit.worker` → `commitOps`/`writeOp` →
`binding.cc`, plus `ops.ts` builders / `invertOp` / `applyOps`, the renderer's
`commitOps`/`applied`, and the tests.

1. **A worker crash bricks `WorldService` for the life of the process, and the
   error message tells the user to do the one thing the code prevents.** —
   **FIXED 2026-08-29**: `handleWorkerDeath` now nulls `this.worker` too, so the
   next `openWorld` starts a fresh one and clears `failure` — the same drop the
   timeout path already did, which is what its "same policy as a crash" comment
   had been claiming. Held by *"a crashed worker is replaced by the next open,
   not kept forever"* (`WorldService.test.ts`).
   `WorldService.ts:359-366` — `handleWorkerDeath` sets `this.failure` and nulls
   `worldPath` but, unlike `handleTimeout` (:345) and `close()` (:282), never
   sets `this.worker = null`. `openWorld` (:84) starts a worker only when
   `worker === null`, and `startWorker` (:291) is the only place `failure` is
   reset, so every later request short-circuits on `request()`'s failure check
   (:311). The banner says "the world worker died — reopen the world"; reopening
   rejects with the same stale error forever. There is no escape hatch:
   `closeWorld` is exposed in `preload.ts:84` and `global.d.ts:198` and is never
   called anywhere in the renderer. `WorldService.test.ts:188` pins exactly this
   recovery for the *timeout* path; the two crash tests (:145, :159) assert the
   rejection and never attempt a reopen.

2. **An undo during a world open is applied to the new world using the old
   world's index paths.** — **FIXED 2026-08-29**: `openWorld` now drops
   `worldPath` and both stacks *before* it awaits the open, so a replay pressed
   mid-open finds nothing to replay and every other request is refused by
   `requestOnOpenWorld`'s existing "refused rather than queued" check. The open
   stays outside the `serialized` queue deliberately — it is not an edit and
   must not wait behind one. A failed open now leaves no world open, which is
   what a partial load in the worker actually leaves behind, and matches the
   renderer's `openFailed` reset. Held by *"an undo while a world is opening is
   refused, not written into the new world"* (`WorldService.test.ts`).
   `WorldService.ts:83-90, 301-308` — `openWorld` is
   outside the `serialized` edit queue; `worldPath` is reassigned and the undo/
   redo stacks cleared only *after* `await this.request('open', …)`. So
   `undo()` → `serialized` → `replayOne` → `requestOnOpenWorld` sees the previous
   world's non-null `worldPath` and a null `failure`, and posts `applyOps` into
   the worker's FIFO behind the pending open. World A open with edits, user opens
   B (a multi-second `loadWorld` + `openVfs`) and presses Ctrl+Z — bound
   unconditionally at `WorldSurface.tsx:1174` — and A's inverse batch is written
   into B at paths like `2/71`, silently mutating whatever sits there. `replayOne`
   then pops A's entry and `openWorld` clears both stacks, so nothing records it.
   No test opens a world with a request in flight.

3. **`applyOps` never bounds-checks `op.vob`, and it runs after the commit.** —
   **FIXED 2026-08-29**: `applyOps` refuses an op naming a VOB outside
   `reader.count` with a `RangeError`, before writing anything for it — what the
   two waynet siblings already did. It still runs after the commit, so what it
   turns is a silent no-op into a loud disagreement; the window itself is the
   renderer's and is unchanged. Held by *"refuses an op naming a vob the index
   does not have"* (`zen-world/test/ops.test.ts`).
   `zenkit.worker.ts:248-283` calls `commitOps` (world mutated, atomic) and only
   then `applyOps` (`ops.ts:1948-2016`). Its two waynet siblings —
   `applyWaypointPositions` (:1908) and `applyWaypointNames` (:1938) — both do
   bounds-check, which makes this an oversight rather than policy;
   `assertApplyOpsRequest` requires only a non-negative integer
   (`ipcValidation.ts:509`). A `RotateVob` with `vob >= count` throws
   `RangeError` at `rotations.set(op.to, op.vob * 9)` *after* the native world was
   already turned: the worker replies `ok:false`, `WorldService` skips the
   `undoStack.push`, and the renderer's catch draws the VOB back at its old pose —
   world rotated, projection not, no undo entry. The sibling columns fail worse:
   `positions[op.vob*3] = …` and `flags[op.vob] |= bit` are silent no-ops on an
   out-of-range typed-array index, so the same stale op reports success with the
   projection never updated. Reachable without a hostile renderer in the window
   between `applyWorldOps` resolving and `refreshWorldIndex` resolving
   (`WorldSurface.tsx:518`), where the store still holds the pre-delete summary.
   `zen-world/test/ops.test.ts` has no out-of-range case.

4. **`AddVob` with `to: null` is an unguarded subtree delete that bypasses every
   `DeleteVob` guard and is recorded as invertible.** — **FIXED 2026-08-29**:
   `assertApplyOpsRequest` now takes an `AddVob` only in the add direction —
   `to` null is refused as "send a `DeleteVob`", `from` non-null as "an AddVob
   adds". The delete direction stays a real direction in `writeOp`, because it
   is what `invertOp` builds off the undo stack *inside* the main process; what
   it is not is a request. Held by *"crosses this boundary only as an add"*
   (`ipcValidation.test.ts`).
   `ipcValidation.ts:563-627` originally
   accepted either null side (tested at `ipcValidation.test.ts:943`)
   and never cross-checks `path` against `parentPath` or the `from` spec. In
   `writeOp` (`ops.ts:1727-1743`) the insert direction is guarded (`landed !==
   op.path` → rollback and throw) while the delete direction is a bare
   `binding.deleteVob(op.path)`; `binding.cc:2877` only checks that the path
   resolves. `isBarrierOp` is false, so `WorldService.applyOps` (:187) pushes it
   to the undo stack instead of clearing history. An `AddVob` naming an existing
   path with `to: null` erases a retail `oCMobContainer` and its subtree, and
   undoing it inserts a bare `zCVob` in that slot — exactly the "undo that looks
   like it worked" the `DeleteVob` doc comment (:481-504) says must never happen,
   and what the exhaustive-key check at :534 prevents for the op that *is* named
   a delete.

**Found clean, explicitly:** op and key coverage of `assertApplyOpsRequest` — all
twelve `WorldOp` members have a branch, `AddVob`'s `NewVob` keys match
`insertVob`'s `kKnownKeys` (including the `physicsEnabled` exclusion),
`SetVobProp`'s key set matches the C++ 20-entry list key for key, and
`CLASS_FIELDS` matches every `RequireClassKeys` list across all 23 catalogued
classes with no class lacking a C++ case; the renderer/validator split for
`oCItem.instance` (shape in the validator, existence in *both* renderer
producers, each gated on a non-empty index); inverses (every non-barrier op
swaps everything asymmetric, and `writeOp` reads `op[direction]` in all three
places where a `commitOps` unwind would otherwise re-apply); ArrayBuffer transfer
(`open`/`refreshIndex` transfer nothing, `takeWorldMesh` nulls its cache and
re-extracts, `visuals`/`texture` transfer freshly built buffers); and the
pending-promise lifecycle (settled ids ignored, `rejectAll` clears every timer, a
late reply after a timeout is harmless).
