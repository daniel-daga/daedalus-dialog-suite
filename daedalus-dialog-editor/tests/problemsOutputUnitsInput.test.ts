/**
 * The OU database reaching the rule that needs it (#264).
 *
 * The rule itself is tested over a hand-built view; this is the other half, and
 * the half that silently rots: a rule registered in `ALL_RULES` but never fed
 * is green in every unit test and reports nothing in the app. So this asserts
 * the whole path — the store fetches the database on project open, and the scan
 * carries it into `scanProject`.
 *
 * @jest-environment jsdom
 */

import { useProblemsStore } from '../src/renderer/store/problemsStore';
import { useProjectStore } from '../src/renderer/store/projectStore';
import type { ProjectOutputUnits, SemanticModel } from '../src/shared/types';

/** One file with one `AI_Output` line, which is all the rule needs. */
const parsedFile = (filePath: string, id: string, text: string) => ({
  filePath,
  semanticModel: {
    dialogs: {},
    functions: {
      DIA_TEST_INFO: {
        name: 'DIA_TEST_INFO',
        actions: [{ type: 'DialogLine', speaker: 'self', listener: 'other', text, id, line: 1 }],
        conditions: [],
        calls: [],
      },
    },
  } as unknown as SemanticModel,
});

const database = (units: Array<{ name: string; text: string }>): ProjectOutputUnits => ({
  filePath: 'C:/Gothic/_work/Data/Scripts/content/CUTSCENE/OU.BIN',
  format: 'BINARY',
  units: units.map((u) => ({ ...u, wav: `${u.name}.WAV` })),
});

const seed = (outputUnits: ProjectOutputUnits | null): void => {
  useProjectStore.setState({
    parsedFiles: new Map([['DIA_Test.d', parsedFile('DIA_Test.d', 'DIA_TEST_15_00', 'Neuer Text.')]]),
    npcList: [],
    npcPrototypes: [],
    allDialogFiles: ['DIA_Test.d'],
    dialogIndex: new Map(),
    outputUnits,
  });
};

describe('the OU database reaching the Problems scan', () => {
  afterEach(() => useProblemsStore.getState().clear());

  it('reports the drift when the store holds a database', () => {
    seed(database([{ name: 'DIA_TEST_15_00', text: 'Alter Text.' }]));

    useProblemsStore.getState().runScan();

    const problems = useProblemsStore.getState().problems.filter((p) => p.rule === 'output-unit-stale');
    expect(problems).toHaveLength(1);
    expect(problems[0].message).toContain('Alter Text.');
  });

  it('reports nothing when the store holds no database', () => {
    // Which is every machine with no Gothic install — and must not turn every
    // line in the project into a finding.
    seed(null);

    useProblemsStore.getState().runScan();

    expect(useProblemsStore.getState().problems.filter((p) => p.rule.startsWith('output-unit'))).toEqual([]);
  });

  it('fetches the database over IPC when a project opens', async () => {
    const readOutputUnits = jest.fn().mockResolvedValue(database([]));
    (window as unknown as { editorAPI: Record<string, unknown> }).editorAPI = {
      addAllowedPath: jest.fn().mockResolvedValue(undefined),
      loadProjectConfig: jest.fn().mockResolvedValue({
        projectRoot: 'C:/mod', scriptsRoot: 'C:/mod/Scripts', projectFilePath: 'C:/mod/p.json',
        config: {}, resolvedAssetSources: [], gmbtProjectDir: null, gmbtAssetSources: [],
        gothicInstallPath: 'C:/Gothic', warnings: [],
      }),
      buildProjectIndex: jest.fn().mockResolvedValue({ npcs: [], allFiles: [] }),
      readOutputUnits,
    };

    await useProjectStore.getState().openProject('C:/mod');
    // The fetch is deliberately off the open path's critical section.
    await Promise.resolve();
    await Promise.resolve();

    expect(readOutputUnits).toHaveBeenCalled();
    expect(useProjectStore.getState().outputUnits).toEqual(database([]));
  });
});
