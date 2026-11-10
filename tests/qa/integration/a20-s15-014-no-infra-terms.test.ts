// qa-verifier (DG6, T-DG6-QA-F). Binding row REQ-S15-014 (A05;A20), clause 2: "non-admin screens show no stack traces
// or infrastructure terms". ADR-0061 §8: "A forced server error ... shows the generic error state with its request id
// only." The web shows the problem's translated `code` (ADR-0007), so the API side of the clause is that the problem
// the server sends for a REAL failure carries no stack trace and none of the §8 terms (e2e/support/s15-014-terms.ts),
// and does carry a request id the error state can show. The e2e scan (e2e/a20-s15-014-term-scan.spec.ts) covers the
// rendered screens.
//
// Real server (the Fastify app through the harness, every response validated against docs/api/openapi.yaml) on a real
// PostgreSQL, SYNTHETIC data, on this suite's OWN scratch database because it breaks the database on purpose:
//  1. a real SQL failure: the `transformation` table is renamed away for one request (42P01 inside the server), then
//     restored;
//  2. a real network failure: a second server instance whose DATABASE_URL points at a closed local port
//     (ECONNREFUSED inside the server);
//  3. negative controls the web also meets: an unknown API path (404) and a malformed JSON body (400).
// The responses of the forced faults are requested with `contract: false` because the contract declares no 500/503 for
// listTransformations, getTransformation, createTransformation or devLogin (an observation in the handback); the
// Problem schema's required members (type, title, status, code, requestId) are asserted here instead.
// Mutation check (handback): the product is mutated in a disposable copy, never in this tree.
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { migrate } from "../../../packages/db/src/migrate.ts";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../packages/db/test/helpers.ts";
import { APP_ORIGIN } from "../../../apps/api/test/support/harness.ts";
import { scanTerms } from "../../../e2e/support/s15-014-terms.ts";
import {
  call,
  createBu,
  createOrg,
  createUser,
  grant,
  signIn,
  startApi,
  type Loose,
  type Res,
  type Session,
  type TestApi,
} from "../support/api.ts";

let scratchDb = "";
let api: TestApi;
/** The server's own log (administrator side): proves each fault really happened inside the server. */
const serverLog: string[] = [];
let lead: Session;
let transformationId = "";
let buId = "";

/** Every string value of a parsed JSON body (what a client would render), depth first. */
function stringLeaves(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.flatMap(stringLeaves);
  if (v && typeof v === "object") return Object.values(v).flatMap(stringLeaves);
  return [];
}

/**
 * The text a client can render from the response: the raw payload AND its decoded string values (headers are never
 * rendered). The decoded values matter: in the raw JSON a PostgreSQL sentence reads `relation \"x\" does not exist`,
 * which the quoted pattern would miss (found by mutant M-API-2, handback).
 */
function receivedText(res: Res<Loose>): string {
  let decoded: string[] = [];
  try {
    decoded = stringLeaves(JSON.parse(res.raw.payload));
  } catch {
    decoded = [];
  }
  return [res.raw.payload, ...decoded].join("\n");
}

/** The problem shape of the contract, a request id to show, and no §8 term anywhere in what the client receives. */
function expectCleanProblem(res: Res<Loose>, status: number, type: string): void {
  expect(res.status, res.raw.payload).toBe(status);
  expect(String(res.headers["content-type"])).toContain("application/problem+json");
  expect(res.body).toMatchObject({ status, type });
  expect(typeof res.body.title).toBe("string");
  expect(res.body.code).toMatch(/^[a-z][a-z0-9_.]*$/);
  expect(typeof res.body.requestId).toBe("string");
  expect(res.body.requestId.length).toBeGreaterThan(0);
  expect(scanTerms(receivedText(res)), receivedText(res)).toEqual([]);
}

beforeAll(async () => {
  const { adminUrl } = inject("mthDb");
  scratchDb = await createScratchDatabase(adminUrl, "mth_qa_s15014");
  await migrate(roleUrl(adminUrl, scratchDb, "mth_owner"));
  api = await startApi({ database: scratchDb, logStream: { write: (line: string) => void serverLog.push(line) } });
  const org = await createOrg(api.db);
  buId = await createBu(api.db, org.id);
  const grantor = await createUser(api.db, org.id);
  const l = await createUser(api.db, org.id);
  await grant(api.db, grantor.id, l.id, "TL", { type: "business_unit", id: buId }, org.id);
  lead = await signIn(api.app, l.subject);
  const t = await call(api.app, "POST", "/api/v1/transformations", {
    session: lead,
    body: { businessUnitId: buId, name: "Synthetic QA-F S15-014 transformation", mode: "end_to_end" },
  });
  expect(t.status, t.raw.payload).toBe(201);
  transformationId = t.body.id;
});

afterAll(async () => {
  await api?.close();
  if (scratchDb) await dropScratchDatabase(inject("mthDb").adminUrl, scratchDb);
});

