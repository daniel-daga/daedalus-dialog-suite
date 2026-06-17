# GitHub Issues Triage

Fetched 2026-06-11. All issues are open; none have milestones or assignees unless noted.

---

## P1 — Bugs (correctness, blocking user workflows)

### #174 — Wrong variable prefix in LOG_RUNNING condition
`TOPIC_X == LOG_RUNNING` is emitted but should be `MIS_X == LOG_RUNNING`.  
Code generation bug in the condition emitter; look for where `LOG_RUNNING` comparisons are serialized.

### #116 — B_Attack emits `hero` (unknown identifier)
Generated code uses `B_Attack(self, hero, ATTACK_REASON_KILL, 1)` — `hero` is not a valid Daedalus identifier.  
Should use `other`. Fix the Attack action template in the code generator.  
Comment notes `B_SetAttitude(self, ATT_HOSTILE)` is optional; the minimal fix is `hero` → `other`.

### #145 — If/else block: text deleted on "Add Line", missing "knows info" option
Two bugs:
1. Clicking "Add Line" inside an if/else block randomly clears text from the field.
2. "knows info" is missing from the condition type dropdown in the `If` block.

### #117 — Added choice not accessible until user re-clicks NPC
After "Add Choice", the new choice sub-dialog isn't accessible until the user clicks the NPC in the left panel (forcing a refresh).  
Fix: trigger the necessary state update / re-render immediately after choice creation.

### #126 — New dialog line defaults to NPC speaker, should default to Hero
Assigned, confirmed still broken in a comment (2026-03-26).  
Default speaker for the first/new line should be `other` (Hero), not `self` (NPC).

---

## P2 — Small QOL / UX (self-contained, low-medium effort)

### #182 — "Add Dialog Line" ignores nesting level; delete button broken in dropdown
Two issues:
1. "+ Add Dialog Line" only inserts into the top-level hierarchy even when the user is working inside a dropdown-expanded sub-dialog. Should insert at the current nesting level.
2. The trash icon (delete) for lines shown inside a dropdown doesn't work; user must use the sidebar tree instead.

### #181 — Auto-insert dialog line with same text when adding a Choice
When inserting a Choice, the first dialog line under that choice should be pre-populated with the same text as the Choice Text field.  
Side effect: also fixes the UX hole where adding a choice left the dropdown pointing to nothing.

### #140 — "Create Topic" should also insert a "Log Set Status" action
When the user invokes "Create Topic", automatically append a "Log Set Status" action directly below it (preset to `LOG_RUNNING`).  
Also mentioned in comments on #111.

### #123 — New action: Info_ClearChoices
Add `Info_ClearChoices(DIA_...)` as an available action, where the dialog instance name is auto-filled from the current dialog context.  
Discussion in comments suggests this may already be partly handled; confirm and implement the missing piece.

### #119 — New action: Npc_SetRefuseTalk
Add `Npc_SetRefuseTalk(self, <seconds>)` as a new action. Seconds should be an editable field (default 300).

### #183 (item 3) — Tab key doesn't navigate Giver → Receiver → Item field
In "Give Inventory Item", pressing Tab while in the Giver field doesn't move focus to Receiver, and from Receiver doesn't move to the Item field in the same row.  
Standard tab-order fix in the relevant form component.

### #118 — Tab key to jump into choice sub-editor
After inserting a Choice, pressing Tab should directly open / focus the choice's sub-dialog for editing, instead of requiring a mouse click through the sidebar.

---

## P3 — Medium features

### #183 (items 1–2) — Give Inventory Item: swap hero/self button + auto-fill from condition
1. Add a small swap button (or keyboard shortcut) to switch Giver ↔ Receiver in "Give Inventory Item".
2. When "NPC has Item" is used as a condition in the same dialog instance, pre-populate the Item field in "Give Inventory Item" with the item from that condition.

### #111 — Choices: show preceding dialog context (accordion / split-screen)
Currently choices are displayed in isolation. Show the preceding dialog lines as context (accordion expand or split-screen).  
UX approach is open; accordion is the preferred starting point.  
Also covers related QOL items from comments:
- Drag-and-drop reordering of dialog lines (#111 comment).
- Auto-prefix "TOPIC_" and auto-suffix underscores for spaces in "Create Topic" / "Log Entry" names.
- Auto-insert "Log Entry" immediately after "Create Topic" with the same name (#111 comments + #140).

---

## P4 — Larger features

### #141 — Disable "Add NPC"; auto-create EXIT dialog when NPC file appears
1. Disable (or remove) the "+ Add NPC" button — it currently creates NPCs with incorrect parameters.
2. When a new NPC `.d` file is manually dropped into the NPC folder, auto-generate a `DIA_<NPCNAME>_GILDE_ID.d` file with the standard EXIT dialog boilerplate (instance + condition + info functions).

### #147 — Teacher dialog template (Lehrer anlegen)
Complex scaffolding feature: given a skill type (1H, 2H, bow, alchemy, etc.) and optional max level / cost-per-level, generate the full teach dialog boilerplate:
- `DIA_<NPC>_Teach` instance, condition, and info functions
- `Info_AddChoice` calls using `B_BuildLearnString` / `B_GetLearnCostTalent`
- Per-level teach functions using `B_TeachFightTalentPercent`
- Back function with level-gate check

### #114 — "Create Topic" writes to external log/quest files
When "Create Topic" is used, also write to project-level log files:
- `LOG_Constants_<project>.d`: add `const string TOPIC_X = "..."; var int MIS_X;`
- `B_CloseTopics<project>.d`: add `B_CloseTopic(TOPIC_X, MIS_X, <chapterStart>, <chapterEnd>);`
Chapter start/end should be input fields (default 0, 2).  
Depends on knowing which project-specific files to target — needs a project-settings mechanism.
