/**
 * The simulator fed real parser output (unattended-queue row 38).
 *
 * Every other simulator suite hand-builds `DialogFunction`s with clean
 * `conditions` arrays. The two high-severity findings of the simulator review
 * (H1: a raw-mode condition function evaluating crisply true; H2: `!Npc_KnowsInfo`
 * landing un-negated and inverting availability) lived exactly in the gap
 * between that and what `daedalus-parser` actually produces. This suite parses
 * the parser's own corpus fixture `condition-idioms.d` — the three shapes the
 * findings cite — and asserts availability through the simulator domain.
 *
 * The fixture is a roundtrip-corpus file and holds no C_INFO instances, so the
 * instances that point at its condition functions are appended here rather than
 * in the fixture (which would move the corpus baseline).
 * @jest-environment node
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { createSimulatorModel } from '../src/renderer/simulator/domain/model';
import { createSimState } from '../src/renderer/simulator/domain/engine';
import { getDialogAvailability } from '../src/renderer/simulator/domain/dialogAvailability';
import type { SemanticModel } from '../src/shared/types';
import type { SimulatorModel } from '../src/renderer/simulator/domain/types';

const FIXTURE = path.resolve(
  __dirname, '..', '..', 'daedalus-parser', 'test', 'fixtures', 'corpus', 'condition-idioms.d'
);

const INSTANCES = `
instance DIA_Foo (C_INFO) { npc = PC_Hero; nr = 1; condition = DIA_Foo_Condition; information = DIA_Foo_Info; };
instance DIA_Bar (C_INFO) { npc = PC_Hero; nr = 2; condition = DIA_Bar_Condition; information = DIA_Bar_Info; };
instance DIA_Baz (C_INFO) { npc = PC_Hero; nr = 3; condition = DIA_Baz_Condition; information = DIA_Baz_Info; };
`;

/**
 * Parse with the real parser in a child process (the native tree-sitter
 * binding cannot be loaded into more than one Jest module registry per worker;
 * see teacherDialogTemplate.test.ts). The JSON round trip is the same
 * IPC-boundary flattening the renderer's model goes through.
 */
function parseWithRealParser(source: string): { hasErrors: boolean; model: SemanticModel } {
  const parserPath = require.resolve('daedalus-parser');
  const visitorPath = require.resolve('daedalus-parser/semantic-visitor');
  const script = `
    let src = '';
    process.stdin.on('data', (d) => { src += d; });
    process.stdin.on('end', () => {
      const DaedalusParser = require(${JSON.stringify(parserPath)});
      const { SemanticModelBuilderVisitor } = require(${JSON.stringify(visitorPath)});
      const result = new DaedalusParser().parse(src);
      const visitor = new SemanticModelBuilderVisitor();
      visitor.pass1_createObjects(result.tree.rootNode);
      visitor.pass2_analyzeAndLink(result.tree.rootNode);
      process.stdout.write(JSON.stringify({ hasErrors: !!result.hasErrors, model: visitor.semanticModel }));
    });
  `;
  const output = execFileSync(process.execPath, ['-e', script], {
    input: source,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024
  });
  return JSON.parse(output);
}

let model: SimulatorModel;

beforeAll(() => {
  const source = fs.readFileSync(FIXTURE, 'utf8') + INSTANCES;
  const parsed = parseWithRealParser(source);
  expect(parsed.hasErrors).toBe(false);
  model = createSimulatorModel(parsed.model);
});

const availabilityOf = (name: string, knownInfos: string[] = []) => {
  const state = createSimState(model);
  for (const info of knownInfos) state.knownInfos.add(info);
  const result = getDialogAvailability(model, state, 'PC_Hero', false)
    .find((item) => item.entry.name === name);
  if (!result) throw new Error(`${name} is not in the availability list`);
  return result;
};

describe('simulator fed real parser output (condition-idioms.d)', () => {
  test('the parser projects all three fixture dialogs onto their condition functions', () => {
    expect(model.dialogs.map((entry) => entry.conditionFunction)).toEqual([
      'DIA_Foo_Condition', 'DIA_Bar_Condition', 'DIA_Baz_Condition'
    ]);
    expect([...model.functions.keys()]).toEqual(
      expect.arrayContaining(['dia_foo_condition', 'dia_bar_condition', 'dia_baz_condition'])
    );
  });

  // H1: `if (...) { return TRUE; }; return FALSE;` sends the linking visitor to
  // raw mode — conditions cleared, the body kept as actions. Before the fix
  // `combine([], 'AND')` made that crisply true.
  test('H1: a raw-mode condition with a non-trivial return is unknown, not available', () => {
    const rawFunction = model.functions.get('dia_foo_condition');
    expect(rawFunction?.conditions).toEqual([]);
    expect(rawFunction?.actions.length).toBeGreaterThan(0);

    const availability = availabilityOf('DIA_Foo');
    expect(availability.value).toBe('unknown');
    expect(availability.reason).toMatch(/not structurally analyzable/i);
    expect(availability.assumedAvailable).toBe(false);
  });

  test('H1: a raw-mode condition with a local var declaration is unknown, not available', () => {
    const rawFunction = model.functions.get('dia_bar_condition');
    expect(rawFunction?.conditions).toEqual([]);
    expect(rawFunction?.actions.length).toBeGreaterThan(0);

    const availability = availabilityOf('DIA_Bar');
    expect(availability.value).toBe('unknown');
    expect(availability.reason).toMatch(/not structurally analyzable/i);
  });

  // H2: the chain gate `!Npc_KnowsInfo(other, DIA_Foo)` must carry `negated`
  // out of the parser and be honoured by the evaluator — a dropped `!` on
  // either side shows as the two expectations below swapping.
  test('H2: a negated knows-info gate is available on a fresh session and closes once the topic is known', () => {
    const gate = model.functions.get('dia_baz_condition');
    expect(gate?.conditions).toEqual([
      expect.objectContaining({ type: 'NpcKnowsInfoCondition', dialogRef: 'DIA_Foo', negated: true })
    ]);

    expect(availabilityOf('DIA_Baz').value).toBe('true');
    expect(availabilityOf('DIA_Baz', ['dia_foo']).value).toBe('false');
  });
});
