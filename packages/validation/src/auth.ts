import { z } from 'zod';
import { EmailSchema, NonEmptyStringSchema } from './common.js';

export const UserStatusEnum = z.enum(['ACTIVE', 'SUSPENDED', 'DISABLED']);
export type UserStatus = z.infer<typeof UserStatusEnum>;

export const IdentityTypeEnum = z.enum(['ROOT', 'EXTERNAL_USER']);
export type IdentityType = z.infer<typeof IdentityTypeEnum>;

/**
 * Builds the signup body schema for a given minimum password length.
 *
 * The length is a factory parameter rather than a literal so `AuthConfig.minPasswordLength`
 * is actually enforced instead of being a knob that silently does nothing.
 *
 * `.strict()` rejects unknown keys outright. Previous versions accepted (and then ignored)
 * a `role` field; rejecting it is clearer than silently discarding it, and it means a
 * client attempting to set `identityType` gets a 400 rather than a false sense that the
 * field was honoured.
 */
export function createSignupRequestSchema(minPasswordLength = 8) {
  return z
    .object({
      email: EmailSchema,
      password: z
        .string()
        .min(minPasswordLength, `Password must be at least ${minPasswordLength} characters long`),
      name: NonEmptyStringSchema,
    })
    .strict();
}

export const SignupRequestSchema = createSignupRequestSchema();
export type SignupRequest = z.infer<typeof SignupRequestSchema>;

export const LoginRequestSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1, 'Password is required'),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const AuthUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  status: UserStatusEnum,
  identityType: IdentityTypeEnum,
  lastLoginAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type AuthUser = z.infer<typeof AuthUserSchema>;

export const AuthSessionInfoSchema = z.object({
  id: z.string().uuid(),
  expiresAt: z.string().datetime(),
  createdAt: z.string().datetime(),
});
export type AuthSessionInfo = z.infer<typeof AuthSessionInfoSchema>;

export const SessionResponseSchema = z.object({
  user: AuthUserSchema,
  session: AuthSessionInfoSchema,
  effectivePermissions: z.array(z.string()),
});
export type SessionResponse = z.infer<typeof SessionResponseSchema>;

export const UpdateProfileSchema = z.object({
  name: z.string().trim().min(1).optional(),
  email: EmailSchema.optional(),
});
export type UpdateProfile = z.infer<typeof UpdateProfileSchema>;

export function createChangePasswordSchema(minPasswordLength = 8) {
  return z.object({
    currentPassword: z.string().min(1),
    newPassword: z
      .string()
      .min(minPasswordLength, `New password must be at least ${minPasswordLength} characters`),
  });
}

export const ChangePasswordSchema = createChangePasswordSchema();
export type ChangePassword = z.infer<typeof ChangePasswordSchema>;
