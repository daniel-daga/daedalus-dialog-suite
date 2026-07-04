import React from 'react';
import { describe, it, expect, beforeEach } from '@jest/globals';
import { render, act } from '@testing-library/react';
import SearchBar from '../src/renderer/components/SearchBar';
import { useSearchStore } from '../src/renderer/store/searchStore';

/**
 * §2.2 item 13 spot check: SearchBar subscribes to `searchQuery` and two
 * actions via per-field selectors, so mutating an unrelated search-store field
 * (searchResults / isSearching) must not re-render it. Fails on the pre-fix
 * selector-less `useSearchStore()` subscription.
 */
describe('SearchBar re-render granularity', () => {
  beforeEach(() => {
    useSearchStore.setState({
      searchQuery: '',
      npcFilter: '',
      dialogFilter: '',
      searchResults: [],
      isSearching: false
    });
  });

  it('does not re-render when an unrelated search-store field changes', () => {
    let commits = 0;
    render(
      <React.Profiler id="searchbar" onRender={() => { commits += 1; }}>
        <SearchBar />
      </React.Profiler>
    );
    const afterMount = commits;

    act(() => {
      useSearchStore.setState({
        searchResults: [{ type: 'dialog', name: 'X', match: 'x' }],
        isSearching: true
      });
    });
    expect(commits).toBe(afterMount);

    // The field it does select still triggers a re-render.
    act(() => {
      useSearchStore.setState({ searchQuery: 'Diego' });
    });
    expect(commits).toBeGreaterThan(afterMount);
  });
});
