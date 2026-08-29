import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { SemanticModel } from '../src/shared/types';

const createSimulatorModelSpy = jest.fn();
jest.mock('../src/renderer/simulator/domain/model', () => {
  const actual = jest.requireActual('../src/renderer/simulator/domain/model');
  return {
    ...actual,
    createSimulatorModel: (source: SemanticModel) => {
      createSimulatorModelSpy(source);
      return actual.createSimulatorModel(source);
    }
  };
});

import SimulatorDialog from '../src/renderer/components/Simulator/SimulatorDialog';

const func = (name: string, conditions: any[] = [], actions: any[] = []) => ({
  name, returnType: 'VOID', actions, conditions, calls: []
});

const dialog = (name: string, condition: string, information: string, nr: number) => ({
  name,
  parent: 'C_INFO',
  properties: { npc: 'NPC_Guard', condition, information, nr }
});

const semanticModel = (): SemanticModel => ({
  functions: {
    DIA_Gate_Cond: func('DIA_Gate_Cond', [
      { type: 'VariableCondition', variableName: 'MIS_X', operator: '==', value: 7, negated: false }
    ]),
    DIA_Gate_Info: func('DIA_Gate_Info', [], [
      { type: 'DialogLine', speaker: 'other', text: 'Gated', id: 'GATE_01' }
    ]),
    DIA_Broken_Cond: func('DIA_Broken_Cond')
  },
  dialogs: {
    DIA_Gate: dialog('DIA_Gate', 'DIA_Gate_Cond', 'DIA_Gate_Info', 10),
    DIA_Broken: dialog('DIA_Broken', 'DIA_Broken_Cond', 'DIA_Missing_Info', 20)
  },
  variables: { MIS_X: { name: 'MIS_X' } },
  constants: {},
  instances: {}
} as unknown as SemanticModel);

describe('SimulatorDialog', () => {
  beforeEach(() => createSimulatorModelSpy.mockClear());

  it('projects nothing while it is closed', () => {
    const model = semanticModel();
    const { rerender } = render(
      <SimulatorDialog open={false} semanticModel={model} dialogName="DIA_Gate" npcName="NPC_Guard" onClose={jest.fn()} />
    );
    expect(createSimulatorModelSpy).not.toHaveBeenCalled();

    // A new semantic-model identity while closed must not re-project either.
    rerender(
      <SimulatorDialog open={false} semanticModel={semanticModel()} dialogName="DIA_Gate" npcName="NPC_Guard" onClose={jest.fn()} />
    );
    expect(createSimulatorModelSpy).not.toHaveBeenCalled();

    rerender(
      <SimulatorDialog open semanticModel={model} dialogName="DIA_Gate" npcName="NPC_Guard" onClose={jest.fn()} />
    );
    expect(createSimulatorModelSpy).toHaveBeenCalledTimes(1);
  });

  it('explains a launch that could not start instead of showing an empty transcript', () => {
    render(
      <SimulatorDialog open semanticModel={semanticModel()} dialogName="DIA_Gate" npcName="NPC_Guard" onClose={jest.fn()} />
    );

    const notice = screen.getByTestId('simulator-launch-failure');
    expect(notice).toHaveTextContent(/DIA_Gate/);
    expect(notice).toHaveTextContent(/false/i);
  });

  it('disables an available entry whose information function is missing, with the reason', () => {
    render(
      <SimulatorDialog open semanticModel={semanticModel()} dialogName="DIA_Gate" npcName="NPC_Guard" onClose={jest.fn()} />
    );

    const entry = screen.getByRole('button', { name: 'DIA_Broken' });
    expect(entry).toBeDisabled();
    expect(screen.getByTestId('simulator-available-dialogs')).toHaveTextContent(/DIA_Missing_Info/);
  });
});
