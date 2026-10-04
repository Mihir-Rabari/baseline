import { EMPLOYEE_DOCUMENT_CONTENT_TYPES, MAX_EMPLOYEE_DOCUMENT_BYTES, type EmployeeDocument, type EmployeeDocumentType } from '@packages/validation';
import { API_BASE_URL, ApiError } from '@/lib/api-client';

export const DOCUMENT_TYPE_LABELS: Record<EmployeeDocumentType, string> = {
  ID_PROOF: 'ID proof',
  ADDRESS_PROOF: 'Address proof',
  CONTRACT: 'Contract',
  CERTIFICATE: 'Certificate',
  OTHER: 'Other',
};
export const DOCUMENT_ACCEPT = EMPLOYEE_DOCUMENT_CONTENT_TYPES.join(',');

/** A readable reason when the file can be refused before it is sent, or null when it looks fine. */
export function documentProblem(file: Pick<File, 'type' | 'size'>): string | null {
  if (!(EMPLOYEE_DOCUMENT_CONTENT_TYPES as readonly string[]).includes(file.type)) return 'Choose a PDF, JPEG, PNG or WebP file.';
  if (file.size === 0) return 'That file is empty.';
  if (file.size > MAX_EMPLOYEE_DOCUMENT_BYTES) return 'Documents can be at most 10 MB.';
  return null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const documentDownloadUrl = (employeeId: string, documentId: string) =>
  `${API_BASE_URL}/api/v1/hr/employees/${encodeURIComponent(employeeId)}/documents/${encodeURIComponent(documentId)}/download`;

/** Uploads one document as the raw request body. The server decides the real type from the bytes. */
export async function uploadEmployeeDocument(employeeId: string, docType: EmployeeDocumentType, file: File): Promise<EmployeeDocument> {
  const problem = documentProblem(file);
  if (problem) throw new ApiError(problem, 400, 'INVALID_DOCUMENT');
  const query = new URLSearchParams({ docType, fileName: file.name });
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/v1/hr/employees/${encodeURIComponent(employeeId)}/documents?${query}`, {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': file.type }, body: file,
    });
  } catch {
    throw new ApiError('Could not reach the server. Check your connection and try again.', 503, 'NETWORK_ERROR');
  }
  const data = (await response.json().catch(() => null)) as (EmployeeDocument & { message?: string; code?: string }) | null;
  if (!response.ok) throw new ApiError(data?.message ?? `Upload failed with status ${response.status}`, response.status, data?.code ?? 'UPLOAD_FAILED');
  return data as EmployeeDocument;
}
