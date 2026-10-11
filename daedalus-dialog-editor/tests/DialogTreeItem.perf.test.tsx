import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import DialogTreeItem from '../src/renderer/components/DialogTreeItem';

describe('DialogTreeItem Performance', () => {
  test('renders correctly', () => {
    const props = {
      dialogName: 'DIA_Test',
      description: 'Test Dialog',
      infoFuncName: 'Info_Dialog',
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
