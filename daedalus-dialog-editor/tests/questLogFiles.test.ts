/**
 * Issue #114: "Create Topic" can register the quest in the project's log
 * files — the TOPIC_/MIS_ declarations in the LOG constants file and a
 * B_CloseTopic call inside the B_CloseTopics function.
 * @jest-environment node
 */
import {
  insertIntoCloseTopicsFunction,
  suggestTopicConstantFiles,
  suggestCloseTopicsFiles,
  buildTopicDeclarationBlock,
  buildCloseTopicLine
} from '../src/renderer/utils/questLogFiles';

const CLOSE_TOPICS_FILE = `// Close topics for the mod
FUNC VOID B_CloseTopicsBeppo()
{
\tB_CloseTopic (TOPIC_Old, MIS_Old, 0, 2);

\tif (Kapitel > 1)
\t{
\t\tB_CloseTopic (TOPIC_Older, MIS_Older, 0, 1);
\t};
};

FUNC VOID SomethingElse()
{
\treturn;
};
`;

describe('insertIntoCloseTopicsFunction', () => {
  test('inserts the call before the closing brace of the B_CloseTopics function', () => {
    const line = '\tB_CloseTopic (TOPIC_DalvinsSpitzhacken, MIS_DalvinsSpitzhacken, 0, 2);';
    const result = insertIntoCloseTopicsFunction(CLOSE_TOPICS_FILE, line);

    // The new call lands inside B_CloseTopicsBeppo, after the existing body
    const fnStart = result.indexOf('FUNC VOID B_CloseTopicsBeppo()');
    const fnEnd = result.indexOf('FUNC VOID SomethingElse()');
    const inserted = result.indexOf('TOPIC_DalvinsSpitzhacken');
    expect(inserted).toBeGreaterThan(fnStart);
    expect(inserted).toBeLessThan(fnEnd);

    // Nested if-block stays intact and the new line comes after it
    expect(inserted).toBeGreaterThan(result.indexOf('TOPIC_Older'));

    // The rest of the file is untouched
    expect(result).toContain('FUNC VOID SomethingElse()');
    expect(result).toContain('B_CloseTopic (TOPIC_Old, MIS_Old, 0, 2);');
  });

  test('throws when the file has no B_CloseTopics function', () => {
    expect(() =>
      insertIntoCloseTopicsFunction('FUNC VOID Unrelated() { return; };', 'B_CloseTopic (TOPIC_X, MIS_X, 0, 2);')
    ).toThrow(/B_CloseTopics/);
  });

  test('handles a closing brace that shares its line with body content', () => {
    const oneLine = 'FUNC VOID B_CloseTopics() { };\n';
    const line = '\tB_CloseTopic (TOPIC_X, MIS_X, 0, 2);';
    const result = insertIntoCloseTopicsFunction(oneLine, line);

    // The call must land inside the braces, not above the function
    const inserted = result.indexOf('TOPIC_X');
    expect(inserted).toBeGreaterThan(result.indexOf('{'));
    expect(inserted).toBeLessThan(result.indexOf('}'));
  });

  test('ignores braces inside string literals and comments', () => {
    const content = `FUNC VOID B_CloseTopics()
{
\tPrintDebug ("closing }");
\t// } end marker
\tB_CloseTopic (TOPIC_Old, MIS_Old, 0, 2);
};
`;
    const line = '\tB_CloseTopic (TOPIC_New, MIS_New, 0, 2);';
    const result = insertIntoCloseTopicsFunction(content, line);

    const inserted = result.indexOf('TOPIC_New');
    expect(inserted).toBeGreaterThan(result.indexOf('TOPIC_Old'));
    expect(inserted).toBeLessThan(result.indexOf('};'));
  });
});

describe('declaration builders', () => {
  test('buildTopicDeclarationBlock emits the TOPIC_ constant and MIS_ variable', () => {
    const block = buildTopicDeclarationBlock('TOPIC_DalvinsSpitzhacken', 'Dalvins Spitzhacken');
    expect(block).toContain('const string TOPIC_DalvinsSpitzhacken = "Dalvins Spitzhacken";');
    expect(block).toContain('var int MIS_DalvinsSpitzhacken;');
  });

  test('quotes and newlines in the title cannot break the generated literal', () => {
    // Daedalus string literals have no escape sequences: a raw quote would
    // terminate the literal and corrupt the constants file.
    const block = buildTopicDeclarationBlock('TOPIC_X', 'Der "Boss"\nQuest');
    expect(block).toContain("const string TOPIC_X = \"Der 'Boss' Quest\";");
    expect(block).toContain("// Quest: Der 'Boss' Quest");
  });

  test('buildCloseTopicLine emits the chapter-gated close call', () => {
    expect(buildCloseTopicLine('TOPIC_DalvinsSpitzhacken', 0, 2)).toBe(
      '\tB_CloseTopic (TOPIC_DalvinsSpitzhacken, MIS_DalvinsSpitzhacken, 0, 2);'
    );
  });
});

describe('file suggestions', () => {
  test('suggestTopicConstantFiles ranks files by TOPIC_ constant count', () => {
    const model: any = {
      constants: {
        TOPIC_A: { name: 'TOPIC_A', filePath: 'C:/p/Log_Constants.d' },
        TOPIC_B: { name: 'TOPIC_B', filePath: 'C:/p/Log_Constants.d' },
        TOPIC_C: { name: 'TOPIC_C', filePath: 'C:/p/Other.d' },
        NOT_TOPIC: { name: 'NOT_TOPIC', filePath: 'C:/p/Misc.d' }
      }
    };
    expect(suggestTopicConstantFiles(model)).toEqual(['C:/p/Log_Constants.d', 'C:/p/Other.d']);
  });

  test('suggestCloseTopicsFiles finds files with a B_CloseTopics function or B_CloseTopic calls', () => {
    const parsedFiles = new Map<string, any>([
      ['C:/p/B_CloseTopicsBeppo.d', {
        filePath: 'C:/p/B_CloseTopicsBeppo.d',
        semanticModel: { functions: { B_CloseTopicsBeppo: { name: 'B_CloseTopicsBeppo', calls: ['B_CloseTopic'] } } }
      }],
      ['C:/p/Story.d', {
        filePath: 'C:/p/Story.d',
        semanticModel: { functions: { SomeFunc: { name: 'SomeFunc', calls: ['AI_Output'] } } }
      }]
    ]);
    expect(suggestCloseTopicsFiles(parsedFiles)).toEqual(['C:/p/B_CloseTopicsBeppo.d']);
  });
});
