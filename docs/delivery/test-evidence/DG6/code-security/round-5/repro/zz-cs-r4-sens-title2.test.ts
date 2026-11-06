// code-security-reviewer, DG6 round 4 (T-DG6-REV-CS-R4): second reproduction for REQ-S10-002 "a sensitive benefit is
// hidden from a workstream member without the grant" (ADR-0051 §2: "Lists, search, exports, assistant retrieval: the
// row is absent"). Extends zz-cs-r4-sens-title.test.ts (whose run log is 40-repro-sens-title.log) to the live
// `registers` report, a stored report snapshot, G6 live readiness (with a G6 instance inserted as
// p4-exercises-be-j.ts approveG6Synthetic does, but NOT approved) and the export refusal (control).
// Run ONLY in a disposable clone (checks.sh repro). Every value is SYNTHETIC. Marking a record sensitive is an access
// decision, never a business approval (G1-G6); nothing here touches DG0-DG7.
import { insertAuditEvent } from "../../../packages/db/src/index.ts";
import { randomUUID as uuidv7 } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, seedWorld, startApi, type Res, type Session, type TestApi, type World } from "../../../apps/api/test/support/harness.ts";
import { ifm } from "../../../apps/api/test/support/p2-fixtures.ts";
import {
  launchedInitiative,
  pendingBenefit,
  seedClosureWorld,
  type ClosureWorld,
} from "../../../apps/api/test/integration/contract/p4-exercises-be-j.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
let api: TestApi;
let w: World;
let c: ClosureWorld;
const S = { benefitId: "", code: "", title: "Synthetic CONFIDENTIAL CS-R4b tariff uplift", planned: "" };
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call<Body>(api.app, m, u, o);
const ok = (res: Res<Body>, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body as Body;
};
const log = (...a: unknown[]) => console.log("[CS-R4b]", ...a);

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  c = await seedClosureWorld(api, w);
  const ini = await launchedInitiative(api.db, c.b);
  const sb = await pendingBenefit(api, c, ini);
  S.benefitId = sb.id;
  S.code = sb.code;
  let cur = ok(await send("GET", `${c.b.base}/benefits/${sb.id}`, { session: c.b.s.bo }));
  ok(
    await send("PATCH", `${c.b.base}/benefits/${sb.id}`, {
      session: c.b.s.bo,
      headers: ifm(cur.version),
      body: { title: S.title },
    }),
  );
  cur = ok(await send("GET", `${c.b.base}/benefits/${sb.id}`, { session: c.b.s.bo }));
  const pv = await send("PATCH", `${c.b.base}/benefits/${sb.id}`, {
    session: c.b.s.bo,
    headers: ifm(cur.version),
    body: { plannedValue: "7654321.1234" },
  });
  log("plannedValue PATCH", pv.status, pv.status === 200 ? pv.body.plannedValue : JSON.stringify(pv.body).slice(0, 300));
  if (pv.status === 200) S.planned = "7654321";
  // A G6 instance (not approved), as the closure fixture inserts it, so the live readiness can be read.
  const def = await api.db
    .selectFrom("gate_definition")
    .select("default_approver_role_code")
    .where("code", "=", "G6")
    .executeTakeFirstOrThrow();
  const gid = uuidv7();
  await api.db.transaction().execute(async (tx) => {
    await tx
      .insertInto("gate_instance")
      .values({
        id: gid,
        organization_id: c.b.organizationId,
        transformation_id: c.b.transformationId,
        gate_code: "G6",
        approver_role_code: def.default_approver_role_code,
        created_by: c.b.users.tl.id,
        updated_by: c.b.users.tl.id,
      })
      .execute();
    await insertAuditEvent(
      tx,
      { actorType: "user", actorUserId: c.b.users.tl.id, requestId: `cs-r4-g6-${gid}`, source: "api" },
      {
        action: "gate_instance.create",
        recordType: "gate_instance",
        recordId: gid,
        organizationId: c.b.organizationId,
        transformationId: c.b.transformationId,
        newVersion: 1,
      },
    );
  });
  ok(
    await send("PUT", `${c.b.base}/records/benefit/${sb.id}/sensitivity`, {
      session: c.s.to.session,
      headers: ifm(0),
      body: { isSensitive: true, reason: "Synthetic commercially sensitive benefit" },
    }),
  );
}, 240_000);
afterAll(() => api?.close());

