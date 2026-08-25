# Engine acceptance record & session handoff — 2026-08-24/25

Phase 0 task **T6.5** (`../../docs/plans/level-editor-phase-0.md` §5, "E-early").
Branch: `feature/level-editor-phase-0`. Nothing pushed to master.

**Status: T6.5 PASSED. Verdict: Plan A** (decision matrix cell *clean diff /
engine OK*; written up in `../../docs/plans/level-editor.md` §5).

A single-variable engine bisect (§3.3) localised the failure to the `MeshAndBsp`
blob, chunk-level isolation (§3.4) named the two fatal defects, and after ten
further ZenKit patches **Spacer loads a fully re-saved retail NewWorld** (§3.5).
All three retail G2 worlds now re-save with a **byte-identical mesh/BSP blob**
and classify `identical`. Remaining: T7, T8, then T10 / E-full (checklist rows
2–10, §8).

---

## 1. What was built (T1–T6, T9 — all green)

New workspace `zenkit-node/`: an N-API binding around ZenKit plus the drift
classifier and the container-level instrument. 72 tests, 71 passing (the one
failure is deliberate — §5).

| Task | State | Notes |
|---|---|---|
| T1 workspace + two-stage build | ✅ | CMake pre-step builds ZenKit static → `vendor-build/zenkit/out/`, then node-gyp compiles only the binding. `prebuildify`/`node-gyp-build` pipeline preserved. |
| T2 `loadWorld` / `worldStats` | ✅ | Version is **verified, never guessed**: a `MeshAndBsp` BSP-version scan; mismatch throws. |
| T3 windows-1252 at the edge | ✅ | `src/encoding.{hh,cc}`; umlaut round-trip test. |
| T4 `normalizeWorld` | ✅ | Direct struct reads, never via the save path. All 44 VOB classes. Self-contained SHA-256. Checked-in golden. **Now also carries a `container` section** — §4. |
| T5 classifier | ✅ | `lib/classify.js` — `identical` / `float-noise` / `reordered` / `semantic-drift`. Container facts are **always** `semantic-drift`. |
| T6 `saveWorld` + minimal mutations | ✅ | Atomic temp+rename; `setVobPosition`, `insertItemVob`. |
| T9 CI wiring | ⚠️ | `.github/workflows/zenkit-node.yml`, path-filtered, 3 OSes. **Never executed on GitHub** — unverified. |
| T6.5 engine gate | 🔶 | Localised, §3. Final confirmation pending. |
| T7, T8, T10 | ⏸ | Blocked on T6.5. |

### ZenKit pin

`vendor/ZenKit` is pinned to **`1ff081c` (upstream `main`, 2026-05-09)**, not a
release tag. Deliberate and user-approved: **v1.3.0's world-save path is
unusable**. A fixed SHA is as reproducible as a tag.

---

## 2. ZenKit defects found and patched (`patches/`, applied at build time)

**Nineteen** patches, all upstreamable to ZenKit (MIT). `scripts/build-zenkit.js`
resets the submodule tree (`git checkout -- .`) and then applies every patch in
order — the old `git apply --reverse --check` probe misjudged patches with
overlapping hunks (0003/0007 in `Camera.cc`) and has been removed.

### Session 1 (0001–0009) — semantic defects

| # | File | Defect |
|---|---|---|
| 0001 | `vobs/VirtualObject.cc` | `anim_mode` load: `bit1 & 0b110000000u >> 7u` — precedence makes it `bit1 & 3`. Save masked `& 2` and wrote `bias << 13` where the loader reads bits 9–13. |
| 0002 | `vobs/Light.cc` | `LightPreset::save` reused a `stringstream` with `os.clear()` → `rangeAniScale` text leaked into `colorAniList`. |
| 0003 | `vobs/Camera.cc` | Trajectory-frame pose: load `read_mat4()` (transposes), save dumped raw memory. |
| 0004 | `Material.cc` | `alphaFunc` written with `write_bool` but read with `read_enum`. |
| 0005 | `Mesh.cc` | G2 `Mesh::save` indexed the *triangulated* `PolygonList` with offsets belonging to the flat array. |
| 0006 | `vobs/Sound.cc`, `vobs/Trigger.cc` | 13 wrong entry **names** (ten consecutive `sndVolume`, four `autoLinkEnabled`, `numTargets`). |
| 0007 | `vobs/VirtualObject.cc`, `vobs/Camera.cc` | Object frame **versions**: visuals stamped `0` instead of `64513`; `VCameraTrajectoryFrame` 52224 instead of 31489. |
| 0008 | `World.cc`, `world/VobTree.hh` | `childs<N>` counter reset once per root vob → 4,460 distinct names instead of 23,289. |
| 0009 | `Material.cc` | `texScale`/`texAniMapDir` written `%.9g`; ZenGin's MSVC 6 CRT wrote 8 significant digits + 3-digit exponent. |

