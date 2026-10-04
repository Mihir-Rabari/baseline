import { describe, expect, it } from 'vitest';
import type { Ticket } from '@packages/validation';
import {
  DEFAULT_KITCHEN_FILTERS,
  filterTickets,
  type KitchenFilters,
} from '../../../../apps/web/src/lib/kitchen-filter';

describe('Kitchen & Bar Ticket Filters (Issue #79)', () => {
  const sampleTickets: Ticket[] = [
    {
      id: 'ticket-1',
      ticketNumber: 101,
      station: 'KITCHEN',
      status: 'NEW',
      minutesWaiting: 2,
      table: { name: 'Table 1' },
      tab: { id: 'tab-1', tabNumber: 12, label: 'Table 1 · Rohit Sharma' },
      items: [
        { name: 'Crispy Veg Burger', qty: 2, note: 'extra spicy' },
        { name: 'French Fries', qty: 1, note: null },
      ],
      createdAt: '2026-10-04T12:00:00.000Z',
    },
    {
      id: 'ticket-2',
      ticketNumber: 102,
      station: 'BAR',
      status: 'PREPARING',
      minutesWaiting: 7,
      table: { name: 'T2' },
      tab: { id: 'tab-2', tabNumber: 15, label: 'T2 · Priya Patel' },
      items: [{ name: 'Classic Mojito', qty: 2, note: 'less mint' }],
      createdAt: '2026-10-04T11:55:00.000Z',
    },
    {
      id: 'ticket-3',
      ticketNumber: 103,
      station: 'KITCHEN',
      status: 'READY',
      minutesWaiting: 14,
      table: null, // Walk-in
      tab: { id: 'tab-3', tabNumber: 18, label: 'Walk-in · Amit Verma' },
      items: [{ name: 'Club Sandwich', qty: 1, note: 'no mayo' }],
      createdAt: '2026-10-04T11:48:00.000Z',
    },
  ];

  it('returns all tickets when default filters are applied', () => {
    const results = filterTickets(sampleTickets, DEFAULT_KITCHEN_FILTERS);
    expect(results).toHaveLength(3);
  });

  describe('Station filtering', () => {
    it('filters only KITCHEN station tickets', () => {
      const filters: KitchenFilters = { ...DEFAULT_KITCHEN_FILTERS, station: 'KITCHEN' };
      const results = filterTickets(sampleTickets, filters);
      expect(results).toHaveLength(2);
      expect(results.every((t) => t.station === 'KITCHEN')).toBe(true);
    });

    it('filters only BAR station tickets', () => {
      const filters: KitchenFilters = { ...DEFAULT_KITCHEN_FILTERS, station: 'BAR' };
      const results = filterTickets(sampleTickets, filters);
      expect(results).toHaveLength(1);
      expect(results[0].ticketNumber).toBe(102);
    });
  });

  describe('Status filtering', () => {
    it('filters by status NEW, PREPARING, or READY', () => {
      expect(filterTickets(sampleTickets, { ...DEFAULT_KITCHEN_FILTERS, status: 'NEW' })).toHaveLength(1);
      expect(filterTickets(sampleTickets, { ...DEFAULT_KITCHEN_FILTERS, status: 'PREPARING' })).toHaveLength(1);
      expect(filterTickets(sampleTickets, { ...DEFAULT_KITCHEN_FILTERS, status: 'READY' })).toHaveLength(1);
    });
  });

  describe('Wait time filtering', () => {
    it('filters under 5 minutes', () => {
      const results = filterTickets(sampleTickets, { ...DEFAULT_KITCHEN_FILTERS, time: 'UNDER_5' });
      expect(results).toHaveLength(1);
      expect(results[0].ticketNumber).toBe(101);
    });

    it('filters 5 to 10 minutes', () => {
      const results = filterTickets(sampleTickets, { ...DEFAULT_KITCHEN_FILTERS, time: '5_TO_10' });
      expect(results).toHaveLength(1);
      expect(results[0].ticketNumber).toBe(102);
    });

    it('filters over 10 minutes (urgent tickets)', () => {
      const results = filterTickets(sampleTickets, { ...DEFAULT_KITCHEN_FILTERS, time: 'OVER_10' });
      expect(results).toHaveLength(1);
      expect(results[0].ticketNumber).toBe(103);
    });
  });

  describe('Channel / Seating filtering', () => {
    it('filters table seated orders vs walk-in orders', () => {
      const tableOnly = filterTickets(sampleTickets, { ...DEFAULT_KITCHEN_FILTERS, channel: 'TABLE' });
      expect(tableOnly).toHaveLength(2);
      expect(tableOnly.every((t) => t.table !== null)).toBe(true);

      const walkInOnly = filterTickets(sampleTickets, { ...DEFAULT_KITCHEN_FILTERS, channel: 'WALK_IN' });
      expect(walkInOnly).toHaveLength(1);
      expect(walkInOnly[0].ticketNumber).toBe(103);
      expect(walkInOnly[0].table).toBeNull();
    });
  });

  describe('Text search queries', () => {
    it('searches by ticket number (#101 or 101)', () => {
      expect(filterTickets(sampleTickets, { ...DEFAULT_KITCHEN_FILTERS, query: '#101' })).toHaveLength(1);
      expect(filterTickets(sampleTickets, { ...DEFAULT_KITCHEN_FILTERS, query: '102' })).toHaveLength(1);
      expect(filterTickets(sampleTickets, { ...DEFAULT_KITCHEN_FILTERS, query: 'ticket 103' })).toHaveLength(1);
    });

    it('searches by tab or order number', () => {
      expect(filterTickets(sampleTickets, { ...DEFAULT_KITCHEN_FILTERS, query: 'tab #12' })).toHaveLength(1);
      expect(filterTickets(sampleTickets, { ...DEFAULT_KITCHEN_FILTERS, query: 'order #15' })).toHaveLength(1);
    });

    it('searches by table name (Table 1, T2)', () => {
      expect(filterTickets(sampleTickets, { ...DEFAULT_KITCHEN_FILTERS, query: 'Table 1' })).toHaveLength(1);
      expect(filterTickets(sampleTickets, { ...DEFAULT_KITCHEN_FILTERS, query: 't2' })).toHaveLength(1);
    });

    it('searches by item name (Burger, Mojito, Fries)', () => {
      expect(filterTickets(sampleTickets, { ...DEFAULT_KITCHEN_FILTERS, query: 'Burger' })).toHaveLength(1);
      expect(filterTickets(sampleTickets, { ...DEFAULT_KITCHEN_FILTERS, query: 'mojito' })).toHaveLength(1);
      expect(filterTickets(sampleTickets, { ...DEFAULT_KITCHEN_FILTERS, query: 'fries' })).toHaveLength(1);
    });

    it('searches by item special instructions / notes', () => {
      expect(filterTickets(sampleTickets, { ...DEFAULT_KITCHEN_FILTERS, query: 'extra spicy' })).toHaveLength(1);
      expect(filterTickets(sampleTickets, { ...DEFAULT_KITCHEN_FILTERS, query: 'no mayo' })).toHaveLength(1);
    });

    it('combines text query with station and status filters', () => {
      const combined = filterTickets(sampleTickets, {
        ...DEFAULT_KITCHEN_FILTERS,
        query: 'Burger',
        station: 'KITCHEN',
        status: 'NEW',
      });
      expect(combined).toHaveLength(1);
      expect(combined[0].ticketNumber).toBe(101);

      // Station mismatch returns empty
      const wrongStation = filterTickets(sampleTickets, {
        ...DEFAULT_KITCHEN_FILTERS,
        query: 'Burger',
        station: 'BAR',
      });
      expect(wrongStation).toHaveLength(0);
    });
  });
});
