import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TenantBranding } from '@packages/validation';
import { BrandingEditor, brandingPatch } from '../../../../../apps/web/src/components/club/branding-editor';

const state = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock('@/lib/ops', () => ({ ops: { get: state.get, put: state.put } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/club/image-uploader', () => ({
  ImageUploader: ({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) => (
    <div><span data-testid="logo-value">{value ?? 'none'}</span><button type="button" onClick={() => onChange('/api/v1/media/club/new-logo.png')}>Pick logo</button></div>
  ),
}));

const empty: TenantBranding = { logoUrl: null, primaryColor: null, secondaryColor: null, accentColor: null };

function show() {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><BrandingEditor /></QueryClientProvider>);
}

beforeEach(() => {
  state.get.mockReset().mockResolvedValue(empty);
  state.put.mockReset();
});

describe('brandingPatch', () => {
  it('lists only changed fields, compares colours case-insensitively and clears with null', () => {
    const saved = { logoUrl: '/a.png', primaryColor: '#1A73E8', secondaryColor: null, accentColor: '#ff8800' };
    expect(brandingPatch(saved, { ...saved })).toEqual({});
    expect(brandingPatch(saved, { ...saved, primaryColor: '#1a73e8' })).toEqual({});
    expect(brandingPatch(saved, { ...saved, accentColor: null, logoUrl: null })).toEqual({ accentColor: null, logoUrl: null });
    expect(brandingPatch(saved, { ...saved, secondaryColor: '#000000' })).toEqual({ secondaryColor: '#000000' });
  });
});

describe('branding editor', () => {
  it('shows loading, then an error with retry', async () => {
    state.get.mockRejectedValueOnce(new Error('Boom'));
    show();
    expect(screen.getByLabelText('Loading branding')).toBeInTheDocument();
    expect(await screen.findByText(/Boom/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry|try again/i }));
    expect(await screen.findByLabelText('Primary colour')).toBeInTheDocument();
  });

  it('starts with nothing to save and previews a colour as it is typed', async () => {
    show();
    const hex = await screen.findByLabelText('Primary colour');
    expect(screen.getByRole('button', { name: 'Save branding' })).toBeDisabled();
    fireEvent.change(hex, { target: { value: '#1a73e8' } });
    expect(screen.getByRole('group', { name: 'Live preview' }).style.getPropertyValue('--primary')).toMatch(/^\d+ \d+% \d+%$/);
    expect(screen.getByRole('button', { name: 'Save branding' })).toBeEnabled();
  });

  it('refuses invalid colours and does not enable saving', async () => {
    show();
    const hex = await screen.findByLabelText('Primary colour');
    fireEvent.change(hex, { target: { value: 'red; background:url(//evil)' } });
    expect(screen.getByText('Use a hex colour such as #1a73e8')).toBeInTheDocument();
    expect(hex).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'Save branding' })).toBeDisabled();
    expect(screen.getByRole('group', { name: 'Live preview' }).style.getPropertyValue('--primary')).toBe('');
    expect(state.put).not.toHaveBeenCalled();
  });

  it('saves only the changes (logo and colours) and reports success', async () => {
    show();
    fireEvent.change(await screen.findByLabelText('Primary colour'), { target: { value: '#1A73E8' } });
    fireEvent.change(screen.getByLabelText('Accent colour'), { target: { value: '#ff8800' } });
    fireEvent.click(screen.getByRole('button', { name: 'Pick logo' }));
    expect(screen.getByTestId('logo-value')).toHaveTextContent('/api/v1/media/club/new-logo.png');
    state.put.mockResolvedValueOnce({ logoUrl: '/api/v1/media/club/new-logo.png', primaryColor: '#1a73e8', secondaryColor: null, accentColor: '#ff8800' });
    fireEvent.click(screen.getByRole('button', { name: 'Save branding' }));
    await waitFor(() => expect(state.put).toHaveBeenCalledWith('/tenant/branding', { logoUrl: '/api/v1/media/club/new-logo.png', primaryColor: '#1a73e8', accentColor: '#ff8800' }));
  });

  it('shows the server error and keeps the draft when saving fails', async () => {
    show();
    fireEvent.change(await screen.findByLabelText('Primary colour'), { target: { value: '#112233' } });
    state.put.mockRejectedValueOnce(new Error('Not allowed'));
    fireEvent.click(screen.getByRole('button', { name: 'Save branding' }));
    expect(await screen.findByText('Not allowed')).toBeInTheDocument();
    expect(screen.getByLabelText('Primary colour')).toHaveValue('#112233');
  });

  it('clears a saved colour with null and can discard changes', async () => {
    state.get.mockResolvedValue({ ...empty, primaryColor: '#112233' });
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Clear primary colour' }));
    state.put.mockResolvedValueOnce(empty);
    fireEvent.click(screen.getByRole('button', { name: 'Save branding' }));
    await waitFor(() => expect(state.put).toHaveBeenCalledWith('/tenant/branding', { primaryColor: null }));

  });

  it('discard returns to the saved values', async () => {
    state.get.mockResolvedValue({ ...empty, primaryColor: '#112233' });
    show();
    const hex = await screen.findByLabelText('Primary colour');
    fireEvent.change(hex, { target: { value: '#445566' } });
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(screen.getByLabelText('Primary colour')).toHaveValue('#112233');
    expect(screen.getByRole('button', { name: 'Save branding' })).toBeDisabled();
  });
});
