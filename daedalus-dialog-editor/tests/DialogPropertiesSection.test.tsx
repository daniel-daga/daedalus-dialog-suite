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
});
