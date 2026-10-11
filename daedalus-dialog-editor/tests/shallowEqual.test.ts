import { shallowEqual } from '../src/renderer/utils/shallowEqual';

describe('shallowEqual', () => {
  it('returns true if arguments are strictly equal', () => {
    expect(shallowEqual(1, 1)).toBe(true);
    expect(shallowEqual('a', 'a')).toBe(true);
    expect(shallowEqual(true, true)).toBe(true);
    const obj = {};
    expect(shallowEqual(obj, obj)).toBe(true);
  });

  it('returns false if arguments are not objects or are null', () => {
    expect(shallowEqual(1, 2)).toBe(false);
    expect(shallowEqual(1, '1')).toBe(false);
    expect(shallowEqual(null, {})).toBe(false);
    expect(shallowEqual({}, null)).toBe(false);
  });

  it('returns true if objects have same keys and values', () => {
    expect(shallowEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
    expect(shallowEqual({ a: 1, b: '2' }, { a: 1, b: '2' })).toBe(true);
  });

  it('returns false if objects have different keys', () => {
    expect(shallowEqual({ a: 1, b: 2 }, { a: 1, c: 2 })).toBe(false);
    expect(shallowEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });

  it('returns false if objects have different values', () => {
    expect(shallowEqual({ a: 1, b: 2 }, { a: 1, b: 3 })).toBe(false);
  });

  it('returns false if nested objects are different references', () => {
    // shallowEqual checks strict equality of values.
    // distinct objects are not strictly equal even if they look the same.
    expect(shallowEqual({ a: {} }, { a: {} })).toBe(false);
  });

  it('returns true if nested objects are same reference', () => {
    const nested = {};
    expect(shallowEqual({ a: nested }, { a: nested })).toBe(true);
  });

  it('handles DialogAction like objects correctly', () => {
    const action1 = {
      speaker: 'self',
      text: 'Hello',
      id: '123'
    };
    const action2 = {
      speaker: 'self',
      text: 'Hello',
      id: '123'
    };
    expect(shallowEqual(action1, action2)).toBe(true);

    const action3 = {
      speaker: 'other',
      text: 'Hello',
      id: '123'
    };
    expect(shallowEqual(action1, action3)).toBe(false);
  });
});
