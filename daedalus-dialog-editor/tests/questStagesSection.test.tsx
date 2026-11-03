/**
 * #325 (slice 1): the Stages section on the quest page and the Stage card that
 * a recognised stage write renders as.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import QuestDetails from '../src/renderer/components/QuestDetails';
import SetVariableActionRenderer from '../src/renderer/components/actionRenderers/SetVariableActionRenderer';
import { createAction } from '../src/renderer/components/actionFactory';
import type { BaseActionRendererProps } from '../src/renderer/components/actionRenderers/types';
import { useProjectStore } from '../src/renderer/store/projectStore';
import { useFileStore } from '../src/renderer/store/fileStore';
import type { DialogAction, SemanticModel } from '../src/renderer/types/global';

const SHEEP_WRITE = {
  type: 'SetVariableAction',
  variableName: 'STAGE_VerloreneSchafe_Sheep',
  operator: '=',
  value: 'STAGE_VerloreneSchafe_Sheep + 1'
} as DialogAction;

const questModel = (overrides: Record<string, unknown> = {}) => ({
  dialogs: {},
  functions: {
    DIA_Bauer_Info: { name: 'DIA_Bauer_Info', filePath: 'dialogs.d', actions: [SHEEP_WRITE] }
  },
  constants: {
    TOPIC_VerloreneSchafe: { name: 'TOPIC_VerloreneSchafe', type: 'string', value: 'Die verlorenen Schafe', filePath: 'quests.d' }
  },
  variables: {
    MIS_VerloreneSchafe: { name: 'MIS_VerloreneSchafe', type: 'int', filePath: 'quests.d', range: { startIndex: 0, endIndex: 29 } },
    STAGE_VerloreneSchafe_Sheep: {
      name: 'STAGE_VerloreneSchafe_Sheep', type: 'int', filePath: 'quests.d', range: { startIndex: 30, endIndex: 66 }
    },
    STAGE_VerloreneSchafe_Said: {
      name: 'STAGE_VerloreneSchafe_Said', type: 'int', filePath: 'quests.d', range: { startIndex: 67, endIndex: 102 }
    }
  },
  instances: {},
  hasErrors: false,
  errors: [],
  ...overrides
}) as unknown as SemanticModel;

const seedStore = (addVariable = jest.fn(), deleteVariable = jest.fn()) => {
  useProjectStore.setState({
    addVariable: addVariable as never,
    deleteVariable: deleteVariable as never,
    isLoading: false,
    mergedSemanticModel: questModel()
  });
  return { addVariable, deleteVariable };
};

describe('the quest page’s Stages section', () => {
  beforeEach(() => {
    useFileStore.setState({ openFiles: new Map() } as never);
  });

  test('lists each declared stage with its kind and its derived target', () => {
    seedStore();
    render(<QuestDetails semanticModel={questModel()} questName="TOPIC_VerloreneSchafe" />);

    const rows = screen.getAllByTestId('quest-stage-item');
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('Sheep'),
      expect.stringContaining('Said')
    ]);
    expect(rows[0]).toHaveTextContent('counter');
    // Sheep counts up once and nothing compares it, so it has no target yet.
    expect(rows[0]).toHaveTextContent('no target');
    expect(rows[1]).toHaveTextContent('flag');
  });

  test('notes the two page-level facts', () => {
    seedStore();
    render(<QuestDetails semanticModel={questModel()} questName="TOPIC_VerloreneSchafe" />);

    expect(screen.getByTestId('stage-note-never-set')).toHaveTextContent('Said');
    expect(screen.getByTestId('stage-note-never-checked')).toHaveTextContent('Sheep');
  });

  test('a stage that is set but never checked does not count as never set', () => {
    seedStore();
    const model = questModel({
      variables: {
        MIS_VerloreneSchafe: { name: 'MIS_VerloreneSchafe', type: 'int', filePath: 'quests.d' },
        STAGE_VerloreneSchafe_Sheep: { name: 'STAGE_VerloreneSchafe_Sheep', type: 'int', filePath: 'quests.d' }
      }
    });
    render(<QuestDetails semanticModel={model} questName="TOPIC_VerloreneSchafe" />);

    expect(screen.getByTestId('stage-note-never-checked')).toHaveTextContent('Sheep');
    expect(screen.queryByTestId('stage-note-never-set')).toBeNull();
  });

  test('adding a stage declares the sanitised stage beside the MIS_ variable', async () => {
    const { addVariable } = seedStore();
    render(<QuestDetails semanticModel={questModel()} questName="TOPIC_VerloreneSchafe" />);

    fireEvent.change(screen.getByLabelText('Stage title'), { target: { value: 'Talked to Greg' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add stage' }));

    await waitFor(() =>
      expect(addVariable).toHaveBeenCalledWith('STAGE_VerloreneSchafe_TalkedToGreg', 'int', undefined, 'quests.d', false)
    );
  });

  test('refuses a stage whose name is already declared, whatever its case', async () => {
    const { addVariable } = seedStore();
    render(<QuestDetails semanticModel={questModel()} questName="TOPIC_VerloreneSchafe" />);

    fireEvent.change(screen.getByLabelText('Stage title'), { target: { value: 'sheep' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add stage' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('STAGE_VerloreneSchafe_Sheep');
    expect(addVariable).not.toHaveBeenCalled();
  });

  test('a quest with no MIS_ cannot own stages', async () => {
    const { addVariable } = seedStore();
    const model = questModel({
      variables: {},
      functions: {}
    });
    render(<QuestDetails semanticModel={model} questName="TOPIC_VerloreneSchafe" />);

    fireEvent.change(screen.getByLabelText('Stage title'), { target: { value: 'Talked to Greg' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add stage' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('MIS_VerloreneSchafe');
    expect(addVariable).not.toHaveBeenCalled();
  });

  test('deleting removes the declaration of a stage nothing writes', async () => {
    const { deleteVariable } = seedStore();
    render(<QuestDetails semanticModel={questModel()} questName="TOPIC_VerloreneSchafe" />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete STAGE_VerloreneSchafe_Said' }));

    await waitFor(() =>
      expect(deleteVariable).toHaveBeenCalledWith('quests.d', { startIndex: 67, endIndex: 102 })
    );
  });

  test('deleting refuses while a write still names the stage', async () => {
    const { deleteVariable } = seedStore();
    render(<QuestDetails semanticModel={questModel()} questName="TOPIC_VerloreneSchafe" />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete STAGE_VerloreneSchafe_Sheep' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('DIA_Bauer_Info');
    expect(deleteVariable).not.toHaveBeenCalled();
  });

  test('deleting refuses while a condition still checks the stage', async () => {    const { deleteVariable } = seedStore();
    const model = questModel({
      variables: {
        MIS_VerloreneSchafe: { name: 'MIS_VerloreneSchafe', type: 'int', filePath: 'quests.d' },
        STAGE_VerloreneSchafe_Said: { name: 'STAGE_VerloreneSchafe_Said', type: 'int', filePath: 'quests.d' }
      },
      functions: {
        DIA_Bauer_Info: {
          name: 'DIA_Bauer_Info',
          actions: [],
          conditions: [
            { type: 'VariableCondition', variableName: 'STAGE_VerloreneSchafe_Said', operator: '==', value: 'TRUE' }
          ]
        }
      }
    });
    render(<QuestDetails semanticModel={model} questName="TOPIC_VerloreneSchafe" />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete STAGE_VerloreneSchafe_Said' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('still checked');
    expect(deleteVariable).not.toHaveBeenCalled();
  });

  // #487: the delete writes from disk, so an open dirty buffer would save the
  // declaration back over it. The stage delete goes through the same guard.
  test('deleting refuses while the declaration file is open with unsaved changes', async () => {
    const { deleteVariable } = seedStore();
    useFileStore.setState({
      openFiles: new Map([['quests.d', { filePath: 'quests.d', isDirty: true }]])
    } as never);
    render(<QuestDetails semanticModel={questModel()} questName="TOPIC_VerloreneSchafe" />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete STAGE_VerloreneSchafe_Said' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('quests.d is open with unsaved changes');
    expect(deleteVariable).not.toHaveBeenCalled();
  });

  test('deleting still removes the declaration while the file is open and clean', async () => {
    const { deleteVariable } = seedStore();
    useFileStore.setState({
      openFiles: new Map([['quests.d', { filePath: 'quests.d', isDirty: false }]])
    } as never);
    render(<QuestDetails semanticModel={questModel()} questName="TOPIC_VerloreneSchafe" />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete STAGE_VerloreneSchafe_Said' }));

    await waitFor(() =>
      expect(deleteVariable).toHaveBeenCalledWith('quests.d', { startIndex: 67, endIndex: 102 })
    );
  });
});

describe('the Stage card', () => {
  const props = (action: DialogAction) => ({
    action,
    path: [0],
    npcName: 'BAU_900_Bauer',
    handleUpdate: jest.fn(),
    handleDelete: jest.fn(),
    flushUpdate: jest.fn(),
    handleKeyDown: jest.fn(),
    mainFieldRef: React.createRef<HTMLInputElement>()
  }) as unknown as BaseActionRendererProps;

  test('the Set Stage menu entry writes one SetVariableAction the card fills in', () => {
    const action = createAction('setStage');
    expect(action).toMatchObject({ type: 'SetVariableAction', variableName: 'STAGE_', operator: '=', value: 'TRUE' });

    seedStore();
    render(<SetVariableActionRenderer {...props(action)} />);
    expect(screen.getByTestId('stage-write-card')).toHaveTextContent('Pick a stage');
  });

  test('a write to a declared stage reads as that stage, with the raw line behind show-script', () => {
    seedStore();
    render(<SetVariableActionRenderer {...props(SHEEP_WRITE)} />);

    const card = screen.getByTestId('stage-write-card');
    expect(card).toHaveTextContent('Sheep');
    expect(card).toHaveTextContent('Counts up');

    fireEvent.click(screen.getByRole('button', { name: 'Show script' }));
    expect(screen.getByTestId('stage-write-script')).toHaveTextContent(
      'STAGE_VerloreneSchafe_Sheep = STAGE_VerloreneSchafe_Sheep + 1;'
    );
  });

  test('a write to a STAGE_ name nobody declares stays a Set Variable and says so', () => {
    seedStore();
    render(<SetVariableActionRenderer {...props({
      type: 'SetVariableAction',
      variableName: 'STAGE_VerloreneSchafe_Cow',
      operator: '=',
      value: 'TRUE'
    } as DialogAction)} />);

    expect(screen.queryByTestId('stage-write-card')).toBeNull();
    expect(screen.getByLabelText('Variable')).toBeInTheDocument();
    expect(screen.getByText('Not declared')).toBeInTheDocument();
  });
});
