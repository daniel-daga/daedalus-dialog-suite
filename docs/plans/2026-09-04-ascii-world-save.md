# ASCII World Save Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Preserve and save existing ASCII ZEN worlds through the normal editor save path after the native writer passes corpus and original-engine fidelity gates.

**Architecture:** Repair the vendored ZenKit ASCII serializer through focused downstream patches, retaining `WorldHandle::format` as the archive-format authority. Keep the current diagnostic override while fixes are measured; promote ASCII into the normal `saveWorld` policy only after retail-corpus and engine evidence pass, while BINARY remains rejected.

**Tech Stack:** C++20, ZenKit downstream patches, Node-API, Node.js `node:test`, TypeScript/Electron worker-service tests, `zen-roundtrip`, Spacer II/Gothic II manual acceptance.

---

Implementation must happen in a dedicated worktree. The ZenKit submodule is
reset and all `zenkit-node/patches/*.patch` files are reapplied by
`zenkit-node/scripts/build-zenkit.js`; therefore every vendored-source change
must be captured as a numbered patch rather than left only in the submodule
working tree.

### Task 1: Match ZenGin's signed ASCII boolean representation

**Files:**
- Create: `zenkit-node/test/asciiBoolFormat.test.js`
- Create: `zenkit-node/patches/0049-fix-ascii-signed-bool-values.patch`
- Modify: `zenkit-node/vendor/ZenKit/src/archive/ArchiveAscii.cc:357`
- Modify: `zenkit-node/patches/README.md`

**Step 1: Write the failing exact-output test**

Author an unpacked ASCII `minimal` fixture, read it as `latin1`, and extract
boolean entry lines. Assert that true values for `locked`, `moveable`, and
`focusOverride` are `bool:-1`, while an ordinary true field such as
`showVisual` is `bool:1` and false remains `bool:0`.

If the current fixture does not place true witnesses for all three signed
fields, seed those values in `zenkit-node/src/fixture.cc` without adding a new
VOB or moving existing VOB paths. Keep the test assertions exact:

```js
assert.ok(lines.includes('locked=bool:-1'));
assert.ok(lines.includes('moveable=bool:-1'));
assert.ok(lines.includes('focusOverride=bool:-1'));
assert.ok(lines.includes('showVisual=bool:1'));
```

**Step 2: Run the test to verify it fails**

Run: `pnpm --filter zenkit-node build && node --test zenkit-node/test/asciiBoolFormat.test.js`

Expected: FAIL because signed true values are emitted as `bool:1`.

**Step 3: Implement the minimal writer rule**

Change `WriteArchiveAscii::write_bool` to mirror patch `0017`'s BinSafe rule:

```cpp
auto const signed_true =
    name == "locked" || name == "moveable" || name == "focusOverride";
this->write_entry(name, "bool", v ? (signed_true ? "-1" : "1") : "0");
```

Generate patch `0049` from the pinned submodule diff, document the measured
ZenGin evidence in its commit message, and add it to the patch index.

**Step 4: Rebuild and verify**

Run: `pnpm --filter zenkit-node build`

Run: `node --test zenkit-node/test/asciiBoolFormat.test.js`

Expected: build succeeds and the focused test passes.

**Step 5: Commit**

```bash
git add zenkit-node/test/asciiBoolFormat.test.js zenkit-node/src/fixture.cc zenkit-node/patches/0049-fix-ascii-signed-bool-values.patch zenkit-node/patches/README.md
git commit -m "fix(zenkit): preserve signed ASCII booleans"
```

### Task 2: Preserve packed `physicsEnabled` without a rigid body

**Files:**
- Modify: `zenkit-node/test/asciiUnpackedVob.test.js`
- Modify: `zenkit-node/test/saveWorld.test.js`
- Create: `zenkit-node/patches/0050-fix-packed-vob-physics-enabled.patch`
- Modify: `zenkit-node/vendor/ZenKit/src/vobs/VirtualObject.cc:279-287`
- Modify: `zenkit-node/patches/README.md`

**Step 1: Change the regression to state the correct contract**

Remove the `withoutPhysics` normalization workaround from
`asciiUnpackedVob.test.js`. Assert that the packed and unpacked fixtures both
load with `physicsEnabled === true` and that their normalized VOB lists are
equal.

Add a focused assertion to `saveWorld.test.js` that the authored packed G2
fixture contains bit 6 in the correct `dataRaw` payload before and after a
save, even though the world VOB has no rigid body.

**Step 2: Run the tests to verify they fail**

Run: `node --test zenkit-node/test/asciiUnpackedVob.test.js zenkit-node/test/saveWorld.test.js`

