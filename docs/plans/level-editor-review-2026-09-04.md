# Level editor review — 2026-09-04

A code and UI/UX review of the level editor, requested by Daniel. It is the
**second pass the 2026-08-29 review never got**: that document says its scope
over `zenkit-node`, the `zen-world` ops, the main process and the renderer's
scene/picking/undo surface "died to a session limit before any finder
reported" and is "unreviewed, not clean". This pass covered exactly that scope,
plus the UI panels as a user sees them.

**How it was done.** Six read-only passes, one per layer (the `zen-world`
domain, the main process, the Three.js layer, the surface and store, the React
panels, the native binding), each told to check the 08-29 review,
`refactoring-targets.md` and §16 before reporting and to verify by re-reading.
The reviewer then re-verified the top findings by hand and, for the first
time on a Linux box, **ran the app**: the addon was built from source (the
CMake `FetchContent` downloads are blocked by the sandbox proxy — cloning
`miniz`, `doctest` and `phoenix-libsquish` into `vendor/ZenKit/vendor/` makes
ZenKit's `px_add_dependency` take the local copies), the editor built, and the
fixture world opened in real Electron under `xvfb` with SwiftShader. The
screenshots informed the UX section. Suites run, all green on `HEAD`:
`zen-world` (14 suites, 436 tests), `zenkit-node` on the fresh addon (419
pass, 1 skipped), the editor's world-related Jest suites (54 suites, 813
tests) and the seven main-process suites the main-process pass named.

Nothing here is fixed. Findings are ranked most severe first within each
section, each with the file and line, the failure scenario and a confidence:
**confirmed** means re-read or reproduced, **plausible** means the mechanism
is confirmed and the trigger is narrow or timing-dependent. A finding the
08-29 review or §16 already holds is not repeated.

## 1. Verdict

The editor's architecture is sound and the tests are real — 1,700 tests over
this scope, and every pass found the documented invariants (op inverses, the
index-path enumeration, the whitelist, the guard set) actually held in the
places the documents cite. What the passes found is the residue of building
fast on top of that: a handful of **real correctness defects** that no test
can see because each lives at a seam the suites mock past (an inverse the fake
binding accepts, a race the fake worker never produces, a matrix nothing
checks for orthonormality), **one security promise the main process does not
keep**, and a UI whose every feature works but whose **feedback is silent**:
refused values, dirty state, camera slots, mode changes and shortcuts all
happen without the screen saying so.

Four things are worth doing before anything else:

1. §3.1 — the scatter brush, carded as landed on 09-03, cannot hit the world
   mesh: its raycaster never had the layer mask the other two have.
2. §2.1 — `world:save` accepts any path in a whitelisted directory, the
   opened retail file included.
3. §2.2, §2.3, §2.4 — three defects that corrupt the world or wedge undo:
   the antiparallel rotation matrix, the `ReparentVob` inverse, the undo stack
   that a new open hands to the previous world's in-flight commit. With them
   §3.2, which recreates the WebGL renderer twice per placement.
4. §5 — the silent-feedback cluster in the UI, which is what a first user
   hits before any of the above.

The pattern behind the first three is worth naming: **each is at a seam the
suites mock past.** The brush tests call the stroke callback directly; the
`ReparentVob` tests use a fake binding that returns whatever path it is
asked; the undo race needs a worker that answers late. `assertApplyOpsRequest`
was already known as such a seam (CLAUDE.md); the viewport's raycasters and
the fake binding's path arithmetic are two more.

## 2. Correctness and security

### 2.1 `world:save` writes anywhere in a whitelisted directory — **confirmed**

