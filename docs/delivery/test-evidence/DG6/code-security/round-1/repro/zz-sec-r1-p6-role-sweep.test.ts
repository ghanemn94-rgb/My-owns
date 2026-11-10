// code-security-reviewer, DG6 re-gate round 1 (T-DG6-REV-CS-RG-R1): a contract-generated sweep of EVERY P6 operation
// (apps/api/test/support/p6-operations.ts) for the read-only auditor (AUD @ org A) and an ADM-only caller (ADM_ACCESS +
// ADM_TECH @ org A, no business role). Run from a disposable clone only, copied to apps/api/test/integration/:
//   tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/zz-sec-r1-p6-role-sweep.test.ts
// Expected:
//   AUD: every P6 mutating operation (non-GET, not public) answers 403 (or 404 where a path names a record that does
//        not exist; the sweep fills record ids with random uuids) and writes nothing but denial events.
//   ADM-only: every P6 GET under /transformations/{transformationId} answers 403/404 on an existing transformation,
//        and the scoped search returns no transformation-scoped hit.
// All data is SYNTHETIC; nothing here grants a business approval (G1-G6) or touches DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { operations } from "../support/contract.ts";
import {
  call,
  createTransformationRow,
  seedWorld,
  signIn,
  startApi,
  type Session,
  type TestApi,
  type World,
} from "../support/harness.ts";
import { P6_OPERATION_IDS } from "../support/p6-operations.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

let api: TestApi;
let w: World;
let tid: string;
let aud: Session;
let adm: Session;

const P6 = operations.filter((o) => P6_OPERATION_IDS.has(o.operationId));
const SCOPE_PARAMS = new Set(["transformationId", "organizationId"]);

function fill(path: string, recordIds: Map<string, string>): { url: string; recordParams: string[] } {
  const recordParams: string[] = [];
  const url = path.replace(/\{([^}]+)\}/g, (_m, name: string) => {
    if (name === "transformationId") return tid;
    if (name === "organizationId") return w.orgA.id;
    if (/No$/.test(name)) return "1";
    if (/Code$|code$|Key$|key$|Ref$|locale$|kind$|Kind$|type$|Type$/.test(name) && !/Id$/.test(name)) {
      recordParams.push(name);
      return "synthetic_x";
    }
    recordParams.push(name);
    let id = recordIds.get(name);
    if (!id) {
      id = crypto.randomUUID();
      recordIds.set(name, id);
    }
    return id;
  });
  return { url, recordParams };
}

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  tid = await createTransformationRow(api.db, w.orgA.id, w.a1, w.grantor.id);
  aud = await signIn(api.app, w.auditor.subject);
  adm = await signIn(api.app, w.admin.subject);
  await api.db
    .insertInto("search_document")
    .values({
      id: crypto.randomUUID(),
      organization_id: w.orgA.id,
      transformation_id: tid,
      record_type: "transformation",
      record_id: tid,
      record_version: 1,
      title: "Quillwort synthetic sweep transformation",
      source_audit_seq: "0",
    })
    .onConflict((oc) => oc.constraint("search_document_record_key").doNothing())
    .execute();
}, 120_000);

afterAll(async () => {
  await api?.close();
});

describe("SEC-R1 P6 role sweep", () => {
  it("AUD: every P6 mutating operation is refused (403, or 404 for a non-existent record) and writes nothing", async () => {
    const mutations = P6.filter((o) => o.method !== "GET");
    const rows: string[] = [];
    const bad: string[] = [];
    const before = await api.db
      .selectFrom("audit_event")
      .select((eb) => eb.fn.countAll<string>().as("n"))
      .where("actor_user_id", "=", w.auditor.id)
      .where("action", "not like", "%denied%")
      .executeTakeFirstOrThrow();
    for (const o of mutations) {
      const { url, recordParams } = fill(o.path, new Map());
      const res = await call<Body>(api.app, o.method, url, {
        session: aud,
        body: o.method === "DELETE" ? undefined : {},
        headers: { "if-match": '"1"' },
        contract: false,
      });
      const code = typeof res.body === "object" && res.body !== null ? (res.body.code ?? "") : "";
      rows.push(`${o.method} ${o.path} ${o.operationId} -> ${res.status} ${code} (record params: ${recordParams.join(",") || "none"})`);
      const ok =
        res.status === 403 ||
        res.status === 401 ||
        (res.status === 404 && recordParams.length > 0) ||
        (o.operationId === "receiveWebhook" && res.status === 401);
      if (!ok) bad.push(rows[rows.length - 1]!);
    }
    const after = await api.db
      .selectFrom("audit_event")
      .select((eb) => eb.fn.countAll<string>().as("n"))
      .where("actor_user_id", "=", w.auditor.id)
      .where("action", "not like", "%denied%")
      .executeTakeFirstOrThrow();
    console.log(`[SEC-R1 AUD sweep] ${mutations.length} P6 mutating operations\n${rows.join("\n")}`);
    console.log(`[SEC-R1 AUD sweep] NOT refused as expected: ${bad.length}\n${bad.join("\n")}`);
    console.log(`[SEC-R1 AUD sweep] non-denial audit events by AUD: before ${before.n}, after ${after.n}`);
    expect(Number(after.n)).toBe(Number(before.n));
    expect(bad).toEqual([]);
  }, 600_000);

  it("ADM-only: no P6 transformation-scoped read on an existing transformation; search finds nothing", async () => {
    const reads = P6.filter((o) => o.method === "GET" && o.path.includes("{transformationId}"));
    const rows: string[] = [];
    const bad: string[] = [];
    for (const o of reads) {
      const { url, recordParams } = fill(o.path, new Map());
      const res = await call<Body>(api.app, "GET", url, { session: adm, contract: false });
      rows.push(`GET ${o.path} ${o.operationId} -> ${res.status} (record params: ${recordParams.join(",") || "none"})`);
      if (res.status < 400) bad.push(`${rows[rows.length - 1]} body=${JSON.stringify(res.body).slice(0, 300)}`);
    }
    const search = await call<Body>(api.app, "GET", `/api/v1/search?q=Quillwort`, { session: adm, contract: false });
    const auditorSearch = await call<Body>(api.app, "GET", `/api/v1/search?q=Quillwort`, { session: aud, contract: false });
    console.log(`[SEC-R1 ADM sweep] ${reads.length} P6 transformation-scoped reads\n${rows.join("\n")}`);
    console.log(`[SEC-R1 ADM sweep] answered < 400: ${bad.length}\n${bad.join("\n")}`);
    console.log(`[SEC-R1 ADM sweep] search as ADM-only: ${search.status} ${JSON.stringify(search.body).slice(0, 400)}`);
    console.log(`[SEC-R1 ADM sweep] search as AUD (control, reads org A): ${auditorSearch.status} items=${auditorSearch.body?.items?.length}`);
    expect(bad).toEqual([]);
    expect(search.status === 403 || (search.status === 200 && search.body.items.length === 0)).toBe(true);
  }, 600_000);
});
