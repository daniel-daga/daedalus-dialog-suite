import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import DialogTreeItem from '../src/renderer/components/DialogTreeItem';

// Mock the recursive buildFunctionTree
const mockBuildFunctionTree = (funcName, ancestorPath = []) => {
  if (funcName === 'Info_Dialog') {
    return {
      name: 'Info_Dialog',
      children: [
        {
          text: 'Choice 1',
          targetFunction: 'Choice_1',
          subtree: {
            name: 'Choice_1',
            children: [
              {
                text: 'Choice 1.1',
                targetFunction: 'Choice_1_1',
                subtree: { name: 'Choice_1_1', children: [] }
              }
            ]
          }
        },
        {
          text: 'Choice 2',
          targetFunction: 'Choice_2',
          subtree: { name: 'Choice_2', children: [] }
        },
        {
          text: 'Choice 3',
          targetFunction: 'Choice_3',
          subtree: { name: 'Choice_3', children: [] }
        }
      ]
    };
  }
  return null;
};

const mockSemanticModel = {
  dialogs: {
    'DIA_Test': {
      properties: {
        information: 'Info_Dialog',
        description: 'Test Dialog'
      }
    }
  },
  functions: {
    'Info_Dialog': {
      actions: [{ dialogRef: true, targetFunction: 'Choice_1' }]
    }
  }
};

describe('DialogTreeItem Performance', () => {
  test('renders correctly', () => {
    const props = {
      dialogName: 'DIA_Test',
      semanticModel: mockSemanticModel,
      isSelected: false,
      isExpanded: true,
      expandedChoices: new Set(),
      selectedFunctionName: null,
      onSelectDialog: jest.fn(),
      onToggleDialogExpand: jest.fn(),
      onToggleChoiceExpand: jest.fn(),
      buildFunctionTree: mockBuildFunctionTree
    };

    render(<DialogTreeItem {...props} />);
    expect(screen.getByText('Test Dialog')).toBeInTheDocument();
    expect(screen.getByText('Choice 1')).toBeInTheDocument();
    expect(screen.getByText('Choice 2')).toBeInTheDocument();
  });
});
