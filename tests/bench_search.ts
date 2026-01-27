
import { useSearchStore } from '../src/renderer/store/searchStore';
import type { SemanticModel, DialogMetadata, DialogFunction } from '../src/shared/types';
import { performance } from 'perf_hooks';

// Generate a large mock semantic model
const NUM_FUNCTIONS = 10000;
const ACTIONS_PER_FUNCTION = 50;

console.log(`Generating mock model with ${NUM_FUNCTIONS} functions and ${ACTIONS_PER_FUNCTION} actions each...`);

const functions: Record<string, DialogFunction> = {};
for (let i = 0; i < NUM_FUNCTIONS; i++) {
  const funcName = `Function_${i}`;
  functions[funcName] = {
    name: funcName,
    returnType: 'VOID',
    actions: Array(ACTIONS_PER_FUNCTION).fill(null).map((_, j) => ({
      speaker: j % 2 === 0 ? 'self' : 'other',
      text: `This is dialog line ${j} in function ${i}. Some keyword here.`,
      id: `${i}_${j}`
    })),
    conditions: [],
    calls: []
  };
}

const mockSemanticModel: SemanticModel = {
  dialogs: {},
  functions,
  hasErrors: false,
  errors: []
};

const mockDialogIndex = new Map<string, DialogMetadata[]>();

console.log('Starting search benchmark...');

(async () => {
  useSearchStore.getState().setSearchQuery('keyword');

  const start = performance.now();
  await useSearchStore.getState().performSearch(mockSemanticModel, mockDialogIndex);
  const end = performance.now();

  console.log(`Search took ${(end - start).toFixed(2)} ms`);
  console.log(`Results found: ${useSearchStore.getState().searchResults.length}`);
})();
