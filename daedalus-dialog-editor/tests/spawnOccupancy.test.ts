import { countSpawnCalls, occupancyOf } from '../scripts/check-spawn-occupancy.js';

// The counting behind the measurement `check-spawn-occupancy.js` reports over a
// retail script tree (level-editor.md §16.22 q4). The script itself needs the
// corpus and a built `dist/main`; this pins what it counts, on lists small
// enough to read.

const site = (instance: string, spawnPoint: string, functionName = 'F', filePath = 'a.d') => ({
  instance,
  spawnPoint,
  filePath,
  functionName,
  line: 1
});

test('one site on one point is one point of occupancy one', () => {
  const r = occupancyOf([site('BAU_900', 'WP_A')]);
  expect(r.points).toBe(1);
  expect(r.sites).toBe(1);
  expect(r.bySites).toEqual([{ n: 1, points: 1 }]);
  expect(r.byInstances).toEqual([{ n: 1, points: 1 }]);
});

test('two different NPCs on one point is occupancy two', () => {
  const r = occupancyOf([site('BAU_900', 'WP_A'), site('BAU_901', 'WP_A')]);
  expect(r.points).toBe(1);
  expect(r.bySites).toEqual([{ n: 2, points: 1 }]);
  expect(r.byInstances).toEqual([{ n: 2, points: 1 }]);
});

test('the same NPC twice on one point is two sites but one instance', () => {
  // The distinction §16.19 slice 2 left open: nine blattcrawlers on one
  // waypoint are nine sites and one instance, and only one of those two
  // numbers is a crowd.
  const r = occupancyOf([site('BLATTCRAWLER', 'WP_A'), site('BLATTCRAWLER', 'WP_A', 'G')]);
  expect(r.bySites).toEqual([{ n: 2, points: 1 }]);
  expect(r.byInstances).toEqual([{ n: 1, points: 1 }]);
});

test('histograms are ascending in n and count points, not sites', () => {
  const r = occupancyOf([
    site('A', 'WP_1'),
    site('B', 'WP_2'), site('C', 'WP_2'),
    site('D', 'WP_3'), site('E', 'WP_3'), site('F', 'WP_3')
  ]);
  expect(r.points).toBe(3);
  expect(r.sites).toBe(6);
  expect(r.bySites).toEqual([{ n: 1, points: 1 }, { n: 2, points: 1 }, { n: 3, points: 1 }]);
});

test('the busiest points come first, by distinct instances then sites', () => {
  const r = occupancyOf([
    site('A', 'WP_QUIET'),
    site('B', 'WP_CROWD'), site('C', 'WP_CROWD'),
    site('D', 'WP_HERD'), site('D', 'WP_HERD', 'G'), site('D', 'WP_HERD', 'H')
  ]);
  expect(r.busiest.map((p: { point: string }) => p.point)).toEqual(['WP_CROWD', 'WP_HERD', 'WP_QUIET']);
  expect(r.busiest[0]).toEqual({ point: 'WP_CROWD', sites: 2, instances: 2 });
  expect(r.busiest[1]).toEqual({ point: 'WP_HERD', sites: 3, instances: 1 });
});

test('no sites is no points and empty histograms', () => {
  const r = occupancyOf([]);
  expect(r).toEqual({ points: 0, sites: 0, bySites: [], byInstances: [], busiest: [] });
});

test('the spawn calls in a source are counted case-insensitively', () => {
  expect(countSpawnCalls('Wld_InsertNpc (A,"W"); WLD_INSERTITEM(I,"W"); B_RemoveNpc(A);')).toBe(2);
});

test('a call inside an if body is counted here and not by the index', () => {
  // Measured 2026-08-29: `callSites` carries only a function body's top-level
  // calls, so 1,178 of retail's 4,084 spawn calls never reach `spawnSites`.
  // The count is what lets the report say how much of the corpus it saw.
  expect(countSpawnCalls('func void T() { if (X) { Wld_InsertNpc(B,"W"); }; };')).toBe(1);
});
