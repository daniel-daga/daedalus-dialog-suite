import * as THREE from 'three';
import { particlesPerVob, type ParticleEffect, type ParticleScene } from 'zen-world';
import { HIDDEN_ATTRIBUTE } from './instanceAttributes';

// The particle effects a project declares, drawn as themselves (level-editor.md
// §16.45, #410).
//
// A world stores a name; `buildParticleBillboards` has already joined that name
// with the `C_PARTICLEFX` body the project declares and grouped the VOBs by
// effect. What is left is the picture, and it is deliberately plausible rather
// than equal: one camera-facing textured quad per live particle, born at the
// VOB, phased across its lifetime, growing and fading the way the definition
// says. No emitter volume, no direction, no collision, no `zCEffect` chaining —
// the fields a preview needs are `texture`, `rate`, `lifetime`, size over time
// and the colour keys, which is what the retail bodies carry.
//
// The animation is single-pass: every particle carries its birth phase as an
// instance attribute and one `uTime` uniform is the clock, so a frame costs one
// number written and no buffer upload. That is also why the fields are uniforms
// per effect rather than attributes per particle — a VOB's particles share the
// definition they came from.
//
// **The quad is the picture, not the handle.** Like a decal, a particle VOB
// keeps its marker at the centre, which is what a pick, the gizmo and the class
// filter answer for; the billboard never enters the id pass.

/** Each particle's birth position in its lifetime, 0-1. The one attribute that
 *  differs between the particles of one VOB, and what keeps them from blinking
 *  in step. */
export const PARTICLE_PHASE_ATTRIBUTE = 'aParticlePhase';

/** The clock every particle material reads — one number, written once a frame
 *  by `WorldScene.setParticleTime`, rather than one uniform per effect. */
export interface ParticleClock {
  value: number;
}

/** The unit quad every particle is a camera-facing copy of, its V turned to
 *  ZenGin's top-left origin — how every texture is uploaded (#368). */
function unitQuad(): THREE.PlaneGeometry {
  const quad = new THREE.PlaneGeometry(1, 1);
  const uv = quad.getAttribute('uv');
  for (let at = 0; at < uv.count; at++) uv.setY(at, 1 - uv.getY(at));
  return quad;
}

/** A deterministic 0-1 per instance: a reseed on every rebuild would make a
 *  world's particles jump on each structural op. */
function phaseOf(index: number): number {
  const raw = Math.sin(index * 12.9898 + 78.233) * 43758.5453;
  return raw - Math.floor(raw);
}

/**
 * The vertex work, which is the whole of the motion:
 *
 *   - `age` is where the particle is in its life, its own phase plus the clock.
 *   - the quad faces the camera, because a particle is a sprite in the engine
 *     too — its VOB's rotation is not part of this field's meaning.
 *   - size and colour interpolate start → end across `age`, and the alpha fades
 *     in over the first tenth and out over the last, which is the shape
 *     OpenGothic's `PfxBucket::buildSsbo` gives an effect with no per-key
 *     alpha ramp.
 */
