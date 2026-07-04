# Worker Reliability Architecture

This document captures the durable decisions for the two worker pools in the
editor's main process: the long-lived `ParserService` pool and the per-build
`MetadataWorkerPool`. Both run tree-sitter + the semantic visitor passes in
Node `worker_threads`.

## Pool lifecycle

- **`ParserService`** — a keep-alive pool of native parser workers used by all
  hot-path parsing (file open, save re-parse/validation, navigation, background
  ingestion). It has restart-with-replacement semantics so a dead worker leaves
  rotation and is respawned rather than being routed to forever.
- **`MetadataWorkerPool`** — spawned **once per project open** by
  `ProjectService.buildProjectIndex` and torn down in that method's `finally`.
  This is the deliberate design (see "Per-build spawn" below), not an oversight.

## Per-build spawn (PF4 decision)

The metadata pool is intentionally recreated per index build rather than kept
alive for the session:

- `buildProjectIndex` runs only from `projectStore.openProject` — a rare,
  user-initiated, spinner-covered operation. File-watcher changes go through
  `parseDialogFile` (the `ParserService` pool), not index rebuilds.
- A keep-alive metadata pool would hold up to 8 native parser instances (tens of
  MB each) resident for the whole session to accelerate an operation that
  happens roughly once per session, and would need extra lifecycle machinery
  (idle state across builds, restart-cap resets, quit teardown).
- The real cost concerns are fixed directly instead: the worker count is capped
  (below) and the settlement guarantees ensure `terminate()` in the `finally` is
  always reached, so pools can no longer leak across builds.

## Worker count caps

Both pools cap at `Math.max(1, Math.min(os.cpus().length - 1, 8))` — one core is
left for the main thread/event loop, and the cap bounds native parser instances
(each loads the parser and uses tens of MB) on high-core machines.

## Timeout

Per-request timeout is **30 000 ms** (`DEFAULT_PARSE_TIMEOUT_MS` /
`DEFAULT_TASK_TIMEOUT_MS`, constructor-overridable for tests). Rationale: real
Gothic 2 / MDK `.d` files top out around 1–2 MB and parse in well under 2 s on
modest hardware; 30 s is >10× the worst plausible legitimate parse, so false
timeouts are effectively impossible, while a genuine native hang still surfaces
inside a window where the save-status UI is meaningful. Shorter values risk
killing legitimate parses of large-but-valid mod files during ingestion bursts.

## Failure classification contract

Rejections that cross IPC carry a stable prefix in the `Error.message` so the
renderer can classify them without new IPC channels. `WorkerRequestError`
(`src/main/services/WorkerRequestError.ts`) has `kind` and embeds:

| kind             | message prefix     | meaning                                   |
|------------------|--------------------|-------------------------------------------|
| `timeout`        | `PARSE_TIMEOUT:`   | request exceeded the timeout              |
| `worker-crashed` | `PARSER_CRASHED:`  | worker `error`/`exit`, or crash-loop cap  |
| `pool-terminated`| `POOL_TERMINATED:` | request outstanding when the pool tore down |

The renderer classifies save rejections via these substrings
(`src/renderer/utils/saveError.ts`) into `FileState.saveError` and never clears
`isDirty` on a failed save. Per-file metadata failures instead **resolve** as
`MetadataFailure` and are surfaced through `ProjectIndex.metadataFailures`
(the project still opens, degraded visibly rather than silently).

## Restart guards

Replacement spawns are capped per pool:

- `ParserService` — a sliding-window cap; past it, `parseSource` rejects
  immediately with a "crash-looping — restart the app" error instead of
  respawning forever.
- `MetadataWorkerPool` — a per-lifetime cap (`workerCount * 3`); past it, all
  remaining pending + queued tasks reject so `buildProjectIndex`'s `Promise.all`
  rejects, its `finally` terminates the pool, and `openProject` sets `loadError`.

Interrupted metadata files are retried **once** on the replacement worker; a
second death records the file as a failure (poison-file guard).

## Encoding in metadata extraction

Encoding detection/decoding lives in the pure helper
`src/main/utils/encodingUtils.ts` (`detectEncoding`, `decodeBuffer`: chardet +
windows-1250 Central-European heuristic + iconv). `FileService.readFile`
delegates to it, and `metadata.worker.ts` / the inline metadata path decode
through it as well — workers must not import `FileService` (it pulls in
Electron's `dialog`, unavailable in worker threads). The metadata path
deliberately does **not** populate FileService's encoding cache:
write-encoding decisions stay owned by FileService's read-before-write flow.

## Native module ABI: `npmRebuild: false` invariant

The `build` block in `daedalus-dialog-editor/package.json` sets
`"npmRebuild": false`, so electron-builder ships the native modules exactly as
installed without rebuilding them against Electron's headers. This is safe only
because **both** native deps are Node-API (ABI-stable across Node/Electron
majors):

- `tree-sitter@0.21.x` — `node-addon-api` + `node-gyp-build` (loads a prebuilt
  NAPI binary).
- `daedalus-parser`'s own binding — `bindings/node/binding.cc` includes
  `napi.h`, built with `prebuildify --napi`.

Because Node-API guarantees ABI stability, the prebuilt binaries load unchanged
under any Electron/Node major, which is why the Electron 29 → 43 upgrade
(bundled Node 20 → 24) needed no rebuild and no `@electron/rebuild`.

**Invariant (foot-gun if broken):** `npmRebuild: false` is valid *only* while
every native dependency is NAPI. If a non-NAPI native module (raw V8/NAN, or a
non-prebuildify addon) is ever added, it will be shipped unrebuilt and crash at
load in the packaged app. Adding such a dep requires flipping `npmRebuild` back
on (or adding `@electron/rebuild`) — do not add native deps without checking
this. The `editor-e2e-electron` CI job (real Electron, `playwright.electron.config.ts`)
is the safety net that exercises a real parse through the worker under the
shipped runtime and would catch an ABI break.

## Known limitation: native SIGSEGV

`worker_threads` are threads in the **same process**. A hard native crash
(SIGSEGV/abort) inside tree-sitter kills the entire Electron main process — no
`error`/`exit` event fires and no in-process restart can help. The defenses here
cover JS exceptions escaping the worker, worker OOM (via `resourceLimits`),
self-exit, and — via timeout — pathological-input hangs. Process-level crash
handling was out of scope for this slice; slice 8 later added crash *visibility*
(a local crash log via `LogService`, plus `render-process-gone` /
`child-process-gone` handlers) but not automatic relaunch — see
[`../plans/code-review-remediation.md`](../plans/code-review-remediation.md).
