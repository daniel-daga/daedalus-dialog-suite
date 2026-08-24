# Phase 0 Work Breakdown — `zenkit-node` + Round-Trip Fidelity Harness

Companion to [`level-editor.md`](level-editor.md) (architecture) and
[`level-editor-design-brief.md`](level-editor-design-brief.md) (source brief).
Status: **proposed** — no code landed.

Phase 0 is the blocking gate for the whole level-editor effort (brief §9,
Gate 1). Nothing in the editor UI is built until it passes. This document
turns "build the binding and a corpus harness" into decisions someone can
implement against.

---

## 1. Scope and exit criteria

**In scope:** a new `zenkit-node/` workspace containing the N-API binding
around ZenKit, plus a `zen-roundtrip` harness that loads and re-saves worlds
and reports whether anything drifted.

**Out of scope:** every editing operation, `zen-world/`, and all UI. The
binding surface built here is *read + save-unchanged only* — `applyOps`,
mesh extraction for rendering, and VFS browsing arrive in Phase 1a/1b. Adding
them now would mean writing editing code against a data layer not yet proven
trustworthy.

**Exit criteria (all four):**

1. `pnpm --filter zenkit-node test` green on Linux, Windows, and macOS.
2. `zen-roundtrip` run against a developer-local Gothic 1 + Gothic 2/NotR
   installation reports **no `semantic-drift`** on any original world,
   including all parts (see §3 for what that means precisely).
3. Every drift the harness *does* report is classified and explained —
   `float-noise` and `reordered` are acceptable-with-rationale, anything
   unexplained is a blocker.
4. A written **Plan A / Plan B verdict** (whole-world re-serialization vs.
   chunk splice — `level-editor.md` §5) with the harness report as evidence.

---

## 2. Decision — fixtures and the fidelity oracle

### The problem I previously waved past

`level-editor.md` §5 says CI runs against "tiny synthetic ZEN fixtures we
author ourselves". That is circular: the only available ZEN *writer* is
ZenKit, which is the component under test. A fixture written by ZenKit and
then read back by ZenKit will agree with itself even if both directions share
a systematic bug. Such a test proves self-consistency, never fidelity.

### Resolution — separate two claims that were being conflated

| Claim | Provable by | Where it runs |
|---|---|---|
| **C1 — Fidelity.** Our load→save reproduces *the original engine's* files | Only real Gothic ZENs + an independent oracle | Developer-local, gated release checks |
| **C2 — No regression.** Today's binding behaves like the last known-good one | Checked-in golden fixtures | CI, every PR |

CI can only ever establish **C2**. That is still worth having — it catches
binding regressions and ZenKit-upgrade surprises, which is the failure mode
CI realistically protects against. The rule is that **a green CI badge must
never be reported as fidelity**; the harness report states which claim it
covers, and `zenkit-node/README.md` says so at the top.

### C2 — golden fixtures for CI

- One minimal world authored once via ZenKit's `WriteArchive`, plus one
  fixture per archive format (`binary`, `binsafe`, `ascii`) and one per game
  version (G1, G2). Kept deliberately tiny (a handful of VOBs, a few dozen
  polygons, a 4-waypoint waynet).
- Checked in as **both** the `.ZEN` bytes and its `normalizeWorld` dump
  (`*.golden.json`). CI asserts: `load(fixture) → normalize` equals the
  golden dump, and `save(load(fixture))` equals the fixture bytes.
- Regenerating a golden is an explicit, reviewed act
  (`pnpm --filter zenkit-node fixtures:regen`), never automatic — an
  auto-regenerating golden silently ratifies whatever bug just landed.
- These are *our* files, not Piranha Bytes assets: no game data enters the
  repo (brief §7).

### C1 — the fidelity oracle, and what counts as independent

Cross-checking a ZenKit write with a ZenKit read proves nothing. Anything
built *on* ZenKit is therefore disqualified as an oracle — including
OpenGothic and the official C#/Java/Python bindings, which share the same
core. Genuinely independent readers:

