// code-security-reviewer DG5 round 3 (T-DG5-RG-SEC-R3): contract-generated P5 role sweep. Reviewer probe, run in the
// disposable clone only (copied to apps/api/test/integration/ there); never part of the candidate.
//
// From docs/api/openapi.yaml, restricted to P5_OPERATION_IDS:
//  (1) every P5 MUTATION is called by AUD (org-wide, inheriting), by an ADM-only user (ADM_ACCESS + ADM_TECH at the
//      organization) and by an ADM_METHOD-only user, against the real organization and a real transformation T (other
//      path ids random). Expected: never 2xx, and no business row written (per-table row counts before/after; audit
//      rows only `authorization.denied`). For AUD the status distribution is printed (403 expected; any other refusal
//      code is listed by operation).
//  (2) every transformation-scoped P5 GET (path holds {transformationId}) on T: TO (positive control) and AUD must get
//      200 on the list/collection reads; ADM-only and ADM_METHOD-only must never get 200.
//  (3) GET /api/v1/me/navigation for each caller is printed; ADM-only callers must see no transformation-scoped area.
import { randomUUID } from "node:crypto";
import { sql } from "@mth/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openapi, operations } from "../support/contract.ts";
import {
  call,
  createTransformationRow,
  createUser,
  grant,
  seedWorld,
  signIn,
  startApi,
  type Session,
  type TestApi,
  type World,
} from "../support/harness.ts";
import { P5_OPERATION_IDS } from "../support/p5-operations.ts";

type Json = Record<string, unknown>;
const P5 = operations.filter((o) => P5_OPERATION_IDS.has(o.operationId));
const MUTATIONS = P5.filter((o) => o.method !== "GET");
const T_READS = P5.filter((o) => o.method === "GET" && o.path.includes("{transformationId}"));

let api: TestApi;
let w: World;
let T: string;
const s = new Map<string, Session>();

function deref(node: unknown): Json {
  let n = node as Json;
  while (n && typeof n["$ref"] === "string") {
    let cur: unknown = openapi;
    for (const part of (n["$ref"] as string).replace(/^#\//, "").split("/")) cur = (cur as Json)[part];
    n = cur as Json;
  }
  return n;
}

function paramValue(path: string, method: string, name: string): string {
  if (name === "transformationId") return T;
  if (name === "organizationId") return w.orgA.id;
  const item = (openapi["paths"] as Json)[path] as Json;
  const params = [...((item["parameters"] as unknown[]) ?? []), ...((((item[method] as Json)["parameters"]) as unknown[]) ?? [])].map(deref);
  const p = params.find((x) => x["name"] === name && x["in"] === "path");
  const schema = p ? deref(p["schema"]) : {};
  if (Array.isArray(schema["enum"])) return String(schema["enum"][0]);
  if (schema["type"] === "integer") return "1";
  if (schema["format"] === "uuid" || /Id$/.test(name)) return randomUUID();
  if (typeof schema["pattern"] === "string" && /\[a-z/.test(schema["pattern"] as string)) return "synthetic_key";
  return "synthetic_key";
}

function urlOf(o: (typeof P5)[number]): string {
  return o.path.replace(/\{([^}]+)\}/g, (_m, n: string) => paramValue(o.path, o.method.toLowerCase(), n));
}

function bodyOf(o: (typeof P5)[number]): unknown {
  const op = ((openapi["paths"] as Json)[o.path] as Json)[o.method.toLowerCase()] as Json;
  return op["requestBody"] === undefined ? undefined : {};
}

async function tableCounts(): Promise<Map<string, number>> {
  const tables = await sql<{ t: string }>`
    SELECT tablename AS t FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`.execute(api.db);
  const out = new Map<string, number>();
  for (const { t } of tables.rows) {
    const r = await sql<{ n: string }>`SELECT count(*)::text AS n FROM ${sql.table(t)}`.execute(api.db);
    out.set(t, Number(r.rows[0]!.n));
  }
  return out;
}

const lines: string[] = [];

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  T = await createTransformationRow(api.db, w.orgA.id, w.a1, w.office.id);
  const meth = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, meth.id, "ADM_METHOD", { type: "organization", id: w.orgA.id }, w.orgA.id);
  const subjects: [string, string][] = [];
  const subj = async (k: string, id: string) => {
    const r = await api.db.selectFrom("user_identity").select("subject").where("user_id", "=", id).executeTakeFirstOrThrow();
    subjects.push([k, r.subject]);
  };
  await subj("AUD", w.auditor.id);
  await subj("ADM", w.admin.id);
  await subj("ADM_METHOD", meth.id);
  await subj("TO", w.office.id);
  for (const [k, sub] of subjects) s.set(k, await signIn(api.app, sub));
}, 60_000);

afterAll(async () => {
  console.log(`\n# SWEEP RESULTS (${lines.length} requests)\n${lines.join("\n")}`);
  await api?.close();
});

