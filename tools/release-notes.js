#!/usr/bin/env node
// Validates RELEASE_NOTES.md and prints its notes as the JSON the editor's
// "What changed" splash reads (VITE_WHAT_CHANGED). Every non-blank line that
// is not a markdown heading must be `- #123: Short description`.
// Usage: node tools/release-notes.js [path]  (path for tests only)
//        node tools/release-notes.js --since <commit>
// --since prints only the notes added since <commit> (the one the published
// build came from), so the file is never reset: a release is its new lines.
// It prints [] when there are none.
//        node tools/release-notes.js --changelog <build> <date> <notes json>
// --changelog puts a published build's notes on top of CHANGELOG.md, so they
// outlive their lines in RELEASE_NOTES.md (build-windows.yml, after publish).
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

// Newest build first; a build already listed is left alone, so a re-run
// cannot add it twice.
function addChangelogSection(changelog, build, date, notes) {
  if (new RegExp(`^## Build ${build} `, 'm').test(changelog)) return changelog;
  const section = `## Build ${build} — ${date}\n\n${notes.map((n) => `- #${n.issue}: ${n.description}\n`).join('')}`;
  const firstBuild = changelog.search(/^## Build /m);
  if (firstBuild === -1) return `${changelog.trimEnd()}\n\n${section}`;
  return `${changelog.slice(0, firstBuild)}${section}\n${changelog.slice(firstBuild)}`;
}

if (require.main === module) {
  try {
    let notes;
    if (process.argv[2] === '--changelog') {
      const [, , , build, date, json] = process.argv;
      const file = path.join(__dirname, '..', 'CHANGELOG.md');
      fs.writeFileSync(file, addChangelogSection(fs.readFileSync(file, 'utf8'), Number(build), date, JSON.parse(json)));
      return;
    }
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

module.exports = { parseReleaseNotes, newReleaseNotes, addChangelogSection };
