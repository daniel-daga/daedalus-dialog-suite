# Board

The one file to read at the start of a session, and the one to update at the end.
It holds **only what nothing else holds**: what is in flight, who owns it, and
the state of the tree.

Everything else already has a home, and repeating it here is what made the old
handovers cost an hour a session:

| Looking for | It is in |
|---|---|
| what landed, and why | `git log` — the commit messages carry the reasoning |
| **the long form of an open card** | `docs/plans/level-editor.md` **§16** |
| a decision or a measurement | `docs/plans/level-editor.md` §7 |
| build and test commands | `CLAUDE.md`, and each workspace's `README.md` |
| machine and toolchain hazards | `docs/reference/environment-hazards.md` |
| a known wart nobody is fixing yet | `docs/refactoring-targets.md` |
| the Gate 2 checklist | `zenkit-node/docs/engine-acceptance-2026-08-25.md` §8 |

**Rules.** A card is one line, an owner, and a pointer to where its long form
lives — §16 for a level-editor card, otherwise the file the routing table names.
A card moves to Done only when its tests and its linter pass.

**Next is ordered by priority and cards are picked top-down.** An unattended run
takes the first card it is allowed to take, so the order is the priority, not a
filing convention — and a run may not reorder it, add to it, or file its own
splits into it. **Deferred** and **Triage** sit outside the pick path: Deferred
is work a human deprioritised, Triage is where a run reports a card too big for
one entry. Both are read and emptied by a person, never by a run.

**The card sections — Now, Next and Done together — stay under 80 lines, and
going over is the signal to flush.** Deferred and Triage are counted separately
and deliberately: deprioritised work has to stay visible to stay a decision
rather than a silent drop, and flushing it would be the drop. The budget is on the cards because the
rules above them do not grow and the cards do. Not a style preference: this file
is read at the start of every session, and a board nobody re-reads is a handover
again. The fix is never to compress a card's prose — it is to move that prose to
its home and leave the pointer.

**Done is emptied whenever it has served its purpose, not only at a phase
boundary.** It exists so one session sees what the last one landed; `git log` is
the permanent record, so a Done card whose substance is in its commit message is
pure duplication. Before emptying, check each card for a *forward* fact — a
caveat, an unowned defect, a "a third one of these should…" — and route it by
the table above. Everything else goes. (Phase 1b's 36 cards were flushed this
way on 2026-08-28, from a file that had reached 1004 lines with 563 in Done.)

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
plan, a fact about this machine to `environment-hazards.md`, a card to Next
here. Say where it went, so the routing can be corrected.

**A doc that has gone stale is a defect.** When work invalidates something a
file asserts, fix it in the same change — including comments that record a
constraint the work has just removed. The claim to check hardest is the one that
was true for so long nobody re-reads it.

---

## State of the tree

- `master` is where work lands and is **pushed to `origin/master`**;
  `feature/level-editor` was merged and is no longer where work happens.
  `board-loop-3` was fast-forwarded into master on 2026-08-28 (35 commits) and
  is **spent** — as `board-loop` was before it. The next unattended loop takes a
  fresh branch. **Local master is ahead of `origin/master`** — the push in the
  first clause is the intent, not the current state. A push is not a release —
  see the merge note below.
  No HEAD hash and no count here — a file committed at HEAD cannot name either,
  and a number goes stale the moment anything lands. `git status -sb` answers it.
- **`zenkit-node/vendor/ZenKit` is permanently dirty** and is **never**
  committed: it is the applied patch series. Stage with
  `git add -A -- . ':!zenkit-node/vendor/ZenKit'`, or name paths explicitly.
  Anything else showing is unfinished work — `reports/` used to be the one
  exception and the root `.gitignore` now catches it.
