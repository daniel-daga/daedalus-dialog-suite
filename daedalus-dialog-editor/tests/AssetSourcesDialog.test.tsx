import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import AssetSourcesDialog from '../src/renderer/components/AssetSourcesDialog';

describe('AssetSourcesDialog', () => {
  const baseProps = {
    open: true,
    assetSources: ['.', 'assets', 'missing'],
    projectRoot: 'C:/project',
    warnings: [{ code: 'asset-source-unavailable' as const, source: 'missing', resolvedPath: 'C:/project/missing', message: 'Source unavailable' }],
    worldLoaded: true,
    onClose: jest.fn(),
    onSave: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => jest.clearAllMocks());

  it('renders ordered sources, warning, precedence and disables root removal', () => {
    render(<AssetSourcesDialog {...baseProps} />);
    expect(screen.getByRole('dialog', { name: /asset sources/i })).toBeInTheDocument();
    expect(screen.getByText('1. .')).toBeInTheDocument();
    expect(screen.getByText('2. assets')).toBeInTheDocument();
    expect(screen.getByText('3. missing')).toBeInTheDocument();
    expect(screen.getByText(/later sources override earlier sources/i)).toBeInTheDocument();
    expect(screen.getByText(/source unavailable/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /remove source \./i })).toBeDisabled();
    expect(screen.getByText(/reopen the world to apply changes/i)).toBeInTheDocument();
  });

  it('keeps edits local, supports add/reorder/remove, cancel and save', async () => {
    const select = jest.fn().mockResolvedValue('new-assets');
    (window as any).editorAPI = { selectAssetSourceFolder: select };
    render(<AssetSourcesDialog {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: /add asset source/i }));
    await waitFor(() => expect(screen.getByText('4. new-assets')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /move new-assets up/i }));
    fireEvent.click(screen.getByRole('button', { name: /remove source assets/i }));
    expect(baseProps.onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /save asset sources/i }));
    await waitFor(() => expect(baseProps.onSave).toHaveBeenCalledWith(['.', 'new-assets', 'missing']));
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(baseProps.onClose).toHaveBeenCalled();
  });

  it('retains dialog and draft when save fails', async () => {
    const onSave = jest.fn().mockRejectedValue(new Error('save failed'));
    (window as any).editorAPI = { selectAssetSourceFolder: jest.fn().mockResolvedValue('new-assets') };
    render(<AssetSourcesDialog {...baseProps} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: /add asset source/i }));
    await waitFor(() => expect(screen.getByText('4. new-assets')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /save asset sources/i }));
    await waitFor(() => expect(screen.getByText('save failed')).toBeInTheDocument());
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('preserves an unsaved draft when the configured props refresh while open', async () => {
    const select = jest.fn().mockResolvedValue('draft-assets');
    (window as any).editorAPI = { selectAssetSourceFolder: select };
    const { rerender } = render(<AssetSourcesDialog {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: /add asset source/i }));
    await waitFor(() => expect(screen.getByText('4. draft-assets')).toBeInTheDocument());

    rerender(<AssetSourcesDialog {...baseProps} assetSources={['.', 'assets', 'refreshed']} />);
    expect(screen.getByText('4. draft-assets')).toBeInTheDocument();
    expect(screen.queryByText('3. refreshed')).not.toBeInTheDocument();
  });
});
