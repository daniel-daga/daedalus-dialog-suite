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
  getTeacherSkill,
  createTeacherDialogTemplate
} from '../src/renderer/utils/teacherDialogTemplate';

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
