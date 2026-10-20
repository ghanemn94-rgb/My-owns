// code-security-reviewer DG5 round 1 sweep (NOT product code; run only in a disposable clone, copied to
// apps/api/test/integration/zz-sec-r1-p5-sweep.test.ts). Synthetic data only.
//
// GENERATED from docs/api/openapi.yaml and apps/api/test/support/p5-operations.ts:
//  (1) AUD (organization scope, inherits) calls EVERY P5 mutating operation, against a real transformation of its
//      organization; every other path parameter is a fresh synthetic id or a plausible code, the body is `{}` (and a
//      plausible If-Match). Expected: never 2xx, and nothing written (the business audit trail does not grow;
//      only access-denial events may appear).
//  (2) An ADM-only caller (seedWorld's admin: ADM_ACCESS + ADM_TECH at organization scope) calls EVERY P5 read whose
//      path names a transformation, on a real transformation of its organization. Expected: never 200 (nothing
//      transformation-scoped is visible to a technical administrator).
//  (3) The same ADM-only caller reads GET /api/v1/me/navigation: printed for the record.
// The status distribution is printed; each non-403 answer of (1) is listed so the reviewer can judge it.
import { readFileSync } from "node:fs";
import { v7 as uuidv7 } from "uuid";
import { parse as parseYaml } from "yaml";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
import { OPENAPI_PATH } from "../support/contract.ts";
import { P5_OPERATION_IDS } from "../support/p5-operations.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
const doc = parseYaml(readFileSync(OPENAPI_PATH, "utf8")) as Json;
const ops: { method: string; path: string; id: string }[] = [];
for (const [p, item] of Object.entries<Json>(doc.paths))
  for (const [m, op] of Object.entries<Json>(item))
    if (["get", "post", "put", "patch", "delete"].includes(m) && P5_OPERATION_IDS.has(op.operationId))
      ops.push({ method: m.toUpperCase(), path: p, id: op.operationId });

const CODES: Record<string, string> = {
  elementType: "phase",
  stableKey: "diagnose",
  configKind: "methodology",
  recordType: "charter",
  procedureCode: "new_transformation_intake",
  stepKey: "capture_intake",
  versionNo: "1",
  stepNo: "1",
  jobCode: "kpi.deviation_scan",
  definitionCode: "gate_pack",
  questionCode: "q01",
  blockRef: "B0004",
  templateCode: "T01",
  gateCode: "G1",
};

let api: TestApi;
let w: World;
let aud: Session;
let adm: Session;
let T: string;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  T = await createTransformationRow(api.db, w.orgA.id, w.a1, w.office.id);
  aud = await signIn(api.app, w.auditor.subject);
  adm = await signIn(api.app, w.admin.subject);
}, 60_000);
afterAll(() => api.close());

const urlOf = (path: string) =>
  path.replace(/\{(\w+)\}/g, (_, name: string) =>
    name === "transformationId" ? T : (CODES[name] ?? (name.endsWith("Id") ? uuidv7() : "x")),
  );

const businessAuditCount = async () =>
  Number(
    (
      await api.db
        .selectFrom("audit_event")
        .select((eb) => eb.fn.countAll().as("n"))
        .where("action", "not like", "authorization.%")
        .where("action", "not like", "auth.%")
        .executeTakeFirstOrThrow()
    ).n,
  );

describe("SEC-R1 P5 sweep", () => {
  it("(1) AUD: no P5 mutation succeeds, nothing is written", async () => {
    const writes = ops.filter((o) => o.method !== "GET");
    const before = await businessAuditCount();
    const sweepStart = new Date();
    const dist = new Map<number, number>();
    const notForbidden: string[] = [];
    const succeeded: string[] = [];
    for (const o of writes) {
      const res = await call<Json>(api.app, o.method, urlOf(o.path), {
        session: aud,
        body: {},
        headers: { "if-match": '"1"', "idempotency-key": `sec-r1-${uuidv7()}` },
        contract: false,
      });
      dist.set(res.status, (dist.get(res.status) ?? 0) + 1);
      if (res.status < 300) succeeded.push(`${o.method} ${o.path} -> ${res.status}`);
      else if (res.status !== 403) notForbidden.push(`${res.status} ${res.body?.code ?? ""} ${o.id}`);
    }
    const after = await businessAuditCount();
    const added = await api.db
      .selectFrom("audit_event")
      .select(["action", "actor_user_id"])
      .select((eb) => eb.fn.countAll().as("n"))
      .where("occurred_at", ">=", sweepStart)
      .groupBy(["action", "actor_user_id"])
      .execute();
    console.log(
      `audit events since the sweep start: ${JSON.stringify(added.map((a) => [a.action, a.actor_user_id === w.auditor.id ? "AUD" : a.actor_user_id, Number(a.n)]))}`,
    );
    console.log(`AUD P5 mutations: ${writes.length}; statuses ${JSON.stringify(Object.fromEntries(dist))}`);
    console.log(`AUD non-403 answers (${notForbidden.length}):\n  ${notForbidden.join("\n  ")}`);
    console.log(`business audit events before ${before}, after ${after}`);
    expect(succeeded).toEqual([]);
    expect(after).toBe(before);
  }, 300_000);

  it("(2) ADM-only: no transformation-scoped P5 read answers 200", async () => {
    const reads = ops.filter((o) => o.method === "GET" && o.path.includes("{transformationId}"));
    const dist = new Map<number, number>();
    const visible: string[] = [];
    for (const o of reads) {
      const res = await call<Json>(api.app, "GET", urlOf(o.path), { session: adm, contract: false });
      dist.set(res.status, (dist.get(res.status) ?? 0) + 1);
      if (res.status < 300) visible.push(`${o.id} ${o.path} -> ${res.status}`);
    }
    console.log(`ADM-only transformation-scoped P5 reads: ${reads.length}; statuses ${JSON.stringify(Object.fromEntries(dist))}`);
    console.log(`ADM-only 2xx (${visible.length}):\n  ${visible.join("\n  ")}`);
    expect(visible).toEqual([]);
  }, 300_000);

  it("(3) ADM-only navigation (printed)", async () => {
    const res = await call<Json>(api.app, "GET", "/api/v1/me/navigation", { session: adm, contract: false });
    console.log(
      "ADM-only navigation",
      res.status,
      JSON.stringify((res.body?.areas ?? []).map((a: Json) => [a.code, (a.items ?? []).map((i: Json) => i.code)])),
    );
    expect(res.status).toBe(200);
  });
});
