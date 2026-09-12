import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import {
  Alert, Autocomplete, Box, Button, Checkbox, Dialog, DialogActions, DialogContent,
  DialogContentText, DialogTitle, FormControlLabel, IconButton, Paper, Snackbar, Stack, Tab, Tabs,
  TextField, Tooltip, Typography,
} from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import {
  AUTHORABLE_VOB_CLASSES,
  addVob, classPropKeys, alignVobsToNormal,
  deleteVobs, dropVobsToGround,
  duplicateVobs, emptyVobFolders,
  matchVobs,
  placeBounds,
  reparentVob, rotateVob, rotateVobs, setVobClassProp, setVobProp, setVobProps,
  topLevelVobs,
  translateVobs, vobExtentOf, vobIndexPath,
  type AuthorableVobClass, type ClassProps, type NewVob, type ReadProps,
  type VobExtent, type VobProps, type VobReader,
  type ZenBounds,
  type ZenPosition, type ZenRotation,
} from 'zen-world';
import type {
  DiscoveredWorld, InstancedPayload, WaynetPayload,
  WorldMeshPayload, WorldOp,
} from '../../../shared/worldTypes';
import { findFreePointVob, primaryVob, useWorldStore } from '../../store/worldStore';
import { stateOptions, stateReach } from '../../routines/routineSchedule';
import { useProjectStore } from '../../store/projectStore';
import { vobModelOf } from '../../world/vobModel';
import { LiveTileContext } from './WorldAssetGrid';
import { DEFAULT_EXPOSURE } from '../../world/WorldScene';
import WorldViewport, { type GizmoMode, type WorldViewportHandle } from './WorldViewport';
import WorldSceneTree from './WorldSceneTree';
import WorldFolderTree from './WorldFolderTree';
import WorldPropertyGrid from './WorldPropertyGrid';
import WorldAssetBrowser from './WorldAssetBrowser';
import WorldAssetPreview, { NAME_OF, isPlaceableVisual } from './WorldAssetPreview';
import WaypointPanel from './WaypointPanel';
import WorldVobContextMenu from './WorldVobContextMenu';
import PanelSplitter from './PanelSplitter';
import { usePanelLayout, COLLAPSED_PANEL_WIDTH } from './hooks/usePanelLayout';
import { useWaynetEditing } from './hooks/useWaynetEditing';
import { useVobFolders } from './hooks/useVobFolders';
import { useVobClipboard, type VobClipboardInput } from './hooks/useVobClipboard';
import { useScatterBrush } from './hooks/useScatterBrush';
import { useInsertNpc } from './hooks/useInsertNpc';
import { useAssetCatalog } from './hooks/useAssetCatalog';
import { useWorldShortcuts } from './hooks/useWorldShortcuts';
import { useWorldEditPipeline } from './hooks/useWorldEditPipeline';
import WorldToolbar from './toolbar/WorldToolbar';
import { OUTLINE_MODE_ORDER } from './toolbar/WorldViewControls';
import WorldStatusStats from './toolbar/WorldStatusStats';
import type { OutlineMode } from '../../world/VobOutline';
import type { CameraSlotOutcome } from '../../world/cameraSlots';
import WorldPickerDialog from './WorldPickerDialog';
import InsertNpcDialog from './InsertNpcDialog';
import ErrorBoundary from '../ErrorBoundary';

// The World surface (level-editor.md §6): a new top-level view of the existing
// app, lazily loaded, so `zenkit-node` is pulled in only when a world is
// actually opened and dialog-only sessions never touch the native addon.
//
// This shell owns the IPC calls and hands the viewport finished payloads; the
// viewport owns the Three.js lifetime. Nothing here keeps a geometry buffer in
// React state.

/** A new VOB is placed unrotated: the terrain click gives a point and nothing
 *  else, and inventing an orientation from a surface normal is a feature with
 *  its own decisions (which axis is up for this visual?) rather than a default. */
const IDENTITY: ZenRotation = [1, 0, 0, 0, 1, 0, 0, 0, 1];

interface WorldSurfaceProps {
  /**
   * Another view is on screen and this one is only kept mounted so its geometry
   * survives the trip (`docs/refactoring-targets.md` §8). Everything React is
   * unaffected — what it buys is the viewport's frame loop stopping, which the
   * display toggle that hides us does nothing about on its own.
   */
  hidden?: boolean;
}

/**
 * Where the slider starts when it is switched on. Mid-morning rather than
 * midnight: the routines put most NPCs somewhere in the working day, so 08:00
 * shows a populated world, and a slider opening on an empty one would read as a
 * broken layer rather than as the hour it is.
 */
const DEFAULT_SPAWN_TIME = 8 * 60;

/** What the place dialog collects. `parent` is a flat index or null for a
 *  root; where the VOB goes is the ground point, chosen before or after. */
interface PlaceSpec {
  vobClass: AuthorableVobClass; name: string; visual: string; instance: string;
  parent: number | null;
}
const FRESH_PLACE: PlaceSpec = { vobClass: 'zCVob', name: '', visual: '', instance: '', parent: null };
/** How the status bar names an armed placement: the visual or the instance
 *  when there is one, the class otherwise. */
function placeLabel(spec: PlaceSpec): string {
  if (spec.vobClass === 'zCVob' && spec.visual.trim() !== '') return spec.visual.trim();
  if (spec.vobClass === 'oCItem' && spec.instance.trim() !== '') return spec.instance.trim();
  return spec.vobClass;
}

