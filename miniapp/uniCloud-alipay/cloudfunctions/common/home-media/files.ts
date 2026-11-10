import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import type { MediaMime } from 'home-contracts';
import { AppError } from 'home-kernel';

export const MAX_MEDIA_BYTES = 1_048_576;
export const digest = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
function png(bytes: Buffer) {
  if (bytes.length < 57 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return false;
  let offset = 8; let header = false; let end = false; let width = 0; let height = 0; let depth = 0; let color = 0; let interlaced = false; let palette = false;
  const data: Buffer[] = [];
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset); if (length > bytes.length - offset - 12) return false;
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    let crc = 0xffffffff;
    for (const byte of bytes.subarray(offset + 4, offset + 8 + length)) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    if (((crc ^ 0xffffffff) >>> 0) !== bytes.readUInt32BE(offset + 8 + length)) return false;
    if (!header) {
      if (type !== 'IHDR' || length !== 13) return false;
      width = bytes.readUInt32BE(offset + 8); height = bytes.readUInt32BE(offset + 12); depth = bytes[offset + 16]; color = bytes[offset + 17]; interlaced = bytes[offset + 20] === 1;
      if (!width || !height || width * height > 16_777_216 || ![1, 2, 4, 8, 16].includes(bytes[offset + 16])
        || ![0, 2, 3, 4, 6].includes(bytes[offset + 17]) || bytes[offset + 18] !== 0 || bytes[offset + 19] !== 0 || bytes[offset + 20] > 1) return false;
      if (color === 3 && depth === 16 || [2, 4, 6].includes(color) && depth < 8) return false;
      header = true;
    } else if (type === 'IHDR') return false;
    if (type === 'PLTE') { if (palette || data.length || !length || length % 3 || length > 768) return false; palette = true; }
    if (type !== 'IHDR' && type !== 'PLTE' && type !== 'IDAT' && type !== 'IEND' && /^[A-Z]/.test(type)) return false;
    if (type === 'IDAT') data.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
    if (type === 'IEND') { end = length === 0 && offset === bytes.length; break; }
  }
  if (!end || !data.length || color === 3 && !palette) return false;
  const channels = color === 0 || color === 3 ? 1 : color === 2 ? 3 : color === 4 ? 2 : 4;
  const passes = interlaced ? [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]] : [[0, 0, 1, 1]];
  const scanlines = passes.map(([x, y, dx, dy]) => {
    const columns = Math.max(0, Math.ceil((width - x) / dx)); const rows = Math.max(0, Math.ceil((height - y) / dy));
    return { rows: columns ? rows : 0, stride: 1 + Math.ceil(columns * channels * depth / 8) };
  });
  const expected = scanlines.reduce((sum, pass) => sum + pass.rows * pass.stride, 0);
  if (expected > 134_217_728) return false;
  try {
    const decoded = inflateSync(Buffer.concat(data), { maxOutputLength: expected });
    if (decoded.length !== expected) return false;
    let position = 0;
    for (const pass of scanlines) for (let row = 0; row < pass.rows; row++) { if (decoded[position] > 4) return false; position += pass.stride; }
    return true;
  } catch { return false; }
}
function jpeg(bytes: Buffer) {
  if (bytes.length < 16 || bytes.readUInt16BE(0) !== 0xffd8 || bytes.readUInt16BE(bytes.length - 2) !== 0xffd9) return false;
  let offset = 2; let frame = false; let scan = false;
  while (offset < bytes.length - 2) {
    if (bytes[offset++] !== 0xff) return false;
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0 || marker === 0xd8 || offset + 2 > bytes.length) return false;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length - 2) return false;
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (length < 8 || bytes[offset + 2] !== 8 || !bytes.readUInt16BE(offset + 3) || !bytes.readUInt16BE(offset + 5)
        || bytes.readUInt16BE(offset + 3) * bytes.readUInt16BE(offset + 5) > 16_777_216) return false;
      frame = true;
    }
    offset += length;
    if (marker === 0xda) {
      if (!frame) return false; scan = true;
      while (offset < bytes.length - 2) {
        if (bytes[offset] !== 0xff) { offset++; continue; }
        if (bytes[offset + 1] === 0 || bytes[offset + 1] >= 0xd0 && bytes[offset + 1] <= 0xd7) { offset += 2; continue; }
        break;
      }
    }
  }
  return frame && scan && offset === bytes.length - 2;
}
export function validateFile(bytes: Buffer, mime: MediaMime, size: number): string {
  if (!Buffer.isBuffer(bytes) || bytes.length !== size || size < 1 || size > MAX_MEDIA_BYTES || !(mime === 'image/png' ? png(bytes) : jpeg(bytes))) throw new AppError('INVALID_INPUT');
  return digest(bytes);
}
export function decodeFile(base64: unknown, mime: MediaMime, size: number): { bytes: Buffer; sha256: string } {
  if (typeof base64 !== 'string' || base64.length > Math.ceil(MAX_MEDIA_BYTES / 3) * 4 || base64.length !== Math.ceil(size / 3) * 4
    || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) throw new AppError('INVALID_INPUT');
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.toString('base64') !== base64) throw new AppError('INVALID_INPUT');
  return { bytes, sha256: validateFile(bytes, mime, size) };
}
