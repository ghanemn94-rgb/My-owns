// code-security-reviewer DG6 round 2 verification of F-DG6-121, F-DG6-122 and F-DG6-123, plus a probe of the paths the
// T-DG6-BE-Y1 handback lists as not done ("What remains"). NOT part of the candidate; copied into a disposable clone's
// tests/qa/integration by checks.sh (step repro) and removed afterwards. Demo data is SYNTHETIC.
//
// Part A re-runs the round-1 reproductions with the EXPECTATIONS OF A FIXED PRODUCT (each assertion fails if the leak
// is back). Part B probes benefit scenarios: a benefit_scenario_value is a sensitive benefit's value row
// (SENSITIVE_CHILD_SOURCES), its item route answers 404 through the guard, but the scenario list and item embed the
// values, and the value create checks no sensitivity. Part B logs and asserts what it observes, to be read in the log.
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { migrate, seedDemo, sql } from "../../../packages/db/src/index.ts";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../packages/db/test/helpers.ts";
import { DEMO_ANCHORS } from "../support/a02.ts";
import { call, createUser, grant, signIn, startApi, type Loose, type Session, type TestApi } from "../support/api.ts";

const T = DEMO_ANCHORS.transformationId;
const ORG = DEMO_ANCHORS.organizationId;

let scratch = "";
let api: TestApi;
let aud: Session;
let tl: Session;
let to: Session;
let benefitId = "";
let measurementId = "";

beforeAll(async () => {
  const { adminUrl } = inject("mthDb");
  scratch = await createScratchDatabase(adminUrl, "mth_cs_r2_sens");
  await migrate(roleUrl(adminUrl, scratch, "mth_owner"));
  await seedDemo(roleUrl(adminUrl, scratch, "mth_owner"), {
    mthEnv: "demo",
    runKind: "seed",
    requestedVia: "cli",
    requestedBy: null,
  });
  api = await startApi({ database: scratch, env: { MTH_ENV: "demo" } });
  const grantor = await createUser(api.db, ORG);
  const a = await createUser(api.db, ORG);
  await grant(api.db, grantor.id, a.id, "AUD", { type: "organization", id: ORG } as never, ORG);
  aud = await signIn(api.app, a.subject);
  const l = await createUser(api.db, ORG);
  await grant(api.db, grantor.id, l.id, "TL", { type: "transformation", id: T } as never, ORG);
  tl = await signIn(api.app, l.subject);
  const o = await createUser(api.db, ORG);
  await grant(api.db, grantor.id, o.id, "TO", { type: "organization", id: ORG } as never, ORG);
  to = await signIn(api.app, o.subject);
}, 240_000);

afterAll(async () => {
  await api?.close();
  if (scratch) await dropScratchDatabase(inject("mthDb").adminUrl, scratch);
}, 60_000);

async function allTransformationAudit(session: Session): Promise<Loose[]> {
  const out: Loose[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 200; i += 1) {
    const q: string = cursor ? `?limit=100&cursor=${encodeURIComponent(cursor)}` : "?limit=100";
    const r = await call<Loose>(api.app, "GET", `/api/v1/transformations/${T}/audit${q}`, { session });
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(200);
    out.push(...r.body.items);
    cursor = r.body.nextCursor;
    if (!cursor) break;
  }
  return out;
}

const hasContent = (e: Loose) =>
  (e.changes !== null && e.changes !== undefined && Object.keys(e.changes).length > 0) ||
  (e.reason !== null && e.reason !== undefined);

