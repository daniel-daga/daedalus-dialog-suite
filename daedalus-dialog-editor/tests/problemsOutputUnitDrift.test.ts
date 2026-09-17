/**
 * `output-unit-stale` / `output-unit-missing`: the scripts against the
 * OutputUnit database the game actually reads (#264).
 *
 * The trap this exists for is the one the Spacer report calls the worst of it:
 * reparsing scripts does not regenerate `OU.BIN`, so a line written here
 * compiles cleanly and then shows the *old* subtitle in game — and our own GMBT
 * quick test passes `--noupdatesubtitles`, which makes it sharper. Nothing in
 * the tree could notice that before this rule.
 *
 * The rule is a check, not a fix: #264's cut is check first, generate after.
 */

import { outputUnitDriftRule } from '../src/renderer/problems/domain/rules/outputUnitDrift';
import { buildProjectView } from '../src/renderer/problems/domain/projectView';
import type { Problem } from '../src/renderer/problems/domain/types';
import type { SemanticModel } from '../src/shared/types';

/** One dialog function holding the given `AI_Output` lines. */
const modelWith = (lines: Array<{ id: string; text: string }>): SemanticModel => ({
  dialogs: {},
  functions: {
    DIA_TEST_INFO: {
      name: 'DIA_TEST_INFO',
      actions: lines.map(({ id, text }, index) => ({
        type: 'DialogLine',
        speaker: 'self',
        listener: 'other',
        text,
        id,
        line: index + 1,
      })),
      conditions: [],
      calls: [],
    },
  },
} as unknown as SemanticModel);

const viewOf = (
  lines: Array<{ id: string; text: string }>,
  outputUnits?: Array<{ name: string; text: string; wav: string }>,
) =>
  buildProjectView({
    files: [{ filePath: 'DIA_Test.d', model: modelWith(lines) }],
    knownNpcNames: [],
    outputUnits,
  });

const messages = (problems: Problem[]) => problems.map((p) => p.message);

describe('outputUnitDriftRule', () => {
  it('says nothing when no OU database is loaded', () => {
    // An empty index means "nothing is known", never "nothing is legal" — a
    // project may legitimately be open with no Gothic install behind it.
    const view = viewOf([{ id: 'DIA_TEST_15_00', text: 'Was willst du?' }]);

    expect(outputUnitDriftRule(view)).toEqual([]);
  });

  it('says nothing when every line matches the database', () => {
    const view = viewOf(
      [{ id: 'DIA_TEST_15_00', text: 'Was willst du?' }],
      [{ name: 'DIA_TEST_15_00', text: 'Was willst du?', wav: 'DIA_TEST_15_00.WAV' }],
    );

    expect(outputUnitDriftRule(view)).toEqual([]);
  });

  it('flags a line whose subtitle the database still holds the old text for', () => {
    const view = viewOf(
      [{ id: 'DIA_TEST_15_00', text: 'Was willst du denn?' }],
      [{ name: 'DIA_TEST_15_00', text: 'Was willst du?', wav: 'DIA_TEST_15_00.WAV' }],
    );

    const problems = outputUnitDriftRule(view);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({
      rule: 'output-unit-stale',
      severity: 'warning',
      locus: { kind: 'script', filePath: 'DIA_Test.d', functionName: 'DIA_TEST_INFO', line: 1 },
    });
    // Both texts, because which one the game shows is the whole point.
    expect(problems[0].message).toContain('Was willst du denn?');
    expect(problems[0].message).toContain('Was willst du?');
  });

  it('flags a line the database has never heard of', () => {
    const view = viewOf(
      [{ id: 'DIA_TEST_15_01', text: 'Neu.' }],
      [{ name: 'DIA_TEST_15_00', text: 'Alt.', wav: 'DIA_TEST_15_00.WAV' }],
    );

    const problems = outputUnitDriftRule(view);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ rule: 'output-unit-missing', severity: 'warning' });
    expect(problems[0].message).toContain('DIA_TEST_15_01');
  });

  it('matches ids case-insensitively, the way the engine does', () => {
    // Daedalus is case-insensitive and the OU writer upper-cases; a rule that
    // compared verbatim would report every line of a normal project as missing.
    const view = viewOf(
      [{ id: 'DIA_Test_15_00', text: 'Gleich.' }],
      [{ name: 'DIA_TEST_15_00', text: 'Gleich.', wav: 'DIA_TEST_15_00.WAV' }],
    );

    expect(outputUnitDriftRule(view)).toEqual([]);
  });

  it('compares subtitle text verbatim, including case and trailing space', () => {
    // The opposite of the id rule above, and deliberate: the subtitle is what
    // the player reads, so a changed capital is a real edit the OU has missed.
    const view = viewOf(
      [{ id: 'DIA_TEST_15_00', text: 'Ja.' }],
      [{ name: 'DIA_TEST_15_00', text: 'ja.', wav: 'DIA_TEST_15_00.WAV' }],
    );

    expect(outputUnitDriftRule(view)).toHaveLength(1);
  });

  it('reports one problem per line, each at its own line number', () => {
    const view = viewOf(
      [
        { id: 'DIA_TEST_15_00', text: 'Eins.' },
        { id: 'DIA_TEST_15_01', text: 'Zwei.' },
      ],
      [
        { name: 'DIA_TEST_15_00', text: 'Alt eins.', wav: 'DIA_TEST_15_00.WAV' },
        { name: 'DIA_TEST_15_01', text: 'Alt zwei.', wav: 'DIA_TEST_15_01.WAV' },
      ],
    );

    const problems = outputUnitDriftRule(view);

    expect(problems).toHaveLength(2);
    expect(problems.map((p) => (p.locus.kind === 'script' ? p.locus.line : undefined))).toEqual([1, 2]);
    expect(new Set(problems.map((p) => p.id)).size).toBe(2);
    expect(messages(problems).join(' ')).toContain('Eins.');
  });

  it('ignores an entry the database holds that no script line claims', () => {
    // A retail OU carries every vanilla line; a mod project holds a handful.
    // Reporting the rest as orphans would bury the two findings that matter.
    const view = viewOf(
      [{ id: 'DIA_TEST_15_00', text: 'Eins.' }],
      [
        { name: 'DIA_TEST_15_00', text: 'Eins.', wav: 'DIA_TEST_15_00.WAV' },
        { name: 'DIA_VANILLA_15_00', text: 'Etwas anderes.', wav: 'DIA_VANILLA_15_00.WAV' },
      ],
    );

    expect(outputUnitDriftRule(view)).toEqual([]);
  });
});
