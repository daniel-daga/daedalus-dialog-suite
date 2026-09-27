import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { act, renderHook } from '@testing-library/react';
import { useManualSave } from '../src/renderer/hooks/useManualSave';
import { useWorldShortcuts, type WorldShortcutsInput } from '../src/renderer/components/world/hooks/useWorldShortcuts';
import { useFileStore } from '../src/renderer/store/fileStore';
import { useUISelectionStore } from '../src/renderer/store/uiSelectionStore';

const FILE_PATH = 'C:/project/DIA_Test.d';

describe('manual save shortcut ownership', () => {
  afterEach(() => {
    useUISelectionStore.getState().setActiveView('dialog');
    useFileStore.setState({ openFiles: new Map(), activeFile: null } as any);
  });

  test('World Ctrl+S requests the world save without saving the active script', async () => {
    const saveFile = jest.spyOn(useFileStore.getState(), 'saveFile')
      .mockResolvedValue({ success: true } as any);
    const onRequestSave = jest.fn();
    const onError = jest.fn();
    useFileStore.setState({
      activeFile: FILE_PATH,
      openFiles: new Map([[FILE_PATH, {
        filePath: FILE_PATH,
        semanticModel: { dialogs: {}, functions: {} },
        isDirty: true,
        lastSaved: new Date(),
      }]]),
    } as any);
    useUISelectionStore.getState().setActiveView('world');

    renderHook(() => {
      useManualSave(onError);
      useWorldShortcuts({
        hasWorld: true,
        hidden: false,
        dialogOpen: false,
        waynet: null,
        armed: false,
        gizmoMode: 'translate',
        snapGrid: 0,
        setGizmoMode: jest.fn(),
        onCopy: jest.fn(),
        onPaste: jest.fn(),
        onDuplicate: jest.fn(),
        onRequestDeleteVobs: jest.fn(),
        onRequestDeleteWaypoint: jest.fn(),
        onDisarm: jest.fn(),
        onRequestSave,
        onNudge: jest.fn(),
        onHistory: jest.fn(),
      } as WorldShortcutsInput);
    });

    const event = new KeyboardEvent('keydown', {
      key: 's', ctrlKey: true, bubbles: true, cancelable: true,
    });
    await act(async () => {
      window.dispatchEvent(event);
      await Promise.resolve();
    });

    expect(event.defaultPrevented).toBe(true);
    expect(onRequestSave).toHaveBeenCalledTimes(1);
    expect(saveFile).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});
