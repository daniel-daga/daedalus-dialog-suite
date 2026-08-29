# Environment hazards

Things about **this machine and this toolchain** that have cost real time, and
that no test will tell you about. They are stable — they were true last month
and they will be true next month — so they live here instead of being retyped in
every handover.

Anything that is a fact about the *code* belongs in the plan or an architecture
doc, not here. This file is only for the ground the code stands on.

## Windows and PowerShell

- **PowerShell 5.1 mangles UTF-8 on a read-modify-write.** `Get-Content -Raw`
  decodes as ANSI and writes mojibake back. Use `node` or
  `[IO.File]::ReadAllText` / `WriteAllText` for scripted source edits.
- **A here-string is not a safe way to pass a commit message.** A `@'…'@` body
  containing quotes has been observed terminating early, so the rest of the
  message reached `git` as pathspecs. Write the message to a file and use
  `git commit -F`.
- **Exit codes through a Bash-tool pipeline are unreliable here.** Use
  PowerShell and `$LASTEXITCODE` whenever a native crash is a possible result.
- **Editor source files are CRLF.** Normalize before matching multi-line
  anchors.

## Building the native addon

- **Run `node scripts/build-zenkit.js` before `node-gyp`** — it resets the
  submodule, applies `patches/*.patch` and writes `zenkit-abi.json`.
- **That reset destroys any edit in `vendor/ZenKit` that is not a patch file.**
  The way to change ZenKit is therefore: edit the vendored source, `diff` it
  against a copy you took first, save that as `patches/00NN-*.patch`, and only
  then run the build — editing and building straight away loses the edit
  silently, because the reset happens before the compile and reports nothing.
- **`git diff` inside `vendor/ZenKit` is not that diff.** The submodule's index
  is the pinned commit, so it hands you *every* applied patch's hunks in the
  file you touched — `0038` came out carrying `0008`'s change to the same file.
  Copy the file before editing and `diff -u` against that copy (it is CRLF on
  this machine, so write the new one CRLF too or the diff is the whole file).
- **Use `node-gyp rebuild`, never `build`.** A stale `build/` fails with
  `LNK1103`.
- `node-gyp rebuild` **deletes `build/`**, which is why the CMake output lives in
  `vendor-build/` deliberately. Do not tidy it back.
- **A patch touching any `save` path needs the retail corpus re-run, by hand.**
  `node scripts/zen-roundtrip.js --root worlds` (after `extract-worlds.js`) —
  the corpus needs a retail install, so `zenkit-node.yml` has none and CI cannot
  catch this. It has already happened once: `0028` made `VTrigger::save` rebuild
  the deprecated `flags` byte from the two bools `load` unpacks, dropping the
  bits nothing maps to, and the headline `4× identical [BIN_SAFE]` silently
  became `4× semantic-drift` for a day. The fix shape is `0016`'s and `0044`'s —
  keep the unmapped bits on a zero-initialized `reserved_*` member and merge
  them back when writing (never on the deprecated member itself: it has no
  initializer, so a fresh object would merge indeterminate bits).
- **Never `dynamic_cast` ZenKit types** — node-gyp compiles `/GR-` on Windows.
- Nested ZenKit submodules must be initialised recursively.
- **An MSVC compile can hang.** One `cl.exe` sat 15 minutes at 31 s CPU with no
  output. Kill the `cl.exe` / `Tracker.exe` / driver chain and re-run.
- **Smart App Control blocks a freshly linked `.node` or `.exe` for ~5 minutes**
  (`ERR_DLOPEN_FAILED`). It clears on its own; re-linking from a different shell
  has also worked around it. **Never turn SAC off** — it is a one-way door
  needing a Windows reinstall.
- **`zen-world` must be built before the editor typechecks**, and rebuilt after
  any `coords` change: the editor consumes the build, not the source.
- **The renderer bundle is what `verify-world-edit.js` drives.** `build:main`
  alone leaves it stale, and the symptom is an edit refused by a validator that
  the renderer is a version behind. Run the full `build`.
- **A stale editor addon never fails a test.** The editor's Jest suites fake
  the zenkit worker, so every suite stays green against a `.node` missing
  whatever the ops have gained since it was built; the only place a stale
  addon shows is the running app — a property absent from the grid, an edit
  refused. Rebuild before trusting anything observed in the app.
