import { buildQuestGraph } from '../src/renderer/components/QuestEditor/questGraphUtils';
import type { SemanticModel } from '../src/renderer/types/global';

// Mock Semantic Model Helper
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

describe('questGraphUtils', () => {
    it('should handle cyclic dependencies gracefully', () => {
        const questName = 'TOPIC_TEST';
        const misVarName = 'MIS_TEST';

        // Cycle: A -> B -> A
        // A runs when MIS_TEST == 1, sets MIS_TEST = 2
        // B runs when MIS_TEST == 2, sets MIS_TEST = 1

        const functions = [
            {
                name: 'DIA_A_Info',
                conditions: [
                    { variableName: misVarName, operator: '==', value: 1 } // Consumes 1
                ],
                actions: [
                    { topic: questName, status: 'LOG_SUCCESS' } // Produces 2 (SUCCESS)
                ]
            },
            {
                name: 'DIA_B_Info',
                conditions: [
                    { variableName: misVarName, operator: '==', value: 2 } // Consumes 2
                ],
                actions: [
                    { topic: questName, status: 'LOG_RUNNING' } // Produces 1 (RUNNING) - Cycle!
                ]
            },
            // Starter to inject initial state 1
            {
                name: 'DIA_Start_Info',
                actions: [
                    { topic: questName, topicType: 'LOG_MISSION' } // Produces 1 (implicit start)
                ]
            }
        ];

        const dialogs = [
            { name: 'DIA_A', properties: { information: 'DIA_A_Info', npc: 'NPC_A' } },
            { name: 'DIA_B', properties: { information: 'DIA_B_Info', npc: 'NPC_B' } },
            { name: 'DIA_Start', properties: { information: 'DIA_Start_Info', npc: 'NPC_Start' } },
        ];

        const model = createMockModel(functions, dialogs);

        // This call should not hang
        const { nodes, edges } = buildQuestGraph(model, questName);

        // Verify nodes are created
        expect(nodes.length).toBeGreaterThan(0);

        // Verify we have edges representing the cycle
        // A -> B (state 2)
        // B -> A (state 1)
        // Start -> A (state 1)
        expect(edges.length).toBeGreaterThanOrEqual(3);

        const edgeAtoB = edges.find(e => e.source === 'DIA_A_Info' && e.target === 'DIA_B_Info');
        const edgeBtoA = edges.find(e => e.source === 'DIA_B_Info' && e.target === 'DIA_A_Info');

        expect(edgeAtoB).toBeDefined();
        expect(edgeBtoA).toBeDefined();
    });

    it('should build a simple DAG correctly', () => {
         const questName = 'TOPIC_SIMPLE';
         const misVarName = 'MIS_SIMPLE';

         const functions = [
             {
                 name: 'DIA_Start_Info',
                 actions: [
                     { topic: questName, topicType: 'LOG_MISSION' } // Produces 1
                 ]
             },
             {
                 name: 'DIA_End_Info',
                 conditions: [
                     { variableName: misVarName, operator: '==', value: 1 } // Consumes 1
                 ],
                 actions: [
                     { topic: questName, status: 'LOG_SUCCESS' } // Produces 2
                 ]
             }
         ];

         const dialogs = [
             { name: 'DIA_Start', properties: { information: 'DIA_Start_Info', npc: 'NPC_Start' } },
             { name: 'DIA_End', properties: { information: 'DIA_End_Info', npc: 'NPC_End' } },
         ];

         const model = createMockModel(functions, dialogs);
         const { nodes, edges } = buildQuestGraph(model, questName);

         expect(nodes).toHaveLength(4); // 2 nodes + 2 swimlanes
         expect(edges).toHaveLength(1); // Start -> End
    });
});
