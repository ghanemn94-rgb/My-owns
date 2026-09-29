import { inflateRawSync } from 'node:zlib';

/**
 * Minimal, bounded ZIP reader used only for (a) listing Office Open XML package entries for type detection and
 * (b) reading `word/document.xml` for DOCX text extraction. Defensive limits (C-16 zip-bomb class): entry count,
 * per-entry uncompressed size, compression ratio; no ZIP64, no encryption, no multi-disk; nothing is written to disk.
 */
export const ZIP_LIMITS = { maxEntries: 5000, maxEntryBytes: 20 * 1024 * 1024, maxRatio: 200 };

interface CdEntry {
  name: string;
  method: number;
  flags: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

function findEocd(buf: Buffer): number {
  const min = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= min; i--) if (buf.readUInt32LE(i) === 0x06054b50) return i;
  return -1;
}

function centralDirectory(buf: Buffer): CdEntry[] | null {
  if (buf.length < 22) return null;
  const eocd = findEocd(buf);
  if (eocd < 0) return null;
  const count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff || count > ZIP_LIMITS.maxEntries) return null;
  if (cdOffset + cdSize > buf.length) return null;
  const out: CdEntry[] = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) return null;
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const uncompressedSize = buf.readUInt32LE(p + 24);
    const n = buf.readUInt16LE(p + 28);
    const e = buf.readUInt16LE(p + 30);
    const c = buf.readUInt16LE(p + 32);
    const localHeaderOffset = buf.readUInt32LE(p + 42);
    if (p + 46 + n > buf.length) return null;
    const name = buf.subarray(p + 46, p + 46 + n).toString('utf8');
    out.push({ name, method, flags, compressedSize, uncompressedSize, localHeaderOffset });
    p += 46 + n + e + c;
  }
  return out;
}

/** Entry names of a ZIP container, or null when it is not a well-formed (non-ZIP64) archive. */
export function listZipEntries(buf: Buffer): string[] | null {
  const cd = centralDirectory(buf);
  return cd ? cd.map((e) => e.name) : null;
}

/** Read one entry (stored or deflated) within the limits; throws on anything unusual. */
export function readZipEntry(buf: Buffer, name: string): Buffer {
  const cd = centralDirectory(buf);
  const e = cd?.find((x) => x.name === name);
  if (!e) throw new Error(`zip entry ${name} not found`);
  if (e.flags & 0x1) throw new Error('encrypted zip entries are not supported');
  if (e.uncompressedSize > ZIP_LIMITS.maxEntryBytes) throw new Error('zip entry exceeds the extraction size limit');
  if (e.compressedSize > 0 && e.uncompressedSize / e.compressedSize > ZIP_LIMITS.maxRatio) throw new Error('zip entry compression ratio exceeds the limit');
  const lh = e.localHeaderOffset;
  if (lh + 30 > buf.length || buf.readUInt32LE(lh) !== 0x04034b50) throw new Error('bad local header');
  const start = lh + 30 + buf.readUInt16LE(lh + 26) + buf.readUInt16LE(lh + 28);
  const data = buf.subarray(start, start + e.compressedSize);
  if (data.length !== e.compressedSize) throw new Error('truncated zip entry');
  if (e.method === 0) return Buffer.from(data);
  if (e.method === 8) return inflateRawSync(data, { maxOutputLength: ZIP_LIMITS.maxEntryBytes });
  throw new Error(`unsupported zip compression method ${e.method}`);
}
