# Plan: ZenGin Level Editor — Viability Analysis & Proposed Architecture

Status: **proposed** — no code landed. Source input:
[`level-editor-design-brief.md`](level-editor-design-brief.md) (German design
brief; defines goals, scope, and constraints, and explicitly leaves the
technical architecture open). This document is the architecture answer: it
assesses viability of hosting the level editor as a subproject of this
monorepo and proposes the concrete architecture, including answers to all six
open questions in brief §10.

Per repo convention, when this plan completes its durable decisions move to
`docs/architecture/` and this file is deleted.

---

## 1. Verdict up front

**Viable, and this monorepo is the right home — but with a different UI base
than the brief recommends.**

1. The brief's strongest differentiator (§5: Daedalus integration — NPC
   preview, daily-routine slider, script↔ZEN cross-validation) depends on the
   tree-sitter parser and semantic model that live *in this repo* as
   Node-native code. Any architecture that cannot consume `daedalus-parser`
   in-process gives up the differentiator or pays for an LSP bridge.
2. Therefore: **not** a Godot plugin (brief Option A) and **not** a standalone
   ImGui app (Option B), but **Option C — a new surface in the existing
   Electron + React app, rendering with Three.js**, with ZenKit bound as a
   native Node addon. This keeps the ZenKit object model as the single source
   of truth (eliminating Option A's own declared central risk: round-trip
   through a foreign scene model) and reuses ~everything this repo already
   has: undo/history patterns, worker-pool crash isolation, windows-1252
   handling, validation/problems UI, project indexing, CI.
3. The brief's Gate 1 (round-trip fidelity) stays the blocking first step:
   **Phase 0 is a ZenKit Node binding plus a roundtrip corpus harness**,
   modeled on the existing parser corpus runner, before any editor UI is
   written. The harness — not taste — decides the passthrough strategy (§5
   below) and confirms ZenKit's save path is trustworthy.

Honest cost statement: Phase 1 (VOB editing) is the largest single feature
this repo will have taken on — a 3D viewport, gizmos, a native C++ binding,
and a second file-format domain. The reuse argument shortens it materially,
but this is months of work, not weeks. The phase gates in §11 are designed so
the project can stop after any phase and still have shipped something useful.

---

## 2. Why this repo (viability of the monorepo subproject)

What the suite already provides, mapped to what the brief needs:

| Brief requirement | Existing asset in this repo |
|---|---|
| Daedalus script intelligence (§5) | `daedalus-parser`: tree-sitter grammar, two-pass semantic model, code generator — Node-native, in-process |
| Windows-1252 everywhere (§5 note) | Battle-tested `iconv-lite`/`chardet` handling in `FileService` and the parser |
| Undo/redo (§1 motivation) | `historyStore.ts` / `historyActions.ts` pattern in the editor |
| Crash-isolated heavy parsing | `MetadataWorkerPool` / worker-thread pattern (`src/main/workers/`) |
| Validation surfaced as clickable problems | `ValidationService` + problems panel (`docs/architecture/problems-panel.md`) |
| Project model, file watching, safe writes | `ProjectService`, `FileWatcherService`, atomic save pipeline (`docs/architecture/save-pipeline.md`) |
| Round-trip fidelity discipline (§9 Gate 1) | "Fidelity by construction" principle + corpus runner (`test:roundtrip-corpus`, `docs/architecture/parser-fidelity.md`) |
| Integrated script editor (§5) | Monaco, already serving Daedalus from the app's own origin |
| Native C++ modules in a pnpm/Electron workspace | tree-sitter NAPI addon, `node-gyp-build`/`prebuildify` already wired |
| CI with sharded UI tests, Windows packaging | `all-tests.yml`, `build-windows.yml` |

Costs of hosting it here, with mitigations:

- **A C++ build enters the workspace** (`zenkit-node`). Precedent exists
  (tree-sitter native addon); N-API keeps it Electron-ABI-stable, and
  `prebuildify` prebuilds keep contributors off the C++ toolchain.
- **CI time grows.** Mitigate with path-filtered jobs (level-editor jobs run
  only when `zenkit-node/`, `zen-world/`, or the world UI change).
- **No game assets may enter the repo or CI** (brief §7). The roundtrip
  corpus therefore runs in two modes: full mode against a locally configured
  Gothic installation (developer machines), and CI mode against tiny
  synthetic ZEN fixtures we author ourselves (§5).
- **Repo identity broadens** from "dialog suite" to "Gothic modding suite".
  No action now; worth revisiting naming when the level editor first ships.

Separate-repo alternative: rejected. It would need `daedalus-parser`
published and versioned externally, duplicate the Electron shell, and split
the cross-validation feature (which by definition needs scripts *and* world
in one process) across two codebases.

---

## 3. UI base decision — brief §6, open question 1

### Why not Godot (brief Option A)

The brief recommends Option A *conditionally* — "sofern das
Metadaten-Durchreichen sauber lösbar ist" — and names round-trip fidelity
through the Godot scene model as the central architectural question. Three
observations tip the decision against it:

1. **The central risk is structural, not incidental.** Importing a ZEN into
   Godot scenes means every ZEN structure without a Godot counterpart (BSP
   tree, portals-as-material-metadata, VOB flags, waynet) must ride along as
   node metadata and survive every editor operation (duplicate, reparent,
   undo). The editing model and the file model are different models, forever.
   Option C dissolves this: the ZenKit object model *is* the editing model;
   Three.js is a render projection, never the source of truth.
2. **The differentiator doesn't fit.** `daedalus-parser` is a Node library.
   In a GDExtension (C++/Rust) editor it is reachable only via an LSP-style
   sidecar — exactly the integration tax the brief's §5 features (time
   slider, occupancy conflicts, go-to-definition across ZEN↔script) can't
   afford, since they need both models in one memory space, queried at
   interaction rates.
3. **Team/stack fit.** Everything in this repo is TypeScript; the Godot free
   features (gizmos, docking, undo stack) largely duplicate things the repo
   already has or that Three.js provides (below).

### What we give up, and its replacement

| Godot would provide | Option C replacement |
|---|---|
| Translation/rotation/scale gizmos | Three.js `TransformControls` (stock, proven) |
| Undo stack | existing `historyStore` command pattern |
| Scene tree with drag-&-drop | React tree (virtualized — `react-window` already in deps), same interaction stack as the dialog tree UI |
| Asset browser with thumbnails | MUI grid + offscreen Three.js thumbnail renders, cached on disk |
| Docking/panels | existing app layout; no docking framework needed for phase 1 |
| Viewport camera/navigation | Three.js controls (orbit/fly), small custom code |

What has no free replacement and must be honestly budgeted: viewport
performance engineering on full outdoor worlds (§7), and picking/selection in
the 3D view. Both are bounded, well-trodden Three.js territory — an *editor*
visualization, not an OpenGothic-quality renderer (vertex lighting can be
displayed from the baked mesh data; no dynamic lighting pipeline).

