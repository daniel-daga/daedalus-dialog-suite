import React from 'react';
import { render, act } from '@testing-library/react';
import { useProjectStore } from '../src/renderer/store/projectStore';
import { useEditorStore } from '../src/renderer/store/editorStore';
import { useUISelectionStore } from '../src/renderer/store/uiSelectionStore';
import { useNavigation } from '../src/renderer/hooks/useNavigation';

const emptyModel = {
  dialogs: {}, functions: {}, constants: {}, variables: {},
  instances: {}, hasErrors: false, errors: []
};

/**
 * Regression guard for N1: useNavigation must not subscribe to any store.
 * Its callbacks are event handlers, so mutating projectStore
 * (`mergedSemanticModel`), editorStore (`openFiles`) or uiSelectionStore must
 * not re-render consumers, and the returned callbacks must keep stable
 * identities across those mutations.
 */
describe('useNavigation store subscription granularity', () => {
  beforeEach(() => {
    useProjectStore.setState({
      mergedSemanticModel: { ...emptyModel },
      dialogIndex: new Map(),
      projectPath: null,
    } as never);
    useEditorStore.setState({
      openFiles: new Map(),
      activeFile: null,
    } as never);
    useUISelectionStore.setState({ selectedNPC: null } as never);
  });

  test('does not re-render consumers and keeps callback identities stable when stores change', () => {
    let renderCount = 0;
    const captured: Array<ReturnType<typeof useNavigation>['navigateToDialog']> = [];
    const Probe = () => {
      const { navigateToDialog } = useNavigation();
      captured.push(navigateToDialog);
      renderCount += 1;
      return null;
    };

    render(<Probe />);
    const initialRenders = renderCount;
    const initialNavigate = captured[captured.length - 1];

    act(() => {
      useProjectStore.setState({ mergedSemanticModel: { ...emptyModel } } as never);
    });
    act(() => {
      useEditorStore.setState({ openFiles: new Map() } as never);
    });
    act(() => {
      useUISelectionStore.setState({ selectedNPC: 'NPC_Hero' } as never);
    });

    expect(renderCount).toBe(initialRenders);
    expect(captured[captured.length - 1]).toBe(initialNavigate);
  });
});
