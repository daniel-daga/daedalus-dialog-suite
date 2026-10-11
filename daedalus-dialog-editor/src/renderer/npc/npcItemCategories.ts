export type NpcItemCategory = 'armor' | 'meleeWeapon' | 'rangedWeapon';

export interface NpcItemModel {
  items?: Record<string, { sourceText?: string }>;
}

const CATEGORY_FLAGS: Record<NpcItemCategory, string> = {
  armor: 'ITEM_KAT_ARMOR',
  meleeWeapon: 'ITEM_KAT_NF',
  rangedWeapon: 'ITEM_KAT_FF',
};

const unwrapped = (value: string): string => {
  let result = value.trim();
  while (result.startsWith('(') && result.endsWith(')')) result = result.slice(1, -1).trim();
  return result;
};

/** Whether an item's mainflag expression contains the requested Gothic category bit. */
export function itemCategoryOf(
  sourceText: string,
  category: NpcItemCategory,
  lookup: (name: string) => number | undefined,
): boolean {
  const expression = /^\s*mainflag\s*=\s*([^;]+)\s*;/im.exec(sourceText)?.[1];
  if (expression === undefined) return false;

  const flagName = CATEGORY_FLAGS[category];
  if (expression.split('|').some((term) => unwrapped(term).toUpperCase() === flagName)) return true;

  const terms = expression.split('|').map((term) => {
    const value = unwrapped(term);
    if (/^-?\d+$/.test(value)) return Number(value);
    return lookup(value);
  });
  const flag = lookup(flagName);
  if (flag === undefined || terms.some((value) => value === undefined)) return false;
  const combined = (terms as number[]).reduce((value, term) => value | term, 0);
  return (combined & flag) !== 0;
}

/** Index project items by their declared category; item names carry no meaning here. */
export function itemCategoriesOf(
  models: readonly NpcItemModel[],
  lookup: (name: string) => number | undefined,
): Map<string, NpcItemCategory> {
  const categories = new Map<string, NpcItemCategory>();
  for (const model of models) {
    for (const [name, item] of Object.entries(model.items ?? {})) {
      if (!item.sourceText) continue;
      const category = (Object.keys(CATEGORY_FLAGS) as NpcItemCategory[])
        .find((candidate) => itemCategoryOf(item.sourceText!, candidate, lookup));
      if (category) categories.set(name.toUpperCase(), category);
    }
  }
  return categories;
}

/** Original item names for one declared category, ordered for autocomplete. */
export function itemNamesForCategory(
  models: readonly NpcItemModel[],
  category: NpcItemCategory,
  lookup: (name: string) => number | undefined,
): string[] {
  const names: string[] = [];
  for (const model of models) {
    for (const [name, item] of Object.entries(model.items ?? {})) {
      if (item.sourceText && itemCategoryOf(item.sourceText, category, lookup)) names.push(name);
    }
  }
  return [...new Set(names)].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}
