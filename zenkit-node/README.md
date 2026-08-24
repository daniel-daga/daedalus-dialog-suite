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
pnpm --filter zenkit-node zen-roundtrip -- \
  --root "C:\<Gothic II>\_work\Data\Worlds" --game g2 --strict --report-dir reports/
```

Loads every world, re-saves it, and compares `normalizeWorld` dumps.
Differences are classified `identical` / `float-noise` / `reordered` /
`semantic-drift` / `unreadable`; the last two block Gate 1 (plan §3). The
in-engine acceptance pass (plan §5) is the second, independent instrument —
results live in `docs/engine-acceptance-<date>.md`.