describe("P5 contract-generated role sweep (code-security-reviewer DG5 r3)", () => {
  it("covers the P5 operations", () => {
    console.log(`P5 operations: ${P5.length}; mutations: ${MUTATIONS.length}; transformation-scoped reads: ${T_READS.length}`);
    expect(MUTATIONS.length).toBeGreaterThan(50);
    expect(T_READS.length).toBeGreaterThan(10);
  });

  for (const who of ["AUD", "ADM", "ADM_METHOD"]) {
    it(`${who}: every P5 mutation is refused and writes no business row`, async () => {
      const before = await tableCounts();
      const auditBefore = before.get("audit_event") ?? 0;
      const statuses = new Map<number, number>();
      const not403: string[] = [];
      for (const o of MUTATIONS) {
        const url = urlOf(o);
        const res = await call(api.app, o.method, url, {
          session: s.get(who)!,
          body: bodyOf(o),
          headers: { "if-match": '"1"' },
          contract: false,
        });
        statuses.set(res.status, (statuses.get(res.status) ?? 0) + 1);
        const code = (res.body as Json | null)?.["code"] ?? "";
        lines.push(`${who}\t${res.status}\t${o.operationId}\t${o.method} ${o.path}\t${String(code)}`);
        expect(res.status, `${who} ${o.operationId}`).toBeGreaterThanOrEqual(400);
        if (res.status !== 403) not403.push(`${o.operationId}:${res.status}:${String(code)}`);
      }
      const after = await tableCounts();
      const changed = [...after].filter(([t, n]) => t !== "audit_event" && n !== before.get(t)).map(([t, n]) => `${t} ${before.get(t)}->${n}`);
      const newAudit = await sql<{ action: string; n: string }>`
        SELECT action, count(*)::text AS n FROM (SELECT action FROM audit_event ORDER BY occurred_at DESC, id DESC
          LIMIT ${(after.get("audit_event") ?? 0) - auditBefore}) x GROUP BY action ORDER BY action`.execute(api.db);
      console.log(
        `${who}: statuses ${JSON.stringify(Object.fromEntries(statuses))}; non-403: ${not403.length} ${JSON.stringify(not403)}; ` +
          `changed tables: ${JSON.stringify(changed)}; new audit rows: ${JSON.stringify(newAudit.rows)}`,
      );
      expect(changed.filter((c) => !/^(user_session|session)\b/.test(c))).toEqual([]);
      for (const r of newAudit.rows) expect(r.action).toBe("authorization.denied");
    }, 300_000);
  }

  it("transformation-scoped P5 reads: TO and AUD read T; ADM-only and ADM_METHOD-only never get 200", async () => {
    const byWho = new Map<string, Map<number, number>>();
    const admLeaks: string[] = [];
    let toOk = 0;
    let audOk = 0;
    for (const o of T_READS) {
      const url = urlOf(o);
      for (const who of ["TO", "AUD", "ADM", "ADM_METHOD"]) {
        const res = await call(api.app, "GET", url, { session: s.get(who)!, contract: false });
        const m = byWho.get(who) ?? byWho.set(who, new Map()).get(who)!;
        m.set(res.status, (m.get(res.status) ?? 0) + 1);
        lines.push(`${who}\t${res.status}\tread:${o.operationId}\tGET ${o.path}`);
        if (who === "TO" && res.status === 200) toOk++;
        if (who === "AUD" && res.status === 200) audOk++;
        if ((who === "ADM" || who === "ADM_METHOD") && res.status < 300) admLeaks.push(`${who}:${o.operationId}:${res.status}`);
      }
    }
    console.log(
      `T reads: ${T_READS.length}; ` +
        [...byWho].map(([k, m]) => `${k} ${JSON.stringify(Object.fromEntries(m))}`).join("; ") +
        `; TO 200: ${toOk}; AUD 200: ${audOk}; ADM leaks: ${JSON.stringify(admLeaks)}`,
    );
    expect(toOk).toBeGreaterThan(10);
    expect(audOk).toBeGreaterThan(10);
    expect(admLeaks).toEqual([]);
  }, 300_000);

  it("navigation: printed for each caller; ADM-only callers see no transformation-scoped area", async () => {
    for (const who of ["TO", "AUD", "ADM", "ADM_METHOD"]) {
      const res = await call(api.app, "GET", "/api/v1/me/navigation", { session: s.get(who)!, contract: false });
      expect(res.status).toBe(200);
      const body = res.body as { areas: { code?: string; key?: string; items?: { code?: string; key?: string; path?: string }[] }[] };
      const areas = body.areas.map((a) => `${a.code ?? a.key}[${(a.items ?? []).map((i) => i.code ?? i.key ?? i.path).join(",")}]`);
      console.log(`navigation ${who}: ${areas.join(" ")}`);
      lines.push(`${who}\tnav\t${areas.join(" ")}`);
    }
  });
});
