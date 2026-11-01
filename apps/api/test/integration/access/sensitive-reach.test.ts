// The reach of a sensitive record (T-DG6-BE-Y1; F-DG6-121, F-DG6-122, F-DG6-123; ADR-0051 §2; REQ-S10-002), against
// the run's disposable PostgreSQL. Every value is SYNTHETIC. Marking a record or granting access is an access
// decision, never a business approval (G1-G6), and nothing here touches the engineering gates DG0-DG7.
//
// One rule: a user who gets 404 on a sensitive record must not learn its content, or its children's, through any other
// route. Each case below fails on the round-1 candidate and passes with the shared helper (access/sensitive-reach.ts):
//   - F-DG6-121: GET /transformations/{t}/audit redacts (changes and reason null) the events of the sensitive benefit
//     and of its measurements and plan values, and the sensitivity flag's own event, for TL and AUD without admission;
//   - F-DG6-122: /audit-events redacts the events of the children (benefit_measurement, business_case_line) as well as
//     the record's own, for AUD without admission; GET /audit-events/{id} the same;
//   - F-DG6-123: the T14 form-record sub-resources (versions, compare, comments read and write, attachments,
//     custom-fields) are 404 for TL without admission, and the comment write persists nothing;
//   - the sweep: the child item routes (benefit-measurements/{id}, benefit-plan-values/{id}, business-case lines) and
//     the T14 form export follow the same rule;
//   - positive: TO (sensitive_record.grant), the owner (a named party) and TL/AUD after an explicit grant read
//     everything unredacted; plain records are never redacted.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedBenefitWorld, type BenefitWorld } from "../benefits/fixtures.ts";
import { measuredBenefit, submittedValue } from "../benefits/value-fixtures.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import {
  call,
  seedWorld,
  signIn,
  startApi,
  type Res,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

let api: TestApi;
let w: World;
let b: BenefitWorld;
let office: Session; // TO @ organization A: sensitive_record.grant (admitted by §2 rule 3)
let tl: Session; // TL @ the transformation: no named party of the benefit
let aud: Session; // AUD @ organization A: AUD alone admits nothing
let sensitiveId = "";
let plainId = "";
let measurementId = "";
let plainMeasurementId = "";
let planValueId = "";
let caseId = "";
let caseLineId = "";

const BC = "/api/v1/business-cases";
const ok = (res: Res<Body>, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body as Body;
};
const get = (s: Session, url: string) => call<Body>(api.app, "GET", url, { session: s });
const form = (id: string, sub: string) => `${b.base}/form-records/T14/${id}/${sub}`;
const mark = async (type: string, id: string) =>
  ok(
    await call<Body>(api.app, "PUT", `${b.base}/records/${type}/${id}/sensitivity`, {
      session: office,
      headers: ifm(0),
      body: { isSensitive: true, reason: "Synthetic commercially sensitive terms" },
    }),
  );
const measure = async (benefitId: string, amount: string) =>
  ok(
    await call<Body>(api.app, "POST", `${b.base}/benefits/${benefitId}/measurements`, {
      session: b.s.bo,
      body: {
        periodStart: "2026-09-01",
        periodEnd: "2026-09-30",
        amount,
        attribution: "Synthetic attribution for the reach test",
      },
    }),
    201,
  ).id as string;

/** Every event of the transformation trail, through the cursor. */
async function trail(s: Session): Promise<Body[]> {
  const out: Body[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 50; i += 1) {
    const q: string = cursor === null ? "?limit=100" : `?limit=100&cursor=${encodeURIComponent(cursor)}`;
    const page = ok(await get(s, `/api/v1/transformations/${b.transformationId}/audit${q}`));
    out.push(...page.items);
    cursor = page.nextCursor;
    if (cursor === null) break;
  }
  return out;
}
const globalEvents = async (s: Session, recordType: string) =>
  ok(
    await get(
      s,
      `/api/v1/audit-events?organizationId=${b.organizationId}&transformationId=${b.transformationId}&recordType=${recordType}&limit=100`,
    ),
  ).items as Body[];
const of = (events: Body[], recordType: string, recordId: string) =>
  events.filter((e) => e.recordType === recordType && e.recordId === recordId);
const withValues = (events: Body[]) => events.filter((e) => e.changes !== null || e.reason !== null);
const commentCount = async (id: string) =>
  Number(
    (
      await api.db
        .selectFrom("form_record_comment")
        .select((eb) => eb.fn.countAll<string>().as("n"))
        .where("record_id", "=", id)
        .executeTakeFirstOrThrow()
    ).n,
  );
