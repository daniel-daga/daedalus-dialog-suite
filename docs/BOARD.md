# Board

The one file to read at the start of a session, and the one to update at the end.
It holds **only what nothing else holds**: what is in flight, who owns it, and
the state of the tree.

Everything else already has a home, and repeating it here is what made the old
handovers cost an hour a session:

| Looking for | It is in |
|---|---|
| what landed, and why | `git log` — the commit messages carry the reasoning |
| a decision or a measurement | `docs/plans/level-editor.md` §7 |
| build and test commands | `CLAUDE.md`, and each workspace's `README.md` |
| machine and toolchain hazards | `docs/reference/environment-hazards.md` |
| a known wart nobody is fixing yet | `docs/refactoring-targets.md` |
| the Gate 2 checklist | `zenkit-node/docs/engine-acceptance-2026-08-25.md` §8 |

**Rules.** A card is one line and an owner. A card moves to Done only when its
tests and its linter pass. Done is emptied at the end of a phase, because
`git log` is the permanent record — this file is a working surface, not an
archive.

**Always commit at the end of a session.** Never leave finished work sitting in
the working tree: this file points at `git log` for what landed and why, and
uncommitted work is invisible to it. Commit the board update in the same
session, and split unrelated work into separate commits. Stage with
`git add -A -- . ':!zenkit-node/vendor/ZenKit'` — the submodule is the applied
patch series and is never committed.

**Anything said about future work is written down before the session ends.**
Every caveat, every "worth remembering next time", every open question, every
defect noticed and not fixed — if it would change what somebody does next, it
goes in a file, not in a chat reply. A finding that exists only in a
conversation is lost the moment the conversation is, and the next session pays
to rediscover it. Route it by the table above: a fact about the code goes to the
plan, a fact about this machine to `environment-hazards.md`, a card to Next or
Blocked here. Say where it went, so the routing can be corrected.

**A doc that has gone stale is a defect.** When work invalidates something a
file asserts, fix it in the same change — including comments that record a
constraint the work has just removed. The claim to check hardest is the one that
was true for so long nobody re-reads it.

---

## State of the tree

- branch `feature/level-editor`, **in sync with its remote.**
  No HEAD hash and no count here — a file committed at HEAD cannot name either,
  and a number goes stale the moment anything lands. `git status -sb` answers it.
- **`zenkit-node/vendor/ZenKit` is permanently dirty** and is **never**
  committed: it is the applied patch series. Stage with
  `git add -A -- . ':!zenkit-node/vendor/ZenKit'`, or name paths explicitly.
  Anything else showing as modified is unfinished work.
- **Merged to `master` 2026-08-28.** The "deliberately unmerged until an engine
  verdict" rule is retired — Gate 2 passed (Done) and the merge was a clean
  fast-forward, so backing it out is a `git reset --hard` to the merge's first
  parent. Merging is not releasing: `build-windows.yml` is `workflow_dispatch:`
  and nothing else, so a push to master builds no installer, cuts no release and
  touches no update feed. Anything about shipping is the dispatch's decision,
  not this one — and the two gaps below have to close before that dispatch.
- **The addon was rebuilt this session**, so every other machine and CI must
  rebuild: `binding.cc` and `normalize.cc`/`.hh` gained `getVobProps` and
  `setVobClassProp`. A stale `.node` is worse than useless here — the editor's
  Jest suites fake the worker, so they stay green against a binary that has
  neither export while the running app has no class properties at all. It also
  predates the exception fix below and still aborts the process on a bad world.
- **`zen-world` and the editor's whole `dist/` were rebuilt this session** —
  `SetVobClassProp` and the `CLASS_FIELDS` catalogue are in both, and the editor
  typechecks and tests against `zen-world/dist`, not its source, so `build:main`
  fails outright until `pnpm --filter zen-world build` has run.
