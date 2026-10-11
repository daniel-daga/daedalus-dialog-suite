/**
 * The mechanical half of production-readiness F19-F22: the highest-stakes
 * dialogs are described by their body text, and the collapsible section
 * headers' toggle buttons say whether they are expanded and toggle from the
 * keyboard.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import userEvent from '@testing-library/user-event';
import DeleteConfirmDialog from '../src/renderer/components/common/DeleteConfirmDialog';
import ExternalChangeConflictDialog from '../src/renderer/components/ExternalChangeConflictDialog';
import DialogPropertiesSection from '../src/renderer/components/DialogPropertiesSection';
import { useFileStore } from '../src/renderer/store/fileStore';

describe('dialogs are described by their body text', () => {
  it('DeleteConfirmDialog', () => {
    render(<DeleteConfirmDialog open onConfirm={jest.fn()} onCancel={jest.fn()} message="Gone for good." />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAccessibleDescription('Gone for good.');
  });

  it('ExternalChangeConflictDialog', () => {
    useFileStore.setState({
      openFiles: new Map([['C:/p/DIA_X.d', {
        filePath: 'C:/p/DIA_X.d',
        semanticModel: { dialogs: {}, functions: {}, hasErrors: false, errors: [] },
        isDirty: true,
        lastSaved: new Date(),
        externalConflict: { detectedAt: new Date().toISOString(), fileMissing: true }
      } as never]]),
      activeFile: 'C:/p/DIA_X.d'
    } as never);
    render(<ExternalChangeConflictDialog />);
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription(/DIA_X\.d was deleted or moved on disk/);
  });
});

describe('collapsible section headers', () => {
  it('the properties toggle reports its state and toggles from the keyboard', async () => {
    const onToggleExpanded = jest.fn();
    render(
      <DialogPropertiesSection
        dialog={{ name: 'DIA_X', parent: 'C_INFO', properties: { npc: 'PC_Hero' } } as never}
        propertiesExpanded={false}
        onToggleExpanded={onToggleExpanded}
        onDialogPropertyChange={jest.fn()}
      />
    );
    const toggle = screen.getByRole('button', { name: 'Expand properties' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    toggle.focus();
    await userEvent.keyboard('{Enter}');
    expect(onToggleExpanded).toHaveBeenCalledTimes(1);
  });
});