- **`daedalus-parser`'s own native binding goes stale the same way, silently.**
  `npm test`'s `npm run build` step is `tree-sitter generate` — it regenerates
  `src/parser.c` but never recompiles `bindings/node`'s `.node` file, so a
  grammar change compiles into source nobody links. Found 2026-08-28: the
  compiled binding was 6 months older than `grammar.js` and four tests failed
  against a grammar that had already grown a `variable_declaration` node the
  binary had never heard of. `npx node-gyp rebuild` (run from `daedalus-parser/`)
  fixed all four with no source change. Check `grammar.js` against
  `build/Release/tree_sitter_daedalus_binding.node`'s mtime whenever a parser
  test fails in a way the diff doesn't explain.

## Jest on Node 24

- **An unhandled promise rejection kills a whole run with no test output.** If
  Jest prints nothing, look for an unawaited promise first.
- **A `mockResolvedValueOnce` that its own test never consumes leaks into the
  next test.** The symptom is the *following* test failing.
- **react-window renders no rows under jsdom without the AutoSizer mock.** Any
  suite that renders the scene tree needs it.
- **`fireEvent` wraps every call in `act()`.** That is why a component test can
  never find a bug that only appears when two events land in one JS task —
  React 18 batches state updates, and a real driver dispatching a whole gesture
  in one `page.evaluate` reads state the handler has not flushed yet.

## The intermittent `3221226505`, and what it is not

`npm run test:matrix:windows` exists to reproduce an intermittent
`3221226505` exit of the editor's Jest run. As of 2026-08-28 it is **still
unexplained**, and three plausible-looking explanations have been ruled out.

- **It is not the worker-handle warning.** That warning was a referenced
  two-second timer in `FileWatcherService.notifySelfWrite`, and it is fixed.
  25 full editor runs while closing it all exited 0, so the two never
  reproduced together and share no cause: `0xC0000409` is a native
  `__fastfail`, while a jest-worker force-kill is `SIGTERM`/`SIGKILL`.
- **The native code in the run is tree-sitter, not `zenkit-node`.** The old
  wording here said the addon was "the only native code in the run" and made it
  the first suspect. That is wrong, and it was the whole basis of the suspicion:
  **nothing in the Jest run ever loads `zenkit-node`.** No suite imports it,
  `WorldService.test.ts` injects a fake worker, and the only `require('zenkit-node')`
  under `tests/` is in `tests/e2e-electron/world-render.spec.ts`, which Playwright
  runs, not Jest. What *does* `dlopen` is the real parser — `jest.config.js`
  refuses to fall back to mocks on purpose — and it brings two `.node` files:
  `daedalus-parser/build/Release/tree_sitter_daedalus_binding.node` and
  `tree-sitter@0.21.1`'s `prebuilds/win32-x64/tree-sitter.node`. Suspect those.
- **It is not a V8 heap OOM.** Measured on this machine: a deliberate
  `--max-old-space-size=8` OOM exits **134**, not `3221226505`. So worker memory
  pressure — the obvious reading of "intermittent, only under parallel workers" —
  produces a different exit code and is not this.
- **`--detectOpenHandles` cannot help.** It implies `--runInBand`, so there are
  no workers and the warning class of bug cannot occur under it at all. It is a
  dead end by construction, not merely unlucky.
- **It does not reproduce on demand, and that is now the blocker.** 2026-08-28:
  three more full default runs and one instrumented run all exited 0 (185 suites,
  1626 tests, ~55 s each), and a targeted GC stress of the parser binding — 3,300
  parses, a fresh `DaedalusParser` per round, `--expose-gc` between rounds — also
  exited 0. With the 25 earlier runs that is 29 clean runs and no capture. Until
  someone catches one, there is nothing to bisect: the next useful thing is not
  another blind matrix run but a *captured* crash — a Windows crash dump (`procdump`
  or `HKLM\SOFTWARE\Microsoft\Windows\Windows Error Reporting\LocalDumps` on
  `node.exe`) so the faulting module is read off a stack instead of guessed at.

## Running a sabotage harness here

A sabotage run breaks the code on purpose and checks the suite notices. On this
machine the harness itself is the thing most likely to be broken, and it fails
*silently* — as a clean run in which every sabotage survives.

