// The T-DG6-BE-B2 A/B byte-stability transcript (the BE-M2 method, `response-transcript.ts`; p6-work-split §E/F.3:
// "one regression test per touched DG4/DG5 read path proving the non-sensitive response is byte-identical"). It drives
// every read path BE-B2 touched, for a reader of a transformation in which nothing is sensitive, while a benefit of
// ANOTHER transformation of the same organization IS sensitive (so the ReadScope and the restricted-records checks run
// with a non-empty sensitive set). When MTH_BE_B2_TRANSCRIPT names a file, every response is recorded (status, ETag,
// Location, body without requestId; ids, instants and hashes normalized) for a `cmp` against a run on the base commit's
// source. Unset, it is an ordinary regression test that records nothing and asserts that no response carries the new
// optional `includesRestrictedRecords` and that every record of the transformation is listed.
// All data is SYNTHETIC. Marking a record is an access decision, never a business approval (G1-G6); nothing here
// touches the engineering delivery gates DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { financialBody, insertInitiative, seedBenefitWorld, type BenefitWorld } from "../benefits/fixtures.ts";
import {
  call,
  createUser,
  grant,
  seedWorld,
  signIn,
  startApi,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { responseTranscript } from "../../support/response-transcript.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

let api: TestApi;
let w: World;
let b: BenefitWorld;
let other: BenefitWorld;
let reader: Session; // WL @ b's transformation only
let office: Session;
const BC = "/api/v1/business-cases";

/**
 * `call`, with fixture randomness replaced by fixed placeholders in the returned body (the transformation's random
 * code "TX" + 6 hex, and the synthetic users' random subjects "u.<10 hex>"), so the A and B runs compare with `cmp`.
 * Fixture data, not a response byte the product chooses.
 */
const masked = (async (...args: Parameters<typeof call>) => {
  const res = await call(...args);
  if (res.body === undefined || typeof res.body === "string") return res;
  const text = JSON.stringify(res.body)
    .replace(/"TX[0-9A-F]{6}"/g, '"TX<fixture>"')
    .replace(/u\.[0-9a-f]{10}/g, "u.<fixture>");
  return { ...res, body: JSON.parse(text) };
}) as typeof call;
const t = responseTranscript(masked, "MTH_BE_B2_TRANSCRIPT");
afterAll(() => t.flush());
const r = (url: string, s: Session = reader) => t.call<Body>(api.app, "GET", url, { session: s });

let benefitId: string;
let caseId: string;
let evidenceId: string;

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  b = await seedBenefitWorld(api, w);
  other = await seedBenefitWorld(api, w);
  office = await signIn(api.app, w.office.subject);
  const u = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, u.id, "WL", { type: "transformation", id: b.transformationId }, w.orgA.id);
  reader = await signIn(api.app, u.subject);

  const ok = (res: { status: number; body: Body }, status: number) => {
    expect(res.status, JSON.stringify(res.body)).toBe(status);
    return res.body;
  };
  const benefit = async (world: BenefitWorld, title: string) => {
    const created = ok(
      await call<Body>(api.app, "POST", `${world.base}/benefits`, {
        session: world.s.bo,
        body: financialBody(world, { title, valueClass: "margin_uplift" }),
      }),
      201,
    );
    ok(
      await call<Body>(api.app, "POST", `${world.base}/benefits/${created.id}/plan-values`, {
        session: world.s.bo,
        body: { valueKind: "planned", periodStart: "2025-01-01", periodEnd: "2025-12-31", amount: "2500000" },
      }),
      201,
    );
    return created.id as string;
  };
  benefitId = await benefit(b, "Synthetic open margin programme");
  await benefit(b, "Synthetic second margin programme");
  // The sensitive benefit of the other transformation (same organization), marked by the organization's TO.
  const hidden = await benefit(other, "Synthetic other confidential programme");
  ok(
    await call<Body>(api.app, "PUT", `${other.base}/records/benefit/${hidden}/sensitivity`, {
      session: office,
      headers: ifm(0),
      body: { isSensitive: true, reason: "Synthetic commercially sensitive terms" },
    }),
    200,
  );
  caseId = ok(
    await call<Body>(api.app, "POST", BC, {
      session: b.s.tl,
      body: { transformationId: b.transformationId, level: "transformation", title: "Synthetic open case" },
    }),
    201,
  ).id;
  const ini = await insertInitiative(api.db, b);
  ok(
    await call<Body>(api.app, "POST", BC, {
      session: b.s.tl,
      body: { transformationId: b.transformationId, level: "initiative", initiativeId: ini, title: "Synthetic case 2" },
    }),
    201,
  );
  ok(
    await call<Body>(api.app, "POST", `${BC}/${caseId}/lines`, {
      session: b.s.tl,
      body: {
        lineKind: "investment",
        class: "capex",
        valueBasis: "cash",
        title: "Synthetic platform",
        amount: "1000000",
        currency: "SAR",
      },
    }),
    201,
  );
  evidenceId = ok(
    await call<Body>(api.app, "POST", `${b.base}/evidence`, {
      session: b.s.tl,
      body: { kind: "note", title: "Synthetic open evidence", noteBody: "Synthetic", ownerUserId: b.users.tl.id },
    }),
    201,
  ).id;
}, 120_000);
afterAll(() => api.close());

