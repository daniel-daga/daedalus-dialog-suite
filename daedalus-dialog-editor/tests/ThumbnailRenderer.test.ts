/**
 * The offscreen thumbnail render (level-editor.md §16.26 row 1): the Assets
 * panel's own preview scene (`VisualPreviewScene`) drawn once into a small
 * canvas and read back as a PNG. jsdom has no GL, so the WebGL renderer is
 * the viewport suites' canvas-backed stand-in and what is checked is the
 * scene graph it was handed and the order things happen in — the pixels want
 * a human eye.
 *
 * @jest-environment jsdom
 */

import * as THREE from 'three';
import type { DecodedTexture, DrawGroup, VisualScene } from '../src/shared/worldTypes';
import { THUMBNAIL_SIZE, ThumbnailRenderer } from '../src/renderer/world/ThumbnailRenderer';

// A `require` in the factory: `three` is imported at the top of this file, so
// the hoisted factory runs before a module-level import binding would exist.
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('three', () => require('./worldViewportMocks').mockThree());

function group(overrides: Partial<DrawGroup> = {}): DrawGroup {
  return {
    texture: 'NW_WOOD.TGA', color: [255, 255, 255, 255], alphaFunc: 0, texAniMapMode: 0, texAniFps: 0,
    texAniMapDir: [0, 0], envMapping: false, envMappingStrength: 0, waveMode: 0, waveSpeed: 0,
    waveMaxAmplitude: 0, waveGridSize: 0, ignoreSun: false, disableLightmap: false, materials: 1,
    vertexCount: 3, triangleCount: 1,
    positions: new Float32Array([0, 0, 0, 100, 0, 0, 0, 100, 0]).buffer,
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]).buffer,
    uvs: new Float32Array([0, 0, 1, 0, 0, 1]).buffer,
    indices: new Uint32Array([0, 1, 2]).buffer,
    lights: null,
    ...overrides,
  };
}

const VISUAL: VisualScene = {
  name: 'NW_CRATE.MRM', source: 'NW_CRATE.MRM', groups: [group()], bounds: [0, 0, 0, 200, 100, 50], triangleCount: 1,
};
const WOOD: DecodedTexture = { name: 'NW_WOOD.TGA', width: 1, height: 1, rgba: new Uint8Array([1, 2, 3, 255]).buffer };
const PNG = 'data:image/png;base64,iVBORw0KGgo=';

describe('ThumbnailRenderer', () => {
  let toDataURL: jest.SpyInstance;
  beforeEach(() => {
    toDataURL = jest.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(PNG);
  });
  afterEach(() => toDataURL.mockRestore());

  it('draws the preview scene once, framed on the bounds, and answers the canvas as a PNG', async () => {
    const renderer = new ThumbnailRenderer();
    // Counted at draw time: the scene is disposed once the PNG is read.
    const meshes: THREE.Mesh[] = [];
    const render = jest.spyOn(THREE.WebGLRenderer.prototype, 'render').mockImplementation((scene) => {
      (scene as THREE.Scene).traverse((object) => { if ((object as THREE.Mesh).isMesh) meshes.push(object as THREE.Mesh); });
    });

    await expect(renderer.renderVisual(VISUAL, async () => null)).resolves.toBe(PNG);

    expect(render).toHaveBeenCalledTimes(1);
    const [scene, camera] = render.mock.calls[0] as [THREE.Scene, THREE.PerspectiveCamera];
    // The preview scene: one mesh per draw group under the world's root matrix,
    // lit — not a second renderer's idea of the crate.
    expect(meshes).toHaveLength(1);
    expect(scene.children.some((o) => (o as THREE.Light).isLight)).toBe(true);
    // Framed on the bounds in Three.js space (X mirrored): the camera looks at
    // the box's centre from a finite distance.
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    const centre = new THREE.Vector3(-1, 0.5, 0.25);
    expect(forward.dot(centre.clone().sub(camera.position).normalize())).toBeCloseTo(1);
    expect(toDataURL).toHaveBeenCalledWith('image/png');
    expect(renderer.canvas.width).toBe(THUMBNAIL_SIZE);
    render.mockRestore();
  });

  it("fetches the visual's textures and applies them before the one draw", async () => {
    const renderer = new ThumbnailRenderer();
    const applied: boolean[] = [];
    const render = jest.spyOn(THREE.WebGLRenderer.prototype, 'render').mockImplementation((scene) => {
      (scene as THREE.Scene).traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (mesh.isMesh) applied.push((mesh.material as THREE.MeshLambertMaterial).map !== null);
      });
    });
    const loadTexture = jest.fn(async () => WOOD);

    await renderer.renderVisual(VISUAL, loadTexture);

    expect(loadTexture).toHaveBeenCalledWith('NW_WOOD.TGA', expect.any(Number));
    expect(applied).toEqual([true]);
    render.mockRestore();
  });

  it('still draws when a texture cannot be decoded, rather than failing the thumbnail', async () => {
    const renderer = new ThumbnailRenderer();
    await expect(renderer.renderVisual(VISUAL, async () => { throw new Error('undecodable'); })).resolves.toBe(PNG);
  });

  it('draws a decoded texture to a 2D canvas, scaled into the tile', () => {
    // jsdom has no ImageData; the preview component draws through the same
    // constructor and its spec never reaches the draw.
    (globalThis as { ImageData?: unknown }).ImageData = class { constructor(public data: Uint8ClampedArray, public width: number, public height: number) {} };
    const putImageData = jest.fn();
    const drawImage = jest.fn();
    const getContext = jest.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockImplementation(() => ({ putImageData, drawImage, imageSmoothingEnabled: true }) as unknown as CanvasRenderingContext2D);
    const renderer = new ThumbnailRenderer();

    expect(renderer.renderTexture({ ...WOOD, width: 2, height: 2, rgba: new Uint8Array(16).buffer })).toBe(PNG);

    expect(putImageData).toHaveBeenCalledTimes(1);
    expect(drawImage).toHaveBeenCalledWith(expect.any(HTMLCanvasElement), 0, 0, THUMBNAIL_SIZE, THUMBNAIL_SIZE);
    getContext.mockRestore();
  });
});
