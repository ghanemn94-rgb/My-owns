import { v7 as uuidv7 } from 'uuid';
import { createHash, randomBytes } from 'node:crypto';

/** Time-ordered UUID v7 for primary keys. */
export const newId = (): string => uuidv7();

export const sha256Hex = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');

export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');

/** Stable JSON (sorted keys) for hashing payloads bound to approvals. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(',')}}`;
}

export const payloadHash = (payload: unknown): string => sha256Hex(stableStringify(payload));
