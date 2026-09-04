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
| 1.2 | **Copy / paste / duplicate**, incl. subtree | **done, less `physicsEnabled`** (§7) | The most-used Spacer verb after move. D1 (duplicate one VOB in place), D4 (a selection as one batch, one undo) and D3 (copy and paste as verbs) all landed 2026-08-28, as ordinary `AddVob`s with no new op. D2's class half landed 2026-08-28 on top of I1/I2 — a copy carries its **class** for the classes `insertVob` can construct, and drops it for the rest (and for `oCItem`, whose instance is not in the index) rather than have the op refused. D5 (the subtree) landed 2026-08-28 as N appends in one batch. **D2's other half landed 2026-08-30** (unattended queue row 46): a copy carries the class *properties* too, as one `SetVobClassProp` per copy in the same batch — the surface fetches them with `getVobProps` (only for VOBs whose class has catalogued fields), `duplicateVobSubtree` puts them on the clipboard, and `commitOps` takes them beside the adds because an append moves no index path. Two rules the copy inherits from the dropped class: a copy that has no class carries no class fields, and a value outside its catalogue bounds is dropped rather than refused, because the IPC assertion would cost the whole copy for one field. What is left is `physicsEnabled`; a cross-world clipboard only if part-to-part copying is wanted. One consequence to know: **Ctrl+C is now asynchronous**, so a paste issued inside the fetch pastes the clipboard as it was. |
| 1.3 | **Class-specific insertion** | **landed** (§16.15) | I1–I5 landed 2026-08-28 and Gate 2b saw `AddVob` author 27 classes; `focusName`'s measured warning followed 2026-08-29. This row used to read "`insertVob` authors `zCVob` and nothing else" and named the list that §16.15 then worked through: `oCItem`, `zCVobLight`, `zCVobSound`/`Daytime`, the trigger family (`zCTrigger`, `zCTriggerList`, `zCTriggerScript`, `zCMover`, `zCCodeMaster`, `zCMessageFilter`, `zCTriggerChangeLevel`), `oCMobInter`/`Container`/`Door`/`Bed`/`Ladder`/`Switch`/`Wheel`, `oCTouchDamage`, `zCPFXController`, the zones (`oCZoneMusic`, `zCZoneZFog`, `zCZoneVobFarPlane`), `zCVobStartpoint`/`zCVobSpot`, `zCVobAnimate`. |
| 1.4 | **Class-specific property editing** | **partial** (§7) | Seven classes so far. Increment 2 (2026-08-28) added the sound family and the zones — `zCVobSound`, `zCVobSoundDaytime` (which inherits the base four), `zCZoneVobFarPlane`, `zCZoneZFog`, `oCZoneMusic` — with no change to the validator, the op builder or the grid, which is increment 1's catalogue claim holding. What it exposed is that the value kinds, not the classes, were the limit — and increment 3 (2026-08-28) answered it with a `bool` kind and an `int` kind, which took the nine fields those five classes were holding back: the three sound booleans, the two fog booleans, and `oCZoneMusic`'s `enabled`/`ellipsoid`/`loop` plus its `int32` `priority`. `oCZoneMusic` and `zCZoneZFog` are complete — the enums that were the last of it landed 2026-08-29 as eight keys over thirteen classes, a fourth table (`CLASS_ENUM_FIELDS`) the validator reads generically so no per-key list can drift, and a field that offers the known values without coercing to them: an unrecognised value is kept, shown as such, and committed by nothing. No engine has seen any of the eight written (§16.2). **Increment 3's one open question closed 2026-09-02 (Daniel)**: `zCZoneZFog.color` is now disabled, with the reason as its helper, while `overrideColor` is false — the grid's first and only cross-field rule (`disabledFor` in `WorldPropertyGrid.tsx`, deliberately not generalised into the catalogue for one field). `randomDelay` beside a non-RANDOM `mode` keeps the same shape and stays enabled, because there the two are separate commits on one VOB rather than a switch drawn one row up. **`oCItem.instance` is no longer free text** (2026-08-28): the grid refuses a name the loaded project's item index does not declare and the IPC validator refuses a `to.instance` that is not a Daedalus symbol — see "The item instance stops being free text" in §7 for why the enforcement is split and why the main process cannot hold the index. Increment 1 (2026-08-28) landed `oCItem.instance` and `zCVobLight`'s `range` and `color` — 23.4 % of the 41,393 retail VOBs, and the three value kinds (cp1252 string, bounded float, fixed-arity integer array) the machinery needed. The whole path exists now — `getVobProps` exporting the reader `normalizeWorld` already had, the `SetVobClassProp` op, the `CLASS_FIELDS` catalogue every layer reads, the validator branch, the grid section — so each further class is one C++ case plus one catalogue entry plus its tests. Out by decision, not by time: `isStatic` (changes which fields the archive contains, so its inverse does not restore the world), list fields (first unbounded payloads in the op set — **narrowed 2026-09-03**: `oCMobContainer.contents` is in, because the archive holds it as one string and the validator bounds that string at 4 KB, so it is a `string` field with a grammar rather than a list payload; `keyframes` and any field the archive stores as a counted list stay out), base-`zCVob` widening (item 1.8, and the `farClipScale` junk it would write back), and class-specific insertion (item 1.3, which is `AddVob`). Still the largest volume of work in this section. |
| 1.5 | **Numeric transform entry** | **landed** | **Position landed 2026-08-28**: the three coordinates are typed entry in `WorldPropertyGrid`, and a committed one leaves as a *delta* through the gizmo's own `onTranslateSelection` → `translateVobs` → `commitOps`, so there is one op-building path and not two — a multi-selection therefore moves by that delta and keeps its spacing, exactly as a drag does. Commit is blur or Enter, Escape reverts, and a value that is not a finite float32 (or is the number already there) is refused *before* an op exists and the field is remounted showing the world's own value — the refusal-counter idiom the class fields already had. **The rotation half landed too (2026-08-28).** `coords` gained `zenRotationToEuler` / `eulerToZenRotation` with the round-trip tolerance test the old wording asked for, and `WorldPropertyGrid` now has three angle fields on top of it. Unlike position, a committed angle leaves as an **absolute** pose (`rotateVob(..., eulerToZenRotation(typed), bounds)`), because an absolute angle is the thing the grid can now read off a VOB; the equality refusal below is therefore applied **per angle**, and it compares the typed number against the *displayed* rounded value as well as the exact decomposed one — `coordinate()` rounds to 2 dp, so a field reading "30" can be 30.000000000000004 underneath and retyping what is on screen would otherwise re-orthonormalize the matrix. `zenRotationToEuler`'s throw is caught and the row renders as unavailable rather than blanking the grid. **A multi-selection landed 2026-08-28** and is the one asymmetry: the fields describe the anchor VOB as always, but with N selected a committed angle leaves as a **delta** through the gizmo's own `onRotateSelection` → `rotateVobs`, so the selection turns together and keeps the relative orientation it had — the rule the position fields already have, and the one that keeps typing and dragging on one op-building path. The delta is `eulerDeltaRotation(displayed, typed)` (`zen-world/coords`), built from the two angle triples rather than from the anchor's stored matrix: a `R(to) * M^-1` would carry the anchor's own non-orthonormality into every other VOB of the selection. See §16.4. Four decisions came with it, all measured over the 41,393 VOBs of retail NewWorld/OldWorld/AddonWorld. **The convention is the engine's own since 2026-09-02** — `zMAT4::GetEulerAngles` / `SetByEulerAngles`, `R = Rx(−x) · Ry(−y) · Rz(−z)`, intrinsic X-Y-Z with the vertical as the middle axis, in degrees (§16.4). It shipped first as Y-X-Z, chosen because nothing in the format or ZenKit commits to an order and YXZ's singularity (a VOB on its nose, 53 retail VOBs) was rarer than XYZ's (a quarter turn about the vertical, 464); it was switched once it was clear no Spacer shows an angle triple and the engine's formula is the one thing a witness can check. **Gimbal lock** is the engine's: at yaw ±90 the roll is folded into the pitch and roll reads 0; the matrix still round-trips, and there is deliberately no near-pole epsilon, because one of 1e-7 in sine space discards a recoverable roll and moves the VOB by 8.5e-4 of matrix entry. **Non-orthonormal input is normalized, not refused**: 12,514 VOBs (30.2 %) deviate by more than 1e-6, worst 2.1e-2, so refusing would take typed angles away from a third of the world — which means **reading and writing back an unchanged angle rewrites that VOB's matrix**, and the grid must only write an angle the user changed. A reflection or a rank-deficient matrix is refused; retail has 0 of each. **Tolerance is 1e-6 on a matrix entry**, a few float32 ulps (ulp near 1 is 5.96e-8); measured worst is 2.98e-8 across the retail corpus and 5.96e-8 over 200k random poses. |
| 1.6 | **Snapping** | **landed** | **Grid step and angle step landed 2026-08-28.** One "Snap" step on the World bar, following the gizmo mode — centimetres for a move, degrees for a turn, both remembered, both free-form by default so an unsnapped drag and `verify-world-edit.js` are unchanged. **Snapping is relative: the drag's *delta* is quantised, never the position or orientation it lands on** (`renderer/world/snapping.ts`), for the reason typed coordinates chose a delta — one gizmo drives a whole selection and an absolute snap would put the anchor on the grid and shift the rest by whatever that took. For the angle there was no choice at all: an absolute angle needs the matrix↔Euler conversion `zen-world` does not have (row 1.5), while the turn since the press is exactly what the op carries. Quantised **on the proxy** in `objectChange`, so the live preview, both commits, a waypoint's destination and the drag harness read one snapped number rather than each applying the step themselves. A drag the step quantises to nothing commits no op at all. **Drop-to-ground and align-to-normal landed 2026-08-28**, as the per-VOB answer the shared-delta commit path could not give: `zen-world`'s `dropVobsToGround`/`alignVobsToNormal` take per-VOB hits and batch to one `MoveVob`/`RotateVob` per VOB, one undo entry, exactly as `translateVobs`/`rotateVobs` do for a shared delta. Align turns local **+Y** onto the hit normal — the engine is Y-up, with no per-visual-class exception (the "which axis is up for this visual" question that keeps a placed VOB at `IDENTITY` is not reopened) — and composes on the left, so whatever rotation the VOB had about that axis survives. The raycast is `WorldViewportHandle.raycastDown`, synchronous against the existing BVH; a VOB whose ray misses (over the sky, off the mesh) is left where it was rather than refusing the batch. A *typed* coordinate still does not snap — a typed number is an explicit destination. |
| 1.7 | **Visual assignment**, as opposed to rename | unscheduled → 1b-2 | `setVobProp.visual` renames in place and refuses any VOB whose visual type is `UNKNOWN` — 15,749 of the 41,393 retail VOBs, 38.0 % (§7). Assigning a visual has to decide the object's class; decals (`.TGA`) are refused outright. **The extension × class table is reproducible as of 2026-08-30** — `zenkit-node/scripts/check-visual-types.js` re-measures it over the corpus and reproduces every figure §7 quotes, `.3DS` being the one ambiguous extension (`MULTI_RESOLUTION_MESH` ×20,716 against `MESH` ×31). That settles the measurement the row was missing; the feature stays a decision. |
| 1.8 | **The rest of `zCVob`** | **landed** (§7) | V1 landed 2026-08-28 — `SetVobProp` takes `presetName`, `visualCamAlign` and `bias`, bounded by the packed layout's bit fields rather than by their archive types. V2 landed the same day: `dynamicShadows` on the same two bits, and all seven fields of a decal visual, flat and prefixed. Two fields stay out and both by a fact rather than by time — `farClipScale`, because retail ships uninitialised junk in it (§7), and **`sleepMode`, because `VirtualObject` reads and writes it only under `is_save_game()`**, so a value set on a world archive never reaches the file. |

**Not a gap either: a foliage/scatter brush.** Spacer has no paint tool — its
whole placement verb is one right-click insert plus a physics drop. Carded
anyway, as a past-Spacer feature, at §16.25 — and neither does Spacer.NET, so
it is invention rather than catch-up. The *windows and modes* this inventory
never covered are §16.26.

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
| 3.1a | **ASCII ZEN preservation save** | **complete 2026-09-04** | Patches `0049`–`0052` closed the remaining writer defects. Untouched, property-edited, and structurally edited `SURFACE_BEPPO.ZEN` candidates passed Gothic II QuickTest under the production basename. Normal `saveWorld` accepts ASCII; see `docs/engine-acceptance-2026-09-04-ascii.md`. The older combined row below remains the investigation record; only its BINARY half is still deferred. |
| 3.1 | **ASCII / BINARY ZEN save** | measured, deferred (§5) | Not an oversight, and half-closed since. T8 found all 20 ASCII worlds aborting the process when their own re-save was loaded back; patches `0024`–`0026` fixed A1, A4 and A5, and all 20 now load, save and re-load (acceptance record §10.4). Patches `0045`–`0047` then closed A2 and A3, and a re-save now keeps each VObject's original packed/unpacked layout: OldCamp's container diff goes from `whole-file` to `event-aligned`, gap 0. They still classify `semantic-drift` — A6, `animMode`, and ASCII float text precision — and none has an engine verdict, so `saveWorld` stays BinSafe-only. BINARY has had no fidelity work at all, and a run on 2026-08-30 found it **cannot start on this machine: there is no BINARY `.zen` to measure**. Every `.zen` in the install was enumerated — `Worlds.vdf` + `Worlds_Addon.vdf` hold 8 unique worlds (4 BinSafe, 4 ASCII, and that is the whole corpus in `zenkit-node/worlds/`), the loose `_work/Data/Worlds` the queue's row 42 points at now holds 5 BinSafe Gate-2b candidates rather than the MDK extraction the 28-file C1 run of §10 measured, and the three `_work/Data/Presets/*.zen` are ASCII. So the 28-file corpus that sentence counts is gone with the extraction, and none of it was BINARY anyway — BINARY is what community exporters emit, which is a new external asset and outside what a run may fetch. Nor can one be made: `saveWorld` takes no format, it serializes with `handle->format` captured at load, so converting a retail world is a binding change. The one BINARY input that exists is `_authorFixtureWorld(p, 'binary', 'g2')`, and its round-trip is already clean — `identical`, deterministic, whole-file byte-identical — while reporting `struct-only`, because `lib/container.js` walks BinSafe and `container-ascii.js` ASCII and neither covers BINARY. That is the second half of the block: even with worlds, the classification table would read `struct-only` on every row, and the harness's own rule is that a struct-only row is never a fidelity pass. Closing 3.1's BINARY half therefore decomposes into three pieces that each want their own test run — a BINARY source (a `format` option on the writer, or an imported export), a `lib/container-binary.js` walker, and only then the fixture-backed defect patches — plus a scope call nobody has made: a world our own writer converted has no retail original, so it cannot be its own reference the way C1 requires. Only 4 of 28 retail `.zen` files are BinSafe, and Blender/KrxImpExp exports are not among them. |
| 3.2 | **Static light recompute** | **warning landed**, bake out (§11) | Spacer re-bakes vertex lighting; we do not, so moving geometry or a light leaves stale lightmaps. The warning Phase 1b promised is the save dialog's *"The lighting will be stale"* paragraph (`WorldSurface.tsx`, the `confirmingSave` dialog) — this row read "planned" until 2026-09-02, a stale line. The bake stays out. |
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
fields, and no candidate writes an enum.
`zCVobLight.lightType` is the sharpest case: retail places SPOT nowhere (0 on
all 4,649 lights), so nothing in the corpus says what it looks like.

**The half of that gap a run could close did close, 2026-08-30.**
`verify-world-pipeline.js` now writes two of the eight — `zCVobLight.lightType`
POINT → SPOT and `oCMobInter.soundMaterial` STONE → WOOD, on retail NewWorld,
each read back through `getVobProps` and undone. The value written is the first
catalogue value the VOB does not already hold, so a read-back cannot pass by
agreeing with what was there; suppressing the `applyOps` was run as a negative
control and fails all four checks. That closes the *pipeline* half — binding
coercion, archive member, the read the property grid makes. It closes nothing
of the engine half: the driver never saves, so what an authored SPOT looks like
is still a question only a candidate answers.
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
stays out with `item`, the same cross-reference decision. `contents` was held
out the same way — a single archive string encoding a comma-separated list of
item instances and counts — **and is in since 2026-09-03 (§16.26 row 2)**: it
travels as that string through `SetVobClassProp`, the IPC validator holds its
grammar and the renderer its item index, `oCItem.instance`'s split. `VDoor` adds the same `locked` and
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

### 16.4 Typed rotation — the multi-selection landed; what is left is a decision, not Spacer

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

