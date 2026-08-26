import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Chip, Paper, Stack, Tab, Tabs, Typography } from '@mui/material';
import { translateVobs } from 'zen-world';
import type { InstancedPayload, WaynetPayload, WorldMeshPayload, WorldOp } from '../../../shared/worldTypes';
import { useWorldStore } from '../../store/worldStore';
import { vobModelOf } from '../../world/vobModel';
import WorldViewport from './WorldViewport';
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

  const commitOps = useCallback(async (ops: WorldOp[]) => {
    const { applyEdit, editFailed } = useWorldStore.getState();
    try {
      await window.editorAPI.applyWorldOps(ops);
      applyEdit(ops);
      setAppliedOps(ops);
    } catch (failure) {
      editFailed(failure instanceof Error ? failure.message : String(failure));
      // The viewport has already drawn the drag; left alone, the VOB would sit
      // where nothing else in the app agrees it is.
      setAppliedOps(ops.map((op) => ({ ...op, from: op.to, to: op.from })));
    }
  }, []);

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

  useEffect(() => {
    if (summary === null) return undefined;

    const handler = (event: KeyboardEvent) => {
      // Lower-cased because holding Shift changes the letter itself: Ctrl+Shift+Z
      // arrives as `key: 'Z'`, and a comparison against 'z' never fires.
      const key = event.key.toLowerCase();
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
          useWorldStore.getState().applyEdit(ops);
          setAppliedOps(ops);
        });
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [summary]);

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
              <WorldSceneTree summary={summary} selection={selection} onSelect={handleSelect} />
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
              appliedOps={appliedOps}
            />
          )}
        </Box>

        {summary && (
          <Box sx={{ width: 300, flexShrink: 0, borderLeft: 1, borderColor: 'divider', minHeight: 0 }}>
            {panel === 'assets' && selectedAsset !== null
              ? <WorldAssetPreview path={selectedAsset} loadTexture={loadTexture} />
              : <WorldPropertyGrid summary={summary} selection={selection} />}
          </Box>
        )}
      </Box>

      {terrainPoint && selection.length === 0 && (
        <Paper square elevation={1} sx={{ p: 1, borderTop: 1, borderColor: 'divider' }}>
          {/* Terrain is not a VOB, so it has no row and no properties — a hit
              reports the point rather than inventing a selection. ZenGin space,
              centimetres: the coordinates an op would carry. */}
          <Typography variant="caption" color="text.secondary" data-testid="world-terrain-point">
            Terrain @ {terrainPoint.map((v) => Math.round(v)).join(', ')}
          </Typography>
        </Paper>
      )}
    </Box>
  );
};

export default WorldSurface;
