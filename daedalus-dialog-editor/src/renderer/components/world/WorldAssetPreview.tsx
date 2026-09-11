import React, { useEffect, useRef, useState } from 'react';
import { Box, Button, CircularProgress, Stack, Tooltip, Typography } from '@mui/material';
import * as THREE from 'three';
import type { DecodedTexture, VisualScene } from '../../../shared/worldTypes';
import { buildVisualPreview, frameVisual } from '../../world/VisualPreviewScene';

// What a mounted asset looks like (level-editor.md §6, §16.26 row 1).
//
// A texture: `decodeTexture` already returns RGBA8 through ZenKit's own ZTEX
// decoder, so the renderer never sees DXT and a 2D canvas is the whole of the
// work. A mesh: `extractVisual`'s draw groups — the same buffers `buildScene`
// turns into the world's own geometry — in a small Three.js scene of its own,
// framed to the visual's bounds and orbitable. Anything else is named rather
// than faked.
//
// The lookup is by **name**, not by the path the browser walked: the VFS
// resolves a name across the whole mounted namespace, and handing it a path
// resolves nothing.

/** The bare file name — what a VOB's `visual` stores. Retail says
 *  `NW_CRATE.3DS`, never a directory: the engine resolves the name across the
 *  whole mounted namespace, exactly as the lookup below does. */
export const NAME_OF = (path: string) => path.slice(path.lastIndexOf('/') + 1);
const DIRECTORY_OF = (path: string) => {
  const at = path.lastIndexOf('/');
  return at <= 0 ? '/' : path.slice(0, at);
};

/** Every extension `extractVisual` resolves (zenkit-node README, "The asset
 *  layer"): the compiled files the browser lists, and the source names a VOB
 *  carries. A `.MDH` alone is a hierarchy with no geometry and is not one. */
const MESH_EXTENSIONS = ['.MRM', '.MSH', '.MMB', '.MDM', '.MDL', '.3DS', '.ASC', '.MDS', '.MMS'];

type AssetKind = 'texture' | 'mesh' | 'other';

/** Whether `name` is a visual the binding can place on a VOB. */
export function isPlaceableVisual(name: string): boolean {
  const upper = name.toUpperCase();
  return MESH_EXTENSIONS.some((extension) => upper.endsWith(extension));
}

function kindOf(name: string): AssetKind {
  if (name.toUpperCase().endsWith('.TEX')) return 'texture';
  if (isPlaceableVisual(name)) return 'mesh';
  return 'other';
}

export interface WorldAssetPreviewProps {
  /** Full path inside the mounted namespace. */
  path: string;
  loadTexture: (name: string, maxSize: number) => Promise<DecodedTexture | null>;
  /** The visual's merged draw groups, or null for a name the binding cannot extract. */
  loadVisual: (name: string) => Promise<VisualScene | null>;
  /** How many VOBs are selected — what "Use as visual" would write to. */
  selectionCount?: number;
  /** Hand the previewed mesh's bare name back as the selection's visual
   *  (§16.26 row 1). Absent, the panel is a viewer and offers no button. */
  onUseAsVisual?: (name: string) => void;
  /** Arm a placement of the previewed mesh (level-editor.md §17, "Adding
   *  things"): the next ground click places a `zCVob` carrying it, with no
   *  dialog in between. */
  onPlace?: (name: string) => void;
}

const PREVIEW_MAX_SIZE = 256;
/** The mesh canvas's fallback edge, for a host that has no layout yet. */
const MESH_CANVAS_FALLBACK = 256;

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

