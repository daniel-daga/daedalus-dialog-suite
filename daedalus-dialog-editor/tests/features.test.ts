import { isWritableQuestEditorEnabled } from '../src/renderer/config/features';

describe('feature flags', () => {
  beforeEach(() => {
    window.localStorage.removeItem('feature.writableQuestEditor');
  });

  it('defaults writable quest editor to enabled', () => {
    expect(isWritableQuestEditorEnabled()).toBe(true);
  });

  it('respects localStorage false toggle', () => {
    window.localStorage.setItem('feature.writableQuestEditor', 'false');
    expect(isWritableQuestEditorEnabled()).toBe(false);
  });

  it('respects localStorage true toggle', () => {
    window.localStorage.setItem('feature.writableQuestEditor', 'true');
    expect(isWritableQuestEditorEnabled()).toBe(true);
  });
});
