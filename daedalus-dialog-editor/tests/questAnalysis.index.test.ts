import { analyzeQuest, getQuestReferences, getUsedQuestTopics, buildQuestUsageIndex } from '../src/renderer/components/QuestEditor/questAnalysis';
import type { SemanticModel } from '../src/renderer/types/global';

// Mock Semantic Model Helper (Copied from questAnalysis.test.ts)
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

describe('questAnalysis with Index', () => {
    describe('Verification of Index Equivalence', () => {
        it('should yield identical analysis results with and without index', () => {
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
                },
                {
                    name: 'DIA_Check',
                    conditions: [{ type: 'VariableCondition', variableName: misVarName }]
                }
            ];

            const model = createMockModel(functions, [], constants, variables);

            // Without index (Slow path)
            const resultSlow = analyzeQuest(model, questName);

            // With index (Fast path)
            const index = buildQuestUsageIndex(model);
            const resultFast = analyzeQuest(model, questName, index);

            expect(resultFast).toEqual(resultSlow);

            // Check specific properties to be sure
            expect(resultFast.status).toBe('implemented');
            expect(resultFast.hasStart).toBe(true);
            expect(resultFast.hasSuccess).toBe(true);
            expect(resultFast.logicMethod).toBe('explicit');
        });

        it('should yield identical references with and without index', () => {
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

            // Slow
            const refsSlow = getQuestReferences(model, questName);

            // Fast
            const index = buildQuestUsageIndex(model);
            const refsFast = getQuestReferences(model, questName, index);

            // Sort by function name to ensure order independence in comparison
            const sortRefs = (refs: any[]) => refs.sort((a, b) => a.functionName.localeCompare(b.functionName));

            expect(sortRefs([...refsFast])).toEqual(sortRefs([...refsSlow]));
            expect(refsFast).toHaveLength(2);
        });

        it('should yield identical used topics with and without index', () => {
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

            const usedSlow = getUsedQuestTopics(model);
            const index = buildQuestUsageIndex(model);
            const usedFast = getUsedQuestTopics(model, index);

            expect(usedFast).toEqual(usedSlow);
            expect(usedFast.has('TOPIC_A')).toBe(true);
            expect(usedFast.has('TOPIC_B')).toBe(true);
        });
    });
});
