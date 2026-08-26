import React from 'react';
import { describe, it, expect, beforeEach } from '@jest/globals';
import { render, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import MainLayout from '../src/renderer/components/MainLayout';
import { useProjectStore } from '../src/renderer/store/projectStore';
import { useUISelectionStore } from '../src/renderer/store/uiSelectionStore';
import { useEditorStore } from '../src/renderer/store/editorStore';
import { useHistoryStore } from '../src/renderer/store/historyStore';

/**
 * Ctrl+Z belongs to whichever view is on screen (level-editor.md §7, Phase 1b).
 *
 * The layout's undo/redo shortcut is a **window** listener, so it fires in the
 * World view too — and it only checks that a file is open, which it is: the
 * World surface lives inside a project like every other view. Undoing a VOB
 * move would therefore undo a *dialog* edit in a file the user cannot see,
 * silently, and the world's own history would be untouched. The World surface
 * has its own history in the main process and binds its own shortcut.
 */
jest.mock('../src/renderer/components/ThreeColumnLayout', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('../src/renderer/components/world/WorldSurface', () => ({
  __esModule: true,
  default: () => null,
}));

describe('the layout undo shortcut', () => {
  beforeEach(() => {
    useProjectStore.setState({ projectPath: '/proj' } as never);
    useEditorStore.setState({ activeFile: '/proj/dialogs.d' } as never);
  });

  const pressUndo = () => fireEvent.keyDown(window, { key: 'z', ctrlKey: true });

  it('drives the dialog history in the dialog view', () => {
    useUISelectionStore.setState({ activeView: 'dialog' } as never);
    const undo = jest.spyOn(useHistoryStore.getState(), 'undo');
    render(<MainLayout />);

    pressUndo();

    expect(undo).toHaveBeenCalledWith('/proj/dialogs.d');
    undo.mockRestore();
  });

  it('leaves it alone in the World view, where the world owns its own history', () => {
    useUISelectionStore.setState({ activeView: 'world' } as never);
    const undo = jest.spyOn(useHistoryStore.getState(), 'undo');
    render(<MainLayout />);

    pressUndo();

    expect(undo).not.toHaveBeenCalled();
    undo.mockRestore();
  });
});
