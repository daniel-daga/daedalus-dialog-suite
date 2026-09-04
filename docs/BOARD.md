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
| **a 2026-09-04 review finding** — the second pass the 08-29 review never got | `docs/plans/level-editor-review-2026-09-04.md` |
| a dialog-simulator finding | `docs/plans/dialog-simulator-review-findings.md` |
| a production-readiness finding | `docs/plans/production-readiness-review-findings.md` |
| a 2026-07 code-review item | `docs/plans/code-review-2026-07-remediation.md` |
| the VOB folders design | `docs/plans/vob-folders.md` |

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
  work lands on `master` directly, and is pushed as it lands — it was level with
  `origin/master` on 2026-08-30. A push is not a release — see the merge note
  below.
  No HEAD hash and no count here — a file committed at HEAD cannot name either,
  and a number goes stale the moment anything lands. `git status -sb` answers it.
- **`zenkit-node/vendor/ZenKit` is permanently dirty** and is **never**
  committed: it is the applied patch series, and `patches/` is what that series
  actually is. Since 2026-08-30 the entry carries `ignore = dirty`, so the dirt
  no longer shows in `git status` — a moved submodule *commit* still does,
  which is the change worth seeing. Stage with
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
  installer) **re-packaged 2026-09-03** for the parse smoke, so it is fresh as
  of that commit — and goes stale again with the next one, because every
  session that only compiles leaves it behind. `.gitignore`d, and it only
  matters if you are about to trust a package already sitting there:
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
with nobody watching. **Take the top unclaimed row and cross it off in the
same commit; a run may not add rows.** `unattended-queue.md` — **only row 42
(Triage) is left**: rows 1-41 and 43-49 landed 2026-08-30 to 2026-09-03, so
the queue is empty of pickable work and the next run resumes at the card
below it.

**Phase 1c — the overlay, at §16.19.** Not blocked.

- **Insert NPC, from the World surface — A–E landed 2026-09-02**, and E's
  three forward facts closed the same day (instance and duplicate warnings,
  `parsedFiles` refreshed). Only slice F is left, and it is Deferred. §16.19 s16

**Phase 1c / Phase 2 — world findings get a locus** (§7 decision, §16.20)

- **Portal findings in the Problems panel — landed 2026-09-02, listed and not
  clickable by decision.** Five rule ids over `checkPortals` in the worker;
  the one-sided orientation cut (0.25 corner share) is the one number Daniel
  may move; framing a polygon is still nobody's card. §16.20 slice 3, §16.22

**Phase 1b-2 — VOB editing**

- **§14's uninventoried gaps** — mesh preview, fly navigation, the picker,
  the four camera slots, §16.12's outline tuning, the walk (F3, pointer lock,
  capsule against the BVH — feel unwitnessed on a real GPU) and, 2026-09-03,
  the thumbnail grid, vobbilder-seeded favorites/categories in a
  `<project>.assets.json` sidecar and the chest-contents editor are all
  landed. Unwitnessed: the thumbnails' look, and a written `contents` in the
  engine. §16.26

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

- **Insert NPC slice F** — the world-directory setting, deferred with the
  slicing 2026-09-01; only `expectedWorldNameFor`'s `.ZEN` opening wants it.
  §16.19 s16

## Triage

**Too big for one board entry.** An unattended run may not create work for
itself — no new cards, no filing its own splits. Too big means: one line here,
the card stays in Next, report BLOCKED, a human decides. Empty is normal.

- **Unattended-queue row 42, the BINARY fidelity baseline** — no BINARY `.zen`
  exists on this machine to classify and the instrument has no BINARY walker, so
  it decomposes into three runs plus a scope call. §14.3 3.1
- **The 2026-09-04 level-editor review — the ranked four and 14 findings
  landed the same day; the rest is its section 6.** Biggest thing left is
  structural and uncarded: `WorldViewport.tsx` is 2,090 lines in one
  1,310-line effect, which is *why* the dead scatter brush was invisible for
  two days. `docs/plans/level-editor-review-2026-09-04.md`, its section 6

## Done

- **One undecodable texture no longer costs every later one its pixels —
  landed 2026-09-03.** `loadPendingTextures` caught nothing, so beppo's six
  source `.TGA` files (which resolve by name, then fail to parse) left every
  name after them white. Now caught per name, answered `null` by the worker,
  and reported in the world banner. §16.31
- **The Gothic install is machine-local again — landed 2026-09-03**, reversing
  §16.28 for that one path: a setting, mounted first under every project, a
  section in the Asset sources dialog, adopted out of a project file that still
  carries one. World open now *refuses* without it. `gothicAssetSources` also
  mounts loose `_compiled` over the archives, so a GMBT build is visible. §16.31
- **The GMBT project configures the project, and worlds are a list — landed
  2026-09-03.** `.gmbt.yml` detected by walking up; a new project file seeds
  its asset sources from it, an existing one only adopts `gmbtProjectDir` and
  is offered the rest by a button. "Open world" now lists the `.zen` files
  under the sources (§16.28 item 3), Browse… kept for the rest. Unwitnessed:
  never run against beppo in the app. §16.31
- **The GMBT quick-test button — landed 2026-09-03**, all six decisions as
  settled, plus a Choose…/Clear for the folder in the Asset sources dialog. A
  dirty world blocks unless the save went back over the opened file.
  Unwitnessed: no run has been launched from the button. §16.29
- **Plane gizmo handles follow the camera — landed 2026-09-04.** The XY/YZ/XZ
  squares are mirrored into the camera's octant instead of the baked positive
  one. Unwitnessed: the drag itself. `docs/architecture/level-editor.md` §7
