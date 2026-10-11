/**
 * Create NPC (docs/plans/npc-editor.md §3, #285): the instance a new NPC starts
 * from, the id it is offered, and the file it lands in. Pure.
 * @jest-environment node
 */
import {
  renameNpcInstance,
  copyEdits,
  proposeNpcId,
  defaultNpcFilePath,
  validateNewNpc
} from '../src/renderer/npc/npcTemplate';
import { handleParserRequest } from '../src/main/workers/parser.worker';

const ONAR = [
  'instance BAU_900_Onar (Npc_Default)',
  '{',
  '\t// ------ NSC ------',
  '\tname \t\t= "Onar";',
  '\tguild \t\t= GIL_BAU;',
  '\tid \t\t\t= 900;',
  '\tB_SetNpcVisual (self, MALE, "Hum_Head_Fatbald", Face_N_Weak_Orry, BodyTex_N, ITAR_Vlk_H);',
  '\tdaily_routine \t\t= Rtn_Start_900;',
  '};'
].join('\n');

describe('copying an NPC', () => {
  test('renames the instance and leaves its prototype and body alone', () => {
    const renamed = renameNpcInstance(ONAR, 'BAU_950_Harald');
    expect(renamed.split('\n')[0]).toBe('instance BAU_950_Harald (Npc_Default)');
    expect(renamed.split('\n').slice(1)).toEqual(ONAR.split('\n').slice(1));
  });

  test('keeps the keyword as written', () => {
    expect(renameNpcInstance('INSTANCE A (Npc_Default) { };', 'B')).toBe('INSTANCE B (Npc_Default) { };');
  });

  test('sets name, guild and id, and drops the template\'s routine', () => {
    expect(copyEdits({ name: 'Der "Alte"', guild: 'GIL_VLK', id: 950 })).toEqual([
      { op: 'set', field: 'name', value: `"Der 'Alte'"` },
      { op: 'set', field: 'guild', value: 'GIL_VLK' },
      { op: 'set', field: 'id', value: '950' },
      { op: 'remove', field: 'daily_routine' }
    ]);
  });
});

describe('proposeNpcId', () => {
  test('is one past the highest id in retail-style instance names', () => {
    expect(proposeNpcId(['BAU_900_Onar', 'VLK_4201_Wache', 'Xardas', 'PAL_207_Girion'])).toBe(4202);
  });

  test('starts at 1 when no name carries an id', () => {
    expect(proposeNpcId(['Xardas', 'Diego'])).toBe(1);
  });
});

describe('defaultNpcFilePath', () => {
  test('lands in the folder holding most NPC files, named after the instance', () => {
    const npcFiles = {
      BAU_900_ONAR: 'C:/mod/Story/NPC/BAU_900_Onar.d',
      VLK_1_A: 'C:/mod/Story/NPC/VLK_1_A.d',
      XARDAS: 'C:/mod/Story/Special/Xardas.d'
    };
    expect(defaultNpcFilePath(npcFiles, 'BAU_950_Harald', 'C:/mod')).toBe('C:/mod/Story/NPC/BAU_950_Harald.d');
  });

  test('falls back to the project folder when no NPC file is known', () => {
    expect(defaultNpcFilePath({}, 'BAU_950_Harald', 'C:/mod')).toBe('C:/mod/BAU_950_Harald.d');
  });
});

describe('validateNewNpc', () => {
  const ok = { template: 'BAU_900_Onar', instance: 'BAU_950_Harald', name: 'Harald', guild: 'GIL_BAU', id: '950', filePath: 'C:/mod/x.d' };

  test('accepts a complete form', () => {
    expect(validateNewNpc(ok, [])).toBeNull();
  });

  test('refuses an instance name that is not an identifier', () => {
    expect(validateNewNpc({ ...ok, instance: '950 Harald' }, [])).toMatch(/identifier/i);
  });

  test('refuses an instance the project already has, whatever its case', () => {
    expect(validateNewNpc(ok, ['bau_950_harald'])).toMatch(/already/i);
  });

  test('needs an NPC to copy', () => {
    expect(validateNewNpc({ ...ok, template: '' }, [])).toMatch(/copy/i);
  });

  test('refuses a non-numeric id and a file that is not a .d', () => {
    expect(validateNewNpc({ ...ok, id: 'x' }, [])).toMatch(/id/i);
    expect(validateNewNpc({ ...ok, filePath: 'C:/mod/x.txt' }, [])).toMatch(/\.d/);
  });
});

describe('a copy through the real parser worker', () => {
  test('is Onar with a new name, guild and id, and no routine — every other line kept', () => {
    const copy = handleParserRequest({
      id: '1',
      npc: 'apply',
      sourceCode: renameNpcInstance(ONAR, 'VLK_950_Harald'),
      edits: copyEdits({ name: 'Harald', guild: 'GIL_VLK', id: 950 })
    });
    expect(copy).toBe([
      'instance VLK_950_Harald (Npc_Default)',
      '{',
      '\t// ------ NSC ------',
      '\tname \t\t= "Harald";',
      '\tguild \t\t= GIL_VLK;',
      '\tid \t\t\t= 950;',
      '\tB_SetNpcVisual (self, MALE, "Hum_Head_Fatbald", Face_N_Weak_Orry, BodyTex_N, ITAR_Vlk_H);',
      '};'
    ].join('\n'));
  });
});