### Renderer feasibility — and its own gate

Gothic worlds are early-2000s scale: the full G2 outdoor world mesh is on the
order of a few hundred thousand to ~1M triangles plus O(10^4) VOBs whose
visuals repeat heavily (the same barrel, tree, and torch hundreds of times).
Textures are 256–512px era, so VRAM is a non-issue. The bar is an *editor
viewport*, not engine parity: baked vertex lighting arrives free as vertex
colors, and there are no dynamic shadows or runtime animation to drive.

**The bottleneck is never triangles — it is draw calls and CPU-side scene-graph
overhead.** Two rules follow, and both are day-one decisions rather than
retrofits:

1. **Never one `Mesh` per VOB.** 10–15k individual `Object3D`s with material
   switches means 10k+ draw calls and heavy per-frame CPU work — the one
   reliable way to make this slow. Instead: `InstancedMesh` per unique visual
   (thousands of VOBs collapse into a few hundred draw calls), world mesh
   pre-chunked by material inside `zenkit-node`, `matrixAutoUpdate` off for
   everything static, frustum culling on chunks. Target: ~500–1500 draw calls
   for a full scene.
2. **Picking needs a BVH.** Stock Three.js raycasting is linear over triangles
   and will stutter against a 500k-triangle world mesh. Use `three-mesh-bvh`
   for the world mesh; GPU ID-picking for instanced VOBs.

