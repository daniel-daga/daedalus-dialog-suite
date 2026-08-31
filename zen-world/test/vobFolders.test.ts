// User-created VOB folders — a virtual grouping over the real scene tree
// (vobFolders.ts). Every function is pure, so these are plain input/output
// checks; `resolveFolderMembers`/`parseVobFolders` are the two that touch a
// world reader / untrusted input and get their own sections.

import {
  addVobsToFolder, createFolder, createVobReader, deleteFolder, emptyVobFolders,
  parseVobFolders, removeVobFromFolder, renameFolder, resolveFolderMembers,
  type VobFolders, type VobIndex,
} from '../src/model';

interface Spec {
  parent?: number;
  childIndex?: number;
}

/** A VOB table in the columnar shape `vobIndex` emits — only `parent`/
 *  `childIndex` vary here, the rest is filler `createVobReader` still needs. */
function vobIndex(vobs: Spec[]): VobIndex {
  const parent = new Int32Array(vobs.length);
  const childIndex = new Uint32Array(vobs.length);
  vobs.forEach((vob, i) => {
    parent[i] = vob.parent ?? -1;
    childIndex[i] = vob.childIndex ?? 0;
  });

  return {
    count: vobs.length,
    parent: parent.buffer,
    childIndex: childIndex.buffer,
    positions: new Float32Array(vobs.length * 3).buffer,
    rotations: new Float32Array(vobs.length * 9).buffer,
    flags: new Uint32Array(vobs.length).buffer,
    classes: ['zCVob'], classIndex: new Uint32Array(vobs.length).buffer,
    names: [''], nameIndex: new Uint32Array(vobs.length).buffer,
    visuals: [''], visualIndex: new Uint32Array(vobs.length).buffer,
    visualTypes: ['MULTI_RESOLUTION_MESH'], visualTypeIndex: new Uint32Array(vobs.length).buffer,
  };
}

describe('folder CRUD', () => {
  it('starts empty', () => {
    expect(emptyVobFolders()).toEqual({ folders: [] });
  });

  it('creates a folder with no members', () => {
    const state = createFolder(emptyVobFolders(), 'f1', 'Quest NPCs');
    expect(state.folders).toEqual([{ id: 'f1', name: 'Quest NPCs', vobPaths: [] }]);
  });

  it('appends rather than replacing on a second create', () => {
    let state = createFolder(emptyVobFolders(), 'f1', 'A');
    state = createFolder(state, 'f2', 'B');
    expect(state.folders.map((f) => f.id)).toEqual(['f1', 'f2']);
  });

  it('renames only the matching folder', () => {
    let state = createFolder(emptyVobFolders(), 'f1', 'A');
    state = createFolder(state, 'f2', 'B');
    state = renameFolder(state, 'f1', 'Renamed');
    expect(state.folders.map((f) => f.name)).toEqual(['Renamed', 'B']);
  });

  it('deletes only the matching folder', () => {
    let state = createFolder(emptyVobFolders(), 'f1', 'A');
    state = createFolder(state, 'f2', 'B');
    state = deleteFolder(state, 'f1');
    expect(state.folders.map((f) => f.id)).toEqual(['f2']);
  });

  it('a rename does not touch the folder id, so nothing else needs re-keying', () => {
    let state = createFolder(emptyVobFolders(), 'f1', 'A');
    state = addVobsToFolder(state, 'f1', ['0']);
    state = renameFolder(state, 'f1', 'Renamed');
    expect(state.folders[0]).toEqual({ id: 'f1', name: 'Renamed', vobPaths: ['0'] });
  });
});

