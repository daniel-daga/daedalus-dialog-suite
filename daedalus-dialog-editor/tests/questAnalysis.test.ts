import { analyzeQuest, getQuestReferences, getUsedQuestTopics, findDialogNameForFunction } from '../src/renderer/components/QuestEditor/questAnalysis';
import type { SemanticModel } from '../src/renderer/types/global';

// Mock Semantic Model Helper
const createMockModel = (functions: any[], dialogs: any[], constants: any[] = [], variables: any[] = []): SemanticModel => {
    const funcMap: Record<string, any> = {};
    functions.forEach(f => funcMap[f.name] = f);

    const dialogMap: Record<string, any> = {};
    dialogs.forEach(d => dialogMap[d.name] = d);

    const constMap: Record<string, any> = {};
    constants.forEach(c => constMap[c.name] = c);

    const varMap: Record<string, any> = {};
    variables.forEach(v => varMap[v.name] = v);

    return {
        functions: funcMap,
        dialogs: dialogMap,
        constants: constMap,
        variables: varMap,
        instances: {},
        classes: {},
        structs: {},
    } as SemanticModel;
};

describe('questAnalysis', () => {
    describe('analyzeQuest', () => {
        it('should correctly analyze an implemented quest', () => {
            const questName = 'TOPIC_TEST';
            const misVarName = 'MIS_TEST';

            const constants = [{ name: questName, value: '"Test Quest"', filePath: 'Topics.d' }];
            const variables = [{ name: misVarName, type: 'int', filePath: 'Topics.d' }];

            const functions = [
                {
                    name: 'DIA_Start',
                    actions: [{ type: 'CreateTopic', topic: questName }]
                },
                {
                    name: 'DIA_End',
                    actions: [{ type: 'LogSetTopicStatus', topic: questName, status: 'LOG_SUCCESS' }]
                }
            ];

            const model = createMockModel(functions, [], constants, variables);
            const result = analyzeQuest(model, questName);

            expect(result.status).toBe('implemented');
            expect(result.misVariableExists).toBe(true);
            expect(result.hasStart).toBe(true);
            expect(result.hasSuccess).toBe(true);
            expect(result.description).toBe('Test Quest');
        });

        it('should detect WIP quest (no end)', () => {
            const questName = 'TOPIC_WIP';
            const misVarName = 'MIS_WIP';

            const constants = [{ name: questName, value: '"WIP Quest"' }];
            const variables = [{ name: misVarName, type: 'int' }];

            const functions = [
                {
                    name: 'DIA_Start',
                    actions: [{ type: 'CreateTopic', topic: questName }]
                }
            ];

            const model = createMockModel(functions, [], constants, variables);
            const result = analyzeQuest(model, questName);

            expect(result.status).toBe('wip');
            expect(result.hasStart).toBe(true);
            expect(result.hasSuccess).toBe(false);
        });

        it('should handle quest with no variable (Method A/Implicit)', () => {
            const questName = 'TOPIC_NOVAR';
            // No variable definition

            const model = createMockModel([], [], [{ name: questName, value: '"No Var"' }], []);
            const result = analyzeQuest(model, questName);

            expect(result.status).toBe('not_started');
            expect(result.logicMethod).toBe('unknown');
            expect(result.misVariableExists).toBe(false);
        });
    });

    describe('getQuestReferences', () => {
        it('should find references to quest usage', () => {
            const questName = 'TOPIC_REF';
            const misVarName = 'MIS_REF';

            const functions = [
                {
                    name: 'DIA_Start_Info',
                    actions: [{ type: 'CreateTopic', topic: questName, topicType: 'LOG_MISSION' }]
                },
                {
                    name: 'DIA_Check_Info',
                    conditions: [
                        { type: 'VariableCondition', variableName: misVarName, negated: false }
                    ]
                }
            ];

            const dialogs = [
                { name: 'DIA_Start', properties: { information: 'DIA_Start_Info', npc: 'NPC_A' } },
                { name: 'DIA_Check', properties: { information: 'DIA_Check_Info', npc: 'NPC_B' } }
            ];

            const model = createMockModel(functions, dialogs);
            const refs = getQuestReferences(model, questName);

            expect(refs).toHaveLength(2);

            const startRef = refs.find(r => r.functionName === 'DIA_Start_Info');
            expect(startRef).toBeDefined();
            expect(startRef?.type).toBe('create');
            expect(startRef?.npcName).toBe('NPC_A');

            const checkRef = refs.find(r => r.functionName === 'DIA_Check_Info');
            expect(checkRef).toBeDefined();
            expect(checkRef?.type).toBe('condition');
            expect(checkRef?.npcName).toBe('NPC_B');
        });
    });

    describe('getUsedQuestTopics', () => {
        it('should return unique set of topics used in actions', () => {
            const functions = [
                {
                    name: 'F1',
                    actions: [{ type: 'LogEntry', topic: 'TOPIC_A', text: '...' }]
                },
                {
                    name: 'F2',
                    actions: [
                        { type: 'LogSetTopicStatus', topic: 'TOPIC_A', status: '...' },
                        { type: 'CreateTopic', topic: 'TOPIC_B' }
                    ]
                }
            ];

            const model = createMockModel(functions, []);
            const used = getUsedQuestTopics(model);

            expect(used.size).toBe(2);
            expect(used.has('TOPIC_A')).toBe(true);
            expect(used.has('TOPIC_B')).toBe(true);
        });
    });

    describe('findDialogNameForFunction', () => {
        it('should resolve function name to dialog name', () => {
            const dialogs = [
                { name: 'DIA_A', properties: { information: 'DIA_A_Info' } },
                { name: 'DIA_B', properties: { information: { name: 'DIA_B_Info' } } }
            ];

            const model = createMockModel([], dialogs);

            expect(findDialogNameForFunction(model, 'DIA_A_Info')).toBe('DIA_A');
            expect(findDialogNameForFunction(model, 'dia_a_info')).toBe('DIA_A'); // Case insensitive
            expect(findDialogNameForFunction(model, 'DIA_B_Info')).toBe('DIA_B');
            expect(findDialogNameForFunction(model, 'Unknown')).toBeNull();
        });
    });
});
