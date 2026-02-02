import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import DialogTreeItem from '../src/renderer/components/DialogTreeItem';

// Mock semantic model
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
      onSelectDialog: jest.fn(),
      onToggleDialogExpand: jest.fn(),
      hasChildren: true,
      style: { height: 40, width: '100%' }
    };

    render(<DialogTreeItem {...props} />);
    expect(screen.getByText('Test Dialog')).toBeInTheDocument();
  });
});
