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
| `model/` | The VOB hierarchy over the columnar index — `buildVobTree`, `flattenVisible`, `createVobReader` — and the op model: `moveVob`, `translateVobs`, `rotateVob`, `rotateVobs`, `setVobProp`, `setVobProps`, `addVob`, `invertOp`, `commitOps`, `applyOps`. |
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
- **A model attachment's node transform must be applied, at the merge.** The
  binding emits it rather than baking it, and for the whole of Phase 1a nothing
  read it: measured on retail NewWorld, **57 of 153 attachment chunks are
  displaced by more than 1 cm and up to 1.25 m**, so every one of those parts was
  drawn stacked at its model's origin. It belongs in `mergeChunks` rather than on
  the draw call because two attachments of one model can share a texture and then
  they are one buffer with two transforms. Positions take the whole affine
  matrix; **normals take only the rotation**, because a normal is a direction and
  translating one points every face at the node.
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
- **A VOB has two addresses, and they are different numbers.** The UI selects a
  flat index into the columnar `vobIndex`; the binding takes an index *path*
  down the children lists (`setVobPosition(handle, "0/2", …)`). The path is the
  chain of `childIndex` values, not of VOB indices — on retail NewWorld, VOB 85
  lives at `2/71`. An op carries both, plus **where the VOB came from as well as
  where it goes**, which is what makes `invertOp` pure: undo replays an op
  through the same path as any other edit, with no snapshot beside the history
  and nothing read back out of the native world. A batch is all-or-nothing
  (`commitOps` unwinds what it applied, back to front) because a batch is one
  undo entry, and a half-applied one leaves the world in a state no entry
  describes.
- **A turn refits the bounding box from the *visual*, and carries a box for each
  pose.** The engine culls by that box and an axis-aligned box does not rotate
  into an axis-aligned box, so a rotation cannot translate it the way a move
  does. Measured across the three retail worlds, a stored box is the tight world
  AABB of the VOB's own visual placed by its own transform — a pure function of
  (visual, rotation, position) — so both poses' boxes are computed when the op is
  made and `invertOp` swaps both pairs. Re-fitting the *stored* box instead
  grows it on every turn and never shrinks back, and undo would not restore it.
  Swapping only the matrix is half an inverse: the VOB goes back and stays culled
  by a box fitted to a pose it no longer holds. A selection turns about **each
  VOB's own origin** and the delta composes **on the left**, so
  differently-oriented VOBs all turn the same way on screen.
- **A drag of a selection is a delta, not a destination.** One gizmo moves N
  VOBs, so `translateVobs` builds one op per VOB and each carries **its own**
  origin: the selection keeps the spacing it had, and undoing the batch puts a
  selection that was never uniform back exactly where it was instead of
  collapsing it onto the anchor. A destination-shaped API cannot say this, and
  it reads correct on a selection of one — which is every test that has only one
  VOB in it. A VOB not in the index refuses the whole batch rather than being
  skipped: a quietly dropped op is the half-applied state above, reached before
  the binding was ever asked.
- **A property op carries exactly the keys it sets, on both sides.** The name,
  the six flags and the visual are the first fields an op writes that are
  *invisible in the viewport* — a move that goes wrong is on screen, a flag that
  goes wrong is not. So `from` is read out of the index for precisely the keys
  `to` names: carrying every property the VOB has gives an inverse that restores
  fields the op never touched, carrying fewer leaves one unrestored, and neither
  is visible until somebody undoes. `visual` is a **rename** — the visual object
  keeps its class, because the class is not implied by the file name (`.3DS` is
  `zCProgMeshProto` 20,716 times and `zCMesh` 31 times across the retail corpus),
  and a VOB with no visual object is refused rather than given one. Only a visual
  swap can change the box, and then the two sides have genuinely *different*
  bounds rather than one bounds under two transforms — which is what separates it
  from a rotation. A batch gives every VOB its own `from` for the same reason a
  drag is a delta: a selection whose VOBs did not share a value has to come back
  to the values they each had, and one shared `from` reads correct on a selection
  of one. Applying one to the projection is an **intern plus a column write**,
  since a name is a dictionary index and not a value.
- **An add appends a root, because a flat index is a position in a traversal.**
  `AddVob` is the first op that changes the *shape* of the world, and the
  enumeration is what constrains it: a VOB's index is where it falls in a
  depth-first walk, so one added anywhere else is enumerated before VOBs that
  already exist and renumbers every one of them — while every op already in the
  history addresses a VOB by that number and by a path built from it. Appending a
  root shifts nothing: it is enumerated last and takes the index one past the
  end. `commitOps` still checks the path the insert actually landed at, because a
  world whose roots have changed since the op was made would put it somewhere
  else and the op's own inverse would then delete somebody else. A null side
  means "not in the world", so `invertOp` turns an add into a delete by swapping
  the two sides like every other op. And the projection **cannot** follow it —
  the typed arrays cannot grow and every later index would shift — so `applyOps`
  refuses a structural op by name rather than skipping it, and the caller
  re-reads the index. Placing a VOB *under a parent*, reparenting and deleting an
  arbitrary VOB all wait on an answer to that renumbering.
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
