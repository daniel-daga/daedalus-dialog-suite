import * as THREE from 'three';
import type { VobExtent } from 'zen-world';

// How far a sound, a light, a zone or a trigger actually reaches, drawn
// (level-editor.md §16.39, #248).
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
//   - **a sphere where the extent IS a radius, a box where it is a box.** A
//     zone's or a trigger's volume is its bounding box, and the columnar index
//     carries no column for one — so the box comes from the same per-selection
//     `getVobProps` read, which is what Daniel chose over paying 41,393 × 6
//     floats at every world load. `vobExtentOf` is where the line between the
//     two shapes is drawn, `oCZoneMusic.ellipsoid` included: one box means two
//     shapes, and the flag is one the user can flip.
//
// A box carries its own position and a radius does not, which is the whole of
// why `show` takes both. Six world-space numbers already say where the volume
// is; drawing one at the VOB would put it wherever that VOB's origin happens to
// sit inside its own volume.
//
// It hangs under the same mirrored root the world mesh, the VOBs, the waynet
// and the markers do, so the position it is given is the index's own ZenGin
// centimetres, unconverted. The mirror on X is invisible on a sphere.

/** The four colours, taken from `VobMarkerLayer`'s table on purpose: the volume
 *  belongs to the marker inside it and a second palette would break that. */
export const EXTENT_COLORS: Record<VobExtent['kind'], number> = {
  sound: 0x00e5ff,
  light: 0xffe082,
  zone: 0xb388ff,
  trigger: 0xff5252,
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

/** The twelve edges of the cube from (-1,-1,-1) to (1,1,1), as line segments —
 *  scaled by a bbox's half extents it is that bbox. */
function unitBoxWireframe(): THREE.BufferGeometry {
  const corner = (bits: number): [number, number, number] => [
    bits & 1 ? 1 : -1, bits & 2 ? 1 : -1, bits & 4 ? 1 : -1,
  ];
  const points: number[] = [];
  for (let from = 0; from < 8; from += 1) {
    // One bit apart is one edge, and taking only the higher end draws each once.
    for (const bit of [1, 2, 4]) {
      const to = from | bit;
      if (to !== from) points.push(...corner(from), ...corner(to));
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  return geometry;
}

export class VobExtentOverlay {
  readonly wireframe: THREE.LineSegments;
  private readonly material: THREE.LineBasicMaterial;
  /** The two geometries the one node is drawn with. Both are owned here and
   *  both are disposed, whichever is mounted when the overlay goes. */
  private readonly sphere = unitSphereWireframe();
  private readonly box = unitBoxWireframe();

  constructor() {
    // Built at unit size once and scaled per selection: a new geometry per
    // radius would rebuild 192 segments for every keystroke in the grid.
    this.material = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.85 });
    this.wireframe = new THREE.LineSegments(this.sphere, this.material);
    // Nothing is selected yet, and an unowned sphere at the origin is a VOB
    // that is not there.
    this.wireframe.visible = false;
    // It is an annotation, not geometry: a pick has to go through it, and it
    // must never write into the id pass the picker reads.
    this.wireframe.raycast = () => {};
    this.wireframe.renderOrder = 1;
  }

  /**
   * Draw the volume of one VOB.
   *
   * `position` is where the VOB is, in the mirrored root's space — what
   * `WorldScene.positionOf` answers — and is used by a **sphere only**: a
   * radius is a length around the VOB and a bounding box is already world
   * space. Both are ZenGin centimetres, the same units the root is in.
   */
  show(position: readonly [number, number, number], extent: VobExtent): void {
    if (extent.shape === 'sphere') {
      this.wireframe.geometry = this.sphere;
      this.wireframe.position.set(position[0], position[1], position[2]);
      this.wireframe.scale.setScalar(extent.radius);
    } else {
      // An ellipsoid is the sphere scaled unevenly, which is what makes it the
      // one inscribed in this box rather than an approximation of one.
      this.wireframe.geometry = extent.shape === 'ellipsoid' ? this.sphere : this.box;
      const [minX, minY, minZ, maxX, maxY, maxZ] = extent.bbox;
      this.wireframe.position.set((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
      this.wireframe.scale.set((maxX - minX) / 2, (maxY - minY) / 2, (maxZ - minZ) / 2);
    }
    this.material.color.setHex(EXTENT_COLORS[extent.kind]);
    this.wireframe.visible = true;
  }

  /** Nothing selected, or a selection with no volume to draw. */
  hide(): void {
    this.wireframe.visible = false;
  }

  dispose(): void {
    // Both, not `wireframe.geometry`: the other one is mounted on nothing and
    // would be the buffer nobody frees.
    this.sphere.dispose();
    this.box.dispose();
    this.material.dispose();
  }
}
