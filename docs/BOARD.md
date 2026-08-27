# Board

The one file to read at the start of a session, and the one to update at the end.
It holds **only what nothing else holds**: what is in flight, who owns it, and
the state of the tree.

Everything else already has a home, and repeating it here is what made the old
handovers cost an hour a session:

| Looking for | It is in |
|---|---|
| what landed, and why | `git log` — the commit messages carry the reasoning |
| a decision or a measurement | `docs/plans/level-editor.md` §7 |
| build and test commands | `CLAUDE.md`, and each workspace's `README.md` |
| machine and toolchain hazards | `docs/reference/environment-hazards.md` |
| a known wart nobody is fixing yet | `docs/refactoring-targets.md` |
| the Gate 2 checklist | `zenkit-node/docs/engine-acceptance-2026-08-25.md` §8 |

**Rules.** A card is one line and an owner. A card moves to Done only when its
tests and its linter pass. Done is emptied at the end of a phase, because
`git log` is the permanent record — this file is a working surface, not an
archive.

**Always commit at the end of a session.** Never leave finished work sitting in
the working tree: this file points at `git log` for what landed and why, and
uncommitted work is invisible to it. Commit the board update in the same
session, and split unrelated work into separate commits. Stage with
`git add -A -- . ':!zenkit-node/vendor/ZenKit'` — the submodule is the applied
patch series and is never committed.

**Anything said about future work is written down before the session ends.**
Every caveat, every "worth remembering next time", every open question, every
defect noticed and not fixed — if it would change what somebody does next, it
goes in a file, not in a chat reply. A finding that exists only in a
conversation is lost the moment the conversation is, and the next session pays
to rediscover it. Route it by the table above: a fact about the code goes to the
plan, a fact about this machine to `environment-hazards.md`, a card to Next or
Blocked here. Say where it went, so the routing can be corrected.

**A doc that has gone stale is a defect.** When work invalidates something a
file asserts, fix it in the same change — including comments that record a
constraint the work has just removed. The claim to check hardest is the one that
was true for so long nobody re-reads it.

---

## State of the tree

- branch `master`, **ahead of its remote and not pushed.** `feature/level-editor`
  was merged and is no longer where work happens.
  No HEAD hash and no count here — a file committed at HEAD cannot name either,
  and a number goes stale the moment anything lands. `git status -sb` answers it.
- **`zenkit-node/vendor/ZenKit` is permanently dirty** and is **never**
  committed: it is the applied patch series. Stage with
  `git add -A -- . ':!zenkit-node/vendor/ZenKit'`, or name paths explicitly.
  Anything else showing is unfinished work — `reports/` used to be the one
  exception and the root `.gitignore` now catches it.
- **Merged to `master` 2026-08-28.** The "deliberately unmerged until an engine
  verdict" rule is retired — Gate 2 passed (Done) and the merge was a clean
  fast-forward, so backing it out is a `git reset --hard` to the merge's first
  parent. Merging is not releasing: `build-windows.yml` is `workflow_dispatch:`
  and nothing else, so a push to master builds no installer, cuts no release and
  touches no update feed. Anything about shipping is the dispatch's decision,
  not this one — and the two gaps below have to close before that dispatch.
- **The addon and the vendored ZenKit were both rebuilt this session**, so every
  other machine and CI must rebuild — and here it is `vendor-build/` too, not
  just `build/`: patches `0024`–`0026` change `ArchiveAscii.cc`, `0027` changes
  `World.cc`, and `src/fixture.cc` gained a decal. Run **`node scripts/build-zenkit.js` before
  `npx node-gyp rebuild`**; the gyp step alone links a stale `zenkit.lib` and
  silently keeps the old writer. A stale `.node` is worse than useless — the
  editor's Jest suites fake the worker, so they stay green against a binary
  that has neither `getVobProps` nor `setVobClassProp` while the running app
  has no class properties at all.
  One trap: `npx node-gyp build` (without `rebuild`) fails with
  `LNK1103: Debuginformationen beschädigt` after the static lib is replaced.
  `rebuild` is the working incantation.
- **`zen-world` and the editor's whole `dist/` were rebuilt for it too** —
  `SetVobClassProp` and the `CLASS_FIELDS` catalogue are in both, and the editor
  typechecks and tests against `zen-world/dist`, not its source, so `build:main`
  fails outright until `pnpm --filter zen-world build` has run.
- **Nothing else needs rebuilding on this machine.** On another, or after any change
  to `coords`, `binding.cc` or anything `zen-world` exports:
  `cd zenkit-node && node scripts/build-zenkit.js && npx node-gyp rebuild`, then
  `pnpm --filter zen-world build`. `verify-world-edit.js` drives the *built*
  renderer, so it needs the full `pnpm --filter daedalus-dialog-editor build`,
  not `build:main`.

---

## Now

*(empty — three cards landed this session; see Done)*

## Next

