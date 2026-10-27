// Sensitive records on the DG4/DG5 record reads, rollups and export selection (T-DG6-BE-B2; p6-work-split §E/F.3;
// ADR-0051 §1, §2, §8; D-195 Q3; REQ-S10-002, REQ-S10-004), against the run's disposable PostgreSQL. Every value is
// SYNTHETIC. Marking a record or granting access is an access decision, never a business approval (G1-G6), and nothing
// here touches the engineering gates DG0-DG7.
//   - REQ-S10-002 literally: "a sensitive benefit is hidden from a workstream member without the grant" (benefit list
//     and GET 404, and every benefit sub-resource read), and visible after a grant; the same for a business case
//     (list, GET, totals, lines, financial metrics) and an evidence item (metadata list and GET);
//   - the named parties (owner, creator) and the TO (sensitive_record.grant) are admitted; AUD alone is not;
//   - the benefit totals are identical for every reader, with `includesRestrictedRecords` true only for the reader
//     without admission (false for one admitted to all, absent while nothing is sensitive); Unknown stays Unknown;
//   - the dashboards: same headlines, the restricted benefit is not listed, the label as above; a drill-down on a
//     restricted subject is refused like a subject outside the scope;
//   - an export of the benefits register (portfolio report) by a user without admission is refused (403) at the
//     request, so it never contains a row of the sensitive benefit; an admitted user exports it; nothing is written for
//     the refused request.
// The calls whose response carries `includesRestrictedRecords` skip the contract assertion (`contract: false`): the
// optional property is BE-B2's contract addition (handback §6), merged into docs/api/openapi.yaml by the orchestrator.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { financialBody, insertInitiative, seedBenefitWorld, type BenefitWorld } from "../benefits/fixtures.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import {
  call,
  createUser,
  grant,
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
let member: Session; // WL @ the transformation: a workstream member without a grant
let member2: Session; // WL @ the transformation: receives a grant
let member2Id: string;
let sensitiveId: string; // the benefit marked sensitive (owner and creator: BO)
let plainId: string; // a benefit never marked
let caseId: string; // a business case marked sensitive (creator: TL)
let plainCaseId: string;
let evidenceId: string; // an evidence item marked sensitive (owner and creator: TL)
let plainEvidenceId: string;

const BC = "/api/v1/business-cases";
const ok = (res: Res<Body>, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body as Body;
};
const get = (s: Session, url: string, contract = true) =>
  call<Body>(api.app, "GET", url, { session: s, ...(contract ? {} : { contract: false }) });
const mark = async (type: string, id: string) =>
  ok(
    await call<Body>(api.app, "PUT", `${b.base}/records/${type}/${id}/sensitivity`, {
      session: office,
      headers: ifm(0),
      body: { isSensitive: true, reason: "Synthetic commercially sensitive terms" },
    }),
  );
const ids = (page: Body) => (page.items as { id: string }[]).map((i) => i.id);
const totals = (s: Session) => get(s, `${b.base}/benefit-totals`, false);
const dashboard = (s: Session) => get(s, `${b.base}/dashboard`, false);
const finance = (s: Session) =>
  get(s, `/api/v1/dashboards/finance?organizationId=${b.organizationId}&transformationId=${b.transformationId}`, false);
const drill = (s: Session, extra = "") =>
  get(
    s,
    `/api/v1/dashboard-drilldown?metric=value.planned&organizationId=${b.organizationId}&transformationId=${b.transformationId}${extra}`,
    false,
  );
const registersExport = (s: Session) =>
  call<Body>(api.app, "POST", "/api/v1/exports", {
    session: s,
    body: {
      report: {
        definitionCode: "registers",
        subjectId: b.transformationId,
        parameters: { register: "benefits", filters: {} },
      },
      format: "csv",
      language: "en",
    },
  });
