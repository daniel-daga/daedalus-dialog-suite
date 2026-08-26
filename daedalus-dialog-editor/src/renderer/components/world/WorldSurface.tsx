import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Chip, Paper, Stack, Typography } from '@mui/material';
import type { InstancedPayload, WorldMeshPayload } from '../../../shared/worldTypes';
import { describeVob, useWorldStore } from '../../store/worldStore';
import WorldViewport from './WorldViewport';

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
  const selectedVob = useWorldStore((s) => s.selectedVob);
  const { beginOpen, openSucceeded, openFailed, selectVob } = useWorldStore.getState();

  const [gothicInstall, setGothicInstall] = useState<string | null>(null);
  const [mesh, setMesh] = useState<WorldMeshPayload | null>(null);
  const [visuals, setVisuals] = useState<InstancedPayload | null>(null);
  const [terrainPoint, setTerrainPoint] = useState<[number, number, number] | null>(null);

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

  const loadTexture = useCallback(
    (name: string, maxSize: number) => window.editorAPI.getWorldTexture(name, maxSize),
    [],
  );

  const handlePick = useCallback((vob: number | null, point: [number, number, number] | null) => {
    selectVob(vob);
    setTerrainPoint(point);
  }, [selectVob]);

  const selection = summary && selectedVob !== null ? describeVob(summary, selectedVob) : null;

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

      {status === 'idle' && (
        <Box sx={{ p: 3 }}>
          <Typography variant="body2" color="text.secondary">
            Open a ZenGin <code>.zen</code> world to view it. Phase 1a is read-only:
            the world mesh, VOB visuals and picking. Select the Gothic installation
            first — its archives supply the meshes and textures.
          </Typography>
        </Box>
      )}

      <Box sx={{ flex: 1, minHeight: 0, position: 'relative' }}>
        {mesh && visuals && summary && (
          <WorldViewport
            mesh={mesh}
            visuals={visuals}
            bbox={summary.bbox}
            loadTexture={loadTexture}
            onPick={handlePick}
          />
        )}
      </Box>

      {(selection || terrainPoint) && (
        <Paper square elevation={1} sx={{ p: 1, borderTop: 1, borderColor: 'divider' }}>
          {selection ? (
            <Typography variant="caption" data-testid="world-selection">
              {selection.className}
              {selection.name && ` "${selection.name}"`}
              {selection.visual && ` — ${selection.visual} (${selection.visualType})`}
              {` @ ${selection.position.map((v) => Math.round(v)).join(', ')}`}
            </Typography>
          ) : (
            <Typography variant="caption" color="text.secondary" data-testid="world-terrain-point">
              {/* ZenGin space, centimetres — the coordinates an op would carry. */}
              Terrain @ {terrainPoint!.map((v) => Math.round(v)).join(', ')}
            </Typography>
          )}
        </Paper>
      )}
    </Box>
  );
};

export default WorldSurface;
