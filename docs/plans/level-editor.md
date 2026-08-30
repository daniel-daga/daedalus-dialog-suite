# Plan: the ZenGin level editor

**Status: Phase 0 and Phase 1a are closed, Phase 1b is in progress.** Not a
proposal — the verdict below was taken, the binding and the world viewer
shipped, and the ops are landing. Source input:
[`level-editor-design-brief.md`](level-editor-design-brief.md) (German design
brief; defines goals, scope and constraints, and leaves the technical
architecture open).

**The settled architecture is no longer here.** It moved to
[`../architecture/level-editor.md`](../architecture/level-editor.md) — the UI
base decision, the binding, the round-trip strategy, the workspace layout, the
process and data-flow architecture, and the answers to all six of the brief's
open questions. This file keeps what is still moving: the verdict and its
rationale (§1, §2), the phasing and gates (§11), the risks (§12), the Spacer
parity backlog (§14), the undo bar (§15) and the open findings (§16).

Section numbers are continuous across the two files and never reused, so a bare
`§7` resolves whichever file you are in; `npm run board:check` fails if that
stops being true.

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
| 1.2 | **Copy / paste / duplicate**, incl. subtree | **done, less `physicsEnabled`** (§7) | The most-used Spacer verb after move. D1 (duplicate one VOB in place), D4 (a selection as one batch, one undo) and D3 (copy and paste as verbs) all landed 2026-08-28, as ordinary `AddVob`s with no new op. D2's class half landed 2026-08-28 on top of I1/I2 — a copy carries its **class** for the classes `insertVob` can construct, and drops it for the rest (and for `oCItem`, whose instance is not in the index) rather than have the op refused. What a copy still drops is the class *properties* and `physicsEnabled`. D5 (the subtree) landed 2026-08-28 as N appends in one batch. What is left is `physicsEnabled`; a cross-world clipboard only if part-to-part copying is wanted. |
| 1.3 | **Class-specific insertion** | unscheduled → 1b-2 | `insertVob` authors `zCVob` and nothing else. Needs at least: `oCItem`, `zCVobLight`, `zCVobSound`/`Daytime`, the trigger family (`zCTrigger`, `zCTriggerList`, `zCTriggerScript`, `zCMover`, `zCCodeMaster`, `zCMessageFilter`, `zCTriggerChangeLevel`), `oCMobInter`/`Container`/`Door`/`Bed`/`Ladder`/`Switch`/`Wheel`, `oCTouchDamage`, `zCPFXController`, the zones (`oCZoneMusic`, `zCZoneZFog`, `zCZoneVobFarPlane`), `zCVobStartpoint`/`zCVobSpot`, `zCVobAnimate`. |
| 1.4 | **Class-specific property editing** | **partial** (§7) | Seven classes so far. Increment 2 (2026-08-28) added the sound family and the zones — `zCVobSound`, `zCVobSoundDaytime` (which inherits the base four), `zCZoneVobFarPlane`, `zCZoneZFog`, `oCZoneMusic` — with no change to the validator, the op builder or the grid, which is increment 1's catalogue claim holding. What it exposed is that the value kinds, not the classes, were the limit — and increment 3 (2026-08-28) answered it with a `bool` kind and an `int` kind, which took the nine fields those five classes were holding back: the three sound booleans, the two fog booleans, and `oCZoneMusic`'s `enabled`/`ellipsoid`/`loop` plus its `int32` `priority`. `oCZoneMusic` and `zCZoneZFog` are complete — the enums that were the last of it landed 2026-08-29 as eight keys over thirteen classes, a fourth table (`CLASS_ENUM_FIELDS`) the validator reads generically so no per-key list can drift, and a field that offers the known values without coercing to them: an unrecognised value is kept, shown as such, and committed by nothing. No engine has seen any of the eight written (§16.2). **One question increment 3 left open**: `zCZoneZFog.color` is legible now only because `overrideColor` is drawn immediately above it — the grid still has no cross-field logic, so a colour on a zone that does not override is not disabled, greyed or annotated, and whether it should be is a UI decision nobody has taken. **`oCItem.instance` is no longer free text** (2026-08-28): the grid refuses a name the loaded project's item index does not declare and the IPC validator refuses a `to.instance` that is not a Daedalus symbol — see "The item instance stops being free text" in §7 for why the enforcement is split and why the main process cannot hold the index. Increment 1 (2026-08-28) landed `oCItem.instance` and `zCVobLight`'s `range` and `color` — 23.4 % of the 41,393 retail VOBs, and the three value kinds (cp1252 string, bounded float, fixed-arity integer array) the machinery needed. The whole path exists now — `getVobProps` exporting the reader `normalizeWorld` already had, the `SetVobClassProp` op, the `CLASS_FIELDS` catalogue every layer reads, the validator branch, the grid section — so each further class is one C++ case plus one catalogue entry plus its tests. Out by decision, not by time: `isStatic` (changes which fields the archive contains, so its inverse does not restore the world), list fields (first unbounded payloads in the op set), base-`zCVob` widening (item 1.8, and the `farClipScale` junk it would write back), and class-specific insertion (item 1.3, which is `AddVob`). Still the largest volume of work in this section. |
| 1.5 | **Numeric transform entry** | **landed** | **Position landed 2026-08-28**: the three coordinates are typed entry in `WorldPropertyGrid`, and a committed one leaves as a *delta* through the gizmo's own `onTranslateSelection` → `translateVobs` → `commitOps`, so there is one op-building path and not two — a multi-selection therefore moves by that delta and keeps its spacing, exactly as a drag does. Commit is blur or Enter, Escape reverts, and a value that is not a finite float32 (or is the number already there) is refused *before* an op exists and the field is remounted showing the world's own value — the refusal-counter idiom the class fields already had. **The rotation half landed too (2026-08-28).** `coords` gained `zenRotationToEuler` / `eulerToZenRotation` with the round-trip tolerance test the old wording asked for, and `WorldPropertyGrid` now has three angle fields on top of it. Unlike position, a committed angle leaves as an **absolute** pose (`rotateVob(..., eulerToZenRotation(typed), bounds)`), because an absolute angle is the thing the grid can now read off a VOB; the equality refusal below is therefore applied **per angle**, and it compares the typed number against the *displayed* rounded value as well as the exact decomposed one — `coordinate()` rounds to 2 dp, so a field reading "30" can be 30.000000000000004 underneath and retyping what is on screen would otherwise re-orthonormalize the matrix. `zenRotationToEuler`'s throw is caught and the row renders as unavailable rather than blanking the grid. **A multi-selection landed 2026-08-28** and is the one asymmetry: the fields describe the anchor VOB as always, but with N selected a committed angle leaves as a **delta** through the gizmo's own `onRotateSelection` → `rotateVobs`, so the selection turns together and keeps the relative orientation it had — the rule the position fields already have, and the one that keeps typing and dragging on one op-building path. The delta is `eulerDeltaRotation(displayed, typed)` (`zen-world/coords`), built from the two angle triples rather than from the anchor's stored matrix: a `R(to) * M^-1` would carry the anchor's own non-orthonormality into every other VOB of the selection. See §16.4. Four decisions came with it, all measured over the 41,393 VOBs of retail NewWorld/OldWorld/AddonWorld. **The convention is intrinsic Y-X-Z in degrees** (`R = Ry * Rx * Rz`, ZenGin axes) — chosen because nothing in ZenGin, ZenKit or this repo commits to an order, so the tie-break is the singularity: YXZ's is a VOB stood on its nose, XYZ's is on the vertical, and **464 retail VOBs sit within 1e-6 of the XYZ singularity against 53 of YXZ's**. **Spacer parity is therefore unverified and not claimed** — there is no artefact in the format or in ZenKit to check an order against, and settling it needs Spacer itself (type an angle, save, read the matrix back). **Gimbal lock** folds the roll into the yaw and returns roll 0; the matrix still round-trips, and there is deliberately no near-pole epsilon, because one of 1e-7 in sine space discards a recoverable roll and moves the VOB by 8.5e-4 of matrix entry. **Non-orthonormal input is normalized, not refused**: 12,514 VOBs (30.2 %) deviate by more than 1e-6, worst 2.1e-2, so refusing would take typed angles away from a third of the world — which means **reading and writing back an unchanged angle rewrites that VOB's matrix**, and the grid must only write an angle the user changed. A reflection or a rank-deficient matrix is refused; retail has 0 of each. **Tolerance is 1e-6 on a matrix entry**, a few float32 ulps (ulp near 1 is 5.96e-8); measured worst is 2.98e-8 across the retail corpus and 5.96e-8 over 200k random poses. |
| 1.6 | **Snapping** | **landed** | **Grid step and angle step landed 2026-08-28.** One "Snap" step on the World bar, following the gizmo mode — centimetres for a move, degrees for a turn, both remembered, both free-form by default so an unsnapped drag and `verify-world-edit.js` are unchanged. **Snapping is relative: the drag's *delta* is quantised, never the position or orientation it lands on** (`renderer/world/snapping.ts`), for the reason typed coordinates chose a delta — one gizmo drives a whole selection and an absolute snap would put the anchor on the grid and shift the rest by whatever that took. For the angle there was no choice at all: an absolute angle needs the matrix↔Euler conversion `zen-world` does not have (row 1.5), while the turn since the press is exactly what the op carries. Quantised **on the proxy** in `objectChange`, so the live preview, both commits, a waypoint's destination and the drag harness read one snapped number rather than each applying the step themselves. A drag the step quantises to nothing commits no op at all. **Drop-to-ground and align-to-normal landed 2026-08-28**, as the per-VOB answer the shared-delta commit path could not give: `zen-world`'s `dropVobsToGround`/`alignVobsToNormal` take per-VOB hits and batch to one `MoveVob`/`RotateVob` per VOB, one undo entry, exactly as `translateVobs`/`rotateVobs` do for a shared delta. Align turns local **+Y** onto the hit normal — the engine is Y-up, with no per-visual-class exception (the "which axis is up for this visual" question that keeps a placed VOB at `IDENTITY` is not reopened) — and composes on the left, so whatever rotation the VOB had about that axis survives. The raycast is `WorldViewportHandle.raycastDown`, synchronous against the existing BVH; a VOB whose ray misses (over the sky, off the mesh) is left where it was rather than refusing the batch. A *typed* coordinate still does not snap — a typed number is an explicit destination. |
| 1.7 | **Visual assignment**, as opposed to rename | unscheduled → 1b-2 | `setVobProp.visual` renames in place and refuses any VOB whose visual type is `UNKNOWN` — 15,749 of the 41,393 retail VOBs, 38.0 % (§7). Assigning a visual has to decide the object's class; decals (`.TGA`) are refused outright. **The extension × class table is reproducible as of 2026-08-30** — `zenkit-node/scripts/check-visual-types.js` re-measures it over the corpus and reproduces every figure §7 quotes, `.3DS` being the one ambiguous extension (`MULTI_RESOLUTION_MESH` ×20,716 against `MESH` ×31). That settles the measurement the row was missing; the feature stays a decision. |
| 1.8 | **The rest of `zCVob`** | **landed** (§7) | V1 landed 2026-08-28 — `SetVobProp` takes `presetName`, `visualCamAlign` and `bias`, bounded by the packed layout's bit fields rather than by their archive types. V2 landed the same day: `dynamicShadows` on the same two bits, and all seven fields of a decal visual, flat and prefixed. Two fields stay out and both by a fact rather than by time — `farClipScale`, because retail ships uninitialised junk in it (§7), and **`sleepMode`, because `VirtualObject` reads and writes it only under `is_save_game()`**, so a value set on a world archive never reaches the file. |

**Not a gap: scale.** `zCVob` has no scale field, so the two-mode gizmo is
correct and a third mode would author a representation ZenGin does not have.

### 14.2 Waynet

`MoveWaypoint`, `RenameWaypoint`, `AddWaypoint`, `SetWaypointEdge` and
`DeleteWaypoint` exist, and the third of them *is* freepoint authoring — every
waypoint it makes is a free point, because `WayNet::save` writes nothing else
that is in no edge. Of the verbs Spacer has, parity still wants only **waypoint
direction** — which the binding deliberately leaves alone.

