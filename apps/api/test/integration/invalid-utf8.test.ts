// F-DG2-290 (T-DG2-BE13): ill-formed UTF-8 from the client is the declared 400 ValidationError, on a real PostgreSQL.
// Before: a JSON body with invalid UTF-8 bytes was decoded by Fastify's default parser with U+FFFD replacement. With a
// Content-Length the byte count then mismatched (FST_ERR_CTP_INVALID_CONTENT_LENGTH, unmapped) -> undeclared 500 before
// authentication, logged as "unhandled error"; chunked, the U+FFFD text was stored and audited. A query component such
// as `?q=%FF` reached the handler as the literal "%FF". Now:
//   - JSON body (Content-Length or chunked): 400 `validation.json` at pointer "", before authentication (like invalid
//     JSON); nothing is written, no audit row, no error-level log entry;
//   - query: 400 `validation.format` at `/query/<key>`, after authentication and CSRF (central preHandler check);
//   - X-File-Name with an escape that is not UTF-8: 400 `validation.file_name`; no revision is stored;
//   - one UTF-8 BOM is accepted and stripped; valid Arabic and emoji text round-trips byte for byte;
//   - the rate limiter still counts the refused requests.
// Every response is asserted against the OpenAPI contract. All data is SYNTHETIC. G1-G6 are PRODUCT gates (business
// approvals), unrelated to the engineering gates DG0-DG7.
import { connect, type AddressInfo } from "node:net";
import { Readable } from "node:stream";
import { sql } from "@mth/db";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  APP_ORIGIN,
  auditOf,
  auditOfRequest,
  call,
  seedWorld,
  startApi,
  type Session,
  type TestApi,
  type World,
} from "../support/harness.ts";
import { assertContract } from "../support/contract.ts";
import { ifm, setupP2World, type P2World } from "../support/p2-fixtures.ts";

/** Log lines written by the server under test (pino JSON, level 30 = info, 50 = error). */
const logLines: Array<{ level: number; msg: string }> = [];
const logStream = {
  write(line: string) {
    for (const l of line.split("\n").filter(Boolean)) logLines.push(JSON.parse(l) as { level: number; msg: string });
  },
};

let api: TestApi;
let w: World;
let p: P2World;
let T: string;
beforeAll(async () => {
  api = await startApi({ logStream, env: { LOG_LEVEL: "info" } });
  w = await seedWorld(api.db);
  p = await setupP2World(api, w);
  T = `/api/v1/transformations/${p.transformationId}`;
});
afterAll(() => api.close());

const ARABIC = "نطاق التحول الاصطناعي";
const EMOJI = "🚀👩🏽‍💻✅";
/** Byte sequences that are not UTF-8: never valid, truncated lead byte, CESU-8 lone surrogate. */
const INVALID = { FF: [0xff], C3: [0xc3], CESU: [0xed, 0xa0, 0x80] } as const;

const utf8 = (s: string) => Buffer.from(s, "utf8");
/** `{"transformationName":"Synthetic","outOfScope":"Synthetic<bytes> text"}` with raw bytes inside the string. */
const charterBody = (inner: readonly number[]) =>
  Buffer.concat([
    utf8('{"transformationName":"Synthetic","outOfScope":"Synthetic'),
    Buffer.from(inner),
    utf8(' text"}'),
  ]);

type Framing = "content-length" | "chunked";
const FRAMINGS: readonly Framing[] = ["content-length", "chunked"];

/** light-my-request sets Content-Length for a Buffer and none for a stream (the body then arrives like chunked). */
const payloadFor = (body: Buffer, framing: Framing) =>
  framing === "content-length" ? body : Readable.from([body.subarray(0, 7), body.subarray(7)]);

interface RawRes {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
  headers: LightMyRequestResponse["headers"];
}

