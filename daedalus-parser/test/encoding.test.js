const { test, describe, before, after } = require('node:test');
const { strict: assert } = require('node:assert');
const fs = require('fs');
const path = require('path');
const iconv = require('iconv-lite');
const DaedalusParser = require('../src/core/parser');

describe('Encoding Support', () => {
  let parser;
  const testDir = path.join(__dirname, 'fixtures', 'encoding');

  before(() => {
    parser = new DaedalusParser();

    // Create test fixtures directory if it doesn't exist
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
  });

  describe('Windows-1250 Encoding', () => {
    const windows1250File = path.join(testDir, 'dialog_windows1250.d');

    before(() => {
      // Create a test file with Windows-1250 encoded Czech/Polish characters
      const content = `// Dialog with Czech characters: č, ř, ž, š, ý, á, í, é
// Polish characters: ą, ć, ę, ł, ń, ó, ś, ź, ż

instance DIA_Petr_Hello (C_Info)
{
    npc = Petr;
    nr = 1;
    condition = DIA_Petr_Hello_Condition;
    information = DIA_Petr_Hello_Info;
    description = "Dobrý den, jak se máš?";
    permanent = 0;
};

func int DIA_Petr_Hello_Condition()
{
    return 1;
};

func void DIA_Petr_Hello_Info()
{
    AI_Output(self, other, "DIA_Petr_Hello_15_00");
    AI_Output(other, self, "DIA_Petr_Hello_15_01");
};`;

      // Convert to Windows-1250 and write to file
      const buffer = iconv.encode(content, 'windows-1250');
      fs.writeFileSync(windows1250File, buffer);
    });

    test('detects Windows-1250 by its Central European bytes', () => {
      const result = parser.parseFile(windows1250File);

      assert.equal(result.encoding, 'windows-1250');
    });

    test('should correctly parse Windows-1250 file', () => {
      const result = parser.parseFile(windows1250File);

      assert.equal(result.hasErrors, false, 'Should parse without errors');
      assert.ok(result.tree, 'Tree should be defined');
      assert.ok(result.rootNode, 'Root node should be defined');
    });

    test('should preserve Czech characters when reading Windows-1250', () => {
      const result = parser.parseFile(windows1250File);

      assert.ok(result.rootNode.text.includes('Dobrý den, jak se máš?'));
      assert.ok(result.rootNode.text.includes('č, ř, ž, š'));
    });

    test('should allow specifying encoding explicitly', () => {
      const result = parser.parseFile(windows1250File, {
        encoding: 'windows-1250'
      });

      assert.equal(result.encoding, 'windows-1250', 'Encoding should match');
      assert.equal(result.encodingConfidence, 100, '100% confidence when explicitly specified');

      // Read from AST instead of sourceCode
      const sourceText = result.rootNode.text;
      assert.ok(sourceText.includes('Dobrý den, jak se máš?'), 'Should contain Czech text');
    });

    test('should allow disabling encoding detection', () => {
      const result = parser.parseFile(windows1250File, {
        detectEncoding: false
      });

      assert.equal(result.encoding, 'utf-8', 'Should use UTF-8 fallback when detection is disabled');
      assert.equal(result.encodingConfidence, 100, 'Should use full confidence for explicit UTF-8 fallback');
      assert.equal(result.hasErrors, false, 'Should still parse without syntax errors');
    });
  });

  describe('UTF-8 Encoding', () => {
    const utf8File = path.join(testDir, 'dialog_utf8.d');

    before(() => {
      // Create a test file with UTF-8 encoded characters
      const content = `// Dialog with various UTF-8 characters: Ñ, ü, ö, ä
// Japanese: こんにちは

instance DIA_Hans_Greeting (C_Info)
{
    npc = Hans;
    nr = 1;
    condition = DIA_Hans_Greeting_Condition;
    information = DIA_Hans_Greeting_Info;
    description = "Grüße! Wie geht's?";
    permanent = 0;
};`;

      fs.writeFileSync(utf8File, content, 'utf8');
    });

    test('should detect UTF-8 encoding', () => {
      const result = parser.parseFile(utf8File);

      assert.ok(result.encoding, 'Encoding should be detected');
      const lowerEncoding = result.encoding.toLowerCase();
      assert.ok(['utf-8', 'utf8', 'ascii'].includes(lowerEncoding), `Encoding should be UTF-8 or ASCII, got: ${result.encoding}`);
      console.log(`Detected encoding: ${result.encoding} (${result.encodingConfidence}% confidence)`);
    });

    test('should correctly parse UTF-8 file', () => {
      const result = parser.parseFile(utf8File);

      assert.equal(result.hasErrors, false, 'Should parse without errors');
      assert.ok(result.tree, 'Tree should be defined');
    });

    test('should preserve German characters when reading UTF-8', () => {
      const result = parser.parseFile(utf8File);

      // Read from AST instead of sourceCode
      const sourceText = result.rootNode.text;
      assert.ok(sourceText.includes('Grüße! Wie geht\'s?'), 'Should contain German text');
      assert.ok(sourceText.includes('ü'), 'Should contain ü');
      assert.ok(sourceText.includes('ö'), 'Should contain ö');
    });
  });

  describe('ASCII Encoding', () => {
    const asciiFile = path.join(testDir, 'dialog_ascii.d');

    before(() => {
      // Create a simple ASCII file
      const content = `// Simple ASCII dialog

instance DIA_Guard_Hello (C_Info)
{
    npc = Guard;
    nr = 1;
    condition = DIA_Guard_Hello_Condition;
    information = DIA_Guard_Hello_Info;
    description = "Hello, stranger!";
    permanent = 0;
};`;

      fs.writeFileSync(asciiFile, content, 'ascii');
    });

    test('should detect ASCII/UTF-8 encoding', () => {
      const result = parser.parseFile(asciiFile);

      assert.ok(result.encoding, 'Encoding should be detected');
      // ASCII is often detected as UTF-8 or ASCII
      console.log(`Detected encoding: ${result.encoding} (${result.encodingConfidence}% confidence)`);
    });

    test('should correctly parse ASCII file', () => {
      const result = parser.parseFile(asciiFile);

      assert.equal(result.hasErrors, false, 'Should parse without errors');
      assert.ok(result.tree, 'Tree should be defined');
    });
  });

  describe('Windows-1252 Encoding', () => {
    // #395: statistical detection read this German script as x-mac-cyrillic or
    // ISO-8859-7, which turned the ß in the identifier into a syntax error.
    test('decodes a non-UTF-8 script as Windows-1252', () => {
      const file = path.join(testDir, 'dialog_windows1252.d');
      const content = `// Änderung der Übersetzung folgt später
const string NSC_Greeting = "Schöne Grüße, Söldner";

func void DIA_Saturas_Hallo_weißtdu ()
{
	AI_StopProcessInfos (self);
};
`;
      fs.writeFileSync(file, iconv.encode(content, 'windows-1252'));

      const result = parser.parseFile(file);

      assert.equal(result.encoding, 'windows-1252');
      assert.equal(result.hasErrors, false);
      assert.ok(result.rootNode.text.includes('DIA_Saturas_Hallo_weißtdu'));
    });
  });

  // One detector for the parser and the editor (#395): its rules, byte by byte.
  describe('detectSourceEncoding', () => {
    const { detectSourceEncoding } = require('../src/core/source-encoding');

    test('pure ASCII is Windows-1252, so a later save writes Gothic\'s encoding', () => {
      assert.equal(detectSourceEncoding(Buffer.from('instance A (C_INFO) { nr = 1; };')), 'windows-1252');
    });

    test('valid UTF-8 with non-ASCII text is UTF-8', () => {
      assert.equal(detectSourceEncoding(Buffer.from('// Grüße\nvar int a;', 'utf8')), 'utf8');
    });

    test('German Windows-1252 is Windows-1252', () => {
      assert.equal(detectSourceEncoding(iconv.encode('// Grüße Köln Straße\nvar int test = 1;', 'windows-1252')), 'windows-1252');
    });

    test('a lone accented byte does not flip a Western file to Windows-1250', () => {
      // 'è' is 0xE8, 'č' in windows-1250; one such byte is French, not Czech.
      assert.equal(detectSourceEncoding(iconv.encode('// Après la mort de Noël\nvar int a;', 'windows-1252')), 'windows-1252');
    });

    test('two distinct Central European bytes read as Windows-1250', () => {
      assert.equal(detectSourceEncoding(iconv.encode('// Čapek Dvořák Škoda Žižka Řež\nvar int a;', 'windows-1250')), 'windows-1250');
    });

    test('a byte Windows-1252 leaves unassigned is decisive for Windows-1250', () => {
      const buffer = iconv.encode('// Ťava\nvar int a;', 'windows-1250');
      assert.ok(buffer.includes(0x8d));
      assert.equal(detectSourceEncoding(buffer), 'windows-1250');
    });
  });

  describe('Encoding Detection Edge Cases', () => {
    test('should handle files with mixed content', () => {
      const mixedFile = path.join(testDir, 'mixed.d');

      // Create a file with mostly ASCII but some special characters
      const content = `// Mix of ASCII and special chars: café, naïve
instance Test (C_Info) { description = "Test café"; };`;

      fs.writeFileSync(mixedFile, content, 'utf8');

      const result = parser.parseFile(mixedFile);

      assert.equal(result.hasErrors, false, 'Should parse without errors');

      // Read from AST instead of sourceCode
      const sourceText = result.rootNode.text;
      assert.ok(sourceText.includes('café'), 'Should contain café');
      assert.ok(sourceText.includes('naïve'), 'Should contain naïve');
    });

    test('should handle empty files', () => {
      const emptyFile = path.join(testDir, 'empty.d');
      fs.writeFileSync(emptyFile, '', 'utf8');

      const result = parser.parseFile(emptyFile);

      assert.ok(result.encoding, 'Encoding should be detected');
      assert.ok(result.tree, 'Tree should be defined');
    });
  });

  after(() => {
    // Cleanup test fixtures
    if (fs.existsSync(testDir)) {
      const files = fs.readdirSync(testDir);
      files.forEach(file => {
        fs.unlinkSync(path.join(testDir, file));
      });
      fs.rmdirSync(testDir);

      // Also remove the parent fixtures directory if empty
      const fixturesDir = path.join(__dirname, 'fixtures');
      if (fs.existsSync(fixturesDir) && fs.readdirSync(fixturesDir).length === 0) {
        fs.rmdirSync(fixturesDir);
      }
    }
  });
});