const flagIdOf = async (recordId: string) =>
  (
    await api.db
      .selectFrom("record_sensitivity")
      .select("id")
      .where("record_id", "=", recordId)
      .executeTakeFirstOrThrow()
  ).id;
const grantTo = async (userId: string, recordType: string, recordId: string) =>
  ok(
    await call<Body>(api.app, "POST", "/api/v1/admin/sensitive-grants", {
      session: office,
      body: {
        transformationId: b.transformationId,
        recordType,
        recordId,
        granteeUserId: userId,
        reason: "Synthetic need to know",
      },
    }),
    201,
  );

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  b = await seedBenefitWorld(api, w);
  office = await signIn(api.app, w.office.subject);
  tl = b.s.tl;
  aud = b.s.auditor;
  // Two benefits at Measure (created by BO: owner and creator, the named parties), with a validated baseline.
  sensitiveId = (await measuredBenefit(api, b, { extra: { title: "Synthetic confidential rebate programme" } })).id;
  plainId = (await measuredBenefit(api, b, { extra: { title: "Synthetic open rebate programme" } })).id;
  planValueId = ok(
    await call<Body>(api.app, "POST", `${b.base}/benefits/${sensitiveId}/plan-values`, {
      session: b.s.bo,
      body: { valueKind: "planned", periodStart: "2026-01-01", periodEnd: "2026-12-31", amount: "5100000" },
    }),
    201,
  ).id as string;
  plainMeasurementId = await measure(plainId, "1000.00");
  // A submitted value queues a finance validation (the transformation-level list of the sweep case).
  await submittedValue(api, b, plainId, "2000.00", { periodStart: "2026-08-01", periodEnd: "2026-08-31" });
  // A business case created by TL (so TL is a named party of it: created_by); AUD is not a party.
  caseId = ok(
    await call<Body>(api.app, "POST", BC, {
      session: b.s.tl,
      body: { transformationId: b.transformationId, level: "transformation", title: "Synthetic confidential case" },
    }),
    201,
  ).id as string;
  caseLineId = ok(
    await call<Body>(api.app, "POST", `${BC}/${caseId}/lines`, {
      session: b.s.tl,
      body: {
        lineKind: "investment",
        class: "internal_fte",
        valueBasis: "non_cash",
        title: "Synthetic confidential analysts",
        amount: "750000",
        currency: "SAR",
      },
    }),
    201,
  ).id as string;
  // TL comments on the benefit while it is still open (as in the F-DG6-123 reproduction).
  ok(
    await call<Body>(api.app, "POST", form(sensitiveId, "comments"), {
      session: tl,
      body: { body: "Synthetic: an open remark before marking." },
    }),
    201,
  );
}, 180_000);
afterAll(() => api?.close());

describe("before marking: nothing is redacted or refused (DG1-DG5 unchanged)", () => {
  it("TL and AUD read the benefit's events with their changes, and its form sub-resources", async () => {
    expect(withValues(of(await trail(tl), "benefit", sensitiveId)).length).toBeGreaterThan(0);
    const g = await globalEvents(aud, "benefit_plan_value");
    expect(of(g, "benefit_plan_value", planValueId).every((e) => e.redacted === false)).toBe(true);
    for (const sub of ["versions", "comments", "attachments", "custom-fields"])
      expect([sub, (await get(tl, form(sensitiveId, sub))).status]).toEqual([sub, 200]);
  });
});