- **Nothing else needs rebuilding on this machine.** On another, or after any change
  to `coords`, `binding.cc` or anything `zen-world` exports:
  `cd zenkit-node && node scripts/build-zenkit.js && npx node-gyp rebuild`, then
  `pnpm --filter zen-world build`. `verify-world-edit.js` drives the *built*
  renderer, so it needs the full `pnpm --filter daedalus-dialog-editor build`,
  not `build:main`.

---

## Now

*(empty — the waypoint gizmo landed; see Done)*

## Next

- **A world request that times out leaks the worker, and every retry feeds it.**
  Found in the merge-readiness pass, 2026-08-28, and the one code defect that
  argued against merging. `WorldService.request` (`:314-318`) rejects at 120 s
  and never calls `terminate()`; `openWorld`'s `if (this.worker === null)` guard
  (`:83`) then posts the retry to the still-spinning thread, so the surface never
  recovers. It pairs with the malformed-BinSafe hang below — that is the bug that
  produces the timeout in the first place — and the two together mean one bad
  `.zen` can take the process down with unsaved *dialog* work in it. Terminate
  and null the worker on `world-timeout`.
- **Two gaps that block the next `build-windows` dispatch, not the merge.**
  Recorded 2026-08-28 so the dispatch is not the place they are discovered:
  - **A dispatched build would ship a World button with no addon behind it.**
    `zenkit-node/scripts/install.js:22-25` skips the source build whenever `CI`
    is set unless `ZENKIT_NODE_FORCE_BUILD=1`, which only `zenkit-node.yml:72`
    sets; `package.json` has `npmRebuild: false` and no `asarUnpack` for
    `*.node`. Needs the addon built or prebuilt in the release job, the
    `asarUnpack` entry, and an asar assertion for `zenkit_node.node` — the
    existing verifier only checks `safe-buffer`, and the startup smoke never
    opens a world.
  - **The addon is not in the release gate.** `build-windows.yml` gates on
    `all-tests.yml`, which has no zenkit-node job. `zenkit-node.yml` is its own
    workflow, path-filtered to `zenkit-node/**` and triggered on push/PR to
    master — so it ran on the phase-1a PR and then on nothing until the merge
    push, which is the first CI this branch's later commits ever saw, including
    `binding.gyp`'s `_HAS_EXCEPTIONS` fix — exactly the MSVC-define class whose
    behaviour is toolchain-dependent. It has `workflow_dispatch`, which is the
    cheap way to get that evidence before a push rather than from one.
    Also: `zen-world/dist` is built by an undeclared `postinstall` hook
    (`zen-world/package.json:24`) and `zen-world` is not in
    `pnpm-workspace.yaml`'s `onlyBuiltDependencies`, so a single
    `--ignore-scripts` takes out four jobs at once.
- **Three shipped ops have no engine verdict.** `DeleteVob`, `MoveWaypoint` and
  `SetVobClassProp` all landed after candidate `03` was built, so Gate 2 covers
  the ops that existed on 2026-08-27 and not these — the acceptance record says
  so itself at `engine-acceptance-2026-08-25.md:851-854`. Say "Gate 2 passed for
  the ops it tested", not "Gate 2 passed". A removed subtree is still the edit
  ZenGin has the most room to disagree about, and `SetVobClassProp` writes
  `oCItem.instance` as free text against a documented engine-crash path
  (`level-editor.md` §14.1) — validating it against the parser's item index is
  the obvious follow-up and is not scheduled.
- **Phase 1b-2, class-aware editing — the rest of it.** Increment 1 landed (see
  Done), so the path exists and each further class is one C++ case plus one
  `CLASS_FIELDS` entry plus its tests. What is left, in the order the plan §7
  entry argues for: the remaining classes (sound, the trigger family, `oCMob*`,
  the zones, `zCPFXController`, `zCVobAnimate`), and then the four things held
  out by decision rather than by time — `isStatic` and anything else that
  changes *which* fields the archive contains, enums (retail carries
  out-of-range values a dropdown destroys), list fields (first unbounded
  payloads in the op set), and base-`zCVob` widening (§14.1 item 1.8). Alongside
  them and independent: class-specific *insertion* (item 1.3 — `insertItemVob`
  is in the binding and wired to nothing), numeric transform entry (1.5),
  copy/paste (1.2), snapping (1.6). Still scheduled before Phase 1c in §11.
