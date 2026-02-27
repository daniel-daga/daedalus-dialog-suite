import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import QuestFlow from '../src/renderer/components/QuestFlow';
import * as questCommands from '../src/renderer/quest/domain/commands';
import type { SemanticModel } from '../src/renderer/types/global';

jest.mock('reactflow', () => {
  const ReactModule = require('react');

  const ReactFlow = ({
    nodes = [],
    edges = [],
    onNodeClick,
    onNodeDragStop,
    onEdgeClick,
    onConnect,
    children
  }: {
    nodes?: Array<any>;
    edges?: Array<any>;
    onNodeClick?: (event: React.MouseEvent, node: any) => void;
    onNodeDragStop?: (event: React.MouseEvent, node: any) => void;
    onEdgeClick?: (event: React.MouseEvent, edge: any) => void;
    onConnect?: (connection: { source?: string; target?: string }) => void;
    children?: React.ReactNode;
  }) => (
    <div data-testid="reactflow">
      {nodes.map((node) => (
        <div key={String(node.id)}>
          <button
            type="button"
            onClick={() => onNodeClick?.(({ preventDefault: () => undefined } as unknown) as React.MouseEvent, node)}
          >
            {String(node.id)}
          </button>
          <button
            type="button"
            onClick={() => onNodeDragStop?.(
              ({ preventDefault: () => undefined } as unknown) as React.MouseEvent,
              { ...node, position: { x: 99, y: 101 } }
            )}
          >
            Drag {String(node.id)}
          </button>
        </div>
      ))}
      {edges.map((edge) => (
        <button
          key={String(edge.id)}
          type="button"
          onClick={() => onEdgeClick?.(({ preventDefault: () => undefined } as unknown) as React.MouseEvent, edge)}
        >
          Edge {String(edge.id)}
        </button>
      ))}
      <button
        type="button"
        onClick={() => onConnect?.({ source: 'DIA_Test_Info', target: 'DIA_Target_Info' })}
      >
        Connect DIA_Test_Info {'->'} DIA_Target_Info
      </button>
      <button
        type="button"
        onClick={() => onConnect?.({ source: 'DIA_Test_Info' })}
      >
        Connect Invalid Missing Target
      </button>
      <button
        type="button"
        onClick={() => onConnect?.({ source: 'DIA_Unknown', target: 'DIA_Target_Info' })}
      >
        Connect Unknown Source {'->'} DIA_Target_Info
      </button>
      {children}
    </div>
  );

  return {
    __esModule: true,
    default: ReactFlow,
    Background: () => null,
    Controls: () => null,
    MiniMap: () => null,
    useNodesState: (initialNodes: Array<any>) => {
      const [nodes, setNodes] = ReactModule.useState(initialNodes);
      return [nodes, setNodes, jest.fn()];
    },
    useEdgesState: (initialEdges: Array<any>) => {
      const [edges, setEdges] = ReactModule.useState(initialEdges);
      return [edges, setEdges, jest.fn()];
    }
  };
});

jest.mock('../src/renderer/quest/domain/graph', () => ({
  buildQuestGraph: () => ({
    nodes: [
      {
        id: 'DIA_Test_Info',
        type: 'questState',
        data: {
          label: 'DIA_Test',
          npc: 'NPC_Test',
          description: 'Set LOG_RUNNING',
          kind: 'misState',
          variableName: 'MIS_TEST',
          provenance: { functionName: 'DIA_Test_Info' }
        },
        position: { x: 0, y: 0 }
      }
    ],
    edges: [
      {
        id: 'choice-DIA_Test_Info-DIA_Target_Info',
        source: 'DIA_Test_Info',
        target: 'DIA_Target_Info',
        data: {
          kind: 'transitions'
        },
        label: 'Continue'
      }
    ]
  })
}));

jest.mock('../src/renderer/hooks/useNavigation', () => ({
  useNavigation: () => ({
    navigateToDialog: jest.fn(),
    navigateToSymbol: jest.fn()
  })
}));

