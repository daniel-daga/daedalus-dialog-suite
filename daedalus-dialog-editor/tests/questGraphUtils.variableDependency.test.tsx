import { buildQuestGraph } from '../src/renderer/quest/domain/graph';
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
    } as unknown as SemanticModel;
};

describe('questGraphUtils - Variable Dependencies', () => {
    it('should connect nodes linked by a generic variable dependency', () => {
        const questName = 'TOPIC_VAR_TEST';
        const helperVar = 'HELPER_VAR';

        const functions = [
            {
                name: 'DIA_Setter_Info',
                actions: [
                    { type: 'CreateTopic', topic: questName, topicType: 'LOG_MISSION' },
                    { type: 'SetVariableAction', variableName: helperVar, operator: '=', value: 1 }
                ]
            },
            {
                name: 'DIA_Checker_Info',
                conditions: [
                    { type: 'VariableCondition', variableName: helperVar, operator: '==', value: 1 }
                ],
                actions: [
                    { type: 'LogSetTopicStatus', topic: questName, status: 'LOG_RUNNING' }
                ]
            }
        ];

        const dialogs = [
            { name: 'DIA_Setter', properties: { information: 'DIA_Setter_Info', npc: 'NPC_Test' } },
            { name: 'DIA_Checker', properties: { information: 'DIA_Checker_Info', npc: 'NPC_Test' } }
        ];

        const model = createMockModel(functions, dialogs);
        const { nodes, edges } = buildQuestGraph(model, questName);

        expect(nodes.find(n => n.id === 'DIA_Setter_Info')).toBeDefined();
        expect(nodes.find(n => n.id === 'DIA_Checker_Info')).toBeDefined();

        const depEdge = edges.find(e => e.source === 'DIA_Setter_Info' && e.target === 'DIA_Checker_Info');
        expect(depEdge).toBeDefined();
        if (depEdge) {
            expect(depEdge.label).toBe(`requires ${helperVar} == 1`);
        }
    });

    it('should include indirect producer nodes that satisfy relevant conditions', () => {
        const questName = 'TOPIC_INDIRECT';

        const functions = [
            {
                name: 'DIA_WorldFlagSetter_Info',
                actions: [
                    { type: 'SetVariableAction', variableName: 'WORLD_FLAG', operator: '=', value: 1 }
                ]
            },
            {
                name: 'DIA_QuestBranch_Info',
                conditions: [
                    { type: 'VariableCondition', variableName: 'WORLD_FLAG', operator: '==', value: 1 }
                ],
                actions: [
                    { type: 'LogSetTopicStatus', topic: questName, status: 'LOG_RUNNING' }
                ]
            }
        ];

        const dialogs = [
            { name: 'DIA_WorldFlagSetter', properties: { information: 'DIA_WorldFlagSetter_Info', npc: 'NPC_World' } },
            { name: 'DIA_QuestBranch', properties: { information: 'DIA_QuestBranch_Info', npc: 'NPC_Quest' } }
        ];

        const model = createMockModel(functions, dialogs);
        const { nodes, edges } = buildQuestGraph(model, questName);

        expect(nodes.find(n => n.id === 'DIA_QuestBranch_Info')).toBeDefined();
        expect(nodes.find(n => n.id === 'DIA_WorldFlagSetter_Info')).toBeDefined();

        const indirectEdge = edges.find(e => e.source === 'DIA_WorldFlagSetter_Info' && e.target === 'DIA_QuestBranch_Info');
        expect(indirectEdge).toBeDefined();
    });

    it('should give a Topic_-spelled quest the same MIS edge as its TOPIC_ twin', () => {
        const misEdge = (questName: string) => {
            const functions = [
                {
                    name: 'DIA_Zettel_Done_Info',
                    actions: [
                        { type: 'LogSetTopicStatus', topic: questName, status: 'LOG_SUCCESS' },
                        { type: 'LogEntry', topic: questName, text: 'Ich habe die Zettel.' }
                    ]
                },
                {
                    name: 'DIA_Zettel_After_Info',
                    conditions: [
                        { type: 'VariableCondition', variableName: 'MIS_Zettel', operator: '==', value: 'LOG_SUCCESS' }
                    ],
                    actions: [
                        { type: 'LogEntry', topic: questName, text: 'Der naechste Hinweis.' }
                    ]
                }
            ];
            const dialogs = [
                { name: 'DIA_Zettel_Done', properties: { information: 'DIA_Zettel_Done_Info', npc: 'NPC_Test' } },
                { name: 'DIA_Zettel_After', properties: { information: 'DIA_Zettel_After_Info', npc: 'NPC_Test' } }
            ];

            const model = createMockModel(functions, dialogs);
            model.variables = { MIS_Zettel: { name: 'MIS_Zettel', type: 'int' } } as never;

            return buildQuestGraph(model, questName).edges.find(
                (edge) => edge.source === 'DIA_Zettel_Done_Info' && edge.target === 'DIA_Zettel_After_Info'
            );
        };

        expect(misEdge('TOPIC_Zettel')).toBeDefined();
        expect(misEdge('Topic_Zettel')).toEqual(misEdge('TOPIC_Zettel'));
    });

    it('should create external condition nodes for unresolved item pickup prerequisites', () => {
        const questName = 'TOPIC_FETCH';

        const functions = [
            {
                name: 'DIA_FetchCheck_Info',
                conditions: [
                    { type: 'NpcHasItemsCondition', npc: 'hero', item: 'ITMW_SWORD', operator: '>=', value: 1 }
                ],
                actions: [
                    { type: 'LogSetTopicStatus', topic: questName, status: 'LOG_RUNNING' }
                ]
            }
        ];

        const dialogs = [
            { name: 'DIA_FetchCheck', properties: { information: 'DIA_FetchCheck_Info', npc: 'NPC_Blacksmith' } }
        ];

        const model = createMockModel(functions, dialogs);
        const { nodes, edges } = buildQuestGraph(model, questName);

        const externalConditionNode = nodes.find(
            (node) => node.data.kind === 'condition' && node.data.conditionType === 'NpcHasItemsCondition'
        );
        expect(externalConditionNode).toBeDefined();
        expect(externalConditionNode?.type).toBe('condition');

        const externalEdge = edges.find(
            (edge) => edge.source === externalConditionNode?.id && edge.target === 'DIA_FetchCheck_Info'
        );
        expect(externalEdge).toBeDefined();
    });
});


