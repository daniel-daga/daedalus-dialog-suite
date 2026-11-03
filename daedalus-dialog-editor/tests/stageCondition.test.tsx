/**
 * #325 (slice 2): the Stage condition card — a declared `STAGE_` variable read
 * as quest/stage/"reached" / "not reached" / "at least N", written back as the
 * plain `VariableCondition` it was read from.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import ConditionCard from '../src/renderer/components/ConditionCard';
import type { ConditionEditorCondition } from '../src/renderer/components/dialogTypes';
import { useProjectStore } from '../src/renderer/store/projectStore';
import type { SemanticModel } from '../src/renderer/types/global';

const questModel = (overrides: Record<string, unknown> = {}) => ({
  dialogs: {},
  functions: {},
  constants: {
    TOPIC_VerloreneSchafe: { name: 'TOPIC_VerloreneSchafe', type: 'string', value: 'Die verlorenen Schafe', filePath: 'quests.d' }
  },
  variables: {
    MIS_VerloreneSchafe: { name: 'MIS_VerloreneSchafe', type: 'int', filePath: 'quests.d' },
    STAGE_VerloreneSchafe_Sheep: { name: 'STAGE_VerloreneSchafe_Sheep', type: 'int', filePath: 'quests.d' },
    STAGE_VerloreneSchafe_Said: { name: 'STAGE_VerloreneSchafe_Said', type: 'int', filePath: 'quests.d' }
  },
  instances: {},
  hasErrors: false,
  errors: [],
  ...overrides
}) as unknown as SemanticModel;

const seed = (model = questModel()) => useProjectStore.setState({ mergedSemanticModel: model });

const stageCheck = (patch: Record<string, unknown> = {}) => ({
  type: 'VariableCondition',
  variableName: 'STAGE_VerloreneSchafe_Sheep',
  negated: false,
  operator: '>=',
  value: 5,
  getTypeName: () => 'VariableCondition',
  ...patch
}) as unknown as ConditionEditorCondition;

const renderCard = (condition: ConditionEditorCondition) => {
  const updateCondition = jest.fn();
  render(
    <ConditionCard
      condition={condition}
      index={0}
      totalConditions={1}
      updateCondition={updateCondition}
      deleteCondition={jest.fn()}
      focusCondition={jest.fn()}
    />
  );
  return updateCondition;
};

describe('the Stage condition card', () => {
  test('reads a declared stage as that stage, not as a raw variable check', () => {
    seed();
    renderCard(stageCheck());

    expect(screen.getByTestId('stage-condition')).toBeInTheDocument();
    expect(screen.getByText('Stage Sheep at least 5')).toBeInTheDocument();
  });

  test('writes "reached" as == TRUE and "not reached" as == FALSE', () => {
    seed();
    const updateCondition = renderCard(stageCheck({ operator: '==', value: 'TRUE' }));

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Form' }));
    fireEvent.click(screen.getByRole('option', { name: 'Not reached' }));
    expect(updateCondition).toHaveBeenCalledWith(0, expect.objectContaining({
      type: 'VariableCondition', variableName: 'STAGE_VerloreneSchafe_Sheep', operator: '==', value: 'FALSE'
    }));

    updateCondition.mockClear();
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Form' }));
    fireEvent.click(screen.getByRole('option', { name: 'Reached' }));
    expect(updateCondition).toHaveBeenCalledWith(0, expect.objectContaining({ operator: '==', value: 'TRUE' }));
  });

  test('writes "at least N" as >= N for a counter', () => {
    seed();
    const updateCondition = renderCard(stageCheck());

    fireEvent.change(screen.getByLabelText('Count'), { target: { value: '3' } });
    fireEvent.blur(screen.getByLabelText('Count'));

    expect(updateCondition).toHaveBeenCalledWith(0, expect.objectContaining({
      variableName: 'STAGE_VerloreneSchafe_Sheep', operator: '>=', value: 3
    }));
  });

  test('offers the project’s declared stages, by quest title', () => {
    seed();
    renderCard(stageCheck());

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Stage' }));
    const options = screen.getAllByRole('option').map((option) => option.textContent);
    expect(options).toEqual(['Die verlorenen Schafe · Sheep', 'Die verlorenen Schafe · Said']);

    fireEvent.click(screen.getByRole('option', { name: 'Die verlorenen Schafe · Said' }));
    expect(screen.getByRole('combobox', { name: 'Stage' })).toHaveTextContent('Said');
  });

  test('a STAGE_ name no quest declares stays a raw variable check and says so', () => {
    seed();
    renderCard(stageCheck({ variableName: 'STAGE_VerloreneSchafe_Cow' }));

    expect(screen.queryByTestId('stage-condition')).toBeNull();
    expect(screen.getByLabelText('Variable Name')).toBeInTheDocument();
    expect(screen.getByText('Not declared')).toBeInTheDocument();
  });

  test('shows the check it writes', () => {
    seed();
    renderCard(stageCheck());

    fireEvent.click(screen.getByRole('button', { name: 'Show script' }));
    expect(screen.getByTestId('stage-condition-script')).toHaveTextContent('STAGE_VerloreneSchafe_Sheep >= 5');
  });
});
