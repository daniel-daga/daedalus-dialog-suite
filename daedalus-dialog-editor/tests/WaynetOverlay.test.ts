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
