# The ZenKit patch series

`scripts/build-zenkit.js` resets `vendor/ZenKit` and applies every `.patch` here in
order before the CMake pre-step. The submodule is therefore **permanently dirty and
never committed** — this directory *is* the change, and the applied tree is a build
artifact. `.gitmodules` carries `ignore = dirty` for exactly that reason, so the
applied tree does not show up as a change to the superproject; a moved submodule
commit still does.

Upstream is pinned at `1ff081c`, which is still `origin/main`. **None of these have
been fixed upstream.** Side branches (`dev/v2-next`,
`refactor/spec-compliant-archives`) were not checked and could carry overlapping work.

`0024`–`0026` all touch `src/archive/ArchiveAscii.cc` in different functions and
apply in any order relative to each other, but they are numbered in the order
they were found: `0026` is only *reachable* once `0024` lets a file load far
enough to hit a byte entry.

## Order matters in six places

These are not independent patches that happen to be numbered.

- **0028 → 0044.** Not duplicates. `0028` stops `save` echoing a stale byte;
  `0044` gives back the bits of that byte `load` never unpacked, which `0028`'s
  rebuild-from-bools drops. `0044`'s context lines contain `0028`'s code.
- **0001 → 0016.** Not duplicates. `0001` fixes broken bitfield arithmetic (a
  paren bug, a wrong mask, a wrong shift); `0016` then preserves the undefined
  bit 15. `0016`'s context lines contain `0001`'s corrected code.
- **0015 → 0019.** Not duplicates. `0015` makes the shared-lightmap texture order
  deterministic (it was `unordered_map` iteration order, i.e. heap addresses);
  `0019` then preserves the *original* on-disk order, which is not derivable —
  NewWorld references textures 125, 1, 125. `0019`'s hunks patch the lines `0015`
  adds, so it cannot apply alone.
- **0003 / 0007** overlap in `Camera.cc` — `0007` inserts a
  `get_version_identifier` override immediately after the block `0003` rewrites.
  This is why `build-zenkit.js:63` documents that per-patch reverse-checking
  misjudges them.

- **0040 → 0041.** Not duplicates, and both in `VNpc::load`. `0040` bounds the
  three counts that size a `resize`; `0041` then guards the null `read_object`
  can hand the item loop *inside* any such bound. `0041`'s context lines sit
  after the item-count guard `0040` adds.

- **0045 → 0046 → 0047.** A chain, not three takes on one bug. `0045` makes the
  unpacked `zCVob` layout readable at all (`trafoOSToWSRot` was written in an
  entry type nothing reads); `0046` makes it *correct* (three entries written
  twice, two objects the reader expects and `save` omitted); `0047` then makes
  it *reachable* by having `save` keep the layout `load` saw. In the other order
  the third patch would turn 20 retail ASCII worlds' re-saves from lossy into
  unreadable.

`0013` and `0018` both touch archive headers but different writers (Binary vs
BinSafe/Ascii) in opposite directions, and do not conflict.

## Triage

Upstreamability only. Every one of these is required for our fidelity claims
regardless of what upstream does with it.

### Upstreamable as-is — plain ZenKit bugs any consumer wants (38)