const projectStoreState = {
  projectPath: null,
  parsedFiles: new Map()
};

const semanticModel: SemanticModel = {
  dialogs: {
    DIA_Test: {
      name: 'DIA_Test',
      parent: 'C_INFO',
      properties: {
        npc: 'NPC_TEST',
        information: 'DIA_Test_Info'
      }
    }
  },
  functions: {
    DIA_Test_Info: {
      name: 'DIA_Test_Info',
      returnType: 'VOID',
      actions: [],
      conditions: [],
      calls: []
    }
  },
  constants: {},
  variables: {
    MIS_TEST: {
      name: 'MIS_TEST',
      type: 'int'
    }
  },
  instances: {},
  hasErrors: false,
  errors: []
};

jest.mock('../src/renderer/store/projectStore', () => ({
  useProjectStore: (selector: (state: typeof projectStoreState) => unknown) => selector(projectStoreState)
}));

jest.mock('../src/renderer/store/editorStore', () => {
  const filePath = 'C:/tmp/test.d';
  const storeModel: SemanticModel = {
    dialogs: {},
    functions: {
      DIA_Test_Info: {
        name: 'DIA_Test_Info',
        returnType: 'VOID',
        actions: [],
        conditions: [],
        calls: []
      }
    },
    constants: {},
    variables: {
      MIS_TEST: {
        name: 'MIS_TEST',
        type: 'int'
      }
    },
    instances: {},
    hasErrors: false,
    errors: []
  };

  const applyQuestModelWithHistory = jest.fn();
  const applyQuestModelsWithHistory = jest.fn();
  const applyQuestNodePositionWithHistory = jest.fn();
  const openFile = jest.fn();
  const getFileState = jest.fn(() => ({
    filePath,
    semanticModel: storeModel
  }));

  (globalThis as any).__questFlowPreviewTest = {
    filePath,
    applyQuestModelWithHistory,
    applyQuestModelsWithHistory,
    getFileState,
    applyQuestNodePositionWithHistory,
    openFile,
    storeModel
  };

  const editorStoreState = {
    activeFile: filePath,
    getFileState,
    openFile,
    applyQuestModelWithHistory,
    applyQuestModelsWithHistory,
    applyQuestNodePositionWithHistory,
    setQuestNodePosition: jest.fn(),
    getQuestNodePositions: jest.fn(() => new Map()),
    undoQuestModel: jest.fn(),
    redoQuestModel: jest.fn(),
    canUndoQuestModel: jest.fn(() => false),
    canRedoQuestModel: jest.fn(() => false),
    undoLastQuestBatch: jest.fn(),
    redoLastQuestBatch: jest.fn(),
    canUndoLastQuestBatch: jest.fn(() => false),
    canRedoLastQuestBatch: jest.fn(() => false),
    codeSettings: {
      indentChar: '\t',
      includeComments: true,
      sectionHeaders: true,
      uppercaseKeywords: true
    }
  };

  const useEditorStore = Object.assign(
    (selector: (state: typeof editorStoreState) => unknown) => selector(editorStoreState),
    {
      getState: () => editorStoreState
    }
  );

  return { useEditorStore };
});

