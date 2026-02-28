import type { SemanticModel } from '../types/global';

export const nodeEditorMockModel: SemanticModel = {
  dialogs: {
    DIA_DragonHunt_Start: {
      name: 'DIA_DragonHunt_Start',
      parent: 'C_INFO',
      properties: {
        npc: 'DIA_NPC_GAROND',
        nr: 100,
        condition: 'DIA_DragonHunt_Start_Condition',
        information: 'DIA_DragonHunt_Start_Info',
        important: true,
      },
    },
    DIA_DragonHunt_Investigate: {
      name: 'DIA_DragonHunt_Investigate',
      parent: 'C_INFO',
      properties: {
        npc: 'DIA_NPC_GAROND',
        nr: 110,
        condition: 'DIA_DragonHunt_Investigate_Condition',
        information: 'DIA_DragonHunt_Investigate_Info',
      },
    },
    DIA_DragonHunt_Complete: {
      name: 'DIA_DragonHunt_Complete',
      parent: 'C_INFO',
      properties: {
        npc: 'DIA_NPC_GAROND',
        nr: 120,
        condition: 'DIA_DragonHunt_Complete_Condition',
        information: 'DIA_DragonHunt_Complete_Info',
      },
    },
    DIA_DragonHunt_Fail: {
      name: 'DIA_DragonHunt_Fail',
      parent: 'C_INFO',
      properties: {
        npc: 'DIA_NPC_GAROND',
        nr: 130,
        condition: 'DIA_DragonHunt_Fail_Condition',
        information: 'DIA_DragonHunt_Fail_Info',
      },
    },
    DIA_GuildJoin_Start: {
      name: 'DIA_GuildJoin_Start',
      parent: 'C_INFO',
      properties: {
        npc: 'DIA_NPC_ANDRE',
        nr: 200,
        condition: 'DIA_GuildJoin_Start_Condition',
        information: 'DIA_GuildJoin_Start_Info',
      },
    },
    DIA_GuildJoin_Approve: {
      name: 'DIA_GuildJoin_Approve',
      parent: 'C_INFO',
      properties: {
        npc: 'DIA_NPC_ANDRE',
        nr: 210,
        condition: 'DIA_GuildJoin_Approve_Condition',
        information: 'DIA_GuildJoin_Approve_Info',
      },
    },
  },
  functions: {
    DIA_DragonHunt_Start_Condition: {
      name: 'DIA_DragonHunt_Start_Condition',
      returnType: 'INT',
      conditions: [
        { type: 'VariableCondition', variableName: 'MIS_DRAGONHUNT', operator: '==', value: 0, negated: false },
        { type: 'NpcHasItemsCondition', npc: 'hero', item: 'ITMI_DRAGON_EGG', operator: '>=', value: 1 },
      ],
      actions: [],
      calls: [],
    },
    DIA_DragonHunt_Start_Info: {
      name: 'DIA_DragonHunt_Start_Info',
      returnType: 'VOID',
      conditions: [],
      actions: [
        { type: 'DialogLine', speaker: 'self', text: 'Bring me proof you found the dragons.', id: 'DIA_DragonHunt_Start_15_00' },
        { type: 'CreateTopic', topic: 'TOPIC_DRAGONHUNT', topicType: 'LOG_MISSION' },
        { type: 'LogSetTopicStatus', topic: 'TOPIC_DRAGONHUNT', status: 'LOG_RUNNING' },
      ],
      calls: [],
    },
    DIA_DragonHunt_Investigate_Condition: {
      name: 'DIA_DragonHunt_Investigate_Condition',
      returnType: 'INT',
      conditions: [
        { type: 'VariableCondition', variableName: 'MIS_DRAGONHUNT', operator: '==', value: 'LOG_RUNNING', negated: false },
        { type: 'NpcKnowsInfoCondition', npc: 'DIA_NPC_GAROND', dialogRef: 'DIA_DragonHunt_Start' },
      ],
      actions: [],
      calls: [],
    },
    DIA_DragonHunt_Investigate_Info: {
      name: 'DIA_DragonHunt_Investigate_Info',
      returnType: 'VOID',
      conditions: [],
      actions: [
        { type: 'DialogLine', speaker: 'other', text: 'I tracked them to the old mine.', id: 'DIA_DragonHunt_Investigate_15_00' },
        { type: 'SetVariableAction', variableName: 'MIS_DRAGONHUNT_STEP', operator: '=', value: 2 },
        { type: 'LogEntry', topic: 'TOPIC_DRAGONHUNT', text: 'Follow the dragon trail into the mine.' },
      ],
      calls: [],
    },
    DIA_DragonHunt_Complete_Condition: {
      name: 'DIA_DragonHunt_Complete_Condition',
      returnType: 'INT',
      conditions: [
        { type: 'VariableCondition', variableName: 'MIS_DRAGONHUNT_STEP', operator: '>=', value: 2, negated: false },
        { type: 'NpcIsDeadCondition', npc: 'DIA_NPC_DRAGON_LEADER', negated: false },
      ],
      actions: [],
      calls: [],
    },
    DIA_DragonHunt_Complete_Info: {
      name: 'DIA_DragonHunt_Complete_Info',
      returnType: 'VOID',
      conditions: [],
      actions: [
        { type: 'LogSetTopicStatus', topic: 'TOPIC_DRAGONHUNT', status: 'LOG_SUCCESS' },
        { type: 'SetVariableAction', variableName: 'MIS_DRAGONHUNT', operator: '=', value: 'LOG_SUCCESS' },
      ],
      calls: [],
    },
    DIA_DragonHunt_Fail_Condition: {
      name: 'DIA_DragonHunt_Fail_Condition',
      returnType: 'INT',
      conditions: [
        { type: 'NpcGetDistToWpCondition', npc: 'hero', waypoint: 'OW_DRAGON_LAIR', operator: '>', value: 5000 },
        { type: 'VariableCondition', variableName: 'MIS_DRAGONHUNT', operator: '==', value: 'LOG_RUNNING', negated: false },
      ],
      actions: [],
      calls: [],
    },
    DIA_DragonHunt_Fail_Info: {
      name: 'DIA_DragonHunt_Fail_Info',
      returnType: 'VOID',
      conditions: [],
      actions: [
        { type: 'LogSetTopicStatus', topic: 'TOPIC_DRAGONHUNT', status: 'LOG_FAILED' },
        { type: 'SetVariableAction', variableName: 'MIS_DRAGONHUNT', operator: '=', value: 'LOG_FAILED' },
      ],
      calls: [],
    },
    DIA_GuildJoin_Start_Condition: {
      name: 'DIA_GuildJoin_Start_Condition',
      returnType: 'INT',
      conditions: [
        { type: 'VariableCondition', variableName: 'MIS_GUILDJOIN', operator: '==', value: 0, negated: false },
        { type: 'NpcGetTalentSkillCondition', npc: 'hero', talent: 'NPC_TALENT_1H', operator: '>=', value: 30 },
      ],
      actions: [],
      calls: [],
    },
    DIA_GuildJoin_Start_Info: {
      name: 'DIA_GuildJoin_Start_Info',
      returnType: 'VOID',
      conditions: [],
      actions: [
        { type: 'CreateTopic', topic: 'TOPIC_GUILDJOIN', topicType: 'LOG_MISSION' },
        { type: 'LogSetTopicStatus', topic: 'TOPIC_GUILDJOIN', status: 'LOG_RUNNING' },
        { type: 'SetVariableAction', variableName: 'MIS_GUILDJOIN', operator: '=', value: 'LOG_RUNNING' },
      ],
      calls: [],
    },
    DIA_GuildJoin_Approve_Condition: {
      name: 'DIA_GuildJoin_Approve_Condition',
      returnType: 'INT',
      conditions: [
        { type: 'VariableCondition', variableName: 'MIS_GUILDJOIN', operator: '==', value: 'LOG_RUNNING', negated: false },
        { type: 'VariableCondition', variableName: 'MIS_DRAGONHUNT', operator: '==', value: 'LOG_SUCCESS', negated: false },
      ],
      actions: [],
      calls: [],
    },
    DIA_GuildJoin_Approve_Info: {
      name: 'DIA_GuildJoin_Approve_Info',
      returnType: 'VOID',
      conditions: [],
      actions: [
        { type: 'LogSetTopicStatus', topic: 'TOPIC_GUILDJOIN', status: 'LOG_SUCCESS' },
        { type: 'SetVariableAction', variableName: 'MIS_GUILDJOIN', operator: '=', value: 'LOG_SUCCESS' },
      ],
      calls: [],
    },
  },
  constants: {
    TOPIC_DRAGONHUNT: { name: 'TOPIC_DRAGONHUNT', type: 'string', value: '"Dragon Hunt"', filePath: 'mock/quests.d' },
    TOPIC_GUILDJOIN: { name: 'TOPIC_GUILDJOIN', type: 'string', value: '"Join the Militia"', filePath: 'mock/quests.d' },
  },
  variables: {
    MIS_DRAGONHUNT: { name: 'MIS_DRAGONHUNT', type: 'int', filePath: 'mock/quests.d' },
    MIS_DRAGONHUNT_STEP: { name: 'MIS_DRAGONHUNT_STEP', type: 'int', filePath: 'mock/quests.d' },
    MIS_GUILDJOIN: { name: 'MIS_GUILDJOIN', type: 'int', filePath: 'mock/quests.d' },
  },
  hasErrors: false,
  errors: [],
};

export const nodeEditorMockQuests = ['TOPIC_DRAGONHUNT', 'TOPIC_GUILDJOIN'];
