/**
 * The World surface survives a navigate-away.
 *
 * `docs/refactoring-targets.md` §8: `mesh`, `visuals` and `waynet` are local
 * state filled only by `openWorld`, and there is no mount-time refetch — so a
 * conditional mount means leaving the World view and coming back leaves the
 * viewport with nothing to draw while `worldStore.status` still says open.
 * Decided 2026-08-28: keep it mounted, the way the dialog view already is, and
 * tell it that it is hidden so its frame loop stops.
 *
 * The lazy load stays: a session that never opens the World view must not pull
 * three.js in, so the surface is mounted from the first visit onwards, not from
 * the first render.
 *
 * @jest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, beforeEach } from '@jest/globals';
import { render, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import MainLayout from '../src/renderer/components/MainLayout';
import { useProjectStore } from '../src/renderer/store/projectStore';
import { useUISelectionStore } from '../src/renderer/store/uiSelectionStore';

jest.mock('../src/renderer/components/ThreeColumnLayout', () => ({
  __esModule: true,
  default: () => null,
}));

const mockSurface = { mounts: 0, unmounts: 0, hidden: [] as boolean[] };
function MockWorldSurface({ hidden }: { hidden?: boolean }) {
  mockSurface.hidden.push(!!hidden);
  React.useEffect(() => {
    mockSurface.mounts += 1;
    return () => { mockSurface.unmounts += 1; };
  }, []);
  return <div data-testid="world-surface" />;
}

jest.mock('../src/renderer/components/world/WorldSurface', () => ({
  __esModule: true,
  default: MockWorldSurface,
}));

const emptyModel = {
  dialogs: {}, functions: {}, constants: {}, variables: {},
  instances: {}, hasErrors: false, errors: []
};

async function setView(view: string) {
  await act(async () => {
    useUISelectionStore.setState({ activeView: view } as never);
  });
}

describe('MainLayout — the World surface stays mounted', () => {
  beforeEach(() => {
    mockSurface.mounts = 0;
    mockSurface.unmounts = 0;
    mockSurface.hidden = [];
    useUISelectionStore.setState({ activeView: 'dialog' } as never);
    useProjectStore.setState({
      projectPath: '/proj',
      mergedSemanticModel: { ...emptyModel },
      isIngesting: false,
      isLoading: false,
    } as never);
  });

  it('mounts it on the first visit, and never unmounts it after', async () => {
    const { queryByTestId, unmount } = render(<MainLayout filePath={null} />);

    // Not before the first visit: the lazy chunk is the point.
    expect(queryByTestId('world-surface')).toBeNull();
    expect(mockSurface.mounts).toBe(0);

    await setView('world');
    expect(mockSurface.mounts).toBe(1);
    expect(mockSurface.hidden[mockSurface.hidden.length - 1]).toBe(false);

    await setView('dialog');
    expect(mockSurface.unmounts).toBe(0);
    expect(queryByTestId('world-surface')).not.toBeNull();
    // Hidden, and told so — a mounted viewport that goes on drawing is worse
    // than the geometry loss this fixes.
    expect(mockSurface.hidden[mockSurface.hidden.length - 1]).toBe(true);

    await setView('world');
    expect(mockSurface.mounts).toBe(1);
    expect(mockSurface.hidden[mockSurface.hidden.length - 1]).toBe(false);

    unmount();
  });

  it('hides it with display rather than a conditional', async () => {
    const { getByTestId } = render(<MainLayout filePath={null} />);
    await setView('world');

    const container = getByTestId('world-surface').parentElement as HTMLElement;
    expect(container).toHaveStyle({ display: 'block' });

    await setView('quest');
    expect(container).toHaveStyle({ display: 'none' });
  });
});
