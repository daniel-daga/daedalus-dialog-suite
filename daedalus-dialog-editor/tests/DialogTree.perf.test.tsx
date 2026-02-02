import React from 'react';
import { render, screen } from '@testing-library/react';
import DialogTree from '../src/renderer/components/DialogTree';
import '@testing-library/jest-dom';

// Mock useSearchStore
jest.mock('../src/renderer/store/searchStore', () => ({
  useSearchStore: jest.fn(() => ({
    dialogFilter: '',
    setDialogFilter: jest.fn(),
    filterDialogs: (dialogs) => dialogs,
  })),
}));

// Mock AutoSizer
jest.mock('react-virtualized-auto-sizer', () => (props) => props.children({ height: 500, width: 300 }));

describe('DialogTree Performance', () => {
  const mockSemanticModel = {
    dialogs: {
      'Dialog1': {
        name: 'Dialog1',
        parent: '',
        properties: {
            nr: 1,
            information: 'InfoFunc1'
        }
      },
      'Dialog2': {
        name: 'Dialog2',
        parent: '',
        properties: {
            nr: 2,
            information: 'InfoFunc2'
        }
      },
      'Dialog3': {
        name: 'Dialog3',
        parent: '',
        properties: {
            nr: 3,
            information: 'InfoFunc3'
        }
      }
    },
    functions: {
        'InfoFunc1': {
            name: 'InfoFunc1',
            returnType: 'VOID',
            actions: [
                {
                    dialogRef: 'Dialog1',
                    targetFunction: 'ChoiceFunc1',
                    text: 'Choice 1'
                }
            ],
            conditions: [],
            calls: []
        },
        'InfoFunc2': {
            name: 'InfoFunc2',
            returnType: 'VOID',
            actions: [],
            conditions: [],
            calls: []
        },
        'InfoFunc3': {
            name: 'InfoFunc3',
            returnType: 'VOID',
            actions: [],
            conditions: [],
            calls: []
        },
        'ChoiceFunc1': {
            name: 'ChoiceFunc1',
            returnType: 'VOID',
            actions: [],
            conditions: [],
            calls: []
        }
    },
    hasErrors: false,
    errors: []
  };

  const defaultProps = {
    selectedNPC: 'TestNPC',
    dialogsForNPC: ['Dialog1', 'Dialog2', 'Dialog3'],
    semanticModel: mockSemanticModel,
    selectedDialog: null,
    selectedFunctionName: null,
    expandedDialogs: new Set(),
    expandedChoices: new Set(),
    onSelectDialog: jest.fn(),
    onToggleDialogExpand: jest.fn(),
    onToggleChoiceExpand: jest.fn(),
    buildFunctionTree: jest.fn(),
  };

  test('does NOT call buildFunctionTree for collapsed dialogs (optimization)', () => {
    const buildFunctionTreeSpy = jest.fn();

    render(
      <DialogTree
        {...defaultProps}
        buildFunctionTree={buildFunctionTreeSpy}
      />
    );

    expect(buildFunctionTreeSpy).toHaveBeenCalledTimes(0);
  });

  test('calls buildFunctionTree only for expanded dialogs', () => {
    const buildFunctionTreeSpy = jest.fn().mockReturnValue({ children: [] });
    const expandedDialogs = new Set(['Dialog2']);

    render(
      <DialogTree
        {...defaultProps}
        expandedDialogs={expandedDialogs}
        buildFunctionTree={buildFunctionTreeSpy}
      />
    );

    expect(buildFunctionTreeSpy).toHaveBeenCalledTimes(1);
    expect(buildFunctionTreeSpy).toHaveBeenCalledWith('InfoFunc2');
  });

  test('renders expand icon for collapsed dialog with choices using shallow check', () => {
    const buildFunctionTreeSpy = jest.fn();

    render(
      <DialogTree
        {...defaultProps}
        buildFunctionTree={buildFunctionTreeSpy}
      />
    );

    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBe(4);
    expect(buildFunctionTreeSpy).toHaveBeenCalledTimes(0);
  });
});
