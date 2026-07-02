/**
 * Issue #114 regression: background ingestion updates projectStore.parsedFiles
 * every 500 ms while a project loads. The RegisterTopicDialog form must not
 * re-initialize (and clobber user input) when the suggestion sources update
 * while the form is open.
 */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import RegisterTopicDialog from '../src/renderer/components/RegisterTopicDialog';
import { useProjectStore } from '../src/renderer/store/projectStore';

const emptyModel = () => ({
  dialogs: {}, functions: {}, constants: {}, variables: {},
  instances: {}, items: {}, npcs: {}, animations: {},
  hasErrors: false, errors: []
});

describe('RegisterTopicDialog', () => {
  beforeEach(() => {
    useProjectStore.setState({
      projectPath: 'C:/project',
      parsedFiles: new Map(),
      mergedSemanticModel: emptyModel() as any,
      isLoading: false
    });
  });

  test('keeps user input when parsedFiles updates in the background', () => {
    render(<RegisterTopicDialog open onClose={() => {}} topicName='TOPIC_MeinQuest' />);

    const constantsField = screen.getByLabelText('Quest Definition File (TOPIC_)');
    fireEvent.change(constantsField, { target: { value: 'C:/project/LOG_Constants.d' } });
    const titleField = screen.getByLabelText('Quest Title');
    fireEvent.change(titleField, { target: { value: 'Mein Quest' } });

    // Simulate a background ingestion flush adding newly parsed files
    act(() => {
      useProjectStore.setState({
        parsedFiles: new Map([
          ['C:/project/B_CloseTopicsX.d', {
            filePath: 'C:/project/B_CloseTopicsX.d',
            semanticModel: {
              ...emptyModel(),
              functions: { B_CloseTopicsX: { name: 'B_CloseTopicsX', calls: ['B_CloseTopic'] } }
            },
            lastParsed: new Date()
          } as any]
        ])
      });
    });

    expect(constantsField).toHaveValue('C:/project/LOG_Constants.d');
    expect(titleField).toHaveValue('Mein Quest');
  });
});