- **Two gaps that block the next `build-windows` dispatch, not the merge.**
  Recorded 2026-08-28 so the dispatch is not the place they are discovered:
  - **A dispatched build would ship a World button with no addon behind it.**
    `zenkit-node/scripts/install.js:22-25` skips the source build whenever `CI`
    is set unless `ZENKIT_NODE_FORCE_BUILD=1`, which only `zenkit-node.yml:72`
    sets; `package.json` has `npmRebuild: false` and no `asarUnpack` for
    `*.node`. Needs the addon built or prebuilt in the release job, the
    `asarUnpack` entry, and an asar assertion for `zenkit_node.node` — the
    existing verifier only checks `safe-buffer`, and the startup smoke never
    opens a world.
  - **The addon is not in the release gate.** `build-windows.yml` gates on
    `all-tests.yml`, which has no zenkit-node job. `zenkit-node.yml` is its own
    workflow, path-filtered to `zenkit-node/**` and triggered on push/PR to
    master — so it ran on the phase-1a PR and then on nothing until the merge
    push. **That push has since gone green** (`zenkit-node` and `All Tests` both
    success on `fbb969c`), so `binding.gyp`'s `_HAS_EXCEPTIONS` fix now has a
    windows-2022 verdict and the evidence half of this card is closed. What is
    not closed is the structure: the addon is still not in the release gate,
    because `all-tests.yml` still has no zenkit-node job and the path filter
    still means a change in `zen-world/` or `zenkit.worker.ts` that breaks the
    binding contract never runs it.
    Also: `zen-world/dist` is built by an undeclared `postinstall` hook
    (`zen-world/package.json:24`) and `zen-world` is not in
    `pnpm-workspace.yaml`'s `onlyBuiltDependencies`, so a single
    `--ignore-scripts` takes out four jobs at once.
- **Three shipped ops have no engine verdict.** `DeleteVob`, `MoveWaypoint` and
  `SetVobClassProp` all landed after candidate `03` was built, so Gate 2 covers
  the ops that existed on 2026-08-27 and not these — the acceptance record says
  so itself at `engine-acceptance-2026-08-25.md:851-854`. Say "Gate 2 passed for
  the ops it tested", not "Gate 2 passed". A removed subtree is still the edit
  ZenGin has the most room to disagree about, and `SetVobClassProp` writes
  `oCItem.instance` as free text against a documented engine-crash path
  (`level-editor.md` §14.1) — validating it against the parser's item index is
  the obvious follow-up and is not scheduled.
- **Phase 1b-2, class-aware editing — the rest of it.** Increment 1 landed (see
  Done), so the path exists and each further class is one C++ case plus one
  `CLASS_FIELDS` entry plus its tests. What is left, in the order the plan §7
  entry argues for: the remaining classes (sound, the trigger family, `oCMob*`,
  the zones, `zCPFXController`, `zCVobAnimate`), and then the four things held
  out by decision rather than by time — `isStatic` and anything else that
  changes *which* fields the archive contains, enums (retail carries
  out-of-range values a dropdown destroys), list fields (first unbounded
  payloads in the op set), and base-`zCVob` widening (§14.1 item 1.8). Alongside
  them and independent: class-specific *insertion* (item 1.3 — `insertItemVob`
  is in the binding and wired to nothing), numeric transform entry (1.5),
  copy/paste (1.2), snapping (1.6). Still scheduled before Phase 1c in §11.
- **Waynet editing — the edge ops, and add/delete/rename.** The gizmo landed
  (see Done), so the one op that exists is now reachable; nothing below is.
  **The addressing problem is the whole job and it is untouched.**
  `MoveWaypoint` addresses a waypoint by its index into the list `getWaynet`
  emits, and that is safe only because a move inserts, deletes and reorders
  nothing. Every op left here breaks it, and names cannot be the fix — nothing
  in the format promises they are unique, which is why the binding matches edge
  endpoints by pointer identity.
  The edge ops keep their original hazard: `free_point` is not a stored field,
  and `WayNet::save` writes only free points plus edge endpoints, so a non-free
  waypoint in no edge is dropped at save. Removing a waypoint's last edge
  therefore deletes the waypoint, which is why an edge op is not invertible as an
  edge op. Waypoint delete has a bounded version of the arbitrary-VOB-delete
  trap — a `WayPoint` is five scalar fields, so what an op cannot describe for
  free is its edge memberships, and those are an enumerable list.