### Session 2 (0010–0019) — byte-fidelity defects

Found by an **event-aligned byte diff** of the retail NewWorld against its
re-save (`bytediff.js`, §7): every one of the 270,311 archive events compared
byte-for-byte, plus the mesh/BSP chunk table.

| # | File | Defect | Evidence |
|---|---|---|---|
| 0010 | `archive/ArchiveBinsafe.cc` | Hash table written in insertion order | Original: all 23,478 records sorted by hash ascending, and all 23,381 same-hash neighbour pairs descend in insertion index (bucket walk + prepend chain). Keys/indices/hashes were already correct. |
| 0011 | `world/BspTree.cc` | BSP header chunk 0xC000 leading ushort hard-coded `2` | NewWorld, OldWorld and AddonWorld all carry `3`. Now kept on `BspTree::version`; falls back to 3 (G2) / 2 (G1) when never loaded. |
| 0012 | `Date.cc` | 16-byte `zDATE` pad word read-skipped, written as 0 | Original mesh chunk 0xB000 carries `4a 01` there — the mesh's date is uninitialised memory that ZenGin dumps verbatim. |
| 0013 | `archive/ArchiveBinary.cc` | Nested BINARY header wrote `date `/`user ` lines and a 10-char `objects` field | Original: `saveGame 0\nEND\nobjects 1400     \nEND\n\n` — 9-char field, no stamps. Same in OldWorld (`543`), AddonWorld (`898`) and every compiled `.MSH`. |
| 0014 | `Mesh.cc` | **One byte after the last material object in chunk 0xB020 that ZenKit neither read nor wrote** | Walking the 1400 self-sized material records ends one byte short of the chunk; the byte is `01` in all three worlds and ICELANCE.MSH, `00` in COLDUMMY/CYLINDERFX → a real per-mesh G2 alpha-test flag, now `Mesh::alpha_test`. |
| 0015 | `Mesh.cc` | 0xB026 iterated an `unordered_map<Texture*,…>` → **nondeterministic**: two saves of the same world differed from each other | Fixed to a deterministic order… |
| 0019 | `Mesh.cc`, `Mesh.hh` | …but first-reference order is still **not** ZenGin's order | The original's list starts at texture 125, then 1, then 125 again — the order the light-map compiler created them in, not derivable from the light-maps. The loaded list is now kept on `Mesh::shared_lightmap_textures` and reused by `save`. |
| 0016 | `vobs/VirtualObject.cc` | Bit 15 of the packed G2 flag word dropped | 49 of 23,288 `dataRaw` payloads have it set; ZenGin never assigns it either, so it carries engine memory. Preserved as `packed_reserved_bit`. |
| 0017 | `archive/ArchiveBinsafe.cc` | `locked`/`moveable` `=true` written as `1`, original `0xFFFFFFFF` | ZenGin declares them as *signed* one-bit bit-fields, so a set flag reads as −1. Census of all 9,802 BOOL keys across all three worlds: exactly three keys ever differ, none ever uses 1 for true — §3.6. |
| 0018 | `archive/ArchiveBinsafe.cc`, `ArchiveAscii.cc` | `strftime("%-d.%-m.%Y %H:%M:%S")` is glibc-only; MSVC's UCRT invalid-parameter handler kills the process | Replaced by `snprintf`, producing ZenGin's exact shape. **`src/msvc_crt_guard.hh` is therefore gone.** |

Found but **not** patched (deliberate, documented residuals):
- `Material::save` writes archive key `"losDontCollapse"` (typo for `lodDontCollapse`) — ZenGin reads the same typo.
- `zCVobLight` `colorAniList`: the original writes greyscale shorthand (`255 `),
  ZenKit always expands to `(255 255 255)`. +80 bytes on NewWorld, 4 entries.
  ZenGin wrote both forms, so its parser accepts both.

