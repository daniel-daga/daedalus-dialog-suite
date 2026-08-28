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

#### The rAF corroboration, obtained — and the run that invalidates half the CPU numbers above (2026-08-26)

A foreground run finally produced `presented.valid: true` — 840 frames, **0
stalls**, `hiddenAtSomePoint: false`. It corroborates the frame-time verdict:

| | synchronous (`gl.finish()`) | **presented (rAF)** |
|---|---|---|
| p50 | 4.9 ms | 6.2 ms |
| p95 | 6.2 ms | 7.9 ms |
| max | 8.9 ms | **15.5 ms** |
| frames over 16.7 ms | 0 of 840 | **0 of 840** |

**The gate holds on real presented frames, not just on work submitted.** The
worst frame in 840 was 15.5 ms — 64.5 fps instantaneous — and not one crossed
16.7 ms. Note that `presented` p50 is *floor-limited by the panel*: mean 168.6
presented fps means this display refreshes every ~5.9 ms, so 6.2 ms p50 is the
refresh interval, not the renderer. What the rAF sweep actually proves is that
nothing stalls; the renderer's own cost is still the 4.9 ms number.

**Then the same run contradicted three numbers this document states as
measured.** Comparing it against the run those came from:

| | recorded above | foreground run | |
|---|---|---|---|
| `gl.finish()` frame p50 | 4.9 ms | 4.9 ms | unchanged |
| `loadWorld` / `extractWorldMesh` (node) | 218 / 267 ms | 218 / 271 ms | unchanged |
| scene build (browser) | 159 ms | **48 ms** | 3.3× |
| BVH build, 352 trees (browser) | 452–591 ms | **145 ms** | 3.1–4.1× |
| Pick — whole scene (browser) | 14.2 ms p50 | **5.6 ms p50** | 2.5× |

The pattern is not noise and it is not the machine: **everything measured in the
node process is unchanged, the GPU-bound number is identical to the decimal, and
every CPU-bound measurement taken inside the browser is ~3× faster.** That is
one cause, and it is the same one the second instrument bug was about — the
earlier run was in a background tab. Chrome does not only suspend `rAF` there;
it deprioritises the whole renderer process. `gl.finish()` was immune because it
is GPU-bound, which is exactly why it was chosen and exactly why it hid this.

**So decision 1 below rests on a throttled measurement.** "A CPU raycast across
the instanced VOBs costs 14.2 ms and blows the one-frame budget by itself" is
what a *backgrounded* tab measures. In the foreground it is 5.6 ms p50 / 6.3
p95, which is inside a 60 Hz frame — the budget it was said to fail.

That does not reverse the decision, and GPU ID-picking stays:

- it is O(1) in prop count, where a CPU raycast is linear in `InstancedMesh`es
  and gets worse as a world grows or as parts are loaded (§7 Phase 3);
- 5.6 ms of a 16.7 ms frame for one click is still a third of the budget spent
  on selection alone, and on *this* panel's ~5.9 ms refresh it is a whole frame;
- the throttled figure is not a fictional state. A laptop editor spends real
  time deprioritised, and a budget that is only met in the good state is not met.

But the *justification* is now "the better mechanism, and the only one that
holds in the degraded state", not "the alternative fails outright". Anyone
re-deriving this should re-measure foreground and background deliberately rather
than trusting either number alone — and should treat every browser-side CPU
figure recorded above (scene build, BVH build, both pick rows) as pessimistic by
about 3×.

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
4. **An attachment's node transform has to be *applied*, and for six weeks it
   was not (found 2026-08-26).** The binding emits each attachment's accumulated
   hierarchy matrix rather than baking it — deliberately, since baking is a
   coordinate decision the binding does not make — and nothing above it ever
   read the field. Measured on retail NewWorld: **57 of 153 attachment chunks
   are displaced by more than 1 cm**, up to **1.25 m** (`TOUCHPLATE_STONE.MDS`'s
   plate, `RMAKER_1.MDS`'s three circles, `BARBQ_SCAV.MDS`'s chicken), so every
   one of those parts was drawn stacked at its model's origin. It is applied in
   `mergeChunks` and not as a per-draw-call matrix, because two attachments of
   one model can share a texture and then they are one buffer with two
   transforms; positions take the whole affine matrix and **normals only the
   rotation**, since a normal is a direction. It was found by writing the bbox
   measurement below — which places a visual by a VOB's transform and reproduced
   20,472 of the engine's own stored boxes, so the placement it applies is the
   one ZenGin agrees with.
5. **DECAL and PARTICLE_EFFECT are not mesh assets.** A decal's name resolves to
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

That run is now a script rather than a one-off:
`daedalus-dialog-editor/scripts/verify-world-pipeline.js` prints the table
above, and is the only instrument that drives binding → worker → IPC → payload
end to end against real data. It is developer-local for the same reason
`zen-roundtrip` is. The detached-index check below is an explicit assertion in
it, so that bug cannot return quietly.

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

What was **not** measured on the real thing at the time of writing: framerate,
draw calls per frame and pick latency in the app's own viewport. Those rested on
the spike's numbers, which is why `zenkit-node/spike/viewport/` was kept — it was
the reference the app's viewport had to be measured against. **That measurement
has since been taken and the spike is deleted; see the next section.** (The rAF
corroboration it was also being kept for has since been obtained: see above. It
came with the finding that every browser-side CPU number in §3 was measured in a
background tab and is ~3× pessimistic, including the pick row that made GPU
ID-picking mandatory.)

#### The app's own viewport, measured on screen — the spike is retired (2026-08-26)

Every budget row above was the spike's. They are now the app's: `WorldViewport`
exposes the live renderer, camera, picker and BVH to `viewportBenchmark.ts`,
which runs the spike's sweep — the same 900-frame three-leg camera path, the
same `gl.finish()` primary instrument, the same rAF corroboration, the same
deterministic rays — against the scene `WorldScene` actually builds.
`daedalus-dialog-editor/scripts/measure-viewport.js` drives it through the real
Electron app on retail NewWorld, on the Radeon 890M.

**The same build, same world and same sweep was measured in two different
machine states**, hours apart, and the difference is large enough that a single
absolute number would have been a fiction. The second state is a **GPU shared
with another workload** — confirmed, not inferred — and the report tells the two
apart by itself: the panel was presenting at 168 Hz in the first and 53 Hz in the
second, and the renderer's own cost roughly doubled with it.

That makes the pair more useful than either half. The 168 Hz rows are what this
scene costs on an uncontended integrated GPU; the 53 Hz rows are what it costs
when something else is using it, which is an ordinary condition for a laptop
editor and exactly the state a budget has to survive.

| Metric | Budget | 168 Hz state (2 runs) | 53 Hz state (3 runs) | spike | |
|---|---|---|---|---|---|
| Frame time, `gl.finish()` | < 16 ms | **4.6 / 4.4 p50** | **8.1 / 7.9 / 7.9 p50** | 4.9 p50 | ✅ |
| Worst frame in 840 | < 16.7 ms | 8.0 ms | **13.5 ms** | 8.9 ms | ✅ |
| Frames over 16.7 ms | 0 | **0 of 840** | **0 of 840** | 0 of 840 | ✅ |
| Draw calls per frame | < 1500 | 974 p50, **1076 max** | 945 p50, **1076 max** | 1076 | ✅ |
| Triangles per frame | — | **2,740,125** | **2,740,125** | 2.74 M | |
| Pick — world mesh, BVH | < 1 frame | 0.1 p50 | 0.2 p50 | 0.2 p50 | ✅ |
| Pick — whole scene, CPU raycast | < 1 frame | 2.7 p50 | **3.8 p50** | 5.6 p50 | ✅ |
| Pick — VOBs, GPU ID | < 1 frame | 2.1 p50 | **7.2 p50, 12.1 p95** | never measured | ✅ |
| Presented (rAF) | — | 5.8 p50, **0 of 840** over 16.7 ms | 18.7 p50, **791 of 840** over | 6.2 p50 | — |

**The gate passes in both states on the instrument that answers it.** The worst
frame in 840 was 13.5 ms even in the degraded state, and not one crossed 16.7 ms
in any run. Draw calls and triangles per frame are identical to the unit across
every run, which is what says the sweep really did render the same scene each
time. So `zenkit-node/spike/viewport/` has nothing left to say and is **deleted**.

Four things the app's own measurement says that the spike's could not:

1. **`framesOver16ms` on the presented series is a fact about the display, not
   a verdict on the renderer.** In the 53 Hz state 791 of 840 presented frames
   crossed 16.7 ms while the renderer never took more than 13.5 ms to draw one:
   the panel was simply not showing frames any faster. §3 already noted that
   presented p50 is floor-limited by the panel; at 168 Hz that caveat was
   harmless and at 53 Hz it inverts the reading of the row entirely. The report
   now computes it — `presented.displayBound` is true when the renderer's p95
   finishes inside the presented interval — so nobody has to notice it by eye.
   **Only the synchronous sweep is a verdict on the renderer.**
2. **GPU ID-picking is not the fast option. It is the scale-free one, and on a
   contended GPU it is the slower one.** Measured: 2.1 ms against the CPU
   raycast's 2.7 ms at 168 Hz — and **7.2 ms against 3.8 ms** with the GPU shared, where
   it loses by nearly 2×. `readRenderTargetPixels` is a *synchronous* readback that
   stalls the pipeline, so its cost tracks GPU state rather than prop count,
   which is exactly what makes it both scale-free and fragile. §3 decision 1
   claimed 40× (14.2 ms against 0.3), the foreground re-measurement claimed 19×,
   and the app's own viewport says the two mechanisms are within 2× of each other
   in either direction. The decision stands on one leg only — O(1) in prop count
   against a raycast that is linear in `InstancedMesh`es and degrades as parts
   load (§7 Phase 3) — and **the readback should be made asynchronous**
   (`readRenderTargetPixelsAsync` / a PBO) before anything else in the pick path
   is optimised.
3. **The first GPU pick of a session costs 53 ms — and once, 276 ms.** That is
   the pick shader compiling on first use, the same class of first-use cost §3
   already records for texture upload. It is not a per-click cost and does not
   touch the budget, but a Phase 2 that wants the first click to feel like the
   rest should warm the pick pass when the world opens.
4. **A pick sweep needs a hit count or it is not a latency.** The first run of
   this benchmark reported a whole-scene raycast at **0.1 ms p50** — faster than
   the same ray through a BVH, and 56× faster than the spike. Every ray had
   missed: the sweep left the camera wherever its last frame put it, and a ray
   that hits nothing is rejected by a bounding sphere and costs almost nothing.
   The instrument now aims from a fixed viewpoint inside the world and reports
   `hits` alongside every percentile (118 of 200 rays hit terrain, 25 of 200 hit
   a prop). A miss rate is not a detail of the report; without it a broken
   measurement reads as an excellent result.

One confound was found and removed between the two states, and it is worth
recording because it invalidated nothing and could have invalidated everything.
The driver stubs the app's file dialogs, and the first version told them apart by
testing the title for `"Gothic"` — but the *project* picker is titled "Select
Gothic Mod Project Folder", so it was answered with the **installation
directory**. Every early run therefore opened the whole Gothic install as the
editor's project and left it being indexed in the background underneath the
measurement. The dialogs are now matched on their exact titles, and an
unrecognised one throws rather than being answered by whichever branch happens to
match first. (The indexed-install runs were the *faster* ones, so the confound
was not what produced the difference between the two states — but that is luck,
not a defence.)

#### The foreground/background A/B — controlled, and the guard that came out of it

§3 above inferred from a disagreement between two runs that a background tab
throttles every CPU-bound browser measurement. Run deliberately, same build,
same world, same sweep, window minimised instead of focused:

Both sides of this A/B were taken in the 168 Hz machine state, back to back:

| | foreground (2 runs) | minimised (2 runs) | |
|---|---|---|---|
| Frame time, `gl.finish()` p50 | 4.6 / 4.4 ms | **7.5 / 8.0 ms** | 1.7× |
| Pick — world mesh, BVH p50 | 0.1 / 0.1 ms | **0.3 / 0.3 ms** | 3× |
| Pick — whole scene p50 | 2.7 / 2.7 ms | **6.6 / 5.3 ms** | 2.0–2.4× |
| Pick — VOBs, GPU ID p50 | 2.1 / 2.2 ms | **5.0 / 4.1 ms** | 1.9–2.3× |
| Presented (rAF) | valid, 0 stalls | **not one callback in 30 s** | — |
| Draw calls, triangles | 974 / 2,740,125 | 974 / 2,740,125 | identical |

**The inference is confirmed: every CPU-bound number degrades ~2–3× outside the
foreground, and the scene itself is provably unchanged** — draw calls and
triangles per frame are identical to the unit, so the sweep really did render
the same thing both times.

One correction to §3 falls out of it. §3 says `gl.finish()` "was immune because
it is GPU-bound". That holds for a *background tab* — the spike measured 4.9 ms
both ways — but **not for a minimised window**, where it degrades 1.7×. A
minimised window is the stronger condition: it is not composited at all. So the
rule is not "GPU-bound numbers are safe"; it is that the degraded state has
degrees, and the only safe measurement is one that proves it was in the good
one.

**Which is the finding worth more than the measurement.** The guard this
benchmark started with was `document.hasFocus()` and `document.visibilityState`,
checked throughout the run. Both are **wrong in Electron**: a minimised window
reports `hasFocus() === true` and `visibilityState === 'visible'` while
Chromium throttles it anyway. The A/B's first background run therefore came
back `valid: true` — 2.4× slower on every CPU number, rAF suspended outright,
and both signals the guard trusted saying it was in the foreground.

So `viewportBenchmark` makes the rAF sweep **the guard, not the
corroboration**: a report is `valid` only if frames were actually presented at a
sane rate, because presented frames are the only evidence Chromium was not
deprioritising the renderer. Every browser-side number this project records from
here needs that guard, not a focus check — and `--background` exists on the
driver precisely so the degraded state can be measured on purpose rather than by
accident.

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

#### The pick readback is asynchronous — and the pick has two costs now (2026-08-26)

The section above ends by saying the readback "should be made asynchronous
before anything else in the pick path is optimised", because the GPU pick's
cost was never prop count: `readRenderTargetPixels` stalls the pipeline until
the GPU has drained, which is why it cost 2.1 ms idle and **7.2 ms with the GPU
shared**, losing to the 3.8 ms CPU raycast it was chosen over. `VobPicker` now
reads through a fence (`readRenderTargetPixelsAsync`).

**Measured as a controlled A/B**: the same world, the same sweep and the same
window, the synchronous build and the asynchronous one built and run back to
back — `render.frameMs.p50` 4.3 against 4.6, draw calls identical at 945 p50 /
1076 max, the same 25 of 200 rays hitting a prop, so the two runs really are
measuring the same scene in the same machine state.

| Prop pick, 200 rays | synchronous | asynchronous | |
|---|---|---|---|
| **Main thread blocked, p50** | **2.4 ms** | **0.9 ms** | 2.7× |
| blocked, p95 | 4.6 ms | 1.8 ms | 2.6× |
| blocked, max | **48.9 ms** | 4.9–13.5 ms | |
| Click → answer, p50 | 2.4 ms | 6.9–9.1 ms | |
| Click → answer, max | 48.9 ms | 15.7 ms | |

**So the pick has two costs and they answer different questions**, and the
report states both: `pickVobs` is click-to-answer, which is the budget row, and
`pickVobsBlocking` is what the main thread spent, which is the part that
competes with the frame. Reading only the first would call this a regression.

- **What got better is the number that mattered.** 0.9 ms p50 of main thread
  against 2.4, and the worst single pick fell from **48.9 ms — three frames,
  synchronously, in a run whose median was 2.4** — to under 5. That tail is the
  characteristic shape of a synchronous readback: its cost is whatever the GPU
  happens to owe, not what the pick asks for.
- **What got worse is latency, and it stays inside the budget.** 6.9–9.1 ms p50,
  15.7 ms worst of 200. Most of it is not the GPU: three's `probeAsync` polls
  the fence on a **4 ms timer**, so ~4 ms is a floor no pick can beat. The row
  is "< 1 frame" and it passes, but with far less headroom than the blocking
  number suggests — a pick that answers one frame later is a correct trade for
  a frame that is never stalled, and it is a trade, not a free win.
- The comparison is at **880×746**, not the 1463×780 of the runs recorded above,
  which is why draw calls read 945 rather than 974: a different aspect culls
  differently. The pick itself draws 1×1 either way.

**And the first pick of a session no longer costs 53 ms** (once, 276 ms)
compiling the pick shader: `VobPicker.warm` draws the pick pass once when the
world opens, which is where §3 said that first-use cost belonged.

##### The measurement disagreed before it agreed, and the defect was in the instrument

Two minimised runs of the asynchronous build answered **32 and 28** prop hits
where every foreground run answered exactly **25** — and a hit count is not a
number that may wobble; the rays are fixed and so is the camera. The
synchronous build re-measured in the same minimised state answered 25 twice,
which is what said the discrepancy was new rather than a property of the
degraded state.

The cause was in `viewportBenchmark`, not in the picker. **A rAF sweep that
ends on its 30 s timeout leaves a callback outstanding**, and Chromium delivers
it whenever it next composites the window. `step` then moved the camera and
rendered — under the pick rays. A *synchronous* pick loop never gave it the
chance to run; a loop that awaits a fence between rays does. So making the
readback asynchronous did not introduce the defect, it made a latent one
reachable, and every pick after the stray frame had been aimed from wherever
that frame left the camera. `step` now returns immediately once the sweep has
finished, and both minimised runs answer 25.

Worth keeping in mind beyond this instrument: **anything that was only correct
because it ran without yielding stops being correct the moment it awaits.**

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

Names above are the design-time sketch, not the shipped surface — several
differ (`worldIndex` shipped as `vobIndex`). `getVobProperties` shipped as
**`getVobProps(h, indexPath)`** in 2026-08-28's class-property slice (§7), and
addressed by native index path rather than by a VOB id, because a VOB has two
addresses and every op already resolves the path.

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
- `classifyDumps`: **`identical`, 0 findings** on all three (measured 2026-08-25;
  patch `0028` cost all four BinSafe worlds that verdict for a day; `0044`
  gave it back — §16.13)
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
at all — and the T8 run over the whole install found **all 20 ASCII worlds
aborting the process when their own re-save was loaded back**
(`STATUS_STACK_BUFFER_OVERRUN`, `0xC0000409`), traced to four named writer
defects A1–A4.

**Three of those are now fixed** (patches `0024`–`0026`, 2026-08-27, §10.4 of the
acceptance record): A1 the corrupt hex, A4 the header padding, and A5 — a fifth
defect the corpus only exposed once A1 let a file load far enough to reach it,
`write_byte`/`write_word` emitting type tokens the reader rejects. The same
command over the same install now reports **24 of 28 measured, 0 crashed, 0
unreadable**, all 24 container-instrumented.

**That changes the coverage, not the claim.** The 20 ASCII worlds classify
`semantic-drift`, not `identical`, and no ASCII world has been through the
engine. What remains:

- **A6** — `physicsEnabled` dropped on every save, and **not an ASCII defect**:
  it is the packed `zCVob` writer (`VirtualObject.cc:251` gating bit 6 on a
  `rigid_body` only savegames fill), so the BinSafe path this plan's save
  pipeline uses has it too. It changes no retail byte today — 0
  `physicsEnabled` VOBs across 41,393 in the three measurable BinSafe worlds —
  which is why it went unseen. **The 43,341-of-43,469 figure that used to sit
  here was not A6**: it was A2's packed conversion, and it went with A2 (§16.9).
  (The older "396 of 400" was the harness's per-world finding cap read as a
  total; the report says when it caps now.)
