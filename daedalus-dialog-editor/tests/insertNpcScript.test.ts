/**
 * Slice A of "Insert NPC from the World surface" (level-editor.md §16.19,
 * slice 16): the pure half — which function a world's spawns belong in, which
 * parsed file holds it, and the model edit that appends the spawn.
 */

import {
  startupFunctionFor,
  findFunctionFile,
  appendInsertNpc,
} from '../src/renderer/components/world/insertNpcScript';
import type { SemanticModel, DialogFunction } from '../src/shared/types';

const fn = (name: string, actions: DialogFunction['actions'] = []): DialogFunction => ({
  name,
  returnType: 'VOID',
  actions,
  conditions: [],
  calls: [],
});

const model = (functions: DialogFunction[], hasErrors = false): SemanticModel => ({
  dialogs: {},
  functions: Object.fromEntries(functions.map((f) => [f.name, f])),
  hasErrors,
});

/** Retail's Startup.d shape: STARTUP_ and INIT_ for the same world in one file. */
const startupFile = model([
  fn('STARTUP_GLOBAL'),
  fn('INIT_GLOBAL'),
  fn('STARTUP_NewWorld', [{ type: 'Action', action: 'STARTUP_NewWorld_Part_City_01();' } as never]),
  fn('INIT_NewWorld'),
]);
const dialogFile = model([fn('DIA_Xardas_Hello_Info')]);

const files = (entries: Array<[string, SemanticModel]>) =>
  new Map(entries.map(([filePath, semanticModel]) => [filePath, { semanticModel }]));

describe('startupFunctionFor', () => {
  it('names STARTUP_ after the world file, UPPERCASED, .zen stripped', () => {
    expect(startupFunctionFor('C:\\Gothic\\_work\\Data\\Worlds\\NewWorld.zen')).toBe('STARTUP_NEWWORLD');
    expect(startupFunctionFor('/mnt/g/worlds/DRAGONISLAND.ZEN')).toBe('STARTUP_DRAGONISLAND');
  });

  it('keeps a name that has no .zen suffix as it is', () => {
    expect(startupFunctionFor('D:\\out\\AddonWorld')).toBe('STARTUP_ADDONWORLD');
  });
});

describe('findFunctionFile', () => {
  it('finds STARTUP_NewWorld in the file that also holds INIT_NewWorld', () => {
    const result = findFunctionFile(
      files([['C:\\mod\\Dialoge\\DIA_Xardas.d', dialogFile], ['C:\\mod\\Startup.d', startupFile]]),
      'STARTUP_NEWWORLD',
    );
    expect(result).toEqual({
      ok: true,
      filePath: 'C:\\mod\\Startup.d',
      functionName: 'STARTUP_NewWorld',
      model: startupFile,
    });
  });

  it('matches the function name case-insensitively', () => {
    const result = findFunctionFile(files([['C:\\mod\\Startup.d', startupFile]]), 'startup_newworld');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.functionName).toBe('STARTUP_NewWorld');
  });

  it('refuses with no-project when nothing is parsed', () => {
    expect(findFunctionFile(new Map(), 'STARTUP_NEWWORLD')).toEqual({
      ok: false,
      refusal: { kind: 'no-project' },
    });
  });

  it('refuses with no-startup-function when no file declares it', () => {
    expect(findFunctionFile(files([['C:\\mod\\Startup.d', startupFile]]), 'STARTUP_OLDWORLD')).toEqual({
      ok: false,
      refusal: { kind: 'no-startup-function', functionName: 'STARTUP_OLDWORLD' },
    });
  });

  it('never settles for INIT_<world> in place of STARTUP_<world>', () => {
    const initOnly = model([fn('INIT_NewWorld')]);
    expect(findFunctionFile(files([['C:\\mod\\Startup.d', initOnly]]), 'STARTUP_NEWWORLD')).toEqual({
      ok: false,
      refusal: { kind: 'no-startup-function', functionName: 'STARTUP_NEWWORLD' },
    });
  });

  it('refuses with parse-errors when the holding file did not parse clean', () => {
    const broken = model([fn('STARTUP_NewWorld')], true);
    expect(findFunctionFile(files([['C:\\mod\\Startup.d', broken]]), 'STARTUP_NEWWORLD')).toEqual({
      ok: false,
      refusal: { kind: 'parse-errors', filePath: 'C:\\mod\\Startup.d' },
    });
  });
});

describe('appendInsertNpc', () => {
  it('pushes a plain-object InsertNpcAction onto the function and leaves the input alone', () => {
    const next = appendInsertNpc(startupFile, 'STARTUP_NewWorld', 'PC_Hero', 'WP_TEST');

    const actions = next.functions.STARTUP_NewWorld.actions;
    expect(actions).toHaveLength(2);
    expect(actions[1]).toEqual({ type: 'InsertNpcAction', npcInstance: 'PC_Hero', spawnPoint: 'WP_TEST' });
    expect(JSON.parse(JSON.stringify(actions[1]))).toEqual(actions[1]);

    expect(startupFile.functions.STARTUP_NewWorld.actions).toHaveLength(1);
    expect(next).not.toBe(startupFile);
    expect(next.functions.INIT_NewWorld).toBe(startupFile.functions.INIT_NewWorld);
  });
});
