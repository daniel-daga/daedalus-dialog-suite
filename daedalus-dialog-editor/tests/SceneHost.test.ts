/**
 * The scene for one payload — `WorldScene`, its BVH trees and its picker —
 * lifted out of `WorldViewport`'s one big effect (#220, review §4).
 *
 * Everything here was a closure inside that effect, so the rules below could
 * only be reached by rendering the whole viewport with the renderer, the picker
 * and the BVH worker all stood in for. What they are actually about is the
 * boundary between what a structural op rebuilds and what survives it:
 *
 *   - the scene, the trees and the picker are per payload;
 *   - the decoded pixels and the builder's memory of the trees are not, and a
 *     rebuild must ask for neither again;
 *   - and the root the whole world hangs under has to come back off the scene
 *     it was added to, or a second payload draws on top of the first.
 *
 * The GPU picker is stood in for: it has its own spec, and what is checked here
 * is that it is given both halves of the pick scene and warmed before any click
 * can reach it.
 *
 * @jest-environment jsdom
 */

import * as THREE from 'three';
import { describe, it, expect, beforeEach } from '@jest/globals';
import type {
  DecodedTexture, DrawGroup, InstancedPayload, InstancedVisual, WorldMeshPayload,
} from '../src/shared/worldTypes';
import { vobIndex } from './worldFixtures';

const worker = {
  onmessage: null as ((event: MessageEvent) => void) | null,
  terminate: jest.fn(),
  postMessage: jest.fn(),
};

jest.mock('../src/renderer/world/bvhWorker', () => ({
  createBvhWorker: () => worker,
}));

const pickerCalls = {
  instanced: [] as THREE.InstancedMesh[][],
  worldMeshes: [] as THREE.Mesh[][],
  warmed: 0,
  disposed: 0,
};

jest.mock('../src/renderer/world/VobPicker', () => ({
  VobPicker: class {
    setInstancedMeshes(meshes: THREE.InstancedMesh[]) { pickerCalls.instanced.push(meshes); }
    setWorldMeshes(meshes: THREE.Mesh[]) { pickerCalls.worldMeshes.push(meshes); }
    warm() { pickerCalls.warmed += 1; }
    dispose() { pickerCalls.disposed += 1; }
  },
}));

import { BvhBuilder } from '../src/renderer/world/BvhBuilder';
import { SceneHost, TEXTURE_MAX_SIZE } from '../src/renderer/world/SceneHost';
import { textureCacheFor } from '../src/renderer/world/WorldScene';

function group(overrides: Partial<DrawGroup> = {}): DrawGroup {
  return {
    texture: 'NW_WOOD.TGA',
    color: [255, 255, 255, 255],
    alphaFunc: 0,
    texAniMapMode: 0,
    texAniFps: 0,
    texAniMapDir: [0, 0],
    envMapping: false,
    envMappingStrength: 0,
    waveMode: 0,
    waveSpeed: 0,
    waveMaxAmplitude: 0,
    waveGridSize: 0,
    ignoreSun: false,
    disableLightmap: false,
    materials: 1,
    vertexCount: 3,
    triangleCount: 1,
    positions: new Float32Array([0, 0, 0, 100, 0, 0, 0, 100, 0]).buffer,
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]).buffer,
    uvs: new Float32Array([0, 0, 1, 0, 0, 1]).buffer,
    indices: new Uint32Array([0, 1, 2]).buffer,
    lights: null,
    ...overrides,
  };
}

function visual(overrides: Partial<InstancedVisual> = {}): InstancedVisual {
  return {
    name: 'BARREL.3DS',
    source: 'BARREL.MRM',
    count: 1,
    matrices: new Float32Array([1, 0, 0, 10, 0, 1, 0, 20, 0, 0, 1, 30]).buffer,
    vobIds: new Uint32Array([7]).buffer,
    groups: [group({ texture: 'BARREL.TGA' })],
    bounds: [0, 0, 0, 100, 100, 0],
    ...overrides,
  };
}

