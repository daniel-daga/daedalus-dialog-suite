import type { Dialog, DialogFunction, SemanticModel } from '../src/shared/types';
import { scanProject } from '../src/renderer/problems/application/scanProject';
import type { FileModel } from '../src/renderer/problems/domain/types';

const model = (overrides: Partial<SemanticModel> = {}): SemanticModel => ({
  dialogs: {},
  functions: {},
  instances: {},
  npcs: {},
  hasErrors: false,
  errors: [],
  ...overrides
});

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

describe('scanProject', () => {
  it('runs the rules over the aggregated view and reports the scanned file count', () => {
    const files: FileModel[] = [
      { filePath: 'a.d', model: model({ dialogs: { DIA_X: dialog('DIA_X', 'Nobody') } }) },
      { filePath: 'b.d', model: model({ functions: { DIA_X_Info: fn('DIA_X_Info') } }) }
    ];

    const result = scanProject({ files, knownNpcNames: [] });

    expect(result.scannedFileCount).toBe(2);
    expect(result.problems.some((p) => p.rule === 'npc-not-found' && p.dialogName === 'DIA_X')).toBe(true);
  });

  it('finds no problems when every NPC is known and nothing is orphaned', () => {
    const files: FileModel[] = [
      {
        filePath: 'ok.d',
        model: model({
          dialogs: { DIA_Ok: dialog('DIA_Ok', 'Diego') },
          functions: { DIA_Ok_Info: fn('DIA_Ok_Info') }
        })
      }
    ];

    const result = scanProject({ files, knownNpcNames: ['Diego'] });

    expect(result.problems).toEqual([]);
    expect(result.scannedFileCount).toBe(1);
  });
});
