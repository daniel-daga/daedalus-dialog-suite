import { useProjectStore, PARSED_FILES_CAP } from '../src/renderer/store/projectStore';
import { useProblemsStore } from '../src/renderer/store/problemsStore';
import type { SemanticModel } from '../src/shared/types';

const model = (overrides: Partial<SemanticModel> = {}): SemanticModel => ({
  dialogs: {}, functions: {}, constants: {}, variables: {}, instances: {},
  hasErrors: false, errors: [], ...overrides
});

describe('project corpus beyond the parsed-files cap (#554)', () => {
  beforeEach(() => {
    useProjectStore.getState().closeProject();
    useProblemsStore.getState().clear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    useProjectStore.getState().closeProject();
    useProblemsStore.getState().clear();
  });

  it('keeps every ingested file available to Problems, quests and the globals merge', async () => {
    const files = Array.from({ length: PARSED_FILES_CAP + 188 }, (_, i) => `/p/file${i}.d`);
    const dialogFile = files[0];
    const globalsFile = files[1];
    const dialogModel = model({
      dialogs: {
        DIA_Hawell: {
          name: 'DIA_Hawell', parent: 'C_INFO',
          properties: { npc: 'MissingNpc', information: 'DIA_Hawell_Info' }
        }
      },
      functions: {
        DIA_Hawell_Info: {
          name: 'DIA_Hawell_Info', returnType: 'VOID', parameters: [], conditions: [], calls: [],
          actions: [{ type: 'LogEntry', topic: 'TOPIC_BEPPO', text: 'Found it' }]
        }
      }
    });
    jest.spyOn(window.editorAPI, 'parseDialogFile').mockImplementation(async (file) => (
      file === dialogFile ? dialogModel : file === globalsFile
        ? model({ constants: { IMPORTANT: { name: 'IMPORTANT', type: 'int', value: 42 } } })
        : model()
    ));
    useProjectStore.setState({
      projectPath: '/p', allDialogFiles: files,
      dialogIndex: new Map([['MISSINGNPC', [{ dialogName: 'DIA_Hawell', npc: 'MissingNpc', filePath: dialogFile }]]])
    });

    await useProjectStore.getState().startBackgroundIngestion();

    const project = useProjectStore.getState();
    expect(project.isIngesting).toBe(false);
    expect(project.parsedFiles.size).toBe(files.length);
    expect(files.every((file) => project.parsedFiles.has(file))).toBe(true);
    expect(project.mergedSemanticModel.constants).toHaveProperty('IMPORTANT');
    expect(project.getQuestUsage('TOPIC_BEPPO').dialogs).toHaveProperty('DIA_Hawell');
    useProblemsStore.getState().runScan();
    expect(useProblemsStore.getState().scannedFileCount).toBe(files.length);
    expect(useProblemsStore.getState().problems.some((problem) => (
      problem.rule === 'npc-not-found' && problem.locus.kind === 'script' && problem.locus.filePath === dialogFile
    ))).toBe(true);

    // Editing another file must not evict the earlier corpus, either.
    project.updateFileModels([{ filePath: files.at(-1)!, model: model() }]);
    expect(useProjectStore.getState().parsedFiles.size).toBe(files.length);
    expect(useProjectStore.getState().parsedFiles.get(dialogFile)?.semanticModel).toBe(dialogModel);
    useProjectStore.getState().closeProject();
    expect(useProjectStore.getState().parsedFiles.size).toBe(0);
  });
});
