// The optional NPV / ROI / payback extension (REQ-S08-019, M0174; ADR-0047 §5, §6, §8, §9; p5-work-split §G.3,
// T-DG5-KBE-F) against a real PostgreSQL. Every value is SYNTHETIC; Finance's assumptions and cash flows here are demo
// inputs by synthetic users and approve nothing. An extension, not a playbook requirement. Product gates G1-G6 are
// business approvals inside the product; nothing here touches the engineering gates DG0-DG7.
//  - REQ-S08-019: no settings row, or the extension off -> `disabled`; enabled without assumptions ->
//    `assumptions_missing`; enabled with assumptions but no discount rate -> `npv: null, npvReason:
//    discount_rate_missing`; at 0.100000 the fixture (outflow 1000 at t = 0, inflows 300/400/500) gives NPV -21.04
//    (beginning_of_period) and -19.12 (end_of_period), ROI 0.200000 and payback index 3; the response names the
//    assumptions and `extension: true`;
//  - cash flows in USD for a SAR case are refused 422 financial_cash_flows.currency_mismatch (at the database: the
//    contract body carries no currency, so the API always writes the case's currency);
//  - ADM_METHOD switches the extension but gets 403 on the assumptions; FIN gets 403 on the switch;
//  - every mutation: AUD 403, If-Match 428/409 (`"0"` creates and is 409 once a row exists), one audit event,
//    authorization re-checked at commit time.
import { insertAuditEvent } from "@mth/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mapDatabaseGuardError } from "../../../src/modules/platform/index.ts";
import {
  auditOf,
  auditOfRequest,
  call,
  createOrg,
  createUser,
  grant,
  seedWorld,
  signIn,
  startApi,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { ifm, setupP2World, type P2World } from "../../support/p2-fixtures.ts";
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";
import { FIXTURE_ROWS } from "../contract/p5-exercises-kbe-f.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

const SETTINGS = "/api/v1/benefits/financial-metrics/settings";
const ENABLE = `${SETTINGS}/enablement`;
const ASSUME = `${SETTINGS}/assumptions`;
const ZERO = { "if-match": '"0"' };
/**
 * Version-0 reads: the two settings/cash-flow GETs send ETag "0" while nothing is stored (the ARCH-R1 rule). The
 * contract declares `ETagOrZero` for them since the orchestrator applied KBE-F's patch (D-156), so they are validated.
 */
const VERSION_ZERO_READ = {} as const;

let api: TestApi;
let w: World;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
}, 60_000);
afterAll(() => api.close(), 60_000);

interface Org {
  readonly orgId: string;
  readonly p: P2World;
  readonly admMethod: Session;
  readonly fin: Session;
  readonly finId: string;
  readonly grantorId: string;
  readonly caseFin: Session;
  readonly caseFinId: string;
  readonly auditor: Session;
  readonly caseId: string;
}

/**
 * A world per test where the organization's settings matter: the extension is one row per organization, so each such
 * test signs in users of its own world's organization A (seedWorld creates fresh organizations).
 */
