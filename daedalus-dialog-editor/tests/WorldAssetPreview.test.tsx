/**
 * The asset preview (level-editor.md §6).
 *
 * The one thing Phase 1a can actually show for a mounted asset without a second
 * renderer is a texture, because `decodeTexture` already returns RGBA8 through
 * ZenKit's own ZTEX decoder — the renderer never sees DXT. Everything else is
 * named and typed honestly rather than faked.
 *
 * @jest-environment jsdom
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import type { DecodedTexture } from '../src/shared/worldTypes';
import WorldAssetPreview from '../src/renderer/components/world/WorldAssetPreview';

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
    render(<WorldAssetPreview path="Meshes/_compiled/NW_CRATE.MRM" loadTexture={load} />);

    expect(screen.getByTestId('world-asset-preview-name')).toHaveTextContent('NW_CRATE.MRM');
    expect(screen.getByTestId('world-asset-preview-path')).toHaveTextContent('Meshes/_compiled');
  });

  it('decodes and draws a texture, asking for it by name rather than by path', async () => {
    // `decodeTexture` resolves through the VFS by name — the namespace is flat
    // for lookup, and handing it a path would resolve nothing.
    const load = jest.fn(async () => texture('NW_WOOD-C.TEX'));
    render(<WorldAssetPreview path="Textures/_compiled/NW_WOOD-C.TEX" loadTexture={load} />);

    await waitFor(() => expect(load).toHaveBeenCalledWith('NW_WOOD-C.TEX', 256));
    const canvas = await screen.findByTestId('world-asset-preview-image');
    expect(canvas).toHaveAttribute('width', '2');
    expect(canvas).toHaveAttribute('height', '2');
    expect(screen.getByTestId('world-asset-preview-size')).toHaveTextContent('2 × 2');
  });

  it('does not try to decode something that is not a texture', async () => {
    const load = jest.fn(async () => null);
    render(<WorldAssetPreview path="Meshes/_compiled/NW_CRATE.MRM" loadTexture={load} />);

    await screen.findByTestId('world-asset-preview-unsupported');
    expect(load).not.toHaveBeenCalled();
  });

  it('says so when a texture will not decode, instead of showing a blank frame', async () => {
    const load = jest.fn(async () => null);
    render(<WorldAssetPreview path="Textures/BROKEN-C.TEX" loadTexture={load} />);

    await screen.findByTestId('world-asset-preview-failed');
    expect(screen.queryByTestId('world-asset-preview-image')).not.toBeInTheDocument();
  });
});
