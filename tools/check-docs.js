#!/usr/bin/env node
// Mechanical enforcement of the doc rules docs/WORKFLOW.md states but nothing
// else checked:
// - docs/plans/level-editor.md §16: an issue that closes takes its subsection
//   with it, so no `### 16.x` heading may still say closed/landed.
// - every bare `§N` resolves, and no number is a heading in two members of the
//   level-editor doc set.
// Usage: node tools/check-docs.js [workflowPath] [planPath]  (paths for tests only)
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const workflowPath = process.argv[2] || path.join(root, 'docs', 'WORKFLOW.md');
const planPath = process.argv[3] || path.join(root, 'docs', 'plans', 'level-editor.md');
const failures = [];

if (fs.existsSync(planPath)) {
  // A closure is declared one of two ways, and both are checked: a status
  // suffix on the heading, or a bold "Closed/Landed ..." opening the
  // subsection's first paragraph. What no regex can decide is a subsection
  // whose halves landed separately under scattered markers - that is why the
  // convention is to mark the heading when the last half lands.
  const lines = fs.readFileSync(planPath, 'utf8').split(/\r?\n/);
  const suffix = /(?:[—–-]\s*|\()(closed|landed)(?:\s+\d{4}-\d{2}-\d{2})?\)?\s*$/i;
  const opener = /^\*\*(closed|landed)\b/i;
  lines.forEach((line, i) => {
    const m = /^### (16\.\d+)\b(.*)/.exec(line);
    if (!m) return;
    let declared = suffix.test(m[2]);
    for (let j = i + 1; !declared && j < lines.length && !/^#{2,3} /.test(lines[j]); j += 1) {
      if (!lines[j].trim()) continue;
      declared = opener.test(lines[j].trim());
      break; // only the first paragraph's opening line speaks for the section
    }
    if (declared) {
      failures.push(
        `${planPath}:${i + 1}: §16.${m[1].split('.')[1]} is marked closed/landed - a closed issue takes ` +
        'its subsection with it: route the forward facts, delete the rest; the commit is the record.'
      );
    }
  });
}

// --- Pointers resolve, and no two files claim a number -----------------------
// A bare "§N" means a section of the level-editor doc set, which is one file
// today and two after the architecture split. Two rules keep that readable:
// no number may be a heading in more than one member (so a bare pointer stays
// unambiguous), and every bare pointer must resolve to a heading that exists
// (so a flushed section cannot leave live pointers behind). A pointer into
// another document is qualified in prose - "brief §5.1", "run sheet §07", or
// the filename beside it - and those are left alone.
const DOC_SET = [planPath, path.join(root, 'docs', 'architecture', 'level-editor.md')]
  .filter((f) => fs.existsSync(f));
const CITING = [workflowPath, ...DOC_SET];
// "brief §5.1", "acceptance record §10.4", "<file>.md §10.2 and §10.4" - the
// qualifier carries across a conjunction so one filename can name two sections,
// but not across arbitrary text, which would exempt a whole line.
const QUALIFIER = /(brief|run sheet|acceptance record|\.md`?)(?:[^§]|§\d[\d.]*\s*(?:and|,)\s*)*$/i;

const headingOwner = new Map();
for (const f of DOC_SET) {
  const seen = new Set();
  for (const m of fs.readFileSync(f, 'utf8').matchAll(/^#{2,4} (\d+(?:\.\d+)*)\.?\s/gm)) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    const other = headingOwner.get(m[1]);
    if (other && other !== f) {
      failures.push(
        `§${m[1]} is a heading in both ${path.basename(other)} and ${path.basename(f)} - ` +
        'a bare pointer cannot name which, so the doc set keeps its numbers disjoint.'
      );
    } else headingOwner.set(m[1], f);
  }
}
const resolves = (n) =>
  headingOwner.has(n) || [...headingOwner.keys()].some((h) => h.startsWith(`${n}.`));

for (const f of CITING) {
  const src = fs.readFileSync(f, 'utf8').split(/\r?\n/);
  src.forEach((line, i) => {
    for (const m of line.matchAll(/§(\d+(?:\.\d+)*)/g)) {
      // The qualifier may wrap onto the previous line, so both are in the window.
      if (QUALIFIER.test(`${src[i - 1] || ''} ${line.slice(0, m.index)}`)) continue;
      if (resolves(m[1])) continue;
      failures.push(
        `${f}:${i + 1}: §${m[1]} resolves to no heading - either the section was ` +
        'flushed and this pointer needs rehoming, or it means another document and must name it.'
      );
    }
  });
}

if (failures.length) {
  for (const f of failures) console.error(`FAIL ${f}`);
  process.exit(1);
}
console.log('docs: clean');
