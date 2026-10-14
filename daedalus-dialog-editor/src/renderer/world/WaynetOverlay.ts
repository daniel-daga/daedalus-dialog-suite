import * as THREE from 'three';
import type { MarkerOcclusion } from './VobMarkerLayer';
import { pickPoint, WAYPOINT_PICK_RADIUS } from './pickWaypoint';
import {
  WAYNET_FLAG_FREE_POINT,
  WAYNET_FLAG_UNDER_WATER,
  type WaynetPayload,
} from '../../shared/worldTypes';

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
// The view chooses depth-tested, faint through walls, or fully visible.
// Distance filtering indexes this same position buffer for both points and
// complete edges; the pick uses the same visibility mask.

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
  /**
   * Every waypoint's position, ZenGin centimetres, three floats each — and a
   * **view over the payload's own buffer**, not a copy of it.
   *
   * Public because the viewport picks a waypoint by projecting all of them
   * (`pickWaypoint`), which needs the column rather than one entry at a time.
   *
   * That is what lets a committed waypoint move be applied once, to the
   * payload, by `zen-world`'s `applyWaypointPositions` — the overlay is already
   * drawing that memory. A copy here would need a second write and would be
   * wrong for as long as anybody forgot it.
   */
  readonly positions: Float32Array;
  private camera = new THREE.Vector3();
  private radius = 0;
  private readonly allEdges: Uint32Array;
  private readonly pointIndices: THREE.BufferAttribute;
  private readonly edgeIndices: THREE.BufferAttribute;
  private readonly visible: Uint8Array;
  private readonly faded: THREE.Object3D[] = [];
  private occlusion: MarkerOcclusion = 'full';
  visiblePoints: number[] = [];

  constructor(payload: WaynetPayload) {
    const position = new THREE.BufferAttribute(new Float32Array(payload.positions), 3);
    this.positions = position.array as Float32Array;
    this.allEdges = new Uint32Array(payload.edges);
    this.pointIndices = new THREE.BufferAttribute(new Uint32Array(payload.count), 1);
    this.edgeIndices = new THREE.BufferAttribute(new Uint32Array(this.allEdges.length), 1);
    this.visible = new Uint8Array(payload.count);
    const flags = new Uint32Array(payload.flags);

    const colors = new Float32Array(payload.count * 3);
    for (let point = 0; point < payload.count; point++) {
      const flag = flags[point];
      // Underwater wins over free: a free point that is also underwater is a
      // swimming node, and that is the more surprising fact about it.
      const color = (flag & WAYNET_FLAG_UNDER_WATER) !== 0 ? UNDERWATER
        : (flag & WAYNET_FLAG_FREE_POINT) !== 0 ? FREE
          : ORDINARY;
      colors[point * 3] = color.r;
      colors[point * 3 + 1] = color.g;
      colors[point * 3 + 2] = color.b;
    }

    this.geometry.setAttribute('position', position);
    this.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.geometry.setIndex(this.pointIndices);
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
    this.edgeGeometry.setIndex(this.edgeIndices);
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
    // The faint pass shares the filtered buffers with the solid pass.
    for (const object of [this.waypoints, this.edges]) {
      const material = (object.material as THREE.Material).clone();
      material.depthTest = false;
      material.depthWrite = false;
      material.opacity *= 0.25;
      const faded = object === this.waypoints
        ? new THREE.Points(this.geometry, material)
        : new THREE.LineSegments(this.edgeGeometry, material);
      faded.renderOrder = RENDER_ORDER - 1;
      faded.frustumCulled = false;
      faded.visible = false;
      this.faded.push(faded);
      this.materials.push(material);
      this.root.add(faded);
    }
    this.filterRange();
  }

  setOcclusion(mode: MarkerOcclusion): void {
    this.occlusion = mode;
    for (const object of [this.waypoints, this.edges]) {
      (object.material as THREE.Material).depthTest = mode !== 'full';
    }
    for (const object of this.faded) object.visible = mode === 'faint';
  }

  setView(camera: readonly [number, number, number], radius: number): void {
    if (this.radius === radius && this.camera.x === camera[0]
      && this.camera.y === camera[1] && this.camera.z === camera[2]) return;
    this.camera.set(...camera);
    this.radius = radius;
    this.filterRange();
  }

  isPointVisible(point: number): boolean {
    return this.visible[point] === 1;
  }

  pick(toClip: THREE.Matrix4, x: number, y: number, width: number, height: number,
    inView: (at: readonly [number, number, number]) => boolean): number {
    return pickPoint(this.positions, toClip, x, y, width, height, WAYPOINT_PICK_RADIUS,
      (point) => this.isPointVisible(point)
        && (this.occlusion === 'full' || inView(this.positionOf(point))));
  }

  private filterRange(): void {
    this.visiblePoints = [];
    for (let point = 0; point < this.visible.length; point++) {
      const at = point * 3;
      const distanceSquared = (this.positions[at] - this.camera.x) ** 2
        + (this.positions[at + 1] - this.camera.y) ** 2
        + (this.positions[at + 2] - this.camera.z) ** 2;
      this.visible[point] = this.radius === 0 || distanceSquared <= this.radius ** 2 ? 1 : 0;
      if (this.visible[point] === 1) {
        this.pointIndices.setX(this.visiblePoints.length, point);
        this.visiblePoints.push(point);
      }
    }
    let edges = 0;
    for (let at = 0; at < this.allEdges.length; at += 2) {
      if (!this.isPointVisible(this.allEdges[at]) || !this.isPointVisible(this.allEdges[at + 1])) continue;
      this.edgeIndices.setX(edges++, this.allEdges[at]);
      this.edgeIndices.setX(edges++, this.allEdges[at + 1]);
    }
    this.pointIndices.needsUpdate = true;
    this.edgeIndices.needsUpdate = true;
    this.geometry.setDrawRange(0, this.visiblePoints.length);
    this.edgeGeometry.setDrawRange(0, edges);
  }

  setVisible(visible: boolean): void {
    this.root.visible = visible;
  }

  /** Where a waypoint sits, in ZenGin centimetres — the space the gizmo's proxy
   *  works in, because both hang under the same mirrored root. */
  positionOf(waypoint: number): [number, number, number] {
    const at = this.at(waypoint);
    return [this.positions[at], this.positions[at + 1], this.positions[at + 2]];
  }

  /**
   * Draw a waypoint somewhere else — the gizmo's live preview.
   *
   * The world in the main process still has it where it was; this is the drag
   * being drawn, and it is made real on release, exactly as a VOB drag is. The
   * edges follow for free, because they index this same buffer.
   */
  setPosition(waypoint: number, to: readonly [number, number, number]): void {
    const at = this.at(waypoint);
    this.positions[at] = to[0];
    this.positions[at + 1] = to[1];
    this.positions[at + 2] = to[2];
    this.refresh();
  }

  /**
   * Upload the positions again, after something outside wrote them.
   *
   * That something is the World surface, applying a committed waypoint move —
   * or an undo, or a redo — to the payload through `zen-world`'s
   * `applyWaypointPositions`. This buffer *is* the payload's, so there is
   * nothing to copy across; without the flag the GPU simply keeps drawing what
   * it was first handed.
   */
  refresh(): void {
    this.geometry.getAttribute('position').needsUpdate = true;
    this.filterRange();
  }

  /** The offset of a waypoint's x, or a refusal. A write past the end of a
   *  `Float32Array` is dropped silently, which would leave the caller told the
   *  waypoint moved. */
  private at(waypoint: number): number {
    const at = waypoint * 3;
    if (at < 0 || at + 2 >= this.positions.length) {
      throw new RangeError(`no waypoint ${waypoint} in the overlay`);
    }
    return at;
  }

  dispose(): void {
    this.geometry.dispose();
    this.edgeGeometry.dispose();
    for (const material of this.materials) material.dispose();
    this.materials = [];
    this.root.clear();
  }
}
