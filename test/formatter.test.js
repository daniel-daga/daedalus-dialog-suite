const { test } = require('node:test');
const assert = require('node:assert');
const DaedalusFormatter = require('../src/formatter');

test('DaedalusFormatter - Basic formatting', () => {
  const formatter = new DaedalusFormatter();
  const input = 'instance Test(Base){name="test";id=42;}';
  const expected = `instance Test (Base)
{
    name = "test";
    id = 42;
}
`;
  const result = formatter.format(input);
  assert.strictEqual(result, expected);
});

test('DaedalusFormatter - Comment preservation', () => {
  const formatter = new DaedalusFormatter();
  const input = `// Line comment
/* Block comment */
instance Test (Base)
{
    name = "test"; // Inline comment
    /* Multi-line
       comment */
    id = 42;
};`;

  const result = formatter.format(input);

  // Check that comments are preserved
  assert(result.includes('// Line comment'));
  assert(result.includes('/* Block comment */'));
  assert(result.includes('// Inline comment'));
  assert(result.includes('/* Multi-line'));
  assert(result.includes('       comment */'));
});

test('DaedalusFormatter - Function declaration formatting', () => {
  const formatter = new DaedalusFormatter();
  const input = 'func void TestFunc(){return;}';
  const expected = `func void TestFunc()
{
    return;
}
`;
  const result = formatter.format(input);
  assert.strictEqual(result, expected);
});

test('DaedalusFormatter - Complex expressions', () => {
  const formatter = new DaedalusFormatter();
  const input = 'func int Calculate(){if(a>b){return a+b;}else{return a-b;}}';

  const result = formatter.format(input);

  // Check that formatting is applied
  assert(result.includes('func int Calculate()'));
  assert(result.includes('if (a > b)'));
  assert(result.includes('return a + b;'));
  assert(result.includes('else'));
  assert(result.includes('return a - b;'));
});

test('DaedalusFormatter - Indentation options', () => {
  const formatterSpaces = new DaedalusFormatter({ indentSize: 2 });
  const formatterTabs = new DaedalusFormatter({ indentType: 'tabs' });

  const input = 'instance Test(Base){name="test";}';

  const spacesResult = formatterSpaces.format(input);
  const tabsResult = formatterTabs.format(input);

  // Spaces formatter should use 2 spaces
  assert(spacesResult.includes('  name = "test";'));

  // Tabs formatter should use tabs
  assert(tabsResult.includes('\tname = "test";'));
});

test('DaedalusFormatter - Comment disable option', () => {
  const formatter = new DaedalusFormatter({ preserveComments: false });
  const input = `// This comment should be ignored
instance Test (Base)
{
    name = "test"; // This too
};`;

  const result = formatter.format(input);

  // Comments should not appear in output
  assert(!result.includes('// This comment should be ignored'));
  assert(!result.includes('// This too'));
  // But the code should still be there
  assert(result.includes('instance Test (Base)'));
  assert(result.includes('name = "test";'));
});

test('DaedalusFormatter - Function calls and parameters', () => {
  const formatter = new DaedalusFormatter();
  const input = 'func void Test(){B_SetNpcVisual(self,MALE,"Head",1,BodyTex,ARMOR);}';

  const result = formatter.format(input);

  // Check function call formatting
  assert(result.includes('B_SetNpcVisual(self, MALE, "Head", 1, BodyTex, ARMOR);'));
});

test('DaedalusFormatter - Error handling for invalid syntax', () => {
  const formatter = new DaedalusFormatter();
  const invalidInput = 'instance Test Base) { // Missing opening parenthesis';

  assert.throws(() => {
    formatter.format(invalidInput);
  }, /Cannot format code with syntax errors/);
});

test('DaedalusFormatter - File formatting', async() => {
  const fs = require('fs');
  const path = require('path');
  const formatter = new DaedalusFormatter();

  // Test with an actual example file
  const examplePath = path.join(__dirname, '../examples/DEV_2130_Szmyk.d');

  if (fs.existsSync(examplePath)) {
    const result = formatter.formatFile(examplePath);

    // Should contain formatted content
    assert(result.includes('instance DEV_2130_Szmyk (Npc_Default)'));
    assert(result.includes('func void Rtn_Start_2130()'));

    // Should be properly indented
    assert(result.includes('    name = "Szmyk";'));
    assert(result.includes('    TA_Stand_WP('));
  }
});