/** A request with a raw byte body through inject, asserted against the OpenAPI contract. */
async function rawCall(
  app: FastifyInstance,
  method: "POST" | "PATCH",
  url: string,
  body: Buffer,
  framing: Framing,
  opts: { session?: Session | null; headers?: Record<string, string>; contract?: boolean } = {},
): Promise<RawRes> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    origin: APP_ORIGIN,
    ...(opts.headers ?? {}),
  };
  if (opts.session) {
    headers["cookie"] = opts.session.cookie;
    headers["x-csrf-token"] = opts.session.csrf;
  }
  const raw = await app.inject({ method, url, headers, payload: payloadFor(body, framing) });
  if (opts.contract !== false) {
    assertContract(method, url, { statusCode: raw.statusCode, headers: raw.headers, body: raw.body });
  }
  const isJson = String(raw.headers["content-type"] ?? "").includes("json");
  return { status: raw.statusCode, body: isJson && raw.body !== "" ? raw.json() : raw.body, headers: raw.headers };
}

/** 400 problem+json validation.json at pointer "", no audit row, no error-level log line for the request. */
async function expectInvalidUtf8(res: RawRes) {
  expect(res.status, JSON.stringify(res.body)).toBe(400);
  expect(String(res.headers["content-type"])).toMatch(/^application\/problem\+json/);
  const requestId = String(res.headers["x-request-id"]);
  expect(res.body).toEqual({
    type: "urn:mth:problem:validation",
    title: "Validation failed",
    status: 400,
    detail: "The request body is not valid UTF-8 JSON.",
    code: "validation",
    requestId,
    errors: [{ pointer: "", code: "validation.json", message: "The request body is not valid UTF-8 JSON." }],
  });
  expect(await auditOfRequest(api.db, requestId)).toEqual([]);
  const forRequest = logLines.filter((l) => (l as { requestId?: string }).requestId === requestId);
  expect(forRequest.length).toBeGreaterThan(0); // the logger is live for this request
  expect(forRequest.filter((l) => l.level >= 50 || l.msg === "unhandled error")).toEqual([]);
}

/** Number of audit rows anywhere whose changes hold U+FFFD (the replacement character must never be stored). */
async function replacementAuditRows(transformationId: string): Promise<number> {
  const r = await sql<{ n: string }>`
    SELECT count(*) AS n FROM audit_event
     WHERE transformation_id = ${transformationId} AND strpos(coalesce(changes::text, ''), ${"�"}) > 0`.execute(api.db);
  return Number(r.rows[0]!.n);
}

