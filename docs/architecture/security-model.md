# Security Model

Durable security invariants for the Electron editor's main process, established by
the code-review remediation (slice 6). This documents **landed, shipping
behavior** and the reasoning behind a few non-obvious choices. Deferred hardening
(code signing, the strict updater verifier) lives in
[`../release-checklist.md`](../release-checklist.md).

## Threat model

The realistic adversary is a **malicious or malformed project folder** (static
content a user opens — mod archives, junctioned script trees), not a hostile
process running concurrently on the same machine. A local process that can race
our filesystem calls can already do worse things directly; we do not defend
against it, and the residual TOCTOU windows below are accepted with that in mind.

## Filesystem / path validation

`PathValidationService` resolves symlinks before deciding containment — it is
**not** purely lexical.

- **Symlink-aware containment.** Allowed roots are canonicalized (`fs.realpath`);
  a candidate path is resolved against its deepest existing ancestor and the
  non-existent tail re-joined, then checked for containment. A symlink/junction
  inside a whitelisted dir that points outside it is rejected. For **writes**, the
  final component is additionally `lstat`-checked and rejected if it is a
  symlink/reparse point.
- **Segment-aware containment.** Containment uses a segment-aware relative-path
  check, so a legitimate sibling whose name merely *begins* with `..` (e.g.
  `<root>/..backup/x.d`) is not falsely rejected.
- **The `%2e`/`%2f`/`%5c` substring checks were deliberately removed — do not
  re-add them.** Local `fs` APIs never URL-decode; `%`, `2`, `e` are legal
  filename characters, so the checks only false-positived on real mod folder
  names while defending against a decode step that does not happen at this
  boundary.
- **Whitelist granularity.** The grant is split: picking a single file
  (`file:openDialog`/`file:saveDialog`) whitelists **that exact file only**;
  opening a project folder grants its root **recursively**. Single-file mode never
  reads siblings; Save-As re-grants through the save dialog.
- **Accepted TOCTOU window.** realpath-then-write is check-then-use; Node has no
  portable per-ancestor `O_NOFOLLOW`. Per the threat model this is accepted and
  documented in code. Slice 2's atomic temp+rename write (unpredictable temp name)
  shrinks it further. See [`save-pipeline.md`](./save-pipeline.md).

