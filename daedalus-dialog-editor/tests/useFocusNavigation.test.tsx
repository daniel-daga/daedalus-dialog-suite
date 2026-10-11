import { act, renderHook } from '@testing-library/react';
import { useFocusNavigation } from '../src/renderer/components/hooks/useFocusNavigation';

describe('useFocusNavigation', () => {
  test('focuses an action once its ref registers after the focus request', () => {
    const { result } = renderHook(() => useFocusNavigation());
    const input = document.createElement('input');
    document.body.appendChild(input);

    act(() => {
      result.current.focusAction([0, 'then', 1], true);
    });

    expect(input).not.toHaveFocus();

    act(() => {
      result.current.registerActionRef([0, 'then', 1], input);
    });

    expect(input).toHaveFocus();
  });
});
