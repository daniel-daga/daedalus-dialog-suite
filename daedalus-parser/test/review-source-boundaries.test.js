const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createParser } = require('./helpers');
const {
  parseSemanticModel, deserializeSemanticModel, SemanticCodeGenerator, DialogLine
} = require('../dist/semantic/semantic-visitor-index');
const { applyNpcEdits, extractNpcDefinition } = require('daedalus-parser/npc-definition');

function parse(source) {
  const model = parseSemanticModel(source);
  assert.equal(model.hasErrors, false, JSON.stringify(model.errors));
  return model;
}

function hydrate(model) {
  return deserializeSemanticModel(JSON.parse(JSON.stringify(model)));
}

function comments(source) {
  const root = createParser().parse(source).rootNode;
  assert.equal(root.hasError, false, source);
  return root.descendantsOfType('comment').map(node => node.text);
}

function findAction(actions, type) {
  for (const action of actions) {
    if (action.type === type) {
      return action;
    }
    if (action.type === 'ConditionalAction') {
      const found = findAction([...action.thenActions, ...action.elseActions], type);
      if (found) {
        return found;
      }
    }
  }
  return undefined;
}

for (const newline of ['\n', '\r\n']) {
  for (const tail of [
    ' /* first\n "quoted" // ordinary comment text\n */',
    ' /* first\n */ /* second\n */',
    ' /* first\n */ // last'
  ]) {
    test(`NPC insertions stay executable across trailing comments: ${JSON.stringify([newline, tail])}`, () => {
      const source = ['instance N(C_NPC) {', `\tlevel = 1;${tail}`, '};'].join('\n').replace(/\n/g, newline);
      const edits = [
        { op: 'set', field: 'strength', value: '3' },
        { op: 'addCall', name: 'EquipItem', args: ['self', 'Sword'] },
        { op: 'setCall', name: 'Mdl_SetModelFatness', args: ['self', '2'] }
      ];
      const output = applyNpcEdits(source, edits);
      const { statements } = extractNpcDefinition(output);
      assert.equal(statements.find(s => s.kind === 'field' && s.field === 'strength')?.value, '3', output);
      assert.deepEqual(statements.filter(s => s.kind === 'call').map(s => s.name), ['EquipItem', 'Mdl_SetModelFatness']);
      assert.deepEqual(comments(output), comments(source));
      if (newline === '\r\n') {
        assert.equal(output.replace(/\r\n/g, '').includes('\n'), false, output);
      }
    });
  }
}

test('NPC call insertion follows a complete trailing block comment on its call anchor', () => {
  const source = 'instance N(C_NPC) {\n\tEquipItem(self, Sword); /* keep\n */\n};';
  const output = applyNpcEdits(source, [{ op: 'addCall', name: 'EquipItem', args: ['self', 'Bow'] }]);
  assert.deepEqual(extractNpcDefinition(output).statements.filter(s => s.kind === 'call').map(s => s.args),
    [['self', 'Sword'], ['self', 'Bow']]);
  assert.deepEqual(comments(output), comments(source));
});

test('NPC insertion stays inside the body when a trailing comment closes beside its brace', () => {
  const source = 'instance N(C_NPC) {\n level = 1; /* keep\n */ };';
  const output = applyNpcEdits(source, [{ op: 'set', field: 'strength', value: '3' }]);
  assert.equal(extractNpcDefinition(output).statements.find(s => s.field === 'strength')?.value, '3', output);
  assert.deepEqual(comments(output), comments(source));
});

