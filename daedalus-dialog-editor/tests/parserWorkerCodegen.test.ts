/**
 * Validate-and-generate runs in the forked parser worker, not on Electron's
 * main thread (#546): the worker normalizes, generates and parses the
 * generated text back itself, so the model crosses the process boundary once
 * and the main process only writes.
 *
 * Against the real daedalus-parser and codegen.
 *
 * @jest-environment node
 */

import { describe, it, expect } from '@jest/globals';
import { handleParserRequest } from '../src/main/workers/parser.worker';
import type { CodeGenerationSettings, SemanticModel, ValidationResult } from '../src/shared/types';

const SETTINGS: CodeGenerationSettings = {
  indentChar: '\t',
  includeComments: true,
  sectionHeaders: true,
  uppercaseKeywords: true,
};

const SOURCE = [
  'instance DIA_Test(C_INFO) { npc = SOME_NPC; nr = 1; condition = DIA_Test_Condition; information = DIA_Test_Info; };',
  'func int DIA_Test_Condition() { return TRUE; };',
  'func void DIA_Test_Info() {',
  '  AI_Output(other, self, "DIA_Test_15_00");',
  '};',
].join('\n');

const parsed = (): SemanticModel =>
  handleParserRequest({ id: 'p', sourceCode: SOURCE }) as SemanticModel;

describe('parser worker codegen requests (#546)', () => {
  it('validates a model and returns the generated code with the result', async () => {
    const result = await handleParserRequest({
      id: 'v', op: 'validate', model: parsed(), settings: SETTINGS, options: {},
    }) as ValidationResult;

    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.generatedCode).toContain('DIA_Test_Info');
  });

  it('reports what the in-worker parse-back finds and the model checks', async () => {
    const model = parsed();
    (model.dialogs.DIA_Test.properties as Record<string, unknown>).npc = undefined;

    const result = await handleParserRequest({
      id: 'v2', op: 'validate', model, settings: SETTINGS,
      options: { existingDialogs: ['DIA_Test'] },
    }) as ValidationResult;

    expect(result.isValid).toBe(false);
    expect(result.errors.map((e) => e.type).sort()).toEqual(['duplicate_dialog', 'missing_required_property']);
  });

  it('generates code', async () => {
    const code = await handleParserRequest({ id: 'g', op: 'generate', model: parsed(), settings: SETTINGS });
    expect(typeof code).toBe('string');
    expect(code).toContain('DIA_Test_Condition');
  });

  it('generates one dialog', async () => {
    const code = await handleParserRequest({
      id: 'd', op: 'generateDialog', model: parsed(), dialogName: 'DIA_Test', settings: SETTINGS,
    });
    expect(code).toContain('instance DIA_Test(C_INFO)');
  });

  it('generates and parses back, answering with the code and the syntax verdict only', async () => {
    const result = await handleParserRequest({
      id: 'c', op: 'generateChecked', model: parsed(), settings: SETTINGS,
    }) as { code: string; hasErrors: boolean; errors: unknown[] };

    expect(result.code).toContain('DIA_Test_Info');
    expect(result.hasErrors).toBe(false);
    expect(result.errors).toEqual([]);
    // The parse-back's model stays in the worker.
    expect(Object.keys(result).sort()).toEqual(['code', 'errors', 'hasErrors']);
  });

  it('refuses a partial model unless asked to allow one', async () => {
    const broken = handleParserRequest({ id: 'b', sourceCode: 'func void X() { ' }) as SemanticModel;
    expect(broken.hasErrors).toBe(true);

    await expect(Promise.resolve().then(() => handleParserRequest({
      id: 'c2', op: 'generateChecked', model: broken, settings: SETTINGS,
    }))).rejects.toThrow();
    await expect(Promise.resolve().then(() => handleParserRequest({
      id: 'c3', op: 'generateChecked', model: broken, settings: SETTINGS, allowPartialModel: true,
    }))).resolves.toMatchObject({ code: expect.any(String) });
  });
});