`daedalus-dialog-editor/src/main/main.ts:1033-1037` validates `targetPath`
against `pathValidator` only. `world:openDialog` (`:848`), `world:saveDialog`
(`:1024`) and `world:listWorlds` (`:805`, every discovered world's folder, the
Gothic install's `_work/Data/Worlds` included) all grant `path.dirname(...)`
recursively. So once a world is listed or opened, `saveWorld(summary.worldPath)`
overwrites the retail file with no dialog; the OS overwrite prompt and the
`.edited.zen` suggestion live only in `WorldSurface.tsx:919-930`.
`docs/architecture/level-editor.md` §7 says "the renderer never names its own
target: the dialog is what puts the directory on the path whitelist" — the
directory, not the file. `security-model.md` says the single-file dialogs
grant *that exact file only*, and `:421`/`:437` do (`addAllowedFile`). The
world dialogs should do the same, and `world:save` should also pass
`{ write: true }` as `world:saveVobFolders` (`:1054`) does.

### 2.2 `rotationBetween` emits a non-rotation for an antiparallel pair — **confirmed**

`zen-world/src/model/ops.ts:715-757`. The antiparallel branch replaces `axis`
with `from × reference` but keeps `sin = |axis|` (≈1) where θ = 180° needs
sin θ = 0. For `from=[0,1,0], to=[0,-1,0]` the result is
`[[-1,1,0],[-1,-1,0],[0,0,1]]` — max|RᵀR−I| = 1.0, and R·up = `[1,-1,0]`: the
VOB is neither aligned nor rigid. Reached by `alignVobsToNormal` on an upright
VOB against a ceiling normal, and by `scatterVobs` painting a ceiling.
`assertApplyOpsRequest` checks only that the nine entries are finite, so the
sheared matrix is written into the `.zen`, and `zenRotationToEuler` later
"squares it up" silently. The tests pin a 90° and a 45° case only. Fix: `sin =
0` in that branch after normalising the perpendicular axis.

### 2.3 Undoing a `ReparentVob` that lands ahead of its old parent is refused, and wedges the stack — **confirmed** (simulated against the binding's arithmetic)

`ops.ts:1890-1950` (`reparentVob`/`landingPath`), `:1961-1990` (`invertOp`),
`:2081-2095` (`writeOp`). `landingPath` predicts `to.path` accounting for the
forward *removal*, but nothing adjusts `from.parentPath` for the forward
*insertion*. On undo, `writeOp` hands the binding the pre-edit parent path,
and `binding.cc:3175-3250` applies its own removal shift and self-descent
check to it. Cases: `0/3 → root slot 0` undo throws "cannot reparent a vob
into itself"; `1/0 → root slot 0` lands at `0/0`, fails the landing check and
throws; `0/1/0 → 0 slot 0` the same. Because `WorldService.replayOne` leaves a
refused batch on the stack (`WorldService.ts:337-349`), every further Ctrl+Z
hits the same refusal and everything beneath it is unreachable. The
`test/ops.test.ts:2141-2170` fake binding returns whatever path it is asked
for, so it cannot see this. Fix: `invertOp` computes the old parent's path *as
it stands after the move*.

### 2.4 A commit in flight when a new world opens lands on the new world's undo stack — **confirmed**

`WorldService.ts:104-112` replaces `this.undoStack = []` *before* awaiting the
open; `applyOps` (`:233-251`) pushes *after* the worker answers, and the worker
is FIFO, so A's batch is pushed into the array that becomes B's stack.
`refreshHistoryDepth` after B's open reports 1, Undo enables, and Ctrl+Z
replays A's inverse at A's path into B. Reachable: a scatter stroke or a big
paste, then Open — the button is disabled only on `status === 'opening'`. The
sibling of the *fixed* 08-29 ops/main finding 2, which guarded the replay side
only. Also, `WorldSurface.tsx:414` clears `unsavedEdits` at the start of
`openWorldAt`, so the same late commit reopens B dirty. A generation counter
on the service, or refusing an open while a commit is in flight, closes both.

### 2.5 Ctrl+Z/Y is the one shortcut that ignores both guards — **confirmed**

`WorldSurface.tsx:2231-2237`: the undo/redo branch has neither
`isTypingOrInPopover` nor `surfaceDialogOpen`, unlike W/E, C/V, Delete,
Escape and the nudge above it; `docs/architecture/level-editor.md` §17 says
"all of them share `isTypingOrInPopover`". Ctrl+Z inside a property-grid
number field, the scene-tree filter or the add-waypoint name field
`preventDefault`s the text undo and undoes a *world* op. Worse: with the
Delete dialog open on VOB N (`deleting` is a flat index), an undo of a
parented `AddVob`/`ReparentVob` renumbers; `applied` clears the selection but
not `deleting`, so Confirm removes whatever now sits at N — a barrier. No test
in `WorldSurface.shortcuts.test.tsx` covers Ctrl+Z with a focused field or an
open dialog.

### 2.6 `removeWaypoint(barrier)` dereferences a null edge endpoint — **confirmed** mechanism, narrow trigger

`zenkit-node/src/binding.cc:873` collects each edge's other endpoint, `:890`
does `endpoint->free_point`. `WayNet::load` (`vendor/ZenKit/src/world/
WayNet.cc:94-100`) keeps an edge whose `read_object` returned null; §16.11
records that tolerance and says "nothing dereferences one" — true of
`normalize.cc`, not of this op. A world with one unresolved edge reference
whose other endpoint the user barrier-deletes segfaults the worker.
`removeWaypointEdge` (`:1019`) is safe.

### 2.7 `commitOps` has no in-flight guard; every builder reads `from` from a projection that updates after the round trip — **confirmed**, timing-dependent

`WorldSurface.tsx:1096-1099, 1162-1168`; `ops.ts:683-693, 2179-2181`. Holding
an arrow key auto-repeats keydown; every press before the first
`applyWorldOps` resolves builds `from+δ` from the same `from`, so the VOB
moves one step while the main process records N identical undo entries.
Double-click Duplicate or held Ctrl+V builds the second `AddVob` from the
stale reader with the same `path`, which the `landed !== op.path` guard
refuses with an internal message.

### 2.8 `runHistory` catches nothing — **confirmed**

`WorldSurface.tsx:1085-1090`, called as `void runHistory(...)`. A rejected
`undoWorldEdit` (worker died, world mid-open) or a throw in `applied` is an
unhandled rejection: no banner, `historyDepth` stale, view silently behind the
world. `commitOps` wraps `applied` for exactly this reason (`:1140-1150`).

### 2.9 `alignVobsToNormal` and `scatterVobs` feed an un-normalised column into Rodrigues — **confirmed**

`ops.ts:776` and `:1683` take `[m[1], m[4], m[7]]` as the current up;
`rotationBetween` uses `dot` as cos θ, so it assumes unit inputs. The README
documents 30.2% of retail VOBs as non-orthonormal (worst 2.1e-2); a Y column
of length 1.02 gives a delta with max|RᵀR−I| = 0.04, then compounded onto the
drifted matrix. One shared `standUp(rotation, normal)` helper is where §2.2
and this get fixed together — the stand-up logic exists twice today.

### 2.10 `WorldService.handleTimeout` cannot stop the thread it claims to — **confirmed**

`WorldService.ts:420-432`: `worker.terminate()` interrupts JavaScript only; a
worker inside a synchronous N-API call (`loadWorld`, `saveWorld`, `commitOps`)
runs until that call returns. The comment says the timeout "takes the worker
down"; it orphans it — the world it holds stays resident and the next
`openWorld` spawns a second worker holding a second world. A save that times
out mid-write leaves `<target>.tmp` behind (`binding.cc:476-497` rolls back on
its own error paths only).

### 2.11 Worker `error`/`exit` handlers are not scoped to the instance — **plausible**

`WorldService.ts:365-374`. `close()`/`handleTimeout` terminate and null
`this.worker`; `exit` arrives asynchronously. If `openWorld` runs first,
`startWorker` clears `failure`, then the stale `exit` (code 1) rejects the new
open, nulls the new `worker` and reports "The world worker died", leaving the
new thread running unreferenced. The test double's `terminate()` never emits
`exit` (`tests/WorldService.test.ts:28`). `if (worker !== this.worker) return`
closes it. A code-0 exit is also ignored entirely (`:369-371`): every pending
request then waits the full 120 s.

### 2.12 `Napi::External` handles are not type-tagged — **confirmed** hazard

`binding.cc:114` (`UnwrapHandle`) and `assets.cc:81` (`UnwrapVfs`) check
`IsExternal()` only. `zenkit.vobIndex(vfs)` reinterprets a `zenkit::Vfs` as a
`shared_ptr<World>`, passes the non-null check and dereferences garbage. Needs
a caller bug (the worker or the blender bridge swapping arguments), but it is
the one argument hole that is memory-unsafe rather than a wrong answer.
`napi_type_tag_object`/`CheckTypeTag` closes it.

### 2.13 `zCVob` position/rotation/bbox accept NaN and ±Infinity in the binding — **confirmed**

`Vec3FromValue` (`binding.cc:595`) and `FloatsFromValue` (`:1055`) cast
unchecked, unlike every class-prop float. `ipcValidation.ts:585` guards the
app's path; the blender bridge does not (`JSON.parse('1e400')` is `Infinity`
and `session.js` forwards `params.position` straight through). The README
calls the binding's bounds "the copy that is load-bearing" — here it is not.
Two unchecked `double → size_t` casts are UB besides (`:3191` `reparentVob`
slot admits `1e300`/`Infinity`; `:339` `_drillMesh` offset admits NaN), and
waypoint indices go through `Int64Value()` with no integrality check
(`:663, :704, :832, :920`).

