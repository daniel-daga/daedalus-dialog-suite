# Fix Plan 03 — Worker Lifecycle & Process Reliability

Slice 3 of the 2026-07-02 production-readiness remediation ([tracker](./code-review-remediation.md), findings in [code-review-findings.md](./code-review-findings.md)).

Status: plan-ready. Plan only — no implementation yet.

---

## Scope & findings addressed

| ID | Finding | Status after deep-dive |
|----|---------|------------------------|
| R1 | ParserService: no timeout, no restart, pending requests never rejected on worker `error`/`exit`; round-robin keeps routing to dead workers | **Confirmed.** `ParserService.ts:47-56` only logs on `error`/`exit`; `getNextWorker()` (`:59-63`) cycles over `this.workers`, which is never pruned. `parseSource` (`:69-77`) registers the pending entry with no worker association, no timer. |
| R2 | MetadataWorkerPool: crashed worker leaves `pendingRequests` unsettled → `Promise.all` in `buildProjectIndex` never settles → project-open spinner hangs; remaining threads leak | **Confirmed, with one correction and two aggravations (N1, N3, N4 below).** |
| R3 | Per-file metadata failures resolve to silent empty metadata; metadata worker reads hard-coded `utf-8` while FileService detects windows-1250/1252 | **Confirmed.** `MetadataWorkerPool.ts:76-81` (silent empty on error), `:158` and `metadata.worker.ts:10` (`readFile(filePath, 'utf-8')`) vs `FileService.readFile` chardet + windows-1250 heuristic (`FileService.ts:76-101`). |
| PF4 (pool part) | Fresh pool of `cpus−1` workers, each loading the native parser, spawned per index build | **Confirmed but bounded** — `buildProjectIndex` is only called from `projectStore.openProject` (once per project open); there is no per-file-change rebuild. See decision in Fix D6. |

### Corrections and new findings from this deep-dive

- **N1 (correction to R2 wording):** `pool.terminate()` **is** already inside a `finally` (`ProjectService.ts:153-155`). The defect is not a missing `finally` — it is that the awaited `Promise.all` never settles, so the `finally` is unreachable. The fix is settlement guarantees on every `processFile` promise, not moving `terminate()`.
- **N2 (severity nuance on R1):** worker_threads are **threads in the same process**. Node delivers `error` (then `exit`) for uncaught JS exceptions in the worker, `error` with `ERR_WORKER_OUT_OF_MEMORY` when `resourceLimits` are exceeded, and `exit` alone for `process.exit()`. A **hard native crash (SIGSEGV/abort) in tree-sitter kills the entire Electron main process** — no `error`/`exit` event fires and no in-process restart logic can help; that class is only addressable by slice 8's crash handling/relaunch. What worker-level defenses genuinely cover: JS exceptions escaping the worker's try/catch, worker OOM (only if we set `resourceLimits` — currently unset, so runaway memory grows the shared process heap instead of failing catchably), self-exit, and — via timeout — pathological-input **hangs**, which for tree-sitter are at least as realistic as crashes.
- **N3 (new, MetadataWorkerPool):** a worker that dies while **idle** stays in `idleWorkers`; `postMessage` to a dead worker is a silent no-op, so the next task assigned to it hangs even though no crash happened "during" it.
- **N4 (new, MetadataWorkerPool):** a worker that dies mid-task never calls `workerBecameIdle`, so its queue lane is lost permanently; with repeated deaths the pool silently shrinks to zero and the whole `taskQueue` stalls.
- **N5 (new):** `MetadataWorkerPool.terminate()` clears `pendingRequests` without rejecting them (`:172`) — any caller still awaiting `processFile` at terminate time hangs forever.
- **N6 (new):** neither pool handles the `messageerror` event (message deserialization failure → request never settles; no request id is available on that event, so the per-request timeout is the backstop).
- **N7 (new, testability):** `MetadataWorkerPool` bypasses workers entirely under Jest (`isLikelyTestRuntime()` → inline processing, `:33-38`), so the worker lifecycle is currently untestable. The fix must make the worker script path and pool options injectable.
- **N8 (new):** metadata pool spawns `cpus−1` workers **uncapped** (a 32-core machine gets 31 native parser instances); ParserService caps at 8. Cap both.
- **N9 (new, main.ts):** `parser:parseSource` handler (`main.ts:81-88`) `return`s the promise without `await` inside `try` — the `catch` is dead code for async rejections (rejection still reaches the renderer, but the intended main-process logging never fires). Same pattern in `project:buildIndex` (`:285`) and `project:parseDialogFile` (`:302`). Cosmetic; fix with `await` while in the area.

