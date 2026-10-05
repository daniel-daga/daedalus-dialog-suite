import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import TeachActionRenderer from '../src/renderer/components/actionRenderers/TeachActionRenderer';
import RemoveInventoryItemsActionRenderer from '../src/renderer/components/actionRenderers/RemoveInventoryItemsActionRenderer';

function renderAction(Renderer: React.FC<any>, action: unknown) {
  const handleUpdate = jest.fn();
  render(<Renderer action={action} path={[0]} index={0} totalActions={1}
    npcName="TestNPC" handleUpdate={handleUpdate} handleDelete={jest.fn()}
    flushUpdate={jest.fn()} handleKeyDown={jest.fn()} mainFieldRef={{ current: null }} />);
  return handleUpdate;
}

test('editing a teaching argument preserves commas within strings and nested calls', () => {
  const handleUpdate = renderAction(TeachActionRenderer, {
    type: 'TeachAction', teachFunctionName: 'B_TeachCustom',
    teachArgs: ['self', '"one,two"', 'Compute(1, 2)', 'SPL_LIGHT']
  });
  fireEvent.change(screen.getByLabelText('Arguments (comma separated)'), {
    target: { value: 'self, "one,two", Compute(1, 2), SPL_FIRE' }
  });
  expect(handleUpdate).toHaveBeenCalledWith(expect.objectContaining({
    teachArgs: ['self', '"one,two"', 'Compute(1, 2)', 'SPL_FIRE']
  }));
});

test('switching inventory removal to singular clears its quantity', () => {
  const handleUpdate = renderAction(RemoveInventoryItemsActionRenderer, {
    type: 'RemoveInventoryItemsAction', removeFunctionName: 'Npc_RemoveInvItems',
    removeNpc: 'self', removeItem: 'Gold', removeQuantity: '5'
  });
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Function' }));
  fireEvent.click(screen.getByRole('option', { name: 'Npc_RemoveInvItem' }));
  expect(handleUpdate).toHaveBeenCalledWith(expect.objectContaining({
    removeFunctionName: 'Npc_RemoveInvItem', removeQuantity: undefined
  }));
});

test('singular removal hides quantity and treats Item as the last tab field', () => {
  const handleKeyDown = jest.fn();
  render(<RemoveInventoryItemsActionRenderer action={{
    type: 'RemoveInventoryItemsAction', removeFunctionName: 'Npc_RemoveInvItem',
    removeNpc: 'self', removeItem: 'Gold'
  } as never} path={[0] as never} index={0} totalActions={1} npcName="TestNPC"
    handleUpdate={jest.fn()} handleDelete={jest.fn()} flushUpdate={jest.fn()}
    handleKeyDown={handleKeyDown} mainFieldRef={{ current: null }} />);
  expect(screen.queryByLabelText('Quantity')).not.toBeInTheDocument();
  fireEvent.keyDown(screen.getByLabelText('Item'), { key: 'Tab' });
  expect(handleKeyDown).toHaveBeenCalledTimes(1);
});

test('switching inventory removal to plural supplies an editable default quantity', () => {
  const handleUpdate = renderAction(RemoveInventoryItemsActionRenderer, {
    type: 'RemoveInventoryItemsAction', removeFunctionName: 'Npc_RemoveInvItem',
    removeNpc: 'self', removeItem: 'Gold'
  });
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Function' }));
  fireEvent.click(screen.getByRole('option', { name: 'Npc_RemoveInvItems' }));
  expect(handleUpdate).toHaveBeenCalledWith(expect.objectContaining({
    removeFunctionName: 'Npc_RemoveInvItems', removeQuantity: '1'
  }));
});
