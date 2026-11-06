// code-security-reviewer, DG6 round 5 (T-DG6-REV-CS-R5): focused reproduction of two REQ-S10-002 / ADR-0051 §2 leaks
// found by zz-cs-r5-sens-beyond-sweep.test.ts (part B), on routes the BE-Z5 sweep never reaches because they require
// ?organizationId= (its bare GET answers 400):
//   1. getExecutiveOverview (GET /api/v1/overview): the "value" area lists every benefit of the scope as an item with
//      code, title and validated value; apps/api/src/modules/reporting/executive-overview.ts applies no
//      dashboardRestriction / withoutRestrictedItems (transformation.ts and workstream.ts do);
//   2. getDashboardDrilldown metric=value.gap with the benefit's value class: the items are the benefit's planned and
//      validated LINES, recordType benefit_plan_value (planned) or benefit_measurement, labelled "<title> (planned)"
//      with the line's amount; dashboards/restricted.ts hides() knows benefit, benefit_measurement, business_case and
//      business_case_line but not benefit_plan_value, so the planned lines of a restricted benefit are listed.
// NOT part of the candidate: copied into a disposable clone's tests/qa/integration by checks.sh repro, removed after.
// Demo data is SYNTHETIC. Marking a record sensitive is an access decision, never a business approval (G1-G6); nothing
// here touches DG0-DG7. The assertions state the EXPECTED behaviour, so on a leaking candidate they fail (red by design).
import { insertAuditEvent, migrate, seedDemo, sql } from "../../../packages/db/src/index.ts";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { DEMO_ANCHORS } from "../../../packages/db/src/demo/data/kpis.ts";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../packages/db/test/helpers.ts";
import { call, createUser, grant, signIn, startApi, type Session, type TestApi } from "../../../apps/api/test/support/harness.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const T = DEMO_ANCHORS.transformationId;
const ORG = DEMO_ANCHORS.organizationId;
const TITLE = "Synthetic CONFIDENTIAL CS-R5 overview benefit";
let api: TestApi;
let scratch: string | null = null;
let to: Session;
let tl: Session;
let aud: Session;
const S = { benefitId: "", code: "", valueClass: "", planLineIds: [] as string[] };
const log = (...a: unknown[]) => console.log("[CS-R5-OD]", ...a);
const get = (path: string, session: Session) => call<Body>(api.app, "GET", path, { session, contract: false });
/** Every object in a body that names the benefit (recordId = the benefit or one of its plan lines, or its title). */
const mentions = (body: Body): Body[] => {
  const out: Body[] = [];
  const walk = (x: Body) => {
    if (x === null || typeof x !== "object") return;
    if (!Array.isArray(x) && (x.recordId === S.benefitId || S.planLineIds.includes(x.recordId) || (typeof x.label === "string" && x.label.includes(TITLE))))
      out.push(x);
    for (const v of Object.values(x)) walk(v);
  };
  walk(body);
  return out;
};

beforeAll(async () => {
  const { adminUrl } = inject("mthDb");
  scratch = await createScratchDatabase(adminUrl, "mth_cs_r5_od");
  await migrate(roleUrl(adminUrl, scratch, "mth_owner"));
  await seedDemo(roleUrl(adminUrl, scratch, "mth_owner"), { mthEnv: "demo", runKind: "seed", requestedVia: "cli", requestedBy: null });
  api = await startApi({ database: scratch, env: { MTH_ENV: "demo" } });
  const grantor = DEMO_ANCHORS.users.sp;
  const mk = async (role: string, s: { type: "organization" | "transformation"; id: string }) => {
    const u = await createUser(api.db, ORG);
    await grant(api.db, grantor, u.id, role, s, ORG);
    return u;
  };
  to = await signIn(api.app, (await mk("TO", { type: "organization", id: ORG })).subject);
  tl = await signIn(api.app, (await mk("TL", { type: "transformation", id: T })).subject);
  aud = await signIn(api.app, (await mk("AUD", { type: "organization", id: ORG })).subject);
  const b = await api.db
    .selectFrom("benefit")
    .select(["id", "code", "version", "value_class"])
    .where("transformation_id", "=", T)
    .where("status", "=", "active")
    .orderBy("code")
    .executeTakeFirstOrThrow();
  S.benefitId = b.id;
  S.code = b.code;
  S.valueClass = b.value_class;
  S.planLineIds = (await api.db.selectFrom("benefit_plan_value").select("id").where("benefit_id", "=", b.id).execute()).map((r) => r.id);
  log(`benefit ${b.code} ${b.id} value_class=${b.value_class} plan lines=${S.planLineIds.length}`);
  await api.db.transaction().execute(async (tx) => {
    await sql`UPDATE benefit SET title = ${TITLE}, version = version + 1, updated_at = now() WHERE id = ${b.id}::uuid`.execute(tx);
    await insertAuditEvent(
      tx,
      { actorType: "user", actorUserId: grantor, requestId: `cs-r5-od-${b.id}`, source: "api" },
      { action: "benefit.update", recordType: "benefit", recordId: b.id, organizationId: ORG, transformationId: T, priorVersion: b.version, newVersion: b.version + 1 },
    );
  });
  const mark = await call<Body>(api.app, "PUT", `/api/v1/transformations/${T}/records/benefit/${b.id}/sensitivity`, {
    session: to,
    headers: { "if-match": '"0"' },
    body: { isSensitive: true, reason: "Synthetic commercially sensitive benefit" },
  });
  expect(mark.status, JSON.stringify(mark.body)).toBe(200);
}, 600_000);

