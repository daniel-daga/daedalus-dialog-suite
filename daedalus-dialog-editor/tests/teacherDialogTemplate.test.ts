/**
 * Issue #147 (Lehrer anlegen): generate the full teach-dialog boilerplate for
 * a fight-skill teacher — C_INFO instance, condition/info functions,
 * Info_AddChoice learn entries via B_BuildLearnString/B_GetLearnCostTalent,
 * per-step teach functions using B_TeachFightTalentPercent, and the Back
 * function with a level-gate check.
 * @jest-environment node
 */
import {
  TEACHER_SKILLS,
  TEACHER_SKILL_GROUPS,
  ALL_TEACHER_SKILLS,
  getTeacherSkill,
  skillHasMaxLevel,
  createTeacherDialogTemplate
} from '../src/renderer/utils/teacherDialogTemplate';
import { execFileSync } from 'child_process';

/**
 * Parse generated source with the real Daedalus parser in a child process
 * (same constraint as npcExitDialog.test.ts: the native tree-sitter binding
 * cannot be loaded into more than one Jest module registry per worker).
 */
function parseInChildProcess(source: string, dialogName: string) {
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
      const dialog = visitor.semanticModel.dialogs[${JSON.stringify(dialogName)}];
      console.log(JSON.stringify({
        hasErrors: !!result.hasErrors,
        dialogs: Object.keys(visitor.semanticModel.dialogs),
        functions: Object.keys(visitor.semanticModel.functions),
        npc: dialog && dialog.properties && dialog.properties.npc,
        information: dialog && dialog.properties && dialog.properties.information
      }));
    });
  `;
  const output = execFileSync(process.execPath, ['-e', script], {
    input: source,
    encoding: 'utf8'
  });
  return JSON.parse(output);
}

describe('TEACHER_SKILLS', () => {
  test('covers the four fight talents with their vanilla constants', () => {
    expect(TEACHER_SKILLS.map((s) => s.id)).toEqual(['1H', '2H', 'BOW', 'CROSSBOW']);
    expect(getTeacherSkill('1H')).toMatchObject({
      talentConstant: 'NPC_TALENT_1H',
      printConstants: ['PRINT_Learn1h1', 'PRINT_Learn1h5']
    });
    expect(getTeacherSkill('BOW')).toMatchObject({
      talentConstant: 'NPC_TALENT_BOW',
      printConstants: ['PRINT_LearnBow1', 'PRINT_LearnBow5']
    });
  });
});

describe('createTeacherDialogTemplate', () => {
  const source = createTeacherDialogTemplate({
    npcInstanceName: 'VLK_438_Alrik',
    dialogName: 'DIA_Alrik_Teach',
    skillId: '1H',
    maxLevel: 30,
    description: 'Trainier mich im Schwertkampf!'
  });

  test('emits the teach instance from the issue example', () => {
    expect(source).toContain('INSTANCE DIA_Alrik_Teach (C_INFO)');
    expect(source).toContain('npc\t\t\t= VLK_438_Alrik;');
    expect(source).toContain('condition\t= DIA_Alrik_Teach_Condition;');
    expect(source).toContain('information\t= DIA_Alrik_Teach_Info;');
    expect(source).toContain('permanent\t= TRUE;');
    expect(source).toContain('description\t= "Trainier mich im Schwertkampf!";');
  });

  test('remembers the current skill value and offers the learn choices', () => {
    expect(source).toContain('var int Alrik_Merke_1H;');
    expect(source).toContain('Alrik_Merke_1H = other.HitChance[NPC_TALENT_1H];');
    expect(source).toContain('Info_ClearChoices\t(DIA_Alrik_Teach);');
    expect(source).toContain('Info_AddChoice\t\t(DIA_Alrik_Teach, DIALOG_BACK, DIA_Alrik_Teach_Back);');
    expect(source).toContain(
      'Info_AddChoice\t\t(DIA_Alrik_Teach, B_BuildLearnString(PRINT_Learn1h1, B_GetLearnCostTalent(other, NPC_TALENT_1H, 1)), DIA_Alrik_Teach_1H_1);'
    );
    expect(source).toContain(
      'Info_AddChoice\t\t(DIA_Alrik_Teach, B_BuildLearnString(PRINT_Learn1h5, B_GetLearnCostTalent(other, NPC_TALENT_1H, 5)), DIA_Alrik_Teach_1H_5);'
    );
  });

  test('teach functions pass the configured max level to B_TeachFightTalentPercent', () => {
    expect(source).toContain('FUNC VOID DIA_Alrik_Teach_1H_1()');
    expect(source).toContain('B_TeachFightTalentPercent (self, other, NPC_TALENT_1H, 1, 30);');
    expect(source).toContain('FUNC VOID DIA_Alrik_Teach_1H_5()');
    expect(source).toContain('B_TeachFightTalentPercent (self, other, NPC_TALENT_1H, 5, 30);');
  });

  test('back function gates on the configured max level', () => {
    expect(source).toContain('FUNC VOID DIA_Alrik_Teach_Back()');
    expect(source).toContain('if (other.HitChance[NPC_TALENT_1H] >= 30)');
    expect(source).toContain('else if (other.HitChance[NPC_TALENT_1H] > Alrik_Merke_1H)');
  });

  test('uses the skill-specific constants for other skills', () => {
    const bowSource = createTeacherDialogTemplate({
      npcInstanceName: 'SLD_800_Bogenmeister',
      dialogName: 'DIA_Bogenmeister_Teach',
      skillId: 'BOW',
      maxLevel: 60,
      description: 'Lehre mich den Bogenkampf!'
    });

    expect(bowSource).toContain('B_TeachFightTalentPercent (self, other, NPC_TALENT_BOW, 1, 60);');
    expect(bowSource).toContain('B_BuildLearnString(PRINT_LearnBow5, B_GetLearnCostTalent(other, NPC_TALENT_BOW, 5))');
    expect(bowSource).toContain('Bogenmeister_Merke_BOW = other.HitChance[NPC_TALENT_BOW];');
  });

  test('sanitizes quotes and newlines in the description', () => {
    // Daedalus string literals have no escape sequences: a raw quote would
    // terminate the description literal, a newline would break the comment.
    const quoted = createTeacherDialogTemplate({
      npcInstanceName: 'VLK_438_Alrik',
      dialogName: 'DIA_Alrik_Teach',
      skillId: '1H',
      maxLevel: 30,
      description: 'Zeig mir den "echten"\nKampf!'
    });

    expect(quoted).toContain("description\t= \"Zeig mir den 'echten' Kampf!\";");
    expect(quoted).toContain("//Zeig mir den 'echten' Kampf!");
  });

  test('remember variable follows the collision-suffixed dialog name', () => {
    // A second teacher dialog (name collision resolved to DIA_..._1H) must
    // not redeclare the first dialog's global remember variable.
    const suffixed = createTeacherDialogTemplate({
      npcInstanceName: 'VLK_438_Alrik',
      dialogName: 'DIA_Alrik_Teach_1H',
      skillId: '1H',
      maxLevel: 30,
      description: 'Trainier mich im Schwertkampf!'
    });

    expect(suffixed).toContain('var int Alrik_Merke_1H_1H;');
    expect(suffixed).not.toContain('var int Alrik_Merke_1H;');
  });

  test('parses with the real Daedalus parser into the full teach dialog', () => {
    // Same constraint as npcExitDialog.test.ts: the native tree-sitter
    // binding cannot be loaded into more than one Jest module registry per
    // worker process, so the parse runs in a child process.
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
        const dialog = visitor.semanticModel.dialogs['DIA_Alrik_Teach'];
        console.log(JSON.stringify({
          hasErrors: !!result.hasErrors,
          dialogs: Object.keys(visitor.semanticModel.dialogs),
          functions: Object.keys(visitor.semanticModel.functions),
          npc: dialog && dialog.properties && dialog.properties.npc,
          information: dialog && dialog.properties && dialog.properties.information
        }));
      });
    `;
    const output = execFileSync(process.execPath, ['-e', script], {
      input: source,
      encoding: 'utf8'
    });
    const parsed = JSON.parse(output);
    expect(parsed.hasErrors).toBe(false);
    expect(parsed.dialogs).toEqual(['DIA_Alrik_Teach']);
    expect(parsed.functions).toEqual(
      expect.arrayContaining([
        'DIA_Alrik_Teach_Condition',
        'DIA_Alrik_Teach_Info',
        'DIA_Alrik_Teach_Back',
        'DIA_Alrik_Teach_1H_1',
        'DIA_Alrik_Teach_1H_5'
      ])
    );
    expect(parsed.npc).toBe('VLK_438_Alrik');
  });
});

