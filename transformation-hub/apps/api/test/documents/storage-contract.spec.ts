import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LocalFsStorage } from '../../src/modules/documents/storage/local-fs.storage';
import { S3CompatibleStorage, S3Settings } from '../../src/modules/documents/storage/s3-compatible.storage';
import { ObjectStorage, storageKey } from '../../src/modules/documents/storage/object-storage';
import { sha256Hex, signV4 } from '../../src/modules/documents/storage/sigv4';
import { loadConfig } from '../../src/platform/config';
import { FakeS3 } from '../support/fake-s3';

/**
 * REQ-ARC-005 — "local filesystem and S3 adapters pass the same contract tests". The S3 adapter runs against an
 * in-process S3-compatible server that re-verifies every SigV4 signature; the signer itself is checked against vectors
 * generated independently with botocore 1.43.105 (S3SigV4Auth). Mobily's object store is NOT connected (Not configured).
 */
const ACCESS = 'AKIAIOSFODNN7EXAMPLE';
const SECRET = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
const BUCKET = 'hub-documents-test';

async function readAll(s: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of s) chunks.push(Buffer.from(c as Buffer));
  return Buffer.concat(chunks);
}
const newKey = (area: 'documents' | 'quarantine' = 'documents') => storageKey(area, randomUUID(), randomUUID());

let dir: string;
let s3: FakeS3;
const settings = (): S3Settings => ({ endpoint: s3.endpoint, region: 'us-east-1', bucket: BUCKET, accessKeyId: ACCESS, secretAccessKey: SECRET, sse: 'AES256', kmsKeyId: null, timeoutMs: 5000 });

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'hub-storage-contract-'));
  s3 = new FakeS3(BUCKET, ACCESS, SECRET);
  await s3.start();
});
afterAll(async () => {
  await s3.stop();
  await rm(dir, { recursive: true, force: true });
});

const adapters: [string, () => ObjectStorage][] = [
  ['local filesystem', () => new LocalFsStorage(dir)],
  ['S3-compatible', () => new S3CompatibleStorage(settings())],
];

