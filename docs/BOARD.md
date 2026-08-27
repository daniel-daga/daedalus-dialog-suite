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

- branch `feature/level-editor`, in sync with its remote. No HEAD hash here —
  a file committed at HEAD cannot name it; `git log -1` can.
- **`zenkit-node/vendor/ZenKit` is permanently dirty** and is **never**
  committed: it is the applied patch series. Stage with
  `git add -A -- . ':!zenkit-node/vendor/ZenKit'`, or name paths explicitly.
  Anything else showing as modified is unfinished work.
- ~40 commits ahead of `master`, deliberately unmerged: merging before an engine
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

- Waynet editing — no op touches it yet.
- macOS CI is absent; the Phase 0 exit criterion it belongs to is still open.
- 22 ZenKit patches unupstreamed.
- The ASCII writer's four named defects.
- `colorAniList` — the only field the byte-diff still reports as differing.
- `.MMB` authoring has no ZenKit writer at all.
- Promote the throwaway Playwright screenshot driver to `scripts/`. The winding
  defect was visible the instant anyone looked and survived a full green suite;
  the screenshot is a test.

## Done — Phase 1b

- `MoveVob`, `RotateVob`, `SetVobProp` — gizmos, multi-select, property grid.
- `AddVob` — terrain placement, at the roots or under the selected VOB.
- `ReparentVob` — drag onto a row, or between rows at a chosen slot.
- Dirty-world save; undo/redo across all of it.
