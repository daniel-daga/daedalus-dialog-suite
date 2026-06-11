import React from 'react';
import { render, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { IngestedFilesDialog } from '../src/renderer/components/IngestedFilesDialog';
import { useProjectStore } from '../src/renderer/store/projectStore';

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
});
