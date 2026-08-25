'use strict';

// T5 — pure-JS drift classifier for `normalizeWorld` dumps.
// Spec: docs/plans/level-editor-phase-0.md §3. No native code involved.

const SEVERITY = {
  identical: 0,
  'float-noise': 1,
  reordered: 2,
  'semantic-drift': 3,
  unreadable: 4, // decided by the caller (re-saved file failed to load); listed for ordering
};

const DEFAULT_EPSILON = 1e-6;

function addFinding(findings, cls, path, detail) {
  findings.push({ class: cls, path, detail });
}

// Exact first; on failure retry with relative epsilon (§3 float rule).
function compareNumbers(a, b, path, findings, epsilon) {
  if (a === b) return;
  const delta = Math.abs(a - b);
  const scale = Math.max(1, Math.abs(a), Math.abs(b));
  if (Number.isFinite(delta) && delta <= epsilon * scale) {
    addFinding(findings, 'float-noise', path, `${a} vs ${b} (within epsilon ${epsilon})`);
  } else {
    addFinding(findings, 'semantic-drift', path, `${a} vs ${b}`);
  }
}

// Generic order-sensitive deep comparison. Numbers get the float rule;
// any other mismatch is semantic-drift.
function deepCompare(a, b, path, findings, epsilon) {
  if (typeof a === 'number' && typeof b === 'number') {
    compareNumbers(a, b, path, findings, epsilon);
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      addFinding(findings, 'semantic-drift', path, `length ${a.length} vs ${b.length}`);
    }
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
      deepCompare(a[i], b[i], `${path}[${i}]`, findings, epsilon);
    }
    return;
  }
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) {
      const childPath = `${path}.${key}`;
      if (!(key in a)) {
        addFinding(findings, 'semantic-drift', childPath, 'only in re-saved dump');
      } else if (!(key in b)) {
        addFinding(findings, 'semantic-drift', childPath, 'only in original dump');
      } else {
        deepCompare(a[key], b[key], childPath, findings, epsilon);
      }
    }
    return;
  }
  if (a !== b) {
    addFinding(findings, 'semantic-drift', path, `${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
  }
}

function compareMeta(a, b, findings) {
  // date/user are writer wall-clock stamps — expected noise, ignored.
  for (const key of ['gameVersion', 'archiveFormat', 'archiveVersion']) {
    if (a[key] !== b[key]) {
      addFinding(
        findings,
        'semantic-drift',
        `meta.${key}`,
        `${JSON.stringify(a[key])} vs ${JSON.stringify(b[key])}`
      );
    }
  }
}

function vobLabel(vob) {
  return `${vob.class} "${vob.name}" (path ${vob.path})`;
}

// ORDER-SENSITIVE: the engine references VOBs by index.
function compareVobs(a, b, findings, epsilon) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    deepCompare(a[i], b[i], `vobs[${i}]`, findings, epsilon);
  }
  for (let i = n; i < a.length; i++) {
    addFinding(findings, 'semantic-drift', `vobs[${i}]`, `only in original dump: ${vobLabel(a[i])}`);
  }
  for (let i = n; i < b.length; i++) {
    addFinding(findings, 'semantic-drift', `vobs[${i}]`, `only in re-saved dump: ${vobLabel(b[i])}`);
  }
}

function multisetDiff(a, b) {
  const counts = new Map();
  for (const x of a) counts.set(x, (counts.get(x) || 0) + 1);
  for (const x of b) counts.set(x, (counts.get(x) || 0) - 1);
  const onlyA = [];
  const onlyB = [];
  for (const [x, c] of counts) {
    for (let i = 0; i < c; i++) onlyA.push(x);
    for (let i = 0; i < -c; i++) onlyB.push(x);
  }
  return { onlyA, onlyB };
}

// Order-INsensitive list of strings: same multiset, different order → reordered.
function compareStringMultiset(a, b, path, findings) {
  const { onlyA, onlyB } = multisetDiff(a, b);
  if (onlyA.length || onlyB.length) {
    const parts = [];
    if (onlyA.length) parts.push(`only in original: ${onlyA.join(', ')}`);
    if (onlyB.length) parts.push(`only in re-saved: ${onlyB.join(', ')}`);
    addFinding(findings, 'semantic-drift', path, parts.join('; '));
  } else if (JSON.stringify(a) !== JSON.stringify(b)) {
    addFinding(findings, 'reordered', path, 'same elements, different order');
  }
}

function compareBsp(a, b, findings, epsilon) {
  for (const key of ['nodeCount', 'leafCount', 'treeDepth', 'portalPolyHash', 'lightMapCount']) {
    deepCompare(a[key], b[key], `bsp.${key}`, findings, epsilon);
  }
  compareStringMultiset(a.sectorNames, b.sectorNames, 'bsp.sectorNames', findings);
}

// Waypoints: order-insensitive by name — match up by name, then compare fields.
function compareWaypoints(a, b, findings, epsilon) {
  const path = 'waynet.waypoints';
  const byNameA = new Map(a.map((wp) => [wp.name, wp]));
  const byNameB = new Map(b.map((wp) => [wp.name, wp]));
  const onlyA = a.filter((wp) => !byNameB.has(wp.name)).map((wp) => wp.name);
  const onlyB = b.filter((wp) => !byNameA.has(wp.name)).map((wp) => wp.name);
  if (onlyA.length) {
    addFinding(findings, 'semantic-drift', path, `waypoints only in original: ${onlyA.join(', ')}`);
  }
  if (onlyB.length) {
    addFinding(findings, 'semantic-drift', path, `waypoints only in re-saved: ${onlyB.join(', ')}`);
  }
  // Order check across the common names only.
  const commonA = a.map((wp) => wp.name).filter((name) => byNameB.has(name));
  const commonB = b.map((wp) => wp.name).filter((name) => byNameA.has(name));
  if (JSON.stringify(commonA) !== JSON.stringify(commonB)) {
    addFinding(findings, 'reordered', path, 'same waypoints, different order');
  }
  for (const name of commonA) {
    deepCompare(byNameA.get(name), byNameB.get(name), `${path}[${name}]`, findings, epsilon);
  }
}

// Edges: order-insensitive, each [a,b] pair itself unordered.
function compareEdges(a, b, findings) {
  const path = 'waynet.edges';
  const norm = (pair) => [...pair].sort().join(' -- ');
  const { onlyA, onlyB } = multisetDiff(a.map(norm), b.map(norm));
  if (onlyA.length || onlyB.length) {
    const parts = [];
    if (onlyA.length) parts.push(`edges only in original: ${onlyA.join('; ')}`);
    if (onlyB.length) parts.push(`edges only in re-saved: ${onlyB.join('; ')}`);
    addFinding(findings, 'semantic-drift', path, parts.join('; '));
  } else if (JSON.stringify(a) !== JSON.stringify(b)) {
    addFinding(findings, 'reordered', path, 'same edge set, different order');
  }
}

// Archive-container facts (lib/container.js) are byte-level: ANY difference is
// semantic-drift — epsilon 0 so a number is never float-noise, and every array
// is order-sensitive so nothing is ever `reordered`. The only benign values
// are the header `date`/`user` writer stamps.
function compareContainer(a, b, findings) {
  if (a === undefined && b === undefined) return;
  if (a === undefined || b === undefined) {
    addFinding(findings, 'semantic-drift', 'container', a === undefined ? 'only in re-saved dump' : 'only in original dump');
    return;
  }
  const strip = ({ header: { date: _date, user: _user, ...header }, ...rest }) => ({ ...rest, header });
  deepCompare(strip(a), strip(b), 'container', findings, 0);
}

function covers(container) {
  return !!container && container.covered !== false;
}

function classifyDumps(originalDump, resavedDump, options = {}) {
  const epsilon = options.epsilon !== undefined ? options.epsilon : DEFAULT_EPSILON;
  const findings = [];

  compareMeta(originalDump.meta, resavedDump.meta, findings);
  compareVobs(originalDump.vobs, resavedDump.vobs, findings, epsilon);
  deepCompare(originalDump.mesh, resavedDump.mesh, 'mesh', findings, epsilon);
  compareBsp(originalDump.bsp, resavedDump.bsp, findings, epsilon);
  compareWaypoints(originalDump.waynet.waypoints, resavedDump.waynet.waypoints, findings, epsilon);
  compareEdges(originalDump.waynet.edges, resavedDump.waynet.edges, findings);
  compareContainer(originalDump.container, resavedDump.container, findings);

  // Whether the container instrument actually looked. `identical` on a pair it
  // could not read is a claim about the struct dump alone, and the caller must
  // be able to tell that apart from a fully instrumented `identical`.
  const containerCoverage =
    covers(originalDump.container) && covers(resavedDump.container);

  let classification = 'identical';
  for (const finding of findings) {
    if (SEVERITY[finding.class] > SEVERITY[classification]) {
      classification = finding.class;
    }
  }
  return { classification, findings, containerCoverage };
}

module.exports = { classifyDumps, SEVERITY };
