import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, CircularProgress, Stack, Typography } from '@mui/material';
import type { NpcDefinition, NpcEdit } from '../../shared/types';
import type { NpcBodyScene } from '../../shared/worldTypes';
import { npcBodyRequest, resolveNpcVisual, withEdits } from '../npc/npcVisual';
import { useVisualPreviewCanvas } from './world/hooks/useVisualPreviewCanvas';

// The NPC as the engine would draw it, beside the form (npc-editor.md §4).
// It follows the form: unsaved edits are applied in memory before the visual
// is resolved. The project assets are mounted on demand for this preview, even
// when no level is open in the World surface.

interface NpcVisualPreviewProps {
  definition: NpcDefinition;
  /** The form's unsaved edits. */
  edits: NpcEdit[];
  lookupConstant: (name: string) => number | undefined;
  itemSource: (instance: string) => string | undefined;
  assetsReady: boolean;
  assetsError: string | null;
}

const TEXTURE_SIZE = 256;
/** Typing a head name should not extract a mesh per keystroke. */
const DEBOUNCE_MS = 250;

const loadTexture = (name: string, maxSize: number) => window.editorAPI.getWorldTexture(name, maxSize);

const NpcVisualPreview: React.FC<NpcVisualPreviewProps> = (
  { definition, edits, lookupConstant, itemSource, assetsReady, assetsError },
) => {
  const resolved = useMemo(
    () => resolveNpcVisual(withEdits(definition, edits), lookupConstant),
    [definition, edits, lookupConstant],
  );
  const body = useMemo(
    () => {
      if (!resolved.ok) return null;
      return npcBodyRequest(resolved.visual, itemSource);
    },
    [resolved, itemSource],
  );
  const requestKey = body ? JSON.stringify(body.request) : null;

  const [scene, setScene] = useState<NpcBodyScene | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'failed'>('idle');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    setScene(null);
    setState('idle');
    if (!assetsReady || requestKey === null || assetsError !== null) return;
    let current = true;
    setState('loading');
    const timer = setTimeout(() => {
      window.editorAPI.getNpcBody(JSON.parse(requestKey))
        .then((result) => {
          if (!current) return;
          setScene(result);
          setState(result === null ? 'failed' : 'idle');
        })
        .catch(() => { if (current) setState('failed'); });
    }, DEBOUNCE_MS);
    return () => { current = false; clearTimeout(timer); };
  }, [assetsReady, assetsError, requestKey]);

  useVisualPreviewCanvas(canvasRef, scene, loadTexture, TEXTURE_SIZE);

  const notes = [...(body?.notes ?? []), ...(scene?.missing ?? [])];
  return (
    <Box sx={{ mb: 2 }} data-testid="npc-preview">
      <Typography variant="subtitle2">Preview</Typography>
      {!resolved.ok && (
        <Typography variant="caption" color="text.secondary" data-testid="npc-preview-reason">
          {`Cannot draw this NPC: ${resolved.reason}.`}
        </Typography>
      )}
      {body && (
        <Typography variant="caption" sx={{ display: 'block' }} data-testid="npc-preview-summary">
          {`${body.request.body} · head ${body.request.head}`}
        </Typography>
      )}
      {body && !assetsReady && !assetsError && (
        <Stack direction="row" spacing={1} alignItems="center">
          <CircularProgress size={14} />
          <Typography variant="caption" color="text.secondary">Loading project assets…</Typography>
        </Stack>
      )}
      {body && assetsError && (
        <Typography variant="caption" color="error" sx={{ display: 'block' }} data-testid="npc-preview-assets-error">
          {`Could not load project assets: ${assetsError}`}
        </Typography>
      )}
      {state === 'loading' && (
        <Stack direction="row" spacing={1} alignItems="center">
          <CircularProgress size={14} />
          <Typography variant="caption" color="text.secondary">Assembling…</Typography>
        </Stack>
      )}
      {state === 'failed' && body && (
        <Typography variant="caption" color="error" sx={{ display: 'block' }} data-testid="npc-preview-failed">
          {`${body.request.body} does not resolve in the mounted assets.`}
        </Typography>
      )}
      {scene && (
        <canvas
          ref={canvasRef}
          data-testid="npc-preview-canvas"
          style={{
            width: '100%', maxWidth: 320, height: 400, display: 'block', marginTop: 4,
            border: '1px solid rgba(128,128,128,0.4)', touchAction: 'none',
          }}
        />
      )}
      {notes.length > 0 && (
        <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2 }} data-testid="npc-preview-notes">
          {notes.map((note) => (
            <Typography key={note} component="li" variant="caption" color="text.secondary">{note}</Typography>
          ))}
        </Box>
      )}
    </Box>
  );
};

export default NpcVisualPreview;
