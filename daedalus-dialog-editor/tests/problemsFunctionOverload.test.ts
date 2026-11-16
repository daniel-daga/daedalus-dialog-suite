/**
 * #567: an additional function overload stays a `raw` declaration (#557), so
 * nothing of it is editable — but its body still runs. The project index reads
 * its calls under the first signature's name, and Problems names the overload
 * as a hint so an accidental redeclaration with a changed parameter list is
 * visible without blocking a save.
 */

import { buildProjectView } from '../src/renderer/problems/domain/projectView';
import { functionOverloadRule } from '../src/renderer/problems/domain/rules/functionOverload';
import { scanProject } from '../src/renderer/problems/application/scanProject';
import {
  buildRoutineParamIndex,
  extractFileMetadataFromSource,
  extractRoutineSites,
  extractSpawnSites,
  extractWaypointSites,
} from '../src/main/utils/semanticMetadataUtils';
import { withoutCallSites } from '../src/main/utils/withoutCallSites';
import type { SemanticModel } from '../src/shared/types';

const SOURCE = [
  'func void B_Foo()',
  '{',
  '\tAI_Output (self, other, "DIA_Foo_15_00"); //First',
  '};',
  '',
  'func void B_Foo(var int stop_h)',
  '{',
  '\tAI_Output (self, other, "DIA_Foo_15_01"); //Second',
  '\tWld_InsertNpc (Wolf, "WP_FOREST");',
  '\tTA_Min (self, 8, 0, 20, 0, ZS_Sleep, "WP_BED");',
  '};',
  '',
].join('\n');

const FILE = '/project/Story/B_Foo.d';

describe('a raw overload body in the project index (#567)', () => {
  const metadata = extractFileMetadataFromSource(SOURCE, FILE);
  const semanticModel = metadata.semanticModel!;
  const fileModels = [{ filePath: FILE, semanticModel }];

  it('parses clean and projects only the first signature', () => {
    expect(semanticModel.hasErrors).toBeFalsy();
    expect(Object.keys(semanticModel.functions)).toEqual(['B_Foo']);
    expect(semanticModel.functions.B_Foo.actions).toHaveLength(1);
  });

  it('indexes the overload body\'s spawn, routine and waypoint sites on their own lines', () => {
    expect(extractSpawnSites(fileModels)).toEqual([
      { instance: 'WOLF', spawnPoint: 'WP_FOREST', filePath: FILE, functionName: 'B_Foo', line: 9 },
    ]);
    expect(extractRoutineSites(fileModels)).toMatchObject([
      { routine: 'B_FOO', waypoint: 'WP_BED', filePath: FILE, line: 10 },
    ]);
    expect(extractWaypointSites(fileModels).WP_BED).toEqual([{ filePath: FILE, functionName: 'B_Foo', line: 10 }]);
  });

  it('indexes the overload body\'s voice ids', () => {
    expect(metadata.voiceIds).toEqual([
      { id: 'DIA_Foo_15_00', functionName: 'B_Foo', line: 3 },
      { id: 'DIA_Foo_15_01', functionName: 'B_Foo', line: 8 },
    ]);
  });

  it('does not read an overload\'s arguments against the first signature\'s parameters', () => {
    // The overload passes its own parameters through. Read against the first
    // signature — the only one the name resolves to — the same names sit at
    // other positions: a layout neither declaration has.
    const source = [
      'func void TA_Wrap(var string wp, var int start_h, var int stop_h) {};',
      'func void TA_Wrap(var int start_h, var int stop_h, var string wp, var int extra) {',
      '\tTA_Min(self, start_h, 0, stop_h, 0, ZS_Sleep, wp);',
      '};',
    ].join('\n');
    const model = extractFileMetadataFromSource(source, FILE).semanticModel!;
    expect(buildRoutineParamIndex([{ semanticModel: model }]).ta_wrap).toBeUndefined();
  });
});