**Read 2026-09-02, and the Spacer dependency is gone: no Spacer shows an
angle triple, so "type an angle, save, read back" is not an experiment that
exists.** The GMC's Spacer page says of the rotation property that it "uses an
odd format and can't be set manually"; Spacer.NET edits `trafoOSToWSRot` as
the raw archive property (`Windows/PropertiesWin.cs`, the `trafoOSToWSRot`
branch) and its rotate tool is single-axis `RotateWorld(axis, angle)` /
`RotateWorldY` (`SpacerNET_Union/VobManipulator.cpp`), using
`GetEulerAngles()[1]` only as "around vertical axis" for its HUD. So Spacer
parity on an *order* is not a thing a modder could notice, and what is left is
whether the fields should match the one Euler triple ZenGin itself has:
`zMAT4::GetEulerAngles` / `SetByEulerAngles` (Gothic2.exe `0x00516390` /
`0x005163D0`, through `zCQuat::EulerToQuat` at `0x00518BE0` and `QuatToEuler`
at `0x00518AC0`), disassembled from the shipped binary and cross-checked
against Siemekk's AST-World-Editor reconstruction (`G2API/zmath.inl`). With
`m[r][c]` the stored row-major 3×3 exactly as `trafoOSToWSRot` is written:
`x = atan2(m[1][2], m[2][2])`, `y = asin(-m[0][2])`, `z = atan2(m[0][1],
m[0][0])`, radians, and at `|m[0][2]| ≥ 1` the lock branch sets `y = ±π/2`,
`z = 0`, `x = atan2(-m[2][1], m[1][1])`. In this repo's column-vector terms
that is `R = Rx(−x) · Ry(−y) · Rz(−z)` — **intrinsic X-Y-Z with the vertical
as the middle, singular axis, every angle sign-flipped against ours**. Ours is
`Ry · Rx · Rz` with X in the middle, so the two disagree on order and, for
even a single-axis turn, on sign. The measurement above already described the
engine's convention without knowing it was the engine's: "XYZ's singularity is
on the vertical, 464 retail VOBs sit on it". **The decision, Daniel's:** match
the engine (X-Y-Z negated, lock at yaw ±90° folding roll to 0, which puts those
464 on the pole) and call the fields "the engine's angles", or keep Y-X-Z for
its 53 and stop calling it Spacer parity — nothing Spacer could settle remains.
Either way only `zenRotationToEuler` / `eulerToZenRotation` change. An
independent witness, if wanted, is a ten-line Union plugin calling
`trafoObjToWorld.GetEulerAngles()` on a known VOB against the formulas above.

**Landed 2026-09-02: the fields are the engine's angles.** Daniel took the
first option. `zenRotationToEuler` now reads exactly `GetEulerAngles` —
`x = atan2(m[1][2], m[2][2])`, `y = asin(-m[0][2])`, `z = atan2(m[0][1],
m[0][0])`, lock at `|m[0][2]| ≥ 1` with `y = ±90°`, `z = 0`,
`x = atan2(-m[2][1], m[1][1])` — and `eulerToZenRotation` builds
`Rx(−x) · Ry(−y) · Rz(−z)`; `ZenEulerDegrees` keeps its `[yaw, pitch, roll]`
order, holding (y, x, z). Canonical ranges moved with the middle axis:
pitch/roll in (−180, 180], yaw in [−90, 90]. The 464 retail VOBs on the
vertical pole now sit on *the* pole and show yaw ±90 with roll folded to 0 and
the remaining turn in pitch, which is what the engine itself would report for
them. Against the old Y-X-Z every single-axis turn also changed sign: the
right-handed `Ry(+90)` that used to read yaw 90 reads yaw −90, and
`test/coords.test.ts` makes that flip explicit. The grid, `eulerDeltaRotation`
and the per-angle refusal were untouched — only the two functions and their
tests changed, and reverting is those two functions. The witness plugin above
is still the one thing that would turn "the engine's formula, disassembled"
into "the engine's formula, observed".

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

**That limit is now a flag, and the sweep of the three variants is clean
(2026-08-30).** `--fixture <variant>` authors one of the binding's own fixture
variants and sweeps it, so reaching a class the checked-in fixture does not carry
no longer means writing a world by hand. Run against all three: `npc` sweeps 76
INTEGER entries in 5.4 s, `camera` 29, `corrupt-mesh` 21 — the last is the
minimal fixture's own entry set, since its corruption is raw chunk bytes rather
than an archive entry — and **nothing crashed, hung or loaded slowly in any of
them**, so there was no hit to bound. Not a null result: the sweep does reach
`oCNpc`'s `numTalents`, `itemCount` and `numInvSlots` and `zCCSCamera`'s `numPos`
and `numTargets`, and each of the five throws its own guard, which is `0040` and
the camera patch answering. `test/loadWorld.test.js` runs all three sweeps and
asserts *that* — the entry is reached and it is bounded — because an empty run
and a run that never touched the class are the same summary line.

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

Both landed with numbers chosen by reasoning, and neither had a test that could
ever judge them. **The pivot is settled; the outline is a screen-space line now, and
Daniel is tuning it by eye.**

**The pivot — settled by use, 2026-09-01**, and both halves reversed.
`ORBIT_ROTATE_SPEED` is `1` (since 2026-08-27), not the `0.4` named here.
`MIN_PIVOT_DISTANCE = 1` m was judged good at the near range it exists for
(Daniel, 2026-09-01) and is no longer an open number.

- The view-axis projection is for a drag, not a double-click: it put the pivot
  11.6 m from the cursor, so the orbit swung around the screen middle.
  `pivotUnderCursor` keeps it (a drag must not snap the view);
  `handleDoubleClick` writes the picked point to `controls.target` outright.
- An orbit press no longer re-pivots at all — the ambient re-centre, not the
  projection, is what made the gesture useless, since the press after a
  double-click is always the orbit it was aiming. `attachBlenderNav` passes the
  `Nav` to `onNavStart`; only dolly and pan still re-centre, which is all they
  use the pivot for.
- A VOB is a pivot target after all, via the GPU pick, so the 14.2 ms CPU
  raycast is still refused. Two open caveats, uncarded: it answers the VOB's
  *origin*, not the surface (raycasting the one picked mesh would fix it), and
  a prop standing on ground never reaches the fallback — the ray passes through
  it and the terrain behind wins.
- The dot is `TerrainMarker` in `PIVOT_COLOR`, not the placement pink: in one
  colour they were indistinguishable where they landed together.

**The VOB outline drew nothing at all, 2026-09-01**, and the mechanism is
why — not the numbers. The first pair (`0.7`/`4`) put the whole band under a
pixel, and a retuned pair (`0.5`/`2`) drew "at most a bit brighter" on retail
NewWorld (Daniel, 2026-09-01). Both were a per-fragment rim term, darkening a
surface as it turns from the eye, and that term has no edge to find on the
geometry VOBs actually are: a flat face has no facing gradient at all, so a
box's edge is a step, and the most-placed visuals — `NW_NATURE_BUSH_120P`
×690, `NW_NATURE_GRASSGROUP_01` ×688 (100 % flat), `NW_NATURE_FARNTEPPICH_306P`
×565, `NW_CAVEWEBS_V201` ×455 (100 % flat) — are camera-facing billboards
whose silhouette is the texture's cutout, with `vobFacing ≈ 1` across the
whole quad. The stored normals were ruled out by measurement (230,395 of
230,395 proto-mesh triangles decided; wedge-normal spread >15° on 56.9 % of
placed visuals), so the failure was never the data.

*What replaced it is a screen-space line, `VobOutline`.* The world pass
renders into a two-attachment target: the picture on 0 and a **mask** on 1,
written by the VOB shader — `r` "a VOB is here", `g` a per-instance key hashed
from the instance origin so two touching VOBs stay distinct, `b` the selection
flag; the world mesh writes zero, a blended VOB writes zero under a define so a
flame quad does not blend a rectangle in. One full-screen quad then paints a
pixel wherever a neighbour's mask *outranks* it — one pixel wide, on the
outside of every edge — and writes the target's depth back so the overlays
drawn after it are occluded as before. The frame is two halves through the
camera's layers: the world's geometry on `WORLD_LAYER`, everything else on 0,
which is the one obligation on the rest of the viewport (both raycasters
`enableAll`). Cost: one draw call and a full-screen copy per frame, against
the 724-draw-call outline pass §3 refused. The colour attachment is sRGB8 so
eight bits do not band the darks. `VobOutline.test.ts` holds the frame's call
order and the composite's source; `WorldScene.test.ts` holds the mask.

*Seen on hardware, 2026-09-01*: every VOB in a retail NewWorld frame carried
the line, cut-out trees included — the cutout silhouette, which the rim never
could. Daniel's first look: present, "very bright". It went to one pixel on
the outside (two — one each side — doubled the fringe on foliage, where every
gap between branches is an edge) and to `OUTLINE_OPACITY = 0.55` over the
picture; the selection line stays opaque. **Judged good, 2026-09-02
(Daniel).** Opacity, colour and the foliage fringe all stand as shipped — no
further tuning wanted.

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

Two things it deliberately did not do, and both were undone by slice 3 of
§16.20 on 2026-09-02. **It was not plumbed** — no worker message, no
`zen-world` consumer — for the same reason slice 1 was not: how world data
reaches the Problems pipeline was the undecided question at §7. And **it
carried no vertices and no plane**: a row's `polygonIndices` entry was the join
key into `_drillMesh`, which emits the plane and the corner indices per polygon,
so the measurement scripts wrote planarity and orientation without touching
C++. The *consumer* could not ride that join — it walks every polygon of the
mesh through `_drillMesh` windows, on every open — so the readout now carries
`planes`, `cornerOffsets` and `corners` per row, plus the `materials` and
`sectorNames` lists its index columns point into (`sectorNames` in stored
order, since `sectorIndices` indexes it). NewWorld's is 85,749 rows and 4.9 MB
— 83,816 of them sector faces — read in 11 ms.

The mesh-extraction fixture grew the portal metadata this is tested against —
two BSP sectors, a BSP portal list, and distinct `sector_index` values on the
portal and sector polygons. The checked-in golden world (`kMinimal`) is
untouched, so no fidelity claim moved.

**Do not widen either card.** Face-material *authoring* is explicitly gated on
validation proving out (§11), and the BSP compiler is out of scope for good —
the editor validates portal metadata and never recompiles a world.

**Where world findings surface was the open question these two slices left,
and §16.20 answered it**: the Problems panel, with a locus union — the earlier
reading that a portal finding could not live there is superseded there and in
`docs/architecture/level-editor.md` §7. Both functions have their consumer
since 2026-09-02 (§16.20 slice 3).

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

**Slice 5 — the routine index.** The time slider's missing half. `ProjectIndex`
gains `routineSites` — every `TA`-family entry with its window, its waypoint and
its call location — and `routinesByNpc`, the UPPERCASED instance to the
UPPERCASED `daily_routine` it declares. `routines` stays what it was, a sorted
name set for autocomplete, which is why neither of these is a widening of it.

**Landed 2026-08-30.** `extractRoutineSites` and `extractRoutinesByNpc` in
`semanticMetadataUtils.ts` ride the same whole-project model list
`extractSpawnSites` does, and reach the renderer as
`projectStore.routineSiteIndex` / `routineNpcIndex`. Both halves read that one
list deliberately — an NPC then never resolves to a routine whose entries the
index could not read, which a per-file pass for the instances (the route
`routines` takes) would not guarantee.

**The one thing it had to decide is how a wrapper's arguments are found, and it
is not by their names.** Retail never calls `TA_MIN` from a routine; it calls a
`TA_*` wrapper, and only the two engine externals have a signature anything here
can know — `TA(self, start_h, stop_h, state, waypoint)` and `TA_MIN(self,
start_h, start_m, stop_h, stop_m, state, waypoint)`, whose waypoint indices are
already the measured `ENGINE_EXTERNAL_WAYPOINT_ARG_INDEX` rows 4 and 6. The
obvious extension of `buildWaypointParamIndex`'s derivation rule — read the
project's own helper declarations rather than listing them — would be to key on
parameters *named* `start_h`; that is a convention nothing in this repo has measured, and
it fails **silently and totally** — a mod spelling them differently yields zero
routine entries and no error. So `buildRoutineParamIndex` follows the call
instead: a wrapper passes its own parameters into a carrier it already knows, so
which of its parameters land in that carrier's time slots *is* its layout. It
assumes only that a wrapper passes its parameters through, which is the one
thing a wrapper can do with them, and it sweeps to a fixed point so a wrapper
around a wrapper resolves too. A wrapper that hardcodes its window rather than
taking it does not resolve, and is reported rather than dropped — see slice 6's
instrument.

Times are normalized to minutes since midnight at extraction, hour 24 to 0.
That is what makes retail's `(06,00,24,00)` + `(24,00,06,00)` pair — the
reference is `daedalus-parser`'s own `SLD_99003_Farim.d` — come out as a window
that wraps plus one that does not, partitioning the day exactly once. An entry
whose hour, minute or waypoint is not a literal is excluded, never guessed (§8,
brief §5.1); a *constant* hour is as unresolvable as a computed waypoint,
because the main process holds no semantic model to resolve one against.

**Slice 6 — the schedule, and the gap/overlap instrument.**
`src/renderer/routines/routineSchedule.ts`, pure, no React or Three.js — the
same split `quest/domain` and `problems/domain` keep. **Landed 2026-08-30.**

`placementsAt(index, minute)` is what a time slider reads: one placement per NPC
with a declared routine, carrying **every** entry in force at that minute rather
than one. Nothing in the format, in ZenKit or in this repo says which entry the
engine picks when two windows overlap, and no measurement available here could
settle it, so a precedence would be a rule the game does not have. Windows are
half-open, which is what lets the retail pair partition the day instead of
colliding on minute 0, and a zero-length window is the whole day — that is
`TA_Stand_WP(00,00,00,00,…)`, the idiom for a routine with one entry. An empty
`entries` is deliberately ambiguous between a hole in the day and a routine the
index never read: an empty index means nothing is known, never that nothing is
legal.

`coverageOf(sites, routine)` is the other half and is **a measurement, not a
rule**: which minutes of a day a routine leaves uncovered and which it covers
twice. It counts a minute at a time rather than merging intervals, because the
day is a circle and every wrap-around case an interval merge has to get right is
one this cannot get wrong; 1,440 counters per routine. **No Problems rule was
written on it, on purpose** — §16.22's precedent is that the number comes first
and the check second, and that the number is allowed to kill the check, as the
occupancy measurement's did.

