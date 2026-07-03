# Fix Plan 06 — Security & Update Chain

Source: [`code-review-findings.md`](./code-review-findings.md) §6 (S1–S6) + main-process IPC hardening notes.
Scope: `daedalus-dialog-editor/src/main/` (PathValidationService, UpdaterService, SettingsService, main.ts, preload), `src/shared/updater-types.ts`, `package.json` build block, `.github/workflows/build-windows.yml`.
Status: in-progress — fixes 1–4 implemented (2026-07-03); fixes 5–7 outstanding (see §4 table).

---

## 1. Scope & findings

### Verified as reported

| ID | Status | Notes from deep-dive |
|----|--------|----------------------|
| S1 | **Verified** | `UpdaterService.downloadUpdate` (`UpdaterService.ts:149-208`) streams the installer to `%TEMP%\daedalus-update-<version>.exe` with no hash check and no downloaded-bytes vs `content-length` check (the header is used only for progress %). `installUpdate` (`:210-231`) spawns it with `/S` (silent NSIS). `update-meta.json` (producer: `build-windows.yml:118-125`) carries only `version`/`baseVersion`/`buildNumber` — no digest, no size. `package.json` build block has no `win.sign*` config; installer is unsigned. Integrity rests entirely on TLS to a **mutable rolling release tag** (`windows-latest`). Mitigations that DO exist and are tested (`tests/services/UpdaterService.test.ts`): download URL pinned to the last check's offer, install path pinned to the last download, redirects bounded at 5, `isNewerVersion` prevents metadata-level downgrade. |
| S2 | **Verified** | `electron ^29.4.6` (devDep) **and** independently pinned `build.electronVersion: "29.4.6"` (`package.json:43`) — two places must move together. Electron 29 EOL Oct 2024. |
| S3 | **Verified** | `PathValidationService` is purely lexical — `fs` is never imported; a symlink/junction inside a whitelisted project dir pointing anywhere escapes both read and write validation. Granularity: `file:openDialog` / `file:saveDialog` (`main.ts:222-254`) whitelist `path.dirname(filePath)` — picking one file in `Downloads/` whitelists all of `Downloads/` for the session. |
| S4 | **Verified** | No `setWindowOpenHandler` and no `will-navigate` handler anywhere in `src/main/`. Renderer calls `window.open('', '_blank', ...)` in `DialogSourceViewDialog.tsx:65` — note the handler is a self-described **placeholder** ("This is a placeholder... we'll just log it") that `document.write`s escaped code into a blank window. Baseline otherwise good (contextIsolation on, nodeIntegration off, narrow invoke-only preload). |
| S5 | **Verified** (release-gating itself is slice 8) | `build-windows.yml` is `workflow_dispatch` with **no test gate and no ref restriction** — it can be dispatched on any branch/old ref and will overwrite the public rolling release. This matters here because it constrains updater-verifier sequencing (see §2.1 and §4). |
| S6 | **Verified** | `SettingsService.writeSettings` (`:41-47`) is a direct `fs.writeFile` (non-atomic, torn file on crash/ENOSPC) with the error swallowed (`console.error` only, caller sees success). Every setter is an unserialized read-modify-write — concurrent setters (e.g. `setUpdaterLastCheckTimestamp` during `addRecentProject`) interleave and silently drop one another's fields. Corrupt JSON silently resets to `{recentProjects: []}` (`:35-38`), which wipes the recent-projects list that **seeds the path whitelist** (`main.ts:53-61`) and gates `project:addAllowedPath` (`SettingsService.isKnownRecentProject`). |
| IPC-a | **Verified** | `fileWatcher:notifySelfWrite` (`main.ts:372-374`) takes an unvalidated renderer string → a compromised renderer can suppress watcher events for arbitrary paths, and the `selfWrittenPaths` Set accepts unbounded arbitrary strings (each with a 2 s timer — low-grade memory/timer DoS). |
| IPC-b | **Verified** | `generator:generateCode`, `generator:generateDialogCode`, `validation:validate`, `generator:saveFile` all accept `model: any` / `settings: any` / `options?: any` straight into services (`main.ts:91-184`). Malformed shapes throw inside try/catch (safe), but there is zero structural validation at the boundary. |
| IPC-c | **Verified** | `%2e`/`%2f`/`%5c` substring rejection (`PathValidationService.ts:76-84, 161-176`) is a false positive: local `fs` APIs never URL-decode, and `%`, `2`, `e` are legal filename characters on every platform (URL-encoded remnants in downloaded mod folder names are realistic). The check rejects legitimate paths while defending against a decode step that does not exist at this boundary. |

