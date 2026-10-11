/**
 * Teacher dialog boilerplate generation (issue #147, "Lehrer anlegen").
 *
 * Generates the full teach dialog for a teacher NPC, following the canonical
 * Gothic 2 NotR script patterns:
 *
 * - Fight skills (1H/2H/Bow/Crossbow): permanent C_INFO, info function that
 *   remembers the current skill value and offers +1/+5 learn choices via
 *   B_BuildLearnString/B_GetLearnCostTalent, per-step teach functions using
 *   B_TeachFightTalentPercent, and a Back function commenting on progress
 *   against the teacher's max level.
 * - Attributes (STR/DEX/MANA): same shape, but the value lives in
 *   other.attribute[ATR_...], costs come from B_GetLearnCostAttribute and the
 *   steps use B_TeachAttributePoints (vanilla pattern: DIA_VLK_461_Carl.d).
 * - One-shot talents (hunting/alchemy/thief): a permanent C_INFO whose
 *   choices each teach one trophy/recipe/talent through the matching
 *   B_TeachPlayerTalentTakeAnimalTrophy / B_TeachPlayerTalentAlchemy /
 *   B_TeachThiefTalent builtin (vanilla patterns: DIA_BAU_981_Grom.d,
 *   DIA_VLK_498_Ignaz.d, DIA_VLK_449_Lares_DI.d). No level cap.
 */

import { deriveNpcShortName } from './npcExitDialog';
import { sanitizeDaedalusString } from './pathAndIdentifierUtils';

export type TeacherSkillId =
  | '1H'
  | '2H'
  | 'BOW'
  | 'CROSSBOW'
  | 'STR'
  | 'DEX'
  | 'MANA'
  | 'HUNTING'
  | 'ALCHEMY'
  | 'THIEF';

export type TeacherSkillCategory = 'fight' | 'attribute' | 'oneshot';

/** One learnable entry of a one-shot talent teacher. */
export interface TeacherOneShotEntry {
  /** Function-name suffix, e.g. 'Fur' -> DIA_X_Teach_Fur */
  suffix: string;
  /** Vanilla Text.d string constant used as the choice label */
  labelConstant: string;
  /** Cost expression for B_BuildLearnString's second argument */
  cost: string;
  /** Full teach builtin call (without trailing semicolon) */
  teach: string;
}

export interface TeacherSkill {
  id: TeacherSkillId;
  category: TeacherSkillCategory;
  label: string;
  defaultDescription: string;
  /** fight: NPC_TALENT_* constant */
  talentConstant?: string;
  /** attribute: ATR_* constant */
  attributeConstant?: string;
  /** fight/attribute: [+1 print constant, +5 print constant] from the vanilla scripts */
  printConstants?: [string, string];
  /** fight/attribute: default cap offered in the create form */
  defaultMaxLevel?: number;
  /** oneshot: the learnable entries */
  entries?: TeacherOneShotEntry[];
}

export const TEACHER_SKILLS: TeacherSkill[] = [
  {
    id: '1H',
    category: 'fight',
    label: 'One-handed (1H)',
    talentConstant: 'NPC_TALENT_1H',
    printConstants: ['PRINT_Learn1h1', 'PRINT_Learn1h5'],
    defaultMaxLevel: 30,
    defaultDescription: 'Trainier mich im Schwertkampf!'
  },
  {
    id: '2H',
    category: 'fight',
    label: 'Two-handed (2H)',
    talentConstant: 'NPC_TALENT_2H',
    printConstants: ['PRINT_Learn2h1', 'PRINT_Learn2h5'],
    defaultMaxLevel: 30,
    defaultDescription: 'Trainier mich im Zweihandkampf!'
  },
  {
    id: 'BOW',
    category: 'fight',
    label: 'Bow',
    talentConstant: 'NPC_TALENT_BOW',
    printConstants: ['PRINT_LearnBow1', 'PRINT_LearnBow5'],
    defaultMaxLevel: 30,
    defaultDescription: 'Trainier mich im Bogenschiessen!'
  },
  {
    id: 'CROSSBOW',
    category: 'fight',
    label: 'Crossbow',
    talentConstant: 'NPC_TALENT_CROSSBOW',
    printConstants: ['PRINT_LearnCrossbow1', 'PRINT_LearnCrossbow5'],
    defaultMaxLevel: 30,
    defaultDescription: 'Trainier mich im Armbrustschiessen!'
  }
];

