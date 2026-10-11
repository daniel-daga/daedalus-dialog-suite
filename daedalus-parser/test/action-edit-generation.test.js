const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PickpocketAction } = require('../dist/semantic/npcActions');
const { RemoveInventoryItemsAction } = require('../dist/semantic/inventoryActions');

test('parsed pickpocket arguments use edited chances while retaining extra arguments and casing', () => {
  const action = new PickpocketAction('C_Beklauen', '10', '90', 'c_beklauen', ['10', '90', 'Extra']);
  action.minChance = '30';
  action.maxChance = '70';
  assert.equal(action.generateCode({}), 'c_beklauen (30, 70, Extra);');
});

test('pickpocket mode edits replace the original callee and argument shape', () => {
  const action = new PickpocketAction('C_Beklauen', '10', '90', 'c_beklauen', ['10', '90']);
  action.pickpocketMode = 'B_Beklauen';
  assert.equal(action.generateCode({}), 'B_Beklauen ();');
  const execute = new PickpocketAction('B_Beklauen', undefined, undefined, 'b_beklauen', []);
  execute.pickpocketMode = 'C_Beklauen';
  execute.minChance = '30';
  execute.maxChance = '70';
  assert.equal(execute.generateCode({}), 'C_Beklauen (30, 70);');
});

test('unchanged unusual pickpocket argument lists retain their original spelling', () => {
  for (const args of [[], ['self'], ['self', 'other', 'Extra']]) {
    const action = new PickpocketAction('B_Beklauen', args[0], args[1], 'b_beklauen', args);
    assert.equal(action.generateCode({}), `b_beklauen (${args.join(', ')});`);
  }
});

test('singular inventory removal always has two arguments, including after mode edits', () => {
  const action = new RemoveInventoryItemsAction('Npc_RemoveInvItems', 'self', 'Gold', '5');
  action.removeFunctionName = 'Npc_RemoveInvItem';
  assert.equal(action.generateCode({}), 'Npc_RemoveInvItem (self, Gold);');
  action.removeQuantity = '';
  assert.equal(action.generateCode({}), 'Npc_RemoveInvItem (self, Gold);');
  action.removeFunctionName = 'npc_removeinvitem';
  assert.equal(action.generateCode({}), 'npc_removeinvitem (self, Gold);');
});

test('plural inventory removal requires a nonempty quantity and retains expressions', () => {
  for (const quantity of [undefined, '', '  ']) {
    const action = new RemoveInventoryItemsAction('Npc_RemoveInvItems', 'self', 'Gold', quantity);
    assert.throws(() => action.generateCode({}), /quantity/i);
  }
  const action = new RemoveInventoryItemsAction('Npc_RemoveInvItems', 'self', 'Gold', 'Count + 1');
  assert.equal(action.generateCode({}), 'Npc_RemoveInvItems (self, Gold, Count + 1);');
});