const WorldAssetPreview: React.FC<WorldAssetPreviewProps> = ({
  path, loadTexture, loadVisual, selectionCount = 0, onUseAsVisual, onPlace,
}) => {
  const name = NAME_OF(path);
  const kind = kindOf(name);

  const [decoded, setDecoded] = useState<DecodedTexture | null>(null);
  const [visual, setVisual] = useState<VisualScene | null>(null);
  const [failed, setFailed] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const meshCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    setDecoded(null);
    setVisual(null);
    setFailed(false);
    if (kind === 'other') return;

    let current = true;
    const request: Promise<DecodedTexture | VisualScene | null> = kind === 'texture'
      ? loadTexture(name, PREVIEW_MAX_SIZE)
      : loadVisual(name);
    void request
      .then((result) => {
        if (!current) return;
        if (result === null) setFailed(true);
        else if (kind === 'texture') setDecoded(result as DecodedTexture);
        else setVisual(result as VisualScene);
      })
      .catch(() => { if (current) setFailed(true); });
    return () => { current = false; };
  }, [name, kind, loadTexture, loadVisual]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || decoded === null) return;
    const context = canvas.getContext('2d');
    if (context === null) return;
    context.putImageData(
      new ImageData(new Uint8ClampedArray(decoded.rgba), decoded.width, decoded.height), 0, 0,
    );
  }, [decoded]);

  // The mesh scene lives exactly as long as the visual it shows. Textures are
  // fetched after the first frame — an untextured crate at once beats a blank
  // panel until every map has decoded — and each arrival marks a frame dirty.
  useEffect(() => {
    const canvas = meshCanvasRef.current;
    if (canvas === null || visual === null) return;

    let current = true;
    let teardown: (() => void) | null = null;
    // Loaded on demand: `WorldSurface` imports this component statically, and
    // a static `three/examples/jsm` import would drag the ESM controls into
    // every suite that renders the surface — the viewport keeps them out the
    // same way, by never being loaded until a world is.
    void import('three/examples/jsm/controls/OrbitControls.js').then(({ OrbitControls }) => {
    if (!current) return;
    const preview = buildVisualPreview(visual);
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.setClearColor(0x2b2b2b, 1);
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    const controls = new OrbitControls(camera, canvas);
    // Kept on, decided 2026-09-11 (#234) — the viewport turned its own damping
    // off (#228) and this did not follow. That one is a level, where a coasting
    // camera reads as lag and neither Spacer nor Blender coasts; this is one
    // small object in a thumbnail, where the coast is the feel of spinning it.
    // The draw loop below is gated on `controls.update()` having work to do,
    // and its comment names the damping as half of what that work is — so the
    // flag is not the only line an answer the other way would touch.
    controls.enableDamping = true;
    controls.target.copy(frameVisual(camera, visual.bounds));
    controls.update();

    let dirty = true;
    let frame = 0;

    const size = () => {
      const edge = canvas.clientWidth || MESH_CANVAS_FALLBACK;
      renderer.setSize(edge, edge, false);
      dirty = true;
    };
    size();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(size);
    observer?.observe(canvas);

    const draw = () => {
      if (!current) return;
      // `update` is true only while the orbit is moving or damping out, so an
      // idle preview costs no draw.
      if (controls.update() || dirty) {
        dirty = false;
        renderer.render(preview.scene, camera);
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);

    for (const textureName of preview.pendingTextureNames()) {
      void loadTexture(textureName, PREVIEW_MAX_SIZE)
        .then((texture) => {
          if (!current || texture === null) return;
          preview.applyTexture(texture);
          dirty = true;
        })
        .catch(() => { /* an undecodable map leaves that material white */ });
    }

    teardown = () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      controls.dispose();
      preview.dispose();
      renderer.dispose();
    };
    });

    return () => {
      current = false;
      teardown?.();
    };
  }, [visual, loadTexture]);

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

      {/* The two things a previewed mesh can become. Both offered for any
          mesh name, resolved or not: the writes go through the same paths the
          property grid's visual field and the place dialog use, which refit
          the box only when the name resolves and otherwise leave it alone. */}
      {kind === 'mesh' && (
        <Stack direction="row" spacing={1} sx={{ mb: 1.5 }}>
          {onPlace !== undefined && (
            <Tooltip title="Then click the ground where it goes">
              <Button
                size="small"
                variant="contained"
                onClick={() => onPlace(name)}
                data-testid="world-asset-place"
              >
                Place in world
              </Button>
            </Tooltip>
          )}
          {onUseAsVisual !== undefined && (
            <Tooltip
              title={selectionCount === 0 ? 'Select a VOB first' : ''}
              data-testid="world-asset-use-visual-reason"
            >
              {/* A span, because a disabled button reports no pointer events and
                  MUI's tooltip needs one to attach to. */}
              <span>
                <Button
                  size="small"
                  variant="outlined"
                  disabled={selectionCount === 0}
                  onClick={() => onUseAsVisual(name)}
                  data-testid="world-asset-use-visual"
                >
                  Use as visual{selectionCount > 1 ? ` (${selectionCount} VOBs)` : ''}
                </Button>
              </span>
            </Tooltip>
          )}
        </Stack>
      )}

      {visual !== null && (
        <>
          <canvas
            ref={meshCanvasRef}
            data-testid="world-asset-preview-mesh"
            style={{
              width: '100%', maxWidth: 320, aspectRatio: '1 / 1', display: 'block',
              border: '1px solid rgba(128,128,128,0.4)',
              touchAction: 'none',
            }}
          />
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block', mt: 0.5 }}
            data-testid="world-asset-preview-mesh-stats"
          >
            {plural(visual.triangleCount, 'triangle')} · {plural(visual.groups.length, 'draw group')}
            {visual.source.toUpperCase() !== name.toUpperCase() && ` · resolved to ${visual.source}`}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            Drag to orbit, wheel to zoom, right-drag to pan.
          </Typography>
        </>
      )}

      {/* A large `.MDL` is re-extracted on every click (§16.26), so this wait is
          seconds rather than a flicker — and the panel used to show a name, a
          path and nothing else for all of it, which reads exactly like a mesh
          that resolved to nothing (§5.4 item 17 of the 2026-09-04 review). */}
      {kind !== 'other' && !failed && decoded === null && visual === null && (
        <Stack direction="row" spacing={1} alignItems="center" data-testid="world-asset-preview-loading">
          <CircularProgress size={14} />
          <Typography variant="caption" color="text.secondary">
            {kind === 'texture' ? 'Decoding…' : 'Extracting…'}
          </Typography>
        </Stack>
      )}

      {failed && (
        <Typography variant="caption" color="error" data-testid="world-asset-preview-failed">
          {kind === 'texture'
            ? 'This texture did not decode.'
            : 'This visual could not be extracted — the binding resolves no geometry for it.'}
        </Typography>
      )}

      {kind === 'other' && (
        <Typography
          variant="caption"
          color="text.secondary"
          data-testid="world-asset-preview-unsupported"
        >
          Textures and meshes are previewed; this file is neither.
        </Typography>
      )}
    </Box>
  );
};

export default WorldAssetPreview;
