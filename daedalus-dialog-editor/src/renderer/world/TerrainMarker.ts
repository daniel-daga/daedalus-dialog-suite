import * as THREE from 'three';
import { markerReticleTexture } from './markerSprite';

// Where the last terrain click landed, drawn (level-editor.md §6).
//
// The placement bar names the point in centimetres, and a coordinate triple is
// not somewhere a user can see — "Place VOB here…" has to have a *here*.
//
// Built like the waynet overlay and for the same reasons: it hangs under the
// scene's mirrored root, so its position stays exactly as the pick reported it
// — ZenGin centimetres, unconverted — and it draws with `depthTest: false` at a
// fixed pixel size, because the point worth marking is routinely one inside a
// building or one seen from across the island.
//
// Unlike the waynet it is not pickable, and that is deliberate: `depthTest:
// false` puts it over everything, so a marker that answered a raycast would be
// hit by the terrain pick and report itself instead of the ground under it —
// the click after a placement click would select nothing at all.

/** Bigger than a waypoint's 3.5 px, and a colour the waynet does not use: it is
 *  one dot among thousands whenever the overlay is on. Bigger again since the
 *  reticle arrived — most of the sprite is its gap, so the ink is roughly the
 *  square's old width. */
const SIZE = 16;
const COLOR = 0xff4081;

/** The orbit pivot's own dot. Both markers are on screen at once and routinely
 *  on the same spot, where in one colour they were indistinguishable. */
export const PIVOT_COLOR = 0x40e0ff;
export const PIVOT_SIZE = 12;

/** Over the waynet's 10, so a point picked on top of the net is still visible. */
const RENDER_ORDER = 11;

export class TerrainMarker {
  /** Add this under the scene's converted root, not under the scene. */
  readonly root = new THREE.Group();
  readonly point: THREE.Points;

  private geometry = new THREE.BufferGeometry();
  private material: THREE.PointsMaterial;

  /** @param style the pivot's cyan dot rather than the placement pink one —
   *   see `PIVOT_COLOR`. */
  constructor(
    at: readonly [number, number, number],
    style: { color?: number; size?: number } = {},
  ) {
    this.geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array([at[0], at[1], at[2]]), 3),
    );

    this.material = new THREE.PointsMaterial({
      size: style.size ?? SIZE,
      // Pixels, not world units — a picked point has no size, and one that
      // shrank with distance would be invisible from the viewpoint a placement
      // is usually aimed from.
      sizeAttenuation: false,
      color: style.color ?? COLOR,
      // A ring around a gap around a dot, rather than a filled square: the
      // point being named stays visible through the thing naming it, and the
      // sprite's black rim keeps it readable over bright rock. Shared and
      // never disposed here — see `markerSprite`.
      map: markerReticleTexture(),
      // The sprite is transparent over most of its area, and two markers on
      // the same spot are the ordinary case: without this the nearer one's
      // empty corners blend the far one away.
      alphaTest: 0.1,
      depthTest: false,
      transparent: true,
    });

    this.point = new THREE.Points(this.geometry, this.material);
    this.point.renderOrder = RENDER_ORDER;
    this.point.matrixAutoUpdate = false;
    this.point.frustumCulled = false;
    // Decoration, not geometry: see above. Nothing in the viewport raycasts it
    // today, but nothing in the viewport has to remember not to either.
    this.point.raycast = () => undefined;

    this.root.add(this.point);
    this.root.matrixAutoUpdate = false;
  }

  dispose(): void {
    this.geometry.dispose();
    // Not the material's `map`: it is the app's one reticle, drawn by the
    // pivot marker as well as this one. `Material.dispose` leaves it alone.
    this.material.dispose();
    this.root.clear();
  }
}