describe("round 2: sensitive benefits", () => {
  it("A: F-DG6-121, F-DG6-122, F-DG6-123 (fixed-product expectations)", async () => {
    const candidates = await sql<{ benefit_id: string }>`
      SELECT m.benefit_id FROM audit_event e JOIN benefit_measurement m ON m.id = e.record_id
       WHERE e.record_type = 'benefit_measurement' AND e.transformation_id = ${T}::uuid
       GROUP BY m.benefit_id ORDER BY count(*) DESC LIMIT 1`.execute(api.db);
    benefitId = candidates.rows[0]!.benefit_id;
    console.log("benefit", benefitId);
    const mark = await call<Loose>(api.app, "PUT", `/api/v1/transformations/${T}/records/benefit/${benefitId}/sensitivity`, {
      session: to,
      headers: { "if-match": '"0"' },
      body: { isSensitive: true, reason: "Synthetic: commercially sensitive figure (cs-r2)." },
    });
    expect(mark.status).toBe(200);

    // The owner (a named party) records a measurement on the now-sensitive benefit (as in round 1).
    const ownerId = (
      await sql<{ id: string }>`SELECT owner_user_id AS id FROM benefit WHERE id = ${benefitId}::uuid`.execute(api.db)
    ).rows[0]!.id;
    const g = await createUser(api.db, ORG);
    const devIssuer = (
      await sql<{ issuer: string }>`SELECT issuer FROM user_identity WHERE user_id = ${g.id}::uuid`.execute(api.db)
    ).rows[0]!.issuer;
    const ownerSubject = `cs-r2-owner-${ownerId.slice(-6)}`;
    await sql`INSERT INTO user_identity (id, user_id, issuer, subject) VALUES (${crypto.randomUUID()}::uuid, ${ownerId}::uuid, ${devIssuer}, ${ownerSubject})`.execute(
      api.db,
    );
    await grant(api.db, g.id, ownerId, "BO", { type: "transformation", id: T } as never, ORG).catch(() => undefined);
    const ownerSession = await signIn(api.app, ownerSubject);
    const measured = await call<Loose>(api.app, "POST", `/api/v1/transformations/${T}/benefits/${benefitId}/measurements`, {
      session: ownerSession,
      body: { periodStart: "2026-09-01", periodEnd: "2026-09-30", amount: "987654.32", attribution: "Synthetic attribution (cs-r2)." },
    });
    console.log("owner measurement", measured.status);
    expect(measured.status).toBe(201);
    measurementId = measured.body.id;

    const tlGet = await call<Loose>(api.app, "GET", `/api/v1/transformations/${T}/benefits/${benefitId}`, { session: tl });
    const audGet = await call<Loose>(api.app, "GET", `/api/v1/transformations/${T}/benefits/${benefitId}`, { session: aud });
    console.log("record GET: TL", tlGet.status, "AUD", audGet.status);
    expect(tlGet.status).toBe(404);
    expect(audGet.status).toBe(404);

    // F-DG6-121: the per-transformation audit trail, TL (not admitted) vs TO (admitted).
    const measurementIds = (
      await sql<{ id: string }>`SELECT id FROM benefit_measurement WHERE benefit_id = ${benefitId}::uuid`.execute(api.db)
    ).rows.map((r) => r.id);
    const tlTrail = await allTransformationAudit(tl);
    const toTrail = await allTransformationAudit(to);
    const ofB = (trail: Loose[]) =>
      trail.filter(
        (e) =>
          (e.recordType === "benefit" && e.recordId === benefitId) ||
          (e.recordType === "benefit_measurement" && measurementIds.includes(e.recordId)),
      );
    const tlOfB = ofB(tlTrail);
    const toOfB = ofB(toTrail);
    console.log(
      "F-DG6-121 TL trail events of B and its measurements:", tlOfB.length,
      "with changes/reason:", tlOfB.filter(hasContent).length,
      "| TO (admitted control):", toOfB.length, "with changes/reason:", toOfB.filter(hasContent).length,
    );
    console.log("F-DG6-121 TL sample:", JSON.stringify(tlOfB.find((e) => e.recordType === "benefit_measurement") ?? null).slice(0, 500));
    expect(tlOfB.length).toBeGreaterThan(0);
    expect(tlOfB.filter(hasContent).length).toBe(0);
    expect(toOfB.filter(hasContent).length).toBeGreaterThan(0);
    // The sensitivity marking event itself (record_sensitivity) carries the reason: redacted for the TL.
    const markEvents = tlTrail.filter((e) => e.recordType === "record_sensitivity");
    console.log("F-DG6-121 TL record_sensitivity events:", markEvents.length, "with content:", markEvents.filter(hasContent).length);
    expect(markEvents.filter(hasContent).length).toBe(0);
    expect(JSON.stringify(tlTrail)).not.toContain("987654.32");

    // F-DG6-122: /audit-events for the AUD.
    const list = await call<Loose>(
      api.app,
      "GET",
      `/api/v1/audit-events?organizationId=${ORG}&transformationId=${T}&recordType=benefit_measurement&limit=100`,
      { session: aud },
    );
    expect(list.status).toBe(200);
    const ofSensitive = (list.body.items as Loose[]).filter((e) => measurementIds.includes(e.recordId));
    console.log(
      "F-DG6-122 AUD measurement events of B:", ofSensitive.length,
      "redacted:", ofSensitive.filter((e) => e.redacted === true).length,
      "with content:", ofSensitive.filter(hasContent).length,
    );
    expect(ofSensitive.length).toBeGreaterThan(0);
    expect(ofSensitive.filter(hasContent).length).toBe(0);
    expect(ofSensitive.every((e) => e.redacted === true)).toBe(true);
    const one = await call<Loose>(api.app, "GET", `/api/v1/audit-events/${ofSensitive[0]!.id}`, { session: aud });
    console.log("F-DG6-122 AUD single event:", one.status, "redacted", one.body?.redacted, "changes", JSON.stringify(one.body?.changes));
    expect(one.body?.redacted).toBe(true);
    const rs = await call<Loose>(
      api.app,
      "GET",
      `/api/v1/audit-events?organizationId=${ORG}&transformationId=${T}&recordType=record_sensitivity&limit=100`,
      { session: aud },
    );
    console.log("F-DG6-122 AUD record_sensitivity events:", rs.body.items.length, "with content:", (rs.body.items as Loose[]).filter(hasContent).length);
    expect((rs.body.items as Loose[]).filter(hasContent).length).toBe(0);
    expect(JSON.stringify(list.body)).not.toContain("987654.32");

    // Guard: the child item route.
    const mItem = await call<Loose>(api.app, "GET", `/api/v1/transformations/${T}/benefit-measurements/${measurementId}`, { session: tl });
    const mItemTo = await call<Loose>(api.app, "GET", `/api/v1/transformations/${T}/benefit-measurements/${measurementId}`, { session: to });
    console.log("guard: TL GET measurement item", mItem.status, "| TO", mItemTo.status);
    expect(mItem.status).toBe(404);
    expect(mItemTo.status).toBe(200);

    // F-DG6-123: form-record sub-resources.
    const FR = `/api/v1/transformations/${T}/form-records/T14/${benefitId}`;
    const toComment = await call<Loose>(api.app, "POST", `${FR}/comments`, {
      session: to,
      body: { body: "Synthetic: restricted - the final rebate figure is 5.1 MSAR (cs-r2)." },
    });
    console.log("TO comment", toComment.status);
    expect(toComment.status).toBe(201);
    const r = {
      versions: await call<Loose>(api.app, "GET", `${FR}/versions`, { session: tl, contract: false }),
      comments: await call<Loose>(api.app, "GET", `${FR}/comments`, { session: tl, contract: false }),
      attachments: await call<Loose>(api.app, "GET", `${FR}/attachments`, { session: tl, contract: false }),
      compare: await call<Loose>(api.app, "GET", `${FR}/compare?fromVersion=1&toVersion=2`, { session: tl, contract: false }),
      customFields: await call<Loose>(api.app, "GET", `${FR}/custom-fields`, { session: tl, contract: false }),
      postComment: await call<Loose>(api.app, "POST", `${FR}/comments`, {
        session: tl,
        body: { body: "Synthetic: TL writes on a record it cannot open (cs-r2)." },
        contract: false,
      }),
    };
    for (const [k, v] of Object.entries(r)) console.log("F-DG6-123 TL", k, v.status, JSON.stringify(v.body).slice(0, 160));
    for (const v of Object.values(r)) expect(v.status).toBe(404);
    const toComments = await call<Loose>(api.app, "GET", `${FR}/comments`, { session: to });
    console.log("F-DG6-123 TO (admitted) comments", toComments.status, toComments.body?.items?.length);
    expect(toComments.status).toBe(200);
  }, 240_000);

  it("B: scenario values of the sensitive benefit (BE-Y1 'What remains')", async () => {
    expect(benefitId).not.toBe("");
    const S = `/api/v1/transformations/${T}/benefit-scenarios`;
    // Find or create an active scenario as the TL (TL holds benefit_scenario.edit).
    const listTl0 = await call<Loose>(api.app, "GET", `${S}?limit=100`, { session: tl });
    console.log("TL scenarios before", listTl0.status, (listTl0.body.items as Loose[]).map((s) => `${s.kind}/${s.status}/case=${s.businessCaseId}/values=${s.values.length}`));
    let scenario = (listTl0.body.items as Loose[]).find((s) => s.status === "active");
    if (!scenario) {
      for (const kind of ["base", "upside", "downside"]) {
        const c = await call<Loose>(api.app, "POST", S, { session: tl, body: { kind, title: `Synthetic ${kind} (cs-r2)` } });
        console.log("TL create scenario", kind, c.status, JSON.stringify(c.body).slice(0, 160));
        if (c.status === 201) {
          scenario = c.body;
          break;
        }
      }
    }
    expect(scenario).toBeDefined();
    console.log("scenario", scenario.id, "case", scenario.businessCaseId);
    // B1: the TL (not admitted to the benefit; 404 on it) adds a scenario value FOR the sensitive benefit.
    const add = await call<Loose>(api.app, "POST", `${S}/${scenario.id}/values`, {
      session: tl,
      body: { benefitId, periodStart: "2031-01-01", periodEnd: "2031-12-31", amount: "424242.42", note: "Synthetic (cs-r2)." },
      contract: false,
    });
    console.log("B1 TL POST scenario value for the sensitive benefit:", add.status, JSON.stringify(add.body).slice(0, 300));
    // B2: an admitted user (TO) adds a value too, if the TL's was refused.
    if (add.status !== 201) {
      const toAdd = await call<Loose>(api.app, "POST", `${S}/${scenario.id}/values`, {
        session: to,
        body: { benefitId, periodStart: "2031-01-01", periodEnd: "2031-12-31", amount: "424242.42", note: "Synthetic (cs-r2)." },
        contract: false,
      });
      console.log("B2 TO POST scenario value:", toAdd.status, JSON.stringify(toAdd.body).slice(0, 200));
    }
    const valueRows = await sql<{ id: string; amount: string }>`
      SELECT id, amount::text FROM benefit_scenario_value WHERE benefit_id = ${benefitId}::uuid`.execute(api.db);
    console.log("scenario values of B in the database:", JSON.stringify(valueRows.rows));
    // B3: what the TL reads.
    const listTl = await call<Loose>(api.app, "GET", `${S}?limit=100`, { session: tl });
    const itemTl = await call<Loose>(api.app, "GET", `${S}/${scenario.id}`, { session: tl });
    const leakedList = (listTl.body.items as Loose[]).flatMap((s) => s.values as Loose[]).filter((v) => v.benefitId === benefitId);
    const leakedItem = ((itemTl.body?.values ?? []) as Loose[]).filter((v) => v.benefitId === benefitId);
    console.log("B3 TL GET scenarios: status", listTl.status, "values of the sensitive benefit:", leakedList.length, JSON.stringify(leakedList).slice(0, 400));
    console.log("B3 TL GET scenario item: status", itemTl.status, "values of the sensitive benefit:", leakedItem.length);
    for (const v of valueRows.rows) {
      const direct = await call<Loose>(api.app, "PATCH", `/api/v1/transformations/${T}/benefit-scenario-values/${v.id}`, {
        session: tl,
        headers: { "if-match": '"1"' },
        body: { note: "Synthetic probe (cs-r2)." },
        contract: false,
      });
      console.log("B4 TL PATCH the value item (guarded route):", direct.status);
    }
    const audList = await call<Loose>(api.app, "GET", `${S}?limit=100`, { session: aud });
    const audLeak = ((audList.body.items ?? []) as Loose[]).flatMap((s) => s.values as Loose[]).filter((v) => v.benefitId === benefitId);
    console.log("B3 AUD GET scenarios: status", audList.status, "values of the sensitive benefit:", audLeak.length);
    // C: the other registers the handback names (logged only).
    const td = await call<Loose>(api.app, "GET", `/api/v1/transformations/${T}/transition-decisions?benefitId=${benefitId}`, { session: tl, contract: false });
    const ca = await call<Loose>(api.app, "GET", `/api/v1/transformations/${T}/corrective-actions?limit=100`, { session: tl, contract: false });
    console.log("C TL transition-decisions of B:", td.status, td.body?.items?.length, "| corrective-actions naming B:", ca.status, ((ca.body?.items ?? []) as Loose[]).filter((c) => c.benefitId === benefitId).length);
    // The observation this part records (a fixed product shows no value of the sensitive benefit to the TL or the AUD).
    expect({ list: leakedList.length, item: leakedItem.length, aud: audLeak.length }).toEqual({ list: 0, item: 0, aud: 0 });
  }, 240_000);
});