for (const identifier of ['Hügo', 'Ärger', 'GIL_Ö', '_ÿ']) {
  test(`dialog property identifier identity survives JSON, edits and style changes: ${identifier}`, () => {
    let model = parse(`instance D(C_INFO) { npc = ${identifier}; description = "${identifier}"; };`);
    for (const preserveSourceStyle of [false, true, false]) {
      model = hydrate(model);
      const output = new SemanticCodeGenerator({ preserveSourceStyle }).generateSemanticModel(model);
      const body = createParser().parse(output).rootNode.namedChildren[0].childForFieldName('body');
      const values = body.namedChildren.map(node => node.childForFieldName('right'));
      assert.equal(values[0].type, 'identifier', output);
      assert.equal(values[0].text, identifier, output);
      assert.equal(values[1].type, 'string', output);
      model = parse(output);
    }
    model.dialogs.D.properties.npc = 'Anderer_Ä';
    assert.match(new SemanticCodeGenerator().generateSemanticModel(hydrate(model)), /npc\s*=\s*Anderer_Ä;/);
  });
}

test('legacy unmarked Latin-1 identifiers keep their meaning', () => {
  const model = hydrate(parse('instance D(C_INFO) { npc = Hügo; };'));
  delete model.dialogs.D.propertyExpressionKeys;
  const output = new SemanticCodeGenerator({ preserveSourceStyle: false }).generateSemanticModel(model);
  assert.equal(parse(output).dialogs.D.properties.npc, 'Hügo', output);
});

for (const literal of ['0.0000001', '1.0', '0001', '9007199254740993', '1000000000000000000000']) {
  test(`numeric source spelling remains valid and exact: ${literal}`, () => {
    let model = parse(`instance D(C_INFO) { nr = ${literal}; condition = Check; };
func int Check() { if (value == ${literal}) { return TRUE; }; };
func void F() { x = ${literal}; };`);
    for (const preserveSourceStyle of [true, false, true]) {
      const output = new SemanticCodeGenerator({ preserveSourceStyle }).generateSemanticModel(hydrate(model));
      model = parse(output);
      assert.equal(String(model.dialogs.D.properties.nr), literal, output);
      assert.equal(String(model.functions.Check.conditions[0].value), literal, output);
      assert.equal(String(model.functions.F.actions[0].value), literal, output);
    }
    model.functions.F.actions[0].value = 2;
    assert.match(new SemanticCodeGenerator().generateSemanticModel(hydrate(model)), /x\s*=\s*2;/);
  });
}

test('numeric action arguments keep noncanonical literals while canonical integers remain numbers', () => {
  const model = parse('func void F() { CreateInvItems(self, Gold, 01); Npc_SetRefuseTalk(self, -0); CreateInvItems(self, Gold, 0); };');
  assert.equal(model.functions.F.actions[0].quantity, 1);
  assert.ok(Object.is(model.functions.F.actions[1].seconds, -0));
  assert.equal(model.functions.F.actions[2].quantity, 0);
  const output = new SemanticCodeGenerator().generateSemanticModel(hydrate(model));
  assert.match(output, /Gold, 01\)/);
  assert.match(output, /self, -0\)/);
});

for (const [value, literal] of [[0.0000001, '0.0000001'], [1e21, '1000000000000000000000']]) {
  test(`edited numeric fields emit grammar-compatible decimals: ${literal}`, () => {
    const model = parse(`instance D(C_INFO) { nr = 1; condition = Check; };
func int Check() {
  if (value == 1 && Npc_HasItems(self, Gold) > 1 && Npc_GetDistToWP(self, "WP") > 1
      && Npc_GetTalentSkill(self, Talent) > 1) { return TRUE; };
};
func void F() {
  x /* gap */ = 1;
  CreateInvItems(self, Gold, 1);
  B_GiveInvItems(self, other, Gold, 1);
  B_Attack(self, other, AR_NONE, 1);
  Npc_SetRefuseTalk(self, 1);
  B_Kapitelwechsel(1, WORLD);
};`);
    model.dialogs.D.properties.nr = value;
    model.functions.Check.conditions.forEach(condition => { condition.value = value; });
    const fields = ['value', 'quantity', 'quantity', 'damage', 'seconds', 'chapter'];
    model.functions.F.actions.forEach((action, index) => { action[fields[index]] = value; });
    const output = new SemanticCodeGenerator().generateSemanticModel(hydrate(model));
    parse(output);
    const numbers = createParser().parse(output).rootNode.descendantsOfType('number').map(node => node.text);
    assert.equal(numbers.length, 11, output);
    assert.ok(numbers.every(number => number === literal), output);
    assert.deepEqual(comments(output), ['/* gap */']);
  });
}