| Oracle | Independence | Cost |
|---|---|---|
| **The original engine / Spacer** | Total — it is the specification | Manual, Windows, but decisive |
| [ZenLib](https://github.com/ataulien/ZenLib) (ataulien) | Separate implementation | Older, incomplete format coverage |
| [zen](https://github.com/MordragT/zen) (MordragT, Rust) | Separate implementation | WIP |

**Decision:** the Phase 0 oracle is **byte/semantic self-comparison against
the untouched original file** — which needs no oracle at all, since the
original ZEN *is* the reference — backed by **one manual Spacer/engine load**
of a re-saved world per game version as a smoke check. ZenLib is a useful
tiebreaker when a specific structure is disputed, not a routine gate. The
full independent-runtime check is Gate 2 (Phase 1b), not Phase 0.

This is the key simplification: Gate 1 compares our output to the *input
file*, so the oracle problem only exists for the CI fixtures (C2), where we
have already accepted the weaker claim.

---

## 3. Decision — the `normalizeWorld` dump schema

This is the measuring instrument for Gate 1. Until it is specified, "the
corpus is green" is not falsifiable. It mirrors the parser corpus runner's
proven approach (`canonicalize` → stable signature → multiset diff,
`daedalus-parser/scripts/roundtrip-corpus.js`).

```jsonc
{
  "meta": { "gameVersion": "g2", "archiveFormat": "binsafe",
            "archiveVersion": 1, "date": "...", "user": "..." },

  "vobs": [                       // ORDER-SENSITIVE (indices are referenced)
    { "path": "0/3/1",            // stable index path through the tree
      "class": "oCMobContainer",
      "name": "CHEST_01",
      "position": [...], "rotation": [...], "bbox": [...],
      "visual": "CHESTBIG_OCCHESTLARGE.MDS",
      "flags": { "showVisual": true, "cdStatic": true, "...": "..." },
      "props": { /* full typed property bag, canonicalized */ },
      "childCount": 2 } ],

  "mesh": {                       // bulk data → hashes, not inline
    "vertexCount": 0, "polyCount": 0,
    "materials": ["..."],         // ORDER-SENSITIVE (poly indices reference these)
    "vertexHash": "sha256:...", "polyHash": "sha256:...",
    "featureHash": "sha256:...", "bbox": [...] },

  "bsp": {
    "nodeCount": 0, "leafCount": 0, "treeDepth": 0,
    "sectorNames": ["..."],       // sorted
    "portalPolyHash": "sha256:...", "lightMapCount": 0 },

  "waynet": {
    "waypoints": [ { "name": "...", "position": [...], "direction": [...],
                     "freePoint": false, "underWater": false } ],  // sorted by name
    "edges": [["A","B"]] }        // ORDER-INSENSITIVE, each pair sorted, then sorted
}
```

**Rules that make the diff meaningful:**

- **Order sensitivity is per-structure and deliberate.** VOB sequence and
  material lists are compared as sequences (engine references them by index);
  waynet edges and sector names as multisets/sorted sets. Getting this
  backwards either hides real corruption or floods the report with noise.
- **Bulk arrays are hashed, not inlined**, so a dump stays a few hundred KB
  instead of hundreds of MB. On a hash mismatch the harness re-runs that one
  structure in `--drill` mode, which emits the first N differing elements.
- **Floats are compared exactly first.** Only on failure does the harness
  retry with an epsilon (`1e-6` relative) and classify the result. Quantizing
  up front would silently absorb genuine drift.
- **Every difference is classified**, and the class decides the exit code:

  | Class | Meaning | Gate 1 |
  |---|---|---|
  | `identical` | byte-identical output | ✅ |
  | `float-noise` | differs only within epsilon | ✅ with rationale |
  | `reordered` | same multiset, different order, in an order-insensitive structure | ✅ with rationale |
  | `semantic-drift` | anything else — missing VOB, changed flag, altered hash | ❌ **blocks** |
  | `unreadable` | re-saved file fails to load | ❌ **blocks** |

- Strings are decoded from **windows-1252** at the binding edge before
  hashing (brief §5), so an encoding regression shows as drift rather than
  as identical mojibake on both sides.

**Harness CLI**, mirroring the parser's runner so the two feel alike:

```
pnpm --filter zenkit-node zen-roundtrip -- \
  --root "C:\Gothic II\Data" --game g2 --strict --report-dir reports/
```

---

## 4. Decision — build integration

Verified upstream facts (2026-08): ZenKit is **CMake ≥3.10, C++20**, target
`zenkit`, dependencies (`squish`, `miniz`, `doctest`) **vendored in-tree**
so no network fetch happens at build time. Relevant options:

| Option | Default | We set |
|---|---|---|
| `ZK_BUILD_SHARED` | OFF | **OFF** — static link into the addon |
| `ZK_BUILD_TESTS` | ON | **OFF** |
| `ZK_ENABLE_ASAN` | ON (debug) | **OFF** — must not ship in a released addon |
| `ZK_ENABLE_MMAP` | ON | ON |
| `ZK_ENABLE_ZIPPED_VDF` | **OFF** | **ON** — mods ship compressed VDFs; the asset browser needs it |
| `ZK_ENABLE_INSTALL` | ON | OFF |

`ZK_ENABLE_ZIPPED_VDF` defaulting off is an easy thing to miss and would only
surface much later as "some mods' assets don't load".

### node-gyp vs cmake-js

`prebuildify` is **node-gyp-only** (its sole escape hatch is `--node-gyp` for
node-gyp-compatible forks), and this repo's whole native-distribution story —
`prebuildify` producing prebuilds, `node-gyp-build` selecting one at
runtime — depends on it (`daedalus-parser`). Three ways out:

- **(A) cmake-js.** Natural for a CMake dependency, but abandons the repo's
  prebuild/runtime-loader pattern and needs a hand-rolled replacement.
- **(B) CMake pre-step + node-gyp link.** A `prepare` script configures and
  builds ZenKit as a static library; `binding.gyp` compiles only our
  `binding.cc` and links `libzenkit.a` / `zenkit.lib`. Two stages, but
  `prebuildify` and `node-gyp-build` keep working unchanged.
- **(C) Sources listed directly in `binding.gyp`.** No CMake at all, but
  ZenKit's source list (plus vendored squish/miniz) must be re-synced by hand
  on every upgrade.

**Decision: (B).** What matters most is that contributors and the Electron
packaging path never need a C++ toolchain, and that is exactly what the
existing prebuildify → node-gyp-build pipeline delivers. (C)'s per-upgrade
manual re-sync is a worse recurring cost than a two-stage build.

### Remaining build tasks

- ZenKit as a **git submodule pinned to a release tag** (not `main`), so a
  fidelity result is reproducible against a known upstream commit.
- Electron ABI: N-API means no `electron-rebuild` per Electron bump; verify
  once against Electron 43 and record it.
- CI: a `zenkit-node` job **path-filtered** to `zenkit-node/**` so the
  existing pipeline is not slowed for dialog-only PRs; prebuild matrix
  (linux/win/mac × x64/arm64) deferred to Phase 1a, when something actually
  ships.
- pnpm: add `zenkit-node` to `pnpm-workspace.yaml` and to
  `onlyBuiltDependencies`.

---

## 5. Task list, in TDD order

Repo rule: failing test first, minimal implementation, green. Tests are
`node --test` to match `daedalus-parser`.

**T1 — workspace skeleton.** `zenkit-node/` with package.json, submodule,
`binding.gyp`, CMake pre-step. *Test:* `require('zenkit-node')` loads the
addon and reports the linked ZenKit version. Fails until the two-stage build
works — this is the build-integration risk, resolved first and alone.

**T2 — load a world.** `loadWorld(path, gameVersion) → WorldHandle`.
*Test:* loading a checked-in G2 golden fixture yields the expected VOB count,
waypoint count, and mesh vertex count. *Also:* a wrong `gameVersion` **fails
loudly** rather than mis-parsing (`level-editor.md` §9 — version is never
guessed).

**T3 — windows-1252 at the edge.** *Test:* a fixture whose VOB name contains
`ä`/`ö`/`ü` round-trips as those characters, and *not* as mojibake, in both
directions. Written before any string crosses the boundary, because
retrofitting encoding is how mojibake becomes permanent.

**T4 — `normalizeWorld`.** The §3 schema. *Test:* dump of a golden fixture
equals its checked-in `*.golden.json`; hashes are stable across runs and
across machines (no map-iteration-order leakage).

**T5 — the classifier.** `identical` / `float-noise` / `reordered` /
`semantic-drift` / `unreadable`. *Test:* hand-built dump pairs — a moved
float within epsilon → `float-noise`; a reordered waynet edge list →
`reordered`; a reordered *material* list → `semantic-drift` (order-sensitive);
a dropped VOB → `semantic-drift`. This test is what makes Gate 1 meaningful,
so it is written before the harness that consumes it.

**T6 — save unchanged.** `saveWorld(handle, path)`. *Test:* golden fixture →
load → save → byte-identical to the fixture (C2 regression claim).

**T7 — the `zen-roundtrip` harness.** CLI per §3, report artifact, `--strict`
exit codes, `--drill`. *Test:* against fixtures, a seeded corrupt fixture
exits non-zero and names the offending structure.

**T8 — run against real worlds.** Developer-local G1 + G2/NotR, all parts.
Not a CI test; produces the report that decides **Plan A vs Plan B** and the
manual Spacer smoke check (§2). Output is a written verdict appended to
`level-editor.md` §5.

**T9 — CI wiring.** Path-filtered job running T1–T7 on the three OSes.

T1–T7 are ordinary TDD. **T8 is the actual gate** — the first point where
reality can contradict the plan.

---

## 6. Deferred, with reasons

- **Prebuild matrix / release packaging** → Phase 1a; nothing ships from
  Phase 0.
- **Mesh + texture extraction, VFS browsing, `applyOps`** → Phase 1a/1b; not
  needed to prove fidelity, and building them against an unproven data layer
  is exactly the risk Phase 0 exists to retire.
- **OpenGothic launch interface** (Gate 2) → Phase 1b.
- **VFS/mod override resolution order** → Phase 1a, with the asset browser.
- **G1 vs G2 archive-version matrix** → partially covered by T2/T8 fixtures;
  full matrix once real-world coverage shows which combinations occur.

## 7. What could still invalidate Phase 0

- ZenKit's `World::save` may not reproduce BSP/mesh faithfully — it is
  implemented (v1.3.0) but never advertised as byte-preserving. This is the
  expected trigger for **Plan B** (chunk splice), and the reason T8 exists.
- A ZenKit fidelity bug may need upstreaming (MIT, active) — budget for the
  round trip, or carry a patched submodule pin meanwhile.
- If Plan B is needed, the binding gains byte-range bookkeeping and Phase 0
  grows by roughly a task-set of its own. Phase 1 should not be scheduled
  until T8 reports.
