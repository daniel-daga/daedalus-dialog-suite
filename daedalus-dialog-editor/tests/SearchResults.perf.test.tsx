import React from 'react';
import { render, screen } from '@testing-library/react';
import SearchResults from '../src/renderer/components/SearchResults';
import { SearchResult } from '../src/renderer/store/searchStore';
import '@testing-library/jest-dom';

// Mock useSearchStore
const mockSearchResults: SearchResult[] = [];
for (let i = 0; i < 1000; i++) {
  mockSearchResults.push({
    type: i % 2 === 0 ? 'text' : 'dialog',
    name: `Result_${i}`,
    match: `Match text ${i}`,
    context: i % 2 === 0 ? `Context info ${i}` : undefined,
    dialogName: `Dialog_${i}`,
    functionName: `Func_${i}`
  });
}

jest.mock('../src/renderer/store/searchStore', () => ({
  useSearchStore: jest.fn((selector?: (s: any) => any) => {
    const state = {
      searchQuery: 'test',
      searchResults: mockSearchResults,
      isSearching: false,
    };
    return selector ? selector(state) : state;
  }),
}));

// Mock react-virtualized-auto-sizer
jest.mock('react-virtualized-auto-sizer', () => ({
  __esModule: true,
  default: ({ children }: any) => children({ height: 500, width: 300 }),
}));

describe('SearchResults Performance', () => {
  test('renders large search results list', () => {
    const onResultClick = jest.fn();

    const startTime = performance.now();
    render(
      <SearchResults
        onResultClick={onResultClick}
        maxHeight={500}
      />
    );
    const endTime = performance.now();

    console.log(`Render time for 1000 results: ${endTime - startTime}ms`);

    // If virtualized (height 463, itemSize 40 or 60), we expect roughly 8-12 rows + overscan.
    // Definitely less than 50. If NOT virtualized, it will be 1000.
    const items = screen.getAllByRole('button');
    expect(items.length).toBeLessThan(50);
    expect(items.length).toBeGreaterThan(0);
  });
});