const ATTRIBUTE_TEACHER_SKILLS: TeacherSkill[] = [
  {
    id: 'STR',
    category: 'attribute',
    label: 'Strength (STR)',
    attributeConstant: 'ATR_STRENGTH',
    printConstants: ['PRINT_LearnSTR1', 'PRINT_LearnSTR5'],
    defaultMaxLevel: 100,
    defaultDescription: 'Ich will staerker werden!'
  },
  {
    id: 'DEX',
    category: 'attribute',
    label: 'Dexterity (DEX)',
    attributeConstant: 'ATR_DEXTERITY',
    printConstants: ['PRINT_LearnDEX1', 'PRINT_LearnDEX5'],
    defaultMaxLevel: 100,
    defaultDescription: 'Ich will geschickter werden!'
  },
  {
    id: 'MANA',
    category: 'attribute',
    label: 'Mana (MANA)',
    attributeConstant: 'ATR_MANA_MAX',
    printConstants: ['PRINT_LearnMANA1', 'PRINT_LearnMANA5'],
    defaultMaxLevel: 100,
    defaultDescription: 'Ich will mein Mana erhoehen!'
  }
];

/** cost/teach helpers for the one-shot tables below */
const trophyEntry = (suffix: string, labelConstant: string, trophyConstant: string): TeacherOneShotEntry => ({
  suffix,
  labelConstant,
  cost: `B_GetLearnCostTalent(other, NPC_TALENT_TAKEANIMALTROPHY, ${trophyConstant})`,
  teach: `B_TeachPlayerTalentTakeAnimalTrophy (self, other, ${trophyConstant})`
});

const potionEntry = (suffix: string, labelConstant: string, potionConstant: string): TeacherOneShotEntry => ({
  suffix,
  labelConstant,
  cost: `B_GetLearnCostTalent(other, NPC_TALENT_ALCHEMY, ${potionConstant})`,
  teach: `B_TeachPlayerTalentAlchemy (self, other, ${potionConstant})`
});

const thiefEntry = (suffix: string, labelConstant: string, talentConstant: string): TeacherOneShotEntry => ({
  suffix,
  labelConstant,
  cost: `B_GetLearnCostTalent(other, ${talentConstant}, 1)`,
  teach: `B_TeachThiefTalent (self, other, ${talentConstant})`
});

const TALENT_TEACHER_SKILLS: TeacherSkill[] = [
  {
    id: 'HUNTING',
    category: 'oneshot',
    label: 'Hunting (animal trophies)',
    defaultDescription: 'Bring mir das Jagen bei.',
    entries: [
      trophyEntry('Fur', 'NAME_LEARN_FUR', 'TROPHY_Fur'),
      trophyEntry('Teeth', 'NAME_LEARN_TEETH', 'TROPHY_Teeth'),
      trophyEntry('Claws', 'NAME_LEARN_CLAWS', 'TROPHY_Claws'),
      trophyEntry('Heart', 'NAME_LEARN_HEARTS', 'TROPHY_Heart'),
      trophyEntry('Mandibles', 'NAME_LEARN_MANDIBLES', 'TROPHY_Mandibles'),
      trophyEntry('ShadowHorn', 'NAME_LEARN_SHADOWBEAST_HORN', 'TROPHY_ShadowHorn')
    ]
  },
  {
    id: 'ALCHEMY',
    category: 'oneshot',
    label: 'Alchemy (potion recipes)',
    defaultDescription: 'Zeig mir, wie man Traenke braut.',
    entries: [
      potionEntry('Health_1', 'NAME_HealthPotion1', 'POTION_Health_01'),
      potionEntry('Health_2', 'NAME_HealthPotion2', 'POTION_Health_02'),
      potionEntry('Health_3', 'NAME_HealthPotion3', 'POTION_Health_03'),
      potionEntry('Mana_1', 'NAME_ManaPotion1', 'POTION_Mana_01'),
      potionEntry('Mana_2', 'NAME_ManaPotion2', 'POTION_Mana_02'),
      potionEntry('Mana_3', 'NAME_ManaPotion3', 'POTION_Mana_03'),
      potionEntry('Speed', 'NAME_Speed_Potion', 'POTION_Speed')
    ]
  },
  {
    id: 'THIEF',
    category: 'oneshot',
    label: 'Thief talents (sneak, picklock, pickpocket)',
    defaultDescription: 'Bring mir ein paar Diebeskuenste bei.',
    entries: [
      thiefEntry('Sneak', 'NAME_LEARN_SNEAK', 'NPC_TALENT_SNEAK'),
      thiefEntry('Picklock', 'NAME_LEARN_LOCKS', 'NPC_TALENT_PICKLOCK'),
      thiefEntry('Pickpocket', 'NAME_TALENT_PICKPOCKET', 'NPC_TALENT_PICKPOCKET')
    ]
  }
];

