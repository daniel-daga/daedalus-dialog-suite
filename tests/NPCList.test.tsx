import React from 'react';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NPCList from '../src/renderer/components/NPCList';
import '@testing-library/jest-dom';

// We need to mock the store hook to return values we can control
let mockNpcFilter = '';
const mockSetNpcFilter = jest.fn((val) => {
  mockNpcFilter = val;
});

jest.mock('../src/renderer/store/searchStore', () => ({
  useSearchStore: () => ({
    npcFilter: mockNpcFilter,
    setNpcFilter: mockSetNpcFilter,
    filterNpcs: (npcs: string[]) => npcs.filter(n => n.toLowerCase().includes(mockNpcFilter.toLowerCase())),
  }),
}));

// Mock react-virtualized-auto-sizer
jest.mock('react-virtualized-auto-sizer', () => ({
  __esModule: true,
  default: ({ children }: any) => children({ height: 500, width: 250 }),
}));

describe('NPCList', () => {
  const mockNpcs = ['Diego', 'Gorn', 'Milten', 'Lester'];
  const mockNpcMap = new Map([
    ['Diego', ['Dialog1']],
    ['Gorn', ['Dialog2']],
    ['Milten', ['Dialog3']],
    ['Lester', ['Dialog4']],
  ]);
  const mockOnSelectNPC = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockNpcFilter = '';
    mockSetNpcFilter.mockClear();
  });

  it('renders filter input', () => {
    render(
      <NPCList
        npcs={mockNpcs}
        npcMap={mockNpcMap}
        selectedNPC={null}
        onSelectNPC={mockOnSelectNPC}
      />
    );
    expect(screen.getByPlaceholderText('Filter NPCs...')).toBeInTheDocument();
  });

  it('updates filter on input', async () => {
    const user = userEvent.setup();
    render(
      <NPCList
        npcs={mockNpcs}
        npcMap={mockNpcMap}
        selectedNPC={null}
        onSelectNPC={mockOnSelectNPC}
      />
    );

    const input = screen.getByPlaceholderText('Filter NPCs...');
    await user.type(input, 'D');

    expect(mockSetNpcFilter).toHaveBeenCalledWith('D');
  });

  it('shows clear button when filter is active and clears on click', async () => {
    const user = userEvent.setup();

    // Start with a filter
    mockNpcFilter = 'Diego';

    const { rerender } = render(
      <NPCList
        npcs={mockNpcs}
        npcMap={mockNpcMap}
        selectedNPC={null}
        onSelectNPC={mockOnSelectNPC}
      />
    );

    const clearButton = screen.getByLabelText('Clear filter');
    expect(clearButton).toBeInTheDocument();

    await user.click(clearButton);

    expect(mockSetNpcFilter).toHaveBeenCalledWith('');

    // Simulate the state update
    mockNpcFilter = '';
    rerender(
       <NPCList
        npcs={mockNpcs}
        npcMap={mockNpcMap}
        selectedNPC={null}
        onSelectNPC={mockOnSelectNPC}
      />
    );

    expect(screen.queryByLabelText('Clear filter')).not.toBeInTheDocument();
  });

  it('does not show clear button when filter is empty', () => {
    mockNpcFilter = '';
    render(
      <NPCList
        npcs={mockNpcs}
        npcMap={mockNpcMap}
        selectedNPC={null}
        onSelectNPC={mockOnSelectNPC}
      />
    );
    expect(screen.queryByLabelText('Clear filter')).not.toBeInTheDocument();
  });
});