describe("a JSON body with invalid UTF-8 is 400 validation.json, the same with Content-Length and chunked", () => {
  it("charter create: 400 for every invalid sequence and framing; no charter, no audit row, no U+FFFD stored", async () => {
    const q = await setupP2World(api, w);
    const QC = `/api/v1/transformations/${q.transformationId}/charter`;
    for (const [name, bytes] of Object.entries(INVALID)) {
      for (const framing of FRAMINGS) {
        const res = await rawCall(api.app, "POST", QC, charterBody(bytes), framing, { session: q.lead.session });
        await expectInvalidUtf8(res).catch((e: Error) => {
          throw new Error(`${name} ${framing}: ${e.message}`);
        });
      }
    }
    expect((await call(api.app, "GET", QC, { session: q.lead.session })).status).toBe(404);
    expect(await replacementAuditRows(q.transformationId)).toBe(0);
    // Control: the same body with a valid byte is created (so the 400 is about the bytes, not the request).
    for (const framing of FRAMINGS) {
      const r = await setupP2World(api, w);
      const ok = await rawCall(
        api.app,
        "POST",
        `/api/v1/transformations/${r.transformationId}/charter`,
        charterBody([0x41]),
        framing,
        {
          session: r.lead.session,
        },
      );
      expect(ok.status, JSON.stringify(ok.body)).toBe(201);
      expect(ok.body.charter.outOfScope).toBe("SyntheticA text");
    }
  });

  it("charter update (PATCH, If-Match): version, value and audit trail unchanged", async () => {
    const q = await setupP2World(api, w);
    const QC = `/api/v1/transformations/${q.transformationId}/charter`;
    const created = await call(api.app, "POST", QC, {
      session: q.lead.session,
      body: { transformationName: "Synthetic", inScope: "Retail onboarding (synthetic)" },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const charterId = created.body.charter.id as string;
    const before = await auditOf(api.db, charterId);
    for (const framing of FRAMINGS) {
      const body = Buffer.concat([utf8('{"inScope":"Retail'), Buffer.from(INVALID.FF), utf8('","changeSummary":"x"}')]);
      const res = await rawCall(api.app, "PATCH", QC, body, framing, { session: q.lead.session, headers: ifm(1) });
      await expectInvalidUtf8(res);
    }
    const after = await call(api.app, "GET", QC, { session: q.lead.session });
    expect([after.body.charter.version, after.body.charter.inScope]).toEqual([1, "Retail onboarding (synthetic)"]);
    expect(await auditOf(api.db, charterId)).toEqual(before);
  });

  it("T03 TOM gap create: no gap is created", async () => {
    const count = async () =>
      Number(
        (
          await sql<{
            n: string;
          }>`SELECT count(*) AS n FROM tom_gap WHERE transformation_id = ${p.transformationId}`.execute(api.db)
        ).rows[0]!.n,
      );
    const before = await count();
    for (const framing of FRAMINGS) {
      const body = Buffer.concat([
        utf8('{"dimensionCode":"technology","gap":"Synthetic'),
        Buffer.from(INVALID.CESU),
        utf8('gap"}'),
      ]);
      await expectInvalidUtf8(
        await rawCall(api.app, "POST", `${T}/tom-gaps`, body, framing, { session: p.lead.session }),
      );
    }
    expect(await count()).toBe(before);
  });

  it("unauthenticated (no cookie, no CSRF token): the declared 400, never 500", async () => {
    for (const framing of FRAMINGS) {
      const res = await rawCall(api.app, "POST", `${T}/charter`, charterBody(INVALID.FF), framing);
      await expectInvalidUtf8(res);
    }
    // Control: a valid body without a session is 401.
    expect((await rawCall(api.app, "POST", `${T}/charter`, charterBody([0x41]), "content-length")).status).toBe(401);
  });
});

/** One raw HTTP/1.1 request over a real socket; resolves with the status and the parsed problem body. */
function overSocket(
  port: number,
  head: string,
  body: Buffer,
): Promise<{ status: number; headers: string; body: string }> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1");
    const chunks: Buffer[] = [];
    socket.on("data", (d: Buffer) => chunks.push(d));
    socket.on("error", reject);
    socket.on("close", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      const [rawHead = "", ...rest] = text.split("\r\n\r\n");
      const status = Number(/^HTTP\/1\.1 (\d{3})/.exec(rawHead)?.[1] ?? 0);
      let payload = rest.join("\r\n\r\n");
      if (/transfer-encoding: chunked/i.test(rawHead)) {
        const parts: string[] = [];
        let restBody = payload;
        for (;;) {
          const nl = restBody.indexOf("\r\n");
          const size = parseInt(restBody.slice(0, nl), 16);
          if (!size) break;
          parts.push(restBody.slice(nl + 2, nl + 2 + size));
          restBody = restBody.slice(nl + 2 + size + 2);
        }
        payload = parts.join("");
      }
      resolve({ status, headers: rawHead, body: payload });
    });
    socket.write(Buffer.concat([utf8(head), body]));
  });
}

describe("over a real socket (the framing the reviewer probed), unauthenticated and authenticated", () => {
  let port: number;
  beforeAll(async () => {
    await api.app.listen({ host: "127.0.0.1", port: 0 });
    port = (api.app.server.address() as AddressInfo).port;
  });

  const head = (path: string, framing: Framing, length: number, session?: Session) =>
    [
      `POST ${path} HTTP/1.1`,
      "Host: 127.0.0.1",
      "Content-Type: application/json",
      `Origin: ${APP_ORIGIN}`,
      "Connection: close",
      ...(session ? [`Cookie: ${session.cookie}`, `X-CSRF-Token: ${session.csrf}`] : []),
      framing === "content-length" ? `Content-Length: ${length}` : "Transfer-Encoding: chunked",
      "",
      "",
    ].join("\r\n");
  const frame = (body: Buffer, framing: Framing) =>
    framing === "content-length"
      ? body
      : Buffer.concat([utf8(`${body.length.toString(16)}\r\n`), body, utf8("\r\n0\r\n\r\n")]);

  it("400 validation.json for both framings, with and without a session; nothing stored", async () => {
    const q = await setupP2World(api, w);
    const QC = `/api/v1/transformations/${q.transformationId}/charter`;
    for (const session of [undefined, q.lead.session]) {
      for (const framing of FRAMINGS) {
        const body = charterBody(INVALID.FF);
        const res = await overSocket(port, head(QC, framing, body.length, session), frame(body, framing));
        expect(res.status, `${framing} ${session ? "signed in" : "anonymous"}: ${res.body}`).toBe(400);
        const problem = JSON.parse(res.body) as { requestId: string; errors: Array<{ code: string; pointer: string }> };
        expect(problem.errors).toEqual([expect.objectContaining({ pointer: "", code: "validation.json" })]);
        expect(await auditOfRequest(api.db, problem.requestId)).toEqual([]);
        expect(
          logLines.filter((l) => (l as { requestId?: string }).requestId === problem.requestId && l.level >= 50),
        ).toEqual([]);
      }
    }
    expect((await call(api.app, "GET", QC, { session: q.lead.session })).status).toBe(404);
    expect(await replacementAuditRows(q.transformationId)).toBe(0);
  });
});