const meshPayload = (): WorldMeshPayload => ({ groups: [group()], bbox: [0, 0, 0, 100, 100, 0] });

const visualsPayload = (): InstancedPayload => ({
  visuals: [visual()],
  stats: {
    visualsSeen: 1,
    visualsResolved: 1,
    vobsPlaced: 1,
    instancedDrawGroups: 1,
    levelCompos: 0,
    unresolvedByType: {},
  },
});

/** One pixel, so a decode succeeds without any image data to speak of. */
const decoded = (name: string): DecodedTexture => ({
  name,
  width: 1,
  height: 1,
  rgba: new Uint8Array([255, 255, 255, 255]).buffer,
});

/** Answer every posted build with a tree the worker really could have made. */
function answerBuilds(): void {
  const posted = worker.postMessage.mock.calls.map((call) => call[0] as {
    id: number; position: ArrayBuffer; index: ArrayBuffer;
  });
  worker.postMessage.mockClear();
  const { MeshBVH } = jest.requireActual('three-mesh-bvh') as typeof import('three-mesh-bvh');
  for (const { id, position, index } of posted) {
    const source = new THREE.BufferGeometry();
    source.setAttribute('position', new THREE.BufferAttribute(new Float32Array(position), 3));
    source.setIndex(new THREE.BufferAttribute(new Uint32Array(index), 1));
    worker.onmessage?.({
      data: { id, serialized: MeshBVH.serialize(new MeshBVH(source)) },
    } as MessageEvent);
  }
}

function harness({
  mesh = meshPayload(),
  visuals = visualsPayload(),
  // One VOB with a visual, so the marker layer (§16.38) is empty: what this
  // spec is about is the rebuild boundary, and `WorldScene.test.ts` holds what
  // the scene does with a markerless VOB.
  index = vobIndex([[0, 0, 0]]),
  builder = new BvhBuilder(),
  textures = textureCacheFor(null, 'the-world'),
  load = async (name: string) => decoded(name),
} = {}) {
  const asked: Array<{ name: string; maxSize: number }> = [];
  const failures: string[][] = [];
  const scene = new THREE.Scene();

  const host = new SceneHost({
    scene,
    renderer: {} as THREE.WebGLRenderer,
    camera: new THREE.PerspectiveCamera(),
    mesh,
    visuals,
    vobIndex: index,
    textures,
    bvh: builder,
    loadTexture: (name, maxSize) => { asked.push({ name, maxSize }); return load(name); },
    onTextureFailures: (names) => { failures.push(names); },
  });

  return { host, scene, builder, textures, asked, failures };
}

