import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CrmPage from '../../../../../../apps/web/src/app/(app)/crm/page';
import plans from '@/mocks/plans.json';

const state = vi.hoisted(() => ({
  read: true,
  manage: true,
  list: vi.fn(),
  summary: vi.fn(),
  detail: vi.fn(),
  note: vi.fn(),
  update: vi.fn(),
  quote: vi.fn(),
  sendQuote: vi.fn(),
  convert: vi.fn(),
  create: vi.fn(),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: { id: 'staff' },
    hasPermission: (permission: string) =>
      permission === 'crm:read' ? state.read : state.manage,
  }),
}));

vi.mock('@/lib/crm-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/crm-api')>()),
  crmApi: state,
}));

vi.mock('@/lib/api-client', () => ({
  api: { plans: { list: async () => plans } },
}));

const lead = {
  id: 'c0000000-0000-4000-8000-000000000001',
  name: 'Riya Kapoor',
  phone: '9876543210',
  email: null,
  status: 'NEW',
  source: 'WEBSITE_ENQUIRY',
  interestedPlan: null,
  nextFollowUpAt: null,
  message: 'Interested in Gold',
  memberId: null,
  quoteCount: 0,
};

function show() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
          },
        })
      }
    >
      <CrmPage />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  for (const method of [
    'list',
    'summary',
    'detail',
    'note',
    'update',
    'quote',
    'sendQuote',
    'convert',
    'create',
  ] as const) {
    state[method].mockReset();
  }
  state.read = true;
  state.manage = true;
  state.list.mockResolvedValue({
    data: [lead],
    meta: { hasPrevPage: false, hasNextPage: false },
  });
  state.summary.mockResolvedValue({
    byStatus: { NEW: 1, CONTACTED: 0, QUOTED: 0, WON: 0, LOST: 0 },
    dueToday: 1,
    overdue: 0,
    conversionRatePct: 0,
  });
  state.detail.mockResolvedValue({ lead, activities: [], quotes: [] });
  state.note.mockResolvedValue({});
  state.update.mockResolvedValue({});
  state.create.mockResolvedValue({ ...lead, name: 'Vikram Singhania' });
});

