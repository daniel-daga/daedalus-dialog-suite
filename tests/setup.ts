import '@testing-library/jest-dom';
import { mockEditorAPI } from '../src/renderer/utils/mockAPI';

// Inject mock EditorAPI for all tests
if (typeof window !== 'undefined') {
  (window as any).editorAPI = mockEditorAPI;
}