- **Waynet editing — the edge ops, and add/delete/rename.** The gizmo landed
  (see Done), so the one op that exists is now reachable; nothing below is.
  **The addressing problem is the whole job and it is untouched.**
  `MoveWaypoint` addresses a waypoint by its index into the list `getWaynet`
  emits, and that is safe only because a move inserts, deletes and reorders
  nothing. Every op left here breaks it, and names cannot be the fix — nothing
  in the format promises they are unique, which is why the binding matches edge
  endpoints by pointer identity.
  The edge ops keep their original hazard: `free_point` is not a stored field,
  and `WayNet::save` writes only free points plus edge endpoints, so a non-free
  waypoint in no edge is dropped at save. Removing a waypoint's last edge
  therefore deletes the waypoint, which is why an edge op is not invertible as an
  edge op. Waypoint delete has a bounded version of the arbitrary-VOB-delete
  trap — a `WayPoint` is five scalar fields, so what an op cannot describe for
  free is its edge memberships, and those are an enumerable list.
- **The ASCII writer's four named defects** (A1–A4, `zenkit-node/docs/engine-acceptance-2026-08-25.md`
  §10.2). Unblocked this session — the abort that made them unobservable is
  fixed (Done) — but still a debugging job before it is a patch job.
  They chain: A3's path is unreachable until A2 is fixed, and A3 writes corrupt
  hex until A1 is. Verified in code this session:
  - **A2 is dead code with no reachable switch.** `VirtualObject.cc:12` has
    `static bool pack = true;`, `:336` `enable_packed_save` is the only writer of
    it, and grep over `src/`, `include/` and `zenkit-node/src/` finds **no caller
    at all** — so `:269`'s unpacked branch, which contains A3's only call site
    (`:272 write_mat3x3("trafoOSToWSRot")`), can never execute.
  - **A2's re-enabled path has a second, undocumented duplicate-entry bug**:
    `VirtualObject.cc:270-275` and `:297-307` both write
    `presetName`/`vobName`/`visual`, and the two `visual` writes are not even the
    same value (`visual_name` vs `visual->name`). ASCII entries are read
    positionally, so the extras are pure stream desync.
  - **A1 is `ArchiveAscii.cc:376-387`**: `std::to_chars` never null-terminates
    and `buf[1]` is only `'\0'` before the first write, so every byte < 0x10 gets
    the previous byte's low nibble. Any A3 fix routing through the `raw:` encoder
    lands in that function.
  - **A4 is `ArchiveAscii.cc:453-455`**: an 11-wide `objects` field where
    ZenGin's is 9-wide. Independent of the other three.
  **The harness still cannot fail on ASCII, and that is the first thing to fix.**
  `lib/container.js:206` (not 205) returns `covered:false` for anything not
  BinSafe before `walk()` is ever entered; `tools/bytediff.js:11` is BinSafe by
  construction and there is no ASCII walker (`lib/container-ascii.js` does not
  exist); and `test/roundtrip.test.js:132-142` is the only ASCII test, asserts
  `['crashed','unreadable','ok']` — the whole outcome space — and does not pass
  `--strict`, even though `crashed` is already in `zen-roundtrip.js:38`'s
  `BLOCKING` set. A full fix of A1–A4 would leave the suite green and unchanged.
  So the harness owes three things before any defect fix is provable: a
  `lib/container-ascii.js` walker so `containerFromBuffer` stops answering
  `covered:false` for the very format under test; a `tools/bytediff.js` that is
  not wired to `walk()`'s BinSafe assumptions; and `roundtrip.test.js`'s
  three-way `assert.ok` replaced by an exact expected status plus a `--strict`
  run. Fix order after that is A1 (its assertion is a pure string check on the
  emitted file and needs no reload), then A2, then A2b, then A3; A4 is
  independent and can ride along any time.
