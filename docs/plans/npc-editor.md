# NPC Editor

**Status:** Phase 1 built (#284); Phase 2 in progress (#285) — editing an existing NPC works; Phase 3 started (#298); Phase 4 not started.

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

**Still open in Phase 2:**

- **Asset-backed suggestions** — head meshes and walk overlays from the VFS
  (`HUM_HEAD_*.MMB`, `HUMANS_*.MDS`) — and splitting items by category flags
  rather than by the `ITAR_`/`ItMw_`/`ItRw_` prefixes.
- **Jumps from the routines section.** It lists (read-only, built
  2026-09-25) the declared routine and each state variant with their time
  windows and waypoints, from `routineSiteIndex`/`routineNpcIndex`/
  `routineStateIndex` via `npc/npcRoutines.ts` — as of the last project load,
  so a routine edited since is stale until reindex. **Each entry's waypoint now
  jumps to the World surface (2026-09-26)**, with the insert-NPC button's
  reasons when it cannot (`waypointJumpReason` in `components/npcWorldJump.ts`,
  shared by both), and is held while the form has unsaved changes, since the
  jump closes the dialog. Still missing: a jump to the routine's **source**,
  which has nowhere to land — the dialog view shows a function only inside a
  dialog, and there is no source view (`spacer-gap-triage.md` §A4) — and the
  TA state name (`TA_Sit`, …), which `RoutineSite` does not carry.
- **A real-Electron disk-truth spec** (`tests/e2e-electron/`). The browser
  harness proves the flow only; byte fidelity is proven below it, by the
  parser suite and by `tests/parserWorkerNpc.test.ts` against the real
  parser. Not run here: the container had no Electron binary.

## 4. Phase 3 — the visual preview

A bind-pose preview beside the form, reusing `VisualPreviewScene` (#298).

**Built so far (2026-09-26):**

- **Binding: `extractHierarchy(vfs, model)`** — a hierarchy's nodes with
  transforms accumulated to the root, row-major; `.MDH` first, else the
  hierarchy inside the `.MDL`. The first question below is settled by it: a
  body `.MDM` has no `.MDH` beside it (every human body hangs on
  `HUMANS.MDH`), and `extractVisual` emits transforms only for attachments,
  so the head could not be placed from JS without it. The head `.MMB` and the
  body `.MDM` are still extracted by `extractVisual`; JS composes them.
- **`src/renderer/npc/npcVisual.ts`** — `resolveNpcVisual` reads the engine
  externals (`Mdl_SetVisual`, `Mdl_SetVisualBody`, `Mdl_SetModelFatness`; the
  last call wins, as the engine runs them in order) with integer constants
  resolved through a project lookup, and `variantTextureName` does the
  `_V<n>_C<n>` substitution. An NPC whose visual `B_SetNpcVisual` sets last is
  reported undrawable, not guessed: its retail body (body mesh per gender,
  skin, the STR-dependent width `SLD_99003_Farim.d`'s comment mentions) is not
  in the repo to confirm against. Once it is, the mapping goes where that
  refusal is.

**Still open:** the `B_SetNpcVisual` mapping; armour (`visual_change` from the
item's `sourceText`, as the World item picker already does); an IPC path from
the renderer to `extractHierarchy`; the scene composition and the dialog
panel. Whether a soft-skin body's stored positions are its bind pose in model
space (they are drawn as-is by `WorldAssetPreview` today) has not been checked
against a real `HUM_BODY_NAKED0.MDM`.

It needs:

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
