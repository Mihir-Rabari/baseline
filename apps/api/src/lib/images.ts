export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const IMAGE_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ImageContentType = (typeof IMAGE_CONTENT_TYPES)[number];

export interface DetectedImage {
  contentType: ImageContentType;
  ext: 'jpg' | 'png' | 'webp';
}

/**
 * Identifies an image from its first bytes. The declared Content-Type is never trusted: a file named
 * or labelled as an image but starting with anything else (HTML, SVG, scripts, GIF) is refused.
 */
export function detectImage(bytes: Buffer): DetectedImage | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { contentType: 'image/jpeg', ext: 'jpg' };
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { contentType: 'image/png', ext: 'png' };
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP') return { contentType: 'image/webp', ext: 'webp' };
  return null;
}

export const EXT_CONTENT_TYPE: Record<DetectedImage['ext'], ImageContentType> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};
