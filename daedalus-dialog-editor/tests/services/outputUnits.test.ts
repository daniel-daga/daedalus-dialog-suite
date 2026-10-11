/**
 * Finding the project's OutputUnit database (#264).
 *
 * Two things here are not obvious and are the reason this has tests at all:
 * the folder's casing varies between real installs, and a database that cannot
 * be read must not take the Problems scan down with it.
 *
 * @jest-environment node
 */

import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { readProjectOutputUnits } from '../../src/main/services/outputUnits';

/** The ASCII flavour, which is a plain enough archive to author inline. */
const asciiOu = (units: Array<{ name: string; text: string }>): string => {
  const head = [
    'ZenGin Archive', 'ver 1', 'zCArchiverGeneric', 'ASCII', 'saveGame 0', 'END',
    `objects ${1 + units.length * 3}  `, 'END', '',
  ];
  const body = ['[% zCCSLib 0 0]', `\tNumOfItems=int:${units.length}`];
  let index = 1;
  for (const unit of units) {
    body.push(
      `\t[% zCCSBlock 0 ${index++}]`,
      `\t\tblockName=string:${unit.name}`,
      '\t\tnumOfBlocks=int:1',
      '\t\tsubBlock0=float:0',
      `\t\t[% zCCSAtomicBlock 0 ${index++}]`,
      `\t\t\t[% oCMsgConversation 0 ${index++}]`,
      '\t\t\t\tsubType=enum:0',
      `\t\t\t\ttext=string:${unit.text}`,
      `\t\t\t\tname=string:${unit.name}.WAV`,
      '\t\t\t[]', '\t\t[]', '\t[]',
    );
  }
  body.push('[]');
  return head.concat(body).join('\n') + '\n';
};

describe('readProjectOutputUnits', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'dde-ou-'));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const writeOu = async (segments: string[], name: string, body: string): Promise<string> => {
    const dir = path.join(root, ...segments);
    await fs.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, name);
    await fs.writeFile(filePath, body, 'latin1');
    return filePath;
  };

  it('returns null when no install is configured', async () => {
    await expect(readProjectOutputUnits(null)).resolves.toBeNull();
  });

  it('returns null when the install holds no cutscene folder', async () => {
    await expect(readProjectOutputUnits(root)).resolves.toBeNull();
  });

  it('reads the database under the install', async () => {
    await writeOu(['_work', 'Data', 'Scripts', 'content', 'CUTSCENE'], 'OU.CSL',
      asciiOu([{ name: 'DIA_TEST_15_00', text: 'Was willst du?' }]));

    const result = await readProjectOutputUnits(root);

    expect(result?.format).toBe('ASCII');
    expect(result?.units).toEqual([
      { name: 'DIA_TEST_15_00', text: 'Was willst du?', wav: 'DIA_TEST_15_00.WAV' },
    ]);
  });

  it('finds it whatever the folder and file casing is', async () => {
    // A real install is not spelled the way Gothic's own docs spell it, and a
    // case-sensitive filesystem is where that stops being harmless.
    await writeOu(['_Work', 'data', 'scripts', 'Content', 'Cutscene'], 'ou.csl',
      asciiOu([{ name: 'DIA_TEST_15_00', text: 'Gefunden.' }]));

    const result = await readProjectOutputUnits(root);

    expect(result?.units).toHaveLength(1);
  });

  it('prefers OU.BIN, which is the file the engine actually loads', async () => {
    const dir = ['_work', 'Data', 'Scripts', 'content', 'CUTSCENE'];
    await writeOu(dir, 'OU.CSL', asciiOu([{ name: 'DIA_TEST_15_00', text: 'aus der CSL' }]));
    await writeOu(dir, 'OU.BIN', asciiOu([{ name: 'DIA_TEST_15_00', text: 'aus der BIN' }]));

    const result = await readProjectOutputUnits(root);

    expect(result?.filePath.toUpperCase()).toContain('OU.BIN');
    expect(result?.units[0].text).toBe('aus der BIN');
  });

  it('returns null rather than throwing when the database is unreadable', async () => {
    // A truncated or half-written OU must not take the whole Problems scan down
    // with it — every other rule's findings would go with it.
    await writeOu(['_work', 'Data', 'Scripts', 'content', 'CUTSCENE'], 'OU.BIN', 'not an archive at all\n');

    await expect(readProjectOutputUnits(root)).resolves.toBeNull();
  });
});
