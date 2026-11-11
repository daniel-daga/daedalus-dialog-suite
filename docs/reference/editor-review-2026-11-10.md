# Editor audit — 2026-11-10

Reviewed commit `621fe40`. One pass over the whole of `daedalus-dialog-editor/`
— performance, security, code quality, architecture — rather than a slice. The
nine slice reviews of 2026-11-01 went through behaviour defect by defect and
their findings are fixed; this pass looks at what they did not: behaviour on a
hostile or oversized project, cost, the dependency set and the shape of the
process boundary.

Everything marked *measured* was run against `dist/` built from this commit, on
the cloud container this audit ran in, against the default
`scripts/generate-perf-fixture.js` project (207 files, 6.7 MB, 3,000 dialogs).
Absolute times are that machine's; the ratios are the finding.

## Verdict

No must-fix. `lint` passes with six `exhaustive-deps` warnings, `build` and both
typechecks are clean, and the renderer has no whole-store subscription and no
deep clone on an edit path. The security baseline the earlier reviews built
holds where it was checked: context isolation with an invoke-only preload, a
deny-by-default window, a script-free CSP, main-owned write targets, a pinned
and re-hashed update, and GMBT resolved to an absolute path and spawned with an
argv array.

What is left is one isolation claim that is not true, a scan that trusts links
the validator does not, two costs that grow with the project instead of the
file, and housekeeping in the dependency set and the lint configuration.

## Should fix

1. **`zenkit.worker` is a thread, so a native crash takes the app** — #543
   (`src/main/services/WorldService.ts:1,106`)
   - **What this is:** the ZenKit addon runs in a `worker_threads` Worker in
     the main process. `docs/architecture/level-editor.md:757` says "a native
     crash kills the worker, not the app"; `docs/plans/level-editor.md:158`
     lists that as the mitigation for the addon.
   - **Problem:** a segfault or abort in a thread ends the process. That is
     the reason #268 moved both parser pools to forked children
     (`worker-reliability.md`, "Process isolation"); the world worker was left
     behind. The plan's fuzzing ran the addon in a child process, so the
     instrument could never show this. The addon is the larger native surface
     and reads the files the threat model calls hostile.
   - **Fix:** route the worker through `ForkedWorker`, or keep the thread by
     decision and correct both documents. Measure the geometry hand-off first:
     a fork has no transfer list, so the 31 MB mesh is copied.
   - **If we skip it:** a malformed world or asset closes the editor with
     every unsaved script edit, and nothing is logged — `child-process-gone`
     does not fire for a thread.

2. **The scan and the watcher follow links out of the root** — #544
   (`src/main/services/ProjectService.ts:74-135`, `FileWatcherService.ts:126`)
   - **What this is:** `scanDirectory` follows symlinks and junctions, cutting
     only cycles; chokidar is started with its default `followSymlinks`.
   - **Problem:** *measured* — a project of one file and a link to `/` indexed
     252 files, 251 from outside it, after walking the whole filesystem (4.1 s
     here). There is no bound on count or depth. And `PathValidationService`
     refuses those same paths, so the index lists dialogs `file:read` will not
     open. `security-model.md` says a junction leaving the root is rejected
     with a readable error; the index build does not know that.
   - **Fix:** one rule for both. Skip a link whose real path leaves the root
     and report it once, or grant what the project links to when the project
     is granted.
   - **If we skip it:** a junction-heavy mod shows NPCs whose dialogs fail to
     open, and a stray link to a drive root makes project open walk the disk.

3. **Every save sends the whole voice-id index** — #545
   (`src/renderer/store/fileStore.ts:328-343`, `src/main/ipcValidation.ts:251`,
   `src/main/services/ValidationService.ts:501`)
   - **What this is:** `buildExistingVoiceIds` filters the project's index and
     attaches it to each save and each validation.
   - **Problem:** *measured* — 27,795 ids, 7.85 MB serialized, 40 ms to build
     and 79 ms for one serialize/deserialize pair, before main's shape walk.
     Main then reads only the keys the saved file's lines use. Paid per
     auto-save, on both main threads.
   - **Fix:** send the entries for the ids in the saved model.
   - **If we skip it:** auto-save cost grows with the project.

