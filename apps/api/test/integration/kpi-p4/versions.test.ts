// KPI dictionary v2 and KPI versions against a real PostgreSQL (T-DG4-KBE-B; ADR-0027 §1, §2, §11-§13; REQ-S07-001):
//  - REQ-S07-001 A05 "a KPI definition persists all listed fields; one without polarity, unit or aggregation rule is
//    rejected": the DG2 create without polarity or unit is 400 (unchanged); a version without an aggregation rule
//    cannot be activated (422 kpi_version.aggregation_rule_required); the dictionary entry returns every field;
//  - the content rules and refusal texts of ADR-0027 §13 (exact), version numbering, one draft, change reason;
//  - activation order: definition active, complete, business approval, no cycle; supersede then activate in one
//    transaction, one audit event each, one kpi.version_activated outbox event (key <event>:<id>:<versionNo>);
//  - updateKpiDefinition of a KPI that has a version: 422 kpi_definition.measure_locked (D-091 (2));
//  - every mutation: If-Match 428/409, one audit event, AUD 403, ADM-only 403, nothing written on a refusal.
// All data is synthetic; nothing here grants a business approval or touches the engineering gates DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  auditOf,
  call,
  seedWorld,
  signIn,
  startApi,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { seedKpiWorld, type KpiWorld } from "../kpi/fixtures.ts";
import { afterIdentity, endSessions, revokeAll } from "../calendar/session-lock.ts";
import { activeVersion, createKpi, FLOW_VERSION, freshUser, ifMatch, postVersion } from "./kbe-b-fixtures.ts";

let api: TestApi;
let w: World;
let k: KpiWorld;
let adm: Session;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  k = await seedKpiWorld(api, w);
  adm = await signIn(api.app, w.admin.subject); // ADM_ACCESS + ADM_TECH only
}, 60_000);
afterAll(() => api.close());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const problem = (res: { status: number; body: Body }, status: number, code: string, detail?: string) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  expect(res.body.code).toBe(code);
  if (detail !== undefined) expect(res.body.detail).toBe(detail);
};
const versionCount = async (kpiId: string) =>
  (await api.db.selectFrom("kpi_version").select("id").where("kpi_definition_id", "=", kpiId).execute()).length;

