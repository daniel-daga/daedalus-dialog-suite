# zen-world

Pure TypeScript domain for the ZenGin level editor — Phase 1a of
[`docs/plans/level-editor.md`](../docs/plans/level-editor.md) (§6, §7).

**No React, MUI, Electron, Three.js or native imports.** Everything here is
plain data and plain functions, which is what lets the decisions in it be tested
without a GPU, without the `zenkit-node` addon and without a Gothic install —
every binding call is injected.

| Module | What it owns |
|---|---|
| `coords/` | **THE** ZenGin ↔ Three.js conversion. One mirrored root transform; nothing else in the codebase flips an axis or reverses an index buffer. |
| `model/` | The VOB hierarchy over the columnar index — `buildVobTree`, `flattenVisible`, `createVobReader`. |
| `render/` | `mergeChunks` — one chunk per material becomes one draw call per *render state*. |
| `scene/` | `buildWorldMesh` / `buildInstancedVisuals` — a loaded world becomes a renderable scene description. |
| `assets/` | `gothicAssetSources` — which VDFs or directories to mount for an install. |

## The rules it encodes, and why each is a rule

Every one of these was measured on retail data, and every one of them fails
*silently* — which is why they are here, with tests, instead of inline in a
viewport.

- **One mirrored root is the whole conversion.** ZenGin is left-handed and
  measures in centimetres. `ROOT_MATRIX` negates X and scales to metres, and
  because a mirror has a negative determinant it also flips the rasteriser's
  front/back test — which is what settles triangle winding. Measured across the
  retail corpus, a triangle in stored index order read right-handed points
  *against* the normals ZenGin stored on its corners, uniformly. So indices stay
  in stored order, positions stay in ZenGin space, and every material stays
  single-sided. Nothing reaches for `DoubleSide` to make a wrong choice
  invisible.
- **Merge by texture + render state + colour, not by texture.** NewWorld has
  1400 materials on 330 textures, and one draw call per material is over the
  whole `< 1500` viewport budget before a single VOB is drawn. The measured key
  gives **352** groups; the 22 it refuses to merge are real differences in blend
  mode, UV scroll, env-map strength and vertex colour, and 266 materials carry
  no texture at all and are told apart only by colour. A field missing from that
  key is an additive-blend flame inside an opaque wall.
- **Never one mesh per VOB.** 12,463 placed VOBs collapse into 379 instanced
  visuals and 724 draw groups. Each instance records the VOB it came from,
  because a pick returns `(InstancedMesh, instanceId)` and nothing else
  identifies the object.
- **A `zCVobLevelCompo` is never resolved.** Its visual names the source mesh a
  slice of the *already-compiled* world came from — measured, 100% of
  `NewWorld_Part_Xardas_01`'s vertex positions are already in NewWorld's own
  world mesh. Drawing it draws the world twice.
- **An unresolved visual is a fact, not an error.** A decal names a texture and a
  `.pfx` is a Daedalus instance; neither is in the VFS. They are counted, and
  the count is per VOB — the per-*name* figure is `visualsSeen - visualsResolved`.
- **Sibling order is `childIndex`, not VOB index.** The hierarchy is two columns
  of the index, and retail worlds are enumerated depth-first so the two usually
  agree — which is exactly why sorting by the wrong one passes on the world you
  tested and silently reorders the next. A flattened view also costs what is
  *visible*: 23,288 VOBs behind a collapsed root is one row, not 23,288. And a
  row is read, never built — `createVobReader` makes its column views once,
  because a virtualized tree calls it on every scroll frame.
- **Mount archives, not loose trees.** `Vfs::mount_host` memory-maps every file
  under a directory eagerly: 2,170 ms for an extracted install's 4,153 compiled
  asset files against **15 ms** for the equivalent VDFs, which resolve every name
  to the same file and decode byte-identical pixels. `Anims.vdf` is mounted too —
  the compiled models live there, not in `Meshes`.

## Commands

```
pnpm --filter zen-world test        # jest
pnpm --filter zen-world run lint
pnpm --filter zen-world run typecheck
pnpm --filter zen-world run build   # dist/cjs + dist/esm
```

The build emits **both** module formats deliberately: the Electron main process
and Jest load the CommonJS output, and a bundler cannot see named exports
through TypeScript's `__exportStar` helper, so the renderer needs a real ESM
build or `import { ROOT_MATRIX } from 'zen-world'` fails at build time.