- **Merged to `master` 2026-08-28.** The "deliberately unmerged until an engine
  verdict" rule is retired — Gate 2 passed for the ops it tested (§16.2) and the
  merge was a clean fast-forward, so backing it out is a `git reset --hard` to
  the merge's first parent. Merging is not releasing: `build-windows.yml` is
  `workflow_dispatch:` and nothing else, so a push to master builds no
  installer, cuts no release and touches no update feed. Anything about shipping is the dispatch's decision,
  not this one. The release-gate gaps that used to be named here are **all
  closed** — the addon is asserted present and unpacked, the packaged app now
  opens a world in CI, and a real-Electron spec now watches the World surface
  draw (§16.1, Done). What a dispatch would still ship unproven is now narrow
  and is in Next: the subtree delete and the waypoint renumber have loaded in an
  engine but have never been *looked at* in a frame where they could be seen.
- **This machine is fully built; every other machine and CI must rebuild.**
  `vendor/ZenKit` (patches `0029`–`0048`, `src/fixture.cc`), the addon, `zen-world/dist`
  and the editor's `dist/` all changed on 2026-08-28, and the addon again with
  I5's seven constructions, the bed's `setVobClassProp` case and `getPortals`. The recipe
  and every trap in it — `build-zenkit.js` before `node-gyp rebuild`, never
  `build`, `zen-world` before the editor typechecks, the full `build` for
  `verify-world-edit.js` — are in `environment-hazards.md`, *"Building the native
  addon"*. Do not repeat them here.
  **Why it matters that a stale `.node` is silent:** the editor's Jest suites
  fake the worker, so they stay green against a binary with neither
  `getVobProps` nor `setVobClassProp` while the running app has no class
  properties at all — and, since §16.17 V1 and V2, against one whose `setVobProp`
  refuses `presetName`, `visualCamAlign`, `bias`, `dynamicShadows` and the seven
  decal keys, and whose `getVobProps` answers no `dynamicShadows` at all.
- `daedalus-dialog-editor/dist/` holds a packaged app (`win-unpacked`, the
  installer) that is **no longer fresh** — it predates the waypoint delete, and
  every session that only compiles leaves it further behind. `.gitignore`d, and
  it only matters if you are about to trust a package already sitting there:
  re-package before you do.

---

## Now

*(empty)*

## Next

Each card is one line, an owner and a pointer. A bare `§` is a section of
`docs/plans/level-editor.md`. The diagnosis, the measurement and the decision a
card waits on live at its pointer — put new prose there, not here.

**Daedalus scripts — where a script names a place**

- **§16.8 W1 — the script-side waypoint index** — the extraction half is landed
  and tested; the lookup rides with the dangling-waypoint card below, which is
  its first consumer. What stays open is only the **third answer** — "no such
  waypoint anywhere" needs worlds the app does not hold, so the rule says "not
  in this world" and never "missing". Unowned. §16.8

**Release gates**

- **`05`'s two observation rows have never been run in a cleared frame** — that
  the deleted torch subtree is *wholly* gone, and that NPC routines survive the
  2,895-waypoint renumber. Both are "loads and plays" only. A `07` in `06`'s
  shape settles them cheaply now the frame-clearing exists. Unowned. §16.2

- **The editor places mobs nobody can use, and says nothing** — a `oCMob*` with
  an empty `focusName` is visible and inert in the engine. Retail sets it per
  class, so it is not an `insertVob` default; the guidance or the warning belongs
  on the editor's side. Unowned. §16.15

**Phase 1b-2 — VOB editing**

- **Euler order is not measured against Spacer** — Y-X-Z was picked on retail
  singularity counts, not a Spacer match. Needs Spacer itself, and only two
  functions change if it differs. **Daniel.** §16.4

**Waynet, and the scripts that name it**

- **The dangling-waypoint rule, and the world input it needs** — decided
  2026-08-28, three parts and all three or none: an optional `world` on
  `ProjectScanInput`/`ProjectView` read from `worldStore` the way
  `knownNpcNames` is read from `projectStore`; a re-scan on world open/close and
  on `AddWaypoint`/`DeleteWaypoint`/`RenameWaypoint` and nothing else; and the
  rule itself, prefix-matching free points. Absent world means the rule returns
  nothing, never a finding. Closes W1's lookup for the two answers it can give.
  Unowned. §16.8

