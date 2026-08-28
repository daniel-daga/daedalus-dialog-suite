# Engine acceptance record & session handoff — 2026-08-24/25

Phase 0 tasks **T6.5** (§5 "E-early"), **T7**, **T8** and **T10**
(`../../docs/plans/level-editor-phase-0.md`).
Branch: `feature/level-editor-phase-0`. Nothing pushed to master.

**Status: T6.5 PASSED, T7 and T8 landed. Verdict: Plan A, scoped to the
BinSafe path** (decision matrix cell *clean diff / engine OK*; written up in
`../../docs/plans/level-editor.md` §5).

A single-variable engine bisect (§3.3) localised the failure to the `MeshAndBsp`
blob, chunk-level isolation (§3.4) named the two fatal defects, and after ten
further ZenKit patches **Spacer loads a fully re-saved retail NewWorld** (§3.5).
All four retail G2 BinSafe worlds re-save with a **byte-identical mesh/BSP blob**
and classify `identical` — now confirmed by the T7 harness over the whole
install (§10).

**The ASCII path does not work at all** and is deliberately out of Phase 0's
scope: ZenKit cannot re-load its own ASCII output (a hard `0xC0000409` on all
20 ASCII worlds) and every raw entry it writes is corrupt. Evidence, the four
named defects and the scope decision are in §10.2 and §10.3.

**T10 / E-full has now run and PASSED** — all three candidates, control
included, row 10 a full pass with the inserted item takeable. Rows 5, 7, 8, 9
were not exercised and are not claimed (§8).

---

## 1. What was built (T1–T9 — all green)

New workspace `zenkit-node/`: an N-API binding around ZenKit plus the drift
classifier, the container-level instrument and the `zen-roundtrip` harness.
**89 tests, all passing.**

| Task | State | Notes |
|---|---|---|
| T1 workspace + two-stage build | ✅ | CMake pre-step builds ZenKit static → `vendor-build/zenkit/out/`, then node-gyp compiles only the binding. `prebuildify`/`node-gyp-build` pipeline preserved. |
| T2 `loadWorld` / `worldStats` | ✅ | Version is **verified, never guessed**: a `MeshAndBsp` BSP-version scan; mismatch throws. |
| T3 windows-1252 at the edge | ✅ | `src/encoding.{hh,cc}`; umlaut round-trip test. |
| T4 `normalizeWorld` | ✅ | Direct struct reads, never via the save path. All 44 VOB classes. Self-contained SHA-256. Checked-in golden. **Now also carries a `container` section** — §4. |
| T5 classifier | ✅ | `lib/classify.js` — `identical` / `float-noise` / `reordered` / `semantic-drift`. Container facts are **always** `semantic-drift`. |
| T6 `saveWorld` + minimal mutations | ✅ | Atomic temp+rename; `setVobPosition`, `insertItemVob`. **Refuses a non-BinSafe world** unless `{ allowNonBinSafe: true }` — §9, §10.3. |
| T9 CI wiring | ✅ | `.github/workflows/zenkit-node.yml`, path-filtered, **Windows only** since 2026-08-25, also running `zen-roundtrip --fixtures`. **Green: run `32934967838`** (build, 89 tests, C2 roundtrip, lint) — §9. |
| T6.5 engine gate | ✅ | Passed, §3.5. |
| T7 `zen-roundtrip` harness | ✅ | `scripts/zen-roundtrip.js`, two modes, per-world child-process isolation, coverage-honest report — §10. |
| T8 corpus run | ✅ | Ran; **scoped to BinSafe**, with the ASCII reason measured — §10.2, §10.3. |
| T10 / E-full | ✅ | Ran 2026-08-25 23:46, all three candidates PASS; rows 5/7/8/9 not exercised — §8. |

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

### 3.6 Two defects the widened instrument caught after the gate passed

Both were found by re-saving a world the engine pass never touched, and both
were the *same mistake*: a rule derived from too small a corpus.

1. Re-saving **OldWorld** classified `semantic-drift`, naming
   `container.payloads.bool.oCMobSwitch…/moveable`. Patch 0017 had been derived
   from NewWorld alone, where `moveable` is never true.
2. After widening it to `locked`+`moveable`, re-saving **DragonIsland** — the
   *fourth* BinSafe world, missed because it does not follow the
   `<Name>/<Name>.zen` layout — flagged `oCMOB/focusOverride` as well.

The rule is now derived from a census of **all 10,279 distinct (class, entry)
BOOL keys across every retail BinSafe world**. Exactly three entry names ever
hold a non-0/1 value, and none ever uses `1` for true:

| Entry name | Classes | false | true |
|---|---|---|---|
| `locked` | oCMobContainer, oCMobDoor | 0 ×326 | 0xFFFFFFFF ×249 |
| `moveable` | oCMobSwitch | 0 ×44 | 0xFFFFFFFF ×5 |
| `focusOverride` | oCMOB, oCMobSwitch | 0 ×171 | 0xFFFFFFFF ×4 |

