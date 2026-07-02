/**
 * Teacher dialog boilerplate generation (issue #147, "Lehrer anlegen").
 *
 * Generates the full teach dialog for a fight-skill teacher, following the
 * canonical Gothic 2 pattern from the issue: a permanent C_INFO instance, an
 * info function that remembers the current skill value and offers +1/+5 learn
 * choices via B_BuildLearnString/B_GetLearnCostTalent, per-step teach
 * functions using B_TeachFightTalentPercent, and a Back function that
 * comments on the player's progress against the teacher's max level.
 */

import { deriveNpcShortName } from './npcExitDialog';

export type TeacherSkillId = '1H' | '2H' | 'BOW' | 'CROSSBOW';

export interface TeacherSkill {
  id: TeacherSkillId;
  label: string;
  talentConstant: string;
  /** [+1 print constant, +5 print constant] from the vanilla scripts */
  printConstants: [string, string];
  defaultDescription: string;
}

export const TEACHER_SKILLS: TeacherSkill[] = [
  {
    id: '1H',
    label: 'One-handed (1H)',
    talentConstant: 'NPC_TALENT_1H',
    printConstants: ['PRINT_Learn1h1', 'PRINT_Learn1h5'],
    defaultDescription: 'Trainier mich im Schwertkampf!'
  },
  {
    id: '2H',
    label: 'Two-handed (2H)',
    talentConstant: 'NPC_TALENT_2H',
    printConstants: ['PRINT_Learn2h1', 'PRINT_Learn2h5'],
    defaultDescription: 'Trainier mich im Zweihandkampf!'
  },
  {
    id: 'BOW',
    label: 'Bow',
    talentConstant: 'NPC_TALENT_BOW',
    printConstants: ['PRINT_LearnBow1', 'PRINT_LearnBow5'],
    defaultDescription: 'Trainier mich im Bogenschiessen!'
  },
  {
    id: 'CROSSBOW',
    label: 'Crossbow',
    talentConstant: 'NPC_TALENT_CROSSBOW',
    printConstants: ['PRINT_LearnCrossbow1', 'PRINT_LearnCrossbow5'],
    defaultDescription: 'Trainier mich im Armbrustschiessen!'
  }
];

export function getTeacherSkill(id: TeacherSkillId): TeacherSkill {
  const skill = TEACHER_SKILLS.find((s) => s.id === id);
  if (!skill) {
    throw new Error(`Unknown teacher skill: ${id}`);
  }
  return skill;
}

export interface TeacherDialogConfig {
  skillId: TeacherSkillId;
  maxLevel: number;
  description: string;
}

/**
 * Emit the learn-choice block shared by the info function and the per-step
 * teach functions.
 */
function learnChoiceLines(dialogName: string, skill: TeacherSkill, backName: string): string[] {
  return [
    `\tInfo_ClearChoices\t(${dialogName});`,
    `\tInfo_AddChoice\t\t(${dialogName}, DIALOG_BACK, ${backName});`,
    `\tInfo_AddChoice\t\t(${dialogName}, B_BuildLearnString(${skill.printConstants[0]}, B_GetLearnCostTalent(other, ${skill.talentConstant}, 1)), ${dialogName}_${skill.id}_1);`,
    `\tInfo_AddChoice\t\t(${dialogName}, B_BuildLearnString(${skill.printConstants[1]}, B_GetLearnCostTalent(other, ${skill.talentConstant}, 5)), ${dialogName}_${skill.id}_5);`
  ];
}

function teachStepFunction(
  dialogName: string,
  skill: TeacherSkill,
  backName: string,
  step: number,
  maxLevel: number
): string[] {
  return [
    `FUNC VOID ${dialogName}_${skill.id}_${step}()`,
    '{',
    `\tB_TeachFightTalentPercent (self, other, ${skill.talentConstant}, ${step}, ${maxLevel});`,
    '',
    ...learnChoiceLines(dialogName, skill, backName),
    '};'
  ];
}

export function createTeacherDialogTemplate(options: {
  npcInstanceName: string;
  dialogName: string;
  skillId: TeacherSkillId;
  maxLevel: number;
  description: string;
}): string {
  const { npcInstanceName, dialogName, skillId, maxLevel, description } = options;
  const skill = getTeacherSkill(skillId);
  const shortName = deriveNpcShortName(npcInstanceName);
  const merkeVar = `${shortName}_Merke_${skill.id}`;
  const backName = `${dialogName}_Back`;

  return [
    '// ************************************************************',
    `//\t\t\t  \tTeach ${skill.id}`,
    '// ************************************************************',
    '',
    `var int ${merkeVar};`,
    '',
    `INSTANCE ${dialogName} (C_INFO)`,
    '{',
    `\tnpc\t\t\t= ${npcInstanceName};`,
    '\tnr\t\t\t= 1;',
    `\tcondition\t= ${dialogName}_Condition;`,
    `\tinformation\t= ${dialogName}_Info;`,
    '\tpermanent\t= TRUE;',
    `\tdescription\t= "${description}";`,
    '};',
    '',
    `FUNC INT ${dialogName}_Condition()`,
    '{',
    '\treturn TRUE;',
    '};',
    '',
    `FUNC VOID ${dialogName}_Info()`,
    '{',
    `\tAI_Output (other, self, "${dialogName}_15_00"); //${description}`,
    '',
    `\t${merkeVar} = other.HitChance[${skill.talentConstant}];`,
    '',
    ...learnChoiceLines(dialogName, skill, backName),
    '};',
    '',
    `FUNC VOID ${backName}()`,
    '{',
    `\tif (other.HitChance[${skill.talentConstant}] >= ${maxLevel})`,
    '\t{',
    `\t\tAI_Output (self, other, "${backName}_09_00"); //Du bist kein Anfaenger mehr!`,
    '\t}',
    `\telse if (other.HitChance[${skill.talentConstant}] > ${merkeVar})`,
    '\t{',
    `\t\tAI_Output (self, other, "${backName}_09_01"); //Du bist schon besser geworden. Bald wird aus dir ein ordentlicher Kaempfer!`,
    '\t};',
    '',
    `\tInfo_ClearChoices (${dialogName});`,
    '};',
    '',
    ...teachStepFunction(dialogName, skill, backName, 1, maxLevel),
    '',
    ...teachStepFunction(dialogName, skill, backName, 5, maxLevel),
    ''
  ].join('\n');
}
