# VOB folders — user-created groupings in the World scene tree

**Status: landed 2026-08-31, awaiting real-world use before extraction into
`docs/architecture/level-editor.md` and deletion of this file.** All tests and
linters pass; nothing here is scaffolding for future phases.

## Context

The World surface's scene tree (`WorldSceneTree.tsx`) shows only the real
ZenGin VOB hierarchy — `parent`/`childIndex` read straight off the world. On a
retail world (23k+ VOBs) that hierarchy is what the engine needs, not what a
level designer thinks in: there was no way to group "the VOBs for this quest"
without touching a VOB's real parent, which has engine-visible consequences.

Daniel asked for user-created folders, additional to the existing tree, that
VOBs can be filed into. Two decisions were settled with him directly before
any code:

- **Folders are a virtual, editor-only overlay** — never a VOB, never written
  into the `.zen` file, never touching `parent`/`childIndex`. Filing a VOB
  into a folder is bookkeeping, not a `ReparentVob`.
- **Persisted as `<worldname>.folders.json`**, written next to the world file
  itself, in the mod's own content directory — versionable through the mod's
  own repo the same way the world file is, rather than tucked away in the
  app's userData.

## Scope

**In:** create/rename/delete a folder; add one or more selected VOBs to a
folder from the existing VOB context menu; remove a VOB from a folder; a
"Folders" tab in the World surface's left panel listing folders and their
resolved members; persistence to the sidecar, reloaded on reopen.

**Deliberately out, not an oversight:**
- **No nesting.** A folder is a flat, named bucket. Not asked for, and it
  roughly doubles the domain/UI surface (parent chains, cycle checks, a
  second drag target). The `VobFolder` shape has room for it later.
- **No undo/redo.** A folder edit is never a `WorldOp`, so it never touches
  `WorldService`'s history stack.
- **No drag-and-drop into a folder.** The only path in is the VOB context
  menu's "Add to Folder ▸". `WorldSceneTree`'s drag machinery (`RowData`'s
  `onDragVob`/`onDropOn`/`canDropOn`) is built tightly around real
  `ReparentVob` semantics; a second, non-reparenting drop target is its own
  body of work if it turns out to be wanted.

## Design

### Domain — `zen-world/src/model/vobFolders.ts`

Pure, no React/Electron/fs — same footing as `vobTree.ts`. Membership is
keyed by `vobIndexPath` (`ops.ts`), the same "native address"
`AddVob`/`ReparentVob`/`DeleteVob` already use, rather than the flat VOB
index every structural op renumbers.

```ts
interface VobFolder { id: string; name: string; vobPaths: string[] }
interface VobFolders { folders: VobFolder[] }
```

`emptyVobFolders`, `createFolder`, `renameFolder`, `deleteFolder`,
`addVobsToFolder` (idempotent), `removeVobFromFolder` — all pure,
immutable. `resolveFolderMembers(reader, folder)` maps `vobPaths` through
`vobAtIndexPath`, **dropping** any path that no longer resolves — the same
"dropped rather than remapped" rule the scene tree already applies to a
stale selection after a renumber. `parseVobFolders(raw)` is the one function
that doesn't trust its input: defensive coercion for JSON read off disk,
collapsing anything malformed to the empty state rather than throwing.

### Persistence — `src/main/services/WorldFoldersService.ts`

Stateless: every call carries the world path explicitly (the renderer
already holds it in `WorldSummary.worldPath`), so there is no
`worldPath`-keyed cache to keep in step with `WorldService`'s own
open/close/timeout/death lifecycle. `save` reuses
`SettingsService.writeSettings`'s exact tmp-file + `fs.open`/`writeFile`/
best-effort `sync()`/`close()`-in-`finally`/`fs.rename` pattern; `load`
mirrors `readSettings`'s missing-file-is-empty and
corrupt-file-preserved-aside behavior, parsed through `parseVobFolders`.

IPC: `world:getVobFolders` / `world:saveVobFolders` (`main.ts`), validated by
`assertVobFoldersGetRequest`/`assertVobFoldersSaveRequest`
(`ipcValidation.ts` — shape only; `folders` itself is re-derived through
`parseVobFolders` rather than trusted) and `pathValidator.validatePathResolved`
against `WorldFoldersService.sidecarPath(worldPath)` — the exact file being
touched, not the world's directory it happens to live in. No new
`addAllowedPath` grant needed: `world:openDialog` already grants the world's
own directory.

### Renderer

State is local to `WorldSurface.tsx` (`vobFolders`, alongside
`waynet`/`appliedOps`/`contextMenu`), not `worldStore.ts` — folders are
editor session state about the currently open world, the same category
those already are. Loaded via `getVobFolders` right after a world opens,
outside the main open `try` (same reasoning as the waynet read: a failure
here is a world that opened correctly and has an editor-only extra nobody
could read, not a reason to throw away 31 MB of geometry and re-pay the
open). Every mutation runs through `persistFolders`, which sets state and
fires `saveVobFolders` (fire-and-forget, logged on failure — folders are
low-stakes editor metadata, not the world itself).

`WorldFolderTree.tsx` — not virtualized, unlike the scene tree: a user files
VOBs into folders by hand, so folder counts and their member lists are
nowhere near the 23,288 rows the real tree has to survive. Mounted as a
third "Folders" tab beside Scene/Assets in the left panel, lazily like
Assets (not kept alive like Scene's expansion set). Takes `summary` and
computes its own `reader` via `vobModelOf`, the same idiom `WorldSceneTree`
uses.

`WorldVobContextMenu.tsx` gained "Add to Folder ▸" — a second `Menu`
anchored to that item's own element (MUI has no built-in nested menu),
listing existing folders plus an inline "New folder…" that creates and adds
the selection in one step.

## What landed

- `zen-world/src/model/vobFolders.ts` + `zen-world/test/vobFolders.test.ts`
- `daedalus-dialog-editor/src/main/services/WorldFoldersService.ts` +
  `tests/WorldFoldersService.test.ts`
- `ipcValidation.ts` additions + `tests/ipcValidation.test.ts` cases
- `main.ts`, `preload.ts`, `serviceRegistry.ts`, `worldTypes.ts`,
  `global.d.ts`, `mockAPI.ts` wiring
- `WorldFolderTree.tsx` + `tests/WorldFolderTree.test.tsx`
- `WorldVobContextMenu.tsx` "Add to Folder" submenu
- `WorldSurface.tsx` wiring (state, handlers, the Folders tab) +
  `tests/WorldSurface.folders.test.tsx`
- Real-Electron E2E: `tests/e2e-electron/world-folders.spec.ts` — creates a
  folder through the context menu, reads the sidecar's actual bytes off
  disk, and reopens the world to prove it survives. The fixture world is
  copied into a fresh temp directory per test rather than opened from
  `zenkit-node/test/fixtures/` directly: folder edits save immediately
  (unlike a VOB edit, which waits for an explicit Save), so opening the
  committed fixture in place would have written a stray sidecar into the
  repo on every run.

## Verified

`pnpm --filter zen-world test/lint/typecheck`,
`pnpm --filter daedalus-dialog-editor test/lint`, `build:main`,
`typecheck:renderer` all green; the two real-Electron specs above pass
against a locally built addon and app.