- **A2 and A3 — closed 2026-08-28**, patches `0045`–`0047`. What replaced them
  on the ASCII path is float text precision, §16.9.
- **`animMode` on 128 VOBs — diagnosed, and no patch is possible.** 130 retail
  `oCMobContainer` chests store a heap-pointer-shaped `visualAniMode` (Spacer
  serialising an uninitialised member; 128 of them `0x08A8B0E8`). ZenKit narrows
  it twice — uint32 to the `uint8_t` `AnimationType` on load
  (`VirtualObject.cc:159`, `VirtualObject.hh:67`), then to two bits by the
  packed writer (`:255`) — giving the reported `104 vs 0`. **The save pipeline
  here is unaffected**, the opposite of A6: a packed reader can only produce
  0–3 and the mask is the identity on those, measured as 0 findings across all
  four BinSafe worlds. The packed format has two bits for this field, so a
  byte-faithful fix would need `AnimationType` widened upstream *and* the
  unpacked writer, which `0045`–`0047` have now resurrected.

**The Phase 1a consequence is unchanged and is not optional:** the binding
still **refuses to save** a non-BinSafe world. "Loads back" is not "is
faithful", and until an ASCII world has an engine verdict the refusal stands.

Evidence, the named defects and the full corpus tables:
`zenkit-node/docs/engine-acceptance-2026-08-25.md` §10.2 and §10.4.

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

#### The Phase 1a panels, landed (2026-08-26)

The surface is **scene tree | viewport | properties**, with the left panel
tabbed between the scene and the mounted assets and the right panel following
it — a VOB's properties belong beside the tree, an asset's preview beside the
browser.

- **Scene tree.** The hierarchy is two columns of `vobIndex` (`parent`,
  `childIndex`), reconstructed in `zen-world/model`. Collapsed by default and
  virtualized: verified against retail NewWorld, 23,288 VOBs are **23 rows in
  the DOM**. A viewport pick returns a VOB index and nothing else, so the tree
  expands the ancestors it is hidden behind and scrolls to it.
- **Property grid.** Read-only, and it keeps two conventions the viewport does
  not get to change: positions stay in **ZenGin centimetres** (the single
  conversion is the mirrored root node, and it is one-way), and `flags` is shown
  as named bits. It also answers what the viewport cannot — why a VOB that
  exists is not drawn — for level compos, particle effects and decals, all three
  of which are measured correct behaviour rather than gaps.
- **Asset browser.** Over the *mounted VFS namespace*, not the filesystem:
  `openVfs` merges the retail VDFs and any mod sources into one namespace, later
  sources winning. It needed one new binding call, `vfsList`, which walks **one
  level** — a Gothic install is tens of thousands of entries — and answers null
  for a missing path and for a file alike, because both mean "nothing here to
  list". A texture previews as an image, because `decodeTexture` already returns
  RGBA8 and a canvas is the whole of the work; a mesh does not, and says so
  rather than showing an empty frame.

- **Waynet overlay.** `getWaynet` is to `normalizeWorld`'s waynet section what
  `vobIndex` is to the VOB dump: the dump sorts waypoints by name and sorts each
  edge pair because order is noise to a diff, while an overlay needs stored
  order and edges as **index pairs into it**. Verified against retail NewWorld:
  **2,959 waypoints, 3,402 edges, 0 dangling, 0 out-of-range indices**, and the
  two independent readers agree on the waypoint set, the edge set, the positions
  and the flags. It is fetched only when switched on, hangs under the same
  mirrored root as everything else — so its positions stay in ZenGin
  centimetres — and shares ONE position buffer between its points and its lines,
  because two buffers can drift apart and one cannot.

Two rules came out of building them, both from running against real data rather
than fixtures:

1. **Label an unnamed VOB by its visual, not its class.** NewWorld's 23,288 VOBs
   carry 2,654 distinct names, so falling back to the class made the tree a
   column of the word "zCVob". Name, else visual, with the class beside it.
2. **"Nothing here" and "not listed yet" are different states.** Collapsing them
   made every directory flash as empty on the way in, and made an empty state
   nobody could trust. Found by a sabotage that should have failed a test and
   did not — the test was passing on the first frame, before the listing had
   arrived at all.

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
- **All edits are ops** (`MoveVob`, `ReparentVob`, `SetVobProp`,
  `SetVobClassProp`, `AddVob`, `DeleteVob`, waynet edge ops …) defined in
  `zen-world` with inverses.
  Gizmo drags preview locally in the viewport; on commit the op goes to
  `WorldService`, applies to the authoritative native model, and lands in the
  history stack. Undo/redo replays inverse ops through the same path —
  multi-select batch edits are just op batches.
- **Navigation is Blender's, and the left mouse button is not part of it**
  (2026-08-27). Middle orbits, Shift+middle pans, Ctrl/Cmd+middle zooms; `.`
  frames the selection and `Home` frames the world. The default OrbitControls
  mapping orbits on the left button — the same drag that picks a VOB and the
  same one that places one — and a click that both selects and tumbles makes the
  viewport unusable for the thing it exists to do. Framing the selection is not
  a convenience either: the orbit pivot starts at the centre of a 600 m island,
  so without a way to move it every orbit up close swings the camera through
  half the world.
- **Adding to a selection is Shift, Ctrl or Cmd, in both panels**
  (2026-08-28). Ctrl/Cmd was there from the start and Shift is the gesture a
  level editor is actually reached for with; it is free precisely because
  panning is on Shift+**middle** (the bullet above), so no left-button gesture
  was spoken for. One rule for the viewport pick and the scene-tree row, because
  the tree is the only way to reach a VOB the viewport cannot draw and the
  viewport the only way to reach one the tree has not been scrolled to.
- **The rotate gizmo is damped to a quarter of `TransformControls`' rate**
  (2026-08-28). Its own rate is `20 / <camera-to-pivot distance>` radians per
  unit of pointer travel — a turntable's, and in a 600 m world where the camera
  is metres from the barrel it is turning, a short flick spins the VOB through
  several turns. Nothing in the library takes a number for it: the rate is a
  local `const` in `pointerMove`, and the `rotationAngle` it produces is defined
  `configurable: false`, so it cannot be wrapped on the instance either. What is
  reachable is the pointer, and the angle is linear in the travel since the
  press — so `DampedTransformControls` scales that travel and the turn scales
  with it, *inside* the gizmo, which keeps the ring, the live preview and the
  committed op the same number. Deliberately not applied to translation (world
  units, already one-to-one with the cursor) and deliberately not applied to
  `__worldViewport.turnGizmo`, which stands in for this pointer maths rather
  than running it — so `verify-world-edit.js` still means the radians it says.
- **A structural edit must not move the camera.** The scene is rebuilt from the
  world after one, which is the same path an open takes and therefore re-framed
  the camera from the bbox — throwing away the view a placement was aimed from,
  which is the one view that shows whether it landed. The pose survives a
  rebuild of the same world, keyed on the bbox so opening a different one still
  frames it.
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
- **The mirror does not perform that flip — `threeIndexOrder` does (corrected
  2026-08-26, after a screenshot).** The first version of this bullet reasoned
  that `ROOT_MATRIX`'s negative determinant inverts the rasteriser's front/back
  test and therefore settles winding for free. True of raw WebGL, and wrong
  here: Three.js exists to hide that effect and cancels it per object
  (`three/build/three.cjs`, `renderBufferDirect`: `const frontFaceCW = (
  object.isMesh && object.matrixWorld.determinant() < 0 )`). The two rules
  cancel, so every one of those 230,395 triangles was drawn from the inside —
  the world's floor transparent from above, `NW_HARBOUR_CRATE_01` inside out.
  The fix reverses index order once at the same boundary; `side: BackSide`
  would have been the identical flip written as a lie about the material, and
  would have left `Raycaster` — which culls by local winding, with no
  determinant compensation — picking by the opposite convention from the one
  drawn. **No matrix avoids this:** a change of handedness has a negative
  determinant by definition. `zen-world/test/coords.test.ts` now models both
  rules together, because a test of either half alone endorses whatever the
  code does — which is exactly how the wrong conclusion passed CI.
- **Multi-ZEN workspace (Phase 3):** parts are a storage format, not a work
  model (brief §4.2) — `WorldService` holds N part handles, the viewport
  renders their union with correct world transforms, every VOB knows its
  part, and only dirty parts are rewritten.

#### The op path, landed — everything but the UI that produces one (2026-08-26)

The first thing in this project that writes. `MoveVob` runs end to end:
`zen-world/model/ops.ts` → `WorldService.applyOps` → `zenkit.worker` →
`setVobPosition`, with undo and redo, and `verify-world-pipeline.js` applies,
undoes and redoes one edit against retail NewWorld.

Only `MoveVob` existed when this was written; `RotateVob` has since landed
beside it (below). `setVobPosition` is the one mutation the **engine** has
accepted — the acceptance record's row 10 moved a VOB through it and the real
game loaded the result — and the rest of the list above (reparent, set-prop,
add, delete, waynet) arrives when the binding call for it does.

What the shape had to get right, none of it obvious from either side alone:

- **A VOB has two addresses.** The UI selects a flat index into `vobIndex`; the
  binding takes an index *path* down the children lists. The path is the chain
  of `childIndex` values, **not** of VOB indices, and on retail NewWorld VOB 85
  lives at `2/71`. `vobIndex` deliberately emits only the last segment and
  leaves the chain to the consumer, so this is `zen-world`'s job and an op
  carries both addresses, resolved when it was made.
- **An op carries `from` as well as `to`**, which is the whole of what makes
  undo work: `invertOp` is pure, the history holds ops and not snapshots, and
  undo goes to the worker as an ordinary `applyOps`. Undo replays a batch's
  inverses **back to front** — two ops on one VOB compose, and unwinding them
  front to back leaves it where the first op put it.
- **A batch is atomic.** It is also one undo entry, so a batch that half-applies
  leaves the world in a state no entry describes — `WorldService` records
  nothing for a refused batch, so whatever it did move would never come back.
  `commitOps` unwinds what it applied, which the op model makes free.
- **The history belongs to the world.** Opening another world empties both
  stacks: an op addresses a VOB by its path down *that* world's tree, and
  replayed against the next one it resolves to whatever sits at that path.
  Nothing is recorded until the worker confirms it, and the stacks move only
  after a replay is confirmed too.

**No fidelity claim had moved when this was written.** Nothing here touches the
writer: an op mutates the in-memory ZenKit world exactly as the engine-accepted
row-10 edit did, and `saveWorld` was untouched and still BinSafe-only. A
UI-edited world has since been saved and re-loaded (below) — one VOB differs, and
mesh, BSP and waynet are byte-for-byte the original's. The claim still waiting on
the *engine* is Gate 2's, rows 7–9 included.

#### The loop closed — a VOB is moved in the app (2026-08-26)

A translate gizmo, the projection following the edit, and Ctrl+Z/Ctrl+Y. The
whole path runs against retail NewWorld in the real Electron app:
`scripts/verify-world-edit.js` selects a placed VOB, drags it 500 cm on each
axis, and watches the property grid, the gizmo and the scene follow it there,
back through undo, forward through redo, and back again.

- **A VOB is an instance, not an `Object3D`**, so there is nothing for
  `TransformControls` to attach to. A proxy object hangs under the same mirrored
  root as everything else, which makes its local position ZenGin centimetres and
  needs no conversion of its own — the root stays the only one. The gizmo's own
  helper goes in the top-level scene instead, or it would be drawn through that
  same 0.01 scale and mirror.
- **A visual with several draw groups puts one VOB in several `InstancedMesh`es.**
  `WorldScene.moveVob` writes every one of them, or the VOB is drawn in two
  places at once — and recomputes the bounding sphere, because `InstancedMesh`
  culls by the sphere it was built with and a VOB dragged out of it vanishes at
  some camera angles and not others.
- **The drag previews locally and commits on release.** The world in the main
  process still has the VOB where it was until then; a refused op sends it back
  and says so in a warning that does not replace the surface, because the world
  is still open and still correct.
- **The projection is written in place.** An op lands in the index's own
  `ArrayBuffer` columns, so no cached reader is invalidated — which also means
  React sees nothing change, and what re-renders the panels is the World
  surface's `appliedOps` state.
- **Ctrl+Z in the World view is the world's undo, not the dialog editor's.** The
  layout's shortcut is a *window* listener that only checks a file is open —
  which it is, since the World surface lives inside a project like every other
  view — so it was undoing dialog edits in a file the user could not see.

Two defects came out of driving it for real, and neither was visible from the
unit tests as they stood:

1. **`Ctrl+Shift+Z` never fired.** Holding Shift changes the letter itself: the
   key arrives as `'Z'`, and a comparison against `'z'` never matches. The Jest
   test agreed with the implementation because `fireEvent` let it fake
   `{ key: 'z', shiftKey: true }`, which no browser sends. (The same latent bug
   is still in the dialog editor's own shortcut in `MainLayout` — noted, not
   touched.)
2. **Two undos in flight took the same batch.** Every edit is an IPC round trip
   and the stacks move only once the worker answers, so overlapping replays both
   read the same top of the undo stack, both applied it, and one entry never
   came off. `WorldService` now serialises edits. This was found by *looking*
   after the driver flickered — the driver's own failure was a fixed 250 ms wait
   where a condition was needed, which is the mistake §3 already records for
   throwaway Playwright scripts, and it had been hiding the race behind its own
   latency.

One build consequence: `TransformControls` puts the three chunk at **545.5 kB**
against the CI guard's 550 kB. It fits, with 4.5 kB to spare — the next thing
added to that chunk trips the guard and the limit will have to be argued about
rather than nudged.

What is still **not** built: any op other than `MoveVob`, and save. No fidelity
claim has moved — `saveWorld` is untouched — and until a UI-edited world is
saved and re-run through the engine checklist, the check above cannot prove the
*native* VOB moved is the one the flat index named, because the position it
reads back comes from the projection.

#### Multi-select — one gizmo, one batch, one undo entry (2026-08-26)

The op path was built for this and needed nothing: a batch was already atomic in
`commitOps` and already one undo entry in `WorldService`. What was missing was
the UI, and one decision underneath it.

- **A drag of a selection is a delta, not a destination.** One gizmo moves N
  VOBs and they keep the spacing they had, so `translateVobs(reader, vobs,
  delta)` builds one `MoveVob` per VOB, each carrying **its own** origin. That
  is also what makes the undo right: the inverses replay back to front and put
  a selection that was never uniform back exactly where it was, rather than
  collapsing it onto the anchor. A destination-shaped API cannot express this
  and reads correct on a selection of one — which is every unit test that stubs
  the viewport out.
- **The delta is measured from where the gizmo was when the drag began**, and
  each VOB's start position is read once, at the press. Reading it per frame
  would compound: the preview writes the same instance matrices it would read
  back.
- **The gizmo anchors on the last selected VOB that is actually drawn**
  (`WorldScene.anchorOf`). Last, because that is the one just clicked; *drawn*,
  because a selection may hold a decal or a sound VOB, and anchoring on one of
  those would detach the gizmo from a selection full of drawable VOBs. Those
  VOBs are still in the batch — the op is built from the index, which knows
  where they are; only the preview needs an instance.
- **`translateVobs` refuses the whole batch if one VOB is not in the index**
  rather than skipping it, which is the half-applied state `commitOps` exists
  to prevent, reached before the binding is ever asked.
- **A gizmo click that moves nothing is not an edit.** With one VOB that was a
  no-op op; with fifty selected it is fifty ops on the undo stack for a batch
  that undoes nothing.
- **The modifier is read before the pick's `await`.** The prop pick is
  asynchronous now (§3), and a modifier released during the readback would turn
  an additive click into a plain one — which empties the selection being
  built.
- The selection is one ordered list in `worldStore`, without duplicates: a
  repeat would put two ops on one VOB in a batch meant to hold one each. The
  property grid describes the last VOB and says how many are going with it,
  because a VOB out of view is not visible in the viewport either.

**Verified in the real app**, which is the only place any of the gizmo half is
reachable — `scripts/verify-world-edit.js` now selects two drawn VOBs on retail
NewWorld, Ctrl+clicks the second, drags both 500 cm on each axis and checks each
one's position in **both** projections (the property grid reads the index, the
gizmo reads the scene), then puts both back with a single Ctrl+Z. Sabotaged by
making the drag a destination again: the two VOBs collapse onto one point and
the script fails.

#### Save, from the UI — and the question the projection could never answer (2026-08-26)

`saveWorld` is reachable from the app: a **Save world…** button, the two
warnings §7 requires shown *before* the file dialog rather than after the write,
a main-process save dialog, and `WorldService.saveWorld` serialised with the
edits so a save can never write a world in the middle of a batch.

Three decisions are worth keeping:

- **The target is always chosen in a dialog, and the suggested name is never the
  file the world was opened from** (`NewWorld.zen` → `NewWorld.edited.zen`).
  The worlds this app opens are retail game files. Overwriting one stays
  reachable — the OS dialog asks — but it has to be asked for, and the renderer
  never names its own target: the dialog is what puts the directory on the path
  whitelist.
- **The warnings are about whether to save at all**, so they come first: the
  lighting a world was compiled with is not re-baked by an edit (only Spacer's
  `compile light` does that, and re-running it rebuilds the world from its
  parts), and a savegame carries its own copy of the VOB tree.
- **The binding's refusal is passed through verbatim.** "Only the binsafe writer
  path is verified" is the one sentence a user can act on, and replacing it with
  a generic failure hides it.

**And it closes the question every check before it had to leave open.** Until
now every witness in `verify-world-edit.js` was a *projection* — the property
grid reads the renderer's index, the gizmo reads the scene — and neither could
prove the VOB the **native** world moved is the one the flat index named. A VOB
has two addresses and on a depth-first-enumerated retail world they agree often
enough that the wrong one passes. The driver now saves the edited world to a
temp file, re-loads it **in its own process through the binding**, with nothing
of the app's in the path, and compares the dump against a fresh load of the
original:

```
Saved and re-loaded    VOB 0 is at 31413, 5299, -14341 in the file
  VOBs differing       1 of 23,288 — mesh, bsp and waynet identical
```

**Exactly one VOB differs, and it is the edited one.** That is the semantic-diff
half of Gate 2 answered for a world edited through the real UI.

**It is not a Gate 2 pass.** Whether the *engine* accepts a UI-edited world is
decided by the engine, and no engine run covers one — nor a rotated VOB, nor the
refitted bounding box. Rows 7–9 of the acceptance checklist regain their full
force there and must actually run, which needs a person at the keyboard.

> **Superseded 2026-08-27 — Gate 2 has since run and passed.** `03-ui-edited.zen`
> carried exactly this: a UI-edited world including a turned table and a retail
> VOB whose bounding box the app re-fitted on rotation, and it loaded clean in
> both Spacer2 and Gothic2. The paragraph above stands as the state at the time
> of writing. What is *still* uncovered is narrower and is listed in the
> acceptance record's "Not run and not claimed here either": `DeleteVob`,
> `MoveWaypoint` and `SetVobClassProp` all shipped after that candidate was
> built.

#### The turn gizmo — the second op, and the first that rewrites a bbox (2026-08-26)

`RotateVob` runs end to end on the same path `MoveVob` does: `zen-world`'s
`rotateVobs` → `WorldService.applyOps` → the worker → **`setVobRotation`**, a new
binding call, with undo and redo, and `verify-world-edit.js` turns a VOB in the
real app on retail NewWorld.

What made it more than "the same again with a different verb":

