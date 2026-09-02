# zenkit-node

N-API binding around [ZenKit](https://github.com/GothicKit/ZenKit) for loading
and re-saving ZenGin worlds, plus the `zen-roundtrip` fidelity harness.
Phase 0 of the level-editor plan — see
[`docs/plans/level-editor-phase-0.md`](../docs/plans/level-editor-phase-0.md).

> **A green CI run is NOT a fidelity claim.** CI runs only against tiny
> synthetic fixtures that ZenKit itself wrote — it can prove *no regression*
> against our own goldens (claim C2), never that ZenKit reproduces *the
> original engine's* files (claim C1). Fidelity is established only by the
> developer-local `zen-roundtrip` run against real Gothic installations plus
> the manual in-engine acceptance pass. The harness report states which claim
> it covers.

## Scope

Phase 0 (complete): read + save + exactly one minimal mutation (set VOB
position, insert item VOB), `normalizeWorld` dumps, and the round-trip
harness. No `applyOps` system, no VFS browsing, no UI — those are Phase 1.

Phase 1a adds `extractWorldMesh` and the asset layer (below). Everything Phase
1a adds is a **read-only projection**: it reads the same load-path structs
`normalizeWorld` does, never the writer, and makes no fidelity claim of its
own.

### `extractWorldMesh(handle)`

The world mesh as render-ready buffers, one chunk per material that at least
one polygon references:

```js
{
  bbox: [minX, minY, minZ, maxX, maxY, maxZ],   // of the vertices emitted
  vertexCount, triangleCount,          // totals over all chunks
  chunks: [{
    materialIndex, name, texture, group, color: [r, g, b, a],
    // the render state, so a merged chunk can only merge with an equal one
    alphaFunc, texAniMapMode, texAniFps, texAniMapDir: [x, y],
    envMapping, envMappingStrength,
    waveMode, waveSpeed, waveMaxAmplitude, waveGridSize,
    ignoreSun, disableLightmap,
    vertexCount, triangleCount,
    positions,  // ArrayBuffer, Float32 ×3 per vertex — ZenGin space, unconverted
    normals,    // ArrayBuffer, Float32 ×3 per vertex
    uvs,        // ArrayBuffer, Float32 ×2 per vertex
    lights,     // ArrayBuffer, Uint32  ×1 per vertex — the raw zCOLOR word
    indices,    // ArrayBuffer, Uint32  ×3 per triangle
    flags,      // ArrayBuffer, Uint32  ×1 per triangle — same packing as _drillMesh
  }]
}
```

Three things it deliberately does *not* do, each because the decision belongs
above the binding:

- **No coordinate conversion.** Positions stay in ZenGin space (cm, ZenGin
  handedness); the single conversion module is `zen-world/coords`
  (`../docs/architecture/level-editor.md` §7).
- **No light decoding.** `lights` is the raw `zCOLOR` word. The channel order
  is a rendering question and is emitted undecoded rather than guessed.
- **No polygon filtering.** It reads the complete `Mesh::geometry` list and
  fan-triangulates n-gons itself, rather than reusing ZenKit's
  `Mesh::triangulate`, which is filtered to the BSP leaf set and silently drops
  `is_portal`, `is_ghost_occluder` and `is_outdoor` polygons. A level editor
  needs to be able to *show* portals and sectors, so the per-triangle `flags`
  buffer lets the projection layer decide what to draw.

Vertices are keyed on the **(vertex, feature) pair**, not the vertex alone:
ZenGin stores position per vertex but UV, normal and baked light per polygon
corner. On retail NewWorld that halves the vertex count (1,429,335 triangle
corners → 713,719 vertices, 49 MB → 30 MB).

`bbox` is computed from the vertices actually emitted, **not** copied from
`Mesh::bbox`: every retail world mesh stores that box as all zeros, so a copied
one hands the projection layer a world with no size. The fixture declares a
deliberately wrong box so the difference is visible in a test.

Chunks are per *material*, but a renderer should merge chunks sharing a
texture — NewWorld has 1400 materials and only 330 unique textures, and one
draw call per material would exceed the whole viewport budget on its own
(`../docs/architecture/level-editor.md` §3). Two materials on one texture may only
merge if they also agree on the render state above; measured on NewWorld that
merge key gives 352 groups where texture alone gives 330, and the 22 it keeps
apart are real differences in blend mode, UV scroll, env-map strength and
vertex colour (266 materials carry no texture at all and are separated only by
`color`). Fields the asset compiler has already baked into the geometry
(`smooth_angle`, `texture_scale`, `default_mapping`) and gameplay-only fields
(`disable_collision`, `dont_collapse`, `force_occluder`, `detail_object`) are
deliberately not emitted.

### `vobIndex(handle)`

The VOB enumeration the render path uses. `normalizeWorld` is the diagnostic
dump — a JS object per VOB with every per-class property, plus the container
section's SHA-256s over the archive bytes — and costs **877 ms** on retail
NewWorld's 23,288 VOBs. `vobIndex` is the *same* enumeration in the *same*
order, reduced to identity, placement, visual and the flags that decide whether
a VOB is drawn: **9.2 ms and 1.69 MB** of transferables.

```js
{
  count,
  parent,          // ArrayBuffer, Int32  ×1 — index of the parent, -1 for a root
  childIndex,      // ArrayBuffer, Uint32 ×1 — position among its siblings
  positions,       // ArrayBuffer, Float32 ×3 — ZenGin space, unconverted
  rotations,       // ArrayBuffer, Float32 ×9 — row-major
  flags,           // ArrayBuffer, Uint32 ×1 — bit 0 showVisual, 1 vobStatic,
                   //   2 ambient, 3 cdStatic, 4 cdDynamic, 5 physicsEnabled
  classes, classIndex,           // dictionary + ArrayBuffer, Uint32 ×1
  names, nameIndex,
  visuals, visualIndex,
  visualTypes, visualTypeIndex,
}
```

The strings are interned because they repeat: those 23,288 VOBs name 445
distinct visuals, 2,654 distinct names and 37 classes. A VOB is addressed for
mutation by an **index path**, and `parent` + `childIndex` rebuild one — for the
single VOB being edited, rather than building 23,288 path strings on load.

A VOB with no visual object interns as the empty string; `normalizeWorld`
reports `null` there. `''` and "a visual named `''`" are the same thing to a
renderer, and a dictionary column has no null.

### `getWaynet(handle)`

The waynet as a drawable graph, and the same kind of thing to
`normalizeWorld`'s `waynet` section that `vobIndex` is to the VOB dump. The dump
sorts waypoints by name and sorts each edge pair, because order is noise to a
diff; this keeps the **stored order** and emits edges as **index pairs into it**,
because an overlay builds a line buffer from indices and a name lookup per edge
would be thousands of string comparisons for a picture.

```js
{
  count,
  names,          // string[] — NOT interned: waypoint names are effectively unique
  positions,      // ArrayBuffer, Float32 ×3 — ZenGin space, unconverted
  directions,     // ArrayBuffer, Float32 ×3
  waterDepths,    // ArrayBuffer, Int32 ×1
  flags,          // ArrayBuffer, Uint32 ×1 — bit 0 freePoint, bit 1 underWater
  edgeCount,
  edges,          // ArrayBuffer, Uint32 ×2 per edge — indices into the above
  danglingEdges,  // edges whose endpoint was not in the point list
}
```

Edges are matched to points by **pointer identity**, not by name: the edge list
holds the same `shared_ptr`s the point list does, and nothing in the format
promises names are unique. An edge whose endpoint is not in the point list is
dropped — it cannot be drawn and cannot be named — and counted in
`danglingEdges`, so an empty overlay is distinguishable from a silently emptied
one.

### `getPortals(handle)`

The portal metadata as data. `is_portal`, `is_sector` and `sector_index` reach
`normalizeWorld` only through `polyHash`, and the BSP's
`portal_polygon_indices` only through `portalPolyHash` — a hash answers "did it
change", and no portal check past the material names can be written on that.

```js
{
  polyCount,          // polygons in the world mesh — what polygonIndices indexes
  count,              // rows below
  polygonIndices,     // ArrayBuffer, Uint32 x1 — into the world mesh geometry
  materialIndices,    // ArrayBuffer, Uint32 x1 — into mesh.materials
  sectorIndices,      // ArrayBuffer, Int32 x1 — the on-disk i16, widened; -1 = none
  portalKinds,        // ArrayBuffer, Uint8 x1 — is_portal, a two-bit value
  sectorFlags,        // ArrayBuffer, Uint8 x1 — is_sector
  bspPortalPolygons,  // ArrayBuffer, Uint32 x1 — BSP portal list, stored order
  planes,             // ArrayBuffer, Float32 x4 per row — [distance, nx, ny, nz], on-disk order
  cornerOffsets,      // ArrayBuffer, Uint32 x(count+1) — row i's corners are [offsets[i], offsets[i+1])
  corners,            // ArrayBuffer, Float32 x3 per corner — ZenGin space, unconverted
  materials,          // string[] — mesh.materials' names, the order polygons index them
  sectorNames,        // string[] — bsp.sectors' names, STORED order (sectorIndices indexes it)
}
```

One row per polygon **carrying portal metadata**, not per polygon — and that
is mostly sector faces: NewWorld's 232k-polygon mesh has 1,933 portal faces
and 83,816 `is_sector` faces, 85,749 rows and 4.9 MB of planes and corners,
read in 11 ms. `sectorIndices` stays signed because -1 means "no sector" and
an unsigned column would report a valid-looking 65535.

The geometry and the two name lists were added for §16.20 slice 3, when the
checks got a consumer. Until then the readout carried indices into lists it
did not emit — `materials` and `sectorNames` existed only in `normalizeWorld`'s
dump, which the editor never reads — and no plane and no corners, because the
measurement scripts rebuilt those from `extractWorldMesh`'s fans by walking
every polygon of the mesh through `_drillMesh`. A check that runs on every
world open cannot afford that walk, and a few thousand rows are cheap to emit.
`sectorNames` is deliberately the BSP's stored order and **not** the sorted
order the dump uses: `sectorIndices` is an index into it. The checks
themselves are `zen-world`'s `checkPortals`.

### `worldProperties(handle)`

The world-level readout: the `oCWorld:zCWorld` archive wrapper the handle
re-saves through (`rootObjectName`, `rootClassName`, `rootVersion`, `format`,
`gameVersion`), plus every member `zenkit::World` models beyond vobs, mesh, BSP
and waynet — `skyController`, `player` and the four NPC-spawn fields.

**Those are all save-game members, and a world `.zen` carries none of them.**
Measured over the four retail worlds (`node scripts/check-world-properties.js`,
2026-08-30): `skyController` and `player` are `null` and the spawn state is
zero in every one, so "expose sky and time of day" is not a matter of plumbing
a field that is already parsed (`../docs/plans/level-editor.md` §14.3 3.5).
The one world-level thing a `.zen` *does* carry is the start position, and it
is not an `oCWorld` field either — it is a `zCVobStartpoint` in the vob tree
and/or a waypoint named `START`. The same script reports both.

### The asset layer — `openVfs`, `vfsResolve`, `extractVisual`, `decodeTexture`

```js
const vfs = openVfs([vdfOrDirectory, ...], { overwrite: 'all' });
vfsResolve(vfs, 'NW_CRATE.3DS');        // -> 'NW_CRATE.MRM' | null
vfsList(vfs, '/');                      // -> [{ name, type: 'file'|'directory' }] | null
extractVisual(vfs, 'NW_CRATE.3DS');     // -> the chunk payload above | null
decodeTexture(vfs, 'NW_WOOD.TGA', 0);   // -> { source, width, height, mipmaps, rgba } | null
```

`openVfs` mounts VDF/MOD archives and loose directories into one namespace, in
order — later paths win, which is the load order ZenGin itself uses, so a mod
directory listed after the retail VDFs overrides them.

**Prefer archives to loose directories where both exist.** `Vfs::mount_host`
memory-maps every file under a directory eagerly, and mounting an extracted
MDK-style install's `Meshes/_compiled` + `Textures/_compiled` (4,153 files)
takes **2,170 ms** against **15 ms** for the four equivalent VDFs — measured
across a whole world, the two mounts resolve every texture and visual name to
the same file and decode byte-identical pixels. The cost is per *file*, not per
byte, and it is not ZenKit's: on the machine this was measured on, opening and
closing those same 4,153 files costs 2,156 ms with no VFS involved, and a
control directory elsewhere on disk costs the same per file. A mod directory
still has to be mounted as a directory — it is just usually small.

`vfsList` walks **one level**, never recursively: a Gothic install is tens of
thousands of entries and an asset browser shows one directory at a time. It
returns null both for a path that is not there and for a file, because both mean
"nothing here to list" and no browser offers to descend into a file. Entries come
out in the VFS's own set order, which is stable across runs without sorting.

A VOB names its **source** asset (`.3DS`, `.ASC`, `.MDS`, `.MMS`, `.TGA`) while
the VFS holds what the asset compiler produced. The mapping is spelled out
rather than probed, because guessing is how the wrong mesh ends up on screen
with nothing reporting a problem — `.3DS` → `.MRM`, else `.MSH`; `.ASC`/`.MDS`
→ `.MDL`, else `.MDM`; `.MMS` → `.MMB`; `.TGA` → `-C.TEX`. Each was verified
against the retail install before it was written down. A name nothing maps to
is `null`, never an error: an unresolved visual is a normal fact about a world.

`extractVisual` reuses the chunk shape above. A proto-mesh chunk carries **no
`lights` and no `flags`** — its wedges are already de-duplicated render vertices
and a VOB visual has no baked ZenGin light word.

**The compiled models are in `Anims.vdf`**, not `Meshes` — `.MDL`, `.MDM`,
`.MDH` and `.MMB` all live there, and an extracted MDK install leaves
`Anims/_compiled` empty. A VFS mounting only meshes and textures resolves no
model at all, which is what made 53 of NewWorld's 63 MODEL visuals look like a
name-mapping problem when the mapping was never wrong.

**A model's geometry is in two places.** `ModelMesh::meshes` holds soft-skin
bodies; `ModelMesh::attachments` holds rigid sub-meshes hung on hierarchy nodes,
and a static prop's geometry is entirely in the second — a locked chest is base
+ lid + lock + zone mesh, four attachments. An attachment chunk carries two
extra fields: `node`, the hierarchy node it hangs on, and `transform`, that
node's matrix accumulated down the chain from the root, row-major and
**emitted rather than baked** into the positions. Attachments are emitted in
hierarchy-node order because the map they are stored in is unordered. A `.MDM`
has attachments but no hierarchy: it is read from the `.MDH` beside it, as
ZenGin pairs them.

A `zCVobLevelCompo`'s visual is **not an asset lookup** — it names the source
mesh that a slice of the already-compiled world mesh came from, and drawing it
would draw that geometry twice. Measured on NewWorld, 100% of
`NewWorld_Part_Xardas_01`'s vertex positions are already in `NewWorld.zen`'s
world mesh. Consumers should skip those VOBs; the part `.zen`s beside the world
are their editable sources. Decals resolve to a texture rather than a mesh, and
`.pfx` particle effects are Daedalus instances that are not in the VFS at all —
`extractVisual` returns null for both, correctly. `decodeTexture` returns RGBA8
through ZenKit's own ZTEX decoder, so the renderer never sees DXT.

#### Triangle winding — measured, and still not applied here

Indices are emitted in **stored order, unreversed**, and that order is now a
known quantity rather than an open question. `scripts/check-visual-winding.js`
compares each triangle's geometric normal in stored order against the normals
ZenGin stored on its own corners — a comparison that needs no coordinate
convention, since both live in the same basis:

| corpus | agree | oppose | ambiguous | degenerate |
|---|---|---|---|---|
| 1351 loose `.MRM` | 0 | **230,395** | 0 | 0 |
| NewWorld world mesh | 38 | **475,146** | 101 | 1160 |
| OldWorld world mesh | 1 | **88,481** | 42 | 27 |

Read right-handed, `(p1-p0)x(p2-p0)` points **against** the stored normals,
uniformly, through two independent readers — MRM wedges and zCMesh's
vertex/feature indirection. (The world-mesh outliers are hand-authored
geometry; the compiler-produced `.MRM` corpus has none.) That is what a
left-handed engine looks like from a right-handed reading, and it makes the
flip a **single decision for the whole projection layer** rather than a
per-mesh one — so the binding still does not make it. (The projection layer's
answer is `zen-world`'s `threeIndexOrder`. It reverses the index buffer, and it
had to: the mirror in `ROOT_MATRIX` does *not* settle winding, because Three.js
cancels a negative determinant's effect on the front/back test.) Run both halves before
trusting the number: a unanimous result from one reader is as likely to be a
sign error in the script as a fact about ZenGin.

A live VFS keeps every mounted file memory-mapped, so **Windows refuses to
delete a mounted file until the handle is garbage-collected.**

### `setVobRotation(handle, indexPath, rotation[9], bbox?)`

The second mutation. The matrix is **row-major** — the order `vobIndex` emits
and `normalizeWorld` dumps — and is transposed once here into `zenkit::Mat3`'s
columns, rather than at each call site that would otherwise have to remember. A
transpose is invisible on identity and on every symmetric matrix, which is what
makes it worth naming.

It does **not** derive the bounding box. `setVobPosition` translates the box by
the delta it moves the VOB, because the engine culls by it; a rotation cannot do
that, since an axis-aligned box does not rotate into an axis-aligned box.
Deriving one here would put the asset layer inside a mutation, and the box is a
pure function of (visual, rotation, position) — see below — so the caller that
already owns the asset layer recomputes it and passes it in. Omitting it leaves
the stale box, which is the right answer for a VOB whose visual does not resolve:
it at least bounded the visual in some pose, where a guessed one bounds nothing.

**No engine verdict covers a rotated VOB.** The acceptance record's row 10 moved
a VOB and inserted an item; a rotation and its refitted box are Gate 2's
business.

#### What a VOB's `bbox` is — measured, before any op re-fits one

`setVobPosition` translates the box by the delta it moves the VOB, because the
engine culls by it. A rotation cannot do that: an axis-aligned box does not
rotate into an axis-aligned box. `scripts/check-vob-bbox.js` places each VOB's
own visual by that VOB's rotation and position — ZenGin space throughout, so no
coordinate convention enters — and compares:

| | NewWorld | OldWorld | AddonWorld |
|---|---|---|---|
| VOBs with a resolvable visual | 12,370 | 4,808 | 3,324 |
| **stored box = tight AABB of the placed visual** | **12,347** | **4,806** | **3,319** |
| looser | 0 | 0 | 0 |
| smaller than the visual | 23 | 2 | 5 |
| mean slack | 0.11 cm | 0.02 cm | 0.07 cm |

So the box is a **pure function of (visual, rotation, position)** and can be
recomputed rather than carried, which is what keeps a rotation op invertible.
The 30 exceptions are all animated visuals (`SNA_BODY.ASC`, `SMOKE_WATERPIPE.MDS`
…) whose stored box covers the animation, not the bind pose.

The same run answers the scale question: `zCVob` has no scale field, and across
**all 41,393 VOB transforms** in the three retail worlds the worst deviation
from unit column length is **1.0e-2**. Nothing in the corpus is scaled, so there
is no scaled representation to author against.

### `setVobProp(handle, indexPath, props)`

The third mutation, and the first that writes nothing derived: the name, the six
boolean flags `vobIndex` emits (`showVisual`, `cdStatic`, `cdDynamic`,
`vobStatic`, `ambient`, `physicsEnabled`), the visual's name, and three more
`zCVob` base fields — `presetName`, `visualCamAlign`, `bias` and
`dynamicShadows` — and the seven fields of a decal visual.

**The three numbers are bounded by the packed layout, not by their C++ types.**
ZenGin writes a VObject either packed — every scalar in one `dataRaw` blob — or
unpacked, and the packed layout gives `visualCamAlign` and `dynamicShadows` two
bits each and `bias` five. An `int32_t` bias of 32 is therefore written as 0 and
reported as written, so 0-31 and 0-3 are refusals here rather than truncations.
The alignment's bound is those two bits and not `SpriteAlignment`'s three named
values: retail carries 3 on 7 of the 41,393 VOBs, and a bound that refused it
would make an edit on one of them un-undoable, since the inverse writes back what
was there. Measured over NewWorld, OldWorld and AddonWorld on 2026-08-28: 5,660
VOBs carry a preset name (122 distinct), `bias` is 0, 1 or 2, `visualCamAlign` is
0-3, and `dynamicShadows` is 0 on 41,260 VOBs and 1 on 133.

**`sleepMode` is not writable and cannot be.** `VirtualObject` reads and writes
it only under `is_save_game()`, so a value set on a world archive never reaches
the file — which is why all 41,393 retail VOBs read back 0.

**The decal fields are `decalDimension`, `decalOffset`, `decalTwoSided`,
`decalAlphaFunc`, `decalTextureAnimFps`, `decalAlphaWeight` and
`decalIgnoreDaylight`** — flat and prefixed, though `getVobProps` answers them
nested under `decal`. They are legal only on a VOB whose visual is a decal; any
other is refused, because defaulting a decal onto it would replace the visual,
which is `visual`'s own refusal. Measured over the same three worlds: 1,932 VOBs
carry a decal, all of them plain `zCVob`; dimensions run 10-550, every offset is
[0, 0], `alphaFunc` is 1, 2, 3 or (once) 6, and `alphaWeight` runs 80-255.

Every key is optional and only the keys present are written, so setting one flag
does not require knowing the other five. **An unrecognised key is refused**
rather than ignored — every field here is invisible in the viewport, so a
misspelled key that silently did nothing is the whole failure mode this op
would otherwise have. Nothing is written until every value has been validated
either: a refused props object leaves the VOB exactly as it was, where a
half-applied one would be a state no op describes and undo could not restore.

**The visual is a rename, and only a rename.** A visual is its own object frame
in the archive with its own class, and the class is **not** implied by the file
name. Measured across the three retail worlds:

| extension | visual type | | |
|---|---|---|---|
| `.3DS` | `MULTI_RESOLUTION_MESH` ×20,716 | `MESH` ×31 | **ambiguous** |
| `.TGA` | `DECAL` ×1,932 | | |
| `.PFX` | `PARTICLE_EFFECT` ×1,391 | | |
| `.ASC` | `MODEL` ×914 | | |
| `.MDS` | `MODEL` ×502 | | |
| `.MMS` | `MORPH_MESH` ×158 | | |
| *(none)* | `UNKNOWN` ×15,749 | | |

Those 31 `.3DS` VOBs carrying a `zCMesh` are why the extension cannot decide the
class: a rule derived from the file name writes the wrong object frame for them,
and nothing downstream reports it. So the object found on the VOB is kept and
only `visual->name` changes. A VOB whose visual is `UNKNOWN` has no object to
rename — and that is not a rare state, it is 15,749 of the 41,393 retail VOBs,
which is what "this VOB has no visual" actually looks like on disk (no retail VOB
has a null visual pointer at all). Naming one is refused, because giving a VOB a
visual means **replacing** that object and deciding its class, which is a
different operation.

`bbox` follows `setVobRotation`'s contract for the same reason: swapping a visual
changes the box the engine culls by, the box is a pure function of (visual,
rotation, position), and only the caller that owns the asset layer can compute
it. It is accepted **only** alongside `visual`, since nothing else here can
change the box.

**No engine verdict covers any of this** — like the rotation before it, it is
Gate 2's business.

### `insertVob(handle, parentPath | null, opts)`, `deleteVob(handle, indexPath)` and `reparentVob(handle, fromPath, parentPath | null, slot)`

The structural three. `insertVob` appends a `zCVob` to a parent's children — or
to the roots, for a null parent — and returns the index path it landed at;
`deleteVob` removes a VOB and its whole subtree; `reparentVob` moves one, with
its subtree, into another parent at a given slot, and returns the path it landed
at.

**A null parent renumbers nothing and a parent renumbers.** Every VOB is
enumerated depth-first and its flat index is its position in that traversal, so
appending a root is the one insertion that shifts nothing: it is enumerated last
and takes the index one past the end. Appended under a parent, the new VOB is
enumerated in the middle and every VOB after that parent's subtree moves up one —
and every op already in the history addresses a VOB both by that number and by an
index path built from it. What makes that safe is the discipline of the history
rather than the call, exactly as it is for `reparentVob` below; the caller's own
guard is the narrower one, that an insert with a parent has to be alone in its
batch.

**It appends rather than taking a slot**, which is the one place it deliberately
differs from `reparentVob`. A reparent has to be able to put a VOB back exactly
where it came from; an insert's inverse is a delete of the VOB it just made, and
the end of the list is where a delete leaves no hole to reason about.

`opts` is `{ class?, instance?, name?, visual?, position, rotation?, bbox?,
showVisual?, cdStatic?, cdDynamic?, vobStatic?, ambient? }`; only `position` is
required and an unrecognised key is refused. Without a `bbox` it gets a 10 cm box
around the position — the caller that owns the asset layer should pass the real
one, since the box is a pure function of (visual, rotation, position). Without a
`visual` it gets none, and then `showVisual` defaults to false: a VOB with
nothing to draw does not claim otherwise.

**`class` is the object's C++ type, not a field on it**, which is why the set is
closed: `'zCVob'` (the default), `'oCItem'`, `'zCVobLight'`, `'zCVobSound'`,
`'zCVobSoundDaytime'` and the trigger family — `'zCTrigger'`,
`'zCTriggerList'`, `'oCTriggerScript'`, `'oCTriggerChangeLevel'`, `'zCMover'`,
`'zCCodeMaster'` and `'zCMessageFilter'`, the last two deriving from `zCVob`
rather than from `zCTrigger`; then the movable objects — `'oCMobInter'` and the
four that add nothing to it (`'oCMobBed'`, `'oCMobLadder'`, `'oCMobSwitch'`,
`'oCMobWheel'`), `'oCMobDoor'`, `'oCMobContainer'` — and `'oCTouchDamage'`,
which is not one of them at all but the other volume placed by hand; then the
zones, the markers and the two effect classes — `'oCZoneMusic'`,
`'zCZoneZFog'`, `'zCZoneVobFarPlane'`, `'zCVobStartpoint'`, `'zCVobSpot'`,
`'zCVobAnimate'` and `'zCPFXController'`. The three `…Default` zone variants are
**not** in the set: a world's fallback fog, far plane and music are one object
each rather than something placed.
**Spell the `oC*` names as the archive does**: `zCTriggerScript`,
`zCTriggerChangeLevel` and `zCTouchDamage` are what everyone says (the last is
ZenKit's own documentation) and not one of the three is a class this authors. Each class needs its own field-complete construction —
ZenKit's structs leave fields uninitialized — and `setVobClassProp` switches on
the type the object really has, so nothing can turn a `zCVob` into an `oCItem`
afterwards. A class with no construction is refused rather than authored as a
bare `zCVob` wearing its name. An `oCItem` requires `instance`, the script
instance the engine spawns; any other class refuses one, having no such field. An
item is normally authored with **no** `visual` — the engine derives one from the
instance — so `showVisual` defaults to true for an `oCItem` rather than to
whether a visual was given.

**A construction's defaults are the retail majority, not ZenKit's**, measured
over NewWorld, OldWorld and AddonWorld (2026-08-28) — and the two disagree on
five fields. A light is authored `POINT` (all 4,649 retail lights are; ZenKit's
default is `SPOT`), `LOW` quality, `can_move = false` (every one of the 1,111
dynamic lights, against ZenKit's `true`), range 400 and white, **dynamic and on**
— a static light is baked by the world's lighting compile, so one added
afterwards lights nothing, and `is_static` decides which fields the archive even
contains. A sound is authored `LOOP` (1,077 of retail's 1,237; ZenKit says
`ONCE`) with `obstruction = false` (the retail majority, against ZenKit's
`true`), volume 100, radius 1500 and no sound name — the caller sets that through
`setVobClassProp`, and a `zCVobSoundDaytime` additionally wakes at 6 and sleeps
at 20, retail's medians. The enums used to matter most because the class
catalogue held no field for one; since 2026-08-29 it holds eight of them, so a
sound's `mode` and a light's `lightType` are editable after placement and what
is chosen here is only the default.

The trigger family is measured the same way, over its own 294 retail VOBs, and
**the four flags the family disagrees about are per class rather than shared**:
a mover is fired at and never touched (148 of 150), a plain trigger is touched
by almost everything, and a script trigger answers the player alone. A mover is
also authored `locked = false` — every one of retail's 150 is, against ZenKit's
`true` — and stays open 2 s. Two caveats travel with the family. Its `target` is
not in the class catalogue, so **a placed trigger fires at nothing** until it
is; and `zCTriggerList`, `zCCodeMaster` and `zCMessageFilter` are configured
only by lists and enums, and the catalogue's eight enums are on none of those
three classes, so a placed one has no editable field of its own at all. A mover is the member that does something
unaided: it runs its visual's animation, needing neither a target nor keyframes.

The movable-object family is measured over its own 1,424 retail VOBs, and
**unlike the trigger family it agrees with itself**: `hp` is 10 and `damage` 0
on every one of them, none is movable or takable outside five switches, and none
names a destroyed visual, an owner or a guild — so the whole `oCMOB` and
`oCMobInter` half is shared rather than split per class, and only the container
decides anything of its own. `stateCount` is 1 (1,287 of the 1,290 interactive
objects), and the two script hooks and `item` are empty for the reason a script
trigger's `function` is. **A container is authored unlocked against retail's own
majority** (199 of 294 chests are locked): a locked chest needs a key or a pick
combination, neither of which this can author, so a locked one would be a
container nothing in the game could open. A damage volume is the family's one
member that does its job the moment it is placed — 1000 damage, point damage
alone, a two-second tick and `BOX` collision, which is what all 51 retail ones
use. One of the eight is placeable with no editable field: `oCTouchDamage`
has never been catalogued. (`oCMobBed` was the other until it took
`oCMobInter`'s fields, in the catalogue and in `setVobClassProp`'s switch both.)
`oCMOB` and `oCMobFire` go the other way — catalogued and editable, and not
authorable.

The zones, the markers and the two effect classes are measured the same way, and
they are where the measurement runs out: retail places 59 `oCZoneMusic` but only
8 `zCZoneZFog` and 2 `zCZoneVobFarPlane` across all three worlds. A music zone is
authored enabled, looping, at volume 1, priority 1 and not an ellipsoid — retail
agrees about all of it and ZenKit's struct disagrees about five of the six — and
it is the one class here that is **complete when placed**, because the theme it
plays is the VOB's own name. A fog zone gets `rangeCenter` 6000 (three-way tie,
and the lower median), inner range 0.5, and `overrideColor`/`fadeOutSky`
**false** against retail's 5-of-8 true: the five that override carry five
different colours, so there is no majority colour to pair with a true, and both
fields are catalogued. A far-plane zone gets 6500, the larger of the only two
retail values, since the field shortens draw distance and popping scenery out
early is the worse error. `zCVobSpot` and `zCVobStartpoint` declare nothing
beyond `zCVob` and are the type tag alone — and **a second startpoint is not
refused**: nothing in the archive forbids one. `zCVobAnimate` is authored not
running (120 of 158) and what animates it is its *visual*; a `zCPFXController` is
killed when done (89 of 109), not running (82) and **emits nothing until
`pfxName` is set** through `setVobClassProp`, the same caveat a sound's
`soundName` carries. Two of these constructions matter more than the rest for
the reason the round-trip test exists: `VZoneFarPlane`'s two floats and
`VParticleEffectController`'s two bools are declared with no initializer at all.

**One field is chosen against its own measurement, and the round trip is why.**
A mover's `lerpMode` is authored `CURVE`, ZenKit's default, where retail's
majority is `LINEAR`: `VMover::save` writes it only when `keyframes` is
non-empty, which this call cannot author, so a reloaded mover comes back `CURVE`
whatever was written. Authoring the majority would make the VOB differ from
itself across a save.

**The visual's class is derived from the extension here, which is exactly what
`setVobProp` refuses to do — and for the opposite reason.** Renaming an existing
visual has a fact to preserve: `.3DS` is `zCProgMeshProto` 20,716 times and
`zCMesh` 31 times, and nothing in the name says which. *Authoring* a new one has
no such fact, so the measured majority is the only defensible choice — `.3DS` →
`zCProgMeshProto`, `.ASC`/`.MDS` → `zCModel`, `.MMS` → `zCMorphMesh`, `.PFX` →
`zCParticleFX`. A `.TGA` is **refused**: a `zCDecal` carries its own dimension,
offset, alpha function and weight, and one authored without them is a visual
ZenGin never wrote. The class must also be a concrete one and never the `Visual`
base — a base-class visual produces a world that cannot be re-loaded at all, a
`0xC0000409` fail-fast with no diagnostic.

**`deleteVob` erases the slot, it does not blank it.** Both `CollectVobs` and
`CountVobs` skip a null child, so a delete that left a hole behind reads
*identical* in every `normalizeWorld` assertion — and hands the writer a child
list with a gap in it. The test that tells the two apart saves the world and
loads the result.

The two are exact inverses for a VOB `insertVob` created, which is what makes an
add op invertible: everything about such a VOB is described by the call that
made it, so undo deletes it and redo makes it again. That is **not** true of an
arbitrary retail VOB — an `oCMobInter` carries per-class properties, children, an
AI and an event manager that no op describes — so deleting one is not yet
invertible and the editor does not offer it. Note that this is the *only* thing
still blocking a general delete: renumbering, which used to be the other half of
the objection, was answered by `reparentVob` below — and a parented `insertVob`
is that answer being used a second time.

**`reparentVob` renumbers, and no slot avoids that** — a move has two ends and
every VOB between them changes its flat index. It is safe because of how the
*history* uses it rather than anything the call does: `WorldService` clears the
redo stack on every new edit and replays batches strictly LIFO, so a recorded op
is only ever applied to a world in the enumeration it was recorded against.
Renumbering never reaches the history. What it does reach is the renderer's
columnar projection — re-read whole, as an insert already forces — and other ops
in the same batch, whose paths were resolved before the batch ran, which is why
`zen-world`'s `commitOps` refuses to put a reparent in a batch with anything
else. That guard is deliberately narrower than "structural": appending a root
renumbers nothing, so an add may share a batch.

It takes a **slot** rather than appending, because that is what makes it
invertible — putting a VOB back at the *end* of the list it came from is a
different world from the one it left. Two consequences of a move having two ends:
the removal vacates a slot *before* the insert happens, so a destination
numbered after the source in the same list has already shifted down one and both
this call and the op that predicts its landing path adjust for it; and a VOB
moved into **its own descendant** is refused, because such a subtree is
unreachable from the roots and would be neither enumerated, counted nor
written — it would simply disappear at the next save rather than being
misplaced.

**Saving is BinSafe-only.** `saveWorld(handle, path)` throws unless the handle
was loaded from a `zCArchiverBinSafe` archive: that is the only writer path
verified byte-for-byte against the retail corpus and in the original engine.
Patches 0024–0026 fixed defects A1, A4 and A5, so ZenKit's ASCII writer now
re-loads its own output and all 20 of a retail install's ASCII worlds are
measured rather than crashed — but they classify `semantic-drift`, not
`identical`, and no ASCII world has been through the engine. A2, A3 and the
newly found A6 are open (§10.4).
The BINARY path has had no fidelity work at all
(`docs/engine-acceptance-2026-08-25.md` §10.2, §10.3). Diagnostics that mean to
measure those paths pass `saveWorld(handle, path, { allowNonBinSafe: true })`,
as `scripts/zen-roundtrip.js` does.

### TypeScript consumers

`lib/index.d.ts` describes the subset of the addon TypeScript callers use —
`loadWorld`, `extractWorldMesh`, `vobIndex`, the asset layer. It is deliberately
not a full description: `normalizeWorld`, the fixture authors and the harness
are JS-only diagnostics. The payload *shapes* are `zen-world`'s, which is where
they are tested.

## ZenKit pin

The submodule `vendor/ZenKit` is pinned to commit `1ff081c` (upstream `main`,
2026-05-09) — **not** the v1.3.0 release tag. This is deliberate: v1.3.0's
world-save path is known-broken (MeshAndBsp header written as `version=0,
size=0`, polygon material/lightmap written 4-byte where the loader reads
2-byte, polygon planes zeroed), and every fix landed on `main` after the
release. A fixed SHA keeps fidelity results exactly reproducible; move the pin
only as an explicit, reviewed act, and re-run the full harness + engine pass
afterwards.

Build flags (set by `scripts/build-zenkit.js`): `ZK_ENABLE_ZIPPED_VDF=ON`
(mods ship compressed VDFs), `ZK_ENABLE_ASAN=OFF` (must never ship in a
released addon), `ZK_BUILD_SHARED=OFF`, static MSVC runtime on Windows to
match node-gyp.

## Build

Two-stage (plan §4, option B): a CMake pre-step builds ZenKit as a static
library into `vendor-build/zenkit/out/`, then `node-gyp` compiles only the
binding and links it. `prebuildify`/`node-gyp-build` keep working unchanged,
so consumers with a matching prebuild never need a C++ toolchain.

```
pnpm install            # uses a prebuild if present, else builds from source
pnpm --filter zenkit-node test
```

The `test` script is bare `node --test`, which discovers `test/*.test.js`
itself. **Do not "fix" it back to `node --test test/*.test.js`**: that relies on
the *shell* expanding the glob, so it works under bash and fails under
PowerShell — which is how it failed the first time CI ever ran the tests on
Windows, our primary platform. `node --test test/` is not a substitute either;
Node tries to load the directory as a module.

Requirements for a source build: CMake ≥3.10 (a Visual Studio-bundled CMake
is found automatically on Windows), a C++20 compiler, git submodules
initialized recursively.

## Golden fixtures

`test/fixtures/` holds tiny synthetic worlds authored by
`scripts/fixtures-regen.js` — our own files, no game data. **Fixtures never
regenerate automatically.** `pnpm --filter zenkit-node fixtures:regen` is an
explicit, reviewed act; an auto-regenerating golden would silently ratify
whatever bug just landed.

## The viewport spike — retired

`spike/viewport/` was the Phase 1a gate from `../docs/architecture/level-editor.md` §3:
a throwaway Three.js scene over retail NewWorld, to answer framerate and pick
latency on measured data rather than arithmetic. It has been **deleted**, because
the thing it was the reference for has now been measured — the app's own
viewport reproduces its frame time, draw calls and pick latency, and adds the
numbers the spike had no way to take (§3, "The app's own viewport, measured on
screen"). Its durable artefacts are those numbers, the two binding changes it
forced, and the instrument rules that outlived it.

That measurement now lives in the app, where it belongs:
`daedalus-dialog-editor/src/renderer/world/viewportBenchmark.ts` runs the same
sweep against the real scene, and
`daedalus-dialog-editor/scripts/measure-viewport.js` drives it through the real
Electron app. Both are developer-local for the same reason `zen-roundtrip` is:
they need a Gothic install, the built addon and a real GPU.

## zen-roundtrip harness

```
# C1 — fidelity, developer-local: every original ZEN is its own reference
node scripts/extract-worlds.js            # the retail worlds, out of the VDFs, into worlds/
pnpm --filter zenkit-node zen-roundtrip -- \
  --root worlds --game g2 --strict --report-dir reports/

# C2 — regression, CI: the checked-in fixtures. NEVER a fidelity result.
pnpm --filter zenkit-node zen-roundtrip -- --fixtures --strict
```

Loads every world, saves it twice (determinism), re-loads the first save and
compares `normalizeWorld` dumps. Differences are classified `identical` /
`float-noise` / `reordered` / `semantic-drift` / `unreadable`; the last two
block Gate 1 (plan §3), as do `crashed` and — outside the classifier —
nothing else. `not-a-world` is a skip, not a failure: four of the install's
`.zen` files are VOB libraries with no `MeshAndBsp`.

Every world is measured **in a child process**. ZenKit aborted the process
outright (`0xC0000409`) on the ASCII path until the `_HAS_EXCEPTIONS` fix, and
a malformed BinSafe world could hang the reader indefinitely until patch `0027`
bounded `World::load`'s mesh chunk scan — a crash or a hang has to be recorded
as a result rather than end the run. Fuzzing the fixture still finds access
violations on other corruptions, so the child process stays the contract.

The summary always prints a `COVERAGE:` line counted against **every file
found**, not every file that survived, plus the claim the run carries. A
world the container instrument could not read is reported `struct-only` and is
never a fidelity pass. `--drill` adds the first differing bytes per structure
to the report; `--report-dir` writes `zen-roundtrip.json`.

**Findings are capped at 20 per world unless you pass `--drill`, and the
listed count is therefore a quota, not a total.** Read `findingTotal` — a row
also carries `findingsTruncated`, and the summary line says `N findings, 20
shown (--drill for all)` whenever it capped. This matters more than it sounds:
one defect that fires on every VOB fills every world's quota from `vobs[0]`
upward and hides everything that sorts after it. That is exactly how an
`animMode` drift affecting 128 VOBs was recorded as affecting 4 — the four
times a bad VOB happened to sort inside the cap.

The in-engine acceptance pass (plan §5) is the second, independent instrument —
results live in `docs/engine-acceptance-<date>.md`.

### The `container` section

A `normalizeWorld` dump has two halves. `meta`/`vobs`/`mesh`/`bsp`/`waynet`
come from ZenKit's parsed structs. `container` is computed in JS from the
archive **bytes** the handle was loaded from (`lib/container.js`), because
ZenKit's positional, type-checked reader ignores facts ZenGin's name-addressed
reader depends on: the archive header lines (verbatim; only the `date`/`user`
values are split off), the hash-table key set with
insertion index/hash **and physical order**, every object frame
`[name class version index]` (per-class version counts + a sequence hash),
the per-class ordered `(entryName, entryType)` schema, entry-stream counts,
SHA-256s over every RAW/RAW_FLOAT payload and every raw BOOL word per
`(class, entryName)`, and the `MeshAndBsp` chunk table `(id, length, sha256)`.
The classifier treats **any** `container` difference as `semantic-drift` —
never `float-noise`, never `reordered` — except the header `date`/`user`
stamp values, which are benign (a missing or added stamp line is still
drift). Golden fixtures carry the section too; regenerate
only the JSON with `node scripts/fixtures-regen.js --golden-only`.

It is `null` for a handle that has been mutated by **any** mutator — the VOB
ops and the six waynet ops alike: the section describes the
bytes the handle was loaded from, and after `setVobPosition` /
`insertVob` / `removeWaypoint` those bytes no longer describe the handle. Save the world and
load the result to get a container section back.

`containerFromBuffer` dispatches on the archive format. ASCII
(`zCArchiverGeneric`) — the other 24 of the 28 `.zen` files in a Gothic II
install — has its own walker in `lib/container-ascii.js`, emitting the same
event vocabulary and the same section shape over a line-oriented stream, plus
two facts only that format has: the top-level `objects` line **verbatim**
(the field is fixed-width, and ZenKit padded it to 11 where ZenGin pads to 9
until patch 0025 — defect A4) and whether `write_indent()`'s leading tabs match
the object depth. A RAW payload is hashed as the **hex text** the file holds,
not the bytes it decodes to, because A1 was a corruption of that text and a
hash of the decoded bytes could not have seen it. **BINARY has no walker**: for it the section is
`{ archiver, format, covered: false, header }` and nothing more, and
`classifyDumps` returns `containerCoverage: false` for the pair.

**The ASCII writer is usable but not yet trusted.** A1–A5 are fixed (patches
0024–0026 and 0045–0047): ZenKit re-loads its own ASCII output, the authored
fixture round-trips `identical` fully instrumented, a retail G2 install's 20
ASCII worlds went from 20 crashed to 20 measured, and a re-save now keeps each
VObject in the layout it was loaded in instead of packing it — which takes
OldCamp's container diff from `whole-file` (unalignable) to `event-aligned`
with gap 0. They still classify **`semantic-drift`**, which is the instrument
working, not the writer passing, but for two reasons that are both smaller than
they looked. The `physicsEnabled` findings that were 43,341 of 43,469 were an
artifact of that packed conversion, not of A6: an unpacked VObject has no
`physicsEnabled` entry, so it keeps ZenKit's `= true` default, and only the
re-save's packed form wrote it false. What remains is **ASCII float text
precision** — every float is written with six decimal places where ZenGin
writes a shortest-round-trip form, so `1511.77087` returns as `1511.770874` —
plus `animMode`, which is **diagnosed and unfixable in principle**: 130 retail
`oCMobContainer` chests store a heap-pointer-shaped `visualAniMode` that ZenKit
narrows twice — uint32 to the `uint8_t` `AnimationType` on load, then to two
bits by the packed writer — so the format has nowhere to put the value. The
editor's BinSafe path is unaffected by both, measured: retail BinSafe worlds
are packed throughout and still re-save `identical`. A6 is still open, and it
is the *packed* writer, so it is the editor's path. And **no ZenGin-written
ASCII fixture exists**, so the checked-in corpus can only ever prove that ZenKit
agrees with itself. `saveWorld` is still BinSafe-only for all of those reasons.
The evidence is in the acceptance record §10.2 and §10.4.
