import React from 'react';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import QuestList from '../src/renderer/components/QuestEditor/QuestList';
import NPCList from '../src/renderer/components/NPCList';
import DialogTree from '../src/renderer/components/DialogTree';
import SearchPanel from '../src/renderer/components/SearchPanel';
import VariableManager from '../src/renderer/components/VariableManager';
import type { SemanticModel } from '../src/renderer/types/global';

const PATTERN = 'searchable-pane-v1';

/**
 * The pane look the shared `searchablePaneShellSx` stands for, as it renders:
 * a column-flex pane with no corner radius, a solid border, and the paper
 * background at 96% opacity. Asserted as computed style, so a pane that drops
 * the shared shell for its own colours/layout fails here.
 */
const expectPaneShell = (el: Element | null) => {
  expect(el).toHaveStyle({
    display: 'flex',
    flexDirection: 'column',
    minHeight: '0',
    borderRadius: '0',
    borderStyle: 'solid',
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
  });
};

const mockSearchStore = {
  npcFilter: '',
  setNpcFilter: jest.fn(),
  filterNpcs: (npcs: string[]) => npcs,
  dialogFilter: '',
  setDialogFilter: jest.fn(),
  filterDialogs: (dialogs: string[]) => dialogs,
  searchQuery: '',
  setSearchQuery: jest.fn(),
  clearSearch: jest.fn(),
  searchResults: [],
  isSearching: false,
  performSearch: jest.fn(),
};

const projectStoreState = {
  mergedSemanticModel: {
    constants: {},
    variables: {},
  },
  deleteVariable: jest.fn(),
  addVariable: jest.fn().mockResolvedValue(undefined),
  questFiles: ['Content/Story/Quests/QUESTS.d'],
  allDialogFiles: ['Content/Story/Dialoge/DIA_Test.d'],
  isLoading: false,
};

jest.mock('../src/renderer/store/searchStore', () => ({
  useSearchStore: (selector?: (s: any) => any) => selector ? selector(mockSearchStore) : mockSearchStore,
}));

jest.mock('../src/renderer/hooks/useNavigation', () => ({
  useNavigation: () => ({
    navigateToSymbol: jest.fn(),
  }),
}));

jest.mock('../src/renderer/store/projectStore', () => ({
  useProjectStore: (selector?: (state: any) => any) => selector ? selector(projectStoreState) : projectStoreState,
}));

jest.mock('react-virtualized-auto-sizer', () => ({
  __esModule: true,
  default: ({ children }: any) => children({ height: 500, width: 300 }),
}));

describe('Searchable pane design language', () => {
  const semanticModel: SemanticModel = {
    constants: {
      TOPIC_TEST_QUEST: {
        name: 'TOPIC_TEST_QUEST',
        type: 'const string',
        value: 'Test quest',
      } as any,
    },
    variables: {},
    functions: {},
    classes: {},
    instances: {},
    dialogs: {},
  } as unknown as SemanticModel;

  test('QuestList root renders the searchable pane shell', () => {
    const { container } = render(
      <QuestList semanticModel={semanticModel} selectedQuest={null} onSelectQuest={jest.fn()} />
    );

    expectPaneShell(container.querySelector(`[data-ui-pattern="${PATTERN}"]`));
  });

  test('NPCList root renders the searchable pane shell', () => {
    const { container } = render(
      <NPCList
        npcs={['NPC_One']}
        npcMap={new Map([['NPC_One', ['DIA_Test']]])}
        selectedNPC={null}
        onSelectNPC={jest.fn()}
      />
    );

    expectPaneShell(container.querySelector(`[data-ui-pattern="${PATTERN}"]`));
  });

  test('DialogTree root renders the searchable pane shell', () => {
    const { container } = render(
      <DialogTree
        selectedNPC={null}
        dialogsForNPC={[]}
        semanticModel={semanticModel}
        selectedDialog={null}
        selectedFunctionName={null}
        expandedDialogs={new Set()}
        expandedChoices={new Set()}
        onSelectDialog={jest.fn()}
        onToggleDialogExpand={jest.fn()}
        onToggleChoiceExpand={jest.fn()}
        buildFunctionTree={jest.fn().mockReturnValue(null)}
      />
    );

    expectPaneShell(container.querySelector(`[data-ui-pattern="${PATTERN}"]`));
  });

  test('SearchPanel root renders the searchable pane shell', () => {
    const { container } = render(
      <SearchPanel
        isOpen
        onClose={jest.fn()}
        semanticModel={semanticModel}
        dialogIndex={new Map()}
        onResultClick={jest.fn()}
      />
    );

    expectPaneShell(container.querySelector(`[data-ui-pattern="${PATTERN}"]`));
  });

  test('VariableManager panes render the searchable pane shell', () => {
    // The pattern marker sits on the page wrapper here; the shell is on its panes.
    const { container } = render(<VariableManager />);

    const panes = container.querySelectorAll('.MuiPaper-root');
    expect(panes.length).toBeGreaterThan(0);
    panes.forEach(expectPaneShell);
  });
});