**The coverage ratio, measured 2026-09-01 against `mdk/Content`** (the
gitignored copy `environment-hazards.md` says is not retail-equivalent for
*compiling*; for an index count that does not matter — every file parses, and
the two retail defects it names touch no routine). `scripts/check-routine-coverage.js`
is the instrument, in `check-spawn-occupancy.js`'s shape: it reports the
`TA`-family calls written in a corpus beside the entries that reached the index,
**names every `TA_*` callee it could not resolve**, and then gives the gap and
overlap distributions. **The index sees 5,087 of the 6,275 `TA`-family calls
retail writes (81%), all 60 wrapper callees resolve, and the 1,188 it misses
are one file, not a scatter**: `Story/NPC/DMT_DementorAmbient.d` carries
1,128 of them — 17 dementor-walker `Rtn_Start_12xx` functions averaging 66
entries — and yields no model at all, because its `PROTOTYPE Default_AmbientDementor`
body calls `B_SetAttributesToChapter (self, 3)` and the grammar's
`prototype_declaration` takes a `class_body` (declarations and assignments
only), so a call statement there is a syntax error and
`extractFileMetadataFromSource` drops the whole file. That is a `grammar.js`
fix (`prototype_declaration` → `$.block`, as `instance_declaration` already
has), a parser-workspace change with a native regenerate behind it, not an
`extractRoutineSites` one. **Landed 2026-09-02**: `prototype_declaration` takes
`$.block`; re-measured, the index sees 6,215 of 6,275 (99%), 0 of 1,725 files
fail to parse, and the 60 left are the ones named next. The other 60: 58 are
`AI/Human/TA.d`'s own wrapper bodies passing parameters into `TA_Min`, which
is what a wrapper is and never an entry; 2 are `BDT_1020_Wegelagerer.d` writing
its `TA_Guard_Passage` pair in the *instance* body instead of a routine
function — the extractor walks `functions` only, and two calls in one file do
not earn an instance-body walk. So the true loss is one syntax gap worth 18%
of the corpus, and the number to quote is 81% until that lands. (The run also
found and fixed a denominator bug of the counting script's own: `instance
TA_Testmodell (Npc_Default)` matched the call regex; `tests/routineCoverage.test.ts`
now holds it.)

**Gap and overlap are how the game is built, at the margin only**: of 1,137
routines with at least one indexed entry, 1,126 cover the day exactly once;
11 leave a hole (each one hole; 720 minutes for `RTN_START_10013`, 600 for
`RTN_START_1086`, 540 for `RTN_START_503`, then 420, 240, 60, 50, 30, 30, 30,
7) and 8 cover a window twice (one each). No tail — a rule written on either
would fire 19 times on retail and every one is plausibly deliberate (a
half-day routine is an NPC who is elsewhere the other half), so the §16.22
precedent holds: the number does not justify a Problems rule, and none is
carded.

**What is deliberately not carded, and why:**

- **NPC and item *visuals* are not reachable.** §11's "NPC/item rendering"
  reads as drawing the actual mesh, and the data for it does not exist:
  `ProjectIndex` carries `npcs` and `npcPrototypes` as **name strings only**, no
  instance bodies and no property values, so the `B_SetNpcVisual` chain that
  resolves an instance to a mesh has nothing to walk. Closing that means either
  a fifth extraction pass over instance bodies or a semantic model in main,
  which `CLAUDE.md` records the main process deliberately not having. Slice 4
  draws markers because a marker needs only the position slice 1 already yields.
- **The time slider is built — slice 7, below.** This bullet has now read three
  ways: first that the `TA_*` windows were an extraction nothing does, then that
  the extraction had landed and only the UI was missing. Both are answered.
- **Occupancy is dead and gap/overlap are now a number away.** All three used to
  sit behind the world-locus wall §7 and §16.18 stood behind; that wall is down
  (§16.20 slices 1 and 2). Occupancy was then measured and killed its own check
  — §16.22 q4, a cliff and no tail. Gap and overlap are the two that survive,
  and they stay uncarded for the same reason as before, that nobody has said
  what the finding should be — but `coverageOf` and its script now compute the
  distribution the saying would rest on.
- **W4, script→world go-to-definition, was called large when it was sized** on the
  premise that nothing displayed a script-side waypoint name to click. That
  expired — `InsertNpcActionRenderer` displays one and §16.20 slice 2 built the
  navigation — and W4 landed 2026-08-29. See §7.

**Slice 7 — the time slider itself.** Landed 2026-08-30. A *Time* button and a
0–1439 slider on the World bar, hung off the *Spawns* toggle rather than beside
it because it has nothing else to change, and `SpawnOverlay` drawing the minute
instead of the static spawns.

**It draws two layers, and that is the decision the slice turned on.** A minute
splits the NPCs three ways and only one of the three is a position the scripts
state: a routine covering the minute is a *placement*, while a routine with a
hole there and an NPC declaring no `daily_routine` at all are both only their
static spawn — the point they were *inserted* at, which is not a claim about
this minute. Drawn in one colour those two are indistinguishable and the weaker
fact reads as the stronger, so `placementWaypointsAt` returns them as two lists
and the overlay draws the fallback smaller, dimmer and in `UNPLACED` grey.
**This is also what keeps the coverage gap visible:** slice 6's ratio is 81%
and the missing fifth is one file (measured 2026-09-01, above), so an hour the
index reads badly shows as grey markers rather than as an empty world nothing
explains. Known wins a point both lists reach — one
marker per point is still the rule, and who is standing there is the waypoint
panel's answer.

Null is the slider **off**, not midnight: where an NPC stands at 00:00 is a
thing the routines answer and "no time chosen" is not, so the two cannot share a
value. It opens at 08:00 for the same reason — a slider opening on a sparse hour
would read as a broken layer.

Two mechanical notes worth not rediscovering. The marker buffers are allocated
once at the waynet's size and drawn as a `drawRange`, because the slider
rewrites both sets on every tick of a drag and replacing the attribute instead
orphans its GPU buffer each time — `WebGLAttributes` frees one on the
attribute's own dispose event, which a replaced attribute never fires. And
`setTime` is re-applied on the overlay's rebuild dependencies, or a structural
op silently resets an open slider to no time at all.

**It has no Playwright spec, and the reason is §16.20 slice 2's exactly.** The
browser harness has no world — `openWorld` is refused there by design — so
`summary` is never set and the World bar never renders, which puts the *Waynet*
and *Spawns* toggles equally out of reach. Daniel took the Jest route knowingly
(2026-08-30): the toolbar wiring is pinned in `WorldSurface.editing.test.tsx`
beside the spawn toggle's, the marker sets in `SpawnOverlay.test.ts`, and the
day's arithmetic in `routineSchedule.test.ts`. **What none of them covers is
that the markers move on screen**, and nothing here can until the harness gets a
world; that is the same wall, not a new one, and it is why `world-render.spec.ts`
exists on the real-Electron side.

**Slice 8 — waypoint names over the world.** Landed 2026-08-30. A *Names*
toggle, offered whenever something is drawing waypoints — the waynet, or the
spawn markers, which stand on them.

**It labels what is drawn, not what exists.** With the waynet on the candidates
are every waypoint; with only the spawn layer on they are that layer's
`labelledPoints`, both colours, because a name over an unmarked waypoint points
at nothing. Only the nearest `LABEL_CAP` (24) survive: a retail world has ~3,000
waypoints and a name on each is neither legible nor affordable, and nearest-first
is what keeps the survivors around the camera instead of an arbitrary slice.

**The layer is DOM, not Three.js, and that is the decision worth recording.**
There is no text anywhere in this scene — no sprite, no canvas texture, no SDF
font — so every option was new infrastructure, and the cheapest that is also the
most legible is HTML over the canvas. The renderer's CSP allows
`style-src 'unsafe-inline'` (`security-model.md`), which is what lets a
transform go straight onto the element. Two consequences: the viewport host is
now `position: relative`, or the labels resolve against the page; and nothing in
the layer takes pointer events, because the viewport is entirely click-driven
and a label over a dot that swallowed the click would make the waypoint you are
looking at the one you cannot select, with nothing about the picture looking
wrong.

`chooseWaypointLabels` is `pickWaypoint`'s projection, guard for guard — a
non-positive `w` is dropped rather than divided, or a waypoint behind the camera
is labelled on the opposite side of the screen. Unlike the pick it runs in the
draw loop: ~3,000 `Vector4` transforms, tens of microseconds against 16 ms, and
only while the layer is on. The cap is on the DOM writes, so the write side does
not grow with the world.

**No Playwright here either, for slice 7's reason** — and in the cloud container
the suite could not have been run anyway (`environment-hazards.md`, *"Playwright
in the Claude Code cloud container"*). Jest covers the choice
(`waypointLabels.test.ts`), the DOM layer (`WaypointLabelLayer.test.ts`) and the
toggle (`WorldSurface.editing.test.tsx`); **that the names land on their dots on
screen is still unwitnessed**, and it is the same wall, not a new one.

**Slice 9 — NPC dummies. Landed 2026-08-30 (Claude).** Draw a body at each
occupied point instead of a dot: the spawn layer's markers become stand-in
figures, moved through the day by slice 7's slider and named by slice 8's
labels.

**This is not the NPC-rendering that is out of scope, and the difference is the
whole reason it is cheap.** The bullet above records that real NPC *visuals* are
unreachable — `ProjectIndex` carries instance names and no bodies, so the
`B_SetNpcVisual` chain has nothing to walk, and closing that needs a fifth
extraction pass or a semantic model in main. A dummy needs none of it. It needs
a position, which slice 1 already yields, and it is the answer to that gap
rather than a placeholder waiting on it.

**One dummy per point, as the markers already are.** The scripts give no
per-NPC offset, so the 175 distinct NPCs on `NW_CITY_ENTRANCE_01` (§16.22 q4)
would need 175 invented positions — the same reason slice 4 draws one marker per
point. Who is standing there stays the waypoint panel's answer, and slice 8's
label is where a count belongs.

**Four things it has to decide, and the first is the one that can go silently
wrong.**

1. **The facing is unverified twice over.** `WaynetPayload.directions` has
   crossed the binding since Phase 1a and **is read by nothing** — no consumer
   has ever confirmed what the vector means, so a dummy would be its first. On
   top of that the layer hangs under the mirrored root: `ROOT_MATRIX` negates X,
   and `coords/index.ts` documents that a quaternion cannot carry a mirror and
   drops it silently. A per-instance matrix composed under that root does come
   out facing correctly — the root transforms the direction exactly as it
   transforms the position — but it is a rotation *and* a reflection, so any
   asymmetric dummy is mirrored with it, and a facing that looks plausible on
   screen can still be wrong. **This is §16.4's problem again and wants the same
   answer: Spacer.** Until then a symmetric dummy claims nothing it cannot back.
2. **A solid body cannot keep the marker's `depthTest: false`.** The dots draw
   through walls on purpose — "a spawn inside a building is exactly the one
   worth looking at" — and a flat dot in front of a wall reads as a dot in
   front of a wall. A *body* that ignores depth reads as standing in front of
   the building rather than inside it. **Keep both layers**: the dummy
   depth-tested, the dot as it is. That also answers (3).
3. **A dummy is world-space and the marker is not.** The points draw with
   `sizeAttenuation: false` — a constant 9 px, deliberately, so a spawn is
   findable with the whole world in frame. A body shrinks with distance and is
   nothing at map zoom. Keeping the dot is what preserves the find-it-anywhere
   property; the dot sits at the dummy's feet, which is where the waypoint is.
4. **`placementWaypointsAt` throws away who — not closed here.** It returns
   waypoint names, because that is all a marker needed, and a labelled dummy
   would want point → the instances standing on it, which `placementsAt` has
   and this discards. **Not taken**: the label a dummy draws is still slice 8's
   waypoint name, over the same point a dot already stood on, so nothing built
   in this slice consumes occupant identity — the count is still the waypoint
   panel's answer. Threading it through `SpawnOverlay` with no reader would be
   an API grown for a call site that does not exist; left for whoever gives a
   dummy its own label.

**Shape of the work, as built.** One `InstancedMesh` of a capsule authored in
ZenGin centimetres — 25 cm radius, 130 cm cylinder, 180 total, the root scales
it — sized at the waynet's point count and drawn with `.count`, the same
fixed-capacity trick slice 7 put on the markers' `drawRange` and for the same
reason: the slider rewrites the set on every tick of a drag. The known/unknown
split is a per-instance colour (`setColorAt`, white material so it is drawn
unmixed) rather than a second mesh — the `HIDDEN_ATTRIBUTE` pattern (the
selection emphasis reaches for it too, §7), one draw call carrying both. The feet-at-the-waypoint
offset (decision 3) is baked into the geometry once, by `translate`, rather than
composed into every instance's matrix, since `setMatrixAt` writes a pure
translation to the waypoint and nothing here ever rotates. Symmetric per
decision 1: no rotation is written, so `WaynetPayload.directions` stays
unread by anything and the mirror problem stays exactly where §16.4 left it.
Held by `SpawnOverlay.test.ts`'s new cases — one dummy per point, the feet
position, the identity rotation, the depth-test split against the dot, the
colour split, and that it moves and disposes with the rest of the overlay.

**The one thing in the slice that failed silently, caught in review rather than
by a test, and now pinned by one.** The material was first written
`vertexColors: true`, which draws **every dummy black**. `instanceColor` alone
is already the whole mechanism: three defines `USE_INSTANCING_COLOR` in the
vertex shader from the attribute merely being present, and `USE_COLOR` in the
*fragment* shader from `vertexColors || instancingColor`, so the multiply into
`diffuseColor` happens without it (`WebGLProgram.js`, the two prefix blocks).
Adding `vertexColors` additionally declares `attribute vec3 color` in the
*vertex* shader and multiplies by it — an attribute a capsule has not got, and
one `MeshBasicMaterial` cannot default, because `defaultAttributeValues` is
`ShaderMaterial`'s alone (`WebGLBindingStates.js` skips the fallback branch
entirely). The generic value stays at WebGL's (0, 0, 0, 1) and the colour split
this slice turns on is invisible. **No colour assertion can see it** —
`getColorAt` reads the buffer back, never the shader — so the regression test
asserts the material contract instead: `instanceColor` set, `vertexColors`
off, and no `color` attribute on the geometry.
Cost is one draw call for the drawn points, against the 724 the VOBs already
spend; ~1,816 is the corpus figure this was sized against, not a cap enforced
anywhere.

**A loose end it does not close:** `pickWaypoint` projects waypoint *origins*
with an 8 px radius, so up close the clickable spot is at the dummy's feet and
clicking its chest selects nothing. Worth knowing before it is reported as a
bug. And like slice 7 and slice 8, **nothing here is witnessed on screen** — the
browser harness has no world, so Jest is what checks the scene graph and
nobody has watched a dummy stand in a real one yet.

**The slider's answer is the start of the game — the state slices. Planned and
landed 2026-08-30 (Claude), except the measurement, which has no corpus on this
machine.** Slices 5–7 resolve an NPC through
`routinesByNpc`, the one routine his instance *declares* — and the declared
routine is only the day the game opens with. Quest state swaps it:
`Npc_ExchangeRoutine(npc, "X")` (retail nearly always through the
`B_StartOtherRoutine` wrapper) makes the engine run `RTN_X_<npc.id>` from then
on, and the chapter-entry files insert whole casts conditionally. So the
waypoint the slider draws for an NPC is conditional on quest state twice over —
*which routine* is in force, and *whether he is in the world at all* — and
today it silently answers "chapter 1, nothing progressed" for both. The four
slices below make the first conditionality choosable; the second stays behind a
measurement, deliberately — see the closing paragraph.

**What this is not, and the framing every slice depends on: a quest-state
evaluator.** The editor cannot know what state a playthrough is in, and the
main process holds no semantic model to evaluate a guard against (the
`assertApplyOpsRequest` note in `CLAUDE.md` is the same fact from the other
side). A *State* control is a **lens** — "draw the day as if this state were
active" — never a claim that the game reaches that state, or reaches it for
everyone at once. That is what keeps the slices cheap: a lens needs an index
and a resolution rule, not an interpreter.

**What already exists is more than it looks — the §16.19 pattern a third
time.** Read out of the code 2026-08-30:

- `routineSites` already index **every** `TA_*` entry of **every** function,
  not only the declared routines — the alternate `RTN_*` variants are in the
  index today, and nothing reaches them only because `routinesByNpc` knows
  nothing but the declared one. The expensive half of a state's schedule is
  already paid for.
- Exchange calls are already in `callSites` with parsed args: `recordCallSite`
  runs before the action is built (`processFunctionCall`) and sweeps skipped
  `if` subtrees since the 2026-08-29 nested-call fix, so a chapter-guarded
  `B_StartOtherRoutine` is visible. No parser change for the exchange index.
- The resolution rule is the **engine's**, not an observed naming style:
  `Npc_ExchangeRoutine(npc, "X")` runs `RTN_X_<id>` where `id` is the C_NPC
  instance's `id` field. Grouping variants by id suffix is grounded the way
  `ENGINE_EXTERNAL_WAYPOINT_ARG_INDEX` is — engine behavior — *provided the id
  is known*, and it is not: the semantic model does not carry the field. That
  is the one parser change, and it is slice 10.

**Slice 10 — `npcId` on the parser's instances.** `GlobalInstance.npcId`, read
exactly as `dailyRoutine` is (`declaration-visitor.ts`, the
`extractDailyRoutine` scan of the body's top-level assignments): `id =
<integer literal>`, and anything else — a constant reference, an expression —
leaves it `undefined`, excluded never guessed. A constant id is as
unresolvable downstream as a constant hour was in slice 5, and for the same
reason: the consumer has no symbol table.

**Landed.** `GlobalInstance.npcId` and `extractNpcId` in
`declaration-visitor.ts`, beside `extractDailyRoutine` and reading the same
top-level body assignments. A leading `-` is part of the literal — retail writes
`id = -1` on templates. Held by two cases in
`semantic-global-symbols.test.js`. **The editor keeps its own structural copy of
`GlobalInstance` in `src/shared/types.ts`**, so the field had to be added in
both places or the extractor does not compile — worth knowing before the next
instance field.

**Slice 11 — the state index.** Two `ProjectIndex` fields, both riding
`fileModelsForSiteIndexes` like slices 1 and 5, both reaching the renderer
through `projectStore`:

- `routineStatesByNpc`: UPPERCASED instance → `{ id, states:
  Record<stateName, routineFunction> }`, built by matching the routine
  functions already present in `routineSites` against `RTN_<state>_<id>` for
  each NPC with a literal id. Prefix `RTN_`, suffix `_<id>` — the split is on
  the *known* id, not a guess at where the state name ends, so a state name
  containing underscores or digits parses correctly. The declared
  `daily_routine` stays `routinesByNpc`'s answer and is not re-derived from
  the name.
- `exchangeSites`: every `Npc_ExchangeRoutine` / `B_StartOtherRoutine` call
  whose state name is a string literal — target as written, state name,
  file/function/line. **Not consumed by the picker.** It is the measurement's
  ground truth for which states are *reachable*, and later the
  go-to-definition for "what triggers this state". A `self` target inside a
  dialog body is recorded unresolved rather than resolved through
  `dialogsByNpc` — a real derivation, but one with no consumer yet, the
  slice 9 decision 4 rule.

**Landed** as `extractRoutineStatesByNpc` and `extractExchangeSites`, reaching
the renderer as `projectStore.routineStateIndex`. **`extractRoutineStatesByNpc`
takes the routine sites rather than recomputing them**: `extractRoutineSites`
runs `buildRoutineParamIndex`'s fixed-point sweep over every function of every
file, and `ProjectService` has already paid for it once. A variant whose routine
has no entries the index could read is dropped — choosing it would empty the
world with no explanation — which also means this index inherits slice 6's
coverage exactly: 81%, and the dementor walkers' `Rtn_Start_12xx` are the
routines it cannot offer.

The decision this slice turns on: variants enumerate **by the engine's name
rule, not by exchange sites**. The name rule sees a variant an exchange
reaches through a variable or a concatenation; an exchange-site enumeration
would not. The cost is listing variants nothing in the scripts triggers — for
a lens that is the point, not a defect.

**The measurement — run 2026-09-01 against `mdk/Content`** (slice 6's caveat
about that copy applies: not retail-equivalent for compiling, immaterial for
an index count). `scripts/check-routine-states.js` is a sibling of
`check-routine-coverage.js`; it had been exercised against a synthetic corpus
only, and the select shipped ahead of the number on an explicit instruction to
implement. The number now exists, and it is what the paragraph *"the control's
shape is gated on slice 11's measurement"* below reads against:

- **271 of the 663 NPCs with a declared routine have at least one variant**
  (every one of the 663 has a literal id — the name rule never fails on that).
  **182 distinct state names, 501 NPC×state pairs.** 112 names reach one NPC
  only; 70 reach two or more and those 70 carry 389 of the 501 pairs (78%).
  The head is real and it is *event*-shaped, not chapter-shaped: `START` 69
  (NPCs whose declared routine is *not* their `Rtn_Start`), `TOT` 34,
  `SHIPFREE` 16, `FOLLOW` 15, `SHIP` 14, `WAITFORSHIP` 13, then 8, 8, 8, 7,
  7, 7 (`FLEEDMT`, `FLEEFROMPASS`, `FLUCHT`, `AFTERRITUAL`, `CONCERT`,
  `PRISON`) and a run of 6s and 5s — twenty-four names reach 5 or more. **No
  `KAPITEL*` state exists in retail** — the chapter is a spawn guard, never a
  routine name.
- **Exchange sites: 672 `Npc_ExchangeRoutine`/`B_StartOtherRoutine` calls,
  670 with a literal state** (the 2 are `B_StartOtherRoutine`'s own body
  passing its parameter through). By *target*: 94 name an instance and **all
  94 resolve** to an indexed variant of that instance; 324 target `self`
  (resolvable through the enclosing dialog's `npc`, the derivation slice 9
  decision 4 declined to build — this is its first number, 48% of the sites);
  252 target a local `var C_NPC` alias (`Biff`, `Lee`, `Bloodwyn` — 139
  distinct names, none an instance), a symbol question the main process
  cannot answer. So 14% resolve today, 62% would with the `self` derivation,
  and the remaining 38% need a symbol table.
- **Drift, by name**: 173 distinct states triggered. **3 triggered that no
  variant is written for** — `FLED`, `POSTSTART`, and `RTN_POSTSTART_1367`,
  a retail call passing a whole function name where a state goes. **12
  written that nothing triggers by literal** — `ATTACK`, `CONCERT`,
  `FLUCHT2`, `FLUCHT3`, `ICEDRAGON`, `ICEWAIT2`, `PIRATECAMP`,
  `POSTENVERLASSEN`, `REST`, `RUHE`, `RUNAFTERVIRTUALREFUGEE`, `TEST` —
  dead, or reached through a variable, which is the case the name rule was
  chosen for. Both lists are short enough to be a Problems rule's output and
  neither is carded, for §16.22's reason: nobody has said the finding.

**The "`extractRoutineStatesByNpc` answers `{}`" report is closed
2026-09-02 on the locator card's rule (§16.24): not reproducible, twice** —
55/55 tests at c514e8a and 271 NPCs indexed over retail the same day, so the
one project it was seen on is what would re-open it. Re-open only on a repeat
that names the project and the file the index missed.

**Slice 12 — the schedule takes a state.** `routineSchedule.ts` stays pure:
`RoutineIndex` gains optional `statesByNpc`, and `placementsAt` /
`placementWaypointsAt` gain an optional state — with one chosen, an NPC that
*has* that variant resolves through it and every other NPC keeps his declared
routine. The fallback is the lens's honest semantics, not a convenience: a
state names the NPCs it exists for, and for everyone else the chosen state
says nothing — so they keep the strongest fact available, the declared day.
Overlap, hole and empty-index semantics unchanged. Jest,
`routineSchedule.test.ts`.

**Landed**, plus one function the plan did not foresee needing: `stateReach`,
which the UX pass below turned into a requirement rather than a nicety.

**Slice 13 — the State picker.** A select on the World bar, offered while
*Time* is on — a state without a minute answers nothing the static layer does
not — options the distinct state names of the index, sorted, default
**Declared**, which is today's behavior exactly. Wiring is `spawnTime`'s,
verbatim: a `spawnState` prop through `WorldViewport` into the overlay's
recompute, re-applied on the same rebuild dependencies (slice 7's note about a
structural op silently resetting an open slider applies to the state too).
Jest as slices 7–9 pin theirs (`WorldSurface.editing.test.tsx`,
`SpawnOverlay.test.ts`); the Playwright wall is slice 7's, so that the markers
*move* when the state changes stays unwitnessed on screen, said rather than
hidden.

**Landed**, with the reach readout below as `world-state-reach` and the picker
as `world-state`. The state rides `setTime(minute, state)` rather than a call of
its own, for the same reason the control hangs off *Time*. Switching *Time* off
clears the state, and so does switching *Spawns* off — a state surviving behind
a hidden control is a filter nobody can see, which is the rule the time slider
already followed for the layer.

**The story it serves, and the one thing that story needs which the wiring
above does not give it.** The question is *"where is this NPC once the plot has
moved on"* — today a person turns on *Spawns*, turns on *Time*, drags to 10:00
and gets an answer that is silently chapter-one-only, with nothing on screen
saying so. The lens makes that answer choosable: pick a state, the dummies jump
to the waypoints the variant routines name. The control chain is
*Spawns → Time → State*, each one meaningful only given the one before, which
is why the picker hangs off *Time* exactly as *Time* hangs off *Spawns*.

**But a chosen state moves a handful of NPCs and leaves the rest on their
declared day, and the control as specified cannot say which it did.** The
fallback is honest (slice 12) and the label is a lie by omission: *State:
KAPITEL3* reads as "the world is in chapter 3" when it means "chapter 3 for the
NPCs who have a chapter-3 routine, opening day for everyone else". **So the
picker ships with a reach readout beside it — the NPC count the chosen state
actually resolved, against the count it could have** — and that is not a nicety.
It is slice 7's grey-marker decision again, in the same spirit and for the same
reason: the weaker fact must not be able to read as the stronger one, and a
number is the cheapest thing that stops it.

**Two naming decisions that look cosmetic and are not.** The default option is
**Declared**, never "Chapter 1": a `daily_routine` is whatever the instance
says, which for some NPCs is already a late-game routine, so "Chapter 1" would
be a claim the index cannot back. And the readout counts *NPCs*, not markers —
one point carries many NPCs (§16.22 q4's 175 on one waypoint), so a marker count
would answer a question nobody asked.

**The control's shape is gated on slice 11's measurement, and this is where the
measurement earns its place.** A dropdown is right only if state names recur
across NPCs — a dozen shared names like `TOT` or `KAPITEL3`. If the corpus
instead shows mostly bespoke suffixes, the honest control is not a select with
four hundred entries; it is a per-NPC affordance or a filter field, and the
picker as drawn here would be unusable in a way no amount of wiring fixes.
*Do not build the select before the number exists* — it was built before, on
instruction, and the number arrived 2026-09-01 (slice 11 above).

**Verdict: the global select is the right control, and its list is the wrong
length.** The premise holds — names do recur across NPCs, 70 of 182 do and
they carry 78% of the NPC×state pairs, with a head (`TOT`, `SHIP*`, `FOLLOW`,
`PRISON`) that is exactly the "where is everyone once the plot has moved on"
question the lens exists for. It is not the four-hundred-bespoke-suffixes case
that would have killed a dropdown. But 112 of the 182 entries reach one NPC,
and a flat alphabetical select puts `ABMARSCH`-style singletons between the
names anyone would pick; the reach readout says *1 of 271* after the fact,
which is late. The fix is a sort or a split, not a rebuild: shared names
first, ordered by reach, singletons after a divider (or behind a filter) — a
tweak to `world-state`'s option list, and not in this slice. Landed 2026-09-02:
`stateOptions` in `routineSchedule.ts` splits the list, shared names by reach
above an *Only one NPC* subheader, each option labelled `TOT (41)`. Also of note: the
names are events, not chapters, so the *Declared* default's honesty argument
stands twice over — there is no `KAPITEL3` for it to be confused with.

**Where "who" belongs, when somebody asks for it.** Somebody did, on
2026-08-30, and slice 14 below is the answer — so the paragraph this replaces
(the markers stay anonymous, the waypoint panel is the surface for *who*) is
superseded rather than merely amended. The panel is still where the *list*
lives; what changed is that a marker with one name on it turned out to be the
question people ask of a picture, and slice 9 decision 4's "left for whoever
gives a dummy its own label" is now spent.

**The obvious follow-on, deliberately not in this slice: highlighting what the
state *changed*.** "Which NPCs does chapter 3 move, and where from" is probably
the most useful question in the whole feature, and it wants a third marker
colour — which the layer has not got, because the colour channel already
carries the known/unknown split that keeps the unmeasured coverage visible. It
is a real slice, not a tweak, and it should not be smuggled into the picker's.

**Chapter-conditional spawns — the other half, deliberately not carded.** An
NPC's *presence* is quest-gated too: `B_Enter_OldWorld.d`'s 302 spawns are one
`if (Kapitel ...)` after another, indexed since the nested-call fix but drawn
unconditionally at every minute and every state. Making presence conditional
needs the guard, and `recordCallSite` keeps no condition context — so it is a
parser widening (the enclosing guard chain on a call site) plus a static
evaluation of `KAPITEL` comparisons in main, which crosses the
no-semantic-model line unless it stays literal-only. **Measure first, §16.22's
manner:** of the 3,976 indexed spawn sites, how many sit under any guard; of
those, how many guards are pure `KAPITEL <op> <literal>` chains. A cliff means
a *Chapter* filter is a cheap follow-on and becomes a second dimension of the
same lens — state + chapter, one control stack, not two; a tail means the
honest UI is a "conditional" marker *style*, never an evaluated one. Exchange
calls are guarded by the same kinds of state, and the lens sidesteps that by
construction — noted so nobody re-derives it.

**Slice 14 — the markers say who. Landed 2026-08-30 (Claude).** With *Spawns*
on, a labelled point draws the NPCs standing on it instead of the waypoint's own
name.

**Nothing new was connected — a discard was undone.** The question that
prompted this ("the NPC name next to the waypoint does not work") assumed a
missing link between script and world, and there is none missing: `spawnSites`
carries `instance` + `spawnPoint`, `routineSites` carries the waypoint per
window, and `placementsAt` has returned `{ instance, routine, entries }` since
slice 2. `placementWaypointsAt` collapsed all of it to waypoint *names* because
a marker needed nothing else (slice 9 decision 4), and the label layer was
handed `waynet.names`. So the whole slice is: stop throwing the instance away,
and let the label ask for it.

**Each point is named by its own layer's fact.** A known point names the NPCs a
routine puts there; an NPC merely *inserted* at that point stays out of it and
keeps his own marker in the unknown layer. Putting him on the known point's
label would rejoin exactly the two facts `placementWaypointsAt` exists to keep
apart — the weaker reading as the stronger, slice 7's rule again.

**One name and a count, not a list.** 175 distinct NPCs stand on
`NW_CITY_ENTRANCE_01` (§16.22 q4), so `labelTextFor` draws `<first> +174`,
alphabetically — the sort is not cosmetic, or which name is drawn would depend
on the order the index enumerated its NPCs in. And the occupant name *replaces*
the waypoint name rather than joining it: the marker is already the point, and
the waypoint's own name stays the panel's answer.

**The layer asks; it is not told.** `WaypointLabelLayer` takes an
`occupantsAt(waypoint)` callback, because it is built once per world while the
occupancy under it changes on every tick of the slider, every state pick and
every rebuild of the spawn overlay (a structural op rebuilds that one and leaves
this one alone). With *Spawns* off it answers nobody: occupancy is that layer's
fact, and a name over a point nothing is marking is a claim the picture does not
support. `SpawnOverlay` is where a waypoint name became a payload index, so it
is where it also becomes "who is on point 1".

**No Playwright, for slices 7–9's reason exactly** — the browser harness has no
world. Jest covers the schedule (`routineSchedule.test.ts`), the text
(`waypointLabels.test.ts`), the DOM layer (`WaypointLabelLayer.test.ts`) and the
index mapping (`SpawnOverlay.test.ts`); **that a name lands on its dot on screen
is still unwitnessed**, the same wall, not a new one.

**What this does not do, and what was asked for beside it.** Daniel's larger
proposal (2026-08-30) is the other direction: an *Insert NPC* button on the
World surface that places a waypoint, writes the `Wld_InsertNpc` line into the
world's `STARTUP_<worldfile>` and links the two — with a world directory set
once, so a spawn point in a world that is not open can be resolved. That is a
separate slice and a bigger one: it is the first time the editor would author
into a file it is not editing (parse the file, append the action, regenerate,
save — and refuse visibly when the file has parse errors, since the generator
throws on an errored model), and the `STARTUP_`/`INIT_` split matters — the
former runs once, the latter on every load, and `Wld_InsertNpc` belongs in the
former. The world-directory setting also buys the answer the
spawn-point jump keeps reserved — "no such waypoint anywhere", which
`InsertNpcActionRenderer` refuses to give today because the editor holds one
world and has no index of the others. **Not carded here** — recorded so the next person does not
re-derive it.

**Slice 15 — the other direction, NPC/Dialog → World. Landed 2026-08-30
(Claude).** `DialogDetailsEditor` gets the jump `InsertNpcActionRenderer`
already had: a *Show in World* button that resolves the dialog's NPC to its
project-index spawn point and leaves the same `requestFocus({ kind:
'waypoint', name })` the action-level jump does.

**The only new step is the resolve.** The action-level button already had a
spawn-point string sitting in the action; a dialog never shows one, so
`resolveNpcSpawnPoint` (`npcWorldJump.ts`) finds it — the first
`spawnSiteIndex` entry whose `instance` matches the dialog's NPC,
case-insensitively, both UPPERCASED at extraction and by the resolver alike.
First match only, deliberately: an NPC spawned twice needs no invented
winner here, because which of a script's spawns is "the" one is the waypoint
panel's question (slice 9 decision 4's reasoning, again), not a jump button's.

**Same three-answer shape as the action-level jump, one rung taller.**
`npcJumpReason` adds "this dialog names no NPC" above the disabled reasons
`worldHasPoint` already gives — no spawn point known for the NPC, no world
open, not in *this* world — so the two buttons cannot answer differently for
the same fact.

**Naming the world to open, once Daniel asked why "no world is open" didn't
already say which one.** The engine's own rule answers it: it spawns every
NPC from a function named after the world *file* — `STARTUP_NEWWORLD`,
`STARTUP_DRAGONISLAND`, `INIT_…` likewise (`environment-hazards.md`, *"A
candidate is only a game under the name NEWWORLD.ZEN"*) — and `spawnSiteIndex`
already carries that function's name on every site. `expectedWorldNameFor`
reads it off the `STARTUP_`/`INIT_` prefix; when the site's own function does
not follow the convention (a script's own wrapper around `Wld_InsertNpc`, say)
it answers `null` rather than guess, and the message falls back to the plain
"No world is open" — a guess dressed as a fact would be worse than the
generic reason it would replace. Both disabled reasons that turn on `world`
now name it: *"Open NEWWORLD.ZEN to jump here"*, and *"WP_MARKET is not in the
open world — open NEWWORLD.ZEN"*.

**Still read-only, and still short of the world-directory slice.** This names
a `.ZEN`; it does not resolve that name to a path or open it — that needs the
world-directory setting slice 14's closing paragraph asks for, which is what
turns "open NEWWORLD.ZEN" from a message into a click. Nothing here writes a
script either, which is the whole reason this shipped a session ahead of slice
14's closing paragraph
rather than behind it.

**Slice 16 — Insert NPC from the World surface. Sized 2026-09-01; A–E landed
2026-09-02 (Claude), F open.** The card slice 14's closing paragraph
declined to card. Sized into six pieces, because it is the first time the
editor authors into a file it is not editing, and the sizing changed what the
write can be.

**Ground truth, before the design.** Retail has *one* file,
`Content\Story\Startup.d` (4,801 lines, 2,356 `Wld_InsertNpc`), and
`STARTUP_<worldfile>` is a *function* in it, not a file of its own.
`STARTUP_NewWorld()` holds no spawn itself — it only calls
`STARTUP_NewWorld_Part_City_01()` and seven siblings, then `Kapitel = 1;` and
two `PlayVideo`s; `STARTUP_OLDWORLD` and the `STARTUP_ADDON_PART_*` family
follow the same pattern. So "find `STARTUP_<worldfile>`" is: find the function
`STARTUP_` + basename of `worldStore.summary.worldPath` (`.zen` stripped,
case-insensitive) in `projectStore.parsedFiles`, and append to *that*
function. **Decision: append to `STARTUP_<world>` itself**, accepting that
retail's own function delegates to parts and holds no spawns — picking a part
would be a guess, and a spawn appended after the parts still runs. No
world-directory setting is needed for this: the open world's path is already
in the store. The setting only buys the *other* card (opening a `.ZEN` from a
dialog — `expectedWorldNameFor`'s answer becoming a click), so it is slice F,
deferred.

**What the save pipeline is, and what it is not.** `SaveFileFlow` takes a
model, generates it through `CodeGeneratorService` (`allowPartialModel:
false`, so the generator throws on `hasErrors`), parse-gates, writes with
`expectUnchanged` and then `notifySelfWrite`. Unknown statements survive as
generic `Action(text)`, so a non-dialog function survives regeneration *in
principle* — but the roundtrip corpus defaults to `Story\Dialoge`, and
`Startup.d`'s fidelity had never been measured. That measurement is slice B,
and it decides slice C's shape, which is why B lands before C.

**Two facts that shape D and E.** The waypoint half exists: `addWaypointAt`
and the `AddWaypoint` op, with the add-waypoint focus request and the
`pendingWaypointName` arming flow; and `projectStore.npcList` +
`AUTOCOMPLETE_POLICIES.actions.npc` already drive the NPC autocomplete in
`InsertNpcActionRenderer`. The conflict: `notifySelfWrite` suppresses the
watcher for that path, so if `Startup.d` is also open in the dialog editor the
renderer keeps a stale model and its next save hits the mtime guard →
`markExternalConflict`; nothing today handles a self-write to an open file
from another surface. And with no project open `projectPath` is `null`,
`parsedFiles` is empty and so is `spawnSiteIndex` — which is only set at
`buildProjectIndex` and never refreshed by `updateFileModels`.

**The slices, in landing order.** Jest throughout; Playwright cannot reach any
of this, the browser harness has no world.

*A — pure resolver + model edit. Landed.* `components/world/insertNpcScript.ts`:
`startupFunctionFor(worldPath)` → `STARTUP_<BASENAME>`;
`findFunctionFile(parsedFiles, name)` → `{ filePath, functionName, model }`
or a typed refusal — `no-project`, `no-startup-function`, `parse-errors`
when the holding model has `hasErrors`; `appendInsertNpc(model, fn, instance,
wp)` returns a new model with a plain-object `InsertNpcAction` pushed onto
`functions[fn].actions` (plain because the `saveFile` IPC deserialises).
Tests cover the retail shape (`STARTUP_NewWorld` found in a file that also
holds `INIT_NewWorld`), case-insensitivity, each refusal, and that `INIT_` is
never chosen.

*B — fidelity gate. Landed, and the verdict is: not clean.*
`daedalus-parser/test/startup-fidelity.test.js` holds a Startup-shaped fixture
(mixed-case `FUNC VOID`, `Kapitel = 1;`, `PlayVideo`, a commented-out
`//Wld_InsertNpc`, tab indent, trailing comments) and asserts what *is* true:
it parses clean with no `hasErrors`, the commented-out spawn is not an action,
and an appended `InsertNpcAction` regenerates as the last statement of
`STARTUP_<world>` with every original statement intact and `INIT_` untouched.
It does **not** assert byte identity, because regeneration of retail's
`Startup.d` is not byte-identical — measured 2026-09-02 against the real
file: 4,801 lines in, 3,944 out. Three things differ, all cosmetic, all
everywhere: blank lines inside and between functions are dropped; a trailing
`// comment` after a statement is moved onto its own line (`Wld_InsertNpc
(X,"WP"); //Held` becomes two lines); and every `Wld_InsertNpc (X,"WP")` is
re-emitted as `Wld_InsertNpc (X, "WP")`. A block comment inside a function
also gains a tab per line. `npm run test:roundtrip-corpus -- --root
mdk\Content\Story` over 1,383 files: 4 source syntax errors (none of them
`Startup.d`), 0 generated syntax errors, 253 drift files — and `Startup.d` is
one of them: token-fidelity drift at the re-indented block comment, action
multiset drift that is trailing whitespace on comment text and CRLF inside
`ConditionalAction` condition text, and byte-idempotence drift. So a
regenerate-and-save of `Startup.d` would rewrite 4,788 of its 4,802 lines to
add one. **Decision, as sized: slice C's write is a text-level insert** —
find the function's closing `};`, splice `\tWld_InsertNpc (X, "WP");` before
it — not a regenerate. The model edit from A stays the renderer's picture of
the result; it is not what reaches the disk.

*C — main-side write. Landed.* `script:appendInsertNpc` — `main.ts` +
`preload.ts` + `assertAppendInsertNpcRequest` in `ipcValidation.ts` +
`mockAPI.ts` (a typed `function-not-found`: the harness has no `Startup.d`) +
`EditorAPI.appendInsertNpc(filePath, functionName, npcInstance, spawnPoint)`,
returning `AppendInsertNpcResult` from `shared/types.ts`: `{ ok: true, line }`
(1-based) or `{ ok: false, reason }` with `parse-errors`, `function-not-found`
or `external-modification`. The body is `services/AppendInsertNpcFlow.ts`,
`SaveFileFlow`'s shape with no generate step: path-validate for write → read
through `FileService` (its encoding detection is what makes the write-back
byte-faithful) → `parseSource` on the bytes just read → refuse on `hasErrors`
→ find the function case-insensitively → splice `Wld_InsertNpc (X, "WP");`
on its own line before the closing `};`, in the file's own line ending and the
indent of the body's first indented line → `writeFile` with `expectUnchanged`
→ `notifySelfWrite`. The validator refuses `INIT_` outright and requires an
identifier instance and a waypoint without `"` or a line break, because both
are spliced into source verbatim. The Jest suite runs the real parser in a
child process over a CRLF, tab-indented, mixed-case fixture with a trailing
comment and `INIT_NewWorld` beside, and asserts the output is the input plus
exactly one line. The parser now records a `range` on `DialogFunction` — the
closing brace is `lastIndexOf('}', range.endIndex)` — the way it already did
for constants, variables and instances.

**What the mtime guard does and does not buy here, for E.** `FileService`
keeps one cached mtime per path, refreshed by every read and every write. The
flow reads the file itself immediately before writing, so `expectUnchanged`
compares against *that* read: the `external-modification` refusal covers only
the race between the flow's read and its write, never the dialog editor's
stale picture. And after the write the cache holds the flow's own mtime, so a
dialog-editor `saveFile` of the same file from a model parsed *before* the
spawn landed sails through the guard and drops the spawn — which corrects the
"next save hits the mtime guard" sentence above. E's refuse-on-dirty and
reload-if-clean are therefore load-bearing, and they have to live in the
renderer: main has no notion of which files the editor holds open.

*D — the button. Landed.* "Insert NPC here…" sits beside "Add waypoint
here…" on the terrain bar, under the same condition (overlay on: the point
it authors would otherwise be invisible), and opens a dialog with
`VariableAutocomplete` under `AUTOCOMPLETE_POLICIES.actions.npc`
(`allowCreation` off — this dialog creates no symbol) and a waypoint name
prefilled from `suggestedWaypointName()`, with the same duplicate refusal the
add-waypoint dialog makes before the round trip. Confirm runs `insertNpcAt`
in `WorldSurface`: `startupFunctionFor(summary.worldPath)` →
`findFunctionFile(parsedFiles, …)`, each typed refusal to the edit banner as
a sentence; then `await commitOps([addWaypoint])` — a refusal there is
already on the banner and the script is left alone — then the IPC. **A
refusal after the op says the waypoint stands** ("Waypoint X was added, but
…"): the half-state the decision accepted is named, not hidden. The
waypoint panel's "Insert NPC at this waypoint…" is the same dialog with the
name fixed and `existing: true`, which skips the op. Two things it warns
about and never refuses (2026-09-02): an instance the index does not know —
only when `projectStore.npcList` is non-empty, case-insensitively, as a
caption under the field ("X is not an NPC instance this project declares"),
because an empty index means "nothing is known" and an instance declared in
a file the index has not parsed is legal, so C's identifier-shape check stays
the only hard one; and a site `spawnSiteIndex` already holds for the same
instance on the same point ("X already spawns at WP (file:line)"), where the
confirm button turns into "Insert anyway" — retail spawns the same NPC on a
point more than once across chapters. Slice A's `appendInsertNpc` model edit
found its caller in E: D writes through C and never regenerates, and the
edit is the renderer's picture of the one line C spliced.

*E — open-file and index coherence. Landed, renderer-side.* Before anything
is written, `fileStore.openFiles.get(filePath)` under `hasUnsavedChanges`
refuses with the file named; after a successful write the same slot, if
present, goes through `fileStore.reloadFile` — the watcher's own
external-change path, and the only reload there is, since `notifySelfWrite`
has silenced the watcher for that write. `projectStore.addSpawnSite` pushes
the site (instance and waypoint uppercased, the index's own casing, and C's
1-based `line`) onto `spawnSiteIndex`, so the waypoint panel and the spawn
markers show it without a reindex; and `projectStore.updateFileModel` puts
`appendInsertNpc(model, fn, instance, wp)` on the cached model of the holding
file, so a reader of that function's `actions` out of `parsedFiles` is not one
spawn behind and no parse round trip is spent — the IPC's success is the fact
(2026-09-02). Jest covers the order (op before IPC), every refusal, the dirty
refusal, the clean reload, the index gain, the model refresh and both
warnings; Playwright cannot, the browser harness has no world.

*F — deferred, its own card.* World-directory setting on `SettingsService`
(the `gothicInstallPath` pattern), only for `expectedWorldNameFor`'s `.ZEN`
opening.

Three runs: {A, B}, {C}, {D, E} — all run. F is the only open piece.

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
3. **`checkPortalMaterials` gets its consumer — LANDED 2026-09-02, with q1,
   q2 and q3 of §16.22 in the same card** (Daniel: one card, not three; and
   *listed, not clickable* is an acceptable slice 3 — no polygon framing was
   designed or built). What landed, by workspace:
   - **`zenkit-node`** — `getPortals` gained `materials`, `sectorNames` (stored
     order: `sectorIndices` indexes it), `planes`, `cornerOffsets` and
     `corners` (`normalize.cc`, `test/getPortals.test.js`). Geometry rather
     than the scripts' `_drillMesh` fan join, because the join walks every
     polygon of the mesh and this runs on every open; §16.18 says the sizes.
   - **`zen-world`** — `validate/portals.ts`: `checkPortalPairing` (q1),
     `PORTAL_PLANARITY_TOLERANCE = 12.1` and `checkPortalPlanarity` (q2),
     `PORTAL_ONE_SIDED_MIN_SHARE = 0.25` and `checkPortalOrientation` (q3),
     and `checkPortals`, which runs all four over the readout and pins each
     finding to the first portal face carrying its material — `null` for a
     name no face carries, since the mesh keeps unused materials.
   - **the editor** — a thirteenth worker op, `portalFindings`, which runs
     `checkPortals` **in the worker** and sends findings only: nothing on the
     renderer side frames a polygon, so 4.9 MB of corners had no reader there.
     `WorldService.getPortalFindings`, `world:portalFindings` (no payload, so
     no validator — like `world:waynet`), `worldStore.portalFindings` +
     `portalsLoaded`, the `storeSync` re-scan on its identity, and
     `problems/domain/rules/portals.ts` — five `ProblemRuleId`s, one per
     finding kind: `portal-material-malformed` and
     `portal-material-unknown-sector` as errors (no retail world has either),
     `portal-unpaired`, `portal-non-planar` and `portal-reversed` as warnings.
     `WorldSurface` reads it once per open after the waynet; no op touches the
     mesh. The row lists as `World · polygon N` and is disabled — `worldFocusOf`
     answers null, pinned in `problemsPortalFindings.test.tsx`.
   - **Witnessed on all four retail worlds** with the built addon
     (2026-09-02): pairing, planarity and the material checks fire nowhere;
     orientation fires on `P:CAPTAIN_` and nothing else. No real world has
     been opened in the app with it — the Jest suites fake the worker — and
     no seeded defect has been through it; Gate 3 (§11) is still Gate 3.

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
   human's call, not a run's. (It was: Daniel, 2026-09-02, above.)

**What this does *not* unblock, and must not be smuggled in.** Leak
flood-fill, intersections and triangle limits are still Phase 2 with their own
Gate 3 (§11); pairing, planarity and orientation joined the card only because
§16.22 had measured them. Occupancy and overlap checks become *possible* here
and stay uncarded: §16.19 lists them under Phase 1c and they want the spawn
index they now have plus a rule nobody has specified.

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
apart rather than reported unpaired (they have no mirror to look for).
**Written and consumed 2026-09-02** — `zen-world`'s `checkPortalPairing`,
reaching the Problems panel as `portal-unpaired` through §16.20 slice 3; zero
findings over the four retail worlds.

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
**Written and consumed 2026-09-02** as `PORTAL_PLANARITY_TOLERANCE = 12.1` and
`checkPortalPlanarity`, reaching the panel as `portal-non-planar`. Re-measured
off `getPortals`' own Float32 corners rather than the fan join: OldWorld's
worst is 12.0968, NewWorld 6.92, AddonWorld 5.03, DragonIsland 0.45 — all
inside, zero findings.

**q3 ran 2026-09-02: the normal points into the first-named sector.**
`scripts/check-portal-orientation.js` rides the same `getPortals` walk and the
planarity script's verified fan join (`polygonCorners` is now exported from it,
and `sidesOf` from the pairing script), and needed no C++: a sector's polygons
carry the material `S:<sector>_<material>` and no sector name holds an
underscore (§16.18), so membership is read off the material name —
`sector_index` is -1 on every retail polygon and `bsp.portal_polygon_indices`
is empty in every retail world, so neither is one. The number per portal is
the signed distance of each named sector's centroid from the stored plane.
Over the four worlds, **every two-sided `P:A_B` the centroid test can decide
is front-named** — 355 of 443 in NewWorld, 46 of 52 in OldWorld, 140 of 140 in
AddonWorld, 226 of 226 in DragonIsland — and the 94 it cannot decide (both
centroids on one side: 44 + 44 in NewWorld, 3 + 3 in OldWorld, always as a
pair, since `P:A_B` and `P:B_A` share the plane) all lean the same way,
*more of A than of B in front*. Those are nested sectors (`P:HH1_HH7`, the
thief-guild rooms), where a centroid is the wrong instrument and a
corner-fraction is the right one — so a check must judge by corners, not by
centroid, or it flags retail. One-sided portals (`P:A_`, `P:_B`, the empty
side outdoors) agree at 97.7–100 %, with six exceptions in three portals:
`P:GRPTURM01_`/`P:_GRPTURM01` and `P:DT1_`/`P:_DT1` (the named sector 28–31 %
in front — a doorway on the edge of a large sector, so a centroid artefact
again) and `P:CAPTAIN_` (1 % in front, on NewWorld and DragonIsland alike),
which is the one row that reads as a genuinely reversed retail portal. So the
convention is settled — front-named, `n` into A — and a check on it would be a
warning that fires once on shipped content; whether to write it is a person's
card, as q1 and q2's are. `test/portalOrientation.test.js` pins the sector
parse, the centroid arithmetic and the verdict on a fixture; the corpus half
needs `worlds/`.

