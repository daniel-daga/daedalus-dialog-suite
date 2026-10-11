# Worker Reliability Architecture

This document captures the durable decisions for the two worker pools in the
editor's main process: the long-lived `ParserService` pool and the per-build
`MetadataWorkerPool`. Both run tree-sitter + the semantic visitor passes in
**forked child processes** (`ForkedWorker`), one OS process per worker — see
"Process isolation" below for why that is not `worker_threads`.

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
(each loads the parser and uses tens of MB, and since the isolation change each
is a process rather than a thread) on high-core machines. The rule is
one function, `workerPoolSize` in `src/main/services/workerPoolSize.ts`, and
both pools call it (`ParserService` only when no `workerCount` is passed).

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
Electron's `dialog`, unavailable in a worker). The metadata path
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

## Process isolation (#268, 2026-09-14)

Both pools used to run `worker_threads`, which are threads in the **same**
process. A hard native crash (SIGSEGV/abort) inside tree-sitter therefore killed
the entire Electron main process: no `error` and no `exit` event fired, so none
of the restart machinery above could see it, and a malformed file took the whole
app down. That was the one failure mode the defenses here did not cover.

A worker is now a forked child process. `src/main/services/ForkedWorker.ts` is
the whole boundary — it wraps `child_process.fork` in the `Worker`-shaped
surface (`postMessage` / `on` / `terminate`) the pools already held, so the
timeouts, the restart caps, the idle dispatch and the failure classification are
unchanged. A native crash now arrives as the `exit` event the pools already know
how to recover from, and the death names its signal: `Parser worker crashed
(killed by SIGSEGV)`.

What the boundary costs and what it required:

- **One OS process per worker**, up to the cap above, instead of one thread.
  Spawn is slower and the resident cost higher; both pools are lazy or
  per-build, which is what makes that affordable.
- **`serialization: 'advanced'`** — the V8 structured-clone serializer, so a
  semantic model crosses the boundary with the fidelity `postMessage` gave it.
  The default JSON serializer would flatten cycles, Maps and Sets.
- **`--max-old-space-size=512`** replaces `resourceLimits`. Runaway memory now
  aborts the child rather than raising a catchable `ERR_WORKER_OUT_OF_MEMORY`;
  an abort is a death like any other.
- **`stdio: ['ignore', 'inherit', 'inherit', 'ipc']`** — nothing reads a
  child's pipes, and an unread pipe fills up and blocks the writer mid-parse.
- **`ELECTRON_RUN_AS_NODE=1`** in the child's env: under Electron
  `process.execPath` is the app binary, and only this makes the fork a plain
  Node process. The **`npmRebuild: false` invariant above still applies** — it
  is the same NAPI addon, loaded in a different process.

`utilityProcess` was the other option and was not taken: it exists only inside a
ready Electron app, so every one of the pool-lifecycle tests would have had to
mock it. `fork` runs identically under Jest, plain Node and Electron, which is
what keeps that suite the safety net.

Crash *visibility* is unchanged and still worth having — a local crash log via
`LogService` plus `render-process-gone` / `child-process-gone` handlers, see
[`../plans/code-review-remediation.md`](../plans/code-review-remediation.md).

**What still has no witness:** a fork out of a *packaged* app, where the worker
script lives inside `app.asar`. The gate for it exists — `build-windows.yml`'s
packaged parse smoke (`DDE_SMOKE_PARSE`) drives `ParserService.parseSource` in
the packaged app — but that workflow is `workflow_dispatch` only. Dispatch it
before trusting a release. The unpackaged path is covered on every push by
`editor-e2e-electron`, which parses real files through the forked worker under
real Electron.
