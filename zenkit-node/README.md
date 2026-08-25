# zenkit-node

N-API binding around [ZenKit](https://github.com/GothicKit/ZenKit) for loading
and re-saving ZenGin worlds, plus the `zen-roundtrip` fidelity harness.
Phase 0 of the level-editor plan — see
[`docs/plans/level-editor-phase-0.md`](../docs/plans/level-editor-phase-0.md).

> **A green CI run is NOT a fidelity claim.** CI runs only against tiny
> synthetic fixtures that ZenKit itself wrote — it can prove *no regression*
> against our own goldens (claim C2), never that ZenKit reproduces *the
> original engine's* files (claim C1). Fidelity is established only by the
> developer-local `zen-roundtrip` run against real Gothic installations plus
> the manual in-engine acceptance pass. The harness report states which claim
> it covers.

## Scope (Phase 0)

Read + save + exactly one minimal mutation (set VOB position, insert item
VOB), `normalizeWorld` dumps, and the round-trip harness. No `applyOps`
system, no mesh extraction for rendering, no VFS browsing, no UI — those are
Phase 1.

**Saving is BinSafe-only.** `saveWorld(handle, path)` throws unless the handle
was loaded from a `zCArchiverBinSafe` archive: that is the only writer path
verified byte-for-byte against the retail corpus and in the original engine.
ZenKit's ASCII writer corrupts every raw entry it emits and cannot re-load its
own output at all, and the BINARY path has had no fidelity work
(`docs/engine-acceptance-2026-08-25.md` §10.2, §10.3). Diagnostics that mean to
measure those paths pass `saveWorld(handle, path, { allowNonBinSafe: true })`,
as `scripts/zen-roundtrip.js` does.

## ZenKit pin

The submodule `vendor/ZenKit` is pinned to commit `1ff081c` (upstream `main`,
2026-05-09) — **not** the v1.3.0 release tag. This is deliberate: v1.3.0's
world-save path is known-broken (MeshAndBsp header written as `version=0,
size=0`, polygon material/lightmap written 4-byte where the loader reads
2-byte, polygon planes zeroed), and every fix landed on `main` after the
release. A fixed SHA keeps fidelity results exactly reproducible; move the pin
only as an explicit, reviewed act, and re-run the full harness + engine pass
afterwards.

Build flags (set by `scripts/build-zenkit.js`): `ZK_ENABLE_ZIPPED_VDF=ON`
(mods ship compressed VDFs), `ZK_ENABLE_ASAN=OFF` (must never ship in a
released addon), `ZK_BUILD_SHARED=OFF`, static MSVC runtime on Windows to
match node-gyp.

## Build

Two-stage (plan §4, option B): a CMake pre-step builds ZenKit as a static
library into `vendor-build/zenkit/out/`, then `node-gyp` compiles only the
binding and links it. `prebuildify`/`node-gyp-build` keep working unchanged,
so consumers with a matching prebuild never need a C++ toolchain.

```
pnpm install            # uses a prebuild if present, else builds from source
pnpm --filter zenkit-node test
```

The `test` script is bare `node --test`, which discovers `test/*.test.js`
itself. **Do not "fix" it back to `node --test test/*.test.js`**: that relies on
the *shell* expanding the glob, so it works under bash and fails under
PowerShell — which is how it failed the first time CI ever ran the tests on
Windows, our primary platform. `node --test test/` is not a substitute either;
Node tries to load the directory as a module.

Requirements for a source build: CMake ≥3.10 (a Visual Studio-bundled CMake
is found automatically on Windows), a C++20 compiler, git submodules
initialized recursively.

## Golden fixtures

`test/fixtures/` holds tiny synthetic worlds authored by
`scripts/fixtures-regen.js` — our own files, no game data. **Fixtures never
regenerate automatically.** `pnpm --filter zenkit-node fixtures:regen` is an
explicit, reviewed act; an auto-regenerating golden would silently ratify
whatever bug just landed.

## zen-roundtrip harness

```
# C1 — fidelity, developer-local: every original ZEN is its own reference
pnpm --filter zenkit-node zen-roundtrip -- \
  --root "C:\<Gothic II>\_work\Data\Worlds" --game g2 --strict --report-dir reports/

# C2 — regression, CI: the checked-in fixtures. NEVER a fidelity result.
pnpm --filter zenkit-node zen-roundtrip -- --fixtures --strict
```

Loads every world, saves it twice (determinism), re-loads the first save and
compares `normalizeWorld` dumps. Differences are classified `identical` /
`float-noise` / `reordered` / `semantic-drift` / `unreadable`; the last two
block Gate 1 (plan §3), as do `crashed` and — outside the classifier —
nothing else. `not-a-world` is a skip, not a failure: four of the install's
`.zen` files are VOB libraries with no `MeshAndBsp`.

Every world is measured **in a child process**. ZenKit can abort the process
outright (`0xC0000409`) on the ASCII path, and a crash has to be recorded as a
result rather than end the run.

The summary always prints a `COVERAGE:` line counted against **every file
found**, not every file that survived, plus the claim the run carries. A
world the container instrument could not read is reported `struct-only` and is
never a fidelity pass. `--drill` adds the first differing bytes per structure
to the report; `--report-dir` writes `zen-roundtrip.json`.

The in-engine acceptance pass (plan §5) is the second, independent instrument —
results live in `docs/engine-acceptance-<date>.md`.

### The `container` section

A `normalizeWorld` dump has two halves. `meta`/`vobs`/`mesh`/`bsp`/`waynet`
come from ZenKit's parsed structs. `container` is computed in JS from the
archive **bytes** the handle was loaded from (`lib/container.js`), because
ZenKit's positional, type-checked reader ignores facts ZenGin's name-addressed
reader depends on: the archive header lines (verbatim; only the `date`/`user`
values are split off), the hash-table key set with
insertion index/hash **and physical order**, every object frame
`[name class version index]` (per-class version counts + a sequence hash),
the per-class ordered `(entryName, entryType)` schema, entry-stream counts,
SHA-256s over every RAW/RAW_FLOAT payload and every raw BOOL word per
`(class, entryName)`, and the `MeshAndBsp` chunk table `(id, length, sha256)`.
The classifier treats **any** `container` difference as `semantic-drift` —
never `float-noise`, never `reordered` — except the header `date`/`user`
stamp values, which are benign (a missing or added stamp line is still
drift). Golden fixtures carry the section too; regenerate
only the JSON with `node scripts/fixtures-regen.js --golden-only`.

It is `null` for a handle that has been mutated: the section describes the
bytes the handle was loaded from, and after `setVobPosition` /
`insertItemVob` those bytes no longer describe the handle. Save the world and
load the result to get a container section back.

The section is **BinSafe-only**, and says so in the dump: for any other
archiver it is `{ archiver, format, covered: false, header }` and nothing more,
and `classifyDumps` returns `containerCoverage: false` for the pair. Only 4 of
the 28 `.zen` files in a Gothic II install use BinSafe; the other 24 are
`zCArchiverGeneric`/ASCII. **The ASCII writer is not usable** — ZenKit cannot
re-load its own ASCII output, and every raw entry it writes is corrupt. The
evidence and the resulting scope decision are in the acceptance record §10;
read it before trusting an ASCII round-trip.
