/**
 * The waynet half of the World surface, lifted out of `WorldSurface.tsx`
 * (`docs/plans/level-editor-review-2026-09-04.md` §4 — "waynet edits and
 * derived data" is one of the nine concerns, and the one with the least
 * coupling to the edit core: it needs the payload, the selection and
 * `commitOps`, and nothing else).
 *
 * The hook owns six edits (move, rename, add, join, unjoin, delete) and five
 * derivations (neighbours, spawns, the join resolver, the suggested name, the
 * known names). What each owes its caller is asserted here rather than through
 * the surface, which is what made these unreachable before.
 */

import { describe, test, expect, jest } from '@jest/globals';
import { renderHook, act } from '@testing-library/react';
import type { WaynetPayload } from '../src/shared/worldTypes';
import type { SpawnSite } from '../src/shared/types';
import { useWaynetEditing } from '../src/renderer/components/world/hooks/useWaynetEditing';

/** A three-point net: 0—1 joined, 2 free. Positions are ZenGin centimetres. */
function waynetOf(names: string[], edges: number[] = [0, 1]): WaynetPayload {
  const positions = new Float32Array(names.length * 3);
  names.forEach((_, at) => { positions.set([at * 100, 0, 0], at * 3); });
  return {
    count: names.length,
    names,
    positions: positions.buffer,
    directions: new Float32Array(names.length * 3).buffer,
    waterDepths: new Float32Array(names.length).buffer,
    flags: new Uint32Array(names.length).buffer,
    edgeCount: edges.length / 2,
    edges: new Uint32Array(edges).buffer,
    danglingEdges: 0,
  };
}

const NAMES = ['WP_START', 'WP_MIDDLE', 'FP_LOOSE'];

function mount(overrides: Partial<Parameters<typeof useWaynetEditing>[0]> = {}) {
  const commitOps = jest.fn(async () => true);
  const input = {
    waynet: waynetOf(NAMES),
    selectedWaypoint: 0 as number | null,
    spawnSiteIndex: [] as SpawnSite[],
    waypointSiteIndex: {} as Record<string, unknown>,
    commitOps,
    ...overrides,
  };
  const { result, rerender } = renderHook(
    (props: typeof input) => useWaynetEditing(props),
    { initialProps: input },
  );
  return { result, rerender, commitOps, input };
}

describe('useWaynetEditing — the six edits', () => {
  test('a move commits one op carrying the moved point', () => {
    const { result, commitOps } = mount();
    act(() => { result.current.moveWaypointTo(1, [100, 0, 0], [500, 20, 5]); });
    expect(commitOps).toHaveBeenCalledTimes(1);
    const [ops] = commitOps.mock.calls[0] as [{ op: string }[]];
    expect(ops).toHaveLength(1);
    expect(ops[0].op).toBe('MoveWaypoint');
  });

  test('a rename commits one rename op', () => {
    const { result, commitOps } = mount();
    act(() => { result.current.renameWaypointTo(1, 'WP_RENAMED'); });
    const [ops] = commitOps.mock.calls[0] as [{ op: string }[]];
    expect(ops[0].op).toBe('RenameWaypoint');
  });

  test('an add commits one add op at the point given', () => {
    const { result, commitOps } = mount();
    act(() => { result.current.addWaypointAt('FP_NEW_3', [10, 20, 30]); });
    const [ops] = commitOps.mock.calls[0] as [{ op: string }[]];
    expect(ops[0].op).toBe('AddWaypoint');
  });

  test('a join and an unjoin are the same op the two ways round', () => {
    const { result, commitOps } = mount({ selectedWaypoint: 0 });
    act(() => { result.current.joinWaypointTo(2); });
    act(() => { result.current.unjoinWaypointFrom(1); });

    const join = (commitOps.mock.calls[0] as [Array<Record<string, unknown>>])[0][0];
    const unjoin = (commitOps.mock.calls[1] as [Array<Record<string, unknown>>])[0][0];
    expect(join).toMatchObject({
      op: 'SetWaypointEdge', a: 0, aName: 'WP_START', b: 2, bName: 'FP_LOOSE', to: true, from: false,
    });
    expect(unjoin).toMatchObject({
      op: 'SetWaypointEdge', a: 0, aName: 'WP_START', b: 1, bName: 'WP_MIDDLE', to: false, from: true,
    });
  });

  test('a delete commits one delete op', () => {
    const { result, commitOps } = mount();
    act(() => { result.current.removeWaypoint(2); });
    const [ops] = commitOps.mock.calls[0] as [{ op: string }[]];
    expect(ops[0].op).toBe('DeleteWaypoint');
  });

  test('with no waynet loaded, every edit is a no-op rather than a throw', () => {
    const { result, commitOps } = mount({ waynet: null });
    act(() => {
      result.current.moveWaypointTo(0, [0, 0, 0], [1, 1, 1]);
      result.current.renameWaypointTo(0, 'X');
      result.current.addWaypointAt('X', [0, 0, 0]);
      result.current.joinWaypointTo(1);
      result.current.unjoinWaypointFrom(1);
      result.current.removeWaypoint(0);
    });
    expect(commitOps).not.toHaveBeenCalled();
  });

  test('with nothing selected, the edits that need a selection do nothing', () => {
    const { result, commitOps } = mount({ selectedWaypoint: null });
    act(() => {
      result.current.joinWaypointTo(1);
      result.current.unjoinWaypointFrom(1);
    });
    expect(commitOps).not.toHaveBeenCalled();
    // The three that carry their own index still work.
    act(() => { result.current.removeWaypoint(2); });
    expect(commitOps).toHaveBeenCalledTimes(1);
  });
});

