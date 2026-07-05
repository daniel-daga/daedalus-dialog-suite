import React from 'react';
import { render, screen } from '@testing-library/react';
import EditorPane from '../src/renderer/components/EditorPane';
import '@testing-library/jest-dom';

describe('EditorPane recent-dialog tabs', () => {
  const baseProps = {
    selectedDialog: null,
    dialogData: null,
    currentFunctionName: null,
    currentFunctionData: null,
    selectedFunctionName: null,
    filePath: null,
    semanticModel: {} as any,
    isLoadingDialog: false,
    onSelectRecentDialog: jest.fn(),
    onCloseRecentDialog: jest.fn(),
    onNavigateToFunction: jest.fn(),
    onDeleteDialog: jest.fn(),
    onRenameDialog: jest.fn(),
  } as any;

  const recentDialogs = [
    { dialogName: 'DIA_Test_Hello', npcName: 'NPC_A', functionName: 'ZS_Test' },
    { dialogName: 'DIA_Test_Bye', npcName: 'NPC_B', functionName: null },
  ];

  test('close button is not a <button> nested inside the tab <button>', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    render(<EditorPane {...baseProps} recentDialogs={recentDialogs} />);

    const closeControl = screen.getByLabelText('Close tab NPC_A: DIA_Test_Hello');

    // The close control lives inside the tab's <button>. It must therefore NOT
    // itself be a native <button>, which would be invalid DOM nesting.
    expect(closeControl.tagName).not.toBe('BUTTON');
    expect(closeControl.closest('button')).not.toBeNull();

    const nestingWarning = errorSpy.mock.calls.some((call) =>
      String(call[0]).includes('validateDOMNesting')
    );
    expect(nestingWarning).toBe(false);

    errorSpy.mockRestore();
  });
});
