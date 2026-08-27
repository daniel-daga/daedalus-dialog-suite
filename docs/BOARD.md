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

**The card sections — Now, Next and Done together — stay under 80 lines, and
going over is the signal to flush.** The budget is on the cards because the
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

- branch `master`, **pushed to `origin/master`.** `feature/level-editor`
  was merged and is no longer where work happens. A push is not a release —
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
  closed** — the addon is asserted present and unpacked, and the packaged app
  now opens a world in CI. What a dispatch would still ship unproven is in Next:
  three ops with no engine verdict, and a packaged renderer nothing has watched
  draw.
- **This machine is fully built; every other machine and CI must rebuild.**
  `vendor/ZenKit` (patch `0028`, `src/fixture.cc`), the addon, `zen-world/dist`
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

**Release gates**

- **Nothing has watched the packaged renderer draw** — the CI smoke opens a
  world and exits, never creating a window. Unowned. §16.1
- **Three shipped ops have no engine verdict** — `DeleteVob`, `MoveWaypoint`,
  `SetVobClassProp` all post-date candidate `03`. Say "Gate 2 passed for the ops
  it tested". Rebuilding a candidate is **Daniel's call**. §16.2

**Phase 1b-2 — VOB editing**

- **`oCMob*` — the base landed, the subclasses are what is left** — `oCMOB`'s
  own nine fields landed; `oCMobInter` and its subclasses
  (`oCMobFire`/`Container`/`Door`/`Ladder`/`Switch`/`Wheel`) still need their
  own case. Unowned. §16.3
- **Typed rotation: absolute-or-delta for a multi-selection, and Spacer
  parity** — a UI decision and a Spacer measurement, no code. **Daniel.** §16.4
- **Snapping — drop-to-ground and align-to-normal** — blocked on a per-VOB
  op-building path, not on a raycast. Unowned. §16.5

**Waynet, and the scripts that name it**

- **Waynet edge ops, add/delete/rename** — the index-addressing problem is the
  whole job and is untouched. Unowned. §16.7
- **Jump between a script reference and the place it names** — Daniel's idea,
  sized; **W2 (world → scripts) is the half to land first.** Unowned. §16.8

**zenkit-node / fidelity**

- **ASCII writer A2, A3 and A6** — A6 is the packed `zCVob` writer, so the
  editor's own BinSafe save path drops `physicsEnabled` too. Unowned. §16.9
- **`resavedSize` breaks at a day or month boundary** — the fix is a
  report-shape decision. **Daniel.** §16.10
- **A malformed world still crashes the reader** — 19 of 30 fuzz seeds segfault;
  the worker isolation stays load-bearing. Unowned. §16.11
- **`.MMB` authoring has no ZenKit writer at all.** Unowned.
- macOS CI — **dropped from scope, 2026-08-27** (Daniel). Not a gap to close.

**Elsewhere, with a home of their own**

- **`3221226505` is still unexplained** — the worker-handle hypothesis is
  disproved and the first suspect is the addon.
  `docs/reference/environment-hazards.md`
- **Four viewport and World-surface warts** — the surface loses its geometry on
  navigate-away (a hard prerequisite for §16.8 W4), the imperative handle, the
  five module mocks, the 31 px reservation. `docs/refactoring-targets.md` §8–11

**UI/UX improvement**

*(empty — both cards landed, see Done)*

## Done

*(emptied 2026-08-28, twice — most recently after `oCMOB` landed. The forward
fact — `oCMobInter` and the leaf subclasses are what is left — is on the Next
card above; `git log` is the permanent record of what landed.)*

Verified this session: `zenkit-node` (rebuild + full suite + lint), `zen-world`
(test/lint/typecheck/build), editor (build:main/typecheck:renderer/Jest/lint)
all green.
