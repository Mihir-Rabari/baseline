import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProfileAvatar } from './profile-avatar';
import { encodeProfileAvatar } from '@/lib/profile-avatar';

const state = vi.hoisted(() => ({
  canUpdate: true, src: undefined as string | undefined, isLoading: false, isError: false,
  upload: vi.fn(), remove: vi.fn(), refetch: vi.fn(),
}));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: { id: 'user-a', name: 'Khushi Trivedi', email: 'khushi@example.test' }, hasPermission: (action: string) => action === 'profile:update:self' ? state.canUpdate : true }) }));
vi.mock('@/hooks/use-profile-avatar', () => ({ useProfileAvatar: () => ({ src: state.src, isLoading: state.isLoading, isError: state.isError, isFetching: false, refetch: state.refetch, upload: { mutateAsync: state.upload, isPending: false }, remove: { mutateAsync: state.remove, isPending: false } }) }));
vi.mock('@/lib/profile-avatar', () => ({ encodeProfileAvatar: vi.fn() }));
beforeEach(() => {
  vi.clearAllMocks(); state.canUpdate = true; state.src = undefined; state.isLoading = false; state.isError = false;
  vi.mocked(encodeProfileAvatar).mockResolvedValue('PNG'); state.upload.mockResolvedValue({ version: 'new' }); state.remove.mockResolvedValue({ success: true });
});
describe('ProfileAvatar', () => {
  it('shows initials and hides edit controls without update permission', () => {
    state.canUpdate = false;
    render(<ProfileAvatar />);
    expect(screen.getByText('KT')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Upload photo' })).not.toBeInTheDocument();
  });
  it('shows a shaped loading state and a retry action on read failure', () => {
    state.isLoading = true;
    const { rerender } = render(<ProfileAvatar />);
    expect(screen.getByLabelText('Loading profile photo')).toBeInTheDocument();
    state.isLoading = false; state.isError = true;
    rerender(<ProfileAvatar />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry photo' }));
    expect(state.refetch).toHaveBeenCalledOnce();
  });
  it('normalizes a selected file, saves it and announces the result', async () => {
    render(<ProfileAvatar />);
    const file = new File(['jpeg'], 'photo.jpg', { type: 'image/jpeg' });
    fireEvent.change(screen.getByLabelText('Choose profile photo'), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Photo updated.'));
    expect(encodeProfileAvatar).toHaveBeenCalledWith(file);
    expect(state.upload).toHaveBeenCalledWith('PNG');
  });
  it('announces invalid input and does not send it to the API', async () => {
    vi.mocked(encodeProfileAvatar).mockRejectedValue(new Error('Choose a PNG, JPEG or WebP photo.'));
    render(<ProfileAvatar />);
    fireEvent.change(screen.getByLabelText('Choose profile photo'), { target: { files: [new File(['svg'], 'photo.svg')] } });
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose a PNG, JPEG or WebP photo.');
    expect(state.upload).not.toHaveBeenCalled();
  });
  it('removes an existing photo and reports storage failures', async () => {
    state.src = '/avatar/user-a?v=old'; state.remove.mockRejectedValueOnce(new Error('Photo storage unavailable'));
    render(<ProfileAvatar />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove photo' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Photo storage unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Remove photo' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Photo removed.'));
  });
});
