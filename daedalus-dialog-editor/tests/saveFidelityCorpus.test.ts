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
 *   ignores indentation. The parser now keeps blank lines and statement
 *   layout, so its byte tier is green for the same shapes this one pins.
 * - This test asserts BYTE identity through the editor's REAL save-path seam —
 *   `CodeGeneratorService.generateCode` with the editor's DEFAULT
 *   `codeSettings` (see `fileStore.ts`: `indentChar: '\t'`,
 *   `includeComments: true`, `sectionHeaders: true`, `uppercaseKeywords: true`;
 *   the service additionally forces `preserveSourceStyle: true`). This is the
 *   same generation the auto-save pipeline runs via `ValidationService`, and it
 *   is what the real-Electron `save-fidelity-no-edit.spec.ts` asserts on disk.
 *   Neither side is normalized: the save path writes the generated text
 *   verbatim, so a CRLF fixture coming back as LF is drift (#440).
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
  'class-prototype.d',  // blank lines between top-level declarations (#286)
  'items-npcs-mds.d',   // blank lines between declarations and after comments (#286)
  'blank-lines.d',      // #286: 0/1/2+ blank lines before every declaration kind
  'condition-idioms.d', // #384: raw multi-line statement continuation indent
  'comments.d',         // #440: a trailing inline comment stays on its statement's line
  'crlf-layout.d',      // #440: the file's own CRLF line endings are written back
  'body-blank-line.d',  // #440: a blank line inside a body
  'body-same-line-statements.d', // #440: two statements on one line
  'body-trailing-comment.d',     // #440: a trailing statement comment
  'same-line-declarations.d',    // #440: two declarations on one line
  'property-gaps.d',             // #440: a blank line inside a C_INFO property list
  'zpe-extensions.d',            // #392: zPE META / test / namespace carried verbatim
];

// Token-equal but not byte-identical through the editor path. Each entry names
// what still gates it; fixing the cause must promote the fixture to GREEN.
const KNOWN_GAP_FIXTURES: Array<{ file: string; reason: string }> = [
  // CreateTopic / LogEntry / InsertNpc action renderers emit surrounding blank
  // lines, inserting spurious blanks between packed statements.
  { file: 'quoting.d', reason: 'topic/log/insert action renderers emit surrounding blank lines' },
];

const parserDir = path.resolve(__dirname, '..', '..', 'daedalus-parser');
const corpusDir = path.join(parserDir, 'test', 'fixtures', 'corpus');

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
  const res = parser.parseFile(p);
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
  // The fixture is the parser's own serialization of a model, so it crosses
  // the same boundary the IPC payload does; it arrives as `unknown` only
  // because it was read back from JSON.
  const generated = new CodeGeneratorService()
    .generateCode(parsed.plainModel as Record<string, unknown>, EDITOR_SETTINGS);
  return { original: parsed.original, generated };
}

function isByteGreen(fixtureFile: string): boolean {
  const { original, generated } = generateThroughEditorPath(fixtureFile);
  return generated === original;
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
    expect(generated).toBe(original);
  });

  test.each(KNOWN_GAP_FIXTURES)('KNOWN_GAP: $file still differs ($reason)', ({ file }) => {
    // If this flips to byte-green, the underlying gap was closed — promote the
    // fixture to GREEN_FIXTURES in the same change.
    expect(isByteGreen(file)).toBe(false);
  });
});