describe("valid UTF-8 round-trips verbatim; one BOM is accepted and stripped", () => {
  it("Arabic and emoji text, with Content-Length and chunked: stored and audited byte for byte", async () => {
    for (const framing of FRAMINGS) {
      const q = await setupP2World(api, w);
      const QC = `/api/v1/transformations/${q.transformationId}/charter`;
      const text = `${ARABIC} ${EMOJI} (${framing})`;
      const res = await rawCall(
        api.app,
        "POST",
        QC,
        utf8(JSON.stringify({ transformationName: "Synthetic", outOfScope: text })),
        framing,
        {
          session: q.lead.session,
        },
      );
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.charter.outOfScope).toBe(text);
      const stored = await sql<{ out_of_scope: string }>`
        SELECT out_of_scope FROM charter WHERE id = ${res.body.charter.id}`.execute(api.db);
      expect(utf8(stored.rows[0]!.out_of_scope).equals(utf8(text))).toBe(true);
      const audit = await auditOfRequest(api.db, String(res.headers["x-request-id"]));
      expect(JSON.stringify(audit)).toContain(JSON.stringify(text).slice(1, -1));
      expect(await replacementAuditRows(q.transformationId)).toBe(0);
    }
  });

  it("a leading BOM (EF BB BF) is stripped: the charter is created with the exact text", async () => {
    for (const framing of FRAMINGS) {
      const q = await setupP2World(api, w);
      const body = Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        utf8(JSON.stringify({ transformationName: "Synthetic", outOfScope: ARABIC })),
      ]);
      const res = await rawCall(
        api.app,
        "POST",
        `/api/v1/transformations/${q.transformationId}/charter`,
        body,
        framing,
        {
          session: q.lead.session,
        },
      );
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.charter.outOfScope).toBe(ARABIC);
    }
  });
});

describe("a query component that is not percent-encoded UTF-8 is 400 validation.format", () => {
  it("GET /transformations?q=%FF and ?q=%ED%A0%80: 400 at /query/q (it used to search for the literal text)", async () => {
    for (const raw of ["%FF", "%ED%A0%80", "%C3"]) {
      const res = await call(api.app, "GET", `/api/v1/transformations?q=${raw}`, { session: p.lead.session });
      expect(res.status, `${raw}: ${JSON.stringify(res.body)}`).toBe(400);
      expect(res.body.errors).toEqual([
        {
          pointer: "/query/q",
          code: "validation.format",
          message: "The query string contains an invalid percent-encoding.",
        },
      ]);
      expect(JSON.stringify(res.body)).not.toContain(raw);
    }
    const ok = await call(api.app, "GET", `/api/v1/transformations?q=${encodeURIComponent("Synthetic P2")}`, {
      session: p.lead.session,
    });
    expect(ok.status).toBe(200);
  });

  it("authentication keeps its precedence: without a session the answer is 401", async () => {
    expect((await call(api.app, "GET", "/api/v1/transformations?q=%FF")).status).toBe(401);
  });

  it("the OIDC callback (exempt; declares only its redirect) is unchanged: never a 400 problem", async () => {
    const res = await api.app.inject({ method: "GET", url: "/api/v1/auth/callback?state=%ED%A0%80&code=%FF" });
    expect(res.statusCode).not.toBe(400);
    expect(res.statusCode).toBeLessThan(500);
  });
});