describe("REQ-S07-001: the dictionary entry holds every listed field", () => {
  it("the DG2 create without polarity or unit is still 400; a complete active version reads back every field", async () => {
    const noPolarity = await call(api.app, "POST", `${k.base}/kpi-definitions`, {
      session: k.s.kds,
      body: { name: "No polarity", unitKind: "count" },
    });
    expect(noPolarity.status).toBe(400);
    const noUnit = await call(api.app, "POST", `${k.base}/kpi-definitions`, {
      session: k.s.kds,
      body: { name: "No unit", polarity: "higher_is_better" },
    });
    expect(noUnit.status).toBe(400);

    const kpi = await createKpi(api, k, {
      name: "Prepaid churn rate",
      unitKind: "percentage",
      unitLabel: "%",
      polarity: "lower_is_better",
    });
    const body = {
      measureType: "lower_is_better",
      valueNature: "ratio",
      entryScopeKind: "business_unit",
      numeratorLabel: "Lines lost in the period",
      denominatorLabel: "Lines at the start of the period",
      calculationDescription: "Lines lost / lines at period start.",
      aggregationRule: "weighted_ratio",
      ytdStartMonth: 1,
      baselineValue: "0.031",
      baselineDate: "2026-01-31",
      targetValue: "0.025",
      targetDate: "2027-12-31",
      dataQuality: { staleAfterDays: 40, validMin: "0", validMax: "1", evidenceRequired: true },
      submissionRoute: "review",
      reviewerPartyCode: "BO",
      definitionApproval: "direct",
    };
    const v = await activeVersion(api, k, kpi.id, body);
    const entry = await call(api.app, "GET", `${k.base}/kpi-definitions/${kpi.id}/dictionary-entry`, {
      session: k.s.auditor,
    });
    expect(entry.status).toBe(200);
    const d = entry.body.definition;
    const a = entry.body.activeVersion;
    // Name, description, purpose, owner, steward, unit, frequency, polarity, source, leading/lagging (definition) ...
    expect(Object.keys(d)).toEqual(
      expect.arrayContaining([
        "name",
        "description",
        "businessPurpose",
        "ownerUserId",
        "stewardUserId",
        "unitKind",
        "frequency",
        "polarity",
        "dataSource",
        "isLeading",
      ]),
    );
    // ... numerator/denominator, calculation, baseline + date, target + date, aggregation rule, data-quality rule,
    // reporting period (frequency + YTD start), approval policy (version).
    expect(a).toMatchObject({
      id: v.id,
      status: "active",
      unitKind: "percentage",
      frequency: "monthly",
      numeratorLabel: "Lines lost in the period",
      denominatorLabel: "Lines at the start of the period",
      calculationMethod: "entered",
      calculationDescription: "Lines lost / lines at period start.",
      aggregationRule: "weighted_ratio",
      baselineValue: "0.031",
      baselineDate: "2026-01-31",
      targetValue: "0.025",
      targetDate: "2027-12-31",
      ytdStartMonth: 1,
      dataQuality: { staleAfterDays: 40, validMin: "0", validMax: "1", evidenceRequired: true },
      submissionRoute: "review",
      reviewerPartyCode: "BO",
      definitionApproval: "direct",
      entryScopeKind: "business_unit",
    });
    // Phased trajectory: not yet approved, so the entry says what still blocks P4 use.
    expect(entry.body.missingForUse).toEqual(["approved_trajectory"]);
    const dict = await call(api.app, "GET", `${k.base}/kpi-dictionary?limit=100`, { session: k.s.auditor });
    expect(dict.status).toBe(200);
    expect((dict.body.items as Body[]).find((e) => e.definition.id === kpi.id)?.activeVersion?.id).toBe(v.id);
  });

  it("a version without an aggregation rule is a draft; activating it is 422 kpi_version.aggregation_rule_required", async () => {
    const kpi = await createKpi(api, k);
    const draft = await postVersion(api, k, kpi.id, {
      measureType: "higher_is_better",
      valueNature: "flow",
      submissionRoute: "direct_accept",
    });
    expect([draft.status, draft.body.status, draft.body.aggregationRule, draft.body.versionNo]).toEqual([
      201,
      "draft",
      null,
      1,
    ]);
    expect(draft.headers.location).toBe(`/api/v1/transformations/${k.transformationId}/kpi-versions/${draft.body.id}`);
    const res = await call(api.app, "POST", `${k.base}/kpi-versions/${draft.body.id}/activate`, {
      session: k.s.kds,
      headers: ifMatch(1),
    });
    problem(
      res,
      422,
      "kpi_version.aggregation_rule_required",
      "A KPI version needs an aggregation rule before it can be activated.",
    );
    const entry = await call(api.app, "GET", `${k.base}/kpi-definitions/${kpi.id}/dictionary-entry`, {
      session: k.s.kds,
    });
    expect(entry.body).toMatchObject({
      activeVersion: null,
      draftVersionId: draft.body.id,
      missingForUse: ["active_version", "aggregation_rule", "approved_trajectory"],
    });
    const after = await call(api.app, "GET", `${k.base}/kpi-versions/${draft.body.id}`, { session: k.s.kds });
    expect([after.body.status, after.body.version]).toEqual(["draft", 1]);
  });
});