async function freshOrg(): Promise<Org> {
  const world = await seedWorld(api.db);
  const p = await setupP2World(api, world);
  const fin = await createUser(api.db, world.orgA.id);
  await grant(api.db, world.grantor.id, fin.id, "FIN", { type: "organization", id: world.orgA.id }, world.orgA.id);
  const caseFin = await createUser(api.db, world.orgA.id);
  await grant(
    api.db,
    world.grantor.id,
    caseFin.id,
    "FIN",
    { type: "transformation", id: p.transformationId },
    world.orgA.id,
  );
  const created = await call<Body>(api.app, "POST", "/api/v1/business-cases", {
    session: p.lead.session,
    body: { transformationId: p.transformationId, level: "transformation", title: "Synthetic case" },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  return {
    orgId: world.orgA.id,
    p,
    admMethod: p.methodologyAdmin.session,
    fin: await signIn(api.app, fin.subject),
    finId: fin.id,
    grantorId: world.grantor.id,
    caseFin: await signIn(api.app, caseFin.subject),
    caseFinId: caseFin.id,
    auditor: p.auditor.session,
    caseId: created.body.id as string,
  };
}

const ASSUMPTIONS = {
  methodologyNote: "Synthetic methodology: discounted net cash flow of Finance-entered annual cash flows.",
  timing: "beginning_of_period",
  periodBasis: "annual",
  discountRate: "0.100000",
};

const metrics = (o: Org) =>
  call<Body>(api.app, "GET", `/api/v1/business-cases/${o.caseId}/financial-metrics`, { session: o.auditor });
const putFlows = (o: Org, rows = FIXTURE_ROWS, headers: Record<string, string> = ZERO) =>
  call<Body>(api.app, "PUT", `/api/v1/business-cases/${o.caseId}/cash-flows`, {
    session: o.caseFin,
    headers,
    body: { rows },
  });

describe("REQ-S08-019: disabled by default; no NPV without a discount rate; 10 % gives the expected NPV to 2 decimals", () => {
  it("walks every status of ADR-0047 §5 on one case, and every response names its assumptions and extension: true", async () => {
    const o = await freshOrg();
    // No settings row (none is seeded): disabled, no metric, nothing shown as 0.
    const none = await call<Body>(api.app, "GET", SETTINGS, { session: o.auditor, ...VERSION_ZERO_READ });
    expect(none.body).toMatchObject({
      enabled: false,
      version: 0,
      extension: true,
      methodology: "discounted_net_cash_flow",
    });
    expect((await metrics(o)).body).toEqual({
      businessCaseId: o.caseId,
      status: "disabled",
      currency: "SAR",
      npv: null,
      npvReason: "not_shown",
      roi: null,
      roiReason: "not_shown",
      paybackPeriodIndex: null,
      paybackReason: "not_shown",
      assumptions: null,
      cashFlowRevision: null,
      extension: true,
    });

    // Finance sets the assumptions WITHOUT a discount rate while the extension is still off: still disabled.
    const noRate = await call<Body>(api.app, "PUT", ASSUME, {
      session: o.fin,
      headers: ZERO,
      body: { ...ASSUMPTIONS, discountRate: null },
    });
    expect(noRate.status, JSON.stringify(noRate.body)).toBe(200);
    expect(noRate.body).toMatchObject({
      enabled: false,
      version: 1,
      discountRate: null,
      timing: "beginning_of_period",
    });
    expect(await putFlows(o)).toMatchObject({ status: 200 });
    expect((await metrics(o)).body).toMatchObject({ status: "disabled", npv: null, roi: null, cashFlowRevision: 1 });

    // ADM_METHOD switches it on: NPV not shown (no discount rate); ROI and payback shown.
    const on = await call<Body>(api.app, "PUT", ENABLE, {
      session: o.admMethod,
      headers: ifm(1),
      body: { enabled: true },
    });
    expect(on.status).toBe(200);
    expect(on.body).toMatchObject({ enabled: true, version: 2 });
    expect((await metrics(o)).body).toMatchObject({
      status: "shown",
      npv: null,
      npvReason: "discount_rate_missing",
      roi: "0.200000",
      roiReason: null,
      paybackPeriodIndex: 3,
      paybackReason: null,
      assumptions: { ...ASSUMPTIONS, discountRate: null },
      extension: true,
    });

    // 10 % per period, beginning of period: -21.04; end of period: -19.12.
    expect(
      (await call<Body>(api.app, "PUT", ASSUME, { session: o.fin, headers: ifm(2), body: ASSUMPTIONS })).status,
    ).toBe(200);
    expect((await metrics(o)).body).toMatchObject({
      status: "shown",
      currency: "SAR",
      npv: "-21.04",
      npvReason: null,
      roi: "0.200000",
      paybackPeriodIndex: 3,
      assumptions: ASSUMPTIONS,
      cashFlowRevision: 1,
      extension: true,
    });
    expect(
      (
        await call<Body>(api.app, "PUT", ASSUME, {
          session: o.fin,
          headers: ifm(3),
          body: { ...ASSUMPTIONS, timing: "end_of_period" },
        })
      ).status,
    ).toBe(200);
    expect((await metrics(o)).body).toMatchObject({ npv: "-19.12", roi: "0.200000", paybackPeriodIndex: 3 });

    // The transformation list applies the same rules to each case.
    const list = await call<Body>(
      api.app,
      "GET",
      `/api/v1/transformations/${o.p.transformationId}/benefits/financial-metrics`,
      { session: o.auditor },
    );
    expect(list.body.items).toEqual([expect.objectContaining({ businessCaseId: o.caseId, npv: "-19.12" })]);

    // Switched off again: disabled, nothing shown (the cash flows and assumptions stay).
    expect(
      (await call<Body>(api.app, "PUT", ENABLE, { session: o.admMethod, headers: ifm(4), body: { enabled: false } }))
        .status,
    ).toBe(200);
    expect((await metrics(o)).body).toMatchObject({ status: "disabled", npv: null, npvReason: "not_shown" });
  });

  it("enabled without assumptions is assumptions_missing; with assumptions and no cash flows, cash_flows_missing", async () => {
    const o = await freshOrg();
    expect(
      (await call<Body>(api.app, "PUT", ENABLE, { session: o.admMethod, headers: ZERO, body: { enabled: true } }))
        .status,
    ).toBe(200);
    expect((await metrics(o)).body).toMatchObject({ status: "assumptions_missing", npv: null, assumptions: null });
    expect(
      (await call<Body>(api.app, "PUT", ASSUME, { session: o.fin, headers: ifm(1), body: ASSUMPTIONS })).status,
    ).toBe(200);
    expect((await metrics(o)).body).toMatchObject({
      status: "cash_flows_missing",
      npv: null,
      roi: null,
      paybackPeriodIndex: null,
      cashFlowRevision: null,
      assumptions: ASSUMPTIONS,
    });
  });

  it("422 financial_metrics.discount_rate_invalid for a rate outside [0, 1] (400 beyond 6 decimals); nothing written", async () => {
    const o = await freshOrg();
    for (const rate of ["1.000001", "-0.1", "1.5"]) {
      const res = await call<Body>(api.app, "PUT", ASSUME, {
        session: o.fin,
        headers: ZERO,
        body: { ...ASSUMPTIONS, discountRate: rate },
      });
      expect([res.status, res.body.code, res.body.detail]).toEqual([
        422,
        "financial_metrics.discount_rate_invalid",
        "The discount rate is a decimal fraction from 0 to 1 per period (0.10 = 10%).",
      ]);
    }
    const rows = await api.db
      .selectFrom("financial_metric_setting")
      .select("id")
      .where("organization_id", "=", o.orgId)
      .execute();
    expect(rows).toEqual([]);
  });
});

describe("cash flows (ADR-0047 §5): replaced as a whole, revisions kept, the case currency only", () => {
  it("a replacement steps the revision; the earlier rows stay as history; one audit event per PUT", async () => {
    const o = await freshOrg();
    const CF = `/api/v1/business-cases/${o.caseId}/cash-flows`;
    const empty = await call<Body>(api.app, "GET", CF, { session: o.auditor, ...VERSION_ZERO_READ });
    expect([empty.status, empty.headers.etag, empty.body.revision, empty.body.rows]).toEqual([200, '"0"', 0, []]);
    const first = await putFlows(o);
    expect([first.status, first.headers.etag, first.body.revision]).toEqual([200, '"1"', 1]);
    const firstAudit = await auditOfRequest(api.db, first.headers["x-request-id"] as string);
    expect(firstAudit.map((a) => [a.action, a.record_type])).toEqual([
      ["financial_cash_flow_set.create", "financial_cash_flow_set"],
    ]);
    const second = await putFlows(
      o,
      [{ periodIndex: 0, outflow: "500.5", inflow: "0", note: "Synthetic" } as never],
      ifm(1),
    );
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    expect(second.body).toMatchObject({
      revision: 2,
      version: 2,
      rows: [{ periodIndex: 0, outflow: "500.5", inflow: "0", note: "Synthetic" }],
    });
    const setId = (
      await api.db
        .selectFrom("financial_cash_flow_set")
        .select("id")
        .where("business_case_id", "=", o.caseId)
        .executeTakeFirstOrThrow()
    ).id;
    const history = await api.db
      .selectFrom("financial_cash_flow")
      .select(["revision", "period_index"])
      .where("set_id", "=", setId)
      .orderBy("revision")
      .orderBy("period_index")
      .execute();
    expect(history.map((h) => `${h.revision}:${h.period_index}`)).toEqual(["1:0", "1:1", "1:2", "1:3", "2:0"]);
    const audit = await auditOf(api.db, setId);
    expect(audit.map((a) => a.action)).toEqual(["financial_cash_flow_set.create", "financial_cash_flow_set.replace"]);
    // With only an outflow, ROI is -1 and payback is never reached (the extension is off here, so the API shows nothing).
  });

  it("422 financial_cash_flows.periods_invalid for a gap or a duplicate index; 400 for a negative or over-scale amount", async () => {
    const o = await freshOrg();
    for (const rows of [[FIXTURE_ROWS[0], FIXTURE_ROWS[2]], [FIXTURE_ROWS[0], FIXTURE_ROWS[0]], [FIXTURE_ROWS[1]]]) {
      const res = await putFlows(o, rows as typeof FIXTURE_ROWS);
      expect([res.status, res.body.code, res.body.detail]).toEqual([
        422,
        "financial_cash_flows.periods_invalid",
        "Cash flows need one row per period index from 0, with no gap and at most 121 rows.",
      ]);
    }
    for (const outflow of ["-1", "1.00001", "10000000000000000"])
      expect((await putFlows(o, [{ periodIndex: 0, outflow, inflow: "0" }])).status).toBe(400);
    expect(
      await api.db
        .selectFrom("financial_cash_flow_set")
        .select("id")
        .where("business_case_id", "=", o.caseId)
        .execute(),
    ).toEqual([]);
  });

  it("cash flows in USD for a SAR case: 422 financial_cash_flows.currency_mismatch (the database guard, mapped)", async () => {
    const o = await freshOrg();
    const c = await api.db.selectFrom("business_case").selectAll().where("id", "=", o.caseId).executeTakeFirstOrThrow();
    expect(c.currency.trim()).toBe("SAR");
    // The contract body carries no currency (the API writes the case's), so the USD set is attempted directly as the
    // application role; the guard refuses it and the API's error mapping answers with the ADR-0047 §8 code and text.
    let caught: unknown;
    try {
      await api.db.transaction().execute(async (tx) => {
        await tx
          .insertInto("financial_cash_flow_set")
          .values({
            id: crypto.randomUUID(),
            organization_id: c.organization_id,
            transformation_id: c.transformation_id,
            business_case_id: c.id,
            currency: "USD",
            revision: 1,
            line_count: 1,
            created_by: o.finId,
            updated_by: o.finId,
          })
          .execute();
      });
    } catch (e) {
      caught = e;
    }
    const problem = mapDatabaseGuardError(caught as { code?: string; constraint?: string });
    expect([problem?.status, problem?.toBody("r").code, problem?.toBody("r").detail]).toEqual([
      422,
      "financial_cash_flows.currency_mismatch",
      "Cash flows are entered in the business case currency.",
    ]);
    // Through the API the set takes the case currency.
    const put = await putFlows(o);
    expect([put.status, put.body.currency]).toEqual([200, "SAR"]);
  });
});

describe("authorization, If-Match, audit and commit-time re-authorization (ADR-0047 §6)", () => {
  it("ADM_METHOD switches the extension but gets 403 on the assumptions; FIN gets 403 on the switch; AUD 403 on every write", async () => {
    const o = await freshOrg();
    expect(
      (await call<Body>(api.app, "PUT", ASSUME, { session: o.admMethod, headers: ZERO, body: ASSUMPTIONS })).status,
    ).toBe(403);
    expect(
      (await call<Body>(api.app, "PUT", ENABLE, { session: o.fin, headers: ZERO, body: { enabled: true } })).status,
    ).toBe(403);
    // A FIN scoped to one transformation enters its cash flows but cannot change the organization's assumptions.
    expect(
      (await call<Body>(api.app, "PUT", ASSUME, { session: o.caseFin, headers: ZERO, body: ASSUMPTIONS })).status,
    ).toBe(403);
    for (const [url, body] of [
      [ENABLE, { enabled: true }],
      [ASSUME, ASSUMPTIONS],
      [`/api/v1/business-cases/${o.caseId}/cash-flows`, { rows: FIXTURE_ROWS }],
    ] as const) {
      const res = await call<Body>(api.app, "PUT", url, { session: o.auditor, headers: ZERO, body });
      expect([url, res.status]).toEqual([url, 403]);
      const denied = await auditOfRequest(api.db, res.headers["x-request-id"] as string);
      expect(denied.map((a) => a.action)).toEqual(["authorization.denied"]);
    }
    // A caller of another organization's world cannot read the case (404) and the settings read is its own org's.
    const outsider = await createUser(api.db, w.orgA.id);
    const outsiderSession = await signIn(api.app, outsider.subject);
    expect(
      (await call<Body>(api.app, "GET", `/api/v1/business-cases/${o.caseId}/cash-flows`, { session: outsiderSession }))
        .status,
    ).toBe(404);
    // ADM_METHOD's switch works (the positive half).
    const on = await call<Body>(api.app, "PUT", ENABLE, {
      session: o.admMethod,
      headers: ZERO,
      body: { enabled: true },
    });
    expect(on.status).toBe(200);
    expect(
      (await auditOfRequest(api.db, on.headers["x-request-id"] as string)).map((a) => [a.action, a.record_type]),
    ).toEqual([["financial_metric_setting.create", "financial_metric_setting"]]);
  });

  it('If-Match: 428 when missing; "0" creates version 1 and is 409 once a row exists; a stale version is 409', async () => {
    const o = await freshOrg();
    expect((await call<Body>(api.app, "PUT", ENABLE, { session: o.admMethod, body: { enabled: true } })).status).toBe(
      428,
    );
    expect((await call<Body>(api.app, "PUT", ASSUME, { session: o.fin, body: ASSUMPTIONS })).status).toBe(428);
    expect(
      (
        await call<Body>(api.app, "PUT", `/api/v1/business-cases/${o.caseId}/cash-flows`, {
          session: o.caseFin,
          body: { rows: FIXTURE_ROWS },
        })
      ).status,
    ).toBe(428);
    const created = await call<Body>(api.app, "PUT", ASSUME, { session: o.fin, headers: ZERO, body: ASSUMPTIONS });
    expect([created.status, created.headers.etag, created.body.version]).toEqual([200, '"1"', 1]);
    expect(
      (await call<Body>(api.app, "PUT", ASSUME, { session: o.fin, headers: ZERO, body: ASSUMPTIONS })).status,
    ).toBe(409);
    expect(
      (await call<Body>(api.app, "PUT", ENABLE, { session: o.admMethod, headers: ZERO, body: { enabled: true } }))
        .status,
    ).toBe(409);
    expect(
      (await call<Body>(api.app, "PUT", ASSUME, { session: o.fin, headers: ifm(7), body: ASSUMPTIONS })).status,
    ).toBe(409);
    expect((await putFlows(o)).status).toBe(200);
    expect((await putFlows(o)).status).toBe(409); // "0" once the set exists
    expect((await putFlows(o, FIXTURE_ROWS, ifm(5))).status).toBe(409);
    const updated = await call<Body>(api.app, "PUT", ENABLE, {
      session: o.admMethod,
      headers: ifm(1),
      body: { enabled: true },
    });
    expect([updated.status, updated.body.version, updated.body.enabled]).toEqual([200, 2, true]);
    // One audit event per mutation, on the one settings row, with the prior and new versions.
    const settingId = (
      await api.db
        .selectFrom("financial_metric_setting")
        .select("id")
        .where("organization_id", "=", o.orgId)
        .executeTakeFirstOrThrow()
    ).id;
    const audit = await auditOf(api.db, settingId);
    expect(audit.map((a) => [a.action, a.prior_version, a.new_version])).toEqual([
      ["financial_metric_setting.create", null, 1],
      ["financial_metric_setting.update", 1, 2],
    ]);
  });

  it("commit-time: a grant revoked while the PUT waited is 403; nothing written (settings and cash flows)", async () => {
    const o = await freshOrg();
    const settings = await afterIdentity(
      api,
      o.finId,
      () => call<Body>(api.app, "PUT", ASSUME, { session: o.fin, headers: ZERO, body: ASSUMPTIONS, contract: false }),
      () => revokeAll(api, o.grantorId, o.finId),
    );
    expect(settings.status).toBe(403);
    expect(
      await api.db.selectFrom("financial_metric_setting").select("id").where("organization_id", "=", o.orgId).execute(),
    ).toEqual([]);
    const flows = await afterIdentity(
      api,
      o.caseFinId,
      () =>
        call<Body>(api.app, "PUT", `/api/v1/business-cases/${o.caseId}/cash-flows`, {
          session: o.caseFin,
          headers: ZERO,
          body: { rows: FIXTURE_ROWS },
          contract: false,
        }),
      () => revokeAll(api, o.grantorId, o.caseFinId),
    );
    expect(flows.status).toBe(403);
    expect(
      await api.db
        .selectFrom("financial_cash_flow_set")
        .select("id")
        .where("business_case_id", "=", o.caseId)
        .execute(),
    ).toEqual([]);
  });
});

describe("db-error mapping of the 0085 financial guards (ADR-0047 §8)", () => {
  it("maps each reachable constraint to its code and text", () => {
    const map = (constraint: string) => {
      const p = mapDatabaseGuardError({ code: "23514", constraint });
      return p === null ? null : [p.status, p.toBody("r").code];
    };
    expect(map("financial_metric_setting_org_key")).toEqual([409, "version_conflict"]);
    expect(map("financial_cash_flow_set_case_key")).toEqual([409, "version_conflict"]);
    expect(map("financial_metric_setting_assumptions_complete")).toEqual([
      422,
      "financial_metrics.assumptions_incomplete",
    ]);
    expect(map("financial_metric_setting_discount_rate_check")).toEqual([
      422,
      "financial_metrics.discount_rate_invalid",
    ]);
    expect(map("financial_cash_flow_set_currency")).toEqual([422, "financial_cash_flows.currency_mismatch"]);
    for (const c of [
      "financial_cash_flow_set_rows",
      "financial_cash_flow_period_key",
      "financial_cash_flow_set_line_count_check",
      "financial_cash_flow_period_index_check",
    ])
      expect(map(c)).toEqual([422, "financial_cash_flows.periods_invalid"]);
  });

  it("the deferred row-count guard refuses a set without its rows at COMMIT (database's last line)", async () => {
    const o = await freshOrg();
    const c = await api.db.selectFrom("business_case").selectAll().where("id", "=", o.caseId).executeTakeFirstOrThrow();
    const err = await api.db
      .transaction()
      .execute(async (tx) => {
        const id = crypto.randomUUID();
        await tx
          .insertInto("financial_cash_flow_set")
          .values({
            id,
            organization_id: c.organization_id,
            transformation_id: c.transformation_id,
            business_case_id: c.id,
            currency: "SAR",
            revision: 1,
            line_count: 2,
            created_by: o.finId,
            updated_by: o.finId,
          })
          .execute();
        // Audited like a real write, so the only guard left to refuse it is the deferred row count.
        await insertAuditEvent(
          tx,
          { actorType: "system", actorUserId: null, source: "migration" },
          {
            action: "test.seed",
            recordType: "financial_cash_flow_set",
            recordId: id,
            organizationId: c.organization_id,
            newVersion: 1,
          },
        );
      })
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(mapDatabaseGuardError(err as { code?: string; constraint?: string })?.toBody("r").code).toBe(
      "financial_cash_flows.periods_invalid",
    );
  });
});

// Keep the shared world referenced (organization B's users never see organization A's settings).
it("a user of another organization reads that organization's own settings (version 0), never another's", async () => {
  const o = await freshOrg();
  expect(
    (await call<Body>(api.app, "PUT", ENABLE, { session: o.admMethod, headers: ZERO, body: { enabled: true } })).status,
  ).toBe(200);
  const other = await createOrg(api.db);
  const stranger = await createUser(api.db, other.id);
  const res = await call<Body>(api.app, "GET", SETTINGS, {
    session: await signIn(api.app, stranger.subject),
    ...VERSION_ZERO_READ,
  });
  expect(res.body).toMatchObject({ enabled: false, version: 0 });
});
