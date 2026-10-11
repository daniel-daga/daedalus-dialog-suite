# Real-Electron E2E suite (`tests/e2e-electron/`)

This is the **actual** end-to-end suite: every spec launches the built Electron
app via Playwright's `_electron.launch` (see `harness.ts`), so it exercises the
**real preload bridge, real IPC, the real native parser, and real disk writes**.

Contrast with `tests/e2e/` (the browser mock harness): that suite runs the
renderer in plain Chromium against a localStorage-backed fake main process and
must not assert saved/generated file content. **Disk-truth and real-IPC
assertions live here** — reading bytes back off disk, reparsing them through the
`daedalus-parser` package, checking the main-process crash log, verifying window
security handlers, etc.

Config: `playwright.electron.config.ts` (separate `testDir`, no webServer,
`workers: 1`, `retries: 1` on CI, 60 s timeout). Each test gets an isolated
temp `userData` dir (via the `DDE_E2E_USER_DATA` seam in `src/main/main.ts`) and
per-test temp project dirs, so no state bleeds between tests.

## Running locally

The app must be **built first** — the harness launches with `NODE_ENV=production`,
which loads `dist/renderer/index.html`, and Electron resolves `dist/main/main.js`:

```bash
npm run build            # produces dist/main + dist/renderer
npx playwright test -c playwright.electron.config.ts
```

On Linux, Electron needs a display; run under xvfb:

```bash
xvfb-run --auto-servernum npx playwright test -c playwright.electron.config.ts
```

The Electron binary is provided by the normal `pnpm install` (electron's
postinstall) — no `playwright install` is needed, since Electron *is* the
browser here.
