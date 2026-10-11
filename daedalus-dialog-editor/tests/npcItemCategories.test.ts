import { itemCategoryOf, itemCategoriesOf, itemNamesForCategory } from '../src/renderer/npc/npcItemCategories';

const models = [{ items: {
  ITAR_Misleading: { sourceText: 'INSTANCE ITAR_Misleading (C_Item)\n{\n mainflag = ITEM_KAT_NF;\n};' },
  Blade_NoPrefix: { sourceText: 'INSTANCE Blade_NoPrefix (C_Item)\n{\n mainflag = ITEM_KAT_NF;\n};' },
  Bow_NoPrefix: { sourceText: 'INSTANCE Bow_NoPrefix (C_Item)\n{\n mainflag = ITEM_KAT_FF;\n};' },
  Armor_NoPrefix: { sourceText: 'INSTANCE Armor_NoPrefix (C_Item)\n{\n mainflag = ITEM_KAT_ARMOR;\n};' },
  Mixed_Ranged: { sourceText: 'INSTANCE Mixed_Ranged (C_Item)\n{\n mainflag = ITEM_KAT_FF | ITEM_KAT_MUN;\n};' },
  Missing_Category: { sourceText: 'INSTANCE Missing_Category (C_Item)\n{ flags = ITEM_FLAG_ACTIVE; };' },
} }];

const lookup = (name: string) => ({ ITEM_KAT_NF: 1, ITEM_KAT_FF: 2, ITEM_KAT_MUN: 4, ITEM_KAT_ARMOR: 8 }[name]);

describe('NPC item categories', () => {
  it('uses mainflag categories even when item names do not follow Gothic prefixes', () => {
    const categories = itemCategoriesOf(models, lookup);
    expect([...categories].filter(([, category]) => category === 'meleeWeapon').map(([name]) => name))
      .toEqual(['ITAR_MISLEADING', 'BLADE_NOPREFIX']);
    expect([...categories].filter(([, category]) => category === 'rangedWeapon').map(([name]) => name))
      .toEqual(['BOW_NOPREFIX', 'MIXED_RANGED']);
    expect([...categories].filter(([, category]) => category === 'armor').map(([name]) => name))
      .toEqual(['ARMOR_NOPREFIX']);
    expect(itemNamesForCategory(models, 'meleeWeapon', lookup)).toEqual(['Blade_NoPrefix', 'ITAR_Misleading']);
  });

  it('reads numeric mainflag bitmasks through the project constants', () => {
    expect(itemCategoryOf('INSTANCE ITEM (C_Item)\n{\nmainflag = 6;\n};', 'rangedWeapon', lookup)).toBe(true);
    expect(itemCategoryOf('INSTANCE ITEM (C_Item)\n{\nmainflag = 6;\n};', 'armor', lookup)).toBe(false);
  });
});