describe.each(adapters)('object storage contract [REQ-ARC-005] — %s adapter', (_name, make) => {
  it('reports itself as configured', () => {
    expect(make().status).toBe('configured');
  });

  it('round-trips binary content exactly (NUL bytes, > 64 KiB)', async () => {
    const st = make();
    const key = newKey();
    const data = Buffer.concat([Buffer.from([0, 1, 2, 255, 0]), Buffer.alloc(200_000, 0xab), Buffer.from('مستند', 'utf8')]);
    await st.put(key, data);
    expect(await st.exists(key)).toBe(true);
    const back = await readAll(await st.get(key));
    expect(back.equals(data)).toBe(true);
  });

  it('an unknown key does not exist and cannot be read', async () => {
    const st = make();
    const key = newKey();
    expect(await st.exists(key)).toBe(false);
    await expect(st.get(key)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('overwriting a key replaces the object', async () => {
    const st = make();
    const key = newKey('quarantine');
    await st.put(key, Buffer.from('first'));
    await st.put(key, Buffer.from('second'));
    expect((await readAll(await st.get(key))).toString()).toBe('second');
  });

  it('delete removes the object; deleting a missing object is a no-op', async () => {
    const st = make();
    const key = newKey();
    await st.put(key, Buffer.from('to delete'));
    await st.delete(key);
    expect(await st.exists(key)).toBe(false);
    await expect(st.delete(key)).resolves.toBeUndefined();
  });

  it('rejects any key that is not a server-generated UUID path, before any I/O', async () => {
    const st = make();
    const before = s3.requests.length;
    for (const bad of ['../etc/passwd', 'documents/x/y', `documents/${randomUUID()}/../../secret`, 'report.pdf', `public/${randomUUID()}/${randomUUID()}`, '']) {
      await expect(st.put(bad, Buffer.from('x'))).rejects.toThrow(/Invalid storage key/);
      await expect(st.get(bad)).rejects.toThrow(/Invalid storage key/);
      await expect(st.exists(bad)).rejects.toThrow(/Invalid storage key/);
      await expect(st.delete(bad)).rejects.toThrow(/Invalid storage key/);
    }
    expect(s3.requests.length).toBe(before);
  });
});

describe('S3-compatible adapter specifics', () => {
  it('stores objects in the configured private bucket with the requested server-side encryption', async () => {
    const st = new S3CompatibleStorage(settings());
    const key = newKey();
    await st.put(key, Buffer.from('sse'));
    const o = s3.objects.get(key)!;
    expect(o.headers['x-amz-server-side-encryption']).toBe('AES256');
    expect(o.headers['content-type']).toBe('application/octet-stream');
  });

  it('wrong credentials fail closed with the S3 error code only (no secret or signature in the message)', async () => {
    const st = new S3CompatibleStorage({ ...settings(), secretAccessKey: 'not-the-secret-0123456789' });
    const err = await st.put(newKey(), Buffer.from('x')).catch((e: Error) => e);
    expect(String(err)).toMatch(/storage\.s3_error: put failed with HTTP 403 \(SignatureDoesNotMatch\)/);
    expect(String(err)).not.toMatch(/not-the-secret|Signature=|AKIA/);
    const other = new S3CompatibleStorage({ ...settings(), accessKeyId: 'AKIAUNKNOWN' });
    await expect(other.put(newKey(), Buffer.from('x'))).rejects.toThrow(/HTTP 403 \(InvalidAccessKeyId\)/);
    // HEAD responses carry no body, so only the status is reported — and a denied HEAD is an error, not "missing".
    await expect(other.exists(newKey())).rejects.toThrow(/storage\.s3_error: exists failed with HTTP 403$/);
  });

  it('an unknown bucket is an error, not an empty store', async () => {
    const st = new S3CompatibleStorage({ ...settings(), bucket: 'another-bucket' });
    await expect(st.put(newKey(), Buffer.from('x'))).rejects.toThrow(/HTTP 404 \(NoSuchBucket\)/);
  });

  it('without complete settings the adapter is Not configured and every call fails closed', async () => {
    const st = new S3CompatibleStorage(null);
    expect(st.status).toBe('not_configured');
    for (const call of [() => st.put(newKey(), Buffer.from('x')), () => st.get(newKey()), () => st.exists(newKey()), () => st.delete(newKey())]) {
      await expect(call()).rejects.toMatchObject({ code: 'storage.not_configured' });
    }
  });

  it('configuration: the s3 driver needs complete https settings in production, and the endpoint must be allow-listed', () => {
    const prod = {
      NODE_ENV: 'production',
      HUB_COOKIE_SECURE: 'true',
      HUB_AI_ALLOW_MOCK: 'false',
      DATABASE_URL: 'postgres://hub_app:x@db.internal:5432/hub',
      HUB_OIDC_ISSUER: 'https://idp.example.invalid',
      HUB_OIDC_CLIENT_ID: 'hub',
      HUB_OIDC_REDIRECT_URI: 'https://hub.example.invalid/api/v1/auth/oidc/callback',
      HUB_COOKIE_SECRET: 'Zq8#pL2!vN5@rT9$wX3%yB6^cF1&hJ4*',
      HUB_STORAGE_DRIVER: 's3',
    } as NodeJS.ProcessEnv;
    expect(() => loadConfig(prod)).toThrow(/HUB_STORAGE_DRIVER=s3 needs HUB_S3_ENDPOINT/);
    const full = { ...prod, HUB_S3_BUCKET: 'hub-documents', HUB_S3_ACCESS_KEY_ID: 'k', HUB_S3_SECRET_ACCESS_KEY: 's' };
    expect(() => loadConfig({ ...full, HUB_S3_ENDPOINT: 'http://objects.example.invalid' })).toThrow(/HUB_S3_ENDPOINT must use https/);
    expect(() => loadConfig({ ...full, HUB_S3_ENDPOINT: 'https://objects.example.invalid' })).toThrow(/HUB_S3_ENDPOINT host objects\.example\.invalid is not on HUB_EGRESS_ALLOWLIST/);
    const ok = loadConfig({ ...full, HUB_S3_ENDPOINT: 'https://objects.example.invalid', HUB_EGRESS_ALLOWLIST: 'objects.example.invalid' });
    expect(ok.storage.s3).toMatchObject({ endpoint: 'https://objects.example.invalid', bucket: 'hub-documents', sse: 'none' });
    expect(() => loadConfig({ ...full, HUB_S3_ENDPOINT: 'https://objects.example.invalid', HUB_EGRESS_ALLOWLIST: 'objects.example.invalid', HUB_S3_SSE: 'aws:kms' })).toThrow(/HUB_S3_KMS_KEY_ID/);
  });
});

describe('SigV4 signer matches independently generated vectors (botocore S3SigV4Auth)', () => {
  // Generated with botocore 1.43.105, credentials = the AWS documentation example pair, time fixed at 2026-09-30T06:00:00Z.
  const key = 'documents/0192f5a0-0000-7000-8000-000000000001/0192f5a0-0000-7000-8000-000000000002';
  const url = new URL(`https://objects.example.invalid:9000/hub-documents/${key}`);
  const now = new Date('2026-09-30T06:00:00Z');
  const sig = (h: Record<string, string>) => /Signature=([0-9a-f]{64})$/.exec(h['authorization']!)![1];
  const base = { url, accessKeyId: ACCESS, secretAccessKey: SECRET, region: 'us-east-1', now };

  it('PUT with content type and SSE header', () => {
    const body = Buffer.from('hello contract');
    const h = signV4({ ...base, method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'x-amz-server-side-encryption': 'AES256' }, payloadHash: sha256Hex(body) });
    expect(h['x-amz-content-sha256']).toBe('fab6b1fd5a1dd40cc9e38faa2291af9c3191bfcb03c48bd9c9adacc4b527d16b');
    expect(h['authorization']).toContain('SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date;x-amz-server-side-encryption');
    expect(sig(h)).toBe('2fb9b176c5f6b41479135fd77e18d3d1e4f38f24c1b80e52e2cdaa0f9845e274');
  });

  it.each([
    ['GET', '3d0010699b2d9b4afd973860bebf2ec710745cbd17da5d1b36d5920044b3588f'],
    ['HEAD', '2c4bd24cb03d0d8fe41155704e8c55ff164e37ce97fa35738d6c0db89a84c42f'],
    ['DELETE', '6e16b1af7abc6e04aeca94d5eec2dba2814de28640cf9edb771bc2055e4cdbe7'],
  ] as const)('%s', (method, expected) => {
    const h = signV4({ ...base, method, payloadHash: sha256Hex('') });
    expect(h['x-amz-date']).toBe('20260930T060000Z');
    expect(h['authorization']).toBe(`AWS4-HMAC-SHA256 Credential=${ACCESS}/20260930/us-east-1/s3/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=${expected}`);
  });
});
