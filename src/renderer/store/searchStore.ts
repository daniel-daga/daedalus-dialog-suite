/**
 * Search Store - Manages search and filter state
 *
 * Handles:
 * - Global search across dialogs
 * - NPC list filtering
 * - Dialog list filtering
 * - Search results with navigation
 */

import { create } from 'zustand';
import type { SemanticModel, DialogMetadata, DialogLineAction } from '../types/global';

export interface SearchResult {
  type: 'dialog' | 'function' | 'text' | 'npc';
  name: string;
  match: string;
  context?: string;
  npc?: string;
  dialogName?: string;
  functionName?: string;
  filePath?: string;
}

interface SearchScope {
  dialogNames: boolean;
  dialogText: boolean;
  functionNames: boolean;
  npcNames: boolean;
}

interface SearchState {
  searchQuery: string;
  npcFilter: string;
  dialogFilter: string;
  searchResults: SearchResult[];
  isSearching: boolean;
  searchScope: SearchScope;
}

interface SearchActions {
  setSearchQuery: (query: string) => void;
  setNpcFilter: (filter: string) => void;
  setDialogFilter: (filter: string) => void;
  setSearchScope: (scope: Partial<SearchScope>) => void;
  clearSearch: () => void;
  filterNpcs: (npcs: string[]) => string[];
  filterDialogs: (dialogs: string[]) => string[];
  performSearch: (
    semanticModel: SemanticModel,
    dialogIndex: Map<string, DialogMetadata[]>
  ) => void;
}

type SearchStore = SearchState & SearchActions;

const initialSearchScope: SearchScope = {
  dialogNames: true,
  dialogText: true,
  functionNames: true,
  npcNames: true
};

export const useSearchStore = create<SearchStore>((set, get) => ({
  // Initial state
  searchQuery: '',
  npcFilter: '',
  dialogFilter: '',
  searchResults: [],
  isSearching: false,
  searchScope: { ...initialSearchScope },

  // Actions
  setSearchQuery: (query: string) => {
    set({ searchQuery: query });
  },

  setNpcFilter: (filter: string) => {
    set({ npcFilter: filter });
  },

  setDialogFilter: (filter: string) => {
    set({ dialogFilter: filter });
  },

  setSearchScope: (scope: Partial<SearchScope>) => {
    set((state) => ({
      searchScope: { ...state.searchScope, ...scope }
    }));
  },

  clearSearch: () => {
    set({
      searchQuery: '',
      npcFilter: '',
      dialogFilter: '',
      searchResults: []
    });
  },

  filterNpcs: (npcs: string[]) => {
    const { npcFilter } = get();
    if (!npcFilter.trim()) {
      return npcs;
    }
    const lowerFilter = npcFilter.toLowerCase();
    return npcs.filter((npc) => npc.toLowerCase().includes(lowerFilter));
  },

  filterDialogs: (dialogs: string[]) => {
    const { dialogFilter } = get();
    if (!dialogFilter.trim()) {
      return dialogs;
    }
    const lowerFilter = dialogFilter.toLowerCase();
    return dialogs.filter((dialog) => dialog.toLowerCase().includes(lowerFilter));
  },

  performSearch: (
    semanticModel: SemanticModel,
    dialogIndex: Map<string, DialogMetadata[]>
  ) => {
    const { searchQuery, searchScope } = get();

    if (!searchQuery.trim()) {
      set({ searchResults: [], isSearching: false });
      return;
    }

    set({ isSearching: true });

    const results: SearchResult[] = [];
    const lowerQuery = searchQuery.toLowerCase();
    const addedKeys = new Set<string>();

    // Search in NPC names
    if (searchScope.npcNames) {
      dialogIndex.forEach((dialogs, npc) => {
        if (npc.toLowerCase().includes(lowerQuery)) {
          const key = `npc:${npc}`;
          if (!addedKeys.has(key)) {
            addedKeys.add(key);
            results.push({
              type: 'npc',
              name: npc,
              match: npc,
              context: `${dialogs.length} dialog(s)`
            });
          }
        }
      });
    }

    // Search in dialog names and properties
    if (searchScope.dialogNames && semanticModel.dialogs) {
      Object.entries(semanticModel.dialogs).forEach(([dialogName, dialog]) => {
        if (dialogName.toLowerCase().includes(lowerQuery)) {
          const key = `dialog:${dialogName}`;
          if (!addedKeys.has(key)) {
            addedKeys.add(key);
            results.push({
              type: 'dialog',
              name: dialogName,
              match: dialogName,
              context: dialog.properties?.description || '',
              npc: dialog.properties?.npc,
              dialogName
            });
          }
        }

        // Also search in description
        const description = dialog.properties?.description;
        if (description && description.toLowerCase().includes(lowerQuery)) {
          const key = `dialog-desc:${dialogName}`;
          if (!addedKeys.has(key)) {
            addedKeys.add(key);
            results.push({
              type: 'dialog',
              name: dialogName,
              match: description,
              context: dialogName,
              npc: dialog.properties?.npc,
              dialogName
            });
          }
        }
      });
    }

    // Search in function names
    if (searchScope.functionNames && semanticModel.functions) {
      Object.keys(semanticModel.functions).forEach((funcName) => {
        if (funcName.toLowerCase().includes(lowerQuery)) {
          const key = `function:${funcName}`;
          if (!addedKeys.has(key)) {
            addedKeys.add(key);
            results.push({
              type: 'function',
              name: funcName,
              match: funcName,
              functionName: funcName
            });
          }
        }
      });
    }

    // Search in dialog text content
    if (searchScope.dialogText && semanticModel.functions) {
      Object.entries(semanticModel.functions).forEach(([funcName, func]) => {
        func.actions?.forEach((action) => {
          // Check if it's a dialog line action
          if ('text' in action && 'speaker' in action) {
            const dialogLine = action as DialogLineAction;
            if (dialogLine.text.toLowerCase().includes(lowerQuery)) {
              const key = `text:${funcName}:${dialogLine.id}`;
              if (!addedKeys.has(key)) {
                addedKeys.add(key);
                results.push({
                  type: 'text',
                  name: funcName,
                  match: dialogLine.text,
                  context: `[${dialogLine.speaker}]`,
                  functionName: funcName
                });
              }
            }
          }
        });
      });
    }

    set({ searchResults: results, isSearching: false });
  }
}));
