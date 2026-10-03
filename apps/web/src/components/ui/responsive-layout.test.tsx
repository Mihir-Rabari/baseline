import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PageHeader } from '@/components/app-shell/page-header';
import { BarList, Pager } from '@/components/club/ops-bits';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from './dialog';
import { Table, TableBody, TableCell, TableRow } from './table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs';

describe('Responsive shared layouts', () => {
  it('wraps header actions independently of a long title', () => {
    render(<PageHeader title={'LongTitle'.repeat(20)} actions={<><button>View</button><button>Schedule shift</button></>} />);
    expect(screen.getByRole('heading').parentElement).toHaveClass('min-w-0', 'break-words');
    expect(screen.getByRole('button', { name: 'View' }).parentElement).toHaveClass('flex-wrap', 'max-w-full', 'w-full');
    expect(screen.getByRole('button', { name: 'Schedule shift' })).toBeVisible();
  });

  it('contains wide tables without dropping columns or breaking the table ref', () => {
    const ref = React.createRef<HTMLTableElement>();
    render(<Table ref={ref}><TableBody><TableRow><TableCell>Long record</TableCell><TableCell>Final column</TableCell></TableRow></TableBody></Table>);
    expect(screen.getByRole('table').parentElement).toHaveClass('min-w-0', 'max-w-full', 'overflow-auto');
    expect(ref.current).toBe(screen.getByRole('table'));
    expect(screen.getByRole('cell', { name: 'Final column' })).toBeVisible();
  });

  it('keeps wide tab labels scrollable and preserves keyboard activation', async () => {
    render(<Tabs defaultValue="first"><TabsList><TabsTrigger value="first">First report</TabsTrigger><TabsTrigger value="second">Second detailed report</TabsTrigger></TabsList><TabsContent value="first">First results</TabsContent><TabsContent value="second">Second results</TabsContent></Tabs>);
    expect(screen.getByRole('tablist')).toHaveClass('max-w-full', 'overflow-x-auto', 'justify-start');
    const first = screen.getByRole('tab', { name: 'First report' });
    expect(first).toHaveClass('shrink-0');
    act(() => first.focus());
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(await screen.findByText('Second results')).toBeVisible();
    expect(screen.getByRole('tab', { name: 'Second detailed report' })).toHaveFocus();
    expect(screen.getByRole('tabpanel')).toHaveClass('min-w-0', 'motion-safe:animate-rise');
  });

  it('constrains dialogs to the viewport and retains accessible dismissal', () => {
    render(<Dialog><DialogTrigger>Open editor</DialogTrigger><DialogContent><DialogHeader><DialogTitle>Edit a long record title</DialogTitle><DialogDescription>Record details</DialogDescription></DialogHeader><DialogFooter><button>Save</button><button>Cancel</button></DialogFooter></DialogContent></Dialog>);
    fireEvent.click(screen.getByRole('button', { name: 'Open editor' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveClass('w-[calc(100%_-_2rem)]', 'supports-[height:100dvh]:max-h-[calc(100dvh_-_2rem)]', 'overflow-y-auto');
    expect(screen.getByRole('heading').parentElement).toHaveClass('pr-8', 'break-words');
    expect(screen.getByRole('button', { name: 'Save' }).parentElement).toHaveClass('gap-2', 'sm:flex-wrap');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('wraps long report labels without losing their amounts', () => {
    render(<BarList money={false} rows={[{ label: 'LongName'.repeat(20), value: 150 }]} />);
    const label = screen.getByText('LongName'.repeat(20));
    expect(label).toHaveClass('min-w-0', 'max-w-full');
    expect(label.parentElement).toHaveClass('flex-wrap', 'break-words');
    expect(screen.getByText('150')).toBeVisible();
  });

  it('allows pagination controls to wrap while keeping both actions usable', () => {
    const pages: number[] = [];
    render(<Pager meta={{ page: 2, limit: 10, totalItems: 30, totalPages: 3, hasPrevPage: true, hasNextPage: true }} onPage={(page) => pages.push(page)} />);
    expect(screen.getByText('Page 2 of 3 · 30 items').parentElement).toHaveClass('flex-wrap');
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(pages).toEqual([1, 3]);
  });
});



