/**
 * The delete-confirm dialog is opened by Escape in an action field. Escape then
 * Enter means "back out" everywhere else, so the default focus must be Cancel:
 * Enter cancels, and Delete is a Tab away.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import DeleteConfirmDialog from '../src/renderer/components/common/DeleteConfirmDialog';

describe('DeleteConfirmDialog', () => {
  test('focuses Cancel, not Delete, when opened', async () => {
    render(<DeleteConfirmDialog open onConfirm={jest.fn()} onCancel={jest.fn()} />);

    const cancel = screen.getByRole('button', { name: 'Cancel' });
    await waitFor(() => expect(cancel).toHaveFocus());
    expect(screen.getByRole('button', { name: 'Delete' })).not.toHaveFocus();
  });
});
