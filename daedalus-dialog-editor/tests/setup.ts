import '@testing-library/jest-dom';
import { mockEditorAPI } from '../src/renderer/utils/mockAPI';

// jsdom's environment does not expose structuredClone, which the parser's
// deserializeSemanticModel uses (Node and Electron both have it). Node's own, or
// a v8 serialize round-trip, would hand back objects from Node's realm, which
// class-transformer's plainToInstance does not hydrate — so a pure-JS clone that
// builds its copy in the test's realm.
if (typeof globalThis.structuredClone !== 'function') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  globalThis.structuredClone = require('@ungap/structured-clone').default;
}

// Inject mock EditorAPI for all tests
if (typeof window !== 'undefined') {
  (window as any).editorAPI = mockEditorAPI;
}