- **A malformed BinSafe world hangs the reader** — found in passing, and separate
  from both the ASCII defects and the exception fix.
  `loadWorld` on a BinSafe file with ~500 corrupted bytes neither crashes
  nor throws; it spun to 202 s CPU with growing RSS before being killed. An
  unbounded length read. It will hang the editor's `zenkit.worker` the same way
  the abort used to kill it. Not yet reproduced into a test.
- `.MMB` authoring has no ZenKit writer at all.
- macOS CI — **dropped from scope, 2026-08-27** (Daniel). Not a gap to close.
- **Gate 2 covered no deleted VOB and no moved waypoint** — both landed after
  the staged candidate was built (2026-08-27 run, Done). A removed subtree and
  a moved waypoint are still the two edits with no engine verdict of their own;
  whether that's worth a rebuilt candidate is Daniel's call, not something to
  do unasked.

The seven cards below come from Daniel's first hands-on pass, 2026-08-27. The
note they were written against has since been deleted, so **these cards are now
the record** — nothing else holds the complaints, which is why each one states
the complaint before its diagnosis. The diagnoses are code-read and every
file:line in them was re-verified 2026-08-28.

- **The viewport pivot — one defect behind four of the complaints.** Rotation
  too fast, movement clunky, zoom unusable close to a mesh, panning too slow
  when zoomed in, interiors unreachable because "the camera always rotates
  around the origin". Not four bugs. `WorldViewport.tsx:252` sets
  `controls.target` to the world bbox centre and only `frameOn` ever moves it —
  and OrbitControls scales *both* dolly step and pan speed by the camera-to-
  target distance. With the pivot 600 m away at the middle of the island, every
  one of those three feels wrong at once, and orbiting swings the camera through
  the terrain instead of around what is being looked at. `frameOn` already does
  the right thing and is already bound (`.` frames the selection, `Home` frames
  the world, `WorldViewport.tsx:619-620`) — so the work is a pivot the user can
  *set*, Blender's way: a middle-drag orbits about the last picked point, not
  about the island. Rotation speed is the one genuinely separate knob —
  `rotateSpeed` is left at OrbitControls' default 1.0 and nothing here has ever
  tuned it.
- **A structural edit re-decodes every texture in the world.** Placing a VOB or
  reparenting one is visibly a cold open. Cause is known and single:
  `applied` in `WorldSurface.tsx:294` calls `setVisuals(...)` after any
  structural op, the new payload identity retriggers the scene-build effect at
  `WorldViewport.tsx:817`, and that effect walks `world.pendingTextureNames()`
  from empty — 490 textures for NewWorld, the 549 ms the file header at :37 says
  was deliberately moved off the critical path. The rebuild itself is not the
  defect and the comment at `WorldSurface.tsx:250-256` argues correctly for it:
  an instance cannot be appended to an allocated `InstancedMesh`. The textures
  are the defect — they did not change, and nothing caches a decoded one across
  a rebuild. The camera reframe rides on the same effect and is felt as part of
  the same jolt.
- **The world open dialog ignores the Gothic install we already found.**
  `main.ts:583` passes no `defaultPath`, so the picker opens wherever Electron
  last was, while `settingsService.getGothicInstallPath()` is right there and
  `world:selectGothicInstall` at :599 is what wrote it. Smallest card on this
  list.
- **A VOB is hard to tell from the world mesh.** Asked for as a faint outline on
  VOB visuals. Nothing about the current pipeline resists it — the VOBs are
  their own `InstancedMesh` set, so the selection highlight already has a place
  to hang.
- **Interiors are too dark, and shadows are not coming.** Both answered by
  `WorldScene.ts:347-353`: the material is `MeshBasicMaterial`, ZenGin's
  lighting is baked into the vertex colours, and there is nothing dynamic to
  relight or to cast with. So "add lights" is the wrong fix and dynamic shadows
  are a no. What is right, and what this card is, is a viewport-only exposure
  lift on those baked colours — a brightness control that changes what is on
  screen and nothing about the world. Worth saying before it is asked again:
  the `zCVobLight`s in the file are data Phase 1b-2 makes *editable*, not a rig
  the viewport can switch on.