const exportJobsOf = (userId: string) =>
  api.db.selectFrom("export_job").select("id").where("requested_by", "=", userId).execute();

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  b = await seedBenefitWorld(api, w);
  office = await signIn(api.app, w.office.subject);
  const scope = { type: "transformation" as const, id: b.transformationId };
  const m1 = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, m1.id, "WL", scope, w.orgA.id);
  const m2 = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, m2.id, "WL", scope, w.orgA.id);
  member = await signIn(api.app, m1.subject);
  member2 = await signIn(api.app, m2.subject);
  member2Id = m2.id;

  const newBenefit = async (title: string, amount: string) => {
    const body = ok(
      await call<Body>(api.app, "POST", `${b.base}/benefits`, {
        session: b.s.bo,
        body: financialBody(b, { title, valueClass: "margin_uplift" }),
      }),
      201,
    );
    ok(
      await call<Body>(api.app, "POST", `${b.base}/benefits/${body.id}/plan-values`, {
        session: b.s.bo,
        body: { valueKind: "planned", periodStart: "2025-01-01", periodEnd: "2025-12-31", amount },
      }),
      201,
    );
    return body.id as string;
  };
  sensitiveId = await newBenefit("Synthetic confidential margin programme", "4000000");
  plainId = await newBenefit("Synthetic open margin programme", "1000000");

  const newCase = async (title: string, initiativeId?: string) =>
    ok(
      await call<Body>(api.app, "POST", BC, {
        session: b.s.tl,
        body:
          initiativeId === undefined
            ? { transformationId: b.transformationId, level: "transformation", title }
            : { transformationId: b.transformationId, level: "initiative", initiativeId, title },
      }),
      201,
    ).id as string;
  caseId = await newCase("Synthetic confidential case");
  plainCaseId = await newCase("Synthetic open case", await insertInitiative(api.db, b));
  // A cost line without an amount on the sensitive case: implementation cost and net are Unknown for every reader.
  ok(
    await call<Body>(api.app, "POST", `${BC}/${caseId}/lines`, {
      session: b.s.tl,
      body: {
        lineKind: "investment",
        class: "internal_fte",
        valueBasis: "non_cash",
        title: "Synthetic confidential analysts",
        amount: null,
        currency: "SAR",
      },
    }),
    201,
  );
  const newEvidence = async (title: string) =>
    ok(
      await call<Body>(api.app, "POST", `${b.base}/evidence`, {
        session: b.s.tl,
        body: { kind: "note", title, noteBody: "Synthetic", ownerUserId: b.users.tl.id },
      }),
      201,
    ).id as string;
  evidenceId = await newEvidence("Synthetic confidential evidence");
  plainEvidenceId = await newEvidence("Synthetic open evidence");
}, 120_000);
afterAll(() => api.close());

describe("before any record is marked: DG4/DG5 responses unchanged", () => {
  it("lists every record to the workstream member, and no aggregate carries includesRestrictedRecords", async () => {
    expect(ids(ok(await get(member, `${b.base}/benefits`)))).toEqual(expect.arrayContaining([sensitiveId, plainId]));
    expect(ids(ok(await get(member, `${BC}?transformationId=${b.transformationId}`)))).toEqual(
      expect.arrayContaining([caseId, plainCaseId]),
    );
    expect(ids(ok(await get(member, `${b.base}/evidence`)))).toEqual(
      expect.arrayContaining([evidenceId, plainEvidenceId]),
    );
    // Through the contract-validating client: the DG4/DG5 schemas, with no new property.
    for (const url of [
      `${b.base}/benefit-totals`,
      `${b.base}/dashboard`,
      `/api/v1/dashboards/finance?organizationId=${b.organizationId}&transformationId=${b.transformationId}`,
      `/api/v1/dashboard-drilldown?metric=value.planned&organizationId=${b.organizationId}&transformationId=${b.transformationId}`,
    ]) {
      const body = ok(await get(member, url));
      expect(Object.keys(body), url).not.toContain("includesRestrictedRecords");
    }
  });

  it("the member may export the benefits register (the export path is unchanged)", async () => {
    ok(await registersExport(member), 202);
  });
});

