/**
 * Particle effects drawn as what their definition says (level-editor.md §16.45,
 * #410). A world names an effect; the definition is a Daedalus instance, and
 * `buildParticleBillboards` has already turned the resolved ones into one group
 * per effect. What is left is the layer: how many particles a VOB carries, where
 * they sit, and that a hidden or dragged VOB carries them along.
 *
 * The motion itself is a vertex shader fed one clock, and only a GPU can show
 * it. What is asserted here is that the shader is installed, reads the clock it
 * is given, and interpolates the fields the definition states.
 *
 * @jest-environment jsdom
 */

import * as THREE from 'three';
import { particlesPerVob, type ParticleEffect, type ParticleScene } from 'zen-world';
import { PARTICLE_PHASE_ATTRIBUTE, ParticleLayer } from '../src/renderer/world/ParticleLayer';
import { HIDDEN_ATTRIBUTE } from '../src/renderer/world/WorldScene';

const FIRE: ParticleEffect = {
  name: 'FIRE',
  texture: 'HUMANBURN.TGA',
  rate: 25,
  lifetimeMs: 1000,
  sizeStart: [40, 40],
  sizeEndScale: 3,
  colorStart: [100, 100, 100],
  colorEnd: [100, 100, 0],
  alphaStart: 1,
  alphaEnd: 1,
  additive: true,
};

function group(effect: ParticleEffect, vobs: Array<{ vob: number; pos: [number, number, number] }>) {
  return {
    effect,
    count: vobs.length,
    particles: vobs.length * particlesPerVob(effect),
    positions: new Float32Array(vobs.flatMap((vob) => vob.pos)).buffer,
    vobIds: new Uint32Array(vobs.map((vob) => vob.vob)).buffer,
  };
}

function scene(...groups: ReturnType<typeof group>[]): ParticleScene {
  return {
    groups,
    stats: {
      effects: groups.length,
      vobs: groups.reduce((sum, g) => sum + g.count, 0),
      particles: groups.reduce((sum, g) => sum + g.particles, 0),
    },
  };
}

function materials() {
  const made: Array<{ effect: ParticleEffect; material: THREE.MeshBasicMaterial }> = [];
  return {
    made,
    materialFor: (effect: ParticleEffect) => {
      const material = new THREE.MeshBasicMaterial();
      made.push({ effect, material });
      return material;
    },
  };
}

/** The two retail effects one world showed, at three VOBs. */
const FIRE_VOBS = group(FIRE, [
  { vob: 4, pos: [100, 200, 300] },
  { vob: 8, pos: [0, 0, 0] },
]);

function positionOf(mesh: THREE.InstancedMesh, instance: number): number[] {
  const matrix = new THREE.Matrix4();
  mesh.getMatrixAt(instance, matrix);
  return [matrix.elements[12], matrix.elements[13], matrix.elements[14]];
}

