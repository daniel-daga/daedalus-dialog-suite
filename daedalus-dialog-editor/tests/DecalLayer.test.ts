/**
 * The decals, drawn as themselves (level-editor.md §16.40, #249).
 *
 * `extractVisual` cannot turn a `.TGA` into geometry, so 1,932 of the retail
 * VOBs drew nothing at all. What a decal actually is — a flat texture of a
 * stated size, facing the camera — is checkable without a GPU in every part
 * that matters: which quad is which VOB, how big it is, where it is, and that
 * it never takes a click meant for the VOB behind it.
 *
 * The billboard itself is a vertex shader and only a GPU can show it. What is
 * asserted here is that the shader is installed and says what it has to say.
 *
 * @jest-environment jsdom
 */

import * as THREE from 'three';
import type { DecalScene } from 'zen-world';
import { DecalLayer } from '../src/renderer/world/DecalLayer';
import { HIDDEN_ATTRIBUTE } from '../src/renderer/world/WorldScene';

/** One decal group, in the shape `buildDecalBillboards` emits — sizes already
 *  doubled out of the half extent, as it does. */
function group(
  texture: string,
  decals: Array<{ vob: number; pos: [number, number, number]; size: [number, number] }>,
) {
  return {
    texture,
    count: decals.length,
    positions: new Float32Array(decals.flatMap((decal) => decal.pos)).buffer,
    sizes: new Float32Array(decals.flatMap((decal) => decal.size)).buffer,
    vobIds: new Uint32Array(decals.map((decal) => decal.vob)).buffer,
  };
}

function scene(...groups: ReturnType<typeof group>[]): DecalScene {
  return {
    groups,
    stats: { decals: groups.reduce((sum, g) => sum + g.count, 0), textures: groups.length },
  };
}

const WEB = group('NW_WEB.TGA', [
  { vob: 7, pos: [100, 200, 300], size: [50, 80] },
  { vob: 9, pos: [0, 0, 0], size: [10, 10] },
]);
const BLOOD = group('NW_BLOOD.TGA', [{ vob: 3, pos: [-5, 0, 5], size: [20, 20] }]);

const materials = () => {
  const made: Array<{ texture: string; material: THREE.MeshBasicMaterial }> = [];
  return {
    made,
    materialFor: (texture: string) => {
      const material = new THREE.MeshBasicMaterial();
      made.push({ texture, material });
      return material;
    },
  };
};