**Written and consumed 2026-09-02** as `checkPortalOrientation`, reaching the
panel as `portal-reversed`, judging by corner share as the paragraph above
demands. The re-run by corners, over the four worlds through `getPortals`'
own geometry, is what fixed the two rules. **Two-sided:** reversed when a
larger share of B's corners than of A's is in front; no threshold, and the
closest retail portal is 0.14 apart (`P:EG1_EG3`, OldWorld) — zero findings.
**One-sided:** there is no second sector, so the judge is the share of the one
sector on the convention's side, and retail is a continuum there, not a
cliff: `P:GRPTURM01_` 28.4 %, `P:DT1_` 30.9 %, `P:WAFFENKAMMER_` 47.8 %
(this one the centroid run had not listed), `P:OCAR02_` and two `P:BAMBUS01_`
faces at exactly 50 %, then everything else above. Below 28.4 % there is
nothing until `P:CAPTAIN_` at **0.8 %**. A majority rule flags four shipped
portals; the cut is therefore `PORTAL_ONE_SIDED_MIN_SHARE = 0.25` — in the
gap, the way q2's tolerance is the worst shipped value — and the whole check
fires exactly once over the corpus: `P:CAPTAIN_`, on NewWorld (polygon
456754) and its DragonIsland copy (71186). Its `P:_CAPTAIN` mirrors are
85–88 % and pass, which is what a genuinely reversed one-sided portal looks
like from the other side.

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

