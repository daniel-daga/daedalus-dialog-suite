import * as THREE from 'three';
import type { WaynetPayload } from '../../shared/worldTypes';

// The waynet, drawn over the world (level-editor.md §6).
//
// It hangs under the same mirrored root node the world mesh and the VOBs do, so
// its positions stay exactly as `getWaynet` emitted them — ZenGin centimetres,
// unconverted. Converting here would be the second place in the codebase that
// knows the conversion, and getting it wrong puts the waynet a hundred metres
// from the world it describes, which looks like "the waynet is missing".
//
// The points and the edges share ONE position attribute. Two buffers can drift
// apart; one cannot, and an edge that points at a stale waypoint is a line
// across the world with no obvious cause.
//
// It draws with `depthTest: false` on purpose: a waynet inside a building is
// exactly the one worth looking at, and an overlay that terrain hides is an
// overlay that answers nothing.

/** bit 0 freePoint, bit 1 underWater — the packing `getWaynet` documents. */
const FREE_POINT = 0b01;
const UNDER_WATER = 0b10;

// Distinct enough to tell apart at a glance and at a distance: a free point is
// somewhere an NPC stands rather than routes through, and an underwater point
// is a swimming node.
const ORDINARY = new THREE.Color(0x4fc3f7);
const FREE = new THREE.Color(0xffb74d);
const UNDERWATER = new THREE.Color(0x81c784);

const RENDER_ORDER = 10;

export class WaynetOverlay {
  /** Add this under the scene's converted root, not under the scene. */
  readonly root = new THREE.Group();
  readonly waypoints: THREE.Points;
  readonly edges: THREE.LineSegments;

  private geometry = new THREE.BufferGeometry();
  private edgeGeometry = new THREE.BufferGeometry();
  private materials: THREE.Material[] = [];

  constructor(payload: WaynetPayload) {
    const position = new THREE.BufferAttribute(new Float32Array(payload.positions), 3);
    const flags = new Uint32Array(payload.flags);

    const colors = new Float32Array(payload.count * 3);
    for (let point = 0; point < payload.count; point++) {
      const flag = flags[point];
      // Underwater wins over free: a free point that is also underwater is a
      // swimming node, and that is the more surprising fact about it.
      const color = (flag & UNDER_WATER) !== 0 ? UNDERWATER
        : (flag & FREE_POINT) !== 0 ? FREE
          : ORDINARY;
      colors[point * 3] = color.r;
      colors[point * 3 + 1] = color.g;
      colors[point * 3 + 2] = color.b;
    }

    this.geometry.setAttribute('position', position);
    this.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.geometry.computeBoundingSphere();

    const pointMaterial = new THREE.PointsMaterial({
      // Small enough that the edges are still visible under the points with the
      // whole world in frame: NewWorld's 2,959 waypoints at 6 px read as one
      // solid mass, which hides the graph the overlay exists to show.
      size: 3.5,
      // Pixels, not world units: a waypoint has no size, and one that shrinks
      // with distance is invisible from the only viewpoint that shows the net.
      sizeAttenuation: false,
      vertexColors: true,
      depthTest: false,
      transparent: true,
    });
    this.waypoints = new THREE.Points(this.geometry, pointMaterial);
    this.waypoints.renderOrder = RENDER_ORDER;
    this.waypoints.matrixAutoUpdate = false;
    this.waypoints.frustumCulled = false;

    // The same position attribute, indexed as segments. A strip would join
    // every waypoint to the next one in the list, which is not a waynet.
    this.edgeGeometry.setAttribute('position', position);
    this.edgeGeometry.setIndex(new THREE.BufferAttribute(new Uint32Array(payload.edges), 1));
    this.edgeGeometry.computeBoundingSphere();

    const lineMaterial = new THREE.LineBasicMaterial({
      color: 0x90a4ae,
      depthTest: false,
      transparent: true,
      opacity: 0.7,
    });
    this.edges = new THREE.LineSegments(this.edgeGeometry, lineMaterial);
    this.edges.renderOrder = RENDER_ORDER;
    this.edges.matrixAutoUpdate = false;
    this.edges.frustumCulled = false;

    this.materials.push(pointMaterial, lineMaterial);
    this.root.add(this.edges, this.waypoints);
    this.root.matrixAutoUpdate = false;
    // Hidden until asked for: it costs a buffer and two draw calls.
    this.root.visible = false;
  }

  setVisible(visible: boolean): void {
    this.root.visible = visible;
  }

  dispose(): void {
    this.geometry.dispose();
    this.edgeGeometry.dispose();
    for (const material of this.materials) material.dispose();
    this.materials = [];
    this.root.clear();
  }
}