- **The bottom bar appears and shoves the layout, and the point it names is
  invisible.** `WorldSurface.tsx:843` mounts the terrain-point `Paper`
  conditionally, so the viewport resizes the moment a terrain pick lands. Two
  fixes in one card: keep the bar mounted and let it carry something when there
  is no point, and draw a marker in the viewport at the picked point — right now
  "Place VOB here…" names coordinates the user cannot see.
- **No way to navigate to a VOB from the scene tree.** Double-click a row and/or
  a locator icon in the sidebar, jumping the camera to it and leaving the pivot
  on it. `frameOn` is the whole mechanism and it exists; this is the affordance
  and the pivot card's payoff, so it lands after that one.

## Done — Phase 1b

- **Class properties, increment 1 — the item instance and the light.**
  `oCItem.instance` and `zCVobLight`'s `range`/`color`, 23.4 % of the 41,393
  retail VOBs, all the way down: `getVobProps` exporting the reader
  `normalizeWorld` already had, `setVobClassProp` in the binding, the
  `SetVobClassProp` op, the
  `CLASS_FIELDS` catalogue the builder/validator/grid all read, the
  `world:vobProps` IPC, and the grid's class section. The validator branch
  landed **in the same change** as the op, which is the whole lesson
  `ReparentVob` left. Decisions and what is deliberately out are in plan §7;
  §14.1 row 1.4 is now *partial*. Two things noted and not fixed: the class
  re-fetch is unconditional, so a gizmo drag on a light flashes the section's
  loading line, and **no engine verdict covers a class-edited world** —
  `verify-world-edit.js` does not yet set an instance or a range on NewWorld,
  which is Gate 2's business and plan §14.1's follow-up, not a landing gate.
- **Gate 2 — the engine verdict for a UI-edited world.** Four candidates run
  through both Spacer2 and Gothic2 (`zenkit-node/docs/engine-acceptance-2026-08-25.md`
  §8, 2026-08-27 run): all clean loads, no captured assertion, `03-ui-edited.zen`
  (built through the real editor UI) the headline result — the first engine run
  of a world the app itself edited, carrying `MoveVob`/`RotateVob`/`SetVobProp`/
  `AddVob`/`ReparentVob` and a retail VOB's re-fitted bounding box. Rows 7–9
  (bed/chest/mobsi, sound/zone trigger, savegame round-trip) recorded passed on
  Daniel's word; the record notes the wall-clock doesn't independently
  corroborate the depth of that exercise, so revisit there first if either op
  set is later found to disagree with the engine.
- **The waypoint gizmo — the UI for an op that had none.** Picking a waypoint
  out of the overlay, the gizmo on it, the drag, the live preview, the commit,
  undo/redo, and `expectedWaypointMoves` in `verify-world-edit.js` moved from 0
  to 1. Driven end to end against NewWorld: one waypoint differs in the saved
  file, `TOT`, position only, and the edges are unchanged.
  Four things the shape of the waynet decided rather than the gizmo:
  **one gizmo means one selection** — `selectedWaypoint` is never held beside
  `selection`, because the mode keys, the property grid and the Delete VOB
  button all follow the latter; **the pick is a projection, not a raycast** —
  `THREE.Points.raycast`'s threshold is world units and the overlay is
  `sizeAttenuation: false`, so `pickWaypoint` projects all 2,959 and measures
  in pixels, which is affordable once per click and would not be per frame;
  **the waynet is picked before the VOBs**, because `depthTest: false` means a
  dot plainly on top would otherwise select the wall behind it; and **the
  preview destroys the `from` the op needs** — every other op reads `from` out
  of the columnar index, which the preview never writes, but the point cloud
  and the edges share one array, so the viewport carries `from` up from the
  press and the shell writes it back before calling `moveWaypoint`.
  `applyWaypointPositions` is no longer dead: it is called once, in `applied`,
  which is the same path undo and redo take.
  One wart found and fixed in passing: hiding the overlay left the gizmo
  standing — and draggable — on a waypoint nothing was drawing.
