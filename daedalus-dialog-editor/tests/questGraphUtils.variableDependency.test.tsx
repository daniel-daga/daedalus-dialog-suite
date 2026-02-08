import { buildQuestGraph } from '../src/renderer/components/QuestEditor/questGraphUtils';
import type { SemanticModel } from '../src/renderer/types/global';

// Mock Semantic Model Helper (Reused from questGraphUtils.test.tsx)
const createMockModel = (functions: any[], dialogs: any[]): SemanticModel => {
    const funcMap: Record<string, any> = {};
    functions.forEach(f => funcMap[f.name] = f);

    const dialogMap: Record<string, any> = {};
    dialogs.forEach(d => dialogMap[d.name] = d);

    return {
        functions: funcMap,
        dialogs: dialogMap,
        variables: {},
        constants: {},
        instances: {},
        classes: {},
        structs: {},
    } as SemanticModel;
};

describe('questGraphUtils - Variable Dependencies', () => {
    it('should connect nodes linked by a generic variable dependency', () => {
        const questName = 'TOPIC_VAR_TEST';
        const helperVar = 'HELPER_VAR';

        // Node A: Sets HELPER_VAR = 1
        // Node B: Checks HELPER_VAR == 1

        const functions = [
            {
                name: 'DIA_Setter_Info',
                actions: [
                    { topic: questName, topicType: 'LOG_MISSION' }, // Relevant to quest
                    { variableName: helperVar, operator: '=', value: 1 } // Sets generic var
                ]
            },
            {
                name: 'DIA_Checker_Info',
                conditions: [
                    { variableName: helperVar, operator: '==', value: 1 } // Checks generic var
                ],
                actions: [
                    { topic: questName, status: 'LOG_RUNNING' } // Relevant to quest
                ]
            }
        ];

        const dialogs = [
            { name: 'DIA_Setter', properties: { information: 'DIA_Setter_Info', npc: 'NPC_Test' } },
            { name: 'DIA_Checker', properties: { information: 'DIA_Checker_Info', npc: 'NPC_Test' } }
        ];

        const model = createMockModel(functions, dialogs);
        const { nodes, edges } = buildQuestGraph(model, questName);

        // Nodes should exist (both touch quest)
        expect(nodes.find(n => n.id === 'DIA_Setter_Info')).toBeDefined();
        expect(nodes.find(n => n.id === 'DIA_Checker_Info')).toBeDefined();

        // Edge should exist linking Setter -> Checker based on HELPER_VAR
        const depEdge = edges.find(e => e.source === 'DIA_Setter_Info' && e.target === 'DIA_Checker_Info');

        // This expectation is currently failing (behavior to fix)
        // I assert it *should* exist.
        expect(depEdge).toBeDefined();
        if (depEdge) {
            expect(depEdge.label).toBe(helperVar);
        }
    });
});