**The rule that catches all of these: a sabotage run in which everything
survives is a broken harness, not a sound implementation.** Four distinct causes
have now been found, two per session, and in every case the first instinct
("the tests must be weak") was wrong.

- **Never report "0 failed" without separately checking that a summary was
  printed at all.** These are different outcomes and they read identically if
  you only regex for the failure count. Ask "did the runner print a summary?"
  first, and "how many failed?" second — a run that printed nothing is a harness
  fault, and a run that printed nothing *because the addon aborted* is a
  finding.
- **`spawn`/`execFileSync` on a `.cmd` without `shell: true` is ENOENT.**
  `pnpm.cmd`, `jest.CMD` and every other npm shim. The throw lands in the catch
  that was meant for "the tests failed", the captured output is empty, and every
  sabotage reads as survived. Prefer `spawnSync(process.execPath, [<the tool's
  own .js entry>, …])` over the shim — `node_modules/jest/bin/jest.js`,
  resolvable with `require.resolve('jest/bin/jest')`.
- **Match the runner's summary loosely, and know which one you are running.**
  Jest prints `Tests: N failed`; `node:test` prints `ℹ fail N` with an
  information glyph, **not** `# fail N` — an anchored `/^# fail (\d+)$/m`
  matches nothing and reads every run as a crash. (This is the same class as the
  older bug where PowerShell 5.1 read a UTF-8 scratch script as ANSI and jest
  wrapped its glyphs in ANSI colour codes: never grep for glyphs, and parse in
  node rather than in PowerShell.)
- **Count a suite that fails to *compile* as caught, and say so.** A TypeScript
  error reports `Tests: 0 total` — no assertion failed, so a failure-count regex
  reads it as survived. It is a real catch, by the type checker rather than by a
  test, and labelling it separately keeps a sabotage the tests would have missed
  from being credited to them.
- **A C++ sabotage costs a full `node-gyp rebuild` per round** (never `build`).
  Budget for it: four sabotages of `binding.cc` is four rebuilds, several
  minutes each. Restore the file and rebuild once more at the end, and check
  that final build succeeded — a harness that leaves a sabotaged `.node` behind
  poisons every run after it.

**Some survivors are honest, and belong in the test as a stated limit.** A
sabotage can survive because the fixture cannot express the thing being
sabotaged — e.g. removing `getWaynet`'s null-slot filter survives because the
minimal fixture has no null slots. Write the limit into the test rather than
weakening or deleting the test, and say what actually prevents the drift if
anything does.

## Gothic II, as the engine oracle

- Installed at `C:\Program Files (x86)\Steam\steamapps\common\Gothic II`,
  **and it is stock** — as of 2026-08-29 nothing on the repo's side needs a
  file in the install renamed, extracted or written:
  - **The world corpus comes out of the archives, not out of `_work`.**
    `node scripts/extract-worlds.js` (zenkit-node) mounts `Data\Worlds.vdf`
    then `Worlds_Addon.vdf` read-only through the binding's own VFS and writes
    every `.ZEN` flat into the gitignored `zenkit-node/worlds/` — 8 worlds,
    `NEWWORLD.ZEN` at the recorded `b4dac867…`. That directory is what every
    `--world` script (`check-portal-pairing.js`, `check-portal-planarity.js`,
    `check-visual-winding.js`, `check-vob-bbox.js`), `tools/mutate.js` and
    `zen-roundtrip --root` take. Re-running the script is the whole re-extract.
  - **Candidates ship as a mod.** `tools/engine-batch.ps1` stages them into
    the GMBT project and `gmbt test --world=<name>` builds
    `Data\ModVDF\DDS-CAND.mod`; the retail `Worlds*.vdf` are never shadowed
    and never renamed. The old layout — six VDFs parked as `.disabled` so a
    world copied into `_work` would win, a pristine backup restored in a
    `finally` — is retired with it, and so is the way a Steam "verify
    integrity" used to void a verdict. The MDK *script* tree GMBT needs is
    `tools/gmbt/mdk/` (gitignored, rebuilt as described below), not `_work`.
  `zenkit-node/tools/startup-probe.ps1` is still the unattended "does the
  engine itself start" check, before blaming a candidate.
