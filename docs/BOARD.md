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

- branch `master`, **pushed to `origin/master`.** `feature/level-editor`
  was merged and is no longer where work happens. A push is not a release —
  see the merge note below.
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
  not this one. The release-gate gaps that used to be named here are **all
  closed** — the addon is asserted present and unpacked, and the packaged app
  now opens a world in CI. What a dispatch would still ship unproven is in Next:
  three ops with no engine verdict, and a packaged renderer nothing has watched
  draw.
- **The addon and the vendored ZenKit were both rebuilt this session**, so every
  other machine and CI must rebuild — and here it is `vendor-build/` too, not
  just `build/`: patches `0024`–`0026` change `ArchiveAscii.cc`, `0027` changes
  `World.cc`, and `src/fixture.cc` gained a decal and then, this
  session, five sound and zone VOBs. `binding.cc` changed again after that for
  the `bool`/`int` kinds — `vendor/` did not, so that rebuild was `npx node-gyp
  rebuild` alone. Run **`node scripts/build-zenkit.js` before
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
- **`binding.cc` changed again for the measured bounds**, so the addon was
  rebuilt once more (`npx node-gyp rebuild` alone — `vendor/` did not change),
  and `zen-world/dist` with it. `daedalus-dialog-editor/dist/` also holds a
  **freshly packaged app**, built after those rebuilds and used to verify the
  open-world smoke; it is `.gitignore`d and only matters if you are about to
  trust a package that is already sitting there. Do not rebuild the addon while
  a package is being written — see `environment-hazards.md`.
- **Nothing else needs rebuilding on this machine.** On another, or after any change
  to `coords`, `binding.cc` or anything `zen-world` exports:
  `cd zenkit-node && node scripts/build-zenkit.js && npx node-gyp rebuild`, then
  `pnpm --filter zen-world build`. `verify-world-edit.js` drives the *built*
  renderer, so it needs the full `pnpm --filter daedalus-dialog-editor build`,
  not `build:main`.

---

## Now

*(empty — five cards landed this session plus one diagnosis that closed a
card by answering it rather than by changing code; see Done)*

## Next

- **Nothing has watched the packaged renderer draw.** The addon half is closed
  (Done): the packaged app opens a world in CI, so `npmRebuild: false` rests on
  a runtime verdict rather than on a reading of `binding.gyp`. But that smoke
  never creates a window — it opens the world through `WorldService` and exits.
  So a packaged build in which the World surface renders nothing, or throws on
  first paint, would pass every gate there is. Closing it needs a driver rather
  than an env var, which is why it is a different job from the one just done.

- **Three shipped ops have no engine verdict.** `DeleteVob`, `MoveWaypoint` and
  `SetVobClassProp` all landed after candidate `03` was built, so Gate 2 covers
  five ops — `MoveVob`, `RotateVob`, `SetVobProp`, `AddVob`, `ReparentVob` — and
  not these. The acceptance record now says so itself, under **"Not run and not
  claimed here either"** in its Gate 2 section; it did not before, and this
  card cited a line range that said nothing of the kind. Say "Gate 2 passed for
  the ops it tested", not "Gate 2 passed". A removed subtree is still the edit
  ZenGin has the most room to disagree about. **The `oCItem.instance` half of
  this card is closed** (Done): the name a `SetVobClassProp` writes is now
  checked against the parser's item index, so a typo cannot reach a save — but
  that is a check, not a verdict, and no engine run covers any of the three ops.
  **Increment 2 widened this rather than closing it**: five more classes are
  editable (Done), and a sound or a fog zone written wrongly is *invisible in
  the viewport* — the first edits whose only witness is the engine.
  `verify-world-edit.js` sets no class property at all, so a rebuilt candidate
  would have to grow one before it is worth building. **Whether that rebuild is
  worth doing is Daniel's call, not something to do unasked** — it costs a
  staged candidate and two engine passes.
