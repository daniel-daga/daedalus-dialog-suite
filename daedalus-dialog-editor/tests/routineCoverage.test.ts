import { countRoutineCalls } from '../scripts/check-routine-coverage.js';

test('the TA-family calls in a source are counted, declarations and comments excluded', () => {
  expect(countRoutineCalls('TA_Sleep (22,00,06,00,"WP"); ta_min(self,6,0,22,0,ZS_X,"WP"); // TA_Sit(1,0,2,0,"W")')).toBe(2);
  expect(countRoutineCalls('func void TA_Sleep(var int a) { TA_Min(self,a,0,a,0,ZS_Sleep,"W"); };')).toBe(1);
});

test('an instance whose name starts with TA_ is not a call', () => {
  // Measured 2026-09-01: `Testmodelle_Kalveram.d` declares `instance
  // TA_Testmodell (Npc_Default)`, which the call regex matched, so the
  // corpus-wide denominator over-counted by two.
  expect(countRoutineCalls('instance TA_Testmodell (Npc_Default) { TA_Sleep(22,00,06,00,"WP"); };')).toBe(1);
  expect(countRoutineCalls('PROTOTYPE TA_Proto (C_NPC) { };')).toBe(0);
});