---

## 3. The T6.5 engine attempts

Oracle: **Spacer II 2.6 (mod)**, `.../Gothic II/System/Spacer2.exe`, against
`_work/Data/Worlds/NewWorld/NewWorld.zen`. Original Gothic only — never
OpenGothic (it is built on ZenKit and shares the code under test).

**Control established:** Spacer shows *nothing* on the first load of **any**
world including the pristine retail original; the second load works and renders
fully. So "nothing on first load" is a Spacer quirk, not our bug. **Always load
twice.** Every batch below re-runs the pristine original as candidate `00`.

### 3.1 Session 1 — three whole-world attempts

| # | File | Result |
|---|---|---|
| 1 | v1 (patches 0001–0005) | Assertion |
| 2 | v2 (+0006, 0007) — 75,035,607 B | **Identical assertion, same address** |
| 3 | v3 (+0008, 0009) — 75,387,803 B | Failed; assertion text not captured |

### 3.2 The v3 assertion, finally captured (session 2)

The **stack did not move** — this is the same failure, not a new one:

```
ASSERT_FAIL()                          zWin32.cpp:3368
zCArchiverBinSafe::ReadType()          zArchiver2.cpp:668    Assertion: sSize<READ_BUFFER_SIZE
zCArchiverBinSafe::RestoreStringEOL()  zArchiver2.cpp:1360
zCArchiverBinSafe::SkipChunk()         zArchiver2.cpp:1730
zCWorld::Unarchive()                   zWorld.cpp:2501
oCWorld::Unarchive()                   oWorld.cpp:380
```

Reading: the archiver read a string length from a desynchronized offset.

### 3.3 The bisect — the decisive experiment

Nine candidates were built by **splicing**: each is the retail original's bytes
with exactly **one** structure replaced by the v3 re-save's bytes (tooling in
§7; every candidate was verified to differ from the original only in its own
group, to keep the hash-table index mapping intact, and to end exactly at its
`hashTableOffset`).

| # | Candidate | Engine |
|---|---|---|
| 00 | pristine original (control) | **OK** |
| 01 | full v3 re-save | **FAIL** — assertion above |
| 02 | original + v3 archive header | OK |
| 03 | original + **v3 `MeshAndBsp` blob** | **FAIL** — same assertion, same stack |
| 04 | original + v3 VobTree (all 23,289 VOBs) | OK |
| 05 | original + v3 hash table (insertion order) | OK |
| 06 | **full v3 re-save with the original blob spliced back in** | **OK** |
| 07 | original + v3 `locked` BOOL values | OK |
| 08 | original + v3 `dataRaw` payloads | OK |
| 09 | original + v3 `colorAniList` entries | OK |

**03 and 06 are the whole result.** The `MeshAndBsp` blob is both *sufficient*
(03 fails on its own) and *necessary* (06 passes without it) to cause the
failure. Everything else ZenKit re-serializes — the entire VOB tree, the waynet,
the archive header, the hash table in a different physical order, the `locked`
and `dataRaw` byte-level differences — **the engine accepts**.

This also explains the stack: the engine does not seek past the blob by its
declared size, it *consumes* it. Chunk 0xB020 was one byte short (the
alpha-test flag, patch 0014), so the archive cursor came out misaligned and the
next BinSafe read hit garbage → `SkipChunk` → `ReadType` → an absurd string
length → assertion.

### 3.4 Chunk-level isolation — naming the two fatal defects

Second batch, same method one level down: the original's bytes with exactly one
*mesh/BSP chunk* replaced (`chunksplice.js`, which also patches the blob's
declared size and `hashTableOffset`).

| # | Candidate | Engine |
|---|---|---|
| 00 | pristine original (control) | **OK** |
| 11 | + chunk 0xB000 (mesh header — `zDATE` pad word) | OK |
| 12 | + chunk 0xB020 (material list — nested header, **missing alpha-test byte**) | **FAIL** |
| 13 | + chunk 0xB026 (light-maps, `unordered_map` order) | OK |
| 14 | + chunk 0xC000 (**BSP header version `2` instead of `3`**) | **FAIL** |
| 15 | + chunk 0xB026 in first-reference order | OK |