Expected: FAIL because G2 packed bit 6 is currently gated by `rigid_body`.

**Step 3: Implement the minimal packed-bit fix**

Replace the version split with the actual on-disk flag rule:

```cpp
bit1 |= this->physics_enabled << 6u;
```

Do not change the later rigid-body payload guard:

```cpp
if (this->physics_enabled && this->rigid_body) {
    this->rigid_body->save(w, version);
}
```

Capture the change as patch `0050` and update the patch index.

**Step 4: Rebuild and verify**

Run: `pnpm --filter zenkit-node build`

Run: `node --test zenkit-node/test/asciiUnpackedVob.test.js zenkit-node/test/saveWorld.test.js`

Expected: both focused suites pass.

**Step 5: Commit**

```bash
git add zenkit-node/test/asciiUnpackedVob.test.js zenkit-node/test/saveWorld.test.js zenkit-node/patches/0050-fix-packed-vob-physics-enabled.patch zenkit-node/patches/README.md
git commit -m "fix(zenkit): preserve packed VOB physics flag"
```

### Task 3: Preserve wide unpacked `visualAniMode` values

**Files:**
- Modify: `zenkit-node/test/asciiUnpackedVob.test.js`
- Create: `zenkit-node/patches/0051-preserve-unpacked-visual-ani-mode.patch`
- Modify: `zenkit-node/vendor/ZenKit/include/zenkit/vobs/VirtualObject.hh:409-425`
- Modify: `zenkit-node/vendor/ZenKit/src/vobs/VirtualObject.cc:184-191`
- Modify: `zenkit-node/vendor/ZenKit/src/vobs/VirtualObject.cc:321-325`
- Modify: `zenkit-node/patches/README.md`

**Step 1: Write a failing preservation test**

Author an unpacked ASCII fixture and replace one exact
`visualAniMode=enum:0` entry with a retail-shaped value such as
`visualAniMode=enum:145297640`. Load and save the file with the diagnostic
override, then assert the same 32-bit entry appears in the re-save and the
world reloads.

Also add a native ZenKit test to the patch itself (or a small existing binding
test seam if the vendored tests are not built) that loads the raw value, assigns
a different valid `AnimationType`, saves, and observes the new semantic value.
The test must distinguish "unchanged raw value" from "deliberately edited".

**Step 2: Run the preservation test to verify it fails**

Run: `node --test zenkit-node/test/asciiUnpackedVob.test.js`

Expected: FAIL because `read_enum()` is narrowed to `AnimationType` and the
writer emits only that narrowed value.

**Step 3: Add raw-value and snapshot state**

Add private or clearly documented fidelity state to `VirtualObject`:

```cpp
std::optional<std::uint32_t> unpacked_anim_mode_raw;
AnimationType unpacked_anim_mode_loaded = AnimationType::NONE;
```

On unpacked G2 load, retain both forms:

```cpp
auto const raw_anim_mode = r.read_enum();
this->anim_mode = static_cast<AnimationType>(raw_anim_mode);
this->unpacked_anim_mode_raw = raw_anim_mode;
this->unpacked_anim_mode_loaded = this->anim_mode;
```

On unpacked save, use the raw value only while the semantic value is unchanged:

```cpp
auto const anim_mode_value =
    this->unpacked_anim_mode_raw &&
            this->anim_mode == this->unpacked_anim_mode_loaded
        ? *this->unpacked_anim_mode_raw
        : static_cast<std::uint32_t>(this->anim_mode);
w.write_enum("visualAniMode", anim_mode_value);
```

Newly authored and packed VOBs keep their current behavior. Capture source and
native-test changes in patch `0051` and update the patch index.

**Step 4: Rebuild and verify both branches**

Run: `pnpm --filter zenkit-node build`

Run: `node --test zenkit-node/test/asciiUnpackedVob.test.js`

Expected: the wide value survives unchanged; the native edit witness emits its
new valid enum; all tests pass.

**Step 5: Commit**

```bash
git add zenkit-node/test/asciiUnpackedVob.test.js zenkit-node/patches/0051-preserve-unpacked-visual-ani-mode.patch zenkit-node/patches/README.md
git commit -m "fix(zenkit): preserve wide ASCII animation modes"
```

### Task 4: Reproduce ZenGin's legacy halfway float rounding

**Files:**
- Modify: `zenkit-node/test/asciiFloatFormat.test.js`
- Create: `zenkit-node/patches/0052-fix-ascii-halfway-float-rounding.patch`
- Modify: `zenkit-node/vendor/ZenKit/src/archive/ArchiveAscii.cc`
- Modify: `zenkit-node/patches/README.md`

