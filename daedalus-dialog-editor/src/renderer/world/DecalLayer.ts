import * as THREE from 'three';
import type { DecalScene } from 'zen-world';
import { HIDDEN_ATTRIBUTE } from './instanceAttributes';

// The decals, drawn as themselves (level-editor.md §16.40, #249).
//
// `extractVisual` cannot turn a `.TGA` into geometry, so all 1,932 decals
// across the three retail worlds land in `unresolvedByType` and
// `buildInstancedVisuals` places none of them. They are not missing geometry: a
// `zCDecal` **is** a flat texture of a stated size, and `buildDecalBillboards`
// has already turned the index's decal side table into one quad per decal,
// grouped by texture so each group is a single draw.
//
// Two facts decide what this draws, and both were read out of OpenGothic, which
// reimplements the ZenGin renderer rather than guessing at it:
//
//   - **`decalDimension` is a half extent.** OpenGothic builds the sprite at
//     `2 * decal->dimension` and spans it -0.5..0.5 of that. The doubling is
//     done in `buildDecalBillboards`, so what arrives here is the drawn size.
//   - **a decal is not oriented by its VOB at all — it faces the camera.** The
//     quad's axes come from the camera basis, and the VOB's rotation is unused.
//     That is why this is a billboard in the vertex shader rather than a plane
//     placed by an instance matrix: a fixed quad would be edge-on and invisible
//     from half the angles a modder looks from.
//
// **The quad is the picture, not the handle.** It never enters the GPU id pass,
// because that pass draws instances through its own material and a billboard
// there would have to be a third shader variant of it. The pick, the gizmo and
// `positionOf` come from the marker at the decal's centre instead — the same
// layer that answers for every other VOB with no drawable geometry — which is
// why `VobMarkerLayer` now covers a decal as well.

/** How opaque a texel has to be to be drawn at all. A decal is a cut-out —
 *  spider webs and blood splats are mostly transparent — and a quad drawn
 *  without this is a rectangle of black where the texture is empty. */
const DECAL_ALPHA_TEST = 0.02;

/** Each decal's own `decalAlphaWeight`, already divided to 0-1 by
 *  `buildDecalBillboards`. Per instance, because the field is per VOB and the
 *  material is per texture — a material per decal would be the 1,405 draw calls
 *  the grouping exists to avoid. */
export const DECAL_ALPHA_ATTRIBUTE = 'aDecalAlpha';

/** The vertex shader hands it to the fragment shader; nothing else reads it. */
const DECAL_ALPHA_VARYING = 'vDecalAlpha';

/** The unit quad every decal is a scaled, camera-facing copy of. One geometry
 *  for the whole layer: only the instance matrix differs. */
function unitQuad(): THREE.PlaneGeometry {
  return new THREE.PlaneGeometry(1, 1);
}

/**
 * Face the camera, at the size the instance matrix carries.
 *
 * `<project_vertex>` is where three.js turns the local position into clip
 * space, so replacing it is where the quad stops being a plane in the world and
 * becomes one in view space. The size comes out of the instance matrix's own
 * scale rather than a second attribute, and `modelViewMatrix`'s scale carries
 * the root's centimetres-to-metres so the quad is as big as the VOB says.
 */