4. **Validate and generate run on the main thread** — #546
   (`src/main/services/SaveFileFlow.ts`, `ValidationService.ts:125-205`,
   `CodeGeneratorService.ts`)
   - **What this is:** only the parse-back leaves the main process.
   - **Problem:** *measured* — an 845 KB constants file holds the main thread
     for about 610 ms (deserialize 52, normalize 271, `generateCode` 289, which
     normalizes again); a 137 KB globals file about 170 ms; a 27 KB dialog file
     about 45 ms. The window does not repaint or answer IPC meanwhile.
   - **Fix:** do both in the parser pool, which already gets the generated
     text. The model crosses once.
   - **If we skip it:** a visible hitch on each save of a globals or constants
     file, nothing for dialog files.

5. **Seven unused dependencies, 200 advisories, no audit in CI** — #547
   - *Measured* — no import of `react-router-dom` or `@tanstack/react-query`
     (production), nor of `concurrently`, `npm-run-all`, `cross-env`,
     `vite-plugin-electron`, `@types/chardet` (dev). `pnpm audit --prod`: three
     moderate, two of them `react-router`. `pnpm audit`: 200 (4 critical, 99
     high), all in dev and build tooling — `wait-on`→`axios`, `electron-builder`,
     `ts-jest`→`handlebars`, `vite`. Electron 43 is the oldest supported major.
   - **Fix:** remove the seven, bump, add `pnpm audit --prod` to `all-tests.yml`.
   - **Fixed 2026-11-11:** the seven are gone and `pnpm audit --prod` now runs
     in the editor CI job; it reports nothing once #548's move landed.

6. **Renderer libraries are production dependencies** — #548
   - **Not verified against a package.** electron-builder packs production
     dependencies whatever `files` says, and Vite has already bundled these:
     about 230 MB installed (`monaco-editor` 75, `@mui/icons-material` 89,
     `three` 33, `@mui/material` 19). Read `app.asar` before acting.
   - **Fix:** move what the main process does not require to `devDependencies`.
   - **Fixed 2026-11-11:** verified against `dist/main`, which requires only
     `chokidar`, `daedalus-parser`, `iconv-lite`, `zenkit-node` and `zen-world`;
     every renderer library is a dev dependency now. The packaged smokes in
     `build-windows.yml` are the gate, not a local repackage.

7. **No Electron fuses** — #549
   - `build` has no `electronFuses`, and `release-checklist.md` now carries the
     item. `RunAsNode` must stay on: `ForkedWorker` depends on it.
   - **Fixed 2026-11-11**: `build.electronFuses` sets all five; the checklist
     item is now the packaged read-back.

8. **`no-explicit-any` is off for a removed reason** — #550
   (`eslint.config.js`, `src/main/main.ts:384-416`, `src/main/preload.ts`)
   - 57 `any` in `src/main`, 41 in `src/renderer` outside `mockAPI.ts`. The
     four oldest handlers take `any` payloads, so the compiler does not notice
     a deleted assertion; the newer ones take `unknown` and narrow.
     `tsconfig.main.json` also has the unused-symbol checks off, and the lint
     is not type-aware.

## Nice to have

- **The updater has no timeout and no size cap when the metadata carries no
  `size`**, and `installUpdate` hashes the installer with `readFileSync` on the
  main thread (`UpdaterService.ts:230,342`). A stalled download never settles.
- **No handler checks `event.senderFrame`.** One window, navigation blocked and
  `frame-src 'none'` make it unreachable today; it would matter the day a
  second surface is embedded.
- **No size bound on a file read or a parse payload** (`assertParseSourcePayload`
  checks the type only). The forked workers' 512 MB heap and 30 s timeout are
  the only limit.

## Looked at and left alone

- **A second app instance.** Deliberately supported: `SettingsService` retries
  a contended rename and names its temp file per process. No single-instance
  lock is wanted.
- **Index-build memory.** *Measured* — 209 MB peak RSS and 116 MB heap in the
  main process for the fixture; the hand-off cache is capped at 512.
- **`WorldSurface.tsx` at 3,598 lines.** #263 took four concerns out and was
  closed on purpose; `main.ts` is `refactoring-targets.md` #12.
- **The bundle.** `main` 611 kB, `three` 513 kB, `mui` 487 kB, `WorldSurface`
  307 kB lazily loaded; the build's warning guard passes.
