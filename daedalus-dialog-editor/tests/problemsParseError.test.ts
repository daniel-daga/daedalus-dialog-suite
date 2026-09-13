/**
 * `parse-error`: the per-file syntax errors the whole-project index pass
 * already finds, in the Problems panel (#267, first half).
 *
 * The input is `ProjectIndex.parseErrors`, not the parsed files, for the reason
 * the waypoint and spawn rules take theirs off the index: `parsedFiles` holds
 * only what has been opened, and the defect this closes is precisely "a project
 * with a broken file nobody has opened looks clean". The metadata pass drops a
 * model that failed to parse, so before this the errors it found were computed
 * and thrown away.
 */

import { parseErrorRule } from '../src/renderer/problems/domain/rules/parseError';
import { buildProjectView } from '../src/renderer/problems/domain/projectView';
import { useProblemsStore } from '../src/renderer/store/problemsStore';
import { useProjectStore } from '../src/renderer/store/projectStore';
import type { FileParseErrors } from '../src/shared/types';
import type { Problem } from '../src/renderer/problems/domain/types';

const lineOf = (problem: Problem): number | undefined =>
  (problem.locus.kind === 'script' ? problem.locus.line : undefined);

const filePathOf = (problem: Problem): string | undefined =>
  (problem.locus.kind === 'script' ? problem.locus.filePath : undefined);

const broken = (
  filePath: string,
  errors: FileParseErrors['errors'],
  total = errors.length
): FileParseErrors => ({ filePath, errors, total });

const viewOf = (parseErrors: FileParseErrors[]) =>
  buildProjectView({ files: [], knownNpcNames: [], parseErrors });

describe('parseErrorRule', () => {
  it('reports one error problem per syntax error, carrying its line', () => {
    const view = viewOf([
      broken('DIA_Farim.d', [
        { type: 'syntax_error', message: 'Syntax error at line 12, column 5', line: 12, column: 5, text: 'npc == SLD' },
        { type: 'missing_token', message: 'Missing ; at line 19, column 1', line: 19, column: 1, text: '' }
      ])
    ]);

    const problems = parseErrorRule(view);

    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatchObject({
      rule: 'parse-error',
      severity: 'error',
      locus: { kind: 'script', filePath: 'DIA_Farim.d', line: 12 }
    });
    expect(problems[0].message).toContain('Syntax error at line 12, column 5');
    // The offending source is what tells one syntax error from the next.
    expect(problems[0].message).toContain('npc == SLD');
    expect(problems[1].message).toBe('Missing ; at line 19, column 1');
    expect(lineOf(problems[1])).toBe(19);
    expect(new Set(problems.map((problem) => problem.id)).size).toBe(2);
  });

  it('names the files the index found, whether or not they were ever opened', () => {
    const view = viewOf([
      broken('A.d', [{ type: 'syntax_error', message: 'a', line: 1, column: 1, text: '' }]),
      broken('B.d', [{ type: 'syntax_error', message: 'b', line: 2, column: 1, text: '' }])
    ]);
    expect(parseErrorRule(view).map(filePathOf)).toEqual(['A.d', 'B.d']);
  });

  it('adds one row for the errors a file has beyond the carried cap', () => {
    // A junk or mis-encoded file can produce thousands of ERROR nodes, and the
    // list is not virtualized. The index caps what it carries; the count it
    // also carries is what keeps the panel honest about the rest.
    const view = viewOf([
      broken(
        'Junk.d',
        [{ type: 'syntax_error', message: 'Syntax error at line 1, column 1', line: 1, column: 1, text: '' }],
        4321
      )
    ]);

    const problems = parseErrorRule(view);
    expect(problems).toHaveLength(2);
    expect(problems[1].message).toContain('4320 more');
    expect(problems[1].locus).toEqual({ kind: 'script', filePath: 'Junk.d' });
  });

  it('says nothing when the index holds no parse errors', () => {
    expect(parseErrorRule(viewOf([]))).toEqual([]);
  });
});

describe('the Problems scan over the parse-error index', () => {
  beforeEach(() => {
    useProblemsStore.getState().clear();
    useProjectStore.setState({
      parsedFiles: new Map(),
      npcList: [],
      npcPrototypes: [],
      allDialogFiles: [],
      waypointSiteIndex: {},
      spawnSiteIndex: [],
      parseErrorIndex: [],
      dialogIndex: new Map()
    });
  });

  it('surfaces a broken file that was never opened', () => {
    useProjectStore.setState({
      parseErrorIndex: [
        broken('NPC/Broken.d', [
          { type: 'syntax_error', message: 'Syntax error at line 7, column 2', line: 7, column: 2, text: 'FUNC' }
        ])
      ]
    });

    useProblemsStore.getState().runScan();

    const found = useProblemsStore.getState().problems.filter((p) => p.rule === 'parse-error');
    expect(found).toHaveLength(1);
    expect(filePathOf(found[0])).toBe('NPC/Broken.d');
    expect(lineOf(found[0])).toBe(7);
    expect(found[0].severity).toBe('error');
  });
});
