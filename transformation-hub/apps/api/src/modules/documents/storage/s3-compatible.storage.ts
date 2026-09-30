import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { ruleViolation } from '@hub/domain';
import { assertStorageKey, ObjectStorage } from './object-storage';
import { sha256Hex, signV4 } from './sigv4';

export interface S3Settings {
  /** Base URL of the S3-compatible service, e.g. https://objects.internal:9000 (path-style addressing). */
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Server-side encryption requested per object; 'none' relies on the bucket's default encryption. */
  sse: 'none' | 'AES256' | 'aws:kms';
  kmsKeyId: string | null;
  timeoutMs: number;
}

type Fetch = typeof fetch;

/**
 * S3-compatible object storage (MinIO / Ceph RGW / on-prem S3) through the S3 REST API with SigV4 (ADR-0010).
 * - Private bucket, path-style URLs; objects are only ever streamed through the authorised API — no presigned or public
 *   links are produced.
 * - `not_configured` (fails closed on every call) unless endpoint, region, bucket and credentials are all set.
 * - Error messages carry the HTTP status and the S3 error code only — never credentials, signatures or response bodies.
 * Connecting to Mobily's object store is **Not configured** here: the adapter is exercised against an in-process
 * S3-compatible test server (apps/api/test/support/fake-s3.ts) and botocore-generated signature vectors.
 */
export class S3CompatibleStorage implements ObjectStorage {
  readonly driver = 's3' as const;
  readonly status: 'configured' | 'not_configured';

  constructor(
    private readonly settings: S3Settings | null,
    private readonly fetchImpl: Fetch = fetch,
    private readonly clock: () => Date = () => new Date(),
  ) {
    this.status = settings ? 'configured' : 'not_configured';
  }

  private cfg(): S3Settings {
    if (!this.settings) throw ruleViolation('storage.not_configured', 'S3-compatible object storage is not configured in this environment');
    return this.settings;
  }

  private url(key: string): URL {
    const s = this.cfg();
    const base = s.endpoint.endsWith('/') ? s.endpoint : `${s.endpoint}/`;
    return new URL(`${encodeURIComponent(s.bucket)}/${key}`, base);
  }

  private async send(method: 'PUT' | 'GET' | 'HEAD' | 'DELETE', key: string, body?: Buffer): Promise<Response> {
    assertStorageKey(key);
    const s = this.cfg();
    const url = this.url(key);
    const extra: Record<string, string> = {};
    if (method === 'PUT') {
      extra['content-type'] = 'application/octet-stream';
      if (s.sse !== 'none') extra['x-amz-server-side-encryption'] = s.sse;
      if (s.sse === 'aws:kms' && s.kmsKeyId) extra['x-amz-server-side-encryption-aws-kms-key-id'] = s.kmsKeyId;
    }
    const headers = signV4({ method, url, headers: extra, payloadHash: sha256Hex(body ?? ''), accessKeyId: s.accessKeyId, secretAccessKey: s.secretAccessKey, region: s.region, now: this.clock() });
    return this.fetchImpl(url, { method, headers, body: body ? new Uint8Array(body) : undefined, redirect: 'error', signal: AbortSignal.timeout(s.timeoutMs) });
  }

  private async fail(op: string, res: Response): Promise<never> {
    let code = '';
    try {
      code = /<Code>([A-Za-z0-9._-]{1,64})<\/Code>/.exec(await res.text())?.[1] ?? '';
    } catch {
      /* body unreadable — status is enough */
    }
    throw new Error(`storage.s3_error: ${op} failed with HTTP ${res.status}${code ? ` (${code})` : ''}`);
  }

  async put(key: string, data: Buffer): Promise<void> {
    const res = await this.send('PUT', key, data);
    if (!res.ok) await this.fail('put', res);
    await res.body?.cancel();
  }

  async get(key: string): Promise<Readable> {
    const res = await this.send('GET', key);
    if (res.status === 404) {
      await res.body?.cancel();
      throw Object.assign(new Error('storage object not found'), { code: 'ENOENT' });
    }
    if (!res.ok || !res.body) await this.fail('get', res);
    return Readable.fromWeb(res.body as unknown as WebReadableStream<Uint8Array>);
  }

  async delete(key: string): Promise<void> {
    const res = await this.send('DELETE', key);
    await res.body?.cancel();
    if (!res.ok && res.status !== 404) await this.fail('delete', res); // deleting a missing object is a no-op
  }

  async exists(key: string): Promise<boolean> {
    const res = await this.send('HEAD', key);
    await res.body?.cancel();
    if (res.status === 404) return false;
    if (!res.ok) await this.fail('exists', res);
    return true;
  }
}
