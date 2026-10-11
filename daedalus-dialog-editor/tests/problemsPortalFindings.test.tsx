/**
 * The world input the portal rule needs, and the re-scan that keeps it
 * current (level-editor.md §16.20 slice 3) — the waynet card's plumbing
 * shape again: the findings reach `worldStore`, the Problems scan reads them
 * the way it reads `waynetNames`, and the scan re-runs when they change.
 *
 * The findings are computed in the zenkit worker, where the mesh is, and
 * cross the IPC as data — including the corners of the one polygon each
 * finding names, which is what makes the row clickable (#222, 2026-09-12).
 *
 * @jest-environment jsdom
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { useWorldStore, worldFocusOf } from '../src/renderer/store/worldStore';
import { useProblemsStore } from '../src/renderer/store/problemsStore';
import { useProjectStore } from '../src/renderer/store/projectStore';
import { initStoreSync } from '../src/renderer/store/storeSync';
import * as scanProjectModule from '../src/renderer/problems/application/scanProject';
import ProblemsList from '../src/renderer/components/Problems/ProblemsList';
import type { PortalFinding } from '../src/shared/worldTypes';
import type { Problem } from '../src/renderer/problems/domain/types';

/** One portal face, as `getPortals` reads it — ZenGin centimetres. */
const CORNERS: ReadonlyArray<readonly [number, number, number]> = [
  [10, 0, 0], [10, 100, 0], [10, 100, 100], [10, 0, 100],
];
const REVERSED: PortalFinding = {
  kind: 'portal-reversed', material: 'P:CAPTAIN_', polygon: 456754, sector: 'CAPTAIN', corners: CORNERS,
};

beforeEach(() => {
  useProjectStore.setState({
    parsedFiles: new Map(), npcList: [], npcPrototypes: [], allDialogFiles: [], waypointSiteIndex: {},
  });
  useWorldStore.getState().reset();
  useProblemsStore.getState().clear();
});

describe('worldStore.portalsLoaded', () => {
  it('holds the findings the worker computed', () => {
    useWorldStore.getState().portalsLoaded([REVERSED]);
    expect(useWorldStore.getState().portalFindings).toEqual([REVERSED]);
  });

  it('keeps a clean world apart from no world', () => {
    // `[]` is a scanned world with nothing wrong; `null` is nothing known.
    useWorldStore.getState().portalsLoaded([]);
    expect(useWorldStore.getState().portalFindings).toEqual([]);
    useWorldStore.getState().portalsLoaded(null);
    expect(useWorldStore.getState().portalFindings).toBeNull();
  });

  it('is cleared when a world opens or the surface resets', () => {
    useWorldStore.getState().portalsLoaded([REVERSED]);
    useWorldStore.getState().beginOpen();
    expect(useWorldStore.getState().portalFindings).toBeNull();

    useWorldStore.getState().portalsLoaded([REVERSED]);
    useWorldStore.getState().reset();
    expect(useWorldStore.getState().portalFindings).toBeNull();
  });
});

describe('the Problems scan over an open world', () => {
  it('lists the portal finding with a polygon locus', () => {
    useWorldStore.getState().portalsLoaded([REVERSED]);

    useProblemsStore.getState().runScan();

    const found = useProblemsStore.getState().problems.filter((p) => p.rule === 'portal-reversed');
    expect(found).toHaveLength(1);
    expect(found[0].locus).toEqual({ kind: 'world', polygon: 456754, polygonCorners: CORNERS });
  });

  it('hands the scan the stored findings rather than recomputing anything', () => {
    useWorldStore.getState().portalsLoaded([REVERSED]);
    const stored = useWorldStore.getState().portalFindings;
    const scanSpy = jest.spyOn(scanProjectModule, 'scanProject');

    useProblemsStore.getState().runScan();

    expect(scanSpy).toHaveBeenCalledTimes(1);
    expect(scanSpy.mock.calls[0][0].portalFindings).toBe(stored);
    scanSpy.mockRestore();
  });

  it('says nothing when no world is open', () => {
    useProblemsStore.getState().runScan();
    expect(useProblemsStore.getState().problems.some((p) => p.rule.startsWith('portal-'))).toBe(false);
  });
});

