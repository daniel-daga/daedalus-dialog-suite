/**
 * The waynet overlay (level-editor.md §6, §4's `getWaynet`).
 *
 * Scene-graph assertions, like `WorldScene.test.ts`: the overlay builds its
 * Three.js objects without a WebGLRenderer, so what would otherwise only be
 * visible in a picture is checkable here.
 *
 * The things that fail silently:
 *
 *   - positions must stay in ZenGin space. The overlay hangs under the same
 *     mirrored root as the world (§7), so converting here would place the
 *     waynet somewhere the world is not — and by a factor of 100, which looks
 *     like "the waynet is missing" rather than like a bug.
 *   - the points and the lines must share one position buffer, or an edge can
 *     point at a waypoint that has moved.
 *   - an edge index out of range is a line to the origin, which reads as a
 *     stray line across the world.
 *
 * @jest-environment jsdom
 */

import * as THREE from 'three';
import type { WaynetPayload } from '../src/shared/worldTypes';
import { WaynetOverlay } from '../src/renderer/world/WaynetOverlay';

/** Four waypoints in ZenGin centimetres, three edges. */
function waynet(overrides: Partial<WaynetPayload> = {}): WaynetPayload {
  return {
    count: 4,
    names: ['FP_FREE', 'WP_A', 'WP_B', 'WP_DEEP'],
    positions: new Float32Array([
      5000, 0, 5000,
      1000, 0, 1000,
      9000, 0, 1000,
      5000, -20000, 1000,
    ]).buffer,
    directions: new Float32Array(4 * 3).buffer,
    waterDepths: new Int32Array([0, 0, 0, 250]).buffer,
    // bit 0 freePoint, bit 1 underWater
    flags: new Uint32Array([1, 0, 0, 2]).buffer,
    edgeCount: 3,
    edges: new Uint32Array([1, 2, 2, 3, 3, 1]).buffer,
    danglingEdges: 0,
    ...overrides,
  };
}