function billboard(shader: THREE.WebGLProgramParametersWithUniforms): void {
  shader.vertexShader = `attribute float ${HIDDEN_ATTRIBUTE};
attribute float ${DECAL_ALPHA_ATTRIBUTE};
varying float ${DECAL_ALPHA_VARYING};
${
    shader.vertexShader.replace(
      '#include <project_vertex>',
      `${DECAL_ALPHA_VARYING} = ${DECAL_ALPHA_ATTRIBUTE};
  vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );
  // The root node is the only thing in the graph with a scale, and it is the
  // unit change: one ZenGin centimetre in the units the view is working in.
  float decalUnit = length( modelViewMatrix[0].xyz );
  vec2 decalSize = vec2( length( instanceMatrix[0].xyz ), length( instanceMatrix[1].xyz ) );
  mvPosition.xy += transformed.xy * decalSize * decalUnit;
  gl_Position = projectionMatrix * mvPosition;
  // Outside the clip volume in every direction, at w = 1: clipped whole,
  // whatever the camera is doing. The scene's own hide, for the same reason.
  if ( ${HIDDEN_ATTRIBUTE} > 0.5 ) gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 );`,
    )
  }`;

  // OpenGothic's own decal fragment shader, which is the whole of what this
  // field does: `tex.a *= alphaWeight`. Before `<alphatest_fragment>` rather
  // than after it, so a decal turned all the way down is *discarded* like an
  // empty texel instead of drawn as a black rectangle the cut-out test would
  // have caught.
  shader.fragmentShader = `varying float ${DECAL_ALPHA_VARYING};
${
    shader.fragmentShader.replace(
      '#include <alphatest_fragment>',
      `diffuseColor.a *= ${DECAL_ALPHA_VARYING};
  #include <alphatest_fragment>`,
    )
  }`;
}

export class DecalLayer {
  /** One per texture. Added under the scene's converted root by `WorldScene`,
   *  which owns them. */
  readonly meshes: THREE.InstancedMesh[] = [];

  /** Which mesh and instance a VOB's quad is. A decal name is shared by many
   *  VOBs, so this is the only way back from a VOB to its quad. */
  private readonly slots = new Map<number, { mesh: THREE.InstancedMesh; instance: number }>();

  private readonly geometry = unitQuad();
  private readonly hidden: THREE.InstancedBufferAttribute[] = [];

  /**
   * @param materialFor  the material for one decal texture. `WorldScene` owns
   *   the texture slots, so the layer asks rather than decoding anything: a
   *   decal's `.TGA` is loaded by the same path every other texture takes.
   */
  constructor(scene: DecalScene, materialFor: (texture: string) => THREE.MeshBasicMaterial) {
    const matrix = new THREE.Matrix4();

    for (const group of scene.groups) {
      const positions = new Float32Array(group.positions);
      const sizes = new Float32Array(group.sizes);
      const vobIds = new Uint32Array(group.vobIds);

      const material = materialFor(group.texture);
      // A decal is a cut-out and is drawn over the surface it sits on, so it
      // must not write depth — one decal would otherwise hide another behind it
      // across its whole quad, transparent corners included.
      material.transparent = true;
      material.depthWrite = false;
      material.alphaTest = DECAL_ALPHA_TEST;
      // `decalTwoSided` is a per-VOB field and this is one material per
      // texture, but a billboard is never seen from behind, so the side it is
      // drawn on cannot come up.
      material.side = THREE.DoubleSide;
      material.onBeforeCompile = billboard;

      // Its own geometry object per mesh, sharing this layer's attributes: an
      // `InstancedBufferAttribute` belongs to a geometry, and the hide is
      // per-mesh.
      const geometry = this.geometry.clone();
      const hidden = new THREE.InstancedBufferAttribute(new Float32Array(group.count), 1);
      geometry.setAttribute(HIDDEN_ATTRIBUTE, hidden);
      this.hidden.push(hidden);
      geometry.setAttribute(
        DECAL_ALPHA_ATTRIBUTE,
        new THREE.InstancedBufferAttribute(new Float32Array(group.alphaWeights), 1),
      );

      const mesh = new THREE.InstancedMesh(geometry, material, group.count);
      // The quads are drawn where the index says, in ZenGin centimetres: the
      // root node converts, exactly as it does for every other layer.
      for (let at = 0; at < group.count; at++) {
        matrix.makeScale(sizes[at * 2], sizes[at * 2 + 1], 1);
        matrix.setPosition(positions[at * 3], positions[at * 3 + 1], positions[at * 3 + 2]);
        mesh.setMatrixAt(at, matrix);
        this.slots.set(vobIds[at], { mesh, instance: at });
      }
      mesh.instanceMatrix.needsUpdate = true;
      // A billboard's real extent is not its geometry's, and three.js would
      // cull it against a unit quad at the origin.
      mesh.frustumCulled = false;
      // Drawn after the opaque world, like every other transparent surface.
      mesh.renderOrder = 1;
      // The picture, never the handle: the marker at the centre takes the click.
      mesh.raycast = () => {};

      this.meshes.push(mesh);
    }
  }

  /** Where one decal's quad is, in ZenGin centimetres, or null for a VOB this
   *  layer draws nothing for. */
  positionOf(vob: number): [number, number, number] | null {
    const slot = this.slots.get(vob);
    if (slot === undefined) return null;
    const matrix = new THREE.Matrix4();
    slot.mesh.getMatrixAt(slot.instance, matrix);
    return [matrix.elements[12], matrix.elements[13], matrix.elements[14]];
  }

  /**
   * Move one decal's quad, in ZenGin centimetres. True when this layer holds
   * it, so a caller can fall through to whatever else might.
   *
   * The size is left exactly as it was: a move is a move, and re-deriving the
   * scale from a fresh matrix is how a dragged decal would silently become a
   * unit quad.
   */
  setPosition(vob: number, position: readonly [number, number, number]): boolean {
    const slot = this.slots.get(vob);
    if (slot === undefined) return false;
    const matrix = new THREE.Matrix4();
    slot.mesh.getMatrixAt(slot.instance, matrix);
    matrix.setPosition(position[0], position[1], position[2]);
    slot.mesh.setMatrixAt(slot.instance, matrix);
    slot.mesh.instanceMatrix.needsUpdate = true;
    return true;
  }

  /**
   * Which VOBs are switched off — one byte per VOB, or null for "all of them
   * drawn". The same per-class filter the instanced VOBs and the markers take,
   * so a class hidden in the view controls is hidden everywhere it is drawn.
   */
  setHidden(hidden: Uint8Array | null): void {
    for (const attribute of this.hidden) attribute.array.fill(0);
    if (hidden !== null) {
      for (const [vob, slot] of this.slots) {
        if (hidden[vob] !== 1) continue;
        const at = this.meshes.indexOf(slot.mesh);
        (this.hidden[at].array as Float32Array)[slot.instance] = 1;
      }
    }
    for (const attribute of this.hidden) attribute.needsUpdate = true;
  }

  /** The geometries only. The materials are the scene's — they hold texture
   *  slots it fills — and it disposes them with the rest. */
  dispose(): void {
    // Both: the geometry is the quad, and `dispose` on the mesh is what frees
    // the instance buffers hanging off it (WorldScene.dispose says why).
    for (const mesh of this.meshes) {
      mesh.geometry.dispose();
      mesh.dispose();
    }
    this.geometry.dispose();
    this.meshes.length = 0;
    this.slots.clear();
    this.hidden.length = 0;
  }
}
