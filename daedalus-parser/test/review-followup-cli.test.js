const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const iconv = require('iconv-lite');
const { parseSemanticModel } = require('../dist/semantic/semantic-visitor-index');

const workspace = path.resolve(__dirname, '..');

function withFiles(run) {
  const directory = fs.mkdtempSync(path.join(__dirname, 'fixtures', 'cli-review-'));
  try {
    run(path.join(directory, 'input.d'), path.join(directory, 'output.d'));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function format(args) {
  return spawnSync(process.execPath, ['-r', 'ts-node/register', 'bin/semantic-code-generator-cli.ts', ...args], {
    cwd: workspace, encoding: 'utf8', timeout: 120000
  });
}

for (const verbose of [false, true]) {
  test(`formatter rejects syntax errors before replacing output, verbose=${verbose}`, () => {
    withFiles((input, output) => {
      const source = 'instance D(C_INFO) { nr = 1; }; @';
      fs.writeFileSync(input, source);
      fs.writeFileSync(output, 'existing output');
      for (const target of [output, input]) {
        const result = format([input, '-o', target, ...(verbose ? ['--verbose'] : [])]);
        assert.equal(result.status, 1, result.stdout + result.stderr);
        assert.match(result.stderr, /syntax|parse error/i);
        assert.equal(fs.readFileSync(output, 'utf8'), 'existing output');
        assert.equal(fs.readFileSync(input, 'utf8'), source);
      }
    });
  });
}

const german = 'instance D(C_INFO) { description = "Grüße über große Straßen für schöne Grüße"; };';
test('formatter preserves Windows-1252 input using the legacy default', () => {
  withFiles((input, output) => {
    fs.writeFileSync(input, iconv.encode(german, 'windows-1252'));
    const result = format([input, '-o', output, '--verbose']);
    assert.equal(result.status, 0, result.stderr);
    const code = iconv.decode(fs.readFileSync(output), 'windows-1252');
    assert.equal(parseSemanticModel(code).dialogs.D.properties.description,
      '"Grüße über große Straßen für schöne Grüße"', code);
    assert.ok(fs.readFileSync(output).includes(0xfc));
  });
});

test('formatter permits explicit input and output encodings', () => {
  withFiles((input, output) => {
    const source = 'instance D(C_INFO) { description = "Dobrý den, čřžš ąęłń"; };';
    fs.writeFileSync(input, iconv.encode(source, 'windows-1250'));
    const result = format([input, '--encoding', 'windows-1250', '--output-encoding', 'utf8', '-o', output]);
    assert.equal(result.status, 0, result.stderr);
    const code = fs.readFileSync(output, 'utf8');
    assert.equal(parseSemanticModel(code).dialogs.D.properties.description, '"Dobrý den, čřžš ąęłń"', code);
  });
});

test('formatter keeps UTF-8 literal text intact', () => {
  withFiles((input, output) => {
    fs.writeFileSync(input, german, 'utf8');
    const result = format([input, '-o', output]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(parseSemanticModel(fs.readFileSync(output, 'utf8')).dialogs.D.properties.description,
      '"Grüße über große Straßen für schöne Grüße"');
  });
});

test('formatter refuses a lossy output encoding before replacing a file', () => {
  withFiles((input, output) => {
    fs.writeFileSync(input, german, 'utf8');
    fs.writeFileSync(output, 'existing output');
    const result = format([input, '-o', output, '--output-encoding', 'ascii']);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /cannot represent/);
    assert.equal(fs.readFileSync(output, 'utf8'), 'existing output');
  });
});

test('parse CLI stdout is a single JSON document', () => {
  withFiles(input => {
    fs.writeFileSync(input, 'var int Count; func void F() {};');
    const result = spawnSync(process.execPath, ['bin/daedalus-parse.js', input, '--json'], {
      cwd: workspace, encoding: 'utf8', timeout: 120000
    });
    assert.equal(result.status, 0, result.stderr);
    const json = JSON.parse(result.stdout);
    assert.equal(json.file, input);
    assert.equal(json.hasErrors, false);
    assert.deepEqual(json.declarations.map(declaration => declaration.name), ['Count', 'F']);
  });
});