- **What is left of the ASCII writer — A2, A3, A6 and one undiagnosed drift.**
  A1, A4 and A5 landed (Done), and the corpus now measures all 20 retail ASCII
  worlds instead of crashing on them. They classify **`semantic-drift`**, and
  the instrument names the whole of it in two findings across all 20:
  - **A6 — `physicsEnabled` is dropped on every save, 396 of the 400 findings,
    and it is not an ASCII defect at all.** `VirtualObject.cc:251` writes packed
    bit 6 as `physics_enabled && rigid_body` on G2, but `rigid_body` is only
    ever filled inside `if (r.is_save_game())` (`:210`) — so in a *world* it is
    always empty and the flag is always lost. The `&& rigid_body` guard belongs
    at `:325`, where the rigid body is actually written, and it is already
    there; the fix is deleting it from `:251`. **This is the packed `zCVob`
    writer, so the BinSafe path the editor saves through has it too.** It
    changes no retail byte today — measured 0 `physicsEnabled` VOBs across
    NewWorld, OldWorld and AddonWorld, 41,393 VOBs — which is exactly why the
    BinSafe worlds still classify `identical` and why nobody has seen it. A
    user-edited or modded world is another matter, and that is the editor's own
    save path. Not landed here because it needs a fixture VOB with the flag set
    and, being a save-path byte change, the project's own engine-A/B rule.
  - **`animMode` on 4 VOBs in the whole corpus.** Undiagnosed. Small enough to
    be a single odd value and large enough to be a second enum defect.
  - **A2 and A3 are unchanged and still chained.** A2 is dead code with no
    reachable switch: `VirtualObject.cc:12` has `static bool pack = true;`,
    `:336` `enable_packed_save` is its only writer, and grep over `src/`,
    `include/` and `zenkit-node/src/` finds **no caller at all** — so `:269`'s
    unpacked branch, which holds A3's only call site
    (`:272 write_mat3x3("trafoOSToWSRot")`), can never execute. A2's re-enabled
    path also has a second, undocumented **duplicate-entry bug**:
    `VirtualObject.cc:270-275` and `:297-307` both write
    `presetName`/`vobName`/`visual`, and the two `visual` writes are not even
    the same value (`visual_name` vs `visual->name`). ASCII entries are read
    positionally, so the extras are pure stream desync.
  **The lesson A5 taught, and it will repeat.** A5 was invisible to CI for one
  reason: `decalAlphaWeight` is the only `write_byte` field reachable outside a
  savegame and the authored fixture had no decal — so the fixture round-tripped
  clean while all 20 retail worlds failed at the first decal in the file. The
  fixture now hangs a `VisualDecal` on the chest. **Any writer path with no
  fixture field on it is a defect CI cannot see**, and the cheap audit is to
  walk `WriteArchive`'s methods and ask which have no fixture data behind them.
  One thing the harness still owes, not blocking (the byte-diff half closed —
  see Done):
  - **There is still no ZenGin-written ASCII fixture, so CI cannot regression-test
    an ASCII round-trip against anything but ZenKit itself.**
    `_authorFixtureWorld(..., 'ascii')` is ZenKit's own writer, so `--fixtures`
    proves self-consistency and nothing about the engine. A real ASCII fidelity
    result stays a C1, developer-local `--root` run unless a small
    ZenGin-authored ASCII world is checked in. `zen-roundtrip`'s early
    `instrument: 'none'` return on a failed load is no longer reached by any
    ASCII world, so that half of the old card is closed.

- **`resavedSize` is fragile at a day or month boundary, not a second one.**
  Found while making the ASCII stamp comparisons robust (Done), and left alone
  deliberately. Patch `0018` formats the header stamp `"%d.%d.%d %02d:%02d:%02d"`
  — hour, minute and second are zero-padded, **day and month are not** — so the
  header's *length* changes when the day crosses 9→10 (or the month does), and
  the re-save is then a different size from the original. That breaks
  `assert.strictEqual(ascii.resavedSize, ascii.size)` (`test/roundtrip.test.js:165`)
  and `row.wholeFileIdentical` with it; reproduced by rewriting the fixture's
  stamp shorter before the re-save, `sizes 5064 5068`. Not fixed because the fix
  changes what `resavedSize` *means* in the harness report — a stamp-stripped
  size, or a second field beside it — and that is a report-shape decision for
  Daniel rather than something to do unasked.
- **A malformed world still crashes the reader — the hang was the small half.**
  The spin is fixed (patch `0027`, Done), but closing it turned up the size of
  what is left. Seeded fuzzing, 30 seeds of 100 corrupted bytes each over one
  BinSafe fixture: **19 crashed the child with `0xC0000005`**, one with
  `0xC0000374` (heap corruption), two hung, and only eight threw cleanly. So a
  malformed world still takes the editor's `zenkit.worker` down — by segfault
  now instead of by spinning — and **the worker isolation stays load-bearing:
  `loadWorld` is not crash-safe and must never be called on the main thread.**
  The shape of the job is unvalidated counts feeding `resize`/indexing
  throughout `Mesh.cc`, `BspTree.cc` and the VOB readers, and the underlying
  hazard beneath all of them is `ReadMemory::seek`
  (`vendor/ZenKit/src/Stream.cc:277-283`) **silently ignoring an out-of-range
  seek** rather than failing. Making it clamp or throw would fix the class in
  one place and change behaviour for every reader in ZenKit, which is why `0027`
  bounded its own loop instead. Until someone takes that decision, every
  chunk-walking loop has to carry its own bound.
- `.MMB` authoring has no ZenKit writer at all.
- macOS CI — **dropped from scope, 2026-08-27** (Daniel). Not a gap to close.
- **Gate 2 covered no deleted VOB and no moved waypoint** — both landed after
  the staged candidate was built (2026-08-27 run, Done). A removed subtree and
  a moved waypoint are still the two edits with no engine verdict of their own;
  whether that's worth a rebuilt candidate is Daniel's call, not something to
  do unasked.

- **The leaked Jest worker handle is still unidentified, and `ParserService` was
  not it.** The pool is lazy now (Done) and the warning *did* leave the two
  suites that import `main.ts` — but the full editor run still prints *"A worker
  process has failed to exit gracefully"*, measured 6 of 7 runs after the fix
  against the "roughly half" the old card recorded before it. So the card's
  hypothesis is disproved and the handle is somewhere else; the next step is a
  `--detectOpenHandles` run, not another guess. The audit that came with the fix
  narrows where it cannot be: every other service `main.ts` constructs at module
  load is string/number arithmetic in its constructor — `LogService` opens its
  file in `log()`, `SettingsService` only joins `userData`, and
  `ProjectService` creates its `MetadataWorkerPool` inside `buildProjectIndex`
  (`ProjectService.ts:129`). Still worth checking against the intermittent
  `3221226505` exits `test:matrix:windows` exists for — they may be the same
  handle.

