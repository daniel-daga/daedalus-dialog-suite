# Engine acceptance record & session handoff — 2026-08-24/25

Phase 0 task **T6.5** (`../../docs/plans/level-editor-phase-0.md` §5, "E-early").
Branch: `feature/level-editor-phase-0`. Nothing pushed to master.

**Status: T6.5 FAILED — three attempts. The original engine rejects a plain
ZenKit re-save of a retail Gothic 2 world.** T7 (harness), T8 (corpus run) and
T10 (full checklist) are parked; no Plan A / Plan B verdict may be written yet
(see §6).

---

## 1. What was built (T1–T6, T9 — all green)

New workspace `zenkit-node/`: an N-API binding around ZenKit plus the drift
classifier. 47 tests, 46 passing (the one failure is deliberate — §5).

| Task | State | Notes |
|---|---|---|
| T1 workspace + two-stage build | ✅ | CMake pre-step builds ZenKit static → `vendor-build/zenkit/out/`, then node-gyp compiles only the binding. `prebuildify`/`node-gyp-build` pipeline preserved. |
| T2 `loadWorld` / `worldStats` | ✅ | Version is **verified, never guessed**: a `MeshAndBsp` BSP-version scan; mismatch throws. |
| T3 windows-1252 at the edge | ✅ | `src/encoding.{hh,cc}`; umlaut round-trip test. |
| T4 `normalizeWorld` | ✅ | Direct struct reads, never via the save path. All 44 VOB classes. Self-contained SHA-256. Checked-in golden. |
| T5 classifier | ✅ | `lib/classify.js` — `identical` / `float-noise` / `reordered` / `semantic-drift`, order-sensitivity per structure. 18 tests. |
| T6 `saveWorld` + minimal mutations | ✅ | Atomic temp+rename; `setVobPosition`, `insertItemVob` (§1 of the plan — no `applyOps`). |
| T9 CI wiring | ⚠️ | `.github/workflows/zenkit-node.yml`, path-filtered, 3 OSes. **Never executed on GitHub** — unverified. |
| T6.5 engine gate | ❌ | §3 below. |
| T7, T8, T10 | ⏸ | Blocked on T6.5. |

### ZenKit pin

`vendor/ZenKit` is pinned to **`1ff081c` (upstream `main`, 2026-05-09)**, not a
release tag. Deliberate and user-approved: **v1.3.0's world-save path is
unusable** (MeshAndBsp header written as `version=0,size=0`; polygon
material/lightmap written 4-byte where the loader reads 2-byte; polygon planes
zeroed). Every fix landed after the release. A fixed SHA is as reproducible as
a tag.

---

## 2. ZenKit defects found and patched (`patches/`, applied at build time)

Nine patches, all upstreamable to ZenKit (MIT). Applied idempotently by
`scripts/build-zenkit.js` before the CMake build.

| # | File | Defect |
|---|---|---|
| 0001 | `vobs/VirtualObject.cc` | `anim_mode` load: `bit1 & 0b110000000u >> 7u` — precedence makes it `bit1 & 3`; every *named* vob misloads as WIND_ALT. Save masked `& 2` (drops WIND) and wrote `bias << 13` where the loader reads bits 9–13. |
| 0002 | `vobs/Light.cc` | `LightPreset::save` reused a `stringstream` with `os.clear()` (resets flags, not the buffer) → `rangeAniScale` text leaked into `colorAniList`; re-saved lights gained phantom colour entries. |
| 0003 | `vobs/Camera.cc` | Trajectory-frame pose: load `read_mat4()` (transposes), save dumped raw memory → poses came back transposed. |
| 0004 | `Material.cc` | `alphaFunc` written with `write_bool` but read with `read_enum` → BLEND/ADD/MUL clamped to 1. |
| 0005 | `Mesh.cc` | G2 `Mesh::save` indexed the *triangulated* `PolygonList` using offsets belonging to the flat `polygon_vertex_indices` array. `triangulate()` drops portal/ghost-occluder/outdoor polys, so indices diverged immediately — scrambled world mesh. |
| 0006 | `vobs/Sound.cc`, `vobs/Trigger.cc` | 13 wrong entry **names**: `VSound::save` wrote ten consecutive entries all named `sndVolume`; `VMover::save` four named `autoLinkEnabled`; `VTriggerList` `numTargets` vs `numTarget`. |
| 0007 | `vobs/VirtualObject.cc`, `vobs/Camera.cc` | Object frame **versions**: `VisualDecal`/`VisualMesh`/`VisualMultiResolutionMesh` never override `get_version_identifier()` → stamped `0` instead of `64513` (1405 decals + 312 meshes read as Gothic 1 by the engine). `VCameraTrajectoryFrame` 52224 instead of 31489. |
| 0008 | `World.cc`, `world/VobTree.hh` | `childs<N>` counter: `save_vob_tree` had a global counter but `World::save` called it **once per root vob, resetting it each time** → 4,460 distinct names instead of 23,289. |
| 0009 | `Material.cc` | `texScale`/`texAniMapDir` written `%.9g` (`9.99999975e-05`); ZenGin's MSVC 6 CRT wrote 8 significant digits + 3-digit exponent (`9.9999997e-005`). |