**Step 1: Add table-driven failing cases from the retail corpus**

Add exact entry assertions for the known ties, including both signs:

```js
[
  [-3055.890625, '-3055.89063'],
  [-4509.328125, '-4509.32813'],
  [3055.890625, '3055.89063'],
  [4509.328125, '4509.32813'],
]
```

Exercise the shared formatter through scalar, `vec3`, and `rawFloat` writers.
Retain the existing non-tie and exponent assertions.

**Step 2: Run the focused test to verify it fails**

Run: `node --test zenkit-node/test/asciiFloatFormat.test.js`

Expected: FAIL on the even-last-digit ties produced by the UCRT.

**Step 3: Implement deterministic legacy rounding**

Refactor `ftosv` into one host-independent formatter used by
`write_float`, `write_vec3`, and `write_raw_float`.

The formatter must:

1. decompose the finite IEEE-754 `float` into sign, integer significand, and a
   power-of-two exponent;
2. derive decimal significant digits without first rounding through the host
   CRT;
3. retain nine significant digits;
4. round greater-than-half upward, less-than-half downward, and an exact half
   away from zero;
5. trim insignificant trailing zeroes as `%g` does;
6. select fixed versus scientific form at the same `%g` thresholds; and
7. normalize scientific exponents to a sign plus three digits.

Keep zero, non-finite-value policy, and ordinary `0048` outputs unchanged.
Do not use `fesetround`, locale-sensitive streams, or host CRT tie behavior.
Capture the implementation as patch `0052` and update the patch index.

**Step 4: Rebuild and verify the formatter**

Run: `pnpm --filter zenkit-node build`

Run: `node --test zenkit-node/test/asciiFloatFormat.test.js`

Expected: all old cases and all halfway cases pass on Windows.

**Step 5: Commit**

```bash
git add zenkit-node/test/asciiFloatFormat.test.js zenkit-node/patches/0052-fix-ascii-halfway-float-rounding.patch zenkit-node/patches/README.md
git commit -m "fix(zenkit): match legacy ASCII float rounding"
```

### Task 5: Make ASCII writer coverage executable

**Files:**
- Create: `zenkit-node/test/asciiWriterCoverage.test.js`
- Modify: `zenkit-node/src/fixture.cc` only if a missing witness is found
- Modify: `zenkit-node/src/fixture.hh` only if its fixture contract changes

**Step 1: Write the coverage inventory test**

Build packed and unpacked ASCII fixtures and walk their event streams with
`lib/container-ascii.js`. Assert witnesses for every world-reachable archive
writer family: string, int, byte-as-int, word-as-int, float, enum, bool, color,
vec3, bbox/raw-float, matrix/raw, object, reference, and null object.

Use field names as witnesses where ASCII type tokens collapse methods. For
example, `decalAlphaWeight` witnesses `write_byte`, while a known 16-bit field
witnesses `write_word`. The assertion failure must name the missing method.

**Step 2: Run the test and record genuine gaps**

Run: `node --test zenkit-node/test/asciiWriterCoverage.test.js`

Expected: FAIL for each method not represented by current fixtures.

**Step 3: Add only the missing fixture data**

Extend the existing fixture graph without regenerating golden files
automatically. Do not add production code merely to satisfy coverage. If a
method is savegame-only or unreachable from world saving, document and exclude
it explicitly in the test inventory.

**Step 4: Verify coverage and fixture round trips**

Run: `node --test zenkit-node/test/asciiWriterCoverage.test.js zenkit-node/test/roundtrip.test.js`

Expected: both suites pass and the ASCII fixture remains fully instrumented and
deterministic.

**Step 5: Commit**

```bash
git add zenkit-node/test/asciiWriterCoverage.test.js zenkit-node/src/fixture.cc zenkit-node/src/fixture.hh
git commit -m "test(zenkit-node): cover the ASCII world writer"
```

### Task 6: Run the automated native fidelity gate

**Files:**
- Modify only if a regression is found; do not ratify failures by changing goldens

**Step 1: Run focused ASCII tests**

Run:

```bash
node --test zenkit-node/test/asciiBoolFormat.test.js zenkit-node/test/asciiFloatFormat.test.js zenkit-node/test/asciiUnpackedVob.test.js zenkit-node/test/asciiWriterCoverage.test.js zenkit-node/test/roundtrip.test.js zenkit-node/test/saveWorld.test.js
```

Expected: PASS with no skipped fidelity assertion.

**Step 2: Run the workspace suite and lint**

Run: `pnpm --filter zenkit-node test`

Run: `pnpm --filter zenkit-node lint`

