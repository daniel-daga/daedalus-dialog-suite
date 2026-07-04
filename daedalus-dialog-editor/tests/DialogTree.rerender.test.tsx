import React from 'react';
import { render } from '@testing-library/react';
import DialogTree from '../src/renderer/components/DialogTree';
import '@testing-library/jest-dom';

// Mock useSearchStore (per-field selector aware, matching DialogTree.perf.test.tsx)
jest.mock('../src/renderer/store/searchStore', () => ({
  useSearchStore: jest.fn((selector) => {
    const state = {
      dialogFilter: '',
      setDialogFilter: jest.fn(),
      filterDialogs: (dialogs: string[]) => dialogs,
    };
    return selector ? selector(state) : state;
  }),
}));

// Mock AutoSizer to a fixed size
jest.mock('react-virtualized-auto-sizer', () => (props: any) => props.children({ height: 500, width: 300 }));

// Capture the itemData handed to react-window and stub the virtualized list with a
// non-virtualizing renderer that preserves react-window's contract: stable per-index
// style refs + the same itemData ref => a memoized Row must not re-render.
const mockStyleCache = new Map<number, object>();
let mockCapturedItemData: any = null;
jest.mock('react-window', () => {
  const R = jest.requireActual('react') as typeof import('react');
  return {
    FixedSizeList: ({ children: Row, itemCount, itemData }: any) => {
      mockCapturedItemData = itemData;
      const rows = [];
      for (let i = 0; i < itemCount; i++) {
        if (!mockStyleCache.has(i)) mockStyleCache.set(i, {});
        rows.push(R.createElement(Row, { key: i, index: i, style: mockStyleCache.get(i), data: itemData }));
      }
      return R.createElement('div', null, rows);
    },
  };
});

// Spy on DialogTreeItem: count renders per dialog and record the props it receives.
const mockRenderCounts: Record<string, number> = {};
const mockPropsByName: Record<string, any> = {};
jest.mock('../src/renderer/components/DialogTreeItem', () => {
  const R = jest.requireActual('react') as typeof import('react');
  return {
    __esModule: true,
    default: (props: any) => {
      mockRenderCounts[props.dialogName] = (mockRenderCounts[props.dialogName] || 0) + 1;
      mockPropsByName[props.dialogName] = props;
      return R.createElement('div', { 'data-testid': `dialog-${props.dialogName}` }, props.dialogName);
    },
  };
});

describe('DialogTree row re-render behavior (PF2)', () => {
  const dialogs = {
    Dialog1: { name: 'Dialog1', parent: '', properties: { nr: 1, information: 'InfoFunc1', description: 'First' } },
    Dialog2: { name: 'Dialog2', parent: '', properties: { nr: 2, information: 'InfoFunc2', description: 'Second' } },
  };
  const functions = {
    InfoFunc1: { name: 'InfoFunc1', returnType: 'VOID', actions: [], conditions: [], calls: [] },
    InfoFunc2: { name: 'InfoFunc2', returnType: 'VOID', actions: [], conditions: [], calls: [] },
  };

  const dialogsForNPC = ['Dialog1', 'Dialog2'];
  const expandedDialogs = new Set<string>();
  const expandedChoices = new Set<string>();
  const onSelectDialog = jest.fn();
  const onToggleDialogExpand = jest.fn();
  const onToggleChoiceExpand = jest.fn();
  const buildFunctionTree = jest.fn();

  const makeProps = (semanticModel: any) => ({
    selectedNPC: 'TestNPC',
    dialogsForNPC,
    semanticModel,
    selectedDialog: null,
    selectedFunctionName: null,
    expandedDialogs,
    expandedChoices,
    onSelectDialog,
    onToggleDialogExpand,
    onToggleChoiceExpand,
    buildFunctionTree,
  });

  beforeEach(() => {
    Object.keys(mockRenderCounts).forEach((k) => delete mockRenderCounts[k]);
    Object.keys(mockPropsByName).forEach((k) => delete mockPropsByName[k]);
    mockCapturedItemData = null;
  });

  test('itemData does not carry semanticModel; rows receive description/infoFuncName primitives', () => {
    const model1 = { dialogs, functions, hasErrors: false, errors: [] };
    render(<DialogTree {...(makeProps(model1) as any)} />);

    // API shape: the row data threaded through react-window must not include the model.
    expect(mockCapturedItemData).not.toHaveProperty('semanticModel');

    const rowProps = mockPropsByName.Dialog1;
    expect(rowProps).toBeDefined();
    expect(rowProps).not.toHaveProperty('semanticModel');
    expect(rowProps.description).toBe('First');
    expect(rowProps.infoFuncName).toBe('InfoFunc1');
  });

  test('a new model identity with unchanged dialog refs triggers zero row re-renders', () => {
    const model1 = { dialogs, functions, hasErrors: false, errors: [] };
    const { rerender } = render(<DialogTree {...(makeProps(model1) as any)} />);

    expect(mockRenderCounts.Dialog1).toBe(1);
    expect(mockRenderCounts.Dialog2).toBe(1);

    // Mimic a category-stable merge after an unrelated edit: brand-new top-level
    // model identity, but the dialogs and functions category refs are untouched.
    const model2 = { ...model1, constants: {} };
    rerender(<DialogTree {...(makeProps(model2) as any)} />);

    expect(mockRenderCounts.Dialog1).toBe(1);
    expect(mockRenderCounts.Dialog2).toBe(1);
  });
});
