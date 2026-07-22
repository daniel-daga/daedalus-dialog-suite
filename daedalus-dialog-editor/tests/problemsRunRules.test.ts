import type { Dialog, DialogFunction, SemanticModel } from '../src/shared/types';
import { buildProjectView } from '../src/renderer/problems/domain/projectView';
import { runRules } from '../src/renderer/problems/domain/runRules';
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

const infoFn = (name: string): DialogFunction => ({
  name,
  returnType: 'VOID',
  actions: [{ type: 'DialogLine', speaker: 'self', text: 'Hi', id: 'DIA_Ghost_Hi_15_00' }],
  conditions: [],
  calls: []
});

const dialog = (name: string, npc: string, info: string): Dialog => ({
  name,
  parent: 'C_INFO',
  properties: { npc, information: info }
});

describe('runRules', () => {
  it('aggregates problems from every rule and orders errors before warnings', () => {
    // A dialog owned by an undefined NPC (error) whose info function is a valid
    // reference (so the info fn is not orphaned) but is itself unreferenced by
    // anything else — plus an orphaned helper function (warning).
    const files: FileModel[] = [
      {
        filePath: 'ghost.d',
        model: model({
          dialogs: { DIA_Ghost: dialog('DIA_Ghost', 'GhostNpc', 'DIA_Ghost_Info') },
          functions: {
            DIA_Ghost_Info: infoFn('DIA_Ghost_Info'),
            Orphan_Helper: infoFn('Orphan_Helper')
          }
        })
      }
    ];

    const problems = runRules(buildProjectView({ files, knownNpcNames: [] }));

    const rules = problems.map((p) => p.rule);
    expect(rules).toContain('npc-not-found'); // GhostNpc undefined
    expect(rules).toContain('orphaned-function'); // Orphan_Helper
    expect(rules).toContain('voice-id-duplicate'); // DIA_Ghost_Hi_15_00 used twice

    // Errors sort ahead of warnings.
    const firstWarningIndex = problems.findIndex((p) => p.severity === 'warning');
    const lastErrorIndex = problems.map((p) => p.severity).lastIndexOf('error');
    expect(lastErrorIndex).toBeLessThan(firstWarningIndex);
  });

  it('returns no problems for a clean project', () => {
    const files: FileModel[] = [
      {
        filePath: 'ok.d',
        model: model({
          dialogs: { DIA_Ok: dialog('DIA_Ok', 'Diego', 'DIA_Ok_Info') },
          functions: {
            DIA_Ok_Info: {
              name: 'DIA_Ok_Info',
              returnType: 'VOID',
              actions: [{ type: 'DialogLine', speaker: 'self', text: 'Hi', id: 'DIA_Ok_Hi_15_00' }],
              conditions: [],
              calls: []
            }
          }
        })
      }
    ];

    const problems = runRules(buildProjectView({ files, knownNpcNames: ['Diego'] }));

    expect(problems).toEqual([]);
  });
});
