# Dialog Authoring Automations Reference

Durable editor behaviors added during the 2026 GitHub-issue burn-down
(#111–#183). Each section names its implementation source of truth; the
regression tests live next to the cited modules in
`daedalus-dialog-editor/tests/`.

## New Dialogs and Lines

- A newly created dialog seeds its info function with one line spoken by the
  Hero (`other`), not the NPC (#126). Source:
  `components/hooks/useDialogFactory.ts`.
- New standalone dialog lines default to the opposite speaker of the previous
  line, falling back to `other`. Source: `components/actionFactory.ts`.

## Create Topic

- Inserting a Create Topic action auto-appends a Log Set Status action (preset
  `LOG_RUNNING`) and a Log Entry with the same topic; editing the Create Topic
  topic keeps those siblings in sync while their topics still match (#140,
  #111). Source: `components/hooks/useActionManagement.ts`.
- Topic names are normalized on input: spaces become underscores and a
  `TOPIC_` prefix is enforced (#111). Source:
  `components/actionRenderers/CreateTopicRenderer.tsx`.
- "Register quest in log files" (book icon on the action card, project mode)
  appends `const string TOPIC_X = "…"; var int MIS_X;` to the quest definition
  file and inserts `B_CloseTopic (TOPIC_X, MIS_X, <start>, <end>);` inside the
  `B_CloseTopics…` function body via brace-aware insertion (#114). Target
  files are suggested from project content (most `TOPIC_` constants; file with
  a `B_CloseTopics` function or `B_CloseTopic` calls) and are free-text
  overridable — there is no project-settings mechanism. Registration is an
  explicit action, not a side effect of inserting the action, because topic
  names are typed after insertion. The form initializes only when it opens;
  background-ingestion updates must not clobber user input. Sources:
  `utils/questLogFiles.ts`, `projectStore.registerTopicInLogFiles`,
  `components/RegisterTopicDialog.tsx`.

## Choices

- Creating a Choice seeds its target function with one Hero line carrying the
  Choice Text (the choice label is only the menu entry; the spoken line must
  be repeated in the sub-dialog). Editing the Choice Text mirrors into that
  seeded line only while the line still matches the previous choice text
  (#181). Sources: `components/hooks/useActionManagement.ts`,
  `components/hooks/useDialogEditorCommands.ts`.
- The choice sub-dialog is edited inline through the `InlineChoiceEditor`
  accordion; the preceding dialog stays visible, and add/delete inside the
  accordion operate on the choice's own function at the correct nesting level
  (#111, #182, #117).
- Forward Tab on a focused Choice Text field expands the accordion and moves
  focus to the first sub-dialog line; Shift+Tab and Tab-without-target keep
  normal card navigation (#118). Sources:
  `components/actionRenderers/ChoiceRenderer.tsx`,
  `components/InlineChoiceEditor.tsx`.

## Multi-Field Action Rows

- In multi-field renderers, Tab walks the fields of the row natively; only Tab
  on the last field / Shift+Tab on the first fall back to card-to-card
  navigation (#183). Helper:
  `components/actionRenderers/rowTabNavigation.ts`, wired into every flat
  multi-field renderer: Give Inventory Items, Remove Inventory Items, Create
  Inventory Items, Attack, Set Variable, Start Other Routine, Pickpocket
  (field count follows the mode: `C_Beklauen` adds Min/Max), Log Entry, Create
  Topic, Log Set Status, Chapter Transition, Exchange Routine, Play Animation,
  Insert NPC, Refuse Talk, Set Attitude, and Teach. Only keyboard-focusable
  inputs count as row fields — `tabIndex={-1}` icon buttons and plain labels do
  not shift the indices. Intentionally excluded: Choice (bespoke #118
  dive-into-sub-dialog Tab handling), Conditional (nested branches, not a flat
  row), Dialog Line (line-specific card semantics), and single-field renderers
  (nothing to walk).
- Give Inventory Items has a mouse-only swap button (Giver ↔ Receiver), and
  the action factory pre-fills the Item from the dialog's `Npc_HasItems`
  condition when one exists (#183). Buttons that are mouse-only affordances
  (swap, follow-reference, register-quest) carry `tabIndex={-1}` so row Tab
  order stays clean.

## NPC Lifecycle

- There is deliberately **no** "Add NPC" button — it created NPC instances
  with incorrect parameters (#141). NPCs enter a project by placing an NPC
  `.d` file in the project folder. "Add Dialog" likewise never generates an
  NPC instance file: creating a dialog for an NPC without a parsed `C_NPC`
  instance only creates the dialog.
- When the file watcher sees a new file whose instances are NPCs (direct
  `C_NPC` parent or a prototype whose chain reaches `C_NPC` —
  `ProjectIndex.npcPrototypes`, computed by `ProjectService`), and the NPC has
  no dialogs yet, the editor auto-creates `DIA_<InstanceName>.d` with the
  standard EXIT dialog (`nr = 999`, `description "ENDE"`, permanent,
  `AI_StopProcessInfos (self)`), placed in the directory where most dialog
  files live. Existing files are never overwritten; short-name collisions
  (`DIA_Robert_EXIT` taken) fall back to the full instance name (#141).
  Sources: `utils/npcExitDialog.ts`, `hooks/useFileWatcher.ts`.

## Teacher Dialogs

- "Create Teacher Dialog" (school icon in the Dialogs pane, project mode)
  scaffolds a full teacher into a new `DIA_<Short>_Teach.d`: permanent
  instance, condition returning `TRUE`, engine-standard costs (#147). The
  skill select is grouped by category (`TEACHER_SKILL_GROUPS`); each category
  emits the matching vanilla NotR teach builtin:
  - **Fight talents** (1H, 2H, Bow, Crossbow — `TEACHER_SKILLS` table): info
    function remembers `other.HitChance[<talent>]`, +1/+5 learn choices via
    `B_BuildLearnString`/`B_GetLearnCostTalent`, per-step
    `B_TeachFightTalentPercent` functions with the configured max level as
    cap, and a level-gated Back function.
  - **Attributes** (STR, DEX, MANA): same leveled shape over
    `other.attribute[ATR_*]`; +1/+5 costs via `B_GetLearnCostAttribute`
    (`* 5` for the +5 step) and per-step `B_TeachAttributePoints` with the
    configured cap (vanilla pattern: `DIA_VLK_461_Carl.d`).
  - **One-shot talents** (no Max Level field — learned once): each choice
    calls its builtin, which handles LP cost and failure messages itself.
    Hunting emits `B_TeachPlayerTalentTakeAnimalTrophy` for the Grom trophy
    set (fur, teeth, claws, heart, mandibles, shadowbeast horn); alchemy
    emits `B_TeachPlayerTalentAlchemy` for the health/mana 1–3 and speed
    recipes; thief emits `B_TeachThiefTalent` for sneak, picklock and
    pickpocket. Choice labels are vanilla `Text.d` constants
    (`NAME_LEARN_*`, `NAME_*Potion*`, `NAME_TALENT_PICKPOCKET`).

  Sources: `utils/teacherDialogTemplate.ts`, `utils/teacherDialogFactory.ts`,
  `components/DialogTree.tsx`.

## Trader Dialogs

- "Create Trader Dialog" (storefront icon in the Dialogs pane, project mode)
  scaffolds the standard merchant dialog into a new `DIA_<Short>_Trade.d`:
  permanent instance with `trade = TRUE` and `nr = 700` (before the EXIT
  entry at 999), condition returning `TRUE`, and an info function calling
  `B_GiveTradeInv (self);` (vanilla shape: `DIA_VLK_413_Bosper.d`). The form
  only asks for the menu description (default `"Zeig mir Deine Waren."`); no
  `AI_Output` lines are emitted because voice numbers are unknowable at
  scaffold time. Name collisions get a numeric suffix; file resolution,
  overwrite guard and project indexing follow the teacher factory. Sources:
  `utils/traderDialogTemplate.ts`, `utils/traderDialogFactory.ts`,
  `components/DialogTree.tsx`.

## Testing Constraint: Native Parser in Jest

The native tree-sitter binding cannot be loaded into more than one Jest module
registry per worker process — whichever suite requires `daedalus-parser`
second in a shared worker fails with `tree.rootNode` undefined.
`ProjectService.test.ts` holds the one in-process slot; any other suite that
must validate generated source against the real parser runs the parse in a
**child process** (see `tests/npcExitDialog.test.ts` /
`tests/teacherDialogTemplate.test.ts` for the pattern).