const WorldSurface: React.FC<WorldSurfaceProps> = ({ hidden = false }) => {
  const status = useWorldStore((s) => s.status);
  const summary = useWorldStore((s) => s.summary);
  const error = useWorldStore((s) => s.error);
  const editError = useWorldStore((s) => s.editError);
  const selection = useWorldStore((s) => s.selection);
  const selectedWaypoint = useWorldStore((s) => s.selectedWaypoint);
  const waypointSiteIndex = useProjectStore((s) => s.waypointSiteIndex);
  const spawnSiteIndex = useProjectStore((s) => s.spawnSiteIndex);
  const routineSiteIndex = useProjectStore((s) => s.routineSiteIndex);
  const routineNpcIndex = useProjectStore((s) => s.routineNpcIndex);
  const routineStateIndex = useProjectStore((s) => s.routineStateIndex);
  const {
    beginOpen, openSucceeded, openFailed, selectVob, toggleVob, selectWaypoint,
  } = useWorldStore.getState();

  const [mesh, setMesh] = useState<WorldMeshPayload | null>(null);
  const [visuals, setVisuals] = useState<InstancedPayload | null>(null);
  const [terrainPoint, setTerrainPoint] = useState<[number, number, number] | null>(null);
  /**
   * The VOB being placed, while the dialog is open. Null when it is closed.
   *
   * `parent` is a flat index or null for a root. It is offered as a choice
   * rather than taken from the selection outright, because the two clicks that
   * set up a parented placement — the ground, then the row — do not say which
   * the user meant, and appending a root is the case that renumbers nothing.
   */
  const [placing, setPlacing] = useState<PlaceSpec | null>(null);
  /**
   * An add action waiting for its ground click (level-editor.md §17, "Adding
   * things"): the toolbar's three dialogs confirm into this when no ground
   * point has been chosen yet, and the Assets panel's "Place in world" arms
   * it directly. The next terrain pick spends it — one click, one add — and
   * Escape or the status bar's Cancel drops it. Null is the ordinary state.
   */
  const [armed, setArmed] = useState<
    | { kind: 'place'; spec: PlaceSpec }
    | { kind: 'insert-npc'; instance: string; waypoint: string }
    | { kind: 'add-waypoint'; name: string }
    | null
  >(null);
  /** The VOB the delete warning is about, or null when it is closed. A flat
   *  index rather than a boolean: the dialog names what it is about to remove,
   *  and the selection can change under an open dialog. */
  /** The VOBs the confirm dialog is about — the whole selection since #253,
   *  not the primary of it. */
  const [deleting, setDeleting] = useState<readonly number[] | null>(null);
  // The left panel is the scene *or* the mounted assets, and the right panel
  // follows it: a VOB's properties belong beside the tree, an asset's preview
  // beside the browser.
  const [panel, setPanel] = useState<'scene' | 'assets' | 'folders'>('scene');
  const [selectedAsset, setSelectedAsset] = useState<string | null>(null);
  const {
    panelWidths,
    leftPanelCollapsed,
    rightPanelCollapsed,
    setLeftPanelWidth,
    setRightPanelWidth,
    setLeftPanelCollapsed,
    setRightPanelCollapsed,
    persistPanelWidths,
  } = usePanelLayout();
  // Fetched the first time it is switched on and kept afterwards. It is a
  // separate IPC call on purpose: an overlay nobody asked for should not be in
  // the cold open.
  const [waynet, setWaynet] = useState<WaynetPayload | null>(null);
  /** A waypoint to fly to as soon as the world opened for it is on screen
   *  (#226) — see `openWorldNamed`. */
  const [pendingJump, setPendingJump] = useState<string | null>(null);
  const [showWaynet, setShowWaynet] = useState(false);
  const {
    listAssets, searchAssets, loadTexture, loadVisual, thumbnails, liveTile,
    catalogProps: assetCatalogProps,
  } = useAssetCatalog();

  // The place verb on an asset row or tile (§16.37 row 4). The same arming the
  // preview panel's button does, offered where the pointer already is.
  const assetPlacement = useMemo(() => ({
    canPlace: isPlaceableVisual,
    onPlace: (name: string) => setArmed({ kind: 'place', spec: { ...FRESH_PLACE, visual: name } }),
  }), []);

  /** The clipboard is cleared when a world opens, and `openWorldAt` is well
   *  above `commitOps` and the two readers a copy needs — so the hook is called
   *  here and handed its inputs further down, through this ref. */
  const clipboardInput = useRef<VobClipboardInput | null>(null);
  const {
    copySelection, pasteClipboard, hasClipboard, clearClipboard,
  } = useVobClipboard(clipboardInput);

  const {
    vobFolders,
    setVobFolders,
    addSelectionToFolder,
    createEmptyFolder,
    createFolderWithSelection,
    renameFolder: renameFolderHandler,
    deleteFolder: deleteFolderHandler,
    removeVobFromFolder: removeVobFromFolderHandler,
  } = useVobFolders();
  /** How many batches the main process can undo/redo — the World bar's
   *  buttons' only way to know, since the stacks are private to
   *  `WorldService` (§7). Refreshed after every applied batch and after a
   *  fresh open, never bumped locally: what this side thinks it sent is not
   *  what decides, same as everywhere else an edit's outcome is read back. */
  const [historyDepth, setHistoryDepth] = useState({ undo: 0, redo: 0 });
  const refreshHistoryDepth = useCallback(async () => {
    setHistoryDepth(await window.editorAPI.getWorldHistoryDepth());
  }, []);
  /** The spawn markers (§16.19 slice 4), beside `showWaynet` because they are
   *  the same kind of thing: a layer over the world, off until asked for. Two
   *  toggles rather than one — the waynet is the world's graph and the markers
   *  are the script's opinion of it, and reading one against the other is
   *  exactly the comparison a story author is making. */
  const [showSpawns, setShowSpawns] = useState(false);
  /** The minute of the day the spawn layer is showing, or null for the static
   *  spawns (§16.19 slice 5). Null is the slider off rather than midnight: where
   *  an NPC stands at 00:00 is a thing the routines answer, and "no time chosen"
   *  is not, so the two cannot share a value. */
  const [spawnTime, setSpawnTime] = useState<number | null>(null);
  /**
   * The quest state the day is drawn through, or null for each NPC's declared
   * routine (§16.19 slice 13). It is a *lens* — "draw the day as if this state
   * were active" — never a claim the game reaches it, which is why an NPC with
   * no variant for it keeps his declared day rather than dropping out.
   */
  const [spawnState, setSpawnState] = useState<string | null>(null);
  /** Waypoint names drawn over the viewport (§16.19 slice 8), and on a marked
   *  point the NPCs standing on it instead (slice 14). Its own toggle rather
   *  than a property of the waynet's, because the dots and the names answer
   *  different questions — where the net runs, and who is at this one — and one
   *  of them is wanted far more often than the other. */
  const [showWaypointNames, setShowWaypointNames] = useState(false);
  /** Which VOBs carry the outline (#229). A view setting, not an edit: no op,
   *  nothing saved, and not persisted across a session either — the other view
   *  toggles on this bar are not. */
  const [outlineMode, setOutlineMode] = useState<OutlineMode>('all');
  /** The name being typed into the add-waypoint dialog, or null when it is
   *  closed. A name is the whole of what a placed waypoint has to be told —
   *  the position is the terrain point and everything else the binding fixes —
   *  so the dialog's state is that one string. */
  const [addingWaypoint, setAddingWaypoint] = useState<string | null>(null);
  /**
   * A name the Problems panel's "Add to world" action armed, or null. Not the
   * dialog's own draft — `addingWaypoint` — but what the *next* terrain click
   * should offer instead of `suggestedWaypointName()`: the request carries no
   * position, only a name, so there is nothing to place until the user picks
   * one. Consumed the moment `world-add-waypoint` is clicked, whether or not
   * the dialog it opens is then confirmed — the same way a fresh suggested
   * name is spent by that click today.
   */
  const [pendingWaypointName, setPendingWaypointName] = useState<string | null>(null);
  /** The waypoint the delete warning is about, as an index+name pair, or null
   *  when it is closed. The name is kept beside the index for the dialog to
   *  show and for the op to be guarded by: it is read when the dialog opens,
   *  which is the enumeration the user is looking at. */
  const [deletingWaypoint, setDeletingWaypoint] =
    useState<{ waypoint: number; name: string } | null>(null);
  /**
   * How bright the viewport draws — component state, beside `showWaynet` and
   * the gizmo mode, because it is the same kind of thing they are: a setting
   * about the picture, not about the world. It reaches nothing but the
   * viewport, so it produces no op and cannot make the world dirty, and it is
   * not persisted for the same reason nothing else on this bar is.
   */
  const [exposure, setExposure] = useState(DEFAULT_EXPOSURE);
  /**
   * Whether the selected `zCVobLight` is drawn as a lamp on the picture (#256).
   *
   * The same kind of setting as `exposure` and off for a reason of its own: the
   * room already holds this light's baked contribution, so the preview shows
   * what one light reaches rather than what the engine will draw. It reads the
   * range and colour the sphere already reads, and writes nothing.
   */
  const [lightPreview, setLightPreview] = useState(false);
  /**
   * VOB classes switched off in the viewport — Spacer's per-class show/hide.
   *
   * The same kind of setting as `exposure`: it decides what is drawn, never
   * what the world holds. A hidden VOB is still in the index, still in the
   * scene tree and still selectable there; it is only not drawn and, because
   * the pick pass reads the same flag, not clickable.
   */
  const [hiddenClasses, setHiddenClasses] = useState<readonly string[]>([]);

  /**
   * The item instances the loaded script project declares — the first thing the
   * World surface reads out of the *dialog* side of the app.
   *
   * It is here for one field: `oCItem.instance` names a Daedalus instance and
   * ZenGin crashes on a name no script declares (level-editor.md §14.1). The
   * main process cannot make that check — it holds no item index (see
   * `ipcValidation.ts`) — and it must not be a hard refusal anywhere, because a
   * world can legitimately be edited with no project open. So it is a renderer
   * refusal over whatever index happens to be there, and an absent one refuses
   * nothing.
   *
   * `mergedSemanticModel` is merged per category with a stable identity
   * (`projectStore.ts`'s `mergeCache`), so this memo recomputes when the item
   * files are ingested and not on every unrelated project edit. Uppercased once,
   * here, because Daedalus symbols are case-insensitive and the parser keys the
   * map by the name as it was written.
   */
  const items = useProjectStore((s) => s.mergedSemanticModel.items);
  const itemInstances = useMemo(
    () => new Set(Object.keys(items ?? {}).map((name) => name.toUpperCase())),
    [items],
  );
  /**
   * Which world the surface is showing, bumped by every open.
   *
   * An edit is sent, awaited, and only then applied to the projection — so an
   * open that starts while a commit is out lands its summary first, and the
   * commit comes back to a store holding a different world. `applied` would
   * write A's ops into B's columns, mark B edited (blocking its quick test over
   * bytes that are in fact clean), and hand the viewport A's ops to draw.
   * `WorldService.generation` is the same guard on the authoritative side; this
   * is the projection's own, because the two states are separate.
   *
   * A ref rather than state: it is read across an await inside callbacks, never
   * rendered, and a re-render on open would be one nobody asked for.
   */
  const openGeneration = useRef(0);

  /** Uppercased instance → the `visual` its declaration assigns, read off
   *  the instance's verbatim source (§16.26 row 2): the semantic model keeps
   *  no per-field record of a `C_ITEM`, and the one line the picker needs is
   *  a regex away. An item that assigns none, or through a constant, has no
   *  picture and is offered by name. */
  const itemVisuals = useMemo(() => {
    const visuals = new Map<string, string>();
    for (const [name, item] of Object.entries(items ?? {})) {
      const match = /\bvisual\s*=\s*"([^"]+)"/i.exec(item.sourceText ?? '');
      if (match !== null) visuals.set(name.toUpperCase(), match[1]);
    }
    return visuals;
  }, [items]);

  const openWorldAt = useCallback(async (worldPath: string) => {
    beginOpen();
    setMesh(null);
    setVisuals(null);
    setTerrainPoint(null);
    // An armed name is a request about *this* open, and a new one answers no
    // question the previous open's Problems scan asked. The same for an
    // armed add: it was about a world that is being replaced.
    setPendingWaypointName(null);
    setArmed(null);
    // The waynet goes too, and it is the one reset that is not obvious: the
    // viewport mounts on `mesh && visuals && summary`, so a payload left
    // standing here draws the *previous* world's waypoints over the new one
    // until the read at the end of this open lands — and a drag committed in
    // that window builds its op from the old names, which the binding's name
    // guard refuses with a message about a waynet that changed. A failed open
    // would leave it standing for good.
    setWaynet(null);
    setVobFolders(emptyVobFolders());
    // The previous world's edits are not this one's, and a quick test over the
    // new world has nothing to be stale about yet. The generation goes with it:
    // an edit still in flight belongs to the world being left behind.
    setUnsavedEdits(false);
    openGeneration.current += 1;
    // And neither are the previous world's *reports*: "Saved to …" standing
    // over a world that was never saved is a lie, and a save error about a file
    // nobody is looking at any more is noise.
    setSavedTo(null);
    setSaveError(null);
    clearClipboard();
    // An asset previewed out of the previous world's mounts, which the new
    // world's may not even have.
    setSelectedAsset(null);

    try {
      // Main resolves the active project's ordered sources and owns the VFS
      // mount list; the renderer sends only the project configuration identity.
      const opened = await window.editorAPI.openWorld({
        worldPath,
        gameVersion: 'g2',
        projectFilePath: useProjectStore.getState().projectFilePath ?? '',
      });
      openSucceeded(opened);
      // A fresh open starts an empty history in the main process — this is
      // the World bar's undo/redo buttons picking that up rather than
      // showing whatever the previous world left them at.
      void refreshHistoryDepth();

      // Requested after the summary, so the scene tree and the load timings are
      // on screen while 31 MB of geometry crosses.
      setMesh(await window.editorAPI.getWorldMesh());
      setVisuals(await window.editorAPI.getWorldVisuals());
    } catch (failure) {
      openFailed(failure instanceof Error ? failure.message : String(failure));
      return;
    }

    // **Outside the try above, and that is the whole point.** The waynet is read
    // here rather than when the overlay is first shown, because it is not only
    // the overlay's any more: the Problems scan reads its names to answer
    // whether a script names a place this world has (level-editor.md §16.8).
    // Left lazy, the rule would say nothing at all until somebody happened to
    // switch the overlay on — silently, since a world with no findings looks
    // exactly like one with nothing to find.
    //
    // But by the time it runs the world is *open*: `openSucceeded` has
    // published a `ready` summary and 31 MB of mesh and visuals are on screen.
    // Routed to `openFailed` — which resets the whole surface — a transient
    // worker or IPC error would throw all of that away over a payload only two
    // things read, and re-paying the open is the only way back, while the main
    // process still holds the world. So it is reported the way a refused edit
    // is: a warning over a world that is still open and still correct, leaving
    // `waynet` null, which the store and the waypoint rule already read as
    // "nothing is known".
    try {
      setWaynet(await window.editorAPI.getWorldWaynet());
    } catch (failure) {
      useWorldStore.getState().editFailed(
        failure instanceof Error ? failure.message : String(failure),
      );
    }

    // The portal findings, for the same Problems scan and outside the try for
    // the same reason (level-editor.md §16.20 slice 3). Once per open: no op
    // touches the world mesh they are computed over. Published straight to
    // the store — nothing on this surface draws them, since framing a polygon
    // is deliberately not built.
    try {
      useWorldStore.getState().portalsLoaded(await window.editorAPI.getWorldPortalFindings());
    } catch (failure) {
      useWorldStore.getState().editFailed(
        failure instanceof Error ? failure.message : String(failure),
      );
    }

    // The `<worldname>.folders.json` sidecar (VOB folders slice) — outside
    // the try above for the same reason the waynet is: a failure here is a
    // world that opened correctly and has an editor-only extra nobody could
    // read, not a reason to throw away 31 MB of geometry and re-pay the open.
    try {
      setVobFolders(await window.editorAPI.getVobFolders(worldPath));
    } catch (failure) {
      useWorldStore.getState().editFailed(
        failure instanceof Error ? failure.message : String(failure),
      );
    }
  }, [beginOpen, openSucceeded, openFailed, refreshHistoryDepth, setVobFolders, clearClipboard]);

  /**
   * The world picker (level-editor.md §16.31): the worlds the project's own
   * asset sources hold, listed instead of a native file dialog pointed at one
   * install. The scan runs on open, not on mount — a project's sources change
   * under the dialog, and a list nobody is looking at is a directory walk
   * nobody asked for.
   */
  const openPicker = useCallback(async () => {
    setPickerOpen(true);
    setPickerError(null);
    setPickerLoading(true);
    try {
      setDiscoveredWorlds(await window.editorAPI.listWorlds());
    } catch (failure) {
      setDiscoveredWorlds([]);
      setPickerError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setPickerLoading(false);
    }
  }, []);

  /**
   * Textures the VFS could not decode (level-editor.md §16.31). Said out loud,
   * because the alternative is white geometry the user has to reverse-engineer:
   * a mod folder holds *source* `.TGA` files, which resolve by name and then
   * fail to parse — they are textures the mod has not compiled yet.
   */
  const reportTextureFailures = useCallback((names: string[]) => {
    useWorldStore.getState().editFailed(
      `${names.length} texture${names.length === 1 ? '' : 's'} could not be decoded and draw white — `
      + `${names.slice(0, 3).join(', ')}${names.length > 3 ? '…' : ''}. `
      + 'A source .TGA in a mod folder resolves by name but is not a compiled ZenGin texture.',
    );
  }, []);

  /**
   * What the last camera-slot keystroke did (09-04 review §5.1 item 6). The
   * slots were the one navigation that said nothing, and a recall is exactly
   * the case where silence is ambiguous: an empty slot moves nothing, and so
   * does a recall onto the pose you are already at. The message is the only
   * difference between "that shortcut does nothing" and "that slot is empty".
   *
   * Transient, unlike the three Alerts above the viewport: those are about a
   * world and stand until dismissed, this is about a keystroke. The nonce
   * makes a repeated outcome a fresh notice — pressing Ctrl+2 twice on an
   * empty slot has to say so twice, and the message alone is unchanged.
   */
  const [cameraSlotNotice, setCameraSlotNotice] =
    useState<{ text: string; nonce: number } | null>(null);
  const reportCameraSlot = useCallback((outcome: CameraSlotOutcome, slot: number) => {
    // The slot is zero-based; the key the user pressed is one higher.
    const named = `Camera slot ${slot + 1}`;
    setCameraSlotNotice((previous) => ({
      text: outcome === 'stored' ? `${named} stored`
        : outcome === 'recalled' ? `${named} recalled`
          : `${named} is empty`,
      nonce: (previous?.nonce ?? 0) + 1,
    }));
  }, []);

  const pickWorld = useCallback((worldPath: string) => {
    setPickerOpen(false);
    void openWorldAt(worldPath);
  }, [openWorldAt]);

  /** Everything the list cannot reach — a world outside the sources. */
  const browseForWorld = useCallback(async () => {
    let worldPath: string | null = null;
    try {
      worldPath = await window.editorAPI.openWorldDialog();
    } catch (failure) {
      setPickerError(failure instanceof Error ? failure.message : String(failure));
      return;
    }
    if (!worldPath) return;
    setPickerOpen(false);
    void openWorldAt(worldPath);
  }, [openWorldAt]);

  // The payload is the overlay's, and its *names* are also the Problems
  // scan's world input. Published from one effect rather than beside each of
  // the three `setWaynet` calls, so a fourth cannot forget: the store keeps its
  // object identity when a re-read changed no name, which is what confines the
  // re-scan to the ops that can change the set (§16.8).
  useEffect(() => {
    useWorldStore.getState().waynetLoaded(waynet);
  }, [waynet]);

  /**
   * The waynet read both overlay toggles make when the open's own read left
   * nothing behind — reported rather than swallowed.
   *
   * The open path was rewritten to report this instead of throwing the world
   * away (2026-08-29 review, finding 1); these two made the same read and said
   * nothing at all, so a failure left the toggle on, the overlay empty and no
   * word about why. The banner over an open world is the same one that path
   * uses.
   */
  const readWaynetInto = useCallback(
    async (into: (payload: WaynetPayload | null) => void): Promise<void> => {
      try {
        into(await window.editorAPI.getWorldWaynet());
      } catch (failure) {
        useWorldStore.getState().editFailed(
          failure instanceof Error ? failure.message : String(failure),
        );
      }
    },
    [],
  );

  const toggleWaynet = useCallback(async () => {
    const next = !showWaynet;
    setShowWaynet(next);
    // The overlay is hidden rather than destroyed, so nothing else would notice
    // a waypoint still being selected — and the gizmo would go on standing, and
    // dragging, where there is no longer a dot to see.
    if (!next) selectWaypoint(null);
    if (next && waynet === null) await readWaynetInto(setWaynet);
  }, [showWaynet, waynet, selectWaypoint, readWaynetInto]);

  // The markers stand on waypoints, so the layer needs the payload the waynet
  // overlay needs. The open reads it already; this covers the case where that
  // read failed over a world that stayed open, which leaves it null.
  // The two halves of the routine index arrive as separate store fields — one
  // is keyed by routine and the other by NPC — and `routineSchedule` wants them
  // together. Memoized because it is a viewport prop, and a fresh object every
  // render would rebuild the overlay on every render.
  const routines = useMemo(
    () => ({
      sites: routineSiteIndex,
      routinesByNpc: routineNpcIndex,
      statesByNpc: routineStateIndex,
    }),
    [routineSiteIndex, routineNpcIndex, routineStateIndex],
  );

  // Every state name any NPC has a variant for, shared names first. Ordered
  // by the module, because the index's own order is whichever file the worker
  // pool finished first.
  const stateOptionList = useMemo(() => stateOptions(routines), [routines]);

  // How far the chosen state actually reaches. Without this the label is a lie
  // by omission: a state moves the NPCs that have a variant for it and leaves
  // every other one on his declared day, so "State: TOT" over a world where one
  // NPC moved would read as "the world is in TOT". Same job as the grey
  // unplaced markers — the weaker fact must not read as the stronger.
  const spawnStateReach = useMemo(
    () => stateReach(routines, spawnState),
    [routines, spawnState],
  );

  const toggleSpawns = useCallback(async () => {
    const next = !showSpawns;
    setShowSpawns(next);
    // The time control belongs to this layer and is only shown with it, so a
    // time left set behind a hidden layer would come back on with the layer and
    // surprise whoever turned it on expecting the spawns.
    if (!next) {
      setSpawnTime(null);
      setSpawnState(null);
    }
    if (next && waynet === null) await readWaynetInto(setWaynet);
  }, [showSpawns, waynet, readWaynetInto]);


  // A plain click replaces the selection; Shift, Ctrl or Cmd adds to it. One
  // rule for
  // both panels — the tree is the only way to reach a VOB the viewport cannot
  // draw (a decal, a sound VOB), and the viewport the only way to reach one the
  // tree has not been scrolled to.
  const handleSelect = useCallback((vob: number, additive: boolean) => {
    if (additive) toggleVob(vob); else selectVob(vob);
    // The preview and the property grid share the right-hand panel, and the
    // preview used to win it outright — so picking a VOB while the Assets tab
    // was open went on showing the mesh being browsed, with nothing on screen
    // saying the pick had landed (§5.2 item 10 of the 2026-09-04 review).
    // Cleared on the pick rather than made to lose the panel: a pick is the
    // user turning away from the asset, and the browser still has its own
    // highlight to bring it back.
    setSelectedAsset(null);
  }, [selectVob, toggleVob]);

  /**
   * The right-click menu (level-editor.md §17, the
   * app's first context menu) — the vob it is about, and its anchor
   * position in viewport coordinates. Null while closed.
   */
  const [contextMenu, setContextMenu] = useState<{
    vob: number; position: { left: number; top: number };
  } | null>(null);

  /** Opens the menu for `vob` — replacing the selection with it first when
   *  it was outside the selection, the way every right-click does: the menu
   *  always acts on the row it was opened from. A right-click on a VOB
   *  already inside a multi-selection leaves it standing, so the menu's
   *  Duplicate/Copy/Drop/Align act on the whole selection. */
  const openVobContextMenu = useCallback((vob: number, position: { left: number; top: number }) => {
    if (!selection.includes(vob)) handleSelect(vob, false);
    setContextMenu({ vob, position });
  }, [selection, handleSelect]);

  /** The menu's "Hide this class" — the right-clicked VOB's own class,
   *  added to the same list the toolbar's Hide control drives. */
  const hideVobClass = useCallback(() => {
    if (contextMenu === null || summary === null) return;
    const cls = vobModelOf(summary).reader.className(contextMenu.vob);
    if (cls === null) return;
    setHiddenClasses((current) => (current.includes(cls) ? current : [...current, cls]));
  }, [contextMenu, summary]);

  /**
   * The imperative handle onto the viewport (level-editor.md §16.5,
   * `refactoring-targets.md` §9) — what the surface needs of the scene that is
   * a command or a query rather than a prop: a per-VOB downward raycast for
   * drop-to-ground and align-to-normal, and the camera jump below.
   */
  const viewportRef = useRef<WorldViewportHandle>(null);

  /**
   * A double-click on a scene-tree row, or its locator: select the VOB and jump
   * the camera to it, leaving the orbit pivot on it.
   *
   * It carries the VOB rather than relying on the selection, which reaches the
   * viewport a render later — and it is a call rather than a prop because it is
   * a command and not a state: the same VOB is jumped to twice precisely after
   * the camera has been flown away from it.
   */
  const focusVob = useCallback((vob: number) => {
    handleSelect(vob, false);
    const viewport = viewportRef.current;
    // Reported rather than optional-chained away (§16.24 5). Every link of this
    // path used to swallow a null, so a locator that had stopped working was
    // indistinguishable from one that had jumped to a VOB already on screen —
    // which is exactly how it went unnoticed for a session. A VOB with no
    // instance is a legitimate `not-drawn`, and it is still worth saying: the
    // button was pressed and nothing moved.
    if (viewport === null) { console.warn(`Could not jump to VOB ${vob}: no-scene`); return; }

    const failure = viewport.frameVob(vob);
    if (failure === null) return;

    // `not-drawn` used to be most of the VOB index (§16.24): a VOB gets an
    // instance only if its visual resolves, so zCVobSpot, oCItem, the triggers,
    // the zones and the sound VOBs had none and were permanently unlocatable.
    // The markers closed most of that (§16.38) — a VOB with no visual at all is
    // drawn now, and the viewport frames it like any other. What is left is the
    // VOB whose visual is a *name* resolving to no geometry, a decal or a
    // `.PFX`, and the index carries a position for those too: the camera jumps
    // to the point instead, the same jump a waypoint gets.
    const at = failure === 'not-drawn' && summary !== null
      ? vobModelOf(summary).reader.position(vob)
      : null;
    const outcome = at === null ? failure : viewport.framePoint(at);
    if (outcome !== null) console.warn(`Could not jump to VOB ${vob}: ${outcome}`);
  }, [handleSelect, summary]);

  /**
   * The camera's own position, on demand — what the scene tree's "within
   * reach of the camera" filter measures VOBs against. Unlike `focusVob`, a
   * pure read: the tree polls this itself while that filter is on, and a
   * scene mid-rebuild answers null the same way `frameVob` reports no scene.
   */
  const getCameraPosition = useCallback(
    () => viewportRef.current?.cameraPosition() ?? null,
    [],
  );

  /**
   * The jump itself — the camera onto the point a name reaches. Lifted out of
   * the focus effect below because it has a second caller now: a jump into a
   * world that had to be opened for it first (#226).
   */
  const jumpToPoint = useCallback((name: string) => {
    // The name comes out of a script, where Daedalus is case-insensitive, and
    // the waynet is the world's own spelling.
    const wanted = name.toUpperCase();
    const waypoint = waynet === null
      ? -1
      : waynet.names.findIndex((each) => each.toUpperCase() === wanted);

    if (waynet !== null && waypoint >= 0) {
      // The overlay is switched on rather than assumed: with it off the gizmo
      // would stand where there is no dot to see, which is the same objection
      // `toggleWaynet` answers in the other direction.
      setShowWaynet(true);
      selectWaypoint(waypoint);
      const positions = new Float32Array(waynet.positions);
      viewportRef.current?.framePoint([
        positions[waypoint * 3], positions[waypoint * 3 + 1], positions[waypoint * 3 + 2],
      ]);
      return;
    }

    // Not a waypoint, so it may still be a free point — those are `zCVobSpot`
    // VOBs, and the button that offers this jump enables itself for them
    // (`worldHasPoint`). Without this the jump would land nowhere at all, which
    // is a worse answer than the disabled one that button used to give.
    const spot = findFreePointVob(summary, wanted);
    if (spot !== null) focusVob(spot);
  }, [waynet, summary, focusVob, selectWaypoint]);

  /**
   * The world an NPC lives in, opened from outside the surface (#226). The
   * dialog editor's jump names the `.ZEN` the spawn site's own `STARTUP_`
   * function points to; the path comes from the same scan the picker lists
   * (§16.31), which is why naming a world resolves to a file with no
   * world-directory setting of its own — the project's asset sources already
   * say where worlds are.
   */
  const openWorldNamed = useCallback(async (worldName: string, thenFocus: string) => {
    let worlds: DiscoveredWorld[];
    try {
      worlds = await window.editorAPI.listWorlds();
    } catch (failure) {
      useWorldStore.getState().editFailed(
        failure instanceof Error ? failure.message : String(failure),
      );
      return;
    }
    const wanted = `${worldName.toUpperCase()}.ZEN`;
    const found = worlds.find((world) => world.name.toUpperCase() === wanted) ?? null;
    if (found === null) {
      useWorldStore.getState().editFailed(
        `${wanted} is not among the project's asset sources — open it with Browse…, `
        + 'or add the folder that holds it to the project.',
      );
      return;
    }
    await openWorldAt(found.path);
    // A refused open has replaced the surface with its own error; a jump into
    // it would be one nothing will ever take.
    if (useWorldStore.getState().status !== 'ready') return;
    // Left to the effect below rather than jumped here, and both halves of
    // that are the point. Not here: React commits this open's mesh and visuals
    // on a task of its own, so at this line the viewport that owns the camera
    // is not mounted and there is nothing to fly. And not back through
    // `requestFocus` either: a store update renders at sync priority and may
    // skip the `setWaynet` this very open just made, which is how the first
    // cut jumped into a world whose waynet it could not yet see. A `useState`
    // lands in the same batch as the open's own — one render, one commit, and
    // the effect runs with the world on screen and its waynet in hand.
    setPendingJump(thenFocus);
  }, [openWorldAt]);

  useEffect(() => {
    if (pendingJump === null) return;
    setPendingJump(null);
    jumpToPoint(pendingJump);
  }, [pendingJump, jumpToPoint]);

  /**
   * A jump asked for from outside the surface — the Problems panel's click on a
   * world finding (§16.20 slice 2). The panel cannot call the viewport: it is
   * another view, and while it is on screen this one may not even be mounted.
   * So it leaves a request in the store and this consumes it.
   *
   * Taken exactly once, whether or not it lands: a request left standing would
   * fire again on the next waynet re-read, long after the click that made it.
   */
  const focusRequest = useWorldStore((s) => s.focusRequest);
  useEffect(() => {
    if (focusRequest === null) return;
    useWorldStore.getState().focusHandled();

    if (focusRequest.kind === 'vob') { focusVob(focusRequest.vob); return; }

    // A portal finding (#222). It carries its own geometry because the scene
    // has none to look up, and the viewport draws it as well as flies to it —
    // a portal is an invisible face, so framing alone shows a wall.
    if (focusRequest.kind === 'polygon') {
      const viewport = viewportRef.current;
      // Reported rather than optional-chained away, for §16.24 5's reason: a
      // locator that has stopped working must not look like one that jumped to
      // something already on screen.
      const outcome = viewport === null
        ? 'no-scene'
        : viewport.framePolygon(focusRequest.corners);
      if (outcome !== null) console.warn(`Could not jump to polygon ${focusRequest.polygon}: ${outcome}`);
      return;
    }

    // A world the request names and this surface is not showing (#226): the
    // dialog editor knows which `.ZEN` an NPC lives in but cannot open one, so
    // the open happens here and the jump is re-issued on the other side of it.
    if (focusRequest.kind === 'waypoint' && focusRequest.inWorld !== undefined) {
      void openWorldNamed(focusRequest.inWorld, focusRequest.name);
      return;
    }

    if (focusRequest.kind === 'add-waypoint') {
      // Not a jump: a script naming a place is not a position, so there is
      // nothing to frame. The overlay goes on for the same reason the
      // waypoint jump above needs it — it is the only thing that will draw
      // the result — and the name is kept for the terrain click to pick up.
      setShowWaynet(true);
      setPendingWaypointName(focusRequest.name);
      return;
    }

    jumpToPoint(focusRequest.name);
  }, [focusRequest, focusVob, jumpToPoint, openWorldNamed]);

  // ── editing (level-editor.md §7, Phase 1b) ────────────────────────────────
  //
  // The shell owns the IPC, so this is where a drag becomes an op. The
  // authoritative world and the authoritative op log are both in the main
  // process; what happens here is that the *projection* is brought into line
  // with them once they have accepted the edit — never before, or a refused op
  // leaves the two disagreeing.
  //
  // `appliedOps` is how the viewport hears about it. It is imperative and lives
  // outside React's render path, so it cannot read the index the panels read;
  // handing it the ops that were applied is smaller than either a callback ref
  // or a second copy of the world.
  const [appliedOps, setAppliedOps] = useState<WorldOp[] | null>(null);

  /**
   * The primary VOB's per-class fields — an item's Daedalus instance, a light's
   * range and colour (level-editor.md §14.1 item 1.4).
   *
   * **React state here rather than in the store or in a cache beside the
   * summary.** `applyEdit` writes into the existing `ArrayBuffer`s and
   * deliberately does not change the identity of `summary`, so the `WeakMap`
   * pattern `vobModelOf` uses would key on an object that never changes and go
   * on serving pre-edit values for the life of the world. And there is no column
   * for any of this: the index interns a class *name* and carries not one field
   * of the class, which is why it is a fetch at all.
   *
   * Re-issued on `appliedOps` as well as on the selection, and that covers more
   * than it looks like: a commit, an undo, a redo and a *refusal* all set it —
   * the last of which is the one that matters, because a refused edit otherwise
   * leaves the grid showing the number the user typed as though the world had
   * taken it. The generation guard is not optional either: the read is not
   * serialized against edits in the main process, so two fetches genuinely
   * overlap and the slower one must not win.
   *
   * **It is tagged with the VOB it was read for, and the tag is load-bearing.**
   * The grid picks its fields out of the catalogue by the *selected* VOB's
   * class, so the fields and this object have to come from the same VOB — and an
   * effect cannot establish that, because it runs a render too late: the render
   * the selection change causes reaches the grid with the new VOB and the props
   * of the old one. Two catalogued classes then disagree about which keys exist,
   * the grid reads a key the props do not have, and the whole editor is replaced
   * by the error boundary's fallback. A mismatched tag reads as "not here yet",
   * which is what it is.
   */
  const [classProps, setClassProps] = useState<{ vob: number; props: ClassProps } | null>(null);
  const primary = primaryVob(selection);

  /** Every class in the world, for the show/hide list — the interned class
   *  dictionary the summary already carries, and 37 entries on a retail world. */
  const classOptions = useMemo(
    () => (summary === null ? [] : [...summary.vobIndex.classes].sort((a, b) => a.localeCompare(b))),
    [summary],
  );
  /**
   * Which VOBs the viewport must not draw, one byte each — the scene tree's own
   * predicate, asked the complementary question.
   *
   * Null while nothing is switched off: the ordinary case must not pay for a
   * sweep over 41,393 VOBs, and the scene must not walk every instance writing
   * zeroes it already holds.
   */
  const hiddenVobs = useMemo(
    () => (summary === null || hiddenClasses.length === 0
      ? null
      : matchVobs(summary.vobIndex, { classes: hiddenClasses })),
    [summary, hiddenClasses],
  );

  useEffect(() => {
    setClassProps(null);
    if (summary === null || primary === null) return undefined;

    const { reader } = vobModelOf(summary);
    const className = reader.className(primary);
    // Asked for every class, not only the two of a retail world's 37 the
    // catalogue has fields for: the base fields (§16.17) are on every VOB
    // and in none of the index's columns, so this read is the only thing the
    // grid can draw or invert them from. It costs one round trip per selection
    // change, and the per-VOB read is the cheap half of the dump.
    if (className === null) return undefined;
    const path = vobIndexPath(reader, primary);
    if (path === null) return undefined;

    let current = true;
    void window.editorAPI.getVobProps(path)
      // The whole props object, base fields and all: it is the reader
      // `normalizeWorld` uses, and the grid picks the catalogued keys out of it.
      .then((props) => {
        if (current) setClassProps({ vob: primary, props: props as ClassProps });
      })
      // A world that has been closed under the fetch, or a path that no longer
      // resolves. The grid says it is waiting, which is what it is doing.
      .catch(() => { if (current) setClassProps(null); });
    return () => { current = false; };
  }, [summary, primary, appliedOps]);

  /**
   * The volume the selected VOB *is* (architecture §7) — a sound's `radius`, a
   * light's `range`, a zone's or a trigger's bounding box.
   *
   * All of it off the props `classProps` already holds, so it costs no round
   * trip of its own: the read the property grid makes on every selection change
   * is the same read. That is the whole of the per-selection fetch Daniel chose
   * over a bbox column in the index, which every world load would have paid
   * 41,393 × 6 floats for. `vobExtentOf` decides which shape a class is, and
   * answers null for the classes that are no volume anybody places.
   */
  const selectedExtent = useMemo<{ vob: number; extent: VobExtent } | null>(() => {
    if (summary === null || primary === null) return null;
    if (classProps === null || classProps.vob !== primary) return null;
    const className = vobModelOf(summary).reader.className(primary);
    if (className === null) return null;
    const extent = vobExtentOf(className, classProps.props);
    return extent === null ? null : { vob: primary, extent };
  }, [summary, primary, classProps]);

  // ── saving (level-editor.md §5) ───────────────────────────────────────────
  //
  // Saving overwrites the open world. The two warnings below are shown before
  // the write because they are about whether to save at all; the confirmation
  // also names the exact file that will be replaced.
  const [confirmingSave, setConfirmingSave] = useState(false);
  // The world picker's own state (§16.31) — the scan is per opening, so the
  // list never outlives the asset sources it was read from.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [discoveredWorlds, setDiscoveredWorlds] = useState<DiscoveredWorld[]>([]);
  const [savedTo, setSavedTo] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  /** Whether an edit has landed that the world file on disk does not have. */
  const [unsavedEdits, setUnsavedEdits] = useState(false);

  const saveWorld = useCallback(async () => {
    setConfirmingSave(false);
    setSavedTo(null);
    setSaveError(null);
    if (summary === null) return;

    try {
      await window.editorAPI.saveWorld();
      setSavedTo(summary.worldPath);
      setUnsavedEdits(false);
    } catch (failure) {
      // The binding's own refusal — "only the binsafe writer path is verified" —
      // is the message worth showing, so it is not replaced with a generic one.
      setSaveError(failure instanceof Error ? failure.message : String(failure));
    }
  }, [summary]);

  // ── the GMBT quick test (level-editor.md §16.29) ──────────────────────────
  //
  // Fire-and-forget: main launches `gmbt test` over the open world and nothing
  // here tracks the process, its output or its exit code. A dirty world is
  // refused rather than auto-saved — launching the engine at bytes the screen
  // does not show is the one outcome worth a click to avoid.
  const gmbtConfigured = useProjectStore((s) => s.gmbtProjectDir !== null);
  const [quickTestBlocked, setQuickTestBlocked] = useState(false);
  const [quickTestRefusal, setQuickTestRefusal] = useState<string | null>(null);

  const startQuickTest = useCallback(async () => {
    if (unsavedEdits) {
      setQuickTestBlocked(true);
      return;
    }
    try {
      await window.editorAPI.startGmbtQuickTest();
    } catch (failure) {
      // A dialog, not the edit banner: nothing was edited, and every way main
      // refuses a launch — GMBT missing, the open world outside the project
      // folder — is an explanation with a path in it that has to be read.
      setQuickTestRefusal(failure instanceof Error ? failure.message : String(failure));
    }
  }, [unsavedEdits]);

  /** An edit landed, so the bytes on disk are no longer what is on screen. */
  const markEdited = useCallback(() => setUnsavedEdits(true), []);
  /** The class fields let go, so a refusal remounts them — `putTheViewBack`'s
   *  half of the rule `editRefusals` is the other half of. */
  const forgetClassProps = useCallback(() => setClassProps(null), []);

  const { commitOps, runHistory, editRefusals } = useWorldEditPipeline({
    waynet,
    setWaynet,
    setVisuals,
    setAppliedOps,
    markEdited,
    forgetClassProps,
    refreshHistoryDepth,
    openGeneration,
  });

  // One gizmo drives the whole selection, so a drag arrives as a delta rather
  // than a destination and becomes one op per VOB in one batch — which is one
  // undo entry, and atomic in `commitOps`. Read out of the store rather than
  // closed over: the drag is delivered from outside React's render path.
  const handleTranslateSelection = useCallback((delta: [number, number, number]) => {
    const { summary: current, selection: selected } = useWorldStore.getState();
    if (current === null || selected.length === 0) return;
    // Each op's `from` comes out of the index before anything is applied to it,
    // which is what lets the batch be inverted without a snapshot beside the
    // history — and what keeps a selection's spacing across an undo.
    void commitOps(translateVobs(vobModelOf(current).reader, selected, delta));
  }, [commitOps]);

  // What the gizmo does. There is no scale: `zCVob` has no scale field, and
  // measured across all 41,393 VOB transforms in the three retail worlds
  // nothing is scaled — a scale gizmo would author a representation ZenGin's
  // own tools never wrote (level-editor.md §7).
  const [gizmoMode, setGizmoMode] = useState<GizmoMode>('translate');

  /**
   * How far a drag is quantised, in ZenGin centimetres and in degrees — one
   * value per gizmo mode, so switching mode and back does not forget the step.
   *
   * Component state beside the gizmo mode and the brightness, because it is the
   * same kind of thing: it changes how an edit is *made*, produces no op of its
   * own and is not part of the world. Free-form by default, so the gizmo behaves
   * as it always has until somebody asks for a step — and so that
   * `verify-world-edit.js`, which drags to exact coordinates, still lands on
   * them.
   */
  const [snapGrid, setSnapGrid] = useState(0);
  const [snapAngleDegrees, setSnapAngleDegrees] = useState(0);

  /**
   * The visual's own bounds for a VOB, from the payload the worker already
   * sent — what a rotation refits the VOB's bbox from.
   *
   * Built from `visuals` rather than asked for over IPC: the bounds are six
   * numbers per visual and they came across with the geometry. A VOB with no
   * instance (a decal, a `.pfx`) has none, and null is the right answer — the
   * op then leaves the stale box alone rather than refitting it to nothing.
   */
  const boundsOf = useMemo(() => {
    const byVob = new Map<number, ZenBounds>();
    for (const visual of visuals?.visuals ?? []) {
      for (const vob of new Uint32Array(visual.vobIds)) byVob.set(vob, visual.bounds);
    }
    return (vob: number) => byVob.get(vob) ?? null;
  }, [visuals]);

  /**
   * Drop each selected VOB straight to its own ground point — a per-VOB batch,
   * unlike a gizmo drag: there is no shared delta, because each VOB's ground
   * comes from its own downward raycast. A VOB with no hit (over the sky, off
   * the edge of the mesh) is left out rather than refusing the whole batch;
   * the rest still land.
   */
  const handleDropToGround = useCallback(() => {
    const { summary: current, selection: selected } = useWorldStore.getState();
    const viewport = viewportRef.current;
    if (current === null || viewport === null || selected.length === 0) return;

    const reader = vobModelOf(current).reader;
    const drops: { vob: number; ground: ZenPosition }[] = [];
    for (const vob of selected) {
      const from = reader.position(vob);
      if (from === null) continue;
      const hit = viewport.raycastDown(from);
      if (hit !== null) drops.push({ vob, ground: hit.point });
    }
    if (drops.length === 0) return;
    void commitOps(dropVobsToGround(reader, drops));
  }, [commitOps]);

  /**
   * Turn each selected VOB's local +Y onto its own hit normal — the same
   * per-VOB batch as a drop, and for the same reason: each VOB's normal comes
   * from its own raycast, not from one shared delta.
   */
  const handleAlignToNormal = useCallback(() => {
    const { summary: current, selection: selected } = useWorldStore.getState();
    const viewport = viewportRef.current;
    if (current === null || viewport === null || selected.length === 0) return;

    const reader = vobModelOf(current).reader;
    const hits: { vob: number; normal: ZenPosition }[] = [];
    for (const vob of selected) {
      const from = reader.position(vob);
      if (from === null) continue;
      const hit = viewport.raycastDown(from);
      if (hit !== null) hits.push({ vob, normal: hit.normal });
    }
    if (hits.length === 0) return;
    void commitOps(alignVobsToNormal(reader, hits, boundsOf));
  }, [commitOps, boundsOf]);

  /**
   * The VOB a placement could be parented to: the selected one, or null when
   * nothing is selected and a root is the only thing on offer.
   *
   * The primary, for the same reason the property grid follows it — one VOB is
   * the one the panels describe, and a placement under several parents is not a
   * thing.
   */
  const parentCandidate = primaryVob(selection);

  /** How a VOB is named in a dialog: the same fallback the scene tree draws its
   *  rows with, because most VOBs are unnamed — the visual is the label, and the
   *  class is what is left. */
  const labelOf = useCallback((vob: number | null) => {
    if (summary === null || vob === null) return '';
    const { reader } = vobModelOf(summary);
    return reader.name(vob) || reader.visual(vob) || reader.className(vob);
  }, [summary]);

  const parentLabel = labelOf(parentCandidate);

  /**
   * Whether the placement dialog is holding an item it must not send.
   *
   * The same refusal `WorldPropertyGrid` makes for the same field and for the
   * same reason — ZenGin crashes on an instance no script declares, and nothing
   * below the renderer holds an index to check it against. **An empty index
   * means "nothing is known", never "nothing is legal"**, so a world edited with
   * no project open places items exactly as it did before; an empty name is
   * refused whatever the index says, because an item without one spawns nothing.
   */
  /** Where the place dialog says the VOB goes: the chosen point, or the
   *  click the confirm will wait for. */
  const placeWhere = terrainPoint === null
    ? 'where you next click the ground'
    : `at ${terrainPoint.map((v) => Math.round(v)).join(', ')}`;
  const placeRefused = placing !== null && placing.vobClass === 'oCItem'
    && (placing.instance.trim() === ''
      || (itemInstances.size > 0 && !itemInstances.has(placing.instance.trim().toUpperCase())));

  const handleRotateSelection = useCallback((delta: ZenRotation) => {
    const { summary: current, selection: selected } = useWorldStore.getState();
    if (current === null || selected.length === 0) return;
    // Each VOB turns about its own origin, and the delta composes on the left
    // so a selection of differently-oriented VOBs all turn the same way.
    void commitOps(rotateVobs(vobModelOf(current).reader, selected, delta, boundsOf));
  }, [commitOps, boundsOf]);

  /**
   * A typed rotation from the property grid — the primary VOB alone, and an
   * **absolute** pose rather than the delta a gizmo drag arrives as: with one
   * VOB selected the typed angles are the destination. A multi-selection types
   * into the same fields but leaves as a delta (§16.4) and goes down
   * `handleRotateSelection` above, which is the gizmo's own path.
   */
  const handleRotateVob = useCallback((to: ZenRotation) => {
    const { summary: current, selection: selected } = useWorldStore.getState();
    if (current === null || selected.length !== 1) return;
    const vob = selected[0];
    void commitOps([rotateVob(vobModelOf(current).reader, vob, to, boundsOf(vob))]);
  }, [commitOps, boundsOf]);

  /**
   * A property change from the grid, applied to the whole selection.
   *
   * The whole selection because that is what every other edit here does — one
   * gizmo drags all of them — and `setVobProps` gives each VOB its own `from`,
   * so one undo puts a selection that never agreed on a value back to the values
   * they each had.
   *
   * A change of visual is the only one that needs anything asked for: the box
   * the engine culls by is refitted from the *new* visual's bounds, and a visual
   * the world does not currently use has no instance and no payload to read them
   * from. Every other property leaves the box alone, and passes no bounds at
   * all — which is what the binding requires.
   */
  const handleEditProps = useCallback(async (props: VobProps) => {
    const { summary: current, selection: selected } = useWorldStore.getState();
    if (current === null || selected.length === 0) return;

    let bounds = null;
    if (props.visual !== undefined) {
      // Null for a name that resolves to nothing — a misspelling, a decal's
      // texture, a `.pfx`. The op then leaves the stale box alone rather than
      // refitting it to nothing, exactly as a rotation does.
      const next = await window.editorAPI.getVisualBounds(props.visual)
        .catch(() => null);
      bounds = { from: boundsOf, to: next === null ? null : next as ZenBounds };
    }

    // The scene is rebuilt for a changed visual by `applied`, which this commit
    // goes through and undo and redo reach on their own — so there is nothing
    // to do here afterwards. It used to be a hand-written fetch on this line,
    // and that is exactly why undo left the old mesh on screen.
    await commitOps(setVobProps(vobModelOf(current).reader, selected, props, bounds));
  }, [commitOps, boundsOf]);

  /** The Assets panel's "Use as visual" (§16.26 row 1): the previewed mesh's
   *  bare name, written to the whole selection through the same path as the
   *  grid's visual field — one batch, one undo entry, the box refitted. */
  const useAssetAsVisual = useCallback((name: string) => {
    void handleEditProps({ visual: name });
  }, [handleEditProps]);

  /**
   * A class field change from the grid — the primary VOB alone.
   *
   * Alone, where every other edit in this surface takes the whole selection:
   * each VOB in a batch would need its own fetched `from`, a selection can hold
   * mixed classes, and there is no guard for that equivalent to the "not in the
   * index" refusal every other op gets for free (§14.1 item 1.4, D7).
   *
   * The fetched props are the whole `from` side. They are passed rather than
   * read back at apply time for the reason no op reads `from` from the world:
   * by then the world holds `to`, and the inverse would restore it.
   */
  const handleEditClassProps = useCallback(async (props: ClassProps) => {
    const { summary: current, selection: selected } = useWorldStore.getState();
    const vob = primaryVob(selected);
    // The tag again: the fetched props are the whole `from` side, so props read
    // for another VOB would build an op — and an inverse — out of values that
    // VOB never had.
    if (current === null || vob === null || classProps?.vob !== vob) return;
    await commitOps([setVobClassProp(vobModelOf(current).reader, vob, classProps.props, props)]);
  }, [commitOps, classProps]);

  /**
   * A base-field change from the grid — `presetName`, `visualCamAlign`, `bias`,
   * `dynamicShadows` or one of the seven decal fields, and the described VOB
   * alone.
   *
   * A `SetVobProp` like the name and the flags above, but built here rather than
   * in `handleEditProps` because these three have no column: the op cannot read
   * their `from` back out of the index, so it takes the fetched props, and that
   * is a read per VOB the batch path does not have. Hence one VOB, exactly as a
   * class field is — the same constraint reached from the other side.
   */
  const handleEditBaseProps = useCallback(async (props: VobProps) => {
    const { summary: current, selection: selected } = useWorldStore.getState();
    const vob = primaryVob(selected);
    // The tag, for `handleEditClassProps`' reason: props read for another VOB
    // would build an op — and an inverse — out of values this VOB never had.
    if (current === null || vob === null || classProps?.vob !== vob) return;
    await commitOps([
      setVobProp(vobModelOf(current).reader, vob, props, null, classProps.props),
    ]);
  }, [commitOps, classProps]);

  /**
   * Move a VOB into another parent — the scene tree's drag and drop.
   *
   * One op, alone in its batch, and `commitOps` enforces that rather than
   * trusting this: a reparent renumbers every path after it, and the other ops
   * in a batch carry paths resolved before the batch ran. The refresh it needs
   * afterwards is the ordinary structural one, which `applied` already does for
   * a placement — the index is re-read whole because the columnar projection
   * cannot reorder.
   */
  const reparent = useCallback(async (vob: number, toParent: number | null, slot: number) => {
    const { summary: current } = useWorldStore.getState();
    if (current === null) return;
    await commitOps([reparentVob(vobModelOf(current).reader, vob, toParent, slot)]);
  }, [commitOps]);

  /**
   * Place a new VOB at the last point picked on the terrain.
   *
   * The terrain point rather than the camera or the origin, because it is the
   * one position in the surface that a user has actually chosen — a click on the
   * world mesh already reports it in ZenGin centimetres, which is what an op
   * carries.
   *
   * The box is fitted here, from the visual's own bounds placed at that point,
   * for the same reason a rotation fits one: the engine culls by it, and the
   * binding's default is a 10 cm cube that would cull a house. A visual that
   * does not resolve gets no box and keeps that default, which is the honest
   * answer — there is nothing to fit.
   *
   * `spec.parent` is a flat index or null for a root. Under a parent the op
   * renumbers, so it goes alone in its batch — `commitOps` in `zen-world`
   * enforces that rather than this side promising it — and `applied` clears the
   * selection afterwards.
   */
  const placeVobAt = useCallback(async (spec: PlaceSpec, point: [number, number, number]) => {
    const { summary: current } = useWorldStore.getState();
    if (current === null) return;

    // Only a `zCVob` carries a visual from this dialog. An item has none in the
    // file — the engine derives one from its script instance — and a light or a
    // sound *is* what it does rather than something drawn, so for all three
    // there is nothing to resolve a box from either, and they keep the binding's
    // default exactly as a VOB with an unresolvable visual does.
    const item = spec.vobClass === 'oCItem';
    const visual = spec.vobClass === 'zCVob' ? spec.visual.trim() : '';
    const bounds = visual === '' ? null : await window.editorAPI.getVisualBounds(visual)
      .catch(() => null);

    const placed: NewVob = {
      position: point,
      ...(spec.vobClass === 'zCVob' ? {} : { class: spec.vobClass }),
      ...(item ? { instance: spec.instance.trim() } : {}),
      ...(spec.name.trim() === '' ? {} : { name: spec.name.trim() }),
      ...(visual === '' ? {} : { visual }),
      ...(bounds === null ? {} : {
        bbox: placeBounds(bounds as ZenBounds, IDENTITY, point),
      }),
    };

    await commitOps([addVob(vobModelOf(current).reader, placed, spec.parent)]);
  }, [commitOps]);

  /**
   * The class fields of every VOB a copy of `vobs` would bring, keyed by flat
   * index — what a duplicate and a copy hand to `zen-world` (§14.1 1.2).
   *
   * **The one thing about a copy that cannot be read synchronously.** Every
   * other field of a `NewVob` is a column of the index the renderer already
   * holds; a `zCVobLight`'s range and colour are in no column at all, so they
   * come back over the same `getVobProps` the property grid reads one VOB with
   * — one round trip per VOB, issued together.
   *
   * Asked only for the VOBs whose class has catalogued fields, which is the
   * difference between two reads and forty: most of a retail selection is
   * `zCVob`s and `oCMobInter`-shaped classes the catalogue is silent about, and
   * a read for one of those would answer base fields a copy does not carry.
   *
   * A read that fails is left out rather than failing the copy — the world was
   * closed under it, or the path no longer resolves — for the reason a
   * non-authorable class is dropped rather than named: a copy missing one field
   * beats no copy.
   */
  const readClassProps = useCallback(async (
    reader: VobReader, vobs: readonly number[],
  ): Promise<(vob: number) => ReadProps | null> => {
    const wanted: number[] = [];
    const walk = (vob: number): void => {
      // The whole subtree, because a duplicate copies one (D5) and each
      // descendant keeps its own fields.
      const className = reader.className(vob);
      if (className !== null && classPropKeys(className).length > 0) wanted.push(vob);
      for (let child = 0; child < reader.count; child++) {
        if (reader.columns.parent[child] === vob) walk(child);
      }
    };
    topLevelVobs(reader, vobs).forEach(walk);

    const read = new Map<number, ReadProps>();
    await Promise.all(wanted.map(async (vob) => {
      const path = vobIndexPath(reader, vob);
      if (path === null) return;
      const props = await window.editorAPI.getVobProps(path).catch(() => null);
      if (props !== null) read.set(vob, props as ReadProps);
    }));

    return (vob: number) => read.get(vob) ?? null;
  }, []);

  /**
   * Duplicate the selection in place — **one batch, therefore one undo**
   * (level-editor.md §16.14, D1 and D4).
   *
   * **In place, and appended beside the original**, which is Spacer's own
   * behaviour: the copy takes the same position, so an offset would be a
   * preference nobody asked for and a copy nobody could find is worse than one
   * sitting exactly where its original is. Each copy goes into its own
   * original's parent, so a duplicated child stays a child — **and brings its
   * own children with it** (D5), which is why a selection holding a VOB and its
   * parent copies that VOB once rather than twice.
   *
   * It is ordinary `AddVob`s and nothing more — no new op, no validator branch
   * — because that op already carries a whole description of a VOB and already
   * inverts to a delete. Several of them may share a batch because an append
   * moves no index path, which is the exception `commitOps` makes and the whole
   * of what D4 needed; `duplicateVobs` makes the one correction that costs, the
   * slot two copies of the same parent would otherwise share.
   *
   * **The class comes across** since D2 (level-editor.md §16.14), for the
   * classes `insertVob` can construct: a duplicated `zCVobLight` is a light.
   * What a copy still does not carry is `physicsEnabled`, which `NewVob` has no
   * room for; the class *properties*, which are follow-up `SetVobClassProp`s;
   * and the class itself for an `oCItem` — the instance it spawns is behind
   * `getVobProps`, and the spec is read synchronously off the index. A class
   * outside that set is dropped rather than named, because naming it would have
   * the IPC validator refuse the op and a lossy copy beats no copy.
   *
   * Each box is fitted from that VOB's own visual bounds, exactly as a rotation
   * refits one and for the same reason: the index has no bbox column to copy,
   * and the binding's default is a 10 cm cube.
   */
  const duplicateSelection = useCallback(async () => {
    const { summary: current, selection: selected } = useWorldStore.getState();
    if (current === null || selected.length === 0) return;

    const { reader } = vobModelOf(current);
    const classProps = await readClassProps(reader, selected);
    await commitOps(duplicateVobs(reader, selected, boundsOf, classProps));
  }, [commitOps, boundsOf, readClassProps]);

  const {
    scatterOn, toggleScatter, scatterRadius, setScatterRadius,
    scatterSpacing, setScatterSpacing, scatterBrushRadius, handleScatterStroke,
  } = useScatterBrush({
    commitOps, boundsOf, readClassProps, viewport: viewportRef,
  });

  clipboardInput.current = { commitOps, boundsOf, readClassProps };

  const {
    moveWaypointTo,
    renameWaypointTo,
    addWaypointAt,
    joinWaypointTo,
    unjoinWaypointFrom,
    removeWaypoint,
    waypointEdges,
    waypointSpawns,
    resolveWaypointToJoin,
    suggestedWaypointName,
    knownWaypointNames,
  } = useWaynetEditing({
    waynet, selectedWaypoint, spawnSiteIndex, waypointSiteIndex, commitOps,
  });

  const {
    draft: insertingNpc,
    openAtWaypoint: openInsertNpcAtWaypoint,
    openForNewWaypoint: openInsertNpcForNewWaypoint,
    editDraft: editInsertNpcDraft,
    closeDraft: closeInsertNpcDraft,
    insertNpcAt,
    startupFunctionName,
    targetExists: insertTargetExists,
    unknownInstance: unknownInsertInstance,
    duplicateSpawn: duplicateInsertSpawn,
  } = useInsertNpc({ waynet, commitOps });

  /**
   * The overlay, switched on for an action whose result is a waypoint: only
   * the overlay draws one, so a waypoint authored with it off would land
   * invisible and unpickable. Add waypoint and Insert NPC used to hide until
   * somebody turned it on by hand — a precondition nothing on screen stated.
   */
  const ensureWaynetShown = useCallback(() => {
    if (!showWaynet) setShowWaynet(true);
    if (waynet === null) void readWaynetInto(setWaynet);
  }, [showWaynet, waynet, readWaynetInto]);

  const handlePick = useCallback((
    vob: number | null, point: [number, number, number] | null, additive: boolean,
  ) => {
    // An additive click that misses must not empty a selection someone is
    // building.
    if (vob !== null) handleSelect(vob, additive);
    else if (!additive) selectVob(null);
    setTerrainPoint(point);
    // An armed add is spent by the ground click it was waiting for — and only
    // a ground click: a VOB hit is a selection, not a place.
    if (point !== null && armed !== null) {
      setArmed(null);
      if (armed.kind === 'place') void placeVobAt(armed.spec, point);
      else if (armed.kind === 'insert-npc') void insertNpcAt(armed.instance, armed.waypoint, false, point);
      else addWaypointAt(armed.name, point);
    }
  }, [handleSelect, selectVob, armed, placeVobAt, insertNpcAt, addWaypointAt]);

  /**
   * Whether the name in the add-waypoint dialog is one the open world already
   * carries — the refusal the binding makes, made on this side too. Derived
   * once so the disabled Add button and the field's own explanation read the
   * same boolean and cannot drift apart.
   */
  const duplicateWaypointName = addingWaypoint !== null
    && (waynet?.names.includes(addingWaypoint.trim()) ?? false);

  /**
   * Remove a VOB and its whole subtree — **the one edit here that cannot be
   * undone** (level-editor.md §15).
   *
   * The op carries an address and nothing else, because what it would need to
   * carry to be invertible is what no op can describe: an `oCMobInter`'s
   * per-class properties, its children, its AI, its event manager. §15 settled
   * that this ships anyway — the original Spacer has no undo at all, so an
   * unundoable delete is already parity — and put one requirement in place of
   * the inverse: the user is told first. That is the dialog below, and it is why
   * this is the only edit in the surface behind a confirm.
   *
   * The whole selection, in one batch (#253). It was one VOB at a time because
   * a delete renumbers; `deleteVobs` answers that with the *order* rather than
   * with a refusal — back to front, so each removal leaves the paths still to
   * be used exactly where they were resolved. One batch is one round trip and
   * one clearing of the history, which is the whole of what one entry can mean
   * for an op with no inverse.
   */
  const removeVobs = useCallback(async (vobs: readonly number[]) => {
    const { summary: current } = useWorldStore.getState();
    if (current === null || vobs.length === 0) return;
    await commitOps(deleteVobs(vobModelOf(current).reader, vobs));
  }, [commitOps]);

  /** Any of the surface's own modal surfaces is up — what
   *  `useWorldShortcuts` takes as `dialogOpen`, and why it takes it. */
  const surfaceDialogOpen = deleting !== null || deletingWaypoint !== null
    || placing !== null || confirmingSave || addingWaypoint !== null || contextMenu !== null
    || insertingNpc !== null || pickerOpen || quickTestBlocked || quickTestRefusal !== null;

  useWorldShortcuts({
    hasWorld: summary !== null,
    hidden,
    dialogOpen: surfaceDialogOpen,
    waynet,
    armed: armed !== null,
    gizmoMode,
    snapGrid,
    setGizmoMode,
    onCopy: () => void copySelection(),
    onPaste: () => void pasteClipboard(),
    onDuplicate: () => void duplicateSelection(),
    onRequestDeleteVobs: setDeleting,
    onRequestDeleteWaypoint: (waypoint, name) => setDeletingWaypoint({ waypoint, name }),
    onDisarm: () => setArmed(null),
    onRequestSave: () => setConfirmingSave(true),
    onNudge: handleTranslateSelection,
    onHistory: (direction) => void runHistory(direction),
  });

  // The World bar's own combined-state rules (WorldToolbar §5): each collapses
  // a pair of related setters, or an event's shape, into the one callback the
  // bar is handed — the bar's children only ever call up, never read a second
  // piece of state to decide what to write.
  /** The Time toggle: switching the slider off clears the state lens with
   *  it, since a state without a minute answers nothing the static layer
   *  does not. */
  const toggleSpawnTime = useCallback(() => {
    const next = spawnTime === null ? DEFAULT_SPAWN_TIME : null;
    setSpawnTime(next);
    if (next === null) setSpawnState(null);
  }, [spawnTime]);
  /** The Names toggle. */
  const toggleWaypointNames = useCallback(() => setShowWaypointNames((v) => !v), []);
  const cycleOutlineMode = useCallback(() => setOutlineMode((mode) => (
    OUTLINE_MODE_ORDER[(OUTLINE_MODE_ORDER.indexOf(mode) + 1) % OUTLINE_MODE_ORDER.length]
  )), []);
  /** The Snap step: which of the two step values it writes follows the
   *  gizmo mode, the way reading it already does. */
  const handleSnapStepChange = useCallback((step: number) => {
    if (gizmoMode === 'rotate') setSnapAngleDegrees(step);
    else setSnapGrid(step);
  }, [gizmoMode]);
  /** The Delete button — opens the same confirm the Delete key does, never
   *  a direct removal. */
  const requestDeleteSelection = useCallback(
    () => setDeleting(selection),
    [selection],
  );

  return (
    <LiveTileContext.Provider value={liveTile}>
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <WorldToolbar
        onOpenWorld={() => void openPicker()}
        status={status}
        hasWorld={summary !== null}
        onSave={() => setConfirmingSave(true)}
        unsavedEdits={unsavedEdits}
        gmbtConfigured={gmbtConfigured}
        onQuickTest={() => void startQuickTest()}
        onPlaceVob={() => setPlacing(FRESH_PLACE)}
        onInsertNpc={() => {
          ensureWaynetShown();
          if (selectedWaypoint !== null && waynet !== null) {
            openInsertNpcAtWaypoint(waynet.names[selectedWaypoint]);
          } else openInsertNpcForNewWaypoint(suggestedWaypointName());
        }}
        onAddWaypoint={() => {
          ensureWaynetShown();
          setAddingWaypoint(pendingWaypointName ?? suggestedWaypointName());
          setPendingWaypointName(null);
        }}
        showWaynet={showWaynet}
        onToggleWaynet={() => void toggleWaynet()}
        showSpawns={showSpawns}
        onToggleSpawns={() => void toggleSpawns()}
        spawnTime={spawnTime}
        onToggleTime={toggleSpawnTime}
        onSpawnTimeChange={setSpawnTime}
        spawnState={spawnState}
        onSpawnStateChange={setSpawnState}
        stateOptions={stateOptionList}
        spawnStateReach={spawnStateReach}
        showWaypointNames={showWaypointNames}
        onToggleWaypointNames={toggleWaypointNames}
        outlineMode={outlineMode}
        onCycleOutlineMode={cycleOutlineMode}
        exposure={exposure}
        onExposureChange={setExposure}
        lightPreview={lightPreview}
        onToggleLightPreview={() => setLightPreview((on) => !on)}
        hiddenClasses={hiddenClasses}
        onHiddenClassesChange={setHiddenClasses}
        classOptions={classOptions}
        gizmoMode={gizmoMode}
        onGizmoModeChange={setGizmoMode}
        snapGrid={snapGrid}
        snapAngleDegrees={snapAngleDegrees}
        onSnapStepChange={handleSnapStepChange}
        selectionCount={selection.length}
        onDropToGround={handleDropToGround}
        onAlignToNormal={handleAlignToNormal}
        onDuplicate={() => void duplicateSelection()}
        onDeleteRequest={requestDeleteSelection}
        historyDepth={historyDepth}
        onUndo={() => void runHistory('undo')}
        onRedo={() => void runHistory('redo')}
        scatterOn={scatterOn}
        onScatterToggle={toggleScatter}
        scatterRadius={scatterRadius}
        scatterSpacing={scatterSpacing}
        onScatterRadiusChange={setScatterRadius}
        onScatterSpacingChange={setScatterSpacing}
      />

      {status === 'error' && (
        <Alert severity="error" square data-testid="world-error">{error}</Alert>
      )}

      {/* A refused edit — or one the view could not follow, or a waynet read
          that failed over an open world. Deliberately not `status: 'error'`:
          that replaces the whole surface, and the world is still open.

          All three close. Each used to stand until something else replaced it —
          the saved banner until the *next* save began, so it went on claiming a
          world was saved across every edit after it, beside a Save button that
          by then said "edited". A banner the user cannot dismiss is one they
          learn to read past. */}
      {editError !== null && (
        <Alert
          severity="warning"
          square
          onClose={() => useWorldStore.getState().editFailed(null)}
          data-testid="world-edit-error"
        >
          {editError}
        </Alert>
      )}

      {saveError !== null && (
        <Alert
          severity="warning"
          square
          onClose={() => setSaveError(null)}
          data-testid="world-save-error"
        >
          {saveError}
        </Alert>
      )}
      {savedTo !== null && (
        <Alert
          severity="success"
          square
          onClose={() => setSavedTo(null)}
          data-testid="world-saved"
        >
          Saved to {savedTo}
        </Alert>
      )}

      {/* The camera slots' one word (09-04 review §5.1 item 6). A Snackbar
          rather than a fourth Alert in the stack above: the three up there are
          about the world and push the viewport down, and a notice that a
          keystroke worked must not reflow the view it is about. `key` is the
          nonce, so a repeated outcome restarts the timer instead of sitting
          out the first one's. */}
      {cameraSlotNotice !== null && (
        <Snackbar
          key={cameraSlotNotice.nonce}
          open
          autoHideDuration={3000}
          onClose={() => setCameraSlotNotice(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
          transitionDuration={0}
          message={cameraSlotNotice.text}
          data-testid="world-camera-slot"
        />
      )}

      {/* The warnings belong before the write, not after it: they are about
          whether to save at all. Both are the brief's (§7) and both are facts
          about ZenGin rather than about this editor. */}
      {/* Unmounted rather than kept closed: MUI's Modal restores the rest of
          the app from `aria-hidden` when it unmounts, and a picker fading out
          over a world that has just opened leaves the toolbar unreachable. */}
      {pickerOpen && (
        <WorldPickerDialog
          open
          worlds={discoveredWorlds}
          loading={pickerLoading}
          error={pickerError}
          onPick={pickWorld}
          onBrowse={() => void browseForWorld()}
          onClose={() => setPickerOpen(false)}
        />
      )}
      <Dialog open={confirmingSave} onClose={() => setConfirmingSave(false)}>
        <DialogTitle>Save this world?</DialogTitle>
        <DialogContent>
          <DialogContentText component="div" variant="body2">
            <p>
              <strong>The lighting will be stale.</strong> ZenGin bakes vertex lighting and
              lightmaps when a world is compiled. Moving or turning a VOB does not re-bake
              anything, so its lighting stays as it was where the VOB used to be. Only Spacer&apos;s
              <code> compile light </code>
              can fix that, and re-running it rebuilds the world from its part files.
            </p>
            <p>
              <strong>Existing savegames will not match.</strong> A savegame stores its own copy of
              the VOB tree, so a game saved before this edit keeps the old world — and loading one
              against an edited world is where ZenGin is least forgiving.
            </p>
            <p>
              This will overwrite the currently opened file:
              <br />
              <code>{summary?.worldPath}</code>
            </p>
            <p>
              BinSafe and ASCII worlds can be written. BINARY worlds remain unsupported.
            </p>
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmingSave(false)} data-testid="world-save-cancel">Cancel</Button>
          <Button onClick={saveWorld} variant="contained" data-testid="world-save-confirm">
            Overwrite opened file
          </Button>
        </DialogActions>
      </Dialog>

      {/* A dirty world blocks the quick test rather than silently overwriting
          its file. The user can enter the same explicit save confirmation. */}
      <Dialog open={quickTestBlocked} onClose={() => setQuickTestBlocked(false)}>
        <DialogTitle>Save this world first</DialogTitle>
        <DialogContent>
          <DialogContentText variant="body2">
            A quick test plays the world file on disk, and this world has edits that are not in
            it yet. Save over the file it was opened from, then start the test again.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setQuickTestBlocked(false)} data-testid="world-gmbt-blocked-cancel">
            Cancel
          </Button>
          <Button
            variant="contained"
            data-testid="world-gmbt-blocked-save"
            onClick={() => { setQuickTestBlocked(false); setConfirmingSave(true); }}
          >
            Save world…
          </Button>
        </DialogActions>
      </Dialog>

      {/* `gmbt test` is a basename plus a working directory, so it always plays
          the GMBT project's own copy. Main refuses a world from anywhere else
          and names both paths; they are the whole point of the dialog, so they
          keep their own lines. */}
      <Dialog open={quickTestRefusal !== null} onClose={() => setQuickTestRefusal(null)}>
        <DialogTitle>The quick test did not start</DialogTitle>
        <DialogContent>
          <DialogContentText variant="body2" sx={{ whiteSpace: 'pre-line' }} data-testid="world-gmbt-refused">
            {quickTestRefusal}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button variant="contained" onClick={() => setQuickTestRefusal(null)} data-testid="world-gmbt-refused-close">
            Close
          </Button>
        </DialogActions>
      </Dialog>

      <WorldVobContextMenu
        open={contextMenu !== null}
        position={contextMenu?.position ?? null}
        onClose={() => setContextMenu(null)}
        selectionCount={selection.length}
        canPaste={hasClipboard()}
        onFrame={() => { if (contextMenu !== null) focusVob(contextMenu.vob); }}
        onDuplicate={() => void duplicateSelection()}
        onCopy={() => void copySelection()}
        onPaste={() => void pasteClipboard()}
        onDeleteRequest={requestDeleteSelection}
        onDropToGround={handleDropToGround}
        onAlignToNormal={handleAlignToNormal}
        onHideClass={hideVobClass}
        folders={vobFolders.folders}
        onAddSelectionToFolder={addSelectionToFolder}
        onCreateFolderWithSelection={createFolderWithSelection}
      />

      {/* The requirement §15 put in place of an inverse. Every other edit in
          this surface undoes, so the thing the user has to be told is not that
          a delete is destructive — it is that this one takes the undo stack
          with it. Spacer has no undo at all, which is why the op ships; it is
          not why the warning is optional. */}
      <Dialog open={deleting !== null} onClose={() => setDeleting(null)} maxWidth="xs" fullWidth>
        {/* Named when it is one and counted when it is several: five labels
            in a title is not a title, and "Delete VOB?" over a selection of
            five is the surprise the dialog exists to prevent (#253). */}
        <DialogTitle data-testid="world-delete-title">
          {deleting !== null && deleting.length > 1
            ? `Delete ${deleting.length} VOBs?`
            : `Delete ${labelOf(deleting?.[0] ?? null)}?`}
        </DialogTitle>
        <DialogContent>
          <DialogContentText component="div" variant="body2" data-testid="world-delete-warning">
            <p>
              <strong>This cannot be undone.</strong> A deleted VOB carries per-class properties,
              children, an AI and an event manager that an op has no way to describe, so there is
              nothing to put back — and the earlier edits go with it: the undo history is cleared,
              because every entry in it addresses VOBs by numbers this delete has just changed.
            </p>
            <p>
              {deleting !== null && deleting.length > 1
                ? 'Each VOB and everything below it in the scene tree is removed.'
                : 'The VOB and everything below it in the scene tree is removed.'}
              {' '}The world in the editor changes; the file on disk does not until it is saved.
            </p>
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleting(null)} data-testid="world-delete-cancel">Cancel</Button>
          <Button
            color="error"
            variant="contained"
            data-testid="world-delete-confirm"
            onClick={() => {
              const vobs = deleting;
              setDeleting(null);
              if (vobs !== null) void removeVobs(vobs);
            }}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>

      {/* The waynet's own barrier warning (§16.7, W4). Separate from the VOB
          one rather than folded into it: they warn about different losses —
          this one takes the waypoint's *edges* with it, which is the part a
          user cannot see coming from the point on screen, and there is no
          subtree to speak of. The undo half of the warning is the same, because
          the barrier is. */}
      <Dialog
        open={deletingWaypoint !== null}
        onClose={() => setDeletingWaypoint(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Delete {deletingWaypoint?.name ?? 'waypoint'}?</DialogTitle>
        <DialogContent>
          <DialogContentText
            component="div"
            variant="body2"
            data-testid="world-waypoint-delete-warning"
          >
            <p>
              <strong>This cannot be undone.</strong> Every edge into this waypoint is removed
              with it, and the earlier edits go too: the undo history is cleared, because every
              entry in it addresses waypoints by numbers this delete has just changed.
            </p>
            <p>
              A routine or a script that names the waypoint is not changed and is not warned
              about. The world in the editor changes; the file on disk does not until it is saved.
            </p>
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setDeletingWaypoint(null)}
            data-testid="world-waypoint-delete-cancel"
          >
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            data-testid="world-waypoint-delete-confirm"
            onClick={() => {
              const target = deletingWaypoint;
              setDeletingWaypoint(null);
              if (target !== null) removeWaypoint(target.waypoint);
            }}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>

      {status === 'idle' && (
        <Box sx={{ p: 3 }}>
          <Typography variant="body2" color="text.secondary">
            Open a ZenGin <code>.zen</code> world to view and edit it: move,
            turn, place, duplicate and delete VOBs, edit the waynet, and start a
            GMBT test run over what you have. Configure at least one available
            asset source in the active project first.
          </Typography>
          <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1.5 }}>
            {/* The shortcuts have never been on screen anywhere (review §5.1):
                every one of them is a window listener with no menu item, no
                tooltip and no legend, so the walk, the fly, the camera slots
                and the nudge were discoverable only by reading the source. */}
            Once a world is open: <b>W</b>/<b>E</b> move and turn ·{' '}
            <b>.</b> frame the selection · <b>Home</b> frame the world ·{' '}
            <b>F3</b> walk · right-drag to fly, <b>WASD</b>/<b>Space</b>/<b>X</b> while held ·{' '}
            <b>Ctrl</b>+<b>1</b>…<b>4</b> recall a camera, <b>Ctrl</b>+<b>Shift</b> to store ·{' '}
            arrows and <b>PageUp</b>/<b>PageDown</b> nudge · <b>Ctrl</b>+<b>C</b>/<b>V</b> copy
            and paste · <b>Ctrl</b>+<b>Z</b>/<b>Y</b> undo · <b>Ctrl</b>+<b>S</b> save ·{' '}
            <b>Del</b> delete · <b>Esc</b> clear the selection.
          </Typography>
        </Box>
      )}

      {/* Scene tree | viewport | properties. The two panels appear only once a
          world is open: without a `VobIndex` there is no hierarchy to show, and
          an empty tree beside an empty viewport says nothing. */}
      <Box sx={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {summary && leftPanelCollapsed && (
          <Box sx={{
            width: COLLAPSED_PANEL_WIDTH, flexShrink: 0, borderRight: 1, borderColor: 'divider',
            minHeight: 0, display: 'flex', justifyContent: 'center', pt: 0.5,
          }}>
            <Tooltip title="Show scene panel">
              <IconButton
                size="small"
                onClick={() => setLeftPanelCollapsed(false)}
                data-testid="world-panel-expand-left"
                aria-label="Show scene panel"
              >
                <ChevronRightIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        )}
        {/* Hidden, never unmounted — the same rule the Scene/Assets tab
            switch below already follows, and for the same reason: the tree
            owns its expansion set, its filter text and its scroll offset,
            and a collapse that threw all three away would make the button
            cost far more than the space it buys. */}
        {summary && (
          <>
            <Box data-testid="world-panel-left" sx={{
              width: panelWidths.left, flexShrink: 0, minHeight: 0,
              display: leftPanelCollapsed ? 'none' : 'flex', flexDirection: 'column',
            }}>
              <Stack direction="row" alignItems="center">
                <Tabs
                  value={panel}
                  onChange={(_event, next: 'scene' | 'assets' | 'folders') => setPanel(next)}
                  variant="fullWidth"
                  sx={{ flex: 1, minHeight: 32, '& .MuiTab-root': { minHeight: 32, fontSize: 12 } }}
                >
                  <Tab value="scene" label="Scene" data-testid="world-panel-scene" />
                  <Tab value="assets" label="Assets" data-testid="world-panel-assets" />
                  <Tab value="folders" label="Folders" data-testid="world-panel-folders" />
                </Tabs>
                <Tooltip title="Hide scene panel">
                  <IconButton
                    size="small"
                    onClick={() => setLeftPanelCollapsed(true)}
                    data-testid="world-panel-collapse-left"
                    aria-label="Hide scene panel"
                  >
                    <ChevronLeftIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Stack>
              <Box sx={{ flex: 1, minHeight: 0, display: panel === 'scene' ? 'block' : 'none' }}>
                <WorldSceneTree
                  summary={summary}
                  selection={selection}
                  appliedOps={appliedOps}
                  onSelect={handleSelect}
                  onFocus={focusVob}
                  onReparent={reparent}
                  onContextMenu={openVobContextMenu}
                  getCameraPosition={getCameraPosition}
                />
              </Box>
              {/* Mounted only once the user asks for it: the first listing is an
                  IPC round trip into the worker that holds the VFS. */}
              {panel === 'assets' && (
                <Box sx={{ flex: 1, minHeight: 0 }}>
                  <WorldAssetBrowser
                    listAssets={listAssets}
                    searchAssets={searchAssets}
                    onPreview={setSelectedAsset}
                    thumbnails={thumbnails ?? undefined}
                    catalog={assetCatalogProps}
                    sources={summary?.assetSources}
                    placement={assetPlacement}
                    previewing={selectedAsset}
                  />
                </Box>
              )}
              {/* Lazily mounted, like Assets above — the folder list is small
                  and rebuilding it on a tab switch is cheap, so nothing here
                  is kept alive the way the scene tree's expansion set is. */}
              {panel === 'folders' && (
                <Box sx={{ flex: 1, minHeight: 0 }}>
                  <WorldFolderTree
                    folders={vobFolders}
                    summary={summary}
                    selection={selection}
                    onSelect={handleSelect}
                    onFocus={focusVob}
                    onCreateFolder={createEmptyFolder}
                    onRenameFolder={renameFolderHandler}
                    onDeleteFolder={deleteFolderHandler}
                    onRemoveFromFolder={removeVobFromFolderHandler}
                  />
                </Box>
              )}
            </Box>
            {!leftPanelCollapsed && (
              <PanelSplitter
                data-testid="world-splitter-left"
                width={panelWidths.left}
                grow="right"
                onResize={setLeftPanelWidth}
                onResizeEnd={persistPanelWidths}
              />
            )}
          </>
        )}

        <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, position: 'relative' }}>
          {/* The viewport's own boundary. `new THREE.WebGLRenderer(...)` throws
              "Error creating WebGL context" on a machine with no usable GL —
              a broken driver, a remote desktop, a VM — and the nearest boundary
              was the app's root one, so opening a world replaced the *whole*
              window, dialog editor and all, with a crash page. The scene tree,
              the property grid and everything else here work without a picture,
              so the failure belongs to this box. */}
          <ErrorBoundary
            fallback={(
              <Box sx={{ p: 3 }} data-testid="world-viewport-failed">
                <Alert severity="error" square>
                  The 3D view could not start — this machine has no usable WebGL
                  context. The scene tree and properties still work; a graphics
                  driver update, or running without remote desktop, is what gets
                  the picture back.
                </Alert>
              </Box>
            )}
          >
            {mesh && visuals && summary && (
            <WorldViewport
              ref={viewportRef}
              mesh={mesh}
              visuals={visuals}
              vobIndex={summary.vobIndex}
              bbox={summary.bbox}
              waynet={waynet}
              showWaynet={showWaynet}
              spawns={spawnSiteIndex}
              showSpawns={showSpawns}
              routines={routines}
              spawnTime={spawnTime}
              spawnState={spawnState}
              showWaypointNames={showWaypointNames}
              loadTexture={loadTexture}
              onTextureFailures={reportTextureFailures}
              onCameraSlot={reportCameraSlot}
              onPick={handlePick}
              onVobContextMenu={openVobContextMenu}
              selection={selection}
              onTranslateSelection={handleTranslateSelection}
              gizmoMode={gizmoMode}
              onRotateSelection={handleRotateSelection}
              appliedOps={appliedOps}
              selectedWaypoint={selectedWaypoint}
              terrainPoint={terrainPoint}
              exposure={exposure}
              lightPreview={lightPreview}
              hiddenVobs={hiddenVobs}
              outlineMode={outlineMode}
              selectedExtent={selectedExtent}
              snapGrid={snapGrid}
              snapAngle={(snapAngleDegrees * Math.PI) / 180}
              scatterRadius={scatterBrushRadius}
              onScatterStroke={handleScatterStroke}
              onSelectWaypoint={selectWaypoint}
              onMoveWaypoint={moveWaypointTo}
              paused={hidden}
            />
            )}
          </ErrorBoundary>
        </Box>

        {summary && rightPanelCollapsed && (
          <Box sx={{
            width: COLLAPSED_PANEL_WIDTH, flexShrink: 0, borderLeft: 1, borderColor: 'divider',
            minHeight: 0, display: 'flex', justifyContent: 'center', pt: 0.5,
          }}>
            <Tooltip title="Show properties panel">
              <IconButton
                size="small"
                onClick={() => setRightPanelCollapsed(false)}
                data-testid="world-panel-expand-right"
                aria-label="Show properties panel"
              >
                <ChevronLeftIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        )}
        {summary && !rightPanelCollapsed && (
          <PanelSplitter
            data-testid="world-splitter-right"
            width={panelWidths.right}
            grow="left"
            onResize={setRightPanelWidth}
            onResizeEnd={persistPanelWidths}
          />
        )}
        {/* Hidden rather than unmounted, as the left panel is — the
            property grid's fields are uncontrolled and corrected by
            remount-by-key (`refactoring-targets.md` §7), so an unmount
            here would discard a half-typed coordinate on a collapse. */}
        {summary && (
          <Box data-testid="world-panel-right" sx={{
            width: panelWidths.right, flexShrink: 0, minHeight: 0,
            display: rightPanelCollapsed ? 'none' : 'flex', flexDirection: 'column',
          }}>
            <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Tooltip title="Hide properties panel">
                <IconButton
                  size="small"
                  onClick={() => setRightPanelCollapsed(true)}
                  data-testid="world-panel-collapse-right"
                  aria-label="Hide properties panel"
                >
                  <ChevronRightIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>
            <Box sx={{ flex: 1, minHeight: 0 }}>
              {panel === 'assets' && selectedAsset !== null
                ? (
                  <WorldAssetPreview
                    path={selectedAsset}
                    loadTexture={loadTexture}
                    loadVisual={loadVisual}
                    selectionCount={selection.length}
                    onUseAsVisual={useAssetAsVisual}
                    onPlace={(name) => setArmed({ kind: 'place', spec: { ...FRESH_PLACE, visual: name } })}
                  />
                )
                : selectedWaypoint !== null && waynet
                  ? (
                    <WaypointPanel
                      name={waynet.names[selectedWaypoint]}
                      routines={waypointSiteIndex[waynet.names[selectedWaypoint].toUpperCase()] || []}
                      spawns={waypointSpawns}
                      onRename={(to) => renameWaypointTo(selectedWaypoint, to)}
                      neighbours={waypointEdges}
                      resolveWaypoint={resolveWaypointToJoin}
                      onConnect={joinWaypointTo}
                      onDisconnect={unjoinWaypointFrom}
                      onDelete={() => setDeletingWaypoint({
                        waypoint: selectedWaypoint, name: waynet.names[selectedWaypoint],
                      })}
                      onInsertNpc={() => openInsertNpcAtWaypoint(waynet.names[selectedWaypoint])}
                    />
                  )
                  : (
                    <WorldPropertyGrid
                      summary={summary}
                      selection={selection}
                      refusalGeneration={editRefusals}
                      onEditProps={handleEditProps}
                      onFocus={focusVob}
                      onTranslate={handleTranslateSelection}
                      onRotate={handleRotateVob}
                      onRotateSelection={handleRotateSelection}
                      classProps={classProps?.vob === primary ? classProps.props : null}
                      onEditClassProps={handleEditClassProps}
                      onEditBaseProps={handleEditBaseProps}
                      itemInstances={itemInstances}
                      itemVisuals={itemVisuals}
                      thumbnails={thumbnails}
                    />
                  )}
            </Box>
          </Box>
        )}
      </Box>

      {summary && (
        <Paper
          square
          elevation={1}
          sx={{ p: 1, borderTop: 1, borderColor: 'divider', display: 'flex', alignItems: 'center' }}
          data-testid="world-status-bar"
        >
          {/* The status bar: the ground on the left, the counts on the right.

              Terrain is not a VOB, so it has no row and no properties — a hit
              reports the point rather than inventing a selection. ZenGin space,
              centimetres: the coordinates an op would carry, and the position a
              placed VOB gets.

              It stays up while something is selected, which is what makes a
              parented placement expressible: only a viewport pick replaces the
              point, so clicking a row in the scene tree afterwards names a
              parent without losing the ground the user chose.

              Mounted whether or not there is a point, because mounting it on the
              first hit shortened the viewport by its own height at the instant of
              the click — the picture moves out from under the cursor that picked
              it. That is also why the row reserves the height of the button it
              only sometimes carries: a bar that changes height is the same
              shove. */}
          <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
            {armed !== null ? (
              <>
                {/* An armed add speaks over the point: it is the more recent
                    intent, and the click it asks for is the same click that
                    would replace the point anyway. */}
                <Typography variant="caption" color="text.secondary" data-testid="world-terrain-hint">
                  {armed.kind === 'place'
                    ? `Click the ground to place ${placeLabel(armed.spec)}.`
                    : armed.kind === 'insert-npc'
                      ? `Click the ground to add waypoint ${armed.waypoint} and insert ${armed.instance} there.`
                      : `Click the ground to place waypoint ${armed.name}.`}
                </Typography>
                <Button size="small" onClick={() => setArmed(null)} data-testid="world-armed-cancel">
                  Cancel (Esc)
                </Button>
              </>
            ) : terrainPoint === null ? (
              <>
                <Typography variant="caption" color="text.secondary" data-testid="world-terrain-hint">
                  {pendingWaypointName !== null
                    ? `Click the ground to place waypoint "${pendingWaypointName}".`
                    : 'Click the ground to choose where a VOB goes.'}
                </Typography>
                {/* The reservation itself, and it is a button rather than a
                    number: a hard-coded height read off MUI's small-button
                    metrics drifts the moment a theme sets one, and jsdom has no
                    layout, so nothing could catch the drift. A real small
                    button, hidden, zero-width and out of the tab and
                    accessibility trees, is the theme's own metric and cannot
                    disagree with the buttons it stands in for.

                    Only the horizontal metrics are taken off it: the vertical
                    padding is the height, and it carries a space so it has a
                    line box to be as tall as. */}
                <Button
                  size="small"
                  aria-hidden
                  tabIndex={-1}
                  /* Stack's spacing wins on specificity, so the margin the
                     spacer would otherwise add is overridden here. */
                  sx={{
                    visibility: 'hidden',
                    width: 0,
                    minWidth: 0,
                    px: 0,
                    overflow: 'hidden',
                    margin: '0 !important',
                  }}
                  data-testid="world-terrain-bar-spacer"
                >
                  &nbsp;
                </Button>
              </>
            ) : (
              <>
                <Typography variant="caption" color="text.secondary" data-testid="world-terrain-point">
                  Terrain @ {terrainPoint.map((v) => Math.round(v)).join(', ')}
                </Typography>
                <Button
                  size="small"
                  onClick={() => setPlacing(FRESH_PLACE)}
                  data-testid="world-place-vob"
                >
                  Place VOB here…
                </Button>
                {/* Both switch the overlay on rather than waiting for it: the
                    overlay is the only thing that draws a waypoint, so a
                    waypoint added without it would be invisible and unpickable
                    the moment it landed. Gated on the payload alone — with no
                    names to append to there is nothing to author. */}
                {waynet !== null && (
                  <Button
                    size="small"
                    onClick={() => {
                      ensureWaynetShown();
                      // An armed name wins over a fresh suggestion, and is
                      // spent the moment it does — the same way a suggested
                      // one is spent by this click today.
                      setAddingWaypoint(pendingWaypointName ?? suggestedWaypointName());
                      setPendingWaypointName(null);
                    }}
                    data-testid="world-add-waypoint"
                  >
                    Add waypoint here…
                  </Button>
                )}
                {waynet !== null && (
                  <Button
                    size="small"
                    onClick={() => {
                      ensureWaynetShown();
                      openInsertNpcForNewWaypoint(suggestedWaypointName());
                    }}
                    data-testid="world-insert-npc"
                  >
                    Insert NPC here…
                  </Button>
                )}
              </>
            )}
          </Stack>
          <WorldStatusStats summary={summary} visuals={visuals} />
        </Paper>
      )}

      <Dialog
        open={addingWaypoint !== null}
        onClose={() => setAddingWaypoint(null)}
        maxWidth="xs"
        fullWidth
        data-testid="world-waypoint-add-dialog"
      >
        <DialogTitle>Add a waypoint</DialogTitle>
        <DialogContent>
          <DialogContentText variant="caption" sx={{ display: 'block', mb: 1.5 }}>
            {/* Both facts a user cannot see and would be caught out by: it is
                appended, so nothing else moves, and it is a free point in no
                edge — which is what makes the engine keep it, and what makes it
                not part of the walkable net yet. */}
            It is appended as a free point
            {terrainPoint === null
              ? ' where you next click the ground'
              : ` at ${terrainPoint.map((v) => Math.round(v)).join(', ')}`}, in no edge and
            renumbering nothing.
          </DialogContentText>
          <Autocomplete
            freeSolo
            fullWidth
            size="small"
            options={knownWaypointNames}
            inputValue={addingWaypoint ?? ''}
            onInputChange={(_event, value) => setAddingWaypoint(value)}
            renderInput={(params) => (
              <TextField
                {...params}
                autoFocus
                label="Name"
                /* The list offers every waypoint a *script* names, and most of
                   those the world already has — so this is the ordinary way to
                   reach the disabled Add, not a corner. It reads the same
                   boolean the button does, so the two cannot disagree. */
                error={duplicateWaypointName}
                helperText={duplicateWaypointName
                  ? 'Already in this world — pick a name it has not got.'
                  : ' '}
                inputProps={{ ...params.inputProps, 'data-testid': 'world-waypoint-add-name' }}
              />
            )}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddingWaypoint(null)}>Cancel</Button>
          <Button
            variant="contained"
            /* The two refusals the binding makes, made here as well — not
               instead. This side is holding the very list the user is reading,
               so a name they can see is taken is worth refusing before a round
               trip rather than after one. */
            disabled={addingWaypoint === null || addingWaypoint.trim() === ''
              || duplicateWaypointName}
            onClick={() => {
              const name = addingWaypoint;
              setAddingWaypoint(null);
              if (name === null) return;
              if (terrainPoint !== null) addWaypointAt(name.trim(), terrainPoint);
              else setArmed({ kind: 'add-waypoint', name: name.trim() });
            }}
            data-testid="world-waypoint-add-confirm"
          >
            {terrainPoint === null ? 'Add on next click' : 'Add'}
          </Button>
        </DialogActions>
      </Dialog>

      <InsertNpcDialog
        draft={insertingNpc}
        waypointNames={waynet?.names ?? []}
        startupFunctionName={startupFunctionName}
        targetExists={insertTargetExists}
        unknownInstance={unknownInsertInstance}
        duplicateSpawn={duplicateInsertSpawn}
        terrainPoint={terrainPoint}
        onChange={editInsertNpcDraft}
        onCancel={closeInsertNpcDraft}
        onConfirm={(instance, waypoint, target) => {
          closeInsertNpcDraft();
          if (target.existing) void insertNpcAt(instance, waypoint, true, null);
          else if (target.point !== null) void insertNpcAt(instance, waypoint, false, target.point);
          // Nowhere to put the waypoint yet, so the spawn waits for the click
          // that chooses one — the status bar names the armed action.
          else setArmed({ kind: 'insert-npc', instance, waypoint });
        }}
      />

      <Dialog open={placing !== null} onClose={() => setPlacing(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Place a VOB</DialogTitle>
        <DialogContent>
          <DialogContentText variant="caption" sx={{ display: 'block', mb: 1.5 }}>
            {/* Which list it is appended to is the one thing about this dialog
                that changes the world's shape, so it is said before the fields
                rather than left to be discovered from the scene tree. */}
            {placing?.parent === null
              ? `It is appended as a root VOB ${placeWhere}.`
              : `It becomes the last child of ${parentLabel}, ${placeWhere} — which renumbers `
                + 'every VOB after that subtree.'}
          </DialogContentText>
          {/* Offered only when there is a VOB to be a parent. A checkbox rather
              than a picker: the selection is already the app's way of naming one
              VOB, and a second one inside the dialog would be a tree the dialog
              has no room for. */}
          {parentCandidate !== null && (
            <FormControlLabel
              sx={{ display: 'block', mb: 1 }}
              control={(
                <Checkbox
                  size="small"
                  checked={placing?.parent !== null}
                  onChange={(event) => setPlacing((was) => (was === null ? was : {
                    ...was, parent: event.target.checked ? parentCandidate : null,
                  }))}
                  inputProps={{ 'data-testid': 'world-place-parent' } as React.InputHTMLAttributes<HTMLInputElement>}
                />
              )}
              label={<Typography variant="caption">Place under {parentLabel}</Typography>}
            />
          )}
          {/* The class is chosen here or never: it is the object's C++ type, so
              nothing can turn a placed `zCVob` into an item afterwards
              (level-editor.md §16.15, I1). A native select, because the set is
              closed and short — the binding refuses any class it has no
              field-complete construction for. */}
          <TextField
            select
            fullWidth
            size="small"
            variant="standard"
            label="Class"
            value={placing?.vobClass ?? 'zCVob'}
            onChange={(event) => setPlacing((was) => (was === null ? was : {
              ...was, vobClass: event.target.value as AuthorableVobClass,
            }))}
            SelectProps={{ native: true, inputProps: { 'data-testid': 'world-place-class' } }}
            sx={{ mb: 1 }}
          >
            {AUTHORABLE_VOB_CLASSES.map((className) => (
              <option key={className} value={className}>{className}</option>
            ))}
          </TextField>
          <TextField
            autoFocus
            fullWidth
            size="small"
            variant="standard"
            label="Name (optional)"
            value={placing?.name ?? ''}
            onChange={(event) => setPlacing((was) => (was === null ? was : { ...was, name: event.target.value }))}
            inputProps={{ 'data-testid': 'world-place-name' }}
          />
          {/* An item carries an instance *instead of* a visual, not beside one:
              the engine derives an item's visual from the script instance, and
              the binding leaves the field empty for exactly that reason. A light
              and a sound carry neither — what makes each the thing it is comes
              from the binding's construction and then from the property grid. */}
          {placing?.vobClass === 'oCItem' && (
            <TextField
              fullWidth
              size="small"
              variant="standard"
              label="Instance"
              placeholder="ITFO_APPLE"
              error={placeRefused}
              helperText={placeRefused
                ? 'The loaded project declares no such item instance — ZenGin crashes on one it cannot resolve.'
                : 'The script instance the engine spawns. It supplies the visual, so there is none to give here.'}
              value={placing?.instance ?? ''}
              onChange={(event) => setPlacing((was) => (was === null ? was : { ...was, instance: event.target.value }))}
              inputProps={{ 'data-testid': 'world-place-instance' }}
              sx={{ mt: 2 }}
            />
          )}
          {placing?.vobClass === 'zCVob' && (
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mt: 2 }}>
              <TextField
                fullWidth
                size="small"
                variant="standard"
                label="Visual"
                placeholder="NW_CRATE.3DS"
                helperText="Its class comes from the extension. A .TGA decal is refused — it carries settings this does not take."
                value={placing?.visual ?? ''}
                onChange={(event) => setPlacing((was) => (was === null ? was : { ...was, visual: event.target.value }))}
                inputProps={{ 'data-testid': 'world-place-visual' }}
              />
              {/* The Assets panel as a picker (§16.26 row 1): the mesh it last
                  previewed, by its bare name. The previewed path outlives the
                  tab, so the gesture is preview, switch to the scene, click
                  the ground, place. */}
              <Tooltip
                title={selectedAsset === null || !isPlaceableVisual(selectedAsset)
                  ? 'Preview a mesh in the Assets panel first'
                  : `Use ${NAME_OF(selectedAsset)}`}
              >
                <span>
                  <Button
                    size="small"
                    disabled={selectedAsset === null || !isPlaceableVisual(selectedAsset)}
                    onClick={() => setPlacing((was) => (was === null || selectedAsset === null
                      ? was
                      : { ...was, visual: NAME_OF(selectedAsset) }))}
                    data-testid="world-place-use-previewed"
                    sx={{ mt: 1.5, whiteSpace: 'nowrap' }}
                  >
                    Use previewed
                  </Button>
                </span>
              </Tooltip>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPlacing(null)} data-testid="world-place-cancel">Cancel</Button>
          <Button
            variant="contained"
            data-testid="world-place-confirm"
            disabled={placeRefused}
            onClick={() => {
              const spec = placing;
              setPlacing(null);
              if (spec === null) return;
              if (terrainPoint !== null) void placeVobAt(spec, terrainPoint);
              else setArmed({ kind: 'place', spec });
            }}
          >
            {terrainPoint === null ? 'Place on next click' : 'Place'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
    </LiveTileContext.Provider>
  );
};

export default WorldSurface;
