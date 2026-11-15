/**
 * A world finding's details (#565): the pane names where in the world the
 * finding is, and offers the one explicit way out of Problems to it. The row
 * click itself stays inside Problems (#560).
 *
 * @jest-environment jsdom
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import userEvent from '@testing-library/user-event';
import ProblemDetails from '../src/renderer/components/Problems/ProblemDetails';
import { useUISelectionStore } from '../src/renderer/store/uiSelectionStore';
import { useWorldStore } from '../src/renderer/store/worldStore';
import type { Problem } from '../src/renderer/problems/domain/types';
import { SUMMARY, vobIndex } from './worldFixtures';

const CORNERS: ReadonlyArray<readonly [number, number, number]> = [
  [10, 0, 0], [10, 100, 0], [10, 100, 100], [10, 0, 100],
];
const problem = (locus: Problem['locus']): Problem => ({
  id: 'portal-reversed:P:CAPTAIN_', rule: 'portal-reversed', severity: 'warning', message: 'The full finding', locus,
});
const show = (locus: Problem['locus']) => render(<ProblemDetails problem={problem(locus)} onReload={jest.fn()} />);
const showInWorld = () => screen.queryByRole('button', { name: 'Show in World' });
const openWorld = () => useWorldStore.getState().openSucceeded({
  ...SUMMARY, vobIndex: vobIndex([[0, 0, 0], [10, 20, 30]], 'zCVob', undefined, ['', 'BARREL']),
});

beforeEach(() => {
  useWorldStore.getState().reset();
  useUISelectionStore.getState().setActiveView('problems');
});

describe('a world finding\'s location', () => {
  it('names the polygon and the open world file', () => {
    openWorld();
    show({ kind: 'world', polygon: 1704, polygonCorners: CORNERS });
    expect(screen.getByText('World: C:/Gothic/NewWorld.zen')).toBeInTheDocument();
    expect(screen.getByText('Polygon: 1704')).toBeInTheDocument();
  });

  it('names the waypoint', () => {
    show({ kind: 'world', waypoint: 'WP_MIDDLE' });
    expect(screen.getByText('Waypoint: WP_MIDDLE')).toBeInTheDocument();
  });

  it('names the VOB by index, and by name where the open world has one', () => {
    openWorld();
    show({ kind: 'world', vob: 1 });
    expect(screen.getByText('VOB: 1 (BARREL)')).toBeInTheDocument();
  });

  it('names the VOB by index alone without an open world', () => {
    show({ kind: 'world', vob: 1 });
    expect(screen.getByText('VOB: 1')).toBeInTheDocument();
  });

  it('says so when the finding names no place', () => {
    openWorld();
    show({ kind: 'world' });
    expect(screen.getByText(/names no place/)).toBeInTheDocument();
    expect(showInWorld()).not.toBeInTheDocument();
  });
});

describe('Show in World', () => {
  it.each<[Problem['locus'], unknown]>([
    [{ kind: 'world', polygon: 1704, polygonCorners: CORNERS }, { kind: 'polygon', polygon: 1704, corners: CORNERS }],
    [{ kind: 'world', waypoint: 'WP_MIDDLE' }, { kind: 'waypoint', name: 'WP_MIDDLE' }],
    [{ kind: 'world', vob: 1 }, { kind: 'vob', vob: 1 }],
  ])('requests the focus for %j and switches to the World view', async (locus, focus) => {
    openWorld();
    show(locus);
    expect(useWorldStore.getState().focusRequest).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Show in World' }));
    expect(useWorldStore.getState().focusRequest).toEqual(focus);
    expect(useUISelectionStore.getState().activeView).toBe('world');
  });

  it('is not offered for a polygon without corners: there is nothing to frame', () => {
    openWorld();
    show({ kind: 'world', polygon: 1704 });
    expect(screen.getByText('Polygon: 1704')).toBeInTheDocument();
    expect(showInWorld()).not.toBeInTheDocument();
  });

  it('is disabled, with the reason, while no world is open', () => {
    show({ kind: 'world', waypoint: 'WP_MIDDLE' });
    expect(showInWorld()).toBeDisabled();
    expect(screen.getByText(/Open the world in the World Editor/)).toBeInTheDocument();
    expect(useWorldStore.getState().focusRequest).toBeNull();
    expect(useUISelectionStore.getState().activeView).toBe('problems');
  });

  it('is not offered for a script finding', () => {
    openWorld();
    show({ kind: 'script', filePath: 'Rtn.d', waypoint: 'WP_MIDDLE' });
    expect(showInWorld()).not.toBeInTheDocument();
  });
});
