import React from 'react';
import { describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react';
import DialogPropertiesSection from '../src/renderer/components/DialogPropertiesSection';

describe('DialogPropertiesSection', () => {
  test('shows Important and Permanent checkboxes in expanded properties', () => {
    const dialog = {
      name: 'DIA_Test',
      parent: 'C_INFO',
      properties: {
        npc: 'PC_HERO',
        nr: 1,
        description: 'Hello',
        important: true,
        permanent: false
      }
    };

    render(
      <DialogPropertiesSection
        dialog={dialog}
        semanticModel={{ dialogs: {}, functions: {}, hasErrors: false, errors: [] }}
        propertiesExpanded
        onToggleExpanded={jest.fn()}
        onDialogPropertyChange={jest.fn()}
      />
    );

    expect(screen.getByRole('checkbox', { name: /important/i })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /permanent/i })).toBeInTheDocument();
  });

  test('updates important property when checkbox is toggled', () => {
    const onDialogPropertyChange = jest.fn();
    const dialog = {
      name: 'DIA_Test',
      parent: 'C_INFO',
      properties: {
        npc: 'PC_HERO',
        nr: 1,
        description: 'Hello',
        important: false,
        permanent: false
      }
    };

    render(
      <DialogPropertiesSection
        dialog={dialog}
        semanticModel={{ dialogs: {}, functions: {}, hasErrors: false, errors: [] }}
        propertiesExpanded
        onToggleExpanded={jest.fn()}
        onDialogPropertyChange={onDialogPropertyChange}
      />
    );

    fireEvent.click(screen.getByRole('checkbox', { name: /important/i }));

    expect(onDialogPropertyChange).toHaveBeenCalledTimes(1);
    const updater = onDialogPropertyChange.mock.calls[0][0] as (existingDialog: typeof dialog) => typeof dialog;
    const updatedDialog = updater(dialog);
    expect(updatedDialog.properties.important).toBe(true);
    expect(updatedDialog.properties.permanent).toBe(false);
  });

  test('updates permanent property when checkbox is toggled', () => {
    const onDialogPropertyChange = jest.fn();
    const dialog = {
      name: 'DIA_Test',
      parent: 'C_INFO',
      properties: {
        npc: 'PC_HERO',
        nr: 1,
        description: 'Hello',
        important: false,
        permanent: false
      }
    };

    render(
      <DialogPropertiesSection
        dialog={dialog}
        semanticModel={{ dialogs: {}, functions: {}, hasErrors: false, errors: [] }}
        propertiesExpanded
        onToggleExpanded={jest.fn()}
        onDialogPropertyChange={onDialogPropertyChange}
      />
    );

    fireEvent.click(screen.getByRole('checkbox', { name: /permanent/i }));

    expect(onDialogPropertyChange).toHaveBeenCalledTimes(1);
    const updater = onDialogPropertyChange.mock.calls[0][0] as (existingDialog: typeof dialog) => typeof dialog;
    const updatedDialog = updater(dialog);
    expect(updatedDialog.properties.permanent).toBe(true);
    expect(updatedDialog.properties.important).toBe(false);
  });

  // #283: the parser hands `FALSE` over as the identifier string "FALSE" and
  // keeps the property's source casing (`Permanent`).
  test('shows FALSE flags unchecked and TRUE flags checked as the parser delivers them', () => {
    const dialog = {
      name: 'DIA_Test',
      parent: 'C_INFO',
      properties: { npc: 'PC_HERO', nr: 1, description: 'Hello', important: 'FALSE', Permanent: 'TRUE' }
    };

    render(
      <DialogPropertiesSection
        dialog={dialog as any}
        semanticModel={{ dialogs: {}, functions: {}, hasErrors: false, errors: [] }}
        propertiesExpanded
        onToggleExpanded={jest.fn()}
        onDialogPropertyChange={jest.fn()}
      />
    );

    expect(screen.getByRole('checkbox', { name: /important/i })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /permanent/i })).toBeChecked();
  });

  test('toggling a flag writes back to its source-cased key rather than adding a second one', () => {
    const onDialogPropertyChange = jest.fn();
    const dialog = {
      name: 'DIA_Test',
      parent: 'C_INFO',
      properties: { npc: 'PC_HERO', nr: 1, description: 'Hello', Permanent: 'TRUE' } as Record<string, unknown>
    };

    render(
      <DialogPropertiesSection
        dialog={dialog as any}
        semanticModel={{ dialogs: {}, functions: {}, hasErrors: false, errors: [] }}
        propertiesExpanded
        onToggleExpanded={jest.fn()}
        onDialogPropertyChange={onDialogPropertyChange}
      />
    );

    fireEvent.click(screen.getByRole('checkbox', { name: /permanent/i }));

    const updater = onDialogPropertyChange.mock.calls[0][0] as (existingDialog: typeof dialog) => typeof dialog;
    const updated = updater(dialog);
    expect(updated.properties.Permanent).toBe(false);
    expect(updated.properties).not.toHaveProperty('permanent');
  });

  // The description holds text; whether it is a string or a constant lives in
  // the dialog's literal/expression key lists, never in quotes (#277 follow-up).
  type Described = {
    name: string;
    parent: string;
    properties: { npc: string; nr: number; description: string };
    propertyLiteralKeys?: string[];
    propertyExpressionKeys?: string[];
  };

  const renderSection = (dialog: Described, expanded = true, semanticModel: any = { dialogs: {}, functions: {} }) => {
    const onDialogPropertyChange = jest.fn();
    render(
      <DialogPropertiesSection
        dialog={dialog}
        semanticModel={semanticModel}
        propertiesExpanded={expanded}
        onToggleExpanded={jest.fn()}
        onDialogPropertyChange={onDialogPropertyChange}
      />
    );
    const written = () => {
      const calls = onDialogPropertyChange.mock.calls;
      const updater = calls[calls.length - 1][0] as (existing: Described) => Described;
      return updater(dialog);
    };
    return { onDialogPropertyChange, written };
  };

  const stringDialog = (description: string): Described => ({
    name: 'DIA_Test',
    parent: 'C_INFO',
    properties: { npc: 'PC_HERO', nr: 1, description },
    propertyLiteralKeys: ['description'],
    propertyExpressionKeys: []
  });

  const constantDialog = (description: string): Described => ({
    ...stringDialog(description),
    propertyLiteralKeys: [],
    propertyExpressionKeys: ['description']
  });

  test('shows a string description as its text, without quotes', () => {
    renderSection(stringDialog('Hallo du'));
    expect(screen.getByRole('textbox', { name: 'Description' })).toHaveValue('Hallo du');
  });

  test('deleting the last character writes the shorter text, with no stray quote', () => {
    const { written } = renderSection(stringDialog('Hallo du'));
    const field = screen.getByRole('textbox', { name: 'Description' });
    fireEvent.change(field, { target: { value: 'Hallo d' } });
    fireEvent.blur(field);
    expect(written().properties.description).toBe('Hallo d');
  });

  // No more guessing: in Text mode a constant-shaped word is a string too.
  test.each(['Hallo', 'Hallo du', 'DIALOG_ENDE', 'MY_TEXT'])('typed text %s is written as a string', (typed) => {
    const { written } = renderSection(constantDialog('DIALOG_WEITER'));
    fireEvent.click(screen.getByRole('button', { name: 'Text' }));
    const field = screen.getByRole('textbox', { name: 'Description' });
    fireEvent.change(field, { target: { value: typed } });
    fireEvent.blur(field);
    const result = written();
    expect(result.properties.description).toBe(typed);
    expect(result.propertyLiteralKeys).toContain('description');
    expect(result.propertyExpressionKeys).not.toContain('description');
  });

  test('a double quote typed into the text cannot reach the file', () => {
    const { written } = renderSection(stringDialog(''));
    const field = screen.getByRole('textbox', { name: 'Description' });
    fireEvent.change(field, { target: { value: 'Er sagt "Hallo"' } });
    fireEvent.blur(field);
    expect(written().properties.description).not.toContain('"');
  });

  test('blurring an untouched field writes nothing', () => {
    const { onDialogPropertyChange } = renderSection(stringDialog('Hallo du'));
    fireEvent.blur(screen.getByRole('textbox', { name: 'Description' }));
    expect(onDialogPropertyChange).not.toHaveBeenCalled();
  });

  test('a constant description opens in Constant mode and shows its name', () => {
    renderSection(constantDialog('DIALOG_ENDE'));
    expect(screen.getByRole('button', { name: 'Constant' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('combobox', { name: 'Description constant' })).toHaveValue('DIALOG_ENDE');
  });

  test('choosing a constant writes it as an expression', () => {
    const { written } = renderSection(stringDialog('Hallo du'));
    fireEvent.click(screen.getByRole('button', { name: 'Constant' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Description constant' }), { target: { value: 'DIALOG_WEITER' } });
    const result = written();
    expect(result.properties.description).toBe('DIALOG_WEITER');
    expect(result.propertyExpressionKeys).toContain('description');
    expect(result.propertyLiteralKeys).not.toContain('description');
  });

  test('switching modes alone writes nothing', () => {
    const { onDialogPropertyChange } = renderSection(stringDialog('Hallo du'));
    fireEvent.click(screen.getByRole('button', { name: 'Constant' }));
    fireEvent.click(screen.getByRole('button', { name: 'Text' }));
    fireEvent.blur(screen.getByRole('textbox', { name: 'Description' }));
    expect(onDialogPropertyChange).not.toHaveBeenCalled();
  });

  test('the collapsed chip shows the text without quotes', () => {
    renderSection(stringDialog('Hallo du'), false);
    expect(screen.getByText('Hallo du')).toBeInTheDocument();
  });
});
