# NPC Editor

**Status:** Phases 1–4 built (#284, #285, #298, #309). NPC bodies now render at world spawn and routine placements.
Phase 5 (authoring routines) is in progress — the model, the draft operations, the routine editor and the World surface's routine mode are built (#312, #314, #315, #317); creating a routine is next (#316).

An editor for `C_NPC` instances inside the dialog editor, covering what the
community's standalone *NPC Generator* covers (main info, attributes, protection,
hit chances, visual, equipment, daily routines) and adding what that tool cannot
do: edit an NPC that already exists without losing a line of it, and show the
NPC as the engine would draw it.

## 1. Where things stand

The parser does not model an NPC body. `GlobalInstance`
(`daedalus-parser/src/semantic/semantic-model.ts`) keeps `name`, `parent`,
`displayName`, `dailyRoutine`, `npcId` and the verbatim `sourceText`, and the
generator re-emits `sourceText` unchanged. Everything else in the body is
opaque.

`ProjectIndex` in main carries NPC *names* only, and main holds no semantic
model by design (`CLAUDE.md`). The World surface's spawn overlay draws a capsule
dummy for exactly this reason (`docs/architecture/level-editor.md`, "What Phase
1c does not reach"). The item picker in `WorldSurface.tsx` already works around
the same gap by regexing `visual` out of an item's `sourceText`.

What already exists and this plan reuses:

- `zenkit-node` reads `.MDM`/`.MDL` with their `.MDH` hierarchy, `.MMB` morph
  meshes (the head format) and decodes ZTEX textures to RGBA8
  (`zenkit-node/src/assets.cc`, `mesh_extract.cc`).
- `WorldAssetPreview.tsx` + `world/VisualPreviewScene.ts` already put one
  extracted visual in a small orbitable Three.js scene.
- The asset VFS is configured through `AssetSourcesDialog.tsx`.
- Routines are indexed: `routinesByNpc`, `routineSites`, and
  `routines/routineSchedule.ts` resolve an NPC's `TA_*` entries.
- `InsertNpcDialog.tsx` / `insertNpcScript.ts` already append a
  `Wld_InsertNpc` to the right `STARTUP_<world>` function.

## 2. Phase 1 — a structured NPC model in the parser

**Built (#284).** Its acceptance is held by `test/npc-definition.test.js`: the
corpus file `items-npcs-mds.d` saves byte-identical unedited, and a set, add or
remove on its retail-shaped Onar changes exactly one line of the file. That
last check needed #286 (blank lines between declarations) first.

This is the only large phase; the others are thin on top of it.

An extractor over an instance whose parent resolves to `C_NPC` (directly or
through a prototype such as `Mst_Default_*`/`Npc_Default`) produces an
`NpcDefinition`: a list of **recognised statements**, each with its source
range, and the **unrecognised** ones kept verbatim in order.

Recognised, first cut:

| Kind | Examples |
|---|---|
| field assignment | `name`, `guild`, `id`, `voice`, `flags`, `npctype`, `level`, `fight_tactic`, `daily_routine` |
| indexed field | `attribute[ATR_*]`, `protection[PROT_*]`, `HitChance[NPC_TALENT_*]`, `aivar[AIV_*]` |
| helper call | `B_SetAttributesToChapter`, `B_SetFightSkills`, `B_GiveNpcTalents`, `B_SetNpcVisual` |
| engine call | `Mdl_SetVisual`, `Mdl_SetVisualBody`, `Mdl_SetModelFatness`, `Mdl_ApplyOverlayMds`, `EquipItem`, `CreateInvItems` |

A value is kept as an expression, not coerced: `guild = GIL_OUT` stays the
constant name; a literal stays a literal; anything else is shown and preserved
but not editable through a form control.

**Writing back patches, it does not regenerate.** An edit replaces the source
range of the statement it changed; a new field is inserted after the last
statement of its kind (or before the closing brace); a removed one deletes its
range. Comments, blank lines, statement order and every unrecognised statement
survive byte for byte. This keeps the save pipeline's contract
(`docs/architecture/save-pipeline.md`) and the fidelity bar in
`docs/architecture/parser-fidelity.md`.

Tests (TDD, `daedalus-parser/test/`):

- extraction of each recognised kind, including through a prototype parent;
- an unedited NPC round-trips byte-identical — extend the corpus
  (`test/fixtures/corpus/items-npcs-mds.d` is the natural home, or a new
  `npcs.d`) with retail-shaped NPCs: vanilla helper calls, raw `Mdl_*` calls,
  comments between statements, an NPC with an unrecognised statement;
- editing one field changes exactly one line; adding and removing a field
  touch only their own line.

**Decided while building it** (#284):

- **On demand, not in the declaration pass.** `extractNpcDefinition(sourceText)`
  re-parses one instance. Whether an instance is an NPC is decided through
  prototype chains that usually live in another file (`Npc_Default` is
  declared once, used everywhere), which a per-file parse cannot see; the
  project index already resolves them (`ProjectService`'s `isNpcParent`). So
  the caller decides, and no parse pays for instances nobody opens.
- **Classified by shape, not by a name list.** Every body statement is a
  `field` (`x = …`, `x[i] = …`), a `call` (`Name(…)`), or `other`. The table
  above is what the form will offer controls for, not what the parser
  recognises.
- **The writer edits `sourceText`**, so an edited NPC saves through the
  existing generator with no change to it. It is pure string work over
  ranges from the original parse, and lives in the parser package as the
  `daedalus-parser/npc-definition` subpath (API in `daedalus-parser/API.md`).
  The renderer imports nothing from `daedalus-parser` today, so Phase 2 reaches
  both functions through main.
- **A repeated call is addressed by occurrence.** Retail calls `EquipItem`
  once per weapon, so `setCall`/`removeCall` take a 0-based `occurrence`
  among the calls of that name, and `addCall` always inserts (after the last
  call of that name) rather than overwriting the first.

## 3. Phase 2 — the form editor

**First slice built (#285, 2026-09-25): edit an existing NPC.** An "Edit NPC"
button on an `NPCList` row opens `NpcEditorDialog`, a modal form over that
NPC's instance. What it rests on:

- `ProjectIndex.npcFiles` — UPPERCASED NPC instance → declaring file, built in
  `ProjectService` beside `npcPrototypes`; the renderer holds it as
  `projectStore.npcFileIndex`. Only an NPC with an instance gets the button.
- Two IPC channels, `npc:extract` and `npc:applyEdits`, validated by
  `assertNpcApplyEditsRequest` (identifiers for names, one non-empty line per
  value) and answered by the **forked parser pool** — `parser.worker.ts`
  gained an `npc` request kind — so no native parse runs in Electron main.
- `src/renderer/npc/npcForm.ts` — the pure half: which controls exist
  (main info, attributes, hit chance, protection, the five `B_SetNpcVisual`
  arguments, and a melee and a ranged weapon — the first `EquipItem` whose item
  starts `ItMw_`/`ItRw_`, edited by its occurrence; a third weapon stays among
  the other statements), reading them from a definition, turning a changed form into
  edits, validating it, and listing the statements no control covers (shown
  read-only as "Other statements"). String controls (name, head mesh) show a
  literal's content and write it back quoted; a constant that stood there
  stays an expression.
- The save opens the file through the file store (keeping the main view's
  active file), replaces the instance's `sourceText` in its model and runs the
  ordinary `saveFile` — validation, conflict handling and store sync included.

Combo box choices come from the parsed project files, indexed routines, and
mounted assets. Typing filters a field's choices; selecting one changes the NPC.
Reopening the field shows the full list. Fields without an option source remain text inputs.

**Create NPC built (#285, 2026-09-26).** "New NPC" in the NPC list's header
opens `CreateNpcDialog`: the new instance is a **copy of an NPC the project
already has**, not a template of ours — #141 removed an Add NPC that wrote
parameters a mod need not define, and a copy uses only what the mod does
(Daniel's call, 2026-09-26). `npc/npcTemplate.ts` renames the instance header
and the parser's writer sets `name`, `guild` and `id` and removes
`daily_routine` (the template's day is its own NPC's). The id offered is one
past the highest in retail-style names (`BAU_900_Onar` → 901); the file is
`<instance>.d` in the folder most NPC files live in. The new file goes through
the file watcher's `handleFileAdded`, since the watcher suppresses the
editor's own writes, so it is indexed and gets its EXIT dialog (#141) like a
dropped-in file. The `Wld_InsertNpc` offer is not part of it: the World
surface's insert already does that, and it needs a waypoint.

**Phase 2 completed (2026-09-27):**

- **VFS suggestions are built (2026-09-27).** Head mesh and walk overlay
  choices come from `HUM_HEAD_*.MMB` and `HUMANS_*.MDS` VFS searches after
  NPC preview assets are mounted. The form edits the
  first matching `Mdl_ApplyOverlayMds` call and leaves other overlays alone.
  Armor and weapon suggestions are filtered by each item's parsed `mainflag`
  category, so custom item names work without relying on Gothic's usual prefixes.
- **Jumps from the routines section.** It lists (read-only, built
  2026-09-25) the declared routine and each state variant with their time
  windows and waypoints, from `routineSiteIndex`/`routineNpcIndex`/
  `routineStateIndex` via `npc/npcRoutines.ts` — as of the last project load,
  so a routine edited since is stale until reindex. **Each entry's waypoint now
  jumps to the World surface (2026-09-26)**, with the insert-NPC button's
  reasons when it cannot (`waypointJumpReason` in `components/npcWorldJump.ts`,
  shared by both), and is held while the form has unsaved changes, since the
  jump closes the dialog. **A source jump is built (2026-09-27):** it opens the
  routine's raw file at the indexed TA line in a read-only view and highlights
  that line, and labels each entry with its TA state name (`TA_Sit`, …).
- **Real-Electron disk truth is covered (2026-09-27).**
  `tests/e2e-electron/npc-editor-disk-truth.spec.ts` edits an NPC field through
  the real app, checks the bytes on disk, and reparses them through the real
  parser.

## 4. Phase 3 — the visual preview

A bind-pose preview beside the form, reusing `VisualPreviewScene` (#298).

**Built so far (2026-09-26):**

- **Binding: `extractHierarchy(vfs, model)`** — a hierarchy's nodes with
  transforms accumulated to the root, row-major; `.MDH` first, else the
  hierarchy inside the `.MDL`. The first question below is settled by it: a
  body `.MDM` has no `.MDH` beside it (every human body hangs on
  `HUMANS.MDH`), and `extractVisual` emits transforms only for attachments,
  so the head could not be placed from JS without it.
- **`zen-world`'s `buildNpcBody`** composes body and head in the world worker
  (IPC `world:npcBody`): the body model (`.ASC` appended to a bare script
  name), the head `.MMB` placed by `BIP01 HEAD`'s transform, and
  `Mdl_SetModelScale` applied to both. Body variation is applied only to naked
  skin materials, face variation only to head skin, and the teeth setting only
  to teeth; armor and mouth materials keep their own texture names. A head it
  cannot place is left off and named in `missing`, never guessed at.
- **`src/renderer/npc/npcVisual.ts`** — `resolveNpcVisual` reads the engine
  externals (`Mdl_SetVisual`, `Mdl_SetVisualBody`, `Mdl_SetModelFatness`; the
  last call wins, as the engine runs them in order) with integer constants
  resolved through a project lookup. `B_SetNpcVisual` is expanded in place into the
  engine calls its **retail** body makes (Daniel supplied it, 2026-09-26):
  `HUMANS.MDS`; a man on `hum_body_Naked0`, width 0.9 below 50 strength and
  1.1 above 100 (no scale between); a woman on `Hum_Body_Babe0` with a male
  body texture 0–3 moved up by 4; skin colour and teeth always 0. The width
  needs the strength *where the helper runs*: only a literal
  `attribute[ATR_STRENGTH]` before it counts, and any script call or
  unclassified statement in between (`B_SetAttributesToChapter` sets it) makes
  it unknown — then the width is assumed normal and the result carries a note
  saying so. A mod that rewrote the helper is drawn by the retail mapping
  regardless; checking the project's own helper body against it is not done.

- **Armour**: `npcBodyRequest` replaces the body with the armour item's
  `visual_change`, read from the item's `sourceText` as the World item picker
  reads `visual`; an armour it cannot find is named and not drawn.
- **The panel**, `NpcVisualPreview`, sits in a sticky column beside the form
  and follows unsaved edits (`withEdits` applies the form's pending edits in
  memory, where the writer would put them, since statement order is what the
  width rule reads). Constants and items come from every parsed file, not
  `mergedSemanticModel`, which holds only the globals and the selected NPC's
  files. The meshes come from the world worker's VFS. The NPC editor mounts
  the active project's configured asset sources on demand when no world is
  open, so previewing an NPC does not require opening a level.

**Retail asset check (2026-09-27, accepted by Daniel):** the Nameless Hero's `PC_L10` test
definition, `Hum_Head_Pony`, and light militia armor (`ITAR_MIL_L` →
`Armor_Mil_L.asc`) resolve and render in Electron. The initial image looked
bald and had an almost black neck because the preview flipped every model
texture vertically. Retail head, skin and armor maps all use the stored UV
origin, unlike the world mesh maps. The NPC body variation had also been
applied to armor materials, and the face variation to the shared mouth
material. Those variants are now selected independently. The body mesh's
stored positions are not its rendered rest pose. Each soft-skin vertex is
weighted from its bone-local positions into the model hierarchy, as in
OpenGothic's renderer. A naked body uses `HUMANS.MDH`; compiled armor models
use their own embedded hierarchy. The head attaches to that same hierarchy's
`BIP01 HEAD`. This joins the head and neck in front and rear Electron captures
of both naked and militia-armored `PC_L10`. Daniel accepts the visual result;
the preview is not claimed as an exact engine reproduction.

**Remaining preview work:**

- **Fatness (#310):** now deforms spine/pelvis weighted vertices in the
  procedural skinning path, independently of `Mdl_SetModelScale`. The current
  preview mapping changes local torso breadth by 10% per script unit; compare
  against a retail in-game capture before treating that mapping as engine
  faithful.
- **Animation (#311):** selecting “Scrub idle animation” loads the `S_IDLE`
  `.MAN` referenced by the model's `.MDS` script and samples its frames through
  the existing skinning path. The normalized frame slider and native fixture
  test cover selection and sampling; playback, walk overlays, and animation
  events remain future work. This preview path has not been compared against a
  retail in-game animation capture.

**The main risk is mods.** `B_SetNpcVisual` and the attribute helpers are
script functions and mods rewrite them. Recognise the vanilla signatures only;
when an NPC's visual is set any other way, the preview says it cannot draw it
and why. It does not guess.

## 5. Phase 4 — real NPCs in the world

**Complete** (#309).

The World surface resolves only spawned NPC definitions, requests their composed
bodies through the open world's VFS, and draws the body groups as instanced
meshes at static spawns or routine placements. NPCs sharing a body and texture
groups share batches. The capsule remains for definitions or assets that cannot
be resolved, and the spawn marker remains visible beside each body. This closes
the "NPC-Rendering im Viewport" item of
`docs/plans/level-editor-design-brief.md`.

## 6. Phase 5 — authoring routines

**Workshop with Daniel, 2026-09-28.** Slices 1, 3, 4 and 6 are built, slice
2 turned out not to be needed; the rest are #316 and #318.

Everything a routine editor reads already exists: `routineSites`,
`routinesByNpc` and `routineStatesByNpc` in the project index, the World
surface's time and state lens (`docs/architecture/level-editor.md`, "The time
and state controls are a lens"), the `routine-overlap` Problems rule, the NPC
editor's read-only routine list with its waypoint and source jumps, and NPC
bodies at routine placements (Phase 4). What is missing is the write side:
today a routine can only be read.

A routine in retail is a function at the bottom of the NPC's own file:

```daedalus
FUNC VOID Rtn_Start_900 ()
{
	TA_Sit_Throne	(07,00,22,00,"NW_BIGFARM_HOUSE_ONAR_SIT");
	TA_Sleep		(22,00,07,00,"NW_BIGFARM_HOUSE_UP1_04");
};
```

### Decisions (Daniel, 2026-09-28)

- **World first.** Routines are authored in a *routine mode* of the World
  surface. An editable table in the NPC editor comes after, over the same
  model.
- **Existing waypoints only.** A stop is placed on a waypoint the waynet
  already has; routine mode never creates one (the waynet tools do). So a
  routine save touches one `.d` file and never the `.zen`, and there is no
  two-file transaction to design.
- **The daily routine and its variants.** `Rtn_Start_<id>` and every
  `Rtn_<State>_<id>` variant, the variant chosen through the existing State
  picker. Same model for both; a variant is just another routine function.
- **Paths follow the waynet.** Consecutive stops are joined by the shortest
  route over the waynet's edges, not a straight line, so a stop the waynet
  cannot reach is visible. A leg with no route is drawn as a straight dashed
  line in the warning colour and named in the panel. What the engine does with
  such a leg is unmeasured; the editor only says the waynet has no route.
- **The day is edited as a partition.** Moving a boundary on the timeline
  moves the neighbouring entry's edge with it, so an edit never creates a gap
  or an overlap by accident; Alt-drag detaches one edge. A routine that
  already has gaps or overlaps opens as it is and shows them. It is never
  silently repaired.
- **Draft + Save.** Routine mode edits a draft with its own undo; Save writes
  the `.d` through the ordinary `saveFile` pipeline (validation, conflict
  handling, store sync), as `NpcEditorDialog` does. Leaving the mode with
  unsaved changes asks.
- **Two ways in.** An "Edit routine in world" button in `NpcEditorDialog`,
  and a click on an NPC body or spawn marker in the viewport. No NPC search
  list in the first cut.
- **The state-needs check is a later slice.** Warning when `TA_Sleep` has no
  bed near its waypoint, or `TA_Sit` no bench, needs a state → mob-scheme
  table measured against retail first (the §16.22 precedent in
  `level-editor.md`: the number comes first, and it may kill the check).

### What a user of another NPC editor expects (2026-09-28)

Relayed by Daniel: routines listed at the top (for example one per chapter),
and below them the selected routine's *Tätigkeiten* (activities), each picked
from a dropdown and given a time window and a waypoint — "stand guarding,
13:30–14:00, at WP_x". A second routine is where the day changes later.

That is this model already: the routines are the daily routine and its
`Rtn_<State>_<id>` variants, an activity is one `TA_*` entry, and the dropdown
is the project's wrapper list. So the routine-mode panel and the NPC editor's
table take that layout, and the UI says *activity* for an entry. Two things it
adds:

- **Minutes matter.** 13:30–14:00 is a half-hour activity, which settled the
  snap step below.
- **A variant does nothing until a script switches to it.** Retail has no
  chapter routines; a chapter is a spawn guard, and a routine changes through
  `Npc_ExchangeRoutine` / `B_StartOtherRoutine` at a story event
  (architecture §8, "States are events, not chapters"). So each variant in the
  list shows where it is triggered, from the index's `exchangeSites` (which has
  no consumer yet), and says so when nothing literal triggers it. Writing the
  trigger stays in the dialog editor, which already has the exchange-routine
  action.

### Slices

1. **Reader/writer** (#312). **Built 2026-09-28, in the renderer rather than
   the parser.** The plan said a `routine-definition` subpath patching the
   function's text, but the file's semantic model already keeps each body
   statement verbatim as one `Action`, and a save regenerates the function
   from its actions — as `insertNpcScript`'s `Wld_InsertNpc` append already
   relies on. So `routines/routineEntries.ts` reads a routine function's
   actions into entries and writes entries back as a new actions list, and
   the save is the ordinary `saveFile`. No parser subpath, no IPC.
   **The argument layout is `ProjectIndex.routineLayouts`**, the index's
   `buildRoutineParamIndex` result now carried to the renderer (UPPERCASED
   callee → argument positions), not a name convention (architecture §8, "A
   wrapper's argument layout is found by following the call"). What the
   writer decides:
   - Within an action it rewrites only the tokens whose value changed, at
     their original width, so alignment tabs, `08` against `8` and a `24` for
     midnight survive every edit that does not touch them.
   - An end at midnight is written as hour 24, as retail writes it, unless the
     window starts at midnight too: `(00,00,00,00)` is the whole-day idiom.
   - A new entry goes after the action of the entry before it, spaced like the
     routine's first call (the gap before `(`, and whether `,` is followed by a
     space), with two-digit times.
   - A changed state whose layout matches is a rename of the callee; one whose
     layout differs is rewritten from the entry alone, and **refused** when the
     layout has positions an entry cannot fill (`TA_MIN` also wants `self` and
     a `ZS_*` state). A minute on an hour-only `TA` is refused too.
2. **IPC** (#313). **Not needed** — see slice 1; closed.
3. **Pure domain** (#314). **Built 2026-09-28.** `routines/routineDraft.ts`:
   `moveBoundary` (the neighbour sharing the boundary follows unless
   detached), `splitEntry`, `removeEntry` (the window goes to the entry
   ending where it started, else the one starting where it ended),
   `setState`, `setWaypoint`. **No window may become empty**, because
   `start === end` is the whole day: a move is clamped one minute inside,
   towards whichever end of the allowed arc the pointer is nearer.
   `routines/waynetRoute.ts`: Dijkstra by straight-line edge length over the
   payload, `null` when there is no route or no such waypoint.
4. **Routine mode in the World surface** (#315). **The panel is built
   (2026-09-28)**; the World half is not. `components/RoutineEditor.tsx`'s
   `RoutineEditorPanel` holds the routines at the top (each variant with its
   chapter and switches, see "Chapters"), a 24-hour timeline whose boundaries
   drag in quarter hours (Alt detaches, arrow keys step), and one row per
   activity: state, typed start and end, waypoint, remove. The draft has its
   own undo; Save goes through `components/routineSave.ts` and re-indexes the
   file. The state picker lists every layout an activity alone can fill,
   spelled as declared (`routineLayouts[…].name`), so `TA` and `TA_MIN` are
   not offered. Covered by `tests/e2e/routine-editor.spec.ts` in the browser
   harness, which has no world by design, so the panel is driven from the NPC
   editor there.
   **The World half is built too (2026-09-28).** Routine mode takes the
   World surface's right panel (`hooks/useRoutineMode.ts`), opened by "In
   world" beside each routine in the NPC editor (a `routineRequest` in
   `worldStore`, consumed once like `focusRequest`) or by a click on a spawn
   marker, which lists who stands there. `PickController` asks the spawn
   markers after the waynet — its click is the older rule and lands on the
   same points — and before every VOB; `SpawnOverlay.pickOccupants` picks in
   pixels like a waypoint. `world/RoutineOverlay.ts` draws the draft: a
   stop per activity in its row's colour (`ROUTINE_COLORS`, in
   `routineDraft.ts` so the NPC editor's bundle does not pull in three.js),
   the selected one marked, routes along the waynet between consecutive stops
   of the day, and a leg with no route as a dashed straight line. "Pick" on
   an activity arms the next waypoint click; `worldStore.savedWaypoints` —
   the first waynet an open reads, then whatever a save wrote — decides
   whether it is taken, and one added since is refused in the status bar
   with the reason. **Not done:** the stops carry colour, not the number the
   plan named (there is no text in the scene; the names layer is DOM and
   driven from the draw loop), and the real-Electron disk-truth spec, which
   needs a world the ubuntu job cannot open.
5. **An NPC with no routine** (#316). "Create routine" appends
   `FUNC VOID Rtn_Start_<id> ()` to the end of the NPC's file with one
   whole-day entry at its spawn waypoint and sets `daily_routine` through
   `npc-definition`'s writer. A new variant is `Rtn_<State>_<id>` with the
   state name typed. Both need a literal `id`; an NPC without one is refused,
   with that reason.
6. **Editing without a world** (#317). **Built 2026-09-28** as the same panel
   in a modal, `RoutineEditorDialog`, opened by "Edit" beside each routine
   in the NPC editor's routines section. That section now follows the index,
   so a saved routine shows there without reopening.
7. **Later: the state-needs check** (#318) (see the last decision above).

### Chapters (Daniel, 2026-09-28: "differences in chapters are important")

Retail has no chapter routine: a routine changes only because a script calls
`B_StartOtherRoutine`/`Npc_ExchangeRoutine` with a state name, and a chapter
change is one place such a call sits (architecture §8, "States are events,
not chapters"). So a chapter routine is a `Rtn_<State>_<id>` variant plus the
call that switches to it, and the editor shows it that way. **Built
2026-09-28:** `variantSwitches` (`npc/npcRoutines.ts`) lists, for each
variant, the literal calls that switch this NPC to it (a `self` target is
kept and marked, since the index cannot resolve it), and reads the chapter
off the switching function's name (`B_Enter_NewWorld_Kapitel_3`) or the
state's (`Kapitel4`). The routine editor shows "Chapter N" and "Switched to
in …" under each variant, from the index's `exchangeSites`, which had no
consumer before.

Not done, and each needs something first:

- **A switch under an `if (Kapitel == 3)` guard** in a function not named
  for the chapter. The exchange-site index does not record the enclosing
  guard, so it reads as no chapter. Recording it is a metadata change, and
  how often retail and mods switch that way is unmeasured
  (`check-routine-states.js` over `mdk/Content`, Daniel's machine).
- **Creating a chapter routine**: a new variant and the call that switches to
  it, written into the chapter's function. Which function a mod uses for
  that is a convention the editor does not know yet. Slice 5 (#316).

### Decided before slice 4 (Daniel, 2026-09-28)

- **Snap: 15 minutes, plus typed fields.** A dragged boundary snaps to the
  quarter hour; each activity also has start and end fields for an exact
  minute (13:05).
- **Re-index in main after Save.** Nothing re-indexed routines after a load
  before this, not even for an external edit. After a routine save the
  renderer asks main for the saved file's routine sites
  (`project:routineSitesOfFile`, with the current `routineLayouts`, since the
  wrappers live in another file), and replaces that file's entries in
  `routineSiteIndex` — one source of truth, the same extraction the load runs.
- **Saved waypoints only.** Routine mode offers the waypoints the world file
  on disk has: the waynet's names as of the last open or save. A waypoint
  added since is not offered until the world is saved.

## 7. Order and size

1 → 2 → 3 → 4. Phase 1 is the bulk and carries the fidelity risk; 2 is UI on
top of it; 3 is mostly asset plumbing that already exists; 4 is small once 3
works. Phase 3 can start in parallel with 2 once Phase 1's `NpcDefinition`
shape is fixed.

Phase 5's remaining work: slice 5, then the state-needs check (7).
