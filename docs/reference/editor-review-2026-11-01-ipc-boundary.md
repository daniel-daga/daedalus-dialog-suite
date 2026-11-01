# Editor review — 2026-11-01, slice 1: the IPC boundary and the small main services

Slice: `src/main/main.ts` (all handler registration), `ipcValidation.ts`,
`preload.ts`, `windowSecurity.ts`, `openWorldSmoke.ts`, `parseSmoke.ts`;
`src/main/services/` `PathValidationService.ts`, `UpdaterService.ts`,
`SettingsService.ts`, `GmbtService.ts`, `gmbtProject.ts`,
`ThumbnailCacheService.ts`, `AssetCatalogService.ts`, `outputUnits.ts`,
`LogService.ts`, `serviceRegistry.ts`; and `src/shared/` — the contract both
sides compile against.

Commit reviewed: `cff7c5a`. Date: 2026-11-01.

**Load assumed.** About a hundred handlers registered at startup, called at UI
speed (an auto-save per edit, a thumbnail request per asset row, an asset
listing over a whole mod); a Windows user profile with junctions and 8.3 short
names; a Gothic install outside the project folder; and an updater that
downloads an installer and launches it. The renderer is treated as untrusted
input throughout — it is where a compromised page or a plain bug sends a path.

**What this slice does.** `main.ts` registers 72 channels (`ipcMain.handle` for
request/response, `ipcMain.on` for the three close-guard signals), asserting the
shape of every request payload from `ipcValidation.ts` — with the exception of
`settings`/`options` on the three read-only generator and validation handlers,
which is finding 5 — and putting every path it accepts through
`PathValidationService.validatePathResolved` before it reaches a service. The
services underneath are small and mostly single-purpose:
the path whitelist, the settings file, the updater's download/verify/spawn
chain, the OU database in the game install, two JSON sidecars beside a project
or world, a thumbnail cache and a local log. `preload.ts` exposes 76 methods over
those 72 channels through `contextBridge` with no `nodeIntegration`, and
`src/shared/` is the type contract both sides compile against.

Checks run: `tests/ipcValidation.test.ts`, `PathValidationService.test.ts`,
`ThumbnailCacheService.test.ts`, `AssetCatalogService.test.ts`,
`SettingsService.test.ts`, `LogService.test.ts`, `windowSecurity.test.ts`,
`outputUnitsUpdate.test.ts`, `serviceRegistry.test.ts`, `GmbtService.test.ts`,
`gmbtProject.test.ts`, `services/UpdaterService.test.ts`,
`closeGuardPerWindow.test.ts` (all pass), and `projectConfigIpc.test.ts`, which
**does not** — 13 of its 17 on this machine, finding 3. Finding 2 is reproduced
by two throwaway probes (`closeTimer`/`two.test.ts` in a temp directory, not
added to the repo); finding 1 is read from the code and from Electron's documented
`quit` semantics, not from a launched app. No repo file was edited except this
report.

## What already holds, and the test that would fail if it broke

