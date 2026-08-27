import React, { useEffect, useRef, useState } from 'react';
import { Box, Typography } from '@mui/material';
import type { DecodedTexture } from '../../../shared/worldTypes';

// What a mounted asset looks like (level-editor.md §6).
//
// Phase 1a can honestly show one kind: a texture. `decodeTexture` already
// returns RGBA8 through ZenKit's own ZTEX decoder, so the renderer never sees
// DXT and a canvas is the whole of the work. A mesh would need a second
// three.js context beside the world viewport, which is Phase 2's problem —
// until then it is named and typed rather than faked.
//
// The lookup is by **name**, not by the path the browser walked: the VFS
// resolves a name across the whole mounted namespace, and handing it a path
// resolves nothing.

const NAME_OF = (path: string) => path.slice(path.lastIndexOf('/') + 1);
const DIRECTORY_OF = (path: string) => {
  const at = path.lastIndexOf('/');
  return at <= 0 ? '/' : path.slice(0, at);
};

export interface WorldAssetPreviewProps {
  /** Full path inside the mounted namespace. */
  path: string;
  loadTexture: (name: string, maxSize: number) => Promise<DecodedTexture | null>;
}

const PREVIEW_MAX_SIZE = 256;

const WorldAssetPreview: React.FC<WorldAssetPreviewProps> = ({ path, loadTexture }) => {
  const name = NAME_OF(path);
  const isTexture = name.toUpperCase().endsWith('.TEX');

  const [decoded, setDecoded] = useState<DecodedTexture | null>(null);
  const [failed, setFailed] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    setDecoded(null);
    setFailed(false);
    if (!isTexture) return;

    let current = true;
    void loadTexture(name, PREVIEW_MAX_SIZE)
      .then((texture) => {
        if (!current) return;
        if (texture === null) setFailed(true);
        else setDecoded(texture);
      })
      .catch(() => { if (current) setFailed(true); });
    return () => { current = false; };
  }, [name, isTexture, loadTexture]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || decoded === null) return;
    const context = canvas.getContext('2d');
    if (context === null) return;
    context.putImageData(
      new ImageData(new Uint8ClampedArray(decoded.rgba), decoded.width, decoded.height), 0, 0,
    );
  }, [decoded]);

  return (
    <Box sx={{ p: 1.5, overflowY: 'auto', height: '100%' }}>
      <Typography variant="caption" sx={{ display: 'block', fontWeight: 600 }} data-testid="world-asset-preview-name">
        {name}
      </Typography>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: 'block', mb: 1.5, wordBreak: 'break-all' }}
        data-testid="world-asset-preview-path"
      >
        {DIRECTORY_OF(path)}
      </Typography>

      {decoded !== null && (
        <>
          {/* A plain <canvas>, not a MUI Box: `width`/`height` are MUI system
              props and would become CSS instead of the canvas's own pixel
              dimensions, leaving a default 300x150 buffer for putImageData to
              draw a 256px texture into. */}
          <canvas
            ref={canvasRef}
            width={decoded.width}
            height={decoded.height}
            data-testid="world-asset-preview-image"
            style={{
              width: '100%', maxWidth: 256, height: 'auto',
              // Nearest, because a Gothic texture is 256px era and smoothing it
              // shows the viewer something the game never draws.
              imageRendering: 'pixelated',
              border: '1px solid rgba(128,128,128,0.4)',
            }}
          />
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block', mt: 0.5 }}
            data-testid="world-asset-preview-size"
          >
            {decoded.width} × {decoded.height} — decoded at most {PREVIEW_MAX_SIZE}px
          </Typography>
        </>
      )}

      {failed && (
        <Typography variant="caption" color="error" data-testid="world-asset-preview-failed">
          This texture did not decode.
        </Typography>
      )}

      {!isTexture && (
        <Typography
          variant="caption"
          color="text.secondary"
          data-testid="world-asset-preview-unsupported"
        >
          Phase 1a previews textures only. Meshes are drawn where they are placed,
          in the viewport.
        </Typography>
      )}
    </Box>
  );
};

export default WorldAssetPreview;