- **Phase 1b-2, class-aware editing — the classes that are left.** Seven classes
  are editable and the catalogue now has five kinds (Done), so the kinds card is
  closed and the class list is the constraint again. Left: the trigger family,
  `oCMob*`, `zCPFXController`, `zCVobAnimate` — each still one C++ case plus one
  `CLASS_FIELDS` entry plus its tests.
  Held out by decision rather than by time, and **enums are now the whole of
  it**: `mode`, `volumeType`, `zCMover.lerpMode` and their kin, where retail
  carries out-of-range values a dropdown destroys. Enums are also what is left
  of the "legal writes the engine ignores" card — `randomDelay` /
  `randomDelayVar` are read only when `mode` is RANDOM, and `mode` is precisely
  what cannot be set. Also out: `isStatic` and anything else changing *which*
  fields the archive contains, list fields, and base-`zCVob` widening (§14.1
  item 1.8). Alongside and independent: class-specific *insertion* (item 1.3 —
  `insertItemVob` is in the binding and wired to nothing), copy/paste (1.2).
  Numeric transform entry (1.5) is **landed** now that rotation joined position,
  bar the multi-selection decision; snapping (1.6) is still **half landed**.
  Both have their own cards below. Still before Phase 1c in §11.

- **Typed rotation landed, and what is left of it needs Spacer and a UI
  decision, not code.** The three fields are in (Done) and the quiet-corruption
  trap is handled per angle, so the 30.2 % of retail VOBs that are
  non-orthonormal are not re-orthonormalized by a commit nobody made. Two
  things stayed open on purpose:
  **Absolute or delta for a multi-selection.** The fields are hidden for N VOBs
  rather than guessing. Single selection is absolute
  (`rotateVob(..., eulerToZenRotation(typed), bounds)`); N VOBs would be
  `multiplyRotation(target, invert(current))` and is a UI decision, not a
  derivation.
  **Spacer parity is still unmeasured.** Nothing in the format, in ZenKit or
  here commits to an Euler order, so Y-X-Z was chosen on retail singularity
  counts (464 VOBs on XYZ's against 53 on YXZ's), not on a match to Spacer.
  Settling it needs Spacer itself — type an angle, save, read the matrix back.
  If it turns out different, only those two functions and their tests change.
  One thing users will see and may report as a bug: displayed angles are
  canonical — yaw/roll in (−180, 180], pitch in [−90, 90] — so a field
  committed at 190° remounts as −170°, and a pole pose remounts with roll 0.
  Both correct, both look like the editor changing their number.

- **Snapping — drop-to-ground and align-to-normal.** Grid step and angle step
  landed (Done). The two that are left are **not** blocked on a raycast, which
  is the thing worth knowing: the world mesh has a BVH. They are blocked because
  both are *per-VOB* answers — each VOB finds its own ground, its own normal —
  while `translateVobs`/`rotateVobs` take **one** delta for the whole selection.
  Doing them means a per-VOB op-building path, the second one this area has
  refused to grow since Phase 1b began. Align-to-normal additionally has to
  decide which axis of a visual is up, the same question that keeps a placed VOB
  at `IDENTITY`. Open and unacted: whether a *typed* coordinate should snap too
  (it does not — a typed number is an explicit destination).

- **Every remaining catalogue bound rests on documentation, and one of those
  was wrong.** The two unmeasured bounds are closed (Done), but the way they
  closed is the card: the sweep that settled them also found `zCVobSound.volume`
  shipping `max: 100` on ZenKit's "percent (0-100)" wording while retail
  NewWorld holds 130 and 150 — the grid, the validator and the binding were all
  refusing values the game itself ships. **So a bound taken from ZenKit's docs
  rather than from a `normalizeWorld` sweep is a live refusal risk, not a
  cautious default.** `coneAngle` 0–360 and the two daytime hours 0–24 are the
  ones still standing on documentation alone; neither has been swept, and the
  sweep is cheap now that the script exists.

