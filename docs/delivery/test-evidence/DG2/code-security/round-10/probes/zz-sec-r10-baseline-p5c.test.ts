// code-security-reviewer DG2 round-10 BASELINE for P5c only (T-DG2-REV-SEC-R10): run at the round-9 candidate 041478cb
// (source 7854770e, before BE15) to show whether the inject + chunked over-limit AbortError / error log predates BE15.
// Same helpers as zz-sec-r10-probe.test.ts (minus the BE15-only imports). NOT part of the candidate: copied into a
// disposable clone (68fe3394 = source fe22d759 + delivery metadata) at apps/api/test/integration/ and run on a
// disposable PostgreSQL 16. All data SYNTHETIC. Each assertion states the secure/declared expectation (a failing test
// shows a defect); every observation is also logged as "PROBE <key>: <json>".
// Scope: BE15/BE15B (F-DG2-350, F-DG2-351): any remaining Content-Type spelling or framing where the central decision
// and Fastify's parser lookup disagree, a refusal names the wrong media type, an unmatched route answers anything but
// 404, a body is rewritten, or the answer is undeclared / a 500; plus no regression of CSRF, rate limiting, bodyLimit,
// the evidence streaming limit / raw sha256, and keep-alive framing.
import { createHash } from "node:crypto";
import { connect, type AddressInfo } from "node:net";
import { Readable } from "node:stream";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertContract } from "../support/contract.ts";
import { call, seedWorld, startApi, type TestApi, type World } from "../support/harness.ts";
import { ifm, setupP2World, type P2World } from "../support/p2-fixtures.ts";

const logLines: Array<{ level: number; msg: string }> = [];
const logStream = {
  write(line: string) {
    for (const l of line.split("\n").filter(Boolean)) logLines.push(JSON.parse(l));
  },
};
let api: TestApi;
let w: World;
let p: P2World;
let T: string;
let port: number;
const log = (k: string, v: unknown) => console.log(`PROBE ${k}: ${JSON.stringify(v)}`);
const errorLogs = () => logLines.filter((l) => l.level >= 50 || l.msg === "unhandled error").length;

beforeAll(async () => {
  api = await startApi({ logStream, env: { LOG_LEVEL: "info" } });
  w = await seedWorld(api.db);
  p = await setupP2World(api, w);
  T = `/api/v1/transformations/${p.transformationId}`;
  await api.app.listen({ port: 0, host: "127.0.0.1" });
  port = (api.app.server.address() as AddressInfo).port;
});
afterAll(() => api.close());

const ORIGIN = () => new URL(String(api.config.appBaseUrl)).origin;
const authHeaders = (s = p.lead.session) => ({ cookie: s.cookie, origin: ORIGIN(), "x-csrf-token": s.csrf });
const BYTES = Buffer.from([0x53, 0x79, 0x6e, 0xff, 0xc3, 0x0a, 0xed, 0xa0, 0x80, 0x41]); // not UTF-8
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const OCTET_DETAIL = "Send the request body as application/octet-stream.";
const JSON_DETAIL = "Send the request body as application/json.";

async function send(method: string, url: string, headers: Record<string, string>, body: Buffer | null, framing: "cl" | "chunked") {
  const raw = await api.app.inject({
    method: method as "POST",
    url,
    headers: { ...headers, ...(framing === "chunked" && body !== null ? { "transfer-encoding": "chunked" } : {}) },
    ...(body === null ? {} : { payload: framing === "cl" ? body : Readable.from([body.subarray(0, 3), body.subarray(3)]) }),
  });
  let declared = true;
  let why = "";
  try {
    assertContract(method, url, { statusCode: raw.statusCode, headers: raw.headers, body: raw.body });
  } catch (e) {
    declared = false;
    why = String((e as Error).message).slice(0, 200);
  }
  let json: { code?: string; detail?: string; errors?: Array<{ pointer: string; code: string; message?: string }> } = {};
  try {
    json = raw.json();
  } catch {
    /* not JSON */
  }
  return { status: raw.statusCode, code: json.errors?.[0]?.code ?? json.code, detail: json.errors?.[0]?.message ?? json.detail, declared, why, raw };
}

/**
 * Raw socket: writes `parts` (with optional delays), collects everything until the server closes or `waitMs` elapses.
 * Returns all status lines, whether the server closed the socket, and the time to first byte.
 */
function socketExchange(parts: Array<Buffer | number>, waitMs = 4000): Promise<{ statuses: string[]; closedByServer: boolean; text: string; firstByteMs: number }> {
  return new Promise((resolve) => {
    const s = connect(port, "127.0.0.1");
    const chunks: Buffer[] = [];
    const t0 = Date.now();
    let firstByteMs = -1;
    let closedByServer = false;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      const text = Buffer.concat(chunks).toString("latin1");
      resolve({ statuses: text.match(/HTTP\/1\.1 \d{3}/g) ?? [], closedByServer, text, firstByteMs });
    };
    s.on("data", (c) => {
      if (firstByteMs < 0) firstByteMs = Date.now() - t0;
      chunks.push(c);
    });
    s.on("end", () => {
      closedByServer = true;
    });
    s.on("error", () => {
      closedByServer = true;
    });
    s.on("close", finish);
    (async () => {
      for (const part of parts) {
        if (typeof part === "number") await new Promise((r) => setTimeout(r, part));
        else if (!s.destroyed) s.write(part);
      }
    })();
    setTimeout(() => {
      s.destroy();
      finish();
    }, waitMs);
  });
}

async function newFile(title: string) {
  const c = await call(api.app, "POST", `${T}/evidence`, { session: p.lead.session, body: { ownerUserId: p.lead.id, kind: "file", title } });
  expect(c.status).toBe(201);
  return { id: c.body.id as string, version: c.body.version as number };
}
const storedOf = async (id: string) =>
  (await sql<{ sha256: string }>`select c.sha256 from evidence e join evidence_content c on c.id = e.current_content_id where e.id = ${id}`.execute(api.db)).rows[0]?.sha256 ?? null;
const auditCount = async () => Number((await sql<{ n: string }>`select count(*) n from audit_event`.execute(api.db)).rows[0]!.n);

let injectArtifactErrors = 0;
describe("P5c baseline", () => {
  it("OBSERVATION (test-transport artifact, compare the r9 baseline): inject + a CHUNKED over-limit stream rejects the inject promise with AbortError", async () => {
    const f = await newFile("Synthetic P5 inject chunked");
    const before = errorLogs();
    let outcome: unknown;
    try {
      const r = await send("POST", `${T}/evidence/${f.id}/content`, { ...authHeaders(), ...ifm(f.version), "content-type": "application/octet-stream", "x-file-name": "p5c.bin" }, Buffer.alloc(30 * 1024 * 1024, 0xfe), "chunked");
      outcome = [r.status, r.code];
    } catch (e) {
      outcome = String((e as Error).name);
    }
    await new Promise((res) => setTimeout(res, 200));
    injectArtifactErrors = errorLogs() - before;
    log("P5c", { outcome, stored: await storedOf(f.id), errorLogsAdded: injectArtifactErrors });
    expect(await storedOf(f.id)).toBeNull();
  });
});

