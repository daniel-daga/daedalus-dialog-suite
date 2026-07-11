import React from 'react';
import { render, act } from '@testing-library/react';
import { useProjectStore } from '../src/renderer/store/projectStore';
import { useVariableOptions, type VariableOption } from '../src/renderer/components/hooks/useVariableOptions';

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

  // Slice 2: the two functions subscriptions are gated on the field's config.
  test('a field without showFunctions/showRoutines does not re-render or rebuild options when only functions churns', () => {
    const stableConstants = { C_A: { name: 'C_A', type: 'int', value: 1, filePath: '/a.d' } };
    const stableVariables = { V_B: { name: 'V_B', type: 'int', filePath: '/b.d' } };
    const stableInstances = {};

    useProjectStore.setState({
      mergedSemanticModel: {
        ...emptyModel,
        constants: stableConstants,
        variables: stableVariables,
        instances: stableInstances,
        functions: { fn_old: { filePath: '/f.d' } }
      }
    } as never);

    let renderCount = 0;
    let lastOptions: unknown = null;
    const Probe = () => {
      // Neither showFunctions nor showRoutines: this field must be deaf to
      // functions churn (the per-keystroke hot path).
      lastOptions = useVariableOptions({});
      renderCount += 1;
      return null;
    };

    render(<Probe />);
    const initialRenders = renderCount;
    const firstOptions = lastOptions;

    // Functions-only churn: brand-new functions object, SAME constants/variables/
    // instances refs (mirrors the category-stable merge; does not depend on the
    // merged model's top-level identity changing).
    act(() => {
      useProjectStore.setState({
        mergedSemanticModel: {
          ...emptyModel,
          constants: stableConstants,
          variables: stableVariables,
          instances: stableInstances,
          functions: { fn_new: { filePath: '/g.d' } }
        }
      } as never);
    });

    expect(renderCount).toBe(initialRenders);
    expect(lastOptions).toBe(firstOptions);
  });

  test('a field WITH showFunctions still re-renders and re-derives when functions churn (gate is conditional, not a blanket cut)', () => {
    const stableConstants = { C_A: { name: 'C_A', type: 'int', value: 1, filePath: '/a.d' } };

    useProjectStore.setState({
      mergedSemanticModel: {
        ...emptyModel,
        constants: stableConstants,
        functions: { fn_old: { filePath: '/f.d' } }
      }
    } as never);

    let renderCount = 0;
    let lastOptions: VariableOption[] = [];
    const Probe = () => {
      lastOptions = useVariableOptions({ showFunctions: true });
      renderCount += 1;
      return null;
    };

    render(<Probe />);
    const initialRenders = renderCount;
    expect(lastOptions.some((o) => o.name === 'fn_old')).toBe(true);

    act(() => {
      useProjectStore.setState({
        mergedSemanticModel: {
          ...emptyModel,
          constants: stableConstants,
          functions: { fn_new: { filePath: '/g.d' } }
        }
      } as never);
    });

    expect(renderCount).toBeGreaterThan(initialRenders);
    expect(lastOptions.some((o) => o.name === 'fn_new')).toBe(true);
    expect(lastOptions.some((o) => o.name === 'fn_old')).toBe(false);
  });
});
