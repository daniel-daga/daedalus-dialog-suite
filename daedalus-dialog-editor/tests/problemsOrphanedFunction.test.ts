/**
 * @jest-environment node
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { orphanedFunctionRule } from '../src/renderer/problems/domain/rules/orphanedFunction';
import { buildProjectView } from '../src/renderer/problems/domain/projectView';
import type { FileModel } from '../src/renderer/problems/domain/types';
import type { Dialog, DialogFunction, SemanticModel } from '../src/shared/types';

const EXAMPLES = path.resolve(__dirname, '..', '..', 'daedalus-parser', 'examples');

/**
 * Parse with the real parser in a child process (the native tree-sitter
 * binding cannot be loaded into more than one Jest module registry per worker;
 * see simulatorParserIntegration.test.ts).
 */
function parseWithRealParser(source: string): { hasErrors: boolean; model: SemanticModel } {
  const parserPath = require.resolve('daedalus-parser');
  const visitorPath = require.resolve('daedalus-parser/semantic-visitor');
  const script = `
    let src = '';
    process.stdin.on('data', (d) => { src += d; });
    process.stdin.on('end', () => {
      const DaedalusParser = require(${JSON.stringify(parserPath)});
      const { SemanticModelBuilderVisitor } = require(${JSON.stringify(visitorPath)});
      const result = new DaedalusParser().parse(src);
      const visitor = new SemanticModelBuilderVisitor();
      visitor.pass1_createObjects(result.tree.rootNode);
      visitor.pass2_analyzeAndLink(result.tree.rootNode);
      process.stdout.write(JSON.stringify({ hasErrors: !!result.hasErrors, model: visitor.semanticModel }));
    });
  `;
  const output = execFileSync(process.execPath, ['-e', script], {
    input: source,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024
  });
  return JSON.parse(output);
}

const model = (overrides: Partial<SemanticModel> = {}): SemanticModel => ({
  dialogs: {},
  functions: {},
  instances: {},
  npcs: {},
  hasErrors: false,
  errors: [],
  ...overrides
});

const fn = (name: string, overrides: Partial<DialogFunction> = {}): DialogFunction => ({
  name,
  returnType: 'INT',
  actions: [],
  conditions: [],
  calls: [],
  ...overrides
});

const dialog = (name: string, properties: Dialog['properties']): Dialog => ({
  name,
  parent: 'C_INFO',
  properties
});

const file = (filePath: string, m: SemanticModel): FileModel => ({ filePath, model: m });