### 2.14 `WorldFoldersService.save` is unserialized with a fixed temp name — **plausible**

`WorldFoldersService.ts:64-80` opens `<target>.tmp` with `'w'` and renames;
the renderer fires one save per folder mutation without awaiting
(`WorldSurface.tsx:1694-1700`). Two rapid changes: the second `open` truncates
the first's temp file, the first `rename` moves a partial file into place, the
second `rename` fails ENOENT and is only logged; the torn file is renamed
aside as corrupt on next load and the folders come back empty.
`SettingsService` has the promise mutex; `AssetCatalogService` is described as
"the same shape" (`main.ts:1097`) and wants the same check.

### 2.15 Smaller confirmed items

- **Two concurrent `openWorld` calls interleave state** (`WorldService.ts:
  104-113`, no in-flight guard in `openWorldAt`): A's `vobIndex` can pair with
  B's mesh for the interval. A generation counter fixes it with §2.4.
- **Structural refresh has a mismatched window** (`WorldSurface.tsx:1078-1079`):
  between `indexRefreshed` and `setVisuals` the store has the new index while
  `visuals.vobIds`/`boundsOf` are the old enumeration; a pick in that window
  maps instance→wrong VOB. `refreshHistoryDepth` (`:1050`) sits after the
  waynet re-read await, so a rejected re-read leaves the buttons stale.
