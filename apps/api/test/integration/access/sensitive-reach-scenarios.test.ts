// The values of a sensitive benefit embedded in a benefit scenario (T-DG6-BE-Z3; ADR-0051 §2; REQ-S10-002; the
// F-DG6-180 class), against the run's disposable PostgreSQL. Every value is SYNTHETIC. Marking a record or granting
// access is an access decision, never a business approval (G1-G6), and nothing here touches the engineering gates
// DG0-DG7.
//
// A benefit scenario of the transformation (no business case: a non-sensitive parent) holds one value row of a plain
// benefit and one of a benefit the TO then marks sensitive. Before T-DG6-BE-Z3, `presentScenarios` embedded every
// value row, so TL and AUD (404 on the benefit) still read its scenario amount through the scenario list and item.
//   - negative: after marking, TL and AUD read the scenario (list, item) WITHOUT the sensitive benefit's value row: it
//     is omitted (not 403, no placeholder; the plain benefit's value is still there, so nothing else is hidden), the
//     sensitive amount appears nowhere in the response, TL's own scenario update returns it without the row, and TL's
//     POST of a value naming the sensitive benefit answers exactly like a benefit that does not exist (422
//     validation.reference), writing nothing;
//   - positive: the TO (sensitive_record.grant), the owner (a named party) and TL after an explicit grant read both
//     value rows with their amounts.
// It fails on the integrated round-2 tree (the row is embedded for TL and AUD) and passes with the presenter filter of
// benefits/scenarios.ts.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { financialBody, seedBenefitWorld, type BenefitWorld } from "../benefits/fixtures.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { call, seedWorld, signIn, startApi, type Res, type Session, type TestApi } from "../../support/harness.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

let api: TestApi;
let b: BenefitWorld;
let office: Session; // TO @ organization A: sensitive_record.grant (admitted by §2 rule 3)
let tl: Session; // TL @ the transformation: not a named party of the benefit
let aud: Session; // AUD @ organization A: AUD alone admits nothing
let S = "";
let scenarioId = "";
let scenarioVersion = 0;
let sensitiveId = "";
let plainId = "";
let sensitiveValueId = "";
let plainValueId = "";

const SENSITIVE_AMOUNT = "9876543.0000";
const PLAIN_AMOUNT = "1234567.0000";
const period = { periodStart: "2026-01-01", periodEnd: "2026-12-31" };

const ok = (res: Res<Body>, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body as Body;
};
/** The scenario as listed (every page, limit 1) and as read by item, for one session. */
async function views(s: Session): Promise<{ listed: Body; item: Body; raw: string }> {
  let listed: Body = undefined;
  let raw = "";
  let cursor: string | null = null;
  for (let i = 0; i < 20; i += 1) {
    const q: string = cursor === null ? "?limit=1" : `?limit=1&cursor=${encodeURIComponent(cursor)}`;
    const page = ok(await call<Body>(api.app, "GET", `${S}${q}`, { session: s }));
    raw += JSON.stringify(page);
    listed ??= (page.items as Body[]).find((x) => x.id === scenarioId);
    cursor = page.nextCursor;
    if (cursor === null) break;
  }
  const item = ok(await call<Body>(api.app, "GET", `${S}/${scenarioId}`, { session: s }));
  raw += JSON.stringify(item);
  return { listed, item, raw };
}
const valueIds = (scenario: Body) => (scenario.values as Body[]).map((v) => v.id as string).sort();

beforeAll(async () => {
  api = await startApi();
  const w = await seedWorld(api.db);
  b = await seedBenefitWorld(api, w);
  office = await signIn(api.app, w.office.subject);
  tl = b.s.tl;
  aud = b.s.auditor;
  S = `${b.base}/benefit-scenarios`;
  const benefit = async (title: string) =>
    ok(
      await call<Body>(api.app, "POST", `${b.base}/benefits`, {
        session: b.s.bo,
        body: financialBody(b, { title }),
      }),
      201,
    ).id as string;
  sensitiveId = await benefit("Synthetic confidential tariff uplift");
  plainId = await benefit("Synthetic open tariff uplift");
  const scenario = ok(
    await call<Body>(api.app, "POST", S, { session: tl, body: { kind: "base", title: "Synthetic base case" } }),
    201,
  );
  scenarioId = scenario.id as string;
  scenarioVersion = scenario.version as number;
  expect(scenario.businessCaseId).toBeNull(); // a non-sensitive parent
  const value = async (benefitId: string, amount: string) =>
    ok(
      await call<Body>(api.app, "POST", `${S}/${scenarioId}/values`, {
        session: b.s.fin,
        body: { benefitId, ...period, amount, note: "Synthetic scenario value" },
      }),
      201,
    ).id as string;
  sensitiveValueId = await value(sensitiveId, SENSITIVE_AMOUNT);
  plainValueId = await value(plainId, PLAIN_AMOUNT);
}, 120_000);
afterAll(() => api?.close());