describe('folder membership', () => {
  it('adds paths in the order given', () => {
    let state = createFolder(emptyVobFolders(), 'f1', 'A');
    state = addVobsToFolder(state, 'f1', ['0', '0/1']);
    expect(state.folders[0].vobPaths).toEqual(['0', '0/1']);
  });

  it('is idempotent — an already-present path is not duplicated', () => {
    let state = createFolder(emptyVobFolders(), 'f1', 'A');
    state = addVobsToFolder(state, 'f1', ['0']);
    state = addVobsToFolder(state, 'f1', ['0', '0/1']);
    expect(state.folders[0].vobPaths).toEqual(['0', '0/1']);
  });

  it('only adds to the named folder', () => {
    let state = createFolder(emptyVobFolders(), 'f1', 'A');
    state = createFolder(state, 'f2', 'B');
    state = addVobsToFolder(state, 'f1', ['0']);
    expect(state.folders[1].vobPaths).toEqual([]);
  });

  it('removes one path, leaving the rest', () => {
    let state = createFolder(emptyVobFolders(), 'f1', 'A');
    state = addVobsToFolder(state, 'f1', ['0', '0/1', '1']);
    state = removeVobFromFolder(state, 'f1', '0/1');
    expect(state.folders[0].vobPaths).toEqual(['0', '1']);
  });

  it('removing a path that is not a member is a no-op', () => {
    let state = createFolder(emptyVobFolders(), 'f1', 'A');
    state = addVobsToFolder(state, 'f1', ['0']);
    state = removeVobFromFolder(state, 'f1', '9');
    expect(state.folders[0].vobPaths).toEqual(['0']);
  });
});

describe('resolveFolderMembers', () => {
  // Two roots (0, 1); root 0 has one child (2).
  const reader = createVobReader(vobIndex([
    { parent: -1, childIndex: 0 }, // vob 0, path "0"
    { parent: -1, childIndex: 1 }, // vob 1, path "1"
    { parent: 0, childIndex: 0 },  // vob 2, path "0/0"
  ]));

  it('resolves every path that still exists, in order', () => {
    const folder = { id: 'f1', name: 'A', vobPaths: ['1', '0/0', '0'] };
    expect(resolveFolderMembers(reader, folder)).toEqual([1, 2, 0]);
  });

  it('drops a path the world no longer has, rather than guessing', () => {
    const folder = { id: 'f1', name: 'A', vobPaths: ['0', '0/9', '1'] };
    expect(resolveFolderMembers(reader, folder)).toEqual([0, 1]);
  });

  it('an empty folder resolves to no members', () => {
    expect(resolveFolderMembers(reader, { id: 'f1', name: 'A', vobPaths: [] })).toEqual([]);
  });
});

describe('parseVobFolders', () => {
  it('round-trips a well-formed payload', () => {
    const folders: VobFolders = { folders: [{ id: 'f1', name: 'A', vobPaths: ['0', '0/1'] }] };
    expect(parseVobFolders(JSON.parse(JSON.stringify(folders)))).toEqual(folders);
  });

  it.each([
    ['null', null],
    ['a string', 'not an object'],
    ['a number', 42],
    ['an array', []],
    ['an object missing folders', {}],
    ['folders not an array', { folders: 'nope' }],
  ])('collapses %s to the empty state', (_label, raw) => {
    expect(parseVobFolders(raw)).toEqual({ folders: [] });
  });

  it('drops a malformed folder entry but keeps the well-formed ones', () => {
    const raw = {
      folders: [
        { id: 'f1', name: 'Good', vobPaths: ['0'] },
        { id: 'f2' }, // missing name/vobPaths
        'not an object',
        { id: 'f3', name: 'Also good', vobPaths: ['1'] },
      ],
    };
    expect(parseVobFolders(raw)).toEqual({
      folders: [
        { id: 'f1', name: 'Good', vobPaths: ['0'] },
        { id: 'f3', name: 'Also good', vobPaths: ['1'] },
      ],
    });
  });

  it('drops non-string entries out of vobPaths rather than rejecting the whole folder', () => {
    const raw = { folders: [{ id: 'f1', name: 'A', vobPaths: ['0', 42, null, '1'] }] };
    expect(parseVobFolders(raw)).toEqual({ folders: [{ id: 'f1', name: 'A', vobPaths: ['0', '1'] }] });
  });
});
