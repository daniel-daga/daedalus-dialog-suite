const { test } = require('node:test');
const assert = require('node:assert');
const DaedalusParser = require('../src/core/parser');
const {
  parseSemanticModel,
  SemanticCodeGenerator
} = require('../dist/semantic/semantic-visitor-index');

// zParserExtender (zPE) is a Union extension the original compiler never had
// (#392). Its META header, `test` blocks and `namespace` are carried verbatim
// and given no semantics: a zPE mod opens instead of being refused wholesale.

const META = `META
{
	Parser = Game
	MergeMode = TRUE
};
`;

const META_WITH_SEMICOLONS = `META { Parser = Game; MergeMode = TRUE; };
`;

const TEST_BLOCKS = `test ZPE_Light_Init
{
	INSTANCE ZPE_Light_Old (C_PARTICLEFX) {
		ZPE_Light_Old_Call();
		vistexcolorstart_s = "0";
	};
};

test ZPE_Empty
{
};
`;

const NAMESPACE_BLOCK = `namespace ZPE_Demo
{
	const int ZPE_INNER = 1;
};
`;

const NAMESPACE_BARE = `namespace ZPE_Bare;
`;

const SOURCE = `// a zPE mod: accepted, carried, never modelled (#392)
${META}
var int ZPE_Count;

${TEST_BLOCKS}
${NAMESPACE_BLOCK}${NAMESPACE_BARE}
func void ZPE_F()
{
	ZPE_Count = 1;
};
`;

function parseWithoutErrors(source) {
  const parser = DaedalusParser.create();
  const result = parser.parse(source);
  assert.equal(
    result.rootNode.hasError,
    false,
    `should parse without a syntax error: ${result.errors?.map((e) => e.message).join('; ')}`
  );
  return result;
}

test('a zPE META header parses, with and without entry semicolons', () => {
  parseWithoutErrors(META);
  parseWithoutErrors(META_WITH_SEMICOLONS);
});

test('zPE test blocks parse, with an empty body and with statements', () => {
  parseWithoutErrors(TEST_BLOCKS);
});

test('zPE namespace parses as a block and as a bare name', () => {
  parseWithoutErrors(NAMESPACE_BLOCK);
  parseWithoutErrors(NAMESPACE_BARE);
});

test('zPE extensions build no semantic model entries', () => {
  const model = parseSemanticModel(SOURCE);
  assert.equal(model.hasErrors, false, 'the file should have no syntax errors');

  assert.deepEqual(Object.keys(model.functions), ['ZPE_F'], 'only the real function is modelled');
  assert.deepEqual(Object.keys(model.variables), ['ZPE_Count'], 'only the real variable is modelled');
  assert.deepEqual(Object.keys(model.constants), [], 'a namespace body is not modelled');
  assert.deepEqual(Object.keys(model.instances ?? {}), [], 'a test body instance is not modelled');
  assert.deepEqual(
    model.declarationOrder.map((entry) => entry.type),
    ['raw', 'variable', 'raw', 'raw', 'raw', 'raw', 'function'],
    'declarationOrder carries the extensions as raw entries in source order'
  );
});

test('zPE extensions round-trip byte-identically', () => {
  const model = parseSemanticModel(SOURCE);
  const generator = new SemanticCodeGenerator({ includeComments: true, sectionHeaders: false });
  assert.equal(generator.generateSemanticModel(model), SOURCE);
});