describe("content rules (ADR-0027 §13 exact texts)", () => {
  it("measure type must fit the polarity; band, milestone, ratio, reviewer, aggregation and custom-formula rules", async () => {
    const lower = await createKpi(api, k, { polarity: "lower_is_better" });
    problem(
      await postVersion(api, k, lower.id, { measureType: "higher_is_better", valueNature: "flow" }),
      422,
      "kpi_version.measure_mismatch",
      "The measure type higher_is_better does not fit the KPI's polarity lower_is_better.",
    );
    const band = await createKpi(api, k, { polarity: "within_band" });
    problem(
      await postVersion(api, k, band.id, { measureType: "acceptable_band", valueNature: "stock", bandLower: "5" }),
      422,
      "kpi_version.band_required",
      "An acceptable-band measure needs a lower and an upper bound, and the lower bound cannot be above the upper bound.",
    );
    problem(
      await postVersion(api, k, band.id, {
        measureType: "acceptable_band",
        valueNature: "stock",
        bandLower: "9",
        bandUpper: "5",
      }),
      422,
      "kpi_version.band_required",
    );
    const higher = await createKpi(api, k);
    problem(
      await postVersion(api, k, higher.id, {
        measureType: "higher_is_better",
        valueNature: "flow",
        aggregationRule: "last_value",
      }),
      422,
      "kpi_version.aggregation_not_allowed",
      "The aggregation rule last_value cannot be used for a flow KPI. Use sum for flows, last value for stocks, weighted ratio for ratios, none for milestones, or an approved custom formula.",
    );
    problem(
      await postVersion(api, k, higher.id, {
        measureType: "higher_is_better",
        valueNature: "flow",
        aggregationRule: "custom_formula",
      }),
      422,
      "kpi_version.custom_formula_needs_approval",
      "A custom aggregation formula needs a formula calculation and the business-approval policy.",
    );
    problem(
      await postVersion(api, k, higher.id, {
        measureType: "higher_is_better",
        valueNature: "flow",
        submissionRoute: "review",
      }),
      422,
      "kpi_version.reviewer_required",
      "The review route needs a reviewer role, and the direct-accept route has none.",
    );
    problem(
      await postVersion(api, k, higher.id, {
        measureType: "higher_is_better",
        valueNature: "flow",
        submissionRoute: "direct_accept",
        reviewerPartyCode: "BO",
      }),
      422,
      "kpi_version.reviewer_required",
    );
    problem(
      await postVersion(api, k, higher.id, { ...FLOW_VERSION, submissionRoute: "review", reviewerPartyCode: "NOPE" }),
      422,
      "validation.reference",
    );
    // Nothing was written by any refusal.
    expect([await versionCount(lower.id), await versionCount(band.id), await versionCount(higher.id)]).toEqual([
      0, 0, 0,
    ]);
  });

  it("ratio labels and the milestone due date are required to activate, with their own codes", async () => {
    const ratio = await createKpi(api, k, { unitKind: "percentage", unitLabel: "%", polarity: "lower_is_better" });
    const r = await postVersion(api, k, ratio.id, {
      measureType: "lower_is_better",
      valueNature: "ratio",
      aggregationRule: "weighted_ratio",
      submissionRoute: "direct_accept",
      numeratorLabel: "Lost",
    });
    expect(r.status).toBe(201);
    problem(
      await call(api.app, "POST", `${k.base}/kpi-versions/${r.body.id}/activate`, {
        session: k.s.kds,
        headers: ifMatch(1),
      }),
      422,
      "kpi_version.ratio_labels_required",
      "A ratio KPI needs a numerator and a denominator.",
    );
    const ms = await createKpi(api, k);
    const m = await postVersion(api, k, ms.id, {
      measureType: "binary_milestone",
      valueNature: "milestone",
      aggregationRule: "none",
      submissionRoute: "direct_accept",
    });
    expect(m.status).toBe(201);
    problem(
      await call(api.app, "POST", `${k.base}/kpi-versions/${m.body.id}/activate`, {
        session: k.s.kds,
        headers: ifMatch(1),
      }),
      422,
      "kpi_version.milestone_due_date_required",
      "A binary milestone measure needs a due date.",
    );
    const fixed = await call(api.app, "PATCH", `${k.base}/kpi-versions/${m.body.id}`, {
      session: k.s.kds,
      headers: ifMatch(1),
      body: { milestoneDueDate: "2027-03-31" },
    });
    expect(fixed.status).toBe(200);
    const act = await call(api.app, "POST", `${k.base}/kpi-versions/${m.body.id}/activate`, {
      session: k.s.kds,
      headers: ifMatch(2),
    });
    expect([act.status, act.body.status, act.body.milestoneDueDate]).toEqual([200, "active", "2027-03-31"]);
  });
});