### 16.24 The locator that stops working after a paste (2026-08-30)

Five of the six findings from Daniel's first real editing sessions landed
2026-08-30 — the selection emphasis, the mode-dependent gizmo anchor, the pick
occluder, the paste offset and selection, and the property grid's locator. Their
record is `git log` and `docs/architecture/level-editor.md` §7, *"What a
selection is on screen, and what a click can reach"*. This one is still open,
and now has more ruled out than in.

**Two things those five left behind, carried off the board.** The rotate gizmo
still anchors on the **last VOB picked**, not the centroid — deliberate, since
`rotateVobs` turns each VOB about its own origin, so whoever lands
rotate-about-a-pivot moves the anchor in the same change. And `duplicateVobs`
was **left alone**: Ctrl+D still drops the copy inside the original, because the
card named paste and only paste. None of the five is witnessed on a real screen
either — the browser harness has no world and `verify-world-edit.js` needs a
Gothic install, the addon and a GPU, so the Jest component tests are the whole
verification.

**The report.** After a paste, the scene tree's locator stops working on every
VOB — not only on the copies.

**What is established.** The path is `onFocus(vob)` → `WorldSurface.focusVob` →
`viewportRef.current.frameVob(vob)` → `frameVobRef.current(vob)`. It used to be
optional-chained end to end, which is why the failure was invisible rather than
why it happened; that half is fixed — `frameVob` answers `no-scene` or
`not-drawn`, and `focusVob` warns. **A repeat now leaves a console warning
naming which link gave way, and that is the next thing to collect.**

**What has been ruled out, and how.** Two probes, both green, both kept:

- `WorldViewport.frameHandle.test.tsx` — the handle survives `visuals` being
  replaced, which is what a structural op does to it. So the scene effect's
  teardown-then-rebuild does not strand `frameVobRef` on its own.
