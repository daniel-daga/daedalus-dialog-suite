/**
 * The asset preview (level-editor.md §6, §16.26 row 1).
 *
 * A texture is drawn to a 2D canvas, because `decodeTexture` already returns
 * RGBA8 through ZenKit's own ZTEX decoder. A mesh is drawn by a small Three.js
 * scene of its own — `extractVisual`'s draw groups, the same ones the world
 * places — and jsdom has no WebGL, so the renderer is the stand-in every
 * viewport spec uses and the assertions are about what was asked for and what
 * was built.
 *
 * @jest-environment jsdom
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { DecodedTexture, VisualScene } from '../src/shared/worldTypes';
import * as mockWorldViewport from './worldViewportMocks';
import WorldAssetPreview from '../src/renderer/components/world/WorldAssetPreview';

jest.mock('three', () => mockWorldViewport.mockThree());
jest.mock('three/examples/jsm/controls/OrbitControls.js', () => mockWorldViewport.mockOrbitControls());

function crate(): VisualScene {
  return {
    name: 'NW_CRATE.MRM',
    source: 'NW_CRATE.MRM',
    bounds: [0, 0, 0, 100, 100, 100],
    triangleCount: 1,
    groups: [{
      texture: 'NW_WOOD.TGA',
      color: [255, 255, 255, 255],
      alphaFunc: 0, texAniMapMode: 0, texAniFps: 0, texAniMapDir: [0, 0],
      envMapping: false, envMappingStrength: 0,
      waveMode: 0, waveSpeed: 0, waveMaxAmplitude: 0, waveGridSize: 0,
      ignoreSun: false, disableLightmap: false,
      materials: 1, vertexCount: 3, triangleCount: 1,
      positions: new Float32Array([0, 0, 0, 100, 0, 0, 0, 100, 0]).buffer,
      normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]).buffer,
      uvs: new Float32Array([0, 0, 1, 0, 0, 1]).buffer,
      indices: new Uint32Array([0, 1, 2]).buffer,
      lights: null,
    }],
  };
}

const noVisual = async () => null;

function texture(name: string): DecodedTexture {
  return {
    name,
    width: 2,
    height: 2,
    rgba: new Uint8Array([
      255, 0, 0, 255, 0, 255, 0, 255,
      0, 0, 255, 255, 255, 255, 255, 255,
    ]).buffer,
  };
}

describe('WorldAssetPreview', () => {
  it('shows the asset it was given, by its compiled name', () => {
    // The VFS holds what the asset compiler produced, not what a VOB names.
    const load = jest.fn(async () => null);
    render(<WorldAssetPreview path="Meshes/_compiled/NW_CRATE.MRM" loadTexture={load} loadVisual={noVisual} />);

    expect(screen.getByTestId('world-asset-preview-name')).toHaveTextContent('NW_CRATE.MRM');
    expect(screen.getByTestId('world-asset-preview-path')).toHaveTextContent('Meshes/_compiled');
  });

  it('decodes and draws a texture, asking for it by name rather than by path', async () => {
    // `decodeTexture` resolves through the VFS by name — the namespace is flat
    // for lookup, and handing it a path would resolve nothing.
    const load = jest.fn(async () => texture('NW_WOOD-C.TEX'));
    render(<WorldAssetPreview path="Textures/_compiled/NW_WOOD-C.TEX" loadTexture={load} loadVisual={noVisual} />);

    await waitFor(() => expect(load).toHaveBeenCalledWith('NW_WOOD-C.TEX', 256));
    const canvas = await screen.findByTestId('world-asset-preview-image');
    expect(canvas).toHaveAttribute('width', '2');
    expect(canvas).toHaveAttribute('height', '2');
    expect(screen.getByTestId('world-asset-preview-size')).toHaveTextContent('2 × 2');
  });

  it('does not try to decode a mesh as a texture, nor a texture as a mesh', async () => {
    const load = jest.fn(async () => null);
    const loadVisual = jest.fn(async () => null);
    render(<WorldAssetPreview path="Meshes/_compiled/NW_CRATE.MRM" loadTexture={load} loadVisual={loadVisual} />);
    await screen.findByTestId('world-asset-preview-failed');
    expect(load).not.toHaveBeenCalled();

    render(<WorldAssetPreview path="Textures/_compiled/NW_WOOD-C.TEX" loadTexture={load} loadVisual={loadVisual} />);
    await waitFor(() => expect(load).toHaveBeenCalled());
    expect(loadVisual).toHaveBeenCalledTimes(1);
  });

  it('says so for a file that is neither', async () => {
    const load = jest.fn(async () => null);
    const loadVisual = jest.fn(async () => null);
    render(<WorldAssetPreview path="Anims/_compiled/HUMANS.MDH" loadTexture={load} loadVisual={loadVisual} />);

    await screen.findByTestId('world-asset-preview-unsupported');
    expect(load).not.toHaveBeenCalled();
    expect(loadVisual).not.toHaveBeenCalled();
  });

  it.each(['NW_CRATE.MRM', 'CHEST.MDL', 'STOVE.MDM', 'BARREL.3DS', 'HEAD.MMB', 'FIRE.MMS', 'LEVEL.MSH'])(
    'asks for the visual %s by name and draws it on its own canvas', async (name) => {
      // Every extension `extractVisual` resolves — compiled and source alike;
      // the browser lists compiled names, a VOB names source ones.
      const loadVisual = jest.fn(async () => ({ ...crate(), name, source: name }));
      const load = jest.fn(async () => null);
      render(<WorldAssetPreview path={`Meshes/_compiled/${name}`} loadTexture={load} loadVisual={loadVisual} />);

      await waitFor(() => expect(loadVisual).toHaveBeenCalledWith(name));
      const canvas = await screen.findByTestId('world-asset-preview-mesh');
      expect(canvas.tagName).toBe('CANVAS');
      expect(screen.getByTestId('world-asset-preview-mesh-stats')).toHaveTextContent('1 triangle');
      expect(screen.getByTestId('world-asset-preview-mesh-stats')).toHaveTextContent('1 draw group');
    },
  );

  it('textures the mesh the way the world would, asking for each map by name', async () => {
    const loadVisual = jest.fn(async () => crate());
    const load = jest.fn(async () => texture('NW_WOOD.TGA'));
    render(<WorldAssetPreview path="Meshes/_compiled/NW_CRATE.MRM" loadTexture={load} loadVisual={loadVisual} />);

    await waitFor(() => expect(load).toHaveBeenCalledWith('NW_WOOD.TGA', 256));
  });

  it('shows the source a name resolved to when it differs', async () => {
    const loadVisual = jest.fn(async () => ({ ...crate(), name: 'NW_CRATE.3DS', source: 'NW_CRATE.MRM' }));
    render(<WorldAssetPreview path="Meshes/NW_CRATE.3DS" loadTexture={noVisual} loadVisual={loadVisual} />);

    await screen.findByTestId('world-asset-preview-mesh');
    expect(screen.getByTestId('world-asset-preview-mesh-stats')).toHaveTextContent('NW_CRATE.MRM');
  });

  it('says so when the binding cannot extract a visual', async () => {
    const loadVisual = jest.fn(async () => null);
    render(<WorldAssetPreview path="Meshes/_compiled/BROKEN.MRM" loadTexture={noVisual} loadVisual={loadVisual} />);

    const failed = await screen.findByTestId('world-asset-preview-failed');
    expect(failed).toHaveTextContent(/could not be extracted/i);
    expect(screen.queryByTestId('world-asset-preview-mesh')).not.toBeInTheDocument();
  });

  it('says so when extracting throws, rather than leaving a blank panel', async () => {
    const loadVisual = jest.fn(async () => { throw new Error('failed to extract visual'); });
    render(<WorldAssetPreview path="Meshes/_compiled/BROKEN.MRM" loadTexture={noVisual} loadVisual={loadVisual} />);

    await screen.findByTestId('world-asset-preview-failed');
  });

  it('ignores a visual that arrives after the selection moved on', async () => {
    let resolveFirst: (v: VisualScene | null) => void = () => {};
    const loadVisual = jest.fn((name: string) => name === 'SLOW.MRM'
      ? new Promise<VisualScene | null>((resolve) => { resolveFirst = resolve; })
      : Promise.resolve(null));
    const { rerender } = render(
      <WorldAssetPreview path="Meshes/SLOW.MRM" loadTexture={noVisual} loadVisual={loadVisual} />,
    );
    rerender(<WorldAssetPreview path="Meshes/GONE.MRM" loadTexture={noVisual} loadVisual={loadVisual} />);
    await screen.findByTestId('world-asset-preview-failed');

    resolveFirst({ ...crate(), name: 'SLOW.MRM' });
    await waitFor(() => expect(loadVisual).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId('world-asset-preview-mesh')).not.toBeInTheDocument();
  });

  it('says so when a texture will not decode, instead of showing a blank frame', async () => {
    const load = jest.fn(async () => null);
    render(<WorldAssetPreview path="Textures/BROKEN-C.TEX" loadTexture={load} loadVisual={noVisual} />);

    await screen.findByTestId('world-asset-preview-failed');
    expect(screen.queryByTestId('world-asset-preview-image')).not.toBeInTheDocument();
  });

  describe('as a picker (§16.26 row 1)', () => {
    it("offers a previewed mesh as the selection's visual, by its bare file name", async () => {
      // The name the world stores is the file name alone — retail says
      // `NW_CRATE.3DS`, never a directory — so the button hands back the last
      // path segment and nothing of where the browser found it.
      const onUseAsVisual = jest.fn();
      render(
        <WorldAssetPreview
          path="Meshes/_compiled/NW_CRATE.MRM"
          loadTexture={noVisual}
          loadVisual={async () => crate()}
          selectionCount={2}
          onUseAsVisual={onUseAsVisual}
        />,
      );

      const button = await screen.findByTestId('world-asset-use-visual');
      expect(button).toBeEnabled();
      fireEvent.click(button);
      expect(onUseAsVisual).toHaveBeenCalledWith('NW_CRATE.MRM');
    });

    it('is disabled, and says why, when no VOB is selected', async () => {
      render(
        <WorldAssetPreview
          path="Meshes/_compiled/NW_CRATE.MRM"
          loadTexture={noVisual}
          loadVisual={async () => crate()}
          selectionCount={0}
          onUseAsVisual={jest.fn()}
        />,
      );

      const button = await screen.findByTestId('world-asset-use-visual');
      expect(button).toBeDisabled();
      expect(screen.getByTestId('world-asset-use-visual-reason')).toHaveAttribute('aria-label', expect.stringMatching(/select/i));
    });

    it('offers nothing for a texture or an unsupported file — neither is a visual a VOB can carry', async () => {
      const { rerender } = render(
        <WorldAssetPreview
          path="Textures/_compiled/NW_WOOD-C.TEX"
          loadTexture={async () => texture('NW_WOOD-C.TEX')}
          loadVisual={noVisual}
          selectionCount={1}
          onUseAsVisual={jest.fn()}
        />,
      );
      await screen.findByTestId('world-asset-preview-image');
      expect(screen.queryByTestId('world-asset-use-visual')).not.toBeInTheDocument();

      rerender(
        <WorldAssetPreview
          path="Anims/_compiled/HUMANS.MDH"
          loadTexture={noVisual}
          loadVisual={noVisual}
          selectionCount={1}
          onUseAsVisual={jest.fn()}
        />,
      );
      await screen.findByTestId('world-asset-preview-unsupported');
      expect(screen.queryByTestId('world-asset-use-visual')).not.toBeInTheDocument();
    });
  });
});