- **The oracle is not stock**, and every verdict has to say so: Gothic II 2.6
  (fix) + SystemPack + GD3D11 (kirides fork, `51efd73`, as `System\ddraw.dll`).
  Stock never rendered on this machine — black screen with working audio in
  every configuration tried. GD3D11 replaces only the D3D7 rendering path, so
  the fidelity claim is untouched; but it changes lighting by design, so
  screenshot comparisons are candidate-vs-control only, never against the retail
  look.
- **Run fullscreen.** Windowed crashes with an access violation here.
- **Not every Access Violation dialog is a verdict, and two of them are noise.**
  Both were seen in the Gate 2b batch (2026-08-28) and both are the engine's,
  not a candidate's — read the stack before you classify a run:
  - **At shutdown.** `CGameManager::Done()` → `exit()` → `_c_exit()` →
    `zCRayTurboAdmin::~zCRayTurboAdmin` → `zCMeshOctreeNode::~zCMeshOctreeNode`
    (`zBsp.cpp:7099`). It appears *after* you close the game, on a session that
    played fine, and it is not reliable: two of five candidates carrying the
    same re-saved mesh raised it and three did not. A world that reached this
    stack **loaded and played**.
  - **On dialog start, in the pristine retail world.** `oCNpc::EV_PlaySound` →
    `zCAICamera::StartDialogCam` → `zCCSCamera::Unarchive` → `zMAT4::operator=`
    (`zAlgebra.cpp:552`). Seen on `00-control-original.zen`, so no edit of ours
    is in that path. It kills the control, which is what the batch's A/B rests
    on — if it recurs, re-run `00` alone rather than voiding the batch.
  `engine-batch.ps1` used to log any such dialog as `FAIL (dialog captured)`;
  it now dumps the window and still asks for a verdict, because the script
  cannot tell these apart and the person at the keyboard can.
- **Never pass a world on Spacer's command line** — `0xC000041D`, on the retail
  original too.
- **Never OpenGothic.** It is built on ZenKit and shares the code under test.
- Gothic 1 is not installed, so G1 coverage is *unavailable*, not clean.
- The pristine addon NewWorld is 75,387,729 B, sha256 `b4dac867…`.
  `scripts/extract-worlds.js` reports whether the one it wrote matches, and
  `test/assets.test.js` asserts it against the archives on any machine that has
  them. There is no backup any more because nothing writes into the install.

## GMBT empties `_work`, and how `_work` is rebuilt

**`gmbt` rebuilds `_work/Data` from its asset dirs and backs up only what it
does not manage.** On 2026-08-29 a `gmbt compile --full` whose one asset dir
held nothing but `Worlds/` moved `_work/Data` aside, copied only `Music`,
`Presets` and `Video` into `_work/DataOriginal`, emptied `Scripts`, `Worlds`,
`Anims`, `Meshes`, `Sound` and `Textures`, and then crashed before restoring —
so the retail extraction was gone and every measurement card lost its corpus.
**The asset dirs must supply a complete tree**, which is why the beppo project
carries a whole `mdk/`; that is load-bearing, not tidiness.

The game itself was never at risk: it runs from `Data/*.vdf`, and `_work` is
only the modding tree. **Since 2026-08-29 nothing of ours lives there**: the
world corpus is `scripts/extract-worlds.js`'s output in the repo, and GMBT owns
`_work/Data` outright. What has to exist is `tools/gmbt/mdk/` — the complete
script tree GMBT merges in — and rebuilding *that* needs no installer and no
UAC; every source is already on the machine:

1. **Compiled scripts** — `Data/ModVDF/GothicGame.mod` is a VDF and carries
   `_WORK\DATA\SCRIPTS\_COMPILED\*.DAT`, `GOTHIC.DAT` included; `openVfs` +
   `vfsRead` read them out, as `extract-worlds.js` does for worlds.