function installParticleShader(effect: ParticleEffect, clock: ParticleClock) {
  const uniforms = {
    uTime: clock,
    uLife: { value: Math.max(0.001, effect.lifetimeMs / 1000) },
    uSizeStart: { value: new THREE.Vector2(effect.sizeStart[0], effect.sizeStart[1]) },
    uSizeEndScale: { value: effect.sizeEndScale },
    uColorStart: { value: new THREE.Vector3(...effect.colorStart.map((value) => value / 255) as [number, number, number]) },
    uColorEnd: { value: new THREE.Vector3(...effect.colorEnd.map((value) => value / 255) as [number, number, number]) },
    uAlphaStart: { value: effect.alphaStart },
    uAlphaEnd: { value: effect.alphaEnd },
  };

  return (shader: THREE.WebGLProgramParametersWithUniforms): void => {
    shader.uniforms = { ...shader.uniforms, ...uniforms };

    shader.vertexShader = `attribute float ${PARTICLE_PHASE_ATTRIBUTE};
attribute float ${HIDDEN_ATTRIBUTE};
uniform float uTime;
uniform float uLife;
uniform float uSizeEndScale;
uniform float uAlphaStart;
uniform float uAlphaEnd;
uniform vec2 uSizeStart;
uniform vec3 uColorStart;
uniform vec3 uColorEnd;
varying vec3 vParticleColor;
varying float vParticleAlpha;
${
      shader.vertexShader.replace(
        '#include <project_vertex>',
        `float particleAge = fract( ${PARTICLE_PHASE_ATTRIBUTE} + uTime / uLife );
  vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );
  // The root node is the only thing in the graph with a scale, and it is the
  // unit change: one ZenGin centimetre in the units the view works in.
  float particleUnit = length( modelViewMatrix[ 0 ].xyz );
  vec2 particleSize = uSizeStart * ( 1.0 + particleAge * ( uSizeEndScale - 1.0 ) );
  mvPosition.xy += transformed.xy * particleSize * particleUnit;
  gl_Position = projectionMatrix * mvPosition;
  vParticleColor = mix( uColorStart, uColorEnd, particleAge );
  vParticleAlpha = ( min( particleAge, 0.1 ) / 0.1 ) * uAlphaStart * ( 1.0 - particleAge )
                 + ( min( 1.0 - particleAge, 0.1 ) / 0.1 ) * uAlphaEnd * particleAge;
  if ( ${HIDDEN_ATTRIBUTE} > 0.5 ) gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 );`,
      )
    }`;

    shader.fragmentShader = `varying vec3 vParticleColor;
varying float vParticleAlpha;
${
      shader.fragmentShader.replace(
        '#include <color_fragment>',
        `diffuseColor.rgb *= vParticleColor;
  diffuseColor.a *= vParticleAlpha;`,
      )
    }`;
  };
}

export class ParticleLayer {
  /** One per effect. Added under the scene's converted root by `WorldScene`,
   *  which owns them. */
  readonly meshes: THREE.InstancedMesh[] = [];

  /** The VOBs one mesh draws, and how many particles each of them is. A mesh's
   *  instances are those VOBs' particles back to back, so a VOB's first
   *  particle is its index in here times `perVob`. */
  private readonly vobIds: Uint32Array[] = [];
  private readonly perVob: number[] = [];
  private readonly hidden: THREE.InstancedBufferAttribute[] = [];
  private readonly geometry = unitQuad();

  constructor(
    scene: ParticleScene,
    materialFor: (effect: ParticleEffect) => THREE.MeshBasicMaterial,
    private readonly clock: ParticleClock,
  ) {
    const matrix = new THREE.Matrix4();

    for (const group of scene.groups) {
      const effect = group.effect;
      const perVob = particlesPerVob(effect);
      const positions = new Float32Array(group.positions);
      const groupVobs = new Uint32Array(group.vobIds);

      const material = materialFor(effect);
      material.transparent = true;
      // A particle is light, not a surface: writing depth would let the nearest
      // particle clip the ones behind it across its whole quad.
      material.depthWrite = false;
      material.blending = effect.additive ? THREE.AdditiveBlending : THREE.NormalBlending;
      material.side = THREE.DoubleSide;
      material.onBeforeCompile = installParticleShader(effect, this.clock);

      const geometry = this.geometry.clone();
      const hidden = new THREE.InstancedBufferAttribute(new Float32Array(group.particles), 1);
      geometry.setAttribute(HIDDEN_ATTRIBUTE, hidden);
      this.hidden.push(hidden);

      const phases = new Float32Array(group.particles);
      for (let at = 0; at < phases.length; at++) phases[at] = phaseOf(at);
      geometry.setAttribute(
        PARTICLE_PHASE_ATTRIBUTE, new THREE.InstancedBufferAttribute(phases, 1),
      );

      const mesh = new THREE.InstancedMesh(geometry, material, group.particles);
      // The index is drawn in ZenGin centimetres: the root node converts, as it
      // does for every other layer.
      for (let vob = 0; vob < groupVobs.length; vob++) {
        matrix.makeTranslation(positions[vob * 3], positions[vob * 3 + 1], positions[vob * 3 + 2]);
        for (let particle = 0; particle < perVob; particle++) {
          mesh.setMatrixAt(vob * perVob + particle, matrix);
        }
      }
      mesh.instanceMatrix.needsUpdate = true;
      // A billboard's real extent is not its geometry's, and three.js would
      // cull it against a unit quad at the origin.
      mesh.frustumCulled = false;
      // Drawn after the world and after the decals: light is on top.
      mesh.renderOrder = 2;
      // The picture, never the handle: the marker at the centre takes the click.
      mesh.raycast = () => {};

      this.vobIds.push(groupVobs);
      this.perVob.push(perVob);
      this.meshes.push(mesh);
    }
  }

