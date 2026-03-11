import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
const capturedTextFieldProps: any[] = [];

jest.mock('@mui/material', () => {
  const actual = jest.requireActual('@mui/material');
  const react = jest.requireActual('react');

  return {
    ...actual,
    TextField: (props: any) => {
      capturedTextFieldProps.push(props);
      return react.createElement(actual.TextField, props);
    }
  };
});

import DialogLineRenderer from '../src/renderer/components/actionRenderers/DialogLineRenderer';

describe('DialogLineRenderer', () => {
  const baseProps = {
    action: {
      type: 'DialogLine',
      speaker: 'self',
      text: 'Hello there',
      id: 'DIA_Test_15_00'
    } as any,
    index: 0,
    npcName: 'Diego',
    handleUpdate: jest.fn(),
    handleDelete: jest.fn(),
    flushUpdate: jest.fn(),
    handleKeyDown: jest.fn(),
    mainFieldRef: { current: null }
  };

  beforeEach(() => {
    jest.clearAllMocks();
    capturedTextFieldProps.length = 0;
  });

  test('renders the text field as vertically resizable multiline textarea with one-row default height', () => {
    render(<DialogLineRenderer {...baseProps} />);

    const dialogTextFieldProps = capturedTextFieldProps.find((props) => props.label === 'Text');
    expect(dialogTextFieldProps?.multiline).toBe(true);
    expect(dialogTextFieldProps?.minRows).toBe(1);
    expect(dialogTextFieldProps?.rows).toBeUndefined();

    const textField = screen.getByLabelText('Text');
    expect(textField.tagName).toBe('TEXTAREA');
    expect(textField).toHaveStyle({ resize: 'vertical' });
  });

  test('updates dialog line text when textarea value changes', () => {
    render(<DialogLineRenderer {...baseProps} />);

    const textField = screen.getByLabelText('Text');
    fireEvent.change(textField, { target: { value: 'Updated line' } });

    expect(baseProps.handleUpdate).toHaveBeenCalledWith({
      ...baseProps.action,
      text: 'Updated line'
    });
  });
});