2. **Script sources** — `Downloads/g2mdk-2.6_small.exe` is NSIS; **7-Zip
   extracts it without running it**, so no elevation is needed. But 7-Zip
   **flattens NSIS's directory structure**: `Scripts/System` comes out as one
   flat directory while its `.src` files expect `_intern\`, `menu\`, `music\`,
   `pfx\`, `sfx\` and `visualfx\`. The `.src` files are the map — each line is
   `dir\file.d` — and reconstructing from them places all 27 exactly.

**Base volumes first, `*_Addon.vdf` last**, wherever archives are mounted —
this is NotR, and `Worlds.vdf` alone yields a *pre-addon* NewWorld with a
different hash. The addon volume reproduces the recorded `b4dac867...` byte for
byte, which `extract-worlds.js` prints and `test/assets.test.js` asserts.

**The repo's gitignored `mdk/` is not retail-equivalent.** It carries
`Story/NPC/BAU_902_Gunnar_2.d`, which redefines `Rtn_Start_902` and so cannot
compile under `Gothic.src`'s `STORY\NPC\*.d` glob, and it is missing at least
whatever defines `DIA_Addon_Cavalorn_MeetingIsRunning_OneTime`. Do not assume it
compiles — `tools/gmbt/mdk` is a separate copy for exactly that reason, and the
harness runs `--noreparse` against shipped retail `.DAT`s rather than building
them.

## ZenKit and the world format

- **`Vfs::mount_host` memory-maps every file eagerly** and skips zero-size files.
  Windows then refuses to delete a mounted file until the handle is collected.
  Mount archives, not loose trees — 15 ms against 2,170 ms, measured.
- **The ZEN header carries a date stamp**, so two saves of the same world differ
  in bytes at identical size. A re-save that no longer matches a recorded hash is
  not evidence of a defect.

## Parallel agents in one working tree

Cards split by *file domain* run concurrently in the same checkout — no worktree,
so nobody pays for a ZenKit rebuild or a fresh pnpm install. Two things follow,
both met on 2026-08-28 with three agents in flight.

- **Never `git stash` to prove a test red.** `git stash push` takes the whole
  working tree, not your files: proving one suite red stashed and restored
  another agent's mid-edit `WorldSurface.tsx` along the way. It popped cleanly,
  but a concurrent write inside that window is simply lost. To see a test fail
  without the implementation, edit the source back by hand, or hardcode the
  value the wiring supplies, and undo it — a change you can name and reverse
  yourself.
- **A full-suite "green" is only as good as its last run.** One intermediate run
  showed 7 failures in `WorldSurface.editing` and `WorldScene` that a rerun did
  not reproduce; they were a neighbouring agent's half-written tree, not a flake
  and not that agent's change. Rerun once before believing a failure that points
  at a file you did not touch, and run the suite again after the other agents
  report.
- **A failure in a file you did not touch still has to be bisected, not
  attributed.** Two agents blamed each other for the same failing test, each
  reran it as this section says to, and **both were wrong** — it was a real
  defect in one of their own changes, reproducing in isolation under `-t`. The
  rerun rule tells you a failure is stable; it does not tell you whose it is.
  Bisect by copying the working file aside, `git show HEAD:<path> > <path>`,
  running the one test, and restoring the copy — four such probes named the file
  in minutes. "The neighbour's tree is dirty" is a *plausible* explanation, which
  is exactly why it needs evidence.
- **Do not run `npx pnpm` in this checkout.** It fetches its own pnpm, decides
  `node_modules` was installed by something else, and aborts trying to remove it
  — `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`. With agents working in
  parallel, the abort is the good outcome. Use `pnpm --filter <pkg> <script>` if
  pnpm is on PATH, and otherwise call the tools directly from the workspace
  directory: `node node_modules/jest/bin/jest.js`,
  `node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit`,
  `node node_modules/eslint/bin/eslint.js .`.
- **Never rebuild the native addon while another agent is packaging.** A
  `node-gyp rebuild` at 20:15 landed inside an `electron-builder` run that
  wrote its asar at 20:18, and the result was a **corrupt package that looks
  intact**: 32,918 entries listed, total size consistent with the declared
  offsets, and yet `@electron/asar` extracted garbage for every file. The
  packaged app then exited 1 in ~220 ms with no window, no stdout, no stderr
  and no Windows event-log entry, which reads exactly like a main-process bug
  and is not one. Two hours of a session can go into that symptom, so check the
  artifact before the code: extract `package.json` out of the asar and parse it.
  If it is not valid JSON, repackage with nothing else running rather than
  debugging the app. (Packaging reads `node_modules` for minutes; any write into
  a workspace it is copying is inside its window.)