- **Two small things noticed while landing an earlier session's cards.** Neither
  blocking, both cheap, each recorded because the finding is worth more than
  the fix is expensive. (The other two — `tools/` outside lint's globs, and the
  ASCII round-trip's clock-second assumption — landed; see Done.)
  - **The terrain bar reserves a hard-coded 31 px** for the button its picked
    state adds, derived from MUI's small-button metrics. If the theme ever sets
    a button height it drifts, and jsdom has no layout, so no test can catch it.
  - **The viewport wants an imperative handle.** `frameSelection` and the new
    jump both live inside the big scene effect, so reaching them needs a ref
    hop plus a request prop. A third viewport command should promote that to a
    handle rather than adding a second prop — a `docs/refactoring-targets.md`
    entry if it grows.

Two cards below are what is left of Daniel's first hands-on pass, 2026-08-27 —
five of the seven have landed: the viewport pivot, the world open dialog, and
this session's three (the texture re-decode, the terrain bar and its marker, and
the jump to a VOB from the scene tree). The note they were written against has
since been deleted, so **these cards are now the record** — nothing else holds the complaints, which is why each one states
the complaint before its diagnosis. The diagnoses are code-read and every
file:line in them was re-verified 2026-08-28. The card heading the list is not
one of Daniel's complaints but the follow-up question the pivot fix asks him.

- **The pivot needs Daniel's hands on it before the next one is tuned.** It
  landed (Done) and the numbers in it are guesses that only use can settle:
  `ORBIT_ROTATE_SPEED = 0.4` against OrbitControls' 1.0, and
  `MIN_PIVOT_DISTANCE = 1` m. Two shapes to judge at the same time — whether the
  projection-onto-the-view-axis pivot reads right near a screen edge (the
  alternative is the literal picked point, which costs a view snap on every
  middle-press), and whether a VOB under the cursor ought to be a pivot target
  (it is not: ID-picking answers an id, not a point, and a CPU raycast over 724
  `InstancedMesh`es is the 14.2 ms the viewport exists to avoid — a *clicked*
  VOB is the fallback pivot, and interiors pivot on walls, which are world mesh).
- **A VOB is hard to tell from the world mesh.** Asked for as a faint outline on
  VOB visuals. Nothing about the current pipeline resists it — the VOBs are
  their own `InstancedMesh` set, so the selection highlight already has a place
  to hang.
- **Interiors are too dark, and shadows are not coming.** Both answered by
  `WorldScene.ts:347-353`: the material is `MeshBasicMaterial`, ZenGin's
  lighting is baked into the vertex colours, and there is nothing dynamic to
  relight or to cast with. So "add lights" is the wrong fix and dynamic shadows
  are a no. What is right, and what this card is, is a viewport-only exposure
  lift on those baked colours — a brightness control that changes what is on
  screen and nothing about the world. Worth saying before it is asked again:
  the `zCVobLight`s in the file are data Phase 1b-2 makes *editable*, not a rig
  the viewport can switch on.

## Done — Phase 1b

- **The waynet overlay survives a structural edit.** The overlay effect was
  keyed `[waynet, mesh]` while the scene effect it hangs off is keyed
  `[mesh, visuals, bbox]`, so a `visuals`-only rebuild handed out a new root and
  left the overlay attached to the disposed one. Both effects now take `visuals`,
  copying the terrain marker's shape.
  **The fix is two-part and that is the durable finding**: `WaynetOverlay.ts:116`
  sets `root.visible = false` in the constructor, so adding `visuals` to only the
  *attach* effect re-parents an overlay that is never shown — the identical
  symptom with a different cause, and the attachment assertion stays green
  through it. The visibility effect needed the same dep, and the second test
  pins it; neither test passes on the partial fix. Any future viewport effect
  that builds an object whose *state* a second effect applies has this trap.
  Two costs accepted: the overlay is now torn down and rebuilt on every
  structural op (2,959 waypoints on NewWorld — cheap beside the scene rebuild it
  rides along with, and the alternative is making the overlay outlive the scene
  the way `TextureCache` now does), and **no E2E can cover this** — the browser
  harness refuses `openWorld` and two specs assert `world-viewport` has count 0,
  so Jest is the whole regression net. This is also the first test that renders
  the real `WorldViewport`, and it needed five module mocks (`WebGLRenderer`,
  `three-mesh-bvh`, both example controls, `BvhBuilder`, `VobPicker`); a third
  such test should promote them to a shared helper.
- **The parser pool waits until something asks for a parse.** `main.ts`
  constructed `ParserService` at module load and it spawned eight worker threads
  in its constructor, before anything asked for a parse. The spawn loop moved
  into a guarded `startPool()` that `parseSource` calls, so construction is now
  string/number arithmetic — **the same shape `WorldService` already had**, which
  is the correction the card needed: `main.ts:52` constructs `WorldService`
  *eagerly* too, and the laziness lives inside the service. A true lazy
  construction in `main.ts` was rejected as non-minimal, because `main.ts:47`
  passes the instance to `ValidationService`. Doing it in the service fixes it
  for every consumer, not just `main.ts`.
  `worldOpenDialogDefaultPath.test.ts` dropped its `ParserService` mock and the
  now-false comment claiming the pool would outlive the test — it exercises the
  real service through `main.ts`, which is the strongest available proof.
  **What it did not fix is now its own card in Next**: the full-suite worker-leak
  warning is still there.