**Two independent defects were each fatal on their own** — patch 0014's missing
byte and patch 0011's BSP header version — and both produce the *same*
assertion. That is the mechanism confirmed: the engine **consumes** the blob
rather than seeking past it by the declared size, so any internal length or
format error inside the mesh leaves the archive cursor misaligned and the next
BinSafe read explodes in the VOB tree.

Equally important, the two chunk defects that turned out to be **harmless to the
engine** (0xB000's uninitialised date padding, 0xB026's texture order) were
still fixed — they are byte differences, and the rule is that a difference is a
suspect until an engine A/B says otherwise.

### 3.5 The passing run

| # | Candidate | Engine |
|---|---|---|
| 00 | pristine original (control) | **OK** |
| 01 | **v5 — full re-save, patches 0001–0018** | **OK** |
| 02 | v4 — full re-save, 0xB026 order still differing | **OK** |

The final build (with patch 0017 widened, §3.6) re-saves NewWorld to a file that
differs from the engine-accepted v5 **in 4 bytes — the header clock** — so this
result carries over without a re-run.

### 3.6 A defect the widened instrument caught after the gate passed

Re-saving **OldWorld** with the v5 build classified `semantic-drift`, naming
`container.payloads.bool.oCMobSwitch…/moveable`. Patch 0017 had been derived
from NewWorld alone, where `moveable` is never true.

A census of **all 9,802 distinct (class, entry) BOOL keys across all three
retail BinSafe worlds** found exactly three keys that ever use a non-0/1 raw
value, and none of them ever uses `1` for true:

| Key | false | true |
|---|---|---|
| `oCMobContainer.locked` | 0 ×95 | 0xFFFFFFFF ×199 |
| `oCMobDoor.locked` | 0 ×217 | 0xFFFFFFFF ×31 |
| `oCMobSwitch.moveable` | 0 ×35 | 0xFFFFFFFF ×5 |

`takeable` sits in the same ZenGin bit-field group but is false in every retail
world, so **no evidence exists either way and it was left writing 1** — noted
rather than guessed. This is the widened instrument earning its keep on a world
the gate never tested.

### 3.7 State of the re-save after patches 0010–0019

All three retail G2 BinSafe worlds, re-saved with the final build and compared
byte-for-byte over every archive event (`breadth.js`):

| World | Size | Blob byte-identical | Deterministic | Byte residual | Classifier |
|---|---|---|---|---|---|
| NewWorld | 75,387,729 | ✅ 69,146,243 B | ✅ | 4× `colorAniList` | `identical`, 0 findings |
| OldWorld | 15,054,355 | ✅ 12,962,396 B | ✅ | 2× `colorAniList` | `identical`, 0 findings |
| AddonWorld | 45,228,300 | ✅ 42,540,421 B | ✅ | 16× `colorAniList` | `identical`, 0 findings |

The hash table is byte-identical and every stream ends exactly at its
`hashTableOffset`. **The only remaining byte difference in the entire corpus** is
`zCVobLight.colorAniList` (ZenGin's greyscale shorthand `255 ` vs ZenKit's
`(255 255 255)`) plus the header `date`/`user` writer stamps.

That residual is **not dismissed by reasoning**: candidate `09` in §3.3 is the
original with exactly those entries replaced, and the engine loads it.

The 0xB026 residual that survived v4 was characterised precisely before patch
0019 closed it: same 180 textures, same 10,034 light-maps, **identical light-map
geometry**, indices a *consistent permutation* — the same set in a different list
order. The original's order is not first-reference order, so it cannot be
derived; it is now preserved from load.

---

## 4. The instrument was widened (plan §5 mandated this)

`normalizeWorld` reads ZenKit's *parsed structs* and is blind to archive-
container facts by construction — that is exactly the blind spot the "clean
diff / broken engine" cell predicted. `lib/container.js` now computes a
`container` section from the archive **bytes** and `classifyDumps` treats any
difference in it as `semantic-drift` (never benign, never float-noise, never
reordered); only the header `date`/`user` *values* are benign.