describe('teacher skill categories (issue #147 follow-up)', () => {
  test('groups fight, attribute and one-shot talent skills', () => {
    // The original fight-only table stays intact (regression guard above);
    // the grouped table adds attribute and one-shot talent teachers.
    expect(TEACHER_SKILL_GROUPS.map((g) => g.skills.map((s) => s.id))).toEqual([
      ['1H', '2H', 'BOW', 'CROSSBOW'],
      ['STR', 'DEX', 'MANA'],
      ['HUNTING', 'ALCHEMY', 'THIEF']
    ]);
    expect(ALL_TEACHER_SKILLS.map((s) => s.id)).toEqual([
      '1H', '2H', 'BOW', 'CROSSBOW', 'STR', 'DEX', 'MANA', 'HUNTING', 'ALCHEMY', 'THIEF'
    ]);
    expect(getTeacherSkill('STR')).toMatchObject({
      category: 'attribute',
      attributeConstant: 'ATR_STRENGTH',
      printConstants: ['PRINT_LearnSTR1', 'PRINT_LearnSTR5']
    });
    expect(getTeacherSkill('MANA')).toMatchObject({ attributeConstant: 'ATR_MANA_MAX' });
  });

  test('one-shot talent teachers have no max level; leveled teachers do', () => {
    expect(skillHasMaxLevel(getTeacherSkill('1H'))).toBe(true);
    expect(skillHasMaxLevel(getTeacherSkill('STR'))).toBe(true);
    expect(skillHasMaxLevel(getTeacherSkill('HUNTING'))).toBe(false);
    expect(skillHasMaxLevel(getTeacherSkill('ALCHEMY'))).toBe(false);
    expect(skillHasMaxLevel(getTeacherSkill('THIEF'))).toBe(false);
  });
});