- **`tools/` is linted, and the byte diff sees past a clock stamp.** Two cards,
  one commit, both in `zenkit-node`.
  The lint glob gains `tools/**/*.js` in `package.json` *and* in
  `eslint.config.js` — the second is not optional, or the CommonJS globals block
  does not apply and every file erupts in `no-undef`. All seven files were
  already clean, so **the card's value was the structural gap, not a latent
  bug**: `tools/bytediff.js` consumes shared `lib/` code. `tools/README.md`'s
  deliberate "not linted" line went in the same change.
  For the stamps, **the card's premise was wrong on two counts and the
  measurement is the finding.** The nested `MeshAndBsp` header carries no
  `date`/`user` at all (ZenKit's patched writer omits nested stamps, as ZenGin
  does), and the top-level stamp reaches neither `differing` (events only) nor
  `blob.identical` (the blob excludes the top-level header) — only
  `textHeaderIdentical`, which no test asserted. Authoring the fixture, waiting
  1.5 s and re-saving leaves both named assertions green. The fix landed anyway
  so the property holds **by construction** rather than by the fixture happening
  not to nest a stamp: `equalIgnoringStamps` in `lib/container-diff.js` (joining
  `withoutHeaderStamps`, moved there out of `zen-roundtrip.js`) drops the stamp
  *values* and never the lines, per span, so a length-changing stamp needs no
  offset arithmetic. It is attempted only for spans containing `ZenGin Archive`,
  which both keeps the cost off a retail world's hundreds of thousands of
  ordinary events and states the rule: **bytes outside a header are compared
  exactly**, so a writer regression anywhere else is still a difference. Proved
  by perturbing one non-stamp blob byte and one `vobName` byte — both still
  reported. A length-changing *nested* stamp is still reported too, deliberately:
  the blob's declared size lives in the enclosing object frame, and normalizing
  that would be normalizing framing.
- **A malformed world no longer spins the reader forever.** Patch `0027`.
  `World::load`'s MeshAndBsp chunk scan trusted a length out of the file, and
  `ReadMemory::seek` refuses an out-of-range seek *silently* — so a length
  corrupted large is a no-op, not a jump: the cursor stays, the scan walks
  garbage six bytes at a time, and at the end of the archive reads stop
  advancing it and `chunk_type` is 0 forever. The card called it an unbounded
  length read; it is a pure spin with no allocation on the path, which matches
  the 202 s of CPU and not the growing RSS, so that was a second corruption.
  The fix is an `eof()` check and nothing else — unreachable for a valid world,
  and it makes the loop provably terminating. Repro is **one byte** of the
  checked-in fixture (offset 945, the 0xB030 length word, 52 → 196660), found by
  seeded fuzzing and minimised from 100 mutations; the test seeds it by walking
  the chunk table rather than by magic offset, and drives `loadWorld` through a
  child process with a 30 s kill so a regression reports a timeout instead of
  wedging the suite. 30088 ms → 128 ms. What the same fuzzing found and did not
  close is now its own card in Next.
- **One byte diff, and it knows ASCII exists.** The harness and the CLI held two
  copies; only the CLI ever learned ASCII, so `zen-roundtrip.js` gated on
  `kind.format === 'BIN_SAFE'` and every ASCII row reported a bare `whole-file`
  verdict — no alignment, no coverage number, nothing about *where* two files
  differ. Both are now `lib/container-diff.js`, dispatching on format the way
  `containerFromBuffer` does and returning the `whole-file` fallback itself for
  BINARY, so the decision is made once instead of at each call site.
  `hashTableIdentical` became `trailerIdentical` — ASCII has no hash table. The
  two stale "walks BinSafe only" claims (the file header and `summarize()`'s
  note) went in the same change. The test asserts the accounting, not the label:
  total == accounted == the file's size on disk, gap 0, both event counts equal.
- **A structural edit no longer re-decodes every texture.** Placing or
  reparenting a VOB read as a cold open for two reasons, both real:
  `WorldScene.dispose()` released every `THREE.Texture` on teardown, and the
  rebuilt scene's slot map started empty anyway, so `pendingTextureNames()`
  named all 490 for NewWorld and the pump re-issued an IPC round and a decode
  for each. A `TextureCache` now lives in the viewport beside `poseRef`, keyed
  on the same world key, and outlives the `WorldScene` that borrows it.
  **Disposal moved and the report says where**: the cache owns it — a rebuild
  disposes nothing, a different world is disposed inside `textureCacheFor`
  before the new cache exists, an unmount by a mount-only effect; a `WorldScene`
  built *without* a cache still disposes its own. The camera reframe the card
  named as part of the same jolt turned out already fixed by the pose restore —
  `refreshIndex` returns the bbox captured at open, so the world key is
  byte-identical across a structural op — and the comment claiming otherwise was
  corrected. 490 IPC calls → 0, test-enforced; not measured in milliseconds,
  because `runViewportBenchmark` needs a live renderer and the harness refuses
  `openWorld`.
