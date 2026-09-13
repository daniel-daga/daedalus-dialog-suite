import { buildProjectView } from '../src/renderer/problems/domain/projectView';
import { runRules } from '../src/renderer/problems/domain/runRules';
import type { FileModel, ScriptLocus } from '../src/renderer/problems/domain/types';
import type { RoutineSite, SemanticModel, SpawnSite } from '../src/shared/types';

/**
 * #267's second half: a semantic problem names a line. Every rule below is fed
 * a model carrying the lines the linking visitor now stamps, and the locus it
 * produces is checked for the line of the construct the message is about — not
 * the file's, and not the enclosing declaration's where a finer one exists.
 */

const lineOf = (locus: ScriptLocus | undefined): number | undefined => locus?.line;

const scriptLocus = (problems: ReturnType<typeof runRules>, rule: string): ScriptLocus | undefined => {
  const problem = problems.find((p) => p.rule === rule);
  return problem && problem.locus.kind === 'script' ? problem.locus : undefined;
};

const emptyModel = (): SemanticModel => ({
  dialogs: {}, functions: {}, instances: {}, npcs: {}, hasErrors: false, errors: []
});

describe('a script problem carries the line of what it is about', () => {
  it('npc-not-found points at the dialog declaration', () => {
    const model = emptyModel();
    model.dialogs.DIA_Ghost = {
      name: 'DIA_Ghost', parent: 'C_INFO', properties: { npc: 'GhostNpc' }, line: 12
    };
    const files: FileModel[] = [{ filePath: 'ghost.d', model }];

    const problems = runRules(buildProjectView({ files, knownNpcNames: [] }));
    expect(lineOf(scriptLocus(problems, 'npc-not-found'))).toBe(12);
  });

  it('orphaned-function and choice-no-clearchoices point at the function declaration', () => {
    const model = emptyModel();
    model.functions.DIA_Test_Info = {
      name: 'DIA_Test_Info',
      returnType: 'VOID',
      line: 40,
      calls: [],
      conditions: [],
      actions: [
        { type: 'Choice', dialogRef: 'DIA_Test', text: 'Go on', targetFunction: 'DIA_Test_Go', line: 42 }
      ]
    };
    const files: FileModel[] = [{ filePath: 'test.d', model }];

    const problems = runRules(buildProjectView({ files, knownNpcNames: [] }));
    expect(lineOf(scriptLocus(problems, 'orphaned-function'))).toBe(40);
    expect(lineOf(scriptLocus(problems, 'choice-no-clearchoices'))).toBe(40);
  });

  it('knowsinfo-dangling points at the condition, not at its function', () => {
    const model = emptyModel();
    model.functions.DIA_Test_Condition = {
      name: 'DIA_Test_Condition',
      returnType: 'INT',
      line: 30,
      calls: [],
      actions: [],
      conditions: [
        { type: 'NpcKnowsInfoCondition', dialogRef: 'DIA_Nowhere', negated: false, line: 33 }
      ]
    };
    const files: FileModel[] = [{ filePath: 'test.d', model }];

    const problems = runRules(buildProjectView({ files, knownNpcNames: [] }));
    expect(lineOf(scriptLocus(problems, 'knowsinfo-dangling'))).toBe(33);
  });

  it('a voice-id finding points at the AI_Output line, not at its function', () => {
    const model = emptyModel();
    model.functions.DIA_Test_Info = {
      name: 'DIA_Test_Info',
      returnType: 'VOID',
      line: 50,
      calls: [],
      conditions: [],
      actions: [
        { type: 'DialogLine', speaker: 'self', listener: 'other', text: 'Hi', id: 'DIA_Test_Hello', line: 52 }
      ]
    };
    const files: FileModel[] = [{ filePath: 'test.d', model }];

    const problems = runRules(buildProjectView({ files, knownNpcNames: [] }));
    expect(lineOf(scriptLocus(problems, 'voice-id-malformed'))).toBe(52);
  });

  it('waypoint-not-in-world points at the call that names the waypoint', () => {
    const problems = runRules(buildProjectView({
      files: [],
      knownNpcNames: [],
      waypointSites: { WP_NOWHERE: [{ filePath: 'rtn.d', functionName: 'RTN_Start_1', line: 77 }] },
      world: { pointNameKeys: new Set(['WP_SOMEWHERE']), freePointNames: [] }
    }));

    expect(lineOf(scriptLocus(problems, 'waypoint-not-in-world'))).toBe(77);
  });

  it('duplicate-spawn points at the spawn call this row is about', () => {
    const spawnSites: SpawnSite[] = [
      { instance: 'VLK_400', spawnPoint: 'WP_A', filePath: 'startup.d', functionName: 'B_Enter', line: 5 },
      { instance: 'VLK_400', spawnPoint: 'WP_B', filePath: 'startup.d', functionName: 'B_Enter', line: 9 }
    ];

    const problems = runRules(buildProjectView({
      files: [], knownNpcNames: [], spawnSites, npcsWithDialogs: ['VLK_400']
    }));

    const lines = problems
      .filter((p) => p.rule === 'duplicate-spawn')
      .map((p) => (p.locus.kind === 'script' ? p.locus.line : undefined));
    expect(lines).toEqual([5, 9]);
  });

  it('routine-overlap points at an entry that is in force over the overlap', () => {
    const routineSites: RoutineSite[] = [
      { routine: 'RTN_START_1', startMinute: 0, endMinute: 0, waypoint: 'WP_A', filePath: 'rtn.d', line: 4 },
      { routine: 'RTN_START_1', startMinute: 480, endMinute: 600, waypoint: 'WP_B', filePath: 'rtn.d', line: 5 }
    ];

    const problems = runRules(buildProjectView({ files: [], knownNpcNames: [], routineSites }));
    expect(lineOf(scriptLocus(problems, 'routine-overlap'))).toBe(4);
  });

  it('carries the real parser\'s lines end to end, not only hand-built ones', async () => {
    // The tests above feed the rules a model written by hand, so they check the
    // rules and not the stamping. This one parses source with the real parser
    // and asserts the lines that come out the far end — which is the whole
    // chain #267 needed: linking visitor → semantic model → file facts → rule.
    const { extractFileMetadataFromSource } = await import('../src/main/utils/semanticMetadataUtils');

    const source = [
      'INSTANCE DIA_Ghost(C_INFO)',          // 1
      '{',                                   // 2
      '\tnpc = SLD_Nobody;',                 // 3
      '\tnr = 1;',                           // 4
      '\tcondition = DIA_Ghost_Condition;',  // 5
      '\tinformation = DIA_Ghost_Info;',     // 6
      '};',                                  // 7
      '',                                    // 8
      'FUNC INT DIA_Ghost_Condition()',      // 9
      '{',                                   // 10
      '\tif (Npc_KnowsInfo(other, DIA_Nowhere))', // 11
      '\t{',                                 // 12
      '\t\treturn TRUE;',                    // 13
      '\t};',                                // 14
      '};',                                  // 15
      '',                                    // 16
      'FUNC VOID DIA_Ghost_Info()',          // 17
      '{',                                   // 18
      '\tAI_Output (self, other, "BadVoiceId");', // 19
      '};'                                   // 20
    ].join('\n');

    const metadata = extractFileMetadataFromSource(source, 'Story/Ghost.d');
    const files: FileModel[] = [{ filePath: 'Story/Ghost.d', model: metadata.semanticModel! }];
    const problems = runRules(buildProjectView({ files, knownNpcNames: [] }));

    expect(lineOf(scriptLocus(problems, 'npc-not-found'))).toBe(1);
    expect(lineOf(scriptLocus(problems, 'knowsinfo-dangling'))).toBe(11);
    expect(lineOf(scriptLocus(problems, 'voice-id-malformed'))).toBe(19);
  });
});
