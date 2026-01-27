/**
 * Tests for Search Store
 */
import { describe, it, expect, beforeEach } from '@jest/globals';
import { useSearchStore, SearchResult } from '../src/renderer/store/searchStore';
import type { SemanticModel, DialogMetadata } from '../src/shared/types';

describe('searchStore', () => {
  beforeEach(() => {
    // Reset store state before each test
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

  describe('setSearchQuery', () => {
    it('should update searchQuery', () => {
      useSearchStore.getState().setSearchQuery('test');
      expect(useSearchStore.getState().searchQuery).toBe('test');
    });
  });

  describe('setNpcFilter', () => {
    it('should update npcFilter', () => {
      useSearchStore.getState().setNpcFilter('Diego');
      expect(useSearchStore.getState().npcFilter).toBe('Diego');
    });
  });

  describe('setDialogFilter', () => {
    it('should update dialogFilter', () => {
      useSearchStore.getState().setDialogFilter('Info');
      expect(useSearchStore.getState().dialogFilter).toBe('Info');
    });
  });

  describe('setSearchScope', () => {
    it('should update search scope options', () => {
      useSearchStore.getState().setSearchScope({ dialogText: false });
      expect(useSearchStore.getState().searchScope.dialogText).toBe(false);
      expect(useSearchStore.getState().searchScope.dialogNames).toBe(true);
    });
  });

  describe('clearSearch', () => {
    it('should clear all search state', () => {
      useSearchStore.setState({
        searchQuery: 'test',
        npcFilter: 'Diego',
        dialogFilter: 'Info',
        searchResults: [{ type: 'dialog', name: 'test', match: 'test' }]
      });

      useSearchStore.getState().clearSearch();

      const state = useSearchStore.getState();
      expect(state.searchQuery).toBe('');
      expect(state.npcFilter).toBe('');
      expect(state.dialogFilter).toBe('');
      expect(state.searchResults).toHaveLength(0);
    });
  });

  describe('filterNpcs', () => {
    it('should filter NPCs by name (case insensitive)', () => {
      const npcs = ['Diego', 'Gorn', 'Milten', 'Lester'];

      useSearchStore.getState().setNpcFilter('go');
      const filtered = useSearchStore.getState().filterNpcs(npcs);

      expect(filtered).toEqual(['Diego', 'Gorn']);
    });

    it('should return all NPCs when filter is empty', () => {
      const npcs = ['Diego', 'Gorn', 'Milten'];

      const filtered = useSearchStore.getState().filterNpcs(npcs);

      expect(filtered).toEqual(npcs);
    });
  });

  describe('filterDialogs', () => {
    it('should filter dialogs by name (case insensitive)', () => {
      const dialogs = ['DIA_Diego_Info', 'DIA_Diego_Trade', 'DIA_Gorn_Info'];

      useSearchStore.getState().setDialogFilter('trade');
      const filtered = useSearchStore.getState().filterDialogs(dialogs);

      expect(filtered).toEqual(['DIA_Diego_Trade']);
    });

    it('should return all dialogs when filter is empty', () => {
      const dialogs = ['DIA_Diego_Info', 'DIA_Diego_Trade'];

      const filtered = useSearchStore.getState().filterDialogs(dialogs);

      expect(filtered).toEqual(dialogs);
    });
  });

  describe('performSearch', () => {
    const mockSemanticModel: SemanticModel = {
      dialogs: {
        'DIA_Diego_Info': {
          name: 'DIA_Diego_Info',
          parent: 'C_Info',
          properties: {
            npc: 'Diego',
            description: 'Diego tells you about the camp'
          }
        },
        'DIA_Gorn_Trade': {
          name: 'DIA_Gorn_Trade',
          parent: 'C_Info',
          properties: {
            npc: 'Gorn',
            description: 'Trade with Gorn'
          }
        }
      },
      functions: {
        'DIA_Diego_Info_Info': {
          name: 'DIA_Diego_Info_Info',
          returnType: 'VOID',
          actions: [
            { speaker: 'self', text: 'Tell me about the camp', id: '1' },
            { speaker: 'other', text: 'This is the Old Camp', id: '2' }
          ],
          conditions: [],
          calls: []
        },
        'DIA_Gorn_Trade_Info': {
          name: 'DIA_Gorn_Trade_Info',
          returnType: 'VOID',
          actions: [
            { speaker: 'other', text: 'Want to buy weapons?', id: '3' }
          ],
          conditions: [],
          calls: []
        }
      },
      hasErrors: false,
      errors: []
    };

    const mockDialogIndex = new Map<string, DialogMetadata[]>([
      ['Diego', [{ dialogName: 'DIA_Diego_Info', npc: 'Diego', filePath: '/test/diego.d' }]],
      ['Gorn', [{ dialogName: 'DIA_Gorn_Trade', npc: 'Gorn', filePath: '/test/gorn.d' }]]
    ]);

    it('should find matches in dialog names', async () => {
      useSearchStore.getState().setSearchQuery('Diego');
      await useSearchStore.getState().performSearch(mockSemanticModel, mockDialogIndex);

      const results = useSearchStore.getState().searchResults;
      const dialogResult = results.find(r => r.type === 'dialog' && r.name === 'DIA_Diego_Info');

      expect(dialogResult).toBeDefined();
    });

    it('should find matches in dialog text content', async () => {
      useSearchStore.getState().setSearchQuery('Old Camp');
      await useSearchStore.getState().performSearch(mockSemanticModel, mockDialogIndex);

      const results = useSearchStore.getState().searchResults;
      const textResult = results.find(r => r.type === 'text');

      expect(textResult).toBeDefined();
      expect(textResult?.match).toContain('Old Camp');
    });

    it('should find matches in function names', async () => {
      useSearchStore.getState().setSearchQuery('Trade_Info');
      await useSearchStore.getState().performSearch(mockSemanticModel, mockDialogIndex);

      const results = useSearchStore.getState().searchResults;
      const functionResult = results.find(r => r.type === 'function');

      expect(functionResult).toBeDefined();
    });

    it('should find matches in NPC names', async () => {
      useSearchStore.getState().setSearchQuery('Gorn');
      await useSearchStore.getState().performSearch(mockSemanticModel, mockDialogIndex);

      const results = useSearchStore.getState().searchResults;
      const npcResult = results.find(r => r.type === 'npc');

      expect(npcResult).toBeDefined();
    });

    it('should respect search scope options', async () => {
      useSearchStore.getState().setSearchQuery('Diego');
      useSearchStore.getState().setSearchScope({ dialogNames: false, npcNames: false });
      await useSearchStore.getState().performSearch(mockSemanticModel, mockDialogIndex);

      const results = useSearchStore.getState().searchResults;
      const dialogResult = results.find(r => r.type === 'dialog');
      const npcResult = results.find(r => r.type === 'npc');

      expect(dialogResult).toBeUndefined();
      expect(npcResult).toBeUndefined();
    });

    it('should return empty results for empty query', async () => {
      useSearchStore.getState().setSearchQuery('');
      await useSearchStore.getState().performSearch(mockSemanticModel, mockDialogIndex);

      expect(useSearchStore.getState().searchResults).toHaveLength(0);
    });

    it('should be case insensitive', async () => {
      useSearchStore.getState().setSearchQuery('diego');
      await useSearchStore.getState().performSearch(mockSemanticModel, mockDialogIndex);

      const results = useSearchStore.getState().searchResults;
      expect(results.length).toBeGreaterThan(0);
    });
  });
});