- **Silent unguarded awaits**: `toggleWaynet`/`toggleSpawns` (`:560`, `:604`)
  leave the toggle on with nothing drawn and no banner when the read rejects —
  the failure the open path was rewritten to report; `refreshHistoryDepth`
  (`:275`) likewise.
- **Surface-local state survives a world open**: `clipboard` (`:1748`) is
  never cleared, so A's positions paste into B; `savedTo`/`saveError` (`:907`)
  stand over B; `selectedAsset` keeps A's VFS path.
- **`surfaceDialogOpen` omits `insertingNpc`, `pickerOpen`, `quickTestBlocked`**
  (`:2129-2130`) — the residual window is MUI's 50 ms focus-trap poll.
- **`mergeChunks` distinguishes `lights === null` but the binding omits the
  key** (`zen-world/src/render/mergeChunks.ts:~141` vs `index.d.ts`
  `lights?: ArrayBuffer`): `undefined` gets zeros — every prop black under a
  vertex-colour material. Masked today by `zenkit.worker.ts:59-62`'s `?? null`.
- **GMBT quick test**: argv array, no `shell` — no injection. But
  `resolveGmbtExecutable` (`GmbtService.ts:39-46`) accepts every `PATHEXT`
  extension including `.BAT`/`.CMD`, which Node ≥ 20.12 refuses to spawn
  without `shell` (EINVAL); skip those extensions, never add `shell: true`. A
  spawn failure after the handler returns (`main.ts:920`) is console-only —
  the renderer sees success. And the dirty check and the launch can disagree
  about which file the engine plays: a world opened from the install's list
  and saved back clears `unsavedEdits`, yet GMBT runs the mod's copy; nothing
  checks the opened path is under `gmbtProjectDir`.
- **`world:getVobFolders` writes under a read validation** (`main.ts:1043`,
  `WorldFoldersService.load:41-43` renames a corrupt sidecar aside).
- **Encoding**: `Utf16ToWindows1252` (`encoding.cc:66`) cannot re-encode the
  five undefined bytes the decoder emits as U+0081/8D/8F/90/9D, so a name
  carrying one reads out and is then refused as a guard — the 08-29 finding-2
  shape, reopened for one byte class; `:79` prints the code point in decimal
  after "U+". `vfsList` (`assets.cc:185`) emits entry names as UTF-8 via
  `Napi::String::New(std::string)`, not `Str()`, so a non-ASCII VDF name is
  U+FFFD. Edge messages at `binding.cc:976, 1014` quote raw cp1252.
- **`loadWorld` on a directory path** (`binding.cc:73-78`): `ifstream` opens a
  directory on Linux, `tellg()` is huge or −1, the `vector` constructor throws
  outside any `try` — `std::terminate`. Windows refuses directories.
- **`decodeTexture` ignores a non-number `level`** (`assets.cc:299`) and
  returns mipmap 0 as success; `openVfs`'s `overwrite` likewise.
- **`vobAtIndexPath` parses leniently** (`ops.ts:627-648`): `'0//1'` and
  `'1e0'` resolve; folder sidecars are the only external source of paths and
  `parseVobFolders` does not validate shape.
- **Paste after a stale view** (`WorldSurface.tsx:1814`): `commitOps` returns
  `true` even when `applied` failed, so `vobAtIndexPath` resolves against the
  old summary and can select the wrong VOB.

## 3. Renderer scene layer

### 3.1 The scatter brush cannot hit the world mesh — the feature is dead in the app — **confirmed**

`WorldViewport.tsx:1037` creates `brushRaycaster` without `layers.enableAll()`;
every world mesh is on `WORLD_LAYER` = 1 (`WorldScene.ts:106, 377, 408`). A
`Raycaster` defaults to layer 0 and `intersectObjects` tests
`object.layers.test(raycaster.layers)` before raycasting, so `brushHit`
(`:1047`) and `brushGround` (`:1102`) always return null: `onBrushDown` never
starts a stroke, the ring never draws, `onScatterStroke` never fires. The other
two raycasters (`:414`, `:582`) do enable all layers, and `VobOutline.ts:24`
says "both raycasters" — the brush is the third, landed two days after the
outline. Every scatter test mocks the viewport and calls `onScatterStroke`
directly (`WorldSurface.scatter.test.tsx`), which is why it is green. The
board's 09-03 card says the brush landed; nobody has painted with it.

### 3.2 Every structural op tears down and recreates the `WebGLRenderer`, twice — **confirmed**