describe('ParticleLayer', () => {
  it('draws one mesh per effect, holding one instance per particle', () => {
    // A VOB carries its effect's live-particle count, not one quad: a single
    // quad per effect VOB would be the static billboard this is not.
    const { materialFor } = materials();
    const layer = new ParticleLayer(scene(FIRE_VOBS), materialFor, { value: 0 });

    expect(layer.meshes).toHaveLength(1);
    expect(layer.meshes[0].count).toBe(FIRE_VOBS.particles);
    expect(layer.meshes[0].count).toBe(2 * particlesPerVob(FIRE));
    layer.dispose();
  });

  it('makes every particle an instance at the VOB its effect belongs to', () => {
    const { materialFor } = materials();
    const layer = new ParticleLayer(scene(FIRE_VOBS), materialFor, { value: 0 });
    const mesh = layer.meshes[0];
    const perVob = particlesPerVob(FIRE);

    for (let at = 0; at < perVob; at++) expect(positionOf(mesh, at)).toEqual([100, 200, 300]);
    for (let at = perVob; at < perVob * 2; at++) expect(positionOf(mesh, at)).toEqual([0, 0, 0]);
    layer.dispose();
  });

  it('gives each particle a phase in the lifetime, so they are not one blink', () => {
    const { materialFor } = materials();
    const layer = new ParticleLayer(scene(FIRE_VOBS), materialFor, { value: 0 });
    const phases = layer.meshes[0].geometry.getAttribute(PARTICLE_PHASE_ATTRIBUTE) as THREE.InstancedBufferAttribute;

    expect(phases.count).toBe(FIRE_VOBS.particles);
    const values = [...(phases.array as Float32Array)];
    expect(values.every((value) => value >= 0 && value < 1)).toBe(true);
    expect(new Set(values).size).toBeGreaterThan(1);
    layer.dispose();
  });

  it('reads one clock the whole layer shares', () => {
    // `WorldScene`'s draw loop writes one number per frame; a uniform per
    // material would be one write per effect per frame.
    const time = { value: 0 };
    const { made, materialFor } = materials();
    const layer = new ParticleLayer(scene(FIRE_VOBS), materialFor, time);

    layer.setTime(12.5);

    expect(time.value).toBe(12.5);
    const material = made[0].material;
    expect(typeof material.onBeforeCompile).toBe('function');

    const shader = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader: '#include <project_vertex>',
      fragmentShader: 'void main() {\n#include <color_fragment>\n}',
    };
    material.onBeforeCompile(shader as never, {} as never);
    expect(shader.uniforms.uTime).toBe(time);
    expect(shader.vertexShader).toContain('uSizeStart');
    expect(shader.vertexShader).toContain('uColorEnd');
    expect(shader.vertexShader).toContain('gl_Position');
    expect(shader.fragmentShader).toContain('vParticleAlpha');
    layer.dispose();
  });

  it('hides a whole VOB — every particle of it — with the class filter', () => {
    const { materialFor } = materials();
    const layer = new ParticleLayer(scene(FIRE_VOBS), materialFor, { value: 0 });
    const mesh = layer.meshes[0];
    const hidden = new Uint8Array(16);
    hidden[8] = 1;

    layer.setHidden(hidden);

    const flags = (mesh.geometry.getAttribute(HIDDEN_ATTRIBUTE) as THREE.InstancedBufferAttribute)
      .array as Float32Array;
    const perVob = particlesPerVob(FIRE);
    expect([...flags.slice(0, perVob)].every((flag) => flag === 0)).toBe(true);
    expect([...flags.slice(perVob)].every((flag) => flag === 1)).toBe(true);
    layer.dispose();
  });

  it('carries a dragged VOB\'s particles with it', () => {
    const { materialFor } = materials();
    const layer = new ParticleLayer(scene(FIRE_VOBS), materialFor, { value: 0 });
    const mesh = layer.meshes[0];

    expect(layer.setPosition(8, [7, 8, 9])).toBe(true);

    const perVob = particlesPerVob(FIRE);
    expect(positionOf(mesh, perVob)).toEqual([7, 8, 9]);
    expect(positionOf(mesh, mesh.count - 1)).toEqual([7, 8, 9]);
    expect(layer.positionOf(8)).toEqual([7, 8, 9]);
    // A VOB this layer does not draw is not this layer's to move.
    expect(layer.setPosition(99, [0, 0, 0])).toBe(false);
    expect(layer.positionOf(99)).toBeNull();
    layer.dispose();
  });

  it('is drawn after the world and never takes a click meant for the VOB behind it', () => {
    const { materialFor } = materials();
    const layer = new ParticleLayer(scene(FIRE_VOBS), materialFor, { value: 0 });
    const mesh = layer.meshes[0];

    expect(mesh.frustumCulled).toBe(false);
    expect(mesh.renderOrder).toBeGreaterThan(0);
    expect(mesh.raycast(new THREE.Raycaster(), [])).toBeUndefined();
    layer.dispose();
  });
});