describe('WaynetOverlay', () => {
  it('keeps positions in ZenGin space — the conversion is the scene root', () => {
    const overlay = new WaynetOverlay(waynet());
    const positions = overlay.waypoints.geometry.getAttribute('position');

    // Centimetres, unscaled and unmirrored.
    expect(positions.getX(1)).toBeCloseTo(1000, 5);
    expect(positions.getZ(2)).toBeCloseTo(1000, 5);
    expect(positions.getY(3)).toBeCloseTo(-20000, 5);
    expect(positions.count).toBe(4);
  });

  it('draws the points and the edges from one position buffer', () => {
    // Two buffers can disagree; one cannot.
    const overlay = new WaynetOverlay(waynet());
    expect(overlay.edges.geometry.getAttribute('position'))
      .toBe(overlay.waypoints.geometry.getAttribute('position'));
  });

  it('indexes the edges exactly as the payload does', () => {
    const overlay = new WaynetOverlay(waynet());
    const index = overlay.edges.geometry.getIndex();

    expect(Array.from(index!.array)).toEqual([1, 2, 2, 3, 3, 1]);
    // Two vertices per edge, drawn as segments rather than a strip: a strip
    // would join every waypoint to the next one in the list.
    expect(index!.count).toBe(3 * 2);
    expect(overlay.edges).toBeInstanceOf(THREE.LineSegments);
  });

  it('colours free points and underwater points apart from ordinary ones', () => {
    // A free point is where an NPC can stand but not route through, and an
    // underwater one is a swimming node. Drawing all three the same makes the
    // net unreadable exactly where it matters.
    const overlay = new WaynetOverlay(waynet());
    const colors = overlay.waypoints.geometry.getAttribute('color');
    const at = (i: number) => [colors.getX(i), colors.getY(i), colors.getZ(i)].join(',');

    expect(at(0)).not.toBe(at(1));   // free vs ordinary
    expect(at(3)).not.toBe(at(1));   // underwater vs ordinary
    expect(at(3)).not.toBe(at(0));   // underwater vs free
    expect(at(1)).toBe(at(2));       // two ordinary waypoints agree
  });

  it('draws through the world, because it is an overlay', () => {
    // A waynet inside a building is exactly the one you need to see.
    const overlay = new WaynetOverlay(waynet());
    for (const object of [overlay.waypoints, overlay.edges]) {
      expect((object.material as THREE.Material).depthTest).toBe(false);
      expect(object.renderOrder).toBeGreaterThan(0);
    }
  });

  it('is hidden until it is asked for', () => {
    // It costs a GPU buffer and a draw call; a viewport nobody asked it for
    // should not be paying either.
    const overlay = new WaynetOverlay(waynet());
    expect(overlay.root.visible).toBe(false);

    overlay.setVisible(true);
    expect(overlay.root.visible).toBe(true);
  });

  it('survives a waynet with no edges at all', () => {
    // Not hypothetical: a world under construction has waypoints before it has
    // routes, and `getWaynet` reports that as an empty edge list.
    const overlay = new WaynetOverlay(waynet({
      edgeCount: 0, edges: new Uint32Array([]).buffer,
    }));

    expect(overlay.edges.geometry.getIndex()!.count).toBe(0);
    expect(overlay.waypoints.geometry.getAttribute('position').count).toBe(4);
  });

  // ── the waypoint gizmo's half of the overlay ──────────────────────────────
  //
  // A waypoint move reaches the overlay by two different routes, and they are
  // different on purpose. The *drag preview* is the viewport writing what the
  // gizmo is doing right now — the world in the main process still has the
  // waypoint where it was. An *applied* op is the World surface writing the
  // payload once main has taken it, through `zen-world`'s
  // `applyWaypointPositions`, which is the same function undo and redo go
  // through.

  it('draws out of the payload buffer rather than a copy of it', () => {
    // Load-bearing, and silent when wrong: the surface applies a committed
    // waypoint move to the *payload*, and the overlay is expected to be drawing
    // the very same memory. A copy here would leave the two disagreeing — the
    // file would save the move and the overlay would keep drawing the old
    // position until the world was reopened.
    const payload = waynet();
    const overlay = new WaynetOverlay(payload);
    const attribute = overlay.waypoints.geometry.getAttribute('position');

    expect((attribute.array as Float32Array).buffer).toBe(payload.positions);

    new Float32Array(payload.positions).set([1234, 5678, 9012], 1 * 3);
    expect([attribute.getX(1), attribute.getY(1), attribute.getZ(1)])
      .toEqual([1234, 5678, 9012]);
  });

  it('reports a waypoint position in ZenGin space, for the gizmo to sit on', () => {
    const overlay = new WaynetOverlay(waynet());
    expect(overlay.positionOf(2)).toEqual([9000, 0, 1000]);
  });

  it('previews a drag into the buffer the edges share, and asks for the upload', () => {
    // The edges have to follow: an edge into a waypoint the preview has moved
    // is otherwise a line to where it used to be, for as long as the drag lasts.
    const overlay = new WaynetOverlay(waynet());
    const points = overlay.waypoints.geometry.getAttribute('position');
    const version = points.version;

    overlay.setPosition(1, [2000, 300, 400]);

    expect(overlay.positionOf(1)).toEqual([2000, 300, 400]);
    expect(overlay.edges.geometry.getAttribute('position').getX(1)).toBe(2000);
    // `needsUpdate` is write-only — it bumps `version`, which is what the
    // renderer actually compares. Without it the GPU keeps drawing the buffer
    // it was first handed and the drag is invisible until something else
    // happens to dirty the geometry.
    expect(points.version).toBeGreaterThan(version);
  });

  it('uploads again when the payload was written from outside', () => {
    // The applied path: the surface has already written the payload through
    // `applyWaypointPositions`, so there is nothing for the overlay to write —
    // only the upload to ask for, which nothing else would.
    const payload = waynet();
    const overlay = new WaynetOverlay(payload);
    const points = overlay.waypoints.geometry.getAttribute('position');
    const version = points.version;

    new Float32Array(payload.positions).set([7, 8, 9], 0);
    overlay.refresh();

    expect(points.version).toBeGreaterThan(version);
    expect(overlay.positionOf(0)).toEqual([7, 8, 9]);
  });

  it('refuses a waypoint it does not have', () => {
    // The overlay and the world are two projections of one waynet, and an index
    // that is valid in neither is a bug worth hearing about rather than a
    // silent write past the end of a typed array — which a `Float32Array`
    // drops, leaving the caller told the waypoint moved.
    const overlay = new WaynetOverlay(waynet());

    expect(() => overlay.setPosition(4, [0, 0, 0])).toThrow(/4/);
    expect(() => overlay.positionOf(-1)).toThrow(/-1/);
  });

  it('releases its buffers when disposed', () => {
    const overlay = new WaynetOverlay(waynet());
    const disposed: string[] = [];
    overlay.waypoints.geometry.addEventListener('dispose', () => disposed.push('points'));
    overlay.edges.geometry.addEventListener('dispose', () => disposed.push('edges'));

    overlay.dispose();

    expect(disposed.sort()).toEqual(['edges', 'points']);
    expect(overlay.root.children).toHaveLength(0);
  });
});
