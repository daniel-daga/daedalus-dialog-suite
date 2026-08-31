/**
 * The VOB folder tree (VOB folders slice) — a virtual grouping additional to
 * the real scene tree (`WorldSceneTree.tsx`). Component-level, the same way
 * the scene tree is tested: a small `VobIndex` in the columnar shape the
 * binding emits, wrapped in a `WorldSummary` the same way the real surface
 * passes one down.
 *
 * @jest-environment jsdom
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import type { VobFolders, VobIndex } from 'zen-world';
import type { WorldSummary } from '../src/shared/worldTypes';
import WorldFolderTree from '../src/renderer/components/world/WorldFolderTree';

function vobIndex(vobs: Array<{ name?: string; cls?: string }>): VobIndex {
  const classes: string[] = [];
  const names: string[] = [];
  const intern = (dict: string[], value: string) => {
    const at = dict.indexOf(value);
    return at === -1 ? dict.push(value) - 1 : at;
  };
  const classIndex = new Uint32Array(vobs.length);
  const nameIndex = new Uint32Array(vobs.length);
  vobs.forEach((vob, i) => {
    classIndex[i] = intern(classes, vob.cls ?? 'zCVob');
    nameIndex[i] = intern(names, vob.name ?? '');
  });

  return {
    count: vobs.length,
    parent: new Int32Array(vobs.length).fill(-1).buffer,
    childIndex: new Uint32Array(vobs.length).map((_, i) => i).buffer,
    positions: new Float32Array(vobs.length * 3).buffer,
    rotations: new Float32Array(vobs.length * 9).buffer,
    flags: new Uint32Array(vobs.length).buffer,
    classes, classIndex: classIndex.buffer,
    names, nameIndex: nameIndex.buffer,
    visuals: [''], visualIndex: new Uint32Array(vobs.length).buffer,
    visualTypes: ['MULTI_RESOLUTION_MESH'], visualTypeIndex: new Uint32Array(vobs.length).buffer,
  };
}

// Three roots: 0 "DIEGO", 1 "LARES", 2 (unnamed torch visual).
const SUMMARY: WorldSummary = {
  worldPath: 'NewWorld.zen',
  bbox: [0, 0, 0, 1, 1, 1],
  vobIndex: vobIndex([
    { name: 'DIEGO', cls: 'oCNpc' },
    { name: 'LARES', cls: 'oCNpc' },
    { cls: 'zCVobLight' },
  ]),
  stats: { vobCount: 3, materials: 0, worldDrawGroups: 0, worldTriangles: 0 },
  timings: {},
};

function foldersOf(folders: VobFolders['folders']): VobFolders {
  return { folders };
}

describe('WorldFolderTree', () => {
  it('shows an empty state with no folders', () => {
    render(
      <WorldFolderTree
        folders={foldersOf([])}
        summary={SUMMARY}
        selection={[]}
        onSelect={jest.fn()}
        onCreateFolder={jest.fn()}
        onRenameFolder={jest.fn()}
        onDeleteFolder={jest.fn()}
        onRemoveFromFolder={jest.fn()}
      />,
    );
    expect(screen.getByTestId('world-folder-empty')).toBeInTheDocument();
  });

  it('lists folders collapsed, with their resolved member count', () => {
    render(
      <WorldFolderTree
        folders={foldersOf([{ id: 'f1', name: 'Quest NPCs', vobPaths: ['0', '1'] }])}
        summary={SUMMARY}
        selection={[]}
        onSelect={jest.fn()}
        onCreateFolder={jest.fn()}
        onRenameFolder={jest.fn()}
        onDeleteFolder={jest.fn()}
        onRemoveFromFolder={jest.fn()}
      />,
    );
    expect(screen.getByText('Quest NPCs')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.queryByTestId('world-folder-member-f1-0')).not.toBeInTheDocument();
  });

  it('drops a member path the world no longer has, from both the list and the count', () => {
    render(
      <WorldFolderTree
        folders={foldersOf([{ id: 'f1', name: 'A', vobPaths: ['0', '9'] }])}
        summary={SUMMARY}
        selection={[]}
        onSelect={jest.fn()}
        onCreateFolder={jest.fn()}
        onRenameFolder={jest.fn()}
        onDeleteFolder={jest.fn()}
        onRemoveFromFolder={jest.fn()}
      />,
    );
    // "1" is the count shown for the surviving member only.
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('expands to show its members on toggle', () => {
    render(
      <WorldFolderTree
        folders={foldersOf([{ id: 'f1', name: 'Quest NPCs', vobPaths: ['0', '1'] }])}
        summary={SUMMARY}
        selection={[]}
        onSelect={jest.fn()}
        onCreateFolder={jest.fn()}
        onRenameFolder={jest.fn()}
        onDeleteFolder={jest.fn()}
        onRemoveFromFolder={jest.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('world-folder-toggle-f1'));
    expect(screen.getByTestId('world-folder-member-f1-0')).toBeInTheDocument();
    expect(screen.getByTestId('world-folder-member-f1-1')).toBeInTheDocument();
    expect(screen.getByText('DIEGO')).toBeInTheDocument();
  });

  it('selects a member on click', () => {
    const onSelect = jest.fn();
    render(
      <WorldFolderTree
        folders={foldersOf([{ id: 'f1', name: 'A', vobPaths: ['0'] }])}
        summary={SUMMARY}
        selection={[]}
        onSelect={onSelect}
        onCreateFolder={jest.fn()}
        onRenameFolder={jest.fn()}
        onDeleteFolder={jest.fn()}
        onRemoveFromFolder={jest.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('world-folder-toggle-f1'));
    fireEvent.click(screen.getByTestId('world-folder-member-f1-0'));
    expect(onSelect).toHaveBeenCalledWith(0, false);
  });

  it('creates a folder from the name field', () => {
    const onCreateFolder = jest.fn();
    render(
      <WorldFolderTree
        folders={foldersOf([])}
        summary={SUMMARY}
        selection={[]}
        onSelect={jest.fn()}
        onCreateFolder={onCreateFolder}
        onRenameFolder={jest.fn()}
        onDeleteFolder={jest.fn()}
        onRemoveFromFolder={jest.fn()}
      />,
    );
    fireEvent.change(screen.getByTestId('world-folder-new-name'), { target: { value: 'Quest NPCs' } });
    fireEvent.click(screen.getByTestId('world-folder-create'));
    expect(onCreateFolder).toHaveBeenCalledWith('Quest NPCs');
  });

  it('does not create a folder with a blank name', () => {
    const onCreateFolder = jest.fn();
    render(
      <WorldFolderTree
        folders={foldersOf([])}
        summary={SUMMARY}
        selection={[]}
        onSelect={jest.fn()}
        onCreateFolder={onCreateFolder}
        onRenameFolder={jest.fn()}
        onDeleteFolder={jest.fn()}
        onRemoveFromFolder={jest.fn()}
      />,
    );
    expect(screen.getByTestId('world-folder-create')).toBeDisabled();
    expect(onCreateFolder).not.toHaveBeenCalled();
  });

  it('renames a folder inline', () => {
    const onRenameFolder = jest.fn();
    render(
      <WorldFolderTree
        folders={foldersOf([{ id: 'f1', name: 'Quest NPCs', vobPaths: [] }])}
        summary={SUMMARY}
        selection={[]}
        onSelect={jest.fn()}
        onCreateFolder={jest.fn()}
        onRenameFolder={onRenameFolder}
        onDeleteFolder={jest.fn()}
        onRemoveFromFolder={jest.fn()}
      />,
    );
    fireEvent.doubleClick(screen.getByText('Quest NPCs'));
    const input = screen.getByTestId('world-folder-rename-f1');
    fireEvent.change(input, { target: { value: 'Renamed' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onRenameFolder).toHaveBeenCalledWith('f1', 'Renamed');
  });

  it('deletes a folder', () => {
    const onDeleteFolder = jest.fn();
    render(
      <WorldFolderTree
        folders={foldersOf([{ id: 'f1', name: 'A', vobPaths: [] }])}
        summary={SUMMARY}
        selection={[]}
        onSelect={jest.fn()}
        onCreateFolder={jest.fn()}
        onRenameFolder={jest.fn()}
        onDeleteFolder={onDeleteFolder}
        onRemoveFromFolder={jest.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('world-folder-delete-f1'));
    expect(onDeleteFolder).toHaveBeenCalledWith('f1');
  });

  it('removes a member from its folder', () => {
    const onRemoveFromFolder = jest.fn();
    render(
      <WorldFolderTree
        folders={foldersOf([{ id: 'f1', name: 'A', vobPaths: ['0'] }])}
        summary={SUMMARY}
        selection={[]}
        onSelect={jest.fn()}
        onCreateFolder={jest.fn()}
        onRenameFolder={jest.fn()}
        onDeleteFolder={jest.fn()}
        onRemoveFromFolder={onRemoveFromFolder}
      />,
    );
    fireEvent.click(screen.getByTestId('world-folder-toggle-f1'));
    fireEvent.click(screen.getByTestId('world-folder-member-remove-f1-0'));
    expect(onRemoveFromFolder).toHaveBeenCalledWith('f1', '0');
  });

  it('locates a member via onFocus when the viewport is present', () => {
    const onFocus = jest.fn();
    render(
      <WorldFolderTree
        folders={foldersOf([{ id: 'f1', name: 'A', vobPaths: ['0'] }])}
        summary={SUMMARY}
        selection={[]}
        onSelect={jest.fn()}
        onFocus={onFocus}
        onCreateFolder={jest.fn()}
        onRenameFolder={jest.fn()}
        onDeleteFolder={jest.fn()}
        onRemoveFromFolder={jest.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('world-folder-toggle-f1'));
    fireEvent.click(screen.getByTestId('world-folder-member-locate-f1-0'));
    expect(onFocus).toHaveBeenCalledWith(0);
  });
});
