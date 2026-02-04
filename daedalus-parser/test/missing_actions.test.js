const { test } = require('node:test');
const { strict: assert } = require('node:assert');
const DaedalusParser = require('../src/core/parser');
const { SemanticModelBuilderVisitor } = require('../dist/semantic/semantic-visitor');

test('should detect missing actions and structures', () => {
    const source = `
    func void DIA_Test_Info() {
        AI_Output(self, other, "DIA_Test_01"); // DialogLine

        AI_StopProcessInfos(self);             // Should be detected
        AI_PlayAni(self, "T_SEARCH");          // Should be detected
        AI_StartState(self, ZS_Talk, 1, "");   // Should be detected

        MIS_TestQuest = LOG_RUNNING;           // Variable assignment - Should be detected
    };
    `;

    // 1. Parse
    const parser = new DaedalusParser();
    const result = parser.parse(source);
    assert.equal(result.hasErrors, false, 'Should parse without errors');

    // 2. Build Semantic Model
    const visitor = new SemanticModelBuilderVisitor();
    visitor.pass1_createObjects(result.rootNode);
    visitor.pass2_analyzeAndLink(result.rootNode);

    const func = visitor.semanticModel.functions['DIA_Test_Info'];
    assert.ok(func, 'Function should be found');

    const actions = func.actions;

    console.log('Actions found:', JSON.stringify(actions, null, 2));

    // Check AI_Output (Baseline)
    const outputAction = actions.find(a => a.constructor.name === 'DialogLine');
    assert.ok(outputAction, 'Should find DialogLine action');

    // Check AI_StopProcessInfos
    // Now parsed as specific class
    const stopAction = actions.find(a => a.constructor.name === 'StopProcessInfosAction');
    assert.ok(stopAction, 'Should find StopProcessInfosAction');
    if (stopAction) {
        assert.equal(stopAction.target, 'self', 'StopProcessInfos target should be self');
    }

    // Check AI_PlayAni
    const playAniAction = actions.find(a => a.constructor.name === 'PlayAniAction');
    assert.ok(playAniAction, 'Should find PlayAniAction');
    if (playAniAction) {
        assert.equal(playAniAction.animationName, 'T_SEARCH', 'PlayAni animation should be T_SEARCH');
    }

    // Check Variable Assignment
    const assignmentAction = actions.find(a => a.constructor.name === 'SetVariableAction');
    assert.ok(assignmentAction, 'Should find SetVariableAction');
    if (assignmentAction) {
        assert.equal(assignmentAction.variableName, 'MIS_TestQuest', 'Variable name should be MIS_TestQuest');
        assert.equal(assignmentAction.value, 'LOG_RUNNING', 'Value should be LOG_RUNNING');
    }
});
