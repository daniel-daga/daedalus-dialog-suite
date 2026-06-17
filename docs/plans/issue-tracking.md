# Issue Tracking

Progress tracker for the GitHub issues triaged in `github-issues.md`.
Source of detail for each issue is `github-issues.md`; this file tracks status only.

Legend: ✅ done · 🚧 in progress · ⬜ not started

---

## P1 — Bugs

| Issue | Title | Status |
|---|---|---|
| #174 | Wrong variable prefix in LOG_RUNNING condition | ✅ done |
| #116 | B_Attack emits `hero` (unknown identifier) | ✅ done |
| #145 | If/else block: text deleted on "Add Line", missing "knows info" option | ✅ done |
| #117 | Added choice not accessible until user re-clicks NPC | ✅ done |
| #126 | New dialog line defaults to NPC speaker, should default to Hero | ✅ done |

## P2 — Small QOL / UX

| Issue | Title | Status |
|---|---|---|
| #182 | "Add Dialog Line" ignores nesting level; delete button broken in dropdown | ⬜ not started |
| #181 | Auto-insert dialog line with same text when adding a Choice | ⬜ not started |
| #140 | "Create Topic" should also insert a "Log Set Status" action | ⬜ not started |
| #123 | New action: Info_ClearChoices | ⬜ not started |
| #119 | New action: Npc_SetRefuseTalk | ⬜ not started |
| #183 (item 3) | Tab key doesn't navigate Giver → Receiver → Item field | ⬜ not started |
| #118 | Tab key to jump into choice sub-editor | ⬜ not started |

## P3 — Medium features

| Issue | Title | Status |
|---|---|---|
| #183 (items 1–2) | Give Inventory Item: swap hero/self button + auto-fill from condition | ⬜ not started |
| #111 | Choices: show preceding dialog context (accordion / split-screen) | ⬜ not started |

## P4 — Larger features

| Issue | Title | Status |
|---|---|---|
| #141 | Disable "Add NPC"; auto-create EXIT dialog when NPC file appears | ⬜ not started |
| #147 | Teacher dialog template (Lehrer anlegen) | ⬜ not started |
| #114 | "Create Topic" writes to external log/quest files | ⬜ not started |

---

## #117 — resolution notes

- **Root cause:** in project mode the dialog tree + editor read from
  `projectStore.mergedSemanticModel`. Adding a Choice creates a brand-new target
  function (the sub-dialog) but no new dialog, and the merged model was not
  re-built after the edit, so the new function was invisible until a manual NPC
  re-click forced a re-merge.
- **Fix (already in `master`):** `projectStore.updateFileModel` re-merges the
  selected NPC's model after every edit that touches one of its files or a
  global file (`158ee70`, refined for perf in `35f0e9d`). The new target function
  reaches the merged model via `storeSync` → `updateFileModel` →
  `loadAndMergeNpcModels`, so the choice is accessible immediately.
- **Regression test:** `tests/e2e/choice-editing.spec.ts` →
  `Choice accessibility after creation in project mode (issue #117)` (2 tests).
  Verified to fail when the re-merge path is disabled and pass with it enabled.

## #126 — resolution notes

- **Request:** almost every dialog opens with a line from the Hero, so a newly
  created dialog should seed its first `DialogLine` with the Hero (`other`) as
  speaker rather than the NPC (`self`).
- **Fix (already in `master`):** `useDialogFactory.createDialogForNpc` seeds the
  new info function's first line with `speaker: 'other'` (`f92edf9`, 2026-04-07).
  The action factory already defaulted standalone new dialog lines to `other`
  (`actionFactory.createAction` → `getOppositeSpeaker`/`'other'` fallback).
- **Gap closed:** the `f92edf9` commit shipped the one-line factory change with
  no dedicated test (its tests covered an unrelated `conditionOperator` change).
- **Regression test:** `tests/ThreeColumnLayout.test.tsx` →
  `first line of a new dialog defaults to Hero (other) speaker (issue #126)`.
  Guards the seeded `informationFunction` block in `useDialogFactory.ts`;
  verified to fail when the speaker is reverted to `self` and pass with `other`.
