// The `P:` material check (level-editor.md §16.18, slice 1). The shapes below
// are retail shapes: measured on 2026-08-28 over OldWorld (100 `P:` materials,
// 38 sectors), NewWorld (318 / 154) and AddonWorld (154 / 154), every one of
// them `P:` uppercase, with exactly one underscore, no underscore inside a
// sector name, and not one side naming a sector the world does not have. So
// **every finding this rule can produce is absent from retail**, which is the
// only reason a finding means anything.

import { checkPortalMaterials } from '../src/validate';

const SECTORS = ['OWCAVE01', 'RICEB01', 'RICEB02'];

function check(materials: string[], sectorNames: string[] = SECTORS) {
  return checkPortalMaterials({ materials, sectorNames });
}

describe('checkPortalMaterials', () => {
  it('accepts the retail shapes: both directions, and one open side', () => {
    // `P:OWCAVE01_` and `P:_OWCAVE01` are 44 of OldWorld's 100 — a portal with
    // one side outdoors is normal, not a half-written pair.
    expect(check([
      'P:RICEB01_RICEB02',
      'P:RICEB02_RICEB01',
      'P:OWCAVE01_',
      'P:_OWCAVE01',
    ])).toEqual([]);
  });

  it('ignores materials that are not portals, including the sector ones', () => {
    expect(check(['OWODWALL', 'S:RICEB01_OCODWABIGWOODMI', 'PLANKE'])).toEqual([]);
  });

  it('reports a name with no separator', () => {
    expect(check(['P:RICEB01'])).toEqual([
      { kind: 'portal-material-malformed', material: 'P:RICEB01' },
    ]);
  });

  it('reports a name with both sides empty', () => {
    expect(check(['P:_'])).toEqual([
      { kind: 'portal-material-malformed', material: 'P:_' },
    ]);
  });

  it('reports a name with more than one separator', () => {
    // No sector name in retail contains an underscore, so a second one is not
    // a sector called `A_B` — it is a malformed name.
    expect(check(['P:RICEB01_RICEB02_RICEB01'])).toEqual([
      { kind: 'portal-material-malformed', material: 'P:RICEB01_RICEB02_RICEB01' },
    ]);
  });

  it('reports a side naming a sector the world does not have', () => {
    expect(check(['P:RICEB01_RICEB09'])).toEqual([
      { kind: 'portal-material-unknown-sector', material: 'P:RICEB01_RICEB09', sector: 'RICEB09' },
    ]);
  });

  it('reports both sides when neither names a sector', () => {
    expect(check(['P:HUT01_HUT02'])).toEqual([
      { kind: 'portal-material-unknown-sector', material: 'P:HUT01_HUT02', sector: 'HUT01' },
      { kind: 'portal-material-unknown-sector', material: 'P:HUT01_HUT02', sector: 'HUT02' },
    ]);
  });

  it('does not read a malformed name as a dangling sector as well', () => {
    expect(check(['P:RICEB09'])).toEqual([
      { kind: 'portal-material-malformed', material: 'P:RICEB09' },
    ]);
  });

  it('matches sectors and the prefix without regard to case', () => {
    // Retail is uniformly uppercase on both sides, so nothing measured says
    // ZenGin pairs case-sensitively — and claiming a case difference will not
    // pair would be a finding this rule cannot support.
    expect(check(['p:riceb01_RICEB02'])).toEqual([]);
  });

  it('reports every material, in the order the mesh indexes them', () => {
    expect(check(['P:RICEB01_HUT01', 'OWODWALL', 'P:HUT02'])).toEqual([
      { kind: 'portal-material-unknown-sector', material: 'P:RICEB01_HUT01', sector: 'HUT01' },
      { kind: 'portal-material-malformed', material: 'P:HUT02' },
    ]);
  });

  it('finds nothing in a world with no sectors and no portals', () => {
    expect(check(['OWODWALL'], [])).toEqual([]);
  });
});
