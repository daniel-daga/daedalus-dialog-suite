import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import VariableAutocomplete from '../src/renderer/components/common/VariableAutocomplete';
import { useProjectStore } from '../src/renderer/store/projectStore';

// Mock the project store
jest.mock('../src/renderer/store/projectStore', () => ({
  useProjectStore: jest.fn()
}));

// Mock navigation
jest.mock('../src/renderer/hooks/useNavigation', () => ({
  useNavigation: () => ({
    navigateToSymbol: jest.fn(),
    navigateToDialog: jest.fn()
  })
}));

describe('VariableAutocomplete', () => {
  const mockVariables = {
    MIS_Quest1: { name: 'MIS_Quest1', type: 'int' },
    OTHER_Var: { name: 'OTHER_Var', type: 'INT' },
    FLOAT_Var: { name: 'FLOAT_Var', type: 'float' }
  };

  beforeEach(() => {
    (useProjectStore as jest.Mock).mockReturnValue({
      mergedSemanticModel: {
        variables: mockVariables,
        constants: {},
        instances: {}
      },
      dialogIndex: new Map(),
      questFiles: [],
      allDialogFiles: [],
      isLoading: false,
      addVariable: jest.fn()
    });
  });

  test('filters by namePrefix', async () => {
    const onChange = jest.fn();
    render(
      <VariableAutocomplete
        value=""
        onChange={onChange}
        namePrefix="MIS_"
        label="Test Autocomplete"
      />
    );

    const input = screen.getByLabelText('Test Autocomplete');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.keyDown(input, { key: 'ArrowDown' });

    // Wait for options to appear
    await waitFor(() => {
      expect(screen.getByText('MIS_Quest1')).toBeInTheDocument();
    });
    
    expect(screen.queryByText('OTHER_Var')).not.toBeInTheDocument();
  });

  test('shows all variables when no namePrefix is provided', async () => {
    const onChange = jest.fn();
    render(
      <VariableAutocomplete
        value=""
        onChange={onChange}
        label="Test Autocomplete"
      />
    );

    const input = screen.getByLabelText('Test Autocomplete');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.keyDown(input, { key: 'ArrowDown' });

    // Wait for options to appear
    await waitFor(() => {
      expect(screen.getByText('MIS_Quest1')).toBeInTheDocument();
      expect(screen.getByText('OTHER_Var')).toBeInTheDocument();
    });
  });

  test('filters by typeFilter case-insensitively', async () => {
    const onChange = jest.fn();
    render(
      <VariableAutocomplete
        value=""
        onChange={onChange}
        typeFilter={['int']}
        label="Test Autocomplete"
      />
    );

    const input = screen.getByLabelText('Test Autocomplete');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.keyDown(input, { key: 'ArrowDown' });

    // Wait for options to appear
    await waitFor(() => {
      expect(screen.getByText('MIS_Quest1')).toBeInTheDocument();
      expect(screen.getByText('OTHER_Var')).toBeInTheDocument();
    });
    
    expect(screen.queryByText('FLOAT_Var')).not.toBeInTheDocument();
  });
});
