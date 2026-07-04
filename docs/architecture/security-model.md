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

## Window / navigation lockdown

`createWindow()` installs deny-by-default handlers: `setWindowOpenHandler` denies
all `window.open`, and `will-navigate` is blocked except dev-server localhost and
same-URL `file:` reloads. The self-described placeholder "Open in new window"
button was removed with it. Baseline was already sound (contextIsolation on,
nodeIntegration off, invoke-only preload).

## Update integrity (landed R1 behavior)

`update-meta.json` carries `sha256` + `size`; the updater:

- pins the whole offered metadata (not just the URL) from the last check;
- streams the download through a sha256 hash and fails (and unlinks) on a
  `content-length`, `size`, or digest mismatch; handles `301/302/303/307/308`
  redirects (bounded at 5); caps buffered metadata bodies;
- **re-hashes the file on disk immediately before `spawn`** — closing the
  temp-file-swap window between download and install.

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
