import type { NpcBodyRequest } from '../../shared/worldTypes';
import type { NpcDefinition, SemanticModel, SpawnSite } from '../../shared/types';
import { npcBodyRequest, resolveNpcVisual } from './npcVisual';

/** Resolve the visual requests for NPCs that the project places at waypoints. */
export async function spawnNpcBodyRequests(
  spawns: readonly SpawnSite[],
  models: readonly SemanticModel[],
  extractNpc: (sourceText: string) => Promise<NpcDefinition>,
): Promise<Map<string, NpcBodyRequest>> {
  const wanted = new Set(spawns.map((site) => site.instance.toUpperCase()));
  const sourceByName = new Map<string, string>();
  const constants = new Map<string, number>();
  const itemSources = new Map<string, string>();

  for (const model of models) {
    for (const [name, instance] of Object.entries(model.instances ?? {})) {
      const upper = name.toUpperCase();
      if (wanted.has(upper) && instance.sourceText) sourceByName.set(upper, instance.sourceText);
    }
    for (const [name, constant] of Object.entries(model.constants ?? {})) {
      const value = Number(constant.value);
      if (typeof constant.value !== 'boolean' && Number.isInteger(value)) constants.set(name.toUpperCase(), value);
    }
    for (const [name, item] of Object.entries(model.items ?? {})) {
      if (item.sourceText) itemSources.set(name.toUpperCase(), item.sourceText);
    }
  }

  const entries = await Promise.all([...sourceByName].map(async ([name, sourceText]) => {
    try {
      const definition = await extractNpc(sourceText);
      const resolved = resolveNpcVisual(definition, (constant) => constants.get(constant.toUpperCase()));
      if (!resolved.ok) return null;
      const body = npcBodyRequest(resolved.visual, (item) => itemSources.get(item.toUpperCase()));
      return [name, body.request] as const;
    } catch {
      // An NPC without a parseable/vanilla visual remains on the existing dummy.
      return null;
    }
  }));

  return new Map(entries.filter((entry): entry is readonly [string, NpcBodyRequest] => entry !== null));
}