describe('the re-scan trigger', () => {
  let stopSync: () => void;

  beforeEach(() => {
    jest.useFakeTimers();
    stopSync = initStoreSync();
  });

  afterEach(() => {
    stopSync();
    jest.useRealTimers();
  });

  it('re-scans when the findings arrive', () => {
    useWorldStore.getState().portalsLoaded([REVERSED]);
    jest.runOnlyPendingTimers();

    expect(useProblemsStore.getState().hasScanned).toBe(true);
    expect(useProblemsStore.getState().problems.some((p) => p.rule === 'portal-reversed')).toBe(true);
  });

  it('does not re-scan for an unrelated world change', () => {
    useWorldStore.getState().portalsLoaded([REVERSED]);
    jest.runOnlyPendingTimers();
    useProblemsStore.getState().clear();

    useWorldStore.getState().selectVob(3);
    jest.runOnlyPendingTimers();

    expect(useProblemsStore.getState().hasScanned).toBe(false);
  });
});

const portalProblem = (locus: Problem['locus']): Problem => ({
  id: 'portal-reversed:456754',
  rule: 'portal-reversed',
  severity: 'warning',
  message: 'Portal polygon 456754 ("P:CAPTAIN_") faces away from sector "CAPTAIN".',
  locus,
});

describe('a portal row in the Problems list', () => {
  it('is listed under its own label, and a finding carrying corners is clickable', () => {
    render(
      <ProblemsList
        worldOpen
        onSelect={jest.fn()}
        problems={[portalProblem({ kind: 'world', polygon: 456754, polygonCorners: CORNERS })]}
      />,
    );

    expect(screen.getByText('Portal reversed')).toBeInTheDocument();
    expect(screen.getByText('World · polygon 456754')).toBeInTheDocument();
    expect(screen.getByTestId('problem-row-0')).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('stays unclickable for a name finding no face carries', () => {
    // `P:_` on a material no polygon references: a real finding with nothing
    // to frame, which is the one row that keeps §16.20 slice 3's behaviour.
    render(
      <ProblemsList
        worldOpen
        onSelect={jest.fn()}
        problems={[portalProblem({ kind: 'world' })]}
      />,
    );
    expect(screen.getByTestId('problem-row-0')).toHaveAttribute('aria-disabled', 'true');
  });

  it('stays unclickable while no world is open, corners or not', () => {
    render(
      <ProblemsList
        worldOpen={false}
        onSelect={jest.fn()}
        problems={[portalProblem({ kind: 'world', polygon: 456754, polygonCorners: CORNERS })]}
      />,
    );
    expect(screen.getByTestId('problem-row-0')).toHaveAttribute('aria-disabled', 'true');
  });
});

describe('worldFocusOf over a polygon locus', () => {
  it('asks the World surface to frame the polygon, corners and all', () => {
    expect(worldFocusOf({ kind: 'world', polygon: 456754, polygonCorners: CORNERS }))
      .toEqual({ kind: 'polygon', polygon: 456754, corners: CORNERS });
  });

  it('answers null for a polygon with no corners — there is nothing to frame', () => {
    expect(worldFocusOf({ kind: 'world', polygon: 456754 })).toBeNull();
  });

  it('leaves the VOB and waypoint addresses ahead of it', () => {
    // A locus never carries two addresses, but the order is the contract the
    // panel's click depends on and a polygon must not overtake either.
    expect(worldFocusOf({ kind: 'world', vob: 7, polygon: 1, polygonCorners: CORNERS }))
      .toEqual({ kind: 'vob', vob: 7 });
  });
});