- **It rewrites the bounding box, and the box is refitted from the *visual*, not
  from the box that is already there.** The engine culls by that box and an
  axis-aligned box does not rotate into an axis-aligned box. Re-fitting the
  stored box would grow it on every turn and never shrink back, so an undo would
  not restore it and the op would stop being invertible. The measurement below
  is what says refitting from the visual is right: a stored box *is* the tight
  world AABB of the VOB's own visual placed by its own transform.
- **So the op carries a box for each pose**, and `invertOp` swaps both pairs.
  Swapping only the matrix is half an inverse: the VOB goes back and stays
  culled by a box fitted to a pose it no longer holds.
- **`zen-world/scene` now emits each visual's own bounds** with the geometry —
  six numbers next to buffers that are already crossing — so the renderer can
  build an op without a round trip, and a VOB with no instance correctly has
  none.
- **`setVobRotation` takes the box rather than deriving one.** The binding would
  have to load the visual to derive it, which means the asset layer inside a
  mutation; the box is a pure function of (visual, rotation, position) and the
  caller that already owns the asset layer computes it.
- **The matrix is row-major everywhere** — `vobIndex` emits it, `normalizeWorld`
  dumps it, the op carries it, `setVobRotation` takes it — and the binding
  transposes once, into `zenkit::Mat3`'s columns. A transpose is invisible on
  identity and on every symmetric matrix, which is why the fixtures are
  deliberately neither.
- **A selection turns about each VOB's own origin**, not about the selection's
  pivot: turning about a pivot moves the VOBs as well as turning them, which is
  a batch of two op kinds and a different feature. The delta composes **on the
  left**, so differently-oriented VOBs all turn the same way on screen.
- **W and E switch the gizmo**, as every 3D editor binds them — bare letters on
  a window listener, so they step aside for anything that takes typing.

**The engine has not accepted a rotated VOB.** The acceptance record's row 10
covered a moved VOB and an inserted item; a rotation, and the refitted box in
particular, is exactly what Gate 2 has to answer — including the 30 measured
VOBs whose stored box is bigger than their bind-pose mesh.

Two fixtures were too special to catch a real defect first time, and both were
found by sabotage rather than by reading:

- a quarter turn about an axis maps a box's min corner to the min corner, so
  fitting the box from **two** corners instead of eight passed; and with bounds
  symmetric about that axis the matrix is its own transpose, so reading it
  column-major passed too. A 45° turn with asymmetric bounds is neither.
- two turns about the **same** axis commute, so composing the delta on the wrong
  side passed. The fixture now turns about a different axis than the VOB's own.

#### The property editor — the first edit the viewport cannot show (2026-08-26)

`SetVobProp` runs the same path the two gizmos do — `zen-world`'s `setVobProp` /
`setVobProps` → `WorldService.applyOps` → the worker → **`setVobProp`**, a new
binding call — and the property grid writes: the name, the six flags, and the
visual. `verify-world-edit.js` renames a VOB in the real app on retail NewWorld,
toggles a flag, undoes each separately, and reads the new name back **out of the
saved file**.

What separates it from a move and a turn, and decides most of its shape:
**every field it writes is invisible in the viewport.** A VOB moved by the wrong
op is on screen. A VOB renamed by the wrong op is not, and neither is an inverse
that restores the wrong set of fields — until somebody presses Ctrl+Z.

- **An op carries exactly the keys it sets, on both sides.** `from` is read out
  of the index for precisely the keys `to` names. Carrying every property the
  VOB has gives an inverse that undoes edits the op never made; carrying fewer
  leaves one unrestored. The grid therefore posts **only the field that
  changed**, and an edit that changes nothing is not sent at all — the rule the
  gizmo already had, and with a selection it is the difference between one undo
  entry and fifty.
- **A visual is renamed, never re-typed.** A visual is its own object frame in
  the archive with its own class, and the class is **not** implied by the file
  name. Measured across the three retail worlds:

  | extension | type | | |
  |---|---|---|---|
  | `.3DS` | `MULTI_RESOLUTION_MESH` ×20,716 | `MESH` ×31 | **ambiguous** |
  | `.TGA` | `DECAL` ×1,932 | | |
  | `.PFX` | `PARTICLE_EFFECT` ×1,391 | | |
  | `.ASC` / `.MDS` | `MODEL` ×914 / ×502 | | |
  | `.MMS` | `MORPH_MESH` ×158 | | |
  | *(none)* | `UNKNOWN` ×15,749 | | |

  Those 31 `.3DS` VOBs carrying a `zCMesh` are the whole argument: a rule that
  derived the class from the extension writes the wrong object frame for them
  and nothing downstream reports it. So the object found on the VOB is kept and
  only its name changes. A VOB whose visual is `UNKNOWN` has none to rename —
  and that is not an edge case, it is **15,749 of the 41,393**, which is what
  "this VOB has no visual" actually looks like on disk (no retail VOB has a null
  visual pointer at all). The binding refuses it and the grid disables the field
  rather than offering an edit that would be refused at the bottom of the stack.
- **Only a visual swap can move the box, and its two sides are different
  visuals** — not one visual under two transforms, which is what a rotation has.
  So the op carries a box for each and `invertOp` swaps both, and the *new*
  visual's bounds are the one thing in the system that has to be **asked for**:
  every other op refits from bounds that crossed with the geometry, and a visual
  the world does not currently use has no instance and no payload.
  `zen-world`'s `visualBounds` computes them through `mergeChunks` and the same
  `groupBounds` the scene uses, so a swapped visual's box is the box the scene
  would have given it by construction rather than by two implementations
  agreeing.
- **The viewport does not follow a visual swap in place.** A move rewrites an
  instance matrix; a swapped visual is a different mesh in a different
  `InstancedMesh` that may not exist yet. The surface re-requests the instanced
  visuals, which rebuilds the scene from the world as it now is — the cold-open
  path, and only a change of visual pays it.

**One defect, and only the real app could show it.** The grid's fields are
uncontrolled inputs keyed on the VOB, which is right for a selection change — a
half-typed name must not follow the selection to the next VOB. It is not enough
for a change of *value*: an undo changed the name in the world and the panel went
on showing the old one, then would have written it back on the next blur. Every
Jest fixture moved the selection and none changed the value, so all of them
passed. The key is on the VOB **and** the value now, and the test that was
missing is the one that changes the value under a fixed selection.

Eleven sabotages this session across the binding, the op model and the grid, all
caught — writing the flag word wholesale (which passes on any props object that
sets all six), a batch sharing one `from`, a half inverse that leaves the box
behind, deriving the visual's class from its extension, and ignoring an unknown
key rather than refusing it. Two of them were reported as *surviving* first, by a
harness that grepped for the test runner's pass/fail glyphs: PowerShell 5.1 reads
a UTF-8 scratchpad script as ANSI, and jest wraps those glyphs in ANSI colour
codes. **A sabotage run that reports every sabotage as surviving is a broken
harness, not a broken test suite** — count the runner's own summary.

Still not built: `ReparentVob`, `AddVob`, `DeleteVob`. And **no engine verdict
covers a renamed VOB, a swapped visual or a changed flag** — like the rotation
before it, that is Gate 2's business.

#### Placing a VOB — and the renumbering that decides what add, delete and reparent can be (2026-08-26)

`AddVob` runs the same path the other three ops do — `zen-world`'s `addVob` →
`WorldService.applyOps` → the worker → **`insertVob`** — and the surface places
one at the last point clicked on the terrain. `verify-world-edit.js` places a
VOB in the real app on retail NewWorld, watches the scene tree go from 23,288 to
23,289, and undoes it.

**One fact about the enumeration decides the shape of this op and of the three
that are still missing.** A VOB's flat index is its position in a depth-first
traversal. Every op in the history carries one of those numbers, and an index
path built from it. So a VOB inserted anywhere *except* the very end is
enumerated before VOBs that already exist and renumbers every one of them —
which silently re-points every op on the undo stack at a different VOB.

Appending a **root** is the one position that shifts nothing: it is enumerated
last and takes the index one past the end. That is why `insertVob` takes no
parent at all, rather than taking one and hoping. `commitOps` still checks the
path the insert actually landed at, because a world whose roots have changed
since the op was made would put it somewhere else — and the op's own inverse
would then delete somebody else.

The consequences worth keeping:

- **A null side means "not in the world".** `AddVob` carries `from: null` and
  `to: spec`, so `invertOp` turns an add into a delete by swapping the two sides
  exactly as it does for a move. There is no separate delete op and no special
  case.
