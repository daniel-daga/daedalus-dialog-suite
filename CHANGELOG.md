# Changelog

What each published Windows build changed, newest first. Build Windows adds a
build here when it publishes it; write new notes in `RELEASE_NOTES.md`, not here.
Builds before 31 had no release notes.

## Build 36 — 2026-10-14

- #399: The asset browser lists source assets (3DS, ASC, MDS, MMS, TGA) by default; the rest behind its filter

## Build 35 — 2026-10-13

- #394: The GMBT quick test and asset compile no longer fail on files locked by an open world
- #262: Decals are drawn with their own blend — additive glows, cut-outs and multiplies, not all as transparency
- #318: Problems hints when a routine state has no bed, bench or other mob near its waypoint
- #391: Editing a decal's size, alpha weight or blend redraws it at once
- #395: Saving keeps a dialog condition as it was written; editing one condition rewrites only that one
- #395: Scripts open with the right characters: German files are no longer misread as Central European, and „“€ show correctly

## Build 34 — 2026-10-11

- #388: Putting a VOB placement down (right-click, Esc) selects the last VOB it placed
- #387: World editor: 1 and 2 switch move/turn (W and E no longer do); in turn mode WASD, Space and X turn the selection
- #386: Moving VOBs with the keys is faster by default; Ctrl moves slower, like the camera
- #390: A file deleted or re-added outside the editor while it was being re-read no longer comes back stale
- #382: A file edited twice in quick succession outside the editor no longer reverts to the first edit
- #381: A world still opening when you close or switch projects no longer leaves an error in the next World view
- #379: Closing, switching or reloading the project now asks before discarding unsaved world edits
- #380: Outside file edits still being read when you switch projects no longer show up in the new project
- #378: Saving no longer overwrites an outside edit to the file after you opened Review Changes

## Build 33 — 2026-10-09

- #367: Save As: write the world to a new .zen file
- #366: Place an asset by double-clicking it in the asset browser, or selecting it and pressing Space
- #364: Place in World stays armed until right-click or Esc, with an optional random Y; its clicks go through VOBs
- #373: Paste lands in front of the camera, standing on the ground
- #372: Drop to ground rests the model's base on the ground, or sinks it in with the new "Into ground"
- #374: Delete removes a VOB straight away; the confirm only appears when its children would go too
- #358: Holding a nudge key moves the selection smoothly, and undoes in one step
- #363: Hold Ctrl to slow the fly camera, as Shift speeds it up
- #362: The selected VOB is outlined instead of tinted yellow
- #368: Bushes and other card meshes are no longer placed upside down
- #371: The viewport no longer twitches when a VOB is added or removed in a world with missing textures
- #369: Clicking quickly through meshes in the asset browser no longer turns the app white
- #375: The asset preview spins on its own and shows the model's size
- #361: Asset search finds a raw .3DS by its source file name
- #360: Asset browser rows give their width to the file name
- #357: Asset browser filters stay usable in a narrow panel
- #324: The quest page is the quest's diary: edit its entries in place, and upgrade an implicit quest to MIS_
- #323: Quest conditions read "Quest X is running / completed / not running …", with the quest picked by its diary title
- #304: New dialog action "Use Item" (B_UseItem): an NPC uses an item, e.g. smokes a joint
- #275: Help button (or F1) shows every keyboard shortcut
- #355: String constants are edited as plain text, without their quotes
- #321: Waypoint pickers open their list on focus, like the other autocompletes

## Build 31 — 2026-10-08

- #285: New NPC editor: edit an existing NPC's attributes, talents, weapons and looks from the NPC list
- #298: The NPC editor shows a live preview of body, head and armour beside the form
- #311: Scrub Gothic animations in the NPC preview
- #306: NPC preview: correct texture orientation, texture variants and head/neck join
- #309: NPCs are drawn with their real meshes at their spawn points in the World view
- #315: Routine mode in the World view: see and edit an NPC's daily routine on the waynet
- #317: Edit an NPC's routine as a table in the NPC editor
- #316: Create a routine for an NPC that has none, and add routine variants
- #319: Routines, spawns and NPCs re-index when a script changes outside the editor
- #322: Quest steps as dialog actions: pick a quest by its diary title; new quests are declared automatically
- #278: Create log notes (LOG_NOTE) and see the diary title of a Log Entry's topic
- #280: Log Entry and other autocompletes open their list on focus
- #277: Default settings for new dialogs
- #279: Dialog numbers (priority) start at 1
- #281: The NPCs tab lists every NPC, not only those that already have a dialog
- #283: The important/permanent checkboxes match what the file says
- #264: Writes the scripts' subtitles into the OutputUnits database (OU.BIN / OU.CSL)
- #265: Warns when the OutputUnits database looks like another language
- #286: Saving no longer changes the blank lines between declarations
- #340: Saving keeps if/else blocks and every statement in dialog functions
- #328: Saving keeps conditions, comparisons and call arguments exactly as written
- #344: Saving keeps comments, literals and quoted arguments in place
- #300: Reloading a file changed outside the editor no longer overwrites your edits
- #301: Deleting a file outside the editor no longer loses edits not yet applied
- #299: Closing the window asks before discarding unsaved world edits
- #334: Opening another world asks before discarding unsaved world edits
- #302: Ctrl+S in the World view saves only the world
- #288: Asset browser: filter by VOB vs MOB
- #289: Asset browser: filter by file format
- #294: Uncompiled mod assets (raw .3DS/.ASC/.TGA) show up in the asset browser
- #297: Preview a raw .3DS without compiling it
- #296: Compile a mod's assets with GMBT from the asset browser
- #295: File many assets into a category at once
- #290: Placing an asset picks the VOB class automatically
- #291: Placed VOBs collide by default; bushes and grass do not
- #292: Moving or rotating a parent VOB moves its children
- #293: Reparent a whole selection at once in the scene tree
- #270: A MOB's interaction scheme is shown, read off its visual
- #266: A GMBT quick test that fails says why
- #351: Saving a script on Windows no longer fails while an NPC preview or a world is open