describe("before marking: every reader sees both value rows (DG4-DG5 unchanged)", () => {
  it("TL and AUD read both values in the scenario list and item", async () => {
    for (const s of [tl, aud]) {
      const { listed, item } = await views(s);
      for (const sc of [listed, item]) expect(valueIds(sc)).toEqual([sensitiveValueId, plainValueId].sort());
    }
  });
});

describe("after marking one benefit sensitive (T-DG6-BE-Z3, F-DG6-180 class)", () => {
  beforeAll(async () => {
    ok(
      await call<Body>(api.app, "PUT", `${b.base}/records/benefit/${sensitiveId}/sensitivity`, {
        session: office,
        headers: ifm(0),
        body: { isSensitive: true, reason: "Synthetic commercially sensitive figure" },
      }),
    );
  });

  it("control: TL and AUD get 404 on the benefit itself", async () => {
    for (const s of [tl, aud]) {
      expect((await call(api.app, "GET", `${b.base}/benefits/${sensitiveId}`, { session: s })).status).toBe(404);
    }
  });

  it("TL and AUD read the scenario (list and item, 200) WITHOUT the sensitive benefit's value row", async () => {
    for (const s of [tl, aud]) {
      const { listed, item, raw } = await views(s);
      for (const sc of [listed, item]) {
        expect(sc).toBeDefined();
        // Omitted, not a placeholder: only the plain benefit's row, with its amount.
        expect(valueIds(sc)).toEqual([plainValueId]);
        expect(sc.values[0]).toMatchObject({ benefitId: plainId, amount: PLAIN_AMOUNT, scenarioKind: "base" });
      }
      // Nothing in the response names the sensitive benefit, its value row or its amount.
      for (const secret of [sensitiveId, sensitiveValueId, SENSITIVE_AMOUNT, "9876543"])
        expect(raw).not.toContain(secret);
    }
  });

  it("TL's scenario update returns the scenario without the row (the write presenter follows the same rule)", async () => {
    const res = ok(
      await call<Body>(api.app, "PATCH", `${S}/${scenarioId}`, {
        session: tl,
        headers: ifm(scenarioVersion),
        body: { assumptions: "Synthetic: tariff elasticity unchanged" },
      }),
    );
    scenarioVersion = res.version as number;
    expect(valueIds(res)).toEqual([plainValueId]);
    expect(JSON.stringify(res)).not.toContain(SENSITIVE_AMOUNT);
  });

  it("TL's POST of a value naming the sensitive benefit answers like an unknown benefit (422) and writes nothing", async () => {
    const add = (benefitId: string) =>
      call<Body>(api.app, "POST", `${S}/${scenarioId}/values`, {
        session: tl,
        body: { benefitId, periodStart: "2027-01-01", periodEnd: "2027-12-31", amount: "1" },
      });
    const hidden = await add(sensitiveId);
    const unknown = await add("01890000-0000-7000-8000-000000000000");
    expect([hidden.status, hidden.body.code]).toEqual([422, "validation.reference"]);
    expect([hidden.status, hidden.body.code, hidden.body.detail, hidden.body.errors]).toEqual([
      unknown.status,
      unknown.body.code,
      unknown.body.detail,
      unknown.body.errors,
    ]);
    const rows = await api.db
      .selectFrom("benefit_scenario_value")
      .select("id")
      .where("benefit_id", "=", sensitiveId)
      .execute();
    expect(rows.map((r) => r.id)).toEqual([sensitiveValueId]);
  });

  it("positive: the TO and the owner (a named party) still read both value rows with their amounts", async () => {
    for (const s of [office, b.s.bo]) {
      const { listed, item } = await views(s);
      for (const sc of [listed, item]) {
        expect(valueIds(sc)).toEqual([sensitiveValueId, plainValueId].sort());
        expect((sc.values as Body[]).find((v) => v.id === sensitiveValueId)).toMatchObject({
          benefitId: sensitiveId,
          amount: SENSITIVE_AMOUNT,
        });
      }
    }
  });

  it("positive: TL with an explicit grant on the benefit reads the row again (next request); AUD still does not", async () => {
    ok(
      await call<Body>(api.app, "POST", "/api/v1/admin/sensitive-grants", {
        session: office,
        body: {
          transformationId: b.transformationId,
          recordType: "benefit",
          recordId: sensitiveId,
          granteeUserId: b.users.tl.id,
          reason: "Synthetic need to know",
        },
      }),
      201,
    );
    const { listed, item } = await views(tl);
    for (const sc of [listed, item]) expect(valueIds(sc)).toEqual([sensitiveValueId, plainValueId].sort());
    const audView = await views(aud);
    expect(valueIds(audView.item)).toEqual([plainValueId]);
  });
});