The scene effect's deps are `[mesh, visuals, bbox]` (`WorldViewport.tsx:1846`)
and `bbox` is `summary.bbox` (`WorldSurface.tsx:2650`) — a structured-cloned
summary after every `indexRefreshed`, so a new array identity per structural
op. The effect constructs a new renderer and canvas (`:557`) and disposes the
old (`:1841`); `WebGLRenderer.dispose()` does not lose the context, and the
cached textures are deliberately not disposed (`WorldScene.ts:782`), so the
old context keeps its GL textures until the detached canvas is collected while
the new one re-uploads all 490 textures and the 31 MB mesh and recompiles
every program — the 53–276 ms shader-compile cost §3 of the plan moved out of
the first click is now paid per placement. Chrome's ~16-context cap evicts the
*oldest* context past that. Twice, because `WorldSurface.tsx:1078` commits the
index before `:1079` commits the visuals. §16.24 notes "two rebuilds per
paste" as a harness gap; this is the cause. Fix: key on the bbox *value*, and
keep renderer, canvas, outline and controls for the component's life,
rebuilding only `WorldScene`, picker and BVH.

### 3.3 The world-mesh BVH is rebuilt on every structural op though the mesh never changed — **confirmed**

`new BvhBuilder()` and the 352 `build()` calls (`:651-652`) run inside the
same effect; `bvh.dispose()` (`:1838`) terminates the worker. Each rebuild
copies position and index (`BvhBuilder.ts:44-45`) and spends the 145–590 ms
the plan says belongs to the cold open; until the trees land,
`acceleratedRaycast` falls back to a linear raycast over 476k triangles for
every pivot press, terrain click and `raycastDown`, and the walk passes
through untreed meshes. With §3.2, ×2 per op. Cache the serialized trees per
`mesh` payload the way textures are cached.

### 3.4 `ThumbnailRenderer` uses one canvas for both a 2D and a WebGL context — **confirmed** (spec behaviour)

`renderTexture` calls `getContext('2d')` (`ThumbnailRenderer.ts:67`) and
`webgl()` hands the *same* canvas to `WebGLRenderer` (`:86`). A canvas's
context mode is fixed by its first `getContext`, so whichever tile kind is
drawn second fails for the rest of the world session; `AssetThumbnails.produce`
catches it as `{status:'failed'}` — a silently marked tile. Reachable in
Favorites or any mixed listing. This is "the thumbnails' look", which the
board lists as unwitnessed. Fix: a second canvas for the 2D path.

### 3.5 GPU buffers never released — **confirmed**

`WorldScene.dispose()` (`WorldScene.ts:776-793`) never calls `dispose()` on
its ~724 `InstancedMesh`es, so their `instanceMatrix`/`instanceColor` buffers
are freed only by GC; `SpawnOverlay.dispose()` (`:379-390`) the same for
`dummies`. ~1 MB per rebuild — small, but the 08-29 "resource lifecycle found
clean" is wrong on this point. And `VobPicker.setInstancedMeshes` deep-clones
every geometry (`VobPicker.ts:272`) — the comment at `:270-271` claiming "no
extra vertex memory" is wrong; a `BufferGeometry` sharing the attribute
objects and adding only `pickColor` is the fix.

### 3.6 Smaller items

- **Fly right-click discrimination is Windows-only** (`:1286-1292` reads
  `flew`, set on release; the comment at `:1310` concedes `contextmenu` fires
  after release on Windows only). On Linux/macOS every right-button hold that
  starts on a VOB also opens the menu; the ubuntu Electron e2e job runs there.
- **F3 twice inside the pointer-lock grant latency** leaves the lock engaged
  with no walk (`:1389`, `:1415`, `:1440`): locked until Escape, clicks at
  frozen coordinates. Narrow.
- **Per-frame allocations with labels on**: `SpawnOverlay.labelledPoints`
  (`:245`) spreads two arrays per frame; `chooseWaypointLabels`
  (`waypointLabels.ts:77-107`) allocates per on-screen waypoint plus a sort.
  Bounded.

Checked and found sound: `pickIds` (no collision or overflow), pick readback
ordering, BVH staleness rules, raycast spaces, the gizmo maths (delta =
`q_now·q_start⁻¹`, mirror conjugation, snapping on the proxy in the right
basis, damping cannot drift), fly/walk `dt` clamping, `paused` really cancels
rAF, listener teardown, `bvh.worker` ordering, and the effect wiring
(callbacks through refs; `appliedOps` are absolute so StrictMode double-runs
are idempotent).

## 4. Structure and duplication