Found but **not** patched (deliberate):
- `Material::save` writes archive key `"losDontCollapse"` (typo for `lodDontCollapse`).
- `MeshChunkType::LIGHTMAPS_SHARED` iterates an `unordered_map` → nondeterministic byte order.
- `zCVobLight` `colorAniList`: original writes greyscale shorthand (`255 `), ZenKit always expands to `(255 255 255)`. +80 bytes on NewWorld. ZenGin wrote both forms, so its parser accepts both.

---

## 3. The T6.5 engine attempts

Oracle: **Spacer II 2.6 (mod)**, `.../Gothic II/System/Spacer2.exe`, against
`_work/Data/Worlds/NewWorld/NewWorld.zen`. Original Gothic only — never
OpenGothic (it is built on ZenKit and shares the code under test).

**Control established (important):** Spacer shows *nothing* on the first load
of **any** world including the pristine retail original; the second load
works and renders fully. So "nothing on first load" is a Spacer quirk, not our
bug, and the A/B comparison is valid. **Always load twice.**

| # | File | Result |
|---|---|---|
| 1 | v1 (patches 0001–0005) | Assertion, stack below |
| 2 | v2 (+0006, 0007) — 75,035,607 B | **Identical assertion, same address** |
| 3 | v3 (+0008, 0009) — 75,387,803 B (original 75,387,729, **+74**) | Failed again. **Assertion text NOT captured** — Spacer was closed before extraction. Capturing it is the first job next session. |

Assertion (attempts 1 and 2, verbatim):

```
ASSERT_FAIL                            zWin32.cpp:3368
zCArchiverBinSafe::ReadType()          zArchiver2.cpp:673   Assertion: sSize < READ_BUFFER_SIZE
zCArchiverBinSafe::RestoreStringEOL()  zArchiver2.cpp:1360
zCArchiverBinSafe::SkipChunk()         zArchiver2.cpp:1730
zCWorld::Unarchive()                   zWorld.cpp:2501
oCWorld::Unarchive()                   oWorld.cpp:380
```

Reading: the engine read a string length from a desynchronized offset. It is
inside `SkipChunk`, which `zCWorld::Unarchive` calls for a chunk it does not
recognise — consistent with a name lookup failing and the archiver hunting.

### What our instruments say about v3 (independently re-verified, not just agent-reported)

- Positional BinSafe entry-stream walk vs the original: **270,310 events, 0
  divergences** in entry name, entry type, object version, object framing.
- Hash table: **23,478 vs 23,478 keys**, `childs*` multiset **identical**.
- Both streams end **exactly** at their `hashTableOffset`.
- `normalizeWorld` + `classifyDumps`: **identical, 0 findings** — on NewWorld,
  OldWorld and AddonWorld.
- Only residual: `MeshAndBsp` raw blob **+18 bytes** (19 B nested-archive
  header text — empty date + shorter user name — minus a 1 B trailing byte the
  original writer emits past its declared object count).