describe("after marking: TL, AUD (no grant) are refused content; TO and the owner are admitted", () => {
  beforeAll(async () => {
    await mark("benefit", sensitiveId);
    await mark("business_case", caseId);
    // The owner (a named party) records a value on the now-sensitive benefit; a TO restricted comment.
    measurementId = await measure(sensitiveId, "987654.32");
    await submittedValue(api, b, sensitiveId, "3000.00", { periodStart: "2026-08-01", periodEnd: "2026-08-31" });
    ok(
      await call<Body>(api.app, "POST", form(sensitiveId, "comments"), {
        session: office,
        body: { body: "Synthetic: restricted - the final rebate figure is 5.1 MSAR." },
      }),
      201,
    );
  });

  it("control: TL and AUD get 404 on the benefit itself; TO and the owner read it", async () => {
    for (const s of [tl, aud]) expect((await get(s, `${b.base}/benefits/${sensitiveId}`)).status).toBe(404);
    for (const s of [office, b.s.bo]) ok(await get(s, `${b.base}/benefits/${sensitiveId}`));
  });

  it("F-DG6-121: /transformations/{t}/audit redacts the benefit's events and its children's for TL and AUD", async () => {
    for (const s of [tl, aud]) {
      const events = await trail(s);
      const own = of(events, "benefit", sensitiveId);
      const measured = of(events, "benefit_measurement", measurementId);
      const planned = of(events, "benefit_plan_value", planValueId);
      const flag = of(events, "record_sensitivity", await flagIdOf(sensitiveId));
      const comments = events.filter((e) => e.recordType === "form_record_comment");
      expect(own.length).toBeGreaterThan(0);
      expect(measured.length).toBe(1);
      expect(planned.length).toBeGreaterThan(0);
      for (const e of [...own, ...measured, ...planned, ...flag, ...comments])
        expect([e.recordType, e.changes, e.reason]).toEqual([e.recordType, null, null]);
      // Actor, action, time, record id and versions remain.
      expect(measured[0].action).toBe("benefit_measurement.create");
      // A plain record is never redacted.
      expect(withValues(of(events, "benefit", plainId)).length).toBeGreaterThan(0);
      expect(withValues(of(events, "benefit_measurement", plainMeasurementId)).length).toBeGreaterThan(0);
      expect(JSON.stringify(events)).not.toContain("987654");
    }
  });

  it("F-DG6-121 positive: TO and the owner read the same events with their changes", async () => {
    // The owner holds no audit.read (BO), so the TO is the positive case for this route.
    const events = await trail(office);
    expect(withValues(of(events, "benefit_measurement", measurementId)).length).toBe(1);
    expect(JSON.stringify(of(events, "benefit_measurement", measurementId))).toContain("987654.32");
    const denied = await call<Body>(api.app, "GET", `/api/v1/transformations/${b.transformationId}/audit`, {
      session: b.s.bo,
    });
    expect(denied.status).toBe(403);
  });

  it("F-DG6-122: /audit-events redacts child events (measurements, case lines) for AUD without a grant", async () => {
    const m = of(await globalEvents(aud, "benefit_measurement"), "benefit_measurement", measurementId);
    expect(m.map((e) => [e.redacted, e.changes, e.reason])).toEqual([[true, null, null]]);
    const pm = of(await globalEvents(aud, "benefit_measurement"), "benefit_measurement", plainMeasurementId);
    expect(pm.every((e) => e.redacted === false && e.changes !== null)).toBe(true);
    const lines = of(await globalEvents(aud, "business_case_line"), "business_case_line", caseLineId);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((e) => e.redacted === true && e.changes === null)).toBe(true);
    const one = ok(await get(aud, `/api/v1/audit-events/${m[0].id}`));
    expect([one.redacted, one.changes]).toEqual([true, null]);
    const flag = of(await globalEvents(aud, "record_sensitivity"), "record_sensitivity", await flagIdOf(sensitiveId));
    expect(flag.map((e) => [e.redacted, e.reason])).toEqual([[true, null]]);
    // TO holds no audit_event.read (0100), so the positive case of this route is AUD with a grant (below).
  });

  it("F-DG6-123: the T14 form-record sub-resources are 404 for TL and AUD; 200 for TO and the owner", async () => {
    for (const s of [tl, aud])
      for (const sub of ["versions", "comments", "attachments", "custom-fields", "compare?fromVersion=1&toVersion=2"]) {
        const res = await get(s, form(sensitiveId, sub));
        expect([sub, res.status, res.body.code]).toEqual([sub, 404, "not_found"]);
      }
    for (const s of [office, b.s.bo]) {
      for (const sub of ["versions", "comments", "attachments", "custom-fields"])
        expect([sub, (await get(s, form(sensitiveId, sub))).status]).toEqual([sub, 200]);
      const bodies = (ok(await get(s, form(sensitiveId, "comments"))).items as Body[]).map((c) => c.body);
      expect(bodies).toContain("Synthetic: restricted - the final rebate figure is 5.1 MSAR.");
    }
    // The plain benefit stays readable for TL.
    ok(await get(tl, form(plainId, "versions")));
  });

  it("F-DG6-123 write: TL's comment on the sensitive benefit is 404 and persists nothing", async () => {
    const before = await commentCount(sensitiveId);
    const res = await call<Body>(api.app, "POST", form(sensitiveId, "comments"), {
      session: tl,
      body: { body: "Synthetic: a probe comment." },
    });
    expect([res.status, res.body.code]).toEqual([404, "not_found"]);
    expect(await commentCount(sensitiveId)).toBe(before);
    ok(
      await call<Body>(api.app, "POST", form(plainId, "comments"), {
        session: tl,
        body: { body: "Synthetic: a comment on the open benefit." },
      }),
      201,
    );
  });

  it("sweep: the child item routes and the T14 export follow the same rule", async () => {
    for (const s of [tl, aud]) {
      expect((await get(s, `${b.base}/benefit-measurements/${measurementId}`)).status).toBe(404);
      expect((await get(s, `${b.base}/benefit-plan-values/${planValueId}`)).status).toBe(404);
      ok(await get(s, `${b.base}/benefit-measurements/${plainMeasurementId}`));
      const rows = (ok(await get(s, `${b.base}/form-records/T14/export?format=json`)).rows as Body[]).map(
        (r) => r.recordId,
      );
      expect(rows).toContain(plainId);
      expect(rows).not.toContain(sensitiveId);
    }
    // The sensitive case's lines: 404 for AUD (no party), 200 for TL (its creator, a named party) and TO.
    expect((await get(aud, `${BC}/${caseId}/lines`)).status).toBe(404);
    expect((await get(aud, `/api/v1/transformations/${b.transformationId}/audit`)).status).toBe(200);
    for (const s of [tl, office]) ok(await get(s, `${BC}/${caseId}/lines`));
    for (const s of [office, b.s.bo]) {
      ok(await get(s, `${b.base}/benefit-measurements/${measurementId}`));
      ok(await get(s, `${b.base}/benefit-plan-values/${planValueId}`));
      const rows = (ok(await get(s, `${b.base}/form-records/T14/export?format=json`)).rows as Body[]).map(
        (r) => r.recordId,
      );
      expect(rows).toContain(sensitiveId);
    }
    // The transformation-level finance-validation list (the baseline validations of both benefits): the sensitive
    // benefit's rows are absent for TL and AUD, present for TO.
    const validationsOf = async (s: Session) =>
      (ok(await get(s, `${b.base}/finance-validations?limit=100`)).items as Body[]).map((v) => v.benefitId);
    expect(await validationsOf(office)).toContain(sensitiveId);
    for (const s of [tl, aud]) {
      const list = await validationsOf(s);
      expect(list).toContain(plainId);
      expect(list).not.toContain(sensitiveId);
    }
  });
});

