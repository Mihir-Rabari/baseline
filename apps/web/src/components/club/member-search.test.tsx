import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemberSearch } from './member-search';

const state = vi.hoisted(() => ({ data: [] as unknown[], error: null as Error | null, isPending: false, refetch: vi.fn() }));
vi.mock('@/hooks/use-debounce', () => ({ useDebounce: (value: string) => value }));
vi.mock('@/hooks/use-availability', () => ({ useMemberLookup: () => state }));
const member = { id: 'd4ecdbbb-6260-4556-9bac-f241568f9bee', fullName: 'Riya Patel', memberCode: 'CC-000001', phone: '9876543210', planCode: 'GOLD', expiryState: 'OK' as const, shopDiscountPct: 20, barDiscountPct: 10 };

describe('member search', () => {
  beforeEach(() => { Object.assign(state, { data: [member], error: null, isPending: false }); vi.clearAllMocks(); });
  it('selects a result and lets staff clear the selected member', () => {
    const onChange = vi.fn();
    const { rerender } = render(<MemberSearch value={null} onChange={onChange} />);
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Member'), { target: { value: 'Ri' } });
    fireEvent.click(screen.getByRole('button', { name: /Riya Patel/ }));
    expect(onChange).toHaveBeenCalledWith(member);
    rerender(<MemberSearch value={member} onChange={onChange} />);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Change member' }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
  it('handles no results, retryable failures and disabled selection', () => {
    const onChange = vi.fn(); state.data = [];
    const { rerender } = render(<MemberSearch value={null} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Member'), { target: { value: 'Nobody' } });
    expect(screen.getByRole('status')).toHaveTextContent('No members match');
    state.error = new Error('Lookup unavailable');
    rerender(<MemberSearch value={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(state.refetch).toHaveBeenCalledOnce();
    rerender(<MemberSearch value={member} onChange={onChange} disabled />);
    expect(screen.getByRole('button', { name: 'Change member' })).toBeDisabled();
  });
});
