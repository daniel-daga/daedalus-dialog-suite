import { buildQuestGraph } from '../src/renderer/quest/domain/graph';
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
                    { type: 'VariableCondition', variableName: misVarName, operator: '==', value: 1 } // Consumes 1
                ],
                actions: [
                    { type: 'LogSetTopicStatus', topic: questName, status: 'LOG_SUCCESS' } // Produces 2 (SUCCESS)
                ]
            },
            {
                name: 'DIA_B_Info',
                conditions: [
                    { type: 'VariableCondition', variableName: misVarName, operator: '==', value: 2 } // Consumes 2
                ],
                actions: [
                    { type: 'LogSetTopicStatus', topic: questName, status: 'LOG_RUNNING' } // Produces 1 (RUNNING) - Cycle!
                ]
            },
            // Starter to inject initial state 1
            {
                name: 'DIA_Start_Info',
                actions: [
                    { type: 'CreateTopic', topic: questName, topicType: 'LOG_MISSION' } // Produces 1 (implicit start)
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
                     { type: 'CreateTopic', topic: questName, topicType: 'LOG_MISSION' } // Produces 1
                 ]
             },
             {
                 name: 'DIA_End_Info',
                 conditions: [
                     { type: 'VariableCondition', variableName: misVarName, operator: '==', value: 1 } // Consumes 1
                 ],
                 actions: [
                     { type: 'LogSetTopicStatus', topic: questName, status: 'LOG_SUCCESS' } // Produces 2
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

    it('should create edges for choices between existing nodes', () => {
        const questName = 'TOPIC_CHOICE';
        const funcA = 'DIA_Start';
        const funcB = 'DIA_Next';

        const functions = [
            {
                name: funcA,
                actions: [
                    { type: 'CreateTopic', topic: questName, topicType: 'LOG_MISSION' },
                    { type: 'Choice', dialogRef: 'self', text: 'Go to B', targetFunction: funcB }
                ]
            },
            {
                name: funcB,
                actions: [
                    { type: 'LogSetTopicStatus', topic: questName, status: 'LOG_RUNNING' }
                ]
            }
        ];

        const dialogs = [
            { name: funcA, properties: { information: funcA, npc: 'NPC_A' } },
            { name: funcB, properties: { information: funcB, npc: 'NPC_A' } }
        ];

        const model = createMockModel(functions, dialogs);
        const { nodes, edges } = buildQuestGraph(model, questName);

        const choiceEdge = edges.find(e => e.source === funcA && e.target === funcB);
        expect(choiceEdge).toBeDefined();
        expect(choiceEdge?.label).toBe('Go to B');
        expect(choiceEdge?.sourceHandle).toBe('out-state'); // Start Node
        expect(choiceEdge?.targetHandle).toBe('in-trigger'); // Set Running Node (now QuestState)
    });

    it('should NOT create edges for choices to non-existent/irrelevant nodes', () => {
        const questName = 'TOPIC_IRRELEVANT';
        const funcA = 'DIA_Start';
        const funcC = 'DIA_Irrelevant';

        const functions = [
            {
                name: funcA,
                actions: [
                    { type: 'CreateTopic', topic: questName, topicType: 'LOG_MISSION' },
                    { type: 'Choice', dialogRef: 'self', text: 'Go to C', targetFunction: funcC }
                ]
            },
            {
                name: funcC,
                actions: [] // Irrelevant
            }
        ];

        const dialogs = [
            { name: funcA, properties: { information: funcA, npc: 'NPC_A' } },
            { name: funcC, properties: { information: funcC, npc: 'NPC_A' } }
        ];

        const model = createMockModel(functions, dialogs);
        const { nodes, edges } = buildQuestGraph(model, questName);

        const nodeC = nodes.find(n => n.id === funcC);
        expect(nodeC).toBeUndefined();

        const edge = edges.find(e => e.source === funcA && e.target === funcC);
        expect(edge).toBeUndefined();
    });

    it('should hide inferred edges when requested', () => {
        const questName = 'TOPIC_FILTERS';
        const functions = [
            {
                name: 'DIA_WorldSetter',
                actions: [
                    { type: 'SetVariableAction', variableName: 'WORLD_FLAG', operator: '=', value: 1 }
                ]
            },
            {
                name: 'DIA_QuestBranch',
                conditions: [
                    { type: 'VariableCondition', variableName: 'WORLD_FLAG', operator: '==', value: 1 }
                ],
                actions: [
                    { type: 'LogSetTopicStatus', topic: questName, status: 'LOG_RUNNING' }
                ]
            }
        ];

        const dialogs = [
            { name: 'DIA_WorldSetterDialog', properties: { information: 'DIA_WorldSetter', npc: 'NPC_World' } },
            { name: 'DIA_QuestBranchDialog', properties: { information: 'DIA_QuestBranch', npc: 'NPC_Quest' } }
        ];

        const model = createMockModel(functions, dialogs);
        const baseline = buildQuestGraph(model, questName);
        const filtered = buildQuestGraph(model, questName, { hideInferredEdges: true });

        expect(baseline.edges.length).toBeGreaterThan(0);
        expect(filtered.edges.length).toBe(0);
    });

    it('creates requires edges for inequality conditions and marks range operators read-only', () => {
        const questName = 'TOPIC_OPS';
        const functions = [
            {
                name: 'DIA_Start_Info',
                actions: [
                    { type: 'CreateTopic', topic: questName, topicType: 'LOG_MISSION' }
                ]
            },
            {
                name: 'DIA_NotFailed_Info',
                conditions: [
                    { type: 'VariableCondition', variableName: 'MIS_OPS', operator: '!=', value: 'LOG_FAILED' }
                ],
                actions: [
                    { type: 'LogSetTopicStatus', topic: questName, status: 'LOG_RUNNING' }
                ]
            },
            {
                name: 'DIA_Range_Info',
                conditions: [
                    { type: 'VariableCondition', variableName: 'MIS_OPS', operator: '>=', value: 2 }
                ],
                actions: [
                    { type: 'LogSetTopicStatus', topic: questName, status: 'LOG_SUCCESS' }
                ]
            }
        ];

        const dialogs = [
            { name: 'DIA_Start', properties: { information: 'DIA_Start_Info', npc: 'NPC_Start' } },
            { name: 'DIA_NotFailed', properties: { information: 'DIA_NotFailed_Info', npc: 'NPC_One' } },
            { name: 'DIA_Range', properties: { information: 'DIA_Range_Info', npc: 'NPC_Two' } },
        ];

        const model = createMockModel(functions, dialogs);
        const { edges } = buildQuestGraph(model, questName);

        const notFailedEdge = edges.find((edge) => edge.target === 'DIA_NotFailed_Info');
        expect(notFailedEdge?.data?.expression).toBe('MIS_OPS != LOG_FAILED');
        expect(notFailedEdge?.data?.operator).toBe('!=');

        const rangeEdge = edges.find((edge) => edge.target === 'DIA_Range_Info');
        expect(rangeEdge?.data?.expression).toBe('MIS_OPS >= 2');
        expect(rangeEdge?.data?.operator).toBe('>=');
    });
});
