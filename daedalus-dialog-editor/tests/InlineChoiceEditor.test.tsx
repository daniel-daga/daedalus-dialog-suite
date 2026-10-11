import React from 'react';
import { render, screen, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import InlineChoiceEditor from '../src/renderer/components/InlineChoiceEditor';
import { useFileStore } from '../src/renderer/store/fileStore';
import { useProjectStore } from '../src/renderer/store/projectStore';
import type { SemanticModel, DialogFunction } from '../src/renderer/types/global';

// Mock ActionsList to avoid DnD dependencies (same pattern as ConditionalActionRenderer.test.tsx)
jest.mock('../src/renderer/components/ActionsList', () => ({
  __esModule: true,
  default: ({ actions, contextId }: any) => (
    <div data-testid={`actions-list-${contextId}`}>{actions.length} actions</div>
  )
}));

const filePath = '/test/file.d';

// InlineChoiceEditor now self-resolves its model from the store (fix-07 §2.8),
// so tests seed the edited file's model there instead of passing a prop.
const setFileModel = (model: SemanticModel) => {
  useFileStore.setState({
    openFiles: new Map([[filePath, { filePath, semanticModel: model } as never]]),
    activeFile: filePath,
  } as never);
  useProjectStore.setState({
    mergedSemanticModel: { dialogs: {}, functions: {}, constants: {}, variables: {}, instances: {}, hasErrors: false, errors: [] },
  } as never);
};

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
    setFileModel(testModel);
    render(
      <InlineChoiceEditor
        targetFunctionName="DIA_Test_Yes"
        dialogName="DIA_Test"
        filePath={filePath}
        npcName="TestNPC"
      />
    );
    expect(screen.getByText('DIA_Test_Yes')).toBeInTheDocument();
    expect(screen.getByTestId('actions-list-DIA_Test_Yes')).toHaveTextContent('2 actions');
  });

  test('shows empty state when function has no actions', () => {
    setFileModel({
      ...testModel,
      functions: {
        DIA_Test_Yes: { ...testFunction, actions: [] }
      },
    });
    render(
      <InlineChoiceEditor
        targetFunctionName="DIA_Test_Yes"
        dialogName="DIA_Test"
        filePath={filePath}
        npcName="TestNPC"
      />
    );
    expect(screen.getByText(/no actions/i)).toBeInTheDocument();
  });

  test('shows error when function not found', () => {
    setFileModel({ ...testModel, functions: {} });
    render(
      <InlineChoiceEditor
        targetFunctionName="DIA_Test_Missing"
        dialogName="DIA_Test"
        filePath={filePath}
        npcName="TestNPC"
      />
    );
    expect(screen.getByText(/not found/i)).toBeInTheDocument();
  });

  test('does not re-render on a no-op / unrelated-category merge (§3d)', () => {
    // Shared category refs so a fresh top-level merged model can preserve the
    // dialogs/functions references (mimics a no-op or unrelated-category merge).
    const sharedDialogs = {} as never;
    const sharedFunctions = {} as never;
    useFileStore.setState({
      openFiles: new Map([[filePath, { filePath, semanticModel: testModel } as never]]),
      activeFile: filePath,
    } as never);
    useProjectStore.setState({
      mergedSemanticModel: {
        dialogs: sharedDialogs, functions: sharedFunctions, constants: {},
        variables: {}, instances: {}, hasErrors: false, errors: [],
      },
    } as never);

    let commits = 0;
    render(
      <React.Profiler id="ice" onRender={() => { commits += 1; }}>
        <InlineChoiceEditor
          targetFunctionName="DIA_Test_Yes"
          dialogName="DIA_Test"
          filePath={filePath}
          npcName="TestNPC"
        />
      </React.Profiler>
    );
    const afterMount = commits;

    // The editor resolves its function from the file model; a merge that hands
    // out a fresh top-level model (dialogs/functions refs preserved) must not
    // reach it.
    act(() => {
      useProjectStore.setState({
        mergedSemanticModel: {
          dialogs: sharedDialogs, functions: sharedFunctions, constants: { NEW_C: {} },
          variables: {}, instances: {}, hasErrors: false, errors: [],
        },
      } as never);
    });
    expect(commits).toBe(afterMount);
  });
});