- **`WorldViewport.tsx` (2,090 lines) is a god component** not listed in
  `refactoring-targets.md`: one `useEffect` (`:535-1846`, ~1,310 lines) owns
  the renderer lifecycle, camera, the gizmo, three pick handlers, the brush,
  fly, walk, framing keys and slots, resize, the draw loop, the benchmark
  probe, the `__worldViewport` harness and a 55-line teardown, over ~40
  shared closure variables. The "no React in `world/`" rule holds, but its
  converse does not — most imperative logic that belongs in `world/` lives in
  the component, which is why `window.__worldViewport` exists to reach it.
  The split is plain classes in `world/`: `ViewportRenderer` (mount-scoped —
  also the fix for §3.2), `SceneHost` (scene + picker + BVH cache, per
  payload), `GizmoController`, `PickController`, `NavController`,
  `ScatterBrush`. A `ScatterBrush` taking a raycaster factory is a unit test;
  §3.1 inside a 1,300-line effect was reachable only through a mocked viewport.
- **`WorldSurface.tsx` (3,190 lines) holds nine concerns** that share only
  `commitOps`/`applied`: open/lifecycle (`395-548`), the edit pipeline core
  (`966-1160`), VOB op builders (`1162-1480, 1554-1625`), clipboard
  (`1748-1825`), scatter (`1627-1690`), waynet edits and derived data
  (`1827-1875, 2000-2110`), Insert-NPC and its dialog (`1877-1998, 2818-2900`),
  folders/asset catalog (`1692-1746`), keyboard (`2129-2242`), and layout with
  five inline `Dialog`s (`2245-3188`). The panel-width/collapse state
  (`110-160, 232-265`) and overlay toggles (`266-350`) are pure view state and
  would go first. The edit core is the one piece that needs the in-flight
  guard of §2.7 and is where §2.4, §2.5 and §2.8 land.
- **`ops.ts` (2,406 lines: 1,174 comment, 1,084 code)** is not a god module in
  the coupling sense but has five seams: op types and predicates (`42-600`),
  VOB builders (`661-1230`), waynet builders (`789-920`, zero coupling),
  authoring (`1232-1866`, ~630 lines, still changing weekly), and
  commit/invert/project (`1961-2406`). Drifted duplication: `duplicateVobs`
  (`:1437`) and `scatterVobs` (`:1657`) share a tail; `duplicateVobSubtree`
  (`:1513`) and `posedSubtree` (`:1724`) are the same walk; the stand-up
  logic exists twice (§2.9). Both subtree walks scan `for (child < reader.count)`
  per node — ~46M comparisons for a 2,000-node subtree on NewWorld — while
  `buildVobTree` answers children in O(1) via CSR; `vobAtIndexPath` is
  likewise O(count × depth). `vobTree.ts` says it does *not* assume parents
  precede children; `subtreeEnd` (`:1868`) and both walks do — correct today
  (`normalize.cc:1139-1159` guarantees pre-order) but two contracts for one
  column. Two docblocks sit on the wrong function (`:543-556` above
  `isWaynetOp`, `:604-612` above `vobAtIndexPath`).
- **`binding.cc` (3,388 lines)** is one anonymous namespace holding seven
  concerns; the `SetVobClassProp` switch alone is ~1,000 lines in which the
  eleven `oCMOB` fields are copied five times and the twelve `VTrigger` fields
  four (`:2000-2600`), and nothing checks the copies against each other —
  the drift `RequireClassKeys` exists to prevent. A split along the seams
  `assets.cc` already shows (`world_io.cc`, `args.hh`, `vob_mutate.cc`,
  `vob_author.cc`, `vob_class_props.cc` with `Write*Base` helpers,
  `waynet_mutate.cc`, `module.cc`) is mechanical and removes ~250 lines.
- **Dead code**: `zenkit.worker.ts:342-354` `close()` and the `'close'`
  member of `WorldWorkerOp` (the service terminates instead);
  `resolveFolderMembers` (`vobFolders.ts:86`, reimplemented inline in
  `WorldFolderTree.tsx:30-38`); `copiedClassProps`' `field !== null` check
  (`ops.ts:1360`); `tileActions`' `onUnfile: undefined` overridden anyway
  (`WorldAssetCatalogView.tsx:992-999`).
- **Renderer duplication of `zen-world`**: `readClassProps`' subtree walk
  (`WorldSurface.tsx:1494`) rescans all VOBs per node while `vobModelOf`'s
  tree is cached; `freePointsOf`/`findFreePointVob` (`worldStore.ts:194, 219`)
  hand-roll what `matchVobs({classes})` provides; `labelOf` (`:1267`) restates
  the tree's `name || visual` fallback with a third rung.
- **Stale comments on security-relevant code**: `ipcValidation.ts:182-186`
  says the caller path-validates every `assetSources` entry; `world:open`
  ignores request-supplied sources and derives them main-side (`main.ts:874`).
  `WorldService.ts:420-432`'s model of `terminate()` is wrong (§2.10). The
  whitelist grant granularity differs by handler — file for scripts,
  directory for worlds, and `world:listWorlds` grants as a side effect of a
  read — which is how §2.1 arose. `setupIpcHandlers`' inline growth is already
  `refactoring-targets.md` §12.
