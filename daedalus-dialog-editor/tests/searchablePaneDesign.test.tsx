import React from 'react';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import QuestList from '../src/renderer/components/QuestList';
import NPCList from '../src/renderer/components/NPCList';
import DialogTree from '../src/renderer/components/DialogTree';
import SearchPanel from '../src/renderer/components/SearchPanel';
import VariableManager from '../src/renderer/components/VariableManager';
import type { SemanticModel } from '../src/renderer/types/global';

const PATTERN = 'searchable-pane-v1';

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
  useSearchStore: () => mockSearchStore,
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
        value: '"Test quest"',
      } as any,
    },
    variables: {},
    functions: {},
    classes: {},
    instances: {},
    dialogs: {},
  } as SemanticModel;

  test('QuestList root has searchable pane pattern marker', () => {
    const { container } = render(
      <QuestList semanticModel={semanticModel} selectedQuest={null} onSelectQuest={jest.fn()} />
    );

    expect(container.querySelector(`[data-ui-pattern="${PATTERN}"]`)).toBeInTheDocument();
  });

  test('NPCList root has searchable pane pattern marker', () => {
    const { container } = render(
      <NPCList
        npcs={['NPC_One']}
        npcMap={new Map([['NPC_One', ['DIA_Test']]])}
        selectedNPC={null}
        onSelectNPC={jest.fn()}
      />
    );

    expect(container.querySelector(`[data-ui-pattern="${PATTERN}"]`)).toBeInTheDocument();
  });

  test('DialogTree root has searchable pane pattern marker', () => {
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

    expect(container.querySelector(`[data-ui-pattern="${PATTERN}"]`)).toBeInTheDocument();
  });

  test('SearchPanel root has searchable pane pattern marker', () => {
    const { container } = render(
      <SearchPanel
        isOpen
        onClose={jest.fn()}
        semanticModel={semanticModel}
        dialogIndex={new Map()}
        onResultClick={jest.fn()}
      />
    );

    expect(container.querySelector(`[data-ui-pattern="${PATTERN}"]`)).toBeInTheDocument();
  });

  test('VariableManager shell has searchable pane pattern marker', () => {
    const { container } = render(<VariableManager />);

    expect(container.querySelector(`[data-ui-pattern="${PATTERN}"]`)).toBeInTheDocument();
  });
});
