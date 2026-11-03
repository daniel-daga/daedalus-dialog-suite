# Next batch — 10 issues for subagent sessions

Selected 2026-11-03 against the tree and the open issues. Every row is
unattended-safe: no Gothic engine, no real GPU, no new asset, and no decision the
owner has not already written down. Each row names the test that has to fail
first; the issue and its pointer hold the diagnosis.

**One agent, one worktree.** `npm run wt:new -- <worktree>`, branch `agent/<worktree>`,
from `master` **at dispatch time** — so a later wave inherits the earlier wave's
merges. Land by merging into `master` from the main checkout, then
`npm run wt:rm -- <worktree>`.

Order is priority first, then one agent at a time per file cluster. Two rows in
one wave never share a file.

## Wave 1 — four agents, disjoint

| Issue | P | Worktree | Files it owns | Failing test first | Size |
|---|---|---|---|---|---|
| #439 Parser extraction reparses every call; three condition lists | P3 parser | `parser-call-identity` | `daedalus-parser/src/semantic/parsers/*` only | rows in `test/action-argument-fidelity.test.js` for the four undispatched calls, and a `!Npc_GetTalentSkill(...)` case | M |
| #467 `PARSED_FILES_CAP` does not cap a dialog-less project | P2 editor | `parsed-files-cap` | `store/projectStore.ts` eviction | `tests/projectStore.parsedFilesCap.test.ts` › cap+188 pinned globals evict down to the cap | S |
| #509 `routine-mob-missing` never re-runs; waypoint positions frozen | P2 level | `problem-rescan` | `store/worldStore.ts`, `store/storeSync.ts`, `store/problemsStore.ts`, `problems/application/scanProject.ts` | `tests/problemsStore.scanScheduling.test.ts` › a `MoveVob` schedules a scan; a `MoveWaypoint` is read at its new position | M |
| #510 Both range filters re-compact and re-upload every frame | P3 level | `world-range-filter` | `world/VobMarkerLayer.ts`, `world/WaynetOverlay.ts`, `components/world/WorldViewport.tsx` | `tests/VobMarkerLayer.test.ts` / `WaynetOverlay.test.ts` › an unchanged view does not flag the attributes; a hidden layer uploads nothing | M |

## Wave 2 — three agents, after wave 1 merges

| Issue | P | Worktree | Files it owns | Failing test first | Size |
|---|---|---|---|---|---|
| #517 Install & Restart exits over unsaved world edits | P2 level | `install-world-guard` | `components/UpdateNotification.tsx` (copy the world branch from `hooks/useWindowCloseGuard.tsx:167-169`) | `tests/installUpdateUnsavedWorld.test.tsx` › a dirty world is saved, or the install is refused with a message | S |
| #469 The incremental index cannot see a prototype the file introduces | P3 editor | `incremental-prototypes` | `store/projectStore.ts` (`withFileIndexes`), `shared/types.ts` `FileIndex` | `tests/projectStore.reindexRoutines.test.ts` neighbour › a file declaring `prototype SLD_New(C_NPC)` lists its instance | M |
| #518 An inline choice edit aimed at an unopened file is dropped silently | P3 editor | `inline-choice-readonly` | `components/InlineChoiceEditor.tsx` | `tests/InlineChoiceEditor.test.tsx` › a target in an unopened file renders read-only with its reason, and no edit is written | S |

## Wave 3 — two agents, after wave 2 merges

| Issue | P | Worktree | Files it owns | Failing test first | Size |
|---|---|---|---|---|---|
| #487 Deleting a variable writes around the open model | P3 editor | `variable-delete-guard` | `components/VariableManager.tsx` (the only caller of `deleteVariable`) | `tests/VariableManager.deleteConfirm.test.tsx` neighbour › a delete of a variable in an open dirty file is refused with its reason, and the file is untouched | S |
| #491 The implicit-quest upgrade can leave a quest half-upgraded | P3 editor | `quest-upgrade-atomic` | `components/questDiarySave.ts` | new `tests/questDiarySave.upgradeAtomic.test.ts` › a refused assignment save leaves no `MIS_` declaration behind | S |

## Wave 4 — one agent, after wave 3 merges

| Issue | P | Worktree | Files it owns | Failing test first | Size |
|---|---|---|---|---|---|
| #325 Quest authoring phase 4: named sub-stages | P3 editor | `quest-stages` | `quest/domain/questStages.ts` (new), `QuestDetails`, action/condition registries, `projectStore.addVariable` | new `tests/questStages.test.ts` › declared stages are inventoried, a write is recognised, a counter's target derives from its `>= N` checks | L |

#325 is decided and specified in `docs/plans/quest-authoring.md` ("Phase 4"),
including its two slices and the rename/delete refusals. Take slice 1 and slice 2
in that order, in the same worktree; do not invent rename.

## The prompt the loop gives each agent

> Work issue #N in your worktree only. Read the issue and its pointer. Invoke the
> `ponytail` skill (full) and the workspace skill (`typescript-react` + `jest` for
> the editor; a new UI flow also wants `playwright` after the Jest test is green).
> Write the failing test named in the issue first. Keep the diff to what the issue
> asks. Run the focused tests, then lint and typecheck for the workspace only —
> never a full suite. Commit with `Closes #N`, no AI attribution, no `zenkit-node`
> submodule. If the issue turns out to need a decision it does not already record,
> stop and say which decision.

## Not in this batch

- **Engine, GPU or a person's eye:** #406, #407, #422, #423, #424, #425, #261, #223, #236, #227, #224, #225, #310, #274. #423 is already on `agent/waypoint-turn` (unmerged).
- **A decision is the whole issue:** #392, #432, #455, #456, #499, #513, #514, #515, #353.
- **No long form or blocked on an earlier slice:** #412, #417, #418 (the plan's §14 does not carry them yet); #410, #420, #419.
- **Nothing to do:** #414 landed in `d648965` (gizmo on the VOB's own axes) and can be closed.