describe('DecalLayer', () => {
  it('draws one mesh per texture, instanced over the decals that share it', () => {
    // 23 decal textures carry 1,405 decal VOBs on retail NewWorld; a mesh each
    // would be 1,405 draw calls against a budget under 1,500.
    const { made, materialFor } = materials();
    const layer = new DecalLayer(scene(WEB, BLOOD), materialFor);

    expect(layer.meshes).toHaveLength(2);
    expect(layer.meshes.map((mesh) => mesh.count)).toEqual([2, 1]);
    expect(made.map((entry) => entry.texture)).toEqual(['NW_WEB.TGA', 'NW_BLOOD.TGA']);
    layer.dispose();
  });

  it('places each quad where the VOB is, at the size the decal says', () => {
    // ZenGin centimetres, unconverted: the root node is the only thing in the
    // graph that converts. The size rides in the instance matrix's scale, which
    // is what the billboard shader reads it back out of.
    const { materialFor } = materials();
    const layer = new DecalLayer(scene(WEB), materialFor);
    const matrix = new THREE.Matrix4();

    layer.meshes[0].getMatrixAt(0, matrix);
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    matrix.decompose(position, quaternion, scale);

    expect(position.toArray()).toEqual([100, 200, 300]);
    expect([scale.x, scale.y]).toEqual([50, 80]);
    layer.dispose();
  });

  it('answers where a decal is, and moves it without resizing it', () => {
    // A drag writes through here exactly as it writes through the markers, and
    // a move that re-derived the scale would silently turn the decal into a
    // one-centimetre quad.
    const { materialFor } = materials();
    const layer = new DecalLayer(scene(WEB), materialFor);

    expect(layer.positionOf(7)).toEqual([100, 200, 300]);
    expect(layer.setPosition(7, [1, 2, 3])).toBe(true);
    expect(layer.positionOf(7)).toEqual([1, 2, 3]);

    const matrix = new THREE.Matrix4();
    layer.meshes[0].getMatrixAt(0, matrix);
    const scale = new THREE.Vector3();
    matrix.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
    expect([scale.x, scale.y]).toEqual([50, 80]);
    layer.dispose();
  });

  it('says it holds nothing for a VOB that is not a decal', () => {
    const { materialFor } = materials();
    const layer = new DecalLayer(scene(WEB), materialFor);

    expect(layer.positionOf(1234)).toBeNull();
    expect(layer.setPosition(1234, [0, 0, 0])).toBe(false);
    layer.dispose();
  });

  it('hides exactly the VOBs the class filter switched off', () => {
    // The same per-VOB byte array the instanced VOBs and the markers take, so
    // a class hidden in the view controls is hidden everywhere it is drawn.
    const { materialFor } = materials();
    const layer = new DecalLayer(scene(WEB, BLOOD), materialFor);
    const hidden = new Uint8Array(16);
    hidden[9] = 1;

    layer.setHidden(hidden);

    const web = layer.meshes[0].geometry.getAttribute(HIDDEN_ATTRIBUTE);
    expect(Array.from(web.array)).toEqual([0, 1]);
    expect(Array.from(layer.meshes[1].geometry.getAttribute(HIDDEN_ATTRIBUTE).array)).toEqual([0]);

    layer.setHidden(null);
    expect(Array.from(layer.meshes[0].geometry.getAttribute(HIDDEN_ATTRIBUTE).array)).toEqual([0, 0]);
    layer.dispose();
  });

  it('is a cut-out that writes no depth, or a web is a black rectangle', () => {
    // A decal is mostly transparent and sits on the surface it decorates.
    const { made, materialFor } = materials();
    const layer = new DecalLayer(scene(WEB), materialFor);
    const { material } = made[0];

    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(material.alphaTest).toBeGreaterThan(0);
    layer.dispose();
  });

  it('billboards in the vertex shader, sized from the instance matrix', () => {
    // A decal is not oriented by its VOB — in the engine it faces the camera —
    // so the quad is built in view space and the VOB's rotation is unused.
    const { made, materialFor } = materials();
    const layer = new DecalLayer(scene(WEB), materialFor);
    const shader = {
      vertexShader: 'void main() {\n#include <project_vertex>\n}',
      fragmentShader: '',
      uniforms: {},
    } as unknown as THREE.WebGLProgramParametersWithUniforms;

    made[0].material.onBeforeCompile!(shader, null as unknown as THREE.WebGLRenderer);

    // The plane's own position never reaches clip space; the camera's basis does.
    expect(shader.vertexShader).not.toContain('#include <project_vertex>');
    expect(shader.vertexShader).toContain('modelViewMatrix * instanceMatrix');
    expect(shader.vertexShader).toContain('length( instanceMatrix[0].xyz )');
    // And the hide is compiled in with it, since it replaced the same include.
    expect(shader.vertexShader).toContain(`attribute float ${HIDDEN_ATTRIBUTE}`);
    layer.dispose();
  });

  it('never answers a raycast, because the marker at its centre is the handle', () => {
    // The quad is the picture. A click has to reach the decal's own marker, and
    // the wall behind it when it misses.
    const { materialFor } = materials();
    const layer = new DecalLayer(scene(WEB), materialFor);
    const hits: THREE.Intersection[] = [];

    layer.meshes[0].raycast(
      new THREE.Raycaster(new THREE.Vector3(100, 200, 9999), new THREE.Vector3(0, 0, -1)), hits,
    );

    expect(hits).toEqual([]);
    layer.dispose();
  });
});