- **Waynet editing — the edge ops, and add/delete/rename.** The gizmo landed
  (see Done), so the one op that exists is now reachable; nothing below is.
  **The addressing problem is the whole job and it is untouched.**
  `MoveWaypoint` addresses a waypoint by its index into the list `getWaynet`
  emits, and that is safe only because a move inserts, deletes and reorders
  nothing. Every op left here breaks it, and names cannot be the fix — nothing
  in the format promises they are unique, which is why the binding matches edge
  endpoints by pointer identity. **Retail happens to have no duplicate** — 24
  worlds, 12,341 waypoints, 0 collisions even case-insensitively, measured while
  sizing the jump card below — but that is a fact about the shipped data, not a
  guarantee about a world somebody edits, and an *op* that persists an address
  needs the guarantee. The jump card can key on names precisely because a jump
  is read-only.
  The edge ops keep their original hazard: `free_point` is not a stored field,
  and `WayNet::save` writes only free points plus edge endpoints, so a non-free
  waypoint in no edge is dropped at save. Removing a waypoint's last edge
  therefore deletes the waypoint, which is why an edge op is not invertible as an
  edge op. Waypoint delete has a bounded version of the arbitrary-VOB-delete
  trap — a `WayPoint` is five scalar fields, so what an op cannot describe for
  free is its edge memberships, and those are an enumerable list.
- **Jumping between a script reference and the place it names — Daniel's idea,
  now sized.** The core claim survived: **nothing in the parser records a
  waypoint-name string literal as a reference**, and that index, not the camera,
  is the job. `cross-references.ts` knows exactly two reference kinds and
  returns no file, line or column at all — it exists to serve rename/remove, so
  it is the right *shape* and the wrong *payload*. The camera is nearly free:
  `frameVobs` takes `bounds: null` for "a point rather than a thing with a
  size", and waynet positions are already ZenGin centimetres.
  **Four things the card said were wrong, and the fourth changes what to
  build.** The jump is at `WorldSurface.tsx:193-198`, not `:158`. `start_aiwp`
  does not exist in the G2 MDK — the field is `C_Npc.wp` (plus `spawnPoint`),
  literal-assigned in 2 places in the whole corpus. There is **one** request
  prop, not two: `frameSelection` is a closure inside the scene effect, so a
  waypoint jump is the *second* prop — still exactly the trigger the
  imperative-handle note names. And the card listed the three least-used
  carriers: measured over the MDK's 1,725 `.d` files, `AI_GotoWP` has **6**
  literal waypoint sites against the `TA_*` daily routines' **6,223**. The
  routines are the feature; the interesting question a level editor answers is
  where an NPC stands at 08:00.
  **The extractor should not hardcode a call list.** 58 `TA_*` functions declare
  a parameter literally named `var string waypoint`, so the rule is derived from
  the project being edited — map a function to the index of such a parameter,
  then read the literal at that position. Only the engine externals
  (`AI_GotoWP`, `Npc_GetDistToWP` and ~4 more) need a seed table, and that set
  is closed. The one genuinely new parser capability is exposing function
  **parameters**.
  **The duplicate-name decision is answered by measurement: don't design for
  it.** 24 worlds, 12,341 waypoints, **0 duplicate names**, not one even
  case-insensitively. Build the lookup multi-valued anyway (it costs nothing),
  jump to the first, and spend the effort on the real residue instead: 98.0 % of
  the 6,529 literal sites resolve against all 24 worlds but only 84.3 % against
  the three main ones, so the UI must distinguish "no such waypoint" from **"not
  in *this* world"** or it will lie about the largest cluster of references in
  the corpus. Names are unsafe as a persisted identity and perfectly safe as a
  *query* — a jump is read-only, so `MoveWaypoint`'s index-addressing hazard
  does not apply.
  **Phasing, and the half worth doing first is the back-direction.**
  W1 the index (medium — needs the parser change, and line/column must survive a
  path that today keeps only `node.text`); **W2 world → scripts (small-medium,
  and the one to land first)**: click a waypoint, see the routines that name it.
  It needs neither inherited decision, no viewport refactor and no new
  navigation model, and it delivers a Problems rule — 128 dangling waypoint
  sites — for free. W3 the imperative handle (small, ~60 lines net negative; do
  it immediately before the caller that justifies it, not earlier). W4 script →
  world is **large**, and not for the camera: it needs the two blockers below.
  Note a selected waypoint has **no UI at all** today, so W2 builds a panel from
  nothing rather than extending one.
  **The trap that would make W1 silently wrong**: an index built off
  `mergedSemanticModel` is capped at `PARSED_FILES_CAP = 512` against the MDK's
  1,725 files, and *which* files depends on the selected NPC — wrong by
  construction and non-deterministically so. It has to ride
  `buildProjectIndex`'s worker-pool pass, exactly as `voiceIds` does. Also:
  free points (`WP_STAND`, `WP_PICK`, …) are prefix-matched by the engine, so a
  strict exact-match Problems rule invents ~60 false findings.

