import * as THREE from 'three';
import type { ZenBounds } from 'zen-world';

// The selection, drawn as a box around each selected VOB — Spacer's picture.
//
// The alternative to the orange outline the screen-space pass draws around a
// selected VOB (`WorldScene`'s `SelectionStyle`, a toolbar switch). A box says
// the same thing in every outline mode, reads on a VOB that fills the screen,
// and is the VOB's actual extent: the world AABB of its visual placed by its
// pose, which is exactly what a stored `bbox` is (`placeBounds`, zen-world).
//
// One `LineSegments` for the whole selection, 12 edges per box. It hangs under
// the mirrored root with everything else, so the boxes it is given are ZenGin
// centimetres, and it sits on layer 0 — drawn after the outline composite, with
// the world's depth restored, so a wall in front of the VOB hides the box the
// way it hides the VOB.

/** `VobOutline`'s selection orange: never the gizmo's red, green or blue. */
export const SELECTION_BOX_COLOR = 0xff8c1f;

/** The twelve edges of a box, as pairs of corner numbers — bit 0 picks x's
 *  max, bit 1 y's, bit 2 z's. */
const EDGES: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [2, 3], [4, 5], [6, 7],
  [0, 2], [1, 3], [4, 6], [5, 7],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

export class SelectionBox {
  readonly lines: THREE.LineSegments;
  /** What is drawn now, ZenGin min/max — empty while hidden. */
  boxes: readonly ZenBounds[] = [];
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material = new THREE.LineBasicMaterial({ color: SELECTION_BOX_COLOR });

  constructor() {
    this.lines = new THREE.LineSegments(this.geometry, this.material);
    this.lines.visible = false;
    // An annotation, not geometry: a pick goes through it.
    this.lines.raycast = () => {};
    // Its positions are rewritten on every selection change and drag frame, so
    // a sphere computed once would cull a box that moved out of it.
    this.lines.frustumCulled = false;
  }

  /** Draw exactly these boxes; none hides the overlay. */
  show(boxes: readonly ZenBounds[]): void {
    if (boxes.length === 0) { this.hide(); return; }
    this.boxes = boxes;

    const points = new Float32Array(boxes.length * EDGES.length * 2 * 3);
    let at = 0;
    for (const box of boxes) {
      for (const edge of EDGES) {
        for (const corner of edge) {
          points[at++] = corner & 1 ? box[3] : box[0];
          points[at++] = corner & 2 ? box[4] : box[1];
          points[at++] = corner & 4 ? box[5] : box[2];
        }
      }
    }
    // Replaced rather than resized: a selection is a handful of VOBs.
    this.geometry.setAttribute('position', new THREE.BufferAttribute(points, 3));
    this.lines.visible = true;
  }

  hide(): void {
    this.boxes = [];
    this.lines.visible = false;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
