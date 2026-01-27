import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { useProjectStore } from '../src/renderer/store/projectStore';

describe('projectStore - race condition', () => {
  beforeEach(() => {
    useProjectStore.getState().closeProject();
    jest.clearAllMocks();
  });

  test('should handle concurrent getSemanticModel calls correctly', async () => {
    // Mock parseDialogFile to have a delay
    const parseDialogFileMock = jest.fn(async (filePath: string) => {
      await new Promise(resolve => setTimeout(resolve, 50));
      return {
        dialogs: { [filePath]: { name: filePath } },
        functions: {},
        constants: {},
        instances: {},
        hasErrors: false,
        errors: []
      };
    });

    // Override the global mock for this test
    const originalParseDialogFile = (window as any).editorAPI.parseDialogFile;
    (window as any).editorAPI.parseDialogFile = parseDialogFileMock;

    try {
      const store = useProjectStore.getState();

      // Start two concurrent calls
      const p1 = store.getSemanticModel('file1.d');
      const p2 = store.getSemanticModel('file2.d');

      await Promise.all([p1, p2]);

      const finalState = useProjectStore.getState();

      // Both files should be in the cache
      expect(finalState.parsedFiles.has('file1.d')).toBe(true);
      expect(finalState.parsedFiles.has('file2.d')).toBe(true);
    } finally {
      // Restore original mock
      (window as any).editorAPI.parseDialogFile = originalParseDialogFile;
    }
  });
});
