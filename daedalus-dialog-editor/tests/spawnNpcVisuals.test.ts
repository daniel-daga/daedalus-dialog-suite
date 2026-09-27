import { spawnNpcBodyRequests } from '../src/renderer/npc/spawnNpcVisuals';
import type { NpcDefinition, SemanticModel, SpawnSite } from '../src/shared/types';

const call = (name: string, ...args: string[]) => ({
  kind: 'call' as const, name, args, text: '', range: { startIndex: 0, endIndex: 0 },
  argsRange: { startIndex: 0, endIndex: 0 },
});

const visualNpc: NpcDefinition = {
  name: 'PC_TEST', parent: 'C_NPC', closingBraceIndex: 0,
  statements: [
    call('Mdl_SetVisual', 'self', '"HUMANS.MDS"'),
    call('Mdl_SetVisualBody', 'self', '"hum_body_Naked0"', 'BodyTex_N', '0',
      '"Hum_Head_Pony"', 'FACE_N', '0', 'ITAR_MIL_L'),
  ],
};

const site = (instance: string, spawnPoint = 'WP_START'): SpawnSite => ({
  instance, spawnPoint, filePath: 'NPCS.D', functionName: 'STARTUP_TEST', line: 1,
});

test('resolves only spawned NPCs and uses project constants and armor source text', async () => {
  const model = {
    dialogs: {}, functions: {}, hasErrors: false, errors: [],
    instances: { PC_TEST: { name: 'PC_TEST', parent: 'C_NPC', sourceText: 'npc source' } },
    constants: {
      BodyTex_N: { name: 'BodyTex_N', type: 'int', value: 1 },
      FACE_N: { name: 'FACE_N', type: 'int', value: 18 },
    },
    items: {
      ITAR_MIL_L: {
        name: 'ITAR_MIL_L', parent: 'C_Item', sourceText: 'visual_change = "Armor_Mil_L.asc";',
      },
    },
  } as SemanticModel;
  const extractNpc = jest.fn(async () => visualNpc);

  const requests = await spawnNpcBodyRequests([site('PC_TEST')], [model], extractNpc);

  expect(extractNpc).toHaveBeenCalledTimes(1);
  expect(extractNpc).toHaveBeenCalledWith('npc source');
  expect(requests.get('PC_TEST')).toEqual({
    model: 'HUMANS.MDS', body: 'Armor_Mil_L.asc', bodyTexture: 1, skinColor: 0,
    head: 'Hum_Head_Pony', headTexture: 18, teethTexture: 0, fatness: 0, scale: [1, 1, 1],
  });
});

test('leaves undeclared or unresolvable NPCs for the dummy fallback', async () => {
  const requests = await spawnNpcBodyRequests([site('MISSING')], [], jest.fn());
  expect(requests.size).toBe(0);
});
