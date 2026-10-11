import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import EditorPane from '../src/renderer/components/EditorPane';

describe('EditorPane loading state', () => {
  const baseProps = {
    selectedFunctionName: null,
    filePath: null,
    semanticModel: { dialogs: {}, functions: {}, hasErrors: false, errors: [] } as any,
    isProjectMode: false,
    recentDialogs: [],
    onSelectRecentDialog: jest.fn(),
    onCloseRecentDialog: jest.fn(),
    onNavigateToFunction: jest.fn()
  };

  test('shows the placeholder, not a spinner, when loading starts before any dialog is selected', () => {
    // There is no previously-committed dialog to keep on screen, so there is
    // nothing to overlay a spinner on top of — the placeholder is shown
    // as-is regardless of the loading flag.
    render(
      <EditorPane
        {...baseProps}
        selectedDialog={null}
        dialogData={null}
        currentFunctionName={null}
        currentFunctionData={null}
        isLoadingDialog
      />
    );

    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.getByText('Select a dialog to edit')).toBeInTheDocument();
  });

  test('overlays a spinner on top of the still-mounted editor while loading a selected dialog', () => {
    const { container } = render(
      <EditorPane
        {...baseProps}
        selectedDialog="DIA_TEST"
        dialogData={{ properties: { npc: 'PC_HERO' } } as any}
        currentFunctionName="DIA_TEST_Info"
        currentFunctionData={{ actions: [] } as any}
        isLoadingDialog
      />
    );

    // The overlay spinner is present...
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(container.querySelector('.MuiSkeleton-root')).toBeNull();
    // ...and the editor underneath stays mounted (not unmounted/replaced by
    // a bare loading shell) — its heading renders the dialog name.
    expect(screen.getByRole('heading', { name: 'DIA_TEST' })).toBeInTheDocument();
  });
});
