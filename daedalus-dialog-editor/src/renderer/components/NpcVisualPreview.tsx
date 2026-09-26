import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, CircularProgress, Stack, Typography } from '@mui/material';
import type { NpcDefinition, NpcEdit } from '../../shared/types';
import type { NpcBodyScene } from '../../shared/worldTypes';
import { npcBodyRequest, resolveNpcVisual, withEdits } from '../npc/npcVisual';
import { useWorldStore } from '../store/worldStore';
import { useVisualPreviewCanvas } from './world/hooks/useVisualPreviewCanvas';

// The NPC as the engine would draw it, beside the form (npc-editor.md §4).
// It follows the form: unsaved edits are applied in memory before the visual
// is resolved. The meshes and textures come from the world worker's VFS, which
// exists only while a world is open — so without one the panel says what it
// would draw and why it cannot yet.

interface NpcVisualPreviewProps {
  definition: NpcDefinition;
  /** The form's unsaved edits. */
  edits: NpcEdit[];
  lookupConstant: (name: string) => number | undefined;
  itemSource: (instance: string) => string | undefined;
}

const TEXTURE_SIZE = 256;
/** Typing a head name should not extract a mesh per keystroke. */
const DEBOUNCE_MS = 250;

const loadTexture = (name: string, maxSize: number) => window.editorAPI.getWorldTexture(name, maxSize);

const NpcVisualPreview: React.FC<NpcVisualPreviewProps> = ({ definition, edits, lookupConstant, itemSource }) => {
  const worldReady = useWorldStore((s) => s.status === 'ready');
  const resolved = useMemo(
    () => resolveNpcVisual(withEdits(definition, edits), lookupConstant),
    [definition, edits, lookupConstant],
  );
  const body = useMemo(
    () => (resolved.ok ? npcBodyRequest(resolved.visual, itemSource) : null),
    [resolved, itemSource],
  );
  const requestKey = body ? JSON.stringify(body.request) : null;

  const [scene, setScene] = useState<NpcBodyScene | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'failed'>('idle');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    setScene(null);
    setState('idle');
    if (!worldReady || requestKey === null) return;
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
  }, [worldReady, requestKey]);

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
      {body && !worldReady && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }} data-testid="npc-preview-no-world">
          Open a world to see it: the game&apos;s meshes and textures are mounted with the world.
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
            width: '100%', maxWidth: 320, aspectRatio: '1 / 1', display: 'block', marginTop: 4,
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