### Corrected / refined

- **S1 redirects**: the review implied no redirect handling; actually 301/302 are handled with a bound of 5 (both `httpsGet` and `doRequest`). **303/307/308 are not handled** and would fail the download if GitHub/S3 ever switches (307/308 preserve method and are the modern permanent/temporary forms). Fix is an extension, not greenfield.
- **S4 impact**: deny-by-default window-open **breaks** the "Open in new window" button in `DialogSourceViewDialog.tsx` — acceptable, since the code itself calls it a placeholder; plan removes the button rather than allow-listing `about:blank`.
- **S2 native-module risk is lower than feared**: both native modules are NAPI — `tree-sitter@0.21.1` depends on `node-addon-api@^8` + `node-gyp-build` (verified in the installed package), and `daedalus-parser`'s own binding is `#include <napi.h>` built with `prebuildify --napi`. Node-API is ABI-stable across Node/Electron majors, which is why `npmRebuild: false` works today and should keep working after the upgrade (must still be verified — see §2.7).

### New findings from this pass

| ID | Finding | Location |
|----|---------|----------|
| N1 | `build-windows.yml` can be dispatched on **any ref**; a rebuild of an old commit republishes the rolling release with an old-schema `update-meta.json`. A strictly-required sha256 verifier would then permanently brick auto-update for everyone on the new build. Drives the "tolerate missing hash for one release" rule in §2.1/§4. | `.github/workflows/build-windows.yml:3-4, 134-151` |
| N2 | Local TOCTOU on the installer: dest path is predictable (`%TEMP%\daedalus-update-<currentVersion>.exe`) and there is an arbitrary user-think-time gap between download-finish and the user clicking Install. Any local process can swap the file in between; `installUpdate` only compares the *path*. Verifying sha256 **immediately before spawn** (not only after download) closes this. | `UpdaterService.ts:157, 210-231` |
| N3 | `..`-prefix relative-path edge: containment check `!relativePath.startsWith('..')` falsely rejects legitimate children whose first segment merely *begins* with `..` (e.g. `<root>/..backup/x.d` → `relative()` = `..backup/x.d`). Correct check must be segment-aware. (`relativePath !== '..'` clause is also redundant as written.) | `PathValidationService.ts:119, 215` |
| N4 | `httpsGet` buffers unbounded response bodies into a string (metadata fetches; DoS-ish only, low). | `UpdaterService.ts:57-59` |
| N5 | `update-meta.json` and the installer are separate assets on a **mutable** tag: an attacker with repo write (or a compromised Action) can replace both consistently. In-release sha256 defends against corruption/truncation/CDN tampering, **not** against a release-level attacker — only code signing (or an out-of-band pinned key) does. Stated explicitly so sha256 isn't oversold. | design-level |

---

## 2. Fix design

### 2.1 Update integrity: sha256 in `update-meta.json`, verified before spawn (S1)

**Producer** (`.github/workflows/build-windows.yml`, "Generate update metadata" step): after "Normalize installer filename", compute over the exact published file:

```powershell
$hash = (Get-FileHash "daedalus-dialog-editor/dist/daedalus-dialog-editor-windows-latest.exe" -Algorithm SHA256).Hash.ToLowerInvariant()
$size = (Get-Item  "daedalus-dialog-editor/dist/daedalus-dialog-editor-windows-latest.exe").Length
```

Extend the metadata object with `sha256` (lowercase hex) and `size` (bytes). Extend `UpdateMetadata` in `src/shared/updater-types.ts`:

```typescript
export interface UpdateMetadata {
  version: string;
  baseVersion: string;
  buildNumber: number;
  sha256?: string;   // required from build N+1 on; optional for one release (see §4)
  size?: number;
}
```

**Consumer** (`UpdaterService`):

