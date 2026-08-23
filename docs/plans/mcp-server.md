# Plan: Built-in MCP Server (AI content control, verification, creation)

Status: **proposed** — no code landed. This plan describes an MCP (Model
Context Protocol) server embedded in the dialog editor so AI clients
(Claude Code, Claude Desktop, other MCP clients) can inspect a project,
verify content, and create/modify dialog and quest content through the same
validated pipelines the editor itself uses.

Per repo convention, when this plan completes its durable decisions move to
`docs/architecture/mcp-server.md` and this file is deleted.

---

## 1. Goals and non-goals

**Goals**

1. **Verify** — expose the existing validation stack (parse, semantic
   validation, roundtrip fidelity, quest guardrails, dialog simulation) as
   MCP tools, so an AI can check content without writing anything.
2. **Create** — let an AI create and modify dialogs/quests through
   structured, schema-validated tool inputs that flow through the exact
   save pipeline the editor uses (validate → generate → atomic write),
   never through unchecked file writes.
3. **Control** — let an AI observe and drive the running editor (what
   project/file is open, dirty state, navigate to a dialog) via a
   main→renderer bridge, so a user and an AI can collaborate on the same
   open project.

**Non-goals**

- No arbitrary filesystem access. Every path-taking tool is confined to the
  already-whitelisted roots (`PathValidationService`); MCP can never extend
  the whitelist (see §5).
- No remote access. Loopback-only transport, opt-in, default off.
- No renderer-embedded server. The server lives in the main process only.
- No "AI feature" in the UI (chat panels, generation buttons). This is a
  protocol surface for external AI clients; the editor UI only gains a
  settings section.

---

## 2. Architecture decision

### Placement: main-process service

A new `McpServerService` in `daedalus-dialog-editor/src/main/services/`,
consuming the same service singletons the IPC handlers use. Everything
needed for *verify* and *create* already exists main-side:

| Capability | Existing surface |
|---|---|
| Parse | `ParserService.parseSource` (worker pool, timeout, crash budget) |
| Validate | `ValidationService.validate` — returns errors, warnings, and `generatedCode` without writing |
| Generate | `CodeGeneratorService.generateCode` / `generateDialogCode` |
| Project introspection | `ProjectService.buildProjectIndex`, `extractDialogMetadata` |
| Safe write | the `generator:saveFile` flow (validate → generate → atomic temp+rename write, mtime guard, watcher self-write suppression) |
| Path containment | `PathValidationService.validatePathResolved` |
| Payload asserts | `src/main/ipcValidation.ts` (`assertModelShape`, `assertDialogName`, `assertSaveFileSettings`, `assertSaveFileOptions`) |

**Prerequisite refactor (Phase 0).** `main.ts` constructs all services at
module scope and exports nothing. Extract construction into a small
composition root (e.g. `src/main/services/serviceRegistry.ts`) that
`main.ts` and `McpServerService` both consume, and lift the body of the
`generator:saveFile` handler into a reusable `SaveFileFlow` function so IPC
and MCP share one save pipeline instead of duplicating it. Pure move — no
behavior change, existing tests stay green.

### Transport: Streamable HTTP on loopback

`stdio` does not fit a long-running desktop app the MCP client did not
spawn. The server binds **Streamable HTTP on `127.0.0.1`** (SDK
`StreamableHTTPServerTransport`):

- Opt-in via settings (`mcp.enabled`, default **false**). Nothing listens
  unless the user turns it on.
- Fixed default port (proposal: `43117`), configurable; startup failure on a
  taken port surfaces in the settings UI, never crashes the app.
- Bearer-token auth: a random token generated on first enable, persisted
  via `SettingsService` (its writes are already atomic + mutex-serialized),
  with a "regenerate" action in settings. Every request without the token
  is 401.
- DNS-rebinding protection on (SDK `enableDnsRebindingProtection` +
  `allowedHosts: ['127.0.0.1:<port>', 'localhost:<port>']`).
- The settings UI renders a copy-pasteable client config snippet
  (`.mcp.json` entry with URL + Authorization header). Clients that only
  speak stdio can use the standard `mcp-remote` proxy; we do not ship our
  own bridge.

### Dependency

`@modelcontextprotocol/sdk` (+ its `zod` peer) as a runtime dependency of
`daedalus-dialog-editor`. Both are pure JS — the Node-API-only
native-module invariant (`npmRebuild: false`, see
`docs/architecture/security-model.md`) is unaffected. **`build.files` in
the editor `package.json` is an explicit allowlist** — the new deps must be
added there or packaged builds silently lack them.

### Renderer control bridge (Phase 3)

Two things exist only in the renderer: the semantic-edit vocabulary
(`fileStore` mutation actions, `projectStore.createQuest` /
`registerTopicInLogFiles`) and the pending-edit flush registry
(`flushAllPendingEdits` — the store never flushes; a main-side write that
ignores it can drop in-flight debounced edits). "Control" tools therefore
use a main→renderer request/response bridge:

- Preload gains `onMcpRequest(handler)` / `mcp:response` (correlation-ID
  matched, timeout-guarded main-side); the renderer registers a handler map
  next to where `storeSync` wires stores.
- The existing `mockAPI.ts` seam already proves the `editorAPI` contract is
  substitutable; the bridge extends the same contract, so the browser
  harness can mock it and Playwright can exercise it.

### Concurrency and conflict policy

- Mutating tool calls are serialized through a single promise-chain queue
  in `McpServerService` (same pattern as `SettingsService`).
- **A write targeting a file open in the editor with unsaved changes**
  (`hasUnsavedChanges` — never `isDirty` alone, per
  `docs/architecture/save-pipeline.md`) **is refused** with a structured
  `EDITOR_DIRTY` error telling the client to ask the user to save or
  discard first. Before Phase 3 lands the main process cannot see renderer
  dirty state, so Phase 2 relies on the existing mtime guard
  (`EXTERNAL_MODIFICATION:`) plus the file watcher's reload/conflict flow;
  Phase 3 upgrades this to the explicit dirty check via the bridge.
- Writes to files *not* open in the editor go pure main-side; the watcher
  already notifies the renderer of external changes.
- Models with `hasErrors` are never written by MCP — there is no
  `forceOnErrors` equivalent (that path requires informed user consent in
  the UI).

---

## 3. Tool surface

Tool inputs are zod schemas (SDK-native); path parameters are validated
with `validatePathResolved` before any I/O. `ProjectIndex.dialogsByNpc` is
a `Map` — tool results need an explicit JSON-safe serialization.

### Phase 1 — read + verify (main-side only)

| Tool | Input → output |
|---|---|
| `get_server_info` | → app version, whitelisted roots, whether a project index is loaded |
| `list_project_files` | root → `.d` files (from `ProjectService.scanDirectory`) |
| `get_project_index` | root → NPCs, dialogs-by-NPC, quest files, routines, voice IDs, metadata failures |
| `read_source_file` | path → source text (encoding-aware via `FileService`) |
| `get_semantic_model` | path → parsed `SemanticModel` summary (names, properties, action digests — not the raw full model; it is large) |
| `get_dialog` | path + dialog name → full dialog + linked condition/information functions |
| `validate_file` | path → parse + `ValidationService.validate` result (errors, warnings) |
| `validate_model` | model JSON (+ settings) → `ValidationResult` — the "dry-run save" |
| `check_roundtrip` | path → parse → generate → reparse → structural diff report (parity with `scripts/roundtrip-corpus.js` semantics) |

### Phase 2 — create + modify (main-side, through the save pipeline)

| Tool | Input → output |
|---|---|
| `preview_dialog_code` | structured dialog spec → generated Daedalus source, **no write** |
| `create_dialog` | path + spec (npc, nr, description, permanent/important, condition spec, lines, choices, log entries) → merged into the file's model → validate → save |
| `update_dialog` | path + dialog name + targeted edits (property changes; add/remove/reorder actions) → validate → save |
| `remove_dialog` | path + dialog name → validate → save |
| `write_source_file` | path + raw source → **parse-gated**: refused on syntax errors (no force), then written via the same atomic write + mtime guard |

Structured specs are converted to live model objects with the parser's own
constructors/deserializers (`Dialog`, `DialogFunction`, action classes,
`deserializeSemanticModel`) — generation stays semantic-model driven, and
`declarationOrder` / `preserveSourceStyle: true` keep untouched file
content byte-stable (the parser-fidelity invariant).

### Phase 3 — editor control + quest tools (renderer bridge)

| Tool | Input → output |
|---|---|
| `get_editor_state` | → open project, open file, selected dialog, `hasUnsavedChanges`, parse-error state |
| `open_in_editor` | path (+ dialog name) → editor navigates there (path must already be whitelisted; MCP cannot open new roots) |
| `create_quest` | title, internal name, topic/variable file paths → routed through `projectStore.createQuest` + `registerTopicInLogFiles` so history/undo and index updates behave exactly like a UI-created quest |
| `check_quest_guardrails` | ~~quest edits spec → `quest/domain` guardrail warnings~~ **Blocked (2026-08-23):** `quest/domain/guardrails.ts` was deleted with the quest Flow view (production-readiness review §1 Option B) — it existed only to gate that view's write path. Reviving this tool means reimplementing the guardrail rules, so treat it as new work, not as wiring up an existing module. |
| `simulate_dialog` | npc + dialog + scripted choice/assumption sequence → transcript, termination reason, condition assumptions (reusing `simulator/domain` + `SimulatorSession`; same placement rule as guardrails) |

