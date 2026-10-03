import type { LeadListItem, LeadStatus, LeadSource } from '@packages/validation';
import { clubToday } from './member-form';
import { crmFollowUpDate } from './crm-api';

export const LEAD_STATUSES: Array<{ key: LeadStatus; label: string }> = [
  { key: 'NEW', label: 'New' },
  { key: 'CONTACTED', label: 'Contacted' },
  { key: 'QUOTED', label: 'Quoted' },
  { key: 'WON', label: 'Won' },
  { key: 'LOST', label: 'Lost' },
];

export const LEAD_SOURCES: Array<{ key: 'ALL' | LeadSource; label: string }> = [
  { key: 'ALL', label: 'All sources' },
  { key: 'WEBSITE_ENQUIRY', label: 'Website Enquiry' },
  { key: 'WEBSITE_TRIAL', label: 'Website Trial' },
  { key: 'WALK_IN', label: 'Walk-in' },
  { key: 'PHONE', label: 'Phone' },
  { key: 'REFERRAL', label: 'Referral' },
];

export interface LeadFilterOptions {
  q?: string;
  status?: 'ALL' | LeadStatus;
  source?: 'ALL' | LeadSource;
  dueTodayOnly?: boolean;
}

export function filterLeads(leads: LeadListItem[], options: LeadFilterOptions): LeadListItem[] {
  const { q = '', status = 'ALL', source = 'ALL', dueTodayOnly = false } = options;
  const normalizedQuery = q.trim().toLowerCase();
  const todayStr = clubToday();

  return leads.filter((lead) => {
    // Status filter
    if (status !== 'ALL' && lead.status !== status) {
      return false;
    }

    // Source filter
    if (source !== 'ALL' && lead.source !== source) {
      return false;
    }

    // Due today filter
    if (dueTodayOnly) {
      if (['WON', 'LOST'].includes(lead.status)) return false;
      const followUpDate = crmFollowUpDate(lead.nextFollowUpAt);
      if (followUpDate !== todayStr) return false;
    }

    // Search query filter
    if (normalizedQuery) {
      const matchName = lead.name.toLowerCase().includes(normalizedQuery);
      const matchPhone = (lead.phone ?? '').toLowerCase().includes(normalizedQuery);
      const matchEmail = (lead.email ?? '').toLowerCase().includes(normalizedQuery);
      const matchPlan = (lead.interestedPlan?.name ?? '').toLowerCase().includes(normalizedQuery);
      if (!matchName && !matchPhone && !matchEmail && !matchPlan) {
        return false;
      }
    }

    return true;
  });
}

export function groupLeadsByStatus(
  leads: LeadListItem[]
): Record<LeadStatus, LeadListItem[]> {
  const groups: Record<LeadStatus, LeadListItem[]> = {
    NEW: [],
    CONTACTED: [],
    QUOTED: [],
    WON: [],
    LOST: [],
  };

  leads.forEach((lead) => {
    if (groups[lead.status]) {
      groups[lead.status].push(lead);
    }
  });

  return groups;
}

export function getFollowUpUrgency(
  nextFollowUpAt: string | null,
  status: LeadStatus
): 'none' | 'overdue' | 'today' | 'future' {
  if (!nextFollowUpAt || ['WON', 'LOST'].includes(status)) return 'none';
  const followUpDate = crmFollowUpDate(nextFollowUpAt);
  const todayStr = clubToday();

  if (followUpDate < todayStr) return 'overdue';
  if (followUpDate === todayStr) return 'today';
  return 'future';
}
