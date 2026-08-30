import { useProjectStore } from '../src/renderer/store/projectStore';

type IndexMockable = { editorAPI: { buildProjectIndex: unknown } };

/**
 * 2026-07 finding 2.1: `openProject` caught every failure into `loadError` —
 * a field no component reads — and never rethrew, so `App`'s own catch around
 * `openProject` could not fire and the user stayed on the welcome screen with
 * no message at all.
 */
describe('projectStore openProject error propagation (2.1)', () => {
  let original: unknown;

  beforeEach(() => {
    useProjectStore.getState().closeProject();
    original = (window as never as IndexMockable).editorAPI.buildProjectIndex;
  });

  afterEach(() => {
    (window as never as IndexMockable).editorAPI.buildProjectIndex = original;
  });

  test('openProject rethrows when the index build fails', async () => {
    (window as never as IndexMockable).editorAPI.buildProjectIndex = jest.fn(
      () => Promise.reject(new Error('index build exploded'))
    );

    await expect(useProjectStore.getState().openProject('/proj')).rejects.toThrow(
      'index build exploded'
    );
  });

  test('a failed open still clears isLoading and records the message', async () => {
    (window as never as IndexMockable).editorAPI.buildProjectIndex = jest.fn(
      () => Promise.reject(new Error('index build exploded'))
    );

    await expect(useProjectStore.getState().openProject('/proj')).rejects.toThrow();

    expect(useProjectStore.getState().isLoading).toBe(false);
    expect(useProjectStore.getState().loadError).toBe('index build exploded');
  });
});
