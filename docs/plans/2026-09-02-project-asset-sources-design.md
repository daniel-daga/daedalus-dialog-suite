# Project Asset Sources Design

## Goal

Replace the editor's single, machine-local Gothic installation setting with an
arbitrary-length, ordered asset-source list stored in a committed project file.
The project root is the default first source, and the same list drives the asset
browser and world loading.

## Project file and migration

The main process owns a versioned `*.gothicproject.json` file through a focused
project-config service. The initial schema contains `version`, `target`,
`scriptsRoot`, `worlds`, and `assetSources`. Relative paths resolve against the
project-file directory; folders outside the project may be absolute.

The existing **Open Project** folder workflow remains. On the first open of a
legacy folder, the main process atomically creates
`<folder-name>.gothicproject.json`. It seeds `scriptsRoot` with `.`,
`assetSources` with `.` followed by the old `gothicInstallPath` when one exists,
and uses conservative defaults for the not-yet-exposed target/world fields.
After a successful project-file write, the obsolete global setting is removed.
Later opens discover and validate the existing project file instead of
repeating migration.

This is an incremental introduction of the project-file abstraction. Dialog
indexing may continue to receive a resolved scripts-root folder internally;
unrelated project workflows do not need to move to a file-picker in this slice.

## Resolution and precedence

`assetSources` is a flat ordered list. Later entries override earlier entries,
matching `openVfs` and its current `overwrite: 'all'` behavior. The editor makes
that precedence visible in the list UI.

Each configured folder resolves to one or more native VFS mounts. A recognized
Gothic installation expands through the existing `gothicAssetSources` rule so
VDF archives are preferred and extracted compiled directories remain the
fallback. An ordinary asset folder mounts directly. Expansion preserves the
configured source order, including when one entry produces several mounts.

The project root is required and cannot be removed. It may be reordered, since
the ordered list is the user's explicit overlay policy.

## Data flow and ownership

Opening a folder calls one main-process operation that discovers or migrates the
project file, validates it, resolves paths, updates the path whitelist and
recents, and returns a normalized project descriptor plus structured warnings.
The renderer stores that descriptor and the warnings in `projectStore`.

Dialog indexing uses the descriptor's resolved `scriptsRoot`. The World surface
passes the descriptor's resolved VFS mounts when opening a world and no longer
reads `SettingsService.getGothicInstallPath`. The asset browser already reads
the loaded VFS, so it automatically sees the same overlay.

Changing the list affects the next world open. If a world is already open, the
dialog explains that reopening is required; it does not silently discard and
rebuild the current world session.

## User interface

A project-level **Asset sources...** action opens a modal list editor. It shows
the ordered folders, identifies unavailable entries, and labels that later
entries have higher priority. Users can add folders through a native directory
picker, remove all entries except the project root, and move entries up or down.
Saving validates and atomically writes the whole project file, refreshes the
normalized descriptor, and updates the warning state.

## Errors and warnings

Malformed JSON, invalid schema fields, ambiguous multiple project files, and an
unsupported future schema version prevent project opening with a precise error.
A missing or unreadable asset source does not: it is skipped and returned as a
structured warning naming the configured path. Warnings remain visible in the
project UI and can be dismissed for the current session.

A project with no usable asset mounts can still open for dialog editing. World
opening then fails with an actionable message asking the user to configure at
least one available asset source.

Migration is failure-safe. The legacy setting is deleted only after the new
project file has been written successfully, so a failed migration can be
retried without losing the old configuration.

## Testing

The user-facing workflow is developed from failing Playwright E2E coverage for
automatic legacy migration and asset-list editing. Focused Jest tests cover
schema validation, atomic migration, path resolution, source expansion and
precedence, missing-source warnings, settings cleanup, IPC validation, renderer
store state, and World-surface wiring.

Final verification runs the focused tests during development, then the editor
workspace test suite, Electron E2E suite, typecheck, and production build.
Durable project-format and security decisions are updated under
`docs/architecture/` when the implementation lands.
