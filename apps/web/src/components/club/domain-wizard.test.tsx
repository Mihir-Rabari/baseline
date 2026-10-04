import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TenantDomainDetail } from '@packages/validation';
import { ApiError } from '@/lib/api-client';
import { DomainWizard, domainErrorText, stepOf } from './domain-wizard';

const state = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), del: vi.fn() }));
vi.mock('@/lib/ops', () => ({ ops: { get: state.get, post: state.post, delete: state.del } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const platform: TenantDomainDetail = { id: 'p1', domain: 'club.baseline.example', kind: 'PLATFORM', status: 'VERIFIED', verifiedAt: '2026-01-01T00:00:00.000Z', lastCheckedAt: null, lastError: null, createdAt: '2026-01-01T00:00:00.000Z', dnsRecords: [] };
const records = [
  { type: 'TXT' as const, name: '_baseline-verify.courts.example.org', value: 'abc123token', purpose: 'ownership' as const },
  { type: 'CNAME' as const, name: 'courts.example.org', value: 'sites.baseline.example', purpose: 'routing' as const },
];
const pending: TenantDomainDetail = { id: 'd1', domain: 'courts.example.org', kind: 'CUSTOM', status: 'PENDING', verifiedAt: null, lastCheckedAt: null, lastError: null, createdAt: '2026-01-02T00:00:00.000Z', dnsRecords: records };

function show() {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><DomainWizard /></QueryClientProvider>);
}

let list: TenantDomainDetail[];
beforeEach(() => {
  list = [platform];
  state.get.mockReset().mockImplementation(async () => list);
  state.post.mockReset();
  state.del.mockReset().mockResolvedValue(undefined);
});

describe('step logic', () => {
  it('maps a domain to its wizard step', () => {
    expect(stepOf(null)).toBe('domain');
    expect(stepOf({ status: 'PENDING', lastCheckedAt: null })).toBe('dns');
    expect(stepOf({ status: 'FAILED', lastCheckedAt: '2026-01-01T00:00:00.000Z' })).toBe('verify');
    expect(stepOf({ status: 'VERIFIED', lastCheckedAt: '2026-01-01T00:00:00.000Z' })).toBe('live');
  });

  it('explains rate limits and duplicates in plain words', () => {
    expect(domainErrorText(new ApiError('x', 429), 'fallback')).toMatch(/Too many checks/);
    expect(domainErrorText(new ApiError('x', 409), 'fallback')).toMatch(/already connected/);
    expect(domainErrorText(new ApiError('Reserved name', 422), 'fallback')).toBe('Reserved name');
    expect(domainErrorText('weird', 'fallback')).toBe('fallback');
  });
});

describe('domain wizard', () => {
  it('shows a loading state, then the platform address and an empty state', async () => {
    show();
    expect(screen.getByLabelText('Loading domains')).toBeInTheDocument();
    expect(await screen.findByText('club.baseline.example')).toBeInTheDocument();
    expect(screen.getByText('No custom domain yet.')).toBeInTheDocument();
  });

  it('shows a retryable error when the domains cannot be loaded', async () => {
    state.get.mockRejectedValueOnce(new Error('Network down'));
    show();
    expect(await screen.findByText(/Network down/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry|try again/i }));
    expect(await screen.findByText('club.baseline.example')).toBeInTheDocument();
  });

  it('validates the domain before calling the server', async () => {
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Connect a domain' }));
    fireEvent.change(screen.getByLabelText('Domain'), { target: { value: 'https://not a domain' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a domain such as courts.example.com');
    expect(state.post).not.toHaveBeenCalled();
  });

  it('walks enter domain, DNS records, failed check, retry and live', async () => {
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Connect a domain' }));
    expect(screen.getByRole('listitem', { current: 'step' })).toHaveTextContent('Domain');
    state.post.mockImplementationOnce(async (path: string, body: object) => {
      expect(path).toBe('/tenant/domains');
      expect(body).toEqual({ domain: 'courts.example.org' });
      list = [platform, pending];
      return pending;
    });
    fireEvent.change(screen.getByLabelText('Domain'), { target: { value: ' Courts.Example.org ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    // Step 2: the records to add, with copy buttons.
    expect(await screen.findByText('_baseline-verify.courts.example.org')).toBeInTheDocument();
    expect(screen.getByText('abc123token')).toBeInTheDocument();
    expect(screen.getByText('sites.baseline.example')).toBeInTheDocument();
    expect(screen.getByRole('listitem', { current: 'step' })).toHaveTextContent('DNS records');
    expect(screen.getByRole('button', { name: 'Copy TXT record value' })).toBeInTheDocument();

    // Step 3: the first check fails, the reason and a retry are shown.
    const failed = { ...pending, status: 'FAILED' as const, lastCheckedAt: '2026-01-02T01:00:00.000Z', lastError: 'The TXT record was not found with the expected value.' };
    state.post.mockImplementationOnce(async (path: string) => { expect(path).toBe('/tenant/domains/d1/verify'); list = [platform, failed]; return failed; });
    fireEvent.click(screen.getByRole('button', { name: 'I added the records, check now' }));
    expect(await screen.findByText('The TXT record was not found with the expected value.')).toBeInTheDocument();
    expect(screen.getByRole('listitem', { current: 'step' })).toHaveTextContent('Verify');
    expect(screen.getAllByText('Not verified').length).toBeGreaterThan(0);

    // Retry succeeds and the domain goes live.
    const live = { ...failed, status: 'VERIFIED' as const, lastError: null, verifiedAt: '2026-01-02T02:00:00.000Z' };
    state.post.mockImplementationOnce(async () => { list = [platform, live]; return live; });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('courts.example.org is live.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open https://courts.example.org' })).toHaveAttribute('href', 'https://courts.example.org');
    expect(screen.getByRole('listitem', { current: 'step' })).toHaveTextContent('Live');
  });

  it('shows server refusals when adding: taken domain, reserved name', async () => {
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Connect a domain' }));
    fireEvent.change(screen.getByLabelText('Domain'), { target: { value: 'taken.example.org' } });
    state.post.mockRejectedValueOnce(new ApiError('That domain is already connected to a club.', 409, 'DOMAIN_TAKEN'));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('That domain is already connected to a club.')).toBeInTheDocument();
    // The form stays so the owner can fix the name.
    expect(screen.getByLabelText('Domain')).toHaveValue('taken.example.org');
  });

  it('tells the owner when checks are rate limited and keeps the retry available', async () => {
    list = [platform, pending];
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Set up courts.example.org' }));
    state.post.mockRejectedValueOnce(new ApiError('Rate limit exceeded', 429));
    fireEvent.click(screen.getByRole('button', { name: 'I added the records, check now' }));
    expect(await screen.findByText('Too many checks. Wait a minute, then try again.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'I added the records, check now' })).toBeEnabled();
  });

  it('shows a DNS outage as a retryable failure', async () => {
    const failed: TenantDomainDetail = { ...pending, status: 'FAILED', lastCheckedAt: '2026-01-02T01:00:00.000Z', lastError: 'The DNS lookup failed. Try again in a few minutes.' };
    list = [platform, failed];
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Set up courts.example.org' }));
    expect(await screen.findByText('The DNS lookup failed. Try again in a few minutes.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
  });

  it('removes a domain only after confirmation, and keeps it when the server refuses', async () => {
    list = [platform, pending];
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove courts.example.org' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(state.del).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Remove courts.example.org' }));
    state.del.mockRejectedValueOnce(new Error('The platform address cannot be removed.'));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText('The platform address cannot be removed.')).toBeInTheDocument();

    state.del.mockImplementationOnce(async () => { list = [platform]; });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(state.del).toHaveBeenLastCalledWith('/tenant/domains/d1'));
    await waitFor(() => expect(screen.queryByText('courts.example.org')).not.toBeInTheDocument());
  });
});