  /** The clock, in seconds since the world opened. */
  setTime(seconds: number): void {
    this.clock.value = seconds;
  }

  /** Where one effect VOB sits, in ZenGin centimetres, or null for a VOB this
   *  layer draws nothing for. */
  positionOf(vob: number): [number, number, number] | null {
    for (let at = 0; at < this.meshes.length; at++) {
      const at2 = this.vobIds[at].indexOf(vob);
      if (at2 === -1) continue;
      const instance = at2 * this.perVob[at];
      const matrix = new THREE.Matrix4();
      this.meshes[at].getMatrixAt(instance, matrix);
      return [matrix.elements[12], matrix.elements[13], matrix.elements[14]];
    }
    return null;
  }

  /**
   * Move one VOB's particles, in ZenGin centimetres. True when this layer holds
   * it, so a caller can fall through to whatever else might.
   */
  setPosition(vob: number, position: readonly [number, number, number]): boolean {
    let moved = false;
    for (let at = 0; at < this.meshes.length; at++) {
      const mesh = this.meshes[at];
      const index = this.vobIds[at].indexOf(vob);
      if (index === -1) continue;

      const matrix = new THREE.Matrix4();
      for (let particle = 0; particle < this.perVob[at]; particle++) {
        const instance = index * this.perVob[at] + particle;
        mesh.getMatrixAt(instance, matrix);
        matrix.setPosition(position[0], position[1], position[2]);
        mesh.setMatrixAt(instance, matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      moved = true;
    }
    return moved;
  }

  /** Which VOBs are switched off — the same per-class filter the instances, the
   *  decals and the markers take, so a hidden class is hidden everywhere. */
  setHidden(hidden: Uint8Array | null): void {
    for (const attribute of this.hidden) attribute.array.fill(0);
    if (hidden !== null) {
      for (let at = 0; at < this.meshes.length; at++) {
        const flags = this.hidden[at].array as Float32Array;
        const vobIds = this.vobIds[at];
        const perVob = this.perVob[at];
        for (let index = 0; index < vobIds.length; index++) {
          const vob = vobIds[index];
          if (vob >= hidden.length || hidden[vob] === 0) continue;
          flags.fill(1, index * perVob, (index + 1) * perVob);
        }
      }
    }
    for (const attribute of this.hidden) attribute.needsUpdate = true;
  }

  /** The geometries only. The materials are the scene's — they hold texture
   *  slots it fills — and it disposes them with the rest. */
  dispose(): void {
    for (const mesh of this.meshes) {
      mesh.geometry.dispose();
      mesh.dispose();
    }
    this.geometry.dispose();
    this.meshes.length = 0;
    this.vobIds.length = 0;
    this.perVob.length = 0;
    this.hidden.length = 0;
  }
}