### Blast radius of one hung/dead parser worker (verified call graph)

`ParserService.parseSource` is awaited by:

1. `parser:parseSource` IPC (`main.ts:81`) ← `fileStore.openFile` (`fileStore.ts:243`), `fileStore.saveSource` re-parse (`:706`) — **opening a file and source-mode save hang.**
2. `ValidationService.validateSyntax` (`ValidationService.ts:225`) ← `validation:validate` IPC and `generator:saveFile` IPC (`main.ts:126`) ← `fileStore.saveFile` (`:634`) and `useAutoSave.performAutoSave` (`useAutoSave.ts:55`) — **every manual save and every auto-save tick hangs silently; `isAutoSaving` spinner state sticks.** The `generator:saveFile` fallback sanity re-parse (`main.ts:153`) hangs the same way.
3. `project:parseDialogFile` IPC (`main.ts:302`) ← file-watcher reloads (`useFileWatcher.ts:93,121`) and **background ingestion** (`projectStore.ts:331`): ingestion runs 20 lanes each awaiting parses serially — every request round-robined to a dead worker permanently consumes a lane; with `workers.length ≤ 8`, all 20 lanes are eventually consumed and `isIngesting` sticks `true` forever. Navigation paths (`useNavigation.ts:72,141`, `useDialogNavigation.ts:71,166`) `Promise.all` over `getSemanticModel` and hang with it.

`MetadataWorkerPool.processFile` is awaited only by `ProjectService.buildProjectIndex` (`Promise.all`, `ProjectService.ts:82-84`) ← `project:buildIndex` IPC ← `projectStore.openProject` (`projectStore.ts:241`) — one unsettled file promise hangs "open project" forever (spinner never resolves, `loadError` never set) and leaks the whole pool (N1).

---

## Fix design

Shared building block: a small `WorkerRequestError` (message + `kind: 'timeout' | 'worker-crashed' | 'pool-terminated'`) serialized into the IPC rejection message with a stable prefix (e.g. `PARSE_TIMEOUT:`, `PARSER_CRASHED:`) so the renderer can classify without new IPC channels.

### D1 — ParserService: per-request timeout + rejection semantics (R1) — size M

Rework `ParserService` around per-worker bookkeeping:

- `pendingRequests: Map<id, { resolve, reject, worker, timer }>` — every request records which worker owns it and a `setTimeout` handle.
- **Timeout: 30 000 ms**, a `DEFAULT_PARSE_TIMEOUT_MS` constant with constructor override (tests use ~100 ms). Justification: real Gothic 2 / MDK `.d` files top out around 1–2 MB and parse (tree-sitter + both visitor passes) in well under 2 s on modest hardware; the parser's own corpus runs process whole script bases in seconds. 30 s is >10× the worst plausible legitimate parse, so false timeouts are effectively impossible, while a genuine native hang surfaces within a window where the save-status UI is still meaningful. Shorter (5–10 s) risks killing legitimate parses of pathological-but-valid mod files on slow laptops during ingestion bursts.
- **On timeout:** reject with `WorkerRequestError('timeout')`, remove the request, and **terminate + replace the worker** — a hung native parse cannot be cancelled, and `worker.terminate()` is the only reclamation path. Honest caveat: a thread blocked *inside* a native tree-sitter call may not actually die until the call returns; removal from rotation is the real protection, `terminate()` is best-effort. Reject all *other* in-flight requests on that worker with `'worker-crashed'` (they were queued behind the hang).
- **On `error` / `exit(code≠0)`:** reject all pending requests owned by that worker with `'worker-crashed'`, splice it out of `this.workers`, clamp `nextWorkerIndex`, and spawn a replacement (fixes the round-robin-to-dead-worker defect directly: the array only ever contains live workers).
- **Restart guard:** cap replacements (e.g. 5 within 60 s, sliding window). Past the cap, `ParserService` enters a degraded state where `parseSource` rejects immediately with a clear "parser workers are crash-looping — restart the app" error instead of respawning forever.
- **`messageerror`:** log; the per-request timeout settles the orphaned request (N6).
- **`resourceLimits`:** set (e.g. `maxOldGenerationSizeMb: 512`) on both pools so runaway memory becomes a catchable `ERR_WORKER_OUT_OF_MEMORY` `error` event instead of an OS-level kill of the shared process (N2).
- Fix the dead `try/catch` in the three IPC handlers by `await`ing (N9).

