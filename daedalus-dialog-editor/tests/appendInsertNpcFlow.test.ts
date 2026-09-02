/**
 * Slice C of "Insert NPC from the World surface" (level-editor.md §16.19,
 * slice 16): the main-side write behind `script:appendInsertNpc`.
 *
 * The write is a text splice, not a regeneration — slice B measured that
 * regenerating Startup.d rewrites nearly every line — so what these assert is
 * that exactly one line lands, before the `};` of the right function, and
 * every other byte of the file is untouched. The model comes from the real
 * parser (in a child process, as the other real-parser suites do) so the
 * function range the splice relies on is the range the worker would send.
 *
 * @jest-environment node
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { execFileSync } from 'child_process';
import { appendInsertNpcFlow, type AppendInsertNpcDeps } from '../src/main/services/AppendInsertNpcFlow';
import { FileServiceError } from '../src/main/services/FileService';
import { PathValidationError } from '../src/main/services/PathValidationService';

const FILE = 'C:/proj/Content/Story/Startup.d';

// Startup.d-shaped: mixed-case FUNC VOID, tabs, CRLF, a trailing comment, a
// commented-out spawn, and INIT_NewWorld in the same file.
const STARTUP_LINES = [
  '// Startup und Init Funktionen der Level-zen-files',
  '',
  'Func Void STARTUP_NewWorld()',
  '{\t',
  '\t// ------ StartUps der Unter-Parts ------ ',
  '\tSTARTUP_NewWorld_Part_City_01();',
  '\tWld_InsertNpc (PC_Hero,"START");\t\t\t//Held',
  '\t//Wld_InsertNpc (NONE_100_Xardas,"XARDAS");',
  '\tKapitel = 1; //Joly: Kann hier stehen bleiben!',
  '',
  '\tPlayVideo ("INTRO.BIK");',
  '};',
  '',
  'FUNC VOID INIT_NewWorld()',
  '{',
  '\tB_InitGuildAttitudes();',
  '};',
  '',
];
const STARTUP_CRLF = STARTUP_LINES.join('\r\n');

/** Parse with the real parser the way `parser.worker.ts` does, as plain JSON. */
function parseLikeTheWorker(source: string): any {
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
      visitor.checkForSyntaxErrors(result.tree.rootNode, src);
      if (!visitor.semanticModel.hasErrors) {
        visitor.pass1_createObjects(result.tree.rootNode);
        visitor.pass2_analyzeAndLink(result.tree.rootNode);
      }
      process.stdout.write(JSON.stringify(visitor.semanticModel));
    });
  `;
  const output = execFileSync(process.execPath, ['-e', script], { input: source, encoding: 'utf8' });
  return JSON.parse(output);
}

type Calls = {
  validatePathResolved: jest.Mock;
  readFile: jest.Mock;
  parseSource: jest.Mock;
  writeFile: jest.Mock;
  notifySelfWrite: jest.Mock;
};

function makeDeps(source: string, overrides: Partial<Calls> = {}): { deps: AppendInsertNpcDeps; calls: Calls } {
  const calls: Calls = {
    validatePathResolved: jest.fn(async () => undefined),
    readFile: jest.fn(async () => source),
    parseSource: jest.fn(async (src: string) => parseLikeTheWorker(src)),
    writeFile: jest.fn(async () => ({ success: true, encoding: 'windows-1252' })),
    notifySelfWrite: jest.fn(() => undefined),
    ...overrides,
  } as Calls;
  const deps = {
    pathValidator: { validatePathResolved: calls.validatePathResolved },
    fileService: { readFile: calls.readFile, writeFile: calls.writeFile },
    parserService: { parseSource: calls.parseSource },
    fileWatcherService: { notifySelfWrite: calls.notifySelfWrite },
  } as unknown as AppendInsertNpcDeps;
  return { deps, calls };
}

function written(calls: Calls): string {
  expect(calls.writeFile).toHaveBeenCalledTimes(1);
  return calls.writeFile.mock.calls[0][1] as string;
}

describe('appendInsertNpcFlow', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('splices one CRLF line before the `};` of STARTUP_<world>, and nothing else changes', async () => {
    const { deps, calls } = makeDeps(STARTUP_CRLF);

    const result = await appendInsertNpcFlow(deps, FILE, 'STARTUP_NEWWORLD', 'BAU_900_Lobart', 'NW_FARM1_LOBART');

    expect(calls.validatePathResolved).toHaveBeenCalledWith(FILE, { write: true });
    const out = written(calls);
    const expected = [...STARTUP_LINES];
    expected.splice(11, 0, '\tWld_InsertNpc (BAU_900_Lobart, "NW_FARM1_LOBART");');
    expect(out).toBe(expected.join('\r\n'));
    expect(out).not.toMatch(/[^\r]\n/);
    expect(result).toEqual({ ok: true, line: 12 });
    expect(calls.writeFile).toHaveBeenCalledWith(FILE, out, { expectUnchanged: true });
    expect(calls.notifySelfWrite).toHaveBeenCalledWith(FILE);
  });

  it('keeps LF and takes the indent the body already uses', async () => {
    const lf = STARTUP_CRLF.replace(/\r\n/g, '\n').replace(/\t(?=\S|\/)/g, '    ');
    const { deps, calls } = makeDeps(lf);

    const result = await appendInsertNpcFlow(deps, FILE, 'STARTUP_NewWorld', 'BAU_900_Lobart', 'NW_FARM1_LOBART');

    const out = written(calls);
    expect(out).not.toContain('\r');
    const lines = out.split('\n');
    expect(lines[11]).toBe('    Wld_InsertNpc (BAU_900_Lobart, "NW_FARM1_LOBART");');
    expect(lines[12]).toBe('};');
    expect([...lines.slice(0, 11), ...lines.slice(12)].join('\n')).toBe(lf);
    expect(result).toEqual({ ok: true, line: 12 });
  });

  it('refuses a file that does not parse clean, and does not write', async () => {
    const broken = STARTUP_CRLF.replace('Kapitel = 1;', 'Kapitel = ;');
    const { deps, calls } = makeDeps(broken);

    const result = await appendInsertNpcFlow(deps, FILE, 'STARTUP_NewWorld', 'BAU_900_Lobart', 'NW_FARM1_LOBART');

    expect(result).toMatchObject({ ok: false, reason: { kind: 'parse-errors' } });
    expect(calls.writeFile).not.toHaveBeenCalled();
    expect(calls.notifySelfWrite).not.toHaveBeenCalled();
  });

  it('refuses when the function is not in the file', async () => {
    const { deps, calls } = makeDeps(STARTUP_CRLF);

    const result = await appendInsertNpcFlow(deps, FILE, 'STARTUP_OldWorld', 'BAU_900_Lobart', 'NW_FARM1_LOBART');

    expect(result).toEqual({ ok: false, reason: { kind: 'function-not-found', functionName: 'STARTUP_OldWorld' } });
    expect(calls.writeFile).not.toHaveBeenCalled();
  });

  it('reports the mtime-guard conflict as a refusal, not a throw', async () => {
    const { deps, calls } = makeDeps(STARTUP_CRLF, {
      writeFile: jest.fn(async () => {
        throw new FileServiceError(`EXTERNAL_MODIFICATION: ${FILE} was modified on disk since it was last read`, 'EXTERNAL_MODIFICATION', FILE);
      }) as Calls['writeFile'],
    });

    const result = await appendInsertNpcFlow(deps, FILE, 'STARTUP_NewWorld', 'BAU_900_Lobart', 'NW_FARM1_LOBART');

    expect(result).toEqual({ ok: false, reason: { kind: 'external-modification' } });
    expect(calls.notifySelfWrite).not.toHaveBeenCalled();
  });

  it('surfaces a path-validation refusal with its own message', async () => {
    const { deps, calls } = makeDeps(STARTUP_CRLF, {
      validatePathResolved: jest.fn(async () => {
        throw new PathValidationError('Path is not in an allowed directory', 'C:/evil.d', 'outside');
      }) as Calls['validatePathResolved'],
    });

    await expect(appendInsertNpcFlow(deps, 'C:/evil.d', 'STARTUP_NewWorld', 'X', 'WP')).rejects.toThrow(
      'Path is not in an allowed directory'
    );
    expect(calls.readFile).not.toHaveBeenCalled();
    expect(calls.writeFile).not.toHaveBeenCalled();
  });
});
