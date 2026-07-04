import React from 'react';
import { describe, it, expect, beforeEach } from '@jest/globals';
import { render, act } from '@testing-library/react';
import VariableManager from '../src/renderer/components/VariableManager';
import { useProjectStore } from '../src/renderer/store/projectStore';

/**
 * §2.4 test 5: VariableManager subscribes to `mergedSemanticModel.constants`
 * and `mergedSemanticModel.variables` (not the whole model), so a merge that
 * produces a new `mergedSemanticModel` identity while keeping the same
 * constants/variables references (an edit that only touched functions) must
 * not re-render it or rebuild+re-sort its list. Fails pre-fix on the
 * selector-less `useProjectStore()` subscription.
 */
describe('VariableManager re-render granularity', () => {
  beforeEach(() => {
    useProjectStore.setState({
      mergedSemanticModel: {
        dialogs: {},
        functions: {},
        constants: { C_A: { name: 'C_A', type: 'int', value: 1, filePath: '/a.d' } },
        variables: { V_B: { name: 'V_B', type: 'int', filePath: '/a.d' } },
        instances: {},
        hasErrors: false,
        errors: []
      },
      deleteVariable: jest.fn(),
      questFiles: [],
      allDialogFiles: [],
      addVariable: jest.fn(),
      isLoading: false
    } as never);
  });

  it('does not re-render when the merged model identity changes but constants/variables refs are stable', () => {
    let commits = 0;
    render(
      <React.Profiler id="varmgr" onRender={() => { commits += 1; }}>
        <VariableManager />
      </React.Profiler>
    );
    const afterMount = commits;

    // Mimic a category-stable merge: new top-level identity, same category refs.
    const prev = useProjectStore.getState().mergedSemanticModel;
    act(() => {
      useProjectStore.setState({ mergedSemanticModel: { ...prev } } as never);
    });
    expect(commits).toBe(afterMount);

    // A genuine constants change DOES re-render.
    act(() => {
      useProjectStore.setState({
        mergedSemanticModel: { ...prev, constants: { ...prev.constants } }
      } as never);
    });
    expect(commits).toBeGreaterThan(afterMount);
  });
});
