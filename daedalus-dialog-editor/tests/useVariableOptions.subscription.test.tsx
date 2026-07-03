import React from 'react';
import { render, act } from '@testing-library/react';
import { useProjectStore } from '../src/renderer/store/projectStore';
import { useVariableOptions } from '../src/renderer/components/hooks/useVariableOptions';

const emptyModel = {
  dialogs: {}, functions: {}, constants: {}, variables: {},
  instances: {}, hasErrors: false, errors: []
};

describe('useVariableOptions store subscription granularity', () => {
  beforeEach(() => {
    useProjectStore.setState({
      mergedSemanticModel: { ...emptyModel },
      dialogIndex: new Map(),
      npcList: [],
      routineList: [],
      isIngesting: false
    } as never);
  });

  test('does not re-render consumers when an unrelated projectStore field changes', () => {
    let renderCount = 0;
    const Probe = () => {
      useVariableOptions({});
      renderCount += 1;
      return null;
    };

    render(<Probe />);
    const initialRenders = renderCount;

    // `isIngesting` is not one of the fields useVariableOptions depends on, so
    // flipping it must not re-render autocomplete consumers.
    act(() => {
      useProjectStore.setState({ isIngesting: true } as never);
    });

    expect(renderCount).toBe(initialRenders);
  });

  test('does not re-render or rebuild options when the merged model identity changes but category refs are stable', () => {
    useProjectStore.setState({
      mergedSemanticModel: {
        ...emptyModel,
        constants: { C_A: { name: 'C_A', type: 'int', value: 1, filePath: '/a.d' } },
        variables: { V_B: { name: 'V_B', type: 'int', filePath: '/a.d' } }
      }
    } as never);

    let renderCount = 0;
    let lastOptions: unknown = null;
    const Probe = () => {
      lastOptions = useVariableOptions({});
      renderCount += 1;
      return null;
    };

    render(<Probe />);
    const initialRenders = renderCount;
    const firstOptions = lastOptions;

    // Category-stable merge: new mergedSemanticModel identity, same category refs.
    const prev = useProjectStore.getState().mergedSemanticModel;
    act(() => {
      useProjectStore.setState({ mergedSemanticModel: { ...prev } } as never);
    });

    expect(renderCount).toBe(initialRenders);
    expect(lastOptions).toBe(firstOptions);
  });
});
