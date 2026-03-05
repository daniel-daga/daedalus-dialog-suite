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

  test('shows spinner immediately when loading starts even before dialog is selected', () => {
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

    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(screen.queryByText('Select a dialog to edit')).not.toBeInTheDocument();
  });

  test('uses spinner instead of skeleton while loading selected dialog', () => {
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

    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(container.querySelector('.MuiSkeleton-root')).toBeNull();
  });
});
