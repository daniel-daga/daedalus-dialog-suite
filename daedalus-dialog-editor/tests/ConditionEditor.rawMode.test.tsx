/**
 * Issue #446: a condition function the flat model cannot spell is preserved as
 * one raw `Action` with `conditions: []`. "Add Condition" beside that text
 * writes `conditions: [new]` onto the same function, and `generateFunction`
 * emits `conditions` instead of `actions` — so the click deletes the preserved
 * guard with no error. The panel offers no add button while raw text is shown.
 */

import React from 'react';
import { describe, test, expect } from '@jest/globals';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import ConditionEditor from '../src/renderer/components/ConditionEditor';
import type { DialogFunction } from '../src/renderer/types/global';
import type { FunctionUpdater } from '../src/renderer/components/dialogTypes';

const RAW_GUARD = 'if (Npc_IsDead(self) && A || B) { return TRUE; };';

const makeFunction = (overrides: Partial<DialogFunction>): DialogFunction => ({
  name: 'DIA_Test_Condition',
  returnType: 'INT',
  actions: [],
  conditions: [],
  calls: [],
  ...overrides,
} as unknown as DialogFunction);

const noopUpdateFunction: (f: FunctionUpdater) => void = () => undefined;

const renderExpanded = (fn: DialogFunction) => {
  render(
    <ConditionEditor
      conditionFunction={fn}
      onUpdateFunction={noopUpdateFunction}
      filePath="test.d"
      dialogName="DIA_Test"
    />
  );
  fireEvent.click(screen.getByLabelText('Expand conditions'));
};

describe('ConditionEditor raw condition mode', () => {
  test('a preserved raw guard is shown verbatim', () => {
    renderExpanded(makeFunction({ actions: [{ type: 'Action', action: RAW_GUARD }] }));

    expect(screen.getByText(RAW_GUARD)).toBeInTheDocument();
  });

  test('Add Condition is not offered while a raw guard is preserved', () => {
    renderExpanded(makeFunction({ actions: [{ type: 'Action', action: RAW_GUARD }] }));

    expect(screen.queryByRole('button', { name: /add condition/i })).not.toBeInTheDocument();
  });

  test('Add Condition is still offered on a function with no conditions at all', () => {
    renderExpanded(makeFunction({}));

    expect(screen.getByRole('button', { name: /add condition/i })).toBeInTheDocument();
  });
});
