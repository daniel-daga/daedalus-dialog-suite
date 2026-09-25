# NPC Editor

**Status:** proposed, 2026-09-25. No code exists.

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

**Open question:** does `NpcDefinition` hang off `GlobalInstance` (computed in
the declaration pass) or get computed on demand in the renderer? On demand
avoids growing every parse for the minority of files that hold NPCs; measure
the parse cost on a full G2 script tree before deciding.

## 3. Phase 2 — the form editor

A new NPC surface in the renderer, reached from `NPCList` / `NpcColumn` ("Edit
NPC"). It opens the file holding the instance, as a dialog opens today, so it
works from that file's semantic model and needs nothing new from main.

Every control's options come from the project, never a hard-coded list:

| Control | Source |
|---|---|
| guild, flags, NPC type, fight tactic, voice | script constants (`GIL_*`, `NPC_FLAG_*`, `NPCTYPE_*`, `FAI_*`) and the existing voice ids |
| face / body texture | script constants (`Face_*`, `BodyTex_*`) |
| head mesh, walk overlay | the asset VFS (`HUM_HEAD_*.MMB`, `HUMANS_*.MDS`) |
| weapons, armour | the items index, split by the item's category flags |

With no project constants for a field the control degrades to free text; with
no asset sources configured the VFS-backed controls degrade the same way. An
empty index means "nothing is known", never "nothing is legal" — the same rule
the World surface follows for `oCItem.instance`.

The routines tab is read-only at first: it lists the NPC's `Rtn_*_<id>`
functions and their `TA_*` entries from the existing index, and jumps to them.
Editing routines is its own later slice.

**Create NPC** writes a new instance from a template into a chosen file and
offers the existing `Wld_InsertNpc` insertion. The `id` is proposed as the next
free one in the project.

This is a new UI workflow: Playwright spec first (`tests/e2e/`) — open an NPC,
change its guild and level, save, and assert the file changed only on those two
lines.

## 4. Phase 3 — the visual preview

A bind-pose preview beside the form, reusing `VisualPreviewScene`. It needs:

1. **Resolve the visual from the definition.** From `Mdl_SetVisual` +
   `Mdl_SetVisualBody` directly, or from the vanilla `B_SetNpcVisual(slf,
   gender, head, face, bodyTex, armor)` arguments by the same mapping that
   helper's body applies. Confirm that mapping against retail scripts before
   coding it.
2. **Body:** the body mesh (`HUM_BODY_NAKED0` → `.MDM` + `HUMANS.MDH`), or the
   armour item's `visual_change` mesh when armour is equipped.
3. **Head:** the head `.MMB` attached at the head node (`BIP01 HEAD`) of the
   hierarchy.
4. **Textures:** ZenGin's variant renaming — the base texture name with
   `_V<variant>_C<skin>` substituted — applied to body and head textures,
   resolved through the VFS.
5. **Fatness** as a scale on the torso, matching `Mdl_SetModelFatness`.

Binding work: `zenkit-node` extracts a model or a morph mesh on its own today;
the preview needs the head placed at a named node of the body's hierarchy and
the node transforms exposed to JS. Whether that is a new binding call or a JS
composition of two existing extractions is the first thing to settle.

Animation (idle pose, walk overlay) is out of scope: it needs `.MAN` reading in
the binding and a skinning path in the renderer.

**The main risk is mods.** `B_SetNpcVisual` and the attribute helpers are
script functions and mods rewrite them. Recognise the vanilla signatures only;
when an NPC's visual is set any other way, the preview says it cannot draw it
and why. It does not guess.

## 5. Phase 4 — real NPCs in the world

With Phases 1 and 3 in place, `SpawnOverlay`'s capsule dummy can become the
NPC's mesh. This needs the per-NPC visual available where the World surface is,
which is the renderer: resolve the definitions of the NPCs actually spawned in
the open world, instance the meshes by visual (many NPCs share a body), and keep
the dummy as the fallback for any NPC Phase 3 cannot draw. This closes the
"NPC-Rendering im Viewport" item of `docs/plans/level-editor-design-brief.md`.

## 6. Order and size

1 → 2 → 3 → 4. Phase 1 is the bulk and carries the fidelity risk; 2 is UI on
top of it; 3 is mostly asset plumbing that already exists; 4 is small once 3
works. Phase 3 can start in parallel with 2 once Phase 1's `NpcDefinition`
shape is fixed.
