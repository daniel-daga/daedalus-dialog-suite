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
  `feature/level-editor` was merged and is no longer where work happens. The
  unattended board loop commits on `board-loop-3` and does not push; its
  predecessor `board-loop` was fast-forwarded into master on 2026-08-28 and is
  spent. **Local master is ahead of `origin/master` and has been for a while** —
  the push in the first clause is the intent, not the current state. A push is
  not a release — see the merge note below.
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
  draw (§16.1, Done). What a dispatch would still ship unproven is in Next:
  six ops with no engine verdict.
- **This machine is fully built; every other machine and CI must rebuild.**
  `vendor/ZenKit` (patches `0029`–`0048`, `src/fixture.cc`), the addon, `zen-world/dist`
  and the editor's `dist/` all changed this session. The recipe
  and every trap in it — `build-zenkit.js` before `node-gyp rebuild`, never
  `build`, `zen-world` before the editor typechecks, the full `build` for
  `verify-world-edit.js` — are in `environment-hazards.md`, *"Building the native
  addon"*. Do not repeat them here.
  **Why it matters that a stale `.node` is silent:** the editor's Jest suites
  fake the worker, so they stay green against a binary with neither
  `getVobProps` nor `setVobClassProp` while the running app has no class
  properties at all.
- `daedalus-dialog-editor/dist/` holds a **freshly packaged app** used to verify
  the open-world smoke. `.gitignore`d, and it only matters if you are about to
  trust a package already sitting there.

---

## Now

*(empty)*

## Next

Each card is one line, an owner and a pointer. A bare `§` is a section of
`docs/plans/level-editor.md`. The diagnosis, the measurement and the decision a
card waits on live at its pointer — put new prose there, not here.

**Spacer parity — Phase 1b-2 (the priority)**

- **Waynet W4 — delete an arbitrary waypoint** — decided 2026-08-28: §15's
  barrier, closer Spacer parity than an id scheme (Spacer has no undo at all).
  No new addressing needed. Unowned. §16.7
- **Typed rotation for a multi-selection** — decided 2026-08-28: relative, as
  the position fields already are. The angle fields stop being hidden for N
  VOBs. Unowned. §16.4
- **Copy/paste D5 — the subtree** — measured 2026-08-28: N appends in one
  batch, paths predictable, one undo entry. No tree format, no new op. §16.14
- **VOB search and filter in the scene tree** — by name and class, over columns
  already in the summary; 41,393 VOBs, so derive, don't rebuild. §16.16
- **Per-class visibility toggles** — Spacer's VOB-type show/hide, on the
  filter's predicate. Unowned. §16.16
- **`zCVob` V1 — preset name, `visualCamAlign`, bias** — catalogue idiom, no
  known hazards. Unowned. §16.17
- **`zCVob` V2 — `dynamicShadows`, `sleepMode`, decals** — a decal field needs
  the fixture to carry it (A5's lesson). Unowned. §16.17

**Release gates**

- **Six shipped ops have no engine verdict** — `DeleteVob`, `MoveWaypoint`,
  `SetVobClassProp`, `RenameWaypoint`, `AddWaypoint`, `SetWaypointEdge`, and
  `AddVob` now authors classes. Say "Gate 2 passed for the ops it tested".
  Rebuilding a candidate is **Daniel's call**. §16.2

**Phase 1b-2 — VOB editing**

- **Euler order is not measured against Spacer** — Y-X-Z was picked on retail
  singularity counts, not a Spacer match. Needs Spacer itself, and only two
  functions change if it differs. **Daniel.** §16.4

**Waynet, and the scripts that name it**

- **Dangling-waypoint Problems rule** — blocked: `ProjectView` holds no
  world/waypoint data, so the rule has no known-waypoints set; needs a design
  decision on how that reaches the Problems pipeline. Unowned. §16.8

**zenkit-node / fidelity**

- **`resavedSize` breaks at a day or month boundary** — decided 2026-08-28:
  strip the stamp in the existing field, no second field. Reproduce by
  shortening the fixture's stamp, not by waiting for a 9→10. Unowned. §16.10
- macOS CI — **dropped from scope, 2026-08-27** (Daniel). Not a gap to close.

**Elsewhere, with a home of their own**

- **`3221226505` is still unexplained** — the worker-handle hypothesis is
  disproved and the first suspect is the addon.
  `docs/reference/environment-hazards.md`
- **Three viewport and World-surface warts** — the surface loses its geometry on
  navigate-away (a hard prerequisite for §16.8 W4), the imperative handle, the
  31 px reservation. `docs/refactoring-targets.md` §8–10

**UI/UX improvement**

*(empty — both cards landed; see `git log`)*

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

*(empty)*

Flushed 2026-08-28 at the end of the third loop run: I1, I2, D2, W2 and W3 all
landed that day. Their forward facts are routed — what a copy still drops and
the batch-guard relaxation it wants are §16.14, the authorable class set is
§16.15, the last-edge promotion is §16.7 — and the rest is in `git log`.
