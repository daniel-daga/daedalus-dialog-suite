#!/usr/bin/env node
// Validates RELEASE_NOTES.md and prints its notes as the JSON the editor's
// "What changed" splash reads (VITE_WHAT_CHANGED). Every non-blank line that
// is not a markdown heading must be `- #123: Short description`.
// Usage: node tools/release-notes.js [path]  (path for tests only)
//        node tools/release-notes.js --since <commit>
// --since prints only the notes added since <commit> (the one the published
// build came from), so the file is never reset: a release is its new lines.
// It prints [] when there are none.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function parseReleaseNotes(text) {
  const notes = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim() || /^#+\s/.test(line)) return;
    const m = /^\s*-\s+#([1-9]\d*)\s*:\s*(\S.*\S|\S)\s*$/.exec(line);
    if (!m) {
      throw new Error(`RELEASE_NOTES.md line ${i + 1}: '${line}' - use one line per change: - #123: Short description`);
    }
    if (m[2].length > 120) {
      throw new Error(`RELEASE_NOTES.md line ${i + 1}: descriptions must be 120 characters or fewer`);
    }
    notes.push({ issue: Number(m[1]), description: m[2] });
  });
  if (notes.length === 0) throw new Error('RELEASE_NOTES.md: add at least one change note with an issue number');
  return notes;
}

function newReleaseNotes(releasedText, currentText) {
  const key = (n) => `${n.issue}:${n.description}`;
  const released = new Set(parseReleaseNotes(releasedText).map(key));
  return parseReleaseNotes(currentText).filter((n) => !released.has(key(n)));
}

if (require.main === module) {
  try {
    let notes;
    if (process.argv[2] === '--since') {
      const root = path.join(__dirname, '..');
      const released = execFileSync('git', ['show', `${process.argv[3]}:RELEASE_NOTES.md`], { cwd: root, encoding: 'utf8' });
      notes = newReleaseNotes(released, fs.readFileSync(path.join(root, 'RELEASE_NOTES.md'), 'utf8'));
    } else {
      const file = process.argv[2] || path.join(__dirname, '..', 'RELEASE_NOTES.md');
      notes = parseReleaseNotes(fs.readFileSync(file, 'utf8'));
    }
    process.stdout.write(`${JSON.stringify(notes)}\n`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = { parseReleaseNotes, newReleaseNotes };
