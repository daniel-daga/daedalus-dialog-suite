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
| the settled architecture | `docs/architecture/level-editor.md` §3-§10, §13 |
| a decision or a measurement | `docs/architecture/level-editor.md` §7 |
| build and test commands | `CLAUDE.md`, and each workspace's `README.md` |
| machine and toolchain hazards | `docs/reference/environment-hazards.md` |
| a known wart nobody is fixing yet | `docs/refactoring-targets.md` |
| the Gate 2 checklist | `zenkit-node/docs/engine-acceptance-2026-08-25.md` §8 |
| **work a run can take unattended** | `docs/plans/unattended-queue.md` |
| a 2026-08-29 review finding | `docs/plans/world-editor-review-2026-08-29.md` |
| a dialog-simulator finding | `docs/plans/dialog-simulator-review-findings.md` |
| a production-readiness finding | `docs/plans/production-readiness-review-findings.md` |
| a 2026-07 code-review item | `docs/plans/code-review-2026-07-remediation.md` |

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
  draw (`world-render.spec.ts`). **Gate 2b closed 2026-08-30**: every op has
  been seen doing its work in the engine; the unwitnessed remainder is the
  acceptance record's list under *"What is still not witnessed"*.
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

Each card is one line, an owner and a pointer. A bare `§` is a section of the
level-editor pair — §16 and the plan's own, or §3-§10 and §13 in
`docs/architecture/level-editor.md`; the numbers are disjoint, so a bare one is
never ambiguous. The diagnosis, the measurement and the decision a
card waits on live at its pointer — put new prose there, not here.

**Release gates** — none open. Gate 2b closed 2026-08-30; what a dispatch
would ship unproven is the acceptance record's short list (decal fields, enum
writes, the classes beyond five), none of it carded.

**The unattended queue — one card for 49 items.** Everything a run can take
with nobody watching. Triaged against the tree 2026-08-30, each verified still
open. **Take the top unclaimed row and cross it off in the same commit; a run
may not add rows.** `unattended-queue.md` — **section 5, the level editor, was
first (Daniel, 2026-08-30)** and is now empty but for row 42, which went to
Triage, so a run resumes at section 1: rows 1-12 landed 2026-08-30 and the next
unclaimed row is 13. The corpus section 5's rows wanted is in
`zenkit-node/worlds/`.

**World surface, from Daniel's own sessions 2026-08-30 — all at §16.24.** None
needs the engine; the order is a guess at his, so move it.

- **A VOB can be picked through the world mesh** — the pick pass draws only the
  VOB proxies, so nothing writes depth and a VOB behind a wall wins the pixel.
  Diagnosed, and the fix is a depth-only occluder in that scene. §16.24 3
- **A selection is invisible unless its gizmo is** — wants an outline; the cheap
  form is a per-instance attribute. §16.24 1
- **Paste lands the copy inside the original and leaves it unselected** — wants
  an offset and the copy selected. §16.24 4
- **After a paste the locator works on no VOB at all** — every link in
  `onFocus → focusVob → frameVob → frameVobRef` is optional-chained, so a null
  is a silent no-op. Not root-caused; the probe is written. §16.24 5
- **The right sidebar has no locator for the selection** — picking in the
  viewport leaves no way back to it. `.` already does it. §16.24 6
- **The multi-select gizmo sits on the last VOB picked, not the centre** —
  **decide rotation first**, or the gizmo shows a pivot the op does not use.
  §16.24 2

**Phase 1c — the overlay, at §16.19.** Not blocked.

- **The routine index's coverage has never been measured** — one command
  against `mdk/Content`; it qualifies everything built on the index. Now also
  qualifies the slider: an hour it reads badly draws grey. §16.19 s6
- **The slider answers only the declared routine** — a *State* lens over the
  `RTN_*` variants quest state swaps in; planned as four slices, parser `id`
  extraction first, chapter-gated spawns stay behind a measurement. §16.19 s10

**Phase 1c / Phase 2 — world findings get a locus** (§7 decision, §16.20)

- **Portal orientation is unmeasured** — unblocked: the corpus is
  `node scripts/extract-worlds.js` away and `getPortals` is the walk; the
  sector-facing half is what the planarity script does not measure. §16.22 q3

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

- **Unattended-queue row 42, the BINARY fidelity baseline** — no BINARY `.zen`
  exists on this machine to classify and the instrument has no BINARY walker, so
  it decomposes into three runs plus a scope call. §14.3 3.1

## Done

*(flushed 2026-08-30 — s7/s8/s9 are in `git log`, and their forward facts —
no Playwright spec, unwitnessed on a real screen — are in §16.19's own prose)*