**zenkit-node / fidelity**

- macOS CI — **dropped from scope, 2026-08-27** (Daniel). Not a gap to close.

**Elsewhere, with a home of their own**

- **`3221226505` is still unexplained** — blocked: it will not reproduce (29
  clean runs), so there is nothing to bisect; needs a captured crash dump. The
  addon is cleared — the run's native code is tree-sitter.
  `docs/reference/environment-hazards.md`

## Deferred

**Outside the pick path — an unattended run skips this section.** Deprioritised,
not blocked: moving a card back to Next is a human decision.

**ASCII writer — deferred 2026-08-28**, all three at §16.9. Real defects, but
the editor does not save through the ASCII path, BinSafe stays `identical`, and
the series absorbed most of a night's run by the time `0048` landed.

- **A6** — the packed `zCVob` writer drops `physicsEnabled`, so the editor's own
  BinSafe path has it too. Wants a fixture VOB and an engine A/B, like §16.2.
- **`bool:` writes `1` where ZenGin writes `-1`** (`locked`, `moveable`) —
  `0017` is the BinSafe template. 3 of OldCamp's 8 findings.
- **Half-way float rounding** — UCRT ties-to-even against MSVC 6's away-from-
  zero. The other 5 findings.

- **`.MMB` authoring has no ZenKit writer at all** — `MorphMesh` has `load` and
  no `save`: new upstream code, not a patch. Deferred 2026-08-28.

## Triage

**Too big for one board entry.** An unattended run may not create work for
itself — no new cards, no filing its own splits. Too big means: one line here,
the card stays in Next, report BLOCKED, a human decides. Empty is normal.

*(empty)*

## Done

- **Gate 2b ran, both passes** — 2026-08-28/29. Every op loads and plays, and
  `06-minimal-frame` then witnessed the class-property writes the first pass
  could not see: red fog, a carried sound radius, an authored chest the player
  opens. `SetVobClassProp` has its engine witness. Daniel + one real
  `insertVob` defect fixed on the way (§16.15). §16.2 and
  `engine-acceptance-2026-08-25.md`
- **The viewport's frame is a handle command** — `WorldViewportHandle.frameVob`
  replaces the `frameRequest` prop; the trigger was `raycastDown`, not W4, and
  the last of the three viewport warts is closed. board-loop.
  `docs/refactoring-targets.md` §9
- **The portal polygon payload is data** — `getPortals` reads out `is_portal`,
  `is_sector`, `sector_index` and the BSP portal list; columnar, one row per
  portal/sector polygon, and unplumbed like slice 1. board-loop. §16.18
- **Portal material checks** — `checkPortalMaterials` in `zen-world/src/validate/`;
  clean on all three retail worlds, and it has no consumer yet. board-loop. §16.18
- **I5 — the zones, the markers and the two effect classes are authorable** —
  all seven landed; §14.1 1.3 is closed. board-loop. §16.15
- **`oCMobBed` is editable** — both halves; `oCTouchDamage` is now the family's
  only authorable-with-nothing-catalogued class. board-loop. §16.15

**Everything landed on 2026-08-28 was flushed that day**, and each card's
substance is at its pointer rather than restated here: class insertion I1–I4 and
the caveats they left at §16.15, the waypoint index W1/W2/W5 at §16.8, `zCVob`
V1/V2 at §16.17 (which closes §14.1 1.8), copy/paste at §16.14, waynet at §16.7,
`resavedSize` at §16.10, the scene tree at §16.16, and the three viewport warts
in `refactoring-targets.md` §8–10. `git log` is the record of what landed and
why; this section only exists so the next session sees the last one's work, and
on 2026-08-28 that was two full runs.
