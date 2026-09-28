import { waynetGraph, waynetRoute } from '../src/renderer/routines/waynetRoute';
import type { WaynetPayload } from '../src/shared/worldTypes';

// Routine mode draws the way between two stops along the waynet
// (npc-editor.md §6), so a stop the waynet cannot reach shows as having no
// route instead of as a straight line that looks walkable.

/**
 *   A ──── B ──── C          E (joined to nothing)
 *    \           /
 *     ──── D ────            (A–D–C is shorter than A–B–C)
 */
function waynet(): WaynetPayload {
  const names = ['WP_A', 'WP_B', 'WP_C', 'WP_D', 'WP_E'];
  return {
    count: names.length,
    names,
    positions: new Float32Array([
      0, 0, 0,
      1000, 0, 800,
      2000, 0, 0,
      1000, 0, 100,
      9000, 0, 9000,
    ]).buffer,
    directions: new Float32Array(names.length * 3).buffer,
    waterDepths: new Int32Array(names.length).buffer,
    flags: new Uint32Array(names.length).buffer,
    edgeCount: 4,
    edges: new Uint32Array([0, 1, 1, 2, 0, 3, 3, 2]).buffer,
    danglingEdges: 0,
  };
}

describe('waynetRoute', () => {
  it('takes the shortest way over the edges, by distance rather than by hops', () => {
    expect(waynetRoute(waynetGraph(waynet()), 'WP_A', 'WP_C')).toEqual([0, 3, 2]);
  });

  it('matches waypoint names case-insensitively, as Daedalus does', () => {
    expect(waynetRoute(waynetGraph(waynet()), 'wp_c', 'Wp_B')).toEqual([2, 1]);
  });

  it('is the one waypoint when both stops are on it', () => {
    expect(waynetRoute(waynetGraph(waynet()), 'WP_B', 'WP_B')).toEqual([1]);
  });

  it('is null when the waynet has no way there, or does not have the waypoint', () => {
    const graph = waynetGraph(waynet());
    expect(waynetRoute(graph, 'WP_A', 'WP_E')).toBeNull();
    expect(waynetRoute(graph, 'WP_A', 'WP_NOWHERE')).toBeNull();
  });
});