describe("A/B transcript (T-DG6-BE-B2): the touched DG4/DG5 read paths, nothing sensitive in the reader's scope", () => {
  it("benefit list, GET and sub-resource reads", async () => {
    const list = await r(`${b.base}/benefits`);
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(2);
    for (const url of [
      `${b.base}/benefits/${benefitId}`,
      `${b.base}/benefits/${benefitId}/values`,
      `${b.base}/benefits/${benefitId}/lifecycle`,
      `${b.base}/benefits/${benefitId}/enablers`,
      `${b.base}/benefits/${benefitId}/allocations`,
      `${b.base}/benefits/${benefitId}/measurements`,
      `${b.base}/benefits/01900000-0000-7000-8000-000000000000`,
    ])
      expect((await r(url)).status, url).toBe(url.endsWith("000000000000") ? 404 : 200);
  });

  it("business-case list, GET, totals, lines, financial metrics (case and transformation)", async () => {
    const list = await r(`${BC}?transformationId=${b.transformationId}`);
    expect(list.body.items).toHaveLength(2);
    for (const url of [
      `${BC}/${caseId}`,
      `${BC}/${caseId}/totals`,
      `${BC}/${caseId}/lines`,
      `${BC}/${caseId}/financial-metrics`,
      `${b.base}/benefits/financial-metrics`,
    ])
      expect((await r(url)).status, url).toBe(200);
  });

  it("evidence metadata list and GET (and 404 for an unknown item)", async () => {
    const list = await r(`${b.base}/evidence`);
    expect(list.body.items.map((i: Body) => i.id)).toEqual([evidenceId]);
    expect((await r(`${b.base}/evidence/${evidenceId}`)).status).toBe(200);
    expect((await r(`${b.base}/evidence?includeArchived=true`)).status).toBe(200);
    expect((await r(`${b.base}/evidence/01900000-0000-7000-8000-000000000000`)).status).toBe(404);
  });

  it("aggregates: benefit totals, transformation dashboard, finance dashboard, drill-down: no new property", async () => {
    const q = `organizationId=${b.organizationId}&transformationId=${b.transformationId}`;
    for (const url of [
      `${b.base}/benefit-totals`,
      `${b.base}/dashboard`,
      `/api/v1/dashboards/finance?${q}`,
      `/api/v1/dashboard-drilldown?metric=value.planned&${q}`,
      `/api/v1/dashboard-drilldown?metric=value.planned&${q}&subjectId=${benefitId}`,
    ]) {
      const res = await r(url);
      expect(res.status, url).toBe(200);
      expect(Object.keys(res.body), url).not.toContain("includesRestrictedRecords");
    }
  });

  it("export selection: a live benefits-register export is accepted (202) as before", async () => {
    const res = await t.call<Body>(api.app, "POST", "/api/v1/exports", {
      session: reader,
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
    expect(res.status, JSON.stringify(res.body)).toBe(202);
  });
});
