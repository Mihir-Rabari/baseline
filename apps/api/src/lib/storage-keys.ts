import { DEFAULT_TENANT_ID } from '@packages/db';

/**
 * Object-storage keys are namespaced per club: `tenants/<tenantId>/...`. The tenant always comes from the
 * request (never from the URL or the body), so club A cannot name, read, overwrite or delete a club B
 * object however the request is crafted: the prefix is not something a caller can influence.
 */
export const tenantPrefix = (tenantId: string): string => `tenants/${tenantId}/`;

/** An uploaded image (product, menu, court, club, employee photos). */
export const uploadKey = (tenantId: string, kind: string, file: string): string => `${tenantPrefix(tenantId)}${kind}/${file}`;

/** A member's or staff member's private profile photo. */
export const avatarKey = (tenantId: string, userId: string): string => `${tenantPrefix(tenantId)}profiles/${userId}/avatar.png`;

/**
 * Objects written before clubs had their own prefix live at the bucket root and belong to the default
 * club. Only the default club may ever read that legacy location; every other club gets `undefined`.
 */
export const legacyKey = (tenantId: string, key: string): string | undefined => (tenantId === DEFAULT_TENANT_ID ? key : undefined);
