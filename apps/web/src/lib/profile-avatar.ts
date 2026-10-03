import { API_BASE_URL, fetchApi } from '@/lib/api-client';
import { ProfileAvatarResponseSchema, ProfileAvatarUploadSchema } from '@packages/validation';
import { z } from 'zod';

export interface ProfileAvatarMetadata { version: string | null }

export const profileAvatarApi = {
  get: async () => ProfileAvatarResponseSchema.parse(await fetchApi('/api/v1/profile/avatar')),
  upload: async (imageBase64: string) => ProfileAvatarResponseSchema.extend({ version: z.string().regex(/^[a-f0-9]{64}$/) }).parse(await fetchApi('/api/v1/profile/avatar', {
    method: 'PUT', body: JSON.stringify(ProfileAvatarUploadSchema.parse({ imageBase64 })),
  })),
  remove: async () => z.object({ success: z.literal(true) }).parse(await fetchApi('/api/v1/profile/avatar', { method: 'DELETE' })),
};

export function profileAvatarUrl(userId: string, version: string): string {
  return `${API_BASE_URL}/api/v1/profile/avatar/${encodeURIComponent(userId)}?v=${encodeURIComponent(version)}`;
}

/** Decode locally, crop to a square and discard the original file's metadata. */
export async function encodeProfileAvatar(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    throw new Error('Choose a PNG, JPEG or WebP photo.');
  }
  if (file.size === 0 || file.size > 5 * 1024 * 1024) {
    throw new Error('Choose a photo smaller than 5 MB.');
  }
  const source = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('This photo could not be opened. Choose another file.'));
      image.src = source;
    });
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('This photo has no usable image content.');
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Your browser could not prepare the photo. Try another browser.');
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, 256, 256);
    const data = canvas.toDataURL('image/png');
    if (!data.startsWith('data:image/png;base64,')) throw new Error('Your browser could not prepare the photo.');
    const base64 = data.slice('data:image/png;base64,'.length);
    const bytes = Math.floor(base64.length * 3 / 4) - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);
    if (!base64 || bytes > 256 * 1024) throw new Error('The prepared photo is too large. Choose a simpler photo.');
    return base64;
  } finally {
    URL.revokeObjectURL(source);
  }
}
