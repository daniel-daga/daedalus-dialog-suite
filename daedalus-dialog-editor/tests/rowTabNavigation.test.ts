import { createRowTabHandlers } from '../src/renderer/components/actionRenderers/rowTabNavigation';

/**
 * Issue #183 (item 3): inside a multi-field action row (Give Inventory Item:
 * Giver / Receiver / Item / Quantity) pressing Tab jumped straight to the next
 * action card instead of moving to the next field in the same row.
 *
 * createRowTabHandlers builds one keydown handler per field. A Tab in the middle
 * of the row must be left to the browser (handler does NOT delegate to the
 * card-level handler), while Tab on the last field / Shift+Tab on the first
 * field must still delegate so card-to-card navigation keeps working. Every
 * non-Tab key always delegates so Enter / Escape behaviour is untouched.
 */
describe('createRowTabHandlers', () => {
  const makeEvent = (key: string, shiftKey = false) => {
    const preventDefault = jest.fn();
    return { key, shiftKey, preventDefault } as unknown as React.KeyboardEvent;
  };

  const setup = (fieldCount: number) => {
    const cardKeyDown = jest.fn();
    const handlers = createRowTabHandlers(cardKeyDown, fieldCount);
    return { cardKeyDown, handlers };
  };

  it('lets the browser handle forward Tab on a non-last field', () => {
    const { cardKeyDown, handlers } = setup(4);
    handlers[0](makeEvent('Tab')); // Giver
    handlers[1](makeEvent('Tab')); // Receiver
    handlers[2](makeEvent('Tab')); // Item
    expect(cardKeyDown).not.toHaveBeenCalled();
  });

  it('delegates forward Tab on the last field to card navigation', () => {
    const { cardKeyDown, handlers } = setup(4);
    const event = makeEvent('Tab');
    handlers[3](event); // Quantity (last)
    expect(cardKeyDown).toHaveBeenCalledWith(event);
  });

  it('delegates Shift+Tab on the first field to card navigation', () => {
    const { cardKeyDown, handlers } = setup(4);
    const event = makeEvent('Tab', true);
    handlers[0](event); // Giver (first)
    expect(cardKeyDown).toHaveBeenCalledWith(event);
  });

  it('lets the browser handle Shift+Tab on a non-first field', () => {
    const { cardKeyDown, handlers } = setup(4);
    handlers[1](makeEvent('Tab', true)); // Receiver
    handlers[3](makeEvent('Tab', true)); // Quantity
    expect(cardKeyDown).not.toHaveBeenCalled();
  });

  it('always delegates non-Tab keys regardless of field position', () => {
    const { cardKeyDown, handlers } = setup(4);
    const escape = makeEvent('Escape');
    const enter = makeEvent('Enter');
    handlers[0](escape); // first field
    handlers[2](enter); // middle field
    expect(cardKeyDown).toHaveBeenCalledWith(escape);
    expect(cardKeyDown).toHaveBeenCalledWith(enter);
    expect(cardKeyDown).toHaveBeenCalledTimes(2);
  });
});
