/**
 * Writing the lines the scripts hold into the OU database (#264, the second
 * half): every OU file under the install, each backed up first, and the
 * database read back so the Problems panel sees what is now on disk.
 *
 * @jest-environment node
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { updateProjectOutputUnits } from '../src/main/services/outputUnits';

const ascii = (units: Array<{ name: string; text: string }>) => [
  'ZenGin Archive', 'ver 1', 'zCArchiverGeneric', 'ASCII', 'saveGame 0', 'END',
  `objects ${1 + units.length * 3}  `, 'END', '',
  '[% zCCSLib 0 0]', `\tNumOfItems=int:${units.length}`,
  ...units.flatMap((u, i) => [
    `\t[% zCCSBlock 0 ${i * 3 + 1}]`, `\t\tblockName=string:${u.name}`, '\t\tnumOfBlocks=int:1', '\t\tsubBlock0=float:0',
    `\t\t[% zCCSAtomicBlock 0 ${i * 3 + 2}]`, `\t\t\t[% oCMsgConversation 0 ${i * 3 + 3}]`, '\t\t\t\tsubType=enum:0',
    `\t\t\t\ttext=string:${u.text}`, `\t\t\t\tname=string:${u.name}.WAV`, '\t\t\t[]', '\t\t[]', '\t[]',
  ]),
  '[]', '',
].join('\n');

const str0 = (v: string) => Buffer.concat([Buffer.from(v, 'latin1'), Buffer.from([0])]);
const le = (bytes: number, write: (b: Buffer) => void) => { const b = Buffer.alloc(bytes); write(b); return b; };
const frame = (cls: string, index: number, body: Buffer) => {
  const f = Buffer.concat([Buffer.alloc(4), le(2, (b) => b.writeUInt16LE(0)), le(4, (b) => b.writeUInt32LE(index)), str0('%'), str0(cls), body]);
  f.writeUInt32LE(f.length, 0);
  return f;
};
const binary = (units: Array<{ name: string; text: string }>) => Buffer.concat([
  Buffer.from(['ZenGin Archive', 'ver 1', 'zCArchiverGeneric', 'BINARY', 'saveGame 0', 'END',
    `objects ${1 + units.length * 3}  `, 'END'].join('\n') + '\n', 'latin1'),
  frame('zCCSLib', 0, Buffer.concat([le(4, (b) => b.writeInt32LE(units.length)), ...units.map((u, i) => frame('zCCSBlock', i * 3 + 1, Buffer.concat([
    str0(u.name), le(4, (b) => b.writeInt32LE(1)), le(4, (b) => b.writeFloatLE(0)),
    frame('zCCSAtomicBlock', i * 3 + 2, frame('oCMsgConversation', i * 3 + 3, Buffer.concat([Buffer.from([0]), str0(u.text), str0(`${u.name}.WAV`)]))),
  ])))])),
]);

/** An install laid out with the casing a real one tends to have. */
function install(files: Record<string, Buffer | string>): { root: string; dir: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gothic-'));
  const dir = path.join(root, '_work', 'DATA', 'Scripts', 'Content', 'Cutscene');
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
  return { root, dir };
}

const OLD = [{ name: 'DIA_HARALD_15_00', text: 'Alt.' }, { name: 'DIA_XARDAS_14_00', text: 'Vanilla.' }];

describe('updateProjectOutputUnits', () => {
  it('rewrites OU.BIN and OU.CSL alike, backs each up first, and returns what is now on disk', async () => {
    const { root, dir } = install({ 'OU.BIN': binary(OLD), 'ou.csl': ascii(OLD) });
    const binBefore = fs.readFileSync(path.join(dir, 'OU.BIN'));
    const cslBefore = fs.readFileSync(path.join(dir, 'ou.csl'));

    const result = await updateProjectOutputUnits(root, [
      { name: 'DIA_HARALD_15_00', text: 'Neu.' },
      { name: 'DIA_HARALD_15_01', text: 'Dazu.' },
    ]);

    expect(result.written.map((p) => path.basename(p)).sort()).toEqual(['OU.BIN', 'ou.csl']);
    expect(fs.readFileSync(path.join(dir, 'OU.BIN.bak'))).toEqual(binBefore);
    expect(fs.readFileSync(path.join(dir, 'ou.csl.bak'))).toEqual(cslBefore);
    // Read back from the file the engine loads, the Xardas line untouched.
    expect(result.outputUnits?.units.map(({ name, text }) => ({ name, text }))).toEqual([
      { name: 'DIA_HARALD_15_00', text: 'Neu.' },
      { name: 'DIA_HARALD_15_01', text: 'Dazu.' },
      { name: 'DIA_XARDAS_14_00', text: 'Vanilla.' },
    ]);
    expect(fs.readFileSync(path.join(dir, 'ou.csl'), 'latin1')).toContain('text=string:Neu.');
  });

  it('refuses when the install holds no OU database, and writes nothing', async () => {
    const { root, dir } = install({});
    await expect(updateProjectOutputUnits(root, [{ name: 'DIA_A_00', text: 'x' }])).rejects.toThrow(/no OU database/i);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it('refuses without an install', async () => {
    await expect(updateProjectOutputUnits(null, [])).rejects.toThrow(/Gothic install/i);
  });
});
