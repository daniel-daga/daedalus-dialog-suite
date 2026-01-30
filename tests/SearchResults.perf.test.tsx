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
  useSearchStore: jest.fn(() => ({
    searchQuery: 'test',
    searchResults: mockSearchResults,
    isSearching: false,
  })),
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

    // In the original component, it renders ALL items.
    // We want to verify this behavior first.
    const items = screen.getAllByRole('button');
    console.log(`Rendered items count: ${items.length}`);

    // Once optimized, this should fail if we expect 1000.
    // For now, we expect 1000.
    // After optimization, we will expect < 50.
  });
});