Expected: all tests pass and lint reports zero warnings.

**Step 3: Confirm deterministic fixture verdicts**

Run: `pnpm --filter zenkit-node zen-roundtrip -- --fixtures --strict`

Expected: ASCII and BinSafe fixtures are `identical`, deterministic, and fully
container-instrumented; strict mode exits 0.

**Step 4: Record the verification in the eventual acceptance document**

Keep command output, addon build identity, and patch list ready for Task 8. Do
not enable normal ASCII saving yet.

### Task 7: Run the retail corpus gate

**Files:**
- Create: `zenkit-node/reports/ascii-save-gate/zen-roundtrip.json` only if repository policy permits retaining the generated report
- Modify: `zenkit-node/docs/engine-acceptance-2026-09-04.md` in Task 8

**Step 1: Verify the native addon is fresh**

Follow `docs/reference/environment-hazards.md`, "Building the native addon".
Confirm the loaded `.node` binary contains patches `0049` through `0052`; do
not trust a seeded worktree binary after native-source changes.

**Step 2: Run the retail corpus**

Run:

```bash
pnpm --filter zenkit-node zen-roundtrip -- --root worlds --game g2 --strict --drill --report-dir reports/ascii-save-gate
```

Expected:

- 20 ASCII worlds measured;
- zero crashed or unreadable worlds;
- full ASCII container coverage;
- no unexplained ASCII semantic drift;
- deterministic re-saves; and
- the four BinSafe worlds retain their existing verdict.

**Step 3: Stop on any residual**

Treat every residual as evidence to diagnose. Do not relabel a structural or
container difference as benign without a field-level explanation and an engine
witness. Keep the default save refusal in place if strict mode fails.

**Step 4: Commit only necessary diagnostic corrections**

If the harness itself needed a correction, add a failing harness test first,
fix it separately, rerun the entire corpus, and commit that correction before
continuing.

### Task 8: Pass and record the original-engine A/B gate

**Files:**
- Create: `zenkit-node/docs/engine-acceptance-2026-09-04.md`
- Reuse: `zenkit-node/docs/engine-acceptance-2026-08-25.md`
- Reuse: `zenkit-node/docs/gate2b-run-sheet.md`

**Step 1: Prepare hash-verified candidates**

Keep the pristine ASCII input as the control. Produce:

1. an untouched ASCII re-save;
2. a property-edited candidate with a transform, signed boolean, and
   `physicsEnabled` change; and
3. a structurally edited candidate with insertion and reparenting.

Record SHA-256, size, archive format, exact edit operations, normalized diff,
container diff, and object counts for every file. Use the diagnostic save
override; normal ASCII saving must still be disabled.

**Step 2: Run Spacer II A/B**

Open the pristine control and every candidate in the same documented Spacer II
environment. Inspect the edited VOBs, tree structure, world mesh, and waynet.
Save screenshots or textual observations sufficient to distinguish each file.

Expected: every candidate loads; unchanged data remains unchanged; intended
edits are visible; no repair prompt, missing subtree, or malformed field occurs.

**Step 3: Run the applicable Gothic II A/B**

Put the playable candidate in the same isolated mod setup used by prior gates.
Load it alongside the pristine control and exercise the edited area.

Expected: both control and candidate load and play; edited objects behave as
authored; no load-time rejection or visible world corruption occurs.

**Step 4: Write the acceptance record**

Record exact executable versions, commands, hashes, corpus summary, candidate
matrix, observed results, limitations, and a PASS/FAIL verdict. A harmless byte
difference is accepted only if named, semantically explained, and witnessed by
the engine.

**Step 5: Commit a passing record**

Proceed only on PASS.

```bash
git add zenkit-node/docs/engine-acceptance-2026-09-04.md
git commit -m "docs(zenkit-node): record the ASCII engine gate"
```

On FAIL, commit the evidence only if useful, leave normal ASCII saving blocked,
and create a new diagnosis before changing the writer again.

### Task 9: Promote ASCII into the normal save policy

**Files:**
- Modify: `zenkit-node/test/saveWorld.test.js`
- Modify: `zenkit-node/src/binding.cc:432-461`
- Modify: `zenkit-node/lib/index.d.ts:525-536`
- Modify: `zenkit-node/README.md`
- Modify: `daedalus-dialog-editor/src/main/workers/zenkit.worker.ts:322-338`
- Modify: `daedalus-dialog-editor/tests/WorldService.test.ts:820-840`
- Modify: `daedalus-dialog-editor/tests/WorldSurface.editing.test.tsx:980-1005`
- Modify: stale ASCII status sections in `docs/BOARD.md`, `docs/plans/level-editor.md`, and `docs/architecture/level-editor.md`