- **Jump to a VOB from the scene tree.** Double-click a row, or the locator that
  appears on hover. The framing maths came out of `WorldViewport`'s
  `frameSelection` closure and became `frameVobs` in `cameraNav.ts`, so the jump
  and the framing key are one mechanism rather than two that agree by accident —
  and pure, therefore testable against a real camera instead of through a scene
  that does not exist in the harness. **The pivot is set twice because there are
  two of them**: `frameOn` leaves `controls.target` on the VOB, and
  `rememberPick` leaves `lastPick` there — the fallback a middle-drag begun over
  the sky uses. Without the second, the first orbit after a jump swings back to
  the last click, which is the complaint the pivot work exists to answer. This
  also changed the `.` key, deliberately. The request is an object and not an
  index, because jumping to the same VOB twice is two requests and that is
  exactly when the second is asked for.
- **The terrain bar stops shoving, and its point is visible.** The bar is gated
  on a world being open rather than on the point, so it mounts once; empty it
  carries the hint saying what it is for, and the row reserves the height of the
  button the picked state adds — a bar that changes height still shoves.
  `TerrainMarker` is modelled on `WaynetOverlay` and inherits its two answers:
  it hangs under the mirrored root, so the root stays the only place that knows
  the conversion, and it is `sizeAttenuation: false`, `depthTest: false`.
  **It cannot steal a pick, twice over** — all three pick paths enumerate
  explicit object lists it is in none of, and its `raycast` is a no-op, which is
  what the test pins with a ray fired at a 1000-unit threshold. Its effect is a
  sibling of the overlay's, outside the scene-build effect, and takes `visuals`
  in its deps — which is what exposed the overlay's own missing dep (Next).
- **The ASCII writer works — A1, A4 and a fifth defect nobody had named.**
  Patches `0024`–`0026`. The corpus is the result: a retail G2 install went from
  **4 of 28 worlds measured, 20 crashed** to **24 measured, 24
  container-instrumented, 0 crashed, 0 unreadable**. Record in
  `zenkit-node/docs/engine-acceptance-2026-08-25.md` §10.4.
  - **A1** (`0024`) — `write_raw` decided how many hex digits `std::to_chars`
    wrote by testing a null terminator `to_chars` never writes, so every byte
    below `0x10` carried the previous byte's low nibble. It was also the reload
    blocker the old card guessed it was: the corruption landed in the packed
    `zCVob` flag word and `VirtualObject::load` then demanded an object frame
    where the archive held an entry. The pin in `container.test.js` is now the
    opposite assertion — the hex must decode **exactly** to the bytes the
    BinSafe fixture's packer produced, with a guard that the entry still
    contains sub-0x10 bytes so the equality can never hold vacuously.
  - **A4** (`0025`) — the header's `objects` field padded to 11 where ZenGin
    pads to 9. Retail `OldCamp.zen` re-saves with `objects 1835     `, byte for
    byte the original line. Same defect `0013` fixed for `zCArchiverBinary`,
    which had picked 10.
  - **A5** (`0026`), **found by running the corpus after A1** —
    `write_byte`/`write_word` emitted `byte:`/`word:` type tokens that
    `ReadArchiveAscii::read_byte`/`read_word` reject, both calling
    `read_entry("int")`. ZenGin settles which side is wrong: 144,111 `int:`
    entries across the install's 24 ASCII worlds and **zero** of either. 19 of
    the 20 worlds still failed after A1, every one at the first
    `decalAlphaWeight` in the file.
  **The fixture had to change to see A5, and that is the durable finding.**
  `decalAlphaWeight` is the only `write_byte` field reachable outside a
  savegame, and the authored fixture had no decal — so it round-tripped clean
  through a defect that broke every real world. `BuildVobTree` now hangs a
  `VisualDecal` on the chest: no VOB added, no index path moved, object count
  11→12 and frame count 18→19. The three ASCII tests that pinned those numbers
  were updated with the reason written next to them.
  The old `roundtrip.test.js` pin said in capitals that a fixed writer must turn
  it red. It did, twice, and is now the verdict the working writer earns —
  `ok`/`identical`/`instrument: 'full'`, with the inverse spelled out: if it
  goes red with `unreadable`, the writer has regressed. What is **not** claimed
  is fidelity: the fixture is ZenKit's own output, the 20 retail worlds classify
  `semantic-drift` not `identical`, and no ASCII world has been through the
  engine. `saveWorld` stays BinSafe-only. `README.md`, `tools/README.md` and
  `patches/README.md` were all corrected in the same change.
- **The Gothic install picker starts where the install is.**
  `world:selectGothicInstall` now passes the stored install as `defaultPath`,
  the mirror of `world:openDialog`'s fix. Two tests in the existing
  `worldOpenDialogDefaultPath.test.ts`, which now covers both pickers.
- **`world-timeout` copy — checked, nothing to change.** The card feared the
  renderer distinguished a timeout from a crash and implied a retry. It does
  neither: `WorldSurface.tsx:685` renders `worldStore.error` as the main
  process's raw message, `openFailed(failure.message)` is the only writer, and
  both `WorldService.ts:349` and `:362` already say *reopen the world*. Nothing
  in the renderer branches on the kind at all — `WORLD_TIMEOUT`/`WORLD_CRASHED`
  appear only in `WorkerRequestError.ts`. Recorded rather than left open so the
  next session does not re-derive it.