describe("version lifecycle", () => {
  it("one draft; version 2 needs a change reason; activation supersedes the previous version (one audit event each, one outbox event)", async () => {
    const kpi = await createKpi(api, k);
    const v1 = await activeVersion(api, k, kpi.id);
    const dup = await postVersion(api, k, kpi.id, { ...FLOW_VERSION, changeReason: "First change." });
    expect(dup.status).toBe(201);
    problem(
      await postVersion(api, k, kpi.id, { ...FLOW_VERSION, changeReason: "Second draft." }),
      409,
      "kpi_version.draft_exists",
      "This KPI already has a draft version. Change or withdraw it first.",
    );
    const wd = await call(api.app, "POST", `${k.base}/kpi-versions/${dup.body.id}/withdraw`, {
      session: k.s.kds,
      headers: ifMatch(1),
      body: { reason: "Wrong draft." },
    });
    expect([wd.status, wd.body.status, wd.body.withdrawnBy, wd.body.withdrawReason]).toEqual([
      200,
      "withdrawn",
      k.users.kds.id,
      "Wrong draft.",
    ]);
    problem(
      await call(api.app, "PATCH", `${k.base}/kpi-versions/${dup.body.id}`, {
        session: k.s.kds,
        headers: ifMatch(2),
        body: { unitLabel: "x" },
      }),
      422,
      "kpi_version.not_draft",
      "Only a draft KPI version can be changed, activated or withdrawn.",
    );
    problem(
      await postVersion(api, k, kpi.id, FLOW_VERSION),
      422,
      "kpi_version.change_reason_required",
      "A new version of a KPI needs a reason for the change.",
    );
    const v3 = await postVersion(api, k, kpi.id, {
      ...FLOW_VERSION,
      changeReason: "Target moved by the SteerCo (synthetic).",
      targetValue: "1200",
    });
    expect([v3.status, v3.body.versionNo]).toEqual([201, 3]);
    // ADR-0036 §6 item 2 (D-101): a KPI with an active version changes only through an approved change request; the
    // direct second activation is refused and changes nothing. Activation through the request (supersede + activate,
    // one audit event each, one kpi.version_activated event) is proven in workflows/change-requests.test.ts (BE-L).
    problem(
      await call(api.app, "POST", `${k.base}/kpi-versions/${v3.body.id}/activate`, { session: k.s.tl, headers: ifMatch(1) }),
      422,
      "kpi_version.change_request_required",
      "This KPI already has an active version; changing its definition, baseline or target needs an approved change request.",
    );
    const old = await call(api.app, "GET", `${k.base}/kpi-versions/${v1.id}`, { session: k.s.auditor });
    expect([old.body.status, old.body.supersededAt]).toEqual(["active", null]);
    expect((await auditOf(api.db, v3.body.id)).map((a) => a.action)).toEqual(["kpi_version.create"]);
    expect(await api.db.selectFrom("outbox_event").selectAll().where("aggregate_id", "=", v3.body.id).execute()).toEqual([]);
    const list = await call(api.app, "GET", `${k.base}/kpi-definitions/${kpi.id}/versions?limit=2`, {
      session: k.s.auditor,
    });
    expect([list.status, (list.body.items as Body[]).map((v) => v.versionNo)]).toEqual([200, [3, 2]]);
    const next = await call(
      api.app,
      "GET",
      `${k.base}/kpi-definitions/${kpi.id}/versions?limit=2&cursor=${list.body.nextCursor}`,
      { session: k.s.auditor },
    );
    expect([(next.body.items as Body[]).map((v) => v.versionNo), next.body.nextCursor]).toEqual([[1], null]);
  });

  it("the definition must be active; the business-approval policy needs an approved approval (no agent grants one)", async () => {
    const draftKpi = await createKpi(api, k, {}, { draft: true });
    const v = await postVersion(api, k, draftKpi.id, FLOW_VERSION);
    problem(
      await call(api.app, "POST", `${k.base}/kpi-versions/${v.body.id}/activate`, {
        session: k.s.kds,
        headers: ifMatch(1),
      }),
      422,
      "kpi_version.definition_not_active",
      "Activate the KPI definition before activating one of its versions.",
    );
    const kpi = await createKpi(api, k);
    const gov = await postVersion(api, k, kpi.id, { ...FLOW_VERSION, definitionApproval: "business_approval" });
    expect(gov.status).toBe(201);
    problem(
      await call(api.app, "POST", `${k.base}/kpi-versions/${gov.body.id}/activate`, {
        session: k.s.kds,
        headers: ifMatch(1),
      }),
      422,
      "kpi_version.approval_required",
      "This KPI version needs an approved business approval before it can be activated.",
    );
    expect(
      (await call(api.app, "GET", `${k.base}/kpi-versions/${gov.body.id}`, { session: k.s.kds })).body.status,
    ).toBe("draft");
  });

  it("updateKpiDefinition of a KPI with a version: unit/currency/polarity/frequency are locked (422), other fields are not", async () => {
    const kpi = await createKpi(api, k);
    await postVersion(api, k, kpi.id, FLOW_VERSION);
    const locked = await call(api.app, "PATCH", `${k.base}/kpi-definitions/${kpi.id}`, {
      session: k.s.kds,
      headers: ifMatch(kpi.version),
      body: { frequency: "quarterly" },
    });
    problem(
      locked,
      422,
      "kpi_definition.measure_locked",
      "This KPI has a version, so its unit, currency, polarity and frequency can no longer change. Create a new KPI instead.",
    );
    const renamed = await call(api.app, "PATCH", `${k.base}/kpi-definitions/${kpi.id}`, {
      session: k.s.kds,
      headers: ifMatch(kpi.version),
      body: { description: "Still editable." },
    });
    expect(renamed.status).toBe(200);
    // A KPI without a version can still change them (DG2 behaviour unchanged).
    const free = await createKpi(api, k);
    const changed = await call(api.app, "PATCH", `${k.base}/kpi-definitions/${free.id}`, {
      session: k.s.kds,
      headers: ifMatch(free.version),
      body: { frequency: "quarterly" },
    });
    expect([changed.status, changed.body.frequency]).toEqual([200, "quarterly"]);
  });
});

