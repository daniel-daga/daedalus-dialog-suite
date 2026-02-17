import { useProjectStore } from '../src/renderer/store/projectStore';
import type { SemanticModel } from '../src/renderer/types/global';

const createEmptyModel = (): SemanticModel => ({
  dialogs: {},
  functions: {},
  constants: {},
  variables: {},
  instances: {},
  hasErrors: false,
  errors: []
});

describe('ProjectStore - getQuestUsage', () => {
  beforeEach(() => {
    useProjectStore.setState({
      parsedFiles: new Map(),
      dialogIndex: new Map(),
      allDialogFiles: [],
      mergedSemanticModel: createEmptyModel()
    });
  });

  it('includes writer-only MIS functions even without direct topic actions', () => {
    const filePath = '/dialogs/mis-only.d';
    const model = createEmptyModel();
    model.constants = {
      TOPIC_TEST: { name: 'TOPIC_TEST', type: 'string', value: '"Test Quest"' }
    };
    model.variables = {
      MIS_TEST: { name: 'MIS_TEST', type: 'int' }
    };
    model.functions = {
      DIA_Test_SetState: {
        name: 'DIA_Test_SetState',
        returnType: 'VOID',
        actions: [{ type: 'SetVariableAction', variableName: 'MIS_TEST', operator: '=', value: 'LOG_RUNNING' }],
        conditions: [],
        calls: []
      }
    };
    model.dialogs = {
      DIA_Test: {
        name: 'DIA_Test',
        parent: 'C_INFO',
        properties: {
          npc: 'NPC_TEST',
          information: 'DIA_Test_SetState'
        }
      }
    };

    useProjectStore.setState({
      parsedFiles: new Map([
        [filePath, { filePath, semanticModel: model, lastParsed: new Date('2026-02-17T00:00:00Z') }]
      ])
    });

    const usage = useProjectStore.getState().getQuestUsage('TOPIC_TEST');

    expect(usage.functions).toHaveProperty('DIA_Test_SetState');
    expect(usage.dialogs).toHaveProperty('DIA_Test');
    expect(usage.variables).toHaveProperty('MIS_TEST');
  });

  it('matches Topic_ quests and case variants across constants, actions, and MIS writers', () => {
    const filePath = '/dialogs/topic-note.d';
    const model = createEmptyModel();
    model.constants = {
      Topic_RescueBennet: { name: 'Topic_RescueBennet', type: 'string', value: '"Bennet sitzt im Knast"' }
    };
    model.variables = {
      MIS_RescueBennet: { name: 'MIS_RescueBennet', type: 'int' }
    };
    model.functions = {
      DIA_Bennet_Start: {
        name: 'DIA_Bennet_Start',
        returnType: 'VOID',
        actions: [
          { type: 'CreateTopic', topic: 'TOPIC_RESCUEBENNET', topicType: 'LOG_NOTE' }
        ],
        conditions: [],
        calls: []
      },
      DIA_Bennet_State: {
        name: 'DIA_Bennet_State',
        returnType: 'VOID',
        actions: [
          { type: 'SetVariableAction', variableName: 'MIS_RESCUEBENNET', operator: '=', value: 'LOG_RUNNING' }
        ],
        conditions: [],
        calls: []
      }
    };
    model.dialogs = {
      DIA_Bennet_Start_Dlg: {
        name: 'DIA_Bennet_Start_Dlg',
        parent: 'C_INFO',
        properties: {
          npc: 'BENNET',
          information: 'DIA_BENNET_START'
        }
      },
      DIA_Bennet_State_Dlg: {
        name: 'DIA_Bennet_State_Dlg',
        parent: 'C_INFO',
        properties: {
          npc: 'BENNET',
          information: 'DIA_BENNET_STATE'
        }
      }
    };

    useProjectStore.setState({
      parsedFiles: new Map([
        [filePath, { filePath, semanticModel: model, lastParsed: new Date('2026-02-17T00:00:00Z') }]
      ])
    });

    const usage = useProjectStore.getState().getQuestUsage('Topic_RescueBennet');

    expect(usage.constants).toHaveProperty('Topic_RescueBennet');
    expect(usage.variables).toHaveProperty('MIS_RescueBennet');
    expect(usage.functions).toHaveProperty('DIA_Bennet_Start');
    expect(usage.functions).toHaveProperty('DIA_Bennet_State');
    expect(usage.dialogs).toHaveProperty('DIA_Bennet_Start_Dlg');
    expect(usage.dialogs).toHaveProperty('DIA_Bennet_State_Dlg');
  });
});
