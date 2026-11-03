/**
 * #491: the implicit-quest upgrade is a declaration plus per-file assignments,
 * each its own disk write. The declaration must be the last write, so a refused
 * assignment leaves the quest exactly as it was — no `MIS_` on disk, the banner
 * still offered — and a retry finishes the job instead of declaring it twice.
 *
 * The stores and the save are real; only the IPC boundary is faked, on an
 * in-memory disk, and every parse goes through the real parser.
 */
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { execFileSync } from 'child_process';
import { useEditorStore } from '../src/renderer/store/editorStore';
import { useHistoryStore } from '../src/renderer/store/historyStore';
import { useProjectStore } from '../src/renderer/store/projectStore';
import { upgradeImplicitQuest } from '../src/renderer/components/questDiarySave';
import { analyzeQuest } from '../src/renderer/quest/domain/analysis';
import type { QuestDiaryItem } from '../src/renderer/quest/domain/questDiary';
import type { SemanticModel } from '../src/renderer/types/global';

const QUESTS = 'Quests.d';
const START = 'DIA_Smith_Start.d';
const DONE = 'DIA_Smith_Done.d';

const questsSource = 'const string TOPIC_Sword = "The sword";\n';

const startSource = `func void DIA_Smith_Start_Info ()
{
	Log_CreateTopic (TOPIC_Sword, LOG_MISSION);
	Log_SetTopicStatus (TOPIC_Sword, LOG_RUNNING);
};
`;

const doneSource = `func void DIA_Smith_Done_Info ()
{
	Log_SetTopicStatus (TOPIC_Sword, LOG_SUCCESS);
};
`;

const diary: QuestDiaryItem[] = [
  { kind: 'state', functionName: 'DIA_Smith_Start_Info', filePath: START, path: [], state: 'running' },
  { kind: 'state', functionName: 'DIA_Smith_Done_Info', filePath: DONE, path: [], state: 'success' }
];

// The real parser, out of process — the same reader questDiary.test.ts uses.
const parseModel = (source: string): SemanticModel => {
  const script = `
    let src = '';
    process.stdin.on('data', (d) => { src += d; });
    process.stdin.on('end', () => {
      const DaedalusParser = require(${JSON.stringify(require.resolve('daedalus-parser'))});
      const { SemanticModelBuilderVisitor } = require(${JSON.stringify(require.resolve('daedalus-parser/semantic-visitor'))});
      const result = new DaedalusParser().parse(src);
      const visitor = new SemanticModelBuilderVisitor();
      visitor.pass1_createObjects(result.tree.rootNode);
      visitor.pass2_analyzeAndLink(result.tree.rootNode);
      const m = visitor.semanticModel;
      process.stdout.write(JSON.stringify({
        dialogs: m.dialogs, functions: m.functions, constants: m.constants,
        variables: m.variables, instances: m.instances, hasErrors: m.hasErrors, errors: m.errors
      }));
    });
  `;
  return JSON.parse(execFileSync(process.execPath, ['-e', script], {
    input: source,
    encoding: 'latin1',
    maxBuffer: 16 * 1024 * 1024
  }));
};

let files: Map<string, string>;
let saved: Array<{ filePath: string; model: SemanticModel }>;
/** `DONE` is a file that moves on disk, until a test lets the save through. */
let doneIsStale: boolean;

const disk = (filePath: string) => files.get(filePath) ?? '';
const declarationCount = () => (disk(QUESTS).match(/var\s+int\s+MIS_Sword\b/gi) ?? []).length;

/** The banner's condition: QuestDetails offers the upgrade while this is false. */
const upgradeStillOffered = async () => {
  const model = await useProjectStore.getState().getSemanticModel(QUESTS);
  return !analyzeQuest(model, 'TOPIC_Sword').misVariableExists;
};

const setsMisSword = (model: SemanticModel) =>
  Object.values(model.functions).some((fn) => JSON.stringify(fn.actions ?? []).includes('"MIS_Sword"'));

const refusal = {
  success: false,
  validationResult: {
    isValid: false,
    errors: [{ type: 'syntax_error', message: 'changed on disk' }],
    warnings: []
  }
} as never;

beforeEach(() => {
  files = new Map([[QUESTS, questsSource], [START, startSource], [DONE, doneSource]]);
  saved = [];
  doneIsStale = false;

  jest.spyOn(window.editorAPI, 'readFile').mockImplementation(async (filePath) => disk(filePath));
  jest.spyOn(window.editorAPI, 'readFileVersioned').mockImplementation(async (filePath) => ({
    content: disk(filePath),
    version: `v:${disk(filePath).length}`
  }));
  jest.spyOn(window.editorAPI, 'writeFile').mockImplementation(async (filePath, content) => {
    files.set(filePath, content);
    return { success: true, version: `v:${content.length}` };
  });
  jest.spyOn(window.editorAPI, 'parseSource').mockImplementation(async (source) => parseModel(source));
  jest.spyOn(window.editorAPI, 'parseDialogFile').mockImplementation(async (filePath) => parseModel(disk(filePath)));

  useEditorStore.setState({ openFiles: new Map(), activeFile: null } as never);
  useHistoryStore.setState({ editHistory: new Map() } as never);
  useProjectStore.setState({
    parsedFiles: new Map(),
    mergedSemanticModel: { dialogs: {}, functions: {}, constants: {}, variables: {} },
    isLoading: false
  } as never);

  // Each save records the model it would have written, and `DONE` is a file
  // that moved on disk: the per-file assignment save the upgrade must survive.
  const saveFile = jest.spyOn(useEditorStore.getState(), 'saveFile')
    .mockImplementation(async (filePath: string) => {
      if (filePath === DONE && doneIsStale) return refusal;
      saved.push({ filePath, model: useEditorStore.getState().getFileState(filePath)!.semanticModel });
      return { success: true } as never;
    });
  saveFile.mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('upgradeImplicitQuest', () => {
  test('leaves the quest exactly as it was when a later assignment save is refused', async () => {
    doneIsStale = true;

    await expect(upgradeImplicitQuest('TOPIC_Sword', diary, QUESTS)).rejects.toThrow('Save refused');

    expect(declarationCount()).toBe(0);
    expect(await upgradeStillOffered()).toBe(true);
  });

  test('writes the declaration beside the quest and the assignments in one pass', async () => {
    await upgradeImplicitQuest('TOPIC_Sword', diary, QUESTS);

    expect(declarationCount()).toBe(1);
    expect(await upgradeStillOffered()).toBe(false);
    expect(saved.map((entry) => entry.filePath).sort()).toEqual([DONE, START]);
    expect(saved.every((entry) => setsMisSword(entry.model))).toBe(true);
  });

  test('a retry after a refusal declares the variable once, not twice', async () => {
    doneIsStale = true;
    await expect(upgradeImplicitQuest('TOPIC_Sword', diary, QUESTS)).rejects.toThrow('Save refused');

    doneIsStale = false;
    await upgradeImplicitQuest('TOPIC_Sword', diary, QUESTS);

    expect(declarationCount()).toBe(1);
    expect(await upgradeStillOffered()).toBe(false);
  });
});
