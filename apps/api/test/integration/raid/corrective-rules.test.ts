// The configured severity and persistence rules through the API (T-DG4-BE-D2; ADR-0031 §5.2, §9-§11; REQ-PB-085
// "under the configured severity and persistence rule", M0227). Proves, against the run's disposable PostgreSQL:
//  - listCorrectiveActionRules returns the four kinds, each with the §5.2 default (isDefault, id and version null)
//    until a rule is stored; cursor pagination visits each kind once;
//  - TL and TO store and change a rule (corrective_rule.configure); BO, FIN and AUD 403; ADM-only and outsiders 404;
//  - a severity only for KPI deviations and required there (422 corrective_rule.severity_kpi_only at /minKpiRag);
//    persistence > 1 only for the series kinds (422 corrective_rule.persistence_series_only at /persistenceCycles);
//    a second rule for a kind is 409 corrective_rule.exists; updating a kind without a stored rule is 404;
//  - If-Match 428/409; one audit event per change; commit-time authorisation.
// All data is SYNTHETIC; a rule is configuration, never a business approval, and nothing touches DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditOf, call, seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";
import { extraUser, seedBenefitWorld, type BenefitWorld } from "../benefits/fixtures.ts";

let api: TestApi;
let w: World;
let b: BenefitWorld;
let to: Awaited<ReturnType<typeof extraUser>>;
let RU: string;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  b = await seedBenefitWorld(api, w);
  to = await extraUser(api, w, b, "TO");
  RU = `${b.base}/corrective-action-rules`;
}, 60_000);
afterAll(async () => {
  await api.close();
}, 60_000);

const SEVERITY = "A severity applies to KPI deviations only, and a KPI deviation rule needs one.";
const PERSISTENCE = "A failed check is one event: its persistence is 1 cycle.";

