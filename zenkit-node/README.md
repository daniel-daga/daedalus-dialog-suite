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
  (`../docs/plans/level-editor.md` §7).
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
(`../docs/plans/level-editor.md` §3). Two materials on one texture may only
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
per-mesh one — so the binding still does not make it. Run both halves before
trusting the number: a unanimous result from one reader is as likely to be a
sign error in the script as a fact about ZenGin.

A live VFS keeps every mounted file memory-mapped, so **Windows refuses to
delete a mounted file until the handle is garbage-collected.**

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

**Saving is BinSafe-only.** `saveWorld(handle, path)` throws unless the handle
was loaded from a `zCArchiverBinSafe` archive: that is the only writer path
verified byte-for-byte against the retail corpus and in the original engine.
ZenKit's ASCII writer corrupts every raw entry it emits and cannot re-load its
own output at all, and the BINARY path has had no fidelity work
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

`spike/viewport/` was the Phase 1a gate from `../docs/plans/level-editor.md` §3:
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
pnpm --filter zenkit-node zen-roundtrip -- \
  --root "C:\<Gothic II>\_work\Data\Worlds" --game g2 --strict --report-dir reports/

# C2 — regression, CI: the checked-in fixtures. NEVER a fidelity result.
pnpm --filter zenkit-node zen-roundtrip -- --fixtures --strict
```

Loads every world, saves it twice (determinism), re-loads the first save and
compares `normalizeWorld` dumps. Differences are classified `identical` /
`float-noise` / `reordered` / `semantic-drift` / `unreadable`; the last two
block Gate 1 (plan §3), as do `crashed` and — outside the classifier —
nothing else. `not-a-world` is a skip, not a failure: four of the install's
`.zen` files are VOB libraries with no `MeshAndBsp`.

Every world is measured **in a child process**. ZenKit can abort the process
outright (`0xC0000409`) on the ASCII path, and a crash has to be recorded as a
result rather than end the run.

The summary always prints a `COVERAGE:` line counted against **every file
found**, not every file that survived, plus the claim the run carries. A
world the container instrument could not read is reported `struct-only` and is
never a fidelity pass. `--drill` adds the first differing bytes per structure
to the report; `--report-dir` writes `zen-roundtrip.json`.

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

It is `null` for a handle that has been mutated: the section describes the
bytes the handle was loaded from, and after `setVobPosition` /
`insertItemVob` those bytes no longer describe the handle. Save the world and
load the result to get a container section back.

The section is **BinSafe-only**, and says so in the dump: for any other
archiver it is `{ archiver, format, covered: false, header }` and nothing more,
and `classifyDumps` returns `containerCoverage: false` for the pair. Only 4 of
the 28 `.zen` files in a Gothic II install use BinSafe; the other 24 are
`zCArchiverGeneric`/ASCII. **The ASCII writer is not usable** — ZenKit cannot
re-load its own ASCII output, and every raw entry it writes is corrupt. The
evidence and the resulting scope decision are in the acceptance record §10;
read it before trusting an ASCII round-trip.
