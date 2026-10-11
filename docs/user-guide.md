# Dandelion user guide

Dandelion edits a Gothic 2 mod's Daedalus scripts and ZenGin worlds. This page
gets you from install to your first saved edit. Press **F1** anywhere in the app
for the full keyboard-shortcut sheet.

## Install and update

Download the installer from the
[download page](https://daniel-daga.github.io/daedalus-dialog-suite/) and run
it. The build is Windows-only and not yet code-signed, so SmartScreen asks once
("More info" → "Run anyway"). The app checks for a newer build on start and
offers it; every download is SHA-256 verified before it installs.

## Open your mod

On the welcome screen:

- **Open Project** — pick your mod's scripts folder (for a standard install,
  `_work/Data/Scripts/Content` or your mod's equivalent). Dandelion indexes
  every `.d` file in the background and watches the folder, so edits you make
  in another editor show up. Recent projects are listed below the buttons.
- **Open Single File** — edit one `.d` file without a project. Cross-file
  features (quests, Problems, NPC lists) need a project.

The bar on the left switches between the editors: **Dialog Editor**,
**Quest Editor**, **Variable Manager**, **Problems** and **World Editor**.

## Saving and undo

**Ctrl+S** saves. Edits are patched into the original source: comments, blank
lines, formatting and the file's encoding stay as they were, and only what you
changed is rewritten. **Ctrl+Z** / **Ctrl+Y** undo and redo. If a file changed
on disk while you had unsaved edits, Dandelion asks which version to keep
instead of overwriting either.

## Dialogs

Pick an NPC, then one of their dialogs (`C_INFO` instances). The editor shows
the dialog's properties (description, conditions, permanent/important flags)
and its actions in order: `AI_Output` lines, choices (`Info_AddChoice`) with
their own branches, inventory and NPC actions, log entries and quest-state
changes.

- **Enter** adds a line for the other speaker, **Shift+Enter** for the same
  speaker, **Ctrl+Enter** adds any other action.
- **Alt+↑ / Alt+↓** reorder actions; **Tab** moves between them.
- **Ctrl+F** searches the whole project.
- The **simulator** plays the dialog as the player would, with a scratch copy
  of the game state, so you can check conditions and branches without starting
  the game.

## Quests

The Quest Editor lists every quest — `Log_CreateTopic` topics and their `MIS_`
state variables — with the dialogs that start, advance and finish them. A
quest's page is its diary: entries are edited in place, and a quest that only
exists implicitly can be upgraded to a proper `MIS_` variable.

## Variables

The Variable Manager lists the project's global constants and variables with
their values and the file each lives in. Search them by name, filter by type,
add new ones and delete those you no longer need.

## NPCs and routines

Open an NPC from the NPC list to edit its `C_NPC` instance: attributes,
talents, equipment and visuals, with a bind-pose preview of the model. The
routine editor edits the NPC's `Rtn_` daily routines: each activity, its time
span and its waypoint. Gaps and overlaps in a day are flagged. Over an open
world, routines are edited on the map itself.

## Worlds

The World Editor opens a ZenGin `.zen` world in a 3D viewport.

1. In the project bar, open **Asset sources…** and add at least one asset
   source (your Gothic installation's data, or extracted asset folders), so
   meshes and textures can be found.
2. Open a world. The scene tree is on the left, the viewport in the middle and
   the selected VOB's properties on the right.
3. Move (**1**) and turn (**2**) the selection with the gizmo; **Ctrl+C / Ctrl+V**,
   **Ctrl+D** and **Del** copy, duplicate and delete; **G** rests the selection
   on the ground. Place new VOBs from the Assets panel.
4. Edit the waynet: add, connect and delete waypoints.
5. Organise the scene tree with your own folders; they are saved beside the
   world in a `<world>.folders.json` file and never touch the `.zen`.
6. If you use [GMBT](https://github.com/Szmyk/gmbt), point the project at
   your GMBT project folder in **Asset sources…** and start a quick test run of
   the open world.

Saving a world rewrites the `.zen` (Dandelion asks first). Existing savegames
will not match the changed world, and static lighting is not recomputed.

## Problems

The Problems panel lists syntax errors and project-wide checks, for example a
dangling `Npc_KnowsInfo`, overlapping routines, or a routine waypoint that the
world does not have. Click a problem to jump to it.

## Something wrong?

[Open an issue](https://github.com/daniel-daga/daedalus-dialog-suite/issues/new/choose)
with the version you run (the update dialog shows it), what you did and what
happened. If a file was saved wrongly, attach the smallest `.d` snippet that
shows it — never game files you are not allowed to share.
