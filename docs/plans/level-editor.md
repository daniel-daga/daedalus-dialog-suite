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

---

## 4. Data layer — ZenKit binding (open question 3)

Facts verified against upstream (2026-08):

- **ZenKit** ([GothicKit/ZenKit](https://github.com/GothicKit/ZenKit)) is MIT
  (logo CC BY-NC), C++17, actively maintained, v1.3 line.
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

The harness decides the passthrough question objectively:

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
(playability: an edited world runs in OpenGothic *and* original Gothic)
closes Phase 1.

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

- **Phase 0 — data layer (blocking, = brief Gate 1).** `zenkit-node` binding;
  `zen-roundtrip` corpus harness green against all G1+G2 originals including
  parts (developer-local) and synthetic fixtures (CI). Decides Plan A vs
  Plan B passthrough. *No editor UI before this gate.*
- **Phase 1a — read-only world viewer.** Opens with the **viewport perf
  spike** (§3): full G2 NewWorld against the written frame/draw-call/pick
  budget, before any viewport UI is built on Three.js. Then: load ZEN, render
  world mesh + VOB visuals + waynet graph, scene tree, property inspection,
  asset browser (VFS). Already useful on its own.
- **Phase 1b — VOB editing.** Gizmos, multi-select, batch property edit,
  drag-&-drop reparenting, undo/redo, dirty-part save with lighting/savegame
  warnings. Closes with **Gate 2**: an edited world (VOB moved, item added)
  runs in OpenGothic *and* original Gothic.
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
