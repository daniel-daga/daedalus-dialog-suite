'use strict';

// T5 — pure-JS drift classifier (docs/plans/level-editor-phase-0.md §3, §6 T5).
// Pure data-in/data-out: no native addon required.

const test = require('node:test');
const assert = require('node:assert');
const { classifyDumps, SEVERITY } = require('../lib/classify.js');

function makeDump() {
  return {
    meta: {
      gameVersion: 'g2',
      archiveFormat: 'binsafe',
      archiveVersion: 1,
      date: '2026-08-24T10:00:00Z',
      user: 'daniel',
    },
    vobs: [
      {
        path: '0',
        class: 'zCVob',
        name: 'START_MARKER',
        position: [100.5, 0, -20.25],
        rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1],
        bbox: [90, -5, -30, 110, 5, -10],
        visual: '',
        flags: { showVisual: false, cdStatic: false },
        props: {},
        childCount: 0,
      },
      {
        path: '1',
        class: 'oCMobContainer',
        name: 'CHEST_01',
        position: [250, 12.5, 300],
        rotation: [0, 0, 1, 0, 1, 0, -1, 0, 0],
        bbox: [240, 10, 290, 260, 20, 310],
        visual: 'CHESTBIG_OCCHESTLARGE.MDS',
        flags: { showVisual: true, cdStatic: true },
        props: { contains: 'ItMi_Gold:50', locked: 1, damage: 0 },
        childCount: 0,
      },
      {
        path: '2',
        class: 'oCItem',
        name: 'SWORD_SPOT',
        position: [-40, 1, 7],
        rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1],
        bbox: [-45, 0, 2, -35, 5, 12],
        visual: 'ITMW_SWORD.3DS',
        flags: { showVisual: true, cdStatic: false },
        props: { itemInstance: 'ItMw_Sword' },
        childCount: 0,
      },
    ],
    mesh: {
      vertexCount: 1234,
      polyCount: 567,
      materials: ['STONE', 'WOOD', 'WATER'],
      vertexHash: 'sha256:aaa',
      polyHash: 'sha256:bbb',
      featureHash: 'sha256:ccc',
      bbox: [-500, -50, -500, 500, 200, 500],
    },
    bsp: {
      nodeCount: 20,
      leafCount: 11,
      treeDepth: 6,
      sectorNames: ['CAVE', 'HALL', 'TOWER'],
      portalPolyHash: 'sha256:ddd',
      lightMapCount: 3,
    },
    waynet: {
      waypoints: [
        { name: 'WP_A', position: [0, 0, 0], direction: [1, 0, 0], freePoint: false, underWater: false },
        { name: 'WP_B', position: [10, 0, 0], direction: [0, 0, 1], freePoint: false, underWater: false },
        { name: 'WP_C', position: [10, 0, 10], direction: [-1, 0, 0], freePoint: true, underWater: false },
      ],
      edges: [['WP_A', 'WP_B'], ['WP_B', 'WP_C']],
    },
  };
}

test('SEVERITY exports the full ordering including unreadable', () => {
  assert.ok(SEVERITY.identical < SEVERITY['float-noise']);
  assert.ok(SEVERITY['float-noise'] < SEVERITY.reordered);
  assert.ok(SEVERITY.reordered < SEVERITY['semantic-drift']);
  assert.ok(SEVERITY['semantic-drift'] < SEVERITY.unreadable);
});

test('identical dumps classify as identical with no findings', () => {
  const a = makeDump();
  const b = makeDump();
  const result = classifyDumps(a, b);
  assert.strictEqual(result.classification, 'identical');
  assert.deepStrictEqual(result.findings, []);
});

test('meta date/user differences are ignored', () => {
  const a = makeDump();
  const b = makeDump();
  b.meta.date = '2026-08-25T23:59:59Z';
  b.meta.user = 'somebody-else';
  const result = classifyDumps(a, b);
  assert.strictEqual(result.classification, 'identical');
  assert.deepStrictEqual(result.findings, []);
});

test('meta gameVersion/archiveFormat/archiveVersion differences are semantic-drift', () => {
  const a = makeDump();
  const b = makeDump();
  b.meta.gameVersion = 'g1';
  b.meta.archiveFormat = 'ascii';
  b.meta.archiveVersion = 2;
  const result = classifyDumps(a, b);
  assert.strictEqual(result.classification, 'semantic-drift');
  const paths = result.findings.map((f) => f.path);
  assert.ok(paths.includes('meta.gameVersion'));
  assert.ok(paths.includes('meta.archiveFormat'));
  assert.ok(paths.includes('meta.archiveVersion'));
  assert.ok(result.findings.every((f) => f.class === 'semantic-drift'));
});

