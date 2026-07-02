/**
 * Issue #141: when a new NPC .d file appears in the project (dropped into the
 * NPC folder), the editor auto-creates a DIA_<NPC>.d file with the standard
 * EXIT dialog boilerplate every NPC needs.
 *
 * These tests cover the pure planning/template layer; the file-watcher wiring
 * is covered in useFileWatcher.test.ts.
 * @jest-environment node
 */
import {
  deriveExitDialogName,
  createExitDialogTemplate,
  planExitDialogsForAddedFile
} from '../src/renderer/utils/npcExitDialog';
import type { DialogMetadata, SemanticModel } from '../src/renderer/types/global';

const emptyModel = (): SemanticModel => ({
  dialogs: {},
  functions: {},
  constants: {},
  variables: {},
  instances: {},
  items: {},
  npcs: {},
  animations: {},
  hasErrors: false,
  errors: []
});

const npcModel = (name: string, parent: string): SemanticModel => ({
  ...emptyModel(),
  instances: { [name]: { name, parent } as any }
});

const indexWith = (entries: DialogMetadata[]): Map<string, DialogMetadata[]> => {
  const map = new Map<string, DialogMetadata[]>();
  for (const entry of entries) {
    map.set(entry.npc, [...(map.get(entry.npc) || []), entry]);
  }
  return map;
};

describe('deriveExitDialogName', () => {
  test('uses the short name after the GUILD_ID prefix', () => {
    expect(deriveExitDialogName('VLK_99099_Robert')).toBe('DIA_Robert_EXIT');
    expect(deriveExitDialogName('NONE_100_Xardas')).toBe('DIA_Xardas_EXIT');
  });

  test('keeps underscored name parts after the numeric id', () => {
    expect(deriveExitDialogName('SLD_800_Sergio_der_Lange')).toBe('DIA_Sergio_der_Lange_EXIT');
  });

  test('falls back to the full instance name without a GUILD_ID prefix', () => {
    expect(deriveExitDialogName('Greg')).toBe('DIA_Greg_EXIT');
  });
});

describe('createExitDialogTemplate', () => {
  const template = createExitDialogTemplate('VLK_99099_Robert');

  test('contains the standard EXIT dialog boilerplate from issue #141', () => {
    expect(template).toContain('INSTANCE DIA_Robert_EXIT (C_INFO)');
    expect(template).toContain('npc\t\t\t= VLK_99099_Robert;');
    expect(template).toContain('nr\t\t\t= 999;');
    expect(template).toContain('condition\t= DIA_Robert_EXIT_Condition;');
    expect(template).toContain('information\t= DIA_Robert_EXIT_Info;');
    expect(template).toContain('description\t= "ENDE";');
    expect(template).toContain('permanent\t= TRUE;');
    expect(template).toContain('FUNC INT DIA_Robert_EXIT_Condition()');
    expect(template).toContain('return TRUE;');
    expect(template).toContain('FUNC VOID DIA_Robert_EXIT_Info()');
    expect(template).toContain('AI_StopProcessInfos (self);');
  });

  test('parses with the real Daedalus parser into a valid dialog', () => {
    // The native tree-sitter binding cannot be loaded into more than one Jest
    // module registry per worker process (ProjectService.test.ts already loads
    // it inline), so the parse runs in a child process instead.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { execFileSync } = require('child_process');
    const parserPath = require.resolve('daedalus-parser');
    const visitorPath = require.resolve('daedalus-parser/semantic-visitor');
    const script = `
      let src = '';
      process.stdin.on('data', (d) => { src += d; });
      process.stdin.on('end', () => {
        const DaedalusParser = require(${JSON.stringify(parserPath)});
        const { SemanticModelBuilderVisitor } = require(${JSON.stringify(visitorPath)});
        const result = new DaedalusParser().parse(src);
        const visitor = new SemanticModelBuilderVisitor();
        visitor.pass1_createObjects(result.tree.rootNode);
        visitor.pass2_analyzeAndLink(result.tree.rootNode);
        const dialog = visitor.semanticModel.dialogs['DIA_Robert_EXIT'];
        console.log(JSON.stringify({
          hasErrors: !!result.hasErrors,
          dialogs: Object.keys(visitor.semanticModel.dialogs),
          npc: dialog && dialog.properties && dialog.properties.npc
        }));
      });
    `;
    const output = execFileSync(process.execPath, ['-e', script], {
      input: template,
      encoding: 'utf8'
    });
    const parsed = JSON.parse(output);
    expect(parsed.hasErrors).toBe(false);
    expect(parsed.dialogs).toEqual(['DIA_Robert_EXIT']);
    expect(parsed.npc).toBe('VLK_99099_Robert');
  });
});

