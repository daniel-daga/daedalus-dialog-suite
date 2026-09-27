# NPC Editor

**Status:** Phases 1–4 built (#284, #285, #298, #309). NPC bodies now render at world spawn and routine placements.

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

Suggestions come from what the project has already ingested
(`mergedSemanticModel.constants`/`items`, `routineList`); every control stays
free text.

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

- **VFS suggestions are built (2026-09-27).** With a World open, head mesh and
  walk overlay suggestions come from `HUM_HEAD_*.MMB` and `HUMANS_*.MDS` VFS
  searches; without one, both controls remain free text. The form edits the
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
  files. The meshes come from the world worker's VFS, **which exists only
  while a world is open** — so with none open the panel says what it would
  draw and asks for a world. Mounting the asset sources without a world is
  the fix if that proves to be in the way.

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

## 6. Order and size

1 → 2 → 3 → 4. Phase 1 is the bulk and carries the fidelity risk; 2 is UI on
top of it; 3 is mostly asset plumbing that already exists; 4 is small once 3
works. Phase 3 can start in parallel with 2 once Phase 1's `NpcDefinition`
shape is fixed.