export const TEACHER_SKILL_GROUPS: { label: string; skills: TeacherSkill[] }[] = [
  { label: 'Fight Talents', skills: TEACHER_SKILLS },
  { label: 'Attributes', skills: ATTRIBUTE_TEACHER_SKILLS },
  { label: 'Other Talents', skills: TALENT_TEACHER_SKILLS }
];

export const ALL_TEACHER_SKILLS: TeacherSkill[] = TEACHER_SKILL_GROUPS.flatMap((g) => g.skills);

export function getTeacherSkill(id: TeacherSkillId): TeacherSkill {
  const skill = ALL_TEACHER_SKILLS.find((s) => s.id === id);
  if (!skill) {
    throw new Error(`Unknown teacher skill: ${id}`);
  }
  return skill;
}

/** One-shot talents are learned once; only leveled teachers have a cap. */
export function skillHasMaxLevel(skill: TeacherSkill): boolean {
  return skill.category !== 'oneshot';
}

export interface TeacherDialogConfig {
  skillId: TeacherSkillId;
  /** Ignored for one-shot talent teachers. */
  maxLevel: number;
  description: string;
}

/**
 * Emit the learn-choice block shared by the info function and the per-step
 * teach functions. The +1/+5 cost expressions differ between fight talents
 * (B_GetLearnCostTalent per step) and attributes (B_GetLearnCostAttribute,
 * times five for the +5 step — vanilla DIA_VLK_461_Carl.d pattern).
 */
function learnChoiceLines(dialogName: string, skill: TeacherSkill, backName: string): string[] {
  const [print1, print5] = skill.printConstants as [string, string];
  const costs: [string, string] =
    skill.category === 'attribute'
      ? [
          `B_GetLearnCostAttribute(other, ${skill.attributeConstant})`,
          `B_GetLearnCostAttribute(other, ${skill.attributeConstant}) * 5`
        ]
      : [
          `B_GetLearnCostTalent(other, ${skill.talentConstant}, 1)`,
          `B_GetLearnCostTalent(other, ${skill.talentConstant}, 5)`
        ];
  return [
    `\tInfo_ClearChoices\t(${dialogName});`,
    `\tInfo_AddChoice\t\t(${dialogName}, DIALOG_BACK, ${backName});`,
    `\tInfo_AddChoice\t\t(${dialogName}, B_BuildLearnString(${print1}, ${costs[0]}), ${dialogName}_${skill.id}_1);`,
    `\tInfo_AddChoice\t\t(${dialogName}, B_BuildLearnString(${print5}, ${costs[1]}), ${dialogName}_${skill.id}_5);`
  ];
}

/** The expression holding the player's current level of a leveled skill. */
function skillValueExpression(skill: TeacherSkill): string {
  return skill.category === 'attribute'
    ? `other.attribute[${skill.attributeConstant}]`
    : `other.HitChance[${skill.talentConstant}]`;
}

function teachStepFunction(
  dialogName: string,
  skill: TeacherSkill,
  backName: string,
  step: number,
  maxLevel: number
): string[] {
  const teachLine =
    skill.category === 'attribute'
      ? `\tB_TeachAttributePoints (self, other, ${skill.attributeConstant}, ${step}, ${maxLevel});`
      : `\tB_TeachFightTalentPercent (self, other, ${skill.talentConstant}, ${step}, ${maxLevel});`;
  return [
    `FUNC VOID ${dialogName}_${skill.id}_${step}()`,
    '{',
    teachLine,
    '',
    ...learnChoiceLines(dialogName, skill, backName),
    '};'
  ];
}

/** Instance + condition boilerplate shared by every teacher category. */
function instanceAndConditionLines(
  dialogName: string,
  npcInstanceName: string,
  description: string
): string[] {
  return [
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
    '};'
  ];
}

function bannerLines(skillId: TeacherSkillId): string[] {
  return [
    '// ************************************************************',
    `//\t\t\t  \tTeach ${skillId}`,
    '// ************************************************************',
    ''
  ];
}

