# The ZenKit patch series

`scripts/build-zenkit.js` resets `vendor/ZenKit` and applies every `.patch` here in
order before the CMake pre-step. The submodule is therefore **permanently dirty and
never committed** — this directory *is* the change, and the applied tree is a build
artifact.

Upstream is pinned at `1ff081c`, which is still `origin/main`. **None of these have
been fixed upstream.** Side branches (`dev/v2-next`,
`refactor/spec-compliant-archives`) were not checked and could carry overlapping work.

`0024`–`0026` all touch `src/archive/ArchiveAscii.cc` in different functions and
apply in any order relative to each other, but they are numbered in the order
they were found: `0026` is only *reachable* once `0024` lets a file load far
enough to hit a byte entry.

## Order matters in three places

These are not independent patches that happen to be numbered.

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

`0013` and `0018` both touch archive headers but different writers (Binary vs
BinSafe/Ascii) in opposite directions, and do not conflict.

## Triage

Upstreamability only. Every one of these is required for our fidelity claims
regardless of what upstream does with it.

### Upstreamable as-is — plain ZenKit bugs any consumer wants (22)

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

`0020`, `0021` and `0022` are the strongest candidates: standalone, no API change,
no fidelity argument needed. `0018` is a portability crash fix with identical output.
`0027`, `0029` and `0030` are the same class of standalone fix — a one-guard hardening
of the read path, reachable by any consumer that opens a file it did not write. `0029`
is the strongest of the three: the bug it stops is an out-of-bounds write, not a hang
or an out-of-bounds read.
`0024` and `0026` are now just as strong and arguably stronger: each is a
self-evident writer/reader disagreement that made ZenKit unable to read its own
ASCII output, with no API change and a one-line diff. Together with `0025` they
took a retail G2 install's ASCII worlds from 20 crashed to 20 measured
(`../docs/engine-acceptance-2026-08-25.md` §10.4).

### Upstreamable with work — each adds public API purely to preserve original bytes (7)

| Patch | Why it needs work |
|---|---|
| `0007` | Version-identifier overrides for four visual/camtrj classes. Correct in kind — the base default stamps a wrong version — but the constants (`0`/`64513`, `12289`/`31489`) are asserted from a retail census with no citation or fixture in the patch, and it is a public-header change |
| `0008` | Real engine-loadability fix (ZenGin numbers `childs<N>` with one global counter; ZenKit reset it per subtree, producing duplicate names in a name-addressed stream) — but it de-statics `save_vob_tree` and exports a second public overload. Upstream would keep the counter internal |
| `0009` | Reimplements MSVC 6 CRT float formatting so `texScale` is byte-identical. The parsed value is unchanged, so this buys byte fidelity only; the hand-rolled exponent fixup is what reviewers will push back on |
| `0011` | Answers upstream's own `TODO(lmichaelis)` — `BspTree` discarded the `0xC000` header word and hard-coded 2 where retail G2 carries 3. Adds a public `version` field, falling back to 3 for G2 and 2 for G1 when a tree was never loaded; wants the value's semantics identified, not just preserved |
| `0012` | Adds public `Date::padding` so a trailing alignment word — uninitialised engine memory — survives. Sound and tiny, but it exposes a meaningless field in a public struct |
| `0016` | Adds public `packed_reserved_bit` for bit 15, which ZenGin never assigns (49 VObjects in NewWorld have it set from stale memory). Same class as `0012` |
| `0019` | The fidelity half of `0015`. Adds public `Mesh::shared_lightmap_textures`; not independently applicable |

### Ours forever (1)

`0017` — `WriteArchiveBinsafe::write_bool` special-cases the entry names `locked`,
`moveable` and `focusOverride` to write `0xFFFFFFFF` instead of `1`. The underlying
observation is real (ZenGin's signed 1-bit `oCMOB` bitfields), but keying
archive-layer behaviour on string entry names is a layering violation upstream
should reject. The right upstream shape is an explicit raw/tri-state write called
from the `oCMOB` save sites; until someone writes that, this stays local.

## Suggested upstreaming order

Independent, highest-value and least arguable first:

1. `0020`, `0021`, `0022`, `0027`, `0029`, `0030` — one PR each.
2. `0002`, `0003`, `0004`, `0005`, `0006`, `0028` — small self-evident writer bugs.
3. `0018`, then `0013`.
4. `0001`, then `0010`.
5. `0014`, `0015`, `0023`.
6. The API-adding fidelity patches, each needing a written rationale and a
   fixture: `0011`, `0019` (after `0015`), `0016` (after `0001`), `0012`, then
   `0008` reshaped to keep the counter internal, then `0009`.
7. `0017` — do not send as written.

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