1. `checkForUpdate` stores the whole `UpdateMetadata` (not just the URL) as the pinned offer (`offeredMeta`), alongside `offeredDownloadUrl`.
2. `downloadUpdate`:
   - Redirect handling: treat `301 || 302 || 303 || 307 || 308` as redirects (same bounded loop, both in `httpsGet` and `doRequest`).
   - Stream through `crypto.createHash('sha256')` while piping to the file.
   - On finish: fail (and `unlink`) if `content-length` was present and `downloaded !== content-length`; fail if `meta.size` is present and `downloaded !== meta.size`; fail if `meta.sha256` is present and digest mismatches. Store `downloadedSha256` next to `downloadedInstallerPath`.
   - Missing-hash policy: **release R1** (the build that introduces verification) logs a warning and proceeds when `meta.sha256` is absent; **release R2** makes it a hard failure (delete the tolerance branch). See §4 for why.
3. `installUpdate`: before `spawn`, **re-hash the file on disk** and compare to the expected digest (`offeredMeta.sha256`, falling back to `downloadedSha256` during the R1 tolerance window). Mismatch → delete file, throw. This closes N2 (temp-file swap between download and install) as well.
4. `httpsGet`: cap the buffered body (e.g. 1 MiB — metadata only) (N4).

**Limitations to state in code comments**: sha256-in-the-same-release protects against truncation, CDN/proxy tampering, and local temp-file swaps — not against an attacker who can rewrite the release itself (N5).

**Code signing — the durable fix.** Cert acquisition (OV/EV cert or Azure Trusted Signing subscription) is an **owner decision**; plan the code side now so it's a config flip:

- `package.json` build block: add a `win` signing config driven entirely by env (electron-builder supports `CSC_LINK`/`CSC_KEY_PASSWORD`, or `win.azureSignOptions` for Azure Trusted Signing with electron-builder ≥ 26). Add `forceCodeSigning: true` **only in the CI packaging step's env** (`ELECTRON_BUILDER_FORCE_CODE_SIGNING`) once a cert exists, so local unsigned dev packaging keeps working.
- `build-windows.yml`: signing secrets via GitHub environment-protected secrets; sign both the app exe and the NSIS installer (electron-builder does both when configured).
- Updater defense-in-depth (post-signing phase): before spawn, verify Authenticode (`Get-AuthenticodeSignature` via a small PowerShell child process, checking `Status -eq 'Valid'` and the expected subject) — cheap and Windows-only, exactly where the installer runs.
- Manual-only validation: SmartScreen behavior and reputation build-up cannot be automated (§3).

### 2.2 Symlink-aware path validation + containment edge + `%2e` removal (S3, N3, IPC-c)

`PathValidationService` becomes async-capable (all call sites are already `async` IPC handlers in `main.ts` — verified, 5 call sites, all `validatePath`):

1. **Keep** the cheap lexical gates: type/empty, null byte, `[\r\n\t]`, absolute-path requirement.
2. **Delete** the `%2e/%2f/%5c/%25..` substring rejections (both in `isPathAllowed` and `validatePath`): local `fs` never URL-decodes, and the check false-positives on legal filenames. Update the class doc comment accordingly.
3. **Fix containment** to be segment-aware:
   ```typescript
   const rel = path.relative(allowedRoot, candidate);
   const inside = rel === '' || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel));
   ```
   (`!path.isAbsolute(rel)` also subsumes the Windows cross-drive case.)
4. **Resolve symlinks before containment** (new `async validatePathResolved(filePath)`, which `main.ts` switches to):
   - Allowed roots are canonicalized with `fs.realpath` **at add time** (`addAllowedPath` becomes async or performs lazy canonicalization on first use; roots added from dialogs exist by construction).
   - For the candidate: the file may not exist yet (save-as). Walk up to the **deepest existing ancestor**, `fs.realpath` it, re-join the non-existing tail, then run containment on the resolved path. Reject if any non-existing tail segment is `..` (already normalized away, but assert).
   - For **writes**, additionally `lstat` the final component when it exists and reject if it is a symlink/reparse point (a symlinked *file* inside the project pointing at e.g. `%APPDATA%` would otherwise pass because its parent resolves inside the root).
   - **Resolution order / TOCTOU caveat (document in code)**: realpath-then-write is check-then-use; a hostile *concurrently running* process can swap a directory for a symlink between validation and `fs.writeFile`. Node has no portable `O_NOFOLLOW`-for-every-ancestor open. The threat model here is a **malicious project folder** (static content), not a hostile concurrent local process (which could do worse things anyway) — the residual window is accepted and documented. Slice 2's atomic temp+rename write shrinks it further since the temp file name is unpredictable.
