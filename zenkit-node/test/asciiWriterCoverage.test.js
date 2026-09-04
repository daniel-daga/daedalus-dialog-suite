'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const zenkit = require('..');
const { walkAscii } = require('../lib/container-ascii.js');

function authoredEvents(dir, packed) {
  const at = path.join(dir, packed ? 'packed.zen' : 'unpacked.zen');
  // The visual fixture includes a zCMover. Its (possibly zero) keyframe count
  // is the only ordinary world field written through write_word.
  zenkit._authorFixtureWorld(at, 'ascii', 'g2', 'mesh-extraction', packed);
  return [...walkAscii(fs.readFileSync(at))];
}

// This is a reachability gate for the public ASCII archive writer surface. It
// deliberately authors both VOB layouts: packed VOBs carry raw blobs, while
// unpacked VOBs exercise the named vector/matrix entries ZenGin accepts.
test('the authored ASCII world reaches every public writer family', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zenkit-ascii-writers-'));
  try {
    const events = [...authoredEvents(dir, true), ...authoredEvents(dir, false)];
    const referenceClass = String.fromCharCode(0xa7);
    const hasEntry = (name, type) => events.some((event) =>
      event.kind === 'entry' && event.entryName === name && event.entryType === type);
    const hasObject = (predicate) => events.some((event) => event.kind === 'objectBegin' && predicate(event));

    const families = [
      ['write_string', () => hasEntry('vobName', 'STRING')],
      ['write_int', () => hasEntry('hitpoints', 'INTEGER')],
      ['write_byte', () => hasEntry('decalAlphaWeight', 'INTEGER')],
      ['write_word', () => hasEntry('numKeyframes', 'INTEGER')],
      ['write_float', () => hasEntry('visualAniModeStrength', 'FLOAT')],
      ['write_enum', () => hasEntry('visualAniMode', 'ENUM')],
      ['write_bool', () => hasEntry('showVisual', 'BOOL')],
      ['write_color', () => hasEntry('color', 'COLOR')],
      ['write_vec3', () => hasEntry('trafoOSToWSPos', 'VEC3')],
      ['write_bbox', () => hasEntry('bbox3DWS', 'RAW_FLOAT')],
      ['write_mat3x3', () => hasEntry('trafoOSToWSRot', 'RAW')],
      ['write_object', () => hasObject((event) => event.frame.cls !== '%' && event.frame.cls !== referenceClass)],
      ['write_reference', () => hasObject((event) => event.frame.cls === referenceClass)],
      ['write_null_object', () => hasObject((event) => event.frame.cls === '%')],
    ];

    for (const [family, reached] of families) {
      assert.ok(reached(), `${family} has no ASCII fixture witness`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
