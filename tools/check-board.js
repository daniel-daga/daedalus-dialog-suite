#!/usr/bin/env node
// Mechanical enforcement of two flush rules the docs state but nothing checked:
// - docs/BOARD.md: Now + Next + Done together stay under the line budget
//   (Deferred and Triage are budgeted separately, by the board's own rule).
// - docs/plans/level-editor.md §16: a card that closes takes its subsection
//   with it, so no `### 16.x` heading may still say closed/landed.
// Usage: node tools/check-board.js [boardPath] [planPath]  (paths for tests only)
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const boardPath = process.argv[2] || path.join(root, 'docs', 'BOARD.md');
const planPath = process.argv[3] || path.join(root, 'docs', 'plans', 'level-editor.md');
const failures = [];

const BUDGET = 80;
const counted = new Set(['## Now', '## Next', '## Done']);
let inCounted = false;
let cardLines = 0;
for (const line of fs.readFileSync(boardPath, 'utf8').split(/\r?\n/)) {
  if (/^## /.test(line)) inCounted = counted.has(line.trim());
  else if (inCounted) cardLines += 1;
}
if (cardLines > BUDGET) {
  failures.push(
    `${boardPath}: Now+Next+Done hold ${cardLines} lines (budget ${BUDGET}). ` +
    'The fix is never to compress a card - move its prose to its home and leave the pointer.'
  );
} else {
  console.log(`board: Now+Next+Done ${cardLines}/${BUDGET} lines`);
}

if (fs.existsSync(planPath)) {
  fs.readFileSync(planPath, 'utf8').split(/\r?\n/).forEach((line, i) => {
    const m = /^### (16\.\d+)\b(.*)/.exec(line);
    if (m && /(?:[—–-]\s*|\()(closed|landed)(?:\s+\d{4}-\d{2}-\d{2})?\)?\s*$/i.test(m[2])) {
      failures.push(
        `${planPath}:${i + 1}: §${m[1]} is marked closed/landed - a closed card takes ` +
        'its subsection with it: route the forward facts, delete the rest; the commit is the record.'
      );
    }
  });
}

if (failures.length) {
  for (const f of failures) console.error(`FAIL ${f}`);
  process.exit(1);
}
console.log('board: clean');
