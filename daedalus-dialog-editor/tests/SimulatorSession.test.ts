import type { DialogAction, DialogFunction } from '../src/shared/types';
import { SimulatorSession } from '../src/renderer/simulator/application/SimulatorSession';
import type { SimulatorModel } from '../src/renderer/simulator/domain/types';

const fn = (name: string, actions: DialogAction[] = [], conditions: DialogFunction['conditions'] = []): DialogFunction => ({
  name, returnType: 'VOID', actions, conditions, calls: []
});

const model = (overrides: Partial<SimulatorModel> = {}): SimulatorModel => ({
  functions: new Map([
    ['dia_intro_cond', fn('DIA_Intro_Cond')],
    ['dia_intro_info', fn('DIA_Intro_Info', [
      { type: 'DialogLine', speaker: 'other', text: 'Welcome', id: 'INTRO_01' },
      { type: 'Choice', text: 'Continue', targetFunction: 'DIA_Next_Info', dialogRef: 'DIA_Next' }
    ])],
    ['dia_next_info', fn('DIA_Next_Info', [
      { type: 'SetVariableAction', variableName: 'MIS_PATH', operator: '=', value: 2 },
      { type: 'DialogLine', speaker: 'self', text: 'Done', id: 'NEXT_01' }
    ])]
  ]),
  dialogs: [{
    name: 'DIA_Intro', npc: 'NPC_Guard', nr: 10, sourceOrder: 0,
    conditionFunction: 'DIA_Intro_Cond', informationFunction: 'DIA_Intro_Info',
    important: false, permanent: false
  }],
  declaredMisVariables: new Set(['mis_path']),
  constants: new Map(),
  ...overrides
});

