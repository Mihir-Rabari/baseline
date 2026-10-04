import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmployeeDocuments } from './employee-documents';
import { documentProblem, formatBytes } from '@/lib/document-api';

const EMP = '22222222-2222-4222-8222-222222222222';
const DOC = { id: '44444444-4444-4444-8444-444444444444', employeeId: EMP, docType: 'ID_PROOF', fileName: 'aadhaar.pdf', contentType: 'application/pdf', sizeBytes: 2048, uploadedAt: '2026-10-04T01:00:00.000Z' };
const state = vi.hoisted(() => ({ docs: [] as unknown[], refetch: vi.fn(), remove: vi.fn() }));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/hooks/use-ops', () => ({
  useOpsQuery: () => ({ data: state.docs, isPending: false, error: null, refetch: state.refetch }),
  useOpsMutation: () => ({ isPending: false, mutateAsync: state.remove }),
}));

const file = (name: string, type: string, size = 10) => new File([new Uint8Array(size)], name, { type });
const pick = (f: File) => fireEvent.change(screen.getByLabelText('Choose a document file'), { target: { files: [f] } });

describe('document helpers', () => {
  it('refuses wrong types, empty and oversized files before sending', () => {
    expect(documentProblem(file('a.pdf', 'application/pdf'))).toBeNull();
    expect(documentProblem(file('a.png', 'image/png'))).toBeNull();
    expect(documentProblem(file('a.exe', 'application/octet-stream'))).toMatch(/PDF, JPEG, PNG or WebP/);
    expect(documentProblem(file('a.svg', 'image/svg+xml'))).toMatch(/PDF, JPEG, PNG or WebP/);
    expect(documentProblem(file('a.pdf', 'application/pdf', 0))).toMatch(/empty/);
    expect(documentProblem(file('a.pdf', 'application/pdf', 10 * 1024 * 1024 + 1))).toMatch(/10 MB/);
  });

  it('formats sizes for people', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
  });
});

describe('employee documents section', () => {
  beforeEach(() => {
    state.docs = [DOC];
    state.refetch.mockReset().mockResolvedValue({});
    state.remove.mockReset().mockResolvedValue({});
  });
  afterEach(() => vi.unstubAllGlobals());

  it('lists documents with type, size and a download link', () => {
    render(<EmployeeDocuments employeeId={EMP} />);
    expect(screen.getByRole('heading', { name: 'Documents' })).toBeInTheDocument();
    expect(screen.getByText('aadhaar.pdf')).toBeInTheDocument();
    const row = within(screen.getByRole('row', { name: /aadhaar.pdf/ }));
    expect(row.getByText('ID proof')).toBeInTheDocument();
    expect(row.getByText('2 KB')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Download aadhaar.pdf' }).getAttribute('href')).toMatch(new RegExp(`/api/v1/hr/employees/${EMP}/documents/${DOC.id}/download$`));
  });

  it('says so when there are no documents', () => {
    state.docs = [];
    render(<EmployeeDocuments employeeId={EMP} />);
    expect(screen.getByText('No documents yet')).toBeInTheDocument();
  });

  it('uploads the chosen file as raw bytes with its type and name, then refreshes the list', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => DOC });
    vi.stubGlobal('fetch', fetchMock);
    render(<EmployeeDocuments employeeId={EMP} />);
    pick(file('contract final.pdf', 'application/pdf'));
    await waitFor(() => expect(state.refetch).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(new RegExp(`/api/v1/hr/employees/${EMP}/documents\\?docType=ID_PROOF&fileName=contract\\+final\\.pdf$`));
    expect(init).toMatchObject({ method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/pdf' } });
  });

  it('shows the problem and never calls the server for a bad file', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<EmployeeDocuments employeeId={EMP} />);
    pick(file('virus.exe', 'application/octet-stream'));
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a PDF, JPEG, PNG or WebP file.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows the server message when the upload is refused', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ message: 'You do not have permission', code: 'FORBIDDEN' }) }));
    render(<EmployeeDocuments employeeId={EMP} />);
    pick(file('a.pdf', 'application/pdf'));
    expect(await screen.findByRole('alert')).toHaveTextContent('You do not have permission');
    expect(state.refetch).not.toHaveBeenCalled();
  });

  it('asks before deleting and deletes the chosen document', async () => {
    render(<EmployeeDocuments employeeId={EMP} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete aadhaar.pdf' }));
    expect(screen.getByText('Delete this document?')).toBeInTheDocument();
    expect(state.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(state.remove).toHaveBeenCalledWith({ id: DOC.id }));
  });
});
