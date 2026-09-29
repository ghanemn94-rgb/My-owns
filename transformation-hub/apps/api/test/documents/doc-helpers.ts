import request from 'supertest';
import { crc32 } from 'node:zlib';
import { getApp, demoUserId, owner } from '../helpers';
import { registerDocumentsJobs } from '../../src/modules/documents/documents.jobs';
import { WorkerService } from '../../src/platform/jobs/worker.service';

/** A logged-in persona that can also send raw (octet-stream) uploads with the CSRF header. */
export interface DocClient {
  persona: string;
  userId: string;
  agent: request.Agent;
  csrf: string;
  get: (path: string) => request.Test;
  post: (path: string, body?: unknown) => request.Test;
  patch: (path: string, body?: unknown) => request.Test;
  upload: (path: string, bytes: Buffer, filename: string | null, fileType?: string) => request.Test;
}

export async function login(persona: string): Promise<DocClient> {
  const app = await getApp();
  const agent = request.agent(app.getHttpServer());
  const userId = await demoUserId(persona);
  const res = await agent.post('/api/v1/auth/demo-login').send({ userId }).expect(201);
  const csrf = res.body.csrfToken as string;
  return {
    persona,
    userId,
    agent,
    csrf,
    get: (path) => agent.get(path),
    post: (path, body = {}) => agent.post(path).set('x-csrf-token', csrf).send(body as object),
    patch: (path, body = {}) => agent.patch(path).set('x-csrf-token', csrf).send(body as object),
    upload: (path, bytes, filename, fileType) => {
      let r = agent.post(path).set('x-csrf-token', csrf).set('content-type', 'application/octet-stream');
      if (filename !== null) r = r.set('x-filename', encodeURIComponent(filename));
      if (fileType) r = r.set('x-file-type', fileType);
      return r.send(bytes);
    },
  };
}

export const docsPath = (pid: string) => `/api/v1/projects/${pid}/documents`;

/** GET a binary response with the raw body as a Buffer (superagent otherwise parses text/* into `text`). */
export function getBinary(c: DocClient, path: string) {
  return c.agent
    .get(path)
    .buffer(true)
    .parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (d: Buffer) => chunks.push(d));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
}

/** Create a document and upload one version; returns ids and the upload response body. */
export async function createWithVersion(c: DocClient, pid: string, meta: { title: string; kind?: string; classification?: string; roomId?: string; retentionUntil?: string }, file: { bytes: Buffer; name: string; type?: string }) {
  const created = await c.post(docsPath(pid), { kind: 'evidence', ...meta });
  if (created.status !== 201) throw new Error(`create failed ${created.status} ${JSON.stringify(created.body)}`);
  const up = await c.upload(`${docsPath(pid)}/${created.body.id}/versions`, file.bytes, file.name, file.type);
  return { id: created.body.id as string, upload: up };
}

/** Drive the worker deterministically: dispatch outbox → run jobs, until nothing is left. */
export async function drainWorker(): Promise<{ executed: number }> {
  const app = await getApp();
  registerDocumentsJobs(app);
  const worker = app.get(WorkerService);
  let executed = 0;
  for (let i = 0; i < 50; i++) {
    const d = await worker.dispatchOutbox(500);
    const e = await worker.runJobs(50);
    executed += e;
    if (d === 0 && e === 0) break;
  }
  return { executed };
}

export async function orgOf(pid: string): Promise<string> {
  return (await owner().query<{ org_id: string }>('select org_id from project where id = $1', [pid])).rows[0]!.org_id;
}

/** Minimal ZIP writer (stored entries) for OOXML test fixtures. */
export function buildZip(entries: { name: string; data: Buffer | string }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data, 'utf8');
    const name = Buffer.from(e.name, 'utf8');
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(0, 8); // stored
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    lh.writeUInt16LE(0, 28);
    locals.push(lh, name, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0, 10);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);
    offset += 30 + name.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

export function docxBytes(paragraphs: { text: string; style?: string }[], extra: { name: string; data: string }[] = []): Buffer {
  const body = paragraphs
    .map((p) => `<w:p>${p.style ? `<w:pPr><w:pStyle w:val="${p.style}"/></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${p.text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</w:t></w:r></w:p>`)
    .join('');
  return buildZip([
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>' },
    { name: 'word/document.xml', data: `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>` },
    ...extra,
  ]);
}

export const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
