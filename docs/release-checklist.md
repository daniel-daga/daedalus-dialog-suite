# Pre-Release Checklist

Work to do **before cutting a first public release**. Nothing here is blocking
current development — all code-review remediation *code* has landed and is
CI-green (see [`plans/code-review-remediation.md`](./plans/code-review-remediation.md)).
These items are **parked**, not pending: they only become relevant once the app
is shipped to real users, or they depend on an owner decision (a code-signing
cert), or they are manual desktop/packaged QA that can't run in CI.

**Status as of 2026-07-04:** no releases exist yet. The rolling release tag
(`windows-latest`) has never been published from this remediation work, so every
item below that is gated on "a release having shipped" is simply not yet due.

**Amended 2026-08-27.** Still no releases. But this file was written against the
dialog/quest app, and the **level editor did not exist yet** — it is a whole
subsystem that can write a world file, and §4 gained one item for it. Treat the
rest of this checklist as covering the app this file knew about; anything about
worlds is in the GitHub issues and `docs/plans/level-editor.md`.

---

## 1. Update chain

The updater ships an integrity-verification path today (sha256 + size checked
before the installer is spawned, plus an install-time re-hash), but it is in its
**tolerant (R1)** phase: a missing `sha256` in `update-meta.json` logs a warning
and proceeds. See [`architecture/security-model.md`](./architecture/security-model.md)
for the landed behavior.

### The R1 → R2 sequencing rule (do not get this wrong)

Every installed client updates from a single **mutable** rolling release and runs
whatever verifier it shipped with. The failure mode is one-directional: if a
client running the **strict** verifier ever fetches an `update-meta.json` that
lacks `sha256`, auto-update fails hard and — because the tag is rolling with no
versioned fallback — that user is **permanently stuck** until they manually
reinstall. An old-schema metadata file can reappear even after CI is correct
(e.g. a `build-windows` dispatch that rebuilds an old commit).

Therefore:

1. **R1 (the first release):** producer emits `sha256` + `size`, consumer verifies
   but **tolerates** a missing hash. *(Code landed; ships with the first release.)*
2. **R2 (a later release):** flip the verifier to **hard-require** `sha256` — only
   after an R1 build has actually reached users.
3. Never reorder. Strict-before-tolerant = bricked update chain.

### To do

- [ ] **Fix 5 — flip to the strict verifier (R2).** Delete the missing-hash
  tolerance branch in `UpdaterService` (warn → hard failure). **Precondition:** a
  tolerant (R1) build has shipped and been adopted. Not due until then.

## 2. Code signing (owner decision)

The installer is currently **unsigned**; the code side is written to be a config
flip once a certificate exists. This is an **owner decision** (OV/EV cert or an
Azure Trusted Signing subscription) with a real cost, deliberately deferred while
prototyping.

- [ ] Acquire a signing identity (cert or Azure Trusted Signing).
- [ ] Wire signing into `package.json` `build.win` (env-driven: `CSC_LINK` /
  `CSC_KEY_PASSWORD`, or `win.azureSignOptions`) and set
  `ELECTRON_BUILDER_FORCE_CODE_SIGNING` in the CI packaging step only (keep local
  unsigned dev packaging working).
- [ ] Store signing secrets as environment-protected GitHub secrets; sign both the
  app exe and the NSIS installer.
- [ ] Add the post-signing defense-in-depth check: verify Authenticode
  (`Get-AuthenticodeSignature`, `Status -eq 'Valid'` + expected subject) before
  the updater spawns the installer.
- [ ] Manual: confirm SmartScreen behavior on a clean VM and let reputation build.

## 3. Release-gating dispatch verification

The release pipeline is structurally gated (see
[`architecture/security-model.md`](./architecture/security-model.md) →
"Release gating"): `build-windows.yml` runs the full `all-tests.yml` matrix +
the Windows real-Electron E2E job via `workflow_call`, is guarded to
`refs/heads/master`, serializes publishes with a `concurrency` group, and fails a
stale re-run via `git ls-remote`. The *logic* is landed and CI-green; the
**maintainer-run dispatch checklist** that proves the guards fire has not been
executed (it needs a real dispatch).

- [ ] Dispatch `build-windows` on a **non-master** branch → the `build` job is
  skipped, no release published.
- [ ] Dispatch on `master` with a deliberately red test on a scratch commit → the
  `build` job never runs.
- [ ] Re-run an **old** successful run → the stale-run guard fails before publish.
- [ ] Successful `master` dispatch → release published; the post-publish integrity
  step is green (or warn-skipped while `sha256` is still absent).
- [ ] This dispatch also exercises the new `e2e-electron-windows` job (Windows real
  Electron) for the first time — confirm it runs and gates packaging.

## 4. Manual desktop / packaged QA

Automated coverage (Jest + structural + Playwright browser & real-Electron) backs
the substance of each item below; these are the human passes CI can't do.

- [ ] **Packaged Windows smoke + real parse** (Electron 43 upgrade). Install the
  packaged build, open a real project, edit + save, confirm the native parser
  loads and round-trips through the worker path. (CI's `editor-e2e-electron` under
  Electron 43 is the automated safety net; this is the packaged-app confirmation.)
- [ ] **Junction / symlink project layout.** On Windows, open a project whose script
  dir is a junction whose target lies outside the chosen root → confirm the new
  symlink-aware validation produces a **readable error** with the documented
  workaround (open the real folder / add it as a project root), not a silent
  failure.
- [ ] **Upgrade smoke.** From a previously installed build, run the NSIS silent
  update end-to-end against a real rolling release (metadata + installer round
  trip).
- [ ] **Render performance — React Profiler evidence.** Against a mod-scale fixture
  (`npm run perf:fixture`), capture before/after React DevTools Profiler traces:
  typing into a dialog line commits only the edited card's subtree; the ingestion
  window doesn't re-render App-rooted; Variable Manager doesn't re-render on a
  dialog keystroke.
- [ ] **Quest editor desktop eyeball.** Literal click-through of the quest
  list/details/create surface in the packaged / `npm run dev` Electron app.
- [ ] **World surface desktop eyeball — the whole subsystem postdates this
  file.** The level editor (World surface, VOB editing, save) arrived after this
  checklist was written and has no other item here. CI now proves the packaged
  app *opens* a world (`DDE_SMOKE_OPEN_WORLD` in `build-windows.yml`), but
  **nothing automated has watched the packaged renderer draw one** — that gap is
  an open issue. So: open a retail world in the packaged build,
  confirm the viewport renders, pick and edit a VOB, save, and re-open. Note
  that a world edited through the UI has an engine verdict only for the five ops
  Gate 2 tested — `DeleteVob`, `MoveWaypoint` and `SetVobClassProp` have none
  (see `zenkit-node/docs/engine-acceptance-2026-08-25.md`), which is a shipping
  decision rather than a QA step.
