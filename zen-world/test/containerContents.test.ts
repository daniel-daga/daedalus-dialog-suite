// `oCMobContainer.contents` — the archive's `contains` string (level-editor.md
// §16.26 row 2). The grammar is what retail NewWorld/OldWorld/AddonWorld
// actually hold (294 chests, surveyed 2026-09-03): `INSTANCE[:COUNT]` entries,
// comma-separated, a count omitted for one, and — in two chests — a space
// after the comma and a `;` for a comma. Read loosely, written canonically.

import { formatContainerContents, isContainerContents, parseContainerContents } from '../src/model';

describe('parseContainerContents', () => {
  it('reads the retail spellings', () => {
    expect(parseContainerContents('ItMw_1H_VLK_Dagger,ItMi_Gold:26,ItPo_Mana_02:3')).toEqual([
      { instance: 'ItMw_1H_VLK_Dagger', count: 1 },
      { instance: 'ItMi_Gold', count: 26 },
      { instance: 'ItPo_Mana_02', count: 3 },
    ]);
    // OldWorld's "ItMi_Gold:20, ItMi_Nugget:2" and NewWorld's
    // "ItMi_Gold:32;ItPo_Health_02:3".
    expect(parseContainerContents('ItMi_Gold:20, ItMi_Nugget:2')).toEqual([
      { instance: 'ItMi_Gold', count: 20 }, { instance: 'ItMi_Nugget', count: 2 },
    ]);
    expect(parseContainerContents('ItMi_Gold:32;ItPo_Health_02:3')).toEqual([
      { instance: 'ItMi_Gold', count: 32 }, { instance: 'ItPo_Health_02', count: 3 },
    ]);
    expect(parseContainerContents('')).toEqual([]);
    expect(parseContainerContents('  ')).toEqual([]);
  });

  it('refuses what is not a list of Daedalus symbols with positive counts', () => {
    for (const bad of ['ItMi_Gold:0', 'ItMi_Gold:-1', 'ItMi_Gold:2.5', 'ItMi_Gold:', ':3', '1Gold', 'ItMi Gold', 'ItMi_Gold,,ItFo_Fish', 'ItMi_Gold:x', 'ItMi_Gold:3:4']) {
      expect(parseContainerContents(bad)).toBeNull();
      expect(isContainerContents(bad)).toBe(false);
    }
    expect(isContainerContents('ItMi_Gold:3,ItFo_Fish')).toBe(true);
  });
});

describe('formatContainerContents', () => {
  it('writes the canonical retail form: no spaces, a count only above one', () => {
    expect(formatContainerContents([
      { instance: 'ItMi_Gold', count: 26 }, { instance: 'ItFo_Fish', count: 1 },
    ])).toBe('ItMi_Gold:26,ItFo_Fish');
    expect(formatContainerContents([])).toBe('');
  });

  it('round-trips through the parser', () => {
    const entries = parseContainerContents('ItMi_Gold:20, ItMi_Nugget:2;ItFo_Fish')!;
    expect(parseContainerContents(formatContainerContents(entries))).toEqual(entries);
  });
});