describe('SceneHost — the scene one payload gets', () => {
  beforeEach(() => {
    worker.postMessage.mockClear();
    worker.terminate.mockClear();
    pickerCalls.instanced = [];
    pickerCalls.worldMeshes = [];
    pickerCalls.warmed = 0;
    pickerCalls.disposed = 0;
  });

  it('hangs the world under the scene it was given, and takes it back off on dispose', () => {
    const { host, scene } = harness();

    expect(scene.children).toContain(host.world.root);

    host.dispose();
    expect(scene.children).not.toContain(host.world.root);
  });

  it('gives the picker the world mesh as well as the props, and warms it', () => {
    // §16.24 3: with only the props in the pick scene nothing writes depth, and
    // a VOB behind a wall wins the pixel. Warming pays the 53 ms pick-shader
    // compile here rather than on the user's first click.
    const { host } = harness();

    expect(pickerCalls.instanced[0]).toEqual(host.world.instancedMeshes);
    expect(pickerCalls.worldMeshes[0]).toEqual(host.world.worldMeshes);
    expect(pickerCalls.warmed).toBe(1);

    host.dispose();
    expect(pickerCalls.disposed).toBe(1);
  });

  it('builds the trees for the world meshes and settles rather than disposes them', async () => {
    const { host, builder } = harness();

    expect(worker.postMessage).toHaveBeenCalledTimes(host.world.worldMeshes.length);
    answerBuilds();
    await host.ready;
    for (const worldMesh of host.world.worldMeshes) {
      expect(worldMesh.geometry.boundsTree).toBeDefined();
    }

    // The builder outlives the payload: only the viewport going away disposes
    // the worker, and a settled build is an abandoned one, not a terminated
    // thread.
    host.dispose();
    expect(worker.terminate).not.toHaveBeenCalled();
    builder.dispose();
  });

  it('settles the builds a teardown abandoned rather than waiting on them', async () => {
    // A world closed while its trees are still being built has posted work
    // nobody will answer. Unsettled, the scene's own readiness never resolves —
    // and the benchmark and the screenshot both wait on it.
    const builder = new BvhBuilder();
    const { host } = harness({ builder });
    expect(worker.postMessage).toHaveBeenCalled();

    host.dispose();
    await expect(host.ready).resolves.toBeUndefined();
    builder.dispose();
  });

  it('asks the worker nothing when the same mesh payload is rebuilt', async () => {
    // The case this exists for: a VOB op rebuilds the scene, so the geometry is
    // new, but the world mesh it came from is the very same payload.
    const mesh = meshPayload();
    const builder = new BvhBuilder();
    const first = harness({ mesh, builder });
    answerBuilds();
    await first.host.ready;
    first.host.dispose();

    const second = harness({ mesh, builder, visuals: visualsPayload() });
    expect(worker.postMessage).not.toHaveBeenCalled();
    await second.host.ready;
    for (const worldMesh of second.host.world.worldMeshes) {
      expect(worldMesh.geometry.boundsTree).toBeDefined();
    }
    second.host.dispose();
    builder.dispose();
  });

  it('decodes at the measured cap, and asks for nothing the cache already holds', async () => {
    const textures = textureCacheFor(null, 'the-world');
    const first = harness({ textures });
    answerBuilds();
    await first.host.ready;

    expect(first.asked.map((ask) => ask.name).sort()).toEqual(['BARREL.TGA', 'NW_WOOD.TGA']);
    expect(first.asked.every((ask) => ask.maxSize === TEXTURE_MAX_SIZE)).toBe(true);
    first.host.dispose();

    // A rebuilt scene asks for nothing at all: the pixels did not change when a
    // VOB was placed, and re-decoding all of them is the 549 ms of the cold open
    // spent again.
    const second = harness({ textures });
    answerBuilds();
    await second.host.ready;
    expect(second.asked).toEqual([]);
    second.host.dispose();
  });

  it('says which textures could not be decoded', async () => {
    // White geometry is otherwise a fact the user has to reverse-engineer: a mod
    // folder holds source `.TGA` files, which resolve by name and fail to parse.
    const { host, failures } = harness({ load: async () => null });
    answerBuilds();
    await host.ready;

    expect(failures).toEqual([['NW_WOOD.TGA', 'BARREL.TGA']]);
    host.dispose();
  });

  it('reports nothing into a scene that was torn down mid-decode', async () => {
    // The first name has already failed when the world is closed under it, so
    // there is a failure to report and nothing left to report it to.
    const { host, failures, asked } = harness({
      load: async (name) => (name === 'NW_WOOD.TGA' ? null : decoded(name)),
    });
    answerBuilds();

    host.dispose();
    await host.ready;

    expect(failures).toEqual([]);
    // And the load stops where it stands rather than decoding into a scene that
    // has been disposed.
    expect(asked.map((ask) => ask.name)).toEqual(['NW_WOOD.TGA']);
  });

  it('is ready only once both the trees and the pixels are in', async () => {
    const { host } = harness();
    let ready = false;
    void host.ready.then(() => { ready = true; });

    await Promise.resolve();
    await Promise.resolve();
    expect(ready).toBe(false);

    answerBuilds();
    await host.ready;
    expect(ready).toBe(true);
    host.dispose();
  });
});