/**
 * One-shot talent teacher (hunting/alchemy/thief): every choice teaches one
 * trophy/recipe/talent through its builtin; the builtin handles LP cost and
 * failure messages itself, so the choice function just calls it and clears
 * the menu (vanilla DIA_BAU_981_Grom.d / DIA_VLK_498_Ignaz.d shape).
 */
function oneShotTemplateLines(options: {
  npcInstanceName: string;
  dialogName: string;
  skill: TeacherSkill;
  description: string;
}): string[] {
  const { npcInstanceName, dialogName, skill, description } = options;
  const backName = `${dialogName}_Back`;
  const entries = skill.entries as TeacherOneShotEntry[];

  const choiceLines = [
    `\tInfo_ClearChoices\t(${dialogName});`,
    `\tInfo_AddChoice\t\t(${dialogName}, DIALOG_BACK, ${backName});`,
    ...entries.map(
      (entry) =>
        `\tInfo_AddChoice\t\t(${dialogName}, B_BuildLearnString(${entry.labelConstant}, ${entry.cost}), ${dialogName}_${entry.suffix});`
    )
  ];

  const lines = [
    ...bannerLines(skill.id),
    ...instanceAndConditionLines(dialogName, npcInstanceName, description),
    '',
    `FUNC VOID ${dialogName}_Info()`,
    '{',
    `\tAI_Output (other, self, "${dialogName}_15_00"); //${description}`,
    '',
    ...choiceLines,
    '};',
    '',
    `FUNC VOID ${backName}()`,
    '{',
    `\tInfo_ClearChoices (${dialogName});`,
    '};'
  ];

  for (const entry of entries) {
    lines.push(
      '',
      `FUNC VOID ${dialogName}_${entry.suffix}()`,
      '{',
      `\t${entry.teach};`,
      '',
      `\tInfo_ClearChoices (${dialogName});`,
      '};'
    );
  }
  lines.push('');
  return lines;
}

export function createTeacherDialogTemplate(options: {
  npcInstanceName: string;
  dialogName: string;
  skillId: TeacherSkillId;
  maxLevel: number;
  description: string;
}): string {
  const { npcInstanceName, dialogName, skillId, maxLevel } = options;
  const description = sanitizeDaedalusString(options.description);
  const skill = getTeacherSkill(skillId);

  if (skill.category === 'oneshot') {
    return oneShotTemplateLines({ npcInstanceName, dialogName, skill, description }).join('\n');
  }

  const shortName = deriveNpcShortName(npcInstanceName);
  // The remember variable is global, so it must be unique per dialog: carry
  // any collision suffix of the dialog name (a second teach dialog for the
  // same skill, or two NPCs sharing a short name, must not redeclare it).
  const baseDialogName = `DIA_${shortName}_Teach`;
  const uniqueSuffix = dialogName.toUpperCase().startsWith(baseDialogName.toUpperCase())
    ? dialogName.slice(baseDialogName.length)
    : `_${dialogName}`;
  const merkeVar = `${shortName}_Merke_${skill.id}${uniqueSuffix}`;
  const backName = `${dialogName}_Back`;
  const valueExpr = skillValueExpression(skill);
  const [backMaxComment, backProgressComment] =
    skill.category === 'attribute'
      ? ['Mehr kann ich dir nicht beibringen.', 'Du machst Fortschritte. Weiter so!']
      : [
          'Du bist kein Anfaenger mehr!',
          'Du bist schon besser geworden. Bald wird aus dir ein ordentlicher Kaempfer!'
        ];

  return [
    ...bannerLines(skill.id),
    `var int ${merkeVar};`,
    '',
    ...instanceAndConditionLines(dialogName, npcInstanceName, description),
    '',
    `FUNC VOID ${dialogName}_Info()`,
    '{',
    `\tAI_Output (other, self, "${dialogName}_15_00"); //${description}`,
    '',
    `\t${merkeVar} = ${valueExpr};`,
    '',
    ...learnChoiceLines(dialogName, skill, backName),
    '};',
    '',
    `FUNC VOID ${backName}()`,
    '{',
    `\tif (${valueExpr} >= ${maxLevel})`,
    '\t{',
    `\t\tAI_Output (self, other, "${backName}_09_00"); //${backMaxComment}`,
    '\t}',
    `\telse if (${valueExpr} > ${merkeVar})`,
    '\t{',
    `\t\tAI_Output (self, other, "${backName}_09_01"); //${backProgressComment}`,
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
