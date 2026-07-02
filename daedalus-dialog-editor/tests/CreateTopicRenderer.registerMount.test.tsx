/**
 * Perf regression guard: RegisterTopicDialog subscribes to the project store
 * and scans the merged model for file suggestions. One instance is hosted by
 * every Create Topic action card, so it must only be mounted while the form
 * is actually open — otherwise every background-ingestion flush re-runs the
 * project-wide scans in every card.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import CreateTopicRenderer from '../src/renderer/components/actionRenderers/CreateTopicRenderer';
import { useProjectStore } from '../src/renderer/store/projectStore';

const mockRegisterDialogRender = jest.fn((_props: unknown) => null);
jest.mock('../src/renderer/components/RegisterTopicDialog', () => ({
  __esModule: true,
  default: (props: unknown) => mockRegisterDialogRender(props)
}));

const emptyModel = () => ({
  dialogs: {}, functions: {}, constants: {}, variables: {},
  instances: {}, items: {}, npcs: {}, animations: {},
  hasErrors: false, errors: []
});

describe('CreateTopicRenderer register-dialog mounting', () => {
  beforeEach(() => {
    mockRegisterDialogRender.mockClear();
    useProjectStore.setState({ projectPath: 'C:/project' });
  });

  test('mounts RegisterTopicDialog only while the form is open', () => {
    render(
      <CreateTopicRenderer
        action={{ type: 'CreateTopic', topic: 'TOPIC_MeinQuest' } as any}
        handleUpdate={jest.fn()}
        handleDelete={jest.fn()}
        flushUpdate={jest.fn()}
        handleKeyDown={jest.fn()}
        mainFieldRef={React.createRef()}
        semanticModel={emptyModel() as any}
      />
    );

    // Closed: the dialog (and its store subscription/scans) must not exist
    expect(mockRegisterDialogRender).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Register quest in log files' }));
    expect(mockRegisterDialogRender).toHaveBeenCalled();
    expect(mockRegisterDialogRender.mock.calls[0][0]).toMatchObject({
      open: true,
      topicName: 'TOPIC_MeinQuest'
    });
  });
});