The gizmo that produces a `MoveWaypoint` landed 2026-08-28 (§7), and the rename
(W1), the append (W2), the edge ops (W3) and the delete (W4) the same day — all
four in the waypoint panel rather than the viewport, since none of them is a
drag.

§7's op list already ends "… waynet edge ops", so this was *planned*. What it
did not carry is the actual work: **addressing**. `MoveWaypoint` addresses a
waypoint by its index into the list `getWaynet` emits, safe only because a move
inserts, deletes and reorders nothing — and W1, W2 and W3 all earned that same
address, because a rename, an append and an edge renumber nothing either. W4 was the
one op that renumbers, and it is answered by §15's barrier rather than by an
identity scheme: it clears the undo history instead of buying an address that
would survive it (§7).

### 14.3 World-level

| # | Missing | Status | Note |
|---|---|---|---|
| 3.1 | **ASCII / BINARY ZEN save** | measured, deferred (§5) | Not an oversight, and half-closed since. T8 found all 20 ASCII worlds aborting the process when their own re-save was loaded back; patches `0024`–`0026` fixed A1, A4 and A5, and all 20 now load, save and re-load (acceptance record §10.4). Patches `0045`–`0047` then closed A2 and A3, and a re-save now keeps each VObject's original packed/unpacked layout: OldCamp's container diff goes from `whole-file` to `event-aligned`, gap 0. They still classify `semantic-drift` — A6, `animMode`, and ASCII float text precision — and none has an engine verdict, so `saveWorld` stays BinSafe-only. BINARY has had no fidelity work at all, and a run on 2026-08-30 found it **cannot start on this machine: there is no BINARY `.zen` to measure**. Every `.zen` in the install was enumerated — `Worlds.vdf` + `Worlds_Addon.vdf` hold 8 unique worlds (4 BinSafe, 4 ASCII, and that is the whole corpus in `zenkit-node/worlds/`), the loose `_work/Data/Worlds` the queue's row 42 points at now holds 5 BinSafe Gate-2b candidates rather than the MDK extraction the 28-file C1 run of §10 measured, and the three `_work/Data/Presets/*.zen` are ASCII. So the 28-file corpus that sentence counts is gone with the extraction, and none of it was BINARY anyway — BINARY is what community exporters emit, which is a new external asset and outside what a run may fetch. Nor can one be made: `saveWorld` takes no format, it serializes with `handle->format` captured at load, so converting a retail world is a binding change. The one BINARY input that exists is `_authorFixtureWorld(p, 'binary', 'g2')`, and its round-trip is already clean — `identical`, deterministic, whole-file byte-identical — while reporting `struct-only`, because `lib/container.js` walks BinSafe and `container-ascii.js` ASCII and neither covers BINARY. That is the second half of the block: even with worlds, the classification table would read `struct-only` on every row, and the harness's own rule is that a struct-only row is never a fidelity pass. Closing 3.1's BINARY half therefore decomposes into three pieces that each want their own test run — a BINARY source (a `format` option on the writer, or an imported export), a `lib/container-binary.js` walker, and only then the fixture-backed defect patches — plus a scope call nobody has made: a world our own writer converted has no retail original, so it cannot be its own reference the way C1 requires. Only 4 of 28 retail `.zen` files are BinSafe, and Blender/KrxImpExp exports are not among them. |
| 3.2 | **Static light recompute** | warning planned (§11) | Spacer re-bakes vertex lighting; we do not, so moving geometry or a light leaves stale lightmaps. Phase 1b promises the warning. The bake stays out. |
| 3.3 | **Merge/import another ZEN, export a selection** | planned (Phase 3) | Spacer's part workflow depends on it. |
| 3.4 | **Portal / sector work** | planned (Phase 2) | Face selection, material assignment, leak detection. |
| 3.5 | **World properties** | measured 2026-08-30, exposure unscheduled | `oCWorld` settings, start position, sky and time control. Nothing exposed, and the measurement changes what "expose them" would mean. `worldProperties` (binding) and `scripts/check-world-properties.js` (readout) report the world level: the `oCWorld:zCWorld` wrapper — `%` / `oCWorld:zCWorld` v64513, binsafe, on all four retail worlds — and every member `zenkit::World` models beyond vobs/mesh/BSP/waynet. **Those are `skyController`, `player` and the four NPC-spawn fields, and all of them are save-game members: `null`/zero in all four.** So sky and time of day are not in a world file at all — exposing them is not plumbing a parsed field, it is authoring an object the format does not carry here, and that is a scope question, not a wiring one. The one world-level thing a `.zen` does carry is the **start position**, and it is not an `oCWorld` field either: NewWorld has both a `zCVobStartpoint` (`START_GOTHIC2`) and a `START` waypoint, DragonIsland only the VOB (`START_DRAGONISLAND`), OldWorld only the waypoint, and AddonWorld **neither** — so an editor exposing "the start position" has to answer which of the two it edits and what it does when there is none. `test/worldProperties.test.js` pins the binding against the golden fixture and the start-position summarizer against fakes; the corpus half needs `worlds/`. |
| 3.6 | **BSP / world-mesh compile** | out of scope (§11) | The Blender pipeline covers it. Restate it whenever "parity" comes up — the one thing Spacer does that we never will. |

### 14.4 Editor UX

- VOB search and find by name or class — the scene tree's header, answered
  against the interned dictionaries. *Landed 2026-08-28 (§7).*
- Per-class visibility filters, hide/show — Spacer's VOB-type toggles, on the
  filter's own predicate. *Landed 2026-08-28 (§7).*
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
closes takes its subsection with it — the commit is then the record. Numbers
are never reused, so a flushed subsection leaves its gap and old pointers stay
unambiguous. This is checked: `npm run board:check` (root, and CI) fails while
a subsection declares itself *closed* or *landed*, either on its heading or
opening its first paragraph. It cannot judge a subsection whose halves landed
separately — mark the heading when the last half lands.

### 16.2 The ops' engine verdict — Gate 2b ran, and it is half a verdict

**Gate 2b ran 2026-08-28** (Gothic2, six candidates; run sheet
`zenkit-node/docs/gate2b-run-sheet.md`, result in the acceptance record under
*"Gate 2b — the run"*). It closed the load-time half of this gap and left the
observational half open.

**Closed.** Every op that had no verdict — `DeleteVob` on a six-VOB subtree,
`AddWaypoint`, `RenameWaypoint`, `MoveWaypoint`, `RemoveWaypoint` with its
2,895-waypoint renumber, `SetWaypointEdge`, `SetVobClassProp` — plus
`SetVobProp`'s ten keys from V1/V2 (§7) and `AddVob` authoring 27 classes,
produces a world the engine **loads and plays**. `zCVobLight` and
`zCPFXController` were seen to *render* what the editor authored, which is the
first in-engine witness of `AddVob` building a class. The `oCItem.instance`
half was already closed by a check against the parser's item index.

**Closed too, by the second pass — `06-minimal-frame`, 2026-08-29.** Every row
of it passed: a red screen from an authored fog zone, a torch crackle carried
3,000 units by a written `radius`, and an authored `oCMobContainer` the player
opens by hand. **`SetVobClassProp` has its positive in-engine witness**, on
three classes and six properties, and `AddVob` has been seen to author five
classes the engine acts on. The sharpest gap in this section is shut.

Getting there cost four fixes to one row, and the first was a real defect —
`insertVob` wrote `showVisual: false` on every class I1–I5 added (§16.15). The
other three were the candidate's: a 10 cm bbox against an engine that culls by
box, a VOB standing at the spawn's Y over ground 50 units lower, and an empty
`focusName`, which is what the crosshair finds a mob by.

**Closed by the third pass — `07`, 2026-08-30.** `05`'s two observation rows,
each in a frame that showed it alone: the torch subtree *wholly* gone, and the
tower's routines running across the 2,895-waypoint renumber (acceptance
record, *"Gate 2b, third pass"*; the `07` paragraph below is how the
instrument got there). Every op the editor ships has now been seen doing its
work in the engine.

**What is still unwitnessed** — say this rather than "Gate 2b passed": the
seven decal fields are in no
candidate. **Nor is any of the eight enum writes** - Gate 2b proved
`SetVobClassProp` reaches the file and the engine plays it, but for *scalar*
fields, and `verify-world-pipeline.js` writes no enum either.
`zCVobLight.lightType` is the sharpest case: retail places SPOT nowhere (0 on
all 4,649 lights), so nothing in the corpus says what it looks like.
`oCZoneMusic.volume` is dropped by decision, below. And five of the
27 authorable classes have been seen in an engine.

**Why, and the candidate that answers it — `06-minimal-frame`, built
2026-08-28.** The instrument, not the ops: retail NewWorld masks every one of
those signals, and a candidate is only an A/B if the edit is the only thing in
the frame.

A minimal *world* was considered and is not reachable — the game boots NewWorld
through a script layer that spawns every NPC at `NW_*` waypoints, so replacing
the file breaks the scripts rather than the scenery. A minimal *frame* is the
same experiment and costs nothing: `tools/mutate.js` clears every
`zCVobLight`, `zCVobSound`, `zCVobSoundDaytime` and `zCPFXController` within
6,000 units of START and **every** `zCZoneZFog` in the world — measured at 239
VOBs and **zero** of any other class — and then authors the edits into the
cleared space. Three design calls worth keeping:

- **The fog zone is authored, not borrowed**, with its own 8,000-unit box centred
  on the spawn. So the row tests both ops at once and `SetVobClassProp` is the
  only thing that can make it red: a grey world is that op failing, with nothing
  else to blame.
- **The sound radius is tested as a binary, not a loudness.** The VOB sits 3,000
  units away with `radius` 8,000 in a frame with no other sound in it — audible
  at all only if the radius reached the file. Ears cannot rank two volumes and
  the first run proved it.
- **`oCZoneMusic.volume` is dropped rather than tested badly.** No candidate
  fixes the fact that a person cannot reliably judge one music volume against
  another in a live world; whatever witnesses it will not be an ear.
- **`oCMobFire` is deliberately not cleared** — a fire is an interactive mob a
  routine can name. Its light and sound children are separate VOBs and go
  without it, so the fires left in the frame glow and do not crackle.

Everything beyond the radius is untouched, so distant routines and mobsis still
behave and a failure still localizes. Run sheet §06;
`-Only 00,06` is the whole second pass, and `-Latest` runs the newest candidate
alone for a re-run where the control has already been seen.

**`07` was built 2026-08-29 and passed 2026-08-30.** Three candidates in
`06`'s shape, run sheet §07. **Played once the night before, and that pass was
void twice over**: the batch staged each world under its
own file name, and the engine spawns NPCs from `STARTUP_<worldfile>`, so there
were none (`environment-hazards.md`, *GMBT*); and the clearing took only the
lights, so 22 other torches' flames burned on around the one under test and
the verdict was "way darker, many torches visible". The `07c: ok` logged at 23:37
is a routine row observed on a world with no NPC. Both fixed the same night —
the script stages every candidate as `NEWWORLD.ZEN` and prints each
candidate's `<name>.txt` run sheet before and after the run; `07a`/`07b` take
the other 22 torches with them — and the rebuilt three passed the next morning:

- **`07a` and `07b` are an A/B of one difference.** Both clear every light,
  sound and effect within 6,000 units of START **except the torch subtree**,
  and every other wall torch of the same model in that radius as a subtree —
  22 of them, so the frame has one torch on its walls or none; `07b` then
  deletes the test torch with one `DeleteVob`. `00` cannot be the control for
  this row — in retail the torch is one of 23 and picking it out is the whole
  problem — so `07a` is, and the only difference between the two files is the
  op under test. `07a` also witnesses 22 subtree deletes of its own: a flame
  or a flare floating where a post was is a partial delete.
- **`07c` is the renumber alone.** `05` bundled it with a subtree delete and
  four other waynet ops; a broken routine there would have implicated six
  edits. Here nothing else in the file changes, which is asserted rather than
  claimed: the VOB count is unchanged at 23,288.

