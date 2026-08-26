import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogContentText, DialogTitle, Paper, Stack, Tab, Tabs, TextField,
  ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material';
import {
  addVob, invertOp, isStructuralOp, placeBounds, reparentVob, rotateVobs, setVobProps,
  translateVobs,
  type NewVob, type VobProps, type ZenBounds, type ZenRotation,
} from 'zen-world';
import type { InstancedPayload, WaynetPayload, WorldMeshPayload, WorldOp } from '../../../shared/worldTypes';
import { useWorldStore } from '../../store/worldStore';
import { vobModelOf } from '../../world/vobModel';
import WorldViewport, { type GizmoMode } from './WorldViewport';
import WorldSceneTree from './WorldSceneTree';
import WorldPropertyGrid from './WorldPropertyGrid';
import WorldAssetBrowser from './WorldAssetBrowser';
import WorldAssetPreview from './WorldAssetPreview';

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

const WorldSurface: React.FC = () => {
  const status = useWorldStore((s) => s.status);
  const summary = useWorldStore((s) => s.summary);
  const error = useWorldStore((s) => s.error);
  const editError = useWorldStore((s) => s.editError);
  const selection = useWorldStore((s) => s.selection);
  const { beginOpen, openSucceeded, openFailed, selectVob, toggleVob } = useWorldStore.getState();

  const [gothicInstall, setGothicInstall] = useState<string | null>(null);
  const [mesh, setMesh] = useState<WorldMeshPayload | null>(null);
  const [visuals, setVisuals] = useState<InstancedPayload | null>(null);
  const [terrainPoint, setTerrainPoint] = useState<[number, number, number] | null>(null);
  /** The VOB being placed, while the dialog is open. Null when it is closed. */
  const [placing, setPlacing] = useState<{ name: string; visual: string } | null>(null);
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
    if (next && waynet === null) setWaynet(await window.editorAPI.getWorldWaynet());
  }, [showWaynet, waynet]);

  const listAssets = useCallback(
    (assetPath: string) => window.editorAPI.listWorldAssets(assetPath),
    [],
  );

  const loadTexture = useCallback(
    (name: string, maxSize: number) => window.editorAPI.getWorldTexture(name, maxSize),
    [],
  );

  // A plain click replaces the selection; Ctrl/Cmd adds to it. One rule for
  // both panels — the tree is the only way to reach a VOB the viewport cannot
  // draw (a decal, a sound VOB), and the viewport the only way to reach one the
  // tree has not been scrolled to.
  const handleSelect = useCallback((vob: number, additive: boolean) => {
    if (additive) toggleVob(vob); else selectVob(vob);
  }, [selectVob, toggleVob]);

  const handlePick = useCallback((
    vob: number | null, point: [number, number, number] | null, additive: boolean,
  ) => {
    // A Ctrl+click that misses must not empty a selection someone is building.
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
   * structural edit pays them — including a camera that returns to framing the
   * world, since the rebuild is the same path an open takes.
   *
   * **Undo and redo come through here too**, and that is the whole reason this
   * is a function rather than three lines inside `commitOps`. They do not go
   * through it — the op log lives in the main process, so the keyboard handler
   * asks it what it undid and applies that — and an undone placement leaves the
   * renderer holding a VOB the world no longer has.
   */
  const applied = useCallback(async (ops: readonly WorldOp[]) => {
    useWorldStore.getState().applyEdit(ops);
    setAppliedOps([...ops]);
    if (!ops.some(isStructuralOp)) return;

    useWorldStore.getState().indexRefreshed(await window.editorAPI.refreshWorldIndex());
    setVisuals(await window.editorAPI.getWorldVisuals());
  }, []);

  const commitOps = useCallback(async (ops: WorldOp[]) => {
    const { editFailed } = useWorldStore.getState();
    try {
      await window.editorAPI.applyWorldOps(ops);
      await applied(ops);
    } catch (failure) {
      editFailed(failure instanceof Error ? failure.message : String(failure));
      // The viewport has already drawn the drag; left alone, the VOB would sit
      // where nothing else in the app agrees it is. Through `invertOp` rather
      // than by swapping `from` and `to` here: a rotation carries a box for each
      // pose, and swapping only the matrix is half an inverse.
      setAppliedOps(ops.map(invertOp));
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

  const handleRotateSelection = useCallback((delta: ZenRotation) => {
    const { summary: current, selection: selected } = useWorldStore.getState();
    if (current === null || selected.length === 0) return;
    // Each VOB turns about its own origin, and the delta composes on the left
    // so a selection of differently-oriented VOBs all turn the same way.
    void commitOps(rotateVobs(vobModelOf(current).reader, selected, delta, boundsOf));
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
   * Move a VOB into another parent — the scene tree's drag and drop.
   *
   * One op, alone in its batch, and `commitOps` enforces that rather than
   * trusting this: a reparent renumbers every path after it, and the other ops
   * in a batch carry paths resolved before the batch ran. The refresh it needs
   * afterwards is the ordinary structural one, which `applied` already does for
   * a placement — the index is re-read whole because the columnar projection
   * cannot reorder.
   */
  const reparent = useCallback(async (vob: number, toParent: number, slot: number) => {
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
   */
  const placeVob = useCallback(async (spec: { name: string; visual: string }) => {
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

    await commitOps([addVob(vobModelOf(current).reader, placed)]);
  }, [commitOps, terrainPoint]);

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
            />
          )}
        </Box>

        {summary && (
          <Box sx={{ width: 300, flexShrink: 0, borderLeft: 1, borderColor: 'divider', minHeight: 0 }}>
            {panel === 'assets' && selectedAsset !== null
              ? <WorldAssetPreview path={selectedAsset} loadTexture={loadTexture} />
              : (
                <WorldPropertyGrid
                  summary={summary}
                  selection={selection}
                  onEditProps={handleEditProps}
                />
              )}
          </Box>
        )}
      </Box>

      {terrainPoint && selection.length === 0 && (
        <Paper square elevation={1} sx={{ p: 1, borderTop: 1, borderColor: 'divider' }}>
          {/* Terrain is not a VOB, so it has no row and no properties — a hit
              reports the point rather than inventing a selection. ZenGin space,
              centimetres: the coordinates an op would carry, and the position a
              placed VOB gets. */}
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="caption" color="text.secondary" data-testid="world-terrain-point">
              Terrain @ {terrainPoint.map((v) => Math.round(v)).join(', ')}
            </Typography>
            <Button size="small" onClick={() => setPlacing({ name: '', visual: '' })} data-testid="world-place-vob">
              Place VOB here…
            </Button>
          </Stack>
        </Paper>
      )}

      <Dialog open={placing !== null} onClose={() => setPlacing(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Place a VOB</DialogTitle>
        <DialogContent>
          <DialogContentText variant="caption" sx={{ display: 'block', mb: 1.5 }}>
            {/* Stated rather than hidden: it is the constraint the enumeration
                imposes, and a user who expects the VOB under the selected node
                should find out here and not from a scene tree. */}
            It is appended as a root VOB at {terrainPoint?.map((v) => Math.round(v)).join(', ')}.
            Placing one under a parent would renumber every VOB after it, which
            no op can yet describe.
          </DialogContentText>
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
