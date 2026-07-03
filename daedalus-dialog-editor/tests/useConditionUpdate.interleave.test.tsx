/**
 * Condition edit/delete interleaving (fix-05 §2.4, finding U3).
 *
 * ConditionCards are keyed by array index, so deleting a condition reindexes
 * the surviving cards under the same mounted components. A pending 300 ms
 * debounce that resolves its index/value lexically — plus the ConditionEditor
 * `index === length` append branch and an unguarded unmount flush — corrupts
 * the wrong slot or resurrects a deleted condition.
 *
 * Stage 1 (this file): a delete during a pending edit must never write to the
 * wrong slot or resurrect a deleted condition. The in-flight ≤300 ms edit may
 * be dropped (accepted, lossy), but the data must stay consistent.
 */

import React, { useState } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import ConditionEditor from '../src/renderer/components/ConditionEditor';
import type { DialogFunction } from '../src/renderer/types/global';
import type { FunctionUpdater } from '../src/renderer/components/dialogTypes';

const makeFunction = (conditionTexts: string[]): DialogFunction => ({
  name: 'DIA_Test_Condition',
  returnType: 'INT',
  actions: [],
  calls: [],
  conditions: conditionTexts.map((condition) => ({ type: 'Condition', condition })),
});

/**
 * Harness that owns the condition function in state, mirroring how the store
 * applies a FunctionUpdater. Re-renders ConditionEditor on every update.
 */
const Harness: React.FC<{ initial: string[]; onChange: (fn: DialogFunction) => void }> = ({
  initial,
  onChange,
}) => {
  const [fn, setFn] = useState<DialogFunction>(() => makeFunction(initial));
  const handleUpdate = (funcOrUpdater: FunctionUpdater) => {
    setFn((current) => {
      const next = typeof funcOrUpdater === 'function' ? funcOrUpdater(current) : funcOrUpdater;
      const resolved = (next ?? current) as DialogFunction;
      onChange(resolved);
      return resolved;
    });
  };
  return (
    <ConditionEditor
      conditionFunction={fn}
      onUpdateFunction={handleUpdate}
      filePath="C:/tmp/cond.d"
      dialogName="DIA_Test"
    />
  );
};

const conditionTexts = (fn: DialogFunction): string[] =>
  (fn.conditions || []).map((c) => (c as { condition?: string }).condition ?? '');

const renderExpanded = (initial: string[]) => {
  let latest = makeFunction(initial);
  render(<Harness initial={initial} onChange={(fn) => { latest = fn; }} />);
  // Conditions start collapsed; expand to mount the cards.
  fireEvent.click(screen.getByLabelText('Expand conditions'));
  return () => latest;
};

describe('useConditionUpdate interleaving (U3 stage 1)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    act(() => { jest.runOnlyPendingTimers(); });
    jest.useRealTimers();
  });

  it('does not write to the wrong slot or resurrect when a condition above is deleted mid-edit', () => {
    const getLatest = renderExpanded(['c0', 'c1', 'c2']);

    const inputs = screen.getAllByLabelText('Condition Expression');
    expect(inputs).toHaveLength(3);

    // Start editing condition #2 (debounce now pending).
    fireEvent.change(inputs[2], { target: { value: 'c2-edited' } });

    // Delete condition #0 within the debounce window (reindexes the cards).
    fireEvent.click(screen.getAllByLabelText('Delete condition')[0]);

    // Let every pending timer / flush settle.
    act(() => { jest.runOnlyPendingTimers(); });

    const texts = conditionTexts(getLatest());
    // Exactly two conditions remain, in order, with no resurrected c0 and no
    // appended/duplicated edit landing in the wrong slot.
    expect(texts).toEqual(['c1', 'c2']);
  });

  it('does not resurrect the last condition when it is deleted with a pending edit', () => {
    const getLatest = renderExpanded(['c0', 'c1', 'c2']);

    const inputs = screen.getAllByLabelText('Condition Expression');
    // Edit the last condition, then delete it before the debounce fires.
    fireEvent.change(inputs[2], { target: { value: 'c2-edited' } });
    fireEvent.click(screen.getAllByLabelText('Delete condition')[2]);

    act(() => { jest.runOnlyPendingTimers(); });

    const texts = conditionTexts(getLatest());
    expect(texts).toEqual(['c0', 'c1']);
  });
});
