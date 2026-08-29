/**
 * The save pipeline, lifted out of the `generator:saveFile` IPC handler
 * (mcp-server.md §2, Phase 0).
 *
 * The flow — assert the payload shapes, validate the path, validate the model,
 * write the code validation already generated, and arm the watcher's
 * self-write suppression only after a write actually succeeded — was reachable
 * only through `ipcMain.handle`. It is a function now, so a second caller gets
 * the same pipeline rather than a second copy of it.
 *
 * Pure move: every assertion below describes behavior the handler already had.
 *
 * @jest-environment node
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { saveFileFlow, type SaveFileDeps } from '../src/main/services/SaveFileFlow';
import { PathValidationError } from '../src/main/services/PathValidationService';

const MODEL = { dialogs: {}, functions: {} };
const SETTINGS = { indentSize: 4 };

type Calls = {
  validatePathResolved: jest.Mock;
  validate: jest.Mock;
  generateCode: jest.Mock;
  parseSource: jest.Mock;
  writeFile: jest.Mock;
  notifySelfWrite: jest.Mock;
};

function makeDeps(overrides: Partial<Calls> = {}): { deps: SaveFileDeps; calls: Calls } {
  const calls: Calls = {
    validatePathResolved: jest.fn(async () => undefined),
    validate: jest.fn(async () => ({
      isValid: true,
      errors: [],
      warnings: [],
      generatedCode: 'INSTANCE DIA_Test (C_INFO) {};',
    })),
    generateCode: jest.fn(() => 'fallback code'),
    parseSource: jest.fn(async () => ({ hasErrors: false })),
    writeFile: jest.fn(async () => ({ success: true, encoding: 'windows-1252' })),
    notifySelfWrite: jest.fn(() => undefined),
    ...overrides,
  } as Calls;

  const deps = {
    pathValidator: { validatePathResolved: calls.validatePathResolved },
    validationService: { validate: calls.validate },
    codeGeneratorService: { generateCode: calls.generateCode },
    parserService: { parseSource: calls.parseSource },
    fileService: { writeFile: calls.writeFile },
    fileWatcherService: { notifySelfWrite: calls.notifySelfWrite },
  } as unknown as SaveFileDeps;

  return { deps, calls };
}

describe('saveFileFlow', () => {
  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('writes the code validation generated and then arms self-write suppression', async () => {
    const { deps, calls } = makeDeps();

    const result = await saveFileFlow(deps, 'C:/proj/DIA_Test.d', MODEL, SETTINGS);

    expect(calls.validatePathResolved).toHaveBeenCalledWith('C:/proj/DIA_Test.d', { write: true });
    expect(calls.writeFile).toHaveBeenCalledWith(
      'C:/proj/DIA_Test.d',
      'INSTANCE DIA_Test (C_INFO) {};',
      { expectUnchanged: true, backupBeforeWrite: false }
    );
    expect(calls.notifySelfWrite).toHaveBeenCalledWith('C:/proj/DIA_Test.d');
    expect(calls.generateCode).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: true, validationResult: { isValid: true } });
  });

  it('refuses to write an invalid model and returns the validation result', async () => {
    const { deps, calls } = makeDeps({
      validate: jest.fn(async () => ({
        isValid: false,
        errors: [{ type: 'missing_reference', message: 'nope' }],
        warnings: [],
      })) as Calls['validate'],
    });

    const result = await saveFileFlow(deps, 'C:/proj/DIA_Test.d', MODEL, SETTINGS);

    expect(result).toEqual({
      success: false,
      validationResult: { isValid: false, errors: [{ type: 'missing_reference', message: 'nope' }], warnings: [] },
    });
    expect(calls.writeFile).not.toHaveBeenCalled();
    expect(calls.notifySelfWrite).not.toHaveBeenCalled();
  });

  it('force-on-errors writes anyway, backs the file up first, and never expects it unchanged when overwriting', async () => {
    const { deps, calls } = makeDeps({
      validate: jest.fn(async () => ({ isValid: false, errors: [], warnings: [], generatedCode: 'forced' })) as Calls['validate'],
    });

    await saveFileFlow(deps, 'C:/proj/DIA_Test.d', MODEL, SETTINGS, {
      forceOnErrors: true,
      overwriteExternal: true,
    });

    expect(calls.writeFile).toHaveBeenCalledWith('C:/proj/DIA_Test.d', 'forced', {
      expectUnchanged: false,
      backupBeforeWrite: true,
    });
  });

  it('falls back to generating directly when validation is skipped, and parse-gates that code', async () => {
    const { deps, calls } = makeDeps({
      parseSource: jest.fn(async () => ({
        hasErrors: true,
        errors: [{ message: 'unexpected token', position: { line: 3 } }],
      })) as Calls['parseSource'],
    });

    const result = await saveFileFlow(deps, 'C:/proj/DIA_Test.d', MODEL, SETTINGS, { skipValidation: true });

    expect(calls.validate).not.toHaveBeenCalled();
    expect(calls.generateCode).toHaveBeenCalled();
    expect(result).toEqual({
      success: false,
      validationResult: {
        isValid: false,
        errors: [{ type: 'syntax_error', message: 'unexpected token', position: { line: 3 } }],
        warnings: [],
      },
    });
    expect(calls.writeFile).not.toHaveBeenCalled();
  });

  it('writes the fallback code when it parses clean', async () => {
    const { deps, calls } = makeDeps();

    const result = await saveFileFlow(deps, 'C:/proj/DIA_Test.d', MODEL, SETTINGS, { skipValidation: true });

    expect(calls.writeFile).toHaveBeenCalledWith('C:/proj/DIA_Test.d', 'fallback code', {
      expectUnchanged: true,
      backupBeforeWrite: false,
    });
    expect(result).toEqual({ success: true, encoding: 'windows-1252' });
  });

  it('rejects a malformed payload before touching any service', async () => {
    const { deps, calls } = makeDeps();

    await expect(saveFileFlow(deps, 'C:/proj/DIA_Test.d', 'not a model', SETTINGS)).rejects.toThrow(
      /Failed to save file/
    );
    expect(calls.validatePathResolved).not.toHaveBeenCalled();
    expect(calls.writeFile).not.toHaveBeenCalled();
  });

  it('surfaces a path-validation refusal with its own message', async () => {
    const { deps, calls } = makeDeps({
      validatePathResolved: jest.fn(async () => {
        throw new PathValidationError('Path is not in an allowed directory', 'C:/evil.d', 'outside');
      }) as Calls['validatePathResolved'],
    });

    await expect(saveFileFlow(deps, 'C:/evil.d', MODEL, SETTINGS)).rejects.toThrow(
      'Path is not in an allowed directory'
    );
    expect(calls.writeFile).not.toHaveBeenCalled();
  });
});