- **Contract drift, checked and clean**: `PROP_KEYS` vs `VobProps` (19),
  `AUTHORABLE_VOB_CLASSES` vs `NewVob.class` (27), `setVobClassProp` key
  lists, `PortalPolygons` buffer types, every enum written via `OptionalEnum`
  is `uint32_t`-backed, all `zCVob` members have initializers. `vfsRead`,
  `worldStats`, `vobNames`, `zenkitAbi` are exported but undeclared in
  `index.d.ts`; `vfsRead` is used by scripts and would reasonably be declared.
- **`ReparentVob` has its validator branch now** (`ipcValidation.ts:678-681`);
  every `WorldOp` member has one and no legitimate renderer op is refused.

## 5. UI/UX

Screenshots from the real app (fixture world, 1600×1000 and 1100×750) are in
the session, not the repo; what they showed is stated as such.

### 5.1 The silent-feedback cluster — the one theme

1. **Local refusals in the property grid are silent.**
   `WorldPropertyGrid.tsx:294-297, 389, 438` — a parse failure or an
   out-of-range value only bumps `refusals`, which remounts the field to the
   old value: no helper text, no error colour. Type `2.5` into an int field
   or `abc` into X, press Enter, and it snaps back with no explanation. Only
   main-process refusals reach the `editError` banner. Fix: a
   `refusedMessage` in `ClassField`/`CoordinateField`/`AngleField` passed as
   `helper` with `error` — "Whole number required", "Outside 0–255".
2. **Navigation modes and shortcuts are invisible.** F3 walk, right-drag fly
   with WASD/QE, Ctrl+1..4 / Ctrl+Shift+1..4 camera slots, `.`/Home framing,
   arrow/PageUp nudge and Ctrl+C/V are bound (`WorldSurface.tsx:2142-2238`,
   `WorldViewport.tsx:1495-1535`) and no on-screen text names any of them;
   the toolbar tooltips name W/E/Del/Ctrl+Z/Y only. §16.27 item 3 diagnosed
   the slot silence and it is still unaddressed. Fix: a `?` button in the file
   group opening a static legend, plus a transient message on slot
   store/recall — which wants the status line of item 4.
3. **No dirty indicator anywhere, and no Ctrl+S.** `unsavedEdits`
   (`WorldSurface.tsx:914`) is read only to block the quick test (`:950`); the
   Save button, the stats chips and the window carry no edited marker.
4. **Banners never dismiss and can lie.** "Saved to X" (`:2338-2340`) stands
   until the *next* save starts, across later edits while `unsavedEdits` is
   true; `editError` (`:2331`, which also carries the texture-decode failure)
   clears only on the next successful edit; none of the four Alerts has
   `onClose`. Seen in the app: the texture banner takes a full row for the
   session. Fix: one status row under the toolbar with `onClose`, `savedTo`
   cleared inside `applied`, "edited" shown from `unsavedEdits` beside Save,
   Ctrl+S bound to `setConfirmingSave(true)`.
5. **Delete with N>1 selected silently does nothing** — the Delete key
   (`WorldSurface.tsx:2183-2190`), the context menu
   (`WorldVobContextMenu.tsx:188`) and the toolbar (`WorldEditControls.tsx`)
   all gate on exactly one VOB, while Duplicate, Copy, Drop and Align take
   the whole selection. The only text is "Delete VOB… (Del)"; the disabled
   state gives no reason, and no plan section records the one-at-a-time
   decision. Smallest fix: a tooltip saying so; the real fix is a per-VOB
   batch, which §15 leaves open.
6. **Camera-slot store/recall gives no feedback** (§16.27 item 3, still open).

### 5.2 Property grid

7. **Coordinate and angle fields are unlabelled and unit-less.**
   `WorldPropertyGrid.tsx:762-780, 797-828` render three bare fields with no
   X/Y/Z or yaw/pitch/roll and no "cm"/"°" — the units live in the file's
   header comment. Confirmed in the screenshot: "Position 0 0 0". Spacer
   shows both. Fix: `label="X"` etc. and "Position (cm)" / "Rotation (°)".
8. **The multi-selection scope note is wrong for position.** `:726` says an
   edit applies to all N VOBs; a typed coordinate becomes a delta
   (`:773-776`) that moves the selection together — only the anchor lands on
   the typed value.
9. **Flag checkboxes on a multi-selection show only the anchor** (`:853`): no
   indeterminate state; a click writes the anchor's inverse to every VOB.
10. **The grid disappears while the Assets tab has a preview**
    (`WorldSurface.tsx:2740-2748`): `panel === 'assets' && selectedAsset`
    wins over the selected VOB, so a viewport pick while browsing keeps
    showing the mesh preview. Smallest fix: clear `selectedAsset` on a
    viewport pick.

