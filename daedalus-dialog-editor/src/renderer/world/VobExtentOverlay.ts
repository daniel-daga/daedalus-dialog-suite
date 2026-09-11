import * as THREE from 'three';
import type { VobExtent } from 'zen-world';

// How far a sound or a light actually reaches, drawn (level-editor.md §16.39,
// #248).
//
// The markers that landed with #247 say where a VOB with no visual stands, and
// for this family that is the smaller half of the fact: a `zCVobSound` **is**
// its `radius` and a `zCVobLight` **is** its `range`, so tuning one was still a
// save-and-play loop with the marker on screen. The number is in the property
// grid; what was missing is what it means in the world.
//
// Nothing new is fetched for it. `radius` and `range` are catalogued class
// fields (`vobExtentOf`, zen-world) and already cross on the `getVobProps` read
// the property grid makes when the selection changes, so this is a wireframe
// and a scale.
//
// Two decisions in it:
//
//   - **the selection only.** The three retail worlds hold 1,237 sound VOBs
//     between them; every radius at once is a screen of overlapping spheres,
//     and the modder tuning one sound wants that one.
//   - **a sphere, and only where the extent IS a radius.** A zone's or a
//     trigger's extent is its bounding box and the index carries no column for
//     one — drawing a sphere there would be a confident wrong answer rather
//     than a missing one. `vobExtentOf` is where that line is drawn.
//
// It hangs under the same mirrored root the world mesh, the VOBs, the waynet
// and the markers do, so the position it is given is the index's own ZenGin
// centimetres, unconverted. The mirror on X is invisible on a sphere.

/** The two colours, taken from `VobMarkerLayer`'s table on purpose: the sphere
 *  belongs to the marker at its centre and a second palette would break that. */
export const EXTENT_COLORS: Record<VobExtent['kind'], number> = {
  sound: 0x00e5ff,
  light: 0xffe082,
};

/** Segments per circle. 64 is round at any distance the camera gets to and is
 *  192 line segments in total — nothing next to a world mesh. */
const SEGMENTS = 64;

/** Three orthogonal unit circles, as line segments. The idiom every level
 *  editor draws a radius with: one circle reads as a disc from the wrong angle
 *  and three read as a sphere from every angle. */
function unitSphereWireframe(): THREE.BufferGeometry {
  const points: number[] = [];
  // XY, XZ and YZ — the axis each circle is *missing* is the one it spins in.
  const planes: Array<[number, number]> = [[0, 1], [0, 2], [1, 2]];
  for (const [u, v] of planes) {
    for (let at = 0; at < SEGMENTS; at += 1) {
      const from = (at / SEGMENTS) * Math.PI * 2;
      const to = ((at + 1) / SEGMENTS) * Math.PI * 2;
      const a = [0, 0, 0];
      const b = [0, 0, 0];
      a[u] = Math.cos(from); a[v] = Math.sin(from);
      b[u] = Math.cos(to); b[v] = Math.sin(to);
      points.push(...a, ...b);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  return geometry;
}

export class VobExtentOverlay {
  readonly wireframe: THREE.LineSegments;
  private readonly material: THREE.LineBasicMaterial;

  constructor() {
    // Built at radius 1 once and scaled per selection: a new geometry per
    // radius would rebuild 192 segments for every keystroke in the grid.
    this.material = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.85 });
    this.wireframe = new THREE.LineSegments(unitSphereWireframe(), this.material);
    // Nothing is selected yet, and an unowned sphere at the origin is a VOB
    // that is not there.
    this.wireframe.visible = false;
    // It is an annotation, not geometry: a pick has to go through it, and it
    // must never write into the id pass the picker reads.
    this.wireframe.raycast = () => {};
    this.wireframe.renderOrder = 1;
  }

  /** Draw the sphere around one VOB. `position` is in the mirrored root's
   *  space — what `WorldScene.positionOf` answers — and `extent.radius` is
   *  ZenGin centimetres, the same units. */
  show(position: readonly [number, number, number], extent: VobExtent): void {
    this.wireframe.position.set(position[0], position[1], position[2]);
    this.wireframe.scale.setScalar(extent.radius);
    this.material.color.setHex(EXTENT_COLORS[extent.kind]);
    this.wireframe.visible = true;
  }

  /** Nothing selected, or a selection with no radius to draw. */
  hide(): void {
    this.wireframe.visible = false;
  }

  dispose(): void {
    this.wireframe.geometry.dispose();
    this.material.dispose();
  }
}
