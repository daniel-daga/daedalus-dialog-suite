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
| a 2026-08-29 review finding | `docs/plans/world-editor-review-2026-08-29.md` |
| a dialog-simulator finding | `docs/plans/dialog-simulator-review-findings.md` |
| a production-readiness finding | `docs/plans/production-readiness-review-findings.md` |

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
its home and leave the pointer. The budget is checked, not trusted:
`npm run board:check` (root, and CI) fails this file over 80 card lines, and
fails the plan while a §16 subsection still declares itself *closed* or
*landed*, on its heading or opening its first paragraph — a closed card takes
its subsection with it there too.

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
  Every `board-loop*` branch is now **spent** — `master` contains all five, and
  work lands on `master` directly. It is ahead of `origin/master` and pushing is
  a person's call. A push is not a release — see the merge note below.
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
  draw (`world-render.spec.ts`). What a dispatch would still ship unproven is now narrow
  and is in Next: the subtree delete and the waypoint renumber have loaded in an
  engine but have never been *looked at* in a frame where they could be seen.
- **This machine is fully built; every other machine and CI must rebuild** —
  the addon has changed in nearly every recent session, and `git log` says what
  and when. The recipe and every trap in it — `build-zenkit.js` before
  `node-gyp rebuild`, never `build`, `zen-world` before the editor typechecks,
  the full `build` for `verify-world-edit.js` — are in
  `environment-hazards.md`, *"Building the native addon"*, along with why a
  stale `.node` is **silent**: the editor's Jest suites fake the worker, so
  every suite stays green against a binary missing whatever the ops have
  gained since it was built. Do not repeat any of it here.
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

**Release gates**

- **`07` is built and has not been played** — `07a`/`07b` (the torch subtree,
  its own A/B in a cleared frame) and `07c` (the renumber with nothing else in
  the file) are the last of Gate 2b's unwitnessed rows. Needs the engine, so it
  needs a person. **Daniel.** §16.2, run sheet §07 — and the install has to be
  restored first, see the planarity card

**Review findings, 2026-08-29.** Each pointer is a section and number in
`world-editor-review-2026-08-29.md`; each card starts with its failing test.

- **The free-point guard may be too narrow** — `startsWith` where ZenGin looks
  to match by substring. Needs the engine. **Daniel.** *first pass* 6

**Editor-side backlogs — nothing carded, which is not the same as nothing
open.** Still unfixed and unowned: the simulator's M2 (a background reparse
wipes a running session), §3 P3's incomplete bundle-size guard, the
error-boundary gaps and the update link with no `shell.openExternal` channel.
None need the engine or the corpus; carding them is a person's call. See the
routing table's review files.

**Phase 1c / Phase 2 — world findings get a locus** (§7 decision, §16.20)

- **The planarity tolerance is unmeasured** — blocked: the script and its tests
  landed, but **the MDK extraction is gone from this machine** and every
  `--world` script has lost its corpus. Needs a re-extract, so it needs a
  person. §16.22 q2, `environment-hazards.md`
- **Portal orientation is unmeasured** — blocked on the same missing corpus as
  the planarity card: it rides `getPortals` over the retail worlds and there is
  no `.zen` left on this machine. Needs the re-extract, so it needs a person.
  §16.22 q3, `environment-hazards.md`

**Phase 1b-2 — VOB editing**

- **Euler order is not measured against Spacer** — Y-X-Z was picked on retail
  singularity counts, not a Spacer match. Needs Spacer itself, and only two
  functions change if it differs. **Daniel.** §16.4

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

- **`checkPortalMaterials`' consumer — deferred 2026-08-29** (Daniel). Not a
  card: its input is not on the editor's side of the binding, so the slice is a
  `zenkit-node` readout, a thirteenth worker op with its IPC chain and the rule
  — three workspaces — plus an undefined part, what framing a polygon means.
  Belongs with the Phase 2 geometric checks the measurement tranche leads into,
  not ahead of them. §16.20 slice 3

- **`.MMB` authoring has no ZenKit writer at all** — `MorphMesh` has `load` and
  no `save`: new upstream code, not a patch. Deferred 2026-08-28.

## Triage

**Too big for one board entry.** An unattended run may not create work for
itself — no new cards, no filing its own splits. Too big means: one line here,
the card stays in Next, report BLOCKED, a human decides. Empty is normal.

*(empty)*

## Done

- **The board's two flush rules are enforced, not trusted** — `tools/check-board.js`
  (`npm run board:check`, and the `zen-world-tests` CI job) fails the card budget
  and any §16 subsection declaring itself closed/landed - on the heading or
  opening its first paragraph. Five flushed to make it green (§16.1, .5, .10,
  .13, .16), forward facts routed to §7, §14.1 1.6, CLAUDE.md's CI notes and
  `environment-hazards.md`. What it cannot judge is a subsection whose halves
  landed separately, so the convention is to mark the heading when the last
  half lands.

*(flushed 2026-08-29, twice. Six rounds' twenty-six cards went first; then the
five of round 7-9 — portal pairing, waypoint occupancy, W4, the spawn-index
fix, and the waynet card that outlived its own fix. Every forward fact they
carried is at §16.19, §16.22 and §16.23; the rest is in `git log`.)*
