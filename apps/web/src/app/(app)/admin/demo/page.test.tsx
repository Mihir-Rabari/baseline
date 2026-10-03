import React from 'react';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import DemoPage from './page';
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: { id: 'member' }, hasPermission: () => false }) }));
describe('Demo access', () => {
  it('denies the race UI without administrative permission', () => { render(<QueryClientProvider client={new QueryClient()}><DemoPage /></QueryClientProvider>); expect(screen.getByText('Demo unavailable')).toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Run race' })).not.toBeInTheDocument(); });
});
