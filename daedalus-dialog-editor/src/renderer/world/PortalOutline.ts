import * as THREE from 'three';

// The portal polygon a Problems finding names, drawn (#222).
//
// A portal is the one thing the World surface can be asked to look at that it
// cannot show: it is an invisible face inside the world mesh's merged draw
// groups, with no material of its own on screen and no row in the VOB index.
// Framing the camera at its centroid alone puts a wall in view and leaves the
// user to guess which face of it the finding meant — so the jump draws the
// polygon as well, and the two together are what "frame a portal" means.
//
// The corners come **with the finding** rather than being looked up here: the
// renderer holds no polygon → geometry mapping to look one up in, which is the
// whole reason this was nobody's card until 2026-09-12. See `PortalLocus` in
// `zen-world`'s `validate/portals.ts`.
//
// It hangs under the same mirrored root the world mesh does, so the corners it
// is given are the readout's own ZenGin centimetres, unconverted — exactly as
// `VobExtentOverlay`'s are.

/** Magenta: no VOB marker, no extent volume and no selection tint uses it, so
 *  an outline is never mistaken for one of them. */
const OUTLINE_COLOR = 0xff00ff;

export class PortalOutline {
  readonly outline: THREE.LineLoop;
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material: THREE.LineBasicMaterial;

  constructor() {
    // `depthTest: false` on purpose, and it is the point rather than a polish:
    // a portal polygon sits inside solid geometry, so an outline that respects
    // depth is an outline behind a wall — which is the picture the user
    // already had.
    this.material = new THREE.LineBasicMaterial({ color: OUTLINE_COLOR, depthTest: false });
    this.outline = new THREE.LineLoop(this.geometry, this.material);
    this.outline.visible = false;
    // An annotation, not geometry: a pick goes through it, and it must never
    // write into the id pass the picker reads.
    this.outline.raycast = () => {};
    // Above the extent wireframe, which is at 1: when a zone's box and a
    // portal happen to overlap, the thing that was just jumped to wins.
    this.outline.renderOrder = 2;
  }

  /**
   * Draw one polygon, and answer where it is and how big — what the caller
   * frames the camera with, so the two never disagree about which polygon
   * this is.
   *
   * A polygon under three corners is not one: `getPortals` reports what the
   * mesh stores, and ExtractMesh's own skip means a degenerate face can reach
   * this. Nothing is drawn for it and the caller is told there is nothing to
   * frame.
   */
  show(corners: readonly (readonly [number, number, number])[]): {
    at: [number, number, number]; bounds: number[];
  } | null {
    if (corners.length < 3) { this.hide(); return null; }

    const points: number[] = [];
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (const corner of corners) {
      points.push(corner[0], corner[1], corner[2]);
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis], corner[axis]);
        max[axis] = Math.max(max[axis], corner[axis]);
      }
    }
    // Replaced rather than resized: a polygon has 3 to 12 corners in retail and
    // a jump happens once per click, so there is nothing here to pool.
    this.geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    this.geometry.computeBoundingSphere();
    this.outline.visible = true;

    // The centroid of the corners rather than of the bounding box: a portal is
    // a flat face, and the box's centre is the same point for a convex one but
    // drifts off the polygon for an L-shaped 7-gon like OldWorld's.
    const at: [number, number, number] = [0, 0, 0];
    for (const corner of corners) {
      for (let axis = 0; axis < 3; axis += 1) at[axis] += corner[axis] / corners.length;
    }
    return { at, bounds: [...min, ...max] };
  }

  /** No finding framed, or the world closed under one. */
  hide(): void {
    this.outline.visible = false;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
