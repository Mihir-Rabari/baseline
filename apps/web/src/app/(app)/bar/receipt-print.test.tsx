import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TabPage from '@/app/(app)/bar/tabs/[id]/page';
import tabFixture from '@/mocks/bar-tab.json';
import type { Tab } from '@packages/validation';

const doubles = vi.hoisted(() => ({
  tabData: null as Tab | null,
  permissions: new Set<string>(['bar:read', 'bar:manage', 'bar:settle']),
}));

vi.mock('@/lib/bar-api', () => ({
  barApi: {
    tab: vi.fn(() => Promise.resolve(doubles.tabData)),
    menu: vi.fn(() => Promise.resolve([])),
    add: vi.fn(),
    remove: vi.fn(),
    send: vi.fn(),
    settle: vi.fn(),
  },
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: { id: 'staff-1' },
    hasPermission: (perm: string) => doubles.permissions.has(perm),
  }),
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'tab-1' }),
}));

function mount() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <TabPage />
    </QueryClientProvider>
  );
}

describe('Receipt Printing (Issue #78)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    doubles.permissions = new Set(['bar:read', 'bar:manage', 'bar:settle']);
    doubles.tabData = {
      ...(structuredClone(tabFixture) as unknown as Tab),
      status: 'SETTLED',
      settledAt: '2026-10-03T10:00:00.000Z',
    };
  });

  it('renders a Print receipt button and calls window.print when tab is settled', async () => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});

    mount();
    const printButton = await screen.findByRole('button', { name: 'Print receipt' });
    expect(printButton).toBeInTheDocument();

    fireEvent.click(printButton);
    expect(printSpy).toHaveBeenCalledTimes(1);

    // Print header contains receipt title and tab number
    expect(screen.getByRole('heading', { name: /Receipt · Tab #/ })).toBeInTheDocument();

    printSpy.mockRestore();
  });

  it('hides the Print receipt button when tab is still open', async () => {
    doubles.tabData = {
      ...(structuredClone(tabFixture) as unknown as Tab),
      status: 'OPEN',
      settledAt: null,
    };

    mount();
    await waitFor(() => {
      expect(screen.getByText(/Opened/)).toBeInTheDocument();
    });

    expect(screen.queryByRole('button', { name: 'Print receipt' })).not.toBeInTheDocument();
  });
});
