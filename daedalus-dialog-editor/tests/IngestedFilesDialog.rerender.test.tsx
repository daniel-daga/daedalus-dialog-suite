import React from 'react';
import { render, act, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { IngestedFilesDialog } from '../src/renderer/components/IngestedFilesDialog';
import { useProjectStore } from '../src/renderer/store/projectStore';

// Mock react-virtualized-auto-sizer to provide dimensions in JSDOM
jest.mock('react-virtualized-auto-sizer', () => ({
  __esModule: true,
  default: ({ children }: any) => children({ height: 500, width: 800 }),
}));

/**
 * Regression test for F7: the object-literal store selector must use shallow
 * equality so unrelated projectStore updates do not re-render the dialog.
 */
describe('IngestedFilesDialog re-render behaviour', () => {
  beforeEach(() => {
    useProjectStore.setState({
      parsedFiles: new Map(),
      allDialogFiles: ['/p/a.d'],
      isIngesting: true,
      selectedNpc: null,
      loadError: null,
    });
  });

  it('does not re-render when an unrelated store field changes', () => {
    let commits = 0;
    const onRender = () => { commits += 1; };

    render(
      <React.Profiler id="ingested" onRender={onRender}>
        <IngestedFilesDialog open onClose={() => {}} />
      </React.Profiler>
    );
    const afterMount = commits;

    // Unrelated field — not part of the dialog's selector
    act(() => {
      useProjectStore.setState({ selectedNpc: 'NPC_Hero' });
    });
    expect(commits).toBe(afterMount);

    // A selected field DOES cause a re-render
    act(() => {
      useProjectStore.setState({ allDialogFiles: ['/p/a.d', '/p/b.d'] });
    });
    expect(commits).toBeGreaterThan(afterMount);
  });

  it('does not re-render on parsedFiles flushes while closed (item E gate)', () => {
    let commits = 0;
    render(
      <React.Profiler id="ingested-closed" onRender={() => { commits += 1; }}>
        <IngestedFilesDialog open={false} onClose={() => {}} />
      </React.Profiler>
    );
    const afterMount = commits;

    // A closed dialog must not re-render when ingestion replaces parsedFiles.
    act(() => {
      useProjectStore.setState({ parsedFiles: new Map([['/p/a.d', {} as never]]) });
    });
    expect(commits).toBe(afterMount);
  });

  it('renders only a bounded number of rows for a large project (virtualized list, P2-2)', () => {
    const parsed = new Map<string, never>();
    const files: string[] = [];
    for (let i = 0; i < 500; i++) {
      const filePath = `/p/file${String(i).padStart(3, '0')}.d`;
      files.push(filePath);
      parsed.set(filePath, {
        filePath,
        semanticModel: { hasErrors: false, errors: [] },
        lastParsed: new Date('2023-01-01T12:00:00'),
      } as never);
    }
    act(() => {
      useProjectStore.setState({ parsedFiles: parsed, allDialogFiles: files });
    });

    render(<IngestedFilesDialog open onClose={() => {}} />);

    // With height 500 and a fixed row size, react-window renders ~10 rows plus
    // overscan — far fewer than the 500 files in the project.
    const rows = screen.getAllByRole('listitem');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(50);
  });

  it('does not rebuild the sorted file list on a re-render without a parsedFiles change (P2-2)', () => {
    // Probe: count Map.get calls — the build reads parsedFiles.get(path) per file.
    const spyMap = (entries: Array<[string, never]>) => {
      const map = new Map(entries);
      let calls = 0;
      const originalGet = map.get.bind(map);
      (map as { get: (key: string) => unknown }).get = (key: string) => {
        calls += 1;
        return originalGet(key);
      };
      return { map, calls: () => calls };
    };

    const parsedEntry = {
      filePath: '/p/a.d',
      semanticModel: { hasErrors: false, errors: [] },
      lastParsed: new Date('2023-01-01T12:00:00'),
    } as never;
    const first = spyMap([['/p/a.d', parsedEntry]]);

    act(() => {
      useProjectStore.setState({
        parsedFiles: first.map,
        allDialogFiles: ['/p/a.d', '/p/b.d'],
        isIngesting: false,
      });
    });

    render(<IngestedFilesDialog open onClose={() => {}} />);
    const afterMount = first.calls();
    expect(afterMount).toBeGreaterThan(0);

    // `isIngesting` is a selected field (the open dialog re-renders) but not an
    // input to the sorted-rows derivation — the memoized build must not re-run.
    act(() => {
      useProjectStore.setState({ isIngesting: true });
    });
    expect(first.calls()).toBe(afterMount);

    // A parsedFiles identity change DOES rebuild (one build per flush).
    const second = spyMap([['/p/a.d', parsedEntry]]);
    act(() => {
      useProjectStore.setState({ parsedFiles: second.map });
    });
    expect(second.calls()).toBeGreaterThan(0);
  });
});