describe("REQ-S15-014 clause 2 (A20): a real server failure reaches the client without stack traces or infrastructure terms", () => {
  it("control: the transformation list and detail answer 200 before the fault", async () => {
    const list = await call(api.app, "GET", "/api/v1/transformations", { session: lead });
    expect(list.status, list.raw.payload).toBe(200);
    const one = await call(api.app, "GET", `/api/v1/transformations/${transformationId}`, { session: lead });
    expect(one.status, one.raw.payload).toBe(200);
    expect(one.body.id).toBe(transformationId);
  });

  it("a real SQL failure (relation missing, 42P01) is a 500 internal problem with a request id and no §8 term", async () => {
    await api.owner.query("ALTER TABLE transformation RENAME TO transformation_qa_f_broken");
    let list: Res<Loose>;
    let one: Res<Loose>;
    try {
      list = await call(api.app, "GET", "/api/v1/transformations", { session: lead, contract: false });
      one = await call(api.app, "GET", `/api/v1/transformations/${transformationId}`, {
        session: lead,
        contract: false,
      });
    } finally {
      await api.owner.query("ALTER TABLE transformation_qa_f_broken RENAME TO transformation");
    }
    expectCleanProblem(list, 500, "urn:mth:problem:internal");
    expectCleanProblem(one, 500, "urn:mth:problem:internal");
    // The fault is real: the server logged PostgreSQL's 42P01 for these requests (the log is administrator-side).
    const logged = serverLog.filter((l) => l.includes(list.body.requestId) || l.includes(one.body.requestId)).join("");
    expect(logged).toMatch(/42P01|does not exist/);
    // The two failures are two requests: each has its own reference.
    expect(list.body.requestId).not.toBe(one.body.requestId);
    // Restored: the same read answers 200 again (the fault was the table, not the session).
    const again = await call(api.app, "GET", `/api/v1/transformations/${transformationId}`, { session: lead });
    expect(again.status, again.raw.payload).toBe(200);
  });

  it("a real SQL failure on a write (CSRF-protected POST) leaks nothing either, and writes nothing", async () => {
    const before = await api.owner.query<{ n: string }>("SELECT count(*)::text AS n FROM transformation");
    await api.owner.query("ALTER TABLE transformation RENAME TO transformation_qa_f_broken");
    let res: Res<Loose>;
    try {
      res = await call(api.app, "POST", "/api/v1/transformations", {
        session: lead,
        body: { businessUnitId: buId, name: "Synthetic QA-F write during fault", mode: "end_to_end" },
        contract: false,
      });
    } finally {
      await api.owner.query("ALTER TABLE transformation_qa_f_broken RENAME TO transformation");
    }
    expectCleanProblem(res, 500, "urn:mth:problem:internal");
    const after = await api.owner.query<{ n: string }>("SELECT count(*)::text AS n FROM transformation");
    expect(after.rows[0]!.n).toBe(before.rows[0]!.n);
  });

  it("a real network failure (database port refuses, ECONNREFUSED) answers a problem with a request id and no §8 term", async () => {
    // 27249 is the last port of this task's harness range (27200-27249); nothing listens on it during this suite
    // (the run's PostgreSQL takes the first free port of the range from QA_PG_PORT upward).
    const closed = `postgresql://mth_app@127.0.0.1:27249/${scratchDb}`;
    const downLog: string[] = [];
    const down = await startApi({
      env: { DATABASE_URL: closed },
      logStream: { write: (line: string) => void downLog.push(line) },
      pool: { max: 1, connectionTimeoutMs: 2000 },
    });
    try {
      // The session cookie of the healthy instance cannot be checked without the database: the read fails inside
      // the server while it looks the session up.
      const list = await call(down.app, "GET", "/api/v1/transformations", { session: lead, contract: false });
      expect([500, 503], list.raw.payload).toContain(list.status);
      expectCleanProblem(
        list,
        list.status,
        list.status === 503 ? "urn:mth:problem:unavailable" : "urn:mth:problem:internal",
      );
      const login = await call(down.app, "POST", "/api/v1/auth/dev-login", {
        body: { username: "u.qa-f-down" },
        contract: false,
      });
      expect([500, 503], login.raw.payload).toContain(login.status);
      expectCleanProblem(
        login,
        login.status,
        login.status === 503 ? "urn:mth:problem:unavailable" : "urn:mth:problem:internal",
      );
      // The fault is real: the server logged the refused connection (administrator-side).
      expect(downLog.join("")).toMatch(/ECONNREFUSED/);
    } finally {
      await down.close();
    }
  });

  it("negative control: an unknown API path is a 404 problem with no §8 term", async () => {
    const res = await call(api.app, "GET", "/api/v1/qa-f-no-such-resource", { session: lead, contract: false });
    expectCleanProblem(res, 404, "urn:mth:problem:not-found");
  });

  it("negative control: a malformed JSON body is a 400 problem with no parser internals or §8 term", async () => {
    const res = await api.app.inject({
      method: "POST",
      url: "/api/v1/transformations",
      headers: {
        cookie: lead.cookie,
        "x-csrf-token": lead.csrf,
        origin: APP_ORIGIN,
        "content-type": "application/json",
      },
      payload: '{"name": "Synthetic QA-F", ',
    });
    const r: Res<Loose> = { status: res.statusCode, body: res.json(), headers: res.headers, raw: res };
    expect(r.status, res.payload).toBe(400);
    expect(String(r.headers["content-type"])).toContain("application/problem+json");
    expect(typeof r.body.requestId).toBe("string");
    expect(scanTerms(receivedText(r)), receivedText(r)).toEqual([]);
  });
});
