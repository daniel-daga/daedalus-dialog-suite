import React, { memo } from 'react';
import { render, screen, act } from '@testing-library/react';
import DialogTree from '../src/renderer/components/DialogTree';
import '@testing-library/jest-dom';

// Mock mocks
const mockDialogTreeItemRender = jest.fn();
const mockChoiceTreeItemRender = jest.fn();

// Mock child components - MUST be memoized to verify optimization
jest.mock('../src/renderer/components/DialogTreeItem', () => {
  const React = require('react');
  return React.memo((props) => {
    mockDialogTreeItemRender(props.dialogName);
    return <div data-testid="dialog-item">{props.dialogName}</div>;
  }, (prev, next) => {
    if (prev.dialogName !== next.dialogName) return false;
    if (prev.isSelected !== next.isSelected) return false;
    return true;
  });
});

jest.mock('../src/renderer/components/ChoiceTreeItem', () => {
  const React = require('react');
  return React.memo((props) => {
    mockChoiceTreeItemRender(props.choiceKey);
    return <div data-testid="choice-item">{props.choiceKey}</div>;
  });
});

// Mock useSearchStore
jest.mock('../src/renderer/store/searchStore', () => ({
  useSearchStore: jest.fn(() => ({
    dialogFilter: '',
    setDialogFilter: jest.fn(),
    filterDialogs: (dialogs) => dialogs,
  })),
}));

// Mock AutoSizer to render immediately
jest.mock('react-virtualized-auto-sizer', () => (props) => props.children({ height: 500, width: 300 }));

describe('DialogTree Render Performance', () => {
  const mockSemanticModel = {
    dialogs: {
      'Dialog1': {
        name: 'Dialog1',
        properties: { nr: 1, information: 'InfoFunc1' }
      },
      'Dialog2': {
        name: 'Dialog2',
        properties: { nr: 2, information: 'InfoFunc2' }
      },
      'Dialog3': {
        name: 'Dialog3',
        properties: { nr: 3, information: 'InfoFunc3' }
      }
    },
    functions: {},
    hasErrors: false,
    errors: []
  };

  const defaultProps = {
    selectedNPC: 'TestNPC',
    dialogsForNPC: ['Dialog1', 'Dialog2', 'Dialog3'],
    semanticModel: mockSemanticModel,
    selectedDialog: 'Dialog1', // Initial selection
    selectedFunctionName: 'InfoFunc1',
    expandedDialogs: new Set(),
    expandedChoices: new Set(),
    onSelectDialog: jest.fn(),
    onToggleDialogExpand: jest.fn(),
    onToggleChoiceExpand: jest.fn(),
    buildFunctionTree: jest.fn(),
  };

  beforeEach(() => {
    mockDialogTreeItemRender.mockClear();
    mockChoiceTreeItemRender.mockClear();
  });

  test('changing selection re-renders ONLY affected items', () => {
    const { rerender } = render(<DialogTree {...defaultProps} />);

    // Initial render
    expect(mockDialogTreeItemRender).toHaveBeenCalledTimes(3);
    mockDialogTreeItemRender.mockClear();

    // Change selection from Dialog1 to Dialog2
    rerender(
      <DialogTree
        {...defaultProps}
        selectedDialog="Dialog2"
        selectedFunctionName="InfoFunc2"
      />
    );

    // Optimized behavior:
    // Dialog1 (deselected) -> Re-render
    // Dialog2 (selected) -> Re-render
    // Dialog3 (unchanged) -> NO Re-render

    const renderCount = mockDialogTreeItemRender.mock.calls.length;
    expect(renderCount).toBe(2);
  });
});