### D2 — MetadataWorkerPool: settlement guarantees + return-or-replace (R2, N3–N6) — size M

- Track in-flight task per worker: `inFlightByWorker: Map<Worker, { id, filePath, timer }>`; assignment happens in one place (`assignTask(worker, task)`) used by both `processFile` and `workerBecameIdle`.
- **Per-task timeout:** same 30 s constant/override (metadata extraction runs a full parse — identical hang risk). On timeout: settle the task as a per-file failure (see D3), terminate + replace the worker.
- **On `error` / `exit` (while `!isTerminated`):** settle that worker's in-flight task as a per-file failure, remove the worker from `workers` *and* `idleWorkers` (fixes N3), spawn a replacement and immediately `workerBecameIdle(replacement)` so the queue lane is restored (fixes N4). Retry policy for the interrupted file: retry **once** on the replacement; if it kills a worker again, record it as a failed file and move on (poison-file guard).
- **Restart guard:** cap replacements per pool lifetime (e.g. 3 × pool size). Past the cap, reject *all* remaining pending + queued tasks with `'worker-crashed'` — `buildProjectIndex`'s `Promise.all` then rejects, the existing `finally` runs `terminate()` (per N1 this is the correct shape already), and `openProject` sets `loadError`.
- **`terminate()`:** before clearing state, reject every entry in `pendingRequests` and every queued task with `'pool-terminated'` (fixes N5); make it idempotent and have it `await`/fire-and-forget `worker.terminate()` promises as today.
- Cap worker count at `Math.max(1, Math.min(os.cpus().length - 1, 8))` (N8).
- **Testability (N7):** constructor takes `options?: { workerPath?: string; forceWorkerMode?: boolean; taskTimeoutMs?: number; maxRestarts?: number }`. `forceWorkerMode: true` bypasses `isLikelyTestRuntime()` so Jest (node env) can exercise real worker_threads against stub worker scripts. `ParserService` gets the same `workerPath`/`timeoutMs`/`workerCount` injection.

### D3 — Surface per-file metadata failures to the project index (R3a) — size S

- `processFile` resolves to a discriminated result: success carries metadata as today; failure carries `{ ok: false, filePath, error: string }` instead of silently-empty metadata (`MetadataWorkerPool.ts:78-81` and the inline catch `:160-163`). Per-file parse/read errors **resolve** (the index build must survive them); only pool-fatal conditions (restart cap, terminate) **reject**.
- `ProjectIndex` (`src/shared/types.ts:15-23`) gains `metadataFailures: Array<{ filePath: string; error: string }>`; `buildProjectIndex` collects failures there and continues.
- Renderer: `projectStore.openProject` stores `metadataFailures`; surface them in `IngestedFilesDialog` (which already presents per-file ingestion errors) plus a count badge — no new dialog. Files with failed metadata still appear in `allFiles` (they do today — scan and metadata are separate), so they remain openable; they are just absent from NPC/dialog groupings, and now visibly so.

### D4 — Unify encoding in metadata extraction with FileService detection (R3b) — size S

- Extract the detection/decode logic from `FileService.readFile` (`chardet.detect` + `detectCentralEuropeanPattern` windows-1250 heuristic + `iconv.decode`, `FileService.ts:76-101, 138-175`) into a pure helper `src/main/utils/encodingUtils.ts`: `detectEncoding(buffer): string` and `decodeBuffer(buffer): { content: string; encoding: string }`. **The worker must not import FileService** — FileService imports `electron`'s `dialog`, which is unavailable in worker threads; the extraction is required, not optional.
- `FileService.readFile` delegates to the helper (behavior-preserving; its encoding cache stays in FileService).
- `metadata.worker.ts` and `processFileInline` read the file as a **Buffer** and decode via the helper instead of `'utf-8'`.
- Note: the metadata path deliberately does **not** populate FileService's encoding cache (worker is a separate module instance; write-encoding decisions stay owned by the read-before-write flow in FileService — coordinate with slice 2/E6).

### D5 — Failure-UX (coordinate with slice 2) — size S–M

What the renderer sees when a parse times out or a worker dies:

- **Manual save / auto-save:** `generator:saveFile` now rejects with a classifiable message (`PARSE_TIMEOUT:` / `PARSER_CRASHED:`). `useAutoSave` currently swallows rejections into `console.error` (`useAutoSave.ts:130-136`) — instead, mark the affected file: keep `isDirty: true`, and set a new `FileState.saveError: { kind: 'timeout' | 'worker-crashed'; message: string }` alongside the existing `autoSaveError` (validation) field. The App-bar error indicator (`App.tsx:220-234`) is extended to render `saveError` with copy like "Save failed: the parser did not respond (timed out). Your changes are kept in the editor — retry with Ctrl+S." `fileStore.saveFile` sets the same state in its `catch` before rethrowing, so the manual-save path shows it too. **Contract with slice 2:** slice 2 owns the save-status UI redesign; this slice only guarantees (a) rejections are classifiable, (b) `isDirty` is never cleared on a failed save, (c) the error lands in one well-known `FileState` field slice 2 can render.
- **Project load:** with D2, `buildProjectIndex` always settles; on pool-fatal rejection `openProject`'s existing `catch` sets `loadError` (`projectStore.ts:270-275`) and the spinner ends with the existing error surface. Per-file failures arrive via `metadataFailures` (D3) — project opens, degraded visibly rather than silently.
- **Background ingestion / file-watcher / navigation:** these already `catch` per-file (`projectStore.ts:348-366` stores `ingestion_error` models) — they were only broken because promises never settled. With D1 they now degrade file-by-file with the existing error entries; no new UI.
- **Crash-loop degraded state:** the immediate-reject errors from D1/D2 restart caps flow through the same surfaces (saveError / loadError) with a message telling the user to restart the app; a main-process crash reporter is slice 8.

### D6 — Pool reuse vs per-build spawn (PF4) — size S

**Recommendation: keep per-build spawn ("cheap-recreate"), made actually cheap and correct — do not introduce a keep-alive metadata pool.** Rationale:

- Verified call graph: `buildProjectIndex` runs **once per project open** (`projectStore.openProject` is its only caller; file-watcher changes go through `parseDialogFile`, not index rebuilds). This is a rare, user-initiated, spinner-covered operation — a one-time worker spawn spike is acceptable there.
- A keep-alive pool would hold `≤ min(cpus−1, 8)` native parser instances (tens of MB each) resident for the whole session to accelerate an operation that happens about once per session, and would need extra lifecycle machinery (idle state across builds, restart-cap resets, app-quit teardown) — more code on exactly the component this slice is de-riskifying.
- The real PF4 costs are fixed directly: cap worker count at 8 (N8), and the R2 fix guarantees `terminate()` in the `finally` is actually reached, so pools can no longer leak across builds.
- The long-lived `ParserService` pool (also 8 native parser instances) already covers all hot-path parsing; it gets keep-alive semantics with restart, which is the appropriate split.

Document this decision in `docs/architecture/` when the slice completes (per plan-deletion hygiene).

---

## Test plan (failing tests first, per repo TDD rules)

All main-process tests use `@jest-environment node` (pattern from `tests/ProjectService.test.ts`). Deterministic crash/hang simulation via **stub worker scripts** (plain `.js`, no build step) in `tests/fixtures/workers/`, injected through the new `workerPath` options (N7):

- `echo.worker.js` — replies `{ id, result: {...} }` normally (recovery assertions).
- `hang.worker.js` — receives messages, never replies.
- `exit.worker.js` — calls `process.exit(1)` on first message (exit-without-error path).
- `throw.worker.js` — `setImmediate(() => { throw new Error('boom') })` on first message (`error`-event path).
- `crash-once.worker.js` — exits on the first message, a respawned instance replies normally (needs a marker file or env toggle; used for retry-once assertions).

Target test files and cases:

1. **`tests/services/ParserService.test.ts` (new)** — construct with `workerPath` fixture, `workerCount: 2`, `timeoutMs: 100`:
   - hang worker → `parseSource` rejects with timeout kind within ~timeout (fails today: promise never settles — assert via `Promise.race` against a generous cap);
   - exit/throw worker → in-flight request rejects with `worker-crashed`; requests on the *other* worker still resolve;
   - after a crash, `2 × workerCount` subsequent requests all settle (proves dead worker left rotation and replacement works — fails today because round-robin still hits the corpse);
   - restart-cap: crash-looping worker script → after cap, `parseSource` rejects immediately with degraded-state error.
2. **`tests/services/MetadataWorkerPool.test.ts` (new)** — construct with `forceWorkerMode: true` + fixture `workerPath`:
   - worker exits mid-task → `processFile` **settles** (resolves with `ok: false`) (fails today);
   - worker dies while idle, next task assigned → settles (N3);
   - queue longer than pool with one `crash-once` worker → all tasks settle, queue drains on replacement (N4);
   - `terminate()` with pending + queued tasks → all reject with `pool-terminated` (N5);
   - restart cap exceeded → remaining tasks reject.