**Every instrument we own says the file is correct. The engine disagrees.**

---

## 4. Assessment

This is the plan's §5 **"clean diff / broken engine"** cell — explicitly the
most valuable one, because it is the only way to learn the measuring
instrument has a blind spot. It does, and structurally so: `normalizeWorld`
reads ZenKit's *parsed structs*, and ZenKit's reader is **positional +
type-checked** while ZenGin's is **name- and version-addressed**. Anything the
reader ignores is invisible to the dump by construction. The external walker
closed most of that gap; it evidently has not closed all of it.

**A methodological warning for whoever picks this up:** three times a
difference was dismissed by *reasoning* that it could not matter, and twice
that reasoning was wrong (`childs<N>` "same type, same size, cannot desync" —
it is name-addressed; the mesh delta "just the date stamp" — 14 of 33 bytes
were real float-format payload). **Do not dismiss a byte difference without
evidence.** The remaining `MeshAndBsp` +18 has been explained but not proven
harmless by an engine load.

### Ranked hypotheses for the next session

1. **Capture the v3 assertion first.** If the stack moved (e.g. into `zCMesh`,
   BSP, or `zWorld` proper) the container is fixed and this is a *different*
   defect — do not assume it is the same failure.
2. **`MeshAndBsp` blob.** The only known remaining byte difference. If the
   engine consumes rather than seeks by the declared `size`, any internal
   length error desyncs everything after it and produces exactly this stack.
   Make the blob byte-identical (drop the trailing byte / reproduce the header
   text exactly incl. `user`) and retest — cheap and decisive.
3. **Bisect instead of theorise.** Build a world that is the original's bytes
   with exactly one structure re-serialized (VobTree only, or mesh only). The
   splice machinery for this is Plan B anyway, so the effort is not wasted.
4. **Try a smaller world** (`OldCamp.zen`, 3.8 MB) for faster iteration, and
   `Gothic2.exe` itself as a second oracle — Spacer 2.6 is a *modified* tool.
5. **Widen the instrument** (plan §5 mandates this before deciding): add to
   `normalizeWorld` — archive hash-key set + hash, per-object frame versions
   (incl. nested visuals), per-class ordered `(entryName, entryType)` schema,
   entry-stream counts/depth, and the `MeshAndBsp` chunk table. Treat all of
   these as `semantic-drift`, never benign.

### On Plan A vs Plan B

**No verdict may be written yet** (plan §5: a clean diff with a broken world
means fix the instrument, *then* re-decide). But the evidence is drifting
toward **Plan B** (retain original byte ranges for structures the editor never
touches — BSP/mesh — and re-serialize only the VOB tree and waynet). Nine
writer defects in a path never advertised as byte-preserving, with an
unexplained failure remaining, is precisely the situation Plan B exists for.
Note the project only ever needs to *edit* VOBs and waynets.

**The gate is working as designed.** This cost days, in Phase 0, with no
viewport, gizmos or op system built on the assumption. That is the entire
reason T6.5 sits before T7.

---

## 5. Known-failing test — do not "fix" it casually

`test/saveWorld.test.js` → *"saveWorld reproduces the fixture bytes except the
header date/user stamps"* **fails**.

Cause: `test/fixtures/minimal.g2.zen` was authored by **unpatched** ZenKit, so
its own bytes encode the `childs` bug (`childs0, childs0, childs1, childs2,
childs3`). Patched output is the correct `childs0…childs4`. The golden *dump*
test still passes — semantics are unchanged.

Regenerating the fixture is justified, but it is **an explicit reviewed act,
never automatic** (project rule: an auto-regenerating golden silently ratifies
whatever bug just landed). It was deliberately left failing so the next
session decides with eyes open. `pnpm --filter zenkit-node fixtures:regen`
regenerates both the `.zen` and the `.golden.json`; verify the diff is *only*
the `childs` naming before accepting.

---

## 6. How to resume