describe('QuestFlow command preview integration', () => {
  beforeEach(() => {
    projectStoreState.parsedFiles = new Map();
    (globalThis as any).__questFlowPreviewTest.applyQuestModelWithHistory.mockClear();
    (globalThis as any).__questFlowPreviewTest.applyQuestModelsWithHistory.mockClear();
    (globalThis as any).__questFlowPreviewTest.getFileState.mockReset();
    (globalThis as any).__questFlowPreviewTest.applyQuestNodePositionWithHistory.mockClear();
    (globalThis as any).__questFlowPreviewTest.openFile.mockReset();
    (globalThis as any).__questFlowPreviewTest.getFileState.mockImplementation(() => ({
      filePath: (globalThis as any).__questFlowPreviewTest.filePath,
      semanticModel: (globalThis as any).__questFlowPreviewTest.storeModel
    }));
    (window as any).editorAPI.generateCode = jest.fn(async () => 'generated-code');
  });

  it('opens diff preview and applies through history-aware store action', async () => {
    render(
      <QuestFlow
        semanticModel={semanticModel}
        questName="TOPIC_TEST"
        writableEnabled
      />
    );

    fireEvent.click(await screen.findByText('DIA_Test_Info'));
    fireEvent.click(screen.getByText('Preview Diff'));

    await waitFor(() => {
      expect(screen.getByText('Quest Command Diff Preview')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Apply'));

    await waitFor(() => {
      const testHarness = (globalThis as any).__questFlowPreviewTest;
      expect(testHarness.applyQuestModelsWithHistory).toHaveBeenCalledTimes(1);
      expect(testHarness.applyQuestModelsWithHistory).toHaveBeenCalledWith([
        { filePath: testHarness.filePath, model: expect.any(Object) }
      ]);
    });
  });

  it('canceling preview does not apply changes', async () => {
    render(
      <QuestFlow
        semanticModel={semanticModel}
        questName="TOPIC_TEST"
        writableEnabled
      />
    );

    fireEvent.click(await screen.findByText('DIA_Test_Info'));
    fireEvent.click(screen.getByText('Preview Diff'));

    await waitFor(() => {
      expect(screen.getByText('Quest Command Diff Preview')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Cancel'));

    await waitFor(() => {
      expect(screen.queryByText('Quest Command Diff Preview')).not.toBeInTheDocument();
    });
    expect((globalThis as any).__questFlowPreviewTest.applyQuestModelsWithHistory).not.toHaveBeenCalled();
  });

  it('persists node position on drag via moveNode command path', async () => {
    render(
      <QuestFlow
        semanticModel={semanticModel}
        questName="TOPIC_TEST"
        writableEnabled
      />
    );

    fireEvent.click(await screen.findByText('Drag DIA_Test_Info'));

    await waitFor(() => {
      const testHarness = (globalThis as any).__questFlowPreviewTest;
      expect(testHarness.applyQuestNodePositionWithHistory).toHaveBeenCalledWith(
        testHarness.filePath,
        'TOPIC_TEST',
        'DIA_Test_Info',
        { x: 99, y: 101 }
      );
    });
    expect(screen.queryByText('Quest Command Diff Preview')).not.toBeInTheDocument();
  });

  it('resolves duplicate function ownership by choosing most recently parsed file', async () => {
    const olderPath = 'C:/tmp/older.d';
    const newerPath = 'C:/tmp/newer.d';
    const testHarness = (globalThis as any).__questFlowPreviewTest;
    const openFileMock = testHarness.openFile as jest.Mock;
    const getFileStateMock = testHarness.getFileState as jest.Mock;

    projectStoreState.parsedFiles = new Map([
      [olderPath, {
        filePath: olderPath,
        semanticModel: semanticModel,
        lastParsed: new Date('2026-01-01T00:00:00Z')
      }],
      [newerPath, {
        filePath: newerPath,
        semanticModel: semanticModel,
        lastParsed: new Date('2026-02-01T00:00:00Z')
      }]
    ]);

    getFileStateMock.mockImplementation((filePath: string) => {
      if (filePath === newerPath) {
        return { filePath: newerPath, semanticModel };
      }
      return null;
    });

    render(
      <QuestFlow
        semanticModel={semanticModel}
        questName="TOPIC_TEST"
        writableEnabled
      />
    );

    fireEvent.click(await screen.findByText('DIA_Test_Info'));
    fireEvent.click(screen.getByText('Preview Diff'));

    await waitFor(() => {
      expect(openFileMock).toHaveBeenCalledWith(newerPath);
      expect(screen.getByText('Quest Command Diff Preview')).toBeInTheDocument();
    });
  });

  it('creates multi-file transition updates when source and target are in different files', async () => {
    const sourcePath = 'C:/tmp/source.d';
    const targetPath = 'C:/tmp/target.d';
    const sourceModel: SemanticModel = {
      ...semanticModel,
      functions: {
        DIA_Test_Info: semanticModel.functions.DIA_Test_Info
      }
    };
    const targetModel: SemanticModel = {
      ...semanticModel,
      functions: {
        DIA_Target_Info: {
          name: 'DIA_Target_Info',
          returnType: 'VOID',
          actions: [],
          conditions: [],
          calls: []
        }
      }
    };
    const testHarness = (globalThis as any).__questFlowPreviewTest;
    const getFileStateMock = testHarness.getFileState as jest.Mock;

    projectStoreState.parsedFiles = new Map([
      [sourcePath, { filePath: sourcePath, semanticModel: sourceModel, lastParsed: new Date('2026-02-02T00:00:00Z') }],
      [targetPath, { filePath: targetPath, semanticModel: targetModel, lastParsed: new Date('2026-02-03T00:00:00Z') }]
    ]);

    getFileStateMock.mockImplementation((filePath: string) => {
      if (filePath === sourcePath) return { filePath: sourcePath, semanticModel: sourceModel };
      if (filePath === targetPath) return { filePath: targetPath, semanticModel: targetModel };
      return null;
    });

    render(
      <QuestFlow
        semanticModel={semanticModel}
        questName="TOPIC_TEST"
        writableEnabled
      />
    );

    fireEvent.click(screen.getByLabelText('Connect mode'));
    fireEvent.click(screen.getByText('Connect DIA_Test_Info -> DIA_Target_Info'));

    await waitFor(() => {
      expect(screen.getByText('Quest Command Diff Preview')).toBeInTheDocument();
    });
    expect(screen.getByText(sourcePath)).toBeInTheDocument();
    expect(screen.getByText(targetPath)).toBeInTheDocument();

    fireEvent.click(screen.getByText('Apply'));

    await waitFor(() => {
      expect(testHarness.applyQuestModelsWithHistory).toHaveBeenCalledWith([
        { filePath: sourcePath, model: expect.any(Object) },
        { filePath: targetPath, model: expect.any(Object) }
      ]);
    });
  });

  it('canceling multi-file preview does not apply batched updates', async () => {
    const sourcePath = 'C:/tmp/source-cancel.d';
    const targetPath = 'C:/tmp/target-cancel.d';
    const sourceModel: SemanticModel = {
      ...semanticModel,
      functions: {
        DIA_Test_Info: semanticModel.functions.DIA_Test_Info
      }
    };
    const targetModel: SemanticModel = {
      ...semanticModel,
      functions: {
        DIA_Target_Info: {
          name: 'DIA_Target_Info',
          returnType: 'VOID',
          actions: [],
          conditions: [],
          calls: []
        }
      }
    };
    const testHarness = (globalThis as any).__questFlowPreviewTest;
    const getFileStateMock = testHarness.getFileState as jest.Mock;

    projectStoreState.parsedFiles = new Map([
      [sourcePath, { filePath: sourcePath, semanticModel: sourceModel, lastParsed: new Date('2026-02-07T00:00:00Z') }],
      [targetPath, { filePath: targetPath, semanticModel: targetModel, lastParsed: new Date('2026-02-08T00:00:00Z') }]
    ]);

    getFileStateMock.mockImplementation((filePath: string) => {
      if (filePath === sourcePath) return { filePath: sourcePath, semanticModel: sourceModel };
      if (filePath === targetPath) return { filePath: targetPath, semanticModel: targetModel };
      return null;
    });

    render(
      <QuestFlow
        semanticModel={semanticModel}
        questName="TOPIC_TEST"
        writableEnabled
      />
    );

    fireEvent.click(screen.getByLabelText('Connect mode'));
    fireEvent.click(screen.getByText('Connect DIA_Test_Info -> DIA_Target_Info'));

    await waitFor(() => {
      expect(screen.getByText('Quest Command Diff Preview')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Cancel'));

    await waitFor(() => {
      expect(screen.queryByText('Quest Command Diff Preview')).not.toBeInTheDocument();
    });
    expect(testHarness.applyQuestModelsWithHistory).not.toHaveBeenCalled();
  });

  it('removes cross-file transition with paired knows-info cleanup in batch apply', async () => {
    const sourcePath = 'C:/tmp/source-remove.d';
    const targetPath = 'C:/tmp/target-remove.d';
    const sourceModel: SemanticModel = {
      ...semanticModel,
      functions: {
        DIA_Test_Info: {
          name: 'DIA_Test_Info',
          returnType: 'VOID',
          actions: [{
            type: 'Choice',
            dialogRef: 'self',
            text: 'Continue',
            targetFunction: 'DIA_Target_Info'
          }],
          conditions: [],
          calls: []
        }
      }
    };
    const targetModel: SemanticModel = {
      ...semanticModel,
      functions: {
        DIA_Target_Info: {
          name: 'DIA_Target_Info',
          returnType: 'VOID',
          actions: [],
          conditions: [{
            type: 'NpcKnowsInfoCondition',
            npc: 'self',
            dialogRef: 'DIA_Test'
          }],
          calls: []
        }
      }
    };
    const testHarness = (globalThis as any).__questFlowPreviewTest;
    const getFileStateMock = testHarness.getFileState as jest.Mock;

    projectStoreState.parsedFiles = new Map([
      [sourcePath, { filePath: sourcePath, semanticModel: sourceModel, lastParsed: new Date('2026-02-03T00:00:00Z') }],
      [targetPath, { filePath: targetPath, semanticModel: targetModel, lastParsed: new Date('2026-02-04T00:00:00Z') }]
    ]);

    getFileStateMock.mockImplementation((filePath: string) => {
      if (filePath === sourcePath) return { filePath: sourcePath, semanticModel: sourceModel };
      if (filePath === targetPath) return { filePath: targetPath, semanticModel: targetModel };
      return null;
    });

    render(
      <QuestFlow
        semanticModel={semanticModel}
        questName="TOPIC_TEST"
        writableEnabled
      />
    );

    fireEvent.click(await screen.findByText('Edge choice-DIA_Test_Info-DIA_Target_Info'));
    fireEvent.click(screen.getByText('Remove Transition'));

    await waitFor(() => {
      expect(screen.getByText('Quest Command Diff Preview')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Apply'));

    await waitFor(() => {
      expect(testHarness.applyQuestModelsWithHistory).toHaveBeenCalledWith([
        { filePath: sourcePath, model: expect.any(Object) },
        { filePath: targetPath, model: expect.any(Object) }
      ]);
    });
  });

  it('updates cross-file transition text with paired knows-info ensure in batch apply', async () => {
    const sourcePath = 'C:/tmp/source-update.d';
    const targetPath = 'C:/tmp/target-update.d';
    const sourceModel: SemanticModel = {
      ...semanticModel,
      functions: {
        DIA_Test_Info: {
          name: 'DIA_Test_Info',
          returnType: 'VOID',
          actions: [{
            type: 'Choice',
            dialogRef: 'self',
            text: 'Old Text',
            targetFunction: 'DIA_Target_Info'
          }],
          conditions: [],
          calls: []
        }
      }
    };
    const targetModel: SemanticModel = {
      ...semanticModel,
      functions: {
        DIA_Target_Info: {
          name: 'DIA_Target_Info',
          returnType: 'VOID',
          actions: [],
          conditions: [],
          calls: []
        }
      }
    };
    const testHarness = (globalThis as any).__questFlowPreviewTest;
    const getFileStateMock = testHarness.getFileState as jest.Mock;

    projectStoreState.parsedFiles = new Map([
      [sourcePath, { filePath: sourcePath, semanticModel: sourceModel, lastParsed: new Date('2026-02-05T00:00:00Z') }],
      [targetPath, { filePath: targetPath, semanticModel: targetModel, lastParsed: new Date('2026-02-06T00:00:00Z') }]
    ]);

    getFileStateMock.mockImplementation((filePath: string) => {
      if (filePath === sourcePath) return { filePath: sourcePath, semanticModel: sourceModel };
      if (filePath === targetPath) return { filePath: targetPath, semanticModel: targetModel };
      return null;
    });

    render(
      <QuestFlow
        semanticModel={semanticModel}
        questName="TOPIC_TEST"
        writableEnabled
      />
    );

    fireEvent.click(await screen.findByText('Edge choice-DIA_Test_Info-DIA_Target_Info'));
    fireEvent.change(screen.getByLabelText('Transition Text'), { target: { value: 'Updated Text' } });
    fireEvent.click(screen.getByText('Preview Diff'));

    await waitFor(() => {
      expect(screen.getByText('Quest Command Diff Preview')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Apply'));

    await waitFor(() => {
      expect(testHarness.applyQuestModelsWithHistory).toHaveBeenCalledWith([
        { filePath: sourcePath, model: expect.any(Object) },
        { filePath: targetPath, model: expect.any(Object) }
      ]);
    });
  });

  it('blocks apply when command introduces failure-status regression warning', async () => {
    const testHarness = (globalThis as any).__questFlowPreviewTest;
    testHarness.storeModel = {
      ...semanticModel,
      functions: {
        DIA_Test_Info: {
          name: 'DIA_Test_Info',
          returnType: 'VOID',
          actions: [
            { type: 'LogSetTopicStatus', topic: 'TOPIC_TEST', status: 'LOG_FAILED' }
          ],
          conditions: [],
          calls: []
        }
      }
    };

    const commandSpy = jest.spyOn(questCommands, 'executeQuestGraphCommand');
    commandSpy.mockImplementation((context, command) => {
      if (command.type === 'setMisState') {
        return {
          ok: true,
          updatedModel: {
            ...context.model,
            functions: {
              ...context.model.functions,
              DIA_Test_Info: {
                ...context.model.functions.DIA_Test_Info,
                actions: [
                  { type: 'LogSetTopicStatus', topic: 'TOPIC_TEST', status: 'LOG_RUNNING' }
                ]
              }
            }
          },
          affectedFunctionNames: ['DIA_Test_Info']
        };
      }
      return {
        ok: false,
        errors: [{ code: 'UNKNOWN_COMMAND', message: 'Unexpected command in test.' }]
      };
    });

    render(
      <QuestFlow
        semanticModel={testHarness.storeModel}
        questName="TOPIC_TEST"
        writableEnabled
      />
    );

    fireEvent.click(await screen.findByText('DIA_Test_Info'));
    fireEvent.click(screen.getByText('Preview Diff'));

    await waitFor(() => {
      expect(screen.getByText('Quest Command Diff Preview')).toBeInTheDocument();
    });
    expect(screen.getByText(/removed LOG_FAILED\/LOG_OBSOLETE status paths/i)).toBeInTheDocument();
    expect(screen.getByText('Apply')).toBeDisabled();
    expect(testHarness.applyQuestModelsWithHistory).not.toHaveBeenCalled();

    commandSpy.mockRestore();
  });

  it('does not block apply when failure/obsolete coverage is preserved via relocation', async () => {
    const testHarness = (globalThis as any).__questFlowPreviewTest;
    testHarness.storeModel = {
      ...semanticModel,
      functions: {
        DIA_Test_Info: {
          name: 'DIA_Test_Info',
          returnType: 'VOID',
          actions: [
            { type: 'LogSetTopicStatus', topic: 'TOPIC_TEST', status: 'LOG_FAILED' }
          ],
          conditions: [],
          calls: []
        },
        DIA_Other_Info: {
          name: 'DIA_Other_Info',
          returnType: 'VOID',
          actions: [],
          conditions: [],
          calls: []
        }
      }
    };

    const commandSpy = jest.spyOn(questCommands, 'executeQuestGraphCommand');
    commandSpy.mockImplementation((context, command) => {
      if (command.type === 'setMisState') {
        return {
          ok: true,
          updatedModel: {
            ...context.model,
            functions: {
              ...context.model.functions,
              DIA_Test_Info: {
                ...context.model.functions.DIA_Test_Info,
                actions: [
                  { type: 'LogSetTopicStatus', topic: 'TOPIC_TEST', status: 'LOG_RUNNING' }
                ]
              },
              DIA_Other_Info: {
                ...context.model.functions.DIA_Other_Info,
                actions: [
                  { type: 'LogSetTopicStatus', topic: 'TOPIC_TEST', status: 'LOG_OBSOLETE' }
                ]
              }
            }
          },
          affectedFunctionNames: ['DIA_Test_Info']
        };
      }
      return {
        ok: false,
        errors: [{ code: 'UNKNOWN_COMMAND', message: 'Unexpected command in test.' }]
      };
    });

    render(
      <QuestFlow
        semanticModel={testHarness.storeModel}
        questName="TOPIC_TEST"
        writableEnabled
      />
    );

    fireEvent.click(await screen.findByText('DIA_Test_Info'));
    fireEvent.click(screen.getByText('Preview Diff'));

    await waitFor(() => {
      expect(screen.getByText('Quest Command Diff Preview')).toBeInTheDocument();
    });
    expect(screen.getByText('Apply')).not.toBeDisabled();

    commandSpy.mockRestore();
  });

  it('shows specific connect-mode validation messages for invalid edge interactions', async () => {
    render(
      <QuestFlow
        semanticModel={semanticModel}
        questName="TOPIC_TEST"
        writableEnabled
      />
    );

    fireEvent.click(screen.getByText('Connect DIA_Test_Info -> DIA_Target_Info'));
    expect(screen.getByText('Enable Connect Mode to create transitions.')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Connect mode'));
    fireEvent.click(screen.getByText('Connect Invalid Missing Target'));
    expect(screen.getByText('Invalid edge: missing source or target.')).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByLabelText('Connect As'));
    fireEvent.click(await screen.findByText('Condition Link'));
    fireEvent.click(screen.getByText('Connect Unknown Source -> DIA_Target_Info'));
    expect(screen.getByText('Unable to infer variable condition from source node.')).toBeInTheDocument();
  });

  it('produces deterministic diff preview output for repeated identical command previews', async () => {
    const generateCodeMock = jest.fn(async (_model: SemanticModel) => 'deterministic-code');
    (window as any).editorAPI.generateCode = generateCodeMock;

    render(
      <QuestFlow
        semanticModel={semanticModel}
        questName="TOPIC_TEST"
        writableEnabled
      />
    );

    fireEvent.click(await screen.findByText('DIA_Test_Info'));
    fireEvent.click(screen.getByText('Preview Diff'));
    await waitFor(() => {
      expect(screen.getByText('Quest Command Diff Preview')).toBeInTheDocument();
    });
    const firstPreview = document.querySelector('pre')?.textContent || '';
    fireEvent.click(screen.getByText('Cancel'));

    await waitFor(() => {
      expect(screen.queryByText('Quest Command Diff Preview')).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Preview Diff'));
    await waitFor(() => {
      expect(screen.getByText('Quest Command Diff Preview')).toBeInTheDocument();
    });
    const secondPreview = document.querySelector('pre')?.textContent || '';

    expect(firstPreview).toBe(secondPreview);
    expect(generateCodeMock).toHaveBeenCalled();
  });
});