describe("X-File-Name with a percent escape that is not UTF-8", () => {
  it("is 400 validation.file_name; no revision is stored and nothing is audited", async () => {
    const created = await call(api.app, "POST", `${T}/evidence`, {
      session: p.lead.session,
      body: { ownerUserId: p.lead.id, kind: "file", title: "Synthetic file" },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const before = await auditOf(api.db, created.body.id);
    const res = await call(api.app, "POST", `${T}/evidence/${created.body.id}/content`, {
      session: p.lead.session,
      headers: {
        ...ifm(created.body.version),
        "content-type": "application/octet-stream",
        "x-file-name": "report%FF.csv",
      },
      body: Buffer.from("a,b\n1,2\n"),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.errors).toEqual([
      expect.objectContaining({ pointer: "/header/X-File-Name", code: "validation.file_name" }),
    ]);
    expect(await auditOf(api.db, created.body.id)).toEqual(before);
    const after = await call(api.app, "GET", `${T}/evidence/${created.body.id}`, { session: p.lead.session });
    expect(after.body.version).toBe(created.body.version);
    // Control: the percent-encoded UTF-8 name the web client sends is stored decoded.
    const good = await call(api.app, "POST", `${T}/evidence/${created.body.id}/content`, {
      session: p.lead.session,
      headers: {
        ...ifm(created.body.version),
        "content-type": "application/octet-stream",
        "x-file-name": encodeURIComponent("تقرير اصطناعي.csv"),
      },
      body: Buffer.from("a,b\n1,2\n"),
    });
    expect(good.status, JSON.stringify(good.body)).toBe(200);
    expect(JSON.stringify(good.body)).toContain("تقرير اصطناعي.csv");
  });
});

describe("rate limiting still applies to the refused requests", () => {
  it("invalid-UTF-8 bodies count against the limit: 400 until the limit, then 429", async () => {
    const limited = await startApi({ env: { RATE_LIMIT_PER_MINUTE: "3" } });
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 5; i += 1) {
        // T-DG2-ARCH-03: createCharter now declares 429 (ADR-0007 §5b), so the 429 is asserted against the contract
        // like the 400s (this call skipped the contract assertion before, when the 429 was undeclared).
        const res = await rawCall(limited.app, "POST", `${T}/charter`, charterBody(INVALID.FF), "content-length");
        statuses.push(res.status);
        if (res.status === 429)
          expect(res.body).toMatchObject({ type: "urn:mth:problem:rate-limited", code: "rate_limited" });
        else expect(res.body.errors).toEqual([expect.objectContaining({ code: "validation.json" })]);
      }
      expect(statuses).toEqual([400, 400, 400, 429, 429]);
    } finally {
      await limited.close();
    }
  });
});

describe("cookie and header values (sweep): byte-faithful, never rewritten, never a 500", () => {
  it("a session cookie with an undecodable escape or high bytes is no session (401); a CSRF token with them is 403", async () => {
    for (const cookie of ["mth_session=%FF", "mth_session=%ED%A0%80", "mth_session=ÿþ"]) {
      const res = await call(api.app, "GET", "/api/v1/me", { headers: { cookie } });
      expect(res.status, cookie).toBe(401);
    }
    const res = await call(api.app, "POST", `${T}/tom-gaps`, {
      session: p.lead.session,
      csrf: false,
      headers: { "x-csrf-token": "%FFÿ" },
      body: { dimensionCode: "technology", gap: "Synthetic gap (csrf)" },
    });
    expect([res.status, res.body.code]).toEqual([403, "csrf"]);
  });

  it("an X-Request-Id with high bytes or percent escapes is never adopted (a UUIDv7 is generated)", async () => {
    for (const id of ["%FF", "ÿþ", "%ED%A0%80"]) {
      const res = await call(api.app, "GET", "/api/v1/me", {
        session: p.lead.session,
        headers: { "x-request-id": id },
      });
      expect(res.status).toBe(200);
      expect(String(res.headers["x-request-id"])).toMatch(/^[0-9a-f-]{36}$/);
    }
  });
});