const live = () => `${c.b.base}/reports/registers/live?parameters=${encodeURIComponent('{"register":"benefits"}')}`;
/** The register report's row of the sensitive benefit, or null. */
const rowOf = (doc: Body): Body | null => {
  const text = JSON.stringify(doc);
  if (!text.includes(S.benefitId)) return null;
  const found: Body[] = [];
  const walk = (x: Body) => {
    if (x === null || typeof x !== "object") return;
    if (x.recordId === S.benefitId && Array.isArray(x.cells)) found.push(x);
    for (const v of Object.values(x)) walk(v);
  };
  walk(doc);
  return found[0] ?? null;
};

describe("REQ-S10-002: a sensitive benefit in reports and G6 readiness (CS-R4b)", () => {
  it("control: TL gets 404 on the benefit; the TO reads it", async () => {
    expect((await send("GET", `${c.b.base}/benefits/${S.benefitId}`, { session: c.b.s.tl })).status).toBe(404);
    expect((await send("GET", `${c.b.base}/benefits/${S.benefitId}`, { session: c.s.to.session })).status).toBe(200);
  });

  it("TL: the live benefits register report does not hold the sensitive benefit", async () => {
    const r = await send("GET", live(), { session: c.b.s.tl });
    const row = rowOf(r.body);
    log("live registers/benefits as TL", r.status, "row:", JSON.stringify(row)?.slice(0, 1500));
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body).includes(S.title), "title in the live report").toBe(false);
    expect(row, "the sensitive benefit's row in the live report").toBeNull();
  });

  it("TL: a report snapshot TL generates and then reads does not hold the sensitive benefit", async () => {
    const g = await send("POST", `${c.b.base}/reports/registers/generate`, {
      session: c.b.s.tl,
      body: { parameters: { register: "benefits" } },
    });
    log("generate as TL", g.status, JSON.stringify(g.body).slice(0, 300));
    expect(g.status).toBe(201);
    const snap = await send("GET", `${c.b.base}/report-snapshots/${g.body.id}`, { session: c.b.s.tl });
    const row = rowOf(snap.body);
    log("snapshot as TL", snap.status, "row:", JSON.stringify(row)?.slice(0, 600));
    // and as AUD (read-only, no grant)
    const aud = await send("GET", `${c.b.base}/report-snapshots/${g.body.id}`, { session: c.b.s.auditor });
    log("snapshot as AUD", aud.status, "title present:", JSON.stringify(aud.body).includes(S.title));
    expect(JSON.stringify(snap.body).includes(S.title), "title in the stored snapshot").toBe(false);
  });

  it("control: exporting the live selection is refused for TL (export.includes_restricted_records)", async () => {
    const e = await send("POST", `${c.b.base}/exports`, {
      session: c.b.s.tl,
      body: { definitionCode: "registers", parameters: { register: "benefits" }, format: "csv" },
    });
    log("export start as TL", e.status, JSON.stringify(e.body).slice(0, 300));
  });

  it("TL: the G6 live readiness does not name the sensitive benefit", async () => {
    const r = await send("GET", `${c.b.base}/gates/G6`, { session: c.b.s.tl });
    const text = JSON.stringify(r.body);
    const i = text.indexOf(S.title);
    log("gates/G6 as TL", r.status, i < 0 ? "(no title)" : text.slice(Math.max(0, i - 300), i + 200));
    expect(r.status).toBe(200);
    expect(text.includes(S.title), "title in the G6 readiness").toBe(false);
  });
});
