const { test } = require('node:test');
const assert = require('node:assert');
const {
  findDialogReferences,
  findFunctionReferences,
  collectReachableFunctions
} = require('../dist/semantic/cross-references');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeModel({ dialogs = {}, functions = {} } = {}) {
  return { dialogs, functions };
}

function makeFunc(name, { actions = [], conditions = [] } = {}) {
  return { name, returnType: 'void', actions, conditions, calls: [] };
}

function makeDialog(name, { information, condition, npc = 'Test_Npc' } = {}) {
  const properties = { npc };
  if (information !== undefined) {
    properties.information = information;
  }
  if (condition !== undefined) {
    properties.condition = condition;
  }
  return { name, parent: 'C_INFO', properties, actions: [] };
}

function makeChoice(dialogRef, targetFunction) {
  return { type: 'Choice', dialogRef, text: 'Choice text', targetFunction };
}

function makeKnowsInfo(npc, dialogRef) {
  return { type: 'NpcKnowsInfoCondition', npc, dialogRef };
}

// ---------------------------------------------------------------------------
// findDialogReferences
// ---------------------------------------------------------------------------

test('findDialogReferences: finds NpcKnowsInfoCondition references', () => {
  const model = makeModel({
    functions: {
      DIA_Npc_Other_Condition: makeFunc('DIA_Npc_Other_Condition', {
        conditions: [makeKnowsInfo('self', 'DIA_Npc_Hello')]
      })
    },
    dialogs: {}
  });

  const refs = findDialogReferences(model, 'DIA_Npc_Hello');
  assert.equal(refs.length, 1);
  assert.equal(refs[0].functionName, 'DIA_Npc_Other_Condition');
  assert.equal(refs[0].kind, 'NpcKnowsInfo');
  assert.equal(refs[0].conditionIndex, 0);
});

test('findDialogReferences: returns empty when no references exist', () => {
  const model = makeModel({
    functions: {
      DIA_Npc_Cond: makeFunc('DIA_Npc_Cond', {
        conditions: [makeKnowsInfo('self', 'DIA_Npc_Other')]
      })
    }
  });

  const refs = findDialogReferences(model, 'DIA_Npc_Hello');
  assert.equal(refs.length, 0);
});

test('findDialogReferences: finds multiple references across functions', () => {
  const model = makeModel({
    functions: {
      Func1: makeFunc('Func1', { conditions: [makeKnowsInfo('self', 'DIA_Target')] }),
      Func2: makeFunc('Func2', { conditions: [makeKnowsInfo('other', 'DIA_Target')] })
    }
  });

  const refs = findDialogReferences(model, 'DIA_Target');
  assert.equal(refs.length, 2);
});

// ---------------------------------------------------------------------------
// findFunctionReferences
// ---------------------------------------------------------------------------

test('findFunctionReferences: finds dialog-info and dialog-condition property refs', () => {
  const model = makeModel({
    dialogs: {
      DIA_Test: makeDialog('DIA_Test', {
        information: 'DIA_Test_Info',
        condition: 'DIA_Test_Condition'
      })
    },
    functions: {}
  });

  const infoRefs = findFunctionReferences(model, 'DIA_Test_Info');
  assert.equal(infoRefs.length, 1);
  assert.equal(infoRefs[0].sourceKind, 'dialog-info');
  assert.equal(infoRefs[0].dialogName, 'DIA_Test');

  const condRefs = findFunctionReferences(model, 'DIA_Test_Condition');
  assert.equal(condRefs.length, 1);
  assert.equal(condRefs[0].sourceKind, 'dialog-condition');
  assert.equal(condRefs[0].dialogName, 'DIA_Test');
});

test('findFunctionReferences: finds Choice targetFunction refs', () => {
  const model = makeModel({
    dialogs: {},
    functions: {
      DIA_Test_Info: makeFunc('DIA_Test_Info', {
        actions: [makeChoice('DIA_Test', 'DIA_Test_Choice1')]
      })
    }
  });

  const refs = findFunctionReferences(model, 'DIA_Test_Choice1');
  assert.equal(refs.length, 1);
  assert.equal(refs[0].sourceKind, 'choice-target');
  assert.equal(refs[0].functionName, 'DIA_Test_Info');
  assert.equal(refs[0].actionIndex, 0);
});

test('findFunctionReferences: returns empty when not referenced', () => {
  const model = makeModel({ dialogs: {}, functions: {} });
  assert.equal(findFunctionReferences(model, 'DIA_Orphan').length, 0);
});

// ---------------------------------------------------------------------------
// collectReachableFunctions
// ---------------------------------------------------------------------------

test('collectReachableFunctions: includes start function and choice targets', () => {
  const model = makeModel({
    functions: {
      DIA_Test_Info: makeFunc('DIA_Test_Info', {
        actions: [makeChoice('DIA_Test', 'DIA_Test_Choice1')]
      }),
      DIA_Test_Choice1: makeFunc('DIA_Test_Choice1')
    }
  });

  const reachable = collectReachableFunctions(model, 'DIA_Test_Info');
  assert.ok(reachable.has('DIA_Test_Info'));
  assert.ok(reachable.has('DIA_Test_Choice1'));
  assert.equal(reachable.size, 2);
});