test('a waypoint position moved within epsilon is float-noise', () => {
  const a = makeDump();
  const b = makeDump();
  b.waynet.waypoints[1].position[0] = 10 + 1e-8;
  const result = classifyDumps(a, b);
  assert.strictEqual(result.classification, 'float-noise');
  assert.strictEqual(result.findings.length, 1);
  assert.strictEqual(result.findings[0].class, 'float-noise');
  // Waypoints are matched by name, so the finding must locate WP_B's position.
  assert.match(result.findings[0].path, /waynet\.waypoints\[WP_B\]\.position\[0\]|waynet\.waypoints\[1\]\.position\[0\]/);
});

test('a float moved outside epsilon is semantic-drift', () => {
  const a = makeDump();
  const b = makeDump();
  b.vobs[1].position[2] = 300.01; // relative delta ~3.3e-5 >> 1e-6
  const result = classifyDumps(a, b);
  assert.strictEqual(result.classification, 'semantic-drift');
  assert.strictEqual(result.findings.length, 1);
  assert.strictEqual(result.findings[0].class, 'semantic-drift');
  assert.strictEqual(result.findings[0].path, 'vobs[1].position[2]');
});

test('options.epsilon overrides the default relative epsilon', () => {
  const a = makeDump();
  const b = makeDump();
  b.vobs[1].position[2] = 300.01; // outside 1e-6, inside 1e-3
  const loose = classifyDumps(a, b, { epsilon: 1e-3 });
  assert.strictEqual(loose.classification, 'float-noise');
  const tight = classifyDumps(a, b, { epsilon: 1e-9 });
  assert.strictEqual(tight.classification, 'semantic-drift');
});

test('reordered waynet edges (including a flipped pair) are reordered', () => {
  const a = makeDump();
  const b = makeDump();
  b.waynet.edges = [['WP_C', 'WP_B'], ['WP_A', 'WP_B']]; // reordered list + flipped pair
  const result = classifyDumps(a, b);
  assert.strictEqual(result.classification, 'reordered');
  assert.strictEqual(result.findings.length, 1);
  assert.strictEqual(result.findings[0].class, 'reordered');
  assert.strictEqual(result.findings[0].path, 'waynet.edges');
});

test('an edge present in only one dump is semantic-drift', () => {
  const a = makeDump();
  const b = makeDump();
  b.waynet.edges = [['WP_A', 'WP_B'], ['WP_A', 'WP_C']];
  const result = classifyDumps(a, b);
  assert.strictEqual(result.classification, 'semantic-drift');
  const finding = result.findings.find((f) => f.path === 'waynet.edges');
  assert.ok(finding);
  assert.strictEqual(finding.class, 'semantic-drift');
});

test('a reordered material list is semantic-drift (order-sensitive)', () => {
  const a = makeDump();
  const b = makeDump();
  b.mesh.materials = ['WOOD', 'STONE', 'WATER'];
  const result = classifyDumps(a, b);
  assert.strictEqual(result.classification, 'semantic-drift');
  const paths = result.findings.map((f) => f.path);
  assert.ok(paths.some((p) => p.startsWith('mesh.materials')));
  assert.ok(result.findings.every((f) => f.class === 'semantic-drift'));
});

test('a dropped VOB is semantic-drift and the finding names it', () => {
  const a = makeDump();
  const b = makeDump();
  const dropped = b.vobs.splice(2, 1)[0];
  const result = classifyDumps(a, b);
  assert.strictEqual(result.classification, 'semantic-drift');
  const finding = result.findings.find((f) => f.path === 'vobs[2]');
  assert.ok(finding, 'expected a finding at vobs[2]');
  assert.strictEqual(finding.class, 'semantic-drift');
  assert.ok(
    finding.detail.includes(dropped.name) || finding.detail.includes(dropped.path),
    `detail should name the dropped vob, got: ${finding.detail}`
  );
});

test('a changed VOB flag (cdStatic true→false) is semantic-drift', () => {
  const a = makeDump();
  const b = makeDump();
  b.vobs[1].flags.cdStatic = false;
  const result = classifyDumps(a, b);
  assert.strictEqual(result.classification, 'semantic-drift');
  assert.strictEqual(result.findings.length, 1);
  assert.strictEqual(result.findings[0].path, 'vobs[1].flags.cdStatic');
  assert.strictEqual(result.findings[0].class, 'semantic-drift');
});