| Rule | Test |
|---|---|
| `preload.ts` exposes all 76 of `EditorAPI`'s methods under the same names, and the mock is missing none of them; every channel the preload invokes is registered (72/72) | checked by hand for this review; nothing pins the preload-versus-type half (finding 6) |
| `world:assets`, `world:assetSearch` and `world:visualBounds` assert their request shape instead of falling back to the namespace root | `tests/ipcValidation.test.ts:359` |
| The lexical-only validators are gone; containment is realpath-based, and a write refuses a symlinked final component | `tests/PathValidationService.test.ts:141` (symlink-aware containment), `:271` (single-file grants), `:74` (traversal) |
| `project:saveAssetSources` refuses an absolute source that never came through the native picker, and a relative one that leaves the project | `tests/projectConfigIpc.test.ts:126`, `:184`; the picker half is `:145`, red for finding 3's reason alone |
| A picker result that arrives after another project became active is granted to the project that launched it, never the active one | `tests/projectConfigIpc.test.ts:212`, `:231` (both currently red for finding 3's reason) |
| `world:open` refuses a project that is not the active one, and re-checks after each `await` | `tests/projectConfigIpc.test.ts:247`, `:263`, `:289` (all red for finding 3's reason) |
| Settings writes are atomic, unique-temp-named, serialized, and survive a corrupt file | `tests/SettingsService.test.ts:87`, `:107`, `:142`, `:207` |
| The updater pins the offered URL and metadata, refuses any other URL, and refuses an installer path it did not download | `tests/services/UpdaterService.test.ts:315`, `:297`, `:302` — the successful install (spawn, quit) has no test (finding 1) |
| A thumbnail is written through a temp file and refused if it is not a real PNG | `tests/ThumbnailCacheService.test.ts:84`, `:94` |
| `window.open` is denied and navigation is blocked outside the dev server | `tests/windowSecurity.test.ts:41`, `:48` |
| The log rotates to exactly one predecessor and collapses newlines | `tests/LogService.test.ts:76`, `:47` |
| The composition root constructs nothing at import, and `main.ts` runs on it | `tests/serviceRegistry.test.ts:52`, `:88` |
| An OU write leaves the database and no temp file behind when it cannot land | `tests/outputUnitsUpdate.test.ts:90` |
| The GMBT quick test cannot be aimed by the renderer: it takes no payload, the folder is the project's own, the filename is the open world's basename, and the spawn is an argv array with no shell | `tests/GmbtService.test.ts:86`, `:166`, `:57` |

## Must fix

1. **"Install & Restart" never quits, so the installer runs against a live app**
   (`src/main/services/UpdaterService.ts:352-357`; the guard it collides with is
   `src/main/main.ts:270-280`, and the handler is `main.ts:817-824`)
   - **What this is:** `installUpdate` spawns the downloaded installer with `/S`,
     `detached`, then calls `app.quit()`.
   - **Problem:** `app.quit()` asks every window to close, and `createWindow`'s
     `close` handler answers `preventDefault()` for every close until the
     renderer sends `app:approveClose` — so the quit is cancelled and the app
     stays up. What the user sees is the dialog's `installing` state: a disabled
     "Installing..." button and "the application will close..."
     (`UpdateNotification.tsx:204-209`, `:238-240`) over a window that is not
     closing, plus, behind it, the close guard's "you have unsaved changes"
     prompt. Meanwhile the silent NSIS installer is already running: electron-builder's
     template closes a running copy of the app itself, so the prompt it just
     showed is moot and whatever was unsaved goes with the killed process; if it
     does not, the install lands under a running executable. This is the most
     plausible cause of the open user report **#421** ("does not restart after
     clicking close and restart when the DL is finished") — the same button, the
     same silence, no diagnosis yet.
   - **What the user loses:** the dialog edits in front of them, without the
     prompt they were about to answer, at the one moment the app kills itself on
     purpose. In the milder branch they end up with a half-applied install and a
     stuck modal.
   - **Test that does not exist:** the successful install path. The suite covers
     the two refusals before the spawn (`tests/services/UpdaterService.test.ts:297`,
     `:302`) and nothing after it. The one to write: with a window whose `close`
     is vetoed the way the real guard vetoes it, a successful install still ends
     the process — i.e. the exit does not go through a path the renderer can
     refuse.
   - **Minimal fix:** flush and save first, then leave without asking. In the
     renderer, `handleInstall` (`UpdateNotification.tsx:84-92`) awaits
     `flushAllPendingEdits()` and a save-all before calling `installUpdate`; in
     `UpdaterService`, `app.exit(0)` instead of `app.quit()` after the spawn, with
     one line of comment saying why (the installer is running either way, and the
     guard would only ask a question the installer is already answering).
   - **If we skip it:** the update path stays the one place where the close guard
     is not merely unhelpful but wrong, and #421 stays undiagnosed.

2. **A second close request leaves the first safety timer armed, and it destroys the window while the user is deciding**
   (`src/main/main.ts:276-279`, cleared at `:753-760`)
   - **What this is:** the `close` handler stores its 3-second force-destroy timer
     in one module-level `closeGuardAckTimer`, and arming it overwrites the
     previous handle without clearing it. `app:ackCloseRequest` clears only
     whatever handle is current.
   - **Problem:** two `close` events before the renderer's first ack — an
     impatient double-click on the title bar's X, or Alt+F4 again, or a quit
     arriving while the renderer is busy saving — leave the first timer
     unreachable. The ack clears the second; three seconds after the *first*
     close the first timer runs `win.destroy()` anyway. Reproduced with two
     throwaway probes against a mocked `electron`: one `close` and one
     `ackCloseRequest`, then 3.1 s — `destroy` is not called, as designed; two
     `close` events and **both** acks, then 3.1 s — `destroy` is called once,
     with the "you have unsaved changes" prompt on screen and no user decision.
   - **What the user loses:** everything unsaved across every open file, with the
     prompt still asking what to do about it.
   - **Test that does not exist:** two `close` events with an ack for each, then
     advance past the safety window, assert `destroy` was not called.
     `tests/closeGuardPerWindow.test.ts` covers only the per-window approval flag.
   - **Minimal fix:** clear before arming —
     `if (closeGuardAckTimer) clearTimeout(closeGuardAckTimer);` — or, better,
     send `app:closeRequested` only when no decision is pending.
   - **If we skip it:** a guard whose whole job is "never lose work without
     asking" has a path that skips the asking, and the trigger is clicking X
     twice when the window seems stuck.

## Should fix

3. **The project registry is keyed by a different spelling of the path than the descriptor hands back, so 13 of 17 project-config IPC tests fail on macOS**
   (`src/main/main.ts:111-114`, `projectFileKey`; against
   `src/main/services/ProjectConfigService.ts:403`, which realpaths the root)
   - **What this is:** `projectFileKey` normalizes and resolves the string it is
     given. `registerProjectConfig` keys `registeredProjectConfigs` by
     `descriptor.projectFilePath`, and that path is canonical because
     `openOrMigrate` starts from `fs.realpath(projectRoot)`.
     `project:saveAssetSources` looks the project up by the string the renderer
     sent.
   - **Problem:** whenever the two spellings differ, the lookup misses and the
     handler refuses with "Project file is not a loaded project". On macOS
     `os.tmpdir()` is `/var/folders/...` and realpath makes it
     `/private/var/...`, which is exactly why `tests/projectConfigIpc.test.ts`
     fails 13 tests here: the four that pass either never call
     `project:saveAssetSources` or hand back `opened.projectFilePath`
     (`:184`), and every failure hands back a `mkdtemp` path
     (`second.projectFilePath` at `:259`, for instance). On Windows the same
     divergence is an 8.3 short name (`C:\PROGRA~1\...`) or a junction; case is
     already folded by the `toLowerCase()` on win32. Today's renderer always
     uses `projectStore.projectFilePath`, which comes from the descriptor, so no
     user path is known to break — the fragility is one caller away.
   - **What the user loses:** nothing today. What the *maintainer* loses is the
     gate itself: the suite that decides who may save asset sources for which
     project is red on the platform the editor is developed on, so a real
     regression in it is indistinguishable from path noise. And a caller that
     hands back the folder the user picked rather than the descriptor's path is
     refused with a message about a project that is, in fact, loaded.
   - **Test that does not exist:** the existing suite, once its helper composes
     the path the way the app does. Fixing it as written is the assertion
     `saveAssetSources` accepts either spelling of the same project.
   - **Minimal fix:** canonicalize in `projectFileKey` —
     `try { return fs.realpathSync(resolved); } catch { return resolved; }` —
     which fixes the 13 tests and every future caller in one line, and leaves
     the fallback for a path that does not exist yet. (The cheaper-looking fix is
     one line in the test helper, `makeProject` realpath-ing its root; that makes
     the suite green and leaves the product comparing spellings.)
   - **If we skip it:** a green macOS run means "I did not touch the IPC tests",
     not "the IPC tests pass", and that is how a real one gets ignored.

4. **The thumbnail cache is written and never pruned, so it grows for as long as the user compiles assets**
   (`src/main/services/ThumbnailCacheService.ts:30-44`, `:58-71`, the only writer
   `src/main/main.ts:1084-1087`)
   - **What this is:** the key is a digest of the asset name plus every mount's
     `mtimeMs`. `store` writes `<key>.png` under `userData/asset-thumbnails`;
     `load` reads one back. There is no delete, no sweep, no count and no size
     cap anywhere in the service or its one caller.
   - **Problem:** a key change is the *normal* case, not an edge case — the mtime
     is in the key precisely so that a rebuilt VDF or a re-converted asset folder
     invalidates what was drawn from the old one, and `gmbt compile` is a button
     in this app. Each rebuild changes every key; the next sweep of the asset grid
     writes a whole new set of PNGs and the previous set stays forever. The op
     also accepts any 64-hex key, not only one `keyFor` minted, so nothing bounds
     the key space either.
   - **What the user loses:** disk in their profile, silently and permanently — a
     1,000-asset mod is a few MB per compile, and the folder never shrinks. There
     is no UI that shows it and no way to clear it but deleting the directory.
   - **Test that does not exist:** touch a mount, redraw, assert the previous
     keys are gone (or that the directory stays under a byte cap).
   - **Minimal fix:** prune inside `store` — after the rename, read the directory
     and unlink what is older than a few days or beyond a total-size cap (96 px
     PNGs, so a `readdir` plus `stat` is cheap and happens once per drawn tile) —
     and add the two-line `Set` of keys `keyFor` has minted this session, refusing
     a `put` for anything else.
   - **If we skip it:** the one writable surface in `userData` with no bound is
     the one nothing in the app can display or clear.

5. **`security-model.md` says the generator and validation handlers check `settings` and `options`; three of them check only `model`**
   (`src/main/main.ts:384-392`, `:394-403`, `:406-414`; the claim is
   `docs/architecture/security-model.md:64-67`)
   - **What this is:** the doc states that structural payload checks on
     `generator:generateCode`, `generator:generateDialogCode`,
     `validation:validate` and `generator:saveFile` reject malformed
     `model`/`settings`/`options` shapes. The first three call `assertModelShape`
     and nothing else; `settings` and the validate handler's `options` reach the
     service untouched. `assertSaveFileSettings`/`assertSaveFileOptions` exist,
     are tested, and are called from `SaveFileFlow.ts:48-49` only.
   - **Problem:** the boundary does not do what the security document says it
     does, and the next reviewer or auditor reads the doc, not the handler. The
     three handlers do not write, which is why this is not a Must fix — the cost
     of a bad payload there is a deep, unhelpful error
     ("Failed to generate code: Cannot read properties of undefined") instead of
     a refusal at the boundary.
   - **What the user loses:** a clear refusal when something upstream is broken;
     nothing else.
   - **Test that does not exist:** each handler's own assert —
     `invoke('validation:validate', {}, null, { evil: true })` rejects with
     `/settings/`. The asserts are tested directly; nothing pins that a handler
     calls one.
   - **Minimal fix:** add the two existing calls to the three handlers —
     `assertSaveFileSettings(settings)` in each, plus `assertSaveFileOptions` in
     `validation:validate` for its `options`. ~6 lines, no new code. Or cut the
     sentence to `model` only, if those two are considered more trouble than they
     are worth for a read-only path.
   - **If we skip it:** the doc keeps crediting a check nobody makes, which is the
     failure mode the doc exists to prevent.

6. **Nothing checks `preload.ts` against the renderer's `EditorAPI`, and the silent direction of that drift is a runtime error**
   (`src/main/preload.ts:6-141` against `src/renderer/types/global.d.ts:139-310`)
   - **What this is:** `preload.ts` hands `contextBridge` a plain object literal;
     TypeScript cannot see it, so the 76 method names and signatures exist twice
     — once untyped in preload, once as `EditorAPI` — plus a third time in
     `renderer/utils/mockAPI.ts`, which is what every Jest test drives.
   - **Problem:** the two directions are not equally loud. A method in `preload`
     that `EditorAPI` lacks fails to compile at its first renderer call. A method
     in `EditorAPI` that `preload` lacks compiles, passes every Jest test through
     the mock, and throws `window.editorAPI.<x> is not a function` only when a
     user clicks it in the real app. They agree today (76/76, checked by hand for
     this review); nothing keeps them agreeing.
   - **What the user loses:** one feature, silently, until someone runs the
     packaged app — and that is the class of defect CI is cheapest at catching.
   - **Test that does not exist:** one node-environment test that reads the three
     files and compares the method name sets. Slice 8 owns the mock-versus-real
     half of this; the `EditorAPI`-versus-preload half belongs here because it is
     the contract, not the fake.
   - **Minimal fix:** that one test, `tests.every name in EditorAPI is a key of
     the exposed object`. No production code changes.
   - **If we skip it:** the contract keeps being maintained by hand, and its next
     miss is invisible to everything except a user.

## Nice to have

- Two doc comments in `ipcValidation.ts` sit above the wrong function after
  insertions: the `shell.openExternal` https comment (`:182-185`) is separated
  from `assertExternalUrl` by `assertOutputUnitLines`, and the "A visual by name
  for the Assets panel" comment (`:361-365`) sits above `assertVisualsRequest`
  instead of `assertVisualRequest`. Moving them costs nothing and this file is
  read as a security reference.

## Verdict

Verdict: fix 1 and 2 first. Finding 1 is the update path not doing the one thing
its own dialog promises ("the application will close"), which either loses
unsaved work to an installer that force-closes the app or leaves a half-applied
install behind a stuck modal — and it is probably the whole of open report #421.
Finding 2 is a one-line timer leak that destroys the window with the save prompt
still on screen. Finding 3 is not a user bug yet, but it is the only reason this
slice's own suite is red on macOS, and a one-line fix; 4 is the one unbounded
write in `userData`; 5 is a doc sentence or six lines of asserts; 6 is a test and
no code.

Lean: -0 lines. The boundary is already lean — 72 channels, one assert helper per
request shape, every assert has a caller, and the lexical-only validators from
the 2026-09-04 review are gone. The only removal available is finding 3's
`path.normalize(path.resolve(...))` becoming one canonicalizing call.

Not checked: I did not launch the app or the updater, so finding 1 is read from
the code, Electron's documented `app.quit` semantics and electron-builder's
installer template, not from an install; on a machine with an older build the
failure might appear as the installer closing the app itself rather than as a
stuck window. The Windows junction and 8.3-name cases in finding 3 are reasoned
from `path.win32` semantics, not run on Windows. `WorldService`, `zenkit.worker`
and the zenkit op validation were left to the level-editor review, and the save
pipeline's own writes to slice 3.