describe('SimulatorSession', () => {
  it('starts an available entry, marks only its C_INFO known, and returns defensive state clones', () => {
    const source = model();
    const session = new SimulatorSession(source);

    expect(session.getAvailableDialogs('npc_guard')).toMatchObject([{ entry: { name: 'DIA_Intro' }, value: 'true', visible: true }]);
    expect(session.startDialog('dia_intro')).toBe(true);
    expect(session.getActiveFunctionName()).toBe('DIA_Intro_Info');
    expect(session.getState()).toMatchObject({ status: 'awaiting-choice', knownInfos: new Set(['dia_intro']) });

    const leaked = session.getState();
    leaked.misVars.set('mis_path', 99);
    leaked.pendingChoices.length = 0;
    expect(session.getState().misVars.get('mis_path')).toBe(0);
    expect(session.getState().pendingChoices).toHaveLength(1);
    expect(source.functions.get('dia_intro_info')?.actions).toHaveLength(2);
  });

  it('snapshots choices for Back and restarts from the entry prelaunch baseline with cleared history', () => {
    const session = new SimulatorSession(model());
    session.startDialog('DIA_Intro');

    expect(session.selectChoice(0)).toBe(true);
    expect(session.getState().misVars.get('mis_path')).toBe(2);
    expect(session.getState().knownInfos).toEqual(new Set(['dia_intro']));
    expect(session.canBack()).toBe(true);
    expect(session.back()).toBe(true);
    expect(session.getActiveFunctionName()).toBe('DIA_Intro_Info');
    expect(session.getState().misVars.get('mis_path')).toBe(0);
    expect(session.getState().pendingChoices).toHaveLength(1);

    session.selectChoice(0);
    expect(session.restart()).toBe(true);
    expect(session.getState().misVars.get('mis_path')).toBe(0);
    expect(session.getState().knownInfos).toEqual(new Set(['dia_intro']));
    expect(session.getState().pendingChoices).toHaveLength(1);
    expect(session.canBack()).toBe(false);
  });

  it('snapshots the unknown policy independently from a subsequent dialog launch', () => {
    const source = model({
      functions: new Map([
        ['dia_unknown_cond', fn('DIA_Unknown_Cond', [], [
          { type: 'NpcIsDeadCondition', npc: 'Guard', negated: false }
        ])],
        ['dia_unknown_info', fn('DIA_Unknown_Info', [])]
      ]),
      dialogs: [{
        name: 'DIA_Unknown', npc: 'NPC_Guard', nr: 1, sourceOrder: 0,
        conditionFunction: 'DIA_Unknown_Cond', informationFunction: 'DIA_Unknown_Info',
        important: false, permanent: true
      }]
    });
    const session = new SimulatorSession(source, { assumeUnknown: false });

    expect(session.startDialog('DIA_Unknown')).toBe(false);
    session.setAssumeUnknown(true);
    expect(session.startDialog('DIA_Unknown')).toBe(true);
    expect(session.back()).toBe(true);
    expect(session.getAssumeUnknown()).toBe(true);
    expect(session.getActiveFunctionName()).toBeUndefined();
    expect(session.back()).toBe(true);
    expect(session.getAssumeUnknown()).toBe(false);
  });

  it('never marks a choice target C_INFO known', () => {
    const base = model();
    const source = model({
      dialogs: [
        ...base.dialogs,
        {
          name: 'DIA_Next', npc: 'NPC_Guard', nr: 20, sourceOrder: 1,
          conditionFunction: 'DIA_Intro_Cond', informationFunction: 'DIA_Next_Info',
          important: false, permanent: false
        }
      ]
    });
    const session = new SimulatorSession(source);

    session.startDialog('DIA_Intro');
    session.selectChoice(0);
    expect(session.getState().knownInfos).toEqual(new Set(['dia_intro']));
  });

  it('rejects a missing information target without teaching the dialog', () => {
    const source = model({
      functions: new Map([['dia_intro_cond', fn('DIA_Intro_Cond')]]),
      dialogs: [{
        name: 'DIA_Broken', npc: 'NPC_Guard', nr: 1, sourceOrder: 0,
        conditionFunction: 'DIA_Intro_Cond', informationFunction: 'DIA_Missing_Info',
        important: false, permanent: false
      }]
    });
    const session = new SimulatorSession(source);

    expect(session.startDialog('DIA_Broken')).toBe(false);
    expect(session.getState().knownInfos).toEqual(new Set());
    expect(session.canBack()).toBe(false);
  });

  it('records an explicit transcript note when an entry gate is assumed true', () => {
    const source = model({
      functions: new Map([
        ['dia_unknown_cond', fn('DIA_Unknown_Cond', [], [
          { type: 'NpcIsDeadCondition', npc: 'Guard', negated: false }
        ])],
        ['dia_unknown_info', fn('DIA_Unknown_Info')]
      ]),
      dialogs: [{
        name: 'DIA_Unknown', npc: 'NPC_Guard', nr: 1, sourceOrder: 0,
        conditionFunction: 'DIA_Unknown_Cond', informationFunction: 'DIA_Unknown_Info',
        important: false, permanent: true
      }]
    });
    const session = new SimulatorSession(source, { assumeUnknown: true });

    expect(session.startDialog('DIA_Unknown')).toBe(true);
    expect(session.getState().transcript).toContainEqual(expect.objectContaining({
      kind: 'condition-note', condition: 'DIA_Unknown_Cond', assumed: true
    }));
  });

  it('does not teach an entry when its action budget aborts execution', () => {
    const source = model({
      functions: new Map([
        ['dia_intro_cond', fn('DIA_Intro_Cond')],
        ['dia_intro_info', fn('DIA_Intro_Info', [
          { type: 'DialogLine', speaker: 'other', text: 'First', id: 'BUDGET_01' },
          { type: 'DialogLine', speaker: 'other', text: 'Second', id: 'BUDGET_02' }
        ])]
      ])
    });
    const session = new SimulatorSession(source, { actionBudget: 1 });

    expect(session.startDialog('DIA_Intro')).toBe(true);
    expect(session.getState().knownInfos).toEqual(new Set());
    expect(session.getState().terminationReason).toBe('budget-exceeded');
  });
});
