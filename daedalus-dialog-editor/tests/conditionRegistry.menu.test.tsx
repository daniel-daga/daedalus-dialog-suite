/**
 * The Add-condition menu is driven by `CONDITION_REGISTRY` (2026-07 review,
 * 3.5): one menu item per registry key, and picking one appends that key's
 * `createDefault()` — no hand-written switch beside the registry.
 */
import React from 'react';
import { describe, test, expect, jest } from '@jest/globals';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import ConditionEditor from '../src/renderer/components/ConditionEditor';
import { CONDITION_REGISTRY, getConditionType } from '../src/renderer/components/conditions/conditionRegistry';
import type { DialogFunction } from '../src/renderer/types/global';

const EMPTY: DialogFunction = { name: 'DIA_Test_Condition', returnType: 'INT', actions: [], conditions: [], calls: [] };

function openAddMenu() {
  const onUpdateFunction = jest.fn();
  render(
    <ConditionEditor
      conditionFunction={EMPTY}
      onUpdateFunction={onUpdateFunction}
      filePath={null}
      dialogName="DIA_Test"
    />
  );
  fireEvent.click(screen.getByLabelText('Expand conditions'));
  fireEvent.click(screen.getByRole('button', { name: /Add Condition/ }));
  return { onUpdateFunction, items: screen.getAllByRole('menuitem') };
}

describe('conditionRegistry.menu', () => {
  test('one item per registry key', () => {
    const { items } = openAddMenu();
    expect(items.map((item) => item.textContent)).toEqual(
      Object.values(CONDITION_REGISTRY).map((entry) => entry.menuLabel)
    );
  });

  test.each(Object.keys(CONDITION_REGISTRY))('picking %s appends that registry default', (key) => {
    const { onUpdateFunction, items } = openAddMenu();
    const index = Object.keys(CONDITION_REGISTRY).indexOf(key);

    fireEvent.click(items[index]);

    expect(onUpdateFunction).toHaveBeenCalledTimes(1);
    const updater = onUpdateFunction.mock.calls[0][0] as (prev: DialogFunction) => DialogFunction;
    const conditions = updater(EMPTY).conditions ?? [];
    expect(conditions).toHaveLength(1);
    expect(getConditionType(conditions[0])).toBe(key);
    // What landed is the registry default, minus the non-serializable getTypeName.
    const { getTypeName: _ignored, ...expected } = CONDITION_REGISTRY[key].createDefault();
    expect(conditions[0]).toEqual(expected);
    cleanup();
  });
});
