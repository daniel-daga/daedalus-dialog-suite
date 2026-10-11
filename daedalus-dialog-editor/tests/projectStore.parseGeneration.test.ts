import { useProjectStore } from '../src/renderer/store/projectStore';
import type { SemanticModel } from '../src/renderer/types/global';

const createEmptyModel = (): SemanticModel => ({
  dialogs: {},
  functions: {},
  constants: {},
  variables: {},
  instances: {},
  hasErrors: false,
  errors: []
});

describe('projectStore - parseGeneration', () => {
  beforeEach(() => {
    useProjectStore.getState().closeProject();
  });

  it('exposes a numeric parseGeneration counter', () => {
    expect(typeof useProjectStore.getState().parseGeneration).toBe('number');
  });

  it('increments when a file is cached via getSemanticModel', async () => {
    const before = useProjectStore.getState().parseGeneration;
    await useProjectStore.getState().getSemanticModel('/dialogs/gen-a.d');
    expect(useProjectStore.getState().parseGeneration).toBe(before + 1);
  });

  it('increments when clearCache replaces parsedFiles', () => {
    const before = useProjectStore.getState().parseGeneration;
    useProjectStore.getState().clearCache();
    expect(useProjectStore.getState().parseGeneration).toBe(before + 1);
  });

  it('increments when updateFileModel replaces parsedFiles', () => {
    const before = useProjectStore.getState().parseGeneration;
    useProjectStore.getState().updateFileModel('/dialogs/gen-b.d', createEmptyModel());
    expect(useProjectStore.getState().parseGeneration).toBeGreaterThan(before);
  });

  it('increments when closeProject clears parsedFiles', () => {
    // Prime with a cached file so closeProject actually replaces the map.
    useProjectStore.getState().updateFileModel('/dialogs/gen-c.d', createEmptyModel());
    const before = useProjectStore.getState().parseGeneration;
    useProjectStore.getState().closeProject();
    expect(useProjectStore.getState().parseGeneration).toBeGreaterThan(before);
  });
});
