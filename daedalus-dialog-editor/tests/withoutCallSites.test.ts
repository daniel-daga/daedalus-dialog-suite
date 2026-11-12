/**
 * The model the renderer receives does not carry `callSites` (#541): it is the
 * project index's view of a function body and only the main process reads it.
 * `calls` stays — the renderer's Problems rules and quest detection use it.
 *
 * @jest-environment node
 */

import { describe, expect, it } from '@jest/globals';
import { SemanticCodeGenerator } from 'daedalus-parser/semantic-code-generator';
import { deserializeSemanticModel } from 'daedalus-parser/semantic-model';
import { handleParserRequest } from '../src/main/workers/parser.worker';
import { withoutCallSites } from '../src/main/utils/withoutCallSites';

const model = () => ({
  dialogs: { DIA_Test: { properties: { information: 'DIA_Test_Info' } } },
  functions: {
    DIA_Test_Info: {
      name: 'DIA_Test_Info',
      calls: ['AI_Output'],
      callSites: [{
        functionName: 'AI_Output',
        args: [{ raw: 'self', value: 'self', isString: false }],
        position: { startLine: 2, startColumn: 3, endLine: 2, endColumn: 31 },
      }],
      actions: [{ type: 'DialogLine' }],
      conditions: [],
      range: { startIndex: 0, endIndex: 10 },
    },
    Helper: {
      name: 'Helper',
      calls: [],
      callSites: [],
      actions: [],
      conditions: [],
    },
  },
  declarationOrder: [{ type: 'function' as const, name: 'DIA_Test_Info' }],
  hasErrors: false,
  errors: [],
});

describe('withoutCallSites', () => {
  it('drops callSites from every function and keeps everything else', () => {
    const source = model();
    const shipped = withoutCallSites(source);

    expect(shipped.functions.DIA_Test_Info).not.toHaveProperty('callSites');
    expect(shipped.functions.Helper).not.toHaveProperty('callSites');
    expect(shipped.functions.DIA_Test_Info.calls).toEqual(['AI_Output']);
    expect(shipped.functions.DIA_Test_Info.actions).toEqual([{ type: 'DialogLine' }]);
    expect(shipped.functions.DIA_Test_Info.range).toEqual({ startIndex: 0, endIndex: 10 });
    expect(shipped.dialogs).toBe(source.dialogs);
    expect(shipped.declarationOrder).toBe(source.declarationOrder);
  });

  it('leaves the main process model it was given untouched', () => {
    const source = model();
    withoutCallSites(source);

    expect(source.functions.DIA_Test_Info.callSites).toHaveLength(1);
    expect(source.functions.DIA_Test_Info.callSites[0].position.startLine).toBe(2);
  });

  it('keeps the actions the renderer edits, as the same objects', () => {
    const source = model();
    const shipped = withoutCallSites(source);

    expect(shipped.functions.DIA_Test_Info.actions)
      .toBe(source.functions.DIA_Test_Info.actions);
  });

  it('generates the same file from the shipped model as from the full one', () => {
    const source = [
      'instance DIA_Test(C_INFO) { information = DIA_Test_Info; };',
      'func void DIA_Test_Info() {',
      '  AI_Output(self, other, "DIA_Test_15_00"); // A line.',
      '  Npc_ExchangeRoutine(self, "SMITH");',
      '};',
    ].join('\n');
    const full = handleParserRequest({ id: '1', sourceCode: source }) as ReturnType<typeof model>;
    const generator = new SemanticCodeGenerator();
    const generate = (m: unknown) => generator.generateSemanticModel(
      deserializeSemanticModel(JSON.parse(JSON.stringify(m)))
    );

    expect(full.functions.DIA_Test_Info.callSites).toHaveLength(2);
    expect(generate(withoutCallSites(full))).toBe(generate(full));
  });
});