Junction-heavy mod layouts whose target lies outside the chosen root are now
rejected by design — the error must be readable and point the user at the real
folder. A manual Windows pass on this UX is in the
[release checklist](../release-checklist.md#4-manual-desktop--packaged-qa).

## IPC boundary hardening

- **Structural payload checks** on `generator:generateCode`,
  `generator:generateDialogCode`, `validation:validate`, and `generator:saveFile`
  reject malformed `model`/`settings`/`options` shapes early (cheap local asserts,
  not a schema library) rather than relying on deep service internals to throw.
- The renderer-exposed `fileWatcher:notifySelfWrite` channel was **removed** — an
  audit found no renderer caller; `generator:saveFile`/`file:write` already notify
  the watcher main-side after validation.
- The renderer-exposed `settings:addRecentProject` channel was **removed** — it
  called `addAllowedPath` on an unvalidated renderer-supplied path and persisted it
  into recents (which `project:addAllowedPath` then trusts forever), so a
  compromised renderer could whitelist e.g. `C:\` and read/write anywhere. Recents
  are now recorded main-side only, inside `project:openFolderDialog` after the OS
  dialog returns a real folder.
- `fileWatcher:start` now runs `validatePathResolved` on its argument like every
  other path-accepting handler; it was previously the only one without the check,
  so the renderer could aim the watcher at an arbitrary directory.

## Window / navigation lockdown

`createWindow()` installs deny-by-default handlers: `setWindowOpenHandler` denies
all `window.open`, and `will-navigate` is blocked except dev-server localhost and
same-URL `file:` reloads. The self-described placeholder "Open in new window"
button was removed with it. Baseline was already sound (contextIsolation on,
nodeIntegration off, invoke-only preload).

## Content Security Policy

The renderer ships a strict policy in `src/renderer/index.html`:

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
font-src 'self' data:; img-src 'self' data:; worker-src 'self' blob:;
connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none';
frame-src 'none'
```

**Why a `<meta>` tag and not `onHeadersReceived`.** Production loads the
renderer with `loadFile` over `file://` (`main.ts`), and `onHeadersReceived`
never fires for `file://` requests — a `session.webRequest` handler would be a
no-op in exactly the build that matters. The policy therefore travels in the
document. Note this is also why `windowSecurity.ts` does not cover it:
`will-navigate` fires for navigations, not subresource loads, so it never saw
the script fetches this policy governs.

**No `unsafe-eval`.** litegraph was the only consumer and went with the quest
Flow view. Verified rather than assumed: the emitted renderer chunks contain
zero `eval(` / `new Function(`, and CI's renderer build step fails on a Rollup
eval warning.

**No remote origin.** Monaco was the one thing the renderer fetched from the
network — `@monaco-editor/react` defaults to loading it from jsdelivr at
runtime by appending a `<script>` to the document. Carving
`https://cdn.jsdelivr.net` out of `script-src` would have kept a remote
script-execution origin in a `file://` renderer, so Monaco is served from the
app's own origin instead; see
[`render-performance.md`](./render-performance.md) for how, and why bundling it
was not the answer. **`script-src` is deliberately `'self'` with no host list:
if a future dependency wants a CDN, the fix is to vendor it, not to widen this.**

**The two concessions, and why they are not script execution.**
`style-src 'unsafe-inline'` is required by emotion/MUI and Monaco, which both
inject `<style>` at runtime; inline *style* cannot execute code. `worker-src`
allows `blob:` alongside `'self'` because Monaco's worker bootstrap uses either
shape depending on origin. Nothing grants inline or remote *script*.

`tests/contentSecurityPolicy.test.ts` guards all of the above, including the
two ways the policy silently rots: an eval hole, and a renderer source file
reaching for a remote origin (it asserts every `@monaco-editor/react` call site
is pinned to the local path, so a new one cannot quietly reinstate the CDN).

**Not covered by this policy.** It governs the renderer only. Main-process
network access (the updater) is unaffected — see *Update integrity* below.

## Update integrity (landed R1 behavior)

`update-meta.json` carries `sha256` + `size`; the updater:

- pins the whole offered metadata (not just the URL) from the last check;
- streams the download through a sha256 hash and fails (and unlinks) on a
  `content-length`, `size`, or digest mismatch; handles `301/302/303/307/308`
  redirects (bounded at 5); caps buffered metadata bodies;
- **re-hashes the file on disk immediately before `spawn`** — closing the
  temp-file-swap window between download and install.

**When a check happens.** The renderer's startup timer is the only caller of
`updater:checkForUpdate`, so the persisted updater settings are honoured in
`UpdaterService.checkForUpdate` rather than in the renderer: `autoCheckOnStartup:
false` returns "no update" before any network call, and a `latestVersion` equal
to `dismissedVersion` is not offered. "Skip This Version" in the update dialog is
what writes `dismissedVersion`, through `updater:dismissVersion`; a build newer
than the dismissed one is offered again, because the comparison is exact.

**Tolerant (R1) phase:** a missing `sha256` warns and proceeds. Flipping this to a
hard requirement is the **strict (R2)** step, gated on the R1→R2 sequencing rule
in the [release checklist](../release-checklist.md#1-update-chain).

**What sha256-in-the-same-release does and does not do:** it protects against
truncation, CDN/proxy tampering, and local temp-file swaps. It does **not** defend
against an attacker who can rewrite the release itself — only code signing (or an
out-of-band pinned key) does. That is why signing is on the release checklist.

CI is the producer and self-checks: `build-windows.yml` computes the hash/size over
the exact published installer and re-downloads the published assets post-publish to
verify the digest matches.

## Settings persistence integrity

`SettingsService` seeds the path whitelist, so its integrity is a security
concern. Writes are **atomic** (temp file + `rename`) and **serialized** through a
promise-chain mutex so concurrent setters can't interleave and drop one another's
fields. Write errors propagate (no longer swallowed). A corrupt `settings.json` is
renamed to `settings.json.corrupt-<timestamp>` and logged before falling back to
defaults — a silent reset would destroy the whitelist evidence.

## Electron / native-module baseline

Runtime is Electron 43 (bundled Node 24), packaged with electron-builder 26; the
single `build.electronVersion` pin was removed so the builder infers from the
devDependency. Both native modules are **Node-API** (`tree-sitter` and
`daedalus-parser`'s binding), which is ABI-stable across Electron/Node majors —
this is why `npmRebuild: false` holds. That invariant, and the worker/NAPI safety
net (CI's real-Electron E2E suite), are documented in
[`worker-reliability.md`](./worker-reliability.md).

## Release gating

Publishing is structurally gated, so releasing from a red tree is not possible:
`build-windows.yml`'s `build` job `needs` both the full `all-tests.yml` matrix
(via `workflow_call`) and a Windows real-Electron E2E job, is guarded to
`refs/heads/master`, serializes publishes with a `concurrency` group, and fails a
stale re-run by comparing `github.sha` against the live `master` head
(`git ls-remote`). There is intentionally **no `skip_tests` escape hatch** — the
break-glass path is reverting the offending commit. The maintainer dispatch that
proves each guard fires is in the
[release checklist](../release-checklist.md#3-release-gating-dispatch-verification).