**Three things the build's own read-back assertions found, none of them the
ops' fault and all three able to have faked a result:**

- **A torch's flame is not a `zCPFXController`.** The five children of `2/1248`
  are two `zCVobLight`s and three plain `zCVob`s carrying `ZFLARE6.TGA`,
  `FIRE_MEDIUM.pfx` and `FIRE_SPARKS.pfx`. So the frame-clearer never takes a
  flame — which is also why `06`'s fires still burn — and what makes the test
  torch the only *lit* thing in the frame is its two lights, not its visual.
- **There are two identical wall torches on that wall**, `2/76` sitting 102
  units away in plan and **884 units below** — and 21 more of the same model
  inside the frame. An XZ-only proximity check counted ten pieces of torch
  where six were expected, and the same confusion was available to the eye,
  which is why the rebuilt candidates delete all 22 others.
- **A cleared VOB can have a child**: 230 paths take 231 VOBs with them, so a
  count that assumes one row per path is off by one. `06` never noticed because
  it only counted what was left, not what went.

**Daniel's idea, unowned and unsized: replace the scripts too, 2026-08-28.**
The paragraph above says a minimal world is unreachable *because of the script
layer* — so the other half of the move is to replace that layer with a minimal
one. A `GOTHIC.DAT` that spawns the hero at `START` and does nothing else would
make the game state as empty as the frame: no NPCs, no routines, no ambient
script sound, no intro, and a world where nothing but the edit under test is
happening. It also removes the two things Gate 2b's noise came from — the
control's dialog-camera crash is in `oCNpc::EV_PlaySound`, and there would be no
NPC to start a dialog.

What it costs, unmeasured: the suite has no Daedalus **compiler** — the parser
reads and generates source, and `.DAT` is the compiled VM image, so this needs an
external compiler in the loop and a script set that satisfies whatever the engine
calls unconditionally at startup. That is a research task, not an afternoon, and
it buys a better instrument rather than a shipped feature. Not carded; sized
first if anyone picks it up.

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
`zCTriggerList` turned out to have **no** eligible field at all once enums,
lists and `target` were excluded — `zCTriggerUntouch` is `target` alone, and
`zCTriggerList` is `mode` (enum) and `targets` (list). **The enum half of that
is over** — see the four classes below.

**The four classes the enums brought in landed 2026-08-30** (queue row 45),
which closes the state I3 and I4 both left behind: authorable with nothing
editable, because the field that configures the class *is* an enum.

- `zCTriggerList` — `mode` (`TriggerBatchMode`), plus the twelve it inherits
  from `VTrigger`, on the rule `zCMover` and `oCTriggerChangeLevel` already
  follow. `targets` and the target strings stay out.
- `zCMessageFilter` — `onTrigger` and `onUntrigger`, both
  `MessageFilterAction`, which is the whole class bar `target`.
- `zCCodeMaster` — the **one with no enum at all**: `ordered`,
  `firstFalseIsFailure` and `untriggeredCancels` were held out with the
  `slaves` list they steer and with `target`/`failureTarget`. Naming it beside
  the enums (as the card did) is the card's one inaccuracy.
- `oCTouchDamage` — all twelve fields, so **the class is complete**: nothing on
  `VTouchDamage` is a list, a cross-reference string or save-game-only. The
  three floats are floored at zero and given no maximum.

Swept over retail NewWorld/OldWorld/AddonWorld the same day, and every stored
value is inside its set: `zCTriggerList.mode` is ALL on all 44,
`oCTouchDamage.collision` is BOX on all 51, and the 26 message filters between
them use five of `MessageFilterAction`'s six values on each of their two fields
— everything but `NONE`, which is the widest spread of any enum in the corpus.
None of the four has a fixture VOB, so each test *places* one, the way the bed's
did. What is left authorable-with-nothing-catalogued is only what declares no
field at all: `zCVob`, `zCVobSpot`, `zCVobStartpoint`.

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
`0044` keeps them; the process lesson is in `environment-hazards.md`,
*"Building the native addon"*.) `zCMover` and `oCTriggerChangeLevel` both derive from `VTrigger` and
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
sound names. `behavior`, `lerpMode` and `speedMode` were enums and stayed out
with the rest of the catalogue's enums; `behavior` joined when the enums landed (§7) and the
other two did not, held out by `speed`'s rule below instead. `keyframes` is an
unbounded list. `speed` is
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
stayed out with the rest of the catalogue's enums until they landed (§7), which
makes this class's ten fields complete; nothing else on it is a list or
save-game-only. Appended to
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

Held out by decision rather than by time, and **enums were the whole of it until
§7 closed them on 2026-08-29**: eight of them — `zCVobLight.lightType` and
`.quality`, the sound family's `mode` and `volumeType`, `zCMover.behavior` and
`soundMaterial` on all nine `oCMob*` — are catalogued, writable and drawn as a
dropdown that offers without coercing. `zCMover.lerpMode`/`speedMode` are the
two that stayed out, and **not for the reason this paragraph gave**: they are
held out by `zCMover.speed`'s rule, the `keyframes`-emptiness silent drop. What
survives of the "legal writes the engine ignores" question is `randomDelay` /
`randomDelayVar`: the engine reads them only when `mode` is RANDOM, and the grid
commits one field at a time, so a delay written beside a mode change is still a
write with no effect.

Also out: `isStatic` and anything else changing *which* fields the archive
contains, list fields, and base-`zCVob` widening (§14.1 item 1.8). Alongside and
independent: class-specific *insertion* (item 1.3 — I1 landed 2026-08-28,
`oCItem` only, §16.15), and copy/paste (1.2). Numeric transform entry
(1.5) is landed, multi-selection rotation included (§16.4); snapping (1.6) is
fully landed (§14.1 1.6). All still before Phase 1c in §11.

### 16.4 Typed rotation — the multi-selection landed; what is left needs Spacer

The three fields are in and the quiet-corruption trap is handled per angle, so
the 30.2 % of retail VOBs that are non-orthonormal are not re-orthonormalized by
a commit nobody made. Two things stayed open on purpose. **The first is closed:
a multi-selection types into the same fields and landed 2026-08-28. The second —
whether these are the angles Spacer would show — still needs Spacer.**

**Absolute or delta for a multi-selection. Decided 2026-08-28: relative —
and landed 2026-08-28.**
A typed angle with N VOBs selected turns each VOB by that much from where it
is — `multiplyRotation(target, invert(current))` per VOB — rather than setting
them all to one pose. **The reason is consistency with the position fields,
which already commit a typed coordinate as a delta** so a multi-selection moves
together and keeps its spacing; a rotation that snapped N VOBs to one absolute
pose would be the odd one out, and it destroys their relative orientation with
no way back but undo. Single selection stays absolute
(`rotateVob(..., eulerToZenRotation(typed), bounds)`), because an absolute
angle is what the grid can read off one VOB — the asymmetry is the same one
position already has and is not a wart.

**The function already exists and the gizmo already uses it.** `rotateVobs`
(`zen-world/src/model/ops.ts:888`) takes a delta and applies it to a selection,
and its own doc settles the remaining semantic: **the delta is applied on the
left**, so the turn happens in world space after each VOB's own orientation and
a selection of differently-oriented VOBs all turn the same way on screen rather
than each about its own axes. The typed field must produce the same delta the
drag does, or the two paths disagree about what "turn 45°" means. So this
increment is a conversion — typed Euler angles to a `ZenRotation` delta — and a
call, not a new op or a new derivation, in the shape D1 turned out to have.

**What landed.** The three angle fields are no longer hidden for N VOBs: they
describe the anchor — the last VOB of the selection, the one every other row of
the grid already describes — and a commit means something different either side
of the count. One VOB gets `onRotate`, the absolute pose, unchanged. N get
`onRotateSelection`, which is `WorldSurface`'s existing `handleRotateSelection`
— the gizmo's own handler — so a typed turn and a dragged one are the same
batch, one undo entry, and there is no second op-building path beside
`rotateVobs`. The per-angle equality refusal is untouched and still applies, so
an angle the user did not change writes nothing for any VOB.

**The conversion is `eulerDeltaRotation(from, to)` in `zen-world/coords`, and it
takes two angle triples rather than the anchor's stored matrix.** That is the
one non-obvious part. A delta built as `R(to) * M^-1` from the anchor's stored
`M` would carry that VOB's own drift — 30.2 % of retail VOBs are non-orthonormal
by more than 1e-6 — and apply it to every *other* VOB in the selection, which is
the smearing the single-selection case avoids by staying absolute. Built from
the angles the read already showed, the delta is exactly a rotation, the
anchor's drift stays on the anchor (where `rotateVob` composes it straight back
in), and nothing but the turn the user asked for reaches the other N-1. `R(from)`
is orthonormal by construction, so the inverse is a transpose and there is no
matrix inversion to be ill-conditioned. It also builds the delta from the
*full-precision* decomposed angles, not from the rounded display — the anchor of
a skewed VOB decomposes to 30.000000x, and the delta is the turn from that.

The row is now gated on `euler === null` alone, so the read-only matrix and the
"no angles describe this matrix" note are about the anchor's pose rather than
about the size of the selection.

**Spacer parity is unmeasured.** Nothing in the format, in ZenKit or here
commits to an Euler order, so Y-X-Z was chosen on retail singularity counts
(464 VOBs on XYZ's against 53 on YXZ's), not on a match to Spacer. Settling it
needs Spacer itself — type an angle, save, read the matrix back. If it turns out
different, only those two functions and their tests change.

One thing users will see and may report as a bug: displayed angles are canonical
— yaw/roll in (−180, 180], pitch in [−90, 90] — so a field committed at 190°
remounts as −170°, and a pole pose remounts with roll 0. Both correct, both look
like the editor changing their number.

### 16.9 What is left of the ASCII writer — A6, and what `0048` left behind

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

**Float text precision — closed 2026-08-28 as patch `0048`.** ZenKit wrote every
ASCII float with `std::to_string`, i.e. `%f`: six decimals, always. That both
*pads* (`0` became `0.000000`) and *truncates*, because six decimals is fewer
significant digits than a float has at world magnitudes (`1511.77087` became
`1511.770874`) and none at all below 1e-6 (`2.98023224e-008` became
`0.000000`). ZenGin's form, measured across the retail ASCII worlds, is `%.9g`
with the three exponent digits its MSVC CRT always printed — the same shape of
fix as `0009` does for `zCMaterial`'s `texScale`, and byte fidelity only, since
nine significant digits is exactly what round-trips a float. `write_float`,
`write_vec3` and `write_raw_float` are the three text-float writers;
`write_vec2` and `write_bbox` go through the last of them.
`zenkit-node/test/asciiFloatFormat.test.js` is the regression. **OldCamp: 440
struct findings → 8, and the re-save 4,012,132 B → 3,979,084 B against a
3,979,132 B original** (it was 33 KB larger before).

**The two residuals `0048` left, both now visible because the floats stopped
drowning them.** OldCamp's remaining 8 findings are exactly these:

1. **Half-way rounding, 5 of the 8.** ZenGin's MSVC 6 CRT rounded an exact tie
   away from zero; the UCRT rounds half-to-even. So a coordinate whose decimal
   expansion terminates in `…5` at the tenth significant digit — common, because
   those are the exact binary fractions — comes back one ulp of *text* low:
   `-3055.89063` vs our `-3055.89062`, `-4509.32813` vs `-4509.32812`. The value
   is identical either way. A fix has to detect the tie itself (print the exact
   decimal expansion and look past digit nine), which is real code for the last
   5 findings in a world; not obviously worth it, and deliberately not attempted.
2. **`bool:` writes `1` where ZenGin writes `-1` for `locked` and `moveable`,
   3 of the 8, and it is `0017`'s missing other half.** ZenGin declares some
   `oCMOB` flags as *signed* one-bit bitfields, so a set flag reads back as −1;
   `0017` already special-cases exactly `locked`, `moveable` and `focusOverride`
   in `WriteArchiveBinsafe::write_bool` to write `0xFFFFFFFF`, and
   `WriteArchiveAscii::write_bool` was never given the same treatment. The
   retail ASCII worlds agree with the rule and nothing else does: 56 `=bool:-1`
   in 45,068 bool entries, and all 56 are `locked` (51) or `moveable` (5).
   Carded in the board; it is a three-line patch with `0017` as its template,
   and it inherits `0017`'s "ours forever" triage — keying the archive layer on
   entry names is the layering violation upstream should reject.

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

