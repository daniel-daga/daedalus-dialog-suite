/**
 * #494: the quest title edit is a write like the diary entry beside it, so a
 * refused `updateGlobalConstant` must reach the same error banner instead of
 * leaving the field open with nothing on screen.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import QuestDetails from '../src/renderer/components/QuestEditor/QuestDetails';
import { useProjectStore } from '../src/renderer/store/projectStore';
import type { SemanticModel } from '../src/renderer/types/global';

const model = {
  dialogs: {},
  functions: {},
  constants: {
    TOPIC_Title: { name: 'TOPIC_Title', type: 'string', value: 'Old title', filePath: 'quests.d' }
  },
  variables: {},
  instances: {},
  hasErrors: false,
  errors: []
} as unknown as SemanticModel;

describe('QuestDetails title edit', () => {
  it('shows the refusal when the constants write fails', async () => {
    const updateGlobalConstant = jest.fn().mockRejectedValue(new Error('quests.d changed on disk'));
    useProjectStore.setState({ updateGlobalConstant: updateGlobalConstant as never, isLoading: false });

    render(<QuestDetails semanticModel={model} questName="TOPIC_Title" />);

    fireEvent.click(screen.getByTestId('EditIcon').closest('button')!);
    fireEvent.change(screen.getByPlaceholderText('Quest Title'), { target: { value: 'New title' } });
    fireEvent.click(screen.getByTestId('SaveIcon').closest('button')!);

    expect(await screen.findByRole('alert')).toHaveTextContent('quests.d changed on disk');
    expect(updateGlobalConstant).toHaveBeenCalledWith('TOPIC_Title', 'New title', 'quests.d');
    expect(screen.getByPlaceholderText('Quest Title')).toBeInTheDocument();
  });
});
