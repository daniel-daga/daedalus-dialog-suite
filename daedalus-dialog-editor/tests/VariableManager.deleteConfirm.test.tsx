/**
 * Variable deletion writes the file immediately with no undo, and used to ask
 * through the native `confirm()` and report failure through `alert()`. Both go
 * through the house idiom now: `DeleteConfirmDialog`, stating that the delete
 * is irreversible, and an in-app error when the write fails.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import VariableManager from '../src/renderer/components/VariableManager';
import { useProjectStore } from '../src/renderer/store/projectStore';
import { useFileStore } from '../src/renderer/store/fileStore';

const RANGE = { startIndex: 10, endIndex: 30 };

function seed(deleteVariable: jest.Mock) {
  useProjectStore.setState({
    mergedSemanticModel: {
      dialogs: {},
      functions: {},
      constants: {},
      variables: { V_B: { name: 'V_B', type: 'int', filePath: '/a.d', range: RANGE } },
      instances: {},
      hasErrors: false,
      errors: []
    },
    deleteVariable,
    questFiles: [],
    allDialogFiles: [],
    addVariable: jest.fn(),
    isLoading: false
  } as never);
}

describe('VariableManager delete confirmation', () => {
  beforeEach(() => {
    window.confirm = jest.fn(() => { throw new Error('native confirm must not be used'); });
    window.alert = jest.fn(() => { throw new Error('native alert must not be used'); });
    useFileStore.setState({ openFiles: new Map(), activeFile: null } as never);
  });

  it('asks through the in-app dialog, stating irreversibility, and deletes on confirm', async () => {
    const deleteVariable = jest.fn().mockResolvedValue(undefined);
    seed(deleteVariable);
    render(<VariableManager />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete variable' }));

    const dialog = await screen.findByRole('dialog', { name: 'Delete variable' });
    expect(dialog).toHaveTextContent('V_B');
    expect(dialog).toHaveTextContent(/cannot be undone/i);
    expect(deleteVariable).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(deleteVariable).toHaveBeenCalledWith('/a.d', RANGE));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('cancel deletes nothing', async () => {
    const deleteVariable = jest.fn().mockResolvedValue(undefined);
    seed(deleteVariable);
    render(<VariableManager />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete variable' }));
    await screen.findByRole('dialog', { name: 'Delete variable' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(deleteVariable).not.toHaveBeenCalled();
  });

  it('a failed delete is reported in-app', async () => {
    const deleteVariable = jest.fn().mockRejectedValue(new Error('disk full'));
    seed(deleteVariable);
    jest.spyOn(console, 'error').mockImplementation(() => {});
    render(<VariableManager />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete variable' }));
    await screen.findByRole('dialog', { name: 'Delete variable' });
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/disk full/);
  });
});

/**
 * #487: the delete writes the file from disk and folds the fresh model in,
 * never touching an open editor model — so a dirty open file's next save wrote
 * the deleted declaration straight back. The panel refuses instead.
 */
describe('VariableManager delete against an open file', () => {
  beforeEach(() => {
    useFileStore.setState({ openFiles: new Map(), activeFile: null } as never);
  });

  async function deleteRow(openFiles: Map<string, unknown>) {
    const deleteVariable = jest.fn().mockResolvedValue(undefined);
    seed(deleteVariable);
    useFileStore.setState({ openFiles } as never);
    render(<VariableManager />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete variable' }));
    await screen.findByRole('dialog', { name: 'Delete variable' });
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    return deleteVariable;
  }

  it('refuses while the file is open and dirty, and leaves the open model alone', async () => {
    const openModel = {
      variables: { V_B: { name: 'V_B', type: 'int', filePath: '/a.d', range: RANGE } }
    };
    const deleteVariable = await deleteRow(new Map([
      ['/a.d', { filePath: '/a.d', isDirty: true, semanticModel: openModel }]
    ]));

    expect(await screen.findByRole('alert')).toHaveTextContent(/unsaved changes/i);
    expect(deleteVariable).not.toHaveBeenCalled();
    expect(useFileStore.getState().openFiles.get('/a.d')?.semanticModel.variables).toHaveProperty('V_B');
    expect(useProjectStore.getState().mergedSemanticModel.variables).toHaveProperty('V_B');
  });

  it('still deletes while the file is open and clean', async () => {
    const deleteVariable = await deleteRow(new Map([
      ['/a.d', { filePath: '/a.d', isDirty: false, semanticModel: { variables: {} } }]
    ]));

    await waitFor(() => expect(deleteVariable).toHaveBeenCalledWith('/a.d', RANGE));
  });

  it('still deletes while the file is not open', async () => {
    const deleteVariable = await deleteRow(new Map());

    await waitFor(() => expect(deleteVariable).toHaveBeenCalledWith('/a.d', RANGE));
  });
});
