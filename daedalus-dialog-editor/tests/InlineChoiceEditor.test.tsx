import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import InlineChoiceEditor from '../src/renderer/components/InlineChoiceEditor';
import type { SemanticModel, DialogFunction } from '../src/renderer/types/global';

// Mock ActionsList to avoid DnD dependencies (same pattern as ConditionalActionRenderer.test.tsx)
jest.mock('../src/renderer/components/ActionsList', () => ({
  __esModule: true,
  default: ({ actions, contextId }: any) => (
    <div data-testid={`actions-list-${contextId}`}>{actions.length} actions</div>
  )
}));

// Mock editorStore
jest.mock('../src/renderer/store/editorStore', () => ({
  useEditorStore: (selector: any) => {
    const state = {
      updateFunction: jest.fn(),
      updateFunctionWithUpdater: jest.fn(),
      renameFunction: jest.fn(),
    };
    return selector(state);
  }
}));

const testFunction: DialogFunction = {
  name: 'DIA_Test_Yes',
  returnType: 'VOID',
  actions: [
    { type: 'DialogLine', speaker: 'self', text: 'Hello there', id: 'DIA_Test_Yes_self_0_0' },
    { type: 'DialogLine', speaker: 'other', text: 'Hi back', id: 'DIA_Test_Yes_other_1_0' },
  ],
  conditions: [],
  calls: [],
};

const testModel: SemanticModel = {
  dialogs: {},
  functions: { DIA_Test_Yes: testFunction },
  hasErrors: false,
  errors: [],
};

describe('InlineChoiceEditor', () => {
  test('renders target function actions', () => {
    render(
      <InlineChoiceEditor
        targetFunctionName="DIA_Test_Yes"
        dialogName="DIA_Test"
        filePath="/test/file.d"
        semanticModel={testModel}
        npcName="TestNPC"
      />
    );
    expect(screen.getByText('DIA_Test_Yes')).toBeInTheDocument();
    expect(screen.getByTestId('actions-list-DIA_Test_Yes')).toHaveTextContent('2 actions');
  });

  test('shows empty state when function has no actions', () => {
    const emptyModel: SemanticModel = {
      ...testModel,
      functions: {
        DIA_Test_Yes: { ...testFunction, actions: [] }
      },
    };
    render(
      <InlineChoiceEditor
        targetFunctionName="DIA_Test_Yes"
        dialogName="DIA_Test"
        filePath="/test/file.d"
        semanticModel={emptyModel}
        npcName="TestNPC"
      />
    );
    expect(screen.getByText(/no actions/i)).toBeInTheDocument();
  });

  test('shows error when function not found', () => {
    const emptyModel: SemanticModel = {
      ...testModel,
      functions: {},
    };
    render(
      <InlineChoiceEditor
        targetFunctionName="DIA_Test_Missing"
        dialogName="DIA_Test"
        filePath="/test/file.d"
        semanticModel={emptyModel}
        npcName="TestNPC"
      />
    );
    expect(screen.getByText(/not found/i)).toBeInTheDocument();
  });
});
