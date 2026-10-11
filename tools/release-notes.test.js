'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseReleaseNotes, newReleaseNotes, addChangelogSection } = require('./release-notes');

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

test('a published build goes on top of the changelog, under its number and date', () => {
  const changelog = '# Changelog\n\nIntro.\n\n## Build 33 — 2026-10-09\n\n- #1: Oldest change\n';
  const notes = [{ issue: 3, description: 'New change' }, { issue: 2, description: 'Older change' }];
  assert.strictEqual(
    addChangelogSection(changelog, 34, '2026-10-11', notes),
    '# Changelog\n\nIntro.\n\n## Build 34 — 2026-10-11\n\n- #3: New change\n- #2: Older change\n\n## Build 33 — 2026-10-09\n\n- #1: Oldest change\n',
  );
});

test('the first build starts the changelog after its intro', () => {
  assert.strictEqual(
    addChangelogSection('# Changelog\n\nIntro.\n', 31, '2026-10-08', [{ issue: 1, description: 'First' }]),
    '# Changelog\n\nIntro.\n\n## Build 31 — 2026-10-08\n\n- #1: First\n',
  );
});

test('a build already in the changelog is not added twice', () => {
  const changelog = '# Changelog\n\n## Build 34 — 2026-10-11\n\n- #3: New change\n';
  assert.strictEqual(addChangelogSection(changelog, 34, '2026-10-12', [{ issue: 3, description: 'New change' }]), changelog);
});