describe('createTeacherDialogTemplate (attribute trainer)', () => {
  const source = createTeacherDialogTemplate({
    npcInstanceName: 'VLK_438_Alrik',
    dialogName: 'DIA_Alrik_Teach',
    skillId: 'STR',
    maxLevel: 100,
    description: 'Ich will staerker werden!'
  });

  test('emits the permanent teach instance', () => {
    expect(source).toContain('INSTANCE DIA_Alrik_Teach (C_INFO)');
    expect(source).toContain('npc\t\t\t= VLK_438_Alrik;');
    expect(source).toContain('permanent\t= TRUE;');
    expect(source).toContain('description\t= "Ich will staerker werden!";');
  });

  test('remembers the attribute and offers +1/+5 via B_GetLearnCostAttribute', () => {
    // Vanilla NotR pattern (DIA_VLK_461_Carl.d): the +1 choice costs
    // B_GetLearnCostAttribute(other, ATR_...), the +5 choice five times that.
    expect(source).toContain('var int Alrik_Merke_STR;');
    expect(source).toContain('Alrik_Merke_STR = other.attribute[ATR_STRENGTH];');
    expect(source).toContain(
      'Info_AddChoice\t\t(DIA_Alrik_Teach, B_BuildLearnString(PRINT_LearnSTR1, B_GetLearnCostAttribute(other, ATR_STRENGTH)), DIA_Alrik_Teach_STR_1);'
    );
    expect(source).toContain(
      'Info_AddChoice\t\t(DIA_Alrik_Teach, B_BuildLearnString(PRINT_LearnSTR5, B_GetLearnCostAttribute(other, ATR_STRENGTH) * 5), DIA_Alrik_Teach_STR_5);'
    );
  });

  test('teach steps call B_TeachAttributePoints with the configured cap', () => {
    expect(source).toContain('FUNC VOID DIA_Alrik_Teach_STR_1()');
    expect(source).toContain('B_TeachAttributePoints (self, other, ATR_STRENGTH, 1, 100);');
    expect(source).toContain('FUNC VOID DIA_Alrik_Teach_STR_5()');
    expect(source).toContain('B_TeachAttributePoints (self, other, ATR_STRENGTH, 5, 100);');
    expect(source).not.toContain('B_TeachFightTalentPercent');
    expect(source).not.toContain('HitChance');
  });

  test('back function gates on the attribute value', () => {
    expect(source).toContain('if (other.attribute[ATR_STRENGTH] >= 100)');
    expect(source).toContain('else if (other.attribute[ATR_STRENGTH] > Alrik_Merke_STR)');
  });

  test('mana trainer uses ATR_MANA_MAX and the mana print constants', () => {
    const mana = createTeacherDialogTemplate({
      npcInstanceName: 'KDF_500_Milten',
      dialogName: 'DIA_Milten_Teach',
      skillId: 'MANA',
      maxLevel: 60,
      description: 'Ich will mein Mana erhoehen!'
    });
    expect(mana).toContain('B_TeachAttributePoints (self, other, ATR_MANA_MAX, 5, 60);');
    expect(mana).toContain('B_BuildLearnString(PRINT_LearnMANA1, B_GetLearnCostAttribute(other, ATR_MANA_MAX))');
    expect(mana).toContain('Milten_Merke_MANA = other.attribute[ATR_MANA_MAX];');
  });

  test('parses with the real Daedalus parser', () => {
    const parsed = parseInChildProcess(source, 'DIA_Alrik_Teach');
    expect(parsed.hasErrors).toBe(false);
    expect(parsed.dialogs).toEqual(['DIA_Alrik_Teach']);
    expect(parsed.functions).toEqual(
      expect.arrayContaining([
        'DIA_Alrik_Teach_Condition',
        'DIA_Alrik_Teach_Info',
        'DIA_Alrik_Teach_Back',
        'DIA_Alrik_Teach_STR_1',
        'DIA_Alrik_Teach_STR_5'
      ])
    );
    expect(parsed.npc).toBe('VLK_438_Alrik');
  });
});

