import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import ActionCard from '../src/renderer/components/ActionCard';

// Mock the renderer registry to capture props passed to renderers
jest.mock('../src/renderer/components/actionRenderers', () => ({
  getRendererForAction: () => {
    const MockRenderer: React.FC<any> = (props) => (
      <div data-testid="mock-renderer" data-filepath={props.filePath || 'none'} />
    );
    return MockRenderer;
  },
  getActionTypeLabel: () => 'Choice',
}));

// Mock the dnd library to avoid errors
jest.mock('@hello-pangea/dnd', () => ({
  DragDropContext: ({ children }: any) => children,
  Droppable: ({ children }: any) => children({ innerRef: () => {}, droppableProps: {}, placeholder: null }),
  Draggable: ({ children }: any) => children({ innerRef: () => {}, draggableProps: {}, dragHandleProps: null }, {}),
}));

const baseProps = {
  action: { type: 'choice' as const, text: 'Yes', targetFunction: 'DIA_Test_Yes', dialogRef: 'DIA_Test' },
  path: [0] as any,
  index: 0,
  totalActions: 1,
  npcName: 'TestNPC',
  updateActionAtPath: jest.fn(),
  deleteActionAtPath: jest.fn(),
  focusActionAtPath: jest.fn(),
  addDialogLineAfterPath: jest.fn(),
  deleteActionAndFocusPrevAtPath: jest.fn(),
  addActionAfterPath: jest.fn(),
  registerActionRef: jest.fn(),
  getVisibleActionPaths: jest.fn(() => []),
  dialogContextName: 'DIA_Test',
};

describe('ActionCard filePath prop threading', () => {
  test('passes filePath to renderer', () => {
    render(<ActionCard {...baseProps} filePath="/test/path.d" />);
    expect(screen.getByTestId('mock-renderer')).toHaveAttribute('data-filepath', '/test/path.d');
  });

  test('passes null filePath as "none" when not provided', () => {
    render(<ActionCard {...baseProps} />);
    expect(screen.getByTestId('mock-renderer')).toHaveAttribute('data-filepath', 'none');
  });
});