- **A timed-out world request takes the worker with it.** The one code defect
  that argued against merging, and it is fixed: `handleTimeout` now mirrors
  `handleWorkerDeath` — reject every pending request, null the world path,
  terminate, null the worker — so `openWorld`'s `worker === null` guard spawns a
  fresh thread instead of posting the retry back into the stuck one. `failure`
  is set *before* `terminate()`, because terminate fires a non-zero `exit` that
  `handleWorkerDeath` would otherwise relabel a crash. Two tests: one proves the
  next open gets a *second* worker, the other that a timeout rejects the
  requests in flight beside it rather than leaving them to hang out their own
  timers. The malformed-BinSafe hang that produces the timeout is still open.
- **A pivot the user sets, and a rotation speed somebody chose.** Four of
  Daniel's complaints were one defect: `controls.target` sat at the centre of a
  600 m island, and OrbitControls scales dolly step, pan speed *and* orbit
  radius by the camera-to-target distance. A navigating press now pivots on what
  is under the cursor, falling back to the last click over sky.
  Two decisions the code settled: the pivot is the **projection of the pick onto
  the view axis**, not the pick — OrbitControls re-aims at the target every
  `update()`, so an off-axis pivot cannot be adopted without snapping the view;
  this is Blender's auto-depth, changes zero pixels, and keeps the distance all
  three complaints depend on. And `MIN_PIVOT_DISTANCE` clamps at 1 m, because a
  closer pivot scales dolly and pan to nothing — navigation locked up, not
  navigation made precise. `rotateSpeed` was the untouched default 1.0, now a
  named `ORBIT_ROTATE_SPEED = 0.4`.
  **No Playwright coverage, deliberately**: the browser harness's mock API
  refuses `openWorld` and two specs assert `world-viewport` has count 0, so
  there is no WebGL scene to raycast and a spec there would pass without
  touching camera navigation. Jest covers the pure `pivotAt`, including that
  `camera.matrixWorld` is unchanged after the pivot moves — the assertion that
  catches an off-axis regression.
- **The world picker starts where the worlds are.** `world:openDialog` now
  passes the extracted `_work/Data/Worlds` when it exists, the install root
  otherwise, nothing when no install is stored. Retail keeps worlds inside
  `Worlds.vdf`, which a picker cannot browse, so the install root is the best a
  retail install can be offered. `setupIpcHandlers` is exported as the test seam.
- **The harness can fail on ASCII.** `lib/container-ascii.js` walks the
  `zCArchiverGeneric` stream and `containerFromBuffer` dispatches on format, so
  it no longer answers `covered:false` for the very format under test; the
  MeshAndBsp blob is consumed by declared length, because it contains `0x0a`
  bytes and a line walker desyncs inside the mesh. 28 of 28 `.zen` in a retail
  install parse, gap 0, 0 threw. `tools/bytediff.js` picks its walker from the
  header. `roundtrip.test.js`'s three-way `assert.ok` — the whole outcome space,
  which would have stayed green through both a full fix of A1–A4 and a
  regression back to the 0xC0000409 abort — is now an exact status plus a
  `--strict` run asserting exit 1, and says in capitals that a fixed writer must
  turn it red. A1 is pinned byte-exactly (the raw section hashes the hex *text*,
  so the corruption cannot hash into agreement) and A4 by the verbatim `objects`
  line, 9 wide against ZenKit's 11. `README.md` and `tools/README.md` both
  asserted the container section was BinSafe-only and were corrected in the same
  change.
- **Class properties, increment 1 — the item instance and the light.**
  `oCItem.instance` and `zCVobLight`'s `range`/`color`, 23.4 % of the 41,393
  retail VOBs, all the way down: `getVobProps` exporting the reader
  `normalizeWorld` already had, `setVobClassProp` in the binding, the
  `SetVobClassProp` op, the
  `CLASS_FIELDS` catalogue the builder/validator/grid all read, the
  `world:vobProps` IPC, and the grid's class section. The validator branch
  landed **in the same change** as the op, which is the whole lesson
  `ReparentVob` left. Decisions and what is deliberately out are in plan §7;
  §14.1 row 1.4 is now *partial*. Two things noted and not fixed: the class
  re-fetch is unconditional, so a gizmo drag on a light flashes the section's
  loading line, and **no engine verdict covers a class-edited world** —
  `verify-world-edit.js` does not yet set an instance or a range on NewWorld,
  which is Gate 2's business and plan §14.1's follow-up, not a landing gate.
- **Gate 2 — the engine verdict for a UI-edited world.** Four candidates run
  through both Spacer2 and Gothic2 (`zenkit-node/docs/engine-acceptance-2026-08-25.md`
  §8, 2026-08-27 run): all clean loads, no captured assertion, `03-ui-edited.zen`
  (built through the real editor UI) the headline result — the first engine run
  of a world the app itself edited, carrying `MoveVob`/`RotateVob`/`SetVobProp`/
  `AddVob`/`ReparentVob` and a retail VOB's re-fitted bounding box. Rows 7–9
  (bed/chest/mobsi, sound/zone trigger, savegame round-trip) recorded passed on
  Daniel's word; the record notes the wall-clock doesn't independently
  corroborate the depth of that exercise, so revisit there first if either op
  set is later found to disagree with the engine.
