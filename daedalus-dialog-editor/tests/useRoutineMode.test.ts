/**
 * Routine mode's state in the World surface (npc-editor.md §6): which NPC's
 * routines are open, the draft the viewport draws, and the waypoint pick the
 * editor modal hands to the viewport, naming the activity it is for.
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
  const loadWaynet = jest.fn();
  const restoreWaynet = jest.fn();
  const showWaynetForPick = jest.fn(() => restoreWaynet);
  const hook = renderHook(() => useRoutineMode({ waynet: waynetOf(names), loadWaynet, showWaynetForPick }));
  return { hook, loadWaynet, showWaynetForPick, restoreWaynet };
};

describe('useRoutineMode', () => {
  beforeEach(() => {
    useWorldStore.getState().reset();
    // The world as it is on disk: WP_NEW was added this session.
    useWorldStore.getState().waynetSaved(['WP_A']);
  });

  test('opens on an NPC with the waynet read but not drawn, and closes with its draft', () => {
    // The whole waynet on screen reads as every routine's stops (Daniel,
    // 2026-09-30): only the routine is drawn until a pick needs targets.
    const { hook, loadWaynet, showWaynetForPick } = setup();

    act(() => hook.result.current.open('BAU_900_ONAR', 'RTN_START_900'));
    expect(hook.result.current.mode).toEqual({ npc: 'BAU_900_ONAR', routine: 'RTN_START_900' });
    expect(loadWaynet).toHaveBeenCalled();
    expect(showWaynetForPick).not.toHaveBeenCalled();

    act(() => hook.result.current.onDraftChange([], null));
    expect(hook.result.current.draft).toEqual({ entries: [], selected: null });

    act(() => hook.result.current.close());
    expect(hook.result.current.mode).toBeNull();
    expect(hook.result.current.draft).toBeNull();
  });

  test('offers the saved waypoints, sorted', () => {
    useWorldStore.getState().waynetSaved(['WP_Z', 'WP_A']);
    const { hook } = setup();
    expect(hook.result.current.waypoints).toEqual(['WP_A', 'WP_Z']);
  });

  test('a waypoint click during a pick sets the activity\'s waypoint instead of selecting it', () => {
    const { hook, showWaynetForPick, restoreWaynet } = setup();
    const set = jest.fn();

    act(() => hook.result.current.onPickWaypoint(set, { index: 1, state: 'TA_Sleep' }));
    expect(hook.result.current.picking).toBe(true);
    // What the bottom bar says the click is for.
    expect(hook.result.current.pickTarget).toEqual({ index: 1, state: 'TA_Sleep' });
    // The waynet is the pick's targets, so it is drawn for the pick only.
    expect(showWaynetForPick).toHaveBeenCalledTimes(1);
    expect(restoreWaynet).not.toHaveBeenCalled();

    let taken = false;
    act(() => { taken = hook.result.current.takeWaypointPick(0); });
    expect(taken).toBe(true);
    expect(set).toHaveBeenCalledWith('WP_A');
    expect(hook.result.current.picking).toBe(false);
    expect(hook.result.current.pickTarget).toBeNull();
    expect(restoreWaynet).toHaveBeenCalledTimes(1);

    // With no pick pending, the click is the surface's again.
    act(() => { taken = hook.result.current.takeWaypointPick(0); });
    expect(taken).toBe(false);
  });

  test('refuses a waypoint the saved world does not have, and keeps the pick open', () => {
    const { hook } = setup();
    const set = jest.fn();

    act(() => hook.result.current.onPickWaypoint(set, { index: 0, state: 'TA_Sit' }));
    act(() => { hook.result.current.takeWaypointPick(1); });

    expect(set).not.toHaveBeenCalled();
    expect(hook.result.current.pickError).toMatch(/WP_NEW.*save the world/);
    expect(hook.result.current.picking).toBe(true);
  });

  test('an aborted pick puts the waynet back as it was', () => {
    const { hook, restoreWaynet } = setup();

    act(() => hook.result.current.onPickWaypoint(jest.fn(), { index: 0, state: 'TA_Sit' }));
    act(() => hook.result.current.cancelPick());

    expect(hook.result.current.picking).toBe(false);
    expect(restoreWaynet).toHaveBeenCalledTimes(1);
  });
});
