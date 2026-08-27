/**
 * The packaged-app open-world smoke (build-windows.yml). CI launches the
 * packaged exe with DDE_SMOKE_OPEN_WORLD pointing at the committed fixture
 * world; main.ts routes that into runOpenWorldSmoke instead of creating a
 * window. These tests pin the verdict logic — a failed open, a dead addon
 * (openWorld rejects), and an implausibly empty summary must all come back
 * red, and the verdict must land in the result file CI reads.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runOpenWorldSmoke } from '../src/main/openWorldSmoke';

function makeService(openWorld: jest.Mock) {
  return { openWorld, close: jest.fn() };
}

const summary = { stats: { vobCount: 12, worldTriangles: 300 } };

describe('runOpenWorldSmoke', () => {
  let resultPath: string;

  beforeEach(() => {
    resultPath = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'dde-smoke-')),
      'result.json',
    );
  });

  afterEach(() => {
    fs.rmSync(path.dirname(resultPath), { recursive: true, force: true });
  });

  it('reports ok with the summary counts when the world opens', async () => {
    const openWorld = jest.fn().mockResolvedValue(summary);
    const service = makeService(openWorld);

    const result = await runOpenWorldSmoke(service, '/fixtures/minimal.g2.zen', resultPath);

    expect(result.ok).toBe(true);
    expect(result.vobCount).toBe(12);
    expect(result.worldTriangles).toBe(300);
    // The open must go through the same request shape the World surface sends.
    expect(openWorld).toHaveBeenCalledWith({
      worldPath: '/fixtures/minimal.g2.zen',
      gameVersion: 'g2',
      assetSources: [],
    });
    const written = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
    expect(written).toEqual(result);
  });

  it('reports failure when the open rejects (addon failed to load, bad world)', async () => {
    const service = makeService(
      jest.fn().mockRejectedValue(new Error('The world worker died (Cannot open zenkit_node.node)')),
    );

    const result = await runOpenWorldSmoke(service, '/nope.zen', resultPath);

    expect(result.ok).toBe(false);
    expect(result.error).toContain('zenkit_node.node');
    const written = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
    expect(written.ok).toBe(false);
  });

  it('reports failure on an implausibly empty summary', async () => {
    const service = makeService(
      jest.fn().mockResolvedValue({ stats: { vobCount: 0, worldTriangles: 0 } }),
    );

    const result = await runOpenWorldSmoke(service, '/fixtures/minimal.g2.zen', resultPath);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/vobCount/);
  });

  it('tears the worker down and still returns a verdict with no result path', async () => {
    const service = makeService(jest.fn().mockResolvedValue(summary));

    const result = await runOpenWorldSmoke(service, '/fixtures/minimal.g2.zen', undefined);

    expect(result.ok).toBe(true);
    expect(service.close).toHaveBeenCalled();
  });
});
