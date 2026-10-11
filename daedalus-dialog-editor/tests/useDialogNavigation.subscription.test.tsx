import React from 'react';
import { describe, it, expect, beforeEach } from '@jest/globals';
import { render, act } from '@testing-library/react';
import { useDialogNavigation } from '../src/renderer/components/hooks/useDialogNavigation';
import { useProjectStore } from '../src/renderer/store/projectStore';
import { useEditorStore } from '../src/renderer/store/editorStore';
import { useUISelectionStore } from '../src/renderer/store/uiSelectionStore';

/**
 * §2.2 items 20-22: useDialogNavigation reads projectStore/editorStore/
 * uiSelection values imperatively via getState() inside its callbacks, so it
 * holds no render-time store subscription. Mutating those stores must not
 * re-render consumers, and the returned handlers keep stable identities.
 * Fails on the pre-fix selector-less subscriptions.
 */
describe('useDialogNavigation store subscription', () => {
  beforeEach(() => {
    useProjectStore.setState({ dialogIndex: new Map(), isIngesting: false });
    useEditorStore.setState({ activeFile: null });
    useUISelectionStore.setState({ selectedNPC: null });
  });

  it('does not re-render and keeps handler identities stable across store mutations', () => {
    const stableProps = {
      isProjectMode: true,
      selectedNPC: 'NPC_Hero',
      selectedDialog: null,
      activeNpcName: null,
      finalizeDialogSelection: () => {},
      setIsLoadingDialog: () => {},
      setOperationError: () => {},
      closeRecentDialog: () => null,
    };

    let commits = 0;
    let lastHandleSelectNPC: unknown = null;
    let lastHandleSelectDialog: unknown = null;

    const Probe: React.FC = () => {
      const nav = useDialogNavigation(stableProps);
      commits += 1;
      lastHandleSelectNPC = nav.handleSelectNPC;
      lastHandleSelectDialog = nav.handleSelectDialog;
      return null;
    };

    render(<Probe />);
    const afterMount = commits;
    const firstSelectNPC = lastHandleSelectNPC;
    const firstSelectDialog = lastHandleSelectDialog;

    act(() => {
      useProjectStore.setState({ dialogIndex: new Map([['NPC_Hero', []]]) });
      useEditorStore.setState({ activeFile: '/p/a.d' });
      useUISelectionStore.setState({ selectedNPC: 'NPC_Other' });
    });

    expect(commits).toBe(afterMount);
    expect(lastHandleSelectNPC).toBe(firstSelectNPC);
    expect(lastHandleSelectDialog).toBe(firstSelectDialog);
  });
});
