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
