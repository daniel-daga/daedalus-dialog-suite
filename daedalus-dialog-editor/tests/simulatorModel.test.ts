import { createSimulatorModel } from '../src/renderer/simulator/domain/model';
import type { SemanticModel } from '../src/shared/types';

const makeModel = (overrides: Partial<SemanticModel> = {}): SemanticModel => ({
  dialogs: {
    DIA_Start: {
      name: 'DIA_Start', parent: 'C_INFO',
      properties: {
        npc: 'NPC_Test', nr: 10,
        condition: { name: 'DIA_Start_Condition' },
        information: { name: 'DIA_Start_Info' },
        important: true, permanent: false
      }
    },
    DIA_Second: {
      name: 'DIA_Second', parent: 'C_INFO',
      properties: { npc: 'NPC_Test', nr: 10, information: 'DIA_Second_Info', permanent: true }
    }
  },
  functions: {
    DIA_Start_Info: { name: 'DIA_Start_Info', returnType: 'VOID', calls: [], conditionOperator: 'AND', conditions: [], actions: [] },
    DIA_Start_Condition: { name: 'DIA_Start_Condition', returnType: 'INT', calls: [], conditionOperator: 'AND', conditions: [], actions: [] },
    DIA_Second_Info: { name: 'DIA_Second_Info', returnType: 'VOID', calls: [], conditionOperator: 'AND', conditions: [], actions: [] }
  },
  constants: {
    LOG_CUSTOM: { name: 'LOG_CUSTOM', type: 'int', value: 7 },
    Greeting: { name: 'Greeting', type: 'string', value: 'hello' }
  },
  variables: {
    MIS_Quest: { name: 'MIS_Quest', type: 'int' },
    mis_Second: { name: 'mis_Second', type: 'int' },
    VAR_Misleading: { name: 'VAR_Misleading', type: 'int' }
  },
  hasErrors: false,
  errors: [],
  ...overrides
});

describe('createSimulatorModel', () => {
  test('projects full C_INFO properties and resolves linked and string function references', () => {
    expect(createSimulatorModel(makeModel()).dialogs).toEqual([
      {
        name: 'DIA_Start', npc: 'NPC_Test', nr: 10,
        conditionFunction: 'DIA_Start_Condition', informationFunction: 'DIA_Start_Info',
        important: true, permanent: false, sourceOrder: 0
      },
      {
        name: 'DIA_Second', npc: 'NPC_Test', nr: 10,
        informationFunction: 'DIA_Second_Info', important: false, permanent: true, sourceOrder: 1
      }
    ]);
  });

  test('keys function and constant maps plus declared MIS names canonically without mutating the source model', () => {
    const source = makeModel();
    const sourceFunctions = source.functions;
    const sourceVariables = source.variables;
    const simulatorModel = createSimulatorModel(source);

    expect(simulatorModel.functions.get('dia_start_info')).toBe(source.functions.DIA_Start_Info);
    expect(simulatorModel.functions.get(' DIA_START_INFO ')).toBeUndefined();
    expect(simulatorModel.constants).toEqual(new Map([['log_custom', 7], ['greeting', 'hello']]));
    expect(simulatorModel.declaredMisVariables).toEqual(new Set(['mis_quest', 'mis_second']));
    expect(source.functions).toBe(sourceFunctions);
    expect(source.variables).toBe(sourceVariables);
    expect(Object.keys(source.functions)).toEqual(['DIA_Start_Info', 'DIA_Start_Condition', 'DIA_Second_Info']);
  });

  test('retains dialogs with missing information functions as non-launchable projection entries', () => {
    const source = makeModel({
      dialogs: {
        DIA_MissingInfo: { name: 'DIA_MissingInfo', parent: 'C_INFO', properties: { npc: 'NPC_Test' } }
      }
    });

    expect(createSimulatorModel(source).dialogs).toEqual([
      { name: 'DIA_MissingInfo', npc: 'NPC_Test', nr: 0, important: false, permanent: false, sourceOrder: 0 }
    ]);
  });
});
