import type { SemanticModel } from '../types/global';
import { useProjectStore } from '../store/projectStore';
import { itemCategoriesOf, itemNamesForCategory } from './npcItemCategories';
import type { NpcFormField, NpcItemCategoryLookup } from './npcForm';

// What a form control's selectable choices come from (`NpcFormField.options`),
// read out of the project the editor holds. Shared by the NPC editor and the
// create dialog (#428) so both offer one set of values.

/** Every ingested file's semantic model — the whole project, where
 *  `mergedSemanticModel` holds only the globals and the selected NPC's files. */
export function parsedModels(): SemanticModel[] {
  return [...useProjectStore.getState().parsedFiles.values()].map((file) => file.semanticModel);
}

/** An integer constant's value in the project, by case-insensitive name. */
export function projectConstantLookup(): (name: string) => number | undefined {
  const values = new Map<string, number>();
  for (const model of parsedModels()) {
    for (const [name, constant] of Object.entries(model.constants ?? {})) {
      const value = Number(constant.value);
      if (typeof constant.value !== 'boolean' && Number.isInteger(value)) values.set(name.toUpperCase(), value);
    }
  }
  return (name) => values.get(name.toUpperCase());
}

/** A project item instance name to its parsed mainflag category. */
export function projectItemCategoryLookup(): NpcItemCategoryLookup {
  const categories = itemCategoriesOf(parsedModels(), projectConstantLookup());
  return (instance) => categories.get(instance.toUpperCase());
}

/** Values used by project NPCs, such as their numeric voice bank IDs. */
function npcFieldValues(field: string): string[] {
  const values = new Set<string>();
  for (const model of parsedModels()) {
    for (const npc of Object.values(model.npcs ?? {})) {
      const expression = new RegExp(`\\b${field}\\s*=\\s*([^;\\r\\n]+)`, 'i').exec(npc.sourceText ?? '')?.[1]?.trim();
      if (expression) values.add(expression);
    }
  }
  return [...values].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

/** The values a `NpcFormField`'s control offers. */
export function fieldOptions(field: NpcFormField): string[] {
  const { options } = field;
  if (!options) return [];
  if ('assets' in options) return [];
  if ('values' in options && !('constantPrefix' in options)) return options.values;
  if ('itemCategory' in options) {
    const names = itemNamesForCategory(parsedModels(), options.itemCategory, projectConstantLookup());
    return options.itemCategory === 'armor' ? ['NO_ARMOR', ...names] : names;
  }
  const project = useProjectStore.getState();
  if ('routines' in options) return project.routineList;
  if ('npcField' in options) return npcFieldValues(options.npcField);
  const names = 'constantPrefix' in options
    ? parsedModels().flatMap((model) => Object.keys(model.constants ?? {}))
    : parsedModels().flatMap((model) => Object.keys(model.items ?? {}));
  const prefix = ('constantPrefix' in options ? options.constantPrefix : options.itemPrefix).toUpperCase();
  const matched = names.filter((name) => name.toUpperCase().startsWith(prefix));
  const additional = 'constantPrefix' in options ? options.values ?? [] : [];
  return [...new Set([...matched, ...additional])].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}
