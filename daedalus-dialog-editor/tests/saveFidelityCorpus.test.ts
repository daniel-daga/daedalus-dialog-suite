import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { CodeGeneratorService } from '../src/main/services/CodeGeneratorService';

/**
 * Editor-path byte-fidelity ratchet over the parser's synthetic corpus.
 *
 * Sibling to the parser's `roundtrip-corpus-smoke.test.js`, but stricter and
 * from the EDITOR's angle:
 *
 * - The parser smoke test asserts TOKEN fidelity through the corpus codegen
 *   config (`sectionHeaders: false`, no `indentChar`/`uppercaseKeywords`); it
 *   ignores blank lines, indentation, and comment placement. All 11 fixtures
 *   are token-green there.
 * - This test asserts BYTE identity (after CRLF->LF normalization) through the
 *   editor's REAL save-path seam — `CodeGeneratorService.generateCode` with the
 *   editor's DEFAULT `codeSettings` (see `fileStore.ts`: `indentChar: '\t'`,
 *   `includeComments: true`, `sectionHeaders: true`, `uppercaseKeywords: true`;
 *   the service additionally forces `preserveSourceStyle: true`). This is the
 *   same generation the auto-save pipeline runs via `ValidationService`, and it
 *   is what the real-Electron `save-fidelity-no-edit.spec.ts` asserts on disk.
 *
 * A fixture is GREEN when parse -> serialize (IPC boundary) -> generate through
 * that seam reproduces the source exactly. It is a KNOWN_GAP when only byte-level
 * (token-equal) formatting differs; each gap records its one-line root cause.
 * When a KNOWN_GAP fixture is fixed in the owning workspace it flips this list to
 * a red-assertion failure and must be promoted to GREEN in the same change.
 */

// Editor default code settings (fileStore.ts initial `codeSettings`). The
// CodeGeneratorService seam adds `preserveSourceStyle: true` on top.
const EDITOR_SETTINGS = {
  indentChar: '\t' as const,
  includeComments: true,
  sectionHeaders: true,
  uppercaseKeywords: true,
};

// Byte-identical through the editor save path after CRLF->LF normalization.
const GREEN_FIXTURES = [
  'arity-variants.d',   // function-only, canonical statements
  'case-drift.d',       // dialog instance + condition/info functions
  'declaration-order.d',// declaration-order fidelity (also the E2E save-fidelity.d)
  'encoding-1252.d',    // globals-only + EOF comment, windows-1252 (EOF newline fix)
  'globals.d',          // consecutive globals + EOF comment (EOF newline fix)
  'numeric-args.d',     // numeric literal fidelity in call arguments
];

// Token-equal but not byte-identical through the editor path. Each entry names
// what still gates it; fixing the cause must promote the fixture to GREEN.
const KNOWN_GAP_FIXTURES: Array<{ file: string; reason: string }> = [
  // Blank lines between consecutive top-level declarations are dropped: the
  // generator packs consecutive globals (class/prototype/instance) with a single
  // newline and the model does not track inter-declaration blank lines.
  { file: 'class-prototype.d', reason: 'inter-global blank lines not preserved' },
  // A trailing inline comment on a non-AI_Output statement is modeled by the
  // parser as a standalone CommentAction (only DialogLine absorbs inline
  // comments), so it regenerates on its own line instead of inline. fix-01
  // (parser fidelity) owns attaching inline comments to arbitrary statements.
  { file: 'comments.d', reason: 'inline comment on non-AI_Output stmt becomes standalone' },
  // A multi-line generic raw statement (hand-written if-block) keeps its source
  // indentation on continuation lines, then generateFunction re-indents every
  // line uniformly, double-indenting the block body.
  { file: 'condition-idioms.d', reason: 'raw multi-line statement continuation lines double-indented' },
  // Same inter-declaration blank-line loss as class-prototype (blank line between
  // the two instance declarations is dropped).
  { file: 'items-npcs-mds.d', reason: 'inter-global blank lines not preserved' },
  // CreateTopic / LogEntry / InsertNpc action renderers emit surrounding blank
  // lines, inserting spurious blanks between packed statements.
  { file: 'quoting.d', reason: 'topic/log/insert action renderers emit surrounding blank lines' },
];

const parserDir = path.resolve(__dirname, '..', '..', 'daedalus-parser');
const corpusDir = path.join(parserDir, 'test', 'fixtures', 'corpus');
const normalizeNewlines = (s: string): string => s.replace(/\r\n/g, '\n');

