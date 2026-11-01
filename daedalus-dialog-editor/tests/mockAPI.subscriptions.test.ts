/**
 * The subscription channels hold every listener, not the last one (#508).
 * `preload.ts` registers a fresh `ipcRenderer.on` per subscribe call, so N
 * subscribers each receive the event and each unsubscribe removes only its own
 * listener. The fake kept a single listener and its unsubscribe nulled it for
 * everyone — correct only while the app happens to mount one subscriber.
 */

import { describe, test, expect } from '@jest/globals';
import type { FileChangeEvent } from '../src/renderer/types/global';

describe('mockAPI subscription channels (#508)', () => {
  test('unsubscribing one file-change subscriber leaves the other subscribed', () => {
    const first: FileChangeEvent[] = [];
    const second: FileChangeEvent[] = [];
    const offFirst = window.editorAPI.onFileChanged((event) => first.push(event));
    const offSecond = window.editorAPI.onFileChanged((event) => second.push(event));

    const emit = () => (window as any).__mockEmitFileChange({ type: 'change', filePath: 'a.d' });

    emit();
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);

    offFirst();
    emit();
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(2);
    expect(second[1]).toEqual({ type: 'change', filePath: 'a.d' });

    offSecond();
  });

  test('unsubscribing one close-request subscriber leaves the other subscribed', () => {
    let first = 0;
    let second = 0;
    const offFirst = window.editorAPI.onCloseRequested(() => { first += 1; });
    const offSecond = window.editorAPI.onCloseRequested(() => { second += 1; });

    const emit = () => (window as any).__mockEmitCloseRequested();

    emit();
    expect(first).toBe(1);
    expect(second).toBe(1);

    offFirst();
    emit();
    expect(first).toBe(1);
    expect(second).toBe(2);

    offSecond();
  });
});
