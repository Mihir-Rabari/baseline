import { z } from 'zod';

export const PROFILE_AVATAR_MAX_BYTES = 256 * 1024;
export const ProfileAvatarUploadSchema = z.object({
  imageBase64: z.string().min(1).max(Math.ceil(PROFILE_AVATAR_MAX_BYTES / 3) * 4)
    .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
}).strict();
export const ProfileAvatarResponseSchema = z.object({ version: z.string().regex(/^[a-f0-9]{64}$/).nullable() });