The other 10,274 keys are 0/1. `takeable` sits in the same ZenGin bit-field
group but is false in every retail world, so **no evidence exists either way and
it was left writing 1** — noted rather than guessed.

The lesson is the corpus, not the rule: both misses were invisible to the engine
gate (which tested one world) and to the struct dump (which cannot see a raw BOOL
value). Only a byte-level instrument run over *every* world catches them — which
is what `tools/breadth.js` now does in one command.

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

## 5. The golden fixture — regenerated, reviewed, 2026-08-25

`test/saveWorld.test.js` → *"saveWorld reproduces the fixture bytes except the
header date/user stamps"* failed for two sessions on purpose:
`test/fixtures/minimal.g2.zen` was authored at commit `1b335e3`, i.e. by
**unpatched** ZenKit *and* from an older `src/fixture.cc`, while
`src/fixture.cc` itself had since been extended (at `623ca5d`) to cover
patches 0012/0016/0019. The checked-in bytes were stale against both.

**Decision: regenerated** (`npm run fixtures:regen`). The review that justifies
it — every byte difference between the old fixture and a freshly authored one,
each traced to a named cause. Nothing is unexplained.

The entry stream aligns event-for-event (97 = 97, same names, types and object
paths) once `childs<N>` is normalized, and **only two payloads differ**:

| Where | Old fixture | New fixture | Cause |
|---|---|---|---|
| text header | `date ` empty | `date 25.8.2026 13:14:03` | **0018** — the glibc-only `strftime` wrote nothing on MSVC |
| hash table | 37 keys | 38 keys (`+childs4`) | **0008** — global `childs` counter (4 VOBs → `childs0..4`) |
| hash table | physical = insertion order | ascending hash, descending index | **0010** |
| `zCVobSpot/dataRaw` | `…1802 0000…` | `…1802 8000…` | **0016** + `fixture.cc` `packed_reserved_bit = true` |
| `oCMobContainer/locked` | `01000000` | `ffffffff` | **0017** |
| chunk 0xB000 (34 B) | pad word `0000` | pad word `014a` | **0012** + `fixture.cc` `Date{…, 0x4A01}` |
| chunk 0xB020 (357→339 B) | nested header carries `date `/`user `, 10-char `objects` field | neither; 9-char field | **0013** |
| chunk 0xB020 | ends at the last material | one trailing `01` byte | **0014** |
| chunk 0xB026 (8→288 B) | 0 textures, 0 light-maps | 3 textures, 4 light-maps in first-reference order | `fixture.cc` light-map content (added at `623ca5d`), listed per **0015**/**0019** |
| chunk 0xC000 (6 B) | version `2` | version `3` | **0011** |

Patches 0001–0007, 0009 change nothing on this fixture — it has no camera
trajectory, no sound/trigger VOBs, and its `texScale` values already round-trip.

The new fixture **round-trips byte-identically** (`save(load(f))` equals `f`
modulo the header stamps, 3515 B normalized on both sides), so the C2 regression
claim is now anchored on a file the current writer actually produces.

The `.golden.json` was regenerated with it. Its diff is confined to exactly the
same causes: `bsp.lightMapCount` 0→4, `container.header.date`,
`container.hashTable` (count 37→38, `+childs4`, permuted order,
`physicalOrder` hash), the `childs0`→`childs4` schema entry, the `dataRaw` and
`locked` payload hashes, and `container.meshAndBsp` (size 900→1162 plus the four
chunk hashes above). **`vobs`, `mesh` (bar `lightMapCount`), and `waynet` are
untouched** — the semantics did not move.

Four other tests carried fixture-derived constants and were re-verified by hand
against the table above rather than pasted from the failure output:
`container.test.js` (d) now mutates `0xFFFFFFFF → 1` instead of `1 → 0xFFFFFFFF`
(the fixture already holds ZenGin's signed-bit-field `true`), the header-date
assertion became a shape match, and the hash-table count / mesh sizes were
updated. **73 tests, 73 pass at that commit. Lint clean.**

Regenerating a golden remains **an explicit reviewed act, never automatic**.
`npm run fixtures:regen` regenerates both files; `--golden-only` regenerates
just the `.golden.json`.

---

## 6. How to resume

```bash
git checkout feature/level-editor-phase-0
cd zenkit-node
node scripts/build-zenkit.js        # resets the submodule, applies patches/*.patch
npx node-gyp rebuild
npm test                            # expect 89 pass / 0 fail
npm run lint
```

**T10 / E-full is done** (§8). The only Phase-0 exit criterion still open is
CI on macOS and Windows (§9).

### Environment

- Gothic II: `C:\Program Files (x86)\Steam\steamapps\common\Gothic II` —
  extracted MDK-style install (`_work\Data\{Meshes,Textures,Scripts,Worlds}`).
  Install is healthy — verified.

  **The MDK layout depends on six VDFs being renamed `.disabled`** —
  `Worlds`, `Worlds_Addon`, `Meshes`, `Meshes_Addon`, `Textures`,
  `Textures_Addon` — so that the engine reads loose files from `_work\Data`
  instead. `vdfs.cfg` globs `Data\*.VDF`, so a Steam reinstall or a "verify
  integrity" **restores all six and silently breaks this**, in two ways:

  1. `Worlds.vdf` carries its own `NewWorld.zen`, so an engine run may not be
     reading the candidate at all — **any T10 verdict taken in that state is
     void**, pass or fail.
  2. It also crashes the game. Measured on 2026-08-25 after a reinstall:
     `Gothic2.exe` took an access violation ~5 s after launch, three runs out
     of three, reading `[null+0x18]` in an ASLR-relocated DLL (`6E40A736`,
     `6E50A736`, `71A5A736` — one offset, three bases), long before any world
     load. Re-parking the six VDFs as `.disabled` fixed it: two clean 40 s and
     30 s `Gothic2` runs and a clean `Spacer2` run, no error dialog.

  The pairs were byte-identical, so re-parking loses nothing and is reversible
  by renaming back. Check this **before** blaming a candidate — and note the
  crash reproduced on candidate `00`, the pristine control, which is what made
  it obvious the file was not implicated.
  `tools/startup-probe.ps1` is the unattended check: it launches an engine,
  watches for an error dialog and always kills what it started, without
  touching the install.

#### The oracle for T10 is not stock — state it with every verdict

`Gothic2.exe` **never rendered on this machine**. T6.5 (§3.5) was won with
Spacer, which does render; the game showed a black screen with working audio in
every stock configuration, so rows 2–10 could not run at all. What was measured,
in order, each with a launch:

| Configuration | Result |
|---|---|
| 800×600 fullscreen, stock | runs, music, **black** |
| + `DWM8And16BitMitigation` compat shim | runs, **black** |
| windowed (`zStartupWindowed=1`) + SystemPack `FixAppCompat=2` | window collapses to its title bar, exits |
| windowed + `FixAppCompat=1`, 1024×768 | silent access violation, `0xC0000005` |
| 1024×768 fullscreen, `FixAppCompat=1` | runs, **black** |
| **+ GD3D11** | **renders** |

So the engine that produces the T10 verdicts is **Gothic II 2.6 (fix) +
SystemPack + GD3D11** (kirides fork, nightly `51efd73`, installed as
`System\ddraw.dll`), not a stock install. Three consequences:

1. **The gate still holds.** GD3D11 replaces the DirectDraw/D3D7 *rendering*
   path by hooking; it does not touch ZEN parsing, the archiver or the BSP —
   the code the fidelity claim is about. It is not ZenKit-derived either, so
   the OpenGothic objection (shared code under test) does not apply.
2. **Checklist row 5 is weakened.** "Screenshots at ~5 fixed positions vs. the
   original — vertex lighting" is now candidate-vs-control only: GD3D11 changes
   lighting by design, so the absolute look is not the retail look. Both sides
   render through the same renderer, so the A/B is still valid — it just cannot
   speak to whether our lighting matches *ZenGin's*.
3. **`-Windowed` is unavailable here.** Windowed mode crashed the process
   outright (row 4 of the table), so the batch must run fullscreen.

SystemPack hooks through its own `Vdfs32g.dll` (not `ddraw.dll`), so it and
GD3D11 coexist. GD3D11 declines to hook Spacer — "GD3D11 Renderer doesn't work
with your game version" — and Spacer then runs normally on its own renderer, so
**Spacer remains a stock oracle** and §3.5 is unaffected.
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
- `tools/breadth.js` — the whole-corpus check in one command (§3.7). Superseded
  by `scripts/zen-roundtrip.js` (§10), which is the same measurement as a real
  harness; kept because it is a two-screen script that is quicker to hack on.
- `tools/engine-batch.ps1`, `tools/dumpwin.ps1` — the engine harness.

- `mutate.js <outDir>` — stages the three T10 candidates (§8): the pristine
  control, an untouched re-save, and the row 10 world carrying the two Phase-0
  mutations. **Promoted this session** — the previous handoff left it in a
  scratchpad and it had to be rebuilt from prose.

Still session-temporary in the scratchpad, one-off probes not worth promoting:
`htdiff.js` (hash-table physical order), `lm.js` (0xB026 structure), `layout.js`,
`inspect.js`, and `bools.js`/`bools2.js` (the BOOL census of §3.6).

---

## 10. T7 and T8 — the harness and the corpus run (2026-08-25)

### T7 — `scripts/zen-roundtrip.js`

`tools/breadth.js` did the work for one world; T7 is that as the harness the
plan specifies (§3 CLI, §6 acceptance test), with three things breadth.js did
not have.

```
# C1 — fidelity, developer-local. Every original ZEN is its own reference.
node scripts/zen-roundtrip.js --root "<Gothic II>/_work/Data/Worlds" --game g2 \
     --strict --report-dir reports/

# C2 — regression, CI. The checked-in fixtures. NEVER a fidelity result.
node scripts/zen-roundtrip.js --fixtures --strict
```

Per world: load → save → save again → re-load the first save → classify, plus
blob identity, determinism and the event-aligned byte diff with its coverage
gap. `--drill` adds the first differing bytes per structure; `--report-dir`
writes `zen-roundtrip.json`; `--strict` exits 1 on `semantic-drift`,
`unreadable` or `crashed`.

Three things it does that the seed did not:

1. **Every world is measured in a child process.** ZenKit aborts the process
   outright on the ASCII path (§10.2), and a crash is a result to record, not
   the end of the run. A crashed row still carries the file's archiver, format
   and size, read by the parent, so "20 ASCII worlds crashed" is a finding
   rather than "20 rows crashed".
2. **Coverage is counted against every file found, not every file that
   survived.** A run where 20 of 28 worlds never produced a measurement must
   not print a full-coverage line. A world whose container the instrument
   cannot read is reported `struct-only`, never as a fidelity pass — this is
   the §3 ASCII problem faced rather than papered over.
3. **The claim is printed.** `--fixtures` says in the summary that it is C2 and
   not a fidelity result.

Two instrument defects were fixed on the way, both found by pointing it at
real data:

- `containerFromBuffer` threw out of `readHashTable` on any non-BinSafe
  archive, which took `normalizeWorld` down with it — so no ASCII world could
  be dumped at all. It now returns `{ archiver, format, covered: false, header }`
  and `classifyDumps` reports `containerCoverage`. An archive the walker cannot
  read must report reduced coverage, never silent agreement.
- The determinism check compared raw bytes, so two saves of NewWorld that
  straddled a second read as `NONDETERMINISTIC`. It now compares
  stamp-normalized bytes and reports `savesBitIdentical` separately; the
  §3.7 determinism result stands.

Covered by `test/roundtrip.test.js` (7 tests, driving the real CLI through
`spawnSync`). The plan's acceptance test — "a seeded corrupt fixture exits
non-zero and names the offending structure" — is seeded with a `locked` BOOL
rewritten from `0xFFFFFFFF` to `1`: ZenKit reads both as `true`, so the struct
dump stays clean and only the container instrument can catch it.

### T8 — the corpus run

Every `.zen` in the developer-local G2 install, 2026-08-25:

```
COVERAGE: 28 .zen found; 4 measured (4 container-instrumented, 0 struct-dump only),
          20 crashed, 0 unreadable, 4 skipped (not worlds)
VERDICTS: 20× crashed [ASCII], 4× identical [BIN_SAFE], 4× not-a-world [ASCII]
```

| World | Archiver | Verdict | Blob identical | Coverage gap | Byte residual |
|---|---|---|---|---|---|
| NewWorld | BinSafe | `identical` | ✅ | 0 | 4× `colorAniList` |
| OldWorld | BinSafe | `identical` | ✅ | 0 | 2× `colorAniList` |
| AddonWorld | BinSafe | `identical` | ✅ | 0 | 16× `colorAniList` |
| DragonIsland | BinSafe | `identical` | ✅ | 0 | **none** |
| 20 ASCII worlds | zCArchiverGeneric | **`crashed`** | — | — | — |
| FireTree_Lamp/Lamp1/Medium, ItLsTorchBurning | zCArchiverGeneric | `not-a-world` | — | — | — |

The four `not-a-world` files carry no `MeshAndBsp` — they are VOB libraries,
not worlds, so a *world* round-trip has nothing to say about them. That is a
skip with a reason, not a pass and not a failure.

### 10.1 The BinSafe half is done

All four retail BinSafe worlds re-save with a byte-identical mesh/BSP blob and
hash table, deterministically, gap 0, classifying `identical`. This confirms
§3.7 on a fourth world and through an independent code path.

### 10.2 The ASCII half: the writer is not usable

**All 20 ASCII worlds load and save, and then abort the process when the
re-save is loaded back** — `STATUS_STACK_BUFFER_OVERRUN`, exit `0xC0000409`,
every one of them. Isolated to the reload step:

```
load1 ok
save ok
exit=-1073740791          # 0xC0000409, loading the re-save
```

It is not a retail-content quirk: a 4 KB world authored by ZenKit's own ASCII
writer (`_authorFixtureWorld(..., 'ascii', 'g2')`) crashes the same way.
**ZenKit cannot read back what its ASCII writer produces.**

Four writer defects were identified, three of them by direct file evidence
from the retail `OldCamp.zen` re-save:

```
file       3979132 -> 3512001  (-11.7%)
blob       2914946 -> 2914946  identical true
ascii tail 1064002 ->  596878  (-43.9%)
pack=0 / pack=1   original 1277 / 0   re-save 0 / 1277
```

| # | Defect | Evidence |
|---|---|---|
| **A1** — FIXED, patch 0024 | `WriteArchiveAscii::write_raw` emits a **stale second hex digit** for every byte below `0x10`. `std::to_chars` does not null-terminate, so `buf[1]` still holds the previous byte's low nibble and the `buf[1] == '\0'` branch is only ever taken on the first byte of the file. **Every raw entry the ASCII writer produces is corrupt.** | The LEVEL-VOB's `trafoOSToWSPos=vec3:0 0 0` re-saves as packed bytes `05 05 05 05 05 05 05 05 05 05 05 05` — `6.25e-36` per axis instead of `0` — and the identity rotation as `0505803f 0f0f0f0f…0f0f803f`. The filler byte is always the previous byte's low nibble. |
| **A2** — open | `VirtualObject::save` writes VOBs **packed unconditionally** (a file-static `pack = true`), so a world loaded unpacked is written packed. | All 1277 OldCamp VOBs are `pack=int:0` in the original and `pack=int:1` in the re-save; the ASCII tail loses 43.9%. |
| **A3** — open, unreachable while A2 stands | `WriteArchiveAscii::write_mat3x3` writes a `rawFloat:` entry, but `ReadArchiveAscii::read_mat3x3` reads a `raw:` entry — and **ZenGin writes `raw:`**. The unpacked path could not be read back either. | All 1277 original `trafoOSToWSRot` entries are `raw:`; ZenKit's writer would emit `rawFloat:`. |
| **A4** — FIXED, patch 0025 | The top-level ASCII header's `objects` field is padded to a different width than ZenGin's. | `objects 1835     ` (original) vs `objects 1835       ` (re-save). |

The one piece of good news: **the `MeshAndBsp` blob is byte-identical on the
ASCII path too** (2,914,946 B on OldCamp), because it is written by the same
patched `Mesh`/`BspTree` code the BinSafe result already validates. Whatever
an ASCII patch series would have to fix, it is all above the blob.

### 10.4 The ASCII writer, 2026-08-27 — three patches and a corpus that measures

§10.2 was written when no ASCII world survived a re-save. Three patches later
every one of them does. Same command, same install, same day's binary:

```
before  28 .zen found;  4 measured, 20 crashed,    0 unreadable, 4 skipped
after   28 .zen found; 24 measured,  0 crashed,    0 unreadable, 4 skipped
        (24 container-instrumented)
VERDICTS: 4× identical [BIN_SAFE], 4× not-a-world [ASCII], 20× semantic-drift [ASCII]
```

> **The numbers above are dated 2026-08-27, and the BinSafe half broke and was
> repaired in between.** Patch `0028` rebuilt `zCTrigger`'s deprecated `flags`
> byte from the two bools `load` unpacks and so dropped the bits that have no
> bool — retail carries `0b00010010`, so bits 1 and 4 were lost on every
> trigger-family VOB, and the same command on 2026-08-28 reported
> `4× semantic-drift [BIN_SAFE]`. Patch `0044` keeps those bits and merges them
> back in when writing; re-run on 2026-08-28 after it, the same command over the
> same install reports `4× identical [BIN_SAFE]` again, i.e. exactly the line
> above. Diagnosis and the process lesson: `docs/plans/level-editor.md` §16.13.
> The ASCII half of this table never changed.


| Patch | Defect | Result |
|---|---|---|
| `0024` | **A1** — `write_raw` read a hex digit `std::to_chars` never wrote, so every byte below `0x10` carried the previous byte's low nibble | Every `raw:` entry now decodes to the bytes the packer produced, asserted byte-exactly against the BinSafe fixture in `test/container.test.js`. It was also the reload blocker: the corruption landed in the packed `zCVob` flag word and `VirtualObject::load` then demanded an object frame where the archive held an entry |
| `0025` | **A4** — the header's `objects` field padded to 11 where ZenGin pads to 9 | Retail `OldCamp.zen` re-saves with `objects 1835     `, byte-identical to the original line |
| `0026` | **A5**, new — `write_byte`/`write_word` emitted `byte:`/`word:` type tokens that `ReadArchiveAscii::read_byte`/`read_word` reject (both call `read_entry("int")`) | Found by the corpus run after 0024: 19 of the 20 worlds still failed, at the first `decalAlphaWeight` in the file. ZenGin settles it — 144,111 `int:` entries across the 24 ASCII worlds and **zero** `byte:` or `word:`. This is what took the corpus from 0 measured ASCII worlds to 20 |

**A5 was invisible to CI and had to be made visible.** `decalAlphaWeight` is the
only `write_byte` field reachable outside a savegame, and the authored fixture
had no decal — so the fixture round-tripped clean while all 20 retail worlds
failed. `BuildVobTree` now hangs a `VisualDecal` on the chest (no VOB added, no
index path moved), which is why the fixture's object count is 12 and its frame
count 19. Anything with a `byte`- or `word`-typed field is worth the same
treatment.

**What this does not claim.** The fixture is authored by ZenKit's own ASCII
writer, so `--fixtures` proves self-consistency and nothing about ZenGin. There
is still no ZenGin-written ASCII fixture in the repository, and `saveWorld`
stays BinSafe-only: 20 worlds classifying `semantic-drift` is a measurement,
not a passing grade, and no ASCII world has been through the engine.

**What the 20 drifts are — two findings, and only two.** The instrument names
them exactly, across all 20 worlds:

| Finding | Count | Diagnosis |
|---|---|---|
| `vobs[].flags.physicsEnabled` true → false | 396 | **A6**, new. `VirtualObject.cc:251` writes packed bit 6 as `physics_enabled && rigid_body` on G2, but `rigid_body` is only ever populated inside `if (r.is_save_game())` (`:210`). In a world, `rigid_body` is always empty, so every `physicsEnabled` flag is dropped on save. The `&& rigid_body` guard belongs at `:325`, where the rigid body is actually written, and it is already there. **Not ASCII-specific — it is the packed `zCVob` writer, so the BinSafe path the editor saves through has it too.** It changes no retail byte today: measured 0 `physicsEnabled` VOBs across NewWorld, OldWorld and AddonWorld (41,393 VOBs), which is why those three still classified `identical` when this was written (they classified `semantic-drift` between patches `0028` and `0044`, for an unrelated reason — the note above §10.4's table, now closed). A user-edited or modded world is another matter |
| `vobs[].flags.animMode` | 4 | Undiagnosed. Four VOBs in the whole corpus |

A2 and A3 remain open and are unchanged by all of this: both live on the
unpacked write path, which nothing reaches while `VirtualObject.cc:12`'s
file-static `pack` is unconditionally true and has no caller to flip it.

### 10.3 Scope decision — Phase 0 covers the BinSafe path only

**T8 is scoped down, deliberately.** Phase 0's fidelity claim covers
`zCArchiverBinSafe` worlds: `NewWorld`, `OldWorld`, `AddonWorld`,
`DragonIsland`. The 20 `zCArchiverGeneric`/ASCII worlds — which includes every
`*_Part_*.zen` the plan's T8 asks for by name — are **out of scope, with the
reason measured and named above**.

Why scoped down rather than patched:

- A1–A4 are a **patch series of their own**, of roughly the size of
  0010–0019, in a writer path that has had no fidelity work at all. Landing
  part of it while calling T8 done would be exactly the "unsupported claim of
  coverage" the brief rules out.
- Every one of those patches would then need its own engine A/B, because the
  rule that has held all project long is that no byte difference is dismissed
  by reasoning. That is a second T6.5, not a finishing touch.
- **The blocking risk is already retired.** Phase 0 exists to answer "does the
  engine accept a world we re-serialized". It does — for the four worlds the
  editor would actually open, which are the four whole worlds. The `*_Part_*`
  files are Spacer's compile-time source layers, not the shipped playable
  worlds the engine loads.

What this costs, stated plainly: the level editor cannot round-trip an ASCII
world until that series lands, and **it must refuse to try** — a save that
silently corrupts every raw entry and cannot be re-opened is worse than no
save. `zen-roundtrip` already reports those worlds as `crashed`; the binding
should reject a non-BinSafe world for *saving* in Phase 1a, and that is now
the first item of ASCII work rather than the last.

---

## 9. Known scope limits

**Only 4 of the 28 `.zen` files in a G2 install are BinSafe.** Everything this
record establishes is about that path. Written before T8; **§10.2 and §10.3
are the measured answer** — the ASCII writer turned out not to work at all, and
Phase 0's scope is now formally BinSafe-only.

| Archiver | Files |
|---|---|
| `zCArchiverBinSafe` / `BIN_SAFE` | `NewWorld.zen`, `OldWorld.zen`, `AddonWorld.zen`, `DragonIsland.zen` |
| `zCArchiverGeneric` / `ASCII` | the other 24 — every `*_Part_*.zen`, `OldCamp`, `Surface`, and the small VOB-library ZENs |

The plan's T8 says "every original world … **including all parts**". All the
parts are **ASCII**, and `ArchiveAscii.cc` has had *no* fidelity work — patch
0018 touched it only for the date format. This expectation was right and then
some: T8 found four ASCII writer defects, one of which makes ZenKit unable to
re-load its own output at all (§10.2). `lib/container.js` now says so in the
dump (`covered: false`) instead of throwing; a real ASCII sibling for it and
for `tools/bytediff.js` is the second half of that future work.

Also open:

- **`takeable`** — in the same ZenGin bit-field group as the three flags patch
  0017 special-cases, but false in every retail world, so there is no evidence
  either way. Left writing `1`. A mod world with a takeable mob would settle it.
- **`colorAniList`** — the last byte residual on the BinSafe path. ZenGin writes
  greyscale shorthand (`255 `), ZenKit expands to `(255 255 255)`. Patching
  `VLight::save` to emit the shorthand when r==g==b would make BinSafe re-saves
  byte-identical bar the header stamps. Engine-tested as harmless (§3.3
  candidate 09), so this is fidelity polish, not a defect.
- **The ASCII writer** — four named defects, §10.2. A patch series of its own,
  plus an engine A/B per patch. **The refusal §10.3 asks for has landed**
  (2026-08-25): `saveWorld` throws unless the handle was loaded from a BinSafe
  archive, naming the format. `scripts/zen-roundtrip.js` opts out per call with
  `{ allowNonBinSafe: true }` — measuring the unverified writer paths is what
  the harness is for, and its C1 verdicts are unchanged by the guard. The guard
  is tested against a **BINARY** world: an ASCII handle cannot be produced
  in-process at all (loading ZenKit's own ASCII output aborts the process), and
  both formats take the same `format != BINSAFE` branch.
- **T9 CI — now GREEN, on Windows only.** The matrix was narrowed on
  2026-08-25 (run `32934967838`, build + 89 tests + C2 roundtrip + lint all
  green on `windows-2022`). Linux and macOS were **both green when dropped**
  (run `32903532421`), which is also the only confirmation that the arm64
  `-msse2` fix works — so nothing broken is hidden and re-adding them is one
  matrix line.

  **Windows found three real defects the other two platforms could not**, which
  is the argument for the narrowing rather than against it:
  1. `windows-latest` now ships **Visual Studio 18**; node-gyp 11.5.0 cannot
     identify it and dies at configure in the *daedalus-parser* workspace.
     `zenkit-node`'s own CMake step is immune — it uses `vswhere`. Pinned to
     `windows-2022`.
  2. The `test` script was `node --test test/*.test.js`, which relies on the
     **shell** expanding the glob. `pwsh` does not, and Node 20's `--test` does
     not glob — so `npm test` had never worked on Windows in PowerShell or cmd.
     Now bare `node --test`.
  3. A byte test depended on the **length of the machine's username**. The
     BinSafe header's `hashTableOffset` counts raw bytes, so it shifts with the
     `user ` stamp; blanking the stamp text left the derived field behind. It
     passed for `Daniel` (6) and CI's `runner` (6) and failed for
     `runneradmin` (11), one byte at offset 81, `0x0B48` vs `0x0B4D`. **Not a
     writer defect** — the test was wrong from the day it was written.
- **Gothic 1** is not installed; no G1 coverage of anything.

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
| 1 | Loads in Spacer | ✅ §3.5, and again in §8's 2026-08-27 run against a fourth, **UI-edited** candidate |
| 2 | Loads in the game, hero spawns | ✅ **all four candidates** (§8, 2026-08-27) |
| 3 | Walk terrain/interiors, jump, fall — **collision** | ✅ |
| 4 | NPCs spawn and walk routines | ✅ |
| 5 | Screenshots at ~5 fixed positions vs. the original — vertex lighting | ⏸ **and degraded** — GD3D11 changes lighting by design, so this can now only be candidate-vs-control, never against the retail look (Environment) |
| 6 | Enter/exit a building, sector boundary — portals | ✅ |
| 7 | Use a bed, chest, one other mobsi | ✅ (2026-08-27, Daniel) |
| 8 | Trigger one sound/zone VOB | ✅ (2026-08-27, Daniel) |
| 9 | Save, reload the savegame | ✅ (2026-08-27, Daniel) |
| 10 | **Minimal edit:** move one VOB, insert one item | ✅ **full pass — both mutations, apple taken** (2026-08-25); ✅ crate/turned table/renamed VOB/raised-and-turned retail VOB (2026-08-27, `03-ui-edited.zen`) |

Rows 2–9 run on the untouched re-save (and, as of 2026-08-27, on the UI-edited
world too), row 10 on the edited worlds.

### The run — 2026-08-25 23:46, all three candidates, PASS

`tools/engine-batch.ps1 -Exe Gothic2`, fullscreen (windowed crashes here —
Environment), against the engine named in Environment (**not stock**: 2.6 fix +
SystemPack + GD3D11). From `results.log`:

```
23:46:12  00-control-original.zen  sha b4dac867…  → ok
23:46:59  01-resave.zen            sha a2f7b7b9…  → ok
23:47:43  02-minimal-edit.zen      sha 27a137c5…  → ok
23:48:48  restored pristine NewWorld.zen (hash verified)
```

**The control ran first and passed in the same session**, and the VDF layout
was verified beforehand so the engine could only have read `_work` — both
preconditions this record insists on.

**Row 10 is a full pass and it is the one that carried information.** The moved
VOB (`NW_CITY_TABLE_PEASANT_01`, +300 units) visibly hung in the air near
`START`, and `ITEM_PHASE0_APPLE_01` was not merely visible but **picked up into
the inventory**. Takeability is the half that could have failed silently: an
`oCItem` whose archive representation is subtly wrong can still render. It did
not.

**What was NOT run, stated rather than implied.** Rows 5, 7, 8 and 9 were not
exercised — the per-candidate wall-clock (47 s / 44 s / 65 s) does not fit a
savegame round-trip, and they are not claimed. On an *untouched* re-save that
is defensible on the argument above (bit-identical mesh, BSP and VOB tree, gap
0), which makes rows 2–9 a smoke test against a process error rather than a
fidelity probe — and rows 2, 3, 4 and 6 supplied that smoke test. It is **not**
defensible for Phase 1b's UI-edited worlds, where the checklist regains its
full force and rows 7–9 must actually run.

### Gate 2 — the run — 2026-08-27, Spacer2 and Gothic2, four candidates, PASS

The Phase 1b milestone: a fourth candidate, `03-ui-edited.zen`, built through
the real editor UI (`daedalus-dialog-editor/scripts/build-gate2-candidate.js`)
rather than through the binding directly — a placed crate, a turned table, a
renamed-and-refitted VOB (visual swapped, `cdDynamic` toggled), and one
**retail** VOB raised 300 units and turned 90° about Y. Staged alongside `00`–
`02` in `%TEMP%\gate2-candidate` with `tools/mutate.js`. VDF layout and the
backup hash were verified beforehand; the control ran first in both passes.

Spacer2, `results.log`:

```
13:14:21  00-control-original.zen  sha b4dac867…  → ok
13:15:49  01-resave.zen            sha 20621bd3…  → ok
13:16:43  02-minimal-edit.zen      sha 01446231…  → ok
13:17:26  03-ui-edited.zen         sha 8ad55a22…  → ok
13:18:07  restored pristine NewWorld.zen (hash verified)
```

Gothic2, `results.log`:

```
13:19:36  00-control-original.zen  sha b4dac867…  → ok   (54 s)
13:20:30  01-resave.zen            sha 20621bd3…  → ok   (103 s)
13:22:13  02-minimal-edit.zen      sha 01446231…  → ok   (40 s)
13:22:53  03-ui-edited.zen         sha 8ad55a22…  → ok   (58 s)
13:23:51  restored pristine NewWorld.zen (hash verified)
```

All eight loads (four candidates × two engines) came back clean — no assertion
dialog captured by `engine-batch.ps1` on any of them, `ok` at every verdict
prompt. `03-ui-edited.zen` is the first engine run of a world that went through
the app's UI at all, and its passing load in both Spacer and Gothic2 is Gate
2's headline result: **the ops the plan's Phase 1b shipped — `MoveVob`,
`RotateVob`, `SetVobProp`, `AddVob`, `ReparentVob` — produce a file the engine
accepts**, on top of the retail VOB whose bounding box the app itself
re-fitted on a rotation.

Rows 7, 8 and 9 (bed/chest/mobsi, a sound/zone trigger, a savegame round-trip)
are recorded **passed on all four candidates**, per Daniel at the keyboard.
Stated plainly: the per-candidate wall-clock (54 s / 103 s / 40 s / 58 s) is in
the same range the 2026-08-25 run measured and called too short for a
savegame round-trip on top of rows 2–6 — this record does not independently
corroborate that rows 7–9 got the depth of exercise their description implies,
and takes the verdict on Daniel's word rather than on a measurement. If either
op set is later found to disagree with the engine on a bed/chest/mobsi
interaction, a sound/zone VOB, or a save/reload round trip, this is the entry
to revisit.

**Not run and not claimed here either:** row 5 (screenshots, candidate-vs-
control only per Environment) was not exercised, and the deleted-VOB and
moved-waypoint edits the board flagged as absent from every staged candidate
are still absent from `03-ui-edited.zen` — that gap is unchanged by this run.

**The ops this gate covers are the five named above, and no others.** Three
have shipped since the candidate was built and therefore have **no engine
verdict at all**: `DeleteVob`, `MoveWaypoint` and `SetVobClassProp`. Quote this
result as *"Gate 2 passed for the ops it tested"*, never as "Gate 2 passed".
A removed subtree is the edit ZenGin has the most room to disagree about, and a
wrongly-written sound or zone property is *invisible in the viewport* — the
engine is its only witness. Note also that `verify-world-edit.js` sets no class
property at all, so a rebuilt candidate would have to grow one before it is
worth the run.

### Building the candidates

`tools/mutate.js` is now in the repo — the previous handoff left it in a
scratchpad and it had to be rebuilt from prose. One command stages all three
candidates as flat `*.zen` files, which is the layout `engine-batch.ps1`
expects (it picks up `*.zen` in the directory, sorted by name):

```
node tools/mutate.js <outDir>
pwsh tools/engine-batch.ps1 -Exe Gothic2 -Dir "<abs outDir>"
```

| Candidate | Size | Purpose |
|---|---|---|
| `00-control-original.zen` | 75,387,729 | the pristine retail world — **the control, never skip it** |
| `01-resave.zen` | 75,387,803 | load → save, unchanged; rows 2–9 |
| `02-minimal-edit.zen` | 75,388,011 | the two Phase-0 mutations; row 10 |

It reads `NewWorld.zen.original-backup` in preference to the installed world,
so it cannot pick up a mid-experiment file, and it prints the source hash
(`b4dac867…`) to prove which one it used.

The row 10 world is produced through the two Phase-0 mutations only, and
verified against the control on reload — 4 findings in `vobs`, **0 in `mesh`,
`bsp` and `waynet`**:

- **moved** VOB `2/962` (`NW_CITY_TABLE_PEASANT_01.3DS`, the nearest visual VOB
  to the `START` waypoint) 300 units up:
  `y 5185.951 → 5485.951`, bounding box with it. It should visibly hang in the air.
- **inserted** `oCItem` `ITFO_APPLE` named `ITEM_PHASE0_APPLE_01` at world path
  `23`, 80 units above `START` (`29628.5, 5198.3, −15176.8`) — at the hero's
  feet on a new game, and it must be takeable.
- VOB count 23,288 → 23,289; **every other VOB identical in the dump.**

G1 coverage remains unavailable (Gothic 1 is not installed).