**Prior art is indirect but real.** [Gothic-UnZENity](https://github.com/GothicKit)
renders ZenKit-loaded Gothic worlds in Unity at VR framerates — a far stricter
budget than an editor viewport — and [ZenRen](https://github.com/Katharsas/ZenRen)
does it in DirectX 11. Both prove the *data* poses no exotic problem. What does
not exist publicly is a Three.js/WebGL ZEN viewer, so "this works in Three.js
specifically" currently rests on workload arithmetic, not on a demo.

**Therefore: Phase 1a opens with a throwaway viewport spike, decided by
measurement like Gate 1.** As soon as the Phase 0 binding can emit mesh
payloads, load the full G2 NewWorld with all VOB visuals and measure against a
written budget:

| Metric | Budget |
|---|---|
| Orbit/fly framerate, mid-range GPU | 60fps sustained (frame < 16ms) |
| Draw calls, full scene | < 1500 |
| Pick latency (click → selection) | < 1 frame |
| Reload after an edit | < 2s |

If the budget fails on real data, the fallback is the same architecture with a
different projection layer (WebGPU renderer; native viewport in the worst
case). The "renderer is a projection, never the model" rule (§5, §7) exists
precisely so that swap touches neither the domain nor the data layer.

#### Correction — "chunk by material" does not fit the budget; chunk by texture (measured 2026-08-26)

Rule 1 above says "world mesh pre-chunked by material". Measured against the
retail G2 worlds through `extractWorldMesh`, that is **on its own over the
draw-call budget before a single VOB is drawn**:

| | NewWorld | OldWorld | AddonWorld |
|---|---|---|---|
| Materials (all referenced by ≥1 polygon) | **1400** | 543 | 898 |
| **Unique textures** | **330** | 288 | 240 |
| Triangles (after fan-triangulation) | 476,445 | 88,551 | 334,272 |
| Render vertices (deduped) | 713,719 | 142,456 | 463,172 |
| Payload | 31.8 MB | 6.2 MB | 21.0 MB |
| `extractWorldMesh` wall clock | 256 ms | 42 ms | 149 ms |

One draw call per material is 1400 for NewWorld's world mesh alone, against a
**< 1500 full-scene** budget. One per *texture* is 330, which leaves the budget
its intended headroom for instanced VOBs. The tail is why: 1060 of the 1400
materials carry fewer than 100 triangles each, and 334 chunks already cover 95%
of all triangles.

So the merge is a **projection-layer** step, and the binding stays as §4
describes — it emits one chunk per material, each carrying its texture name,
and the renderer merges chunks sharing a texture. The merge key must include
whatever render state actually differs between two materials that share a
texture; that is for the spike to establish, not to assume.

Two budget rows are already met and need no spike: extraction of the largest
world is **256 ms**, comfortably inside "reload after an edit < 2s"; and 476k
triangles is the scale §3 predicted. What remains genuinely open is framerate
and pick latency, which only a real Three.js scene can answer.

#### The spike ran — Gate: **passed** on measured data (2026-08-26)

`zenkit-node/spike/viewport/` is that scene: retail NewWorld, the complete world
mesh merged by the key below, **11,548 VOBs as 313 instanced visuals**, 454
decoded textures, `three-mesh-bvh` for picking, Three.js r180. It is throwaway —
the durable artefacts are the numbers here and the two binding changes it forced.

| Metric | Budget | Measured | |
|---|---|---|---|
| Frame time, full scene | < 16 ms | **4.9 ms p50, 6.5 p95, 16.2 max** — 0 of 840 frames over 16.7 ms | ✅ |
| Draw calls, full scene | < 1500 | **1076 total, 961 p50 per frame** | ✅ |
| Pick latency — world mesh | < 1 frame | **0.2 ms p50, 0.9 p95, 5.0 max** | ✅ |
| Pick latency — whole scene | < 1 frame | **14.2 ms p50, 21.3 p95, 22.2 max** | ❌ |
| Reload after an edit | < 2 s | **266 ms** — a full world-mesh re-extract; a VOB edit needs none | ✅ |
| Cold open (no budget row) | — | **1.8 s**, from 4.3 s (see below) | |

Final scene: 476,445 world-mesh triangles in 352 draw groups, plus **12,463
VOBs collapsed into 379 instanced visuals** and 490 decoded textures —
2.74M triangles a frame.

On an **integrated** GPU (Radeon 890M through ANGLE/D3D11) at 1463×780 — the low
end of "mid-range", so the headroom is real: 2.59M triangles a frame at 936 draw
calls costs a quarter of the budget.

Three results change what Phase 1a builds:

1. **GPU ID-picking for instanced VOBs is now required, not optional.** §3 offered
   it as an alternative to a BVH; measured, a CPU raycast across 584
   `InstancedMesh`es costs **12.4 ms median** and blows the one-frame budget on
   its own, while the same raycast against the 476k-triangle world mesh through
   its BVH costs **0.3 ms**. The BVH answers the world mesh; it does not answer
   the props.
2. **The merge key is texture + render state + material colour** — measured, not
   assumed. On NewWorld it yields **352 groups** against 330 for texture alone;
   the 22 it refuses to merge are real differences in blend mode (`alphaFunc`),
   scroll speed, env-map strength and vertex colour, and 266 of the 1400
   materials carry *no* texture at all and are separated only by their colour.
   22 extra draw calls is what correctness costs here. `zenkit-node` now emits
   the whole key on every chunk (world mesh and VOB visual alike).
3. **The reload row and the number that missed it were measuring different
   things** — see the next section, which took the cold open from 4.3 s to
   1.9–2.1 s and cost the binding one new call.

Two instrument bugs were caught before their numbers were believed, both by
distrusting a suspiciously constant result rather than by luck:

- The first run reported a **flat 505 draw calls and an identical triangle count
  in all 840 frames**. The camera had never moved: the flythrough framed the
  world from `extractWorldMesh`'s `bbox`, and every retail zCMesh stores that
  box as **all zeros**. The fixture had hidden it by declaring a real one. The
  binding now computes the box from the vertices it emits, as the proto-mesh
  path always did.
- `requestAnimationFrame` is suspended in a tab that is not the foreground tab,
  which reports any renderer as a 1 fps one. The framerate above therefore comes
  from a synchronous sweep timed with `gl.finish()`, which is immune to that and
  includes GPU time; it excludes vsync, so it answers "can the frame be drawn
  inside the budget", not "was it presented at 60 Hz". The rAF sweep still runs
  as corroboration and reports itself void when it stalls.

#### The load path, phase by phase — 4.3 s to 1.9 s (2026-08-26)

The spike's first report put "reload" at 2.7 s and blamed the BVH. Both halves
of that were wrong, and finding out why took nothing but timing each phase
separately instead of one stopwatch around a block:

| Phase | Before | After | |
|---|---|---|---|
| `loadWorld` | 218 ms | 216 ms | |
| `extractWorldMesh` | 271 ms | 267 ms | |
| VOB enumeration | **933 ms** | **11 ms** | `vobIndex` instead of `normalizeWorld` |
| `openVfs` | **2102 ms** | **12 ms** | four VDFs instead of two loose trees |
| `extractVisual` ×444 | 26 ms | 72 ms | |
| `decodeTexture` ×454 | 723 ms | 692 ms | 96 MB of RGBA |
| merge to draw groups | — | 57 ms | |
| scene build (browser) | 179 ms | 153 ms | |
| BVH build | 545 ms (936 trees) | 452–591 ms (352) | |
| **total, no transfer** | **~4.3 s + browser** | **1.9–2.1 s** | |

**The reload row is met, and always was.** "Reload after an edit" is not a cold
open: the world is already in memory, the VFS is already mounted and the
textures are already decoded. The worst case is re-extracting the whole world
mesh — **267 ms** — and an edit that only moves a VOB does not even need that.
What the 2.7 s measured was the cold open, which has no budget row of its own;
it now has a number instead.

Two costs were worth removing, and both were the same mistake — using a
general-purpose call on a hot path:

1. **`normalizeWorld` is a diagnostic instrument, not the render path's VOB
   source.** It builds a JS object per VOB with every per-class property, plus
   the container section's SHA-256s over the archive bytes: 877–933 ms for
   NewWorld's 23,288 VOBs. `vobIndex` is the same enumeration in the same order,
   reduced to identity, placement, visual and the flags that decide whether a
   VOB is drawn, emitted columnar with the repeated strings interned (23,288
   VOBs name 445 visuals and 37 classes). **9.2 ms, 1.69 MB of transferables**,
   verified against the dump on retail data: same count, same order, same
   reconstructed paths, same visual names. This is §7's `VobIndex` becoming a
   real thing rather than a diagram box.
2. **Mount archives, not loose trees, when both exist.** `Vfs::mount_host`
   memory-maps every file under the directory eagerly — 4,153 of them for
   `Meshes/_compiled` + `Textures/_compiled` — and on this machine *any* file
   open costs ~500 µs (measured: walking and stat-ing all 4,153 takes 41 ms,
   opening and closing them takes 2,156 ms, and a control directory outside
   Program Files costs the same per file, so it is the platform, not ZenKit and
   not the install layout). Mounting the four VDFs instead reads four archive
   indexes: **15 ms against 2,170 ms**, and measured across the whole world the
   two mounts resolve all 329 texture names and all 444 visual names to the
   same files and decode byte-identical pixels. A mod directory still has to be
   mounted as a directory — it is just usually small.

What is left is honest: **692 ms decoding 454 textures** and **452–591 ms
building 352 bounds trees**, on the main thread, in a spike that does both
eagerly. Phase 1a should decode textures on demand and build the BVH off the
main thread; note that neither is invalidated by an edit, so both belong to the
cold open and neither is in the reload path.

One more thing the phase split exposed: the *first* traversal of a freshly
loaded page shows two frames over 16.7 ms (max 20.1 ms) where the second
traversal shows none (max 8.2 ms). That is first-use texture upload, not
rendering cost — worth knowing before someone reads it as a framerate problem.

#### The unresolved visuals — none of them were a name-mapping problem (2026-08-26)

Phase 0 left two open questions: 53 of 63 MODEL visuals unresolved, and 16 MESH
visuals unresolved. Neither turned out to be about `.ASC`/`.MDS`/`.3DS` mapping,
and the answers are different in kind:

| Visual type | Before | Now | Why |
|---|---|---|---|
| MULTI_RESOLUTION_MESH | 313/313 | 313/313 | |
| MODEL | 10/63 | **63/63** | `Anims.vdf` + model attachments |
| MORPH_MESH | 0/3 | **3/3** | `Anims.vdf` |
| MESH | 0/16 | **n/a** | level compos — must not resolve |
| DECAL | 0/23 | 0/23 | not a mesh; a textured quad |
| PARTICLE_EFFECT | 1/26 | 1/26 | script-defined, not a VFS asset |

1. **The compiled models are in `Anims.vdf`.** `.MDL`, `.MDM`, `.MDH` and `.MMB`
   live there, not in `Meshes` — and an extracted MDK install leaves
   `Anims/_compiled` empty, so nothing mounting only `Meshes` and `Textures` can
   see a single model. The documented mapping was right all along; the archive
   holding the files was never mounted. With it, name resolution is 63/63 and
   3/3.
2. **A model's geometry is in two places, and a static prop's is entirely in the
   second.** `ModelMesh::meshes` holds soft-skin bodies; `ModelMesh::attachments`
   holds rigid sub-meshes hung on hierarchy nodes. `extractVisual` read only the
   first and returned null for the rest, which is why chests, stoves and
   bookshelves came back as nothing. Attachments are now emitted in
   hierarchy-node order — the map they live in is unordered — each carrying its
   node name and the transform accumulated down the node chain. Retail models
   carry up to four (a locked chest is base + lid + lock + zone mesh).
3. **The 16 MESH visuals must never resolve.** They are all on `zCVobLevelCompo`
   VOBs, and they name the source mesh a *slice of the compiled world* came
   from. Measured: 100% of `NewWorld_Part_Xardas_01`'s 19,430 distinct vertex
   positions, 100% of `..._Ship_01`'s and `..._TrollArea_01`'s, and 99.2% of
   `..._Farm_01`'s already appear in `NewWorld.zen`'s own world mesh. Drawing
   them would draw the world twice — the four TrollArea compos alone are 111k
   triangles. They are part *references*, which is the §7 Phase 3 multi-ZEN
   model showing up in the data; the part `.zen`s beside the world are their
   editable sources. (The 0.8% of Farm that does *not* match is a part edited
   after the last full compile — a live example of the drift §5 warns about at
   save time.)
4. **DECAL and PARTICLE_EFFECT are not mesh assets.** A decal's name resolves to
   a texture (23/23 do) and the renderer builds the quad; a `.pfx` is a Daedalus
   instance, not a file in the VFS. Both are correctly "unresolved" by
   `extractVisual` and neither is a defect.

Result: **379 of 428 visuals**, up from 313, and **12,463 VOBs placed** instead
of 11,548 — 1076 draw calls where the budget is 1500, with the framerate above
measured on that fuller scene.

#### The real viewport landed — and reproduces the spike's numbers exactly (2026-08-26)

The spike's pipeline is now the app's: `zen-world` (`coords`, `render`, `scene`,
`assets`), `zenkit.worker` + `WorldService` in the main process, and a lazily
loaded **World** surface in the editor. Driving the *compiled worker* through
the *real* `WorldService` against retail NewWorld — no spike code in the path —
returns the same scene the spike measured, field for field:

| | spike | real pipeline |
|---|---|---|
| Materials → world draw groups | 1400 → 352 | **1400 → 352** |
| World-mesh triangles | 476,445 | **476,445** |
| VOBs enumerated / placed | 23,288 / 12,463 | **23,288 / 12,463** |
| Visuals seen / resolved | 428 / 379 | **428 / 379** |
| Level compos skipped | 16 | **16** |
| Instanced draw groups | 724 | **724** |
| **Total draw calls** | 1076 | **1076** (budget 1500) |
| Unique textures | 490 | **490** |

Cold open is **637 ms** against the spike's 1.8 s, and the difference is exactly
the two costs §3 said belonged elsewhere: textures are no longer decoded eagerly
(549 ms — now one call per texture, on demand, at 1 ms each) and the BVH is no
longer built on the main thread. Phase by phase: `loadWorld` 217, `vobIndex` 8,
`openVfs` 33, `extractWorldMesh` 333, `visuals` 61.

Two things the run found that no test had:

1. **`open` must not transfer the VOB index.** Transferring its columns to the
   renderer detaches them in the worker, and `visuals` reads exactly those
   columns to decide what to place — "Construct on a detached ArrayBuffer", on
   the first real world, after every unit test was green. The index is copied
   (1.69 MB); transfer is for the 31 MB of geometry, which the worker really
   does hand over.
2. **`unresolvedByType` counts VOBs, not visual names** — 1,405 decal VOBs, not
   23 decal visuals. The per-name figure is `visualsSeen - visualsResolved`,
   which is 49, which is the 23 + 26 in the table above.

What is **not** yet measured on the real thing: framerate, draw calls per frame
and pick latency in the app's own viewport. Those still rest on the spike's
numbers, which is why `zenkit-node/spike/viewport/` is **not** deleted yet — it
is the reference the app's viewport has to be measured against, and it is still
the only way to obtain the rAF corroboration §3 records as missing.

Carried over into the real viewport, all of it measured rather than assumed:
GPU ID-picking for instanced VOBs (`VobPicker`, ids shifted by one so a cleared
black buffer is "nothing" rather than VOB 0), a BVH for the world mesh only and
built off the main thread (`BvhBuilder` — deliberately *not*
`GenerateMeshBVHWorker`, which transfers the live geometry's buffers away and
would leave the viewport drawing a detached mesh), textures decoded on demand,
level compos skipped, and one mirrored root node as the entire coordinate and
winding decision.

One build consequence worth recording: three.js is **517 kB** minified and
irreducible — `WebGLRenderer` pulls in the whole shader library — so the CI
chunk-size guard's 500 kB limit is raised to 550 kB in `vite.config.ts`. It
still guards what it was written for (main 398 kB, MUI 468 kB). The World
surface, three and three-mesh-bvh are separate chunks fetched only when the
World view is opened.

---

## 4. Data layer — ZenKit binding (open question 3)

Facts verified against upstream (2026-08):

- **ZenKit** ([GothicKit/ZenKit](https://github.com/GothicKit/ZenKit)) is MIT
  (logo CC BY-NC), **C++20** (the brief says C++17 — that is outdated;
  CMakeLists requires C++20, so MSVC 2019+/GCC 10+/Clang 10+),
  actively maintained, v1.3 line.
- **Saving is supported.** v1.3.0 implemented `save` for `World`, `Mesh`,
  `VirtualObject` and descendants, `MultiResolutionMesh`, `ModelMesh`,
  `Model`, `Texture`, `Font` and `Vfs`, and added the `WriteArchive` API for
  creating ZenGin archives; XZEN-encoded worlds are supported. The header
  confirms the shape the architecture needs — one `World` object carrying all
  four structures we care about, and an explicit game version on both ends:

  ```cpp
  struct World {
    std::vector<std::shared_ptr<VirtualObject>> world_vobs;
    Mesh world_mesh;
    BspTree world_bsp_tree;
    std::shared_ptr<WayNet> way_net;
    // ...
    ZKAPI void load(Read* r, GameVersion version);
    ZKAPI void save(WriteArchive& w, GameVersion version) const override;
  };
  ```

  Note `save` *requires* a `GameVersion` — the per-project explicit target
  version (§9) is not a nicety, it is a mandatory parameter of the data layer.

  **What this does not prove** is round-trip *fidelity*: that loading and
  re-saving an original G1/G2 world reproduces the BSP tree, mesh, materials
  and waynet semantically unchanged. No documentation can establish that;
  only the Phase 0 corpus harness (§5) can, which is why it gates everything.
- **No Node binding exists** (official bindings: C#, Java, Python; plus
  [ZenKitCAPI](https://github.com/GothicKit/ZenKitCAPI), the official
  C wrapper). We build our own.

### `zenkit-node`: N-API addon, C++ API directly

New workspace `zenkit-node/`, vendoring ZenKit as a git submodule, built with
CMake driven from the addon build. Bind ZenKit's C++ API directly with
`node-addon-api` (the C API exists as a fallback but adds a layer without
solving anything we need). N-API keeps the addon ABI-stable across
Node/Electron versions; `prebuildify` ships prebuilds exactly as
`daedalus-parser` does.

**Alternative considered — WASM (Emscripten):** portable, no native build for
consumers, but costs mmap/threads, complicates >2GB worlds and transferable
zero-copy handoff, and this app is Electron-only anyway. Decision: N-API
first; keep the JS-facing API free of leaked native handles in its *data*
types (plain objects + `ArrayBuffer`s) so a WASM backend could substitute
later without API change.

### Binding API shape — coarse-grained and editor-shaped

Not a 1:1 mirror of ZenKit's class graph. The binding exposes exactly what the
editor needs, keeping bulk data in native memory:

```ts
loadWorld(path, gameVersion): WorldHandle          // native-side world
worldIndex(h): VobIndex                            // lightweight tree: ids, names, classes, parents, AABBs
getVobProperties(h, vobId): VobProps               // full typed properties on demand
applyOps(h, ops: WorldOp[]): void                  // transform/reparent/add/delete/set-prop
saveWorld(h, path): void
extractWorldMesh(h): MeshPayload                   // chunked by material, transferable ArrayBuffers
extractVisual(name): MeshPayload                   // MRM/MDL/MDM via Vfs
decodeTexture(name): TexturePayload                // ZTEX → GPU-ready
getWaynet(h): WaynetGraph
normalizeWorld(pathOrHandle): NormalizedDump       // for the semantic diff harness
openVfs(paths): VfsHandle                          // VDF/mod archives for the asset browser
```

The addon runs inside a **worker thread in the Electron main process**
(`MetadataWorkerPool` precedent): a native crash kills the worker, not the
app, and long loads never block the UI or IPC.

Strings cross the boundary as windows-1252 bytes decoded/encoded at the
binding edge with the repo's existing `iconv-lite` conventions — never
"probably UTF-8".

---

## 5. Round-trip strategy — open question 2, Gate 1

Adopt the parser's governing principle unchanged:

> **Fidelity by construction** — the authoritative in-memory model is the
> full ZenKit world object model; the editor edits that model; nothing is
> regenerated from a lossy projection.

Phase 1 never touches mesh, BSP, or lighting data — those objects pass
through the load→save cycle untouched inside ZenKit's model.

**Phase 0 deliverable: `zen-roundtrip` corpus harness** (mirroring
`scripts/roundtrip-corpus.js`):

1. Load every original world of G1 and G2/NotR **including all parts**,
   save without modification, and compare — byte-diff statistics plus a
   **semantic diff** over `normalizeWorld` dumps (VOB tree, materials, BSP
   data, waynet), since byte identity may be unreachable for format reasons
   (ordering, padding) per brief §9.
2. Runs in two modes: **full** against a developer-local Gothic install
   (path from local config, never committed), and **CI** against small
   synthetic fixture ZENs authored in-repo (no game assets, brief §7).
3. Output is a report artifact like the parser corpus job.

The harness is one of **two** instruments. It answers *what changed*; the
in-engine acceptance pass (Phase 0 task T10, `level-editor-phase-0.md` §5)
answers *whether it matters*. Neither alone is sufficient — a conservative
diff flags benign noise as drift, and a clean diff can still hide a broken
world, because ZenGin uses the BSP tree for **collision**, not just rendering.
Together they turn the passthrough call into a lookup (matrix in
`level-editor-phase-0.md` §5), including the case that matters most: a clean
diff with a broken world means the *measuring instrument* is wrong and must be
fixed before deciding anything.

The two candidate strategies:

- **Plan A (default): whole-world re-serialization through ZenKit.** If the
  corpus is clean (semantically identical, byte diffs explainable), untouched
  structures are already preserved by construction and no extra machinery is
  needed.
- **Plan B (fallback, only if the harness finds lossy chunks): chunk-level
  splice.** The ZEN archive is object-structured; for top-level objects the
  editor never modifies (BSP/mesh), retain the original byte ranges from the
  source file and splice them into the output, re-serializing only the VOB
  tree and waynet. Confined to `zenkit-node`; invisible above the binding.
- Fidelity gaps found in ZenKit itself are also **upstreamable** — it is an
  active MIT project and the backend of OpenGothic; fixes benefit both sides.

No editing feature merges before its formats pass the harness. Gate 2
(playability) is **split**: its original-engine half moves into Phase 0 as the
in-engine pass, because that half is what can invalidate the project and it
costs days rather than months to run there. What remains in Phase 1b is the
cross-platform half — the same worlds under OpenGothic — plus re-running the
checklist against worlds edited through the real UI.

### Verdict — Plan A (decided 2026-08-25, Phase 0 task T6.5)

**Plan A holds: whole-world re-serialization through ZenKit produces
engine-loadable worlds.** Decision-matrix cell: **clean diff / engine OK**.
Full record and evidence: `zenkit-node/docs/engine-acceptance-2026-08-25.md`.

The gate did its job — it failed three times first, and the reason was real.
Nineteen ZenKit writer defects had to be fixed to get here (`zenkit-node/patches/`,
all upstreamable); two of them were independently fatal to the original engine.

**What settled it.** The plan's "clean diff / broken engine" cell came up, so the
instrument was widened (`lib/container.js`: a `container` section computed from
the archive *bytes* — hash-table physical order, per-object frame versions,
per-class entry schema, RAW/BOOL payload hashes, the mesh/BSP chunk table — all
classified `semantic-drift`, never benign). It immediately saw what the struct
dump could not. In parallel, a **single-variable engine bisect** localised the
failure instead of theorising about it: worlds built from the original's bytes
with exactly one structure replaced by ZenKit's output.

| Candidate | Engine |
|---|---|
| original + re-serialized VobTree (all 23,289 VOBs) / waynet / header / hash table | **loads** |
| original + re-serialized **MeshAndBsp blob** | **fails** — `sSize<READ_BUFFER_SIZE` |
| full re-save with the original blob spliced back | **loads** |

The blob was both necessary and sufficient. Isolating it chunk-by-chunk named
the two fatal defects exactly: a missing per-mesh alpha-test byte in chunk
0xB020 and a hard-coded BSP header version (`2` where retail G2 has `3`) in
0xC000. Both desynchronised the archive cursor — the engine *consumes* the blob
rather than seeking past it by the declared size — which is why an error inside
the mesh surfaced as a string-length assertion in the VOB tree.

**Where the writer now stands** — all three retail G2 BinSafe worlds
(NewWorld 75 MB, OldWorld 15 MB, AddonWorld 45 MB), re-saved and compared
byte-for-byte over every archive event:

- the **entire mesh/BSP blob is byte-identical** (69,146,243 / 12,962,396 /
  42,540,421 bytes, matching SHA-256)
- the hash table is byte-identical; the stream ends exactly at `hashTableOffset`
- saving twice is byte-identical (the writer was nondeterministic before)
- `classifyDumps`: **`identical`, 0 findings** on all three
- the only byte residual is `zCVobLight.colorAniList` (4/2/16 entries): the
  original writes ZenGin's greyscale shorthand `255 `, ZenKit expands it to
  `(255 255 255)`. Semantically identical, ZenGin's parser wrote and accepts both
  forms, and it was **A/B tested in the engine in isolation** — that candidate
  loads. Documented, not assumed.
- **Spacer II loads the re-saved NewWorld**, with the pristine original as the
  control in the same session.

**Consequences for the plan.** Plan B is not needed: untouched structures are
preserved by construction, as §5 assumed. Its splice machinery was nonetheless
built (it *was* the bisect) and is kept as diagnostic tooling — a working
fallback that has now been demonstrated end to end, should a later format or a
mod-specific world need it.

### Scope of the verdict — BinSafe only (T8, 2026-08-25)

**Plan A holds for `zCArchiverBinSafe` worlds. The ASCII path is out of Phase
0's scope, and not because it was skipped — because it was measured and does
not work.**

Only 4 of the 28 `.zen` files in a retail G2 install are BinSafe: `NewWorld`,
`OldWorld`, `AddonWorld`, `DragonIsland`. All four round-trip `identical` with
a byte-identical mesh/BSP blob and a coverage gap of 0. The other 24 are
`zCArchiverGeneric`/ASCII — 20 worlds plus 4 VOB libraries that are not worlds
at all — and the T8 run over the whole install found:

- **all 20 ASCII worlds abort the process when their own re-save is loaded
  back** (`STATUS_STACK_BUFFER_OVERRUN`, `0xC0000409`). So does a 4 KB world
  authored by ZenKit's own ASCII writer. ZenKit cannot read what it writes.
- **every raw entry the ASCII writer produces is corrupt** — `write_raw` emits
  a stale second hex digit for each byte below `0x10`, so a `vec3 0 0 0`
  re-saves as `05 05 05 05 05 05 05 05 05 05 05 05`.
- **VOB representation is not preserved**: all 1277 OldCamp VOBs go from
  `pack=0` to `pack=1`, and the ASCII body loses 43.9%.
- `write_mat3x3` writes `rawFloat:` where both `read_mat3x3` and ZenGin use
  `raw:`.

Fixing that is a patch series the size of 0010–0019 plus an engine A/B per
patch — a second T6.5, not a finishing touch — and it is not what Phase 0 exists
to answer. The blocking risk *is* retired: the four whole worlds the editor
would actually open re-serialize and load. The `*_Part_*.zen` files are Spacer's
compile-time source layers, not the worlds the engine loads.

**The consequence for Phase 1a is a hard one and is not optional:** the binding
must **refuse to save** a non-BinSafe world until that series lands. A save that
corrupts every raw entry and cannot be re-opened is worse than no save at all.

Evidence, the four named defects and the full corpus table:
`zenkit-node/docs/engine-acceptance-2026-08-25.md` §10.

#### What the `*_Part_*` files actually are, and why we are downstream of them

Called out because "the parts are Spacer's source layers" above is true but
undersells the consequence. Measured in the retail G2 install:

| | |
|---|---|
| Every `*_Part_*.zen` carries a `MeshAndBsp` blob | 67–94% of the file — they are **compiled** sub-worlds, not raw geometry |
| The 4 blob-less `.zen` (`FireTree_*`, `ItLsTorchBurning`) | **uncompiled** ZENs: the VOB tree only, no terrain |
| 11 NewWorld part blobs sum to 85,134,700 B | vs. the whole `NewWorld.zen` blob's 69,146,243 B — **the whole is 23% smaller than the sum of its parts** |
| 25,236 VOBs across the 11 parts | vs. 23,288 in the compiled `NewWorld.zen` |

The community documentation explains all four rows. Parts exist because **the
`.3ds` format caps an object at 65,536 triangles** (GMC also advises keeping a
submesh under 50k for performance) — a modelling-format limit, not a ZenGin
one; the modern alternative is one world mesh internally split into submeshes,
which removes the need for parts entirely. Parts are joined by a **Spacer
macro that recompiles**, not by concatenation:

```
Load world oldworld\SURFACE.ZEN
Load world oldworld\OLDCAMP.ZEN
compile world outdoor
compile light high
```

which is why the merged blob is smaller than its inputs — a global re-BSP and a
global light bake. And VOBs live in the **source** layer: GMC states the part
ZENs "are filled with VOBs separately and the world is compiled as a final
step", which the 25,236 → 23,288 count corroborates.

**So our output is a leaf, not a source.** VOB edits this editor makes to a
compiled world sit downstream of that macro: re-running the merge rebuilds the
world from the parts and our work is gone. Two things make that acceptable
rather than fatal, and they should be stated to users rather than discovered:

1. Re-merging is explicitly a **one-time final step** — GMC warns it "will
   cause issues with culling and stop interiors from rendering" — so mods do
   not re-run it casually. Editing the compiled world *is* the normal VOB
   workflow, which is exactly the position this editor takes.
2. Terrain is out of reach regardless of the archiver. `compile world` and
   `compile light` are a mesh compiler, a BSP builder and a lightmap baker;
   ZenKit implements **none** of them and we are not writing them. So fixing
   the four ASCII defects would let us round-trip a part file and still not let
   us do anything useful with one. The ASCII series buys VOB editing in the
   source layer — nothing more.

Still open, and not to be reasoned about: whether the merge macro *preserves*
VOBs already present on a compiled target or rebuilds the tree purely from the
loaded parts (GMC does not say, and the count above is consistent with either);
and whether "uncompiled ZEN" — a plausible future export path for exchanging
VOB sets — is always ASCII, which would put it behind A1–A4 too. Every sample
in the retail install is.

Sources: [GMC — Worlds](https://gothic-modding-community.github.io/gmc/zengin/worlds/),
[GMC — Spacer](https://gothic-modding-community.github.io/gmc/zengin/worlds/spacer/),
[GMC — Meshes](https://gothic-modding-community.github.io/gmc/zengin/meshes/).

**What this verdict does not cover.** T6.5 is the plan's *E-early* pass — "does
the engine accept it" — and only checklist row 1 (Spacer) has run. Rows 2–10
remain as **T10 / E-full**. Gothic 1 is not installed on the Phase 0 machine, so
G1 coverage is still open.

But their *purpose has changed*, and §5's original worry about collision no
longer applies to an untouched re-save. The concern was written on the
assumption that the re-save would differ from the original in ways a semantic
diff might wave through. It does not. Accounting for **every byte** of NewWorld
(`tools/bytediff.js`, coverage gap 0 — the whole file, not a sampled subset):

```
COVERAGE: 75387729 of 75387729 bytes accounted for, gap 0
identical event bytes: 74952502
hash table identical:  true (434980 B)
differing events: 4 — all zCVobLight.colorAniList
text header: date/user writer stamps only
```

The engine therefore reads **bit-identical mesh, BSP tree, and VOB tree** — the
inputs collision is computed from. Given a deterministic loader, identical input
bytes cannot produce different collision; there is nothing left for row 3 to
discover on an untouched re-save. Rows 2–9 are now an end-to-end smoke test
(they would catch a mistake in *which file got installed*, not a fidelity
defect), and even the four differing light entries were engine-tested in
isolation.

Where the checklist still earns its keep is **row 10 and Phase 1b**: worlds the
editor has actually changed. There, bytes legitimately differ, and collision
becomes a live question the moment anything the BSP indexes is touched — which
is precisely why Phase 1 never edits mesh or BSP.

---

## 6. Workspace layout and app integration

```
daedalus-dialog-suite/
├── zenkit-node/                 # NEW: N-API binding, vendored ZenKit submodule,
│                                #      zen-roundtrip corpus harness
├── zen-world/                   # NEW: pure TS domain — no React/MUI/Electron/native imports
│   ├── model/                   #   VOB-tree ops, command/inverse (undo) definitions,
│   │                            #   part-workspace model, project file schema
│   ├── waynet/                  #   graph model + validations (orphans, unreachable, dupes)
│   ├── analysis/                #   script↔world: spawn extraction, routine timeline,
│   │                            #   occupancy conflicts, WorldState context object
│   └── coords/                  #   THE single ZenGin↔Three.js conversion module
├── daedalus-parser/             # unchanged; zen-world consumes its semantic model
└── daedalus-dialog-editor/      # gains the "World" surface (lazy-loaded)
    ├── src/main/services/WorldService.ts     # owns the zenkit-node worker
    ├── src/main/workers/zenkit.worker.ts
    └── src/renderer/components/world/        # viewport, scene tree, property grid,
                                              # asset browser, time slider
```

### Decision: integrate into the existing app (not a third app)

**Recommendation: the level editor is a new top-level surface of
`daedalus-dialog-editor`**, not a separate Electron app.

For: the differentiator features are *joins* between scripts and world — one
process, one project model, one problems panel, one Monaco, one go-to
navigation. A second app would duplicate `ProjectService`, `FileService`,
settings, updater, packaging, and still need cross-app IPC for exactly the
features that make the project worth building. The quest editor sets the
in-app pattern: pure domain package, thin UI, one-way imports (UI → domain).

Against (and mitigations): app bloat and stability risk for existing dialog
users → the World surface is a lazily loaded route/chunk (CSP-compatible,
same discipline as the Monaco self-origin move); `zenkit-node` loads only
when a world project opens; all level-editor domain logic lives in
`zen-world`, so if packaging size, startup time, or stability regress, the
tripwire response is a mechanical split into a separate app shell — the
domain and binding packages move unchanged.

Naming note: the app's product identity ("Daedalus Dialog Editor") will need
revisiting when the World surface ships; defer.

---

## 7. Process & data-flow architecture

```
┌ renderer ──────────────────────────────────────────────┐
│ React UI (scene tree, props, panels)   Three.js viewport│
│   Zustand worldStore: VobIndex,          GPU buffers    │
│   selection, dirty part set              (transferables)│
└──────────────▲───────────────────────────▲─────────────┘
        IPC: index, props, ops      IPC: mesh/texture payloads
┌ main ────────┴───────────────────────────┴─────────────┐
│ WorldService — authoritative op log, save orchestration │
│   └─ zenkit.worker (worker thread)                      │
│        └─ zenkit-node (N-API) — ZenKit world in memory  │
└─────────────────────────────────────────────────────────┘
```

- **The React state never holds the world.** The renderer store holds the
  lightweight `VobIndex`, selection, and dirty flags — the direct extension of
  the existing render-performance rule ("don't pass `semanticModel` into
  memoized components"). Mesh/texture payloads flow as transferable
  `ArrayBuffer`s straight into Three.js `BufferGeometry`/textures, bypassing
  React entirely.
- **All edits are ops** (`MoveVob`, `ReparentVob`, `SetVobProp`, `AddVob`,
  `DeleteVob`, waynet edge ops …) defined in `zen-world` with inverses.
  Gizmo drags preview locally in the viewport; on commit the op goes to
  `WorldService`, applies to the authoritative native model, and lands in the
  history stack. Undo/redo replays inverse ops through the same path —
  multi-select batch edits are just op batches.
- **Save** writes only dirty parts (brief §4.2), atomic temp+rename per the
  existing save pipeline, with the stale-vertex-lighting and
  savegame-invalidation warnings (brief §7) surfaced at save time.
- **Coordinates:** authoritative data is always ZenGin-space (cm,
  ZenGin handedness). Conversion to Three.js space happens in exactly one
  module (`zen-world/coords/`), used at the render/gizmo boundary, with
  property-based round-trip tests. No scattered axis flips.
- **Triangle winding belongs to that same single boundary (measured
  2026-08-26).** `zenkit-node` emits indices in stored order and makes no
  winding claim. Measured across the retail corpus with
  `zenkit-node/scripts/check-visual-winding.js`, the geometric normal of a
  triangle in stored order, read right-handed, points *against* the normals
  ZenGin stored on its corners: 230,395 of 230,395 triangles over 1351 loose
  `.MRM` visuals, and 475,146 of 475,184 decidable NewWorld world-mesh
  triangles — two independent readers, one answer. So the flip is uniform and
  is `coords`' job, exactly like the axis convention; it is never a per-mesh
  or per-visual decision, and the spike must not sprinkle
  `side: DoubleSide` over the problem instead.
- **Multi-ZEN workspace (Phase 3):** parts are a storage format, not a work
  model (brief §4.2) — `WorldService` holds N part handles, the viewport
  renders their union with correct world transforms, every VOB knows its
  part, and only dirty parts are rewritten.

---

## 8. Daedalus integration — open question 4

**In-process library, no LSP.** The parser already runs in this app with a
worker pool, crash budget, and project-wide semantic models; an LSP would add
serialization and process management to reach code we own in the same
runtime. (If an external-editor story is ever wanted, an LSP can wrap the
same analysis layer later.)

- `zen-world/analysis/` consumes the **parser's semantic model** (keeping
  `daedalus-parser` game-agnostic): extracts `Wld_InsertNpc`/`Wld_InsertItem`
  call sites, `TA_*` routine windows, `B_SetNpcVisual` chains,
  `Npc_ExchangeRoutine` sites. Statically unresolvable call sites (loops,
  `Hlp_Random`, guild/distance conditions) are **marked dynamic and excluded**
  from rendering and conflict checks — never guessed (hard rule from brief
  §5.1).
- **`WorldState` is an explicit object from day one** (brief §5.2 mandate):
  Phase 1 constructs only the constant start state, but every evaluation
  (time slider, spawn resolution, conflict checks) takes it as a parameter,
  so the scenario-context extension later swaps the object, not the logic.
- Cross-validation (waypoint existence both directions, freepoint-vs-waypoint
  spawns, duplicate NPC IDs, orphaned waypoints) feeds the existing problems
  panel; markers in the viewport drive the camera to the offending
  VOB/waypoint, mirroring the brief's "spatial, pre-compile" validation
  decision for portals.

---

## 9. Project file — open question 5

A JSON project file, e.g. `myworld.gothicproject.json`, committed with the
mod's content:

```jsonc
{
  "version": 1,
  "target": "g2-notr",              // g1 | g2 | g2-notr — explicit, never guessed
  "scriptsRoot": "./Scripts",
  "worlds": [{
    "name": "NewWorld",
    "parts": [{ "path": "./Worlds/NEWWORLD.ZEN", "role": "main" },
              { "path": "./Worlds/NEWWORLD_PART_*.ZEN", "role": "part" }]
  }]
}
```

Machine-local, non-committed state (Gothic installation path, VDF search
paths, window layout) lives in the existing `SettingsService` store keyed by
project — same split the app already uses for app settings. Target version is
per-project and explicit (brief §7); the binding refuses to load with a
mismatched archive version rather than guessing.

## 10. Multi-user — open question 6

Keep the part-split as the collaboration unit; no locking or merge
infrastructure. Because saves rewrite only dirty parts, two people editing
different parts merge cleanly in git; same-part conflicts are resolved like
any binary-file conflict (rare at hobby-team scale, and Phase 3 can add a
part-level "who edits what" convention in the project file if needed).
Anything beyond this is out of scope.

---

## 11. Phasing and gates

Each phase lands TDD (Jest for `zen-world` and binding-level tests;
Playwright browser-harness for UI flows; viewport correctness via scene-graph
and pixel-snapshot assertions where DOM assertions can't reach).

Phase 0 has its own task-level breakdown:
[`level-editor-phase-0.md`](level-editor-phase-0.md) — fixture/oracle
strategy, the `normalizeWorld` schema, build integration, and the test
list in TDD order.

- **Phase 0 — data layer (blocking, = brief Gate 1 + the original-engine half
  of Gate 2).** `zenkit-node` binding; `zen-roundtrip` corpus harness green
  against all G1+G2 originals including parts (developer-local) and synthetic
  fixtures (CI); **and the in-engine acceptance pass** — an untouched re-save
  and a minimally edited world both load and behave in original Gothic. An
  early one-world engine check (T6.5) runs before the harness is even built,
  since a re-save the engine refuses would make the harness moot too.
  Decides Plan A vs Plan B passthrough. *No editor UI before this gate.*
- **Phase 1a — read-only world viewer.** Opens with the **viewport perf
  spike** (§3): full G2 NewWorld against the written frame/draw-call/pick
  budget, before any viewport UI is built on Three.js. Then: load ZEN, render
  world mesh + VOB visuals + waynet graph, scene tree, property inspection,
  asset browser (VFS). Already useful on its own.
- **Phase 1b — VOB editing.** Gizmos, multi-select, batch property edit,
  drag-&-drop reparenting, undo/redo, dirty-part save with lighting/savegame
  warnings. Closes with the **remainder of Gate 2**: worlds edited through the
  real UI re-run the Phase 0 engine checklist, and the same worlds are
  verified under OpenGothic for the cross-platform claim.
- **Phase 1c — Daedalus overlay.** NPC/item rendering from static spawns,
  time slider, occupancy/gap/overlap checks, cross-validation in the problems
  panel, go-to-definition both directions.
- **Phase 2 — portal/sector validation** (static checks first: pairing,
  orientation, accidental `P:` materials; geometric checks after: planarity,
  intersections, leak flood-fill, triangle limits), spatial display, **Gate 3**
  (each seeded error class detected pre-compile). Face-material authoring
  only after validation proves out.
- **Phase 3 — multi-ZEN workspace.** All parts loaded, seamless navigation,
  changed-parts-only export.
- **Later / kept-open by design:** scenario context (swap the `WorldState`
  object), "play from here" via OpenGothic launch, Daedalus-VM-backed
  evaluation if static analysis coverage proves insufficient.

Out of scope stays out of scope: **no BSP compiler, no terrain sculpting**
(brief §3) — the editor edits VOB trees and waynets of compiled ZENs and
validates portal metadata; it never recompiles worlds.

---

## 12. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| ZenKit save fidelity gaps on some world/format (the load→save→compare corpus fails) | **High — the project's kill criterion** | Phase 0 gate before any UI investment; Plan B chunk splice; upstream fixes (active MIT project, OpenGothic's backend) |
| A ZenKit-written world the **engine refuses to load**, invisible to any file-level diff | **High — the hardest stop** | Pulled forward to Phase 0: one-world engine check (T6.5) before the harness is built, full checklist (T10) before Phase 1 is scheduled — days to discover instead of months |
| Native addon build/distribution pain (Electron ABI, Windows toolchains, pnpm) | Medium | N-API (ABI-stable), `prebuildify` prebuilds, exact precedent in `daedalus-parser`; worker-thread isolation contains native crashes |
| Viewport performance on full outdoor worlds | Medium | Measured Phase 1a entry spike against a written budget (§3); material-chunked world mesh, instanced VOBs, `three-mesh-bvh` picking; editor-grade rendering only — no engine-parity goal. No public Three.js ZEN viewer exists as proof, hence the spike |
| Bloating the shipping dialog editor | Medium | Lazy-loaded surface, `zenkit-node` loaded on demand, domain isolated in `zen-world`; tripwire: split into a separate app shell if startup/size/stability regress |
| Effort underestimation (Phase 1 is the repo's biggest feature yet) | Medium | Phase 0/1a/1b/1c each ship standalone value; stopping after any phase leaves a useful tool |
| G1/G2/NotR format divergence | Medium | Explicit per-project target version; corpus covers both games; binding refuses version mismatches |
| License contamination | Low | ZenKit MIT ✓ (repo is MIT); **KrxImpExp is GPLv3 — never link or derive, file-level interop only**; no game assets in repo or CI |
| OpenGothic preview ≠ original-engine truth | Low | Documented limitation (brief §7); Gate 2 tests against both runtimes |

---

## 13. Brief §10 open questions — answer key

| # | Question | Answer |
|---|---|---|
| 1 | Godot plugin or standalone? | Neither: Electron + Three.js surface in this suite (§3) |
| 2 | Non-mappable ZEN structures — passthrough blob or full model? | Full ZenKit model as source of truth; renderer is a projection; chunk splice only as harness-driven fallback (§5) |
| 3 | ZenKit bindings — C++, C#, or Rust? | Own N-API Node binding (`zenkit-node`) against the C++ API (§4) |
| 4 | Tree-sitter in-process or LSP? | In-process (already is); analysis layer in `zen-world` (§8) |
| 5 | Project file format? | `*.gothicproject.json` + machine-local settings split (§9) |
| 6 | Multi-user model? | Part-split as collaboration unit, git-based; no locking (§10) |
