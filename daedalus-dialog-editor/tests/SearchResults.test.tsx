/**
 * Tests for SearchResults component
 */
import React from 'react';
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SearchResults from '../src/renderer/components/SearchResults';
import { useSearchStore, SearchResult } from '../src/renderer/store/searchStore';

// Mock react-virtualized-auto-sizer
jest.mock('react-virtualized-auto-sizer', () => ({
  __esModule: true,
  default: ({ children }: any) => children({ height: 500, width: 300 }),
}));

const mockResults: SearchResult[] = [
  {
    type: 'npc',
    name: 'Diego',
    match: 'Diego',
    context: '5 dialog(s)'
  },
  {
    type: 'dialog',
    name: 'DIA_Diego_Info',
    match: 'DIA_Diego_Info',
    context: 'Diego tells you about the camp',
    npc: 'Diego',
    dialogName: 'DIA_Diego_Info'
  },
  {
    type: 'function',
    name: 'DIA_Diego_Info_Info',
    match: 'DIA_Diego_Info_Info',
    functionName: 'DIA_Diego_Info_Info'
  },
  {
    type: 'text',
    name: 'DIA_Diego_Info_Info',
    match: 'Tell me about the camp',
    context: '[self]',
    functionName: 'DIA_Diego_Info_Info'
  }
];

describe('SearchResults', () => {
  beforeEach(() => {
    useSearchStore.setState({
      searchQuery: '',
      searchResults: [],
      isSearching: false
    });
  });

  it('should render nothing when no search query', () => {
    const { container } = render(<SearchResults onResultClick={jest.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('should show loading state when searching', () => {
    useSearchStore.setState({
      searchQuery: 'test',
      isSearching: true,
      searchResults: []
    });

    render(<SearchResults onResultClick={jest.fn()} />);
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('should show no results message when query has no matches', () => {
    useSearchStore.setState({
      searchQuery: 'nonexistent',
      isSearching: false,
      searchResults: []
    });

    render(<SearchResults onResultClick={jest.fn()} />);
    expect(screen.getByText(/no results/i)).toBeInTheDocument();
  });

  it('should render search results', () => {
    useSearchStore.setState({
      searchQuery: 'Diego',
      isSearching: false,
      searchResults: mockResults
    });

    render(<SearchResults onResultClick={jest.fn()} />);

    expect(screen.getByText('Diego')).toBeInTheDocument();
    expect(screen.getByText('DIA_Diego_Info')).toBeInTheDocument();
    expect(screen.getByText('DIA_Diego_Info_Info')).toBeInTheDocument();
    expect(screen.getByText('Tell me about the camp')).toBeInTheDocument();
  });

  it('should call onResultClick when result is clicked', async () => {
    const user = userEvent.setup();
    const onResultClick = jest.fn();

    useSearchStore.setState({
      searchQuery: 'Diego',
      isSearching: false,
      searchResults: mockResults
    });

    render(<SearchResults onResultClick={onResultClick} />);

    const npcResult = screen.getByText('Diego');
    await user.click(npcResult);

    expect(onResultClick).toHaveBeenCalledWith(mockResults[0]);
  });

  it('should show result type badges', () => {
    useSearchStore.setState({
      searchQuery: 'Diego',
      isSearching: false,
      searchResults: mockResults
    });

    render(<SearchResults onResultClick={jest.fn()} />);

    expect(screen.getByText('NPC')).toBeInTheDocument();
    expect(screen.getByText('Dialog')).toBeInTheDocument();
    expect(screen.getByText('Function')).toBeInTheDocument();
    expect(screen.getByText('Text')).toBeInTheDocument();
  });

  it('should show result count', () => {
    useSearchStore.setState({
      searchQuery: 'Diego',
      isSearching: false,
      searchResults: mockResults
    });

    render(<SearchResults onResultClick={jest.fn()} />);

    expect(screen.getByText(/4 result/i)).toBeInTheDocument();
  });
});
