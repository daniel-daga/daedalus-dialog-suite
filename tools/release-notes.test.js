'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseReleaseNotes, newReleaseNotes } = require('./release-notes');

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

test('a release takes only the notes added since the commit it was built from', () => {
  const released = '# Notes\n\n- #2: Older change\n- #1: Oldest change\n';
  const now = '# Notes\n\n- #3: New change\n- #2: Older change\n- #1: Oldest change\n';
  assert.deepStrictEqual(newReleaseNotes(released, now), [{ issue: 3, description: 'New change' }]);
});

test('a reworded note counts as new, a removed one never does', () => {
  const released = '- #2: Older change\n- #1: Oldest change\n';
  assert.deepStrictEqual(newReleaseNotes(released, '- #2: Older change, reworded\n'), [
    { issue: 2, description: 'Older change, reworded' },
  ]);
  assert.deepStrictEqual(newReleaseNotes(released, '- #2: Older change\n'), []);
});