```bash
git checkout feature/level-editor-phase-0
cd zenkit-node
node scripts/build-zenkit.js        # applies patches/*.patch, builds ZenKit static
npx node-gyp rebuild                # see build gotchas below
node --test test/*.test.js          # expect 46 pass / 1 fail (§5)
npm run lint
```

Re-save + classify a real world:

```js
const zk = require('./lib'), { classifyDumps } = require('./lib/classify');
const h = zk.loadWorld('<...>/Worlds/NewWorld/NewWorld.zen', 'g2');
zk.saveWorld(h, '<scratch>/out.zen');
classifyDumps(zk.normalizeWorld(h), zk.normalizeWorld(zk.loadWorld('<scratch>/out.zen','g2')));
```

### Diagnostic tooling (scratchpad — **not in the repo, recreate or salvage**)

`walk.js` (BinSafe entry-stream walker), `audit.js` / `audit2.js` (positional
per-class divergence census; `audit2` also compares hash tables and does *not*
normalize `childs<N>`), `derive3.js` (childs-rule derivation), `dumpwin.ps1`
(extracts Spacer's assertion dialog text via Win32 `EnumWindows` — far better
than screenshots). Location:
`C:\Users\Daniel\AppData\Local\Temp\claude\C--Users-Daniel-Projects\ac22a28d-51b2-474e-a537-68a41b9d296f\scratchpad\`.
**These are session-temporary. Promote the walker + audit into `zenkit-node/`
as real tooling** — they are the only instrument that can see container-level
defects, and T7's harness needs them anyway.

### Environment

- Gothic II: `C:\Program Files (x86)\Steam\steamapps\common\Gothic II` —
  extracted MDK-style install (`_work\Data\{Meshes,Textures,Scripts,Worlds}`),
  which is why `Textures.vdf`/`Meshes.vdf` are absent from `Data`. Install is
  healthy — verified.
- **Pristine backup: `_work\Data\Worlds\NewWorld\NewWorld.zen.original-backup`
  (75,387,729 B).** The install is currently restored to the original
  (hash-verified). Never write into the Gothic directory without a backup, and
  restore before leaving.
- Gothic 1 is **not installed** — G1 coverage for T8 is unavailable here.

### Build gotchas (all cost real time already)

1. `node-gyp rebuild` **deletes `build/`**, so the CMake output lives in
   `vendor-build/` deliberately. Do not "tidy" it back.
2. **`scripts/build-zenkit.js` only works on a clean submodule tree.** Patches
   0003 and 0007 both touch `vobs/Camera.cc` with overlapping context, so once
   fully patched the `git apply --reverse --check` probe misjudges 0003 as
   unapplied and the build aborts. Fix by `git -C vendor/ZenKit checkout -- .`
   at the top of `applyPatches()`, or rebase the two patches apart.
3. ZenKit's archive writers call `strftime("%-d...")` — glibc-only; MSVC's UCRT
   invalid-parameter handler **kills the process**. `src/msvc_crt_guard.hh`
   wraps every `WriteArchive` use. Side effect: our headers carry an empty
   `date`. Upstreamable.
4. **Never `dynamic_cast` ZenKit types** — node-gyp compiles `/GR-` on Windows.
   Dispatch on `VirtualObjectType` / `get_object_type()`.
5. Windows Smart App Control has blocked freshly linked `.node` files
   (`ERR_DLOPEN_FAILED`). Re-linking via a different shell has worked around it.
6. Nested ZenKit submodules must be initialised recursively (`glm` is gone on
   `main`; `miniz` arrives with `ZK_ENABLE_ZIPPED_VDF=ON`).

### Manual engine procedure

1. Copy the candidate over `_work\Data\Worlds\NewWorld\NewWorld.zen`.
2. Launch `System\Spacer2.exe`; **load the world twice** (first load is always
   blank).
3. On crash, run `dumpwin.ps1` while the dialogs are still open — the
   **"Assertion Failed"** window carries the file/line/condition; the
   "Breakpoint" window only shows the dialog handler and is useless.
4. Restore the backup afterwards.

Do **not** pass a world on Spacer's command line — it crashes with
`0xC000041D` on the retail original too (verified control), so any result from
that invocation is meaningless.
