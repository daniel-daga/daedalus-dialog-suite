import { npcNotFoundRule } from '../src/renderer/problems/domain/rules/npcNotFound';
import { buildProjectView } from '../src/renderer/problems/domain/projectView';
import type { FileModel } from '../src/renderer/problems/domain/types';
import type { Dialog, SemanticModel } from '../src/shared/types';

const dialog = (name: string, npc?: string): Dialog => ({
  name,
  parent: 'C_INFO',
  properties: { npc, information: `${name}_Info` }
});

const model = (dialogs: Record<string, Dialog>): SemanticModel => ({
  dialogs,
  functions: {},
  instances: {},
  npcs: {},
  hasErrors: false,
  errors: []
});

const file = (filePath: string, m: SemanticModel): FileModel => ({ filePath, model: m });

describe('npcNotFoundRule', () => {
  it('does not flag a dialog referencing a known NPC', () => {
    const files = [file('a.d', model({ DIA_Alrik: dialog('DIA_Alrik', 'Alrik') }))];
    const view = buildProjectView({ files, knownNpcNames: ['Alrik'] });

    expect(npcNotFoundRule(view)).toEqual([]);
  });

  it('flags a dialog referencing an unknown NPC exactly once', () => {
    const files = [file('a.d', model({ DIA_Ghost: dialog('DIA_Ghost', 'Ghost') }))];
    const view = buildProjectView({ files, knownNpcNames: ['Alrik'] });

    const problems = npcNotFoundRule(view);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({
      rule: 'npc-not-found',
      severity: 'error',
      locus: { kind: 'script', filePath: 'a.d', dialogName: 'DIA_Ghost', npc: 'Ghost' },
      id: 'npc-not-found:a.d:DIA_Ghost'
    });
    expect(problems[0].message).toBe(
      'Dialog "DIA_Ghost" references NPC "Ghost", which is not defined in the project.'
    );
  });

  it('matches NPC names case-insensitively', () => {
    const files = [file('a.d', model({ DIA_Alrik: dialog('DIA_Alrik', 'Alrik') }))];
    const view = buildProjectView({ files, knownNpcNames: ['alrik'] });

    expect(npcNotFoundRule(view)).toEqual([]);
  });

  it('does not flag a dialog with no npc property', () => {
    const files = [file('a.d', model({ DIA_None: dialog('DIA_None') }))];
    const view = buildProjectView({ files, knownNpcNames: [] });

    expect(npcNotFoundRule(view)).toEqual([]);
  });
});