### 16.15 Class-specific insertion (§14.1 1.3)

**What the engine taught this card, 2026-08-29.** Gate 2b's second pass put an
authored `oCMobContainer` in front of the hero and it was visible, standing on
the ground, and **impossible to open**. Three of the four things that had to be
right were not, and none of them failed anywhere in the stack:

- **`showVisual` was written `false` on every class this card added** — the
  binding's `insertVob` decided the default per branch and set it only in the
  bare-`zCVob` case, so a chest, a door or a mover handed a real `.MDS` was
  authored invisible. An invisible world loads, so nothing complained. **Fixed**
  and covered by `mutations.test.js` — this was a real defect, and it had eaten
  the chest row of two engine passes.
- **`focusName` is what makes an authored mob usable at all.** The engine's
  crosshair finds a mob through it, and a mob with an empty one is placeable,
  visible and inert. Retail sets it per class rather than globally — 220 of 225
  `oCMobContainer`s say `MOBNAME_CHEST`, while 7 beds and 121 fires say nothing,
  because those are used by **NPC routines** and not by the player's hand. So it
  is deliberately **not** an `insertVob` default: there is no majority to take
  for `oCMobInter` (30+ values, the top one at 27 %) and `oCMobDoor`'s own
  majority is `MOBNAME_BED`, a retail copy-paste quirk. What is missing is on the
  editor's side — it will place a chest nobody can ever open and say nothing.
  **Closed 2026-08-29**, below.
- **The bbox default is a 10 cm cube and ZenGin culls by box.** Not observed to
  bite yet, but it is the next way that row would have been lost; the candidate
  now measures a box off a retail VOB with the same visual.

**The editor says it now, 2026-08-29, and what it says is measured.** The
warning sits under the `focusName` field in the world property grid, drawn from
`focusNameExpectation` in `zen-world`'s catalogue — the same table the grid, the
op builder and the IPC validator already read, rather than a second list.

Every `oCMob*` VOB in retail NewWorld and OldWorld, read through `getVobProps`:

| class | instances | with a focus name |
|---|---|---|
| `oCMobInter` | 538 | 94.1 % |
| `oCMobContainer` | 224 | 100 % |
| `oCMobDoor` | 224 | 96.9 % |
| `oCMobFire` | 134 | 9.7 % |
| `oCMobSwitch` | 27 | 77.8 % |
| `oCMobBed` | 7 | 0 % |
| `oCMobWheel` | 1 | 100 % |

Four classes are in the table and the rest are deliberately out. **Fires and
beds are the reason the warning is per class and not per family**: an empty name
on one is correct, and a warning on every one an author places is how a warning
stops being read. `oCMobWheel` (one instance) and `oCMobLadder` (none in either
world) are out for the opposite reason — one instance is not a majority, and
this table exists so the editor stops guessing.

Two smaller calls worth keeping. The warning **names a value to type**
(`MOBNAME_CHEST`), because "this is empty" is a complaint and the card asked for
guidance; and the example is not always the commonest string — 178 of the 224
doors say `MOBNAME_BED`, so teaching the majority would propagate the quirk.
Whitespace counts as empty, because the engine matches the string. It is **not**
a `Problem`: the Problems panel is built on a file, a dialog and a function, and
a VOB in a world has none of the three (§16.18).

Not a defect, recorded so it is not re-diagnosed: a VOB authored at an arbitrary
Y **floats**, because nothing snaps it. The editor's answer is the Drop-to-ground
command (`handleDropToGround`, `raycastDown`); `tools/mutate.js` had no raycast
at all and now walks the world mesh once for the one point it places.

`insertVob` authors a bare `zCVob`, so every class the property grid can now
*edit* is a class the editor cannot *create*. In practice that means class
editing only reaches VOBs retail already placed — you can change a
`zCTriggerScript` that exists and you cannot add one.

**The catalogue work makes this tractable, and that is new.** The increments
closed on 2026-08-27/28 — `zCVobAnimate`, `zCPFXController`, the trigger family,
`zCMover`, `oCMOB` and the `oCMob*` subclasses — already carry each class's
field definitions, defaults and bounds, with tests. The work here is an
authoring path that *consumes* that catalogue, not a second hand-written list of
fields per class. If it turns into the latter, the catalogue's shape is wrong
and that is the finding worth reporting.

**Split into increments 2026-08-28, after D2 hit the wall this card is.**
D2 assumed a duplicate could be authored and then have its class properties
written. It cannot: `InsertVob` hard-codes `vob->type = zCVob`
(`zenkit-node/src/binding.cc:1707`) and `SetVobClassProp` switches on the VOB's
real type, so its `default:` throws for a `zCVob`. **The class is the object's
C++ type, not a field the spec is missing** — which is why this card blocks D2
rather than sitting beside it.

**What the binding already proves, and what it costs.** `insertItemVob`
(`binding.cc:1863`) constructs a real `oCItem` — `make_shared<VItem>`,
`type = oCItem`, the visual left empty because the engine derives item visuals
from the script instance. It is **exported to JS and called from nowhere**: no
`zen-world` or editor code references it. So half of I1 is shipped and untested
in anger. The cost it also reveals: its comment says it mirrors the fixture's
`VItem` construction because **ZenKit structs have uninitialized fields**, so
every class needs its own construction that initializes every field. This is
not a type-tag switch, and an increment that treats it as one will author
garbage.

