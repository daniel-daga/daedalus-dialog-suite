import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import {
  Alert, Autocomplete, Box, Button, Checkbox, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogContentText, DialogTitle, FormControlLabel, IconButton, MenuItem, Paper, Slider, Stack, Tab, Tabs,
  TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material';
import RedoIcon from '@mui/icons-material/Redo';
import UndoIcon from '@mui/icons-material/Undo';
import {
  AUTHORABLE_VOB_CLASSES,
  addVob, classPropKeys, addWaypoint, alignVobsToNormal, applyWaypointNames, applyWaypointPositions,
  connectWaypoints, disconnectWaypoints,
  deleteVob, deleteWaypoint, dropVobsToGround,
  duplicateVobSubtree, duplicateVobs,
  invertOp, isBarrierOp, isStructuralOp,
  matchVobs,
  moveWaypoint, pasteVobs, placeBounds, renameWaypoint, renumbersPaths,
  reparentVob, rotateVob, rotateVobs, setVobClassProp, setVobProp, setVobProps, topLevelVobs,
  translateVobs, vobAtIndexPath, vobIndexPath,
  type AddVob,
  type AuthorableVobClass, type ClassProps, type NewVob, type ReadProps,
  type VobProps, type VobReader, type VobSubtree,
  type ZenBounds,
  type ZenPosition, type ZenRotation,
} from 'zen-world';
import type { InstancedPayload, WaynetPayload, WorldMeshPayload, WorldOp } from '../../../shared/worldTypes';
import { findFreePointVob, primaryVob, useWorldStore } from '../../store/worldStore';
import { MINUTES_PER_DAY, stateReach } from '../../routines/routineSchedule';
import { useProjectStore } from '../../store/projectStore';
import { vobModelOf } from '../../world/vobModel';
import { DEFAULT_EXPOSURE, MAX_EXPOSURE, MIN_EXPOSURE } from '../../world/WorldScene';
import WorldViewport, { type GizmoMode, type WorldViewportHandle } from './WorldViewport';
import WorldSceneTree from './WorldSceneTree';
import WorldPropertyGrid from './WorldPropertyGrid';
import WorldAssetBrowser from './WorldAssetBrowser';
import WorldAssetPreview from './WorldAssetPreview';
import WaypointPanel from './WaypointPanel';

// The World surface (level-editor.md §6): a new top-level view of the existing
// app, lazily loaded, so `zenkit-node` is pulled in only when a world is
// actually opened and dialog-only sessions never touch the native addon.
//
// Phase 1a is read-only. This shell owns the IPC calls and hands the viewport
// finished payloads; the viewport owns the Three.js lifetime. Nothing here
// keeps a geometry buffer in React state.

/** A new VOB is placed unrotated: the terrain click gives a point and nothing
 *  else, and inventing an orientation from a surface normal is a feature with
 *  its own decisions (which axis is up for this visual?) rather than a default. */
const IDENTITY: ZenRotation = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** What a move drag can be quantised to. **ZenGin centimetres** — every position
 *  in this app is in them (`WorldPropertyGrid` says so too), so a metre is 100
 *  and the labels say which is which. */
const GRID_STEPS = [
  { value: 0, label: 'Free' },
  { value: 10, label: '10 cm' },
  { value: 50, label: '50 cm' },
  { value: 100, label: '1 m' },
  { value: 500, label: '5 m' },
];

/** And a turn drag, in degrees — converted to radians on the way to the gizmo,
 *  which is what it turns in. */
const ANGLE_STEPS = [0, 5, 15, 45, 90].map((degrees) => ({
  value: degrees, label: degrees === 0 ? 'Free' : `${degrees}°`,
}));

/** Arrow-key nudge, in the world's own axes (ZenGin is Y-up): one unit of
 *  step per key, `[x, y, z]`. Keyed by the lower-cased `KeyboardEvent.key`. */
const NUDGE_DELTAS: Record<string, [number, number, number]> = {
  arrowleft: [-1, 0, 0],
  arrowright: [1, 0, 0],
  arrowup: [0, 0, -1],
  arrowdown: [0, 0, 1],
  pageup: [0, 1, 0],
  pagedown: [0, -1, 0],
};

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

/** Minutes since midnight as `HH:MM` — the routine index's own unit (§16.19). */
function formatDayMinute(minute: number): string {
  const hours = Math.floor(minute / 60);
  return `${String(hours).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
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

  const [gothicInstall, setGothicInstall] = useState<string | null>(null);
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
  const [placing, setPlacing] = useState<
    { vobClass: AuthorableVobClass; name: string; visual: string; instance: string;
      parent: number | null } | null
  >(null);
  /** The VOB the delete warning is about, or null when it is closed. A flat
   *  index rather than a boolean: the dialog names what it is about to remove,
   *  and the selection can change under an open dialog. */
  const [deleting, setDeleting] = useState<number | null>(null);
  // The left panel is the scene *or* the mounted assets, and the right panel
  // follows it: a VOB's properties belong beside the tree, an asset's preview
  // beside the browser.
  const [panel, setPanel] = useState<'scene' | 'assets'>('scene');
  const [selectedAsset, setSelectedAsset] = useState<string | null>(null);
  // Fetched the first time it is switched on and kept afterwards. It is a
  // separate IPC call on purpose: an overlay nobody asked for should not be in
  // the cold open.
  const [waynet, setWaynet] = useState<WaynetPayload | null>(null);
  const [showWaynet, setShowWaynet] = useState(false);
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
   * VOB classes switched off in the viewport — Spacer's per-class show/hide.
   *
   * The same kind of setting as `exposure`: it decides what is drawn, never
   * what the world holds. A hidden VOB is still in the index, still in the
   * scene tree and still selectable there; it is only not drawn and, because
   * the pick pass reads the same flag, not clickable.
   */
  const [hiddenClasses, setHiddenClasses] = useState<readonly string[]>([]);
  /**
   * How many edits the main process has refused — folded into every editable
   * field key in `WorldPropertyGrid`, so a refusal remounts the fields showing
   * the world's own values (refactoring-targets.md §7). Bumped in `commitOps`'
   * catch, beside the `setClassProps(null)` that is the same rule for the class
   * section: a refusal changes nothing in the world, so without this nothing
   * re-keys and an uncontrolled input keeps the number the user typed.
   */
  const [editRefusals, setEditRefusals] = useState(0);

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

  useEffect(() => {
    void window.editorAPI.getGothicInstall().then(setGothicInstall);
  }, []);

  const chooseInstall = useCallback(async () => {
    const chosen = await window.editorAPI.selectGothicInstall();
    if (chosen) setGothicInstall(chosen);
  }, []);

  const openWorld = useCallback(async () => {
    const worldPath = await window.editorAPI.openWorldDialog();
    if (!worldPath) return;

    beginOpen();
    setMesh(null);
    setVisuals(null);
    setTerrainPoint(null);
    // An armed name is a request about *this* open, and a new one answers no
    // question the previous open's Problems scan asked.
    setPendingWaypointName(null);
    // The waynet goes too, and it is the one reset that is not obvious: the
    // viewport mounts on `mesh && visuals && summary`, so a payload left
    // standing here draws the *previous* world's waypoints over the new one
    // until the read at the end of this open lands — and a drag committed in
    // that window builds its op from the old names, which the binding's name
    // guard refuses with a message about a waynet that changed. A failed open
    // would leave it standing for good.
    setWaynet(null);

    try {
      // An empty asset list asks main to derive the sources from the
      // configured Gothic install, by `zen-world`'s measured rule — archives
      // when they exist, loose trees only as a fallback. It runs there because
      // it needs the filesystem, and because those paths are then the ones the
      // path validator sees.
      const opened = await window.editorAPI.openWorld({
        worldPath,
        gameVersion: 'g2',
        assetSources: [],
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
  }, [beginOpen, openSucceeded, openFailed, refreshHistoryDepth]);

  // The payload is the overlay's, and its *names* are also the Problems
  // scan's world input. Published from one effect rather than beside each of
  // the three `setWaynet` calls, so a fourth cannot forget: the store keeps its
  // object identity when a re-read changed no name, which is what confines the
  // re-scan to the ops that can change the set (§16.8).
  useEffect(() => {
    useWorldStore.getState().waynetLoaded(waynet);
  }, [waynet]);

  const toggleWaynet = useCallback(async () => {
    const next = !showWaynet;
    setShowWaynet(next);
    // The overlay is hidden rather than destroyed, so nothing else would notice
    // a waypoint still being selected — and the gizmo would go on standing, and
    // dragging, where there is no longer a dot to see.
    if (!next) selectWaypoint(null);
    if (next && waynet === null) setWaynet(await window.editorAPI.getWorldWaynet());
  }, [showWaynet, waynet, selectWaypoint]);

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

  // Every state name any NPC has a variant for. Sorted, because the index's own
  // order is whichever file the worker pool finished first.
  const stateNames = useMemo(() => {
    const names = new Set<string>();
    for (const npc of Object.values(routineStateIndex)) {
      for (const state of Object.keys(npc.states)) names.add(state);
    }
    return [...names].sort();
  }, [routineStateIndex]);

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
    if (next && waynet === null) setWaynet(await window.editorAPI.getWorldWaynet());
  }, [showSpawns, waynet]);

  const listAssets = useCallback(
    (assetPath: string) => window.editorAPI.listWorldAssets(assetPath),
    [],
  );

  const loadTexture = useCallback(
    (name: string, maxSize: number) => window.editorAPI.getWorldTexture(name, maxSize),
    [],
  );

  // A plain click replaces the selection; Shift, Ctrl or Cmd adds to it. One
  // rule for
  // both panels — the tree is the only way to reach a VOB the viewport cannot
  // draw (a decal, a sound VOB), and the viewport the only way to reach one the
  // tree has not been scrolled to.
  const handleSelect = useCallback((vob: number, additive: boolean) => {
    if (additive) toggleVob(vob); else selectVob(vob);
  }, [selectVob, toggleVob]);

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
    const failure = viewport === null ? 'no-scene' : viewport.frameVob(vob);
    if (failure !== null) console.warn(`Could not jump to VOB ${vob}: ${failure}`);
  }, [handleSelect]);

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

    if (focusRequest.kind === 'add-waypoint') {
      // Not a jump: a script naming a place is not a position, so there is
      // nothing to frame. The overlay goes on for the same reason the
      // waypoint jump above needs it — it is the only thing that will draw
      // the result — and the name is kept for the terrain click to pick up.
      setShowWaynet(true);
      setPendingWaypointName(focusRequest.name);
      return;
    }

    // The name comes out of a script, where Daedalus is case-insensitive, and
    // the waynet is the world's own spelling.
    const wanted = focusRequest.name.toUpperCase();
    const waypoint = waynet === null
      ? -1
      : waynet.names.findIndex((name) => name.toUpperCase() === wanted);

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
  }, [focusRequest, waynet, summary, focusVob, selectWaypoint]);

  const handlePick = useCallback((
    vob: number | null, point: [number, number, number] | null, additive: boolean,
  ) => {
    // An additive click that misses must not empty a selection someone is
    // building.
    if (vob !== null) handleSelect(vob, additive);
    else if (!additive) selectVob(null);
    setTerrainPoint(point);
  }, [handleSelect, selectVob]);

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

  // ── saving (level-editor.md §5) ───────────────────────────────────────────
  //
  // Two things are deliberately not automatic. The **target** is always chosen
  // in the save dialog: the worlds this app opens are retail game files, and
  // writing back over the one it opened is never the default. And the two
  // warnings below are shown *before* the dialog rather than after the write,
  // because they are about whether to save at all.
  const [confirmingSave, setConfirmingSave] = useState(false);
  const [savedTo, setSavedTo] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const saveWorld = useCallback(async () => {
    setConfirmingSave(false);
    setSavedTo(null);
    setSaveError(null);
    if (summary === null) return;

    // `.edited.zen` beside the original, so the pre-filled answer is never the
    // file the world was opened from. Overwriting is still reachable — the OS
    // dialog asks — but it has to be asked for.
    const suggested = `${summary.worldPath.replace(/\.zen$/i, '')}.edited.zen`;

    try {
      const target = await window.editorAPI.saveWorldDialog(suggested);
      if (target === null) return;
      await window.editorAPI.saveWorld(target);
      setSavedTo(target);
    } catch (failure) {
      // The binding's own refusal — "only the binsafe writer path is verified" —
      // is the message worth showing, so it is not replaced with a generic one.
      setSaveError(failure instanceof Error ? failure.message : String(failure));
    }
  }, [summary]);

  /**
   * What every applied batch does, whichever way it arrived.
   *
   * A structural op changes how many VOBs there are, and a flat index is a VOB's
   * position in a depth-first traversal — so the columnar projection cannot be
   * patched and is re-read whole. The scene follows by rebuilding from fresh
   * visuals: an instance cannot be appended to an `InstancedMesh` that is
   * already allocated. Both are the cost of a structural edit, and only a
   * structural edit pays them. What the rebuild no longer costs is the two
   * things that made it read as a cold open: the camera stays put, because the
   * pose is restored across a rebuild under an unchanged world key, and the
   * textures are not re-decoded, because the viewport's `TextureCache` outlives
   * the `WorldScene` that used them.
   *
   * **Undo and redo come through here too**, and that is the whole reason this
   * is a function rather than three lines inside `commitOps`. They do not go
   * through it — the op log lives in the main process, so the keyboard handler
   * asks it what it undid and applies that — and an undone placement leaves the
   * renderer holding a VOB the world no longer has.
   */
  const applied = useCallback(async (ops: readonly WorldOp[]) => {
    useWorldStore.getState().applyEdit(ops);

    // The waynet's half of the projection. The store's `applyEdit` writes the
    // VOB columns and filters these out — a waypoint has no row in them — so
    // this is the only place a committed waypoint move reaches the renderer.
    // The payload is the one the overlay is drawing: its position attribute is
    // a *view* over this buffer, so writing it here is writing what is on
    // screen, and the viewport only has to ask for the upload.
    //
    // Undo and redo come through here as well, which is the whole reason it is
    // in `applied` rather than beside the commit.
    const moves = ops.filter((op) => op.op === 'MoveWaypoint');
    if (moves.length > 0 && waynet !== null) {
      applyWaypointPositions(new Float32Array(waynet.positions), moves);
    }
    // The names are the other half, and they are written differently on
    // purpose. The positions column is a buffer the overlay's attribute is a
    // *view* over, so writing it in place is writing what is on screen; nothing
    // draws a name, and the panel that shows one is React — so this replaces
    // the list rather than mutating it, keeping the same `positions` buffer.
    const renames = ops.filter((op) => op.op === 'RenameWaypoint');
    if (renames.length > 0 && waynet !== null) {
      const names = [...waynet.names];
      applyWaypointNames(names, renames);
      setWaynet({ ...waynet, names });
    }

    // An append is the one waynet op the payload cannot be patched for. The
    // positions column is a typed array the point cloud and the edge lines draw
    // *through* and it cannot grow, and the names list is only half of it — so
    // the payload is re-read whole, which is the waynet's version of what a
    // structural VOB op does to the columnar index. It is cheap for the same
    // reason the overlay is a separate call at all: a waynet is thousands of
    // points, not tens of thousands of VOBs with visuals behind them.
    //
    // Undo comes through here too, and arrives as the same op with its sides
    // swapped — so this covers the removal without knowing it is one.
    // An edge op is re-read the same way and for the same reason: the edge
    // buffer the overlay draws its lines through is a typed array, so it cannot
    // gain or lose a pair in place — and a removal can promote an endpoint to a
    // free point, which is a flags column nothing else would rewrite.
    // A delete is re-read for the same reason and one more of its own: it takes
    // a waypoint out of the *middle*, so the payload cannot shrink in place any
    // more than it can grow, and every index after it names a different
    // waypoint afterwards.
    if (ops.some((op) => op.op === 'AddWaypoint' || op.op === 'SetWaypointEdge'
      || op.op === 'DeleteWaypoint')) {
      // The removing direction takes the tail away, and a gizmo standing on it
      // would be standing on an index the waynet no longer has. Cleared rather
      // than followed, exactly as a renumbering VOB op clears the selection —
      // and a delete renumbers every waypoint after it, so it clears for the
      // stronger version of the same reason.
      if (ops.some((op) => (op.op === 'AddWaypoint' && op.to === null)
        || op.op === 'DeleteWaypoint')) selectWaypoint(null);
      setWaynet(await window.editorAPI.getWorldWaynet());
    }

    setAppliedOps([...ops]);
    void refreshHistoryDepth();
    if (!ops.some(isStructuralOp)) return;

    // A selection is a list of flat indices, and an op that renumbers leaves
    // every one of them naming a VOB nobody picked — the property grid would
    // describe it and the gizmo would sit on it. Cleared rather than followed:
    // the moved VOB's new index is recoverable from its path, but the *other*
    // VOBs in a multi-select are not, and a selection that silently lost some of
    // its members is worse than one that says it is empty. Not the same
    // condition as structural: an appended root shifts nothing.
    if (ops.some(renumbersPaths)) useWorldStore.getState().selectVob(null);

    useWorldStore.getState().indexRefreshed(await window.editorAPI.refreshWorldIndex());
    setVisuals(await window.editorAPI.getWorldVisuals());
  }, [waynet, selectWaypoint, refreshHistoryDepth]);

  /** Shared by Ctrl+Z/Y and the World bar's undo/redo buttons: ask the main
   *  process what it did, and — through the same path a commit takes —
   *  apply exactly that, never what this side thinks it sent. */
  const runHistory = useCallback(async (direction: 'undo' | 'redo') => {
    const ops = await (direction === 'undo'
      ? window.editorAPI.undoWorldEdit() : window.editorAPI.redoWorldEdit());
    if (ops === null || ops.length === 0) return;
    await applied(ops);
  }, [applied]);

  /** @returns whether the world took the edit — false is a refusal, and the
   *   banner has already been set. A caller that has something to do *after* a
   *   commit needs it: the paste selects what it pasted, and there is nothing
   *   to select when nothing landed. */
  const commitOps = useCallback(async (ops: WorldOp[]): Promise<boolean> => {
    const { editFailed } = useWorldStore.getState();
    try {
      await window.editorAPI.applyWorldOps(ops);
    } catch (failure) {
      editFailed(failure instanceof Error ? failure.message : String(failure));
      // **Let go of the class fields here, and not only in the re-read effect.**
      // The grid's inputs are uncontrolled and are put right by *remounting*
      // through a key that carries the value — so a refused edit is only undone
      // on screen if the fields unmount, and the value the re-read answers is by
      // definition the value they already had: the key does not change, and
      // nothing but a `null` in between takes the typed number off the screen.
      //
      // The effect below sets that `null` too, but a render later and in the
      // same tick as the read that fills it back in — so whether it is ever
      // *committed* depends on whether React happens to flush between the two,
      // which any unrelated pending update in this component can change (adding
      // a MUI `Select` to the bar above did exactly that). Set here it is
      // committed before the read is even issued, which is what makes the revert
      // a rule rather than a coincidence.
      setClassProps(null);
      // And re-key the base fields for the same reason: they read from the
      // columnar index, which a refusal leaves exactly as it was, so no value
      // change remounts them and a typed number would stay on screen.
      setEditRefusals((at) => at + 1);
      // The viewport has already drawn the drag; left alone, the VOB would sit
      // where nothing else in the app agrees it is. Through `invertOp` rather
      // than by swapping `from` and `to` here: a rotation carries a box for each
      // pose, and swapping only the matrix is half an inverse.
      //
      // A barrier op is dropped rather than inverted, and needs no inverse here:
      // what this puts back is the viewport's *optimistic* draw of a gizmo drag,
      // and a delete is never drawn before the main process has taken it.
      setAppliedOps(ops.filter((op) => !isBarrierOp(op)).map(invertOp));
      return false;
    }

    // **Past the commit point, and in its own try for that reason.** Everything
    // `applied` does is the renderer catching up with a world that has already
    // changed, and four of its steps can fail after the fact — `applyEdit`,
    // `applyWaypointPositions` and three IPC calls of its own. Inside the catch
    // above, any of them was reported as a refusal: the banner said the edit did
    // not happen, the viewport was handed `ops.map(invertOp)` and visibly undid
    // it, and the class fields were re-keyed — while the columns `applyEdit`
    // had already written stayed written and the main process went on holding
    // the op, on the undo stack and written on save. Three layers disagreeing
    // over an edit that did happen.
    //
    // So a failure here says exactly that, and puts nothing back. What is stale
    // is the *view*, and the way out of a stale view is to re-open the world —
    // not to pretend the world does not hold the edit.
    try {
      await applied(ops);
    } catch (failure) {
      const reason = failure instanceof Error ? failure.message : String(failure);
      editFailed(`The edit was applied, but the view could not be brought up to date: ${reason}. Re-open the world to resync.`);
    }
    // The world holds the edit either way — a stale view is not a refusal, and
    // the message above says so.
    return true;
  }, [applied]);

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

    await commitOps(setVobProps(vobModelOf(current).reader, selected, props, bounds));

    // The viewport can follow a move or a turn by rewriting an instance matrix.
    // It cannot follow a swapped visual: that is a different mesh, in a
    // different `InstancedMesh` which may not exist yet. Re-requesting the
    // instanced visuals rebuilds the scene from the world as it now is, which is
    // the same path the cold open takes and the only one that is correct. It
    // costs what an open costs, and only a change of visual pays it.
    if (props.visual !== undefined) {
      setVisuals(await window.editorAPI.getWorldVisuals());
    }
  }, [commitOps, boundsOf]);

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
  const placeVob = useCallback(async (
    spec: {
      vobClass: AuthorableVobClass; name: string; visual: string; instance: string;
      parent: number | null;
    },
  ) => {
    const { summary: current } = useWorldStore.getState();
    if (current === null || terrainPoint === null) return;

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
      position: terrainPoint,
      ...(spec.vobClass === 'zCVob' ? {} : { class: spec.vobClass }),
      ...(item ? { instance: spec.instance.trim() } : {}),
      ...(spec.name.trim() === '' ? {} : { name: spec.name.trim() }),
      ...(visual === '' ? {} : { visual }),
      ...(bounds === null ? {} : {
        bbox: placeBounds(bounds as ZenBounds, IDENTITY, terrainPoint),
      }),
    };

    await commitOps([addVob(vobModelOf(current).reader, placed, spec.parent)]);
  }, [commitOps, terrainPoint]);

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

  /**
   * The clipboard copy and paste share (level-editor.md §16.14, D3).
   *
   * **In-process, and a `ref` rather than state**: nothing on screen changes
   * when it is filled, so a render would be for nothing, and it is deliberately
   * not the OS clipboard — a VOB subtree has no serialization anybody else reads,
   * and giving it one is the cross-world clipboard nobody has asked for.
   */
  const clipboard = useRef<VobSubtree[]>([]);

  /**
   * Copy the selection — the same subtrees a duplicate commits, read at the
   * copy and held as values.
   *
   * That is the whole difference between the two verbs. `duplicateVobs` reads a
   * VOB and appends it in one step, so it can only ever put a copy back beside
   * its original; here the reading happens now and the placing happens at the
   * paste, so the clipboard outlives the selection, and outlives the VOBs it
   * was read from being deleted. It loses exactly what a duplicate loses —
   * `physicsEnabled`, the class properties, and the class of an `oCItem` or of
   * anything `insertVob` cannot construct.
   */
  const copySelection = useCallback(async () => {
    const { summary: current, selection: selected } = useWorldStore.getState();
    if (current === null || selected.length === 0) return;

    const { reader } = vobModelOf(current);
    // Awaited before the clipboard is filled, so a copy is the fields the VOBs
    // had when Ctrl+C was pressed — the same instant the rest of the subtree is
    // read at, and the whole point of the clipboard being values.
    const classProps = await readClassProps(reader, selected);
    // Pruned as a duplicate's selection is, and for the same reason: a child
    // whose parent is also copied is already inside its parent's subtree.
    clipboard.current = topLevelVobs(reader, selected)
      .map((vob) => duplicateVobSubtree(reader, vob, boundsOf, classProps));
  }, [boundsOf, readClassProps]);

  /**
   * Paste the clipboard into the selection's own list — beside it, not inside
   * it — and into the roots when nothing is selected.
   *
   * The *root* of each copied subtree, that is: its descendants go under it,
   * wherever it landed.
   *
   * A sibling rather than a child because that is what makes a paste undo a
   * copy's place: the copy lands where the thing it was copied from lives. A
   * paste *into* the selected VOB is the other reading, and it is the one that
   * cannot be taken back by selecting something else — every VOB is somewhere's
   * child, so there would be no way to ask for a root.
   *
   * The clipboard is not consumed: pasting twice is two copies, as everywhere
   * else. And it is one batch of pure adds, so it is one undo entry — the same
   * relaxation `duplicateVobs` needed, for the same reason.
   */
  const pasteClipboard = useCallback(async () => {
    const { summary: current, selection: selected } = useWorldStore.getState();
    if (current === null || clipboard.current.length === 0) return;

    const { reader } = vobModelOf(current);
    const into = primaryVob(selected);
    const parent = into === null ? -1 : reader.columns.parent[into];
    const parentPath = parent < 0 ? null : vobIndexPath(reader, parent);
    const ops = pasteVobs(reader, clipboard.current, parent < 0 ? null : parent);

    if (!await commitOps(ops)) return;

    // The copies, selected (§16.24 4) — a paste used to leave the *source*
    // selected, so the thing that had just landed could only be reached by
    // hunting for it in the scene tree.
    //
    // By path, and only after the re-read: the flat index an `AddVob` carries
    // is the enumeration as it was, and appending changes every index after the
    // insertion point. The roots of the paste are the ops whose parent is the
    // list the paste chose; a descendant's parent is its own root's new path.
    const { summary: after } = useWorldStore.getState();
    if (after === null) return;

    const refreshed = vobModelOf(after).reader;
    const pasted = ops
      .filter((op): op is AddVob => op.op === 'AddVob' && op.parentPath === parentPath)
      .map((op) => vobAtIndexPath(refreshed, op.path))
      .filter((vob): vob is number => vob !== null);

    if (pasted.length > 0) useWorldStore.getState().selectVobs(pasted);
  }, [commitOps]);

  /**
   * A finished waypoint drag — the waynet's counterpart of a gizmo move.
   *
   * One waypoint, so this takes a destination where a VOB drag takes a delta:
   * there is no selection whose spacing has to survive.
   *
   * `from` comes from the viewport rather than being read here, and that is the
   * one asymmetry with every other op in this surface. A VOB drag reads `from`
   * out of the columnar index, which the live preview never wrote — it writes
   * instance matrices instead, and the two are separate. The waynet has one
   * array for both, so by the time the drag ends the preview has already put
   * `to` where `from` used to be. The viewport recorded it at the press; it is
   * put back here so that `moveWaypoint` — and with it the range check and the
   * name the op is guarded by — reads the position the waypoint actually had.
   */
  const moveWaypointTo = useCallback((
    waypoint: number, from: ZenPosition, to: ZenPosition,
  ) => {
    if (waynet === null) return;
    const positions = new Float32Array(waynet.positions);
    positions.set(from, waypoint * 3);
    void commitOps([moveWaypoint(positions, waynet.names, waypoint, to)]);
  }, [commitOps, waynet]);

  /**
   * A waypoint renamed in the panel (§16.7, W1) — the one waynet edit that is
   * not a drag, and the only edit in this surface that does not come from the
   * viewport at all.
   *
   * `from` is read out of the payload rather than taken from the panel, for the
   * reason every op reads its own origin: it is the guard the bare index is
   * addressed by, and the panel's copy is whatever the user has been typing
   * over.
   */
  const renameWaypointTo = useCallback((waypoint: number, to: string) => {
    if (waynet === null) return;
    void commitOps([renameWaypoint(waynet.names, waypoint, to)]);
  }, [commitOps, waynet]);

  /**
   * A free waypoint appended at the terrain point (§16.7, W2).
   *
   * The terrain point rather than the camera, for the same reason a placed VOB
   * takes it: it is the one position in the surface the user has actually
   * chosen, and it already arrives in ZenGin centimetres.
   *
   * It is an *append*, so it renumbers nothing and every index the overlay is
   * holding — the selected waypoint above all — still names what it named
   * before. The waypoint is free and in no edge, which is what makes
   * `WayNet::save` write it at all; joining it to the net is W3.
   */
  const addWaypointAt = useCallback((name: string) => {
    if (waynet === null || terrainPoint === null) return;
    void commitOps([addWaypoint(waynet.names, name, terrainPoint)]);
  }, [commitOps, terrainPoint, waynet]);

  /**
   * The selected waypoint's edges, as the other end of each (§16.7, W3).
   *
   * Derived from the payload the overlay is already drawing rather than asked
   * for: `edges` is the same flat pair buffer the lines are built from, and a
   * waynet is thousands of points — walking it once per selection is cheaper
   * than a round trip and cannot disagree with what is on screen.
   */
  const waypointEdges = useMemo(() => {
    if (waynet === null || selectedWaypoint === null) return [];
    const pairs = new Uint32Array(waynet.edges);
    const neighbours: Array<{ waypoint: number; name: string }> = [];
    for (let pair = 0; pair < pairs.length; pair += 2) {
      const [left, right] = [pairs[pair], pairs[pair + 1]];
      if (left !== selectedWaypoint && right !== selectedWaypoint) continue;
      const other = left === selectedWaypoint ? right : left;
      neighbours.push({ waypoint: other, name: waynet.names[other] });
    }
    return neighbours;
  }, [waynet, selectedWaypoint]);

  /**
   * The spawns at the selected waypoint (§16.19 slice 3). The index is flat and
   * uppercase, so this is a scan keyed the same way every other by-name
   * waypoint lookup here is — the payload's own casing is display only.
   */
  const waypointSpawns = useMemo(() => {
    if (waynet === null || selectedWaypoint === null) return [];
    const point = waynet.names[selectedWaypoint].toUpperCase();
    return spawnSiteIndex.filter((site) => site.spawnPoint === point);
  }, [waynet, selectedWaypoint, spawnSiteIndex]);

  /**
   * The waypoint a typed name would join the selection to, or null when there
   * is none to join.
   *
   * Case-insensitively, because every other by-name lookup a waypoint has is —
   * the routine index above all, which is keyed uppercase since Daedalus is.
   * The first match wins: nothing in the format promises a waypoint name is
   * unique, which is why the *op* carries the index and checks the name rather
   * than the other way round.
   *
   * Null for the selection itself and for a waypoint it is already joined to,
   * so the button is dead rather than the round trip refused — both are
   * refusals the binding makes as well, and this side is holding the list.
   */
  const resolveWaypointToJoin = useCallback((typed: string): number | null => {
    if (waynet === null || selectedWaypoint === null) return null;
    const wanted = typed.trim().toUpperCase();
    if (wanted === '') return null;
    const at = waynet.names.findIndex((name) => name.toUpperCase() === wanted);
    if (at === -1 || at === selectedWaypoint) return null;
    return waypointEdges.some((edge) => edge.waypoint === at) ? null : at;
  }, [selectedWaypoint, waynet, waypointEdges]);

  /**
   * The two directions of an edge, from the panel (§16.7, W3).
   *
   * Both endpoints are index+name pairs the factory reads out of the payload,
   * the same address a move and a rename stand on — an edge inserts, deletes
   * and reorders no waypoint, so no index moves under it.
   */
  const joinWaypointTo = useCallback((to: number) => {
    if (waynet === null || selectedWaypoint === null) return;
    void commitOps([connectWaypoints(waynet.names, selectedWaypoint, to)]);
  }, [commitOps, selectedWaypoint, waynet]);

  const unjoinWaypointFrom = useCallback((to: number) => {
    if (waynet === null || selectedWaypoint === null) return;
    void commitOps([disconnectWaypoints(waynet.names, selectedWaypoint, to)]);
  }, [commitOps, selectedWaypoint, waynet]);

  /**
   * Delete a waypoint (§16.7, W4) — **the waynet's one uninvertible edit.**
   *
   * It renumbers every waypoint after it, which is what no other waynet op does
   * and what the index+name pair every one of them is addressed by could not
   * survive. §15 settled it the way it settled the VOB delete: the history
   * clears rather than replaying entries against an enumeration that has moved,
   * and the user is told first — the dialog below, the second and last confirm
   * in this surface.
   */
  const removeWaypoint = useCallback((waypoint: number) => {
    if (waynet === null) return;
    void commitOps([deleteWaypoint(waynet.names, waypoint)]);
  }, [commitOps, waynet]);

  /** The name the dialog opens with: `FP_` because a waypoint this authors is a
   *  free point, and the first index nothing is called yet, so the suggestion is
   *  never one the payload already refuses. */
  const suggestedWaypointName = useCallback(() => {
    const names = waynet === null ? [] : waynet.names;
    let at = names.length;
    while (names.includes(`FP_NEW_${at}`)) at += 1;
    return `FP_NEW_${at}`;
  }, [waynet]);

  /**
   * Every waypoint name a script in the project actually calls for, sorted —
   * the add-waypoint dialog's autocomplete list. `waypointSiteIndex`'s keys
   * are the project index's own uppercased names (Daedalus is
   * case-insensitive), which is the casing every retail name already has, so
   * nothing here re-derives a display casing of its own.
   */
  const knownWaypointNames = useMemo(
    () => Object.keys(waypointSiteIndex).sort(),
    [waypointSiteIndex],
  );

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
   * One VOB, never a selection of them, and alone in its batch: a delete
   * renumbers every VOB after it, so a second one in the same batch would
   * address a VOB that had moved.
   */
  const removeVob = useCallback(async (vob: number) => {
    const { summary: current } = useWorldStore.getState();
    if (current === null) return;
    await commitOps([deleteVob(vobModelOf(current).reader, vob)]);
  }, [commitOps]);

  useEffect(() => {
    if (summary === null) return undefined;
    // Every shortcut below is a *window* listener, and the surface stays
    // mounted behind whichever view is on screen (refactoring-targets.md §8) —
    // so bound while hidden, Ctrl+Z in the dialog view would undo a world edit
    // as well as the dialog edit `MainLayout` performs, and W would swallow a
    // keystroke on a view that has never heard of a gizmo.
    if (hidden) return undefined;

    const handler = (event: KeyboardEvent) => {
      // Lower-cased because holding Shift changes the letter itself: Ctrl+Shift+Z
      // arrives as `key: 'Z'`, and a comparison against 'z' never fires.
      const key = event.key.toLowerCase();

      // W and E, as every 3D editor binds them. Bare letters, so unlike the
      // undo shortcut they have to keep out of the way of anything that takes
      // typing — the World surface has no text field of its own, but this is a
      // window listener and the app is full of them.
      if (!event.ctrlKey && !event.metaKey && !event.altKey && (key === 'w' || key === 'e')) {
        const target = event.target as HTMLElement | null;
        if (target?.isContentEditable
          || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '')) return;
        event.preventDefault();
        setGizmoMode(key === 'w' ? 'translate' : 'rotate');
        return;
      }

      // Ctrl+C / Ctrl+V, guarded like W and E above and for the same reason:
      // this is a window listener, and in a text field a copy belongs to the
      // browser.
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey
        && (key === 'c' || key === 'v')) {
        const target = event.target as HTMLElement | null;
        if (target?.isContentEditable
          || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '')) return;
        // And with nothing selected a copy is the browser's too, rather than a
        // swallowed keystroke: the surface shows text — the install path, a VOB
        // name — that a user may well be trying to copy. It leaves whatever is
        // already on the clipboard standing.
        if (key === 'c' && useWorldStore.getState().selection.length === 0) return;
        event.preventDefault();
        if (key === 'c') void copySelection(); else void pasteClipboard();
        return;
      }

      // Delete — opens the confirm dialog that already gates a destructive
      // edit (§15) rather than committing anything itself; the two dialogs
      // stay the only place either delete is actually sent. Waypoint checked
      // first: VOB and waypoint selection are mutually exclusive in the
      // store, so only one of the two branches below can ever apply.
      if (key === 'delete') {
        const target = event.target as HTMLElement | null;
        if (target?.isContentEditable
          || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '')) return;
        const { selection: currentSelection, selectedWaypoint: currentWaypoint } = useWorldStore.getState();
        if (currentWaypoint !== null && waynet !== null) {
          event.preventDefault();
          setDeletingWaypoint({ waypoint: currentWaypoint, name: waynet.names[currentWaypoint] });
        } else if (currentSelection.length === 1) {
          event.preventDefault();
          setDeleting(currentSelection[0]);
        }
        return;
      }

      // Escape — clears the selection, but not while a surface dialog is
      // showing: every one of them already closes on Escape (MUI's own
      // Modal), and this is a second, independent listener on the same
      // keydown — without the guard it would also discard the selection the
      // open dialog is about, out from under the dialog that is closing.
      if (key === 'escape') {
        const target = event.target as HTMLElement | null;
        if (target?.isContentEditable
          || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '')) return;
        if (deleting !== null || deletingWaypoint !== null || placing !== null
          || confirmingSave || addingWaypoint !== null) return;
        const { selection: currentSelection, selectedWaypoint: currentWaypoint } = useWorldStore.getState();
        if (currentSelection.length === 0 && currentWaypoint === null) return;
        event.preventDefault();
        selectVob(null);
        return;
      }

      // World-axis nudge — ZenGin is Y-up, so ArrowLeft/Right move X,
      // ArrowUp/Down move Z and PageUp/Down move Y; the step is the chosen
      // snap grid, or 10 cm free-form (§: nudge step *is* the snap step),
      // ×10 while Shift is held. One keypress is one undo entry — no
      // coalescing, same as a single gizmo drag.
      if (NUDGE_DELTAS[key]) {
        const target = event.target as HTMLElement | null;
        if (target?.isContentEditable
          || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '')) return;
        // Reserves the arrow keys for the scene tree's own navigation
        // (level-editor-ui-improvements.md slice 7). `event.target` is the
        // bare `Window` for a shortcut fired with nothing focused, which has
        // no `closest` — only an in-page element can be inside the tree.
        if (target instanceof Element && target.closest('[role="tree"]')) return;
        event.preventDefault();
        const step = (snapGrid > 0 ? snapGrid : 10) * (event.shiftKey ? 10 : 1);
        const [dx, dy, dz] = NUDGE_DELTAS[key];
        handleTranslateSelection([dx * step, dy * step, dz * step]);
        return;
      }

      const undo = (event.ctrlKey || event.metaKey) && key === 'z' && !event.shiftKey;
      const redo = (event.ctrlKey || event.metaKey)
        && (key === 'y' || (key === 'z' && event.shiftKey));
      if (!undo && !redo) return;

      event.preventDefault();
      void runHistory(undo ? 'undo' : 'redo');
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    summary, hidden, runHistory, copySelection, pasteClipboard, waynet, selectVob,
    deleting, deletingWaypoint, placing, confirmingSave, addingWaypoint,
    snapGrid, handleTranslateSelection,
  ]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Paper square elevation={1} sx={{ p: 1, borderBottom: 1, borderColor: 'divider' }}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
          <Button size="small" variant="outlined" onClick={chooseInstall} data-testid="world-choose-install">
            {gothicInstall ? 'Change Gothic install' : 'Select Gothic install'}
          </Button>
          <Button
            size="small"
            variant="contained"
            onClick={openWorld}
            disabled={status === 'opening'}
            data-testid="world-open"
          >
            Open world
          </Button>
          {gothicInstall && (
            <Typography variant="caption" color="text.secondary" data-testid="world-install-path">
              {gothicInstall}
            </Typography>
          )}
          {status === 'opening' && <CircularProgress size={16} />}
          {summary && (
            <Button
              size="small"
              variant={showWaynet ? 'contained' : 'outlined'}
              onClick={toggleWaynet}
              data-testid="world-waynet-toggle"
            >
              Waynet
            </Button>
          )}
          {/* The project's spawns, drawn where the script puts them. Offered
              beside the waynet because it is the same kind of layer, and
              deliberately not hidden when the index is empty: an empty index
              means no script project is open, which is a different fact from
              "nobody is spawned in this world" and is not one a missing button
              could tell anybody. */}
          {summary && (
            <Button
              size="small"
              variant={showSpawns ? 'contained' : 'outlined'}
              onClick={toggleSpawns}
              data-testid="world-spawns-toggle"
            >
              Spawns
            </Button>
          )}
          {/* The time of day the spawn layer answers for (§16.19 slice 5), and
              it hangs off that layer rather than standing beside it because it
              has nothing else to change. Off by default: the static spawns are
              where `Wld_InsertNpc` puts an NPC and they are a fact on their own,
              so the slider is an extra question and not a better default. What
              it draws is two-coloured on purpose — the routines do not cover
              every NPC at every minute, and the dim markers are the ones the
              scripts leave unplaced rather than NPCs who are not there. */}
          {summary && showSpawns && (
            <Stack direction="row" spacing={1} alignItems="center">
              <Button
                size="small"
                variant={spawnTime === null ? 'outlined' : 'contained'}
                onClick={() => {
                  const next = spawnTime === null ? DEFAULT_SPAWN_TIME : null;
                  setSpawnTime(next);
                  // The state is a lens on the day; with no day there is
                  // nothing to look through, and a state surviving behind a
                  // hidden control is a filter nobody can see.
                  if (next === null) setSpawnState(null);
                }}
                data-testid="world-time-toggle"
              >
                Time
              </Button>
              {spawnTime !== null && (
                <>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    noWrap
                    sx={{ fontVariantNumeric: 'tabular-nums' }}
                    data-testid="world-time-readout"
                  >
                    {formatDayMinute(spawnTime)}
                  </Typography>
                  <Slider
                    size="small"
                    min={0}
                    max={MINUTES_PER_DAY - 1}
                    step={5}
                    value={spawnTime}
                    onChange={(_event, next) => setSpawnTime(next as number)}
                    aria-label="Time of day"
                    data-testid="world-time"
                    sx={{ width: 120 }}
                  />
                  {/* The quest state the day is drawn through. Offered with the
                      slider rather than beside it because a state without a
                      minute answers nothing the static layer does not, and
                      offered even with nothing in it for the Spawns button's
                      reason: a missing control cannot tell anybody the
                      difference between no project open and no states in this
                      one. */}
                  <TextField
                    select
                    size="small"
                    value={spawnState ?? ''}
                    onChange={(event) => setSpawnState(event.target.value || null)}
                    aria-label="Quest state"
                    data-testid="world-state"
                    sx={{ width: 130 }}
                  >
                    {/* Not "Chapter 1": a `daily_routine` is whatever the
                        instance declares, which for some NPCs is already a
                        late-game routine, so a chapter number would be a claim
                        the index cannot back. */}
                    <MenuItem value="">Declared</MenuItem>
                    {stateNames.map((name) => (
                      <MenuItem key={name} value={name}>{name}</MenuItem>
                    ))}
                  </TextField>
                  {spawnState !== null && (
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      noWrap
                      data-testid="world-state-reach"
                    >
                      {spawnStateReach.resolved} of {spawnStateReach.total} NPCs
                    </Typography>
                  )}
                </>
              )}
            </Stack>
          )}
          {/* Waypoint names. Offered whenever something is drawing waypoints —
              the waynet itself, or the spawn markers, which stand on them —
              because it labels what is drawn rather than the whole net: with
              only the spawns on, a name over an unmarked waypoint would point
              at nothing. Only the nearest few are drawn whatever is on; a
              retail world has ~3,000 waypoints and a name on each is neither
              legible nor affordable. With the spawn layer on, a marked point
              says who is standing on it rather than what it is called — the
              marker is already the point (slice 14). */}
          {summary && (showWaynet || showSpawns) && (
            <Button
              size="small"
              variant={showWaypointNames ? 'contained' : 'outlined'}
              onClick={() => setShowWaypointNames(!showWaypointNames)}
              data-testid="world-names-toggle"
            >
              Names
            </Button>
          )}
          {/* Brightness, beside the other view toggles and deliberately not
              near anything that edits: ZenGin's lighting is baked into the
              vertex colours, so an interior is dark in the file and there is no
              light in this scene to turn up. This lifts the picture and nothing
              else — no op, no dirty world, nothing saved. */}
          {summary && (
            <Stack direction="row" spacing={1} alignItems="center" sx={{ width: 170 }}>
              <Typography variant="caption" color="text.secondary" noWrap>
                Brightness
              </Typography>
              <Slider
                size="small"
                min={MIN_EXPOSURE}
                max={MAX_EXPOSURE}
                step={0.1}
                value={exposure}
                onChange={(_event, next) => setExposure(next as number)}
                aria-label="Brightness"
                data-testid="world-exposure"
              />
            </Stack>
          )}
          {/* Spacer's per-class show/hide, beside the other view controls
              because that is what it is: the world still holds every VOB, the
              scene tree still lists them, and one of them switched off here is
              only not drawn — and, since the pick pass reads the same flag, not
              clickable either. Named for what it does rather than for what is
              on: the empty list is the ordinary state and "nothing hidden"
              should read as the empty one. */}
          {summary && (
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="caption" color="text.secondary" noWrap>
                Hide
              </Typography>
              <TextField
                select
                size="small"
                value={hiddenClasses as string[]}
                onChange={(event) => setHiddenClasses(
                  typeof event.target.value === 'string'
                    ? [event.target.value]
                    : (event.target.value as unknown as string[]),
                )}
                aria-label="Hidden VOB classes"
                data-testid="world-hidden-classes"
                SelectProps={{
                  multiple: true,
                  displayEmpty: true,
                  renderValue: (picked) => ((picked as string[]).length === 0
                    ? 'Nothing'
                    : `${(picked as string[]).length} classes`),
                }}
                sx={{ width: 110, '& .MuiInputBase-input': { py: 0.5, fontSize: 12 } }}
              >
                {classOptions.map((cls) => (
                  <MenuItem key={cls} value={cls} sx={{ fontSize: 12 }}>{cls}</MenuItem>
                ))}
              </TextField>
            </Stack>
          )}
          {summary && (
            <Button
              size="small"
              variant="outlined"
              onClick={() => setConfirmingSave(true)}
              data-testid="world-save"
            >
              Save world…
            </Button>
          )}
          {/* Two modes, not three: a VOB has no scale to gizmo. */}
          {summary && (
            <ToggleButtonGroup
              size="small"
              exclusive
              value={gizmoMode}
              onChange={(_event, next: GizmoMode | null) => next !== null && setGizmoMode(next)}
              sx={{ '& .MuiToggleButton-root': { py: 0.25, px: 1, fontSize: 12 } }}
            >
              <ToggleButton value="translate" data-testid="world-gizmo-translate">Move (W)</ToggleButton>
              <ToggleButton value="rotate" data-testid="world-gizmo-rotate">Turn (E)</ToggleButton>
            </ToggleButtonGroup>
          )}
          {/* The step the gizmo drags in, and it follows the mode rather than
              being two controls: one of them is always meaningless, and the
              steps for a distance and for an angle share nothing but the word.
              Both values are kept, so a detour through the other mode does not
              reset the one you set. */}
          {summary && (
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="caption" color="text.secondary" noWrap>
                Snap
              </Typography>
              <TextField
                select
                size="small"
                value={gizmoMode === 'rotate' ? snapAngleDegrees : snapGrid}
                onChange={(event) => {
                  const step = Number(event.target.value);
                  if (gizmoMode === 'rotate') setSnapAngleDegrees(step);
                  else setSnapGrid(step);
                }}
                aria-label="Snap step"
                sx={{ width: 88, '& .MuiInputBase-input': { py: 0.5, fontSize: 12 } }}
                data-testid="world-snap"
              >
                {(gizmoMode === 'rotate' ? ANGLE_STEPS : GRID_STEPS).map((step) => (
                  <MenuItem key={step.value} value={step.value} sx={{ fontSize: 12 }}>
                    {step.label}
                  </MenuItem>
                ))}
              </TextField>
            </Stack>
          )}
          {/* Snapping's per-VOB half (level-editor.md §16.5) — unlike the
              gizmo, which drives the whole selection from one shared delta,
              each of these finds its own ground point or its own normal, so
              they act on the selection whatever its size. */}
          {summary && (
            <Stack direction="row" spacing={1}>
              <Button
                size="small"
                variant="outlined"
                disabled={selection.length === 0}
                onClick={handleDropToGround}
                data-testid="world-drop-to-ground"
              >
                Drop to ground
              </Button>
              <Button
                size="small"
                variant="outlined"
                disabled={selection.length === 0}
                onClick={handleAlignToNormal}
                data-testid="world-align-to-normal"
              >
                Align to normal
              </Button>
            </Stack>
          )}
          {/* The one destructive edit in the surface, and the only one behind a
              confirm. Exactly one VOB, never a selection: it renumbers, so each
              would need its own batch, and a button that removed only the
              primary of five is the surprise the dialog exists to prevent. */}
          {/* The whole selection, unlike the delete beside it: an append moves
              no index path, so the copies share one batch and one undo (D4).
              A delete cannot, because it renumbers the paths of everything
              after it. */}
          {summary && (
            <Button
              size="small"
              variant="outlined"
              disabled={selection.length === 0}
              onClick={() => void duplicateSelection()}
              data-testid="world-duplicate-vob"
            >
              {selection.length > 1 ? `Duplicate ${selection.length} VOBs` : 'Duplicate VOB'}
            </Button>
          )}
          {summary && (
            <Button
              size="small"
              color="error"
              variant="outlined"
              disabled={selection.length !== 1}
              onClick={() => setDeleting(selection[0])}
              data-testid="world-delete-vob"
            >
              Delete VOB
            </Button>
          )}
          {/* The main process is the authority on whether there is anything
              to do (§7) — these read `historyDepth`, never a local guess, and
              a click drives the very path Ctrl+Z does (`runHistory`). */}
          {summary && (
            <Stack direction="row" spacing={0.5}>
              <Tooltip title="Undo (Ctrl+Z)">
                <span>
                  <IconButton
                    size="small"
                    disabled={historyDepth.undo === 0}
                    onClick={() => void runHistory('undo')}
                    data-testid="world-undo"
                    aria-label="Undo"
                  >
                    <UndoIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title="Redo (Ctrl+Y)">
                <span>
                  <IconButton
                    size="small"
                    disabled={historyDepth.redo === 0}
                    onClick={() => void runHistory('redo')}
                    data-testid="world-redo"
                    aria-label="Redo"
                  >
                    <RedoIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            </Stack>
          )}
          {summary && (
            <Stack direction="row" spacing={1}>
              <Chip size="small" label={`${summary.stats.vobCount.toLocaleString()} VOBs`} />
              <Chip size="small" label={`${summary.stats.worldTriangles.toLocaleString()} triangles`} />
              <Chip size="small" label={`${summary.stats.worldDrawGroups} world draw calls`} />
              {visuals && <Chip size="small" label={`${visuals.stats.vobsPlaced.toLocaleString()} placed`} />}
            </Stack>
          )}
        </Stack>
      </Paper>

      {status === 'error' && (
        <Alert severity="error" square data-testid="world-error">{error}</Alert>
      )}

      {/* A refused edit — or one the view could not follow, or a waynet read
          that failed over an open world. Deliberately not `status: 'error'`:
          that replaces the whole surface, and the world is still open. */}
      {editError !== null && (
        <Alert severity="warning" square data-testid="world-edit-error">{editError}</Alert>
      )}

      {saveError !== null && (
        <Alert severity="warning" square data-testid="world-save-error">{saveError}</Alert>
      )}
      {savedTo !== null && (
        <Alert severity="success" square data-testid="world-saved">Saved to {savedTo}</Alert>
      )}

      {/* The warnings belong before the write, not after it: they are about
          whether to save at all. Both are the brief's (§7) and both are facts
          about ZenGin rather than about this editor. */}
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
              Only <code>zCArchiverBinSafe</code> worlds can be written: that is the one writer path
              verified byte-for-byte against the retail corpus and in the original engine. The four
              in a Gothic II install are NewWorld, OldWorld, AddonWorld and DragonIsland.
            </p>
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmingSave(false)} data-testid="world-save-cancel">Cancel</Button>
          <Button onClick={saveWorld} variant="contained" data-testid="world-save-confirm">
            Choose a file…
          </Button>
        </DialogActions>
      </Dialog>

      {/* The requirement §15 put in place of an inverse. Every other edit in
          this surface undoes, so the thing the user has to be told is not that
          a delete is destructive — it is that this one takes the undo stack
          with it. Spacer has no undo at all, which is why the op ships; it is
          not why the warning is optional. */}
      <Dialog open={deleting !== null} onClose={() => setDeleting(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete {labelOf(deleting)}?</DialogTitle>
        <DialogContent>
          <DialogContentText component="div" variant="body2" data-testid="world-delete-warning">
            <p>
              <strong>This cannot be undone.</strong> A deleted VOB carries per-class properties,
              children, an AI and an event manager that an op has no way to describe, so there is
              nothing to put back — and the earlier edits go with it: the undo history is cleared,
              because every entry in it addresses VOBs by numbers this delete has just changed.
            </p>
            <p>
              The VOB and everything below it in the scene tree is removed. The world in the editor
              changes; the file on disk does not until it is saved.
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
              const vob = deleting;
              setDeleting(null);
              if (vob !== null) void removeVob(vob);
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
            Open a ZenGin <code>.zen</code> world to view it. Phase 1a is read-only:
            the world mesh, VOB visuals and picking. Select the Gothic installation
            first — its archives supply the meshes and textures.
          </Typography>
        </Box>
      )}

      {/* Scene tree | viewport | properties. The two panels appear only once a
          world is open: without a `VobIndex` there is no hierarchy to show, and
          an empty tree beside an empty viewport says nothing. */}
      <Box sx={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {summary && (
          <Box sx={{
            width: 280, flexShrink: 0, borderRight: 1, borderColor: 'divider',
            minHeight: 0, display: 'flex', flexDirection: 'column',
          }}>
            <Tabs
              value={panel}
              onChange={(_event, next: 'scene' | 'assets') => setPanel(next)}
              variant="fullWidth"
              sx={{ minHeight: 32, '& .MuiTab-root': { minHeight: 32, fontSize: 12 } }}
            >
              <Tab value="scene" label="Scene" data-testid="world-panel-scene" />
              <Tab value="assets" label="Assets" data-testid="world-panel-assets" />
            </Tabs>
            <Box sx={{ flex: 1, minHeight: 0, display: panel === 'scene' ? 'block' : 'none' }}>
              <WorldSceneTree
                summary={summary}
                selection={selection}
                appliedOps={appliedOps}
                onSelect={handleSelect}
                onFocus={focusVob}
                onReparent={reparent}
              />
            </Box>
            {/* Mounted only once the user asks for it: the first listing is an
                IPC round trip into the worker that holds the VFS. */}
            {panel === 'assets' && (
              <Box sx={{ flex: 1, minHeight: 0 }}>
                <WorldAssetBrowser listAssets={listAssets} onPreview={setSelectedAsset} />
              </Box>
            )}
          </Box>
        )}

        <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, position: 'relative' }}>
          {mesh && visuals && summary && (
            <WorldViewport
              ref={viewportRef}
              mesh={mesh}
              visuals={visuals}
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
              onPick={handlePick}
              selection={selection}
              onTranslateSelection={handleTranslateSelection}
              gizmoMode={gizmoMode}
              onRotateSelection={handleRotateSelection}
              appliedOps={appliedOps}
              selectedWaypoint={selectedWaypoint}
              terrainPoint={terrainPoint}
              exposure={exposure}
              hiddenVobs={hiddenVobs}
              snapGrid={snapGrid}
              snapAngle={(snapAngleDegrees * Math.PI) / 180}
              onSelectWaypoint={selectWaypoint}
              onMoveWaypoint={moveWaypointTo}
              paused={hidden}
            />
          )}
        </Box>

        {summary && (
          <Box sx={{ width: 300, flexShrink: 0, borderLeft: 1, borderColor: 'divider', minHeight: 0 }}>
            {panel === 'assets' && selectedAsset !== null
              ? <WorldAssetPreview path={selectedAsset} loadTexture={loadTexture} />
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
                  />
                )}
          </Box>
        )}
      </Box>

      {summary && (
        <Paper
          square
          elevation={1}
          sx={{ p: 1, borderTop: 1, borderColor: 'divider' }}
          data-testid="world-terrain-bar"
        >
          {/* Terrain is not a VOB, so it has no row and no properties — a hit
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
          <Stack direction="row" spacing={1} alignItems="center">
            {terrainPoint === null ? (
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
                  onClick={() => setPlacing({
                    vobClass: 'zCVob', name: '', visual: '', instance: '', parent: null,
                  })}
                  data-testid="world-place-vob"
                >
                  Place VOB here…
                </Button>
                {/* Offered only while the overlay is on, and not as a
                    preference: the overlay is the only thing that draws a
                    waypoint, so a waypoint added without it would be invisible
                    and unpickable the moment it landed. */}
                {showWaynet && waynet !== null && (
                  <Button
                    size="small"
                    onClick={() => {
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
              </>
            )}
          </Stack>
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
            It is appended as a free point at
            {` ${terrainPoint?.map((v) => Math.round(v)).join(', ')}`}, in no edge and
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
              if (name !== null) void addWaypointAt(name.trim());
            }}
            data-testid="world-waypoint-add-confirm"
          >
            Add
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={placing !== null} onClose={() => setPlacing(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Place a VOB</DialogTitle>
        <DialogContent>
          <DialogContentText variant="caption" sx={{ display: 'block', mb: 1.5 }}>
            {/* Which list it is appended to is the one thing about this dialog
                that changes the world's shape, so it is said before the fields
                rather than left to be discovered from the scene tree. */}
            {placing?.parent === null
              ? `It is appended as a root VOB at ${terrainPoint?.map((v) => Math.round(v)).join(', ')}.`
              : `It becomes the last child of ${parentLabel}, at `
                + `${terrainPoint?.map((v) => Math.round(v)).join(', ')} — which renumbers `
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
              sx={{ mt: 2 }}
            />
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
              if (spec !== null) void placeVob(spec);
            }}
          >
            Place
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default WorldSurface;
