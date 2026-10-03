import { inflateSync } from 'node:zlib';
import { PROFILE_AVATAR_MAX_BYTES } from '@packages/validation';

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Accept the bounded, static RGB/RGBA PNG produced by the browser canvas.
 * Validate PNG chunks, CRCs and inflated scanlines; discard ancillary metadata.
 * Format reference: https://www.w3.org/TR/png-3/
 */
export function normalizeAvatarPng(image: Buffer): Buffer | null {
  try {
    if (image.length > PROFILE_AVATAR_MAX_BYTES || !image.subarray(0, 8).equals(signature)) return null;
    const kept: Buffer[] = [signature];
    const compressed: Buffer[] = [];
    let offset = 8;
    let rowBytes = 0;
    let height = 0;
    let endedData = false;
    let ended = false;
    while (offset + 12 <= image.length) {
      const length = image.readUInt32BE(offset);
      const end = offset + 12 + length;
      if (end > image.length) return null;
      const type = image.toString('ascii', offset + 4, offset + 8);
      const typeBytes = image.subarray(offset + 4, offset + 8);
      if (!typeBytes.every((byte) => (byte >= 65 && byte <= 90) || (byte >= 97 && byte <= 122)) || typeBytes[2] > 90 || crc32(image.subarray(offset + 4, end - 4)) !== image.readUInt32BE(end - 4)) return null;
      const data = image.subarray(offset + 8, end - 4);
      if (offset === 8 && type !== 'IHDR') return null;
      if (type === 'IHDR') {
        if (offset !== 8 || length !== 13) return null;
        const width = data.readUInt32BE(0);
        height = data.readUInt32BE(4);
        const channels = data[9] === 2 ? 3 : data[9] === 6 ? 4 : 0;
        if (!width || !height || width > 512 || height > 512 || !channels || data[8] !== 8 || data[10] !== 0 || data[11] !== 0 || data[12] !== 0) return null;
        rowBytes = 1 + width * channels;
        kept.push(image.subarray(offset, end));
      } else if (type === 'IDAT') {
        if (endedData) return null;
        compressed.push(data);
        kept.push(image.subarray(offset, end));
      } else if (type === 'IEND') {
        if (length !== 0 || !compressed.length || end !== image.length) return null;
        kept.push(image.subarray(offset, end));
        ended = true;
      } else {
        if (compressed.length) endedData = true;
        // Unknown critical chunks and animations are outside the upload contract.
        if (type[0] === type[0].toUpperCase() || ['acTL', 'fcTL', 'fdAT'].includes(type)) return null;
      }
      offset = end;
    }
    if (!ended || offset !== image.length) return null;
    const compressedBytes = Buffer.concat(compressed);
    const inflated = inflateSync(compressedBytes, { maxOutputLength: rowBytes * height, info: true }) as unknown as { buffer: Buffer; engine: { bytesWritten: number } };
    if (inflated.engine.bytesWritten !== compressedBytes.length) return null;
    const rows = inflated.buffer;
    if (rows.length !== rowBytes * height) return null;
    for (let row = 0; row < height; row++) if (rows[row * rowBytes] > 4) return null;
    return Buffer.concat(kept);
  } catch {
    return null;
  }
}