### 5.3 Toolbar and layout (seen in the app)

11. **The stats group wraps to a second row at 1600 px.** The toolbar is two
    rows wide open; the chips are the least important group and the first to
    move. At 1100 px the wrap is sensible (edit group and chips share row 2).
12. **The brightness label is truncated to "Brigh…" at every width tested**,
    and the Snap step (`Free`) and Hide (`Nothing`) selects carry no visible
    label — the reader has to know that "Free" is a snap step.
13. **The idle copy is stale**: "Phase 1a is read-only: the world mesh, VOB
    visuals and picking" (`WorldSurface.tsx:2527-2529`) is the first thing a
    new user reads, and the surface edits, places, scatters and quick-tests.
    With no world open the stats group shows three bare "—" chips.
14. **A WebGL context failure takes down the whole app.** Seen directly:
    under `xvfb` without SwiftShader flags, opening a world replaced the
    entire main area (dialog editor, sidebar and all) with the top-level
    `ErrorBoundary` — `WorldViewport.tsx:557` constructs `WebGLRenderer` with
    no guard, and the nearest boundary is `App.tsx:516`. A machine with a
    broken GPU driver or remote desktop gets the same. The World surface
    wants its own boundary that says "WebGL is unavailable" and leaves the
    rest of the app standing.
15. **The scene tree is fully collapsed on open** — a five-VOB fixture shows
    one row. Right for NewWorld; a small world (or the first level of a large
    one) could open expanded.
16. **Terrain point and nudge messages carry no units** ("Terrain @ 50, 0,
    50").

### 5.4 Panels, menus, keyboard, accessibility

17. **Asset browser**: no highlight on the previewed entry and no keyboard
    path (`WorldAssetBrowser.tsx:45-66` `Row` has no selected state, no
    `tabIndex`); tile actions reveal on `:hover` only (`WorldAssetGrid.tsx:
    532, 546`), no `:focus-within`. **Mesh preview has no loading state**
    (`WorldAssetPreview.tsx:730-749`) — and §16.26 notes a large `.MDL`
    re-extracts on every click, so the wait is real.
18. **Folder tree**: rename is double-click on the label only
    (`WorldFolderTree.tsx:161`); delete is a hover-only span with no confirm
    and, by design, no undo (`:170-179`); `role="tree"` with no
    `role="treeitem"` rows (`:110`).
19. **Context menu, tree and grid disagree on the frame verb** — "Frame" vs
    "Jump the camera to this VOB", with "(.)" only in the grid — and the menu
    shows no shortcut hints; Duplicate has no shortcut anywhere.
20. **Viewport Home/`.` fire inside popovers** (`WorldViewport.tsx:1502` skips
    inputs only; the surface's guard also skips listbox/menu/dialog) — Home in
    an open MUI Select frames the world.
21. **Scene-tree labels truncate with no tooltip** (`WorldSceneTree.tsx:
    203-207`, unlike `AssetTile`); rows lack `aria-level`; the empty message
    "No VOB matches this filter." also shows for an empty world (`:682-690`).
22. **Scatter radius/spacing accept NaN** (`WorldEditControls.tsx:718, 731`
    `Number('')`), passed through as the brush radius (`WorldSurface.tsx:
    1643`); the tree's reach field guards the same case.
23. **Waypoint panel fields have placeholder-only labels** (`WaypointPanel.tsx:
    307-319, 388-399`); **`PanelSplitter` is mouse-only** with no
    `role="separator"` (`PanelSplitter.tsx:592-607`).

### 5.5 Component quality

- `vobModel.ts` caches tree and reader per summary in a `WeakMap` — the tree,
  grid and folder tree share one build. Good.
- `WorldSceneTree`, `WorldPropertyGrid`, `WorldFolderTree` and `WorldToolbar`
  are not memoised, so a terrain click or a scatter-field keystroke re-renders
  all of them; per-render costs are O(rows), not O(VOBs), so it is a cost,
  not a defect. `WorldToolbar.tsx` spreads the ~40-prop union into all four
  children, so none can ever be memoised.
- Theme use is consistent except `WorldAssetPreview.tsx:779, 866, 911`
  (`0x2b2b2b`, `rgba(128,128,128,0.4)`).
- The tree's `aria-activedescendant` model is the right one for a virtualised
  list.

## 6. What is not in this document

Everything found clean is not listed — the
passes checked, and confirmed, the 08-29 fixes for the waynet-fetch, stale
waynet, empty-waynet, `stoull`, mesh-bounds and mipmap findings, the
`ReparentVob` validator branch, the op inverses for all ten invertible ops,
the `commitOps` unwind order, the engine Euler formulas, `placeBounds`,
`buildVobTree`'s CSR arithmetic, `sha256.cc`, and every `zCVob` initializer.
