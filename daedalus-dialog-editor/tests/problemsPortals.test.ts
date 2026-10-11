/**
 * The portal rule: `zen-world`'s portal findings become Problems with a
 * world locus by polygon, carrying that polygon's corners so the World
 * surface can frame it (level-editor.md §16.20 slice 3, §16.22 q1–q3; #222).
 *
 * The checks themselves are tested where they live, in `zen-world`. What is
 * pinned here is the mapping — one rule id per finding kind, the severity,
 * the id, the locus — and that a world problem sorts after every script one.
 */

import { buildProjectView } from '../src/renderer/problems/domain/projectView';
import { runRules } from '../src/renderer/problems/domain/runRules';
import { portalsRule } from '../src/renderer/problems/domain/rules/portals';
import type { PortalFinding } from '../src/shared/worldTypes';

/** One portal face, as `getPortals` reads it — ZenGin centimetres. */
const QUAD: ReadonlyArray<readonly [number, number, number]> = [
  [10, 0, 0], [10, 100, 0], [10, 100, 100], [10, 0, 100],
];

const view = (portalFindings?: readonly PortalFinding[]) =>
  buildProjectView({ files: [], knownNpcNames: [], portalFindings });

describe('portalsRule', () => {
  it('says nothing while no world is open', () => {
    expect(portalsRule(view(undefined))).toEqual([]);
    expect(portalsRule(view([]))).toEqual([]);
  });

  it('maps each finding kind to its rule id, severity and polygon locus', () => {
    const problems = portalsRule(view([
      { kind: 'portal-material-malformed', material: 'P:_', polygon: 12, corners: QUAD },
      { kind: 'portal-material-unknown-sector', material: 'P:A_Z', sector: 'Z', polygon: 13, corners: QUAD },
      { kind: 'portal-unpaired', material: 'P:A_B', wanted: 'P:B_A', polygon: 14, corners: QUAD },
      { kind: 'portal-non-planar', material: 'P:A_B', polygon: 14, spread: 30.25, corners: QUAD },
      { kind: 'portal-reversed', material: 'P:B_A', polygon: 15, sector: 'B', corners: QUAD },
    ]));

    expect(problems).toEqual([
      {
        id: 'portal-material-malformed:P:_',
        rule: 'portal-material-malformed',
        severity: 'error',
        message: 'Portal material "P:_" is not P:<sector>_<sector>.',
        locus: { kind: 'world', polygon: 12, polygonCorners: QUAD },
      },
      {
        id: 'portal-material-unknown-sector:P:A_Z:Z',
        rule: 'portal-material-unknown-sector',
        severity: 'error',
        message: 'Portal material "P:A_Z" names sector "Z", which this world does not have.',
        locus: { kind: 'world', polygon: 13, polygonCorners: QUAD },
      },
      {
        id: 'portal-unpaired:P:A_B',
        rule: 'portal-unpaired',
        severity: 'warning',
        message: 'Portal material "P:A_B" has no mirror "P:B_A".',
        locus: { kind: 'world', polygon: 14, polygonCorners: QUAD },
      },
      {
        id: 'portal-non-planar:14',
        rule: 'portal-non-planar',
        severity: 'warning',
        message: 'Portal polygon 14 ("P:A_B") is 30.3 units off its own plane; retail stays within 12.1.',
        locus: { kind: 'world', polygon: 14, polygonCorners: QUAD },
      },
      {
        id: 'portal-reversed:15',
        rule: 'portal-reversed',
        severity: 'warning',
        message: 'Portal polygon 15 ("P:B_A") faces away from sector "B".',
        locus: { kind: 'world', polygon: 15, polygonCorners: QUAD },
      },
    ]);
  });

  it('gives a name finding with no face a world locus with no address', () => {
    // The mesh keeps a material no polygon references; the name is still
    // wrong, and the row is listed with nothing to jump to.
    const [problem] = portalsRule(view([
      { kind: 'portal-material-malformed', material: 'P:_', polygon: null, corners: null },
    ]));
    expect(problem.locus).toEqual({ kind: 'world' });
  });

  it('emits one problem per id — a repeated material name is one row', () => {
    const problems = portalsRule(view([
      { kind: 'portal-material-malformed', material: 'P:_', polygon: 12, corners: QUAD },
      { kind: 'portal-material-malformed', material: 'P:_', polygon: 40, corners: QUAD },
    ]));
    expect(problems).toHaveLength(1);
  });
});

describe('runRules with portal findings', () => {
  it('orders a portal problem after every script problem of its severity', () => {
    const problems = runRules(buildProjectView({
      files: [],
      knownNpcNames: [],
      waypointSites: { OW_PATH_42: [{ filePath: 'Rtn.d', functionName: 'Rtn_Start_Diego' }] },
      world: { pointNameKeys: new Set(['NW_CITY_01']), freePointNames: [] },
      portalFindings: [
        { kind: 'portal-reversed', material: 'P:B_A', polygon: 15, sector: 'B', corners: QUAD },
        { kind: 'portal-material-malformed', material: 'P:_', polygon: 12, corners: QUAD },
      ],
    }));

    expect(problems.map((p) => p.rule)).toEqual([
      'portal-material-malformed', 'waypoint-not-in-world', 'portal-reversed',
    ]);
  });
});
