import { detectImage } from './images.js';

export type DocumentContentType = 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp';

const EXTENSION: Record<DocumentContentType, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * Identifies a document from its first bytes (PDF, or one of the accepted image formats). The declared
 * Content-Type is never trusted: HTML, SVG, scripts and executables are refused whatever they claim to be.
 */
export function detectDocument(bytes: Buffer): { contentType: DocumentContentType; ext: string } | null {
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString('latin1') === '%PDF-') return { contentType: 'application/pdf', ext: EXTENSION['application/pdf'] };
  const image = detectImage(bytes);
  return image ? { contentType: image.contentType, ext: image.ext } : null;
}

/** A display name that is safe to store and to put in a download header: no paths, control characters or quotes. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const cleaned = base
    .replace(/[^\p{L}\p{N}._ ()-]/gu, '_')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .trim();
  return (cleaned || 'document').slice(0, 120);
}