**Step 1: Write the failing save-policy tests**

In `saveWorld.test.js`, add an ASCII fixture test that calls
`zenkit.saveWorld(handle, out)` with no options, then asserts:

```js
assert.strictEqual(zenkit.worldProperties(zenkit.loadWorld(out, 'g2')).format, 'ascii');
```

Retain a BINARY test that normal saving rejects and diagnostic saving permits.
Update editor service/renderer tests so an ASCII-originated error is no longer
expected, while a real worker save failure still reaches the existing UI.

**Step 2: Run the policy tests to verify they fail**

Run: `node --test zenkit-node/test/saveWorld.test.js`

Run: `pnpm --filter daedalus-dialog-editor test -- WorldService.test.ts WorldSurface.editing.test.tsx`

Expected: native ASCII normal-save test fails under the old BinSafe-only guard.

**Step 3: Narrow the guard to BINARY**

Replace the broad non-BinSafe policy with an explicit verified-format check:

```cpp
bool const verified = handle->format == zenkit::ArchiveFormat::BINSAFE ||
                      handle->format == zenkit::ArchiveFormat::ASCII;
if (!verified && !AllowUnverifiedBinary(env, info[2])) {
    throw Napi::Error::New(
        env,
        "refusing to save a world loaded from a 'binary' archive: the binary writer path is not verified");
}
```

Rename the option to `allowUnverifiedBinary` if compatibility permits. If
diagnostic callers outside this repository require the old spelling, accept it
as a deprecated alias but document only the new one. Update the harness call
site and type declarations together.

**Step 4: Remove stale BinSafe-only application assumptions**

Keep the editor call as `zenkit.saveWorld(handle, targetPath)`. Update comments,
error fixtures, README, board, plan, and architecture text to say ASCII passed
the dated engine gate. Do not add UI state, warnings, conversion, or a format
selector.

**Step 5: Run focused policy and editor tests**

Run: `node --test zenkit-node/test/saveWorld.test.js zenkit-node/test/roundtrip.test.js`

Run: `pnpm --filter daedalus-dialog-editor test -- WorldService.test.ts WorldSurface.editing.test.tsx`

Expected: ASCII and BinSafe save normally, BINARY rejects normally, diagnostic
BINARY save still works, and editor errors behave as before.

**Step 6: Commit**

```bash
git add zenkit-node/src/binding.cc zenkit-node/lib/index.d.ts zenkit-node/test/saveWorld.test.js zenkit-node/README.md daedalus-dialog-editor/src/main/workers/zenkit.worker.ts daedalus-dialog-editor/tests/WorldService.test.ts daedalus-dialog-editor/tests/WorldSurface.editing.test.tsx docs/BOARD.md docs/plans/level-editor.md docs/architecture/level-editor.md
git commit -m "feat(level-editor): preserve and save ASCII worlds"
```

### Task 10: Run final repository verification

**Files:**
- Modify only to fix diagnosed regressions with their own failing tests

**Step 1: Rebuild the native addon from the final patch series**

Run: `pnpm --filter zenkit-node build`

Expected: patches `0001` through `0052` apply cleanly and the addon builds.

**Step 2: Run ZenKit verification**

Run: `pnpm --filter zenkit-node test`

Run: `pnpm --filter zenkit-node lint`

Run: `pnpm --filter zenkit-node zen-roundtrip -- --fixtures --strict`

Expected: all commands exit 0.

**Step 3: Run editor verification**

Run: `npm test --workspace daedalus-dialog-editor`

Run: `npm run typecheck --workspace daedalus-dialog-editor`

Run: `npm run build --workspace daedalus-dialog-editor`

Expected: tests and typecheck pass; build passes. If Vite fails with sandbox
`spawn EPERM`, rerun the same build outside the sandbox as documented in
`AGENTS.md`.

**Step 4: Rerun the final retail corpus**

Run:

```bash
pnpm --filter zenkit-node zen-roundtrip -- --root worlds --game g2 --strict --drill --report-dir reports/ascii-save-final
```

Expected: the same passing verdict recorded by Task 8, now with the normal save
policy enabled and no BinSafe regression.

**Step 5: Inspect the final diff and status**

Run: `git diff --check`

Run: `git status --short`

Expected: no whitespace errors and only intentional files changed.

**Step 6: Commit any verification-only documentation update**

If the final build identity or corpus report changed the acceptance record,
update it and commit:

```bash
git add zenkit-node/docs/engine-acceptance-2026-09-04.md
git commit -m "docs(zenkit-node): finalize ASCII save evidence"
```
