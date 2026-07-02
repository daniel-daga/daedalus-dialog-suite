/**
 * Issue #114: projectStore.registerTopicInLogFiles writes the TOPIC_/MIS_
 * declarations into the LOG constants file and the B_CloseTopic call into the
 * B_CloseTopics function, then folds the re-parsed models into the merged
 * semantic model.
 */
import { useProjectStore } from '../src/renderer/store/projectStore';

const CONSTANTS_FILE = 'C:/project/Story/Log_Constants_Test.d';
const CLOSE_TOPICS_FILE = 'C:/project/Story/B_CloseTopicsTest.d';

const CONSTANTS_CONTENT = 'const string TOPIC_Old = "Old Quest";\nvar int MIS_Old;\n';
const CLOSE_TOPICS_CONTENT = `FUNC VOID B_CloseTopicsTest()
{
\tB_CloseTopic (TOPIC_Old, MIS_Old, 0, 2);
};
`;

const mockReadFile = jest.spyOn(window.editorAPI, 'readFile');
const mockWriteFile = jest.spyOn(window.editorAPI, 'writeFile');
const mockParseDialogFile = jest.spyOn(window.editorAPI, 'parseDialogFile');

describe('projectStore.registerTopicInLogFiles', () => {
  beforeEach(() => {
    useProjectStore.setState({
      projectPath: 'C:/project',
      parsedFiles: new Map(),
      mergedSemanticModel: {
        dialogs: {}, functions: {}, constants: {}, variables: {},
        instances: {}, items: {}, npcs: {}, animations: {},
        hasErrors: false, errors: []
      } as any
    });

    const files: Record<string, string> = {
      [CONSTANTS_FILE]: CONSTANTS_CONTENT,
      [CLOSE_TOPICS_FILE]: CLOSE_TOPICS_CONTENT
    };
    mockReadFile.mockClear().mockImplementation(async (p: string) => {
      if (files[p] === undefined) throw new Error(`File not found: ${p}`);
      return files[p];
    });
    mockWriteFile.mockClear().mockImplementation(async (p: string, content: string) => {
      files[p] = content;
      return { success: true } as any;
    });
    mockParseDialogFile.mockClear().mockImplementation(async (p: string) => {
      if (p === CONSTANTS_FILE) {
        return {
          dialogs: {}, functions: {},
          constants: { TOPIC_Dalvins: { name: 'TOPIC_Dalvins', type: 'string', value: '"Dalvins Spitzhacken"' } },
          variables: { MIS_Dalvins: { name: 'MIS_Dalvins', type: 'int' } },
          hasErrors: false, errors: []
        } as any;
      }
      return { dialogs: {}, functions: {}, constants: {}, variables: {}, hasErrors: false, errors: [] } as any;
    });
  });

  test('appends declarations and inserts the close call, then merges the models', async () => {
    await useProjectStore.getState().registerTopicInLogFiles({
      topicName: 'TOPIC_Dalvins',
      title: 'Dalvins Spitzhacken',
      chapterStart: 0,
      chapterEnd: 2,
      constantsFilePath: CONSTANTS_FILE,
      closeTopicsFilePath: CLOSE_TOPICS_FILE
    });

    const constantsWrite = mockWriteFile.mock.calls.find(([p]) => p === CONSTANTS_FILE);
    expect(constantsWrite).toBeDefined();
    expect(constantsWrite![1]).toContain('const string TOPIC_Dalvins = "Dalvins Spitzhacken";');
    expect(constantsWrite![1]).toContain('var int MIS_Dalvins;');
    expect(constantsWrite![1]).toContain('TOPIC_Old'); // existing content preserved

    const closeWrite = mockWriteFile.mock.calls.find(([p]) => p === CLOSE_TOPICS_FILE);
    expect(closeWrite).toBeDefined();
    const closeContent = closeWrite![1] as string;
    expect(closeContent).toContain('B_CloseTopic (TOPIC_Dalvins, MIS_Dalvins, 0, 2);');
    // Inserted inside the function: before its closing brace
    expect(closeContent.indexOf('TOPIC_Dalvins')).toBeLessThan(closeContent.lastIndexOf('};'));

    // The merged model picks up the new declarations
    const merged = useProjectStore.getState().mergedSemanticModel;
    expect(merged.constants?.TOPIC_Dalvins).toBeDefined();
    expect(merged.variables?.MIS_Dalvins).toBeDefined();
  });

  test('rejects when the topic is already declared in the constants file', async () => {
    await expect(
      useProjectStore.getState().registerTopicInLogFiles({
        topicName: 'TOPIC_Old',
        title: 'Old Quest',
        chapterStart: 0,
        chapterEnd: 2,
        constantsFilePath: CONSTANTS_FILE,
        closeTopicsFilePath: CLOSE_TOPICS_FILE
      })
    ).rejects.toThrow(/already/i);

    expect(mockWriteFile).not.toHaveBeenCalled();
  });
});
