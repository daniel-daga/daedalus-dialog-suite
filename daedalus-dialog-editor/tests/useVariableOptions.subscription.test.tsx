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
});