test('reordered VOB sequence is semantic-drift (order-sensitive)', () => {
  const a = makeDump();
  const b = makeDump();
  const tmp = b.vobs[1];
  b.vobs[1] = b.vobs[2];
  b.vobs[2] = tmp;
  const result = classifyDumps(a, b);
  assert.strictEqual(result.classification, 'semantic-drift');
  assert.ok(result.findings.some((f) => f.path.startsWith('vobs[1]')));
  assert.ok(result.findings.some((f) => f.path.startsWith('vobs[2]')));
});

test('mesh vertexHash change is semantic-drift', () => {
  const a = makeDump();
  const b = makeDump();
  b.mesh.vertexHash = 'sha256:zzz';
  const result = classifyDumps(a, b);
  assert.strictEqual(result.classification, 'semantic-drift');
  assert.strictEqual(result.findings.length, 1);
  assert.strictEqual(result.findings[0].path, 'mesh.vertexHash');
  assert.strictEqual(result.findings[0].class, 'semantic-drift');
});

test('reordered sectorNames are reordered (order-insensitive multiset)', () => {
  const a = makeDump();
  const b = makeDump();
  b.bsp.sectorNames = ['TOWER', 'CAVE', 'HALL'];
  const result = classifyDumps(a, b);
  assert.strictEqual(result.classification, 'reordered');
  assert.strictEqual(result.findings.length, 1);
  assert.strictEqual(result.findings[0].path, 'bsp.sectorNames');
  assert.strictEqual(result.findings[0].class, 'reordered');
});

test('sectorNames with different multiset are semantic-drift', () => {
  const a = makeDump();
  const b = makeDump();
  b.bsp.sectorNames = ['CAVE', 'HALL', 'DUNGEON'];
  const result = classifyDumps(a, b);
  assert.strictEqual(result.classification, 'semantic-drift');
  assert.strictEqual(result.findings[0].path, 'bsp.sectorNames');
});

test('reordered waypoints plus a within-epsilon move: classification reordered, both findings present', () => {
  const a = makeDump();
  const b = makeDump();
  // Reorder the waypoint list...
  b.waynet.waypoints = [b.waynet.waypoints[2], b.waynet.waypoints[0], b.waynet.waypoints[1]];
  // ...and nudge WP_C's position by 1e-7 (within epsilon).
  const wpC = b.waynet.waypoints[0];
  wpC.position[2] = 10 + 1e-7;
  const result = classifyDumps(a, b);
  assert.strictEqual(result.classification, 'reordered');
  const classes = result.findings.map((f) => f.class);
  assert.ok(classes.includes('reordered'), 'expected a reordered finding');
  assert.ok(classes.includes('float-noise'), 'expected a float-noise finding');
  const noise = result.findings.find((f) => f.class === 'float-noise');
  assert.ok(noise.path.includes('WP_C') || noise.path.includes('position'));
});

// --- container section: archive-container facts computed from the bytes ---

function makeContainer() {
  return {
    header: { lines: ['ZenGin Archive', 'ver 1', 'zCArchiverBinSafe', 'BIN_SAFE', 'saveGame 0', 'date', 'user', 'END'], date: '', user: 'Daniel' },
    hashTable: { count: 2, keys: [{ key: 'childs0', index: 0, hash: 86 }, { key: 'pack', index: 1, hash: 5 }], physicalOrder: 'sha256:aaa' },
    frames: { total: 3, sequenceHash: 'sha256:bbb', classes: { zCVob: { count: 2, versions: { 52224: 2 } } } },
    schemas: { zCVob: { entries: [['pack', 'INTEGER'], ['dataRaw', 'RAW']], objects: 2, deviating: 0 } },
    stream: { binSafeVersion: 2, declaredObjectCount: 3, events: 20, objects: 3, maxDepth: 2, endsAtHashTable: true },
    payloads: { raw: { 'zCVob/dataRaw': 'sha256:ccc' }, bool: { 'zCVob/showVisual': 'sha256:ddd' } },
    meshAndBsp: { bspVersion: 0x04090000, size: 900, chunks: [{ id: '0xb000', length: 34, sha256: 'sha256:eee' }], trailing: '' },
  };
}

function makeDumpWithContainer() {
  const dump = makeDump();
  dump.container = makeContainer();
  return dump;
}

test('identical container sections classify identical', () => {
  const result = classifyDumps(makeDumpWithContainer(), makeDumpWithContainer());
  assert.strictEqual(result.classification, 'identical');
  assert.deepStrictEqual(result.findings, []);
});