const branches = [body => body, body => `if (Flag) { ${body} };`,
  body => `if (Flag) { Touch(); } else { ${body} };`, body => `if (Flag) { if (Other) { ${body} }; };`];

for (const suffix of [' /* keep */', ' /* first */ /* second */', ' // keep\n', ' /* keep\r\n  ä */']) {
  test(`call statement suffix comments survive typed edits and JSON: ${JSON.stringify(suffix)}`, () => {
    for (const branch of branches) {
      const source = `func void F() { ${branch(`AI_Output(self, other, "ID")${suffix}; // original subtitle\n`)} };`;
      let model = parse(source);
      for (let cycle = 0; cycle < 3; cycle += 1) {
        model = hydrate(model);
        const line = findAction(model.functions.F.actions, 'DialogLine');
        assert.ok(line instanceof DialogLine);
        line.id = 'EDITED';
        line.text = 'edited subtitle';
        const output = new SemanticCodeGenerator().generateSemanticModel(model);
        assert.deepEqual(comments(output), [...comments(source).filter(text => text !== '// original subtitle'), '//edited subtitle']);
        assert.ok(output.includes('//edited subtitle'), output);
        assert.equal(output.includes('// original subtitle'), false, output);
        model = parse(output);
        assert.equal(findAction(model.functions.F.actions, 'DialogLine').id, 'EDITED');
      }
      const withoutComments = new SemanticCodeGenerator({ includeComments: false }).generateSemanticModel(model);
      assert.deepEqual(comments(withoutComments), []);
      assert.equal(findAction(parse(withoutComments).functions.F.actions, 'DialogLine').id, 'EDITED');
    }
  });
}

test('generic call suffix and call-internal comments survive together', () => {
  const source = 'func void F() { Foo(/* inner */ 1) /* after */; };';
  const model = hydrate(parse(source));
  const output = new SemanticCodeGenerator().generateSemanticModel(model);
  assert.deepEqual(comments(output), comments(source));
  assert.equal(model.functions.F.actions[0].type, 'Action');
});

test('typed call arity edits keep suffix comments and use the current arguments', () => {
  const source = 'func void F() { B_TeachCustom(/* inner */ self, 1) // after\n; };';
  const model = hydrate(parse(source));
  model.functions.F.actions[0].teachArgs = ['other', '2', '3'];
  const output = new SemanticCodeGenerator().generateSemanticModel(model);
  assert.deepEqual(comments(output), comments(source));
  assert.deepEqual(findAction(parse(output).functions.F.actions, 'TeachAction').teachArgs, ['other', '2', '3']);
});

test('all trailing property comments retain their order, text and edited property value', () => {
  const source = 'instance D(C_INFO) { nr = 1; /* first */  /* second */\t// last\n description = "D"; };';
  let model = parse(source);
  for (let cycle = 0; cycle < 3; cycle += 1) {
    model = hydrate(model);
    model.dialogs.D.properties.nr = 2;
    const output = new SemanticCodeGenerator().generateSemanticModel(model);
    assert.deepEqual(comments(output), comments(source));
    assert.ok(output.includes('/* first */  /* second */\t// last'), output);
    model = parse(output);
    assert.equal(model.dialogs.D.properties.nr, 2);
  }
  const output = new SemanticCodeGenerator({ includeComments: false }).generateSemanticModel(hydrate(model));
  assert.deepEqual(comments(output), []);
  assert.equal(parse(output).dialogs.D.properties.nr, 2);
});