describe("with an explicit grant: TL and AUD are admitted (next request); revocation restores the rule", () => {
  it("TL with a grant reads the events unredacted and the form sub-resources, and may comment", async () => {
    const g = await grantTo(b.users.tl.id, "benefit", sensitiveId);
    const events = await trail(tl);
    expect(withValues(of(events, "benefit_measurement", measurementId)).length).toBe(1);
    ok(await get(tl, form(sensitiveId, "versions")));
    ok(
      await call<Body>(api.app, "POST", form(sensitiveId, "comments"), {
        session: tl,
        body: { body: "Synthetic: a comment with the grant." },
      }),
      201,
    );
    ok(await get(tl, `${b.base}/benefit-measurements/${measurementId}`));
    ok(
      await call<Body>(api.app, "POST", `/api/v1/admin/sensitive-grants/${g.id}/revoke`, {
        session: office,
        headers: ifm(g.version),
        body: { reason: "Synthetic need ended" },
      }),
    );
    expect((await get(tl, form(sensitiveId, "versions"))).status).toBe(404);
    expect(withValues(of(await trail(tl), "benefit_measurement", measurementId))).toEqual([]);
  });

  it("AUD with grants on the benefit and the case reads their child events unredacted", async () => {
    await grantTo(w.auditor.id, "benefit", sensitiveId);
    await grantTo(w.auditor.id, "business_case", caseId);
    const m = of(await globalEvents(aud, "benefit_measurement"), "benefit_measurement", measurementId);
    expect(m.map((e) => e.redacted)).toEqual([false]);
    const lines = of(await globalEvents(aud, "business_case_line"), "business_case_line", caseLineId);
    expect(lines.every((e) => e.redacted === false)).toBe(true);
    expect(withValues(of(await trail(aud), "benefit", sensitiveId)).length).toBeGreaterThan(0);
    ok(await get(aud, form(sensitiveId, "comments")));
    ok(await get(aud, `${BC}/${caseId}/lines`));
  });
});
