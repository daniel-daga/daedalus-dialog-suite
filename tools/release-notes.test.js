'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseReleaseNotes } = require('./release-notes');

test('reads each bullet as an issue and description, skipping headings and blanks', () => {
  const notes = parseReleaseNotes('# Release notes\n\n- #351: Saving works on Windows\r\n- #12 :  Faster load  \n');
  assert.deepStrictEqual(notes, [
    { issue: 351, description: 'Saving works on Windows' },
    { issue: 12, description: 'Faster load' },
  ]);
});

test('refuses a line that is not a "- #123: description" bullet', () => {
  assert.throws(() => parseReleaseNotes('- a lot of stuff!\n'), /line 1.*- #123: Short description/);
  assert.throws(() => parseReleaseNotes('- #0: zero is no issue\n'), /line 1/);
});

test('refuses a description over 120 characters', () => {
  assert.throws(() => parseReleaseNotes(`- #1: ${'x'.repeat(121)}\n`), /120 characters/);
});

test('refuses a file with no notes', () => {
  assert.throws(() => parseReleaseNotes('# Release notes\n\n'), /at least one/);
});