describe("S-4: If-Match, audit, authorization", () => {
  it("If-Match 428/409 on update, activate and withdraw; one audit event per change", async () => {
    const kpi = await createKpi(api, k);
    const v = await postVersion(api, k, kpi.id, {
      measureType: "higher_is_better",
      valueNature: "flow",
      submissionRoute: "direct_accept",
    });
    const VI = `${k.base}/kpi-versions/${v.body.id}`;
    for (const [method, url, body] of [
      ["PATCH", VI, { aggregationRule: "sum" }],
      ["POST", `${VI}/activate`, undefined],
      ["POST", `${VI}/withdraw`, { reason: "Not needed." }],
    ] as const) {
      expect((await call(api.app, method, url, { session: k.s.kds, ...(body ? { body } : {}) })).status).toBe(428);
      expect(
        (await call(api.app, method, url, { session: k.s.kds, headers: ifMatch(5), ...(body ? { body } : {}) })).status,
      ).toBe(409);
    }
    const up = await call(api.app, "PATCH", VI, {
      session: k.s.kds,
      headers: ifMatch(1),
      body: { aggregationRule: "sum", targetValue: "500.5" },
    });
    expect([up.status, up.body.version, up.body.targetValue, up.headers.etag]).toEqual([200, 2, "500.5", '"2"']);
    const audits = await auditOf(api.db, v.body.id);
    expect(audits.map((a) => a.action)).toEqual(["kpi_version.create", "kpi_version.update"]);
    expect(audits[1]!.changes).toMatchObject({ aggregation_rule: { from: null, to: "sum" } });
  });

  it("AUD and an ADM-only user get 403 on every version mutation; KDS/TL write; reads are open to AUD", async () => {
    const kpi = await createKpi(api, k);
    const v = await postVersion(api, k, kpi.id, FLOW_VERSION);
    const VI = `${k.base}/kpi-versions/${v.body.id}`;
    for (const session of [k.s.auditor, adm, k.s.sp, k.s.fin]) {
      const label = session === adm ? "ADM-only" : "role without kpi_version.*";
      expect((await postVersion(api, k, kpi.id, FLOW_VERSION, session)).status, label).toBe(403);
      expect(
        (await call(api.app, "PATCH", VI, { session, headers: ifMatch(1), body: { unitLabel: "x" } })).status,
        label,
      ).toBe(403);
      expect((await call(api.app, "POST", `${VI}/activate`, { session, headers: ifMatch(1) })).status, label).toBe(403);
      expect(
        (await call(api.app, "POST", `${VI}/withdraw`, { session, headers: ifMatch(1), body: { reason: "No right." } }))
          .status,
        label,
      ).toBe(403);
    }
    expect((await call(api.app, "GET", VI, { session: k.s.auditor })).status).toBe(200);
    expect((await call(api.app, "GET", `${k.base}/kpi-dictionary`, { session: k.s.auditor })).status).toBe(200);
    // Outside the scope: 404, existence not disclosed.
    expect((await call(api.app, "GET", VI, { session: k.s.outsider })).status).toBe(404);
    expect((await auditOf(api.db, v.body.id)).map((a) => a.action)).toEqual(["kpi_version.create"]);
    expect((await call(api.app, "GET", VI, { session: k.s.kds })).body.version).toBe(1);
  });

  it("authorization is re-checked at commit time: a grant revoked meanwhile is 403, an ended session 401; nothing written", async () => {
    const kpi = await createKpi(api, k);
    const kds = await freshUser(api, k, w.orgA.id, w.grantor.id, "KDS");
    const revoked = await afterIdentity(
      api,
      kds.id,
      () => postVersion(api, k, kpi.id, FLOW_VERSION, kds.session),
      () => revokeAll(api, w.grantor.id, kds.id),
    );
    expect(revoked.status).toBe(403);
    expect(await versionCount(kpi.id)).toBe(0);
    const v = await postVersion(api, k, kpi.id, FLOW_VERSION);
    const tl = await freshUser(api, k, w.orgA.id, w.grantor.id, "TL");
    const ended = await afterIdentity(
      api,
      tl.id,
      () =>
        call(api.app, "POST", `${k.base}/kpi-versions/${v.body.id}/activate`, {
          session: tl.session,
          headers: ifMatch(1),
          contract: false,
        }),
      (locker) => endSessions(locker, tl.id),
    );
    expect(ended.status).toBe(401);
    expect((await call(api.app, "GET", `${k.base}/kpi-versions/${v.body.id}`, { session: k.s.kds })).body.status).toBe(
      "draft",
    );
  });
});
