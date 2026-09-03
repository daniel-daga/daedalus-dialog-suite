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
    await waitFor(() => expect(baseProps.onSave).toHaveBeenCalledWith(['.', 'new-assets', 'missing'], null));
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

  it('chooses, shows, clears and saves the GMBT project folder (§16.29)', async () => {
    const select = jest.fn().mockResolvedValue('C:/mod/gmbt');
    (window as any).editorAPI = { selectAssetSourceFolder: select };
    render(<AssetSourcesDialog {...baseProps} />);

    expect(screen.getByTestId('gmbt-project-dir')).toHaveTextContent('Not set');
    expect(screen.getByRole('button', { name: /clear gmbt project folder/i })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /choose gmbt project folder/i }));
    await waitFor(() => expect(screen.getByTestId('gmbt-project-dir')).toHaveTextContent('C:/mod/gmbt'));
    // The picker is what whitelists an absolute path main-side, so it is also
    // what seeds this field — never a typed string.
    expect(select).toHaveBeenCalledWith('C:/project');

    fireEvent.click(screen.getByRole('button', { name: /save asset sources/i }));
    await waitFor(() => expect(baseProps.onSave).toHaveBeenCalledWith(baseProps.assetSources, 'C:/mod/gmbt'));
  });

  it('clears a configured GMBT folder to null, and warns about one that does not resolve', async () => {
    (window as any).editorAPI = { selectAssetSourceFolder: jest.fn() };
    render(
      <AssetSourcesDialog
        {...baseProps}
        gmbtProjectDir="gmbt"
        warnings={[{ code: 'gmbt-project-dir-unavailable' as const, source: 'gmbt',
          resolvedPath: 'C:/project/gmbt', message: 'GMBT project folder has no .gmbt.yml: gmbt' }]}
      />,
    );

    expect(screen.getByTestId('gmbt-project-dir')).toHaveTextContent('gmbt');
    expect(screen.getByText(/has no \.gmbt\.yml/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /clear gmbt project folder/i }));
    expect(screen.getByTestId('gmbt-project-dir')).toHaveTextContent('Not set');

    fireEvent.click(screen.getByRole('button', { name: /save asset sources/i }));
    await waitFor(() => expect(baseProps.onSave).toHaveBeenCalledWith(baseProps.assetSources, null));
  });

  // level-editor.md §16.31: the detected GMBT project's own asset folders,
  // offered rather than applied — the list's order is the user's.
  it('adds the GMBT folders the list does not have yet, once', async () => {
    render(<AssetSourcesDialog {...baseProps} gmbtAssetSources={['../thirdparty', '../mdk']} />);

    const add = screen.getByRole('button', { name: /add 2 folders from gmbt/i });
    fireEvent.click(add);

    expect(screen.getByText('4. ../thirdparty')).toBeInTheDocument();
    expect(screen.getByText('5. ../mdk')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /from gmbt/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /save asset sources/i }));
    await waitFor(() => expect(baseProps.onSave).toHaveBeenCalledWith(
      ['.', 'assets', 'missing', '../thirdparty', '../mdk'], null,
    ));
  });

  it('offers nothing when the GMBT project adds nothing', () => {
    render(<AssetSourcesDialog {...baseProps} gmbtAssetSources={[]} />);
    expect(screen.queryByRole('button', { name: /from gmbt/i })).not.toBeInTheDocument();
  });

  it('blocks Escape dismissal while an async save is in flight', async () => {
    let resolveSave!: () => void;
    const onSave = jest.fn(() => new Promise<void>((resolve) => { resolveSave = resolve; }));
    render(<AssetSourcesDialog {...baseProps} onSave={onSave} />);
    (window as any).editorAPI = { selectAssetSourceFolder: jest.fn().mockResolvedValue('new-assets') };
    fireEvent.click(screen.getByRole('button', { name: /add asset source/i }));
    await waitFor(() => expect(screen.getByText('4. new-assets')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /save asset sources/i }));
    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(baseProps.onClose).not.toHaveBeenCalled();
    resolveSave();
    await waitFor(() => expect(baseProps.onClose).toHaveBeenCalled());
  });
});
