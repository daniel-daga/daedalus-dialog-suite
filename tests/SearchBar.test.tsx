/**
 * Tests for SearchBar component
 */
import React from 'react';
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SearchBar from '../src/renderer/components/SearchBar';
import { useSearchStore } from '../src/renderer/store/searchStore';

// Mock debounce to execute immediately in tests
jest.mock('../src/renderer/utils/debounce', () => ({
  debounce: (fn: (...args: unknown[]) => void) => fn
}));

describe('SearchBar', () => {
  beforeEach(() => {
    // Reset store state
    useSearchStore.setState({
      searchQuery: '',
      npcFilter: '',
      dialogFilter: '',
      searchResults: [],
      isSearching: false,
      searchScope: {
        dialogNames: true,
        dialogText: true,
        functionNames: true,
        npcNames: true
      }
    });
  });

  it('should render search input', () => {
    render(<SearchBar />);
    expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument();
  });

  it('should update search query on input', async () => {
    const user = userEvent.setup();
    render(<SearchBar />);

    const input = screen.getByPlaceholderText(/search/i);
    await user.type(input, 'Diego');

    expect(useSearchStore.getState().searchQuery).toBe('Diego');
  });

  it('should clear search when clear button is clicked', async () => {
    const user = userEvent.setup();
    useSearchStore.setState({ searchQuery: 'test' });

    render(<SearchBar />);

    const clearButton = screen.getByRole('button', { name: /clear/i });
    await user.click(clearButton);

    expect(useSearchStore.getState().searchQuery).toBe('');
  });

  it('should call onSearch when provided', async () => {
    const onSearch = jest.fn();
    const user = userEvent.setup();

    render(<SearchBar onSearch={onSearch} />);

    const input = screen.getByPlaceholderText(/search/i);
    await user.type(input, 'test');

    expect(onSearch).toHaveBeenCalledWith('test');
  });

  it('should focus input when focusRef is triggered', () => {
    const focusRef = { current: null as (() => void) | null };

    render(<SearchBar focusRef={focusRef} />);

    const input = screen.getByPlaceholderText(/search/i);

    // Trigger focus via ref
    act(() => {
      focusRef.current?.();
    });

    expect(document.activeElement).toBe(input);
  });

  it('should show search icon', () => {
    render(<SearchBar />);
    expect(screen.getByTestId('SearchIcon')).toBeInTheDocument();
  });
});