test('container header date/user values are benign metadata', () => {
  const a = makeDumpWithContainer();
  const b = makeDumpWithContainer();
  b.container.header.date = '25.8.2026 10:00:00';
  b.container.header.user = 'somebody-else';
  const result = classifyDumps(a, b);
  assert.strictEqual(result.classification, 'identical');
  assert.deepStrictEqual(result.findings, []);
});

test('a differing hash-table physical order is semantic-drift naming container.hashTable.physicalOrder', () => {
  const a = makeDumpWithContainer();
  const b = makeDumpWithContainer();
  b.container.hashTable.physicalOrder = 'sha256:zzz';
  const result = classifyDumps(a, b);
  assert.strictEqual(result.classification, 'semantic-drift');
  assert.deepStrictEqual(result.findings.map((f) => [f.class, f.path]), [
    ['semantic-drift', 'container.hashTable.physicalOrder'],
  ]);
});

test('a numeric container difference within epsilon is still semantic-drift, never float-noise', () => {
  const a = makeDumpWithContainer();
  const b = makeDumpWithContainer();
  b.container.stream.events = 20 + 1e-9;
  const result = classifyDumps(a, b);
  assert.strictEqual(result.classification, 'semantic-drift');
  assert.deepStrictEqual(result.findings.map((f) => [f.class, f.path]), [
    ['semantic-drift', 'container.stream.events'],
  ]);
});

test('reordered container arrays are semantic-drift, never reordered', () => {
  const a = makeDumpWithContainer();
  const b = makeDumpWithContainer();
  b.container.header.lines = ['ZenGin Archive', 'ver 1', 'BIN_SAFE', 'zCArchiverBinSafe', 'saveGame 0', 'date', 'user', 'END'];
  b.container.hashTable.keys.reverse();
  const result = classifyDumps(a, b);
  assert.strictEqual(result.classification, 'semantic-drift');
  assert.ok(result.findings.every((f) => f.class === 'semantic-drift'));
  const paths = result.findings.map((f) => f.path);
  assert.ok(paths.includes('container.header.lines[2]'));
  assert.ok(paths.some((p) => p.startsWith('container.hashTable.keys[0]')));
});

test('a MeshAndBsp chunk hash difference names the chunk index', () => {
  const a = makeDumpWithContainer();
  const b = makeDumpWithContainer();
  b.container.meshAndBsp.chunks[0].sha256 = 'sha256:fff';
  const result = classifyDumps(a, b);
  assert.strictEqual(result.classification, 'semantic-drift');
  assert.strictEqual(result.findings[0].path, 'container.meshAndBsp.chunks[0].sha256');
});

test('a container section present on only one side is semantic-drift', () => {
  const result = classifyDumps(makeDump(), makeDumpWithContainer());
  assert.strictEqual(result.classification, 'semantic-drift');
  assert.strictEqual(result.findings[0].path, 'container');
});

test('a waypoint missing from one dump is semantic-drift naming the waypoint', () => {
  const a = makeDump();
  const b = makeDump();
  b.waynet.waypoints = b.waynet.waypoints.filter((wp) => wp.name !== 'WP_B');
  const result = classifyDumps(a, b);
  assert.strictEqual(result.classification, 'semantic-drift');
  const finding = result.findings.find((f) => f.class === 'semantic-drift');
  assert.ok(finding.path.startsWith('waynet.waypoints'));
  assert.ok(finding.detail.includes('WP_B'));
});

// binding review 2026-08-29, finding 4: `null` is the one "no container" value
// the library produces — normalizeWorld emits it for a handle that has been
// mutated — and compareContainer's early return tested `=== undefined` only, so
// `strip`'s destructuring threw `Cannot destructure property 'header' of null`.
// `covers()` four lines below already handled null explicitly.
test('a null container is no container, not a crash', () => {
  const a = makeDumpWithContainer();
  const b = makeDumpWithContainer();
  a.container = null;
  b.container = null;

  const result = classifyDumps(a, b);
  assert.strictEqual(result.classification, 'identical');
  assert.deepStrictEqual(result.findings, []);
  assert.strictEqual(result.containerCoverage, false);
});

test('a container present on one side and null on the other is semantic-drift', () => {
  const withNull = makeDumpWithContainer();
  withNull.container = null;

  const result = classifyDumps(withNull, makeDumpWithContainer());
  assert.strictEqual(result.classification, 'semantic-drift');
  assert.strictEqual(result.findings[0].path, 'container');
  assert.strictEqual(result.containerCoverage, false);
});
