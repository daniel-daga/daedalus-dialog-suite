/**
 * The status bar's counts, and the report behind them (#273).
 *
 * A world whose assets are missing loads and draws holes. `unresolvedByType`
 * was counted and consumed by the scene layers, and nothing ever told the user
 * "these N visuals did not resolve, and here they are" — which for a
 * custom-asset map is the whole diagnosis, and the thing the Spacer report says
 * you go and read zSpy for.
 *
 * @jest-environment jsdom
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import WorldStatusStats from '../src/renderer/components/world/toolbar/WorldStatusStats';
import type { InstancedPayload, WorldSummary } from '../src/shared/worldTypes';

const summary = {
  stats: { vobCount: 41393, worldTriangles: 512000, worldDrawGroups: 120 },
} as unknown as WorldSummary;

const payload = (
  unresolved: Array<{ name: string; type: string; count: number }>,
): InstancedPayload => ({
  visuals: [],
  decals: { quads: [] } as unknown as InstancedPayload['decals'],
  stats: {
    visualsSeen: 10,
    visualsResolved: 10 - unresolved.length,
    vobsPlaced: 38000,
    instancedDrawGroups: 900,
    levelCompos: 3,
    unresolvedByType: unresolved.reduce<Record<string, number>>(
      (acc, entry) => ({ ...acc, [entry.type]: (acc[entry.type] ?? 0) + entry.count }),
      {},
    ),
    unresolved,
  },
});

describe('WorldStatusStats', () => {
  it('says nothing about unresolved assets on a world where everything resolved', () => {
    render(<WorldStatusStats summary={summary} visuals={payload([])} />);

    expect(screen.getByTestId('world-status-stats')).toHaveTextContent('41,393 VOBs');
    expect(screen.queryByTestId('world-unresolved-open')).not.toBeInTheDocument();
  });

  it('says nothing before the visuals payload has arrived', () => {
    // The brief window between the summary landing and the visuals fetch
    // resolving is not a state to report on — nothing is known yet.
    render(<WorldStatusStats summary={summary} visuals={null} />);

    expect(screen.queryByTestId('world-unresolved-open')).not.toBeInTheDocument();
  });

  it('counts the unresolved visuals in the bar and names them on click', () => {
    render(
      <WorldStatusStats
        summary={summary}
        visuals={payload([
          { name: 'GRASSGROUP_01.3DS', type: 'MULTI_RESOLUTION_MESH', count: 412 },
          { name: 'FENCE_MOD.3DS', type: 'MULTI_RESOLUTION_MESH', count: 7 },
        ])}
      />,
    );

    // Distinct visuals, not VOBs: two things to go and find, not 419.
    const open = screen.getByTestId('world-unresolved-open');
    expect(open).toHaveTextContent('2 unresolved');

    fireEvent.click(open);

    const report = screen.getByTestId('world-unresolved-report');
    // The name, its type and how many VOBs wanted it — in the order the scene
    // built them, most-wanted first.
    expect(report).toHaveTextContent('GRASSGROUP_01.3DS');
    expect(report).toHaveTextContent('MULTI_RESOLUTION_MESH');
    expect(report).toHaveTextContent('412');
    expect(report).toHaveTextContent('FENCE_MOD.3DS');
    expect(report.textContent!.indexOf('GRASSGROUP_01.3DS'))
      .toBeLessThan(report.textContent!.indexOf('FENCE_MOD.3DS'));
  });

  it('closes the report again', async () => {
    render(
      <WorldStatusStats
        summary={summary}
        visuals={payload([{ name: 'A.3DS', type: 'MULTI_RESOLUTION_MESH', count: 1 }])}
      />,
    );

    fireEvent.click(screen.getByTestId('world-unresolved-open'));
    fireEvent.click(screen.getByTestId('world-unresolved-close'));

    // The dialog fades out, so it is still mounted for the length of the
    // transition — the assertion is that it goes, not that it goes instantly.
    await waitFor(() => {
      expect(screen.queryByTestId('world-unresolved-report')).not.toBeInTheDocument();
    });
  });

  it('does not offer the report for the two types that never resolve', () => {
    // A decal names a texture and a `.pfx` is a Daedalus instance, so neither
    // is a mesh the VFS could ever answer for — every retail world counts
    // thousands. Reporting them would make the bar shout on a world that is
    // perfectly fine, which is how a warning stops being read.
    render(
      <WorldStatusStats
        summary={summary}
        visuals={payload([
          { name: 'BLOOD.TGA', type: 'DECAL', count: 1405 },
          { name: 'PFX_SMOKE', type: 'PARTICLE_EFFECT', count: 88 },
        ])}
      />,
    );

    expect(screen.queryByTestId('world-unresolved-open')).not.toBeInTheDocument();
  });
});
