import { createHash, createHmac } from 'node:crypto';

/**
 * AWS Signature Version 4 for S3-compatible object storage (MinIO / Ceph RGW / on-prem S3), header-based, path-style,
 * no query string. Deliberately small: the adapter only issues PUT / GET / HEAD / DELETE on server-generated keys.
 * Verified against botocore-generated vectors in apps/api/test/documents/storage-contract.spec.ts.
 */
export interface SigV4Input {
  method: 'PUT' | 'GET' | 'HEAD' | 'DELETE';
  url: URL;
  /** Extra headers to sign and send (e.g. content-type, x-amz-server-side-encryption). */
  headers?: Record<string, string>;
  payloadHash: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service?: string;
  now: Date;
}

export const sha256Hex = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
const hmac = (key: Buffer | string, data: string) => createHmac('sha256', key).update(data).digest();

/** RFC 3986 encoding of one path segment (S3 does not double-encode). */
function encodeSegment(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** Returns the headers to send (including host, x-amz-date, x-amz-content-sha256 and Authorization). */
export function signV4(i: SigV4Input): Record<string, string> {
  const service = i.service ?? 's3';
  const amzDate = i.now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); // YYYYMMDDTHHMMSSZ
  const date = amzDate.slice(0, 8);
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(i.headers ?? {})) headers[k.toLowerCase()] = String(v).trim().replace(/\s+/g, ' ');
  headers['host'] = i.url.host; // includes the port only when it is not the scheme's default, as S3 expects
  headers['x-amz-content-sha256'] = i.payloadHash;
  headers['x-amz-date'] = amzDate;
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => `${n}:${headers[n]}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalUri = i.url.pathname.split('/').map((seg) => encodeSegment(decodeURIComponent(seg))).join('/');
  const canonicalRequest = [i.method, canonicalUri, '', canonicalHeaders, signedHeaders, i.payloadHash].join('\n');
  const scope = `${date}/${i.region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${i.secretAccessKey}`, date), i.region), service), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  const out: Record<string, string> = { ...headers };
  delete out['host']; // fetch sets Host from the URL; it was signed above
  out['authorization'] = `AWS4-HMAC-SHA256 Credential=${i.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return out;
}
