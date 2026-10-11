/**
 * Merchant/trader scaffolder: orchestration for creating a trader dialog file
 * in project mode — target file resolution, name collision handling,
 * write + index.
 * @jest-environment node
 */
import { createTraderDialogForNpc } from '../src/renderer/utils/traderDialogFactory';
import type { DialogMetadata } from '../src/renderer/types/global';

const indexWith = (entries: DialogMetadata[]): Map<string, DialogMetadata[]> => {
  const map = new Map<string, DialogMetadata[]>();
  for (const entry of entries) {
    map.set(entry.npc, [...(map.get(entry.npc) || []), entry]);
  }
  return map;
};

function makeDeps(overrides: Partial<Record<string, any>> = {}) {
  return {
    dialogIndex: indexWith([
      { dialogName: 'DIA_Bosper_Hello', npc: 'VLK_413_Bosper', filePath: 'C:/project/Dialoge/DIA_Bosper.d' }
    ]),
    projectPath: 'C:/project',
    readFile: jest.fn().mockRejectedValue(new Error('File not found')),
    writeFile: jest.fn().mockResolvedValue({ success: true }),
    addProjectFile: jest.fn(),
    getSemanticModel: jest.fn().mockResolvedValue({ dialogs: {}, functions: {} }),
    addDialogToIndex: jest.fn(),
    selectNpc: jest.fn(),
    loadAndMergeNpcModels: jest.fn(),
    ...overrides
  };
}

const CONFIG = { description: 'Zeig mir Deine Waren.' };

describe('createTraderDialogForNpc', () => {
  test('writes the trade dialog next to the NPC dialog file and indexes it', async () => {
    const deps = makeDeps();
    const result = await createTraderDialogForNpc('VLK_413_Bosper', CONFIG, deps as any);

    expect(result).toMatchObject({
      dialogName: 'DIA_Bosper_Trade',
      filePath: 'C:/project/Dialoge/DIA_Bosper_Trade.d',
      infoFunctionName: 'DIA_Bosper_Trade_Info'
    });

    const [writtenPath, content] = deps.writeFile.mock.calls[0];
    expect(writtenPath).toBe('C:/project/Dialoge/DIA_Bosper_Trade.d');
    expect(content).toContain('INSTANCE DIA_Bosper_Trade (C_INFO)');
    expect(content).toContain('trade\t\t= TRUE;');
    expect(content).toContain('B_GiveTradeInv (self);');

    expect(deps.addProjectFile).toHaveBeenCalledWith('C:/project/Dialoge/DIA_Bosper_Trade.d');
    expect(deps.getSemanticModel).toHaveBeenCalledWith('C:/project/Dialoge/DIA_Bosper_Trade.d');
    expect(deps.addDialogToIndex).toHaveBeenCalledWith({
      dialogName: 'DIA_Bosper_Trade',
      npc: 'VLK_413_Bosper',
      filePath: 'C:/project/Dialoge/DIA_Bosper_Trade.d'
    });
    expect(deps.selectNpc).toHaveBeenCalledWith('VLK_413_Bosper');
    expect(deps.loadAndMergeNpcModels).toHaveBeenCalledWith('VLK_413_Bosper');
  });

  test('appends a numeric suffix when the Trade name is taken (case-insensitively)', async () => {
    const deps = makeDeps({
      dialogIndex: indexWith([
        { dialogName: 'DIA_BOSPER_TRADE', npc: 'VLK_413_Bosper', filePath: 'C:/project/Dialoge/DIA_Bosper.d' }
      ])
    });

    const result = await createTraderDialogForNpc('VLK_413_Bosper', CONFIG, deps as any);
    expect(result.dialogName).toBe('DIA_Bosper_Trade_1');
    expect(deps.writeFile.mock.calls[0][1]).toContain('INSTANCE DIA_Bosper_Trade_1 (C_INFO)');
  });

  test('falls back to the project dialog directory for NPCs without dialogs', async () => {
    const deps = makeDeps();
    const result = await createTraderDialogForNpc('SLD_800_Sergio', CONFIG, deps as any);
    expect(result.filePath).toBe('C:/project/Dialoge/DIA_Sergio_Trade.d');
  });

  test('refuses to overwrite an existing file', async () => {
    const deps = makeDeps({
      readFile: jest.fn().mockResolvedValue('// already there')
    });

    await expect(createTraderDialogForNpc('VLK_413_Bosper', CONFIG, deps as any)).rejects.toThrow(/exists/i);
    expect(deps.writeFile).not.toHaveBeenCalled();
  });
});
