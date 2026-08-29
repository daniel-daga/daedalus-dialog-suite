import { buildProjectView } from '../src/renderer/problems/domain/projectView';
import { compareProblems, runRules } from '../src/renderer/problems/domain/runRules';
import type { FileModel, Problem } from '../src/renderer/problems/domain/types';
import type { Dialog, SemanticModel } from '../src/shared/types';

const model = (dialogs: Record<string, Dialog>): SemanticModel => ({
  dialogs,
  functions: {},
  instances: {},
  npcs: {},
  hasErrors: false,
  errors: []
});

const files: FileModel[] = [
  {
    filePath: 'ghost.d',
    model: model({
      DIA_Ghost: { name: 'DIA_Ghost', parent: 'C_INFO', properties: { npc: 'GhostNpc' } }
    })
  }
];

const worldProblem: Problem = {
  id: 'portal-material:42',
  rule: 'npc-not-found',
  severity: 'error',
  message: 'Portal material on polygon 42 is malformed.',
  locus: { kind: 'world', polygon: 42 }
};

describe('Problem.locus', () => {
  it('gives every script rule a script locus carrying the declaration it points at', () => {
    const problems = runRules(buildProjectView({ files, knownNpcNames: [] }));

    expect(problems.length).toBeGreaterThan(0);
    for (const problem of problems) {
      expect(problem.locus.kind).toBe('script');
    }

    const npcProblem = problems.find((p) => p.rule === 'npc-not-found');
    expect(npcProblem?.locus).toEqual({
      kind: 'script',
      filePath: 'ghost.d',
      dialogName: 'DIA_Ghost',
      npc: 'GhostNpc'
    });
  });

  it('orders a world locus after every script problem of the same severity', () => {
    const scriptProblem: Problem = {
      id: 'npc-not-found:zzz.d:DIA_Z',
      rule: 'npc-not-found',
      severity: 'error',
      message: 'Dialog "DIA_Z" references NPC "Nobody", which is not defined in the project.',
      locus: { kind: 'script', filePath: 'zzz.d', dialogName: 'DIA_Z' }
    };

    expect([worldProblem, scriptProblem].sort(compareProblems)).toEqual([
      scriptProblem,
      worldProblem
    ]);
  });

  it('still puts a warning after an error whatever the locus kind', () => {
    const scriptWarning: Problem = {
      id: 'orphaned-function:a.d:Helper',
      rule: 'orphaned-function',
      severity: 'warning',
      message: 'Function "Helper" is not referenced by any dialog, choice, or function call.',
      locus: { kind: 'script', filePath: 'a.d', functionName: 'Helper' }
    };

    expect([scriptWarning, worldProblem].sort(compareProblems)).toEqual([
      worldProblem,
      scriptWarning
    ]);
  });
});
