#!/usr/bin/env node
// Validates RELEASE_NOTES.md and prints its notes as the JSON the editor's
// "What changed" splash reads (VITE_WHAT_CHANGED). Every non-blank line that
// is not a markdown heading must be `- #123: Short description`.
// Usage: node tools/release-notes.js [path]  (path for tests only)
'use strict';
const fs = require('fs');
const path = require('path');

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

if (require.main === module) {
  const file = process.argv[2] || path.join(__dirname, '..', 'RELEASE_NOTES.md');
  try {
    process.stdout.write(`${JSON.stringify(parseReleaseNotes(fs.readFileSync(file, 'utf8')))}\n`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = { parseReleaseNotes };
