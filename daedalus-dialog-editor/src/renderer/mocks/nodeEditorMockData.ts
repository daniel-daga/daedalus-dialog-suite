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
    DIA_RelicConspiracy_Start: {
      name: 'DIA_RelicConspiracy_Start',
      parent: 'C_INFO',
      properties: {
        npc: 'DIA_NPC_VATRAS',
        nr: 300,
        condition: 'DIA_RelicConspiracy_Start_Condition',
        information: 'DIA_RelicConspiracy_Start_Info',
        important: true,
      },
    },
    DIA_RelicConspiracy_ReportDock: {
      name: 'DIA_RelicConspiracy_ReportDock',
      parent: 'C_INFO',
      properties: {
        npc: 'DIA_NPC_VATRAS',
        nr: 310,
        condition: 'DIA_RelicConspiracy_ReportDock_Condition',
        information: 'DIA_RelicConspiracy_ReportDock_Info',
      },
    },
    DIA_RelicConspiracy_AskSmuggler: {
      name: 'DIA_RelicConspiracy_AskSmuggler',
      parent: 'C_INFO',
      properties: {
        npc: 'DIA_NPC_CARDIFF',
        nr: 320,
        condition: 'DIA_RelicConspiracy_AskSmuggler_Condition',
        information: 'DIA_RelicConspiracy_AskSmuggler_Info',
      },
    },
    DIA_RelicConspiracy_BribeGuard: {
      name: 'DIA_RelicConspiracy_BribeGuard',
      parent: 'C_INFO',
      properties: {
        npc: 'DIA_NPC_PALADIN_MARCOS',
        nr: 330,
        condition: 'DIA_RelicConspiracy_BribeGuard_Condition',
        information: 'DIA_RelicConspiracy_BribeGuard_Info',
      },
    },
    DIA_RelicConspiracy_ForgePass: {
      name: 'DIA_RelicConspiracy_ForgePass',
      parent: 'C_INFO',
      properties: {
        npc: 'DIA_NPC_HALVOR',
        nr: 340,
        condition: 'DIA_RelicConspiracy_ForgePass_Condition',
        information: 'DIA_RelicConspiracy_ForgePass_Info',
      },
    },
    DIA_RelicConspiracy_EnterArchive: {
      name: 'DIA_RelicConspiracy_EnterArchive',
      parent: 'C_INFO',
      properties: {
        npc: 'DIA_NPC_PALADIN_MARCOS',
        nr: 350,
        condition: 'DIA_RelicConspiracy_EnterArchive_Condition',
        information: 'DIA_RelicConspiracy_EnterArchive_Info',
      },
    },
    DIA_RelicConspiracy_FindLedger: {
      name: 'DIA_RelicConspiracy_FindLedger',
      parent: 'C_INFO',
      properties: {
        npc: 'DIA_NPC_HALVOR',
        nr: 360,
        condition: 'DIA_RelicConspiracy_FindLedger_Condition',
        information: 'DIA_RelicConspiracy_FindLedger_Info',
      },
    },
    DIA_RelicConspiracy_DecodeLedger: {
      name: 'DIA_RelicConspiracy_DecodeLedger',
      parent: 'C_INFO',
      properties: {
        npc: 'DIA_NPC_VATRAS',
        nr: 370,
        condition: 'DIA_RelicConspiracy_DecodeLedger_Condition',
        information: 'DIA_RelicConspiracy_DecodeLedger_Info',
      },
    },
    DIA_RelicConspiracy_ConfrontJudge: {
      name: 'DIA_RelicConspiracy_ConfrontJudge',
      parent: 'C_INFO',
      properties: {
        npc: 'DIA_NPC_JUDGE',
        nr: 380,
        condition: 'DIA_RelicConspiracy_ConfrontJudge_Condition',
        information: 'DIA_RelicConspiracy_ConfrontJudge_Info',
      },
    },
    DIA_RelicConspiracy_ExposeAtCouncil: {
      name: 'DIA_RelicConspiracy_ExposeAtCouncil',
      parent: 'C_INFO',
      properties: {
        npc: 'DIA_NPC_HAGEN',
        nr: 390,
        condition: 'DIA_RelicConspiracy_ExposeAtCouncil_Condition',
        information: 'DIA_RelicConspiracy_ExposeAtCouncil_Info',
      },
    },
    DIA_RelicConspiracy_BlackmailJudge: {
      name: 'DIA_RelicConspiracy_BlackmailJudge',
      parent: 'C_INFO',
      properties: {
        npc: 'DIA_NPC_JUDGE',
        nr: 400,
        condition: 'DIA_RelicConspiracy_BlackmailJudge_Condition',
        information: 'DIA_RelicConspiracy_BlackmailJudge_Info',
      },
    },
    DIA_RelicConspiracy_FailCaught: {
      name: 'DIA_RelicConspiracy_FailCaught',
      parent: 'C_INFO',
      properties: {
        npc: 'DIA_NPC_VATRAS',
        nr: 410,
        condition: 'DIA_RelicConspiracy_FailCaught_Condition',
        information: 'DIA_RelicConspiracy_FailCaught_Info',
      },
    },
    DIA_RelicConspiracy_FailTimeout: {
      name: 'DIA_RelicConspiracy_FailTimeout',
      parent: 'C_INFO',
      properties: {
        npc: 'DIA_NPC_VATRAS',
        nr: 420,
        condition: 'DIA_RelicConspiracy_FailTimeout_Condition',
        information: 'DIA_RelicConspiracy_FailTimeout_Info',
      },
    },
    DIA_RelicConspiracy_FinalDebrief: {
      name: 'DIA_RelicConspiracy_FinalDebrief',
      parent: 'C_INFO',
      properties: {
        npc: 'DIA_NPC_VATRAS',
        nr: 430,
        condition: 'DIA_RelicConspiracy_FinalDebrief_Condition',
        information: 'DIA_RelicConspiracy_FinalDebrief_Info',
      },
    },
    DIA_Addon_Henry_FreeBDTTower_Start: {
      name: 'DIA_Addon_Henry_FreeBDTTower_Start',
      parent: 'C_INFO',
      properties: {
        npc: 'PIR_1354_Addon_Henry',
        nr: 500,
        condition: 'DIA_Addon_Henry_FreeBDTTower_Start_Condition',
        information: 'DIA_Addon_Henry_FreeBDTTower_Start_Info',
        important: true,
      },
    },
    DIA_Addon_Henry_ClearTower: {
      name: 'DIA_Addon_Henry_ClearTower',
      parent: 'C_INFO',
      properties: {
        npc: 'PIR_1354_Addon_Henry',
        nr: 510,
        condition: 'DIA_Addon_Henry_ClearTower_Condition',
        information: 'DIA_Addon_Henry_ClearTower_Info',
      },
    },
    DIA_Addon_Henry_Owen: {
      name: 'DIA_Addon_Henry_Owen',
      parent: 'C_INFO',
      properties: {
        npc: 'PIR_1354_Addon_Henry',
        nr: 520,
        condition: 'DIA_Addon_Henry_Owen_Condition',
        information: 'DIA_Addon_Henry_Owen_Info',
      },
    },
    DIA_Addon_Henry_FreeBDTTower_End: {
      name: 'DIA_Addon_Henry_FreeBDTTower_End',
      parent: 'C_INFO',
      properties: {
        npc: 'PIR_1354_Addon_Henry',
        nr: 530,
        condition: 'DIA_Addon_Henry_FreeBDTTower_End_Condition',
        information: 'DIA_Addon_Henry_FreeBDTTower_End_Info',
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
    DIA_RelicConspiracy_Start_Condition: {
      name: 'DIA_RelicConspiracy_Start_Condition',
      returnType: 'INT',
      conditions: [
        { type: 'VariableCondition', variableName: 'MIS_RELIC_CONSPIRACY', operator: '==', value: 0, negated: false },
        { type: 'NpcGetTalentSkillCondition', npc: 'hero', talent: 'NPC_TALENT_PICKLOCK', operator: '>=', value: 20 },
        { type: 'NpcHasItemsCondition', npc: 'hero', item: 'ITMI_GOLD', operator: '>=', value: 50 },
      ],
      actions: [],
      calls: [],
    },
    DIA_RelicConspiracy_Start_Info: {
      name: 'DIA_RelicConspiracy_Start_Info',
      returnType: 'VOID',
      conditions: [],
      actions: [
        { type: 'DialogLine', speaker: 'self', text: 'A relic was stolen from the monastery vault.', id: 'DIA_RelicConspiracy_Start_15_00' },
        { type: 'CreateTopic', topic: 'TOPIC_RELIC_CONSPIRACY', topicType: 'LOG_MISSION' },
        { type: 'LogSetTopicStatus', topic: 'TOPIC_RELIC_CONSPIRACY', status: 'LOG_RUNNING' },
        { type: 'SetVariableAction', variableName: 'MIS_RELIC_CONSPIRACY', operator: '=', value: 'LOG_RUNNING' },
        { type: 'SetVariableAction', variableName: 'MIS_RELIC_CONSPIRACY_STEP', operator: '=', value: 1 },
        { type: 'SetVariableAction', variableName: 'MIS_RELIC_CONSPIRACY_EVIDENCE', operator: '=', value: 0 },
        { type: 'SetVariableAction', variableName: 'MIS_RELIC_CONSPIRACY_ALERT', operator: '=', value: 0 },
        { type: 'SetVariableAction', variableName: 'MIS_RELIC_CONSPIRACY_TIMER', operator: '=', value: 12 },
        { type: 'LogEntry', topic: 'TOPIC_RELIC_CONSPIRACY', text: 'Vatras suspects a smuggling ring in Khorinis harbor.' },
        {
          type: 'Choice',
          dialogRef: 'DIA_RelicConspiracy_ReportDock',
          text: 'I will watch the docks tonight.',
          targetFunction: 'DIA_RelicConspiracy_ReportDock_Info'
        },
        {
          type: 'Choice',
          dialogRef: 'DIA_RelicConspiracy_AskSmuggler',
          text: 'I will question the tavern smugglers first.',
          targetFunction: 'DIA_RelicConspiracy_AskSmuggler_Info'
        },
      ],
      calls: [],
    },
    DIA_RelicConspiracy_ReportDock_Condition: {
      name: 'DIA_RelicConspiracy_ReportDock_Condition',
      returnType: 'INT',
      conditions: [
        { type: 'VariableCondition', variableName: 'MIS_RELIC_CONSPIRACY_STEP', operator: '>=', value: 1, negated: false },
        { type: 'NpcKnowsInfoCondition', npc: 'DIA_NPC_VATRAS', dialogRef: 'DIA_RelicConspiracy_Start' },
        { type: 'Condition', condition: '(HOUR >= 21) || (HOUR <= 4)' },
      ],
      actions: [],
      calls: [],
    },
    DIA_RelicConspiracy_ReportDock_Info: {
      name: 'DIA_RelicConspiracy_ReportDock_Info',
      returnType: 'VOID',
      conditions: [],
      actions: [
        { type: 'DialogLine', speaker: 'other', text: 'The guards switched routes near the archive.', id: 'DIA_RelicConspiracy_ReportDock_15_00' },
        { type: 'SetVariableAction', variableName: 'MIS_RELIC_CONSPIRACY_STEP', operator: '=', value: 2 },
        { type: 'SetVariableAction', variableName: 'MIS_RELIC_CONSPIRACY_EVIDENCE', operator: '+=', value: 1 },
        { type: 'LogEntry', topic: 'TOPIC_RELIC_CONSPIRACY', text: 'A dockworker saw patrol changes near the city archive.' },
        {
          type: 'Choice',
          dialogRef: 'DIA_RelicConspiracy_BribeGuard',
          text: 'Use coin to reach the archive quietly.',
          targetFunction: 'DIA_RelicConspiracy_BribeGuard_Info'
        },
      ],
      calls: [],
    },
    DIA_RelicConspiracy_AskSmuggler_Condition: {
      name: 'DIA_RelicConspiracy_AskSmuggler_Condition',
      returnType: 'INT',
      conditions: [
        { type: 'VariableCondition', variableName: 'MIS_RELIC_CONSPIRACY_STEP', operator: '>=', value: 1, negated: false },
        { type: 'NpcHasItemsCondition', npc: 'hero', item: 'ITFO_BEER', operator: '>=', value: 2 },
        { type: 'NpcKnowsInfoCondition', npc: 'DIA_NPC_VATRAS', dialogRef: 'DIA_RelicConspiracy_Start' },
      ],
      actions: [],
      calls: [],
    },
    DIA_RelicConspiracy_AskSmuggler_Info: {
      name: 'DIA_RelicConspiracy_AskSmuggler_Info',
      returnType: 'VOID',
      conditions: [],
      actions: [
        { type: 'DialogLine', speaker: 'other', text: 'A forged permit can get you into the archive wing.', id: 'DIA_RelicConspiracy_AskSmuggler_15_00' },
        { type: 'SetVariableAction', variableName: 'MIS_RELIC_CONSPIRACY_STEP', operator: '=', value: 2 },
        { type: 'SetVariableAction', variableName: 'MIS_RELIC_CONSPIRACY_EVIDENCE', operator: '+=', value: 2 },
        { type: 'LogEntry', topic: 'TOPIC_RELIC_CONSPIRACY', text: 'Cardiff suggests forging a pass through Halvor.' },
        {
          type: 'Choice',
          dialogRef: 'DIA_RelicConspiracy_ForgePass',
          text: 'Get a forged archive pass from Halvor.',
          targetFunction: 'DIA_RelicConspiracy_ForgePass_Info'
        },
      ],
      calls: [],
    },
    DIA_RelicConspiracy_BribeGuard_Condition: {
      name: 'DIA_RelicConspiracy_BribeGuard_Condition',
      returnType: 'INT',
      conditions: [
        { type: 'VariableCondition', variableName: 'MIS_RELIC_CONSPIRACY_STEP', operator: '>=', value: 2, negated: false },
        { type: 'VariableCondition', variableName: 'MIS_RELIC_CONSPIRACY_EVIDENCE', operator: '>=', value: 1, negated: false },
        { type: 'NpcHasItemsCondition', npc: 'hero', item: 'ITMI_GOLD', operator: '>=', value: 500 },
      ],
      actions: [],
      calls: [],
    },
    DIA_RelicConspiracy_BribeGuard_Info: {
      name: 'DIA_RelicConspiracy_BribeGuard_Info',
      returnType: 'VOID',
      conditions: [],
      actions: [
        { type: 'DialogLine', speaker: 'other', text: 'Keep this brief. I saw nothing.', id: 'DIA_RelicConspiracy_BribeGuard_15_00' },
        { type: 'SetVariableAction', variableName: 'MIS_RELIC_CONSPIRACY_ALERT', operator: '+=', value: 1 },
        { type: 'LogEntry', topic: 'TOPIC_RELIC_CONSPIRACY', text: 'A paid guard leaves a side door unlocked for one hour.' },
        {
          type: 'Choice',
          dialogRef: 'DIA_RelicConspiracy_EnterArchive',
          text: 'Enter the archive before dawn.',
          targetFunction: 'DIA_RelicConspiracy_EnterArchive_Info'
        },
      ],
      calls: [],
    },
    DIA_RelicConspiracy_ForgePass_Condition: {
      name: 'DIA_RelicConspiracy_ForgePass_Condition',
      returnType: 'INT',
      conditions: [
        { type: 'VariableCondition', variableName: 'MIS_RELIC_CONSPIRACY_STEP', operator: '>=', value: 2, negated: false },
        { type: 'NpcGetTalentSkillCondition', npc: 'hero', talent: 'NPC_TALENT_PICKLOCK', operator: '>=', value: 35 },
        { type: 'NpcHasItemsCondition', npc: 'hero', item: 'ITWR_PARCHMENT', operator: '>=', value: 1 },
      ],
      actions: [],
      calls: [],
    },
    DIA_RelicConspiracy_ForgePass_Info: {
      name: 'DIA_RelicConspiracy_ForgePass_Info',
      returnType: 'VOID',
      conditions: [],
      actions: [
        { type: 'DialogLine', speaker: 'other', text: 'The seal is fake, but it should fool sleepy guards.', id: 'DIA_RelicConspiracy_ForgePass_15_00' },
        { type: 'SetVariableAction', variableName: 'MIS_RELIC_CONSPIRACY_EVIDENCE', operator: '+=', value: 1 },
        { type: 'LogEntry', topic: 'TOPIC_RELIC_CONSPIRACY', text: 'Halvor forged a plausible access pass.' },
        {
          type: 'Choice',
          dialogRef: 'DIA_RelicConspiracy_EnterArchive',
          text: 'Use the forged pass at the archive gate.',
          targetFunction: 'DIA_RelicConspiracy_EnterArchive_Info'
        },
      ],
      calls: [],
    },
    DIA_RelicConspiracy_EnterArchive_Condition: {
      name: 'DIA_RelicConspiracy_EnterArchive_Condition',
      returnType: 'INT',
      conditions: [
        { type: 'VariableCondition', variableName: 'MIS_RELIC_CONSPIRACY_STEP', operator: '>=', value: 2, negated: false },
        { type: 'VariableCondition', variableName: 'MIS_RELIC_CONSPIRACY_EVIDENCE', operator: '>=', value: 2, negated: false },
        { type: 'VariableCondition', variableName: 'MIS_RELIC_CONSPIRACY_ALERT', operator: '<=', value: 2, negated: false },
      ],
      actions: [],
      calls: [],
    },
    DIA_RelicConspiracy_EnterArchive_Info: {
      name: 'DIA_RelicConspiracy_EnterArchive_Info',
      returnType: 'VOID',
      conditions: [],
      actions: [
        { type: 'DialogLine', speaker: 'self', text: 'The records room is ahead. Move quietly.', id: 'DIA_RelicConspiracy_EnterArchive_15_00' },
        { type: 'SetVariableAction', variableName: 'MIS_RELIC_CONSPIRACY_STEP', operator: '=', value: 3 },
        { type: 'LogEntry', topic: 'TOPIC_RELIC_CONSPIRACY', text: 'You entered the archive and located the restricted records wing.' },
        {
          type: 'Choice',
          dialogRef: 'DIA_RelicConspiracy_FindLedger',
          text: 'Search for shipping ledgers.',
          targetFunction: 'DIA_RelicConspiracy_FindLedger_Info'
        },
      ],
      calls: [],
    },
    DIA_RelicConspiracy_FindLedger_Condition: {
      name: 'DIA_RelicConspiracy_FindLedger_Condition',
      returnType: 'INT',
      conditions: [
        { type: 'VariableCondition', variableName: 'MIS_RELIC_CONSPIRACY_STEP', operator: '==', value: 3, negated: false },
        { type: 'NpcGetDistToWpCondition', npc: 'hero', waypoint: 'KHO_ARCHIVE_VAULT', operator: '<', value: 500 },
        { type: 'VariableCondition', variableName: 'MIS_RELIC_CONSPIRACY_ALERT', operator: '<=', value: 3, negated: false },
      ],
      actions: [],
      calls: [],
    },
    DIA_RelicConspiracy_FindLedger_Info: {
      name: 'DIA_RelicConspiracy_FindLedger_Info',
      returnType: 'VOID',
      conditions: [],
      actions: [
        { type: 'DialogLine', speaker: 'other', text: 'Found it. Several shipments marked as temple repairs.', id: 'DIA_RelicConspiracy_FindLedger_15_00' },
        { type: 'SetVariableAction', variableName: 'MIS_RELIC_CONSPIRACY_STEP', operator: '=', value: 4 },
        { type: 'SetVariableAction', variableName: 'MIS_RELIC_CONSPIRACY_EVIDENCE', operator: '+=', value: 2 },
        { type: 'LogEntry', topic: 'TOPIC_RELIC_CONSPIRACY', text: 'The ledger links the stolen relic to city officials.' },
        {
          type: 'Choice',
          dialogRef: 'DIA_RelicConspiracy_DecodeLedger',
          text: 'Return to Vatras to decode ledger marks.',
          targetFunction: 'DIA_RelicConspiracy_DecodeLedger_Info'
        },
      ],
      calls: [],
    },
    DIA_RelicConspiracy_DecodeLedger_Condition: {
      name: 'DIA_RelicConspiracy_DecodeLedger_Condition',
      returnType: 'INT',
      conditions: [
        { type: 'VariableCondition', variableName: 'MIS_RELIC_CONSPIRACY_STEP', operator: '>=', value: 4, negated: false },
        { type: 'NpcHasItemsCondition', npc: 'hero', item: 'ITWR_LEDGER', operator: '>=', value: 1 },
        { type: 'NpcGetTalentSkillCondition', npc: 'hero', talent: 'NPC_TALENT_MAGE', operator: '>=', value: 20 },
      ],
      actions: [],
      calls: [],
    },
    DIA_RelicConspiracy_DecodeLedger_Info: {
      name: 'DIA_RelicConspiracy_DecodeLedger_Info',
      returnType: 'VOID',
      conditions: [],
      actions: [
        { type: 'DialogLine', speaker: 'self', text: 'The code points to Judge Silven and a council courier.', id: 'DIA_RelicConspiracy_DecodeLedger_15_00' },
        { type: 'SetVariableAction', variableName: 'MIS_RELIC_CONSPIRACY_STEP', operator: '=', value: 5 },
        { type: 'LogEntry', topic: 'TOPIC_RELIC_CONSPIRACY', text: 'Decode complete. Judge Silven appears to lead the conspiracy.' },
        {
          type: 'Choice',
          dialogRef: 'DIA_RelicConspiracy_ConfrontJudge',
          text: 'Confront the judge before he escapes.',
          targetFunction: 'DIA_RelicConspiracy_ConfrontJudge_Info'
        },
      ],
      calls: [],
    },
    DIA_RelicConspiracy_ConfrontJudge_Condition: {
      name: 'DIA_RelicConspiracy_ConfrontJudge_Condition',
      returnType: 'INT',
      conditions: [
        { type: 'VariableCondition', variableName: 'MIS_RELIC_CONSPIRACY_STEP', operator: '>=', value: 5, negated: false },
        { type: 'VariableCondition', variableName: 'MIS_RELIC_CONSPIRACY_EVIDENCE', operator: '>=', value: 3, negated: false },
        { type: 'NpcKnowsInfoCondition', npc: 'DIA_NPC_VATRAS', dialogRef: 'DIA_RelicConspiracy_DecodeLedger' },
      ],
      actions: [],
      calls: [],
    },
    DIA_RelicConspiracy_ConfrontJudge_Info: {
      name: 'DIA_RelicConspiracy_ConfrontJudge_Info',
      returnType: 'VOID',
      conditions: [],
      actions: [
        { type: 'DialogLine', speaker: 'other', text: 'You have no proof that will survive the council.', id: 'DIA_RelicConspiracy_ConfrontJudge_15_00' },
        { type: 'SetVariableAction', variableName: 'MIS_RELIC_CONSPIRACY_STEP', operator: '=', value: 6 },
        { type: 'SetVariableAction', variableName: 'MIS_RELIC_CONSPIRACY_ALERT', operator: '+=', value: 2 },
        { type: 'LogEntry', topic: 'TOPIC_RELIC_CONSPIRACY', text: 'The judge is cornered. Choose whether to expose him or deal quietly.' },
        {
          type: 'Choice',
          dialogRef: 'DIA_RelicConspiracy_ExposeAtCouncil',
          text: 'Present the evidence to Lord Hagen.',
          targetFunction: 'DIA_RelicConspiracy_ExposeAtCouncil_Info'
        },
        {
          type: 'Choice',
          dialogRef: 'DIA_RelicConspiracy_BlackmailJudge',
          text: 'Force a private deal and recover the relic quietly.',
          targetFunction: 'DIA_RelicConspiracy_BlackmailJudge_Info'
        },
      ],
      calls: [],
    },
    DIA_RelicConspiracy_ExposeAtCouncil_Condition: {
      name: 'DIA_RelicConspiracy_ExposeAtCouncil_Condition',
      returnType: 'INT',
      conditions: [
        { type: 'VariableCondition', variableName: 'MIS_RELIC_CONSPIRACY_STEP', operator: '>=', value: 6, negated: false },
        { type: 'VariableCondition', variableName: 'MIS_RELIC_CONSPIRACY_EVIDENCE', operator: '>=', value: 4, negated: false },
        { type: 'VariableCondition', variableName: 'MIS_RELIC_CONSPIRACY_ALERT', operator: '<=', value: 4, negated: false },
      ],
      actions: [],
      calls: [],
    },
    DIA_RelicConspiracy_ExposeAtCouncil_Info: {
      name: 'DIA_RelicConspiracy_ExposeAtCouncil_Info',
      returnType: 'VOID',
      conditions: [],
      actions: [
        { type: 'LogSetTopicStatus', topic: 'TOPIC_RELIC_CONSPIRACY', status: 'LOG_SUCCESS' },
        { type: 'SetVariableAction', variableName: 'MIS_RELIC_CONSPIRACY', operator: '=', value: 'LOG_SUCCESS' },
        { type: 'SetVariableAction', variableName: 'MIS_RELIC_CONSPIRACY_STEP', operator: '=', value: 99 },
        { type: 'LogEntry', topic: 'TOPIC_RELIC_CONSPIRACY', text: 'The council arrests Judge Silven and the relic is returned.' },
        {
          type: 'Choice',
          dialogRef: 'DIA_RelicConspiracy_FinalDebrief',
          text: 'Report the outcome to Vatras.',
          targetFunction: 'DIA_RelicConspiracy_FinalDebrief_Info'
        },
      ],
      calls: [],
    },
    DIA_RelicConspiracy_BlackmailJudge_Condition: {
      name: 'DIA_RelicConspiracy_BlackmailJudge_Condition',
      returnType: 'INT',
      conditions: [
        { type: 'VariableCondition', variableName: 'MIS_RELIC_CONSPIRACY_STEP', operator: '>=', value: 6, negated: false },
        { type: 'VariableCondition', variableName: 'MIS_RELIC_CONSPIRACY_EVIDENCE', operator: '>=', value: 3, negated: false },
        { type: 'VariableCondition', variableName: 'MIS_RELIC_CONSPIRACY_ALERT', operator: '<=', value: 5, negated: false },
      ],
      actions: [],
      calls: [],
    },
    DIA_RelicConspiracy_BlackmailJudge_Info: {
      name: 'DIA_RelicConspiracy_BlackmailJudge_Info',
      returnType: 'VOID',
      conditions: [],
      actions: [
        { type: 'LogSetTopicStatus', topic: 'TOPIC_RELIC_CONSPIRACY', status: 'LOG_OBSOLETE' },
        { type: 'SetVariableAction', variableName: 'MIS_RELIC_CONSPIRACY', operator: '=', value: 'LOG_OBSOLETE' },
        { type: 'LogEntry', topic: 'TOPIC_RELIC_CONSPIRACY', text: 'You recovered the relic, but the conspirators remain in power.' },
      ],
      calls: [],
    },
    DIA_RelicConspiracy_FailCaught_Condition: {
      name: 'DIA_RelicConspiracy_FailCaught_Condition',
      returnType: 'INT',
      conditions: [
        { type: 'VariableCondition', variableName: 'MIS_RELIC_CONSPIRACY', operator: '==', value: 'LOG_RUNNING', negated: false },
        { type: 'VariableCondition', variableName: 'MIS_RELIC_CONSPIRACY_ALERT', operator: '>=', value: 5, negated: false },
        { type: 'NpcKnowsInfoCondition', npc: 'DIA_NPC_JUDGE', dialogRef: 'DIA_RelicConspiracy_ConfrontJudge' },
      ],
      actions: [],
      calls: [],
    },
    DIA_RelicConspiracy_FailCaught_Info: {
      name: 'DIA_RelicConspiracy_FailCaught_Info',
      returnType: 'VOID',
      conditions: [],
      actions: [
        { type: 'LogSetTopicStatus', topic: 'TOPIC_RELIC_CONSPIRACY', status: 'LOG_FAILED' },
        { type: 'SetVariableAction', variableName: 'MIS_RELIC_CONSPIRACY', operator: '=', value: 'LOG_FAILED' },
        { type: 'LogEntry', topic: 'TOPIC_RELIC_CONSPIRACY', text: 'The city guard catches you in the archive operation.' },
      ],
      calls: [],
    },
    DIA_RelicConspiracy_FailTimeout_Condition: {
      name: 'DIA_RelicConspiracy_FailTimeout_Condition',
      returnType: 'INT',
      conditions: [
        { type: 'VariableCondition', variableName: 'MIS_RELIC_CONSPIRACY', operator: '==', value: 'LOG_RUNNING', negated: false },
        { type: 'VariableCondition', variableName: 'MIS_RELIC_CONSPIRACY_STEP', operator: '>=', value: 2, negated: false },
        { type: 'Condition', condition: 'WLD_GetDay() > MIS_RELIC_CONSPIRACY_TIMER' },
      ],
      actions: [],
      calls: [],
    },
    DIA_RelicConspiracy_FailTimeout_Info: {
      name: 'DIA_RelicConspiracy_FailTimeout_Info',
      returnType: 'VOID',
      conditions: [],
      actions: [
        { type: 'LogSetTopicStatus', topic: 'TOPIC_RELIC_CONSPIRACY', status: 'LOG_FAILED' },
        { type: 'SetVariableAction', variableName: 'MIS_RELIC_CONSPIRACY', operator: '=', value: 'LOG_FAILED' },
        { type: 'LogEntry', topic: 'TOPIC_RELIC_CONSPIRACY', text: 'You took too long and the relic vanished from the city.' },
      ],
      calls: [],
    },
    DIA_RelicConspiracy_FinalDebrief_Condition: {
      name: 'DIA_RelicConspiracy_FinalDebrief_Condition',
      returnType: 'INT',
      conditions: [
        { type: 'VariableCondition', variableName: 'MIS_RELIC_CONSPIRACY', operator: '==', value: 'LOG_SUCCESS', negated: false },
        { type: 'NpcKnowsInfoCondition', npc: 'DIA_NPC_HAGEN', dialogRef: 'DIA_RelicConspiracy_ExposeAtCouncil' },
      ],
      actions: [],
      calls: [],
    },
    DIA_RelicConspiracy_FinalDebrief_Info: {
      name: 'DIA_RelicConspiracy_FinalDebrief_Info',
      returnType: 'VOID',
      conditions: [],
      actions: [
        { type: 'DialogLine', speaker: 'self', text: 'The city is safer, but this was only one cell of the network.', id: 'DIA_RelicConspiracy_FinalDebrief_15_00' },
        { type: 'LogEntry', topic: 'TOPIC_RELIC_CONSPIRACY', text: 'Vatras warns that other cells may still be active in the valley.' },
      ],
      calls: [],
    },
    DIA_Addon_Henry_FreeBDTTower_Start_Condition: {
      name: 'DIA_Addon_Henry_FreeBDTTower_Start_Condition',
      returnType: 'INT',
      conditions: [
        { type: 'VariableCondition', variableName: 'MIS_Henry_FreeBDTTower', operator: '==', value: 0, negated: false },
      ],
      actions: [],
      calls: [],
    },
    DIA_Addon_Henry_FreeBDTTower_Start_Info: {
      name: 'DIA_Addon_Henry_FreeBDTTower_Start_Info',
      returnType: 'VOID',
      conditions: [],
      actions: [
        { type: 'DialogLine', speaker: 'self', text: 'The bandit tower blocks our route. Clear it out.', id: 'DIA_Addon_Henry_FreeBDTTower_Start_15_00' },
        { type: 'CreateTopic', topic: 'TOPIC_Addon_BanditsTower', topicType: 'LOG_MISSION' },
        { type: 'LogSetTopicStatus', topic: 'TOPIC_Addon_BanditsTower', status: 'LOG_RUNNING' },
        { type: 'SetVariableAction', variableName: 'MIS_Henry_FreeBDTTower', operator: '=', value: 'LOG_RUNNING' },
        { type: 'SetVariableAction', variableName: 'Henry_EnterCrewMember', operator: '=', value: 'TRUE' },
        { type: 'LogEntry', topic: 'TOPIC_Addon_BanditsTower', text: 'Henry asked me to clear the tower and secure the path.' },
      ],
      calls: [],
    },
    DIA_Addon_Henry_ClearTower_Condition: {
      name: 'DIA_Addon_Henry_ClearTower_Condition',
      returnType: 'INT',
      conditions: [
        { type: 'VariableCondition', variableName: 'MIS_Henry_FreeBDTTower', operator: '==', value: 'LOG_RUNNING', negated: false },
        { type: 'NpcIsDeadCondition', npc: 'MALCOM_BANDITLEADER', negated: false },
      ],
      actions: [],
      calls: [],
    },
    DIA_Addon_Henry_ClearTower_Info: {
      name: 'DIA_Addon_Henry_ClearTower_Info',
      returnType: 'VOID',
      conditions: [],
      actions: [
        { type: 'LogEntry', topic: 'TOPIC_Addon_BanditsTower', text: 'The tower is clear. Henry can move men through safely.' },
        { type: 'LogSetTopicStatus', topic: 'TOPIC_Addon_BanditsTower', status: 'LOG_SUCCESS' },
        { type: 'SetVariableAction', variableName: 'MIS_Henry_FreeBDTTower', operator: '=', value: 'LOG_SUCCESS' },
      ],
      calls: [],
    },
    DIA_Addon_Henry_Owen_Condition: {
      name: 'DIA_Addon_Henry_Owen_Condition',
      returnType: 'INT',
      conditions: [
        { type: 'VariableCondition', variableName: 'MIS_Henry_FreeBDTTower', operator: '==', value: 'LOG_SUCCESS', negated: false },
        { type: 'VariableCondition', variableName: 'Henry_EnterCrewMember', operator: '==', value: 'TRUE', negated: false },
        { type: 'NpcIsDeadCondition', npc: 'Malcom', negated: true },
      ],
      actions: [],
      calls: [],
    },
    DIA_Addon_Henry_Owen_Info: {
      name: 'DIA_Addon_Henry_Owen_Info',
      returnType: 'VOID',
      conditions: [],
      actions: [
        { type: 'DialogLine', speaker: 'self', text: 'Good, now talk to Owen at the valley camp.', id: 'DIA_Addon_Henry_Owen_15_01' },
        { type: 'LogEntry', topic: 'TOPIC_Addon_BanditsTower', text: 'Henry redirected me to Owen after the tower operation.' },
        {
          type: 'Choice',
          dialogRef: 'DIA_Addon_Henry_FreeBDTTower_End',
          text: 'Report completion back to Henry.',
          targetFunction: 'DIA_Addon_Henry_FreeBDTTower_End_Info'
        },
      ],
      calls: [],
    },
    DIA_Addon_Henry_FreeBDTTower_End_Condition: {
      name: 'DIA_Addon_Henry_FreeBDTTower_End_Condition',
      returnType: 'INT',
      conditions: [
        { type: 'VariableCondition', variableName: 'MIS_Henry_FreeBDTTower', operator: '==', value: 'LOG_SUCCESS', negated: false },
        { type: 'NpcKnowsInfoCondition', npc: 'PIR_1354_Addon_Henry', dialogRef: 'DIA_Addon_Henry_Owen' },
      ],
      actions: [],
      calls: [],
    },
    DIA_Addon_Henry_FreeBDTTower_End_Info: {
      name: 'DIA_Addon_Henry_FreeBDTTower_End_Info',
      returnType: 'VOID',
      conditions: [],
      actions: [
        { type: 'LogEntry', topic: 'TOPIC_Addon_BanditsTower', text: 'Henry confirms the route is safe. The tower contract is done.' },
        { type: 'LogSetTopicStatus', topic: 'TOPIC_Addon_BanditsTower', status: 'LOG_OBSOLETE' },
      ],
      calls: [],
    },
  },
  constants: {
    TOPIC_DRAGONHUNT: { name: 'TOPIC_DRAGONHUNT', type: 'string', value: '"Dragon Hunt"', filePath: 'mock/quests.d' },
    TOPIC_GUILDJOIN: { name: 'TOPIC_GUILDJOIN', type: 'string', value: '"Join the Militia"', filePath: 'mock/quests.d' },
    TOPIC_RELIC_CONSPIRACY: { name: 'TOPIC_RELIC_CONSPIRACY', type: 'string', value: '"The Relic Conspiracy"', filePath: 'mock/quests.d' },
    TOPIC_Addon_BanditsTower: { name: 'TOPIC_Addon_BanditsTower', type: 'string', value: '"Der Turm"', filePath: 'mock/quests.d' },
  },
  variables: {
    MIS_DRAGONHUNT: { name: 'MIS_DRAGONHUNT', type: 'int', filePath: 'mock/quests.d' },
    MIS_DRAGONHUNT_STEP: { name: 'MIS_DRAGONHUNT_STEP', type: 'int', filePath: 'mock/quests.d' },
    MIS_GUILDJOIN: { name: 'MIS_GUILDJOIN', type: 'int', filePath: 'mock/quests.d' },
    MIS_RELIC_CONSPIRACY: { name: 'MIS_RELIC_CONSPIRACY', type: 'int', filePath: 'mock/quests.d' },
    MIS_RELIC_CONSPIRACY_STEP: { name: 'MIS_RELIC_CONSPIRACY_STEP', type: 'int', filePath: 'mock/quests.d' },
    MIS_RELIC_CONSPIRACY_EVIDENCE: { name: 'MIS_RELIC_CONSPIRACY_EVIDENCE', type: 'int', filePath: 'mock/quests.d' },
    MIS_RELIC_CONSPIRACY_ALERT: { name: 'MIS_RELIC_CONSPIRACY_ALERT', type: 'int', filePath: 'mock/quests.d' },
    MIS_RELIC_CONSPIRACY_TIMER: { name: 'MIS_RELIC_CONSPIRACY_TIMER', type: 'int', filePath: 'mock/quests.d' },
    MIS_Henry_FreeBDTTower: { name: 'MIS_Henry_FreeBDTTower', type: 'int', filePath: 'mock/quests.d' },
    Henry_EnterCrewMember: { name: 'Henry_EnterCrewMember', type: 'int', filePath: 'mock/quests.d' },
  },
  hasErrors: false,
  errors: [],
};

export const nodeEditorMockQuests = ['TOPIC_RELIC_CONSPIRACY', 'TOPIC_DRAGONHUNT', 'TOPIC_GUILDJOIN', 'TOPIC_Addon_BanditsTower'];