describe('createTeacherDialogTemplate (one-shot talent teachers)', () => {
  const hunting = createTeacherDialogTemplate({
    npcInstanceName: 'BAU_981_Grom',
    dialogName: 'DIA_Grom_Teach',
    skillId: 'HUNTING',
    maxLevel: 0,
    description: 'Bring mir das Jagen bei.'
  });

  test('hunting teacher offers the vanilla trophy choices', () => {
    // Vanilla NotR pattern (DIA_BAU_981_Grom.d): NAME_LEARN_* labels with
    // B_GetLearnCostTalent(other, NPC_TALENT_TAKEANIMALTROPHY, TROPHY_*).
    expect(hunting).toContain(
      'Info_AddChoice\t\t(DIA_Grom_Teach, B_BuildLearnString(NAME_LEARN_FUR, B_GetLearnCostTalent(other, NPC_TALENT_TAKEANIMALTROPHY, TROPHY_Fur)), DIA_Grom_Teach_Fur);'
    );
    expect(hunting).toContain(
      'Info_AddChoice\t\t(DIA_Grom_Teach, B_BuildLearnString(NAME_LEARN_SHADOWBEAST_HORN, B_GetLearnCostTalent(other, NPC_TALENT_TAKEANIMALTROPHY, TROPHY_ShadowHorn)), DIA_Grom_Teach_ShadowHorn);'
    );
    expect(hunting).toContain('FUNC VOID DIA_Grom_Teach_Fur()');
    expect(hunting).toContain('B_TeachPlayerTalentTakeAnimalTrophy (self, other, TROPHY_Fur);');
    expect(hunting).toContain('B_TeachPlayerTalentTakeAnimalTrophy (self, other, TROPHY_Teeth);');
    expect(hunting).toContain('B_TeachPlayerTalentTakeAnimalTrophy (self, other, TROPHY_ShadowHorn);');
    // One-shot teachers have no remember variable and no level cap
    expect(hunting).not.toContain('Merke');
    expect(hunting).not.toContain('HitChance');
  });

  test('alchemy teacher offers the vanilla potion recipes', () => {
    // Vanilla NotR pattern (DIA_VLK_498_Ignaz.d)
    const alchemy = createTeacherDialogTemplate({
      npcInstanceName: 'VLK_498_Ignaz',
      dialogName: 'DIA_Ignaz_Teach',
      skillId: 'ALCHEMY',
      maxLevel: 0,
      description: 'Zeig mir, wie man Traenke braut.'
    });
    expect(alchemy).toContain(
      'Info_AddChoice\t\t(DIA_Ignaz_Teach, B_BuildLearnString(NAME_HealthPotion1, B_GetLearnCostTalent(other, NPC_TALENT_ALCHEMY, POTION_Health_01)), DIA_Ignaz_Teach_Health_1);'
    );
    expect(alchemy).toContain('B_TeachPlayerTalentAlchemy (self, other, POTION_Health_01);');
    expect(alchemy).toContain('B_TeachPlayerTalentAlchemy (self, other, POTION_Mana_03);');
    expect(alchemy).toContain('B_TeachPlayerTalentAlchemy (self, other, POTION_Speed);');
    expect(alchemy).toContain('B_BuildLearnString(NAME_Speed_Potion, B_GetLearnCostTalent(other, NPC_TALENT_ALCHEMY, POTION_Speed))');
  });

  test('thief teacher offers sneak, picklock and pickpocket', () => {
    // Vanilla NotR: B_TeachThiefTalent (DIA_VLK_449_Lares_DI.d), labels from Text.d
    const thief = createTeacherDialogTemplate({
      npcInstanceName: 'VLK_449_Lares',
      dialogName: 'DIA_Lares_Teach',
      skillId: 'THIEF',
      maxLevel: 0,
      description: 'Bring mir ein paar Diebeskuenste bei.'
    });
    expect(thief).toContain(
      'Info_AddChoice\t\t(DIA_Lares_Teach, B_BuildLearnString(NAME_LEARN_SNEAK, B_GetLearnCostTalent(other, NPC_TALENT_SNEAK, 1)), DIA_Lares_Teach_Sneak);'
    );
    expect(thief).toContain(
      'Info_AddChoice\t\t(DIA_Lares_Teach, B_BuildLearnString(NAME_LEARN_LOCKS, B_GetLearnCostTalent(other, NPC_TALENT_PICKLOCK, 1)), DIA_Lares_Teach_Picklock);'
    );
    expect(thief).toContain(
      'Info_AddChoice\t\t(DIA_Lares_Teach, B_BuildLearnString(NAME_TALENT_PICKPOCKET, B_GetLearnCostTalent(other, NPC_TALENT_PICKPOCKET, 1)), DIA_Lares_Teach_Pickpocket);'
    );
    expect(thief).toContain('B_TeachThiefTalent (self, other, NPC_TALENT_SNEAK);');
    expect(thief).toContain('B_TeachThiefTalent (self, other, NPC_TALENT_PICKLOCK);');
    expect(thief).toContain('B_TeachThiefTalent (self, other, NPC_TALENT_PICKPOCKET);');
  });

  test('hunting teacher parses with the real Daedalus parser', () => {
    const parsed = parseInChildProcess(hunting, 'DIA_Grom_Teach');
    expect(parsed.hasErrors).toBe(false);
    expect(parsed.dialogs).toEqual(['DIA_Grom_Teach']);
    expect(parsed.functions).toEqual(
      expect.arrayContaining([
        'DIA_Grom_Teach_Condition',
        'DIA_Grom_Teach_Info',
        'DIA_Grom_Teach_Back',
        'DIA_Grom_Teach_Fur',
        'DIA_Grom_Teach_Teeth',
        'DIA_Grom_Teach_Claws',
        'DIA_Grom_Teach_Heart',
        'DIA_Grom_Teach_Mandibles',
        'DIA_Grom_Teach_ShadowHorn'
      ])
    );
    expect(parsed.npc).toBe('BAU_981_Grom');
  });
});
