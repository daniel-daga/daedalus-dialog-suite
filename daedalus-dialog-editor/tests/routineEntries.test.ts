import { readRoutine, withRoutineFunction, writeRoutine, type RoutineEntry } from '../src/renderer/routines/routineEntries';
import type { RoutineArgIndex } from '../src/shared/types';

// Routine authoring (npc-editor.md §6): a routine function's `TA_*` calls as
// entries an editor can change, and those entries written back into the
// function's actions. Each action is one statement kept verbatim by the model,
// so an edit rewrites only the tokens it changed in only the action it touched.

const layouts: Record<string, RoutineArgIndex> = {
  TA: { startH: 1, stopH: 2, waypoint: 4 },
  TA_MIN: { startH: 1, startM: 2, stopH: 3, stopM: 4, waypoint: 6 },
  TA_SIT_THRONE: { startH: 0, startM: 1, stopH: 2, stopM: 3, waypoint: 4 },
  TA_SLEEP: { startH: 0, startM: 1, stopH: 2, stopM: 3, waypoint: 4 },
  TA_STAND_GUARDING: { startH: 0, startM: 1, stopH: 2, stopM: 3, waypoint: 4 },
};

const action = (text: string) => ({ type: 'Action', action: text });
const comment = (text: string) => ({ type: 'CommentAction', text });

const onar = () => [
  action('TA_Sit_Throne\t(07,00,22,00,"NW_BIGFARM_HOUSE_ONAR_SIT")'),
  comment('// sleeps upstairs'),
  action('TA_Sleep\t\t(22,00,07,00,"NW_BIGFARM_HOUSE_UP1_04")'),
];

const texts = (actions: unknown[]) => actions.map((a) => {
  const x = a as { action?: string; text?: string };
  return x.action ?? x.text;
});

describe('readRoutine', () => {
  it('reads each routine call as an entry, in source order, and skips everything else', () => {
    const entries = readRoutine(onar(), layouts);

    expect(entries.map(({ state, startMinute, endMinute, waypoint }) => ({ state, startMinute, endMinute, waypoint })))
      .toEqual([
        { state: 'TA_Sit_Throne', startMinute: 7 * 60, endMinute: 22 * 60, waypoint: 'NW_BIGFARM_HOUSE_ONAR_SIT' },
        { state: 'TA_Sleep', startMinute: 22 * 60, endMinute: 7 * 60, waypoint: 'NW_BIGFARM_HOUSE_UP1_04' },
      ]);
    expect(entries.map((e) => e.source?.actionIndex)).toEqual([0, 2]);
  });

  it('reads the engine externals in their own layout, and hour 24 as midnight', () => {
    const entries = readRoutine([
      action('TA_MIN (self, 8, 30, 24, 0, ZS_Stand, "WP_A")'),
      action('TA (self, 24, 8, ZS_Sleep, "WP_B")'),
    ], layouts);

    expect(entries.map(({ startMinute, endMinute, waypoint }) => ({ startMinute, endMinute, waypoint }))).toEqual([
      { startMinute: 8 * 60 + 30, endMinute: 0, waypoint: 'WP_A' },
      { startMinute: 0, endMinute: 8 * 60, waypoint: 'WP_B' },
    ]);
  });

  it('leaves a call it cannot read literally out of the entries, never guessing', () => {
    const entries = readRoutine([
      action('TA_Sleep (START_H,00,07,00,"WP")'),
      action('TA_Sleep (22,00,07,00,wpVariable)'),
      action('Print ("TA_Sleep")'),
      action('Unknown_Wrapper (22,00,07,00,"WP")'),
    ], layouts);

    expect(entries).toEqual([]);
  });
});

