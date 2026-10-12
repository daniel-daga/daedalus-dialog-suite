'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { stateSchemes, routineEntries, schemeOfVisual, nearestMob } = require('../scripts/check-routine-mobs.js');

// The reading behind the measurement `check-routine-mobs.js` reports over the
// retail scripts and worlds (npc-editor.md §6, slice 7). The script itself
// needs an installation; this pins what it reads, on sources small enough to
// read.

const TA = `
func void TA_Sleep	(var int start_h, var int start_m, var int stop_h, var int stop_m, VAR string waypoint)	{TA_Min	(self,	start_h,start_m, stop_h, stop_m, ZS_GotoBed,	waypoint);};
func void TA_Stand_Guarding (var int start_h, var int start_m, var int stop_h, var int stop_m, VAR string waypoint)	{TA_Min	(self, start_h,start_m, stop_h, stop_m, ZS_Stand_Guarding, waypoint);};
`;
const ZS_SLEEP = `
func void ZS_GotoBed () { AI_StartState (self, ZS_Sleep, 0, ""); };
func int ZS_Sleep_Loop () { if (Wld_IsMobAvailable(self,"BEDHIGH")) { AI_UseMob (self, "BEDHIGH"	, 1); }; };
func void ZS_Sleep_End () { AI_UseMob (self, "BEDHIGH", -1); };
`;
const ZS_GUARD = 'func void ZS_Stand_Guarding () { AI_PlayAni (self, "T_STAND_2_HGUARD"); };';

test('a TA is mapped to the scheme its state sits down at, through the file defining the state', () => {
  const table = stateSchemes(TA, [ZS_SLEEP, ZS_GUARD]);
  assert.deepStrictEqual(table.get('TA_SLEEP'), { state: 'ZS_GotoBed', schemes: ['BEDHIGH'] });
});

test('a state that uses no mob has no row, and getting up (-1) is not a need', () => {
  const table = stateSchemes(TA, [ZS_SLEEP, ZS_GUARD]);
  assert.strictEqual(table.has('TA_STAND_GUARDING'), false);
  assert.strictEqual(stateSchemes(TA, ['func void ZS_GotoBed () { AI_UseMob (self, "BEDHIGH", -1); };']).size, 0);
});

test('routine entries are read with their waypoint, whatever the spacing', () => {
  const text = 'FUNC VOID Rtn_Start_1 () {\n\tTA_Sleep\t\t(22,00,\t07,00,"nw_farm_bed");\n\tTA_Sit_Bench (07, 00, 22, 00, "NW_FARM_BENCH");\n};';
  assert.deepStrictEqual(routineEntries(text), [
    { ta: 'TA_SLEEP', waypoint: 'NW_FARM_BED' },
    { ta: 'TA_SIT_BENCH', waypoint: 'NW_FARM_BENCH' },
  ]);
});

test('a mob scheme is its visual name up to the first underscore', () => {
  assert.strictEqual(schemeOfVisual('BedHigh_1_OC.asc'), 'BEDHIGH');
  assert.strictEqual(schemeOfVisual('INNOS_BELIAR_ADDON_01.ASC'), 'INNOS');
  assert.strictEqual(schemeOfVisual('BENCH.ASC'), 'BENCH');
});

test('the nearest mob counts only the wanted schemes, and none is null', () => {
  const mobs = [
    { scheme: 'BENCH', position: [100, 0, 0] },
    { scheme: 'BEDHIGH', position: [0, 0, 300] },
    { scheme: 'BEDHIGH', position: [0, 400, 0] },
  ];
  assert.strictEqual(nearestMob([0, 0, 0], ['BEDHIGH'], mobs), 300);
  assert.strictEqual(nearestMob([0, 0, 0], ['CHAIR'], mobs), null);
});
