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
- **Use `node-gyp rebuild`, never `build`.** A stale `build/` fails with
  `LNK1103`.
- `node-gyp rebuild` **deletes `build/`**, which is why the CMake output lives in
  `vendor-build/` deliberately. Do not tidy it back.
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
unexplained**, and one plausible-looking explanation has been ruled out.

- **It is not the worker-handle warning.** That warning was a referenced
  two-second timer in `FileWatcherService.notifySelfWrite`, and it is fixed.
  25 full editor runs while closing it all exited 0, so the two never
  reproduced together and share no cause: `0xC0000409` is a native
  `__fastfail`, while a jest-worker force-kill is `SIGTERM`/`SIGKILL`.
- **The first suspect is the native addon, not Jest.** A native abort with no
  reproduction is the shape of a C++ failure, and `zenkit-node` is the only
  native code in the run.
- **`--detectOpenHandles` cannot help.** It implies `--runInBand`, so there are
  no workers and the warning class of bug cannot occur under it at all. It is a
  dead end by construction, not merely unlucky.

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
  extracted MDK-style into `_work\Data\{Meshes,Textures,Scripts,Worlds}`.
- **The MDK layout depends on six VDFs staying renamed `.disabled`** — `Worlds`,
  `Worlds_Addon`, `Meshes`, `Meshes_Addon`, `Textures`, `Textures_Addon`. A
  Steam reinstall or "verify integrity" restores all six and silently breaks it
  two ways: `Worlds.vdf` carries its own `NewWorld.zen`, so **any engine verdict
  taken in that state is void**, pass or fail; and it crashes the game a few
  seconds after launch. Check this *before* blaming a candidate.
  `zenkit-node/tools/startup-probe.ps1` is the unattended check.
- **The oracle is not stock**, and every verdict has to say so: Gothic II 2.6
  (fix) + SystemPack + GD3D11 (kirides fork, `51efd73`, as `System\ddraw.dll`).
  Stock never rendered on this machine — black screen with working audio in
  every configuration tried. GD3D11 replaces only the D3D7 rendering path, so
  the fidelity claim is untouched; but it changes lighting by design, so
  screenshot comparisons are candidate-vs-control only, never against the retail
  look.
- **Run fullscreen.** Windowed crashes with an access violation here.
- **Never pass a world on Spacer's command line** — `0xC000041D`, on the retail
  original too.
- **Never OpenGothic.** It is built on ZenKit and shares the code under test.
- Gothic 1 is not installed, so G1 coverage is *unavailable*, not clean.
- Pristine backup: `_work\Data\Worlds\NewWorld\NewWorld.zen.original-backup`,
  75,387,729 B, sha256 `b4dac867…`. Never write into the Gothic directory
  without one; `engine-batch.ps1` verifies the hash before it starts and restores
  in a `finally`.

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