**I1 — `AddVob` can name a class, and `oCItem` is the first. Landed 2026-08-28**,
every layer in one change per `ReparentVob`'s rule: `NewVob` grew `class` and
`instance` (`zen-world/src/model/ops.ts`), `assertApplyOpsRequest` grew the
branch that checks them, `insertVob` dispatches on the class in C++, and the
*Place a VOB* dialog offers the choice. **`insertItemVob` is gone** — its `VItem`
construction moved behind the dispatch and its three tests now drive `insertVob`
with `class: 'oCItem'`, so there is one authoring path and not two. (The
acceptance record's T6 row names `insertItemVob`; it was the entry point the
Gate 2 candidate's `tools/mutate.js` used, and that tool now calls `insertVob`.)

**The class dispatch is a `switch` over constructions, deliberately, not a type
tag.** Each branch owns the fields ZenKit leaves to the struct's own defaults
plus the ones it does not initialize at all: an `oCItem` sets `instance`,
`s_amount` and `s_flags`, and takes `show_visual = true` because the engine
derives an item's visual from the script instance rather than from the file. The
base-class half — name, pose, box, the five flags, `physics_enabled = false` —
is shared and runs after. **One behaviour changed for an authored item**:
`physics_enabled` was left at ZenKit's `true` by `insertItemVob` and is now
`false` like every other authored VOB. Invisible in a saved world either way,
because the packed `zCVob` writer drops the field (A6, Deferred).

**The `instance` refusal is split across three layers, each as strong as it
can be**, and the split is the one the property grid already settled (see *"The
item instance stops being free text"*): the binding requires an `instance` for an
`oCItem` and refuses one on any other class; `assertApplyOpsRequest` checks the
class against the closed set, the same pairing, and that the instance is the
shape of a Daedalus symbol; and `WorldSurface` disables *Place* for a name the
loaded project does not declare — with an empty index meaning "nothing is
known", never "nothing is legal".

**An engine verdict for an authored `oCItem` covers the construction and not the
entry point.** Checklist row 10 of the acceptance record placed an item through
exactly these field assignments, so I1 changed which function assigns them
rather than what is written. Nothing in Gate 2 covers a *`zCVob`* authored with a
class named, because there was no such thing to author.

**I2 — `zCVobLight`, `zCVobSound` and `zCVobSoundDaytime`. Landed 2026-08-28**,
each a field-complete construction in the `InsertVob` dispatch, the sound's base
half shared by the derived class exactly as the catalogue's entry inherits it.
The catalogue was the field list and stayed one: nothing here restates a field
the grid already edits, and the construction only has to decide the fields the
catalogue *cannot* reach.

**The list of authorable classes is now written twice, not four times.**
`AUTHORABLE_VOB_CLASSES` in `zen-world/src/model/vobClasses.ts` is read by
`NewVob['class']`, by `assertApplyOpsRequest` and by the placement dialog's
`<option>`s, so the "added to two of the three and refused by the third" trap
I1 left is gone. What stays separate is `ParseNewVobClass` and the C++ dispatch
— the construction itself, which cannot be shared — and the per-class insertion
tests in `zenkit-node` are what tie the two lists together. (I5 found a
*third*: `NewVob['class']` in `zenkit-node/lib/index.d.ts` is its own hand-kept
union. Nothing shares it either, but the editor's `build:main` typechecks
`zen-world`'s union against it, so an omission is a compile error rather than a
refusal at runtime — which is how I5's was caught.) **Authorable and
editable are different sets and neither contains the other**: `zCVob` is
authorable with no catalogued field, and at I2 every mover, trigger and zone
was editable with no construction. I5 closed the zones; what is still
editable-only is `zCTriggerWorldStart`, `oCMOB` and `oCMobFire`.

**Every default is the retail majority, measured over NewWorld, OldWorld and
AddonWorld on 2026-08-28 — and ZenKit's struct defaults disagree on five
fields.** A light is `POINT` (all 4,649 retail lights; ZenKit says `SPOT`),
`LOW` quality (majority), `can_move = false` (all 1,111 dynamic lights; ZenKit
says `true`), range 400 (the median) and white. A sound is `LOOP` (1,077 of
1,237; ZenKit says `ONCE`) with `obstruction = false` (majority; ZenKit says
`true`), volume 100, radius 1500, and a daytime sound wakes at 6 and sleeps at
20 (the medians of 84).

**The two decisions worth re-reading are the enums and `is_static`, because both
are permanent.** The catalogue holds no enum field by design, so the `mode` a
placed sound gets is the one it keeps — and a sound that plays *once* is not
what placing an ambient sound means. `is_static` is out of the catalogue for a
harder reason (it decides which fields the archive contains, so its inverse does
not restore the world), and a *static* light is baked by the world's lighting
compile: one added to a compiled world lights nothing. So a placed light is
dynamic and on.

**No engine verdict covers any of this**, like every op since candidate `03` —
the round-trip is what proves the constructions leave no field indeterminate.

**Then the trigger family, then `oCMobInter` and friends**, now that I2 has
shown what one costs: a construction, one shared list entry, and a measurement
sweep per class over the retail worlds. What I2 did *not* need was a new
validator branch, a new op or a binding signature change.

**I3 — the trigger family. Landed 2026-08-28**, all seven classes, and it cost
exactly what I2 predicted: seven constructions in the `InsertVob` dispatch,
seven names in `AUTHORABLE_VOB_CLASSES`, and no new op, validator branch or
signature. Five derive from `VTrigger` and share `AuthorTriggerFields` — the
eight of its twelve fields retail agrees about across all 294 of these VOBs;
`zCCodeMaster` and `zCMessageFilter` derive straight from `zCVob` and share
nothing. **The other four `VTrigger` flags are set per class and not shared**,
because the family does not agree about them: a mover is fired at and never
touched (148 of 150), a plain trigger is touched by nearly everything, a script
trigger answers the player alone. One shared answer would have been wrong for
four of the five.

**Two of the seven names are not the names anyone says.** The archive — and so
`CLASS_FIELDS`, the dump and the binding — spells them `oCTriggerScript` and
`oCTriggerChangeLevel`, while the board card, this section and everyday speech
say `zCTrigger…`. The spoken forms stay refused, and both test suites keep
`zCTriggerScript` in their bad-class list for exactly that reason.

**A placed trigger fires at nothing, and that is the finding to carry forward.**
`target` and `vobTarget` are held out of the catalogue with the rest of the
family's cross-reference strings, so nothing in the editor can tell a placed
trigger where to send its `OnTrigger`. It is not a defect of the construction —
the same is true of every retail trigger the grid can already *edit* — but it
does mean placement alone does not yet produce a working trigger. Three of the
seven go further: `zCTriggerList`, `zCCodeMaster` and `zCMessageFilter` are
configured only by lists (`targets`, `slaves`) and enums (`mode`,
`onTrigger`/`onUntrigger`), and the catalogue holds neither, so a placed one has
**no editable field of its own at all**. Authorable-with-nothing-catalogued is
therefore a real state since I3, and `zen-world`'s invariant test now says so
rather than forbidding it. The one member that works unaided is `zCMover`: it
runs its visual's animation, needing neither a target nor keyframes.

**One default is chosen against its own measurement, and the round-trip test is
what found it.** A mover's `lerpMode` is authored `CURVE` — ZenKit's default —
where retail's majority is `LINEAR`, because `VMover::save` writes the field only
when `keyframes` is non-empty and this cannot author keyframes: a reloaded mover
comes back `CURVE` whatever was written, so the majority would have made the VOB
differ from itself across a save. The same instrument that proves no field is
left indeterminate is the only one that can see a field the writer drops.

**`zCMover.locked` is the sweep's other surprise**: false on every one of
retail's 150 movers against ZenKit's `true`, and unlike the sound and light
disagreements this one is catalogued, so it is also the user's to change.

**I4 — the movable objects, and the damage volume placed like one. Landed
2026-08-28**: `oCMobInter`, the four subclasses that add nothing to it
(`oCMobBed`, `oCMobLadder`, `oCMobSwitch`, `oCMobWheel`), `oCMobDoor`,
`oCMobContainer` and `oCTouchDamage`. Eight constructions, eight names in
`AUTHORABLE_VOB_CLASSES`, one retail sweep — and, exactly as I2 predicted and I3
confirmed, no new op, no validator branch and no binding signature change.

**This family agrees with itself, and that is what makes it cheaper than the
triggers.** Measured over its 1,424 VOBs in NewWorld, OldWorld and AddonWorld
(2026-08-28): `hp` is 10 and `damage` 0 on every single one, none is movable or
takable outside five switches, and none names a destroyed visual, an owner or a
guild. So `AuthorMovableObjectFields` and `AuthorInteractiveObjectFields` are
genuinely shared — there is no per-class flag to split out the way a trigger's
four had to be — and only the container decides anything of its own.

**The container is authored unlocked against retail's own majority** (199 of 294
chests are locked), and the reason is the same family as the mover's `lerpMode`
approached from the other end: every locked retail chest carries a `key` or a
`pickString`, both of which name script symbols the catalogue holds no
cross-reference for and this cannot author, so a locked placed chest would be a
container nothing in the game could ever open. `locked` *is* catalogued, so a
user who wants one has the switch.

**Four of the eight are a type tag and nothing else.** `VBed`, `VLadder`,
`VSwitch` and `VWheel` declare not one field beyond `VInteractiveObject`, so the
construction is the same one and only `make_shared` differs — but the object
still has to *be* that struct, because `SetVobClassProp` switches on the type.

**`oCTouchDamage` is the one class in the increment that works the moment it is
placed.** Retail's 51 agree about everything: 1000 damage, point damage alone,
a two-second tick, full volume scale and `BOX` collision. It is also the
family's name trap — ZenKit's *own documentation* calls it `zCTouchDamage`, the
archive calls it `oCTouchDamage`, and both suites now keep the spoken form in
their bad-class list beside `zCTriggerScript`.

**Two facts I4 leaves behind, neither carded.** First, `oCMOB` and `oCMobFire`
are catalogued and editable and are *not* authorable: they are not in the card's
list, and a fire is only ever a rigged model with a fire template on a named
bone, which nothing in the placement path can supply. Second, `oCMobBed` and
`oCTouchDamage` are the I3 state from the other side — placeable with no
editable field at all.

**The bed is editable since 2026-08-28**, and it cost exactly the two halves the
card named: `oCMobBed: OC_MOB_INTER_FIELDS` in `CLASS_FIELDS` and a
`case oCMobBed:` on the `oCMobInter`/`Ladder`/`Switch`/`Wheel` group in
`SetVobClassProp`'s switch. Nothing else moved — the property grid is entirely
catalogue-driven (no editor source names a single one of these fourteen keys),
`getVobProps` had listed the bed with its siblings since the reader landed, and
the op needed no new validator branch. Doing only the catalogue half would have
offered a grid the binding refuses, which is why the card insisted on both.

The bed had no fixture VOB to write to — the authored world's class-property
round-trip table runs `1/3`…`1/19` and holds no bed — so its three tests
*place* one with `insertVob` and write to that, which is also the only way a
user reaches a bed the editor made. **`oCTouchDamage` was the last
authorable-with-nothing-catalogued class in this family and is not one since
2026-08-30**: what configured a damage volume past its eleven catalogued-shaped
scalars was `collision`, an enum, and the catalogue held no enum until the enums landed (§7) —
so it was the enums, not an omission, and all twelve fields landed together
(§16.3). No class of this family is editable-only-in-name any more.

**A duplicate of a door is now a door**, which is the increment's one change to
behaviour nobody asked for: `duplicateVobSpec` carries the class of any class
the binding can construct, so the set it silently drops shrinks with every one
of these increments. What a copy still drops, and why, is in §7.

**`oCItem` was first and was also the awkward one.** Its `instance` is the
validation that cannot live in the main process at all: there is no semantic
model there — `ProjectIndex` carries npcs, dialogs, routines and voice ids but
no instances, `primedModels` is a take-once cache that deletes as it reads, and
`ParserService` is stateless. So it is a *shape* check in
`assertApplyOpsRequest` and an *existence* check in the renderer, which is the
only side holding the index. It cannot be a hard refusal either: a world may
legitimately be edited with no script project open, so an empty index means
"nothing is known", never "nothing is legal".

**I5 — the zones, the markers and the two effect classes. Landed 2026-08-28**,
and it closes §14.1 1.3: `oCZoneMusic`, `zCZoneZFog`, `zCZoneVobFarPlane`,
`zCVobStartpoint`, `zCVobSpot`, `zCVobAnimate` and `zCPFXController`. I2's shape
for the fifth time — seven constructions in the `InsertVob` dispatch, seven
names in `AUTHORABLE_VOB_CLASSES`, one retail sweep — and, as with I3 and I4, no
new op, no validator branch and no binding signature change.

**Five of the seven were the row's own example of the gap.** They had been
*editable* since the catalogue landed — `setVobClassProp` has a case for each —
and authorable by nothing, which is what "the property grid only reaches VOBs
retail already placed" meant in practice. `zen-world`'s separation test used
`zCVobAnimate` as its editable-not-authorable example and now uses
`zCTriggerWorldStart`, which with `oCMOB` and `oCMobFire` is all that is left of
that set.

**The two markers are the fourth kind of class this dispatch has met.** `VSpot`
and `VStartPoint` are `final` structs declaring not one field beyond `zCVob`, so
they are authorable-with-nothing-catalogued like `zCTriggerList` — but for the
opposite reason: not fields the catalogue refuses, but no fields to hold. A
second `zCVobStartpoint` is **not** refused, and that is a decision: retail has
one per world, nothing in the archive forbids a second, the engine picks one,
and a uniqueness rule invented in the binding would be a refusal no format asks
for.

**`oCZoneMusic` is the first class since `oCTouchDamage` that is complete the
moment it is placed**, and for a reason no other class has: the music theme it
plays *is the VOB's name*, which the placement dialog already supplies. There is
no cross-reference string held out of the catalogue here at all — unlike a
sound's `soundName`, a PFX controller's `pfxName` or a trigger's `target`.

**Two defaults are chosen rather than counted, and the fog zone is where this
family's measurement finally runs out.** Retail places eight `zCZoneZFog` and
two `zCZoneVobFarPlane` in all three worlds together, which is not enough for a
majority to mean anything:

- A fog zone's `rangeCenter` splits 4500×2, 6000×2, 8000, 16000×2, 20000 — three
  modes. 6000 is the lower median and one of them.
- `overrideColor` and `fadeOutSky` are *true* on five of the eight and are
  authored **false**. The two are perfectly correlated in retail and the five
  that override carry five *different* colours, so there is no majority colour
  to pair with a true — and a zone that tints the world a colour nobody chose is
  worse than one that uses the world's own fog and only shortens its range. Both
  are catalogued, so the switch is the user's. The colour is then the one all
  three non-overriding retail zones carry, and three of the four `…Default`
  fallbacks with them.
- A far-plane zone's `vobFarPlaneZ` is 3600 on one and 6500 on the other, and
  the larger is authored: the field *shortens* VOB draw distance, so one that
  pops scenery out closer than any retail zone does is the worse of the two ways
  to be wrong.

**The three `…Default` zone variants stay refused**, in the binding and in
`AUTHORABLE_VOB_CLASSES` both, and there is now a test saying so. A world's
fallback fog, far plane and music are one object each rather than a placed zone
— the same reason `CLASS_FIELDS` has never held an entry for one.

**Two constructions here would have authored from the stack.**
`VZoneFarPlane`'s two floats and `VParticleEffectController`'s two bools are
declared with no initializer at all, which is the sharpest instance yet of the
rule I1 wrote down. The round-trip test is what proves neither was forgotten:
the dump cannot see a field the writer drops, and the writer cannot be trusted
with a field the construction never set.

**A placed `zCPFXController` emits nothing and a placed `zCVobAnimate` may not
move**, both for the reason a placed trigger fires at nothing: the effect is a
`.PFX`/`.ZEN` name and the animation is a property of the *visual*. `pfxName` is
catalogued so the grid supplies it; the visual comes from the placement dialog.

**No engine verdict covers any of this**, like every op since candidate `03`.

### 16.18 Portals and sectors — the first two slices (§14.3 3.4, §11 Phase 2)

Portal/sector work is a **phase**, not a card: §11 puts it in Phase 2 behind its
own Gate 3 (each seeded error class detected pre-compile), and it decomposes
into static checks (pairing, orientation, accidental `P:` materials), then
geometric ones (planarity, intersections, leak flood-fill, triangle limits),
then spatial display, and only then face-material authoring. Two slices are
carded here; the rest stays a phase and is deliberately not on the board.

**What the payload already holds, checked 2026-08-28 rather than assumed.**
`normalizeWorld` sets `materials` (the mesh's material names, in the order
polygons index them) and `sectorNames` (from `bsp.sectors`, sorted — sector
order is referenced by index nowhere). Both are ordinary data on the world
summary — **`normalizeWorld`'s summary, which is the fidelity dump and not
anything the editor reads.** Corrected 2026-08-29 while triaging §16.20 slice 3:
the editor's `WorldSummary` carries `stats.materials` as a *count* and no sector
names at all, the dump costs 877–933 ms and was replaced at open by `vobIndex`,
and `getPortals` emits indices into these two lists without emitting the lists.
Feeding a name check needs a binding change.

**Slice 1 — the material-name checks — landed 2026-08-28** as
`checkPortalMaterials` in `zen-world/src/validate/`, a pure function over
`{ materials, sectorNames }` returning `portal-material-malformed` and
`portal-material-unknown-sector`. It has **no consumer yet**: the Problems
pipeline takes script rules over a semantic model, and how world data reaches it
is the same undecided question that blocks §7's waypoint rule. Nothing was
plumbed, deliberately.

What the retail measurement fixed, taken with the addon rather than assumed
(OldWorld 100 `P:` materials / 38 sectors, NewWorld 318 / 154, AddonWorld
154 / 74 — the sector count corrected 2026-08-29 by §16.22 q1, which recorded
154 here for both columns):

- **A one-sided name is legal, not half-written.** `P:OWCAVE01_` and
  `P:_OWCAVE01` are 44 of OldWorld's 100 — a portal whose other side is
  outdoors. Only *both* sides empty is malformed.
- **Exactly one underscore, and no sector name contains one**, in all three
  worlds — so a second separator is a malformed name, not a sector called
  `A_B`.
- **Case is uniformly uppercase on both sides**, so nothing measured says
  ZenGin pairs case-sensitively; the match is case-insensitive rather than
  claiming a finding the data cannot support.
- **All three worlds are clean** under the shipped function, which is the only
  reason a finding from it means anything.

Still unwritten because it is the *pairing* check and not a name check: a
`P:A_B` with no `P:B_A` beside it. Retail has both directions for every portal,
but whether a missing reverse is an error or a convention was not measured.

**Slice 2 — the polygon payload — landed 2026-08-28** as `getPortals(handle)`
in `normalize.cc`. `is_portal`, `is_sector` and `sector_index` used to reach the
payload only through `polyHash`, and `portal_polygon_indices` only through
`portalPolyHash`; a hash answers "did it change" and no portal check that needs
geometry — orientation first among them — can be written on that.

The readout is **columnar and one row per polygon carrying portal metadata**,
not one per polygon: a retail world mesh is ~200k polygons and a few hundred of
them are portal or sector faces, so a dense column would be a megabyte of zeroes
to say the same thing. It emits `polyCount`, `count`, and the buffers
`polygonIndices`, `materialIndices` (into `mesh.materials`, which is what joins
a portal face to its `P:A_B` name), `sectorIndices` (the on-disk i16 widened to
i32 and kept **signed** — -1 is "no sector" and unsigned would report a
valid-looking 65535), `portalKinds` (`is_portal` is a two-bit ZenGin value, not
a boolean), `sectorFlags`, and `bspPortalPolygons`.

Two things it deliberately does not do. **It is not plumbed** — no worker
message, no `zen-world` consumer — for the same reason slice 1 was not: how
world data reaches the Problems pipeline is still the undecided question at
§7. And **it carries no vertices and no plane**: a row's `polygonIndices`
entry is the join key into `_drillMesh`, which already emits the plane and the
corner indices per polygon, so planarity and orientation can be written without
touching C++ again.

The mesh-extraction fixture grew the portal metadata this is tested against —
two BSP sectors, a BSP portal list, and distinct `sector_index` values on the
portal and sector polygons. The checked-in golden world (`kMinimal`) is
untouched, so no fidelity claim moved.

**Do not widen either card.** Face-material *authoring* is explicitly gated on
validation proving out (§11), and the BSP compiler is out of scope for good —
the editor validates portal metadata and never recompiles a world.

**Where world findings surface is the open question these two slices leave.**
Both functions are correct, tested and have no consumer, and that is a real cost
rather than a tidy pause — `checkPortalMaterials` and `getPortals` are the second
and third things now waiting on a decision about world-shaped findings. The
Problems panel is **not** the answer (§7 says why: a portal finding has no
file, dialog or function, which is the panel's entire navigation model), so the
answer is a surface on the World side, and nobody has designed one. Until then
neither slice is plumbed, and a third portal check would only deepen the debt --
prefer designing the surface over adding checks.

---

### 16.19 The Daedalus overlay — the first slices (§11 Phase 1c)

Phase 1c is a **phase**, not a card. §11 gives it five deliverables — NPC/item
rendering from static spawns, a time slider, occupancy/gap/overlap checks,
cross-validation in the problems panel, and go-to-definition both directions —
and only some of that is reachable with the data the project actually has.
Four slices are carded here; the rest stays a phase and is deliberately not on
the board, for reasons named at the bottom.

**What already exists, read out of the code 2026-08-29 rather than assumed.**
§7's waypoint work landed more of 1c than its own section claims:

- `extractWaypointSites` in `src/main/utils/semanticMetadataUtils.ts` already
  visits **every** `Wld_InsertNpc` and `Wld_InsertItem` call site — both are in
  the measured `ENGINE_EXTERNAL_WAYPOINT_ARG_INDEX` table at argument 1 — and
  keeps the waypoint name. It rides the `MetadataWorkerPool` pass inside
  `buildProjectIndex`, so it is not subject to the renderer's
  `PARSED_FILES_CAP = 512`.
- `WaypointPanel.tsx` answers the world→script direction for a selected
  waypoint, and `waypointNotInWorld` is the one Problems rule of six that
  cross-checks script against world.

So the overlay is not starting from nothing. **The gap is that the index keeps
argument 1 and discards argument 0** — the NPC or item instance being spawned —
which is precisely the half a spawn needs and a routine does not.

**Slice 1 — the spawn index.** A `spawnSites` field on `ProjectIndex` carrying
instance, spawn point, file and line, built in the same worker-pool pass as
`waypointSites` and following the same pattern `voiceIds` established. It is
deliberately a second field rather than a widening of `waypointSites`: a spawn
is not a routine (§7 measured `Wld_InsertNpc` at 3,722 literal sites against
the daily routines' 6,223, and the two answer different questions about the same
waypoint). `InsertNpcAction.spawnPointIsExpression` already exists in the parser
and is the carrier for statically unresolvable sites — loops, `Hlp_Random`,
guild conditions — which are **marked dynamic and excluded, never guessed**
(§8, brief §5.1, a hard rule).

**Landed 2026-08-29.** `extractSpawnSites` in `semanticMetadataUtils.ts` rides
the same worker-pool pass as `extractWaypointSites` (both now read
`fileModelsForSiteIndexes`), and `ProjectIndex.spawnSites` is a flat
`SpawnSite[]` — instance, spawn point, file, function, 1-based line, both names
UPPERCASED — reaching the renderer as `projectStore.spawnSiteIndex`. Deliberately
flat rather than keyed: slice 2 groups by instance and slice 3 by spawn point,
so neither key is the natural one. A site is kept only when argument 0 is a bare
identifier *and* argument 1 is a string literal; the two spawn externals are read
from their own set, not from `ENGINE_EXTERNAL_WAYPOINT_ARG_INDEX`, because every
other entry there acts on `self` and would index a mover as a spawn. What it
still cannot tell apart is an instance name from a `var` holding one — that is a
symbol question, and the main process holds no semantic model of the project.

**Re-measured 2026-08-30, after the fix below: the index now sees 3,976 of the
3,978 spawn calls retail writes**, and the two it misses are `Externals.d`'s
`Wld_InsertNpc`/`Wld_InsertItem` prototype declarations, which the counting
script's regex cannot tell from a call. Nothing real is lost any more. The
denominator moved too — `countSpawnCalls` now strips comments before counting,
because retail comments out spawns in bulk (`Startup.d` alone carries 61 in line
comments) and a commented-out call was never one the index lost; the old 4,087
counted those. **The paragraph that follows is the pre-fix state, kept because
it is what the fix was measured against.**

**The index saw 71% of the spawn calls retail writes, measured 2026-08-29 by
q4's script and not known when slices 1–4 landed.** `DialogFunction.callSites`
carries only a function body's **top-level** calls, so a `Wld_InsertNpc` inside
an `if` body is not a call site at all and never reaches `extractSpawnSites`:
2,909 of the corpus's 4,087 spawn calls survive, and the 1,178 lost are whole
files, not a scatter — `B_Enter_NewWorld.d` (400 calls), `B_Enter_OldWorld.d`
(302), `B_Enter_AddonWorld.d` (137) and every `EVT_*.d` yield **zero** sites,
because a chapter-entry function is one `if` after another. Reproduced at one
line: `func void T() { Wld_InsertNpc(A,"WP1"); if (X == 1) { Wld_InsertNpc(B,
"WP2"); }; };` indexes A and not B. This qualifies all four slices — the
duplicate rule cannot see a relocation written in a chapter block, the panel
under-reports who spawns at a point, and the overlay under-draws — and it is a
parser-side fact (`linking-visitor.ts`, `processFunctionCall`), not an
`extractSpawnSites` one. Nobody owns it; it is written here rather than carded.

**Fixed 2026-08-29.** `shouldSkipChildren` still skips the subtree of an `if` or
a `return` — the action model and the round-trip fidelity that hangs off it are
untouched — but it now sweeps that subtree for `call_expression` nodes first and
records each one through a `recordCallSite` extracted from
`processFunctionCall`. Only the call record is taken: no action, no condition,
so a `ConditionalAction` is still the one thing built from the `if`. `calls`
follows `callSites`, so the orphaned-function rule and `questLogFiles`'
`B_CloseTopic` probe gain the same nested calls. Held by *"records call sites
nested in if/else bodies, not only a body's top-level calls"*
(`linking-visitor.test.js`, which is the one-line repro above grown an `else`
and a second nesting level) and, at the consumer, *"records a spawn written
inside a chapter block, not only a top-level one"* (`ProjectService.test.ts`).
The default-root corpus scan is unchanged against the same run before the fix —
143 drift files, 314 Tier-1, both pre-existing — and `--root
test/fixtures/corpus --strict` is clean. The re-measurement is the paragraph above: **3,976 of
3,978**, on the same `mdk/Content` corpus.

**Slice 2 — the duplicate-spawn rule.** §8 names "duplicate NPC IDs" as
cross-validation and nothing implements it. Over slice 1's index this is a
script-locus finding, so it has a `filePath` and fits the panel's navigation
model as it stands — which is what makes it the cross-validation slice worth
taking first, ahead of any finding whose locus is the world.

**Landed 2026-08-29** as `duplicateSpawnRule` in
`problems/domain/rules/duplicateSpawn.ts`, the seventh Problems rule, with
`ProjectView.spawnSites` and `ProjectView.dialogNpcKeys` as its two new inputs
(both threaded from the project index through `problemsStore`, the route
`waypointSites` established — the index sees every file, `parsedFiles` is
capped). One warning per site, keyed on file + function + instance + point.

**The one design decision it needed was measured, not assumed, and it is the
whole rule.** Unconditioned, "same NPC at two distinct points" fires 103 times
on retail Gothic II's 3,722 literal `Wld_InsertNpc` sites — counted on the
pre-fix index, like the 71% above, so the rule sees more sites today than the
run that shaped it did — and nearly every one
is a monster template — `Draconian` at 186 points, `ORCWARRIOR_ROAM` at 167,
`Wolf` at 49 — which is how the game is built, not a defect. Nothing in
`ProjectIndex` separates a character from a template by instance alone: monsters
are `C_NPC` instances too, so all 961 spawned instances are in `npcs`. **Dialog
is the discriminator the editor already holds**, and it takes the same corpus
from 103 findings to **4**: `BAU_4300_ADDON_CAVALORN`, `BAU_961_GAAN`,
`MIL_350_ADDON_MARTIN`, `SLD_805_CORD` — all four story relocations, all four
worth seeing. Note `dialogsByNpc` keys *every* C_NPC instance with an empty
array, so the array's length is the test, never the key's presence.

Two things this leaves for whoever wants them, neither carded: a modder's new
unique NPC with no dialog yet is invisible to the rule (accepted — the same
empty-index-means-nothing-is-known rule the world input follows), and **the same
NPC inserted twice at the *same* point is a different finding** that this rule
deliberately does not make — 598 retail site pairs do it on purpose (nine
blattcrawlers on one waypoint), so it needs its own discriminator, not this one.

**Slice 3 — the waypoint panel names who spawns there.** The panel lists
function name and file for every site naming the selected waypoint, and cannot
distinguish "three NPCs are inserted here" from "a routine passes through". With
slice 1 it can, and the panel is the surface that already exists.

**Landed 2026-08-29.** `WaypointPanel` takes a `spawns` prop — the flat
`spawnSiteIndex` scanned for `spawnPoint === name.toUpperCase()`, the same
uppercase key every other by-name waypoint lookup on the surface uses — and
lists the instance above *"spawned in <function> — <file>"*.

**The one thing it had to decide is that the two indexes overlap.**
`extractWaypointSites` visits `Wld_InsertNpc` and `Wld_InsertItem` as well, so
every spawn is already a row in the site list; shown in both, the new section
says nothing the old list was not already saying wrongly. So a spawn now cancels
one site row in its own file and function — a **count**, not a filter, because a
function may genuinely name the waypoint *and* spawn into it and that mention is
still worth listing. The site list is `world-waypoint-sites`; *"No script in
this project names it"* now requires both lists empty.

**Slice 4 — spawn markers in the viewport.** A marker layer at the resolved
world position of each static spawn: the first thing in 1c a person *sees*.
Scoped to markers on purpose — see below.

**Landed 2026-08-29.** `SpawnOverlay` in `src/renderer/world/`, built and torn
down beside `WaynetOverlay` under the scene's converted root, behind its own
*Spawns* toolbar toggle (`world-spawns-toggle`) — a second toggle rather than a
widening of the waynet's, because the waynet is the world's graph and the
markers are the script's opinion of it, and reading one against the other is the
comparison being made.

**Three things it had to decide.** It draws **one marker per point, not per
site**: nine NPCs on one waypoint are nine vertices in the same place, and who
they are is slice 3's answer in the panel. A spawn point the world has not got
is **dropped**, because an unresolved name drawn anyway is a marker at the world
origin — a spawn in the corner of the map, where the honest report is
`waypointNotInWorld`'s. And unlike the waynet overlay it **cannot draw the
payload buffer itself**: the markers are a subset, so it copies the positions
and keeps the waypoint each one stands on. That is why it has a `refresh()` and
why the viewport calls it beside the waynet's on every applied waynet op — a
committed waypoint move otherwise leaves the marker where the waypoint was, and
the two overlays disagree on screen with nothing to explain it.

The layer needs the waynet payload for its positions, so the toggle asks for it
when it is null — the case where the open's own read failed over a world that
stayed open. The spawn index reaching it empty stays "nothing is known": the
button is offered anyway, because a missing button cannot tell anybody the
difference between no project open and no spawn here.

**What is deliberately not carded, and why:**

- **NPC and item *visuals* are not reachable.** §11's "NPC/item rendering"
  reads as drawing the actual mesh, and the data for it does not exist:
  `ProjectIndex` carries `npcs` and `npcPrototypes` as **name strings only**, no
  instance bodies and no property values, so the `B_SetNpcVisual` chain that
  resolves an instance to a mesh has nothing to walk. Closing that means either
  a fifth extraction pass over instance bodies or a semantic model in main,
  which `CLAUDE.md` records the main process deliberately not having. Slice 4
  draws markers because a marker needs only the position slice 1 already yields.
- **The time slider needs the routine *windows*, not the routine names.**
  `ProjectIndex.routines` is the set of `dailyRoutine` name strings off NPC
  instances and feeds autocomplete; the `TA_*` windows §8 asks for are a
  different extraction that nothing does.
- **Occupancy, gap and overlap checks are world-locus findings** and used to hit
  the wall §7 and §16.18 stood behind. The wall is down on the type side —
  §16.20 slices 1 and 2 both landed, so the panel navigates a world locus too.
  What is left is not a wall but a specification: these stay uncarded because
  nobody has said what the rule should be, either way.
- **W4, script→world go-to-definition, was called large when it was sized** on the
  premise that nothing displayed a script-side waypoint name to click. That
  expired — `InsertNpcActionRenderer` displays one and §16.20 slice 2 built the
  navigation — and W4 landed 2026-08-29. See §7.

**Phase ordering note.** §11 schedules 1b-2 before 1c, and 1b-2 is not finished
— but what remains of it on the board (Euler order against Spacer) needs Spacer
itself and a person, as do the Gate 2b `07` rows. These slices were carded by
Daniel on 2026-08-29 with that ordering understood: they are the work an
unattended run *can* take while the 1b-2 remainder waits on hardware.

---

### 16.20 World findings get a locus, and a panel (§7 decision, 2026-08-29)

The decision is in §7; this is what it costs and what it frees.

**Why it was stuck.** `Problem` (`renderer/problems/domain/types.ts`) requires
`filePath` and carries `npc`, `dialogName`, `functionName` — the panel's entire
navigation model is "open this file and go to this declaration". A portal with a
malformed material name has no file, no dialog and no function. §7 recorded
the gap and left it open; §16.18 added two more behind it; §16.19 added a fourth
and argued that a fifth checker would only deepen the debt.

**What lands, in order — each slice is a card.**

1. **The locus union — LANDED 2026-08-29.** `Problem.locus` is the union below;
   the eight rule ids all emit `kind: 'script'`, `runRules` exports its
   comparator (`compareProblems`) and orders a world locus after every script
   problem of its severity, and `ProblemsPanel` returns early on a world locus
   because it has no file to open — slice 2's branch replaces that early return.
   Original text: `Problem.filePath` becomes
   `locus: { kind: 'script'; filePath; npc?; dialogName?; functionName? }
   | { kind: 'world'; waypoint?; vob?; polygon? }`. The eight existing rule ids
   all emit `kind: 'script'` and their behaviour does not change; the panel
   reads `locus.filePath` where it read `filePath`. This is a mechanical change
   across six rule files and their tests, and it is deliberately its own commit
   with **no new rule in it** — a type migration and a new check in one change
   is how a regression in the eight working rules would hide.
2. **World findings navigate — LANDED 2026-08-29.** The panel's click handler
   branches: a script locus opens the file as today, a world locus becomes a
   `WorldFocus` in `worldStore` and switches to the World view, which consumes
   it. A world finding while no world is open is shown and not clickable — the
   editor holds one world at a time and the finding may belong to another.
   What the shape of it turned out to be:
   - **The panel cannot call the viewport**, so the jump is a *request*, not a
     call: `worldStore.focusRequest` is set by the panel and consumed exactly
     once by `WorldSurface` (`focusHandled`), which is what makes two clicks on
     one finding two jumps — the second is asked for precisely after the camera
     has been flown away. A request left standing would fire again on the next
     unrelated waynet re-read.
   - **`worldFocusOf` is the one predicate**, and both halves read it: the list
     to disable a row, the panel to build the request. A locus it answers `null`
     for is listed and not clickable, which is the honest state for a polygon —
     framing one needs the mesh and is slice 3's, with the rule that emits it.
   - **A waypoint is not a VOB**, so the handle grew `framePoint(at)` beside
     `frameVob`: no row in the columnar index, no bounds, and `frameVobs`
     already reads `bounds: null` as "a point". The lookup is by name and
     case-insensitive (the name comes out of a script), and the jump switches
     the waynet overlay on — with it off the gizmo would stand where there is no
     dot to see, which is the objection `toggleWaynet` already answers in the
     other direction.
   - **No Playwright spec covers it, and cannot yet.** The browser harness has
     no world — `openWorld` is refused there by design — and no rule emits a
     world locus, so the flow has no reachable end to end. The seams are pinned
     in Jest instead (`ProblemsPanel.navigation`, `WorldSurface.editing`,
     `WorldViewport.frameHandle`). Slice 3 is what makes an E2E possible.
3. **`checkPortalMaterials` gets its consumer.** It has been built and tested
   against all three retail worlds since 2026-08-28 with nothing calling it
   (§16.18 slice 1). Its two findings are world-locus by polygon.

   **Triaged 2026-08-29: this is not one card, and the reason is that its input
   does not exist on the editor's side of the binding.** §16.18 recorded that
   "`normalizeWorld` sets `materials` and `sectorNames`… both are ordinary data
   on the world summary", and that is true of the *fidelity dump* and of nothing
   the editor reads. The editor's summary carries `stats.materials` — a **count**
   — and `WorldSummary` has no material names and no sector names at all. The
   worker's twelve ops (`open`…`close`) include no portal op. `getPortals`
   emits `materialIndices` and `sectorIndices`, i.e. **indices into two name
   lists it does not emit**, so it cannot feed a name check either. And
   `extractWorldMesh`'s chunks do carry a material `name`, but `mergeChunks`
   drops it by design (a `DrawGroup` is `Pick<MeshChunk, MergeKeyField>` plus
   geometry), and sector names have no non-`normalizeWorld` path in any case.
   The dump is not an option at open: it was measured at 877–933 ms on NewWorld
   and was replaced by `vobIndex` for exactly that reason.

   So the slice decomposes into parts that each want their own build and their
   own test run, in three workspaces:

   - **`zenkit-node`** — `getPortals` (or a new readout) gains the two name
     lists. A C++ change, so `build-zenkit.js` + `node-gyp rebuild` + the
     Smart App Control wait, and its suite is not in `all-tests.yml`.
   - **the editor's main process** — a thirteenth worker op, its
     `WorldWorkerRequest`/response shapes, `WorldService`, the IPC channel and
     preload, a `worldStore` field, and the `storeSync` re-scan trigger. That
     is the whole of the waynet card's plumbing again, and it earned its own
     card then.
   - **`problems/domain`** — two new `ProblemRuleId`s, the rule, `runRules`, and
     `ProjectView`'s new input.

   And one part is not just big but **unspecified**: slice 2 assigned polygon
   *framing* to this slice ("framing one needs the mesh"), and nothing says what
   framing a polygon means. The renderer holds merged draw groups with no
   polygon mapping, so it would be a `_drillMesh` window per finding or a new
   readout — a design decision, not an implementation of one. Without it the
   findings are listed and not clickable, which `worldFocusOf` already does
   correctly for a polygon locus; whether that is an acceptable slice 3 is a
   human's call, not a run's.

**What this does *not* unblock, and must not be smuggled in.** The portal
*pairing* check is still blocked on its own measurement — whether a missing
reverse `P:B_A` is an error or a convention was never measured (§16.18) — and
`getPortals`' geometric checks (orientation, planarity, leaks) are Phase 2 with
their own Gate 3. Occupancy and overlap checks become *possible* here and stay
uncarded: §16.19 lists them under Phase 1c and they want the spawn index they
now have plus a rule nobody has specified.

### 16.22 The measurement tranche (§11 Phase 2, decided 2026-08-29)

**Every remaining portal check is blocked on a number nobody has measured, not
on code.** §16.18 shipped the material checks *because* their rules came out of
counting retail (`P:` names and sector counts across all three worlds) and left
the pairing check unwritten for exactly the missing measurement: whether a
`P:A_B` without its `P:B_A` is an error or a convention. Planarity and
orientation are in the same position, and so is Phase 1c's occupancy check —
a threshold invented rather than measured would flag half of Khorinis as a
crowd.

This is how this project has settled every contested question: the scale gizmo
died on 41,393 measured transforms (§7), the Euler order was picked on retail
singularity counts (§16.4), the waypoint-externals table is closed *because* it
is measured (§7). The precedent for the instrument is `check-vob-bbox.js`
and `check-visual-winding.js` in `zenkit-node/scripts/`.

**The shape is one script per question, then one check per answer.** A
measurement card writes a script that reports against the three retail worlds
and records what it found *in this section*; the check card that follows takes
its threshold from that record. The two are separate cards deliberately — a
measurement that lands in the same commit as the rule it justifies cannot be
read as evidence for it.

The four questions:

1. **Portal pairing.** Does every `P:A_B` have a `P:B_A`? §16.18 believes retail
   has both directions but never counted. If it is 100%, the check is a warning;
   if retail itself has one-sided portals, it is not a check at all.
2. **Planarity.** The worst coplanarity deviation across retail portal polygons
   *is* the tolerance — anything tighter flags shipped geometry.
3. **Orientation.** Whether portal normals point consistently with respect to
   their two sectors, and if so in which direction. Both slices ride
   `getPortals`, which §16.20 slice 3 gives a consumer path.
4. **Waypoint occupancy.** How many NPCs retail spawns on one waypoint, over
   the spawn index §16.19 built. The distribution's tail is the threshold.

**A measurement is allowed to kill its own check.** If retail carries one-sided
portals, or spawns nine NPCs on a waypoint routinely, the honest outcome is to
write that down here and card nothing — the same outcome the scale gizmo got.

**q1 answered, 2026-08-29: retail is 100% paired.** `check-portal-pairing.js`
in `zenkit-node/scripts/` counts `P:` material names against their mirrors and
was run over all three G2 worlds:

| world | sectors | `P:` materials | two-way pairs | no mirror | malformed |
|---|---|---|---|---|---|
| OldWorld | 38 | 100 | 50 | 0 | 0 |
| NewWorld | 154 | 318 | 159 | 0 | 0 |
| AddonWorld | 74 | 154 | 77 | 0 | 0 |

572 names, 286 pairs, **not one unpaired name and not one repeat** — every
distinct name occurs exactly once, and the count is exactly twice the pair
count in each world. No symmetric `P:A_A` exists either, so a sector never
portals to itself. The one-sided names §16.18 measured pair the same way: the
mirror of `P:OWCAVE01_` is `P:_OWCAVE01`, and both are always there.

So the rule q1 asked for exists and the check is a **warning**, in
§16.18 slice 1's shape: a pure function over `mesh.materials`, mirror lookup
case-insensitive as `checkPortalMaterials` already is, malformed names counted
apart rather than reported unpaired (they have no mirror to look for). It rides
the same undecided consumer question as slice 1 — the check is writable, its
locus is not, and it is a card for a person to file, not for a run to invent.

**q2 answered, 2026-08-29: retail portal polygons sit up to 12.1 units off
their own plane, and the stored plane is `n·p = d`.** `check-portal-planarity.js`
in `zenkit-node/scripts/` (`test/portalPlanarity.test.js`, 8 cases) ran over
the three worlds the same day the corpus came back — not from a re-extract into
the install but from `scripts/extract-worlds.js`, which reads the `.ZEN`s out of
`Worlds.vdf` + `Worlds_Addon.vdf` through the binding's own VFS (`vfsRead`) and
leaves the install stock; the "binding cannot read a world out of an archive"
blocker this paragraph used to name is gone, and so is the one on q1's rerun,
the winding measurement and the bbox check.

| world | portal polygons | unjoined / flag mismatches | spread max | p99 | median | `\|n·p + d\|` closer |
|---|---|---|---|---|---|---|
| OldWorld | 400 | 0 / 0 | **12.10** | 1.33 | 3e-5 | 0 |
| NewWorld | 1,933 | 0 / 0 | 6.92 | 1.21 | 6e-6 | 0 |
| AddonWorld | 1,662 | 0 / 0 | 5.03 | 1.44 | 5e-6 | 0 |

The join held on all 3,995 polygons, every stored normal is unit-length, and
`|n·p − d|` is the closer form in 100% of them — so `plane_distance` is the
signed distance with the normal pointing *away* from the origin side, never
`n·p + d = 0`. 3,135 of the polygons are triangles, which are flat by
construction; the spread lives in the quads and up (OldWorld has 7-gons,
AddonWorld 12-gons), where 1% of retail is more than ~1.2–1.4 units off flat
and the worst shipped polygon is 12.1. **So the tolerance is ≥ 12.1 units** —
anything tighter flags OldWorld as shipped — and a check at that width catches
only a polygon folded outright, which is the honest thing it can do.

**q3 is unblocked and unrun.** It rides the same `getPortals` walk over the
same corpus; the sector-facing half — which of a portal's two sectors its
normal points into — is not what the planarity script measures, and it is a
card for a person to file.

What the script does, so the next run does not re-derive it. Two numbers per
portal polygon: **spread**, `max(n·p) - min(n·p)` over the corners with the
stored plane normal — how far from flat the polygon is, independent of how
`plane_distance` is signed, and therefore the number a coplanarity tolerance
comes from; and **`|n·p - d|`**, whether the *stored* plane is the polygon's
own, reported beside its mirror `|n·p + d|` so the sign convention is read off
the corpus rather than assumed.

**The join was the work, and it is verified rather than trusted.** No binding
call carries both a portal polygon's identity and its vertex positions:
`getPortals` names the polygon by mesh index, `_drillMesh` adds its plane,
material and corner count, and the only positions the binding exposes are
`extractWorldMesh`'s — per material, fan-triangulated, in mesh order, with
vertices keyed on the (vertex, feature) pair. So the walk counts triangles per
material to find where a polygon's fan starts, reads its corners back off that
fan (corner 0 and 1 from the first triangle, every later corner as the third
vertex of its own triangle), and reproduces ExtractMesh's own two skips exactly
— a polygon under three corners, and one naming a material the mesh does not
declare — because a skip that advances the cursor desynchronises everything
after it. Every triangle it lands on must carry the polygon's own packed flag
word; a mismatch is counted and the run says the numbers are not evidence. The
mesh-extraction fixture pins the arithmetic end to end (polygon 1 is the portal
triangle over vertices 1, 2 and 4). **This needed no C++**, as §16.20 slice 2
predicted.

**A number in §16.18 was wrong and is corrected here and there:** AddonWorld has
**74** sectors, not 154. 154 is its `P:` material count, copied one column
across on 2026-08-28. Nothing was built on it — `checkPortalMaterials` reads the
list, never its length.

**q4 answered, 2026-08-29: there is no threshold, because the distribution has
a cliff and not a tail — and the check dies on it.**
`check-spawn-occupancy.js` in `daedalus-dialog-editor/scripts/` runs the
editor's own index pass over a script tree (`extractFileMetadataFromSource` per
file, then `extractSpawnSites`) and counts two numbers per spawn point: how many
sites name it, and how many *distinct* instances those sites carry. NPCs are
told from items by `ProjectService`'s own test — a prototype chain reaching
`C_NPC` — because `SpawnSite` keeps no class and both externals feed it. **Re-run
2026-08-30 on the fixed parser (row 40), which is the table below**; the shape
did not change, only the counts. Over `mdk/Content`, 1,725 `.d` files: 3,976
spawn sites on 2,098 points, of which **3,629 NPC sites on 1,816 points**.

| distinct NPCs on one point | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 9 | 12 | 17 | 21 | 22 | 26 | 49 | 70 | 100 | 175 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| points | 1475 | 263 | 38 | 18 | 6 | 3 | 1 | 2 | 1 | 1 | 2 | 1 | 1 | 1 | 1 | 1 | 1 |

**1,794 of 1,816 points hold four NPCs or fewer, and the other 22 are the
game's own design.** Everything from 5 up is a named group: `ADW_ENTRANCE` and
`FARM2` at 9, `NW_FARM1_OUT_01` at 7, `DI_UNDEADDRAGONTEMPEL_01`, `MAYA` and
`REICH` at 6, mine and bandit camps at 5 — and above them the mass-relocation
points, `NW_TROLLAREA_RITUALPATH_01` at 12, `SHIP_DECK_01` at 17, `CITY1` and
`STRAND` at 21, `ADDON_GOLDMINE` at 22, `NW_MONASTERY_ENTRY_01` at 26,
`BANDIT` at 49, `BIGFARM` at 70, `OC1` at 100 and **`NW_CITY_ENTRANCE_01` at
175**. So a threshold anywhere between 5 and 175 flags only points retail put
there on purpose, and there is no gap in between to put it in. That is the
outcome §16.22 allows: **the occupancy check is not writable from a count**, and
this run cards nothing.

**A second number that would have been the wrong one.** Sites per point is not
occupancy: 1,124 points carry one site but 1,475 carry one distinct instance, so
**351 points get the same NPC written more than once** — the chapter-re-entry
pattern §16.19 slice 2 met as 598 site pairs. Only the distinct-instance column
could ever have been a crowd, and it is the one tabled above.

**They were floors on the first run and they are counts now.** The 2026-08-29
numbers missed every spawn nested in an `if` body — 1,178 of the corpus's 4,087
spawn calls, whole chapter-entry files at a time; the nested-call-sites fix
closed that, and the re-run above sees 3,976 of 3,978. The script still reports
its own coverage, which is how the difference was read off. The measurement is
recorded at §16.19, where the index it qualifies is described.

**The corpus is `mdk/Content`, which is not retail-equivalent** — it carries an
extra `BAU_902_Gunnar_2.d` and is missing at least one dialog
(`environment-hazards.md`). Its 3,722 literal `Wld_InsertNpc` calls match the
number §7 and §16.19 measured, so it is the same corpus those used; it is
not the shipped `.DAT`.

### 16.24 World-surface feedback from the first real sessions (2026-08-30)

Daniel's, from using the surface rather than from a review. Three, and the
third is a defect with a diagnosis; the first two are decisions being revisited
and each contradicts something the tree deliberately does.

**1. A selection is invisible unless the gizmo is.** The only VOB emphasis
that exists is `WorldScene`'s silhouette darkening, and its own doc says it is
*"deliberately faint and never a selection state — selection is the gizmo"*.
That was the right call for legibility and is the wrong one for selection: a
VOB whose gizmo is off-screen, or one of several selected, reads as unselected.
Wanted: an outline or another visible effect on the selected VOBs themselves.
The constraint that shaped the darkening still holds — an outline *pass* is a
second `InstancedMesh` per visual, 724 more draw calls (§3, render-performance)
— so the cheap form is the same one: a per-instance attribute the VOB shader
already carries, switched on for the selection, exactly as `HIDDEN_ATTRIBUTE`
is written today.

**2. The multi-selection gizmo sits on the last VOB picked, not in the middle.**
`WorldScene.anchorOf` walks the selection backwards and takes the first VOB
that is drawn; `worldStore.toggleVob` appends for that reason. Wanted: the
centre of the selected items. **The trap is rotation.** `rotateVobs` turns each
VOB about *its own* origin, deliberately (§16.4 and its own doc: turning about
a pivot moves the VOBs as well, which is a different feature) — so a gizmo
standing at the centroid would show a pivot the op does not use, and the first
multi-VOB rotate would look broken. Either the anchor moves for translate only,
or rotate-about-pivot lands with it. Decide that before writing the anchor.

**3. A VOB can be picked through the world mesh.** Reported on a Khorinis
tower: click the wall and a VOB behind it is selected. **The pick pass draws
only the VOB proxies** — `VobPicker`'s scene holds the instanced proxies and
nothing else, so no world geometry ever writes depth into the 1×1 pick target
and occlusion cannot happen. The fix is to draw the world mesh into that scene
as a depth-only occluder (`colorWrite: false`, or black, which the pass already
reads as "nothing was hit"); it costs one more draw into a one-pixel view
offset. Watch the two knowns while there: the pass ignores alpha-tested
cut-outs (documented in `VobPicker`), and `HIDDEN_ATTRIBUTE` must keep meaning
"not clickable" — a hidden VOB behind a wall must not become pickable, and a
*hidden* world mesh must not occlude.

**4. Paste lands the copy inside the original, and leaves it unselected.**
`duplicateVobSpec` copies the position verbatim, so a pasted VOB is exactly
where its source is — invisible, and only findable in the scene tree. Nothing
selects the new VOBs either: `pasteClipboard` commits the ops and the selection
still holds the *source*. Wanted: the copy offset a little from the original
and selected, so it can be dragged straight away. The "jerking" reported with
it is the structural-op re-read — a paste is `isStructuralOp`, so the whole
projection is rebuilt — which is a separate and larger question from where the
copy lands.

**5. After a paste, the locator stops working on every VOB.** Reported
2026-08-30. Not diagnosed to a root cause — what is established is the path and
why it fails *silently*: the scene tree's locator is
`onFocus(vob)` → `WorldSurface.focusVob` → `viewportRef.current?.frameVob(vob)`
→ `frameVobRef.current?.(vob)`, and **every link is optional-chained**, so a
null anywhere is a no-op with no error, which is exactly the reported symptom.
`frameVobRef.current` is installed by the scene effect
(`WorldViewport.tsx:854`) and set to null by its teardown (`:1076`); the effect
is keyed on `[mesh, visuals, bbox]` — the three payloads a **structural op
re-reads**, and a paste is `isStructuralOp`. Its first statement is
`if (!host) return;` with **no cleanup returned**, so a re-run that finds no
host leaves the ref null for the rest of the world's life. First probe:
assert `frameVobRef.current` is non-null after a structural re-read; the
double-click on a row and the `.` key go through `frameThese` too, so check
whether they also died — that separates "the ref is null" from "the handle is
stale".
Whatever the cause, the optional chaining is the reason nobody saw it: a
locator that cannot locate should say so, not do nothing.

**6. The right sidebar needs a locator for the current selection.** Picking in
the viewport leaves no way back to it — the tree's locator is per row, and a
VOB selected by clicking the world may not even be scrolled into view there.
The keyboard already does it (`.` or Numpad-`.` → `frameSelection`, and `Home`
frames the world), so this is the same command with a button on it, in the
property grid's header, calling `focusVob(primaryVob(selection))`. It also
gives item 5 a second surface to fail on, which is worth having.
