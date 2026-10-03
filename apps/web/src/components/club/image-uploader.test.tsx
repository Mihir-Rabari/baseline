import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImageUploader } from './image-uploader';
import { imageProblem, mediaUrl } from '@/lib/upload-api';

const file = (name: string, type: string, size = 10) => new File([new Uint8Array(size)], name, { type });
const pick = (input: HTMLElement, f: File) => fireEvent.change(input, { target: { files: [f] } });

afterEach(() => vi.unstubAllGlobals());

describe('upload helpers', () => {
  it('refuses wrong types, empty and oversized files before sending', () => {
    expect(imageProblem(file('a.png', 'image/png'))).toBeNull();
    expect(imageProblem(file('a.svg', 'image/svg+xml'))).toMatch(/JPEG, PNG or WebP/);
    expect(imageProblem(file('a.gif', 'image/gif'))).toMatch(/JPEG, PNG or WebP/);
    expect(imageProblem(file('a.png', 'image/png', 0))).toMatch(/empty/);
    expect(imageProblem(file('a.png', 'image/png', 5 * 1024 * 1024 + 1))).toMatch(/5 MB/);
  });

  it('turns stored references into loadable addresses', () => {
    expect(mediaUrl(null)).toBeNull();
    expect(mediaUrl('https://cdn.example.com/a.png')).toBe('https://cdn.example.com/a.png');
    expect(mediaUrl('/api/v1/media/product/x.png')).toMatch(/\/api\/v1\/media\/product\/x\.png$/);
  });
});

describe('image uploader', () => {
  it('uploads the chosen image as raw bytes and reports the stored reference', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ url: '/api/v1/media/product/new.png', key: 'product/new.png', contentType: 'image/png', size: 10 }) });
    vi.stubGlobal('fetch', fetchMock);
    const onChange = vi.fn();
    render(<ImageUploader kind="product" value={null} onChange={onChange} />);
    pick(screen.getByLabelText('Photo'), file('a.png', 'image/png'));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('/api/v1/media/product/new.png'));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/v1\/uploads\/product$/);
    expect(init).toMatchObject({ method: 'POST', credentials: 'include', headers: { 'Content-Type': 'image/png' } });
  });

  it('shows the problem and never calls the server for a bad file', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const onChange = vi.fn();
    render(<ImageUploader kind="product" value={null} onChange={onChange} />);
    pick(screen.getByLabelText('Photo'), file('a.svg', 'image/svg+xml'));
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a JPEG, PNG or WebP image.');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows the server message when the upload is refused', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ message: 'You do not have permission to upload this kind of image', code: 'FORBIDDEN' }) }));
    render(<ImageUploader kind="product" value={null} onChange={vi.fn()} />);
    pick(screen.getByLabelText('Photo'), file('a.png', 'image/png'));
    expect(await screen.findByRole('alert')).toHaveTextContent('do not have permission');
  });

  it('previews the current image and removes it on request', () => {
    const onChange = vi.fn();
    render(<ImageUploader kind="menu" label="Item photo" value="https://cdn.example.com/a.png" onChange={onChange} />);
    expect(screen.getByAltText('Item photo preview')).toHaveAttribute('src', 'https://cdn.example.com/a.png');
    fireEvent.click(screen.getByRole('button', { name: /Remove/ }));
    expect(onChange).toHaveBeenCalledWith(null);
    expect(screen.getByRole('button', { name: 'Replace image' })).toBeInTheDocument();
  });
});
