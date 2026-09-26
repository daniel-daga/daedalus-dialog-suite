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

import {
  outputUnitAgreement,
  looksLikeAnotherLanguage,
  outputUnitDriftRule,
} from '../src/renderer/problems/domain/rules/outputUnitDrift';
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

  it('does not count whitespace at the ends of the comment as an edit', () => {
    // The retail OU holds its lines trimmed while 65 retail MDK scripts carry
    // `// Text. ` — every one of them read as stale against the real OU.BIN.
    const view = viewOf(
      [{ id: 'DIA_TEST_15_00', text: 'Was willst du? ' }],
      [{ name: 'DIA_TEST_15_00', text: 'Was willst du?', wav: 'DIA_TEST_15_00.WAV' }],
    );

    expect(outputUnitDriftRule(view)).toEqual([]);
    expect(outputUnitAgreement(view)).toEqual({ compared: 1, stale: 0 });
  });

  it('asks for the trimmed line to be written, as the OU tools write it', () => {
    const view = viewOf(
      [{ id: 'DIA_TEST_15_00', text: 'Was willst du denn? ' }],
      [{ name: 'DIA_TEST_15_00', text: 'Was willst du?', wav: 'DIA_TEST_15_00.WAV' }],
    );

    expect(outputUnitDriftRule(view).map((p) => p.outputUnitLine)).toEqual([
      { name: 'DIA_TEST_15_00', text: 'Was willst du denn?' },
    ]);
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

  // The fix half of #264: each finding carries the line the database should
  // hold, which is what "Update OUs" writes — the script's text, never the OU's.
  it('carries the line to write: the script\'s id and its text', () => {
    const view = viewOf(
      [{ id: 'DIA_TEST_15_00', text: 'Neu.' }, { id: 'DIA_TEST_15_01', text: 'Dazu.' }],
      [{ name: 'DIA_TEST_15_00', text: 'Alt.', wav: 'DIA_TEST_15_00.WAV' }],
    );
    expect(outputUnitDriftRule(view).map((p) => p.outputUnitLine)).toEqual([
      { name: 'DIA_TEST_15_00', text: 'Neu.' },
      { name: 'DIA_TEST_15_01', text: 'Dazu.' },
    ]);
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

// #265: German MDK scripts over an English OU. Every line then reads as stale,
// which is true line by line and wrong as a diagnosis — and "Update OUs" would
// do exactly what the report complains of, overwrite the English with German.
// So the panel is told when the disagreement is too wide to be edits.
describe('a database in another language than the scripts', () => {
  const lines = (n: number, text: (i: number) => string) =>
    Array.from({ length: n }, (_, i) => ({ id: `DIA_T_15_${String(i).padStart(2, '0')}`, text: text(i) }));
  const units = (n: number, text: (i: number) => string) =>
    lines(n, text).map(({ id, text: t }) => ({ name: id, text: t, wav: `${id}.WAV` }));

  it('counts the lines both hold, and how many of those disagree — a missing line is neither', () => {
    const view = viewOf(
      [...lines(3, (i) => `Satz ${i}.`), { id: 'DIA_NEW_00', text: 'Neu.' }],
      units(3, (i) => (i === 0 ? 'Sentence 0.' : `Satz ${i}.`)),
    );
    expect(outputUnitAgreement(view)).toEqual({ compared: 3, stale: 1 });
  });

  it('is nothing to count without a database', () => {
    expect(outputUnitAgreement(viewOf(lines(3, () => 'x')))).toBeNull();
  });

  it('calls it another language when most of many shared lines disagree', () => {
    expect(looksLikeAnotherLanguage({ compared: 40, stale: 38 })).toBe(true);
    expect(looksLikeAnotherLanguage({ compared: 40, stale: 20 })).toBe(true);
  });

  it('does not for an edit session, however busy, nor for a handful of lines', () => {
    expect(looksLikeAnotherLanguage({ compared: 400, stale: 60 })).toBe(false);
    expect(looksLikeAnotherLanguage({ compared: 5, stale: 5 })).toBe(false);
  });
});

