import type { Dialog, DialogFunction, GlobalInstance, SemanticModel } from '../src/shared/types';
import { buildProjectView } from '../src/renderer/problems/domain/projectView';
import type { FileModel } from '../src/renderer/problems/domain/types';

const dialog = (name: string, npc: string): Dialog => ({
  name,
  parent: 'C_INFO',
  properties: { npc, information: `${name}_Info` }
});

const fn = (name: string): DialogFunction => ({
  name,
  returnType: 'VOID',
  actions: [],
  conditions: [],
  calls: []
});

const instance = (name: string, parent: string): GlobalInstance => ({ name, parent });

const model = (overrides: Partial<SemanticModel> = {}): SemanticModel => ({
  dialogs: {},
  functions: {},
  instances: {},
  npcs: {},
  hasErrors: false,
  errors: [],
  ...overrides
});

const file = (filePath: string, m: SemanticModel): FileModel => ({ filePath, model: m });

describe('buildProjectView', () => {
  it('aggregates dialog, function, and NPC names case-insensitively across files', () => {
    const files: FileModel[] = [
      file('a.d', model({ dialogs: { DIA_Alrik: dialog('DIA_Alrik', 'Alrik') } })),
      file('b.d', model({ functions: { DIA_Alrik_Info: fn('DIA_Alrik_Info') } }))
    ];

    const view = buildProjectView({ files, knownNpcNames: ['Alrik', 'PC_Hero'] });

    expect(view.dialogNameKeys.has('dia_alrik')).toBe(true);
    expect(view.functionsByKey.has('dia_alrik_info')).toBe(true);
    expect(view.functionsByKey.get('dia_alrik_info')?.filePath).toBe('b.d');
    expect(view.npcNameKeys.has('alrik')).toBe(true);
    expect(view.npcNameKeys.has('pc_hero')).toBe(true);
  });

  it('folds in file-local C_NPC instances not yet in the project index', () => {
    const files = [file('npc.d', model({ instances: { Diego: instance('Diego', 'C_NPC') } }))];

    const view = buildProjectView({ files, knownNpcNames: [] });

    expect(view.npcNameKeys.has('diego')).toBe(true);
  });

  it('ignores non-C_NPC instances', () => {
    const files = [file('item.d', model({ instances: { ITMW_Sword: instance('ITMW_Sword', 'C_ITEM') } }))];

    const view = buildProjectView({ files, knownNpcNames: [] });

    expect(view.npcNameKeys.has('itmw_sword')).toBe(false);
  });
});
