import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LeadsBoard, type LeadSummaryItem } from '../../../../../apps/web/src/components/club/leads-board';
import { ShiftsCards, type ShiftItem } from '../../../../../apps/web/src/components/club/shifts-cards';
import { InvoicesCards, InvoicesBoard, type InvoiceItem } from '../../../../../apps/web/src/components/club/invoices-views';
import { InventoryCards, InventoryBoard } from '../../../../../apps/web/src/components/club/inventory-views';
import { MembersCards, MembersBoard, type MemberItem } from '../../../../../apps/web/src/components/club/members-views';
import { KitchenBoard, KitchenCards, type KitchenTicketItem } from '../../../../../apps/web/src/components/club/kitchen-views';
import { LeaveCards, LeaveBoard, type LeaveRequestItem } from '../../../../../apps/web/src/components/club/leave-views';
import type { Product } from '@packages/validation';

describe('New Views & Components', () => {
  it('renders LeadsBoard and interacts with cards and status changes', () => {
    const leads: LeadSummaryItem[] = [
      {
        id: 'lead-1',
        name: 'Aanya Patel',
        phone: '9876543210',
        email: null,
        source: 'WEBSITE_ENQUIRY',
        status: 'NEW',
        interestedPlan: { id: 'p1', code: 'GOLD', name: 'Gold' },
        nextFollowUpAt: '2026-10-04T09:00:00+05:30',
        quoteCount: 1,
      },
      {
        id: 'lead-2',
        name: 'Dev Shah',
        phone: null,
        email: null,
        source: 'WALK_IN',
        status: 'CONTACTED',
        nextFollowUpAt: null,
      },
    ];
    const onSelect = vi.fn();
    const onStatusChange = vi.fn();

    render(
      <LeadsBoard
        leads={leads}
        canManage={true}
        onSelect={onSelect}
        onStatusChange={onStatusChange}
      />
    );

    expect(screen.getByText('Aanya Patel')).toBeInTheDocument();
    expect(screen.getByText('Dev Shah')).toBeInTheDocument();
    expect(screen.getByText('No phone')).toBeInTheDocument();
    expect(screen.getByText('1 quote(s)')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Contacted' }));
    expect(onStatusChange).toHaveBeenCalledWith(leads[0], 'CONTACTED');

    fireEvent.click(screen.getAllByRole('button', { name: 'View details' })[0]);
    expect(onSelect).toHaveBeenCalledWith('lead-1');
  });

  it('renders ShiftsCards and allows removing shifts', () => {
    const shifts: ShiftItem[] = [
      {
        id: 'shift-1',
        roleLabel: 'FRONT_DESK',
        startsAt: '2026-10-03T09:00:00+05:30',
        endsAt: '2026-10-03T17:00:00+05:30',
        status: 'SCHEDULED',
        clockInAt: null,
        employee: { id: 'emp-1', fullName: 'Ramesh Kumar' },
      },
    ];
    const onRemove = vi.fn();

    render(
      <ShiftsCards
        shifts={shifts}
        canManage={true}
        onRemove={onRemove}
      />
    );

    expect(screen.getByText('Ramesh Kumar')).toBeInTheDocument();
    expect(screen.getByText('Front desk')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove shift' }));
    expect(onRemove).toHaveBeenCalledWith('shift-1');
  });

  it('renders InvoicesCards and InvoicesBoard with links and financial totals', () => {
    const invoices: InvoiceItem[] = [
      {
        id: 'inv-1',
        invoiceNumber: 'INV-2026-001',
        status: 'SENT',
        issueDate: '2026-10-01',
        dueDate: '2026-10-15',
        billTo: { name: 'Acme Academy' },
        totalPaise: 500000,
        balancePaise: 250000,
      },
    ];

    const { rerender } = render(<InvoicesCards invoices={invoices} />);
    expect(screen.getByText('INV-2026-001')).toHaveAttribute('href', '/invoices/inv-1');
    expect(screen.getByText('Acme Academy')).toBeInTheDocument();

    rerender(<InvoicesBoard invoices={invoices} />);
    expect(screen.getByText('INV-2026-001')).toHaveAttribute('href', '/invoices/inv-1');
    expect(screen.getByText('Acme Academy')).toBeInTheDocument();
  });

  it('renders InventoryCards and InventoryBoard with restock and edit actions', () => {
    const products: Product[] = [
      {
        id: 'prod-1',
        sku: 'RACK-01',
        name: 'Pro Racket',
        category: 'RACKET',
        imageUrl: null,
        pricePaise: 1200000,
        yourPricePaise: 1200000,
        discountPct: 0,
        stockQty: 0,
        inStock: false,
        reorderLevel: 5,
        isActive: true,
      },
    ];
    const onRestock = vi.fn();
    const onEdit = vi.fn();

    const { rerender } = render(
      <InventoryCards
        products={products}
        canAdjust={true}
        canUpdate={true}
        onRestock={onRestock}
        onEdit={onEdit}
      />
    );

    expect(screen.getByText('Pro Racket')).toBeInTheDocument();
    expect(screen.getByText('Out of stock')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Restock' }));
    expect(onRestock).toHaveBeenCalledWith(products[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Pro Racket' }));
    expect(onEdit).toHaveBeenCalledWith(products[0]);

    rerender(
      <InventoryBoard
        products={products}
        canAdjust={true}
        canUpdate={true}
        onRestock={onRestock}
        onEdit={onEdit}
      />
    );
    expect(screen.getByText('Pro Racket')).toBeInTheDocument();
  });

  it('renders MembersCards and MembersBoard with links to profiles', () => {
    const members: MemberItem[] = [
      {
        id: 'mem-1',
        memberCode: 'MEM-001',
        fullName: 'Vikram Seth',
        phone: '9876543210',
        membership: {
          plan: { code: 'GOLD', name: 'Gold Plan' },
          expiryState: 'ACTIVE',
          daysLeft: 45,
        },
      },
    ];

    const { rerender } = render(<MembersCards members={members} />);
    expect(screen.getByText('Vikram Seth')).toHaveAttribute('href', '/members/mem-1');
    expect(screen.getByText('Gold Plan')).toBeInTheDocument();
    expect(screen.getByText('45 days left')).toBeInTheDocument();

    rerender(<MembersBoard members={members} />);
    expect(screen.getByText('Vikram Seth')).toHaveAttribute('href', '/members/mem-1');
    expect(screen.getByText('MEM-001')).toBeInTheDocument();
  });

  it('renders KitchenBoard and KitchenCards with action buttons', () => {
    const tickets: KitchenTicketItem[] = [
      {
        id: 'ticket-1',
        ticketNumber: 42,
        status: 'NEW',
        station: 'KITCHEN',
        minutesWaiting: 8,
        tab: { tabNumber: 3, label: 'Table 3' },
        table: { name: 'Table 3' },
        items: [{ name: 'Masala Fries', qty: 2, note: 'Extra crispy' }],
      },
    ];
    const onMove = vi.fn();

    const { rerender } = render(
      <KitchenBoard
        tickets={tickets}
        isPending={false}
        onMove={onMove}
      />
    );

    expect(screen.getByText(/Masala Fries/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start ticket 42' }));
    expect(onMove).toHaveBeenCalledWith('ticket-1', 'PREPARING');

    rerender(
      <KitchenCards
        tickets={tickets}
        isPending={false}
        onMove={onMove}
      />
    );
    expect(screen.getByRole('button', { name: 'Start ticket 42' })).toBeInTheDocument();
  });

  it('renders LeaveCards and LeaveBoard with approve and reject actions', () => {
    const requests: LeaveRequestItem[] = [
      {
        id: 'leave-1',
        leaveType: 'CASUAL',
        fromDate: '2026-10-10',
        toDate: '2026-10-12',
        days: 3,
        reason: 'Family event',
        status: 'PENDING',
        employee: { id: 'emp-1', fullName: 'Sneha Patel' },
      },
    ];
    const onDecide = vi.fn();

    const { rerender } = render(
      <LeaveCards
        requests={requests}
        canDecide={true}
        onDecide={onDecide}
      />
    );

    expect(screen.getByText('Sneha Patel')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(onDecide).toHaveBeenCalledWith('leave-1', 'APPROVED');
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect(onDecide).toHaveBeenCalledWith('leave-1', 'REJECTED');

    rerender(
      <LeaveBoard
        requests={requests}
        canDecide={true}
        onDecide={onDecide}
      />
    );
    expect(screen.getByText('Sneha Patel')).toBeInTheDocument();
  });
});
