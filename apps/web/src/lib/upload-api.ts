import type { ImageUploadResponse, UploadKind } from '@packages/validation';
import { API_BASE_URL, ApiError } from '@/lib/api-client';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** A readable reason when the file can be refused before it is sent, or null when it looks fine. */
export function imageProblem(file: Pick<File, 'type' | 'size' | 'name'>): string | null {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) return 'Choose a JPEG, PNG or WebP image.';
  if (file.size === 0) return 'That file is empty.';
  if (file.size > MAX_IMAGE_BYTES) return 'Images can be at most 5 MB.';
  return null;
}

/** Stored image references are relative to the API; browsers need the full address. */
export function mediaUrl(ref: string | null | undefined): string | null {
  if (!ref) return null;
  return ref.startsWith('/') ? `${API_BASE_URL}${ref}` : ref;
}

/** Uploads one image as the raw request body. The server decides the real type from the bytes. */
export async function uploadImage(kind: UploadKind, file: File): Promise<ImageUploadResponse> {
  const problem = imageProblem(file);
  if (problem) throw new ApiError(problem, 400, 'INVALID_IMAGE');
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/v1/uploads/${kind}`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': file.type }, body: file });
  } catch {
    throw new ApiError('Could not reach the server. Check your connection and try again.', 503, 'NETWORK_ERROR');
  }
  const data = (await response.json().catch(() => null)) as (ImageUploadResponse & { message?: string; code?: string }) | null;
  if (!response.ok) throw new ApiError(data?.message ?? `Upload failed with status ${response.status}`, response.status, data?.code ?? 'UPLOAD_FAILED');
  return data as ImageUploadResponse;
}
