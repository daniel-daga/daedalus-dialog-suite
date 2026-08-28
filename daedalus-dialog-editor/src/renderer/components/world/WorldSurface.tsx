import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import {
  Alert, Box, Button, Checkbox, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogContentText, DialogTitle, FormControlLabel, MenuItem, Paper, Slider, Stack, Tab, Tabs,
  TextField, ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material';
import {
  addVob, alignVobsToNormal, applyWaypointPositions, classPropKeys, deleteVob, dropVobsToGround,
  duplicateVobSpec,
  invertOp, isBarrierOp, isStructuralOp,
  isWaynetOp, moveWaypoint, placeBounds, renumbersPaths,
  reparentVob, rotateVob, rotateVobs, setVobClassProp, setVobProps, translateVobs, vobIndexPath,
  type ClassProps, type NewVob, type VobProps, type ZenBounds, type ZenPosition, type ZenRotation,
} from 'zen-world';
import type { InstancedPayload, WaynetPayload, WorldMeshPayload, WorldOp } from '../../../shared/worldTypes';
import { primaryVob, useWorldStore } from '../../store/worldStore';
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

/** A small MUI button's height, rounded up — what the placement bar's row
 *  reserves so it is the same height with a point and without one. */
const BAR_HEIGHT = 31;

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

const WorldSurface: React.FC = () => {
  const status = useWorldStore((s) => s.status);
  const summary = useWorldStore((s) => s.summary);
  const error = useWorldStore((s) => s.error);
  const editError = useWorldStore((s) => s.editError);
  const selection = useWorldStore((s) => s.selection);
  const selectedWaypoint = useWorldStore((s) => s.selectedWaypoint);
  const waypointSiteIndex = useProjectStore((s) => s.waypointSiteIndex);
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
    { name: string; visual: string; parent: number | null } | null
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
  /**
   * How bright the viewport draws — component state, beside `showWaynet` and
   * the gizmo mode, because it is the same kind of thing they are: a setting
   * about the picture, not about the world. It reaches nothing but the
   * viewport, so it produces no op and cannot make the world dirty, and it is
   * not persisted for the same reason nothing else on this bar is.
   */
  const [exposure, setExposure] = useState(DEFAULT_EXPOSURE);
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

      // Requested after the summary, so the scene tree and the load timings are
      // on screen while 31 MB of geometry crosses.
      setMesh(await window.editorAPI.getWorldMesh());
      setVisuals(await window.editorAPI.getWorldVisuals());
    } catch (failure) {
      openFailed(failure instanceof Error ? failure.message : String(failure));
    }
  }, [beginOpen, openSucceeded, openFailed]);

  const toggleWaynet = useCallback(async () => {
    const next = !showWaynet;
    setShowWaynet(next);
    // The overlay is hidden rather than destroyed, so nothing else would notice
    // a waypoint still being selected — and the gizmo would go on standing, and
    // dragging, where there is no longer a dot to see.
    if (!next) selectWaypoint(null);
    if (next && waynet === null) setWaynet(await window.editorAPI.getWorldWaynet());
  }, [showWaynet, waynet, selectWaypoint]);

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
   * A double-click on a scene-tree row, or its locator: select the VOB and jump
   * the camera to it, leaving the orbit pivot on it.
   *
   * The request is a fresh object every time and carries the VOB rather than
   * relying on the selection, because both of those are what make it a request
   * and not a state — the same VOB is jumped to twice precisely after the
   * camera has been flown away from it, and the selection reaches the viewport
   * a render later.
   */
  const [frameRequest, setFrameRequest] = useState<{ vob: number } | null>(null);

  const focusVob = useCallback((vob: number) => {
    handleSelect(vob, false);
    setFrameRequest({ vob });
  }, [handleSelect]);

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

  useEffect(() => {
    setClassProps(null);
    if (summary === null || primary === null) return undefined;

    const { reader } = vobModelOf(summary);
    const className = reader.className(primary);
    // Nothing is asked for a class the catalogue has no fields for — 35 of the
    // 37 in a retail world, and the selection moves with every click.
    if (className === null || classPropKeys(className).length === 0) return undefined;
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
    const waynetOps = ops.filter(isWaynetOp);
    if (waynetOps.length > 0 && waynet !== null) {
      applyWaypointPositions(new Float32Array(waynet.positions), waynetOps);
    }

    setAppliedOps([...ops]);
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
  }, [waynet]);

  const commitOps = useCallback(async (ops: WorldOp[]) => {
    const { editFailed } = useWorldStore.getState();
    try {
      await window.editorAPI.applyWorldOps(ops);
      await applied(ops);
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
    }
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
   * The imperative handle onto the viewport (level-editor.md §16.5) — the one
   * thing drop-to-ground and align-to-normal need that is a query rather than a
   * prop: a per-VOB downward raycast against the world mesh, answered
   * synchronously in response to a toolbar click.
   */
  const viewportRef = useRef<WorldViewportHandle>(null);

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

  const handleRotateSelection = useCallback((delta: ZenRotation) => {
    const { summary: current, selection: selected } = useWorldStore.getState();
    if (current === null || selected.length === 0) return;
    // Each VOB turns about its own origin, and the delta composes on the left
    // so a selection of differently-oriented VOBs all turn the same way.
    void commitOps(rotateVobs(vobModelOf(current).reader, selected, delta, boundsOf));
  }, [commitOps, boundsOf]);

  /**
   * A typed rotation from the property grid — the primary VOB alone, and an
   * **absolute** pose rather than the delta a gizmo drag arrives as: the typed
   * angles are the destination, and the grid only offers them for a single
   * selection (absolute-vs-delta for a multi-selection is an undecided UI
   * question, deliberately not answered here).
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
    spec: { name: string; visual: string; parent: number | null },
  ) => {
    const { summary: current } = useWorldStore.getState();
    if (current === null || terrainPoint === null) return;

    const visual = spec.visual.trim();
    const bounds = visual === '' ? null : await window.editorAPI.getVisualBounds(visual)
      .catch(() => null);

    const placed: NewVob = {
      position: terrainPoint,
      ...(spec.name.trim() === '' ? {} : { name: spec.name.trim() }),
      ...(visual === '' ? {} : { visual }),
      ...(bounds === null ? {} : {
        bbox: placeBounds(bounds as ZenBounds, IDENTITY, terrainPoint),
      }),
    };

    await commitOps([addVob(vobModelOf(current).reader, placed, spec.parent)]);
  }, [commitOps, terrainPoint]);

  /**
   * Duplicate one VOB in place (level-editor.md §16.14, D1).
   *
   * **In place, and appended beside the original**, which is Spacer's own
   * behaviour: the copy takes the same position, so an offset would be a
   * preference nobody asked for and a copy nobody could find is worse than one
   * sitting exactly where its original is. It goes into the original's parent,
   * so a duplicated child stays a child.
   *
   * It is an ordinary `AddVob` and nothing more — no new op, no validator
   * branch — because that op already carries a whole description of a VOB and
   * already inverts to a delete. What the copy does *not* carry is
   * `physicsEnabled`, which `NewVob` has no room for, and **its class**: the
   * binding's `insertVob` authors a `zCVob` whatever the original was, so a
   * duplicated `oCMobDoor` is not a door and a follow-up `SetVobClassProp`
   * would be refused. D2's class half waits on class-specific insertion
   * (level-editor.md §16.15); the finding is written up in §16.14.
   *
   * The box is fitted from the visual's own bounds, exactly as a rotation
   * refits one and for the same reason: the index has no bbox column to copy,
   * and the binding's default is a 10 cm cube.
   */
  const duplicateVob = useCallback(async (vob: number) => {
    const { summary: current } = useWorldStore.getState();
    if (current === null) return;

    const { reader } = vobModelOf(current);
    const parent = reader.columns.parent[vob];
    await commitOps([addVob(
      reader,
      duplicateVobSpec(reader, vob, boundsOf(vob)),
      parent < 0 ? null : parent,
    )]);
  }, [commitOps, boundsOf]);

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

      const undo = (event.ctrlKey || event.metaKey) && key === 'z' && !event.shiftKey;
      const redo = (event.ctrlKey || event.metaKey)
        && (key === 'y' || (key === 'z' && event.shiftKey));
      if (!undo && !redo) return;

      event.preventDefault();
      // What the main process says it applied, not what this side thinks it
      // sent: the op log is over there and it is the one that decides.
      void (undo ? window.editorAPI.undoWorldEdit() : window.editorAPI.redoWorldEdit())
        .then((ops) => {
          if (ops === null || ops.length === 0) return;
          // Through the same path a commit takes, because an undone placement
          // is as structural as the placement was: the VOB is gone from the
          // world and the renderer's index still has it.
          return applied(ops);
        });
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [summary, applied]);

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
          {/* One VOB, like the delete beside it and for the same reason: a
              button that copied only the primary of a five-VOB selection is the
              same surprise. A selection duplicating as one batch is D4. */}
          {summary && (
            <Button
              size="small"
              variant="outlined"
              disabled={selection.length !== 1}
              onClick={() => void duplicateVob(selection[0])}
              data-testid="world-duplicate-vob"
            >
              Duplicate VOB
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

      {/* A refused edit, deliberately not `status: 'error'` — that replaces the
          whole surface, and the world is still open and still correct. */}
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
              loadTexture={loadTexture}
              onPick={handlePick}
              selection={selection}
              onTranslateSelection={handleTranslateSelection}
              gizmoMode={gizmoMode}
              onRotateSelection={handleRotateSelection}
              appliedOps={appliedOps}
              selectedWaypoint={selectedWaypoint}
              frameRequest={frameRequest}
              terrainPoint={terrainPoint}
              exposure={exposure}
              snapGrid={snapGrid}
              snapAngle={(snapAngleDegrees * Math.PI) / 180}
              onSelectWaypoint={selectWaypoint}
              onMoveWaypoint={moveWaypointTo}
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
                  />
                )
                : (
                  <WorldPropertyGrid
                    summary={summary}
                    selection={selection}
                    refusalGeneration={editRefusals}
                    onEditProps={handleEditProps}
                    onTranslate={handleTranslateSelection}
                    onRotate={handleRotateVob}
                    classProps={classProps?.vob === primary ? classProps.props : null}
                    onEditClassProps={handleEditClassProps}
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
          <Stack direction="row" spacing={1} alignItems="center" sx={{ minHeight: BAR_HEIGHT }}>
            {terrainPoint === null ? (
              <Typography variant="caption" color="text.secondary" data-testid="world-terrain-hint">
                Click the ground to choose where a VOB goes.
              </Typography>
            ) : (
              <>
                <Typography variant="caption" color="text.secondary" data-testid="world-terrain-point">
                  Terrain @ {terrainPoint.map((v) => Math.round(v)).join(', ')}
                </Typography>
                <Button
                  size="small"
                  onClick={() => setPlacing({ name: '', visual: '', parent: null })}
                  data-testid="world-place-vob"
                >
                  Place VOB here…
                </Button>
              </>
            )}
          </Stack>
        </Paper>
      )}

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
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPlacing(null)} data-testid="world-place-cancel">Cancel</Button>
          <Button
            variant="contained"
            data-testid="world-place-confirm"
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
