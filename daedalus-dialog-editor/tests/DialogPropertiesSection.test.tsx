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
        semanticModel={{ dialogs: {}, functions: {} }}
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
        semanticModel={{ dialogs: {}, functions: {} }}
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
        semanticModel={{ dialogs: {}, functions: {} }}
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
        semanticModel={{ dialogs: {}, functions: {} }}
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
        semanticModel={{ dialogs: {}, functions: {} }}
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

  // A typed description is a string: unquoted, a single word was emitted as a
  // bare identifier (`description = Hallo;`). A constant keeps its bare form.
  test.each([
    ['Hallo', '"Hallo"'],
    ['Hallo du', '"Hallo du"'],
    ['"Schon zitiert"', '"Schon zitiert"'],
    ['DIALOG_ENDE', 'DIALOG_ENDE'],
    ['MY_TEXT', 'MY_TEXT']
  ])('writes a typed description %s as %s', (typed, written) => {
    const onDialogPropertyChange = jest.fn();
    const dialog = {
      name: 'DIA_Test',
      parent: 'C_INFO',
      properties: { npc: 'PC_HERO', nr: 1, description: '' }
    };

    render(
      <DialogPropertiesSection
        dialog={dialog}
        semanticModel={{ dialogs: {}, functions: {} }}
        propertiesExpanded
        onToggleExpanded={jest.fn()}
        onDialogPropertyChange={onDialogPropertyChange}
      />
    );

    const field = screen.getByRole('textbox', { name: 'Description' });
    fireEvent.change(field, { target: { value: typed } });
    fireEvent.blur(field);

    const updater = onDialogPropertyChange.mock.calls[0][0] as (existingDialog: typeof dialog) => typeof dialog;
    expect(updater(dialog).properties.description).toBe(written);
  });

  test('a lowercase constant the file declares keeps its bare form', () => {
    const onDialogPropertyChange = jest.fn();
    const dialog = {
      name: 'DIA_Test',
      parent: 'C_INFO',
      properties: { npc: 'PC_HERO', nr: 1, description: '' }
    };

    render(
      <DialogPropertiesSection
        dialog={dialog}
        semanticModel={{ dialogs: {}, functions: {}, constants: { Dialog_Weiter: { name: 'Dialog_Weiter' } } } as any}
        propertiesExpanded
        onToggleExpanded={jest.fn()}
        onDialogPropertyChange={onDialogPropertyChange}
      />
    );

    const field = screen.getByRole('textbox', { name: 'Description' });
    fireEvent.change(field, { target: { value: 'dialog_weiter' } });
    fireEvent.blur(field);

    const updater = onDialogPropertyChange.mock.calls[0][0] as (existingDialog: typeof dialog) => typeof dialog;
    expect(updater(dialog).properties.description).toBe('dialog_weiter');
  });
});
