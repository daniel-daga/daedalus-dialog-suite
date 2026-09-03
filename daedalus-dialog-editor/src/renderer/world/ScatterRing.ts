import * as THREE from 'three';

// The scatter brush's cursor (level-editor.md §16.25).
//
// The one piece of feedback the brush has, and it is load-bearing rather than
// decoration: the radius is a number in the toolbar, and a number in
// centimetres is not something anybody can judge against a hillside. The stroke
// itself shows nothing until it is released — the placements are committed on
// mouse-up, in one batch — so without this the whole gesture would be aimed
// blind.
//
// Unlike `TerrainMarker` it draws **with** depth test and in world units. It is
// a footprint on the ground and has to be occluded by whatever stands in front
// of it: a ring floating over the rock it is behind would say the brush reaches
// somewhere it does not.

/**
 * Segments around the ring, and therefore **raycasts per pointermove**: the
 * ring follows the mesh rather than lying in one plane, so each vertex is found
 * by its own downward ray, exactly as the placements under it will be.
 *
 * That is what fixes the thing a flat disc gets wrong. A brush is aimed at
 * hillsides and shorelines, and a disc in the tangent plane at the cursor cuts
 * straight through the hill on one side and floats over the valley on the
 * other — so the one piece of feedback the tool has would be wrong in exactly
 * the terrain the tool is for.
 *
 * 48 rather than 64 because these are real work now. The BVH answers a ray in
 * ~0.2 ms, so a full ring is well inside a frame, and the handler runs at most
 * once per pointermove.
 */
const SEGMENTS = 48;

const COLOR = 0x7cff5a;

/** Lifted off the surface, or the ring z-fights the ground it is drawn on.
 *  Centimetres, like everything else in this space. */
const LIFT = 4;

export class ScatterRing {
  /** Add this under the scene's converted root — the positions written here are
   *  ZenGin centimetres, exactly as the pick reported them. */
  readonly root = new THREE.Group();

  private geometry = new THREE.BufferGeometry();
  private material: THREE.LineBasicMaterial;
  private ring: THREE.LineLoop;

  /** The ring's vertices, rewritten in place on every move — allocated once,
   *  because this runs on a pointermove. */
  private points = new Float32Array(SEGMENTS * 3);

  constructor() {
    const attribute = new THREE.BufferAttribute(this.points, 3);
    attribute.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', attribute);

    this.material = new THREE.LineBasicMaterial({ color: COLOR, transparent: true, opacity: 0.9 });
    this.ring = new THREE.LineLoop(this.geometry, this.material);
    this.ring.frustumCulled = false;
    // Decoration: it must never answer the pick that is about to place through
    // it, the same rule `TerrainMarker` follows.
    this.ring.raycast = () => undefined;
    this.ring.visible = false;
    this.ring.matrixAutoUpdate = false;

    this.root.add(this.ring);
    this.root.matrixAutoUpdate = false;
  }

  /**
   * Drape the ring over the mesh around a surface point.
   *
   * `groundAt` is a downward raycast — the *same* one a placement makes, which
   * is what makes this a prediction rather than a decoration: a segment that
   * finds no ground is a place the brush would find none either. Those segments
   * fall back to the cursor's own plane rather than breaking the loop, so the
   * ring stays closed and reads as "the brush reaches here, there is nothing
   * under it" instead of as a rendering fault.
   *
   * The vertices are written in world space and the object's own transform left
   * at identity, because a draped ring is not a rigid circle any more — there
   * is no single position and rotation that describes it.
   */
  moveTo(
    at: readonly [number, number, number],
    normal: readonly [number, number, number],
    radius: number,
    groundAt: (x: number, z: number) => { y: number; normal: readonly [number, number, number] } | null,
  ): void {
    this.ring.visible = true;

    for (let segment = 0; segment < SEGMENTS; segment++) {
      const angle = (segment / SEGMENTS) * Math.PI * 2;
      const x = at[0] + Math.cos(angle) * radius;
      const z = at[2] + Math.sin(angle) * radius;
      const ground = groundAt(x, z);

      // Lifted along the surface's own normal where there is one, and along the
      // cursor's where there is not — a vertex over a hole would otherwise sit
      // at the cursor's height with the cursor's tilt, which is the one place
      // the fallback could still cross the mesh.
      const up = ground?.normal ?? normal;
      const y = ground?.y ?? at[1];
      this.points[segment * 3] = x + up[0] * LIFT;
      this.points[segment * 3 + 1] = y + up[1] * LIFT;
      this.points[segment * 3 + 2] = z + up[2] * LIFT;
    }

    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.computeBoundingSphere();
  }

  /** Off the surface entirely — the cursor left the world mesh, so there is no
   *  footprint to show and a stale one would be a lie about where a click lands. */
  hide(): void {
    this.ring.visible = false;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.root.clear();
  }
}
