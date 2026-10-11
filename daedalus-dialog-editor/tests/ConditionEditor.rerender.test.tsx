/**
 * P2-1: the condition-editing subtree must uphold the ActionCard memo-boundary
 * invariant (docs/architecture/render-performance.md — "model data must not
 * cross this boundary"). ConditionEditor / ConditionCard are React.memo; a
 * churning `semanticModel` prop threaded through them would defeat those memos
 * and re-derive every condition field's ~11k-symbol option pool per keystroke.
 *
 * Probe 1 (memo boundary): an unrelated keystroke-path update — new model +
 * new `functions` identity, but an identity-stable condition function (Immer
 * structural sharing) — must NOT re-render the condition fields' autocomplete
 * leaves. Mock precedent: tests/SetVariableActionRenderer.rerender.test.tsx.
 *
 * Probe 2 (per-dialog UI state): `conditionsExpanded` must reset on dialog
 * switch — the editor stays mounted across switches (render-performance.md,
 * "Editor stays mounted across dialog switches"), so the reset is an explicit
 * effect keyed on `dialogName`, like `propertiesExpanded` in
 * DialogDetailsEditor.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import ConditionSection from '../src/renderer/components/ConditionSection';
import ConditionEditor from '../src/renderer/components/ConditionEditor';
import type { DialogFunction, SemanticModel } from '../src/renderer/types/global';
import type { FunctionUpdater } from '../src/renderer/components/dialogTypes';

const mockAutocompleteRender = jest.fn();

// Memoized probe mirroring the real component: VariableAutocomplete is
// React.memo with the default shallow props comparison, so this mock
// re-renders exactly when a changed prop identity crosses the memo boundary.
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

const makeConditionFunction = (variableName: string): DialogFunction => ({
  name: 'DIA_Test_Condition',
  returnType: 'INT',
  actions: [],
  calls: [],
  conditions: [{ type: 'VariableCondition', variableName, negated: false }]
} as unknown as DialogFunction);

const makeModel = (conditionFunction: DialogFunction): SemanticModel => ({
  dialogs: {
    DIA_Test: {
      name: 'DIA_Test',
      properties: {
        npc: 'TestNPC',
        condition: 'DIA_Test_Condition',
        information: 'DIA_Test_Info'
      }
    }
  },
  functions: { DIA_Test_Condition: conditionFunction },
  constants: {},
  variables: {},
  instances: {},
  hasErrors: false,
  errors: []
} as unknown as SemanticModel);

const noopUpdateFunction: (f: FunctionUpdater) => void = () => undefined;

const Harness: React.FC<{ model: SemanticModel }> = ({ model }) => (
  <ConditionSection
    dialogName="DIA_Test"
    dialog={(model as any).dialogs.DIA_Test}
    semanticModel={model}
    filePath="test.d"
    onUpdateFunction={noopUpdateFunction}
  />
);

describe('ConditionEditor memo boundary (P2-1)', () => {
  beforeEach(() => {
    mockAutocompleteRender.mockClear();
  });

  test('unrelated keystroke-path model churn does not re-render condition autocomplete leaves', () => {
    const conditionFn = makeConditionFunction('MIS_Test');
    const model1 = makeModel(conditionFn);

    const { rerender } = render(<Harness model={model1} />);
    fireEvent.click(screen.getByLabelText('Expand conditions'));

    const afterExpand = mockAutocompleteRender.mock.calls.length;
    expect(afterExpand).toBeGreaterThan(0);

    // Unrelated keystroke: Immer gives the model and its `functions` map fresh
    // identities, but the condition function object itself is untouched
    // (structural sharing) — exactly what an edit to another function produces.
    const model2 = {
      ...model1,
      functions: {
        ...model1.functions,
        DIA_Other_Info: { name: 'DIA_Other_Info', returnType: 'VOID', actions: [], calls: [], conditions: [] }
      }
    } as unknown as SemanticModel;

    rerender(<Harness model={model2} />);

    expect(mockAutocompleteRender.mock.calls.length).toBe(afterExpand);
  });

  test('a real condition change still re-renders the autocomplete (probe liveness)', () => {
    const model1 = makeModel(makeConditionFunction('MIS_Test'));

    const { rerender } = render(<Harness model={model1} />);
    fireEvent.click(screen.getByLabelText('Expand conditions'));
    const afterExpand = mockAutocompleteRender.mock.calls.length;

    const model2 = makeModel(makeConditionFunction('MIS_Other'));
    rerender(<Harness model={model2} />);

    expect(mockAutocompleteRender.mock.calls.length).toBeGreaterThan(afterExpand);
    const lastProps = mockAutocompleteRender.mock.calls[mockAutocompleteRender.mock.calls.length - 1][0];
    expect(lastProps.value).toBe('MIS_Other');
  });
});

describe('conditionsExpanded resets on dialog switch (P2-1)', () => {
  test('switching dialogs collapses the conditions section', () => {
    const fnA = makeConditionFunction('MIS_A');
    const fnB = makeConditionFunction('MIS_B');

    const { rerender } = render(
      <ConditionEditor
        conditionFunction={fnA}
        onUpdateFunction={noopUpdateFunction}
        filePath="a.d"
        dialogName="DIA_A"
      />
    );

    fireEvent.click(screen.getByLabelText('Expand conditions'));
    expect(screen.getByLabelText('Collapse conditions')).toBeInTheDocument();

    // A re-render for the SAME dialog (e.g. an edit) must keep it expanded…
    rerender(
      <ConditionEditor
        conditionFunction={makeConditionFunction('MIS_A2')}
        onUpdateFunction={noopUpdateFunction}
        filePath="a.d"
        dialogName="DIA_A"
      />
    );
    expect(screen.getByLabelText('Collapse conditions')).toBeInTheDocument();

    // …but switching to a different dialog resets to collapsed.
    rerender(
      <ConditionEditor
        conditionFunction={fnB}
        onUpdateFunction={noopUpdateFunction}
        filePath="b.d"
        dialogName="DIA_B"
      />
    );
    expect(screen.getByLabelText('Expand conditions')).toBeInTheDocument();
  });
});