3. **`tests/ProjectService.test.ts` (extend)** — temp dir where one `.d` file is unreadable (`chmod 000`, skip on Windows CI) or the pool is injected with a poison-marking fixture: `buildProjectIndex` resolves, `metadataFailures` names the file, other files indexed normally (fails today: silent empty metadata). Plus: with a crashing pool, `buildProjectIndex` **rejects** (not hangs) — assert with a timeout race.
4. **`tests/encoding.test.ts` (extend) or new `tests/services/metadataEncoding.test.ts`** — write a fixture `.d` with windows-1252 bytes (`instance DIA_Bärbel(C_INFO) { npc = Bärbel_1252; }` encoded via iconv) → metadata extraction (inline path *and* real-worker path) yields the umlaut name intact (fails today: `utf-8` read yields U+FFFD). Same for a windows-1250 sample hitting the Central-European heuristic.
5. **`tests/autoSave.test.ts` (extend)** — mock `window.editorAPI.saveFile` to reject with `PARSE_TIMEOUT: …` → file keeps `isDirty: true`, `FileState.saveError` populated with kind `timeout`; existing success-path tests stay green. New small test for `fileStore.saveFile` manual path doing the same before rethrow.
6. **Manual smoke (not automatable here):** open a real project, `kill -SEGV` is out of scope (kills the process, N2) — instead temporarily wire a debug IPC that posts a poison message; verify save shows the error indicator and a retry succeeds after worker replacement.

Verification gate: `npm test`, `npm run typecheck:renderer`, `npm run build:main` in `daedalus-dialog-editor/` (editor has no lint script — slice 8).

---

## Ordering, dependencies, risks

| Step | Fix | Size | Depends on |
|------|-----|------|-----------|
| 1 | D1 ParserService (timeout, reject, restart, round-robin prune, resourceLimits, N9 awaits) | **M** | — |
| 2 | D2 MetadataWorkerPool (settlement, return-or-replace, terminate rejection, caps, injectability) | **M** | shared `WorkerRequestError` from step 1 |
| 3 | D3 `metadataFailures` in ProjectIndex + renderer surfacing | **S** | D2 (result shape) |
| 4 | D4 encoding extraction + worker adoption | **S** | independent; touches FileService, so land before/with slice 2's E6 work to avoid conflicts |
| 5 | D5 renderer failure-UX (`saveError` state + App indicator) | **S–M** | D1 rejection contract; **coordinate with slice 2** (owns save-pipeline UX; agree on the `FileState.saveError` field shape before slice 2 finalizes) |
| 6 | D6 PF4 decision (cap + architecture note) | **S** | D2 |

Cross-slice dependencies:
- **Slice 2 (save pipeline):** D5's `saveError` field and the never-clear-`isDirty`-on-failure rule are inputs to slice 2's dirty-tracking redesign. D4 touches `FileService` where slice 2 fixes E5/E6 (atomic writes, encoding roundtrip) — sequence the FileService edits.
- **Slice 8 (release gating/crash logging):** native SIGSEGV in tree-sitter still kills the main process (N2) — out of this slice's reach; slice 8's `uncaughtException` handler/crash reporter + relaunch is the only mitigation. Note this explicitly in slice 8's plan.
- **Slice 1 (parser fidelity):** none functionally, but pathological-input hang fixtures discovered while testing D1 should be donated to the parser corpus.

Risks:
- `worker.terminate()` may not reclaim a thread wedged inside native tree-sitter code (it interrupts JS, not C). Mitigated: the worker leaves rotation immediately; replacement spawn is what restores capacity; restart caps bound zombie accumulation. Worst case is a leaked OS thread per hang, strictly better than today's leaked thread *plus* permanently hung UI.
- Timeout false-positives on very slow machines during ingestion bursts (8 concurrent 30 s parses). Mitigated by the generous 30 s choice and by timeouts being per-request (a timed-out ingestion file becomes an `ingestion_error` entry, not a failed project open).
- `resourceLimits` too low could OOM legitimate parses of huge files — start at 512 MB old-gen and treat `ERR_WORKER_OUT_OF_MEMORY` as a normal crash-restart; tune with corpus data.
- D2 changes `processFile`'s resolve shape — `ProjectService.buildProjectIndex` is the only consumer (verified), but the inline test path must change in lockstep or Jest suites diverge from production behavior.
