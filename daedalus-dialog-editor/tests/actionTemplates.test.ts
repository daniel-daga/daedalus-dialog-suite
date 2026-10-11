import { ACTION_TEMPLATES } from '../src/renderer/components/actionTemplates';

describe('ACTION_TEMPLATES.attackAction', () => {
  // Issue #116: generated `B_Attack (self, hero, ATTACK_REASON_KILL, 1);` fails
  // in-game with "Unknown Identifier". Gothic 2 scripts use
  // `B_Attack (self, other, AR_NONE, 1);` (see daedalus-parser/reference/DIA_Farim.d).
  test('defaults match valid Gothic 2 identifiers', () => {
    const action = ACTION_TEMPLATES.attackAction();

    expect(action.attacker).toBe('self');
    expect(action.target).toBe('other');
    expect(action.attackReason).toBe('AR_NONE');
    expect(action.damage).toBe(1);
  });
});
