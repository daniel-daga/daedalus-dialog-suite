/**
 * P0 perf: project open must parse each file exactly once.
 *
 * The index build's metadata pass already produces a full semantic model per
 * file. It must (a) walk top-level declarations once — not once for instances
 * and again for prototypes — and (b) persist the model keyed on path+mtime so
 * the renderer's background ingestion (project:parseDialogFile) is a cache
 * read instead of a second full parse.
 * @jest-environment node
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

jest.mock('daedalus-parser', () => {
  const actual = jest.requireActual('daedalus-parser');
  const Actual = actual.default ?? actual;
  const counters = { parse: 0, extractDeclarations: 0 };
  (globalThis as any).__daedalusParserCounters = counters;
  class CountingParser extends Actual {
    parse(...args: any[]) {
      counters.parse += 1;
      return super.parse(...args);
    }
    extractDeclarations(...args: any[]) {
      counters.extractDeclarations += 1;
      return super.extractDeclarations(...args);
    }
  }
  (CountingParser as any).default = CountingParser;
  (CountingParser as any).DaedalusLanguage = actual.DaedalusLanguage;
  return CountingParser;
});

const counters = (): { parse: number; extractDeclarations: number } =>
  (globalThis as any).__daedalusParserCounters;

const DIALOG_SOURCE = `
INSTANCE DIA_Farim_Hallo (C_INFO)
{
    npc = SLD_99003_Farim;
    nr = 1;
    condition = DIA_Farim_Hallo_Condition;
    information = DIA_Farim_Hallo_Info;
    description = "Hallo!";
};

FUNC INT DIA_Farim_Hallo_Condition()
{
    return TRUE;
};

FUNC VOID DIA_Farim_Hallo_Info()
{
    AI_Output(other, self, "DIA_Farim_Hallo_15_00"); //Hallo!
};
`;

const PROTOTYPE_SOURCE = `
PROTOTYPE Mst_Default_Sld (C_NPC)
{
    level = 10;
};

INSTANCE SLD_99003_Farim (Mst_Default_Sld)
{
    name = "Farim";
};
`;

const BROKEN_SOURCE = 'INSTANCE DIA_Broken (C_INFO) { npc = ; };;; func';

describe('project-open single-parse hand-off', () => {
  let tempDir: string;
  let ProjectService: any;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gothic-handoff-'));
    const module = await import('../src/main/services/ProjectService');
    ProjectService = module.default;
    counters().parse = 0;
    counters().extractDeclarations = 0;
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  const writeFile = (name: string, content: string): string => {
    const filePath = path.join(tempDir, name);
    fs.writeFileSync(filePath, content);
    return filePath;
  };

  it('walks top-level declarations once per file during the metadata pass', async () => {
    writeFile('SLD_Farim.d', PROTOTYPE_SOURCE);

    const service = new ProjectService();
    const index = await service.buildProjectIndex(tempDir);

    // Both instances and prototypes must still be extracted…
    expect(index.npcs).toContain('SLD_99003_Farim');
    expect(index.npcPrototypes).toContain('MST_DEFAULT_SLD');
    // …from a single declarations walk.
    expect(counters().extractDeclarations).toBe(1);
  });

  it('persists index-pass models so a subsequent per-file read needs no second parse', async () => {
    const fileA = writeFile('DIA_Farim.d', DIALOG_SOURCE);
    const fileB = writeFile('SLD_Farim.d', PROTOTYPE_SOURCE);

    const service = new ProjectService();
    await service.buildProjectIndex(tempDir);
    const parsesAfterIndex = counters().parse;
    expect(parsesAfterIndex).toBe(2); // one per file

    const modelA = await service.takeParsedModel(fileA);
    const modelB = await service.takeParsedModel(fileB);

    expect(modelA).toBeDefined();
    expect(Object.keys(modelA.dialogs)).toContain('DIA_Farim_Hallo');
    expect(Object.keys(modelA.functions).map((n) => n.toUpperCase())).toContain(
      'DIA_FARIM_HALLO_INFO'
    );
    expect(modelB).toBeDefined();
    expect(Object.keys(modelB.instances)).toContain('SLD_99003_Farim');

    // The hand-off served both models without any additional parse.
    expect(counters().parse).toBe(parsesAfterIndex);
  });

  it('serves each primed model at most once (hand-off, not a growing cache)', async () => {
    const fileA = writeFile('DIA_Farim.d', DIALOG_SOURCE);

    const service = new ProjectService();
    await service.buildProjectIndex(tempDir);

    expect(await service.takeParsedModel(fileA)).toBeDefined();
    expect(await service.takeParsedModel(fileA)).toBeUndefined();
  });

  it('rejects a primed model when the file changed on disk since the index pass', async () => {
    const fileA = writeFile('DIA_Farim.d', DIALOG_SOURCE);

    const service = new ProjectService();
    await service.buildProjectIndex(tempDir);

    // Simulate an external modification after the index pass.
    const future = new Date(Date.now() + 5000);
    fs.utimesSync(fileA, future, future);

    expect(await service.takeParsedModel(fileA)).toBeUndefined();
  });

  it('does not prime models for files with syntax errors', async () => {
    const broken = writeFile('DIA_Broken.d', BROKEN_SOURCE);

    const service = new ProjectService();
    await service.buildProjectIndex(tempDir);

    // The parse path must stay authoritative for error files (parser.worker
    // returns an errors-only model without declarations for those).
    expect(await service.takeParsedModel(broken)).toBeUndefined();
  });

  it('drops primed models from a previous index build on reindex', async () => {
    const fileA = writeFile('DIA_Farim.d', DIALOG_SOURCE);

    const service = new ProjectService();
    await service.buildProjectIndex(tempDir);
    fs.rmSync(fileA);

    await service.buildProjectIndex(tempDir);
    expect(await service.takeParsedModel(fileA)).toBeUndefined();
  });
});
