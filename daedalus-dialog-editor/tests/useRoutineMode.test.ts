/**
 * Routine mode's state in the World surface (npc-editor.md §6): which NPC's
 * routines are open, the draft the viewport draws, the waypoint pick the panel
 * hands to the viewport, and the menu a click on a spawn marker opens.
 *
 * The pick is the rule worth a test: only a waypoint the world file on disk
 * has may become a stop (Daniel, 2026-09-28), so a click on one added since is
 * refused with a reason rather than written into the script.
 *
 * @jest-environment jsdom
 */

import { describe, test, expect, jest, beforeEach } from '@jest/globals';
import { renderHook, act } from '@testing-library/react';
import type { WaynetPayload } from '../src/shared/worldTypes';
import { useWorldStore } from '../src/renderer/store/worldStore';
import { useRoutineMode } from '../src/renderer/components/world/hooks/useRoutineMode';

function waynetOf(names: string[]): WaynetPayload {
  return {
    count: names.length,
    names,
    positions: new Float32Array(names.length * 3).buffer,
    directions: new Float32Array(names.length * 3).buffer,
    waterDepths: new Int32Array(names.length).buffer,
    flags: new Uint32Array(names.length).buffer,
    edgeCount: 0,
    edges: new Uint32Array(0).buffer,
    danglingEdges: 0,
  };
}

const setup = (names = ['WP_A', 'WP_NEW']) => {
  const ensureWaynetShown = jest.fn();
  const hook = renderHook(() => useRoutineMode({ waynet: waynetOf(names), ensureWaynetShown }));
  return { hook, ensureWaynetShown };
};

describe('useRoutineMode', () => {
  beforeEach(() => {
    useWorldStore.getState().reset();
    // The world as it is on disk: WP_NEW was added this session.
    useWorldStore.getState().waynetSaved(['WP_A']);
  });

  test('opens on an NPC, shows the waynet, and closes with its draft', () => {
    const { hook, ensureWaynetShown } = setup();

    act(() => hook.result.current.open('BAU_900_ONAR', 'RTN_START_900'));
    expect(hook.result.current.mode).toEqual({ npc: 'BAU_900_ONAR', routine: 'RTN_START_900' });
    expect(ensureWaynetShown).toHaveBeenCalled();

    act(() => hook.result.current.onDraftChange([], null));
    expect(hook.result.current.draft).toEqual({ entries: [], selected: null });

    act(() => hook.result.current.close());
    expect(hook.result.current.mode).toBeNull();
    expect(hook.result.current.draft).toBeNull();
  });

  test('takes a request from the NPC editor once', () => {
    const { hook } = setup();

    act(() => useWorldStore.getState().requestRoutine({ npc: 'BAU_900_ONAR' }));

    expect(hook.result.current.mode).toEqual({ npc: 'BAU_900_ONAR' });
    expect(useWorldStore.getState().routineRequest).toBeNull();
  });

  test('offers the saved waypoints, sorted', () => {
    useWorldStore.getState().waynetSaved(['WP_Z', 'WP_A']);
    const { hook } = setup();
    expect(hook.result.current.waypoints).toEqual(['WP_A', 'WP_Z']);
  });

  test('a waypoint click during a pick sets the activity\'s waypoint instead of selecting it', () => {
    const { hook } = setup();
    const set = jest.fn();

    act(() => hook.result.current.onPickWaypoint(set));
    expect(hook.result.current.picking).toBe(true);

    let taken = false;
    act(() => { taken = hook.result.current.takeWaypointPick(0); });
    expect(taken).toBe(true);
    expect(set).toHaveBeenCalledWith('WP_A');
    expect(hook.result.current.picking).toBe(false);

    // With no pick pending, the click is the surface's again.
    act(() => { taken = hook.result.current.takeWaypointPick(0); });
    expect(taken).toBe(false);
  });

  test('refuses a waypoint the saved world does not have, and keeps the pick open', () => {
    const { hook } = setup();
    const set = jest.fn();

    act(() => hook.result.current.onPickWaypoint(set));
    act(() => { hook.result.current.takeWaypointPick(1); });

    expect(set).not.toHaveBeenCalled();
    expect(hook.result.current.pickError).toMatch(/WP_NEW.*save the world/);
    expect(hook.result.current.picking).toBe(true);
  });

  test('a click on a spawn marker opens a menu of who stands there, and choosing one opens its routines', () => {
    const { hook } = setup();

    act(() => hook.result.current.openNpcMenu(['BAU_900_ONAR', 'GRD_200_XARDAS'], { left: 10, top: 20 }));
    expect(hook.result.current.npcMenu).toEqual({ npcs: ['BAU_900_ONAR', 'GRD_200_XARDAS'], at: { left: 10, top: 20 } });

    act(() => hook.result.current.open('GRD_200_XARDAS'));
    expect(hook.result.current.npcMenu).toBeNull();
    expect(hook.result.current.mode).toEqual({ npc: 'GRD_200_XARDAS' });
  });
});