- `WorldSurface.editing.test.tsx` — the locator still fires after a real
  Ctrl+C/Ctrl+V through the surface, index re-read and all. So the wiring from
  the tree's button to the viewport survives a paste in the harness.

So the standing hypothesis — `if (!host) return;` at the top of the scene
effect, which returns no cleanup and would leave the ref null for the world's
life — is **not reachable in either harness**: `hostRef` is on the always-
rendered `Box`, and nothing unmounts it. It is still the only known way the ref
can be stranded, so it stays the first thing to check against a real world.

**What neither probe covers**, and where to look next: a real GPU, a real world,
and the async work a structural re-read starts — `loadPendingTextures`, the BVH
build, the two separate awaits in `applied` that produce *two* rebuilds per
paste rather than one. A paste that rebuilds the scene twice in quick succession
is the one shape the harness does not reproduce, because both its payload reads
resolve in the same tick.

**Root cause, from Daniel 2026-09-01: most VOBs were never locatable at all.**
He noticed the locator does nothing on a `zCVobSpot` or an `oCItem` *ever*,
paste or no paste. It is `WorldScene.positionOf`: it reads the instance matrices,
and `buildInstancedScene` gives a VOB an instance only when its visual name is
non-empty and `extractVisual` resolves it. So every class the viewport draws
nothing for — spots, start points, items (whose visual the engine sets from the
script instance, not the `.zen`), sounds, triggers, zones, `zCVobLevelCompo` —
answered `not-drawn`, and the honest report §16.24 5 added was reporting a
defect, not a legitimate miss. `focusVob` now falls back to
`reader.position(vob)` — the index carries a position for every VOB — through
the existing `framePoint`, the same jump a waypoint gets. Covered by *"frames a
VOB with no drawn instance at its stored position"* in
`WorldSurface.editing.test.tsx`.

**What that leaves open.** Whether a paste *also* breaks the locator for drawn
VOBs is now unwitnessed either way: the original report is fully explained by
this if the VOBs Daniel tried it on were undrawn, and the two probes above stay
green regardless. Re-open only on a repeat that names a drawn VOB.

### 16.25 Scatter placement — a tool Spacer does not have (2026-08-30)