describe('useWaynetEditing — neighbours', () => {
  test('an edge is reported from either end', () => {
    const fromLeft = mount({ selectedWaypoint: 0 });
    expect(fromLeft.result.current.waypointEdges)
      .toEqual([{ waypoint: 1, name: 'WP_MIDDLE' }]);

    const fromRight = mount({ selectedWaypoint: 1 });
    expect(fromRight.result.current.waypointEdges)
      .toEqual([{ waypoint: 0, name: 'WP_START' }]);
  });

  test('a free point has no neighbours', () => {
    const { result } = mount({ selectedWaypoint: 2 });
    expect(result.current.waypointEdges).toEqual([]);
  });

  test('no selection and no waynet both give an empty list', () => {
    expect(mount({ selectedWaypoint: null }).result.current.waypointEdges).toEqual([]);
    expect(mount({ waynet: null }).result.current.waypointEdges).toEqual([]);
  });
});

describe('useWaynetEditing — the join resolver', () => {
  test('a name is matched case-insensitively', () => {
    const { result } = mount({ selectedWaypoint: 0 });
    expect(result.current.resolveWaypointToJoin('fp_loose')).toBe(2);
    expect(result.current.resolveWaypointToJoin('  FP_Loose  ')).toBe(2);
  });

  test('the selection itself will not join to itself', () => {
    const { result } = mount({ selectedWaypoint: 0 });
    expect(result.current.resolveWaypointToJoin('WP_START')).toBeNull();
  });

  test('a waypoint already joined is refused, so the button is dead', () => {
    const { result } = mount({ selectedWaypoint: 0 });
    expect(result.current.resolveWaypointToJoin('WP_MIDDLE')).toBeNull();
  });

  test('an empty or unknown name resolves to nothing', () => {
    const { result } = mount({ selectedWaypoint: 0 });
    expect(result.current.resolveWaypointToJoin('')).toBeNull();
    expect(result.current.resolveWaypointToJoin('   ')).toBeNull();
    expect(result.current.resolveWaypointToJoin('WP_NOT_HERE')).toBeNull();
  });
});

describe('useWaynetEditing — spawns at the selection', () => {
  const sites: SpawnSite[] = [
    { instance: 'PC_HERO', spawnPoint: 'WP_START', filePath: 'a.d', functionName: 'STARTUP', line: 1 },
    { instance: 'ORC', spawnPoint: 'WP_MIDDLE', filePath: 'a.d', functionName: 'STARTUP', line: 2 },
  ];

  test('only the selected point\'s spawns are reported', () => {
    const { result } = mount({ selectedWaypoint: 0, spawnSiteIndex: sites });
    expect(result.current.waypointSpawns.map((s) => s.instance)).toEqual(['PC_HERO']);
  });

  test('the index is matched uppercase, whatever casing the payload carries', () => {
    const { result } = mount({
      waynet: waynetOf(['wp_start', 'WP_MIDDLE', 'FP_LOOSE']),
      selectedWaypoint: 0,
      spawnSiteIndex: sites,
    });
    expect(result.current.waypointSpawns.map((s) => s.instance)).toEqual(['PC_HERO']);
  });
});

describe('useWaynetEditing — the suggested name', () => {
  test('it is an FP_ name the world has not got', () => {
    const { result } = mount();
    expect(result.current.suggestedWaypointName()).toBe('FP_NEW_3');
  });

  test('it starts at the count, so a shorter net is not re-scanned', () => {
    const { result } = mount({ waynet: waynetOf(['A', 'B', 'C', 'FP_NEW_0', 'FP_NEW_1']) });
    expect(result.current.suggestedWaypointName()).toBe('FP_NEW_5');
  });

  test('it steps past the name at the count when that one is taken', () => {
    // Three points, and `FP_NEW_3` is one of them — the suggestion has to move.
    const { result } = mount({ waynet: waynetOf(['A', 'B', 'FP_NEW_3']) });
    expect(result.current.suggestedWaypointName()).toBe('FP_NEW_4');
  });

  test('with no waynet it still offers a name', () => {
    const { result } = mount({ waynet: null });
    expect(result.current.suggestedWaypointName()).toBe('FP_NEW_0');
  });
});

describe('useWaynetEditing — the names scripts call for', () => {
  test('the project index\'s keys, sorted', () => {
    const { result } = mount({
      waypointSiteIndex: { WP_ZEBRA: [], WP_ALPHA: [], WP_MIDDLE: [] },
    });
    expect(result.current.knownWaypointNames).toEqual(['WP_ALPHA', 'WP_MIDDLE', 'WP_ZEBRA']);
  });
});