- **The World surface loses its geometry when you navigate away from it.**
  Found while sizing the card above; pre-existing, unowned, and a hard
  prerequisite for that card's W4. `MainLayout.tsx:189` renders `<WorldSurface>`
  under a *conditional*, unlike the dialog view which is deliberately kept
  mounted by a display toggle. `mesh`, `visuals` and `waynet` are local
  `useState` filled only inside `openWorld`, and there is no mount-time refetch
  — so leaving the World view and returning leaves `mesh === null`, the viewport
  guard renders nothing, and the world looks closed while `worldStore.status`
  still says open. The fix is a decision nobody has taken: keep tens of MB of
  buffers mounted, or refetch on mount and pay the latency.

- **What is left of the ASCII writer — A2, A3 and A6.** A1, A4 and A5 landed
  (Done), and the corpus now measures all 20 retail ASCII worlds instead of
  crashing on them. They classify **`semantic-drift`** in two findings across
  all 20.
  **Read the finding counts below as quotas, not totals.** A non-`--drill` run
  kept only the first 20 findings per world, which is why "400 findings, 396 of
  them A6" looked so tidy — it was 20 worlds times the cap. The report says so
  now (Done), and the numbers here have been re-taken under `--drill`.
  - **A6 — `physicsEnabled` is dropped on every save, 43,341 of the 43,469
    findings a `--drill` run reports, and it is not an ASCII defect at all.**
    (It was "396 of 400" while the cap was silent; it fires on essentially every
    VOB, which is what filled every world's quota.) `VirtualObject.cc:251` writes packed
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
  - **`animMode` is diagnosed, is not 4 VOBs but 128, and needs no patch.** It
    is retail garbage meeting a representational narrowing, not a writer defect.
    130 `oCMobContainer` chests across 19 of the 20 ASCII worlds store a
    heap-pointer-shaped `visualAniMode` — 145264232 (`0x08A8B0E8`) on 128 of
    them — which Spacer serialized from an uninitialised member. ZenKit narrows
    it twice: the load truncates uint32 to uint8 because `AnimationType` is
    `: std::uint8_t` (`VirtualObject.cc:159`, `VirtualObject.hh:67`), giving
    145264232 mod 256 = 104; then the packed writer masks to two bits
    (`:255`, `& 3`), giving 0. Hence `104 vs 0`, and hence the two values ≡ 0
    mod 256 that drift invisibly. **The editor's BinSafe save path is not
    affected** — the opposite of A6: a packed reader can only ever produce 0–3
    and `& 3` is the identity there, measured as 0 findings across all four
    BinSafe worlds. No packed-path fix exists even in principle, since the
    format has two bits for the field; a byte-faithful fix would need
    `AnimationType` widened upstream *and* the unpacked writer resurrected,
    which is blocked behind A2 and A3 below.
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

- **`3221226505` is still unexplained, and the worker-handle warning was not
  it.** The warning is closed (Done) — it was a referenced timer in
  `FileWatcherService`, and the hypothesis chain that ran through
  `ParserService` is finished. But 25 full editor runs while closing it all
  exited 0, so the intermittent `3221226505` that `test:matrix:windows` exists
  for **did not reproduce at all today** and has no shared cause with the
  warning: `0xC0000409` is a native `__fastfail`, and a jest-worker force-kill
  is `SIGTERM`/`SIGKILL`. The board's own guess that they were the same handle
  is disproved. What is left is a native abort with no reproduction, and the
  first suspect is the addon, not Jest.

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
    entry if it grows. Sized since (the waypoint card above, W3): small, ~60
    lines net negative, the closures already exist and `frameVobRef` is already
    a ref. The one hazard is that the handle is only alive while the scene
    effect is, and that effect re-runs on `[mesh, visuals, bbox]` — a jump
    requested during a rebuild must be a no-op, not a crash.

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
- **The VOB outline needs Daniel's eyes, the same way the pivot does.** It
  landed (Done) and two things in it are unverifiable without a GPU: that the
  injected GLSL compiles at all — jsdom has no WebGL, so a shader-link error
  would surface as black or missing props at runtime, not as a red test — and
  whether `OUTLINE_DARKEN = 0.7` / `OUTLINE_POWER = 4` is the right faintness on
  retail NewWorld. Both constants are named in `WorldScene.ts`. Also unjudged:
  how it reads on alpha-tested foliage and on blended VOB materials, which get
  the term uniformly by design (a face-on billboard is untouched; an edge-on one
  dims slightly).

## Done — Phase 1b

- **The packaged app opens a world before a dispatch ships it.** The release
  gate asserted `zenkit_node.node` was packaged and unpacked, which is a claim
  about a file. `DDE_SMOKE_OPEN_WORLD` now routes `whenReady` into a windowless
  open through `WorldService` — the same call `world:open` makes, so the worker
  spawn, the `app.asar.unpacked` dlopen and the summary all run as they would
  for a user. Verified against a real package here in both directions: exit 0
  with `{"ok":true,"vobCount":5,"worldTriangles":2}`, and exit 1 naming the
  missing module when the addon is renamed away.
  **The finding that cost the time is not in the feature.** The first package
  built here was corrupt and the app exited 1 in 220 ms with no window, no
  output and no event-log entry — indistinguishable from a main-process bug. A
  `node-gyp rebuild` in one agent's tree had landed inside another agent's
  packaging window. `environment-hazards.md` has the rule and the cheap test
  (extract `package.json` from the asar and parse it).

- **Two guessed catalogue bounds get measured, and a third turns out to have
  been refusing retail data.** `innerRangePercentage` is 0..1 — every value
  across the three worlds in [0.1, 1.0], world-defaults at exactly 1.0, where
  ZenKit's docs say "Unknown". `oCZoneMusic.priority` keeps `min: 0`, now
  measured: 62 music zones, 0 through 30, no negative. `reverb` stays unbounded
  and the sweep says why — every retail value is negative, −10 to −3.219. The
  third is the one worth remembering: `zCVobSound.volume` shipped `max: 100` on
  ZenKit's "percent (0-100)" wording, and retail NewWorld holds 130 and 150.

- **A refused edit stops sticking, and rotation becomes typeable.** The refusal
  generation is a rule now — bumped in `commitOps`'s catch, folded into every
  editable field key — so position, name and visual are corrected by the same
  mechanism the class properties already were, with no scheduling coincidence
  under it. Sabotage-verified. Typed rotation then rides on it, refusing a no-op
  per angle so the 30.2 % non-orthonormal VOBs are not silently
  re-orthonormalized; the equality check has to compare the *displayed* rounded
  number as well as the decomposed one, since a field reading "30" can be
  30.000000000000004 underneath.

- **The finding cap stops passing for a total.** A non-`--drill` corpus report
  kept the first 20 findings per world and said nothing about it, so a quota
  read as a total and put a wrong number on this board. Rows carry
  `findingTotal` and `findingsTruncated`, and the summary says "N findings, 20
  shown (--drill for all)". The cap and `--drill` are unchanged.

- **`animMode` is diagnosed, and the answer is that nothing should be done.**
  Retail garbage — 130 chests carrying a heap-pointer-shaped `visualAniMode` —
  meeting a uint8 enum and a two-bit packed field. Not 4 VOBs but 128, and the
  editor's BinSafe save path is provably unaffected. The Next card carries the
  mechanism; no patch, and the reason a patch cannot exist.

- **The item instance stops being free text.** `oCItem.instance` is the only
  class field whose value is a name in *another file*, and one no script
  declares crashes ZenGin when the item spawns. The grid now refuses a name the
  loaded project does not declare, through the same route a value out of bounds
  already takes: nothing is sent, no op is built, and the field remounts showing
  the world's own value.
  **Where it could *not* go is the durable finding.** The main process holds no
  item index and is not one round trip from having one — `ProjectIndex` carries
  NPCs, dialogs, routines and voice ids and *no instances at all*, and
  `ProjectService.primedModels` is a **take-once** hand-off cache of per-file
  models, emptied as it is read and deliberately not a copy of the renderer's.
  And even with an index it could not be a hard refusal: a world may be edited
  with **no script project open**, and the renderer's own index is empty until
  ingestion has merged the item files — so an empty index has to mean "nothing
  is known", never "nothing is legal". What `assertApplyOpsRequest` *can* say is
  the shape, and it now does: a `to.instance` that is not a Daedalus symbol is
  refused there. `from` deliberately is not — it is the value the world already
  holds, and refusing it would block the one edit that repairs such a VOB.
  **Daedalus is case-insensitive and the parser keys `items` by the name as it
  was written**, so the fold happens on both sides; each side has its own test
  and each was verified by breaking one fold at a time.
  Autocomplete was looked at and left out with a reason (plan §7):
  `VariableAutocomplete` calls `onChange` per keystroke where this grid commits
  on blur, so reusing it as-is would build an op per character, and its "Add …"
  affordance offers to author a Daedalus symbol from the level editor. A
  `<datalist>` on the existing input is the cheap version if it is ever wanted.

- **A `bool` kind and an `int` kind, and the nine fields they unblock.** The
  catalogue's three kinds were the constraint; now there are five, and the class
  list is the constraint again. `int` is deliberately not a `float` with a rule
  attached — a `float` whose archive member is `int32_t` truncates on the cast in
  C++ and *reports success* — so the two are separated at the type, and the grid,
  the IPC assertion and the binding each read `kind`. Booleans assign on
  `.has_value()`, never on truthiness.
  **The fog pairing was closed by ordering alone**: catalogue order is draw
  order, so `overrideColor` is now immediately above `color`, pinned by a test in
  both packages. Deliberately *not* done — greying the colour out when the flag
  is false, or making a colour write imply the flag: the grid has no cross-field
  logic anywhere, and an op setting a key nobody edited builds an inverse
  restoring a value nobody edited.

- **Typed angles get a conversion, and every decision in it is measured.**
  `zenRotationToEuler` / `eulerToZenRotation` in `zen-world/coords`, domain only.
  Four decisions, none asserted: **the order** is intrinsic Y-X-Z because 464 of
  41,393 retail VOBs sit on XYZ's singularity against 53 on YXZ's — and the
  report says plainly that this is *not* a claim of Spacer parity, which nothing
  available here can check. **The pole** takes roll to 0 with no near-pole
  epsilon, because a naive one discards a recoverable roll at 8.5e-4 of matrix
  entry, four orders above tolerance. **Tolerance** is 1e-6 from float32 ulp
  arithmetic, with a measured worst case of exactly one ulp over 200k poses.
  **Non-orthonormal matrices** are normalized rather than refused because 30.2 %
  of retail VOBs are non-orthonormal — drift, not scale, and refusing would take
  typed angles from a third of the world.
  The consequence is a trap and it is in Next: because the read normalizes, a
  no-op commit rewrites bytes for that same 30 %.

- **The gizmo snaps, and an uncontrolled input stops keeping a refused value.**
  Grid step and angle step, quantising the *delta* — consistent with the typed
  coordinate, and for rotation there was no alternative until this same batch
  landed the conversion. One `snapProxy()` on the proxy everything downstream
  already reads, so the step is applied once and not in four places.
  **The bug it exposed is the durable half, and it was measured rather than
  guessed.** Adding a toolbar `Select` broke a class-property test; instrumented
  renders showed the re-read's `setClassProps(null)` and the fetch's
  `setClassProps(props)` collapsing into one render, so the section never
  unmounted and the key never changed. Bisected to a bare `<TextField select>`
  at HEAD — the two `useState` calls are innocent; MUI's `SelectInput` schedules
  its own update from a ref callback during commit and changes when React
  flushes. So the correction of a refused edit **depended on React committing an
  intermediate state React never promised to commit**. `setClassProps(null)` now
  happens in `commitOps`'s catch, before the re-read is issued. The worse
  instance — position, name and visual, where there is no unmount at all — is a
  live bug and is in Next.

- **Five more classes became editable — the two sounds and the three zones.**
  Increment 2 of Phase 1b-2, and the increment that showed the catalogue's three
  value kinds are now the constraint rather than the class list (its card is in
  Next). `zCVobSound` and `zCVobSoundDaytime` share **one** C++ case, because the
  daytime sound derives from `VSound` and inherits its four members; the
  catalogue entry spreads the base list for the same reason.
  **Two claims of increment 1 got their first real test and both held.** Reading
  needed no change at all — `GetVobProps` is `normalize.cc`'s `BuildProps`, which
  already emitted every one of these keys — and `assertApplyOpsRequest` needed no
  change either, because its `SetVobClassProp` branch is catalogue-driven; its
  six new cases were added anyway, since the board's own warning is that the
  validator is the layer every test mocks past. The property grid needed nothing.
  **The fixture VOBs went into `BuildVisualVobTree` only**, the mesh-extraction
  variant, so `minimal.g2.zen` and its golden dump are untouched and no
  `fixtures:regen` was needed. `VZoneFarPlane`'s two floats have **no default
  initializer in ZenKit at all**, so a fixture that left them alone would have
  round-tripped stack garbage.

- **A brightness for the viewport, and nothing for the world.** The interiors
  card, answered the way it predicted: ZenGin's light is baked into the vertex
  colours and the material is `MeshBasicMaterial`, so the fix is a multiply, not
  a lamp. One shared uniform object per `WorldScene`, injected as
  `outgoingLight *= uExposure` before `#include <opaque_fragment>` — after the
  texture, the baked colour and the VOB outline — and `setExposure` writes that
  one object: no recompile, no `needsUpdate`, no per-frame work. The **world
  mesh** got the hook too, which is the point: interiors are walls and walls are
  world mesh, so a control that skipped it would light nothing that is dark.
  The outline card's `customProgramCacheKey` trap is preserved and re-documented
  — the two hooks must stay *textually* different, the default key being
  `onBeforeCompile.toString()`.
  **It falsified a neighbouring assertion, which is the durable part**: the
  outline test asserted the world-mesh material compiles the stock fragment
  shader untouched, and that is exactly what this change makes false. It now
  asserts the narrower thing the test was always about — no `vVobNormal`, no
  outline mix. And the viewport effect carries `mesh`/`visuals` in its deps for
  the third time in this file's history: a structural op builds a fresh
  `WorldScene` that starts at 1, so without them a placement snaps the
  brightness back.

- **Typed coordinates in the property grid.** §14.1 item 1.5, the position half.
  Three fields on the existing `EditableField`, so blur/Enter/Escape and the
  value-in-the-key remount are the rules the name, visual and class fields
  already proved.
  **A typed coordinate leaves as a *delta*, not a destination**, through
  `handleTranslateSelection` → `translateVobs` → `commitOps` — the gizmo's own
  path, so undo, the atomic batch, the history barrier and the refusal-unwind
  are the proven ones and there is no second op-building path to keep in step.
  The consequence is deliberate and is the decision worth remembering: a typed
  coordinate moves a *multi*-selection by that delta and keeps its spacing,
  exactly as a drag does, where an absolute would stack the selection on one
  point. Refusal happens **before** an op exists — anything that is not a finite
  float32, and any value numerically equal to the one already there, remounts the
  field showing the world's own number and never reaches the undo stack. Not
  disabled during a gizmo drag, because a pointer-captured drag and a focused
  text field are mutually exclusive input states and there is no keyboard drag.

- **The addon is in the release gate, and in the installer.** Two gaps, one
  dispatch away from being discovered by shipping a World button with nothing
  behind it. The gate: `all-tests.yml` gained a `zenkit-node-tests` job running
  `zenkit-node.yml`'s recipe unchanged, and `zenkit-node.yml` is now
  `workflow_dispatch:` only — its path filter to `zenkit-node/**` *was* the
  hole, because a change in `zen-world/` or `zenkit.worker.ts` that breaks the
  binding contract lives outside it. The installer: `ZENKIT_NODE_FORCE_BUILD=1`
  in the release install (that install is the only chance — `install.js` skips
  the source build under `CI` and `npmRebuild` is `false`), `asarUnpack` for the
  addon, and the packaged-app verifier — which knew only about `safe-buffer` —
  now asserts both silent failures: never built, and built but left inside the
  asar where `node-gyp-build` cannot `dlopen` it. Both branches were exercised
  against a real `electron-builder` run, not just written.
  **Two things nobody had written down.** The `build` job's checkout had no
  `submodules: recursive`, so forcing the build alone would have failed on
  absent ZenKit sources. And once the addon actually ships, electron-builder
  packs **90 MB** of vendored sources and CMake scratch with it — including two
  `CompilerIdCXX.exe` it then code-signs; the new file exclusions bring that to
  1.6 MB. `zen-world` joined `onlyBuiltDependencies` and got an explicit build
  step in the two jobs consuming its `dist`, so `--ignore-scripts` fails on that
  line rather than as an unresolvable import three steps later.

- **The worker that would not exit was holding a suppression mark.**
  `FileWatcherService.notifySelfWrite` armed a *referenced* two-second timer per
  call and cleared none, so its Jest worker ended the file with six live timers
  and jest-worker force-killed it 500 ms later. `.unref()` is the whole fix, and
  **it matters in production too**: each call pinned the Electron main process
  for two seconds, so a quit within two seconds of a save was waiting on a
  suppression mark.
  **The durable finding is that the card's own next step could not have
  worked.** `--detectOpenHandles` implies `--runInBand` — no workers, so the
  warning cannot occur; it is a dead end by construction for this class of bug.
  What found it was a preload in every worker watching jest-worker's message
  listener count hit zero (its `exitProcess()` removes the listener and never
  calls `process.exit`) and dumping `async_hooks` resources with creation
  stacks. **And the bisect misleads**: the trigger is *files per worker*, not
  which files — each half of a 2-way shard ran clean at 23 workers and
  reproduced at 4. Ratios: default 4/5 → 0/6, `--maxWorkers=8` 4/4 → 0/4.
  A second real leak was fixed alongside it and was *not* the cause (4/5 → 5/6
  measured alone): `ParserService.dispose` and `MetadataWorkerPool.terminate`
  fired `worker.terminate()` without awaiting, so a test file could end with a
  live thread — one `MessagePort` held 5.3 s. Both return promises now.

- **A VOB stops disappearing into the world mesh.** The faint outline Daniel
  asked for, drawn by *not* drawing one: an inverted-hull or edge-line shell is
  a second `InstancedMesh` per visual, 724 more draw calls a frame in the
  viewport that exists to keep per-frame work off the CPU. Instead the VOB
  materials, and only they, share an `onBeforeCompile` darkening outgoing light
  as the surface turns edge-on. `MeshBasicMaterial` and baked vertex colours are
  no obstacle — the term multiplies *after* texture and baked colour, adds no
  light source, updates no uniform. One module-level hook, so
  `customProgramCacheKey` folds every VOB material onto one program while the
  world mesh keeps its own. `abs()` on the facing term because the mirrored root
  flips the normal's sign; a signed one outlines the front faces instead.

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