It carries: header lines (stamp values split off), the hash-table key set with
per-key insertion index and hash **plus the physical order**, per-object frame
versions including nested visuals (per-class counts + a SHA-256 over the ordered
frame sequence), the per-class ordered `(entryName, entryType)` schema with a
deviation count, entry-stream counts/depth and whether the stream ends exactly
at the hash table, a SHA-256 per `(class, entryName)` over every RAW/RAW_FLOAT
payload and every BOOL raw value, and the `MeshAndBsp` chunk table
`(id, length, sha256)`.

Verification that it actually sees the blind spot — original vs. the old v3:

```
verdict: semantic-drift   findings: 10
  container.hashTable.physicalOrder
  container.payloads.raw.zCVob/dataRaw
  container.payloads.bool.oCMobContainer:…/locked
  container.payloads.bool.oCMobDoor:…/locked
  container.meshAndBsp.size, chunks[0] 0xB000, chunks[2] 0xB020, chunks[3] 0xB026, chunks[8] 0xC000
```

The same pair classified `identical` before. ZenKit's loader accepted all six
hand-built mutants used in `test/container.test.js` silently, so each is a
proven blind spot of the struct dump.

---

## 5. Known-failing test — do not "fix" it casually

`test/saveWorld.test.js` → *"saveWorld reproduces the fixture bytes except the
header date/user stamps"* **fails**.

`test/fixtures/minimal.g2.zen` was authored by **unpatched** ZenKit, so its own
bytes encode the `childs` bug — and now also the pre-0010 hash-table order, the
missing alpha-test byte and the nested-header stamps. The golden *dump* test
passes; semantics are unchanged.

Regenerating the fixture is justified but is **an explicit reviewed act, never
automatic**. It is now no longer "only the childs naming" — regenerating ratifies
patches 0010–0019 as well, which is why it was left failing again rather than
regenerated in passing. `pnpm --filter zenkit-node fixtures:regen` regenerates
both files; `--golden-only` regenerates just the `.golden.json`.

The golden JSON *was* regenerated this session, deliberately and reviewed: the
diff is **+639 / −0 lines**, purely the new additive `container` key.

---

## 6. How to resume

```bash
git checkout feature/level-editor-phase-0
cd zenkit-node
node scripts/build-zenkit.js        # resets the submodule, applies patches/*.patch
npx node-gyp rebuild
node --test test/*.test.js          # expect 71 pass / 1 fail (§5)
npm run lint
```

**Next:** T7 (harness), T8 (corpus), then T10 / E-full — §8.

### Environment

- Gothic II: `C:\Program Files (x86)\Steam\steamapps\common\Gothic II` —
  extracted MDK-style install (`_work\Data\{Meshes,Textures,Scripts,Worlds}`).
  Install is healthy — verified.
- **Pristine backup: `_work\Data\Worlds\NewWorld\NewWorld.zen.original-backup`
  (75,387,729 B, sha256 `b4dac867…`).** The install is currently restored to the
  original (hash-verified). Never write into the Gothic directory without a
  backup, and restore before leaving — `engine-batch.ps1` does both, in a
  `finally`, and refuses to start if the backup hash is wrong.
- Gothic 1 is **not installed** — G1 coverage for T8 is unavailable here.

### Build gotchas

1. `node-gyp rebuild` **deletes `build/`**, so the CMake output lives in
   `vendor-build/` deliberately. Do not "tidy" it back.
2. `scripts/build-zenkit.js` resets the submodule before patching (fixed this
   session); a dirty tree no longer aborts the build.
3. `strftime("%-d…")` is gone from ZenKit's writers (patch 0018), so
   `src/msvc_crt_guard.hh` was deleted.
4. **Never `dynamic_cast` ZenKit types** — node-gyp compiles `/GR-` on Windows.
5. Windows Smart App Control has blocked freshly linked `.node` files
   (`ERR_DLOPEN_FAILED`). Re-linking via a different shell has worked around it.
6. Nested ZenKit submodules must be initialised recursively.
7. **An MSVC compile can hang.** One `cl.exe` sat 15 minutes at 31 s CPU with no
   output. Kill the `cl.exe`/`Tracker.exe`/driver chain and re-run; it then
   completed normally.

### Manual engine procedure

Automated by `engine-batch.ps1` (§7) — it verifies the backup hash before
touching anything, installs each candidate, launches Spacer, polls the process's
top-level windows, auto-captures any assertion dialog via `EnumWindows` and
kills Spacer, asks for a verdict when Spacer exits cleanly, and restores the
pristine file (hash-verified) in a `finally`. **Load each world twice.**

