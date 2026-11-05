// code-security-reviewer, DG6 round 4 (T-DG6-REV-CS-R4): sweep for REQ-S10-002 "a sensitive benefit is hidden from a
// workstream member without the grant" over the demo dataset. NOT part of the candidate; copied into a disposable
// clone's tests/qa/integration by checks.sh repro and removed afterwards. Demo data is SYNTHETIC. Marking a record
// sensitive is an access decision, never a business approval (G1-G6); nothing here touches DG0-DG7.
//
// Setup: the demo-seeded roaming transformation (rich P1-P6 data). One active demo benefit is given a unique title
// (direct UPDATE in the scratch database, version + 1; synthetic setup only) and marked sensitive by a TO through the
// product route. A Team Lead (TL at the transformation; no grant; not a named party of the benefit) then calls:
//   - every GET operation of docs/api/openapi.yaml whose only path parameter is {transformationId};
//   - the live `registers` report for the benefits register.
// Each body is searched for the unique title. The control TO (sensitive_record.grant) must see it on some routes, and
// the TL must get 404 on the benefit itself. Expected: the TL sees the title nowhere. Every route and answer is logged.
import { operations } from "../../../apps/api/test/support/contract.ts";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { insertAuditEvent, migrate, seedDemo, sql } from "../../../packages/db/src/index.ts";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../packages/db/test/helpers.ts";
import { DEMO_ANCHORS } from "../support/a02.ts";
import { call, createUser, grant, signIn, startApi, type Loose, type Session, type TestApi } from "../support/api.ts";

const T = DEMO_ANCHORS.transformationId;
const ORG = DEMO_ANCHORS.organizationId;
const TITLE = "Synthetic CONFIDENTIAL CS-R4 sweep benefit";

let scratch = "";
let api: TestApi;
let tl: Session;
let to: Session;
let benefitId = "";
let benefitCode = "";

beforeAll(async () => {
  const { adminUrl } = inject("mthDb");
  scratch = await createScratchDatabase(adminUrl, "mth_cs_r4_sweep");
  await migrate(roleUrl(adminUrl, scratch, "mth_owner"));
  await seedDemo(roleUrl(adminUrl, scratch, "mth_owner"), {
    mthEnv: "demo",
    runKind: "seed",
    requestedVia: "cli",
    requestedBy: null,
  });
  api = await startApi({ database: scratch, env: { MTH_ENV: "demo" } });
  const grantor = await createUser(api.db, ORG);
  const l = await createUser(api.db, ORG);
  await grant(api.db, grantor.id, l.id, "TL", { type: "transformation", id: T }, ORG);
  tl = await signIn(api.app, l.subject);
  const o = await createUser(api.db, ORG);
  await grant(api.db, grantor.id, o.id, "TO", { type: "organization", id: ORG } as never, ORG);
  to = await signIn(api.app, o.subject);
  const b = await api.db
    .selectFrom("benefit")
    .select(["id", "code", "title", "version"])
    .where("transformation_id", "=", T)
    .where("status", "=", "active")
    .orderBy("code")
    .executeTakeFirstOrThrow();
  benefitId = b.id;
  benefitCode = b.code;
  console.log("[CS-R4s] benefit", b.code, b.id, "demo title:", b.title);
  // With its audit event in the same transaction (the 0004 guard refuses a mutation without one: attempt 2's log).
  await api.db.transaction().execute(async (tx) => {
    await sql`UPDATE benefit SET title = ${TITLE}, version = version + 1, updated_at = now() WHERE id = ${b.id}`.execute(tx);
    await insertAuditEvent(
      tx,
      { actorType: "user", actorUserId: grantor.id, requestId: `cs-r4-sweep-${b.id}`, source: "api" },
      {
        action: "benefit.update",
        recordType: "benefit",
        recordId: b.id,
        organizationId: ORG,
        transformationId: T,
        priorVersion: b.version,
        newVersion: b.version + 1,
      },
    );
  });
  const mark = await call<Loose>(api.app, "PUT", `/api/v1/transformations/${T}/records/benefit/${b.id}/sensitivity`, {
    session: to,
    headers: { "if-match": '"0"' },
    body: { isSensitive: true, reason: "Synthetic commercially sensitive benefit" },
    contract: false,
  });
  console.log("[CS-R4s] mark sensitive", mark.status, JSON.stringify(mark.body).slice(0, 200));
  expect(mark.status).toBe(200);
}, 300_000);

afterAll(async () => {
  await api?.close();
  if (scratch) await dropScratchDatabase(inject("mthDb").adminUrl, scratch);
}, 60_000);

describe("cs-r4: a sensitive demo benefit over every transformation-scoped GET", () => {
  it("TL (no grant) sees its title nowhere", async () => {
    const tlItem = await call<Loose>(api.app, "GET", `/api/v1/transformations/${T}/benefits/${benefitId}`, {
      session: tl,
      contract: false,
    });
    const toItem = await call<Loose>(api.app, "GET", `/api/v1/transformations/${T}/benefits/${benefitId}`, {
      session: to,
      contract: false,
    });
    console.log("[CS-R4s] benefit item: TL", tlItem.status, "| TO", toItem.status);
    expect(tlItem.status).toBe(404);
    expect(toItem.status).toBe(200);
    const ops: { id: string; path: string }[] = [];
    for (const o of operations) {
      const params = [...o.path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
      if (o.method !== "GET" || params.length !== 1 || params[0] !== "transformationId") continue;
      ops.push({ id: o.operationId, path: o.path.replace("{transformationId}", T) });
    }
    ops.push({
      id: "getLiveReport(registers: benefits)",
      path: `/api/v1/transformations/${T}/reports/registers/live?parameters=${encodeURIComponent('{"register":"benefits"}')}`,
    });
    ops.push({
      id: "getLiveReport(executive_dashboard)",
      path: `/api/v1/transformations/${T}/reports/executive_dashboard/live`,
    });
    console.log("[CS-R4s] operations:", ops.length);
    const leaks: string[] = [];
    let controlSeen = 0;
    for (const op of ops) {
      const r = await call<Loose>(api.app, "GET", op.path, { session: tl, contract: false });
      const c = await call<Loose>(api.app, "GET", op.path, { session: to, contract: false });
      const text = JSON.stringify(r.body);
      const ctext = JSON.stringify(c.body);
      const inTl = text.includes(TITLE);
      const inTo = ctext.includes(TITLE);
      if (inTo) controlSeen += 1;
      if (inTl) {
        const i = text.indexOf(TITLE);
        leaks.push(op.id);
        console.log(`[CS-R4s] LEAK ${op.id} TL ${r.status}: ...${text.slice(Math.max(0, i - 250), i + 120)}...`);
      }
      console.log(`[CS-R4s] ${op.id} TL ${r.status} title=${inTl} | TO ${c.status} title=${inTo}`);
    }
    console.log("[CS-R4s] TO sees the title on", controlSeen, "routes; TL sees it on", leaks.length, JSON.stringify(leaks));
    console.log("[CS-R4s] benefit code", benefitCode);
    expect(controlSeen).toBeGreaterThan(0);
    expect(leaks).toEqual([]);
  }, 900_000);
});
