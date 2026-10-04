import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDebounce } from '../../../../apps/web/src/hooks/use-debounce';

describe('useDebounce', () => {
  afterEach(() => vi.useRealTimers());
  it('waits 250ms and cancels the previous pending search', () => {
    vi.useFakeTimers();
    const { result, rerender, unmount } = renderHook(({ value }) => useDebounce(value, 250), { initialProps: { value: '' } });
    rerender({ value: 'aa' });
    act(() => vi.advanceTimersByTime(200));
    expect(result.current).toBe('');
    rerender({ value: 'aar' });
    act(() => vi.advanceTimersByTime(249));
    expect(result.current).toBe('');
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe('aar');
    rerender({ value: 'aarav' });
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