afterAll(async () => {
  await api?.close();
  if (scratch !== null) await dropScratchDatabase(inject("mthDb").adminUrl, scratch);
}, 60_000);

describe("CS-R5: getExecutiveOverview and the value.gap drill-down for a reader not admitted to a sensitive benefit", () => {
  it("control: TL and AUD get 404 on the benefit; the per-transformation dashboard omits it for them", async () => {
    for (const [who, s] of [["TL", tl], ["AUD", aud]] as const) {
      expect((await get(`/api/v1/transformations/${T}/benefits/${S.benefitId}`, s)).status, who).toBe(404);
      const d = await get(`/api/v1/transformations/${T}/dashboard`, s);
      log(`control ${who} transformation dashboard ${d.status}: mentions=${mentions(d.body).length} includesRestrictedRecords=${d.body?.includesRestrictedRecords}`);
      expect(d.status, who).toBe(200);
      expect(mentions(d.body), `${who}: transformation dashboard`).toEqual([]);
    }
    const d = await get(`/api/v1/transformations/${T}/dashboard`, to);
    log(`control TO transformation dashboard: mentions=${mentions(d.body).length}`);
    expect(mentions(d.body).length).toBeGreaterThan(0);
  });

  it("getExecutiveOverview: no item of the sensitive benefit for TL or AUD", async () => {
    const bad: string[] = [];
    for (const [who, s] of [["TL", tl], ["AUD", aud]] as const)
      for (const q of [`organizationId=${ORG}`, `organizationId=${ORG}&transformationId=${T}`]) {
        const r = await get(`/api/v1/overview?${q}`, s);
        const m = mentions(r.body);
        log(`overview ${who} ?${q} -> ${r.status} includesRestrictedRecords=${r.body?.includesRestrictedRecords} mentions=${JSON.stringify(m).slice(0, 900)}`);
        if (m.length > 0) bad.push(`${who} ?${q}: ${m.length}`);
      }
    expect(bad).toEqual([]);
  });

  it("getDashboardDrilldown value.gap (the benefit's value class): no line of the sensitive benefit for TL or AUD", async () => {
    const bad: string[] = [];
    for (const [who, s] of [["TL", tl], ["AUD", aud], ["TO (admitted)", to]] as const) {
      const r = await get(
        `/api/v1/dashboard-drilldown?metric=value.gap&valueClass=${S.valueClass}&organizationId=${ORG}&transformationId=${T}&limit=100`,
        s,
      );
      const m = mentions(r.body);
      log(`drill value.gap ${who} -> ${r.status} includesRestrictedRecords=${r.body?.includesRestrictedRecords} mentions=${JSON.stringify(m).slice(0, 900)}`);
      if (!who.startsWith("TO") && m.length > 0) bad.push(`${who}: ${m.map((x: Body) => `${x.recordType}:${x.label}`).join(", ")}`);
    }
    // the value-state drill of the same class, for comparison (items are benefits: hidden)
    const v = await get(`/api/v1/dashboard-drilldown?metric=value.planned&valueClass=${S.valueClass}&organizationId=${ORG}&transformationId=${T}&limit=100`, tl);
    log(`drill value.planned TL -> ${v.status} mentions=${mentions(v.body).length}`);
    expect(bad).toEqual([]);
  });
});