describe("REQ-S10-002: a sensitive benefit is hidden from a workstream member without the grant", () => {
  beforeAll(async () => {
    await mark("benefit", sensitiveId);
    await mark("business_case", caseId);
    await mark("evidence", evidenceId);
  });

  it("benefit list and GET: absent / 404 for the member and AUD; visible to the owner, the creator and the TO", async () => {
    for (const s of [member, b.s.auditor]) {
      const list = ids(ok(await get(s, `${b.base}/benefits`)));
      expect(list).toContain(plainId);
      expect(list).not.toContain(sensitiveId);
      const res = await get(s, `${b.base}/benefits/${sensitiveId}`);
      expect([res.status, res.body.code]).toEqual([404, "not_found"]);
      ok(await get(s, `${b.base}/benefits/${plainId}`));
    }
    for (const s of [b.s.bo, office]) {
      expect(ids(ok(await get(s, `${b.base}/benefits`)))).toContain(sensitiveId);
      expect(ok(await get(s, `${b.base}/benefits/${sensitiveId}`)).id).toBe(sensitiveId);
    }
  });

  it("the benefit's sub-resource reads (values, lifecycle, enablers, allocations, measurements) are 404 too", async () => {
    for (const sub of ["values", "lifecycle", "enablers", "allocations", "measurements"]) {
      const res = await get(member, `${b.base}/benefits/${sensitiveId}/${sub}`);
      expect([sub, res.status]).toEqual([sub, 404]);
      expect([sub, (await get(b.s.bo, `${b.base}/benefits/${sensitiveId}/${sub}`)).status]).toEqual([sub, 200]);
    }
  });

  it("visible to the member after a grant; hidden again after the revocation (next request)", async () => {
    const created = ok(
      await call<Body>(api.app, "POST", "/api/v1/admin/sensitive-grants", {
        session: office,
        body: {
          transformationId: b.transformationId,
          recordType: "benefit",
          recordId: sensitiveId,
          granteeUserId: member2Id,
          reason: "Synthetic need to know",
        },
      }),
      201,
    );
    expect(ids(ok(await get(member2, `${b.base}/benefits`)))).toContain(sensitiveId);
    ok(await get(member2, `${b.base}/benefits/${sensitiveId}`));
    // The other member still does not see it (a grant is per person).
    expect((await get(member, `${b.base}/benefits/${sensitiveId}`)).status).toBe(404);
    ok(
      await call<Body>(api.app, "POST", `/api/v1/admin/sensitive-grants/${created.id}/revoke`, {
        session: office,
        headers: ifm(created.version),
        body: { reason: "Synthetic need ended" },
      }),
    );
    expect((await get(member2, `${b.base}/benefits/${sensitiveId}`)).status).toBe(404);
    expect(ids(ok(await get(member2, `${b.base}/benefits`)))).not.toContain(sensitiveId);
  });

  it("business case: list, GET, totals, lines and financial metrics hidden from the member; the creator reads them", async () => {
    const list = ids(ok(await get(member, `${BC}?transformationId=${b.transformationId}`)));
    expect(list).toContain(plainCaseId);
    expect(list).not.toContain(caseId);
    for (const url of [
      `${BC}/${caseId}`,
      `${BC}/${caseId}/totals`,
      `${BC}/${caseId}/lines`,
      `${BC}/${caseId}/financial-metrics`,
    ]) {
      const res = await get(member, url);
      expect([url, res.status]).toEqual([url, 404]);
      expect([url, (await get(b.s.tl, url)).status]).toEqual([url, 200]);
    }
    const memberMetrics = ok(await get(member, `${b.base}/benefits/financial-metrics`)).items.map(
      (m: Body) => m.businessCaseId,
    );
    expect(memberMetrics).not.toContain(caseId);
    const tlMetrics = ok(await get(b.s.tl, `${b.base}/benefits/financial-metrics`)).items.map(
      (m: Body) => m.businessCaseId,
    );
    expect(tlMetrics).toContain(caseId);
  });

  it("evidence metadata: list and GET hidden from the member; the owner reads them", async () => {
    const list = ids(ok(await get(member, `${b.base}/evidence`)));
    expect(list).toContain(plainEvidenceId);
    expect(list).not.toContain(evidenceId);
    const res = await get(member, `${b.base}/evidence/${evidenceId}`);
    expect([res.status, res.body.code]).toEqual([404, "not_found"]);
    expect(ids(ok(await get(b.s.tl, `${b.base}/evidence`)))).toContain(evidenceId);
    expect(ok(await get(b.s.tl, `${b.base}/evidence/${evidenceId}`)).id).toBe(evidenceId);
  });
});

