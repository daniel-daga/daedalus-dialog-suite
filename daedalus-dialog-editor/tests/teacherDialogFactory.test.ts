/**
 * Issue #147: orchestration for creating a teacher dialog file in project
 * mode — target file resolution, name collision handling, write + index.
 * @jest-environment node
 */
import { createTeacherDialogForNpc } from '../src/renderer/utils/teacherDialogFactory';
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
      { dialogName: 'DIA_Alrik_Hello', npc: 'VLK_438_Alrik', filePath: 'C:/project/Dialoge/DIA_Alrik.d' }
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

const CONFIG = { skillId: '1H' as const, maxLevel: 30, description: 'Trainier mich im Schwertkampf!' };

describe('createTeacherDialogForNpc', () => {
  test('writes the teach dialog next to the NPC dialog file and indexes it', async () => {
    const deps = makeDeps();
    const result = await createTeacherDialogForNpc('VLK_438_Alrik', CONFIG, deps as any);

    expect(result).toMatchObject({
      dialogName: 'DIA_Alrik_Teach',
      filePath: 'C:/project/Dialoge/DIA_Alrik_Teach.d',
      infoFunctionName: 'DIA_Alrik_Teach_Info'
    });

    const [writtenPath, content] = deps.writeFile.mock.calls[0];
    expect(writtenPath).toBe('C:/project/Dialoge/DIA_Alrik_Teach.d');
    expect(content).toContain('INSTANCE DIA_Alrik_Teach (C_INFO)');
    expect(content).toContain('B_TeachFightTalentPercent (self, other, NPC_TALENT_1H, 1, 30);');

    expect(deps.addProjectFile).toHaveBeenCalledWith('C:/project/Dialoge/DIA_Alrik_Teach.d');
    expect(deps.getSemanticModel).toHaveBeenCalledWith('C:/project/Dialoge/DIA_Alrik_Teach.d');
    expect(deps.addDialogToIndex).toHaveBeenCalledWith({
      dialogName: 'DIA_Alrik_Teach',
      npc: 'VLK_438_Alrik',
      filePath: 'C:/project/Dialoge/DIA_Alrik_Teach.d'
    });
    expect(deps.selectNpc).toHaveBeenCalledWith('VLK_438_Alrik');
    expect(deps.loadAndMergeNpcModels).toHaveBeenCalledWith('VLK_438_Alrik');
  });

  test('appends the skill id when the plain Teach name is taken', async () => {
    const deps = makeDeps({
      dialogIndex: indexWith([
        { dialogName: 'DIA_Alrik_Teach', npc: 'VLK_438_Alrik', filePath: 'C:/project/Dialoge/DIA_Alrik.d' }
      ])
    });

    const result = await createTeacherDialogForNpc('VLK_438_Alrik', CONFIG, deps as any);
    expect(result.dialogName).toBe('DIA_Alrik_Teach_1H');
    expect(deps.writeFile.mock.calls[0][1]).toContain('INSTANCE DIA_Alrik_Teach_1H (C_INFO)');
  });

  test('falls back to the project dialog directory for NPCs without dialogs', async () => {
    const deps = makeDeps();
    const result = await createTeacherDialogForNpc('SLD_800_Sergio', CONFIG, deps as any);
    // Most dialogs live in C:/project/Dialoge
    expect(result.filePath).toBe('C:/project/Dialoge/DIA_Sergio_Teach.d');
  });

  test('refuses to overwrite an existing file', async () => {
    const deps = makeDeps({
      readFile: jest.fn().mockResolvedValue('// already there')
    });

    await expect(createTeacherDialogForNpc('VLK_438_Alrik', CONFIG, deps as any)).rejects.toThrow(/exists/i);
    expect(deps.writeFile).not.toHaveBeenCalled();
  });
});