| Patch | What it fixes |
|---|---|
| `0001` | `zCVob` packed bitfield: missing parens on the `anim_mode` mask, `& 2` dropping a bit of a 2-bit enum, `bias` shifted 13 instead of 9 |
| `0002` | `colorAniList` built on a reused `ostringstream` cleared with `clear()` (stream state) instead of `str("")` (the buffer), so the previous string is prepended |
| `0003` | `zCCamTrj_KeyFrame` `original_pose` saved raw while load transposes — writer/reader asymmetry |
| `0004` | `alphaFunc` written with `write_bool`, read with `read_enum`, clamping every value ≥ 2 to 1 |
| `0005` | G2 mesh save indexed the triangulated `PolygonList` with offsets addressing the flat index arrays — writes garbage |
| `0006` | Copy-paste entry names: nine `sndVolume` in `VSound::save`, three `autoLinkEnabled` in `VMover::save`, `numTargets` vs the reader's `numTarget` |
| `0010` | BinSafe hash table emitted in insertion order; ZenGin walks buckets ascending by hash, chains descending by insertion |
| `0013` | Binary archive header wrote `date`/`user` lines `zCArchiverBinary` never writes, and padded the object count to 10 instead of 9 |
| `0014` | G2 mesh chunk `0xB020`'s trailing alpha-test byte never read (upstream's own "1 byte remaining" warning) and never written |
| `0015` | Shared lightmap textures emitted in `unordered_map` order — two saves of one world differed |
| `0018` | `strftime("%-d…")`, a glibc extension MSVC's UCRT treats as an invalid parameter and terminates on |
| `0020` | `.MRM` `MeshSection::size` written as a byte length, read as an element count — save→load crashed the process (`0xC0000409`) |
| `0021` | `TextureBuilder` pushed mipmaps largest-first; load, `data(level)` and save all assume smallest-first |
| `0022` | `ModelMesh::save` packed every attachment into one `PROTO` chunk; load takes one per chunk, so N−1 were silently lost |
| `0023` | `colorAniList` re-emitted every element as a triple, losing ZenGin's greyscale shorthand — see the patch header for the retail measurement |
| `0024` | `WriteArchiveAscii::write_raw` decided how many hex digits `std::to_chars` wrote by testing a null terminator `to_chars` never writes — every byte below `0x10` got the previous byte's low nibble, and ZenKit could not re-load its own ASCII output |
| `0025` | The ASCII header's `objects` count padded to 11 characters where ZenGin pads to 9 (the same defect `0013` fixed for `zCArchiverBinary`, which had picked 10) |
| `0026` | `WriteArchiveAscii::write_byte`/`write_word` emitted `byte:`/`word:` type tokens that `ReadArchiveAscii::read_byte`/`read_word` reject and ZenGin never writes (144,111 `int:` and zero of either across a retail install's 24 ASCII worlds) |
| `0027` | `World::load`'s mesh chunk scan had no end-of-file check and seeked by an unvalidated chunk length; since `ReadMemory::seek` ignores an out-of-range seek instead of failing, one corrupted length word made `loadWorld` spin forever at 100% CPU with nothing thrown |
| `0028` | `VTrigger::save` wrote the deprecated raw `flags`/`filterFlags` bytes `load()` unpacks into eight public bools, verbatim, instead of reconstructing them from the bools — the same writer/reader asymmetry as `0003`, on the trigger family's own base fields |
| `0029` | `ReadArchiveBinsafe::read_header` sized the hash table to the file's `hash_table_size` and then indexed it with the file's `insertion_index`, an independent unchecked count — an out-of-bounds heap *write* on a corrupted world (the `0xC0000374` seen fuzzing this file) |
| `0030` | `BspTree::load` walked each leaf node's `polygonIndex`/`polygonCount` range straight into `polygon_indices`, a list sized by a different chunk — an out-of-bounds read reachable from one corrupted byte of a world file |
| `0031` | `Mesh::load`'s LIGHTMAPS_SHARED chunk indexed the shared texture list with a second, unchecked file-supplied index — an out-of-range value copy-constructs a `shared_ptr` from memory past the vector, so it is a wild refcount increment as well as an out-of-bounds read |
| `0032` | `Texture::load` trusted the file's `mipmapCount` and `_ztex_mipmap_size` halves the dimensions once per level *inside* the walk, so the cost is quadratic in an unbounded count — a few million levels neither throws nor returns |
| `0033` | `WayNet::load` pushed `read_object`'s result into `points` and dereferenced it on the next line — but `read_object` returns null for an unknown class, an empty object and an unresolved reference, so one corrupted byte in a waypoint's object header is a null deref |
| `0034` | `BspTree::load`'s OUTDOORS branch sized a loop and two `resize`s from unvalidated file counts, and `read_chunked` hands the callback the whole reader rather than one bounded to the chunk — so one corrupted byte made the first sector read its node count out of the next chunk's header and `resize` to 17 GB |
| `0035` | `BspTree::load`'s `_parse_bsp_nodes` recursed once per set flag bit of the node it had just read, so a file-supplied bit ran the call stack — a chain of 100,000 nodes (49 bytes each) kills the process with an uncatchable `0xC00000FD`. Parsed iteratively instead of bounded, because the depth a *valid* world may reach has no documented ceiling; it also removes a use-after-realloc the recursion had on `back_index` |
| `0036` | Every chunk in `Mesh::load` sized a container from an unvalidated `uint32` element count, and the same unbounded reader means the loop after it neither throws nor stops: a vertex count of 0x0FFFFFFF commits 3.2 GB, a feature count 8.6 GB, and the world still reports as loaded. Bounded by the bytes left in the reader, like `0034` |
| `0037` | `WayNet::load` sized `points.reserve` and `edges.reserve` from unvalidated file counts, and the edge loop cannot stop on its own: `read_object` past the end of the entry stream returns null, which a waynet endpoint is allowed to be. `numWays` of 0x0FFFFFFF builds 268 million edges and the world still reports as loaded, after 41 s. Bounded by the bytes left in the reader, like `0034` and `0036` |
| `0038` | `parse_vob_tree` recursed once per child and its `skip` lambda once per nesting level, and the nesting depth is the file's own `childs<N>` counts. 60,000 nested VObs (9 MB) kill the process with an uncatchable `0xC00000FD`; 200,000 empty ones (5 MB) do it through the skip path. Both walks parse iteratively instead of being bounded, for `0035`'s reason — a valid tree's depth has no documented ceiling |
| `0039` | The other half of `0038`: `VirtualObject`'s defaulted destructor tears a tree down by recursing once per level, so a world 60,000 VObs deep loads and *then* dies with `0xC00000FD`. The destructor moves each child's children out onto an explicit stack, leaving a child shared with another owner whole |
| `0040` | `VNpc::load` sized `talents`, `items` and `slots` with `resize` from three unvalidated file counts. `numTalents` of 0x0FFFFFFF builds 268 million null talents, 4.3 GB, and the world still reports as loaded after 6.8 s; the other two commit 2.1 GB each before failing. Bounded by the bytes left in the reader, like `0034`, `0036` and `0037`. `numOverlays` and the news `NumOfEntries` are left alone on purpose — both already throw in 66 ms |
| `0041` | `VNpc::load` dereferences each item it has just read (`items[i]->s_flags` decides whether a `shortKey<n>` int follows), and `read_object` returns null for the three file-supplied reasons `0033` named. An `itemCount` of 2 over a world holding one item — inside any byte-based bound — kills the process with `0xC0000005` |
| `0042` | `VCutsceneCamera::load` reads `numPos` and `numTargets` off the file and `push_back`s one keyframe object per iteration into a vector it never reserves — so there is not even a `bad_alloc` to stop an absurd count, and every value is a merely large one. 0x0FFFFFFF builds 268 million null keyframes, 4.33 GB, and the world still reports as loaded after 15.8 s; a negative count loads a camera with no keyframes at all |
| `0043` | `ReadArchiveBinsafe::read_header` sizes the hash table entry vector from the file's own `hash_table_size` with no check, and the loop after it cannot stop: every read past the end of the file returns zero, so a zero key length and a zero insertion index pass `0029`'s bound. 0x0FFFFFFF is a 20.5 GB peak working set and a world that still reports as loaded, after 35 s. `0029`'s own chunk — it bounded the count that *indexes* this vector, not the one that *sizes* it |
| `0044` | `0028`'s own chunk. `VTrigger::load` unpacks bits 0 and 2 of `flags` and bits 0-5 of `filterFlags` into bools, and `0028` made `save` rebuild both bytes from exactly those bools — so bits 1 and 3-7 of `flags` (and 6-7 of `filterFlags`), which retail sets, are written as zero. It cost the four retail BinSafe worlds their `identical` verdict: 121 differing events, all of them this one field. Keeps the unmapped bits on two new zero-initialized members and merges them back in when writing |
| `0045` | `WriteArchiveAscii::write_mat3x3` emitted a `rawFloat:` entry where `ReadArchiveAscii::read_mat3x3` reads `raw:` and ZenGin writes `raw:` (all 1277 `trafoOSToWSRot` entries in OldCamp). ZenKit could not read back its own unpacked `zCVob`s — the same class of writer/reader disagreement as `0024` and `0026`, on the library's only `write_mat3x3` caller |
| `0046` | `VirtualObject::save`'s unpacked branch writes `presetName`/`vobName`/`visual` and the common tail wrote all three again; entries are read positionally, so the repeat is a stream desync. The mirror-image hole: `load` hardcodes `has_visual_object`/`has_ai_object` to true in the unpacked layout, so the reader takes two objects out of the stream that `save` never wrote. `visual` also came from `visual_name`, empty on any VOB that was built rather than loaded, where the packed tail writes `visual->name` |
| `0048` | Every ASCII float written with `std::to_string` — `%f`, six decimals, always — where ZenGin wrote nine significant digits with its MSVC CRT's three-digit exponent. It both pads (`0` → `0.000000`) and *truncates* (`1511.77087` → `1511.770874`, and anything under 1e-6 → `0.000000`). `%.9g` is what the retail ASCII worlds hold and is also what round-trips a float exactly, so no parsed value changes. OldCamp: 440 struct findings → 8, re-save 4,012,132 B → 3,979,084 B against a 3,979,132 B original |

`0020`, `0021` and `0022` are the strongest candidates: standalone, no API change,
no fidelity argument needed. `0018` is a portability crash fix with identical output.
`0027`, `0029`–`0043` are the same class of standalone
fix — a hardening of the read path, reachable by any consumer that opens a
file it did not write. `0029` is the strongest of the eight: the bug it stops is an
out-of-bounds write, not a hang, a null deref or an out-of-bounds read.
`0024`, `0026` and `0045` are now just as strong and arguably stronger: each is
a self-evident writer/reader disagreement that made ZenKit unable to read its
own ASCII output, with no API change and a one-line diff. Together with `0025` they
took a retail G2 install's ASCII worlds from 20 crashed to 20 measured
(`../docs/engine-acceptance-2026-08-25.md` §10.4).

### Upstreamable with work — each adds public API purely to preserve original bytes (9)

| Patch | Why it needs work |
|---|---|
| `0007` | Version-identifier overrides for four visual/camtrj classes. Correct in kind — the base default stamps a wrong version — but the constants (`0`/`64513`, `12289`/`31489`) are asserted from a retail census with no citation or fixture in the patch, and it is a public-header change |
| `0008` | Real engine-loadability fix (ZenGin numbers `childs<N>` with one global counter; ZenKit reset it per subtree, producing duplicate names in a name-addressed stream) — but it de-statics `save_vob_tree` and exports a second public overload. Upstream would keep the counter internal |
| `0009` | Reimplements MSVC 6 CRT float formatting so `texScale` is byte-identical. The parsed value is unchanged, so this buys byte fidelity only; the hand-rolled exponent fixup is what reviewers will push back on |
| `0011` | Answers upstream's own `TODO(lmichaelis)` — `BspTree` discarded the `0xC000` header word and hard-coded 2 where retail G2 carries 3. Adds a public `version` field, falling back to 3 for G2 and 2 for G1 when a tree was never loaded; wants the value's semantics identified, not just preserved |
| `0012` | Adds public `Date::padding` so a trailing alignment word — uninitialised engine memory — survives. Sound and tiny, but it exposes a meaningless field in a public struct |
| `0016` | Adds public `packed_reserved_bit` for bit 15, which ZenGin never assigns (49 VObjects in NewWorld have it set from stale memory). Same class as `0012` |
| `0044` | Adds public `reserved_flags`/`reserved_filter_flags` so the bits of `zCTrigger`'s two deprecated bytes that `load` does not unpack survive a save. Same class as `0016`, and not independently applicable — it is the correction to `0028` |
| `0019` | The fidelity half of `0015`. Adds public `Mesh::shared_lightmap_textures`; not independently applicable |
| `0047` | The fidelity half of `0045`/`0046`. `save` wrote every VObject packed whatever layout `load` read, and the packed layout has no room for most of the tail — all 1277 of OldCamp's `pack=int:0` VObjects come back `pack=int:1`. Adds public `VirtualObject::packed_layout` so the layout survives; same shape as `0016`, but it also changes what `save` writes for any consumer that loads an unpacked world |

### Ours forever (2)

`0017` — `WriteArchiveBinsafe::write_bool` special-cases the entry names `locked`,
`moveable` and `focusOverride` to write `0xFFFFFFFF` instead of `1`. The underlying
observation is real (ZenGin's signed 1-bit `oCMOB` bitfields), but keying
archive-layer behaviour on string entry names is a layering violation upstream
should reject. The right upstream shape is an explicit raw/tri-state write called
from the `oCMOB` save sites; until someone writes that, this stays local.

`0049` — the ASCII half of `0017`: the same three signed one-bit entry names
write `-1` instead of `1`. A retail ASCII census finds 56 such values among
45,068 boolean entries (51 `locked`, 5 `moveable`) and no other non-0/1 value.
It has the same archive-layer string-keying compromise and the same desired
upstream shape as `0017`.

## Suggested upstreaming order

Independent, highest-value and least arguable first:

1. `0020`, `0021`, `0022`, `0027`, `0029`, `0030`, `0031`, `0032`, `0033`, `0034`,
   `0035`, `0036`, `0037`, `0038` (with `0039`), `0040`, `0041`, `0042`,
   `0043`, `0045` — one PR
   each.
2. `0002`, `0003`, `0004`, `0005`, `0006`, `0028`, `0046` — small self-evident
   writer bugs.
3. `0018`, then `0013`.
4. `0001`, then `0010`.
5. `0014`, `0015`, `0023`.
6. The API-adding fidelity patches, each needing a written rationale and a
   fixture: `0011`, `0019` (after `0015`), `0016` (after `0001`),
   `0044` (after `0028`), `0047` (after `0045` and `0046`), `0012`, then
   `0008` reshaped to keep the counter internal, then `0009`.
7. `0017` and `0049` — do not send as written.

## Open questions

- Do upstream's side branches already carry equivalent fixes? Only `origin/main`
  was checked.
- `0007` is the only patch in the series with **no prose header** — it is a bare
  diff, and its version constants (`0`/`64513`, `12289`/`31489`) are asserted with
  no citation anywhere. An upstream PR needs that evidence, so it has to be
  re-measured before it can be sent. Every other patch carries its reasoning and
  its measurement in its own header; `0017`'s census of 10,279 `(class, entry)`
  BOOL keys is the model.
- `0013` removes the `date`/`user` stamp from the binary archiver entirely. Is
  any consumer relying on it, and does upstream consider it intentional?