Do **not** pass a world on Spacer's command line — it crashes with
`0xC000041D` on the retail original too (verified control).

---

## 7. Diagnostic tooling

Everything load-bearing now lives in the repo — `tools/README.md` documents each
one. The previous handoff left these in a scratchpad and they had to be rebuilt;
they are the only instruments that can see container-level defects, and T7 needs
them.

- `lib/container.js` — the BinSafe entry-stream walker and the `container`
  section builder (covered by `test/container.test.js`). `tools/walk.js` and
  `tools/audit2.js` are thin CLIs over it.
- `tools/bytediff.js` — the event-aligned byte diff that found defects 0010–0019.
- `tools/splice.js`, `tools/chunksplice.js` — the bisect machinery (§3.3, §3.4),
  which is also Plan B's implementation should it ever be needed.
- `tools/breadth.js` — the whole-corpus check in one command (§3.7).
- `tools/engine-batch.ps1`, `tools/dumpwin.ps1` — the engine harness.

Still session-temporary in the scratchpad, one-off probes not worth promoting:
`htdiff.js` (hash-table physical order), `lm.js` (0xB026 structure), `layout.js`,
`inspect.js`, `bools.js`/`bools2.js` (the BOOL census of §3.6), and `mutate.js`
(builds the row 10 world, §8 — reproduce it from the report there).

---

## 8. What remains: T10 / E-full

Row 1 of the plan's §5 checklist has run (Spacer, §3.5). Rows 2–10 need the
game and a person at the keyboard, and are **not** claimed by this record.

**What they can still find has narrowed.** `tools/bytediff.js` accounts for
every byte of the file — the number that matters is the coverage gap, because a
diff that silently skips a region can call a broken file clean:

```
COVERAGE: 75387729 of 75387729 bytes accounted for, gap 0
identical event bytes: 74952502
hash table identical:  true (434980 B)
differing events: 4 — all zCVobLight.colorAniList
```

So the engine reads a bit-identical mesh, BSP tree and VOB tree. On an
*untouched* re-save, collision, lighting, portals and waynet cannot differ —
that is deduction from identical input plus a deterministic loader, not a
prior. Rows 2–9 are therefore a smoke test against a process error (the wrong
file installed, a bad copy), not a fidelity probe. **Row 10 is the informative
one**, and Phase 1b's UI-edited worlds are where the checklist regains its full
force.

| # | Check | Status |
|---|---|---|
| 1 | Loads in Spacer | ✅ §3.5 |
| 2 | Loads in the game, hero spawns | ⏸ |
| 3 | Walk terrain/interiors, jump, fall — **collision** | ⏸ — but the BSP tree and mesh are bit-identical, so nothing can differ here on an untouched re-save |
| 4 | NPCs spawn and walk routines | ⏸ |
| 5 | Screenshots at ~5 fixed positions vs. the original — vertex lighting | ⏸ |
| 6 | Enter/exit a building, sector boundary — portals | ⏸ |
| 7 | Use a bed, chest, one other mobsi | ⏸ |
| 8 | Trigger one sound/zone VOB | ⏸ |
| 9 | Save, reload the savegame | ⏸ |
| 10 | **Minimal edit:** move one VOB, insert one item | ⏸ — world built and verified, below |

Rows 2–9 run on the untouched re-save, row 10 on the edited world. Both are
staged in the scratchpad `cand3/` (`00-control-original`, `01-resave-v6`,
`02-minimal-edit`); run them with
`engine-batch.ps1 -Dir cand3 -Exe Gothic2`.

The row 10 world was produced by `mutate.js` through the two Phase-0 mutations
only, and verified on reload:

- **moved** VOB `2/962` (`NW_CITY_TABLE_PEASANT_01.3DS`, the nearest visual VOB
  to the `START` waypoint) 300 units up — it should visibly hang in the air.
- **inserted** `oCItem` `ITFO_APPLE` named `ITEM_PHASE0_APPLE_01` 80 units above
  `START` — at the hero's feet on a new game, and it must be takeable.
- VOB count 23,288 → 23,289; **every other VOB byte-identical in the dump.**

G1 coverage remains unavailable (Gothic 1 is not installed).
