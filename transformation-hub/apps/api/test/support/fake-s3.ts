import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { sha256Hex, signV4 } from '../../src/modules/documents/storage/sigv4';

/**
 * Minimal in-process S3-compatible server for adapter contract tests (NOT for any other use): path-style
 * PUT / GET / HEAD / DELETE on one bucket, SigV4 header authentication re-computed from the request as received
 * (method, path, host, signed headers, payload hash — the payload hash is also checked against the body), 403
 * SignatureDoesNotMatch / InvalidAccessKeyId otherwise, and a request log for assertions.
 */
export class FakeS3 {
  endpoint = '';
  readonly objects = new Map<string, { body: Buffer; headers: Record<string, string> }>();
  readonly requests: { method: string; path: string; status: number }[] = [];
  private server: Server | null = null;

  constructor(
    readonly bucket: string,
    readonly accessKeyId: string,
    readonly secretAccessKey: string,
    readonly region = 'us-east-1',
  ) {}

  async start(): Promise<string> {
    this.server = createServer((req, res) => {
      this.handle(req)
        .then((r) => {
          this.requests.push({ method: req.method ?? '', path: req.url ?? '', status: r.status });
          res.writeHead(r.status, r.headers ?? {});
          res.end(req.method === 'HEAD' ? undefined : r.body);
        })
        .catch((e: Error) => {
          res.writeHead(500, { 'content-type': 'text/plain' });
          res.end(e.message);
        });
    });
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
    this.endpoint = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this.endpoint;
  }

  async stop() {
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }

  private error(status: number, code: string) {
    return { status, headers: { 'content-type': 'application/xml' }, body: Buffer.from(`<?xml version="1.0"?><Error><Code>${code}</Code><Message>fake-s3</Message></Error>`) };
  }

  private async handle(req: IncomingMessage): Promise<{ status: number; headers?: Record<string, string>; body?: Buffer }> {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks);
    const url = new URL(req.url ?? '/', this.endpoint);
    // --- authentication: recompute the signature over what was actually received --------------------------------
    const auth = String(req.headers.authorization ?? '');
    const m = /^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/s3\/aws4_request, SignedHeaders=([a-z0-9;-]+), Signature=([0-9a-f]{64})$/.exec(auth);
    if (!m) return this.error(403, 'AccessDenied');
    if (m[1] !== this.accessKeyId) return this.error(403, 'InvalidAccessKeyId');
    const payloadHash = String(req.headers['x-amz-content-sha256'] ?? '');
    if (payloadHash !== sha256Hex(body)) return this.error(400, 'XAmzContentSHA256Mismatch');
    const amzDate = String(req.headers['x-amz-date'] ?? '');
    const now = new Date(`${amzDate.slice(0, 4)}-${amzDate.slice(4, 6)}-${amzDate.slice(6, 8)}T${amzDate.slice(9, 11)}:${amzDate.slice(11, 13)}:${amzDate.slice(13, 15)}Z`);
    if (Number.isNaN(now.getTime()) || Math.abs(Date.now() - now.getTime()) > 15 * 60_000) return this.error(403, 'RequestTimeTooSkewed');
    const signed = m[4]!.split(';').filter((h) => !['host', 'x-amz-content-sha256', 'x-amz-date'].includes(h));
    const extra = Object.fromEntries(signed.map((h) => [h, String(req.headers[h] ?? '')]));
    const hostUrl = new URL(`${url.protocol}//${String(req.headers.host)}${url.pathname}`);
    const expected = signV4({ method: req.method as 'GET', url: hostUrl, headers: extra, payloadHash, accessKeyId: this.accessKeyId, secretAccessKey: this.secretAccessKey, region: m[3]!, now });
    if (expected['authorization'] !== auth) return this.error(403, 'SignatureDoesNotMatch');
    // --- path-style bucket/key ---------------------------------------------------------------------------------------
    const [, bucket, ...rest] = url.pathname.split('/');
    if (bucket !== this.bucket) return this.error(404, 'NoSuchBucket');
    const key = rest.join('/');
    switch (req.method) {
      case 'PUT':
        this.objects.set(key, { body, headers: Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, String(v)])) });
        return { status: 200, headers: { etag: `"${sha256Hex(body).slice(0, 32)}"` } };
      case 'GET':
      case 'HEAD': {
        const o = this.objects.get(key);
        if (!o) return this.error(404, 'NoSuchKey');
        return { status: 200, headers: { 'content-type': 'application/octet-stream', 'content-length': String(o.body.length) }, body: o.body };
      }
      case 'DELETE':
        this.objects.delete(key);
        return { status: 204 };
      default:
        return this.error(405, 'MethodNotAllowed');
    }
  }
}