5. `isPathAllowed` keeps a sync lexical-only behavior for existing tests but is no longer the security boundary; the IPC boundary uses the async resolved variant. (Alternative: make both async and update tests — decide at implementation; prefer one async boundary function and demote `isPathAllowed` to internal.)

**Whitelist granularity narrowing** (`main.ts` + `PathValidationService`):

- Split the whitelist into `allowedRoots: Set<string>` (directories, recursive) and `allowedFiles: Set<string>` (exact canonical file paths).
- `file:openDialog` / `file:saveDialog`: whitelist the **selected file path only** (into `allowedFiles`), not its parent directory.
- `project:openFolderDialog`, recent-projects seeding, `settings:addRecentProject`, `project:addAllowedPath` (still gated by `isKnownRecentProject`): unchanged semantics, into `allowedRoots` (explicit project roots are the intended coarse grant).
- **UX impact assessment**: single-file mode only ever reads/writes that one file (verified: no sibling scanning outside project mode); Save-As always goes through `file:saveDialog`, which grants the new exact path. Project mode is untouched. Expected user-visible change: none. Watch item: a symlinked/junctioned project layout (modders sometimes junction script dirs into the Gothic install) whose junction target lies **outside** the chosen root will now be rejected — the error message must tell the user to open the *real* folder (or add it as a project root via the folder dialog). This is the correct security behavior but must be a readable error, not a silent failure.

### 2.3 `setWindowOpenHandler` + `will-navigate` deny-by-default (S4)

In `createWindow()` (`main.ts`):

```typescript
mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
mainWindow.webContents.on('will-navigate', (event, url) => {
  const allowed = process.env.NODE_ENV === 'development'
    ? url.startsWith('http://localhost:5173')
    : url === mainWindow!.webContents.getURL(); // file: reloads only
  if (!allowed) event.preventDefault();
});
```

Renderer follow-up: remove the "Open in new window" button and `handleOpenInNewWindow` from `DialogSourceViewDialog.tsx` (self-described placeholder; content is already shown in the in-app dialog). No allow-list for `about:blank` — nothing legitimate opens windows.

### 2.4 Validate `fileWatcher:notifySelfWrite` (IPC-a)

In the `main.ts` handler: run the same async path validation as `file:write`; unknown/invalid paths are ignored with a `console.warn` (not thrown — the renderer calls this fire-and-forget after saves). Additionally cap `selfWrittenPaths` (e.g. refuse when `size > 1000`) as cheap DoS hygiene. Note: `generator:saveFile` and `file:write` already call `notifySelfWrite` main-side *after* validation, so the renderer-exposed channel is only needed for legacy/renderer-driven flows — if a usage audit shows the renderer no longer needs it, **removing the channel from preload entirely** is the better fix (prefer this; fall back to validation if a caller exists: `preload.ts:38`).

### 2.5 Atomic + serialized SettingsService writes (S6)

- **Serialize**: a private promise-chain mutex (`this.queue = this.queue.then(op)`) wrapping every public read-modify-write method, so setters can no longer interleave.
- **Atomic write**: write to `settings.json.tmp` in the same directory, `fsync` (best-effort), then `fs.rename` over `settings.json`.
- **Stop swallowing write errors**: let them reject; IPC callers already wrap in try/catch and surface a message.
- **Corrupt-file handling**: on JSON parse failure, rename the corrupt file to `settings.json.corrupt-<timestamp>` before falling back to defaults, and log loudly — the file seeds the security whitelist, so silent reset destroys evidence and grants nothing back to the user.

### 2.6 IPC payload shape validation for generator/validation channels (IPC-b)

Cheap structural checks in `main.ts` (a tiny local helper, not a schema library):

```typescript
function assertModelShape(m: unknown): asserts m is object {
  if (!m || typeof m !== 'object' || Array.isArray(m)) throw new Error('Invalid model payload');
  // dialogs/functions, when present, must be plain objects
}
```

Apply to `generator:generateCode`, `generator:generateDialogCode` (also `typeof dialogName === 'string'`), `validation:validate`, `generator:saveFile` (`settings`: object-or-undefined; `options`: object with only boolean `skipValidation`/`forceOnErrors`). Reject early with a clear error instead of relying on deep service internals to throw. No full-schema validation — the services already fail safe inside try/catch; this is boundary hygiene.

