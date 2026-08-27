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

---

## State of the tree

- branch `feature/level-editor`, **3 commits ahead of its remote and unpushed.**
  No HEAD hash here — a file committed at HEAD cannot name it; `git log -1` can.
- **`zenkit-node/vendor/ZenKit` is permanently dirty** and is **never**
  committed: it is the applied patch series. Stage with
  `git add -A -- . ':!zenkit-node/vendor/ZenKit'`, or name paths explicitly.
  Anything else showing as modified is unfinished work.
- 43 commits ahead of `master`, deliberately unmerged: merging before an engine
  verdict would put an unverified world editor on master.
- **Nothing needs rebuilding on this machine.** On another, or after any change
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

*(empty — Phase 1b's automatable work is done)*

## Next

- **Waynet editing — designed, nothing built.** The dominant hazard is not
  renumbering: `free_point` is not a stored field, and `WayNet::save` writes only
  free points plus edge endpoints, so a non-free waypoint in no edge is dropped
  at save. Removing a waypoint's last edge therefore deletes the waypoint, which
  is why an edge op is not invertible as an edge op. Waypoint delete has a
  bounded version of the arbitrary-VOB-delete trap — a `WayPoint` is five scalar
  fields, so what an op cannot describe for free is its edge memberships, and
  those are an enumerable list. Recommended first slice is `MoveWaypoint` alone;
  its mandatory layer is `assertApplyOpsRequest`, with the branch placed **before**
  the `op.vob` check, because a waynet op has no `vob`. `applyOps` ends in an
  `else` that would write `positions[NaN]` silently — that dispatch has to become
  exhaustive in the same change. Note the first waynet op retires the "mesh, BSP
  and waynet identical" claim, so `verify-world-edit.js` needs a waynet-aware
  assertion built before it, not after.
- **The ASCII writer's four named defects** (A1–A4, `zenkit-node/docs/engine-acceptance-2026-08-25.md`
  §10.2). This is a debugging job before it is a patch job, and it is bigger than
  the card implied. They chain — A3's path is unreachable until A2 is fixed, and
  A3 writes corrupt hex until A1 is — and A2's re-enabled path has a second,
  undocumented duplicate-entry bug (`VirtualObject.cc:270-275` and `:297-307` both
  write `presetName`/`vobName`/`visual`). **None of the four is provable by any
  existing test**: `lib/container.js:205` returns `covered:false` for anything not
  BinSafe, `tools/bytediff.js` is BinSafe by construction, and the one ASCII test
  accepts `['crashed','unreadable','ok']`. A full fix would leave the suite green
  and unchanged. First step is the `0xC0000409` abort, which no document
  attributes to any of A1–A4; the checked-in repro is
  `zenkit._authorFixtureWorld(path, 'ascii', 'g2')`. Then `lib/container-ascii.js`.
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
