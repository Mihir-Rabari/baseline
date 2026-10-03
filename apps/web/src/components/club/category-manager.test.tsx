import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CategoryManager } from './category-manager';
import { categoryName, categoryOptions } from '@/hooks/use-categories';

const state = vi.hoisted(() => ({ post: vi.fn(), put: vi.fn() }));
const list = [
  { id: 'c1', scope: 'PRODUCT', code: 'RACKET', name: 'Rackets', sortOrder: 1, isActive: true },
  { id: 'c2', scope: 'PRODUCT', code: 'STRINGS', name: 'Strings', sortOrder: 2, isActive: false },
];
vi.mock('@/hooks/use-ops', () => ({
  useOpsQuery: (key: unknown[]) => ({
    data: key[2] === 'usage' ? { RACKET: 4 } : list,
    isPending: false,
    error: null,
    refetch: vi.fn(),
  }),
  useOpsMutation: (method: string) => ({ isPending: false, mutateAsync: method === 'post' ? state.post : state.put }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

describe('category manager', () => {
  beforeEach(() => {
    state.post.mockReset().mockResolvedValue({});
    state.put.mockReset().mockResolvedValue({});
  });

  it('lists categories with usage, flags switched-off ones and searches by name or code', () => {
    render(<CategoryManager scope="PRODUCT" />);
    expect(screen.getByText('4 products')).toBeInTheDocument();
    expect(screen.getByText('Off')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search product categories'), { target: { value: 'string' } });
    expect(screen.queryByText('Rackets')).not.toBeInTheDocument();
    expect(screen.getByText('Strings')).toBeInTheDocument();
  });

  it('derives a code from the name, validates it and creates the category', async () => {
    render(<CategoryManager scope="PRODUCT" />);
    fireEvent.click(screen.getByRole('button', { name: 'New product category' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Pro shop' } });
    expect(screen.getByLabelText('Code')).toHaveValue('PRO_SHOP');
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add category' }));
    await screen.findByRole('alert');
    expect(state.post).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: 'PRO_SHOP' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add category' }));
    await waitFor(() => expect(state.post).toHaveBeenCalledWith({ code: 'PRO_SHOP', name: 'Pro shop', sortOrder: 0 }));
  });

  it('keeps the code fixed when editing and switches a category off', async () => {
    render(<CategoryManager scope="PRODUCT" />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Rackets' }));
    expect(screen.getByLabelText('Code')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Racquets' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(state.put).toHaveBeenCalledWith({ id: 'c1', name: 'Racquets', sortOrder: 1 }));
    fireEvent.click(screen.getByLabelText('Rackets active'));
    await waitFor(() => expect(state.put).toHaveBeenCalledWith({ id: 'c1', isActive: false }));
  });
});

describe('category helpers', () => {
  const cats = list.map((c) => ({ ...c, scope: 'PRODUCT' as const }));
  it('offers only active categories but keeps an item\'s switched-off one visible', () => {
    expect(categoryOptions(cats).map((o) => o.value)).toEqual(['RACKET']);
    expect(categoryOptions(cats, 'STRINGS')).toContainEqual({ value: 'STRINGS', label: 'Strings (off)' });
    expect(categoryOptions(cats, 'GONE')).toContainEqual({ value: 'GONE', label: 'GONE' });
  });
  it('shows the managed name, falling back to the code', () => {
    expect(categoryName(cats, 'RACKET')).toBe('Rackets');
    expect(categoryName(cats, 'GONE')).toBe('GONE');
  });
});