describe('planExitDialogsForAddedFile', () => {
  const existingDialog: DialogMetadata = {
    dialogName: 'DIA_Alrik_Hello',
    npc: 'VLK_438_Alrik',
    filePath: 'C:/project/Dialoge/DIA_Alrik.d'
  };

  test('plans an EXIT dialog for an NPC instance derived from a known prototype', () => {
    const plans = planExitDialogsForAddedFile({
      model: npcModel('VLK_99099_Robert', 'Npc_Default'),
      addedFilePath: 'C:/project/NPC/VLK_99099_Robert.d',
      npcPrototypes: ['NPC_DEFAULT'],
      dialogIndex: indexWith([existingDialog])
    });

    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({
      npcName: 'VLK_99099_Robert',
      dialogName: 'DIA_Robert_EXIT',
      // Written into the directory where the project's dialogs live
      filePath: 'C:/project/Dialoge/DIA_VLK_99099_Robert.d'
    });
    expect(plans[0].content).toContain('INSTANCE DIA_Robert_EXIT (C_INFO)');
  });

  test('plans an EXIT dialog for a direct C_NPC instance without prototype data', () => {
    const plans = planExitDialogsForAddedFile({
      model: npcModel('SLD_201_Blacksmith', 'C_NPC'),
      addedFilePath: 'C:/project/NPC/SLD_201_Blacksmith.d',
      npcPrototypes: [],
      dialogIndex: new Map()
    });

    expect(plans).toHaveLength(1);
    // No dialog files known yet — fall back to the NPC file's directory
    expect(plans[0].filePath).toBe('C:/project/NPC/DIA_SLD_201_Blacksmith.d');
  });

  test('skips NPCs that already have dialogs', () => {
    const plans = planExitDialogsForAddedFile({
      model: npcModel('VLK_438_Alrik', 'Npc_Default'),
      addedFilePath: 'C:/project/NPC/VLK_438_Alrik.d',
      npcPrototypes: ['NPC_DEFAULT'],
      dialogIndex: indexWith([existingDialog])
    });

    expect(plans).toHaveLength(0);
  });

  test('ignores instances that are not NPCs', () => {
    const plans = planExitDialogsForAddedFile({
      model: npcModel('ItMi_Special', 'C_ITEM'),
      addedFilePath: 'C:/project/Items/ItMi_Special.d',
      npcPrototypes: ['NPC_DEFAULT'],
      dialogIndex: new Map()
    });

    expect(plans).toHaveLength(0);
  });

  test('falls back to the full instance name when the short EXIT name is taken', () => {
    const otherRobertsExit: DialogMetadata = {
      dialogName: 'DIA_Robert_EXIT',
      npc: 'SLD_500_Robert',
      filePath: 'C:/project/Dialoge/DIA_SLD_500_Robert.d'
    };

    const plans = planExitDialogsForAddedFile({
      model: npcModel('VLK_99099_Robert', 'Npc_Default'),
      addedFilePath: 'C:/project/NPC/VLK_99099_Robert.d',
      npcPrototypes: ['NPC_DEFAULT'],
      dialogIndex: indexWith([otherRobertsExit])
    });

    expect(plans).toHaveLength(1);
    expect(plans[0].dialogName).toBe('DIA_VLK_99099_Robert_EXIT');
    expect(plans[0].content).toContain('INSTANCE DIA_VLK_99099_Robert_EXIT (C_INFO)');
  });
});