describe('orphanedFunctionRule', () => {
  it('does not flag a function used as a dialog information property', () => {
    const files = [
      file(
        'dialogs.d',
        model({
          dialogs: { DIA_Hello: dialog('DIA_Hello', { information: 'Info_Hello' }) },
          functions: { Info_Hello: fn('Info_Hello') }
        })
      )
    ];
    const view = buildProjectView({ files, knownNpcNames: [] });

    expect(orphanedFunctionRule(view)).toEqual([]);
  });

  it('does not flag a function used as a dialog condition property', () => {
    const files = [
      file(
        'dialogs.d',
        model({
          dialogs: { DIA_Hello: dialog('DIA_Hello', { condition: 'Cond_Hello' }) },
          functions: { Cond_Hello: fn('Cond_Hello') }
        })
      )
    ];
    const view = buildProjectView({ files, knownNpcNames: [] });

    expect(orphanedFunctionRule(view)).toEqual([]);
  });

  it('does not flag a function referenced only as a Choice targetFunction', () => {
    // Info_Menu is anchored by a dialog so only Info_Sub's Choice reference is under test.
    const files = [
      file(
        'dialogs.d',
        model({
          dialogs: { DIA_Menu: dialog('DIA_Menu', { information: 'Info_Menu' }) },
          functions: {
            Info_Menu: fn('Info_Menu', {
              actions: [{ type: 'Choice', dialogRef: 'DIA_Menu', text: 'Go', targetFunction: 'Info_Sub' }]
            }),
            Info_Sub: fn('Info_Sub')
          }
        })
      )
    ];
    const view = buildProjectView({ files, knownNpcNames: [] });

    const problems = orphanedFunctionRule(view);
    expect(problems.map((p) => p.locus.kind === 'script' && p.locus.functionName)).not.toContain('Info_Sub');
  });

  it('does not flag a function referenced only via another function calls array', () => {
    // Info_Main is anchored by a dialog so only Helper_Fn's calls reference is under test.
    const files = [
      file(
        'dialogs.d',
        model({
          dialogs: { DIA_Main: dialog('DIA_Main', { information: 'Info_Main' }) },
          functions: {
            Info_Main: fn('Info_Main', { calls: ['Helper_Fn'] }),
            Helper_Fn: fn('Helper_Fn')
          }
        })
      )
    ];
    const view = buildProjectView({ files, knownNpcNames: [] });

    const problems = orphanedFunctionRule(view);
    expect(problems.map((p) => p.locus.kind === 'script' && p.locus.functionName)).not.toContain('Helper_Fn');
  });

  it('flags a function referenced by nobody with exactly one warning', () => {
    const files = [
      file('dialogs.d', model({ functions: { Lonely_Fn: fn('Lonely_Fn') } }))
    ];
    const view = buildProjectView({ files, knownNpcNames: [] });

    const problems = orphanedFunctionRule(view);

    expect(problems).toHaveLength(1);
    expect(problems[0].rule).toBe('orphaned-function');
    expect(problems[0].severity).toBe('warning');
    expect(problems[0].locus).toEqual({
      kind: 'script',
      filePath: 'dialogs.d',
      functionName: 'Lonely_Fn'
    });
    expect(problems[0].message).toContain('Lonely_Fn');
    expect(problems[0].id).toBe('orphaned-function:dialogs.d:Lonely_Fn');
  });

  it('resolves references across files case-insensitively', () => {
    const files = [
      file('defs.d', model({ functions: { Info_Target: fn('Info_Target') } })),
      file(
        'dialogs.d',
        model({ dialogs: { DIA_Ref: dialog('DIA_Ref', { information: 'info_TARGET' }) } })
      )
    ];
    const view = buildProjectView({ files, knownNpcNames: [] });

    expect(orphanedFunctionRule(view)).toEqual([]);
  });
});

/**
 * The engine reaches two function kinds through a C_NPC instance body rather
 * than through a dialog or a call: the routine in `daily_routine` and the
 * state in `start_aistate`. Retail names **1,154 routines** and nothing else,
 * so missing these reported every one of them (editor review 2026-11-01,
 * finding 2).
 */
describe('orphanedFunctionRule over real parser output', () => {
  it('does not flag the routine an NPC instance names in daily_routine', () => {
    const parsed = parseWithRealParser(fs.readFileSync(path.join(EXAMPLES, 'DEV_2130_Szmyk.d'), 'utf8'));
    expect(parsed.hasErrors).toBe(false);
    const view = buildProjectView({
      files: [file('DEV_2130_Szmyk.d', parsed.model)],
      knownNpcNames: []
    });

    expect(view.functionsByKey.has('rtn_start_2130')).toBe(true);
    expect(orphanedFunctionRule(view)).toEqual([]);
  });

  it('does not flag the start state an NPC instance names in start_aistate', () => {
    const parsed = parseWithRealParser(`
      instance NPC_Test (C_NPC)
      {
        name = "Test";
        id = 9999;
        start_aistate = ZS_Test;
      };

      func void ZS_Test () { };
    `);
    expect(parsed.hasErrors).toBe(false);
    const view = buildProjectView({
      files: [file('npc.d', parsed.model)],
      knownNpcNames: []
    });

    expect(view.functionsByKey.has('zs_test')).toBe(true);
    expect(orphanedFunctionRule(view)).toEqual([]);
  });
});
