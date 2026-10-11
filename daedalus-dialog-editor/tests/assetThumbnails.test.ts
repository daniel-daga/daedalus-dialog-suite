/**
 * The thumbnail queue (level-editor.md §16.26 row 1): what a grid tile asks
 * when it comes on screen. Cache first; on a miss the visual is extracted,
 * drawn and the PNG put back under the key the cache answered — one at a
 * time, in the background, so a directory of 300 files never blocks the
 * panel and never extracts 300 meshes at once.
 *
 * @jest-environment jsdom
 */

import { AssetThumbnails, type ThumbnailDeps } from '../src/renderer/world/assetThumbnails';
import type { VisualScene } from '../src/shared/worldTypes';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const VISUAL = { name: 'NW_CRATE.MRM', source: 'NW_CRATE.MRM', groups: [], bounds: [0, 0, 0, 1, 1, 1], triangleCount: 0 } as VisualScene;

function deps(overrides: Partial<ThumbnailDeps> = {}) {
  const d: ThumbnailDeps = {
    getThumbnail: jest.fn(async (name: string) => ({ key: `key-${name}`, dataUrl: null })),
    putThumbnail: jest.fn(async () => undefined),
    loadVisual: jest.fn(async () => VISUAL),
    loadTexture: jest.fn(async () => ({ name: 'X', width: 1, height: 1, rgba: new ArrayBuffer(4) })),
    renderer: {
      renderVisual: jest.fn(async () => PNG),
      renderTexture: jest.fn(() => PNG),
      dispose: jest.fn(),
    },
    ...overrides,
  };
  return d;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('AssetThumbnails', () => {
  it('serves a cached thumbnail without extracting or drawing anything', async () => {
    const d = deps({ getThumbnail: jest.fn(async () => ({ key: 'k', dataUrl: PNG })) });
    const thumbnails = new AssetThumbnails(d);
    const changed = jest.fn();
    thumbnails.subscribe(changed);

    thumbnails.request('NW_CRATE.MRM');
    expect(thumbnails.get('NW_CRATE.MRM')).toEqual({ status: 'pending' });
    await settle();

    expect(thumbnails.get('NW_CRATE.MRM')).toEqual({ status: 'ready', dataUrl: PNG });
    expect(d.loadVisual).not.toHaveBeenCalled();
    expect(d.renderer.renderVisual).not.toHaveBeenCalled();
    expect(d.putThumbnail).not.toHaveBeenCalled();
    expect(changed).toHaveBeenCalled();
  });

  it('draws a missing mesh thumbnail and puts it back under the key the cache answered', async () => {
    const d = deps();
    const thumbnails = new AssetThumbnails(d);

    thumbnails.request('NW_CRATE.MRM');
    await settle();

    expect(d.loadVisual).toHaveBeenCalledWith('NW_CRATE.MRM');
    expect(d.renderer.renderVisual).toHaveBeenCalledWith(VISUAL, d.loadTexture);
    expect(d.putThumbnail).toHaveBeenCalledWith('key-NW_CRATE.MRM', PNG);
    expect(thumbnails.get('NW_CRATE.MRM')).toEqual({ status: 'ready', dataUrl: PNG });
  });

  it('draws a texture through the 2D path, at the tile size', async () => {
    const d = deps();
    const thumbnails = new AssetThumbnails(d);

    thumbnails.request('NW_WOOD-C.TEX');
    await settle();

    expect(d.loadTexture).toHaveBeenCalledWith('NW_WOOD-C.TEX', expect.any(Number));
    expect(d.loadVisual).not.toHaveBeenCalled();
    expect(d.renderer.renderTexture).toHaveBeenCalled();
    expect(thumbnails.get('NW_WOOD-C.TEX')).toEqual({ status: 'ready', dataUrl: PNG });
  });

  it('marks a name the binding cannot extract as failed, and never asks again', async () => {
    const d = deps({ loadVisual: jest.fn(async () => null) });
    const thumbnails = new AssetThumbnails(d);

    thumbnails.request('BROKEN.MRM');
    await settle();
    thumbnails.request('BROKEN.MRM');
    await settle();

    expect(thumbnails.get('BROKEN.MRM')).toEqual({ status: 'failed' });
    expect(d.loadVisual).toHaveBeenCalledTimes(1);
    expect(d.putThumbnail).not.toHaveBeenCalled();
  });

  it('is not a thumbnail at all for a file that is neither mesh nor texture', async () => {
    const d = deps();
    const thumbnails = new AssetThumbnails(d);
    thumbnails.request('SCRIPT.MDS.TXT');
    await settle();
    expect(thumbnails.get('SCRIPT.MDS.TXT')).toEqual({ status: 'failed' });
    expect(d.getThumbnail).not.toHaveBeenCalled();
  });

  it('draws one at a time, in request order', async () => {
    let release: () => void = () => {};
    const d = deps({
      renderer: {
        renderVisual: jest.fn(() => new Promise<string>((resolve) => { release = () => resolve(PNG); })),
        renderTexture: jest.fn(() => PNG),
        dispose: jest.fn(),
      },
    });
    const thumbnails = new AssetThumbnails(d);

    thumbnails.request('A.MRM');
    thumbnails.request('B.MRM');
    await settle();

    expect(d.renderer.renderVisual).toHaveBeenCalledTimes(1);
    release();
    await settle();
    expect(d.renderer.renderVisual).toHaveBeenCalledTimes(2);
    expect((d.renderer.renderVisual as jest.Mock).mock.calls.map(() => 0)).toHaveLength(2);
    expect(d.loadVisual).toHaveBeenNthCalledWith(1, 'A.MRM');
    expect(d.loadVisual).toHaveBeenNthCalledWith(2, 'B.MRM');
  });

  it('drops what has not started yet when the listing moves on', async () => {
    let release: () => void = () => {};
    const d = deps({
      renderer: {
        renderVisual: jest.fn(() => new Promise<string>((resolve) => { release = () => resolve(PNG); })),
        renderTexture: jest.fn(() => PNG),
        dispose: jest.fn(),
      },
    });
    const thumbnails = new AssetThumbnails(d);
    thumbnails.request('A.MRM');
    thumbnails.request('B.MRM');
    await settle();

    thumbnails.cancelPending();
    release();
    await settle();

    expect(d.loadVisual).toHaveBeenCalledTimes(1);
    expect(thumbnails.get('A.MRM')).toEqual({ status: 'ready', dataUrl: PNG });
    // Forgotten, not failed: asking again draws it.
    expect(thumbnails.get('B.MRM')).toBeUndefined();
  });

  it('redraws on demand, bypassing what the cache holds', async () => {
    const d = deps({ getThumbnail: jest.fn(async () => ({ key: 'k', dataUrl: PNG })) });
    const thumbnails = new AssetThumbnails(d);
    thumbnails.request('NW_CRATE.MRM');
    await settle();

    thumbnails.redraw('NW_CRATE.MRM');
    await settle();

    expect(d.renderer.renderVisual).toHaveBeenCalledTimes(1);
    expect(d.putThumbnail).toHaveBeenCalledWith('k', PNG);
  });
});