test('collectReachableFunctions: handles cycles without infinite loop', () => {
  const model = makeModel({
    functions: {
      A: makeFunc('A', { actions: [makeChoice('DIA', 'B')] }),
      B: makeFunc('B', { actions: [makeChoice('DIA', 'A')] })
    }
  });

  const reachable = collectReachableFunctions(model, 'A');
  assert.ok(reachable.has('A'));
  assert.ok(reachable.has('B'));
  assert.equal(reachable.size, 2);
});

test('collectReachableFunctions: skips dangling function references', () => {
  const model = makeModel({
    functions: {
      DIA_Test_Info: makeFunc('DIA_Test_Info', {
        actions: [makeChoice('DIA_Test', 'DIA_Test_Missing')]
      })
    }
  });

  const reachable = collectReachableFunctions(model, 'DIA_Test_Info');
  assert.ok(reachable.has('DIA_Test_Info'));
  assert.ok(!reachable.has('DIA_Test_Missing'));
  assert.equal(reachable.size, 1);
});

// ---------------------------------------------------------------------------
// Review fixes (docs/plans/parser-review-fixes.md)
// ---------------------------------------------------------------------------

function makeConditional(thenActions = [], elseActions = []) {
  return { type: 'ConditionalAction', condition: 'X > 0', thenActions, elseActions };
}

// F8: choices nested inside ConditionalAction branches must be visible.
test('findFunctionReferences: finds Choice targets nested in conditional branches', () => {
  const model = makeModel({
    functions: {
      DIA_Npc_Info: makeFunc('DIA_Npc_Info', {
        actions: [makeConditional([makeChoice('DIA_Npc', 'DIA_Npc_Target')], [])]
      })
    }
  });

  const refs = findFunctionReferences(model, 'DIA_Npc_Target');
  assert.equal(refs.length, 1);
  assert.equal(refs[0].sourceKind, 'choice-target');
  assert.equal(refs[0].functionName, 'DIA_Npc_Info');
  assert.equal(refs[0].actionIndex, 0, 'actionIndex should point at the top-level containing action');
});

test('collectReachableFunctions: follows Choice targets nested in conditional branches', () => {
  const model = makeModel({
    functions: {
      DIA_Npc_Info: makeFunc('DIA_Npc_Info', {
        actions: [makeConditional([], [makeChoice('DIA_Npc', 'DIA_Npc_Deep')])]
      }),
      DIA_Npc_Deep: makeFunc('DIA_Npc_Deep')
    }
  });

  const reachable = collectReachableFunctions(model, 'DIA_Npc_Info');
  assert.ok(reachable.has('DIA_Npc_Deep'), 'nested choice target should be reachable');
});

// D3 (docs/plans/frontend-editor-review-fixes.md): information/condition hold a
// string-vs-DialogFunction union; the linked-object branch must resolve by name.
test('findFunctionReferences: matches linked DialogFunction object refs', () => {
  const infoFunc = makeFunc('DIA_Obj_Info');
  const condFunc = makeFunc('DIA_Obj_Cond');
  const model = makeModel({
    dialogs: {
      DIA_Obj: makeDialog('DIA_Obj', { information: infoFunc, condition: condFunc })
    },
    functions: { DIA_Obj_Info: infoFunc, DIA_Obj_Cond: condFunc }
  });

  const infoRefs = findFunctionReferences(model, 'DIA_Obj_Info');
  assert.equal(infoRefs.length, 1);
  assert.equal(infoRefs[0].sourceKind, 'dialog-info');
  assert.equal(infoRefs[0].dialogName, 'DIA_Obj');

  const condRefs = findFunctionReferences(model, 'DIA_Obj_Cond');
  assert.equal(condRefs.length, 1);
  assert.equal(condRefs[0].sourceKind, 'dialog-condition');
  assert.equal(condRefs[0].dialogName, 'DIA_Obj');
});

// F3: dialog property lookups must be case-insensitive.
test('findFunctionReferences: matches capitalized Information/Condition property keys', () => {
  const dialog = makeDialog('DIA_Caps');
  dialog.properties = { npc: 'Test_Npc', Information: 'DIA_Caps_Info', Condition: 'DIA_Caps_Cond' };
  const model = makeModel({ dialogs: { DIA_Caps: dialog } });

  const infoRefs = findFunctionReferences(model, 'DIA_Caps_Info');
  assert.equal(infoRefs.length, 1);
  assert.equal(infoRefs[0].sourceKind, 'dialog-info');

  const condRefs = findFunctionReferences(model, 'DIA_Caps_Cond');
  assert.equal(condRefs.length, 1);
  assert.equal(condRefs[0].sourceKind, 'dialog-condition');
});
