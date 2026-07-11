import React from 'react';
import { render, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import SetVariableActionRenderer from '../src/renderer/components/actionRenderers/SetVariableActionRenderer';
import { SetVariableAction } from '../src/renderer/components/actionTypes';

const mockAutocompleteRender = jest.fn();

// Memoized probe mirroring the real component: VariableAutocomplete is
// React.memo with the default shallow props comparison, so this mock
// re-renders exactly when the renderer hands it a changed prop identity.
// It fails against call sites that pass fresh sx/onChange/textFieldProps
// objects per render (frontend-interaction-latency slice 4).
jest.mock('../src/renderer/components/common/VariableAutocomplete', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  return {
    __esModule: true,
    default: ReactActual.memo((props: any) => {
      mockAutocompleteRender(props);
      return <div data-testid="autocomplete-probe" />;
    })
  };
});

describe('SetVariableActionRenderer autocomplete memo stability', () => {
  const initialAction: SetVariableAction = {
    variableName: 'MIS_Test',
    operator: '=',
    value: 'LOG_RUNNING'
  };

  const stableProps = {
    path: [0],
    index: 0,
    totalActions: 1,
    npcName: 'TestNPC',
    handleUpdate: jest.fn(),
    handleDelete: jest.fn(),
    flushUpdate: jest.fn(),
    handleKeyDown: jest.fn(),
    mainFieldRef: { current: null }
  };

  beforeEach(() => {
    mockAutocompleteRender.mockClear();
  });

  test('parent re-render with unchanged inputs does not re-render the autocomplete', () => {
    let bump: () => void = () => undefined;
    const Harness: React.FC = () => {
      const [, setTick] = React.useState(0);
      bump = () => setTick((t) => t + 1);
      return <SetVariableActionRenderer {...(stableProps as any)} action={initialAction} />;
    };

    render(<Harness />);
    const afterMount = mockAutocompleteRender.mock.calls.length;
    expect(afterMount).toBeGreaterThan(0);

    act(() => bump());

    expect(mockAutocompleteRender.mock.calls.length).toBe(afterMount);
  });

  test('a real action change still re-renders the autocomplete (probe liveness)', () => {
    let setAction: (a: SetVariableAction) => void = () => undefined;
    const Harness: React.FC = () => {
      const [action, set] = React.useState(initialAction);
      setAction = set;
      return <SetVariableActionRenderer {...(stableProps as any)} action={action} />;
    };

    render(<Harness />);
    const afterMount = mockAutocompleteRender.mock.calls.length;

    act(() => setAction({ ...initialAction, variableName: 'MIS_Other' }));

    expect(mockAutocompleteRender.mock.calls.length).toBeGreaterThan(afterMount);
    const lastProps = mockAutocompleteRender.mock.calls[mockAutocompleteRender.mock.calls.length - 1][0];
    expect(lastProps.value).toBe('MIS_Other');
  });
});