Bridge-routed edits go through the stores, so they respect
`flushAllPendingEdits`, history, and the source-dirty refuse-and-reconcile
rules automatically.

Deferred beyond Phase 3 (revisit only on demand): undo/redo tools, MCP
resources/prompts, project-wide batch refactors, NPC/item instance
creation.

---

## 4. Verification story (what "verify content via AI" means)

An AI client gets four independent checks, all read-only:

1. **Syntax** — `validate_file` / parse errors with locations.
2. **Semantics** — `ValidationService`'s eight-step pass (duplicate
   dialogs, missing function refs, required props, choice targets, action
   validation, quoted-string content, voice-ID warnings).
3. **Fidelity** — `check_roundtrip` proves generate→reparse stability
   before any write is attempted.
4. **Behavior** — `simulate_dialog` (Phase 3) plays the content through the
   three-valued-condition simulator and returns the transcript, so an AI
   can check that a generated dialog actually reaches its choices and quest
   log entries.

Every mutating tool runs (1)+(2) internally and returns the
`ValidationResult` alongside the write outcome, so a client never needs a
separate round-trip to learn why a write was rejected.

---

## 5. Security model changes

The documented threat model (`docs/architecture/security-model.md`) covers
a malicious *project folder*, not a network peer. The MCP server introduces
a new actor and needs an explicit amendment when this plan completes:

- **Loopback + bearer token + opt-in (default off)** is the access control.
  The realistic adversary gained is a local process or a browser page
  attempting DNS rebinding — hence token auth on every request and the
  SDK's rebinding protection; we continue not to defend against a hostile
  local process that can already act as the user.
- **The whitelist invariant is preserved verbatim**: only the main process
  extends the whitelist, and only from an OS-dialog result. No MCP tool
  adds roots — `open_in_editor` and every path-taking tool operate strictly
  inside existing grants, mirroring how `project:addAllowedPath` only
  re-grants known recents. (Do not re-add `%2e`-style substring checks.)
- **Reuse, don't fork, the boundary checks**: `ipcValidation.ts` asserts +
  zod schemas at the MCP edge; `validatePathResolved` before all I/O;
  writes only through the shared `SaveFileFlow`.
- The token is a secret in `settings.json`; it must never appear in logs
  (`LogService` sanitization) or in tool results.

---

## 6. Implementation phases (TDD per repo rules)

Each phase lands with tests-first, and `npm test` + `npm run lint` +
typecheck green in the editor workspace before it is called done.

1. **Phase 0 — composition root.**
   Extract service construction + `SaveFileFlow` from `main.ts`; IPC
   handlers become thin delegates.
   → verify: full existing Jest + Playwright suites green, zero behavior
   change.
2. **Phase 1 — server core + read/verify tools.**
   `McpServerService` (start/stop from settings, token auth, port
   handling), Phase 1 tools.
   → verify: Jest integration tests spin the server on an ephemeral port
   against fixture projects with a real MCP client from the SDK; security
   tests: no token → 401, path outside whitelist → structured refusal,
   wrong Host header → refused; disabled setting → nothing listens.
3. **Phase 2 — create/modify tools.**
   Structured spec → model construction, shared save flow, conflict
   policy.
   → verify: integration tests prove created dialogs roundtrip
   (write → reparse → equal), untouched-content byte-stability, syntax-gated
   `write_source_file` refusal, `EXTERNAL_MODIFICATION` surfacing.
4. **Phase 3 — renderer bridge + control/quest/simulation tools.**
   Preload channel pair, renderer handler registry, `EDITOR_DIRTY` policy
   upgrade.
   → verify: Playwright E2E (browser harness via `mockAPI` seam +
   real-Electron spec) proving `open_in_editor` navigation, dirty-file
   write refusal, and a bridge-created quest appearing with working undo.
5. **Phase 4 — settings UI, docs, packaging.**
   Settings section (enable, port, token regenerate, config snippet),
   `security-model.md` amendment, new `docs/architecture/mcp-server.md`,
   CLAUDE.md service-table updates, packaged-build check that the SDK deps
   survive `build.files`.
   → verify: `npm run package` output contains the deps; manual smoke:
   packaged app + Claude Code client end-to-end.

Phases 0–2 deliver standalone value (verify + create against project files)
even if Phase 3 is deferred.

---

## 7. Open questions (owner input wanted)

1. **Default port** — is `43117` acceptable, or should first-enable pick a
   random free port and pin it in settings?
2. **Editor-control scope** — is `open_in_editor` navigation enough for v1,
   or should MCP also drive selection/undo/redo?
3. **Headless mode** — is a `--mcp-stdio` no-window launch mode (same tools
   minus Phase 3) worth adding for CI/scripted use, or does the
   `daedalus-parser` CLI trio cover that need?
4. **Token lifetime** — persisted until regenerated (stable client config,
   proposed) vs. rotated per app launch (safer, but breaks saved client
   configs)?