- **The waypoint gizmo — the UI for an op that had none.** Picking a waypoint
  out of the overlay, the gizmo on it, the drag, the live preview, the commit,
  undo/redo, and `expectedWaypointMoves` in `verify-world-edit.js` moved from 0
  to 1. Driven end to end against NewWorld: one waypoint differs in the saved
  file, `TOT`, position only, and the edges are unchanged.
  Four things the shape of the waynet decided rather than the gizmo:
  **one gizmo means one selection** — `selectedWaypoint` is never held beside
  `selection`, because the mode keys, the property grid and the Delete VOB
  button all follow the latter; **the pick is a projection, not a raycast** —
  `THREE.Points.raycast`'s threshold is world units and the overlay is
  `sizeAttenuation: false`, so `pickWaypoint` projects all 2,959 and measures
  in pixels, which is affordable once per click and would not be per frame;
  **the waynet is picked before the VOBs**, because `depthTest: false` means a
  dot plainly on top would otherwise select the wall behind it; and **the
  preview destroys the `from` the op needs** — every other op reads `from` out
  of the columnar index, which the preview never writes, but the point cloud
  and the edges share one array, so the viewport carries `from` up from the
  press and the shell writes it back before calling `moveWaypoint`.
  `applyWaypointPositions` is no longer dead: it is called once, in `applied`,
  which is the same path undo and redo take.
  One wart found and fixed in passing: hiding the overlay left the gizmo
  standing — and draggable — on a waypoint nothing was drawing.
- **`DeleteVob` — the first op that ships without an inverse.** The op, the
  validator branch, the history barrier in `WorldService.applyOps` (both stacks,
  after the worker confirms), the confirm dialog that says the undo history goes
  with it, and end-to-end coverage in `verify-world-pipeline.js` against
  NewWorld — the last root took its whole 4,460-VOB subtree with it and the
  history came back empty. Not an `AddVob` with a null `to`: that shape means
  "the op describes this VOB completely", and reusing it would have made the
  undo of a deleted `oCMobInter` look like it worked. Written up as the plan's
  "The delete, and the barrier that replaces its inverse". A third dispatch
  nobody had listed turned up in the World surface — `commitOps`' catch inverts
  the batch to put the viewport's optimistic draw back, and threw on a refused
  delete.
- `MoveVob`, `RotateVob`, `SetVobProp` — gizmos, multi-select, property grid.
- `AddVob` — terrain placement, at the roots or under the selected VOB.
- `ReparentVob` — drag onto a row, or between rows at a chosen slot.
- Dirty-world save; undo/redo across all of it.
- `colorAniList` — the byte-diff's last differing field is closed. The asymmetry
  was ZenKit's; `patches/0023` emits an `r == g == b` element as the greyscale
  scalar ZenGin writes. The fixture had no light at all, so it gained one.
- The patch series is triaged for upstreaming — `zenkit-node/patches/README.md`.
  15 as-is, 7 needing a rationale and a fixture, `0017` ours forever, and the
  three places where the numbering hides an ordering dependency.
- `scripts/verify-world-render.js` — the screenshot, promoted to a driver that
  fails on its own when the winding fix is reverted.
- **The addon caught no ZenKit exception at all** — `binding.gyp` inherited
  node-gyp's `_HAS_EXCEPTIONS=0`, under which MSVC aliases `std::exception` to
  `stdext::exception` and never declares the real one, so all ~20
  `catch (std::exception const&)` in `binding.cc` named a type no ZenKit
  exception derives from and there is no `catch (...)` anywhere. A `ParserError`
  found no handler, `std::terminate` → `__fastfail` → **0xC0000409 on any
  malformed or truncated world**, taking the editor's `zenkit.worker` with it.
  Proved with two probe executables differing only in that define, then fixed
  with `defines!` and a `_HAS_EXCEPTIONS=1`. It also silently changed the base
  class of `zenkit::Error` inside the binding's TUs — an ODR violation on top of
  the missed catch. Pinned by `test/loadWorld.test.js`, which is the only test
  here that makes **ZenKit** throw rather than the binding.
- **`MoveWaypoint` — the first op that is not about a VOB.** Binding
  (`setWaypointPosition`, with `CollectWaypoints` as the single definition of
  what a waypoint index means), the op and its inverse, the validator branch, the
  worker and store partitions, and end-to-end coverage in
  `verify-world-pipeline.js` batched with a VOB move. No UI: the waypoint gizmo
  is its own slice (Next).
  Three things the design brief got wrong and the code settled:
  **the dispatch tails were three, not one** (`applyOps`, `writeOp`, `invertOp`
  — `invertOp`'s was accidentally *correct* for a waypoint move, the most
  dangerous of the three), they now end in a `never` refusal; **`applyOps`'
  trailing `else` did not write `positions[NaN]`** — a `Float32Array` drops a
  write at a NaN index, so nothing moved and the caller was told a VOB had; and
  **the mandatory layer was three layers**, because `zenkit.worker.ts` and
  `worldStore.ts` both routed a non-structural op into `applyOps`, where the
  refusal would land *after* `commitOps` had already changed the world.