**Asked for by Daniel 2026-08-30 as "the foliage painting tool in Spacer".
Checked: Spacer has no such tool.** The
[GMC's Spacer reference](https://gothic-modding-community.github.io/gmc/zengin/worlds/spacer/)
lists the whole of its VOB placement as *insert one VOB from the Create tab's
right-click menu*, plus a physics button that drops the inserted object onto
the terrain and a grid snap. There is no brush, no scatter, no multi-placement.
What the search turns up under that name is **Spacer.NET**, the Union-based
modernisation, whose own pitch is "maximum automation of the vobbing process" —
a different tool, not the MDK Spacer §14 measures parity against.

So this is not a §14 row and must not be filed as one: it is a **past-Spacer**
feature, and its home is §11's question of where the editor goes beyond parity.
It is carded because the request stands on its own merits — placing a forest one
`AddVob` at a time is the single most tedious thing the World surface asks of a
modder, and every piece it needs already exists.

**What it would be built from, all of it already landed.** A scatter is N
`AddVob`s in one batch with one undo entry, which is exactly what `duplicateVob-
Subtree` + `commitOps` already do for a subtree paste (§14.1 1.2, D5); the
per-VOB ground placement is `dropVobsToGround`/`alignVobsToNormal`, which
already take per-VOB raycast hits and batch to one op per VOB (§14.1 1.6); the
raycast is `WorldViewportHandle.raycastDown` against the existing BVH. Nothing
in the op set, the validator or the binding has to change. That is the reason to
believe the estimate: the work is a brush *interaction* over machinery that
exists, not a new op.

**Landed 2026-09-03.** The four open decisions were settled by Daniel that day
and the tool was built the same session; what follows the decision list is the
record of what it became. The three that shaped it: **spacing plus a capped
batch** (a stroke is one batch, so the cap bounds what §15's undo bar is
handed), **no erase** (`DeleteVob` is the one op with no inverse and a history
barrier — an erase that cleared the undo history was judged worse than none),
and **random yaw plus ground align** (no scale: `zCVob` has no scale field).
The fourth, whether the palette persists across strokes, was decided in the
build: **it does not**. The palette is read off the live selection every
stroke, so there is nothing to store, nothing to migrate, and nothing that can
name a VOB the world no longer holds.

**Three layers, split by what each one is able to answer.**

1. `zen-world/src/model/scatter.ts` — `strokeCandidates` turns the raw pointer
   stream into candidate positions, each with a yaw and a palette member. It
   cannot see the world, so every candidate is a *guess*. It decimates the
   samples itself, at a quarter of the radius, because the decimation distance
   is a function of a setting rather than of anything a pointer handler holds;
   it draws from a seeded `mulberry32`, so a stroke is reproducible from one
   number; and **it applies the cap**, before a single ray is cast, because the
   cap exists to bound the batch rather than the work.
2. `WorldViewport` — one downward raycast per candidate, it being the only
   layer holding a BVH. **Lifted by the brush radius before the ray is cast**:
   a candidate that fell uphill of the cursor has its ground *above* the
   cursor, and a ray from the sample height would pass through the slope and
   report the far side of the hill.
3. `scatterVobs` in `ops.ts` — the survivors become one batch of ordinary
   `AddVob`s. **No op, no validator branch, no binding change**, which is the
   same reason D5's subtree and D3's paste needed none: `AddVob` already
   carries a whole description of a VOB and already inverts to a delete.

**What `scatterVobs` adds over `duplicateVobs` is the pose, and it is rigid
about each copy's own root.** A palette member may be a subtree — a torch is a
`zCVob` with a fire under it — and ZenGin VOB positions are world-space, so a
root turned alone leaves its children behind and a root moved alone leaves them
standing over the original. Every descendant therefore takes the same rotation
on the left and has its position carried through the same transform.
`posedSubtree` is a separate walk rather than a transform over what
`duplicateVobSubtree` returns, because **the bbox has to be fitted in the pose
the copy lands in**: refitting from an already-placed box would grow it every
time — an axis-aligned box rotated and re-bounded is strictly larger — and a
forest painted over a few times would end up culled by boxes the size of
houses.

**The cursor is draped over the mesh, not flat, and that is the second thing a
person asked for** (Daniel, 2026-09-03: "project the circle of influence on the
world mesh as a thin line akin to the outline shader"). `ScatterRing` finds
each of its 48 vertices by its own downward ray — the *same* ray a placement
makes — so the ring is a prediction rather than a decoration. A flat disc in
the tangent plane is what it was built as first, and it is wrong in exactly the
terrain the brush is for: on a hillside it cuts through the hill on one side
and floats over the valley on the other. A vertex with no ground under it falls
back to the cursor's own plane rather than breaking the loop, because a broken
ring reads as a rendering fault where a closed one reads as "the brush reaches
here and there is nothing under it". The vertices are written in world space
with the object's own transform left at identity: a draped ring is no longer a
rigid circle, and no single position and rotation describes it.

**What is not there, and none of it is an oversight.** No preview during the
stroke — the placements appear on mouse-up, in one batch, and the ring is the
only feedback before then. No erase, by the decision above. No scale variation,
there being no field to vary. The cap is 200 and is deliberately **not** a
toolbar field: raising it is a measurement somebody has to make against the
undo bar and the structural re-read, not a number a user should be able to
type.

**Unwitnessed:** how a painted stroke actually looks, and whether 48 segments
of ring re-draped on every pointermove stay smooth on a real GPU over retail
terrain — the ring's geometry is asserted against a fake ground in
`ScatterRing.test.ts`, and nothing in jsdom draws a pixel. Also unwitnessed in
an engine: a scattered subtree, though it reaches the world down the same
`AddVob` path Gate 2b witnessed for the 27 authorable classes.

**What was undecided when this was carded, and how each was settled.**

- **What the brush paints — partly settled 2026-09-02 (Daniel).** The palette
  is assembled by selecting a handful of already-placed VOBs in the scene as
  the scatter set, not a typed name or a stored settings blob — the tool reads
  its distribution off a selection rather than off a separate palette editor.
  **Settled in the build 2026-09-03: rebuilt every stroke**, off the live
  selection, so nothing is remembered and nothing can name a VOB the world no
  longer holds.
- **Where the models come from — confirmed 2026-09-02 (Daniel): the assets.**
  Same source as everywhere else, no separate model list — the palette is
  drawn from the VFS asset namespace `WorldAssetBrowser` already walks. That
  **That prerequisite closed 2026-09-01/02/03** — mesh preview, the "Use as
  visual" picker and the thumbnail grid all landed (§16.26 row 1), which is
  what unblocked this card. Note what the brush actually does with it: the
  palette is *placed VOBs*, so a model reaches a stroke by being placed once
  and selected, and the asset browser is how it got placed.
- **Randomisation, and its reproducibility — the scale half dropped 2026-09-02
  (Daniel): not needed.** `zCVob` **has no scale field** (§14.1's "Not a gap"),
  so size variation was never available; Daniel does not consider that a
  blocker. **Rotation about the up axis settled 2026-09-03 (Daniel): random
  yaw, then align to the surface normal** — the yaw and the stand-up compose
  in that order, and a seeded RNG makes the whole stroke reproducible.
- **Density and the undo entry — settled 2026-09-03 (Daniel): a spacing
  slider and a hard cap of 200 per stroke.** The concern stands exactly as
  written — §15's undo bar has never been shown a batch that size, and neither
  has the structural re-read path (§16.24's two rebuilds per paste is the same
  machinery) — so the cap is what keeps a stroke inside sizes that *have* been
  shown. Raising it is a measurement, not a preference, which is why it is a
  constant and not a field.
- **Erase — settled 2026-09-03 (Daniel): not in this version.** The reasoning
  is unchanged and is why: the natural inverse of a paint stroke is a delete
  stroke, `DeleteVob` is the one op with no inverse and a history barrier
  (§14.1 1.1), and a scatter tool whose erase clears the undo history is worse
  than no erase. **This is the one piece of the tool still wanted**, and it is
  blocked on giving `DeleteVob` an inverse rather than on anything about the
  brush.

**Landed 2026-09-03, and unwitnessed in two ways:** how a stroke actually looks
on a real GPU, and what draping the brush ring over the mesh costs there.

**A second gap the same check surfaced, unscheduled and not carded:** a
mesh-capable model browser wired as a picker into `insertVob` and
`setVobProp.visual` — the VFS-browsing half exists, corrected in §16.26 row 1.
It is a prerequisite for a usable scatter tool and it is independently
useful for §14.1 1.3 and 1.7. Also absent, and deliberately noted here so the
next parity question does not re-derive it: Spacer's first-person navigation
modes (F3/M/T/C) and its two camera slots, against our orbit plus focus/frame.
Everything else the GMC page lists is already in §14 — mesh-editor mode's
triangle material assignment, portal setup, leak detection and polygon check
under 3.4/3.6, the multi-ZEN macro system under 3.3, the physics drop under
1.6, `cdDyn` under 1.8.

### 16.26 Three gaps §14 never inventoried, and Spacer.NET's own list (2026-08-30)

**Spacer.NET has no foliage brush either.** Its published feature list — the
same twelve items on the
[GitHub repo](https://github.com/postm1/SpacerNET_Interface) and the
[Steam Workshop page](https://steamcommunity.com/sharedfiles/filedetails/?id=3261221886)
— is entirely VOB-editing quality of life: hierarchical copy, reparenting,
collision-free manipulation, preview models, PFX and item support, VobTree
support, chest-contents editing, Union extended classes, FPS/VOB counters. No
brush, no scatter, no randomised or mass placement anywhere in it. So the
scatter tool of §16.25 is not a thing we lack — **it does not exist anywhere in
the ZenGin tooling lineage**, and building it is invention, not catch-up. That
is worth knowing before it is estimated: there is no reference implementation
to copy and no modder muscle memory to match.

Reading that list against ours also settles two things that look like gaps and
are not. **Reparenting is landed** — `ReparentVob` is validated in
`ipcValidation.ts` and driven by drag-and-drop in `WorldSceneTree` — CLAUDE.md
tells its "shipped refused" story in the past tense, as the cautionary tale it
is, and that reads as a live gap on a fast skim. **Hierarchical
copy is landed** (§14.1 1.2 D5). What is genuinely missing is below.

**1. A model browser — corrected 2026-08-30, this row overstated the gap.**
Spacer's *VOB Bilder* and Spacer.NET's *preview models* browse the available
visuals by name, with an image. **That half already exists**: `WorldAssetBrowser`
walks the mounted VFS namespace one directory at a time over `vfsList`
(`world:assets`), and `WorldAssetPreview` renders a selected file's texture to
a 2D canvas via `decodeTexture` — both live in `WorldSurface`'s Assets panel
today, not a text field. Three things are still missing, and none of them is
the VFS plumbing:

- **Mesh preview — landed 2026-09-01.** It previewed textures only;
  `extractVisual` was wired into the worker but never called from the panel.
  Now a file with any extension the binding resolves (`.MRM`/`.MSH`/`.MMB`/
  `.MDM`/`.MDL`, and the source names `.3DS`/`.ASC`/`.MDS`/`.MMS`) goes over a
  new `world:visual` channel (validator `assertVisualRequest`, service
  `getVisual`, worker op `visual`) to `zen-world`'s new `buildVisual` — the
  same `mergeChunks` path `buildInstancedVisuals` takes, so the preview shows
  the geometry the world would place, attachments transformed; `visualBounds`
  now delegates to it. The renderer side is `VisualPreviewScene`
  (`buildVisualPreview` + `frameVisual`, no React, no WebGLRenderer, tested by
  scene-graph assertions) under `WorldScene`'s own `drawGroupGeometry` and
  `dataTexture`, factored out as exports rather than copied, so scale, mirror
  and winding are the viewport's. Materials are Lambert under a hemisphere and
  a key light — a proto mesh has no baked light word, and alone on a canvas a
  `MeshBasicMaterial` is a silhouette — textured with the world's maps at 256
  px, fetched after the first frame; `.TEX` still draws to the 2D canvas. The
  panel frames the bounds and orbits with `OrbitControls`, drawing only while
  the orbit moves or a texture arrives. An unextractable name says so. **Not
  done**: no picker wiring and no thumbnail grid — the two bullets below — and
  `.MDH` alone is refused as "neither", which is right (a hierarchy has no
  geometry). One fact for the grid: `world:visual` transfers a freshly
  built payload per click with no cache, so a large `.MDL` re-extracts on every
  re-selection — fine for a panel, and the thumbnail grid will want the worker
  to cache or the renderer to memoise per name.
- **It is a namespace explorer, not a picker — landed 2026-09-02.** The
  preview of any mesh the binding can place (the same extension list the mesh
  preview keys on, now `isPlaceableVisual`) carries a **"Use as visual"**
  button that writes the file's bare name — what retail stores, `NW_CRATE.3DS`
  and never a directory — to the whole selection through `handleEditProps`,
  the grid's own path: one `SetVobProp` per VOB, one batch, one undo entry,
  the box refitted only when the name resolves. Disabled, with the reason,
  when nothing is selected. The place-a-VOB dialog's visual field has a
  **"Use previewed"** button beside it that fills in the same name; the
  previewed path already lived in `WorldSurface`, so it outlives the tab and
  the gesture is preview, switch to the scene, click the ground, place. No new
  op, no new IPC. Two things it does not do: it writes the compiled name the
  browser lists (`.MRM`) rather than deriving the source name retail would
  carry (`.3DS`) — the engine and `extractVisual` resolve either, and the
  mapping is not one-to-one for `.MDL`/`.MMB`; and it does not pre-check the
  selection for a VOB with no visual object, which the binding refuses the
  same way the grid's field does for a multi-selection. What is left is the
  thumbnail grid below.
- **Thumbnail grid — landed 2026-09-03.** A list/grid toggle in the Assets
  panel (`WorldAssetGrid.tsx`, react-window `FixedSizeGrid`, 96 px tiles).
  The picture is the editor's own: `ThumbnailRenderer.ts` draws
  `VisualPreviewScene`'s scene — same geometry, lights, `frameVisual` — once
  into one reused offscreen `WebGLRenderer` (a context per tile would exhaust
  the browser's budget inside one directory), textures fetched at 64 px
  before the draw; a `.TEX` is a 2D scale. Cached **machine-locally** in
  `userData/asset-thumbnails/<sha256>.png` (`ThumbnailCacheService.ts`),
  never beside the project: the key is the name plus each mount's path and
  mtime in mount order, since the VFS answers "which file" and nothing else,
  so a rebuilt VDF or a reordered source list changes the key. A loose
  directory's mtime does not follow its files, which is why the grid has a
  redraw button. `world:getThumbnail` answers the key and the PNG or null;
  the renderer — the only process with a GPU — draws and `world:putThumbnail`
  stores under that key, the bytes checked as PNG and capped at 512 KB. The
  worker caches nothing and the renderer memoises nothing
  (`assetThumbnails.ts`): the PNG cache *is* the memo, at the layer where it
  survives a restart, and a name is extracted once and never while its PNG
  exists — the one access pattern the grid has. Tiles ask as they mount, one
  draw at a time in request order, the queue dropped when the listing moves
  on; a name the binding cannot extract is a marked tile, not a pending one.
  **Wants a human eye:** the pictures themselves — framing, lighting and the
  texture fetch are scene-graph-tested under a mocked renderer, and nothing
  in jsdom draws a pixel.

So the honest framing: the *asset access* layer §14 assumed was missing is
landed, and so are the preview, the picker and the grid on top of it.

**Wanted on top, 2026-09-02 (Daniel): favorites and categories on the asset
browser.** Neither exists — the browser is a plain VFS directory walk with no
way to mark or group visuals. **Persistence decided: a project sidecar, so
it's committable** — not an app-level setting, the same shape as the VOB
folders sidecar (`docs/plans/vob-folders.md`), though that one is scoped to a
world and this is asset-browser-wide, so it wants its own file, not a section
of `<worldname>.folders.json`. **Categorization reference named: `vobbilder`
(the "VOB-Katalog" tool, Felix Horn / HornOx, a static HTML+JS Spacer-era
catalog)**, which Daniel already has installed and calls sensibly
categorized — its scheme is a **hand-authored, hierarchical category tree**
keyed by category path (e.g. `Items/Bögen und Armbrüste`, `Items/Sonstiges`),
each category listing `(source directory, base name)` pairs across G1 and G2
assets, not derived from the VFS directory layout at all. That's the bar for
"sensible": a curated taxonomy, not an auto-grouping by folder.

*Landed 2026-09-03, seeded from the tree (decided by Daniel 2026-09-02).*
`scripts/convert-vobbilder.js` reads the tool's `neue_daten.js` (cp1252;
per category path an array of `(dir, baseName, view, games)` tuples, `games`
a bit set — 1 G1, 2 G2, 4 the author's own) and writes
`src/shared/assetCategorySeed.json`: **32 categories, 1,396 G2 entries** as
`<BASE>.3DS` source names, author and URL in its `$source`; the tool's own
thumbnails are not shipped. The sidecar is **`<project>.assets.json` beside
the project file** (`AssetCatalogService.ts`, `project:getAssetCatalog` /
`saveAssetCatalog`), holding only what the project added — favorites and
categories — and merged with the seed at read time (`mergeCatalogs`,
`zen-world/src/model/assetCatalog.ts`), so the sidecar stays a diff and a
seed update reaches every project. A visual is identified by `assetKey` —
bare name, no extension, case-folded — because the VFS lists `NW_CRATE.MRM`,
a VOB carries `NW_CRATE.3DS` and vobbilder stores neither. The UI is a
Browse / Favorites / Categories switch on the Assets panel once a project is
loaded; every tile carries a star and a file-into menu (any known category,
or a new one typed in place); a category view can unfile the project's own
entries and not the seed's. **Not done, by choice:** no removal or renaming
of seed categories, no nesting beyond the path string, no export of the
merged tree — a category's tiles ask the binding for the seed's `.3DS`
names, so a seed entry the mounted sources lack is a marked tile, which is
also the only way to learn the seed names an install does not have.

**2. Container contents.** Spacer.NET calls it "convenient editing of chests
contents". `oCMobContainer`'s catalogue is the thirteen `oCMobInter` fields plus
`locked` and `pickString` — the item list itself is not there, because it is a
**list field, and list fields are out of `SetVobClassProp` by decision** (§14.1
1.4): they would be the first unbounded payload in the op set. So this is not an
oversight to correct but the first concrete demand for the thing that decision
deferred, and it should be the case that reopens it. Note the cross-reference
problem it inherits from `oCItem.instance`: contents are Daedalus item symbols,
so validation splits across the IPC boundary exactly as that field's did, and
"nothing is known" must not mean "nothing is legal".

**Reopened 2026-09-02 (Daniel): wanted, and not as a bare list.** The contents
editor should be the same visual grid the thumbnail-grid gap above still wants
— pick items by picture, not by typing or choosing an instance symbol from a
list — so this converges with row 1's thumbnail grid into one component rather
than two. The two things that decision left unaddressed are unchanged by the UI
choice: the list-field plumbing itself (§14.1 1.4's unbounded-payload concern),
and the cross-reference validation split inherited from `oCItem.instance`.

**Landed 2026-09-03.** `contents` travels as the archive's own `contains`
string through the existing `SetVobClassProp` — `{ key: 'contents', kind:
'string' }` on `OC_MOB_CONTAINER_FIELDS`, and the C++ case writes it
(`binding.cc`, `1/18` in `mutations.test.js` round-trips it). The grammar is
retail's, surveyed over the 294 chests of NewWorld/OldWorld/AddonWorld:
`INSTANCE[:COUNT]`, comma-separated, no count meaning one; two chests carry a
space after the comma and one a `;`, so the reader takes both and the writer
emits the majority form (`zen-world/src/model/containerContents.ts`). The
validator refuses a `to.contents` that is not that grammar or is over 4 KB,
`to` only, the `instance` rule (`ipcValidation.ts`); the renderer holds the
index: `ContainerContentsField.tsx` draws a row per entry with a count and a
remove, and "Add item…" opens a picker over the loaded scripts' item
instances, each drawn with the visual its `C_ITEM` declares — read off the
instance's `sourceText` by a regex in `WorldSurface`, since the semantic model
keeps no per-field record of an item — through the Assets panel's own
thumbnail queue. With an index, the picker is the only way in; with none, a
name is typed and shape-checked, "nothing is known" never being "nothing is
legal". A string the grammar cannot read is shown as it is with a Clear, never
rewritten. §14.1 1.4's list-field sentence is narrowed accordingly. **No
engine has played a written `contents`** — the binding round-trip is the
witness so far; an item whose visual is assigned through a constant has no
picture and is offered by name.

**3. First-person navigation.** Spacer has four movement modes (F3, M, T, C)
and two camera slots; we have orbit, focus-on-selection and frame-world. A
modder placing objects along a path walks it in Spacer. This is the cheapest of
the three — it is `renderer/world/cameraNav` and no op, no binding, no
validator — and it is the one with a real design question hiding in it: a
walk mode wants collision against the world mesh to be useful, and the BVH that
would answer that is already built for picking.

*Landed 2026-09-01, the fly half:* hold the **right mouse button** in the
viewport — the drag looks (yaw about world up, pitch clamped short of the
poles, no roll), **W/A/S/D** move along the view, **Q/E** descend and climb
along the world's up, **Shift** is four times faster. No mode key: the right
button was free (OrbitControls' RIGHT is `null`) except for the click that
opens the context menu, and a hold is told from a click by whether it moved
anything — a hold that did opens no menu on release. Speed is the distance
from camera to orbit pivot at the moment the hold began, clamped to 2–2000
m/s, so a camera framed on a barrel walks and one framed on the island crosses
it in about a second. On release the orbit pivot is re-seated on the world
mesh under the centre of the view, or failing that at the starting distance
along the view axis, so the next orbit turns about what is being looked at and
the next dolly and pan keep their scale; W/E are the fly's while held and the
surface's gizmo-mode keys again after; the gizmo is switched off for the
hold exactly as it is for an Alt+left orbit. Pure logic is
`renderer/world/flyNav.ts` (`Fly`, `flySpeedFor`, `pivotAhead`), wiring in
`WorldViewport` beside the context-menu handler. *Landed 2026-09-02, Spacer's
camera slots:* four per open world, **Ctrl+Shift+1..4** stores the pose
(camera and orbit pivot), **Ctrl+1..4** recalls it — by key code, since Shift
turns the digit into `!`; `Ctrl+digit` was bound nowhere in the app. Per
session, reset when a different world opens, no persistence
(`renderer/world/cameraSlots.ts`, wired beside `.`/`Home`). *Landed
2026-09-02, the walk half:* **F3** toggles it — Spacer's own key, free here
(Ctrl+W was proposed and dropped: Electron's default menu binds it to Close).
The mouse looks under **pointer lock**, the app's first use of it: a look
with no edge to run into, requested on the F3 keydown because the lock needs
the user's activation, entry optimistic and `pointerlockerror` the rollback.
A walker is the spawn overlay's dummy — 25 cm radius, 130 cm cylinder, eye at
180 (`SpawnOverlay`'s `DUMMY_*`, now exported, so the figure lives once) —
at 4 m/s, Shift ×4, gravity 9.8, fall capped at 20 m/s so a stalled 0.1 s
frame moves under a storey. Pure logic is `renderer/world/walkNav.ts`
(`Walk`, `resolveWalkCapsule`, `snapWalkToFloor`, `findWalkEntry`); it
integrates in Three metres and crosses into ZenGin centimetres only for the
BVH, which is built on the mesh's raw buffers. Walls: the capsule's axis as a
`Line3`, `shapecast` over the picking BVH, each overlapping triangle pushing
the segment out along its closest-point direction, three rounds — no
`Raycaster`, a capsule is not a ray; a mesh whose tree has not landed yet is
walked through and caught next frame. The push is by nearest point, so the
frame's move is cut into pieces of half a radius — a sprint at 60 fps moves
more than a radius a frame and would be pushed on through a wall. Floor: a
ray down from 10 cm above the feet, `raycastFirst` both sides, snapped within
15 cm; no step or slope logic beyond that, no jump. Entry: the current spot
first (open air resolves in one test), then upward in 0.5 m steps to the
world's top — `zenBoxToThree(bbox).max[1]`, the bound the frame-world
camera already reads — and a search that finds nothing enters nothing and
says nothing. Mutually exclusive with the fly (F3 bails during a hold, the
right button starts nothing during a walk); under lock the click, double-click,
context menu and nav press all fire at frozen coordinates and are declined;
`controls.enabled`, the gizmo and its helper are snapshotted at F3 and
restored exactly at exit, the `gizmoBeforeNav` precedent, since a walk is a
mode and not a hold; `Home` and the slots keep working because `Walk.step`
reads the camera fresh each frame; the exit re-seats the pivot on the mesh
under the crosshair, else 5 m ahead — the fly's reach does not transfer, a
walk can cross the level. WASD keys are taken on capture (`onWalkKey`) so
they never reach the surface's W/E mode switch. **Unwitnessed:** the feel of
speed, gravity and snap on a real ramp, the lock itself in Electron, and the
entry search's cost on a retail world — all three want a human at a GPU.
Also unbound and cheap once a walk exists: Spacer's two camera slots.

None of the three is scheduled. They are carded as one line because they share
a cause — §14 was assembled against Spacer's *verbs*, and these are its
*windows and modes*, which nobody enumerated until 2026-08-30.

### 16.27 Four findings from Daniel's 2026-09-02 in-app pass — one carded, three confirmed fine

Four of the "five looks" (board, §16.19/§16.26/§16.12's landed features) came
back with findings. Each was diagnosed by a separate read-only pass before any
fix; only item 1 is a real bug — items 2-4 were retested and confirmed working
as built, so nothing there needs a code change.

**1. Undo doesn't revert the 3D mesh after "Use as visual" — fixed
2026-09-02.** `applied` gained a `visual`-aware trigger beside `isStructuralOp`
— a batch holding a `SetVobProp` whose `to` carries `visual` re-reads
`getWorldVisuals()` and nothing else, leaving the index alone because nothing
renumbered. The forward path's hand-written fetch in `handleEditProps` is gone
with it: the commit goes through `applied` too, so keeping both would have paid
an open's worth of work twice per visual change, and the duplication is what let
the two paths disagree in the first place. Three tests: the undo re-reads, the
`MoveVob` undo still re-reads nothing, and a forward edit fetches exactly once.
The diagnosis it replaces: `applied()` only re-fetched
`getWorldVisuals()` — the call that rebuilds the `InstancedPayload` the
viewport renders from — when an op is `isStructuralOp` (`AddVob`,
`ReparentVob`, `DeleteVob`; `zen-world/src/model/ops.ts:539`). `SetVobProp` is
never structural, regardless of which field it touches, so the inverse
`SetVobProp` that undo replays patches `worldStore` (`applyEdit`, correct —
the property grid reads from there and shows the old name) but never
triggers a re-read of the mesh payload. The forward edit only works because
`handleEditProps`'s "Use as visual" call site has its own hand-written fast
path (`if (props.visual !== undefined) setVisuals(await
window.editorAPI.getWorldVisuals())`) — a path `runHistory`/`applied` never
goes through, since undo and redo bypass `handleEditProps` entirely and call
`applied(ops)` directly. Redo goes through the same gate and should show the
identical bug, just harder to notice since redo's target already matches
what's on screen. **Fix shape**: `applied` needs a `visual`-aware trigger
(any op — forward or inverted — whose `to`/`from` touches `visual`) beside
`isStructuralOp`, not instead of it. **Test gap**: no test asserts
`getWorldVisuals` is called for an undo of a visual-carrying `SetVobProp`;
`WorldSurface.editing.test.tsx`'s "does not re-read on an undo that was not
structural" uses a plain `MoveVob`, which doesn't exercise this case at all.

**2. "Can't find Insert NPC" — a real precondition, and a possible stale
build, not mutually exclusive.** The gesture that works: open a world →
explicitly turn the **"Waynet"** overlay toggle ON (`WorldOverlayControls.tsx`,
off by default) → left-click terrain → a bottom bar appears
(`world-terrain-bar`) → **only then**, gated on `showWaynet && waynet !==
null`, does "Insert NPC here…" appear beside "Place VOB here…"
(`WorldSurface.tsx:2515`). With Waynet off, ground-click shows only "Place
VOB here…", with no hint a third option exists once Waynet is on — the
board's own phrasing ("overlay on → ground click") states the precondition
but nothing in the running UI does. A second entry point exists too: select
an existing waypoint → `WaypointPanel`'s "Insert NPC at this waypoint…".
Visibility needs no project or `Startup.d` open — those are checked only
after the dialog is confirmed, surfacing as an edit-banner error. Separately:
`daedalus-dialog-editor/dist/win-unpacked` (built 2026-08-27) predates this
feature (landed 2026-09-02) entirely — if that packaged build is what ran
instead of `npm run dev`/`npm start`, the feature genuinely isn't there.
**Confirmed working, 2026-09-02 (Daniel).** No code change.

**3. Camera slots "do nothing" — no wiring bug found.** `cameraSlotFor`
(`cameraSlots.ts:29-38`) reads `event.code` (not `event.key`, so layout- and
Shift-independent), and the `keydown` listener in `WorldViewport.tsx`
(~1225-1256) is on `window`, not the canvas, so DOM focus isn't the issue; it
skips typing targets first, then calls `preventDefault()`. No other
`Ctrl+Digit` binding exists in the renderer, no Electron `Menu`/
`globalShortcut` claims the combo, and both test files
(`WorldViewport.cameraSlots.test.tsx`, dispatching real `KeyboardEvent`s;
`cameraSlots.test.ts`) pass on `HEAD`. **Leading theory**: neither `store` nor
`recall` gives any on-screen feedback — grepped for toast/status/announce,
none exists — so storing a pose is silently a no-op to look at, and recalling
it without having moved the camera first looks like a no-op too. A stale dev
window that didn't pick up today's merge (Vite HMR miss) is the other live
candidate. **Confirmed working, 2026-09-02 (Daniel), after retest.** No code
change — the silent-feedback theory stands as the likely reason it first
looked broken.

**4. Fly speed** — "a bit fast by default" on first look (Daniel), then
**confirmed fine, 2026-09-02** on further use. `flySpeedFor`
(`renderer/world/flyNav.ts`) derives speed from the distance to the orbit
pivot at hold-start, clamped 2–2000 m/s. No number changed.

### 16.28 An arbitrary-length asset folder list, project root default (2026-09-02, Daniel)

**Requested:** the asset browser, and world resolution, should pull from more
than the single Gothic install path configured today — an **orderable list of
any length**, not a fixed pair. The project root is the default first entry;
further folders (the shared MDK folder is the common one, but the list is not
limited to it) are added by hand. Worlds should resolve off the same source
list, not a separate mechanism.

**The native layer already does this — it is not the gap.** `openVfs`
(zenkit-node) mounts an ordered list of directories/archives with later-wins
overlay priority, a straight port of ZenGin's own VDFS load order, tested in
`zenkit-node/test/assets.test.js`. `OpenWorldRequest.assetSources` is
`string[]` end-to-end, IPC validation included, and `world:open`'s handler
(`main.ts`) already accepts a `modSources` parameter appended after the
install-derived list — "so a mod overrides the retail assets" — it is simply
never populated from the app today.

**What's missing is the settings layer, and it's a gap against what
`docs/architecture/level-editor.md` §9 already committed to.** §9 already
says "VDF search paths" (plural), "keyed by project" — but
`SettingsService.getGothicInstallPath`/`setGothicInstallPath` is one flat
global string, not project-keyed and not a list. So this request is mostly
making §9's language real, not inventing new architecture:

1. **A flat, ordered list of asset sources**, not one global path and not
   capped at two — an addable, orderable list defaulting to the project
   root, with further folders (MDK included) added by hand, any number.
2. **`modSources` gets a UI and a settings-backed value**, plural. The
   "project overrides the rest" default falls straight out of this, since
   later sources already win — no new mount logic needed, just wiring.
3. **World resolution moves off the dedicated file-picker dialog and onto
   the same source list.** Today `.ZEN` opening is a native Open File dialog
   seeded from the install path, not the merged VFS namespace — it cannot
   reach a retail `.zen` still packed inside `Worlds.vdf`, only a loose file
   in an extracted MDK-style install. Pulling worlds from the same
   asset-source list fixes that limitation too, as a side effect.

**Storage settled 2026-09-02 (Daniel): the project file, not `SettingsService`
— and it *replaces* `gothicInstallPath` rather than sitting beside it.** The
list is per-project "since the mod root" is itself a project concept, and it
should be committable like `worlds`/`parts`/`target` already are, not
machine-local. This is a real change to §9, not just filling in its
aspirational "VDF search paths" plural: §9 currently puts the install path in
`SettingsService`, machine-local, precisely so it doesn't need to be the same
on every collaborator's machine — the project file's `worlds` array already
records paths *relative to the project root* for that reason. A flat ordered
list of absolute folders committed into the project file reopens that
question for every entry after the first (the project root itself is free —
it's wherever the project file already is): if a collaborator's MDK folder
sits somewhere else, a committed absolute path won't resolve for them. Worth
a decision on how a missing/wrong entry behaves (skip with a warning, most
likely, given a `modSources` config is already optional) before this is
carded. `docs/architecture/level-editor.md` §9 should be updated once this
lands.

### 16.29 A GMBT quick-test button for the selected world (2026-09-03, Daniel)

**The ask.** A button in the level editor that starts a Gothic Mod Builder
Toolkit quick test run with the selected `.zen`, so an edit can be seen in the
engine without leaving the app and without the by-hand copy/launch dance every
Gate pass has done so far.

**Settled 2026-09-03 (Daniel), all six questions:**

- **Invocation is the CLI**, the same entry point `zenkit-node/tools/engine-batch.ps1`
  already drives: `gmbt` resolved off PATH, falling back to
  `%APPDATA%\GMBT\bin\gmbt.exe` exactly as that script does. The command is
  `gmbt test --world=<NAME> --nomenu -D --noupdatesubtitles`, run with the
  GMBT project directory (below) as the working directory — `gmbt` reads its
  `.gmbt.yml` from cwd, same as the harness's `-WorkingDirectory $GmbtDir`.
  **No `--noreparse`**: the harness passes it because its `mdk/` never
  compiles and it wants world-only iteration; Daniel's own scripts change too
  (dialogs edited in this suite), so a quick test recompiles them every run.
  **Never `--full`** either — GMBT refuses it without a prior script reparse,
  and dropping `--noreparse` already gets one. `<NAME>` is the open world's
  own on-disk filename, not a rename — see below.
- **Config is Daniel's own pre-existing GMBT project, not generated.** He
  already maintains a `.gmbt.yml` (its own `gothicRoot`, asset dirs) for his
  mod, the way `zenkit-node/tools/gmbt/.gmbt.yml` does for the round-trip
  harness. The editor does not synthesize one from the project's §16.28
  asset-source list — that list is VFS mount sources, and a GMBT project is a
  different kind of thing.
- **Stored as a dedicated project-file field** — a GMBT project directory
  path, not another entry in the §16.28 asset-source list (it is not content
  to mount). Same storage pattern as §16.28 otherwise: committed to the
  project file, skip-with-a-warning if the path is missing or wrong.
- **No staging or copying.** Daniel edits the world file in place inside the
  mod repo already, at the path GMBT's `mod\Worlds` points to — the button
  does not copy or rename anything, unlike `engine-batch.ps1`'s forced
  `NEWWORLD.ZEN` staging (which exists only because that harness needs one
  fixed identity across many candidates). One caveat inherited from GMBT
  itself and not solved here: `--world` is compared case-sensitively against
  the on-disk filename after GMBT upper-cases the argument, so the file has
  to already be cased the way its `STARTUP_<name>` script expects — Daniel's
  setup already satisfies this, the button just passes the filename through.
- **Save behaviour: refuse and prompt.** A dirty world blocks the button with
  a prompt to save first, rather than auto-saving or launching stale bytes.
- **Run mode: fire-and-forget.** The editor launches the process and does not
  track it, show a running indicator, or capture its output — no watcher, no
  exit-code handling.
- **Not configured: disabled with a tooltip.** No GMBT project directory set,
  or the path doesn't resolve, and the button is greyed out with a tooltip
  naming the setting — never an error toast on click.

**Built 2026-09-03, all six as settled.** `gmbtProjectDir` is an optional field
of the project file (`docs/architecture/level-editor.md` §9), resolved by
`ProjectConfigService` into `OpenedProjectConfig.gmbtProjectDir` — non-null only
when the folder exists *and* holds a `.gmbt.yml`, otherwise a
`gmbt-project-dir-unavailable` warning through the same snackbar an unavailable
asset source uses. `GmbtService` finds `gmbt` on PATH (PATHEXT by PATHEXT) then
at `%APPDATA%\GMBT\bin\gmbt.exe`, and spawns
`test --world=<file> --nomenu -D --noupdatesubtitles` detached, `stdio: 'ignore'`,
unref'd, with an `error` listener so a failed spawn cannot take main down.

Three things in it are load-bearing:

- **The IPC takes no payload.** `world:gmbtQuickTest` reads both halves of the
  launch from main's own state — the registered project's resolved
  `gmbtProjectDir`, and `WorldService.openWorldPath()`'s basename. A renderer
  that could name either would be naming a folder to run a program in and a
  file to hand it.
- **Dirty means "not written back over the file the world was opened from"**,
  not "edits exist". The save dialog suggests `.edited.zen` *beside* the
  original, and a quick test plays the original — so the block clears only on a
  save whose target matches `summary.worldPath`. Undo counts as an edit for the
  same reason: the history's depth cannot say what is on disk.
- **The Asset sources dialog sets it** (asked for 2026-09-03, after the six
  decisions): a Choose…/Clear pair below the list and outside it, never a
  fourteenth entry in the list — it is still not a mount. `project:saveAssetSources`
  gained a third argument and `updateAssetSources` became `updateProjectPaths`,
  with `null` for "clear" and omitted for "leave alone"; the folder answers to
  the sources' own save-time rule (absolute only if the native picker granted
  it, relative only inside the project), and one already in the project file is
  granted at load like an asset source there.

Unwitnessed: no quick test has been launched from the button on this machine —
the launcher's argv and its two lookup paths are covered by
`tests/GmbtService.test.ts` against an injected `spawn`, which is not the same
as GMBT having started a game.

### 16.30 The point markers get a sprite (2026-09-03)

Every marker on the World surface was a bare `PointsMaterial` square in a flat
colour: the placement point, the orbit pivot, and both spawn layers. At 6-16
pixels over terrain that is sunlit rock as often as it is cave floor, an
unrimmed square is lost against one of the two, and two of them on the same
waypoint read as one smudge.

`markerSprite.ts` now builds two shared masks and the four materials take one
as `map`. A **pip** — colour to 0.58 of the sprite, black rim to 0.86 — for the
spawn layers; a **reticle** — a centre dot inside a gap inside a ring, all
rimmed — for the placement and pivot markers, so the point being named stays
visible through the thing naming it. Sizes went up to keep the coloured core at
its old width, the rim being new area: placement 11→16, pivot 8→12, spawn 9→11,
unplaced 6→8. Every colour is unchanged.

Three things in it are load-bearing:

- **The mask is white-on-black.** `map` multiplies into `material.color`, so a
  white texel takes the layer's colour and a black one stays black whatever the
  layer picked. A grey rim would take the marker's colour too, which is the
  contrast gone.
- **`DataTexture`, not a canvas.** The renderer suites run in jsdom, which has
  no 2D context — a canvas sprite would be silently blank in exactly the
  environment that tests it. Written texel by texel, it is also readable back,
  which is how `markerSprite.test.ts` checks a picture.
- **One texture per shape for the whole app, and nobody disposes it.**
  `TerrainMarker` is built per placement click; a texture built with it would be
  a GPU upload per click, and one disposed with it would blank the pivot marker
  drawing the same sprite. `Material.dispose` leaves a `map` alone, so both
  layers' `dispose` are already correct — the tests assert it rather than trust
  it.

Unwitnessed: how any of it looks on a real GPU. The waynet's own 3.5 px points
were deliberately left as squares — that size is tuned against NewWorld's 2,959
of them reading as a mass, and it is a waypoint rather than a marker.

### 16.31 The GMBT project configures the project, and worlds are a list (2026-09-03, Daniel)

**The ask.** A `.gmbt.yml` already names the mod's asset folders, its Gothic
root and its default world — beppo's names `mdk`, `thirdparty`, `mod` and
`SURFACE_BEPPO.ZEN`. Detect the GMBT project, seed the asset list from it, and
then the worlds under `thirdparty/Worlds` can be *found* rather than browsed
for. Scope settled the same day: this plus §16.28 item 3 (world detection);
opening the world an NPC lives in is a separate card, and Daniel's own
definition of it is "from an NPC in the dialog editor, resolve their start
waypoint to the world that holds it, open that world and fly to them".

**Built 2026-09-03.**

- **`gmbtProject.ts` reads the file**, and it is a three-key subset rather than
  a YAML dependency: `gothicRoot`, `modFiles.assets`, `modFiles.defaultWorld`.
  Anything it does not understand is skipped — the file belongs to GMBT, and
  this app does not get to call it invalid. `modVdf` repeating the same key
  names below is why the reader tracks which top-level block it is in.
  Backslashes are normalized to `/` before resolving, so the paths a
  Windows-only tool writes resolve on the Linux CI that tests them.
- **Detection walks up four levels** from the project folder. beppo's project
  root is `beppo/mod` and its `.gmbt.yml` is one above.
- **Seeding happens once, at project-file creation**: `assetSources` becomes
  the project root plus the GMBT asset folders in the file's own mount order,
  plus `gothicRoot` *only when that folder is install-shaped* — beppo's is
  `..\..`, which resolves to a folder with no `Data/*.vdf` in it, and an entry
  that resolves to nothing is a warning the user did not ask for. The paths are
  written project-relative with forward slashes, so a detected folder is as
  committable as a hand-written one.
- **An existing project file is not rewritten**, with one exception: a file
  that names no `gmbtProjectDir` adopts the detected one and persists just that
  field, so the quick test configures itself. The asset list's *order* is a
  decision, and a silent append would be this code making it. Instead
  `OpenedProjectConfig.gmbtAssetSources` carries what the GMBT project mounts
  and the list does not, and the Asset sources dialog offers it as one button
  ("Add 2 from GMBT"). beppo, whose committed file predates all of this and is
  missing `thirdparty`, is exactly that case.
- **Worlds are discovered off the same source list** (§16.28 item 3):
  `worldDiscovery.ts` scans each configured source *as a folder* — hence the
  new `resolvedAssetRoots`, which is the list before an install-shaped source
  is expanded into its six archives — for `Worlds/`, `_work/Data/Worlds/` and
  loose `.zen` files in the folder itself. A later source wins the same world
  name, which is the mount order the engine would resolve through. The GMBT
  `defaultWorld` is re-read at list time and marked.
- **"Open world" is a list, and "Browse…" is still in it.** Only loose `.zen`
  files are found: the VFS could *name* a world inside `Worlds.vdf`, but
  nothing downstream can open a world with no filesystem path, so listing one
  would be an entry that fails on click.
- **Seeding follows GMBT's mount order, corrected 2026-09-03**: `gothicRoot`
  first when it is an install, then `modFiles.assets` as the file lists them,
  with the project root written as `.` wherever it falls among them (last if
  the list does not contain it). The first cut put `.` first, which is
  backwards — later wins here as it does in GMBT, so retail has to be the base
  and the mod folder has to win.
- **The save-time rule had to learn about them** (2026-09-03, after Daniel hit
  it): `project:saveAssetSources` refused a relative source leaving the project
  folder, and every GMBT folder does — `../thirdparty`, and the adopted
  `gmbtProjectDir: ".."` itself. `registerProjectConfig` now grants the
  *resolved* path of every configured source and of `gmbtAssetSources`, and the
  escape check passes only for a path in that set. The trust level is
  unchanged: main derived those paths from the project file and its `.gmbt.yml`,
  which is the same standing an absolute configured source already had. It also
  fixes the older case of a hand-written `../shared` that could be loaded but
  not re-saved.
- **`world:listWorlds` takes no payload** and whitelists the folders it
  returns, for the reason `registerProjectConfig` whitelists an absolute asset
  source: the paths come from the project file the user has already opened, not
  from the renderer.

**What beppo then showed (2026-09-03, Daniel: white world, no VOBs).** Not a
bug in any of the above: the project's sources were `.`, `../mdk`,
`../thirdparty` and **no Gothic install**, because beppo's `.gmbt.yml` says
`gothicRoot: ..\..`, which on this machine resolves to `C:/Users/Daniel/Projects`
— stale, and correctly rejected as not install-shaped. Probed with the binding
over `SURFACE_BEPPO.ZEN` (4,539 VOBs, 414 distinct visuals, 329 world
textures):

| mounts | world textures | VOB visuals |
|---|---|---|
| `mdk` + `thirdparty` + `mod` | 8 / 329 | 0 / 414 |
| the same plus the Steam install's six VDFs | 317 / 329 | 319 / 414 |

So the fix for the project is to add the install by hand and move it to the
top of the list. Two facts came out of the probe and are worth keeping:

- **What is still missing with the install mounted is beppo's own content, and
  it is missing because it is not compiled.** `KM_VOB_BIG_BUSH_01.3DS` is a
  source `.3DS` in `mod/Meshes/Archolos_stuff/`, and `thirdparty/Meshes/_compiled`
  holds exactly one `.MRM`. ZenKit reads compiled formats; GMBT compiles into
  `<gothicRoot>/_work/Data/*/_compiled` on a build. So a mod's own new assets
  appear in the editor only after a GMBT build, and only if the install that
  build wrote into is an asset source. The 12 remaining world textures are
  mostly `NAME.TGA.TGA` double extensions in the world's own material names.
- **`gothicAssetSources` returns archives *or* loose `_compiled`, never both**
  (`zen-world/src/assets/gothicArchives.ts`), and on a GMBT-built install both
  exist: the retail VDFs, plus the mod's compiled output in `_work/Data`. ZenGin
  itself reads the loose files with priority. So on an install GMBT builds into,
  the editor mounts the archives and **ignores every asset the mod just
  compiled**. Not carded — it wants Daniel's call, and it is measured against
  the 2,170 ms figure that rule was written for (a fully extracted install; a
  GMBT-built one holds only the mod's own files there).

**Both of those were then decided and built the same day (Daniel).**

- **The Gothic install goes back to being machine-local**, reversing §16.28 for
  that one path: it is a fact about the machine, not about the mod. It is
  `SettingsService.gothicInstallPath` again, mounted *first* under every
  project's own sources, chosen through a main-process folder dialog from a
  section of the Asset sources dialog, and never written into a project file. A
  project file that still names an install-shaped source hands it to the
  setting on the next open and is de-duplicated at mount time — nothing is
  rewritten, nothing is mounted twice. The legacy migration that *consumed* the
  setting into the list, and its `legacyCleanupSafe` machinery, are gone.
- **The check Daniel asked for is a refusal, not a warning.** `world:open`
  refuses when no installation resolves, naming the setting — the white world
  was a silent failure, and a snackbar on project open would fire for every
  dialog-only session too.
- **`gothicAssetSources` mounts archives *and* loose `_compiled` trees**,
  archives first, so a GMBT build's output wins the way ZenGin resolves it. A
  stock install has no `_work` and pays nothing for the change.

**One texture killed the rest (2026-09-03, Daniel: a tree still white with the
install mounted).** Not the tree's fault — `NW_NATURE_SMALLTREE_79P.3DS`
resolves to its `.MRM`, its three materials name `NW_NATURE_BARK_01.TGA` and
two branch textures, and all three decode at 256/512. Probed name by name over
`SURFACE_BEPPO`'s 494 distinct texture names: **476 decode, 12 return null, and
6 throw**. The six throw `invalid signature` — they are beppo's own *source*
`.TGA` files in `mod/Textures`, which resolve by name because the mod folder is
mounted and are then handed to a ZTEX parser. `WorldScene.loadPendingTextures`
awaited each decode in one sequential loop with no `try`, so the first rejection
came out of the loop and **every name after it stayed white**, which is why the
white set looked arbitrary.

Three changes, each independently right:

- The loop catches per name and keeps going, returning the names it could not
  decode. A name the VFS simply does not hold is returned too — white is white,
  whatever the reason.
- `zenkit.worker`'s `texture` op answers `null` instead of throwing when the
  binding refuses a file, and its mipmap walk stops instead of asserting a
  level is non-null.
- The failures are **said**: `WorldViewport` hands them up (`onTextureFailures`)
  and `WorldSurface` puts them in the world banner, naming the first three and
  the reason. White geometry the user has to reverse-engineer is what cost the
  last two sessions.

Not fixed, because it is not the editor's to fix: those six textures have no
compiled form anywhere in the project, so they stay white until a GMBT build
compiles them. The 12 nulls are `NAME.TGA.TGA` double extensions in the world's
own material names.

Unwitnessed: nothing here has been run against the beppo project in the app —
the detection, the seeding and the scan are covered by `gmbtProject.test.ts`,
`worldDiscovery.test.ts` and `ProjectConfigService.test.ts` over temp trees,
and the picker by a browser-harness spec against the mock API. The first real
open is also the first proof that `thirdparty/Worlds/SURFACE_BEPPO.ZEN` both
lists and loads.
