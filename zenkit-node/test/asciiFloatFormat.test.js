'use strict';

// ASCII float text precision. ZenKit wrote every ASCII float with
// `std::to_string` — `%f`, six decimals, always — where ZenGin printed nine
// significant digits and its MSVC CRT's three-digit exponent. Both directions
// cost bytes against a retail original, and one of them costs *digits*: `0`
// came back `0.000000`, and at world magnitudes `1511.77087` came back
// `1511.770874`. Measured across the retail install's ASCII worlds:
// `=float:10.0000105`, `=float:1200`, `vec3:1552.21545 756.087585 -6289.54248`,
// `bbox3DWS=rawFloat:751.806152 -128.8302 …`, `2.98023224e-008` — all `%.9g`.
//
// Assertions pull the entry lines out rather than matching the whole file: a
// failing `assert.match` on a world dumps the mesh blob with it.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const zenkit = require('..');

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'zenkit-ascii-float-'));
}

function entries(file, name) {
  return fs
    .readFileSync(file, 'latin1')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith(`${name}=`));
}

test('a scalar ASCII float entry drops the six forced decimals ZenGin never wrote', () => {
  const dir = tmpdir();
  try {
    const at = path.join(dir, 'packed.zen');
    zenkit._authorFixtureWorld(at, 'ascii', 'g2', 'minimal');

    assert.deepStrictEqual(entries(at, 'range'), ['range=float:500']);
    assert.deepStrictEqual(entries(at, 'spotConeAngle'), ['spotConeAngle=float:0']);
    assert.deepStrictEqual(entries(at, 'rangeAniFPS'), ['rangeAniFPS=float:4']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('vec3 and rawFloat entries keep nine significant digits and ZenGin\'s exponent', () => {
  const dir = tmpdir();
  try {
    const source = path.join(dir, 'source.zen');
    const resaved = path.join(dir, 'resaved.zen');
    // The unpacked layout is the one that writes `trafoOSToWSPos` and
    // `bbox3DWS` as text at all; the packed layout hides both in `dataRaw`.
    zenkit._authorFixtureWorld(source, 'ascii', 'g2', 'minimal', false);

    // A retail-shaped position: a magnitude that needs all nine digits, a value
    // with trailing zeros for `%g` to strip, and one small enough to force an
    // exponent — the three cases `%f` gets wrong in three different ways.
    const position = [1511.770874, -128.8302, 2.9802322e-8];
    const handle = zenkit.loadWorld(source, 'g2');
    zenkit.setVobPosition(handle, '0/1', position);
    zenkit.saveWorld(handle, resaved, { allowNonBinSafe: true });

    assert.ok(
      entries(resaved, 'trafoOSToWSPos').includes(
        'trafoOSToWSPos=vec3:1511.77087 -128.8302 2.98023224e-008'
      ),
      `positions written: ${entries(resaved, 'trafoOSToWSPos').join(' | ')}`
    );
    assert.deepStrictEqual(
      entries(resaved, 'bbox3DWS').filter((line) => /[0-9]\.[0-9]{6}(?: |$)/.test(line)),
      []
    );

    // Byte fidelity only: the parsed value is unchanged, and nine digits is
    // exactly what makes that true for a float.
    const back = zenkit.normalizeWorld(zenkit.loadWorld(resaved, 'g2'));
    assert.deepStrictEqual(
      back.vobs.find((v) => v.path === '0/1').position,
      position.map((v) => Math.fround(v))
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