describe("listCorrectiveActionRules (ADR-0031 §5.2 defaults)", () => {
  it("returns the four kinds with their defaults until a rule is stored; pagination visits each once", async () => {
    const fresh = await seedBenefitWorld(api, w);
    const r = await call(api.app, "GET", `${fresh.base}/corrective-action-rules`, { session: fresh.s.auditor });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      items: [
        {
          id: null,
          sourceKind: "kpi_deviation",
          minKpiRag: "red",
          persistenceCycles: 2,
          followUpWorkingDays: 5,
          enabled: true,
          isDefault: true,
          version: null,
        },
        ...["benefit_variance", "adoption_check", "control_check"].map((sourceKind) => ({
          id: null,
          sourceKind,
          minKpiRag: null,
          persistenceCycles: 1,
          followUpWorkingDays: 5,
          enabled: true,
          isDefault: true,
          version: null,
        })),
      ],
      nextCursor: null,
    });
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const q: string = `${fresh.base}/corrective-action-rules?limit=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const page = await call(api.app, "GET", q, { session: fresh.s.tl });
      seen.push(...page.body.items.map((x: { sourceKind: string }) => x.sourceKind));
      cursor = page.body.nextCursor;
    } while (cursor);
    expect(seen).toEqual(["kpi_deviation", "benefit_variance", "adoption_check", "control_check"]);
    for (const session of [fresh.s.admin, fresh.s.outsider])
      expect((await call(api.app, "GET", `${fresh.base}/corrective-action-rules`, { session })).status).toBe(404);
  });
});

describe("createCorrectiveActionRule and updateCorrectiveActionRule", () => {
  it("TL stores a KPI rule (amber, 3 cycles); the list shows it stored; TO changes it with If-Match", async () => {
    const r = await call(api.app, "POST", RU, {
      session: b.s.tl,
      body: { sourceKind: "kpi_deviation", minKpiRag: "amber", persistenceCycles: 3, followUpWorkingDays: 10 },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect([r.headers.etag, r.headers.location]).toEqual(['"1"', `${RU}/kpi_deviation`]);
    expect(r.body).toMatchObject({
      sourceKind: "kpi_deviation",
      minKpiRag: "amber",
      persistenceCycles: 3,
      followUpWorkingDays: 10,
      enabled: true,
      isDefault: false,
      version: 1,
    });
    const listed = await call(api.app, "GET", RU, { session: b.s.auditor });
    expect(
      listed.body.items.map((x: { sourceKind: string; isDefault: boolean }) => [x.sourceKind, x.isDefault]),
    ).toEqual([
      ["kpi_deviation", false],
      ["benefit_variance", true],
      ["adoption_check", true],
      ["control_check", true],
    ]);
    const dup = await call(api.app, "POST", RU, {
      session: to.session,
      body: { sourceKind: "kpi_deviation", minKpiRag: "red", persistenceCycles: 2, followUpWorkingDays: 5 },
    });
    expect([dup.status, dup.body.type, dup.body.code, dup.body.detail]).toEqual([
      409,
      "urn:mth:problem:duplicate",
      "corrective_rule.exists",
      "A rule for this source already exists in this transformation; update it instead.",
    ]);
    const noIfMatch = await call(api.app, "PATCH", `${RU}/kpi_deviation`, {
      session: to.session,
      body: { enabled: false },
    });
    expect(noIfMatch.status).toBe(428);
    const stale = await call(api.app, "PATCH", `${RU}/kpi_deviation`, {
      session: to.session,
      headers: ifm(5),
      body: { enabled: false },
    });
    expect([stale.status, stale.body.currentVersion]).toEqual([409, 1]);
    const upd = await call(api.app, "PATCH", `${RU}/kpi_deviation`, {
      session: to.session,
      headers: ifm(1),
      body: { minKpiRag: "red", enabled: false },
    });
    expect([upd.status, upd.body.minKpiRag, upd.body.enabled, upd.body.version, upd.headers.etag]).toEqual([
      200,
      "red",
      false,
      2,
      '"2"',
    ]);
    expect((await auditOf(api.db, r.body.id)).map((a) => [a.action, a.new_version])).toEqual([
      ["corrective_action_rule.create", 1],
      ["corrective_action_rule.update", 2],
    ]);
  });

  it("severity only for KPI deviations and required there; persistence > 1 only for KPI and benefit; nothing written", async () => {
    const cases: [Record<string, unknown>, string, string, string][] = [
      [
        { sourceKind: "kpi_deviation", persistenceCycles: 2, followUpWorkingDays: 5 },
        "corrective_rule.severity_kpi_only",
        SEVERITY,
        "/minKpiRag",
      ],
      [
        { sourceKind: "control_check", minKpiRag: "red", persistenceCycles: 1, followUpWorkingDays: 5 },
        "corrective_rule.severity_kpi_only",
        SEVERITY,
        "/minKpiRag",
      ],
      [
        { sourceKind: "adoption_check", persistenceCycles: 2, followUpWorkingDays: 5 },
        "corrective_rule.persistence_series_only",
        PERSISTENCE,
        "/persistenceCycles",
      ],
    ];
    for (const [body, code, detail, pointer] of cases) {
      const r = await call(api.app, "POST", RU, { session: b.s.tl, body });
      expect([r.status, r.body.code, r.body.detail, r.body.errors[0].pointer]).toEqual([422, code, detail, pointer]);
    }
    const rows = await api.db
      .selectFrom("corrective_action_rule")
      .select("source_kind")
      .where("transformation_id", "=", b.transformationId)
      .where("source_kind", "in", ["control_check", "adoption_check"])
      .execute();
    expect(rows).toEqual([]);
    // A benefit rule may persist over cycles.
    const benefit = await call(api.app, "POST", RU, {
      session: b.s.tl,
      body: { sourceKind: "benefit_variance", persistenceCycles: 2, followUpWorkingDays: 3 },
    });
    expect([benefit.status, benefit.body.persistenceCycles]).toEqual([201, 2]);
    // An update is checked on the merged rule.
    const clear = await call(api.app, "PATCH", `${RU}/benefit_variance`, {
      session: b.s.tl,
      headers: ifm(1),
      body: { minKpiRag: "amber" },
    });
    expect([clear.status, clear.body.code]).toEqual([422, "corrective_rule.severity_kpi_only"]);
    // Out of range and unknown kinds are 400.
    expect(
      (
        await call(api.app, "POST", RU, {
          session: b.s.tl,
          body: { sourceKind: "control_check", persistenceCycles: 1, followUpWorkingDays: 61 },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call(api.app, "POST", RU, {
          session: b.s.tl,
          body: { sourceKind: "value_review", persistenceCycles: 1, followUpWorkingDays: 5 },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call(api.app, "PATCH", `${RU}/control_check`, {
          session: b.s.tl,
          headers: ifm(1),
          body: { enabled: false },
        })
      ).status,
    ).toBe(404);
  });

  it("BO, FIN and AUD 403; ADM-only and outsiders 404; nothing written", async () => {
    const body = { sourceKind: "control_check", persistenceCycles: 1, followUpWorkingDays: 7 };
    for (const session of [b.s.bo, b.s.fin, b.s.auditor]) {
      expect((await call(api.app, "POST", RU, { session, body })).status).toBe(403);
      expect(
        (await call(api.app, "PATCH", `${RU}/kpi_deviation`, { session, headers: ifm(2), body: { enabled: true } }))
          .status,
      ).toBe(403);
    }
    for (const session of [b.s.admin, b.s.outsider]) {
      expect((await call(api.app, "POST", RU, { session, body })).status).toBe(404);
      expect(
        (await call(api.app, "PATCH", `${RU}/kpi_deviation`, { session, headers: ifm(2), body: { enabled: true } }))
          .status,
      ).toBe(404);
    }
    const row = await api.db
      .selectFrom("corrective_action_rule")
      .select("id")
      .where("transformation_id", "=", b.transformationId)
      .where("source_kind", "=", "control_check")
      .executeTakeFirst();
    expect(row).toBeUndefined();
  });

  it("commit-time: corrective_rule.configure revoked while the request waited is 403; nothing written", async () => {
    const u = await extraUser(api, w, b, "TO");
    const res = await afterIdentity(
      api,
      u.id,
      () =>
        call(api.app, "POST", RU, {
          session: u.session,
          body: { sourceKind: "adoption_check", persistenceCycles: 1, followUpWorkingDays: 4 },
          contract: false,
        }),
      () => revokeAll(api, w.grantor.id, u.id),
    );
    expect(res.status).toBe(403);
    const row = await api.db
      .selectFrom("corrective_action_rule")
      .select("id")
      .where("transformation_id", "=", b.transformationId)
      .where("source_kind", "=", "adoption_check")
      .executeTakeFirst();
    expect(row).toBeUndefined();
  });
});