describe("rollups (D-195 Q3): identical totals, labelled for the reader without admission", () => {
  it("benefit totals: same figures for the member and the owner; includesRestrictedRecords true only for the member", async () => {
    const m = ok(await totals(member));
    const o = ok(await totals(b.s.bo));
    const t = ok(await totals(office));
    expect(m.currencies).toEqual(o.currencies);
    expect(t.currencies).toEqual(o.currencies);
    expect([m.nonFinancialCount, m.excluded]).toEqual([o.nonFinancialCount, o.excluded]);
    // The sensitive benefit's value is in the total for everyone: 4 M + 1 M planned margin uplift.
    expect(m.currencies[0].gross.planned).toEqual({
      status: "known",
      amount: "5000000.0000",
      currency: "SAR",
      reason: null,
    });
    // The member is not admitted to the benefit nor to the case; the TO is admitted to both. BO is the benefit's named
    // party but not admitted to the case (created by TL), so BO's totals are labelled too.
    expect(m.includesRestrictedRecords).toBe(true);
    expect(t.includesRestrictedRecords).toBe(false);
    expect(o.includesRestrictedRecords).toBe(true);
  });

  it("Unknown stays Unknown: the sensitive case's missing cost keeps cost and net Unknown for every reader", async () => {
    for (const s of [member, b.s.bo, office]) {
      const c = ok(await totals(s)).currencies[0];
      expect(c.implementationCost.nonCash).toEqual({
        status: "unknown",
        amount: null,
        currency: "SAR",
        reason: "benefit.cost_amount_missing",
      });
      expect(c.net.planned.status).toBe("unknown");
    }
  });

  it("transformation dashboard: same areas' headlines and statuses; the restricted benefit is not listed", async () => {
    const m = ok(await dashboard(member));
    const t = ok(await dashboard(office));
    expect(m.includesRestrictedRecords).toBe(true);
    expect(t.includesRestrictedRecords).toBe(false);
    const strip = (body: Body) => body.areas.map((a: Body) => ({ code: a.code, rag: a.rag, headlines: a.headlines }));
    expect(strip(m)).toEqual(strip(t));
    const valueItems = (body: Body) =>
      body.areas.find((a: Body) => a.code === "value").items.map((i: Body) => i.recordId);
    expect(valueItems(t)).toEqual(expect.arrayContaining([sensitiveId, plainId]));
    expect(valueItems(m)).toContain(plainId);
    expect(valueItems(m)).not.toContain(sensitiveId);
    expect(JSON.stringify(m)).not.toContain("Synthetic confidential");
  });

  it("finance dashboard: same lines and headlines; labelled for the member only", async () => {
    const m = ok(await finance(member));
    const t = ok(await finance(office));
    expect([m.lines, m.headlines]).toEqual([t.lines, t.headlines]);
    expect([m.includesRestrictedRecords, t.includesRestrictedRecords]).toEqual([true, false]);
  });

  it("drill-down: same value and inputs; the restricted benefit is not an item; a restricted subject is refused", async () => {
    const m = ok(await drill(member));
    const t = ok(await drill(office));
    expect(m.value).toEqual(t.value);
    expect(m.calculation.inputs).toEqual(t.calculation.inputs);
    expect(m.items.map((i: Body) => i.recordId)).not.toContain(sensitiveId);
    expect(t.items.map((i: Body) => i.recordId)).toContain(sensitiveId);
    expect([m.includesRestrictedRecords, t.includesRestrictedRecords]).toEqual([true, false]);
    const refused = await drill(member, `&subjectId=${sensitiveId}`);
    const outside = await drill(member, `&subjectId=01900000-0000-7000-8000-000000000000`);
    expect([refused.status, refused.body.code]).toEqual([outside.status, outside.body.code]);
    expect(refused.status).toBe(422);
    ok(await drill(office, `&subjectId=${sensitiveId}`));
  });
});

describe("REQ-S10-004: export selection through the ReadScope", () => {
  it("the member's export of the benefits register is 403 and writes nothing; the owner exports it", async () => {
    const before = await exportJobsOf(member.userId);
    const res = await registersExport(member);
    expect([res.status, res.body.code]).toEqual([403, "forbidden"]);
    expect(await exportJobsOf(member.userId)).toEqual(before);
    ok(await registersExport(b.s.bo), 202);
  });

  it("a snapshot without a sensitive source still exports for the member (a RAID register)", async () => {
    ok(
      await call<Body>(api.app, "POST", "/api/v1/exports", {
        session: member,
        body: {
          report: {
            definitionCode: "registers",
            subjectId: b.transformationId,
            parameters: { register: "raid", filters: { type: "risk" } },
          },
          format: "csv",
          language: "en",
        },
      }),
      202,
    );
  });

  it("the owner's snapshot exported by the member (by snapshot id) is 403 too", async () => {
    const job = ok(await registersExport(b.s.bo), 202);
    const res = await call<Body>(api.app, "POST", "/api/v1/exports", {
      session: member,
      body: { snapshotId: job.snapshotId, format: "csv", language: "en" },
    });
    expect([res.status, res.body.code]).toEqual([403, "forbidden"]);
  });
});
