import { describe, expect, it } from 'vitest';
import type { LeadListItem } from '@packages/validation';
import {
  filterLeads,
  groupLeadsByStatus,
  getFollowUpUrgency,
  LEAD_STATUSES,
  LEAD_SOURCES,
} from '../../../../apps/web/src/lib/crm-filter';
import { clubToday } from '../../../../apps/web/src/lib/member-form';

const mockLeads: LeadListItem[] = [
  {
    id: 'l-1',
    name: 'Riya Kapoor',
    phone: '9876543210',
    email: 'riya@example.com',
    source: 'WEBSITE_ENQUIRY',
    status: 'NEW',
    interestedPlan: { id: 'p-1', code: 'GOLD', name: 'Gold Annual' },
    message: 'Interested in gym',
    assignedTo: null,
    nextFollowUpAt: `${clubToday()}T09:00:00+05:30`,
    memberId: null,
    quoteCount: 0,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'l-2',
    name: 'Dev Shah',
    phone: '9876543211',
    email: null,
    source: 'WALK_IN',
    status: 'CONTACTED',
    interestedPlan: null,
    message: null,
    assignedTo: null,
    nextFollowUpAt: '2020-01-01T09:00:00+05:30', // Overdue
    memberId: null,
    quoteCount: 1,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'l-3',
    name: 'Aanya Patel',
    phone: null,
    email: 'aanya@example.com',
    source: 'PHONE',
    status: 'WON',
    interestedPlan: null,
    message: null,
    assignedTo: null,
    nextFollowUpAt: null,
    memberId: 'm-1',
    quoteCount: 2,
    createdAt: new Date().toISOString(),
  },
];

describe('crm-filter helpers', () => {
  it('filters by status', () => {
    const newLeads = filterLeads(mockLeads, { status: 'NEW' });
    expect(newLeads).toHaveLength(1);
    expect(newLeads[0].name).toBe('Riya Kapoor');

    const all = filterLeads(mockLeads, { status: 'ALL' });
    expect(all).toHaveLength(3);
  });

  it('filters by search query matching name, phone, or email', () => {
    const byName = filterLeads(mockLeads, { q: 'dev' });
    expect(byName).toHaveLength(1);
    expect(byName[0].name).toBe('Dev Shah');

    const byPhone = filterLeads(mockLeads, { q: '9876543210' });
    expect(byPhone).toHaveLength(1);
    expect(byPhone[0].name).toBe('Riya Kapoor');

    const byEmail = filterLeads(mockLeads, { q: 'aanya@' });
    expect(byEmail).toHaveLength(1);
    expect(byEmail[0].name).toBe('Aanya Patel');
  });

  it('filters by source', () => {
    const walkIn = filterLeads(mockLeads, { source: 'WALK_IN' });
    expect(walkIn).toHaveLength(1);
    expect(walkIn[0].name).toBe('Dev Shah');
  });

  it('groups leads by status into Kanban columns', () => {
    const grouped = groupLeadsByStatus(mockLeads);
    expect(grouped.NEW).toHaveLength(1);
    expect(grouped.CONTACTED).toHaveLength(1);
    expect(grouped.QUOTED).toHaveLength(0);
    expect(grouped.WON).toHaveLength(1);
    expect(grouped.LOST).toHaveLength(0);
  });

  it('computes follow up urgency correctly', () => {
    expect(getFollowUpUrgency(`${clubToday()}T09:00:00+05:30`, 'NEW')).toBe('today');
    expect(getFollowUpUrgency('2020-01-01T09:00:00+05:30', 'CONTACTED')).toBe('overdue');
    expect(getFollowUpUrgency(null, 'NEW')).toBe('none');
    expect(getFollowUpUrgency(`${clubToday()}T09:00:00+05:30`, 'WON')).toBe('none');
  });

  it('exports valid metadata arrays', () => {
    expect(LEAD_STATUSES).toHaveLength(5);
    expect(LEAD_SOURCES.length).toBeGreaterThanOrEqual(5);
  });
});
