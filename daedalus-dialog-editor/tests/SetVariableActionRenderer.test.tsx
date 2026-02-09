import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import SetVariableActionRenderer from '../src/renderer/components/actionRenderers/SetVariableActionRenderer';
import { SetVariableAction } from '../src/renderer/components/actionTypes';

// Create a mock function to capture props
const mockVariableAutocomplete = jest.fn();

// Mock VariableAutocomplete to simplify testing and capture props
jest.mock('../src/renderer/components/common/VariableAutocomplete', () => {
  return function MockVariableAutocomplete(props: any) {
    mockVariableAutocomplete(props);
    return (
      <div data-testid={`autocomplete-${props.label}`} className={props.textFieldProps?.error ? 'error' : ''}>
        <label>{props.label}</label>
        <input
            value={props.value}
            onChange={(e) => props.onChange(e.target.value)}
            onKeyDown={props.onKeyDown}
        />
        {props.textFieldProps?.helperText && <span data-testid={`helper-${props.label}`}>{props.textFieldProps.helperText}</span>}
      </div>
    );
  };
});

describe('SetVariableActionRenderer', () => {
  const mockAction: SetVariableAction = {
    variableName: 'MIS_Test',
    operator: '=',
    value: 'LOG_RUNNING'
  };

  const mockProps = {
    action: mockAction,
    index: 0,
    totalActions: 1,
    npcName: 'TestNPC',
    handleUpdate: jest.fn(),
    handleDelete: jest.fn(),
    flushUpdate: jest.fn(),
    handleKeyDown: jest.fn(),
    mainFieldRef: { current: null },
    semanticModel: {} as any
  };

  beforeEach(() => {
    mockVariableAutocomplete.mockClear();
  });

  test('renders variable name, operator and value', () => {
    render(<SetVariableActionRenderer {...mockProps} />);

    // Check Variable Name (Autocomplete mock)
    expect(screen.getByTestId('autocomplete-Variable')).toBeInTheDocument();
    expect(screen.getByDisplayValue('MIS_Test')).toBeInTheDocument();

    // Check Operator (Select/TextField)
    expect(screen.getByDisplayValue('=')).toBeInTheDocument();

    // Check Value (TextField)
    expect(screen.getByLabelText('Value')).toBeInTheDocument();
    expect(screen.getByDisplayValue('LOG_RUNNING')).toBeInTheDocument();
  });

  test('calls handleUpdate when variable name changes', () => {
    render(<SetVariableActionRenderer {...mockProps} />);

    const variableInput = screen.getByTestId('autocomplete-Variable').querySelector('input');
    fireEvent.change(variableInput!, { target: { value: 'NewVar' } });

    expect(mockProps.handleUpdate).toHaveBeenCalledWith({
      ...mockAction,
      variableName: 'NewVar'
    });
  });

  test('shows error when variable name is empty', () => {
    const emptyAction = { ...mockAction, variableName: '' };
    render(<SetVariableActionRenderer {...mockProps} action={emptyAction} />);

    const autocomplete = screen.getByTestId('autocomplete-Variable');
    expect(autocomplete).toHaveClass('error');
    expect(screen.getByTestId('helper-Variable')).toHaveTextContent('Variable name required');
  });

  test('shows error when variable name is whitespace', () => {
    const whitespaceAction = { ...mockAction, variableName: '   ' };
    render(<SetVariableActionRenderer {...mockProps} action={whitespaceAction} />);

    const autocomplete = screen.getByTestId('autocomplete-Variable');
    expect(autocomplete).toHaveClass('error');
    expect(screen.getByTestId('helper-Variable')).toHaveTextContent('Variable name required');
  });

  test('Value field is a plain text input (no autocomplete)', () => {
    render(<SetVariableActionRenderer {...mockProps} />);

    expect(screen.queryByTestId('autocomplete-Value')).toBeNull();
    expect(screen.getByLabelText('Value')).toBeInTheDocument();
  });
});
