import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import VariableAutocomplete from '../src/renderer/components/common/VariableAutocomplete';
import { useProjectStore } from '../src/renderer/store/projectStore';

// Mock the project store
jest.mock('../src/renderer/store/projectStore', () => ({
  useProjectStore: jest.fn()
}));

const navigateToSymbol = jest.fn();
const navigateToDialog = jest.fn();

// Mock navigation
jest.mock('../src/renderer/hooks/useNavigation', () => ({
  useNavigation: () => ({
    navigateToSymbol,
    navigateToDialog
  })
}));

describe('VariableAutocomplete', () => {
  const mockVariables = {
    MIS_Quest1: { name: 'MIS_Quest1', type: 'int' },
    OTHER_Var: { name: 'OTHER_Var', type: 'INT' },
    FLOAT_Var: { name: 'FLOAT_Var', type: 'float' }
  };

  const mockConstants = {
    DIA_Greeting: { name: 'DIA_Greeting', type: 'string', value: 'hello' }
  };

  const mockInstances = {
    Diego: { name: 'Diego', parent: 'C_NPC', displayName: 'Diego the Guard' },
    ItMi_Sword: { name: 'ItMi_Sword', parent: 'C_ITEM', displayName: 'Rusty Sword' }
  };

  beforeEach(() => {
    navigateToSymbol.mockClear();
    navigateToDialog.mockClear();
    (useProjectStore as jest.Mock).mockReturnValue({
      mergedSemanticModel: {
        variables: mockVariables,
        constants: mockConstants,
        instances: mockInstances
      },
      dialogIndex: new Map([
        ['DIEGO', [
          { dialogName: 'DIA_Diego_Hello', filePath: 'DIEGO.d' },
          { dialogName: 'INFO_Diego_Internal', filePath: 'DIEGO.d' }
        ]]
      ]),
      npcList: ['SLD_200_DIEGO'],
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

  test('deduplicates names and prefers local semantic constants over merged/global', async () => {
    const onChange = jest.fn();
    render(
      <VariableAutocomplete
        value=""
        onChange={onChange}
        label="Test Autocomplete"
        semanticModel={{
          constants: {
            DUP_NAME: { name: 'DUP_NAME', type: 'int', value: 111 }
          },
          variables: {
            dup_name: { name: 'dup_name', type: 'string' }
          },
          instances: {},
          functions: {},
          dialogs: {},
          hasErrors: false,
          errors: []
        } as any}
      />
    );

    const input = screen.getByLabelText('Test Autocomplete');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'DUP' } });
    fireEvent.keyDown(input, { key: 'ArrowDown' });

    await waitFor(() => {
      expect(screen.getByText('DUP_NAME')).toBeInTheDocument();
    });

    expect(screen.queryByText('dup_name')).not.toBeInTheDocument();
    expect(screen.getByText('Value: 111')).toBeInTheDocument();
  });

  test('filters dialog options by prefix and tags them as C_INFO', async () => {
    const onChange = jest.fn();
    render(
      <VariableAutocomplete
        value=""
        onChange={onChange}
        showDialogs
        typeFilter="C_INFO"
        namePrefix="DIA_"
        label="Dialog"
      />
    );

    const input = screen.getByLabelText('Dialog');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'DIA_' } });
    fireEvent.keyDown(input, { key: 'ArrowDown' });

    await waitFor(() => {
      expect(screen.getByText('DIA_Diego_Hello')).toBeInTheDocument();
    });

    expect(screen.queryByText('INFO_Diego_Internal')).not.toBeInTheDocument();
    expect(screen.getByText('C_INFO')).toBeInTheDocument();
  });

  test('withholds normal suggestions for very large lists until 2 chars', async () => {
    const bigVariables: Record<string, { name: string; type: string }> = {};
    for (let i = 0; i < 2100; i += 1) {
      const name = `VAR_${i}`;
      bigVariables[name] = { name, type: 'int' };
    }

    (useProjectStore as jest.Mock).mockReturnValue({
      mergedSemanticModel: {
        variables: bigVariables,
        constants: {},
        instances: {}
      },
      dialogIndex: new Map(),
      questFiles: [],
      allDialogFiles: [],
      isLoading: false,
      addVariable: jest.fn()
    });

    render(
      <VariableAutocomplete
        value=""
        onChange={jest.fn()}
        label="Large"
      />
    );

    const input = screen.getByLabelText('Large');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.keyDown(input, { key: 'ArrowDown' });

    await waitFor(() => {
      expect(screen.queryByText('VAR_1')).not.toBeInTheDocument();
    });

    fireEvent.change(input, { target: { value: 'A' } });
    fireEvent.keyDown(input, { key: 'ArrowDown' });

    await waitFor(() => {
      expect(screen.getByText('Add "A"')).toBeInTheDocument();
    });
    expect(screen.queryByText('VAR_1')).not.toBeInTheDocument();
  });

  test('shows follow-reference icon only when value matches an option', async () => {
    const onChange = jest.fn();
    const { rerender } = render(
      <VariableAutocomplete
        value="MIS_Quest1"
        onChange={onChange}
        label="Nav"
      />
    );

    expect(await screen.findByTestId('OpenInNewIcon')).toBeInTheDocument();

    rerender(
      <VariableAutocomplete
        value="DOES_NOT_EXIST"
        onChange={onChange}
        label="Nav"
      />
    );

    expect(screen.queryByTestId('OpenInNewIcon')).not.toBeInTheDocument();
  });



  test('navigates with symbol kind to avoid expensive fallback resolution', async () => {
    const onChange = jest.fn();
    render(
      <VariableAutocomplete
        value="MIS_Quest1"
        onChange={onChange}
        label="Nav kind"
      />
    );

    fireEvent.click(await screen.findByTestId('OpenInNewIcon'));

    expect(navigateToSymbol).toHaveBeenCalledWith('MIS_Quest1', { kind: 'variable' });
  });
  test('falls back to project npcList for C_NPC suggestions when instances are missing', async () => {
    (useProjectStore as jest.Mock).mockReturnValue({
      mergedSemanticModel: {
        variables: {},
        constants: {},
        instances: {}
      },
      dialogIndex: new Map(),
      npcList: ['SLD_200_DIEGO', 'PC_HERO'],
      questFiles: [],
      allDialogFiles: [],
      isLoading: false,
      addVariable: jest.fn()
    });

    render(
      <VariableAutocomplete
        value=""
        onChange={jest.fn()}
        showInstances
        typeFilter="C_NPC"
        label="NPC"
      />
    );

    const input = screen.getByLabelText('NPC');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'SLD_' } });
    fireEvent.keyDown(input, { key: 'ArrowDown' });

    await waitFor(() => {
      expect(screen.getByText('SLD_200_DIEGO')).toBeInTheDocument();
    });
  });

  test('supports item display name aliases but inserts the instance id', async () => {
    const onChange = jest.fn();
    render(
      <VariableAutocomplete
        value=""
        onChange={onChange}
        showInstances
        typeFilter="C_ITEM"
        label="Item"
      />
    );

    const input = screen.getByLabelText('Item');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Rusty' } });
    fireEvent.keyDown(input, { key: 'ArrowDown' });

    await waitFor(() => {
      expect(screen.getByText('Rusty Sword')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Rusty Sword'));

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith('ItMi_Sword');
    });
  });

  test('supports npc display name aliases but inserts the instance id', async () => {
    const onChange = jest.fn();
    render(
      <VariableAutocomplete
        value=""
        onChange={onChange}
        showInstances
        typeFilter="C_NPC"
        label="NPC"
      />
    );

    const input = screen.getByLabelText('NPC');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Guard' } });
    fireEvent.keyDown(input, { key: 'ArrowDown' });

    await waitFor(() => {
      expect(screen.getByText('Diego the Guard')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Diego the Guard'));

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith('Diego');
    });
  });
});
