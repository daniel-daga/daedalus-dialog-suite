import { FileService, acquireLock } from '../../src/main/services/FileService';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as iconv from 'iconv-lite';

jest.mock('electron', () => ({
  dialog: {},
}));

describe('FileService.acquireLock serialization', () => {
  it('runs three concurrent operations on the same path strictly one at a time', async () => {
    let active = 0;
    let maxActive = 0;
    const makeOp = () => () => new Promise<void>((resolve) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      setTimeout(() => {
        active -= 1;
        resolve();
      }, 15);
    });

    await Promise.all([
      acquireLock('same-path', makeOp()),
      acquireLock('same-path', makeOp()),
      acquireLock('same-path', makeOp()),
    ]);

    expect(maxActive).toBe(1);
  });

  it('preserves queue order even if one operation rejects', async () => {
    const order: number[] = [];
    const results = await Promise.allSettled([
      acquireLock('p', async () => { order.push(1); }),
      acquireLock('p', async () => { order.push(2); throw new Error('boom'); }),
      acquireLock('p', async () => { order.push(3); }),
    ]);

    expect(order).toEqual([1, 2, 3]);
    expect(results[1].status).toBe('rejected');
    expect(results[0].status).toBe('fulfilled');
    expect(results[2].status).toBe('fulfilled');
  });
});

describe('FileService write encoding default', () => {
  let dir: string;
  let service: FileService;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fs-enc-'));
    service = new FileService();
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('writes a never-read file as windows-1252, not utf8', async () => {
    const file = path.join(dir, 'brand-new.d');
    const content = '// äöü ß — Gothic chars\nvar int test = 1;';

    await service.writeFile(file, content);

    const buffer = await fs.readFile(file);
    // Decoding as windows-1252 round-trips exactly
    expect(iconv.decode(buffer, 'windows-1252')).toBe(content);
    // 'ä' is one byte (0xE4) in win1252; utf8 would encode it as two bytes
    expect(buffer.includes(0xe4)).toBe(true);
  });

  it('preserves the detected encoding for a previously read file', async () => {
    const file = path.join(dir, 'existing.d');
    await fs.writeFile(file, iconv.encode('UTF-8: 你好 🎉', 'utf8'), 'utf8');

    const readBack = await service.readFile(file);
    await service.writeFile(file, readBack + ' more');

    const buffer = await fs.readFile(file);
    expect(buffer.toString('utf8')).toBe('UTF-8: 你好 🎉 more');
  });
});