- **An added VOB is invertible because the call that made it describes it
  completely.** Undo deletes it, redo makes it again from the same spec, and
  nothing is snapshotted beside the history. That is emphatically **not** true of
  an arbitrary retail VOB — an `oCMobInter` carries per-class properties,
  children, an AI and an event manager that no op describes. *(That is why
  deleting one is `DeleteVob` rather than this shape with a null `to`, and why it
  is the one op with no inverse. It landed on 2026-08-27 — "The delete, and the
  barrier that replaces its inverse" below.)*
- **The projection cannot follow it.** The columnar index cannot grow, so
  `applyOps` refuses a structural op *by name* rather than skipping it, and the
  index is re-read whole (`refreshIndex` — from the world the worker already
  holds, since re-opening would re-load from disk and discard every edit). The
  scene rebuilds too: an instance cannot be appended to an `InstancedMesh` that
  is already allocated. Both costs are paid only by a structural edit, and the
  rebuild resets the camera because it is the same path an open takes.
- **`insertVob` derives the visual's class from the extension, which is exactly
  what `setVobProp` refuses to do.** Renaming an existing visual has a fact to
  preserve — `.3DS` is `zCProgMeshProto` 20,716 times and `zCMesh` 31 times —
  and authoring a new one has none, so the measured majority is the only
  defensible choice. A `.TGA` is refused: a `zCDecal` carries dimension, offset,
  alpha function and weight that this call does not take.
- **A placed VOB goes at the terrain point, unrotated, with a box fitted from its
  visual.** The point because it is the one position the user actually chose;
  unrotated because inventing an orientation from a surface normal is a feature
  with its own decisions; and the box because the engine culls by it and the
  binding's fallback is a 10 cm cube that would cull a house.

**Two defects, both found by thinking about how the driver would exercise this
rather than by a failing test.** `deleteVob` must *erase* the slot rather than
blank it — `CollectVobs` and `CountVobs` both skip a null child, so a delete that
left a hole reads identical in the dump, the VOB count, the mesh, the BSP and the
waynet, and only hands the writer a gap. And **undo does not go through
`commitOps`**: the op log lives in the main process, so the keyboard handler asks
it what it undid and applies that — without the same refresh, an undone
placement leaves the renderer holding a VOB the world no longer has.

Eleven sabotages across the binding and the op, all caught. Still missing, and
all three waiting on the same answer: placing a VOB **under a parent**,
`ReparentVob`, and deleting an arbitrary VOB. And no engine verdict covers a
world with a VOB added to it. *(The answer landed on 2026-08-27 — see "The
renumbering answer" below. It is the history's LIFO discipline, not a property
of the ops. `ReparentVob` landed with it, placing under a parent on 2026-08-28,
and the general delete on 2026-08-27 — the objection against it was never
renumbering.)*

#### Two defects the viewport shipped with, and the shape they share (2026-08-26/27)

Both were live from the day the viewport was built, both were green in CI
throughout, and both come from the same mistake about the same matrix.

**The world was drawn inside-out.** Every floor was transparent from above,
every roof visible from underneath, every VOB turned inside out — all 230,395
measured triangles, uniformly. Recorded in full in the winding bullet in §7; the
short form is that a negative determinant *does* invert the rasteriser's
front/back test, and Three.js exists to hide exactly that, so it inverts it
straight back. The two cancel.

**The rotate gizmo turned VOBs the wrong way.** `Matrix4.decompose` answers a
negative determinant by negating `scale.x`, so `ROOT_MATRIX` decomposes to a
scale of (-0.01, 0.01, 0.01) and a rotation of **identity** — the mirror is
absorbed into the scale and never reaches the quaternion.
`TransformControls` builds its parent-inverse from that decomposition, so a
world-space drag was applied to the proxy's local quaternion unconjugated: the
VOB turned by `R` where it should have turned by `M⁻¹RM`. Conjugating by
diag(-1, 1, 1) maps a rotation about (x, y, z) to one about (x, -y, -z), so **X
was correct and Y and Z were reversed** — and yaw is the one anybody tests.
`coords`' `mirrorRotation` is that conjugation; it is an involution, so one
function converts both ways and cannot be applied backwards.

**Positions were never affected, and the reason is worth keeping.**
`TransformControls` divides its offset by the same `_parentScale` the
decomposition produced, so the negative x comes back. A translation survives a
mirror that a rotation cannot, because the scale still carries it and the
quaternion does not. "It works for moves" was never evidence about turns.

**What the two share is the failure of the tests, not of the code.** Both were
protected by an assertion that re-states the implementation: `coords.test.ts`
asserted the determinant was negative — true, and silent about whether that
achieved anything — and `verify-world-edit.js` drives rotation through
`turnGizmo`, which sets the proxy's *local* quaternion and so bypasses precisely
the world-space maths that inverted it, checking the result against an
expectation computed the way the app computes it. It passes identically before
and after the fix. **When a rule has two halves that can cancel — a mirror, and
a library's compensation for mirrors — a test of either half endorses whatever
the code does.** Both suites now model both halves, and the rendering one states
the requirement in terms anyone can check: turn a point in ZenGin and convert
it, or convert it and turn it on screen, and it must land in the same place.

The other lesson is cheaper: **the screenshot is a test.** The winding defect
was visible the instant anyone looked at the viewport, and it survived a full
green suite for the whole of Phase 1a.

#### The renumbering answer, and `ReparentVob` on top of it (2026-08-27)

Three ops were held back by one question — placing a VOB under a parent,
`ReparentVob`, and deleting an arbitrary VOB — because a VOB inserted or moved
anywhere but the end of the roots renumbers every VOB after it, and every op in
the history carries one of those numbers and a path built from it.

**The answer was already in the code, and it is a property of the history rather
than of the ops.** `WorldService.applyOps` clears the redo stack on every new
edit, and undo and redo move whole batches between two stacks through one
serialised queue. So a recorded op is only ever applied to a world in **exactly
the enumeration it was recorded against**: new edits destroy the redo stack that
would otherwise hold ops from a different one, and LIFO replay unwinds
enumerations in the order they were created. Renumbering cannot reach the
history at all.

What renumbering *does* reach is two things, and both are handled where they
belong:

- **The renderer's projection**, which is columnar and cannot grow or reorder —
  re-read whole, exactly as an add re-reads it. `isStructuralOp` is the name of
  that, and it now covers `ReparentVob` too.
- **Other ops in the same batch**, whose paths were resolved before the batch
  ran. That is a real hole and `commitOps` now refuses it: a reparent must be
  the only op in its batch. **Not** the same rule as "structural", and the
  distinction is the point — appending a root renumbers nothing, so an add
  legitimately shares a batch, and a guard written against `isStructuralOp`
  would have broken the batches it already appears in. `renumbersPaths` is the
  narrower predicate.

`reparentVob(handle, fromPath, parentPath | null, slot)` takes a **slot** rather
than appending, because that is what makes it invertible: putting a VOB back at
the end of the list it came from is a different world from the one it left. Two
consequences fall out of the move having two ends:

- **The removal vacates a slot before the insert happens**, so a destination
  numbered after the source in the same list has already shifted down one. Both
  sides make that adjustment — the binding to find the list, the op to predict
  the path its own inverse will address — and `commitOps` checks the two agree,
  the same guard an insert already had. The duplication is deliberate; the
  disagreement is the signal that the world moved under the op.
- **A VOB moved into its own descendant is unreachable from the roots**, so it
  is not enumerated, not counted and not written — it disappears at the next
  save rather than being misplaced. Refused in the binding and again in the op
  factory, so the UI never offers it.

Three sabotages, all caught, and one of them was found by asking which branch no
test reached: the index adjustment was covered by nothing until a test moved a
VOB into a *later sibling* of itself, which is the only shape that exercises it.

Still missing: **deleting an arbitrary retail VOB** — which is not blocked by
renumbering at all but by invertibility: an `oCMobInter` carries per-class
properties, children, an AI and an event manager that no op describes, so undo
cannot rebuild one. That needs a way to snapshot a subtree, and it is a
different feature. *(Placing a VOB under a parent and the between-rows drop both
landed on 2026-08-28 — below. **The invertibility objection was withdrawn on
2026-08-27 — §15**, and the delete landed the same day with a history barrier in
place of an inverse — below. The subtree snapshot stays open as an improvement,
not as a prerequisite.)*

#### The reparent that never reached the binding, and the parent an insert can now take (2026-08-28)

**`ReparentVob` was refused at the IPC boundary for as long as it existed.**
`assertApplyOpsRequest` checks an op's kind against a list, and the list was
never extended — so every drag-and-drop reparent in the running app came back
as `Invalid op: unknown op ReparentVob`, was caught by `commitOps` and shown as
an edit error. Three suites cover that gesture and all three were green,
because **every one of them mocks `applyWorldOps`**: the renderer test stubs the
IPC, the op test injects a fake binding, and the binding test calls C++ directly.
Nothing owned the seam between them. It is the same shape as the winding defect
— each half correct, the join untested — and the fix is the same shape too: the
validator now has a `ReparentVob` branch, and `ipcValidation.test.ts` has the
cases that would have caught it.

The op is also the first with **no top-level `path`**: a move has two ends and
carries one on each side, so the branch has to run *before* the loop's `op.path`
check rather than after it. A validator written around a field every op used to
have is what refused the first op that did not.

**`insertVob` now takes a parent**, `insertVob(handle, parentPath | null, opts)`
— the shape `insertItemVob` already had. A null parent renumbers nothing and a
parent renumbers, and the whole design is that one sentence: appended to the
roots a VOB is enumerated last, appended under a parent it is enumerated as soon
as that parent's subtree ends and every VOB after it moves up one. The safety
argument is the history's LIFO discipline, exactly as it is for a reparent; the
op-level guard is the narrower `renumbersPaths`, which is now `ReparentVob ||
(AddVob && parentPath !== null)` rather than a test of the op's name. **An
appended root still shares a batch**, which is the distinction that predicate was
introduced to keep.

It **appends rather than taking a slot**, which is the one place it deliberately
differs from `reparentVob`. A reparent has to be able to put a VOB back exactly
where it came from, so it needs a slot to be invertible; an insert's inverse is a
delete of the VOB it just made, and the end of a list is where a delete leaves no
hole to reason about.

`AddVob.vob` — the flat index — is computed for the parented case by walking
forward past the parent's whole subtree. That is sound **because the enumeration
is strictly pre-order**: `CollectVobs` and the columnar builder are the same
traversal, so a subtree is a contiguous run of indices. The branch that climbs
more than one link was reached by nothing until a test used a *grandchild*, which
is the only shape that exercises it — the same gap `reparentVob`'s index
adjustment had.

**The gesture is two clicks and a checkbox, and it works because a terrain point
survives a click in the scene tree.** Only a viewport pick replaces the point, so
"click the ground, then click the parent, then confirm" needs no new state: the
placement bar, which used to hide itself whenever anything was selected, now
stays up and the dialog says which list it will append to.

**A drop between rows means "immediately before the row under the line."** That
is the rule that gives a gap one meaning where the depth changes: the row below
is the only one whose own list the line is actually inside, so a drop under a
deeply nested last child means "before the next row at *its* depth", never one of
the outer levels the pixels also touch. The last visible row carries the only
"after" in the tree, because nothing is under it. The hit zone is a strip element
of its own rather than a zone measured off the pointer's Y — splitting one
element's height between two meanings makes both of them a guess about where the
mouse was.

The slot it passes is an index into the destination list **as it will be once the
VOB has left it**, which is the convention `reparentVob` takes. Within one list
that is a subtraction, and it needs **three siblings to test**: moving the first
of two before the second is where it already is, and the tree refuses that as a
no-op before the arithmetic is reached. A no-op is refused because it is still an
op — a batch, a history entry and a full re-read of the index for a world that
did not change — and that rule is also what refuses a row's own edges, so they
need no guard of their own.

**A selection does not survive an op that renumbers.** It is a list of flat
indices, and afterwards there is no telling which VOB one of them names — the
property grid would describe a VOB nobody picked and the gizmo would sit on it.
Cleared rather than followed: the moved VOB's new index is recoverable from its
path, but the *other* members of a multi-select are not, and a selection that
quietly lost some of them is worse than one that says it is empty. `worldStore`
documented the opposite ("there is no such op yet") for as long as `ReparentVob`
has existed.

#### The delete, and the barrier that replaces its inverse (2026-08-27)

`DeleteVob` landed — the first op that ships **without** an inverse, on §15's
decision. What it settled, in the order the code forced the questions:

**It is not an `AddVob` with a null `to`, and that was the whole design
question.** §7 built that shape deliberately: a null side means "not in the
world", so `invertOp` turns an add into a delete by swapping the sides and
neither needs a case of its own. The shape carries a `NewVob` on the other side,
and *what it means* is "this op describes the VOB completely" — true of a VOB
the editor authored from a spec, false of every retail one. Reusing it would
have made the delete of an `oCMobInter` look invertible: the undo would insert a
bare `zCVob` wearing its name and visual, and would have thrown its class, its
children, its AI and its event manager away while reporting success. So a
separate op, carrying an address and nothing else, and `invertOp` refuses it.
`AddVob`'s null-side rule is untouched and still the inverse of a placement.

**`renumbersPaths` has no exception for a deleted root**, which is where it
stops being the mirror of an add. An appended root is enumerated last and shifts
nothing — that is the distinction the predicate was introduced to keep. A
*removed* root takes every VOB after it down by one, and there is no position in
the tree where a delete does not renumber. So a delete is always alone in its
batch.

**The barrier is the history's, not the op's.** `WorldService.applyOps` clears
**both** stacks when a batch contains one, and clearing only the entry it would
have made is not enough: every batch already on the undo stack addresses VOBs by
flat indices and index paths that this delete has just moved, so replaying one
would edit whatever has since taken that address. Cleared after the worker
confirms, so a refused delete costs the user nothing.

**Three dispatches, not one, and only one of them is `invertOp`.** The refusal
lives in `invertOp` and in `writeOp`'s reverse direction, sharing one error
because two dispatches disagreeing about a barrier is how one quietly becomes
half-invertible. The third was found by a failing test rather than by reading:
the World surface's `commitOps` catch does `ops.map(invertOp)` to put the
viewport's *optimistic* draw back when an op is refused, and it threw on a
refused delete. Barrier ops are filtered out there — nothing is drawn before the
main process takes a delete, so there is nothing to put back.

**The validator refuses a delete carrying anything but its address.** The usual
reason plus one: an extra `from` on a `DeleteVob` is either a mislabelled
`AddVob` or something reaching for the inverse this op does not have, and both
are better refused at the boundary than silently ignored by the writer. Same
lesson as `ReparentVob` — `assertApplyOpsRequest` is the one layer every suite
mocks past, so the branch and its cases landed in the same change as the op.

**The UI half is a confirm, and it is the only one in the surface.** §15's
requirement is not "warn that delete is destructive" — it is that the user knows
the undo stack goes with it, because everything else here undoes. Exactly one
VOB, never a selection: each delete renumbers, so a second would need its own
batch against a re-read index, and a button that removed only the primary of
five is the surprise the dialog exists to prevent.

**Proved end to end on NewWorld**, not on a fixture:
`verify-world-pipeline.js` now deletes the last root through the real
`WorldService`, after an ordinary invertible edit so that a cleared stack is
distinguishable from an empty one. 23,288 VOBs → 18,828: the subtree really goes
with the VOB, which no unit test observes because no fixture has a 4,460-VOB
child list. It runs last and never undoes — nothing after it may assume the
world is the one that was opened.

Still open, and neither a prerequisite: serialising the subtree into the op, and
the describe-it-completely fallback. Both would turn the barrier back into an
inverse.

#### The waypoint gizmo — the UI for an op that had none (2026-08-28)

`MoveWaypoint` landed with no gesture that produced one. This is that gesture,
and four things about it were decided by the waynet being a different shape from
the VOB tree rather than by anything the gizmo wanted.

**One gizmo, so one selection.** `selectedWaypoint` is its own field on
`worldStore` and is never held at the same time as `selection`: each pick clears
the other. Not fastidiousness — the mode keys, the property grid and the **Delete
VOB** button all follow `selection`, so a VOB selection standing behind a picked
waypoint is a delete aimed at something the user cannot see.

**The pick is a projection, not a raycast.** `THREE.Points.raycast` is the
obvious answer and the wrong one: its threshold is in *world units*, while the
overlay draws with `sizeAttenuation: false`, so every waypoint is the same 3.5 px
whatever its distance. A world-unit threshold tuned to work up close cannot be
clicked at range, and one tuned for range swallows half the net up close. So
`pickWaypoint` projects every waypoint and measures the threshold in pixels,
where the sizes actually are equal. Looping over all 2,959 sounds worse than it
is: it runs once per click, not once per frame — unlike the props, which is
exactly why those are GPU ID-picked.

**The waynet is picked before the VOBs**, and only while it is switched on. It
draws with `depthTest: false` — over everything, the whole reason a waynet
inside a building is visible at all — so picking it second means clicking a dot
that is plainly on top and selecting the wall behind it.

**The waynet forced an asymmetry on where `from` comes from.** Every other op in
this surface reads `from` out of the columnar index at commit time, and can,
because the live preview writes *instance matrices* — a different array. The
waynet has one `Float32Array` for both: the point cloud and the edge lines share
it, deliberately, so an edge cannot point at a stale waypoint. That sharing is
what makes the preview destructive. By the time the drag ends, the position the
op has to carry as `from` has been overwritten with `to`. So the viewport records
it at the press and hands it up with the drag, and the shell writes it back
before building the op — which keeps the op coming out of `moveWaypoint`, with
its range check and the name the address is guarded by, rather than being
assembled by hand at the call site.

**`applyWaypointPositions` is called once, in `applied`** — the same function
undo and redo come through, which is why it is there and not beside the commit.
It writes the *payload*, and the overlay's position attribute is a view over that
same buffer, so there is no second copy to keep in step: the viewport only asks
for the upload. `WaynetOverlay.test.ts` pins the view-not-a-copy, because a copy
would fail silently — the file would save the move and the overlay would go on
drawing the old position until the world was reopened.

Translate only. `MoveWaypoint` is the only waynet op there is; a waypoint does
carry a direction, but nothing writes one, so a rotate ring would turn something
the world would never be told about.

`verify-world-edit.js`'s `expectedWaypointMoves` moves from 0 to 1 — the number
§14.2 said this slice would change — and the driver's waynet comparison was
already differential and already narrowed a difference to *position*, so a
waypoint that changed anything else is a red row regardless.

Still not done, and unchanged by this: the edge ops, and waypoint add, delete and
rename. §14.2's addressing problem is untouched, because a move is precisely the
op that does not need it solved.

#### What the real-app driver had to be taught, to be worth running (2026-08-28)

`verify-world-edit.js` reported the reparent as a pass throughout the period the
IPC validator was refusing every one of them. **Two separate reasons, and both
are general.**

**Its assertion could not fail.** It checked that the VOB count held across the
reparent — and a reparent moves a VOB and never loses one, so a *refused* op
holds the count exactly as a successful one does. The row now checks the tree:
both VOBs involved are roots, so one that really became another's child is no
longer a row of its own. That check does fail without the validator branch,
measured by putting the defect back and running it.

**Its drag never happened.** All three events were dispatched in one
`page.evaluate`, and React 18 batches the `setDragging` that `dragstart` does —
so a `drop` in the same JS task ran before the flush, read "nothing is being
dragged" and returned, with no op, no error, and nothing for any assertion to
see. A real drag is three user gestures in three tasks; the driver is now three
`page.evaluate` calls. **The component tests could not have found this**:
`fireEvent` wraps every call in `act()`, which flushes between them. That is the
same class of gap as the mocked IPC — a seam that only exists outside the test
harness.

**Three assertions that look discriminating and are not**, all three measured by
sabotage rather than argued about, on the question "did this VOB go under the
parent or to the roots?":

- the VOB count — identical for both;
- the number of rendered rows, or of top-level rows — the tree is virtualized,
  so it is the viewport's worth either way;
- **finding a row with the placed VOB's name** — which passes for a root too,
  because the tree is still scrolled to where the previous step's placement was
  and the last root is on screen. This one went green on the sabotage.

What separates them is the flat index in the row's `data-testid`, because that
*is* the difference between the two cases: a root takes the index one past the
end, a child is enumerated as soon as its parent's subtree ends.

**And an index in a `data-testid` is not a stable name for a VOB.** After a
reparent the enumeration changes, so `world-vob-row-5` means a different VOB than
it did a moment earlier — an assertion written against it silently checks the
wrong VOB. The between-rows step compares the top two rows' *labels* across the
drop instead, and skips itself, saying so, when those two labels are equal.

#### Class properties — the item instance and the light (2026-08-28)

§14.1's row 1.4 is the largest single item in the parity inventory, so it lands
one class at a time. The first increment is **two classes and three fields**:
`oCItem.instance` (5,022 VOBs, 12.1 % of retail) and `zCVobLight`'s `range` and
`color` (4,649 VOBs, 11.2 %). Together 23.4 % of every retail VOB — counted over
the same 41,393 the rest of this file means by retail, the three main worlds and
not `DragonIsland` (whose 2,261 VOBs would add 108 items and 612 lights, and
which no other measurement here includes). Chosen not for the share but because
between them they are a cp1252 string, a bounded scalar and
a fixed-arity integer array — every value kind the machinery has to grow, with no
enum, no list and no inheritance chain deeper than one.

**The read was already written and unreachable.** `normalize.cc`'s `BuildProps`
dispatches on `VirtualObject::type` and emits every class-specific field of every
class the binding knows, and has since Phase 0 — but it sat in an anonymous
namespace and was called only from `CollectVobs`, on the whole-world
`normalizeWorld` dump the worker rejects for costing 933 ms. So the read half of
this was an **export, not an implementation**: `BuildProps` and `VobClassName`
were promoted into `normalize.hh` and `getVobProps(handle, indexPath)` calls the
same function `normalizeWorld` does. That deliberately couples them — a change to
either moves the golden dumps in `normalizeWorld.test.js` and `roundtrip.test.js`
— which is the point, because the alternative is two hand-maintained mirrors of
the vendor headers drifting apart in silence.

**The read is a prerequisite of building the op, not a display convenience.**
Every other property op reads its `from` out of the columnar index; the index
carries no per-class data at all, only the interned class *name*. So
`setVobClassProp(reader, vob, current, to)` takes the current values from the
caller, the way `moveWaypoint` does for the waynet, and keeps only the keys `to`
names. What stays forbidden is reading `from` back from the native world at apply
time — passing it at build time is not that.

- **A new op, not a widened `SetVobProp`.** Four things break on widening, all
  of them code rather than taste: `setVobProp`'s `from` loop is typed by the
  index's accessors and has none per class; `applyOps`' projection has no column
  and a typed array in a transferred payload cannot grow; `setVobProp` performs
  no class check anywhere, so `{ range: 500 }` on an `oCItem` would build
  cleanly and be refused by C++ halfway through a batch; and `PROP_KEYS` would
  become a union of ~135 keys, most illegal for most VOBs, multiplying the
  "added to the type, forgot the list" trap its own comment warns about. A
  separate op also sheds `fromBbox`/`toBbox` — no field in this slice can move
  the culling box — rather than carrying two permanent `null`s forever.
- **The op declares its `className`, and the binding does not believe it.**
  `assertApplyOpsRequest` is stateless with respect to the world: it sees
  `op.vob` and `op.path`, has no index and no handle, and therefore cannot tell
  whether `range` is legal for this VOB unless the op says what the VOB is. So
  the class is stamped from `reader.className(vob)` at build time and is a
  declaration of intent — `setVobClassProp` in C++ takes **no** class argument,
  resolves the VOB first and switches on its real `vob->type`, so a lie is
  refused by the key check naming the actual class. Same shape as `writeOp`
  re-checking `landed !== destination.path` for a reparent. It is directionally
  symmetric, so `invertOp`'s `{ ...op, from: op.to, to: op.from }` carries it
  through unchanged.
- **One catalogue, in `zen-world`.** Three allowlists already had to move in
  lockstep with nothing shared between them — `kKnownKeys` in the binding,
  `VOB_FLAG_KEYS` in the validator, `PROP_KEYS` in the op model. A fourth would
  have been worse than the first three, so `zen-world/src/model/vobClasses.ts`
  is the single table the builder, the IPC validator and the grid all read:
  class → key → kind (`string` / `float` / `color`) and bounds. Adding a class
  to the UI is one entry in it. The C++ table stays separate and unavoidable;
  what ties it to the TS one is a per-key round-trip test in
  `mutations.test.js`, not a shared constant. The catalogue is read through
  `classPropKeys` / `fieldOf` rather than indexed directly, because a class name
  is a boundary value and `CLASS_FIELDS['toString']` on a plain object literal
  answers with a *function* — which behind a `?? []` would hand the grid a
  method to iterate.
- **The read is addressed by native index path, the op by both.** A VOB has two
  addresses, and the renderer already resolves the path for every op it builds,
  so `world:vobProps` takes the path and validates it with the same
  `INDEX_PATH` regex every other world IPC uses. It sits **outside**
  `serialized()` in `WorldService` — it is a read, and queueing it behind a
  120 s edit timeout would stall the panel on an edit it does not depend on.
- **`applyOps` touches the VOB and writes nothing.** Not a fall-through to
  `unreachableOp`, not the structural throw, and deliberately not a new
  partition predicate in the `isWaynetOp` mould: a filter-it-out design has to
  be applied identically in the worker and in the store, and forgetting one
  leaves the world one edit ahead of a projection that threw *after* the commit.
  `touched` is what re-attaches the gizmo and re-renders the panels, so the VOB
  is reported touched and no column is written. One branch, one function, both
  callers.
- **The values are React state on `WorldSurface`, not the store and not a
  summary-keyed cache.** `worldStore.applyEdit` writes into the existing
  `ArrayBuffer`s and deliberately does not change the identity of `summary`, so
  a `WeakMap` keyed on it — the `vobModelOf` pattern — would serve pre-edit
  class props forever. The fetch is re-issued from `applied()`, which covers
  commit, undo and redo, and from `commitOps`' catch, where a refused edit would
  otherwise leave the grid showing what the user typed. The grid itself stays
  synchronous and prop-driven, so its fixture has no async in it.
- **Class fields edit the primary VOB only; base scalars keep batching.**
  `setVobProps` builds one op per VOB each with its own `from`, precisely
  because a shared `from` reads correct on a selection of one — which is every
  unit test. A class-field batch needs N reads before the edit and has no guard
  for a selection of mixed classes, so under a multi-selection the section says
  in as many words that it applies to the described VOB alone.

**Refusing a typed value had to un-type the field, not just drop the write.** A
refused parse is not a commit, so nothing re-renders and the uncontrolled input
goes on showing a colour the world does not have — the same defect the property
grid shipped with and fixed by keying on the value. The class fields fold a
refusal counter into that key, which is Escape's behaviour reached by a different
route.

Deliberately out, and each for a reason rather than for time. **`isStatic`**
changes *which fields the archive contains* — ZenKit writes the animation block
only when it is false — so its inverse does not restore the world; it needs an op
carrying the animation vectors in `from`. **Enums** (`lightType`, sound `mode`,
`lerpMode`), because retail data contains out-of-range values — `zCMover.lerpMode`
is 120 on three VOBs — and a dropdown that cannot represent junk destroys it on
write; that decision belongs with the first class that needs one. **List fields**
(`colorAnimationList`, trigger targets, mover keyframes), the first unbounded
payloads in the op set, needing a length cap and a nested-record assertion
`ipcValidation.ts` has no idiom for. **The rest of `zCVob`** (§14.1 item 1.8),
where the measured hazard is that retail `farClipScale` is `20901904` on 33 VOBs
and `4.43e-33` on 17 — uninitialised memory Piranha Bytes shipped, which a grid
that writes back on blur would move under the fidelity gate.
**Class-specific insertion** (item 1.3): `insertItemVob` already exists in the
binding and is wired to nothing, which makes it adjacent and tempting, but it is
`AddVob` with a different invariant. And **validating `instance` against the
parser's item index** — a real hazard, since an unknown instance crashes the
engine, but it couples the World surface to the semantic model; the field ships
as free text at the trust level `name` already has. *(Closed 2026-08-28 — see
"The item instance stops being free text" below.)*

Still open, both noted rather than fixed: the re-fetch is unconditional, so
committing a gizmo drag on a light flashes the class section's loading line
before the re-read lands — narrowing it to ops that touch the primary VOB would
be a second rule to keep in step with `applied()`. And **no engine verdict covers
a class-edited world**; like every op before it, that is Gate 2's business, and
`verify-world-edit.js` does not yet set an instance or a range on retail
NewWorld.

#### Class properties, increment 2 — the sound family and the zones (2026-08-28)

Five classes and thirteen distinct keys, in the shape increment 1 left behind:
one C++ case, one `CLASS_FIELDS` entry, its tests. Nothing structural moved —
the IPC validator, the op builder and the property grid are all catalogue-driven
and were not touched, which is the claim increment 1 made and this increment is
the first test of.

| class | keys written |
|---|---|
| `zCVobSound` | `soundName`, `volume`, `radius`, `coneAngle` |
| `zCVobSoundDaytime` | those four **plus** `startTime`, `endTime`, `soundName2` |
| `zCZoneVobFarPlane` | `vobFarPlaneZ`, `innerRangePercentage` |
| `zCZoneZFog` | `rangeCenter`, `innerRangePercentage`, `color` |
| `oCZoneMusic` | `reverb`, `volume` |

- **`zCVobSoundDaytime` inherits, in both tables.** It derives from `zCVobSound`
  in ZenKit, so the binding's case falls through onto the same `VSound` members
  and the catalogue entry spreads the base list. An entry that listed only the
  three derived fields would draw a daytime sound with no volume and no radius
  and refuse an op that set one; a C++ case that wrote only the derived three
  would pass every test that did not name a base field, which is why the
  round-trip fixture sets all seven.
- **The kinds decided the field sets more than the classes did.** With
  `string`, `float` and `color` and nothing else, every boolean on these five
  classes was out by construction and so was `oCZoneMusic.priority`, an
  `int32_t` a float field truncates in silence. That is what increment 3 closed;
  the table above is superseded by the one below it.

#### Increment 3 — the `bool` and `int` kinds (2026-08-28)

Not a class at all. Two kinds, and the nine fields the five classes of increment
2 were holding back for want of them.

| class | keys added |
|---|---|
| `zCVobSound` (and so `zCVobSoundDaytime`) | `initiallyPlaying`, `ambient3d`, `obstruction` |
| `zCZoneZFog` | `fadeOutSky`, `overrideColor` |
| `oCZoneMusic` | `enabled`, `ellipsoid`, `loop`, `priority` |

- **`int` is not `float` with a rule attached, and that is the whole reason it
  is a kind.** `oCZoneMusic.priority` is an `int32_t`; offered as a float it
  takes `2.5`, truncates on the cast and reports success, and the caller never
  learns which of the two numbers the world now holds. Separating it at the
  *type* means the grid, `assertClassPropValue` and `OptionalInt32` each refuse
  it, rather than one validator that happens to remember. `OptionalInt32` also
  refuses anything outside the 32-bit range: a value past 2^31 is not a large
  priority, it is a wrap.
- **`priority`'s `min: 0` is documented *and* measured.** ZenKit says "`0` is
  the lowest possible priority", and the 2026-08-27 `normalizeWorld` sweep over
  the three retail worlds corroborates it: observed priorities run 0 (the three
  `oCZoneMusicDefault`s) through 30 (AddonWorld — NewWorld tops out at 3,
  OldWorld at 1), with no negative anywhere in 62 music zones. Every other new
  field is a boolean and carries no bounds at all: there is nothing between
  false and true to refuse.
- **A boolean is a checkbox, and it is the one kind that is not text.** Every
  other kind round-trips through `formatted`/`parse`, because one text control
  over a catalogue table beats a widget per kind. A boolean goes the other way
  precisely to avoid deciding what "true", "1" and "yes" mean — a parsing
  problem the panel would be inventing for itself, when the six base `zCVob`
  flags beside it already have a control that has none.
- **`overrideColor` is drawn immediately above the colour it governs**, and the
  catalogue's field order is what puts it there. ZenGin reads `zCZoneZFog.color`
  only while `overrideColor` is true, so increment 2 shipped a colour that was a
  legal write the engine ignored — which reads to a user as the editor having
  done nothing. The adjacency is the whole of the fix and it is deliberately not
  more than that: the two stay **independent keys**, because an op that set the
  flag because the colour changed would build an inverse restoring a value
  nobody edited. Nothing disables or annotates the colour when the flag is
  false; the grid has no cross-field logic anywhere and this was not the place
  to introduce it (see the open question in §14.1 row 1.4).
- **`randomDelay`/`randomDelayVar` are still out, and now for their own reason
  alone.** They were held back next to the booleans; the kinds are no longer the
  obstacle, but the engine still reads them only when `mode` is RANDOM, and
  `mode` is an enum this catalogue cannot set. They are the same shape of defect
  `overrideColor` just fixed for fog, and closing them means a `mode` control,
  which means enums.
- **Two enums stayed out for the reason the catalogue already gives** (sound
  `mode`, `volumeType`), and `randomDelay`/`randomDelayVar` stayed out for a
  third reason that is neither: the engine reads them only when `mode` is
  RANDOM, and `mode` is exactly what cannot be set. They are plain floats and
  are the cheapest thing here to add if a random ambient sound ever needs
  tuning.
- **A bound is only written down where something measured it — and the
  2026-08-27 `normalizeWorld` sweep over the three retail worlds settled the two
  that shipped unmeasured, plus one that was wrong.** `innerRangePercentage` is
  **0..1**: every stored value across NewWorld/OldWorld/AddonWorld (far-plane and
  fog zones, placed and `…Default` alike) is in [0.1, 1.0], and the world-default
  zones hold exactly 1.0 — 100% stored as 1.0 — where ZenKit's docs say
  "Unknown"; so `max: 1` now, in the catalogue and the binding. `volume` on
  `zCVobSound` lost its maximum: ZenKit documents "percent (0-100)", but retail
  NewWorld holds 130 on two sounds and 150 on four, so a max of 100 refused
  values the game itself ships. `coneAngle` stays 0–360 and the two daytime
  hours 0–24 (24 is a bound and not a modulus — midnight is 0).
  `oCZoneMusic.reverb` has no bound at all in either direction, because ZenGin's
  reverb level is negative decibels — retail holds −10 to −3.219 and nothing
  positive, so a `min: 0` copied from the light's `range` would refuse every
  music zone in the game.
- **The `…Default` zone variants are deliberately absent** from both tables.
  `zCZoneZFogDefault`, `zCZoneVobFarPlaneDefault` and `oCZoneMusicDefault` are a
  world's fallback settings rather than placed zones; adding a C++ case without
  a catalogue entry would make a class the grid cannot draw and the validator
  refuses, which is the drift the round-trip test exists to prevent.
- **The fixture VOBs went into the mesh-extraction variant, not the golden.**
  `BuildVisualVobTree` gained five VOBs at `1/3`–`1/7`, so `minimal.g2.zen` and
  its golden dump are untouched and no `fixtures:regen` was needed.
  `VZoneFarPlane`'s two floats have **no default initializer in ZenKit at all**,
  so a fixture that left them alone would have round-tripped whatever was on the
  stack.

Still open, and inherited unchanged from increment 1: **no engine verdict covers
a class-edited world**, and these five classes are further from one than
`oCItem`/`zCVobLight` are — a sound or a fog zone written wrongly is silent in
the viewport and audible only in the engine.

#### The item instance stops being free text (2026-08-28)

`oCItem.instance` is the only class field whose value is a **name in another
file**, and a name no script declares crashes ZenGin when the item spawns
(§14.1). Increment 1 shipped it as free text with the reason written down; this
closes that, and **where** it closes it is the durable part.

**The main process cannot make this check, and that is a fact about the
architecture rather than a gap to fill.** It holds no item index and nothing in
it is one round trip away from being one: `ProjectIndex` (`shared/types.ts`)
carries NPCs, dialogs, routines, prototypes and voice ids and **no instances at
all**, and `ProjectService.primedModels` is a *take-once* hand-off cache of at
most `MAX_PRIMED_MODELS` per-file semantic models — deliberately not a second
copy of the renderer's, and emptied as it is read. `ParserService` is stateless.
Making `assertApplyOpsRequest` able to answer "does this instance exist" means a
new project-wide index pass, a new IPC, and a lifetime coupling of
`WorldService` to `ProjectService`.

**And even with the index it could not be a hard refusal**, which is the reason
that survives the architecture: a world may legitimately be opened and edited
with **no script project loaded**, and the renderer's own index is empty until
ingestion has merged the item files. A validator that refuses an unknown name
must first know that "unknown" is not "unasked", and the main process cannot.

So the enforcement is split, each half as strong as its layer allows:

- **The renderer refuses a name the loaded project does not declare.**
  `WorldSurface` reads `mergedSemanticModel.items` — the parser's `C_ITEM`
  instances, uppercased once — and hands it to `WorldPropertyGrid`, which
  refuses through the same route a value out of bounds already takes: nothing is
  sent, no op is built, and the field remounts showing the world's own value.
  **An empty index means "nothing is known", never "nothing is legal"**, so a
  world edited with no project open behaves exactly as it did before. The field
  carries a helper naming the rule whenever the rule is active, because a field
  that silently declines what was typed is the complaint the refusal idiom
  already comes close to.
- **The main process refuses a `to.instance` that is not the shape of a Daedalus
  symbol** (`DAEDALUS_INSTANCE` in `ipcValidation.ts`) — the strongest statement
  a process with no index can make, and one that holds with no project loaded.
  `to` **only**, deliberately: `from` is the value the world already holds, and a
  hand-edited or third-party world is free to hold something the shape refuses —
  checking it would refuse the one edit that repairs such a VOB, and refuse the
  undo of an edit that has already applied.

**Daedalus is case-insensitive and the parser keys `items` by the name as it was
written**, so the fold has to happen on *both* sides — the index is uppercased
where it is built, the typed value where it is compared — and the value committed
is still the one the user typed. Both directions have their own test; each was
verified by breaking one fold at a time.

Not done, and each for a reason: **an autocomplete against the index**. The
obvious reuse is `VariableAutocomplete`, and it does not fit — it calls
`onChange` on every keystroke where the grid commits on blur or Enter, so wiring
it as-is would build an op per character, and its "Add …" affordance offers to
author a Daedalus symbol from the level editor. Making it fit means local draft
state and a second commit path beside `EditableField`'s, which is more machinery
than the refusal is. A `<datalist>` on the existing input is the cheap version if
suggestion is ever wanted. **A refusal for the other direction** — an item
instance that exists in the scripts but whose *world* VOB is gone — is script→
world, which is the cross-reference job in §14.4, not this one. And **partial
ingestion can refuse a real name**: the index converges, the refusal writes
nothing, and the alternative is not enforcing at all.

#### What a VOB's bbox is, and why there is no scale gizmo (measured 2026-08-26)

Rotation is the next op, and it cannot be built the way `MoveVob` was.
`setVobPosition` translates `bbox` by the same delta it moves the VOB, because
the engine culls by that box and a moved VOB with a stale one may vanish — but
an axis-aligned box does not rotate into an axis-aligned box. So before writing
a `RotateVob`, `zenkit-node/scripts/check-vob-bbox.js` asked the data what the
stored box actually **is**: it places each VOB's own visual by that VOB's
rotation and position, in ZenGin space throughout, and compares.

| | NewWorld | OldWorld | AddonWorld |
|---|---|---|---|
| VOBs with a resolvable visual | 12,370 | 4,808 | 3,324 |
| **Stored box is the tight AABB of the placed visual** (<1% of the VOB's size) | **12,347** | **4,806** | **3,319** |
| Looser than that | 0 | 0 | 0 |
| Stored box *smaller* than the visual | 23 | 2 | 5 |
| Mean slack | 0.11 cm | 0.02 cm | 0.07 cm |

**So the box is a pure function of (visual, rotation, position)** — not of the
VOB's history. That is the finding that makes a rotation op possible at all: the
binding can recompute the box from the visual on every rotation, undo recomputes
the box it started from, and nothing has to be carried in the op or snapshotted
beside the history. Re-fitting the *stored* box instead would have grown it on
every rotation and made the op non-invertible.

**The 30 exceptions are all animated visuals** — `SNA_BODY.ASC`, `ORC_BODY.ASC`
(NPC bodies, soft-skin), `SMOKE_WATERPIPE.MDS`, `BSFIRE_OC.MDS` — where the
stored box covers the *animation* and the bind-pose mesh is up to 1 m smaller.
Recomputing from the visual would shrink those boxes, and the engine consequence
(early culling at the extremes of an animation) is **unmeasured**. It applies
only to a VOB someone actually rotates, and it belongs on the Gate 2 checklist
rather than being argued away here.

**And there is no scale to gizmo.** `zCVob` stores a `Mat3` and a `Vec3` and has
no scale field at all (`far_clip_scale` is a render-distance multiplier, not a
transform), so the only way a scaled VOB could exist is a rotation matrix with
non-unit columns. Measured across **all 41,393 VOB transforms** in the three
retail worlds: the worst deviation from unit length is **1.0e-2**, and it is on
a `.pfx` particle effect. Nothing in the corpus is scaled — every stored
transform is a rotation to within 1% — so a scale gizmo would be authoring a
representation ZenGin's own tools never wrote and whose acceptance nothing can
be checked against. It is **out**, and the handoff item asking for "rotate and
scale on the same gizmo" is answered by this measurement rather than by code.

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
- **Phase 1b-2 — class-aware editing (§14).** Authoring and editing VOBs *as
  their class*: insertion of the classes a modder actually places, the per-class
  property sets behind them, and visual assignment. Phase 1b edits a VOB
  generically — transform, tree, the eight `zCVob` scalars — and a modder placing
  a light or wiring a trigger touches none of it. Sized by the field sets, not
  by the op count; scheduled before 1c because the overlay reads a world and
  this is what makes the world worth reading. Carries the rest of §14 with it:
  copy/paste, numeric transform entry, snapping, tree search and per-class
  visibility.
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

---

## 14. Spacer parity inventory

What the original Spacer does for a modder that the World surface does not,
assessed 2026-08-27 against the state of Phase 1b. Modding parity only — it says
nothing about where the editor goes *past* Spacer (portal validation with live
feedback, the Daedalus overlay, the multi-part workspace); that is §11's job.

**Status** reads: *planned* — already accounted for elsewhere in this file;
*unscheduled* — no entry anywhere before this section.

### 14.1 VOB editing

| # | Missing | Status | Note |
|---|---|---|---|
| 1.1 | **Delete an arbitrary retail VOB** | **landed** (§7) | `DeleteVob`, the history barrier and the confirm. The one op with no inverse. |
| 1.2 | **Copy / paste / duplicate**, incl. subtree | unscheduled → 1b-2 | The most-used Spacer verb after move. Same undo question as delete, same answer. A cross-world clipboard only if part-to-part copying is wanted. |
| 1.3 | **Class-specific insertion** | unscheduled → 1b-2 | `insertVob` authors `zCVob` and nothing else. Needs at least: `oCItem`, `zCVobLight`, `zCVobSound`/`Daytime`, the trigger family (`zCTrigger`, `zCTriggerList`, `zCTriggerScript`, `zCMover`, `zCCodeMaster`, `zCMessageFilter`, `zCTriggerChangeLevel`), `oCMobInter`/`Container`/`Door`/`Bed`/`Ladder`/`Switch`/`Wheel`, `oCTouchDamage`, `zCPFXController`, the zones (`oCZoneMusic`, `zCZoneZFog`, `zCZoneVobFarPlane`), `zCVobStartpoint`/`zCVobSpot`, `zCVobAnimate`. |
| 1.4 | **Class-specific property editing** | **partial** (§7) | Seven classes so far. Increment 2 (2026-08-28) added the sound family and the zones — `zCVobSound`, `zCVobSoundDaytime` (which inherits the base four), `zCZoneVobFarPlane`, `zCZoneZFog`, `oCZoneMusic` — with no change to the validator, the op builder or the grid, which is increment 1's catalogue claim holding. What it exposed is that the value kinds, not the classes, were the limit — and increment 3 (2026-08-28) answered it with a `bool` kind and an `int` kind, which took the nine fields those five classes were holding back: the three sound booleans, the two fog booleans, and `oCZoneMusic`'s `enabled`/`ellipsoid`/`loop` plus its `int32` `priority`. `oCZoneMusic` and `zCZoneZFog` are now complete but for enums. **One question increment 3 left open**: `zCZoneZFog.color` is legible now only because `overrideColor` is drawn immediately above it — the grid still has no cross-field logic, so a colour on a zone that does not override is not disabled, greyed or annotated, and whether it should be is a UI decision nobody has taken. **`oCItem.instance` is no longer free text** (2026-08-28): the grid refuses a name the loaded project's item index does not declare and the IPC validator refuses a `to.instance` that is not a Daedalus symbol — see "The item instance stops being free text" in §7 for why the enforcement is split and why the main process cannot hold the index. Increment 1 (2026-08-28) landed `oCItem.instance` and `zCVobLight`'s `range` and `color` — 23.4 % of the 41,393 retail VOBs, and the three value kinds (cp1252 string, bounded float, fixed-arity integer array) the machinery needed. The whole path exists now — `getVobProps` exporting the reader `normalizeWorld` already had, the `SetVobClassProp` op, the `CLASS_FIELDS` catalogue every layer reads, the validator branch, the grid section — so each further class is one C++ case plus one catalogue entry plus its tests. Out by decision, not by time: `isStatic` (changes which fields the archive contains, so its inverse does not restore the world), enums (retail carries out-of-range values a dropdown would destroy), list fields (first unbounded payloads in the op set), base-`zCVob` widening (item 1.8, and the `farClipScale` junk it would write back), and class-specific insertion (item 1.3, which is `AddVob`). Still the largest volume of work in this section. |
| 1.5 | **Numeric transform entry** | **landed**, bar a multi-selection rotation | **Position landed 2026-08-28**: the three coordinates are typed entry in `WorldPropertyGrid`, and a committed one leaves as a *delta* through the gizmo's own `onTranslateSelection` → `translateVobs` → `commitOps`, so there is one op-building path and not two — a multi-selection therefore moves by that delta and keeps its spacing, exactly as a drag does. Commit is blur or Enter, Escape reverts, and a value that is not a finite float32 (or is the number already there) is refused *before* an op exists and the field is remounted showing the world's own value — the refusal-counter idiom the class fields already had. **The rotation half landed too (2026-08-28).** `coords` gained `zenRotationToEuler` / `eulerToZenRotation` with the round-trip tolerance test the old wording asked for, and `WorldPropertyGrid` now has three angle fields on top of it. Unlike position, a committed angle leaves as an **absolute** pose (`rotateVob(..., eulerToZenRotation(typed), bounds)`), because an absolute angle is the thing the grid can now read off a VOB; the equality refusal below is therefore applied **per angle**, and it compares the typed number against the *displayed* rounded value as well as the exact decomposed one — `coordinate()` rounds to 2 dp, so a field reading "30" can be 30.000000000000004 underneath and retyping what is on screen would otherwise re-orthonormalize the matrix. `zenRotationToEuler`'s throw is caught and the row renders as unavailable rather than blanking the grid. **A multi-selection hides the angle fields**: N VOBs would be `multiplyRotation(target, invert(current))`, and absolute-vs-delta there is a UI decision nobody has taken. Four decisions came with it, all measured over the 41,393 VOBs of retail NewWorld/OldWorld/AddonWorld. **The convention is intrinsic Y-X-Z in degrees** (`R = Ry * Rx * Rz`, ZenGin axes) — chosen because nothing in ZenGin, ZenKit or this repo commits to an order, so the tie-break is the singularity: YXZ's is a VOB stood on its nose, XYZ's is on the vertical, and **464 retail VOBs sit within 1e-6 of the XYZ singularity against 53 of YXZ's**. **Spacer parity is therefore unverified and not claimed** — there is no artefact in the format or in ZenKit to check an order against, and settling it needs Spacer itself (type an angle, save, read the matrix back). **Gimbal lock** folds the roll into the yaw and returns roll 0; the matrix still round-trips, and there is deliberately no near-pole epsilon, because one of 1e-7 in sine space discards a recoverable roll and moves the VOB by 8.5e-4 of matrix entry. **Non-orthonormal input is normalized, not refused**: 12,514 VOBs (30.2 %) deviate by more than 1e-6, worst 2.1e-2, so refusing would take typed angles away from a third of the world — which means **reading and writing back an unchanged angle rewrites that VOB's matrix**, and the grid must only write an angle the user changed. A reflection or a rank-deficient matrix is refused; retail has 0 of each. **Tolerance is 1e-6 on a matrix entry**, a few float32 ulps (ulp near 1 is 5.96e-8); measured worst is 2.98e-8 across the retail corpus and 5.96e-8 over 200k random poses. |
| 1.6 | **Snapping** | **partial** | **Grid step and angle step landed 2026-08-28.** One "Snap" step on the World bar, following the gizmo mode — centimetres for a move, degrees for a turn, both remembered, both free-form by default so an unsnapped drag and `verify-world-edit.js` are unchanged. **Snapping is relative: the drag's *delta* is quantised, never the position or orientation it lands on** (`renderer/world/snapping.ts`), for the reason typed coordinates chose a delta — one gizmo drives a whole selection and an absolute snap would put the anchor on the grid and shift the rest by whatever that took. For the angle there was no choice at all: an absolute angle needs the matrix↔Euler conversion `zen-world` does not have (row 1.5), while the turn since the press is exactly what the op carries. Quantised **on the proxy** in `objectChange`, so the live preview, both commits, a waypoint's destination and the drag harness read one snapped number rather than each applying the step themselves. A drag the step quantises to nothing commits no op at all. **Drop-to-ground and align-to-normal are still out**, and not for want of a raycast — the world mesh has a BVH and the terrain pick already uses it. They are out because both are *per-VOB* answers (each VOB finds its own ground, its own normal) and the commit path takes one delta for the whole selection: `translateVobs`/`rotateVobs` would need a per-VOB variant, which is a second op-building path and the thing the gizmo work has avoided since Phase 1b began. Align-to-normal additionally has to decide which axis of a visual is up — the same question that keeps a placed VOB unrotated (`IDENTITY` in `WorldSurface`). |
| 1.7 | **Visual assignment**, as opposed to rename | unscheduled → 1b-2 | `setVobProp.visual` renames in place and refuses any VOB whose visual type is `UNKNOWN` — 15,749 of the 41,393 retail VOBs (§7). Assigning a visual has to decide the object's class; decals (`.TGA`) are refused outright. |
| 1.8 | **The rest of `zCVob`** | unscheduled → 1b-2 | Preset name, `visualCamAlign`, bias, `dynamicShadows`, `sleepMode`, decal parameters. |

**Not a gap: scale.** `zCVob` has no scale field, so the two-mode gizmo is
correct and a third mode would author a representation ZenGin does not have.

### 14.2 Waynet

Only `MoveWaypoint` exists. Parity wants add, delete, rename, connect and
disconnect edges, freepoint authoring (the `FP_` convention), and waypoint
direction — which the binding deliberately leaves alone.

The gizmo that produces a `MoveWaypoint` landed 2026-08-28 (§7), so the one op
that exists is now reachable from the UI. Everything below still is not.

§7's op list already ends "… waynet edge ops", so this is *planned*. What it
does not carry is the actual work: **addressing**. `MoveWaypoint` addresses a
waypoint by its index into the list `getWaynet` emits, safe only because a move
inserts, deletes and reorders nothing. Every op above breaks that, so the waynet
needs a stable identity scheme first — and names cannot be it, since nothing in
the format promises they are unique.

### 14.3 World-level

| # | Missing | Status | Note |
|---|---|---|---|
| 3.1 | **ASCII / BINARY ZEN save** | measured, deferred (§5) | Not an oversight, and half-closed since. T8 found all 20 ASCII worlds aborting the process when their own re-save was loaded back; patches `0024`–`0026` fixed A1, A4 and A5, and all 20 now load, save and re-load (§10.4). Patches `0045`–`0047` then closed A2 and A3, and a re-save now keeps each VObject's original packed/unpacked layout: OldCamp's container diff goes from `whole-file` to `event-aligned`, gap 0. They still classify `semantic-drift` — A6, `animMode`, and ASCII float text precision — and none has an engine verdict, so `saveWorld` stays BinSafe-only. BINARY has had no fidelity work at all. Only 4 of 28 retail `.zen` files are BinSafe, and Blender/KrxImpExp exports are not among them. |
| 3.2 | **Static light recompute** | warning planned (§11) | Spacer re-bakes vertex lighting; we do not, so moving geometry or a light leaves stale lightmaps. Phase 1b promises the warning. The bake stays out. |
| 3.3 | **Merge/import another ZEN, export a selection** | planned (Phase 3) | Spacer's part workflow depends on it. |
| 3.4 | **Portal / sector work** | planned (Phase 2) | Face selection, material assignment, leak detection. |
| 3.5 | **World properties** | unscheduled | `oCWorld` settings, start position, sky and time control. Nothing exposed. |
| 3.6 | **BSP / world-mesh compile** | out of scope (§11) | The Blender pipeline covers it. Restate it whenever "parity" comes up — the one thing Spacer does that we never will. |

### 14.4 Editor UX

- VOB search and find by name or class — the scene tree has no filter at all.
  *Unscheduled.*
- Per-class visibility filters, hide/show — Spacer's VOB-type toggles.
  *Unscheduled.*
- Batch operations. Spacer has zSlang; our answer is
  [`mcp-server.md`](mcp-server.md) plus scripted ops. *Planned elsewhere.*
- Engine preview ("play from here") — parked as later/kept-open (§11).

Already landed and therefore absent above: focus-on-selection and frame-world
(`.` and `Home`, the 2026-08-27 navigation entry), and batch property edit
across a multi-selection (Phase 1b).

---

## 15. The undo bar (2026-08-27)

**The original Spacer has no undo.** Not for delete, not for anything — the
community workflow is to save often and reload after a mistake.

**Decision: undo for delete and paste is a nice-to-have, and gates neither op.**
If Spacer cannot do it, matching Spacer does not require it. An op that cannot
describe its own inverse may ship anyway, with the history recording it as a
**barrier that clears the undo stack** rather than as something invertible.

This withdraws the objection §7 raised against deleting an arbitrary retail VOB.
The op was never blocked by renumbering, and it is no longer blocked by
invertibility either.

What does *not* change: the invertible-op model stays the rule for every op that
can hold one. It is what makes history, multi-select batches and dirty-world
save coherent, and it is nearly free for `MoveVob`, `RotateVob`, `SetVobProp`,
`AddVob` and `ReparentVob`. What changes is that `invertOp` is no longer the
gate a *new* op has to pass.

The requirement that replaces it is narrower and non-negotiable: **the user has
to know the undo stack was cleared before the op lands.** Not to match Spacer —
Spacer simply has no stack — but because ours works everywhere else, so a delete
that quietly made the previous twenty edits unundoable is the surprise. A
confirm is enough; the fallback is the user's own save file either way.

Serializing the subtree into the op, or snapshotting the world around it, stay
open as later improvements. Neither is a prerequisite.


---

## 16. Open findings (2026-08-28)

The long form of every open card on [`docs/BOARD.md`](../BOARD.md). The board
carries one line and an owner per card and points here; this section carries the
diagnosis, the measurement and the decision each one is waiting on. A card that
closes takes its subsection with it — the commit is then the record.

### 16.1 Nothing has watched the packaged renderer draw — closed 2026-08-28

The addon half was already closed: the packaged app opens a world in CI, so
`npmRebuild: false` rests on a runtime verdict rather than on a reading of
`binding.gyp`. But that smoke never created a window — it opened the world
through `WorldService` and exited. A packaged build in which the World surface
rendered nothing, or threw on first paint, would still have passed every gate
there was.

Closed with `daedalus-dialog-editor/tests/e2e-electron/world-render.spec.ts`:
a real-Electron spec that drives the actual UI (Open Project → World toggle →
choose install → open a world) and then reads the GPU's own framebuffer back
through `window.__worldViewport.renderFrom` — the same mechanism
`scripts/verify-world-render.js` already used against a real Gothic install —
to prove the fixture's mesh was drawn, not just fetched. It compares every
pixel against the known clear colour and asserts at least one differs.

The spec needs the native addon for the *dev* build, which `zenkit-node`'s
install script skips by default in CI. `build-windows.yml`'s
`e2e-electron-windows` job now sets `ZENKIT_NODE_FORCE_BUILD=1` before
`pnpm install` so the spec actually runs there rather than self-skipping; the
ubuntu `editor-e2e-electron` job (`all-tests.yml`) does not set it, so the
spec skips itself there for want of the addon — that job's platform doesn't
ship, so it was never the gate this closes.

### 16.2 Three shipped ops have no engine verdict

`DeleteVob`, `MoveWaypoint` and `SetVobClassProp` all landed after candidate
`03` was built, so Gate 2 covers five ops — `MoveVob`, `RotateVob`,
`SetVobProp`, `AddVob`, `ReparentVob` — and not these. The acceptance record
says so itself, under **"Not run and not claimed here either"** in its Gate 2
section. Say **"Gate 2 passed for the ops it tested"**, never "Gate 2 passed".
A removed subtree is still the edit ZenGin has the most room to disagree about.

The `oCItem.instance` half is closed: the name a `SetVobClassProp` writes is
checked against the parser's item index, so a typo cannot reach a save — but
that is a check, not a verdict. Increment 2 widened the gap rather than closing
it: five more classes are editable, and a sound or a fog zone written wrongly is
*invisible in the viewport* — the first edits whose only witness is the engine.

`verify-world-edit.js` sets no class property at all, so a rebuilt candidate
would have to grow one before it is worth building. **Whether that rebuild is
worth doing is Daniel's call** — it costs a staged candidate and two engine
passes.

### 16.3 Phase 1b-2 — the classes that are left

Eight classes are editable and the catalogue has five kinds, so the kinds are no
longer the constraint and the class list is again. Left: the rest of the trigger
family, `oCMob*` — each one C++ case plus one `CLASS_FIELDS` entry plus its
tests.

`zCVobAnimate` landed 2026-08-28: its one field, `startOn`, needed no enum and
no decision — `s_is_running` is save-game only, exactly as the header marks
it, so the class had nothing else to hold out.

`zCPFXController` is fully landed 2026-08-28: `initiallyRunning` first, then
`pfxName` and `killWhenDone` in the same session — all three plain scalars,
none an enum, so nothing on the class was held out by decision.

`zCTriggerWorldStart` landed its one non-enum, non-list field 2026-08-28:
`fireOnce` (`fire_once`), read as `fireOnce` on the get side already. `target`
stays out with the rest of the trigger family's target strings, and
`s_has_fired` is save-game only — the same "nothing else to hold out" shape as
`zCVobAnimate`.

`oCTriggerScript` landed its one non-enum, non-list field 2026-08-28:
`function` (the script function it calls before firing an `OnTrigger`),
already read on the get side (`normalize.cc`'s `PutTriggerProps`/case). The
base `VTrigger` fields it inherits (`target` among them) stay out with the
rest of the family's target strings and base fields. `zCTriggerUntouch` and
`zCTriggerList` turn out to have **no** eligible field at all once enums,
lists and `target` are excluded — `zCTriggerUntouch` is `target` alone, and
`zCTriggerList` is `mode` (enum) and `targets` (list).

`zCTrigger`'s own base fields landed 2026-08-28: the eight bools and four
numerics `VTrigger` declares (`startEnabled`, `sendUntrigger`,
`reactToOnTrigger`, `reactToOnTouch`, `reactToOnDamage`, `respondToObject`,
`respondToPc`, `respondToNpc`, `maxActivationCount`, `retriggerDelaySec`,
`damageThreshold`, `fireDelaySec`) — `target` and `vobTarget` stay out with the
rest of the family's target strings. This surfaced a genuine ZenKit
writer/reader asymmetry, patched as `0028`: `VTrigger::save` wrote the
deprecated raw `flags`/`filterFlags` bytes `load()` unpacks into those eight
bools, verbatim, rather than reconstructing them from the bools — so setting
any of the eight and saving silently reverted to whatever the archive held at
load. (`0028` dropped the bits of those bytes `load()` does not unpack;
`0044` keeps them — §16.13.) `zCMover` and `oCTriggerChangeLevel` both derive from `VTrigger` and
inherit these twelve once their own case is added. `zCTrigger` was appended to
`BuildVisualVobTree`'s mesh-extraction-only fixture (path `1/12`), so the
checked-in golden fixture is unaffected.

`oCTriggerChangeLevel` landed 2026-08-28: the inherited `VTrigger` twelve plus
its own two strings, `levelName` and `startVob` — decided to be plain config
rather than cross-references (nothing in the world names them back the way
`target`/`vobTarget` are named), so they join instead of staying held out with
the rest of the family's target strings. Appended to `BuildVisualVobTree` at
path `1/13`. `oCMob*` is the remaining work.

`zCMover`'s own fields landed 2026-08-28: the inherited `VTrigger` twelve plus
thirteen of its own fourteen — two delay/damage floats (`touchBlockerDamage`,
`stayOpenTimeSec`), three bools (`locked`, `autoLink`, `autoRotate`) and eight
sound names. `behavior`, `lerpMode` and `speedMode` are enums and stay out with
the rest of the catalogue's enums; `keyframes` is an unbounded list. `speed` is
held out for a reason none of the family's other held-out fields share:
ZenKit's `VMover::save` writes `moveSpeed` (with the two lerp/speed enums)
only when `keyframes` is non-empty, and this catalogue cannot author
`keyframes` — so on any mover that animates from its visual instead of manual
keyframes (most of them), a `speed` write is silently dropped on save, the same
"legal write the engine ignores" shape as `randomDelay` below. Appended to
`BuildVisualVobTree` at path `1/14`.

`oCMOB` landed 2026-08-28: `VMovableObject`'s own nine plain scalars — the base
every `oCMob*` class inherits, and a class in its own right for a plain,
non-interactive movable object. `soundMaterial` is the one enum on the class and
stays out with the rest of the catalogue's enums; nothing else on it is a list
or save-game-only, so nothing else was held out. Appended to
`BuildVisualVobTree` at path `1/15`.

`oCMobInter` landed 2026-08-28, and with it the three subclasses that add
nothing of their own — `oCMobLadder`, `oCMobSwitch`, `oCMobWheel` (each an
empty `struct : VInteractiveObject` in `MovableObject.hh`, so they share
`oCMobInter`'s exact field set and its C++ case, one `case` label falling
through to the next). The base nine plus `oCMobInter`'s own four eligible
fields — `stateCount`, `conditionFunction`, `onStateChangeFunction`, `rewind`.
`target` stays out with the rest of the family's cross-reference strings; the
`item` decision flagged above was resolved the same way — held out, for the
same reason: the editor's `oCItem.instance` index check does not extend to it,
and a class-property write is not the layer to grow that check in. Appended to
`BuildVisualVobTree` at path `1/16` (one fixture VOB of type `oCMobInter`
stands in for all four — the C++ case and the field set are identical for the
other three, so a second fixture would round-trip the same code path).
`oCMobFire`, `oCMobContainer` and `oCMobDoor` landed 2026-08-28, closing
`oCMob*`: each is the base thirteen (`oCMobInter`'s own four included) plus
its own fields. `VFire` adds `slot` and `vobTree`, both plain config that
names no script symbol, so nothing on the class is held out. `VContainer`
adds `locked` and `pickString`; `key` (the item instance that unlocks it)
stays out with `item`, the same cross-reference decision, and so does
`contents` — a single archive string, but one that encodes a comma-separated
list of item instances and counts, the same "names script symbols this
catalogue cannot validate" shape as `key` rather than the unbounded-list
reason `keyframes` is held out by. `VDoor` adds the same `locked` and
`pickString`, `key` held out the same way. One fixture VOB per class, appended
to `BuildVisualVobTree` at paths `1/17`-`1/19`.

Held out by decision rather than by time, and **enums are now the whole of it**:
`mode`, `volumeType`, `zCMover.lerpMode`/`speedMode` and their kin, where
retail carries out-of-range values a dropdown destroys. Enums are also most of
the "legal writes the engine ignores" question — `randomDelay` /
`randomDelayVar` are read only when `mode` is RANDOM, and `mode` is precisely
what cannot be set; `zCMover.speed` is the one instance of the same shape that
is not an enum, held out for the `keyframes`-emptiness reason above instead.

Also out: `isStatic` and anything else changing *which* fields the archive
contains, list fields, and base-`zCVob` widening (§14.1 item 1.8). Alongside and
independent: class-specific *insertion* (item 1.3 — `insertItemVob` is in the
binding and wired to nothing), and copy/paste (1.2). Numeric transform entry
(1.5) is landed bar the multi-selection decision (§16.4); snapping (1.6) is
fully landed (§16.5). All still before Phase 1c in §11.

### 16.4 Typed rotation — what is left needs Spacer and a UI decision, not code

The three fields are in and the quiet-corruption trap is handled per angle, so
the 30.2 % of retail VOBs that are non-orthonormal are not re-orthonormalized by
a commit nobody made. Two things stayed open on purpose.

**Absolute or delta for a multi-selection.** The fields are hidden for N VOBs
rather than guessing. Single selection is absolute
(`rotateVob(..., eulerToZenRotation(typed), bounds)`); N VOBs would be
`multiplyRotation(target, invert(current))` and is a UI decision, not a
derivation.

**Spacer parity is unmeasured.** Nothing in the format, in ZenKit or here
commits to an Euler order, so Y-X-Z was chosen on retail singularity counts
(464 VOBs on XYZ's against 53 on YXZ's), not on a match to Spacer. Settling it
needs Spacer itself — type an angle, save, read the matrix back. If it turns out
different, only those two functions and their tests change.

One thing users will see and may report as a bug: displayed angles are canonical
— yaw/roll in (−180, 180], pitch in [−90, 90] — so a field committed at 190°
remounts as −170°, and a pole pose remounts with roll 0. Both correct, both look
like the editor changing their number.

### 16.5 Snapping — drop-to-ground and align-to-normal (landed)

Grid step and angle step landed first. The two that were left were **not**
blocked on a raycast — the world mesh already had a BVH — but on both being
*per-VOB* answers — each VOB finds its own ground, its own normal — while
`translateVobs`/`rotateVobs` take **one** delta for the whole selection. That
meant a per-VOB op-building path, which `zen-world` now has:
`dropVobsToGround` and `alignVobsToNormal` each take a list of `{ vob, ... }`
hits rather than a shared delta, batching to one `MoveVob`/`RotateVob` per VOB
and one undo entry, exactly as `translateVobs`/`rotateVobs` do for a shared
delta.

Align-to-normal turns local **+Y** onto the hit normal — the engine is Y-up, so
+Y is the standard default, with no per-visual-class exception (the open
question of "which axis is up for this visual" that keeps a placed VOB at
`IDENTITY` is not reopened here). The turn composes on the left, same as
`rotateVobs`, so whatever the VOB's orientation already had about that axis
survives.

The raycast itself lives on `WorldViewport` as an imperative handle
(`WorldViewportHandle.raycastDown`) — the one thing the World surface needs
from the viewport that is a query rather than a prop, answered synchronously
against the existing BVH in response to a toolbar click. `WorldSurface` casts
down from each selected VOB's own position, in flat-index order, and drops any
VOB whose ray missed rather than refusing the whole batch — a VOB over the
sky or off the edge of the mesh is left where it was, and the rest still land.

Confirmed not reopened: a *typed* coordinate does not snap (a typed number is
an explicit destination).

### 16.6 Every remaining catalogue bound rests on documentation, and one was wrong

The two unmeasured bounds are closed, but the way they closed is the finding:
the sweep that settled them also found `zCVobSound.volume` shipping `max: 100`
on ZenKit's "percent (0-100)" wording while retail NewWorld holds 130 and 150 —
the grid, the validator and the binding were all refusing values the game itself
ships.

**So a bound taken from ZenKit's docs rather than from a `normalizeWorld` sweep
is a live refusal risk, not a cautious default.** `coneAngle` 0–360 and the two
daytime hours 0–24 were the ones still standing on documentation alone; swept
2026-08-28 over the same three worlds, both are confirmed rather than
falsified. `coneAngle` is `0` on all 1,237 `zCVobSound`/`zCVobSoundDaytime`
VOBs in the corpus — retail never uses a directional cone, so nothing tests the
upper bound, but nothing refutes it either. The 84 `zCVobSoundDaytime` VOBs
hold `startTime` in [5, 8] and `endTime` in [12, 23], comfortably inside 0–24.
Every catalogue bound has now been swept at least once; none remain
documentation-only.

### 16.7 Waynet editing — the edge ops, and add/delete/rename

The gizmo landed, so the one op that exists is now reachable; nothing below is.

**The addressing problem is the whole job and it is untouched.** `MoveWaypoint`
addresses a waypoint by its index into the list `getWaynet` emits, and that is
safe only because a move inserts, deletes and reorders nothing. Every op left
here breaks it, and names cannot be the fix — nothing in the format promises
they are unique, which is why the binding matches edge endpoints by pointer
identity. **Retail happens to have no duplicate** — 24 worlds, 12,341 waypoints,
0 collisions even case-insensitively — but that is a fact about the shipped data,
not a guarantee about a world somebody edits, and an *op* that persists an
address needs the guarantee. The jump (§16.8) can key on names precisely because
a jump is read-only.

The edge ops keep their original hazard: `free_point` is not a stored field, and
`WayNet::save` writes only free points plus edge endpoints, so a non-free
waypoint in no edge is dropped at save. Removing a waypoint's last edge therefore
deletes the waypoint, which is why an edge op is not invertible as an edge op.
Waypoint delete has a bounded version of the arbitrary-VOB-delete trap — a
`WayPoint` is five scalar fields, so what an op cannot describe for free is its
edge memberships, and those are an enumerable list.

### 16.8 Jumping between a script reference and the place it names

Daniel's idea, sized 2026-08-28. The core claim survived: **nothing in the
parser records a waypoint-name string literal as a reference**, and that index,
not the camera, is the job. `cross-references.ts` knows exactly two reference
kinds and returns no file, line or column at all — it exists to serve
rename/remove, so it is the right *shape* and the wrong *payload*. The camera is
nearly free: `frameVobs` takes `bounds: null` for "a point rather than a thing
with a size", and waynet positions are already ZenGin centimetres.

**Four details the first sizing got wrong, and the fourth changes what to
build.** The jump is at `WorldSurface.tsx:193-198`, not `:158`. `start_aiwp`
does not exist in the G2 MDK — the field is `C_Npc.wp` (plus `spawnPoint`),
literal-assigned in 2 places in the whole corpus. There is **one** request prop,
not two: `frameSelection` is a closure inside the scene effect, so a waypoint
jump is the *second* prop — exactly the trigger the imperative-handle note names.
And the three carriers first listed were the least-used: measured over the MDK's
1,725 `.d` files, `AI_GotoWP` has **6** literal waypoint sites against the `TA_*`
daily routines' **6,223**. The routines are the feature; the interesting question
a level editor answers is where an NPC stands at 08:00.

**The extractor should not hardcode a call list.** 58 `TA_*` functions declare a
parameter literally named `var string waypoint`, so the rule is derived from the
project being edited — map a function to the index of such a parameter, then read
the literal at that position. Only the engine externals (`AI_GotoWP`,
`Npc_GetDistToWP` and ~4 more) need a seed table, and that set is closed.

**Correction, 2026-08-28: function parameters were already exposed** —
`DialogFunction.parameters` (`daedalus-parser/src/semantic/semantic-model.ts`)
has existed since commit `a5270a3`, generic across every `function_declaration`,
not a stale claim worth re-checking again. What was actually missing, and has
now landed, is the call-site half: `DialogFunction.callSites` captures every
`call_expression` in a function body (not gated behind the hardcoded
action-name switch `action-parsers.ts` uses) with its arguments
(`ParsedArg[]`, reusing `parseArgumentsDetailed`) and a 1-based
`{startLine, startColumn, endLine, endColumn}` — the "line/column must survive
a path that today keeps only `node.text`" trap W1 names below. Joining a call
site's args against the callee's `parameters` to find the `waypoint` index is
now pure application logic over the model; no more parser work is needed for
either W1 or W2.

**The duplicate-name decision is answered by measurement: don't design for it.**
24 worlds, 12,341 waypoints, **0 duplicate names**, not one even
case-insensitively. Build the lookup multi-valued anyway (it costs nothing), jump
to the first, and spend the effort on the real residue instead: 98.0 % of the
6,529 literal sites resolve against all 24 worlds but only 84.3 % against the
three main ones, so the UI must distinguish "no such waypoint" from **"not in
*this* world"** or it will lie about the largest cluster of references in the
corpus.

**Phasing, and the half worth doing first is the back-direction.** W1 the index
(medium — needs the parser change, and line/column must survive a path that today
keeps only `node.text`); **W2 world → scripts (small-medium, and the one to land
first)**: click a waypoint, see the routines that name it. It needs neither
inherited decision, no viewport refactor and no new navigation model, and it
delivers a Problems rule — 128 dangling waypoint sites — for free. W3 the
imperative handle (small, ~60 lines net negative; do it immediately before the
caller that justifies it, not earlier). W4 script → world is **large**, and not
for the camera: it needs the mount-lifetime fix in `refactoring-targets.md`.

Note a selected waypoint has **no UI at all** today, so W2 builds a panel from
nothing rather than extending one.

**The trap that would make W1 silently wrong**: an index built off
`mergedSemanticModel` is capped at `PARSED_FILES_CAP = 512` against the MDK's
1,725 files, and *which* files depends on the selected NPC — wrong by
construction and non-deterministically so. It has to ride `buildProjectIndex`'s
worker-pool pass, exactly as `voiceIds` does. Also: free points (`WP_STAND`,
`WP_PICK`, …) are prefix-matched by the engine, so a strict exact-match Problems
rule invents ~60 false findings.

**W2 landed, 2026-08-28, minus the Problems rule.** `ProjectIndex.waypointSites`
(`ProjectService.buildProjectIndex`) rides the worker-pool pass exactly as
`voiceIds` does — `extractWaypointSites`/`buildWaypointParamIndex`
(`semanticMetadataUtils.ts`) join every call site's `callSites` against a
global map of "which argument index holds the waypoint": a small seed table
for engine externals (`AI_GotoWP`, `Npc_GetDistToWP` — only the two the plan
confirmed; the "~4 more" are still unverified and not guessed at) plus every
project-declared function whose own parameter is literally named `waypoint`
typed `string`, derived per-project rather than hardcoded. `WaypointPanel`
(new) is mounted in `WorldSurface`'s right panel when `selectedWaypoint` is
set — the panel a waypoint never had — listing the routines the index found,
read-only (no jump-to-source; that is W4's mount-lifetime-gated territory,
not this).

**The Problems rule turned out not to be free.** `ProjectView`
(`problems/domain/types.ts`) is built purely from parsed per-file
`SemanticModel`s — it carries no world/waypoint data at all, so a
"dangling waypoint" rule has no way to know which waypoint names exist in the
currently open world. Closing this needs either a new input the Problems
pipeline threads through (from `worldStore`, only meaningful with a world
open) or folding the free-point prefix-match exception in above into whatever
shape that takes — a small design decision, not a measurement, so it stays
open rather than being guessed at here.

### 16.9 What is left of the ASCII writer — A6, and float text precision

**A2 and A3 landed 2026-08-28** as patches `0045`, `0046` and `0047`, a chain:
`0045` made the unpacked `zCVob` layout readable at all (`write_mat3x3` emitted
a `rawFloat:` entry where `read_mat3x3` and ZenGin both use `raw:`), `0046` made
the unpacked writer correct (`presetName`/`vobName`/`visual` written twice, and
the visual and ai objects the unpacked reader always takes out of the stream but
`save` never wrote), and `0047` made it reachable by having `load` record the
layout on the object and `save` reproduce it instead of packing everything.
`zenkit-node/test/asciiUnpackedVob.test.js` is the regression, and
`_authorFixtureWorld`'s fifth argument is the only thing that reaches the
unpacked writer.

**Closing A2 re-diagnosed A6's headline number, which was never A6's.** The
43,341-of-43,469 `physicsEnabled` findings were an artifact of the packed
conversion: an unpacked VObject carries no `physicsEnabled` entry, so `load`
leaves ZenKit's `= true` default on it, and only the re-save's packed form —
where A6 writes bit 6 false — disagreed. Measured on OldCamp, before and after
over the retail install: container diff `whole-file` (unalignable) →
`event-aligned` with **gap 0**; re-save 3,511,964 B → 4,012,132 B against a
3,979,132 B original; struct findings down to **440, none of them
`physicsEnabled`**. `OldWorld` and `DragonIsland` re-save `identical` either
way — retail BinSafe is packed throughout, so `0047` cannot move it.

**A6 is still open and still the editor's own path.** `VirtualObject.cc` writes
packed bit 6 as `physics_enabled && rigid_body` on G2, but `rigid_body` is only
filled inside `if (r.is_save_game())` — so in a *world* it is always empty and
the flag is always lost. The `&& rigid_body` guard belongs where the rigid body
is actually written, and it is already there; the fix is deleting it from the
bit-6 line. It changes no retail byte today (0 `physicsEnabled` VOBs across
41,393 in the three measurable BinSafe worlds), but it is the packed writer, so
the BinSafe path the editor saves through has it. **Not landed because it needs
a fixture VOB with the flag set and, being a save-path byte change, the
project's own engine-A/B rule** — the same reason the three ops of §16.2 have no
verdict.

**What is now the dominant ASCII defect: float text precision.** ZenKit writes
every ASCII float with `std::to_string` — six decimal places, always — where
ZenGin writes a shortest-round-trip form. `1511.77087` comes back
`1511.770874`, `0` comes back `0.000000`, and at retail magnitudes it costs
significant digits: OldCamp's remaining 440 struct findings are all `position`,
`bbox`, `speed` and waypoint `direction`, and the re-save is now 33 KB *larger*
than the original for this reason alone. It is the ASCII-entry counterpart of
what patch `0009` does for binary `texScale`, so the shape of the fix is known
and the same argument (byte fidelity only; the parsed value is unchanged)
applies. Unowned, and it is what a fourth patch in this area should be.

**The lesson A5 taught, and it will repeat.** A5 was invisible to CI for one
reason: `decalAlphaWeight` is the only `write_byte` field reachable outside a
savegame and the authored fixture had no decal — so the fixture round-tripped
clean while all 20 retail worlds failed at the first decal in the file. The
fixture now hangs a `VisualDecal` on the chest. **Any writer path with no
fixture field on it is a defect CI cannot see**, and the cheap audit is to walk
`WriteArchive`'s methods and ask which have no fixture data behind them. A2 and
A3 were the same lesson at the level of a whole *branch* rather than a field —
they survived because nothing could execute the branch, which is why `0047`
came with a fixture switch that can.

**There is still no ZenGin-written ASCII fixture**, so CI cannot regression-test
an ASCII round-trip against anything but ZenKit itself.
`_authorFixtureWorld(..., 'ascii')` is ZenKit's own writer, so `--fixtures`
proves self-consistency and nothing about the engine. A real ASCII fidelity
result stays a developer-local `--root` run unless a small ZenGin-authored ASCII
world is checked in.


### 16.10 `resavedSize` is fragile at a day or month boundary, not a second one

Found while making the ASCII stamp comparisons robust, and left alone
deliberately. Patch `0018` formats the header stamp `"%d.%d.%d %02d:%02d:%02d"`
— hour, minute and second are zero-padded, **day and month are not** — so the
header's *length* changes when the day crosses 9→10 (or the month does), and the
re-save is then a different size from the original. That breaks
`assert.strictEqual(ascii.resavedSize, ascii.size)`
(`test/roundtrip.test.js:165`) and `row.wholeFileIdentical` with it; reproduced
by rewriting the fixture's stamp shorter before the re-save, `sizes 5064 5068`.

Not fixed because the fix changes what `resavedSize` *means* in the harness
report — a stamp-stripped size, or a second field beside it — and that is a
report-shape decision for Daniel rather than something to do unasked.

### 16.11 A malformed world still crashes the reader — the hang was the small half

The spin is fixed (patch `0027`), but closing it turned up the size of what is
left. Seeded fuzzing, 30 seeds of 100 corrupted bytes each over one BinSafe
fixture: **19 crashed the child with `0xC0000005`**, one with `0xC0000374` (heap
corruption), two hung, and only eight threw cleanly.

So a malformed world still takes the editor's `zenkit.worker` down — by segfault
now instead of by spinning — and **the worker isolation stays load-bearing:
`loadWorld` is not crash-safe and must never be called on the main thread.**

The shape of the job is unvalidated counts feeding `resize`/indexing throughout
`Mesh.cc`, `BspTree.cc` and the VOB readers, and the underlying hazard beneath
all of them is `ReadMemory::seek` (`vendor/ZenKit/src/Stream.cc:277-283`)
**silently ignoring an out-of-range seek** rather than failing. Making it clamp
or throw would fix the class in one place and change behaviour for every reader
in ZenKit, which is why `0027` bounded its own loop instead. **That decision has
since been taken — leave it alone — and the four reasons are at the end of this
section.** Every chunk-walking loop carries its own bound, deliberately.

**One more instance is bounded (2026-08-28, patch `0029`).**
`ReadArchiveBinsafe::read_header` sized `_m_hash_table_entries` to the file's
`hash_table_size` and then indexed it with the file's `insertion_index`, a
second, independent, unchecked count — so a corrupted index past the table was
an out-of-bounds *write* into the heap, which is where the `0xC0000374` in the
fuzz run came from. Bisected to one byte of `test/fixtures/minimal.g2.zen`
(offset 3983, the low byte of the `rangeAniSmooth` entry's index) and now
covered by a child-process test in `zenkit-node/test/loadWorld.test.js` that
seeds the field by structure and asserts a clean throw.

**A second instance is bounded (2026-08-28, patch `0030`).** `BspTree::load`
walked each leaf node's `[polygonIndex, polygonIndex + polygonCount)` range
straight into `polygon_indices` with `operator[]`. Both ends come off the node
in the TREE chunk (`0xC040`) while the list is sized by the POLYGONS chunk
(`0xC010`), so nothing tied the two together — and the list is empty entirely
if POLYGONS never parsed. Found by a fresh fuzz run and delta-debugged to one
byte: file offset 1230 of `minimal.g2.zen`, the high byte of the `0xC010` chunk
id. Covered by a child-process test in `zenkit-node/test/loadWorld.test.js`
that seeds an out-of-range `polygonIndex` by structure, so it does not depend
on the fixture's chunk order.

**A third instance is bounded (2026-08-28, patch `0031`).** `Mesh::load`'s
LIGHTMAPS_SHARED (`0xB026`) branch read a per-lightmap `texture_index` off the
file and handed it straight to `lightmap_textures[texture_index]`, a vector of
`shared_ptr` sized by a *different* count in the same chunk. An out-of-range
index therefore copy-constructs a `shared_ptr` from memory past the allocation
— a wild refcount increment, not only an out-of-bounds read. This is the
`--seed 39` reproducer named below, delta-debugged to file offset 899, byte 2
of the third lightmap's texture index. Covered by a child-process test in
`zenkit-node/test/loadWorld.test.js` that seeds the index by structure (the
chunk's last four bytes are, by its layout, the last lightmap's index).

**`get_entry_key()` is *not* a third instance, and this section used to say it
was.** It does index `_m_hash_table_entries` with an unchecked file-supplied
`hash`, but it has **no caller anywhere in ZenKit or in `zenkit-node`** — every
real read goes through `ensure_entry_meta`, which seeks past the same `uint32`
without dereferencing it. A world with a corrupted entry name index loads
cleanly. Bounding it would be dead-code hardening; the crash class is
elsewhere.

Still not the class. Every chunk-walking loop in `Mesh.cc` and the VOB readers
was untouched — which is why the worker isolation stays load-bearing. (`Mesh.cc`
is bounded by `0036` below; the VOB readers are not.)
(`_parse_bsp_nodes`'s unbounded recursion was named here too, and is gone with
`0035` below.)
(`BspTree::load`'s OUTDOORS branch was named here too, and is bounded by `0034`
below.)

**Re-measured 2026-08-28**, with `zenkit-node/tools/fuzz-world.js`, which is now
checked in so the number is reproducible: 40 seeds of 20 random byte writes
*confined to the entry stream* (`entryStart` to `hashTableOffset`) gave 4
`0xC0000005` and 1 hang before `0030`, and **1 crash and 1 hang after it**. The
old 19-of-30 number was measured a different way and the two are not comparable.

**Corrupt the entry stream, not the whole file.** The same driver flipping 100
bytes anywhere gave 30 of 30 clean throws: a byte in the text header is rejected
before any reader runs, so a whole-file fuzz mostly measures the header check.

**A fourth instance is bounded (2026-08-28, patch `0032`), and it was not the
`seek` hazard.** `--seed 17`, the last failure left after `0031`, delta-debugged
to one byte — file offset 679 of `minimal.g2.zen`, byte 2 of the first shared
lightmap texture's `mipmapCount`, turning 1 into 9,568,257. `Texture::load`
walks one iteration per level and `_ztex_mipmap_size` halves the dimensions
*inside* that walk, once per level, so the work is **quadratic in a count
nothing bounds** — on the order of 9e13 halvings, which neither throws nor
returns. It looks exactly like `0027`'s spin from outside and shares no
mechanism with it: no seek is involved, and the `ReadMemory::seek` hazard above
is not the only way to build a hang out of an unvalidated count. Bounded at 32
levels — `width` and `height` are `uint32`, so a chain cannot need more halvings
than that — and covered by a child-process test in
`zenkit-node/test/loadWorld.test.js` that seeds the count by structure.

**The 40-seed run is 40 of 40 clean throws** (2026-08-28, after `0032`): no
crash, no hang, no named reproducer left in it. That is a milestone and **not** a
crash-safety claim — it is 40 seeds of 20 bytes over one small synthetic
fixture. The unvalidated counts listed above are still unvalidated, the recursion
in `_parse_bsp_nodes` is still unbounded, and **the worker isolation stays
load-bearing.**

**Widening it to 200 seeds immediately found six more** (2026-08-28), which is
the answer to "is 40 of 40 enough": two crashes and four hangs, and the whole
run costs two minutes. **Take the widened run as the baseline from here** — the
40-seed number is only kept above because the patch headers cite it.

**A fifth instance is bounded (2026-08-28, patch `0033`), and it is a null
dereference, not a count.** `WayNet::load` does
`points.push_back(r.read_object<WayPoint>(version))` and then
`points.back()->free_point = true`, but `ReadArchive::read_object` returns null
for three separate file-supplied conditions — an unknown class name, an object
marked empty (`%`), and a reference whose index is not in the object cache. Seeds
68 and 81 of the 200-seed run each delta-debug to **one byte** inside the first
waypoint's `[waypoint0 zCWaypoint 0 7]` header (offsets 2716 and 2723: the class
name, and the space before the object index), both `0xC0000005`. Covered by a
child-process test in `zenkit-node/test/loadWorld.test.js` that rewrites the
class token in place with an equal-length name ZenKit does not know.

**The bound stops at the free-point loop on purpose, and the second test in that
file says so.** An edge's `wayl`/`wayr` can be null for the same three reasons,
but nothing in `WayNet::load` dereferences one and `CollectWaypoints` /
`WayNetGraph` in `src/normalize.cc` already filter nulls out deliberately — a
reference into a waynet ZenGin itself wrote can go unresolved, so refusing that
world would be a new refusal rather than a crash fix. Measured: such a world
still loads and its endpoint is dropped from the waynet.

**All four remaining hangs were one chunk, and they are bounded (2026-08-28,
patch `0034`).** Seeds 124, 129, 178 and 181 of the 200-seed run every one
delta-debug into the `0xC050` OUTDOORS chunk of `BspTree::load` — seed 124 to
**one byte**, file offset 1317, the low byte of `sector_count`, turning 0 into
121.

Two things this section asserted about it were wrong. **The chunk reader is not
bounded**: `proto::read_chunked` (`include/zenkit/Stream.hh`) hands the callback
the whole reader, so `c->eof()` is the end of the *archive*, not of the chunk,
and a guard built on it would not have fired here. And the hang is not the loop
count — **one sector is already enough**, measured. The first sector reads its
name off the four zero bytes of `portal_count`, so `node_count` is read across
the following `0xC0FF` chunk header as `0xFF000000` and `resize` commits 17 GB.
An *absurd* count is harmless by comparison: `reserve` throws `bad_alloc` and
the loop is never entered, which is why a test seeded with two billion sectors
passes against the unpatched reader and the committed one uses the fuzzer's own
121.

The patch bounds all three counts in the chunk — sector, per-sector node and
polygon, and portal — by the bytes actually left in the reader, which needs a
`_bytes_remaining` helper because `Read` exposes no size but every
implementation can seek to the end and back. Covered by a child-process test in
`zenkit-node/test/loadWorld.test.js` that seeds the count by structure.

**The 200-seed run is now 200 of 200 clean throws.** Same caveat as the 40-seed
milestone above, only louder: it is 200 seeds of 20 bytes over one small
synthetic fixture, and it is **not** a crash-safety claim. The chunk-walking
loops in the VOB readers are untouched, and **the worker isolation stays
load-bearing.** The next step is not another seed — it is either widening the
corpus (more seeds, more bytes, a real world) or taking the `ReadMemory::seek`
decision, and neither is named as a card yet. (The widening happened, and is
written up under patch `0037` below: what was exhausted is the random seeds, not
the defect class.)

**The BSP node recursion is gone (2026-08-28, patch `0035`), and it is the one
site here the fuzzer could never have found.** `_parse_bsp_nodes` recursed once
per set flag bit of the node it had just read, and a node is 49 bytes on the
wire — so a chain deep enough to exhaust the stack needs megabytes, and 200
seeds of 20 byte writes over a 4 KB fixture cannot manufacture one. Measured by
growing the fixture's TREE chunk into a chain instead: 100,000 nodes (4.9 MB)
kill the child with `0xC00000FD`, a stack overflow, which no `catch` can turn
into a thrown error. **The editor is worse off than that number says** — node's
main thread has an 8 MB stack and worlds are loaded on a `worker_threads`
worker, whose default is 4 MB.

**It is the one bound in the series that is not a bound.** Every other patch
here checks a file count against the bytes left in the reader, and that argument
does not transfer: the depth a *valid* world may reach rises with its size and
ZenGin's compiler documents no ceiling, so a guessed limit risks refusing a
world the engine loads. Parsing the tree iteratively — an explicit stack of the
back children still owed — removes the question rather than answering it, and
costs heap, which the reader already bounds elsewhere. It also removes a latent
use-after-realloc only the recursion could have: `node.back_index` was assigned
through a reference into `nodes` *after* the front subtree had pushed onto that
same vector, which is safe only while `reserve(node_count)` holds — that is, only
while the file's own count is not smaller than the nodes it carries. Covered by
a child-process test in `zenkit-node/test/loadWorld.test.js` that grows the TREE
chunk by structure (the blob's declared size and the header's hash-table offset
move with it; nothing else in the container is an absolute offset).

The class is still open either way: the chunk-walking loops in the VOB readers,
and the `ReadMemory::seek` decision (taken at the end of this section: leave it).

**The waynet's own two counts are bounded (2026-08-28, patch `0037`), and the
way it was found matters more than the patch.** `WayNet::load` sized
`points.reserve` and `edges.reserve` from `numWaypoints` and `numWays` with no
check, and the edge loop cannot stop on its own for a reason `0033` had already
established: `ReadArchive::read_object` past the end of the entry stream logs
"Expected object, got entry" and returns **null** rather than throwing, and a
null endpoint is tolerated *by design*. Measured against the 1.4 KB fixture with
`numWays` rewritten in place to 0x0FFFFFFF: 268 million edges and 536 million
null waypoints, and the world still reports **`LOADED`**, after 41 s. The same
shape as `0036` — the dangerous count is the merely large one, because an absurd
one throws out of `reserve` before the loop is entered.

**Random fuzzing had been saturated for a while and did not say so.** Before the
patch: 600 seeds × 60 bytes over the fixture, **0 of 600**; and the corpus
widened to a real world at last — retail `NewWorld.zen`, 75 MB — 100 seeds × 20
bytes and 60 seeds × 500 bytes, **0 of 160**, with 44 of the first 100 loading
*cleanly corrupted*. Twenty to five hundred random byte writes have no reason to
land on the four bytes of a count, and over a 50 MB entry stream they never will.
So `tools/fuzz-world.js` grew a **`--counts` mode**: it rewrites every INTEGER
entry in the stream, one at a time, to one large-but-not-absurd value and reports
anything that crashes, hangs, or loads slowly against the clean file's own wall
clock. Twenty-one entries in the fixture, five seconds, and it named `numWays` on
the first run. **Prefer it to another seed.** Its limit is the fixture's field
set: a count that no VOB in `minimal.g2.zen` carries — `oCNpc`'s `numTalents`,
for one — is not swept by it, and running the sweep against a retail world is not
practical at one process spawn per entry.

**Two things the sweep cleared, and they are worth not re-deriving.**
`parse_vob_tree`'s `childs<N>` count is equally unbounded and `reserve`s just as
much, but the first missing child makes `read_object_begin` fail and the load
throws `invalid format` in 70 ms — loud, so not patched. And
`VirtualObject.cc:184` dereferences an iterator `:176` has just compared against
`visual_type_map.end()`, which looks like a defect and is not reachable: the
`dynamic_pointer_cast<Visual>` above it can only produce the seven visual classes,
and all seven are in the map. Bounding either would be `get_entry_key()` again.

**`parse_vob_tree`'s recursion is gone, and so is the tree's destructor (2026-08-28, patches `0038` and `0039`).** It was recursive twice over: once
per child in `parse_vob_tree` itself, and once per nesting level in the `skip`
lambda it uses for an object it cannot parse. Unlike `_parse_bsp_nodes` a deep
tree is cheap to write — a nested node costs an object header and a child count
— so both were measured by growing the fixture rather than by fuzzing: a chain
spliced into the root VOb's children, one child per level. **60,000 nested
`zCVob`s (9 MB) and 200,000 nested empty (`%`) objects (5 MB) each kill the child
with `0xC00000FD`**, on node's 8 MB main thread; the editor loads worlds on a
worker whose default stack is half that. Parsed iteratively for `0035`'s reason,
not bounded: a valid tree's depth has no documented ceiling.

**The parse was the smaller half.** With `0038` alone the 60,000-level world
loads, prints `LOADED`, and the process *then* dies with the same
`0xC00000FD`: `children` is a vector of `shared_ptr` and the defaulted
destructor tears the tree down by recursing once per level too. `0039` gives
`VirtualObject` a destructor that moves each child's children onto an explicit
stack, so a child always dies childless. A child whose `use_count()` is not 1 is
left whole — something else owns it. **Read a defect of this shape as reaching
as far as the object graph does, not as far as the parser does.**

**The binding's own four walks are iterative too (2026-08-28), and no patch was
involved — they are `zenkit-node`'s own source.** `CountVobs` and
`CollectVobNames` (`src/binding.cc`), `CollectVobs` and `CollectVobColumns`
(`src/normalize.cc`) each recursed once per level over `children`, reached
through `worldStats`, `vobNames`, `normalizeWorld` and `vobIndex` respectively.
Measured before the change, on node's 8 MB main thread: 40,000 levels kill
`vobNames` and `vobIndex`, 10,000 kill `normalizeWorld`, and 300,000 kill even
`worldStats` — the crash had moved from the reader into the binding, where the
frames are smaller but the bound was still nothing. All four now walk an
explicit cursor stack (`VobCursor` / `VobPathCursor` / `VobColumnCursor`), which
is `0035`'s argument, not a bound: a valid tree's depth has no documented
ceiling. Pre-order and the parent-before-child ordering both consumers rely on
are unchanged — checked against retail `NewWorld.zen`, 23,288 VOBs, identical
counts from all four and every parent index below its child's.

**One thing the fix does not remove, and cannot: `normalizeWorld` is quadratic
in the depth.** Every VOB gets a slash-joined index path, so a chain of N levels
retains N strings averaging N characters — ~200 MB at 10,000 levels and ~45 GB
at 300,000. That is the dump's shape, not the recursion, which is why the deep
test covers the other three walks at 300,000 and `normalizeWorld` only at
10,000. It is the fidelity harness's path, not the editor's; the editor reads
`vobIndex`, whose columns carry a sibling index rather than a path.

The `ReadMemory::seek` decision is taken at the end of this section.

**`Mesh.cc`'s element counts are bounded (2026-08-28, patch `0036`), and the
failure they allowed is not a crash.** Every chunk in `Mesh::load` sized a
container from a `uint32` read off the file — materials, vertices, features,
polygons, both lightmap chunks — and the same unbounded reader that made `0034`
possible means the loop after the `resize` neither throws nor stops early: it
runs to the file's own count over reads that return zero bytes. Measured against
the 1.4 KB fixture with one count rewritten in place to 0x0FFFFFFF: vertices
commit 3.2 GB and the world reports **`LOADED`** after 1.6 s, features 8.6 GB
after 5.1 s, polygons 13.9 s. An *absurd* count is again the harmless one —
0xFFFFFFFF vertices are 51 GB, `resize` throws `bad_alloc` and the load fails
loudly — so the dangerous value is the merely large one, and the tests assert on
the guard's own wording so a `bad_alloc` on a smaller machine cannot pass for a
pass. The fuzzer never found this because it never would: memory exhaustion is
not a non-zero exit, and 20 random byte writes have no reason to land on the
four bytes of a count. Bounded by the bytes left in the reader, the same
`_bytes_remaining` helper as `BspTree.cc`; the three retail worlds and all 24
loadable `.zen` under `Gothic II/_work/Data/Worlds` still load unchanged, and
`--fixtures` is still `identical`. Covered by three child-process tests in
`zenkit-node/test/loadWorld.test.js`.

**The first VOB reader is bounded (2026-08-28, patches `0040` and `0041`), and
getting at it needed a new fixture.** `VNpc::load` `resize`s `talents`, `items`
and `slots` from three unvalidated file counts, and it dereferences each item it
has just read — `items[i]->s_flags` decides whether a `shortKey<n>` int follows
on the wire, and `read_object` returns null for the three reasons `0033` named.
Both were measured, not inferred: `numTalents` at 0x0FFFFFFF builds 268 million
null talents, 4.3 GB, and the world reports **`LOADED`** after 6.8 s (`itemCount`
and `numInvSlots` commit 2.1 GB each before failing loudly, which is `0037`'s
waypoint-count argument); and an `itemCount` of **2** over a world holding one
item — a value inside any byte-based bound, so not the same defect — kills the
child with `0xC0000005` in 60 ms.

**Two of the five counts are deliberately left alone, and that is a measurement
too.** `numOverlays` and the news `NumOfEntries` drive `push_back` loops over
plain fields, and the first read past the end of the entry stream is a type
mismatch that throws in 66 ms — loud, so bounding them would be
`get_entry_key()` again.

**What actually blocked this was the fixture, not the fix.** `minimal.g2.zen`
carries no `oCNpc`, so the `--counts` sweep — whose limit this section already
named — could never reach any of the five fields, and neither could any seed. A
third fixture variant (`npc`, `src/fixture.cc`) authors a world with one NPC
carrying one of each list, into a temp directory at test time; the golden
fixture is untouched. **Read that as the general shape**: for a reader the
sweep cannot reach, the work is authoring the data, and the patch is the small
half. The remaining unbounded VOB counts are `oCMobContainer`'s `NumOfEntries`
and `zCTrigger`'s `numTriggerEvents`, both savegame-only and so unreachable from
a world.

**The last world-reachable VOB count is bounded (2026-08-28, patch `0042`), and
it is the one with no `reserve` to save it.** `VCutsceneCamera::load` reads
`numPos` and `numTargets` off the file and `push_back`s one keyframe object per
iteration into a vector it never reserves — so the "an *absurd* count is the
harmless one" escape hatch every other patch in this series leans on does not
exist here, because there is no `reserve` for `bad_alloc` to throw out of.
Every value is a merely large one. Measured against a 6 KB fixture with `numPos`
rewritten in place to 0x0FFFFFFF: **268 million null keyframes, 4.33 GB
resident, and the world still reports `LOADED`** after 15.8 s; `numTargets` is
the same at 15.5 s. A *negative* count is the one value that "works" unpatched —
both loops are `i < count` over a signed `int`, so an on-disk 0xFFFFFFFF loads a
cutscene camera with no keyframes at all instead of failing — and it is refused
too. Bounded by the bytes left in the reader with the same `_bytes_remaining`
helper as `Mesh.cc`, `BspTree.cc` and `WayNet.cc`; the 24 loadable retail `.zen`
all still load with identical VOB and waypoint counts. Needed a fourth fixture
variant (`camera`, `src/fixture.cc`) for `0040`'s reason exactly: the golden
world has no cutscene camera, so neither the `--counts` sweep nor any seed could
ever reach the two fields.

The 24 loadable retail `.zen` under `Gothic II/_work/Data/Worlds` all still load
with identical VOB and waypoint counts.

**The BinSafe container's own hash-table count is bounded (2026-08-28, patch
`0043`), and it is the first instance that is not in a *reader* at all.**
`ReadArchiveBinsafe::read_header` does `_m_hash_table_entries.resize(hash_table_size)`
straight off the file, and the loop after it cannot stop for `0037`'s reason
turned inside out: every read past the end of the *file* returns zero, so a zero
`keyLength` and a zero `insertionIndex` satisfy `0029`'s bound and the loop runs
to the file's own count once per unit. Measured against the 1.4 KB fixture with
the count rewritten in place to 0x0FFFFFFF: a **20.5 GB peak working set**, and
the world still reports `LOADED` after 35 s; 0xFFFFFFFF throws `bad allocation`
out of `resize` in 69 ms, which is the same "an absurd count is the harmless one"
shape as `0034`, `0036`, `0037`, `0040` and `0042`. Bounded by the bytes left in
the file at eight per entry — two `uint16`s and a `uint32` before a key that may
legitimately be empty. **This is `0029`'s own function and `0029`'s own chunk**:
that patch bounded the count that *indexes* the vector and left the one that
*sizes* it. Covered by a child-process test in `zenkit-node/test/loadWorld.test.js`
that locates the field through `readHeader`, so nothing in it is a byte offset.

**The `--counts` sweep has a second limit, and this is it.** `0040` and `0042`
named the first — a field no VOB in the fixture carries. This one the fixture
carries and the sweep still cannot reach, because the sweep rewrites INTEGER
*entries* of the entry stream and this is a raw `uint32` in the container's own
header. Read the limit as *"a field the sweep cannot reach is a field with no
coverage"*, whether it is missing from the fixture or simply not an entry. The
container header has three such words — `bsVersion`, `objectCount` and
`hashTableOffset` — and of those only `objectCount` is stored unused; an
out-of-range `hashTableOffset` is refused by `zenkit-node`'s own container
pre-check before ZenKit sees it (measured: `no MeshAndBsp section found`).

**The `ReadMemory::seek` decision is taken: leave it alone (2026-08-28).** It is
recorded here as a decision, not as a deferral, so nobody re-opens it without new
evidence.

- **Throwing is not available.** `Read::seek` is `noexcept` on the interface
  (`include/zenkit/Stream.hh`), and so is every override — `ReadFile`,
  `ReadStream`, `ReadMemory`, `ReadMmap`. A throw from one is `std::terminate`,
  so "make it fail" means changing a public vendor API and every caller's
  contract with it, in a fork we have to rebase.
- **Clamping would have fixed none of the fifteen.** Every instance closed in
  this section (`0027`, `0029`–`0043`) is an unvalidated *count*, an unvalidated
  *index* or an unbounded *recursion*. Not one is a desynced cursor, and a clamp
  changes nothing about any of them: `0027` is the only one seek was ever part
  of, and it was closed by bounding its own loop.
- **The layer above already stops at eof.** `ReadArchiveBinsafe::read_object_begin`
  opens with `if (read->eof()) return false;` and `read_object_end` with
  `if (read->eof()) return true;`, which is what makes `ReadArchive::skip_object`'s
  `do { … } while (level > 0)` terminate on a truncated or unbalanced archive
  rather than spin. Measured, not read: a world with a skipped object's end marker
  rewritten to `{}` and every byte after it zeroed still fails in 63 ms.
- **What would re-open it** is a reproducer in which the *cursor*, not a count, is
  the cause. There is none in the record, and the frontier the last three patches
  actually found is the opposite direction: fields no sweep and no seed can reach.

### 16.12 Two viewport constants only Daniel's hands can settle

Both landed with numbers chosen by reasoning, and neither has a test that could
ever judge them.

**The pivot.** `ORBIT_ROTATE_SPEED = 0.4` against OrbitControls' 1.0, and
`MIN_PIVOT_DISTANCE = 1` m. Two shapes to judge at the same time — whether the
projection-onto-the-view-axis pivot reads right near a screen edge (the
alternative is the literal picked point, which costs a view snap on every
middle-press), and whether a VOB under the cursor ought to be a pivot target
(it is not: ID-picking answers an id, not a point, and a CPU raycast over 724
`InstancedMesh`es is the 14.2 ms the viewport exists to avoid — a *clicked* VOB
is the fallback pivot, and interiors pivot on walls, which are world mesh).

**The VOB outline.** Two things in it are unverifiable without a GPU: that the
injected GLSL compiles at all — jsdom has no WebGL, so a shader-link error would
surface as black or missing props at runtime, not as a red test — and whether
`OUTLINE_DARKEN = 0.7` / `OUTLINE_POWER = 4` is the right faintness on retail
NewWorld. Both constants are named in `WorldScene.ts`. Also unjudged: how it
reads on alpha-tested foliage and on blended VOB materials, which get the term
uniformly by design (a face-on billboard is untouched; an edge-on one dims
slightly).

### 16.13 The four retail BinSafe worlds re-save `identical` again — patch `0044`

**Closed 2026-08-28 (patch `0044`).** For one day the headline BinSafe result —
`4× identical [BIN_SAFE]`, measured 2026-08-27 — did not reproduce: the same
command over the same install reported `4× semantic-drift [BIN_SAFE]`, NewWorld
108 differing events and OldWorld 13, every one of them the `flags` field of a
`zCTrigger` subclass and nothing else.

**It was patch `0028`.** `VTrigger::load` unpacks exactly two bits of the
deprecated `flags` byte — `startEnabled` (bit 0) and `sendUntrigger` (bit 2) —
and `0028` made `VTrigger::save` rebuild the byte from those two bools instead
of echoing the byte it read. Bits 1 and 3–7 have no bool to be rebuilt from, so
they were dropped; retail carries them (the four bytes sampled in OldWorld are
all `0b00010010`, bits 1 *and* 4). `filterFlags` had the same hole in bits 6–7
and was safe only by luck: `load` unpacks all six bits ZenGin uses.

**Reverting `0028` was never the answer** — the asymmetry it fixes is real and
is on the editor's own path. `0044` is `0016`'s shape applied here: the bits
nothing maps to are kept on two new zero-initialized members
(`reserved_flags`, `reserved_filter_flags`) and merged back into the rebuilt
bytes when writing. The deprecated `flags`/`filter_flags` members could not
serve for this — they have no initializer at all, so a freshly constructed
`VTrigger` would have merged in indeterminate bits. Covered by
`test/saveWorld.test.js`, which seeds the unmapped bits into an authored world
by structure and asserts every flag byte survives a load and a save; the retail
corpus was re-run and reports `4× identical [BIN_SAFE]` again.

**The forward fact, and it outlives the patch:** a save-path patch landed
without the retail corpus being re-run, and the claim it invalidated is the
loudest one this project makes. `zenkit-node.yml` cannot catch it — the corpus
needs a retail install and CI has none — so the check is a person running
`node scripts/zen-roundtrip.js --root "<install>/_work/Data/Worlds"` after any
patch that touches a `save`.
