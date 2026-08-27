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

---

## State of the tree

- branch `feature/level-editor`, **ahead of its remote and unpushed.**
  No HEAD hash and no count here — a file committed at HEAD cannot name either,
  and a number goes stale the moment anything lands. `git status -sb` answers it.
- **`zenkit-node/vendor/ZenKit` is permanently dirty** and is **never**
  committed: it is the applied patch series. Stage with
  `git add -A -- . ':!zenkit-node/vendor/ZenKit'`, or name paths explicitly.
  Anything else showing as modified is unfinished work.
- 43 commits ahead of `master`, deliberately unmerged: merging before an engine
  verdict would put an unverified world editor on master.
- **The addon was rebuilt this session and `binding.gyp` changed**, so every
  other machine and CI must rebuild — a stale `.node` predates the exception fix
  below and still aborts the process on a bad world.
- **Nothing else needs rebuilding on this machine.** On another, or after any change
  to `coords`, `binding.cc` or anything `zen-world` exports:
  `cd zenkit-node && node scripts/build-zenkit.js && npx node-gyp rebuild`, then
  `pnpm --filter zen-world build`. `verify-world-edit.js` drives the *built*
  renderer, so it needs the full `pnpm --filter daedalus-dialog-editor build`,
  not `build:main`.

---

## Blocked on Daniel

- **Gate 2 — the engine verdict for a UI-edited world.** The Phase 1b milestone,
  and the one thing here that cannot be automated. Four candidates are staged in
  `%TEMP%\gate2-candidate` (rebuild with
  `node daedalus-dialog-editor/scripts/build-gate2-candidate.js`); `03` carries
  23,291 VOBs including a placed crate, a turned table, a renamed-and-refitted
  VOB and one *retail* VOB raised and turned. Control first, same session,
  fullscreen. **Rows 7, 8 and 9 must actually run this time** — bed/chest/mobsi,
  a sound or zone VOB, a savegame round-trip. They were defensible as ⏸ for a
  bit-identical re-save and are not for an edited world.
- **Deleting an arbitrary VOB — a design choice, not a coding one.** Blocked by
  invertibility, not renumbering: an `oCMobInter` carries per-class properties,
  children, an AI and an event manager that `NewVob` does not describe.
  Snapshot the subtree in the binding (complete, and opens its own fidelity
  question — does a round-tripped VOB come back identical?), or offer delete only
  for VOBs the op model can describe completely (small, honest, invertible
  today — and it refuses most of what a user would click).

## Now

*(empty — the exception fix and `MoveWaypoint` both landed; see Done)*

## Next

- **Waynet editing — the waypoint gizmo, and the edge ops.** `MoveWaypoint`
  itself is done (see Done below); what is left is the UI that produces one and
  the ops that renumber. The gizmo is a bigger change than the op was:
  `WorldViewport` couples the gizmo to VOBs throughout (`gizmoVobs`,
  `world.anchorOf`, `world.moveVob`), picking a waypoint needs a `THREE.Points`
  raycast with a pixel threshold, and the selection model is `number[]` of VOB
  indices only. `verify-world-edit.js`'s waynet assertion is already
  differential and already has an `expectedWaypointMoves` constant sitting at 0
  — that is the one number the gizmo slice changes.
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
- **A malformed BinSafe world hangs the reader** — found in passing, unrelated to
  A1–A5. `loadWorld` on a BinSafe file with ~500 corrupted bytes neither crashes
  nor throws; it spun to 202 s CPU with growing RSS before being killed. An
  unbounded length read. It will hang the editor's `zenkit.worker` the same way
  the abort used to kill it. Not yet reproduced into a test.
- `.MMB` authoring has no ZenKit writer at all.
- macOS CI — **dropped from scope, 2026-08-27** (Daniel). Not a gap to close.

## Done — Phase 1b

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