- **`DeleteVob` — the first op that ships without an inverse.** The op, the
  validator branch, the history barrier in `WorldService.applyOps` (both stacks,
  after the worker confirms), the confirm dialog that says the undo history goes
  with it, and end-to-end coverage in `verify-world-pipeline.js` against
  NewWorld — the last root took its whole 4,460-VOB subtree with it and the
  history came back empty. Not an `AddVob` with a null `to`: that shape means
  "the op describes this VOB completely", and reusing it would have made the
  undo of a deleted `oCMobInter` look like it worked. Written up as the plan's
  "The delete, and the barrier that replaces its inverse". A third dispatch
  nobody had listed turned up in the World surface — `commitOps`' catch inverts
  the batch to put the viewport's optimistic draw back, and threw on a refused
  delete.
- `MoveVob`, `RotateVob`, `SetVobProp` — gizmos, multi-select, property grid.
- `AddVob` — terrain placement, at the roots or under the selected VOB.
- `ReparentVob` — drag onto a row, or between rows at a chosen slot.
- Dirty-world save; undo/redo across all of it.
- `colorAniList` — the byte-diff's last differing field is closed. The asymmetry
  was ZenKit's; `patches/0023` emits an `r == g == b` element as the greyscale
  scalar ZenGin writes. The fixture had no light at all, so it gained one.
- The patch series is triaged for upstreaming — `zenkit-node/patches/README.md`.
  15 as-is, 7 needing a rationale and a fixture, `0017` ours forever, and the
  three places where the numbering hides an ordering dependency.
- `scripts/verify-world-render.js` — the screenshot, promoted to a driver that
  fails on its own when the winding fix is reverted.
- **The addon caught no ZenKit exception at all** — `binding.gyp` inherited
  node-gyp's `_HAS_EXCEPTIONS=0`, under which MSVC aliases `std::exception` to
  `stdext::exception` and never declares the real one, so all ~20
  `catch (std::exception const&)` in `binding.cc` named a type no ZenKit
  exception derives from and there is no `catch (...)` anywhere. A `ParserError`
  found no handler, `std::terminate` → `__fastfail` → **0xC0000409 on any
  malformed or truncated world**, taking the editor's `zenkit.worker` with it.
  Proved with two probe executables differing only in that define, then fixed
  with `defines!` and a `_HAS_EXCEPTIONS=1`. It also silently changed the base
  class of `zenkit::Error` inside the binding's TUs — an ODR violation on top of
  the missed catch. Pinned by `test/loadWorld.test.js`, which is the only test
  here that makes **ZenKit** throw rather than the binding.
- **`MoveWaypoint` — the first op that is not about a VOB.** Binding
  (`setWaypointPosition`, with `CollectWaypoints` as the single definition of
  what a waypoint index means), the op and its inverse, the validator branch, the
  worker and store partitions, and end-to-end coverage in
  `verify-world-pipeline.js` batched with a VOB move. No UI: the waypoint gizmo
  is its own slice (Next).
  Three things the design brief got wrong and the code settled:
  **the dispatch tails were three, not one** (`applyOps`, `writeOp`, `invertOp`
  — `invertOp`'s was accidentally *correct* for a waypoint move, the most
  dangerous of the three), they now end in a `never` refusal; **`applyOps`'
  trailing `else` did not write `positions[NaN]`** — a `Float32Array` drops a
  write at a NaN index, so nothing moved and the caller was told a VOB had; and
  **the mandatory layer was three layers**, because `zenkit.worker.ts` and
  `worldStore.ts` both routed a non-structural op into `applyOps`, where the
  refusal would land *after* `commitOps` had already changed the world.