describe('CRM pipeline (Issue #73)', () => {
  it('blocks read access without querying', () => {
    state.read = false;
    show();
    expect(screen.getByText('Leads are unavailable')).toBeInTheDocument();
    expect(state.list).not.toHaveBeenCalled();
  });

  it('renders Kanban board with columns and lead cards', async () => {
    show();
    expect(await screen.findByText('Lead pipeline')).toBeInTheDocument();
    expect(await screen.findByText('Riya Kapoor')).toBeInTheDocument();
    expect(screen.getByText('New')).toBeInTheDocument();
    expect(screen.getByText('Contacted')).toBeInTheDocument();
    expect(screen.getByText('Quoted')).toBeInTheDocument();
    expect(screen.getByText('Won')).toBeInTheDocument();
    expect(screen.getByText('Lost')).toBeInTheDocument();
  });

  it('allows switching to list view and filters by status tabs', async () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Table list view' }));
    expect(await screen.findByRole('tab', { name: 'new' })).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'won' }), { button: 0, ctrlKey: false });
    await waitFor(() =>
      expect(state.list).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'WON' })
      )
    );
  });

  it('allows quick adding a new lead', async () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Add Lead' }));

    expect(screen.getByText('Add New Lead')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Full Name'), {
      target: { value: 'Vikram Singhania' },
    });
    fireEvent.change(screen.getByLabelText('Phone Number'), {
      target: { value: '9811223344' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save Lead' }));

    await waitFor(() =>
      expect(state.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Vikram Singhania',
          phone: '9811223344',
          source: 'WALK_IN',
        })
      )
    );
  });

  it('allows read-only lead detail without mutation controls', async () => {
    state.manage = false;
    show();
    fireEvent.click(await screen.findByText('Riya Kapoor'));
    await screen.findByText('Interested in Gold');
    expect(screen.queryByRole('button', { name: 'Convert to member' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Add Activity Note')).not.toBeInTheDocument();
  });

  it('submits a note and validates the lost reason', async () => {
    show();
    fireEvent.click(await screen.findByText('Riya Kapoor'));
    fireEvent.change(await screen.findByLabelText('Add Activity Note'), {
      target: { value: 'Called today' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }));
    await waitFor(() =>
      expect(state.note).toHaveBeenCalledWith(lead.id, {
        type: 'NOTE',
        body: 'Called today',
      })
    );

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'LOST' } });
    expect(state.update).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Reason if lost'), {
      target: { value: 'Moved away' },
    });
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'LOST' } });
    await waitFor(() =>
      expect(state.update).toHaveBeenCalledWith(lead.id, {
        status: 'LOST',
        lostReason: 'Moved away',
      })
    );
  });

  it('switches list filters and presents retry and empty states', async () => {
    state.list
      .mockRejectedValueOnce(new Error('Lead service unavailable'))
      .mockResolvedValue({ data: [], meta: {} });
    show();
    await screen.findByText('Lead service unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('No leads in this view');
    fireEvent.click(screen.getByRole('button', { name: 'Table list view' }));
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'won' }), { button: 0, ctrlKey: false });
    await waitFor(() =>
      expect(state.list).toHaveBeenCalledWith(expect.objectContaining({ status: 'WON', page: 1 }))
    );
  });

  it('clears unsaved notes, quote and lost reason when opening another lead', async () => {
    const second = {
      ...lead,
      id: 'c0000000-0000-4000-8000-000000000002',
      name: 'Dev Shah',
    };
    state.list.mockResolvedValue({
      data: [lead, second],
      meta: { hasPrevPage: false, hasNextPage: false },
    });
    state.detail.mockImplementation(async (id: string) => ({
      lead: id === second.id ? second : lead,
      activities: [],
      quotes: [],
    }));

    show();
    fireEvent.click(await screen.findByText('Riya Kapoor'));
    fireEvent.change(await screen.findByLabelText('Add Activity Note'), {
      target: { value: 'Private draft for Riya' },
    });
    fireEvent.change(screen.getByLabelText('Reason if lost'), {
      target: { value: 'Riya moved away' },
    });
    fireEvent.change(screen.getByLabelText('Amount (paise)'), {
      target: { value: '999' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    fireEvent.click(screen.getByText('Dev Shah'));
    await screen.findByRole('heading', { name: 'Dev Shah' });

    expect(screen.getByLabelText('Add Activity Note')).toHaveValue('');
    expect(screen.getByLabelText('Reason if lost')).toHaveValue('');
    expect(screen.getByLabelText('Amount (paise)')).toHaveValue(null);
  });

  it('rejects adult Junior conversions before calling the API', async () => {
    show();
    fireEvent.click(await screen.findByText('Riya Kapoor'));
    fireEvent.click(await screen.findByRole('button', { name: 'Convert to member' }));
    fireEvent.click(screen.getByRole('button', { name: /Junior/ }));
    fireEvent.change(screen.getByLabelText('Date of birth (Junior)'), {
      target: { value: '1990-01-01' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm conversion' }));
    await waitFor(() =>
      expect(screen.getByText('Junior members must be under 18')).toBeInTheDocument()
    );
    expect(state.convert).not.toHaveBeenCalled();
  });

  it('displays follow-up dates in IST and submits a valid UTC ISO instant', async () => {
    state.detail.mockResolvedValue({
      lead: { ...lead, nextFollowUpAt: '2026-10-02T19:00:00.000Z' },
      activities: [],
      quotes: [],
    });
    show();
    fireEvent.click(await screen.findByText('Riya Kapoor'));
    expect(await screen.findByLabelText('Next follow-up')).toHaveValue('2026-10-03');
    fireEvent.change(screen.getByLabelText('Next follow-up'), {
      target: { value: '2026-10-04' },
    });
    await waitFor(() =>
      expect(state.update).toHaveBeenCalledWith(lead.id, {
        nextFollowUpAt: '2026-10-04T03:30:00.000Z',
      })
    );
  });
});