describe('writeRoutine', () => {
  it('writes nothing different when nothing changed', () => {
    const actions = onar();
    expect(writeRoutine(actions, readRoutine(actions, layouts), layouts)).toEqual(actions);
  });

  it('rewrites only the tokens an edit changed, keeping spacing and two-digit hours', () => {
    const actions = onar();
    const [throne, sleep] = readRoutine(actions, layouts);

    const written = writeRoutine(actions, [
      { ...throne, endMinute: 21 * 60 + 30 },
      { ...sleep, startMinute: 21 * 60 + 30, waypoint: 'NW_BIGFARM_HOUSE_UP1_05' },
    ], layouts);

    expect(texts(written)).toEqual([
      'TA_Sit_Throne\t(07,00,21,30,"NW_BIGFARM_HOUSE_ONAR_SIT")',
      '// sleeps upstairs',
      'TA_Sleep\t\t(21,30,07,00,"NW_BIGFARM_HOUSE_UP1_05")',
    ]);
  });

  it('keeps an unpadded literal unpadded, and writes midnight as an end at 24', () => {
    const actions = [action('TA_MIN (self, 8, 0, 22, 0, ZS_Stand, "WP_A")')];
    const [entry] = readRoutine(actions, layouts);

    expect(texts(writeRoutine(actions, [{ ...entry, startMinute: 9 * 60, endMinute: 0 }], layouts)))
      .toEqual(['TA_MIN (self, 9, 0, 24, 0, ZS_Stand, "WP_A")']);
  });

  it('changes the state by renaming the callee when the layouts agree', () => {
    const actions = onar();
    const [throne, sleep] = readRoutine(actions, layouts);

    expect(texts(writeRoutine(actions, [{ ...throne, state: 'TA_Stand_Guarding' }, sleep], layouts))[0])
      .toBe('TA_Stand_Guarding\t(07,00,22,00,"NW_BIGFARM_HOUSE_ONAR_SIT")');
  });

  it('drops a removed entry and keeps the comments around it', () => {
    const actions = onar();
    const [throne] = readRoutine(actions, layouts);

    expect(texts(writeRoutine(actions, [{ ...throne, endMinute: 7 * 60 }], layouts))).toEqual([
      'TA_Sit_Throne\t(07,00,07,00,"NW_BIGFARM_HOUSE_ONAR_SIT")',
      '// sleeps upstairs',
    ]);
  });

  it('inserts a new entry after the entry before it, spaced like it', () => {
    const actions = onar();
    const [throne, sleep] = readRoutine(actions, layouts);
    const guard: RoutineEntry = {
      state: 'TA_Stand_Guarding', startMinute: 13 * 60 + 30, endMinute: 14 * 60, waypoint: 'WP_X',
    };

    const written = writeRoutine(actions, [
      { ...throne, endMinute: 13 * 60 + 30 },
      guard,
      { ...throne, source: undefined, startMinute: 14 * 60 },
      sleep,
    ], layouts);

    expect(texts(written)).toEqual([
      'TA_Sit_Throne\t(07,00,13,30,"NW_BIGFARM_HOUSE_ONAR_SIT")',
      'TA_Stand_Guarding\t(13,30,14,00,"WP_X")',
      'TA_Sit_Throne\t(14,00,22,00,"NW_BIGFARM_HOUSE_ONAR_SIT")',
      '// sleeps upstairs',
      'TA_Sleep\t\t(22,00,07,00,"NW_BIGFARM_HOUSE_UP1_04")',
    ]);
    expect(written[1]).toEqual({ type: 'Action', action: 'TA_Stand_Guarding\t(13,30,14,00,"WP_X")' });
  });

  it('writes entries into a routine that has none', () => {
    const entry: RoutineEntry = { state: 'TA_Sleep', startMinute: 0, endMinute: 0, waypoint: 'WP_BED' };

    expect(texts(writeRoutine([], [entry], layouts))).toEqual(['TA_Sleep (00,00,00,00,"WP_BED")']);
  });

  it('refuses a minute an hour-only call cannot carry', () => {
    const actions = [action('TA (self, 8, 22, ZS_Stand, "WP_A")')];
    const [entry] = readRoutine(actions, layouts);

    expect(() => writeRoutine(actions, [{ ...entry, startMinute: 8 * 60 + 30 }], layouts))
      .toThrow(/TA.*whole hours/);
  });

  it('refuses a state whose layout it cannot fill from the entry alone', () => {
    const actions = onar();
    const [throne, sleep] = readRoutine(actions, layouts);

    expect(() => writeRoutine(actions, [{ ...throne, state: 'TA_MIN' }, sleep], layouts))
      .toThrow(/TA_MIN/);
  });
});

describe('withRoutineFunction', () => {
  // Creating a routine (npc-editor.md §6 slice 5, #316) appends a function to
  // the NPC's file model; the save regenerates the file from it, so the
  // function has to be in the declaration order or it lands wherever the
  // generator's fallback puts leftovers.
  const model = () => ({
    dialogs: {},
    functions: { Rtn_Start_900: { name: 'Rtn_Start_900', returnType: 'VOID', actions: [] } },
    declarationOrder: [{ type: 'instance', name: 'BAU_900_Onar' }, { type: 'function', name: 'Rtn_Start_900' }],
  });

  it('appends a VOID function with the actions, last in the declaration order', () => {
    const actions = [{ type: 'Action', action: 'TA_Sleep (00,00,00,00,"WP_BED")' }];
    const next = withRoutineFunction(model() as never, 'Rtn_Ship_900', actions);

    expect(next.functions.Rtn_Ship_900).toMatchObject({
      name: 'Rtn_Ship_900', returnType: 'VOID', parameters: [], actions, conditions: [], calls: [], callSites: [],
    });
    expect(next.declarationOrder!.at(-1)).toEqual({ type: 'function', name: 'Rtn_Ship_900', blankLinesBefore: 1 });
    expect(model().declarationOrder).toHaveLength(2);
  });

  it('refuses a name the file already declares, whatever its case', () => {
    expect(() => withRoutineFunction(model() as never, 'RTN_START_900', [])).toThrow(/RTN_START_900 already exists/);
  });
});