describe('function-overload rule (#567)', () => {
  const model = withoutCallSites(extractFileMetadataFromSource(SOURCE, FILE).semanticModel!) as SemanticModel;

  it('names an overload as a hint at its own line', () => {
    const problems = functionOverloadRule(buildProjectView({ files: [{ filePath: FILE, model }], knownNpcNames: [] }));
    expect(problems).toEqual([
      expect.objectContaining({
        rule: 'function-overload',
        severity: 'hint',
        locus: { kind: 'script', filePath: FILE, functionName: 'B_Foo', line: 6 },
      }),
    ]);
    expect(problems[0].message).toContain('B_Foo');
  });

  it('runs in a project scan and is never an error', () => {
    const { problems } = scanProject({ files: [{ filePath: FILE, model }], knownNpcNames: [] });
    const found = problems.filter((problem) => problem.rule === 'function-overload');
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe('hint');
  });

  it('says nothing about an extension block or a file outside the scan', () => {
    const extension = extractFileMetadataFromSource('func void A() {};\nMETA { Parser = Game; };', FILE).semanticModel!;
    expect(functionOverloadRule(buildProjectView({
      files: [{ filePath: FILE, model: extension as SemanticModel }], knownNpcNames: [],
    }))).toEqual([]);
    // Engine reference stubs (`Externals.d`) are outside the project's `.src`
    // lists, so they are never among the scanned files (#559).
    expect(functionOverloadRule(buildProjectView({ files: [], knownNpcNames: [] }))).toEqual([]);
  });
});

describe('renderer rules read a raw overload body (#574)', () => {
  // Every finding below is in the overload, on its own line, and named by the
  // function the overload shares a name with — never merged into the first.
  const source = [
    'instance DIA_Foo (C_INFO) { npc = Npc_Foo; information = DIA_Foo_Info; };',
    'func void DIA_Foo_Info()',
    '{',
    '\tAI_Output (self, other, "DIA_Foo_15_00"); //First',
    '};',
    '',
    'func void DIA_Foo_Info(var int x)',
    '{',
    '\tAI_Output (self, other, "DIA_Foo_15_00"); //First',
    '\tAI_Output (self, other, "Malformed"); //Odd',
    '\tif (Npc_KnowsInfo (other, DIA_Missing)) { B_Say (self, other, "$X"); };',
    '\tInfo_AddChoice (DIA_Foo, "Go", DIA_Foo_Go);',
    '};',
    'func void DIA_Foo_Go() {};',
    '',
  ].join('\n');
  const model = withoutCallSites(extractFileMetadataFromSource(source, FILE).semanticModel!) as SemanticModel;
  const scan = (outputUnits?: { name: string; text: string; wav: string }[]) =>
    scanProject({ files: [{ filePath: FILE, model }], knownNpcNames: ['Npc_Foo'], outputUnits }).problems;
  const byRule = (problems: ReturnType<typeof scan>, rule: string) =>
    problems.filter((problem) => problem.rule === rule);
  const at = (line: number) => ({ kind: 'script', filePath: FILE, functionName: 'DIA_Foo_Info', line });
  const loci = (problems: ReturnType<typeof scan>) =>
    problems.map(({ locus }) => (locus.kind === 'script'
      ? { kind: locus.kind, filePath: locus.filePath, functionName: locus.functionName, line: locus.line }
      : locus));

  it('crosses the IPC boundary with the projection and without merging it', () => {
    expect(model.functions.DIA_Foo_Info.actions).toHaveLength(1);
    const raw = model.declarationOrder!.find((entry) => entry.overloadOf === 'DIA_Foo_Info');
    expect(raw?.overloadBody?.actions.map((action) => action.type))
      .toEqual(['DialogLine', 'DialogLine', 'ConditionalAction', 'Choice']);
  });

  it('sees a duplicate and a malformed voice id in the overload', () => {
    const problems = scan();
    const duplicates = byRule(problems, 'voice-id-duplicate');
    expect(loci(duplicates)).toEqual([at(4), at(9)]);
    expect(new Set(duplicates.map((problem) => problem.id)).size).toBe(2);
    expect(loci(byRule(problems, 'voice-id-malformed'))).toEqual([at(10)]);
  });

  it('sees an overload\'s lines against the OutputUnit database', () => {
    const problems = scan([{ name: 'DIA_FOO_15_00', text: 'First', wav: '' }]);
    expect(byRule(problems, 'output-unit-missing').map((problem) => problem.locus.kind === 'script' && problem.locus.line))
      .toEqual([10]);
  });

  it('sees a dangling KnowsInfo and an uncleared choice in the overload', () => {
    const problems = scan();
    expect(loci(byRule(problems, 'knowsinfo-dangling'))).toEqual([at(11)]);
    expect(loci(byRule(problems, 'choice-no-clearchoices'))).toEqual([at(7)]);
  });
});