interface ParsedFixture {
  original: string;
  plainModel: unknown;
}

// The native tree-sitter binding is a process-global resource that other suites
// in the full run can leave in a bad state (the same reason the parser's own
// corpus smoke test shells out via execFileSync). So the native parse runs once
// in a clean child process; the per-test work below is pure JS through the real
// codegen seam (deserialize + string-template generate + compare).
const PARSE_SCRIPT = `
const fs = require('fs');
const path = require('path');
const parserDir = process.env.PARSER_DIR;
const corpusDir = process.env.CORPUS_DIR;
const DaedalusParser = require(path.join(parserDir, 'src', 'core', 'parser'));
const { SemanticModelBuilderVisitor } = require(path.join(parserDir, 'dist', 'semantic', 'semantic-visitor-index'));
const parser = DaedalusParser.create();
const out = {};
for (const f of fs.readdirSync(corpusDir).filter((n) => n.toLowerCase().endsWith('.d'))) {
  const p = path.join(corpusDir, f);
  let res;
  try { res = parser.parseFile(p, { detectEncoding: true }); }
  catch (e) { res = parser.parseFile(p, { encoding: 'windows-1252' }); } // 1252 fixture: jschardet misdetects; editor FileService defaults to windows-1252
  const v = new SemanticModelBuilderVisitor();
  v.pass1_createObjects(res.rootNode);
  v.pass2_analyzeAndLink(res.rootNode);
  out[f] = { original: res.rootNode.text, plainModel: JSON.parse(JSON.stringify(v.semanticModel)) };
}
process.stdout.write(JSON.stringify(out));
`;

const parsedFixtures = new Map<string, ParsedFixture>();

beforeAll(() => {
  const json = execFileSync(process.execPath, ['-e', PARSE_SCRIPT], {
    env: { ...process.env, PARSER_DIR: parserDir, CORPUS_DIR: corpusDir },
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  const out = JSON.parse(json) as Record<string, ParsedFixture>;
  for (const [file, parsed] of Object.entries(out)) {
    parsedFixtures.set(file, parsed);
  }
});

/**
 * Generate through the editor save-path seam (CodeGeneratorService) from the
 * pre-parsed, IPC-boundary-plain model — the same generation the auto-save
 * pipeline runs via ValidationService.
 */
function generateThroughEditorPath(fixtureFile: string): { original: string; generated: string } {
  const parsed = parsedFixtures.get(fixtureFile);
  if (!parsed) {
    throw new Error(`fixture not parsed in beforeAll: ${fixtureFile}`);
  }
  const generated = new CodeGeneratorService().generateCode(parsed.plainModel, EDITOR_SETTINGS);
  return { original: parsed.original, generated };
}

function isByteGreen(fixtureFile: string): boolean {
  const { original, generated } = generateThroughEditorPath(fixtureFile);
  return normalizeNewlines(generated) === normalizeNewlines(original);
}

describe('Editor save-path byte-fidelity ratchet (parser corpus)', () => {
  test('ratchet lists cover every corpus fixture exactly once (cannot rot silently)', () => {
    const fixtureFiles = fs
      .readdirSync(corpusDir)
      .filter((n) => n.toLowerCase().endsWith('.d'))
      .sort();
    const gapFiles = KNOWN_GAP_FIXTURES.map((g) => g.file);
    const listed = [...GREEN_FIXTURES, ...gapFiles].sort();
    const overlap = GREEN_FIXTURES.filter((n) => gapFiles.includes(n));

    expect(overlap).toEqual([]);
    // Every fixture file must appear in exactly one ratchet list — a new corpus
    // fixture cannot be silently omitted from the editor-path fidelity claim.
    expect(listed).toEqual(fixtureFiles);
  });

  test.each(GREEN_FIXTURES)('GREEN: %s regenerates byte-identical through the editor save path', (fixtureFile) => {
    const { original, generated } = generateThroughEditorPath(fixtureFile);
    expect(normalizeNewlines(generated)).toBe(normalizeNewlines(original));
  });

  test.each(KNOWN_GAP_FIXTURES)('KNOWN_GAP: $file still differs ($reason)', ({ file }) => {
    // If this flips to byte-green, the underlying gap was closed — promote the
    // fixture to GREEN_FIXTURES in the same change.
    expect(isByteGreen(file)).toBe(false);
  });
});
