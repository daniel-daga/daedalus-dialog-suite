import '@testing-library/jest-dom';
import { mockEditorAPI } from '../src/renderer/utils/mockAPI';

// Inject mock EditorAPI for all tests
(global as any).window.editorAPI = mockEditorAPI;