### 2.7 Electron upgrade off 29 (S2) — phased

**Target**: Electron has **no LTS line** — only the latest 3 stable majors receive security fixes. As of the author's knowledge cutoff (Jan 2026) the latest stable was around Electron 38/39; by mid-2026 the supported window is likely ~Electron 39–41. **Uncertainty flagged: confirm the current stable major on electronjs.org/releases at implementation time and target that**, accepting the ~8-week major cadence means "latest stable", not a fixed number in this plan.

Risk areas enumerated for this codebase:

1. **Native modules / ABI (`npmRebuild: false`)** — both native deps are Node-API: `tree-sitter@0.21.1` (node-addon-api 8 + node-gyp-build, verified in installed package) and `daedalus-parser`'s binding (`bindings/node/binding.cc` uses `napi.h`, built with `prebuildify --napi`). Node-API is ABI-stable across Electron/Node majors, so `npmRebuild: false` should remain valid and `@electron/rebuild` should stay unnecessary. **Verify, don't assume**: after the bump, run the packaged-app smoke test AND an actual parse in the packaged app (the current smoke test only checks "didn't exit in 8 s" — extend it to invoke a parse via the app or keep a checklist item). If a non-NAPI native dep ever appears, `npmRebuild: false` becomes a foot-gun; document that invariant in the build block.
2. **`worker_threads` + native addon** — `ParserService`/`MetadataWorkerPool` load the NAPI parser inside `worker_threads` in the main process. NAPI modules are context-aware, so this is expected to keep working, but worker+addon regressions have occurred historically in Electron; cover with a main-process integration test that round-trips a parse through the real worker under the new Electron (`electron`-launched, not plain Node — plain-Node Jest does not exercise Electron's Node).
3. **Dual version pins** — bump `devDependencies.electron` and `build.electronVersion` together (`package.json:43,107`); better: delete `build.electronVersion` and let electron-builder infer from the devDependency, removing the drift hazard (N4-adjacent).
4. **electron-builder 24.13** — likely too old to know post-31 Electron/NSIS metadata; bump to current electron-builder (≥26) in the same phase. Re-verify the NSIS artifact name that `build-windows.yml` globs (`*.exe`) and the `app.asar` layout that "Verify packaged app dependencies" asserts (`\\node_modules\\safe-buffer\\index.js` paths).
5. **Renderer defaults & removed APIs** — sandbox has defaulted on since Electron 20 and the preload only uses `contextBridge`/`ipcRenderer` (compatible). `File.path` removal (Electron 32) does not affect this codebase (no drag-drop `.path` usage — verified by grep). No `remote`, no `sendSync`, no WebSQL. `--no-sandbox` flag in `dev:electron` still supported.
6. **litegraph eval + CSP** — litegraph.js uses `eval`/`new Function`; the renderer currently ships **no CSP**, so nothing breaks at runtime on upgrade. The CI build guard whitelists litegraph's eval warning (`all-tests.yml:49-54`) — keep the whitelist. Explicit non-goal: introducing a CSP is desirable but would break litegraph and is out of scope for this slice; note it as a follow-up blocked on litegraph replacement/patch (see `docs/refactoring-targets.md` candidates).
7. **Node major bump** (Electron 29 bundles Node 20.9 → target bundles Node ≥22): main-process code is small and standard (`fs/promises`, `https`, `child_process`, `worker_threads`); no known removals used. `@types/node` bump to match.
8. **Toolchain compat** — Playwright `_electron` (slice 8), `vite-plugin-electron`, and the `wait-on`-based dev script: dev-only, verify by running `npm run dev` and the smoke pass.

Phasing: single hop 29 → latest stable (NAPI removes the usual reason for multi-hop), but budget a checkpoint after the version bump + electron-builder bump where the full matrix runs (Jest, packaged smoke incl. a real parse, manual dev smoke) before layering anything else on the new baseline.

---

## 3. Test plan (TDD: failing test first where testable)

### PathValidationService (`tests/PathValidationService.test.ts`, extend)

Failing-first unit tests against the real filesystem via `fs.mkdtemp` fixtures:

1. **Symlink escape (dir)**: `<root>/link -> <outside>`; `validatePathResolved('<root>/link/x.d')` must reject. Fails today (lexical pass).
2. **Symlink escape (file, write)**: `<root>/evil.d -> <outside>/target`; write-mode validation must reject. Fails today.
3. **Symlink within allowed roots**: `<rootA>/link -> <rootB>` with both whitelisted → allowed (guards against over-blocking).
4. **Non-existent target (save-as)**: `<root>/new/sub/file.d` where `new/` doesn't exist → allowed; `<root>/link-out/new.d` where `link-out` escapes → rejected.
5. **`..`-prefix sibling edge (N3)**: `<root>/..backup/x.d` → allowed. Fails today (`startsWith('..')`).
6. **`%2e` literal filename (IPC-c)**: `<root>/mod%2e5/x.d` → allowed. Fails today.
7. **Traversal regressions stay red**: existing `..`-escape and cross-drive tests keep passing against the new resolved variant.
8. Windows caveat: symlink creation on Windows CI may need Developer Mode; wrap symlink fixtures in a capability probe and `test.skip` when unavailable (CI Jest runs on ubuntu, where they always run).

**Whitelist granularity** (Jest, main-process handler level or service level): after simulating `file:openDialog` selection of `<dir>/a.d`, `file:read('<dir>/b.d')` must be rejected while `<dir>/a.d` passes. Fails today.

### SettingsService (`tests/SettingsService.test.ts`, extend)

1. **Serialization**: fire `addRecentProject` + `setUpdaterLastCheckTimestamp` + `setUpdaterAutoCheck` concurrently (no awaits between starts); final file must contain all three effects. Fails today (interleaved read-modify-write).
2. **Atomicity**: assert write goes through temp-file + `rename` (spy on `fs.rename`), and that a `writeFile` failure leaves the previous `settings.json` intact and **rejects** (fails today: error swallowed).
3. **Corrupt file preserved**: seed invalid JSON; a read must produce defaults *and* leave a `settings.json.corrupt-*` sibling. Fails today.

### UpdaterService (`tests/services/UpdaterService.test.ts`, extend — mocked `https` fixture pattern already established there)

1. **sha256 happy path**: mocked download stream with known bytes; meta `sha256` = digest → resolves. 
2. **sha256 mismatch**: wrong digest → rejects, file unlinked. Fails today (no verification exists).
3. **size / content-length mismatch**: `content-length: 100`, stream 50 bytes → rejects; `meta.size` mismatch → rejects. Fails today.
4. **Missing-hash tolerance (R1 behavior)**: meta without `sha256` → warns + proceeds (this test is deleted/inverted in R2).
5. **307/308 redirect**: mocked 307 then 200 → succeeds; bounded-redirect test extended to 307/308. Fails today (`statusCode !== 200` branch).
6. **Install-time re-hash (N2)**: after successful download, mutate the file on disk; `installUpdate` must throw and not spawn. Fails today.

### Producer (CI) verification

- No unit-testable seam in the workflow; add a **post-publish assertion step** in `build-windows.yml` that re-downloads `update-meta.json` + installer from the just-published release and verifies the sha256 matches — this makes the producer self-checking on every run.

### window-open / will-navigate

- Extract the guard wiring into a testable `applyWindowSecurity(webContents)` helper; Jest-test with a stub `webContents` (deny handler returns `{action:'deny'}`; `will-navigate` to `https://evil` calls `preventDefault`). Real-Electron verification belongs to slice 8's Playwright `_electron` subset (add "window.open stays denied in packaged app" to that list).

### IPC shape validation

- Handler-level Jest tests: `generator:generateCode(null)`, `(\"string\")`, `({dialogs: 42})` → clear rejection before service invocation (spy: service not called).

### Manual-only verification

- Signed installer: signature shows the right subject (`Get-AuthenticodeSignature`), SmartScreen prompt behavior on a clean VM, NSIS silent update end-to-end from a previous installed build (real GitHub release round-trip).
- Electron upgrade: packaged-app smoke with a real project open/edit/save; dev-mode smoke (`npm run dev`, node-editor playground per CLAUDE.md).
- Junction-heavy project layout (Windows): confirm the new symlink rejection produces a readable error and the documented workaround works.

---

## 4. Ordering, dependencies, risks, sizes

**⚠ Update-chain sequencing constraint (the one thing that must not be gotten wrong):** every existing install runs a verifier-less updater and updates from a single mutable rolling release. The build that *introduces* the strict verifier is itself delivered unverified — unavoidable and fine. The failure mode is the other direction: if a client running the strict verifier ever fetches an `update-meta.json` **without** `sha256`, auto-update fails hard and — because the tag is rolling with no versioned fallback — that user is **permanently stuck** until they manually download an installer. This can happen even after CI is fixed, because `build-windows.yml` is `workflow_dispatch` on any ref (N1): one rebuild of an old commit republishes old-schema metadata. Therefore:

1. **R1 (one release)**: CI producer change (sha256+size in metadata) **and** consumer verification land in the *same commit/release*, with the verifier **tolerant** of a missing hash (warn + proceed). 
2. **R2 (next release)**: flip the verifier to hard-require `sha256`, and add a workflow guard (refuse to publish if the ref is not `main`'s head, or at minimum refuse if the metadata step would emit no `sha256`).
3. Never reorder: strict verifier before producer = broken chain; producer alone = no protection but harmless.

**Fix order and sizes:**

| # | Fix | Size | Depends on | Risk notes |
|---|-----|------|-----------|------------|
| 1 | **DONE (2026-07-03)** — SettingsService atomic + serialized + corrupt-preserve (§2.5) | S | — | Foundation: settings seed the whitelist. Behavior change: write errors now propagate (IPC already wraps). |
| 2 | **DONE (2026-07-03)** — PathValidationService: remove `%2e` checks, N3 containment fix, symlink-aware async validation, whitelist narrowing (§2.2) | M | 1 (whitelist seeding) | Main risk is over-blocking legitimate junction-based mod setups → needs the readable-error path and manual junction test (manual junction test on Windows still outstanding, §3). `validatePath` → async ripples through 5 `main.ts` call sites (all already async). |
| 3 | **DONE (2026-07-03)** — window-open/will-navigate deny + remove placeholder button (§2.3); notifySelfWrite channel removal — audit found no renderer caller (§2.4); IPC shape checks (§2.6) | S | — (parallel with 2) | Low risk; button removal is user-visible but the feature never worked as intended. Note: §2.6 additionally allows boolean `overwriteExternal` in `generator:saveFile` options — the live handler uses it. |
| 4 | **DONE (2026-07-03)** — Updater integrity R1: CI sha256/size producer + tolerant verifier + 303/307/308 + content-length + install-time re-hash + post-publish CI assertion (§2.1) | M | sequencing rule above | Must ship as one release. Coordinate with slice 8 (release gating) — the ref-guard on `workflow_dispatch` overlaps; whoever lands first adds it. |
| 5 | Updater integrity R2: strict sha256 requirement | S | 4 shipped to users | Trivial code; the risk is purely sequencing (see constraint). |
| 6 | Code signing (code side: builder config, CI secrets wiring, Authenticode pre-spawn check) (§2.1) | M (code) | owner cert decision; ideally after 7 (electron-builder bump) | Blocked on cert acquisition (owner). Azure Trusted Signing needs electron-builder ≥ 26 → weak dependency on 7. |
| 7 | Electron 29 → latest stable + electron-builder bump + drop `build.electronVersion` pin (§2.7) | L | best after 1–5 (don't debug a new runtime and new security code simultaneously); slice 3 (worker reliability) ideally first since workers are the top ABI-risk surface | Verify NAPI assumption in packaged app; extend smoke test to exercise a real parse. Coordinate with slice 8 for real-Electron E2E as the upgrade's safety net. |

**Cross-slice dependencies**: slice 8 (release gating/real E2E) owns wiring tests before publish — fix 4's post-publish hash assertion and the ref-guard should merge with that work rather than duplicate it. Slice 2 (atomic file writes) shares the temp+rename pattern with fix 1 but targets different files; no code dependency. Slice 3's worker restart logic should land before fix 7 so worker failures under the new Electron surface as errors instead of hangs.

**Done criteria** (per repo working agreement): all new tests green, `npm test` + `npm run typecheck` clean in the editor workspace, R1/R2 releases published in order, manual checklist (§3) executed for signing and the Electron bump; then extract durable outcomes (path-validation invariants, update-chain contract incl. the sequencing rule, signing setup) into `docs/architecture/` / `docs/reference/` and delete this plan.
