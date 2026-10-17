// T-DG5-KBE-D4 (D-164 g; QA-C O3; ADR-0045 §3, ADR-0046 §9) against a real PostgreSQL and the real CSV renderer: the
// KPI register prints each KPI's target in its own unit kind through the shared display formatter, never the raw
// stored decimal:
//  - a count KPI with target 100 (stored `100.000000`) shows "100";
//  - a percentage KPI with target 0.25 (a fraction) shows "25 %";
//  - in the English and the Arabic export the same text is printed (Latin digits in both languages);
//  - the stored target is not rounded (the kpi_version row still holds the full decimal).
// All data is SYNTHETIC. Nothing here approves anything or touches the engineering gates DG0-DG7.
import { REPORT_CONTENT_LABELS } from "@mth/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { render } from "../../../../../packages/reporting/src/render.ts";
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
import { ifm, setupP2World, type P2World } from "../../support/p2-fixtures.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

let api: TestApi;
let w: World;
let p: P2World;
let T: string;
let kds: { id: string; session: Session };
let countKpi: string;
let percentKpi: string;
let percentVersionId: string;

const ok = (res: { status: number; body: unknown }, status: number, what: string): Body => {
  expect(res.status, `${what}: ${JSON.stringify(res.body).slice(0, 800)}`).toBe(status);
  return res.body as Body;
};

/** A KPI created and activated with an active version of target `target` (KDS through the API). */
async function activeKpi(name: string, unitKind: string, target: string): Promise<{ id: string; versionId: string }> {
  const created = ok(
    await call<Body>(api.app, "POST", `${T}/kpi-definitions`, {
      session: kds.session,
      body: { name, unitKind, unitLabel: null, polarity: "higher_is_better", frequency: "monthly" },
    }),
    201,
    "createKpiDefinition",
  );
  ok(
    await call<Body>(api.app, "POST", `${T}/kpi-definitions/${created.id}/activate`, {
      session: kds.session,
      headers: ifm(created.version),
    }),
    200,
    "activateKpiDefinition",
  );
  const v = ok(
    await call<Body>(api.app, "POST", `${T}/kpi-definitions/${created.id}/versions`, {
      session: kds.session,
      body: {
        measureType: "higher_is_better",
        valueNature: unitKind === "percentage" ? "stock" : "flow",
        aggregationRule: unitKind === "percentage" ? "last_value" : "sum",
        submissionRoute: "direct_accept",
        targetValue: target,
      },
    }),
    201,
    "createKpiVersion",
  );
  ok(
    await call<Body>(api.app, "POST", `${T}/kpi-versions/${v.id}/activate`, {
      session: kds.session,
      headers: ifm(v.version),
    }),
    200,
    "activateKpiVersion",
  );
  return { id: created.id, versionId: v.id };
}

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  p = await setupP2World(api, w);
  T = `/api/v1/transformations/${p.transformationId}`;
  const u = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, u.id, "KDS", { type: "transformation", id: p.transformationId }, w.orgA.id);
  kds = { id: u.id, session: await signIn(api.app, u.subject) };
  countKpi = (await activeKpi("Synthetic activated lines", "count", "100")).id;
  const pct = await activeKpi("Synthetic digital share", "percentage", "0.25");
  percentKpi = pct.id;
  percentVersionId = pct.versionId;
}, 120_000);
afterAll(() => api.close());

const targetOf = (doc: Body, kpiId: string): Body => {
  const sec = doc.sections.find((s: Body) => s.key === "register");
  const row = sec.rows.find((r: Body) => r.recordId === kpiId);
  expect(row, `the KPI ${kpiId} in the register`).toBeDefined();
  return row.cells[sec.columns.findIndex((c: Body) => c.key === "target")];
};

describe("D-164 g: the KPI target in the registers output", () => {
  it("the live register shows 100 for 100.000000 and the percentage target in its % form", async () => {
    const stored = await api.db
      .selectFrom("kpi_version")
      .select(["kpi_definition_id", "target_value"])
      .where("kpi_definition_id", "in", [countKpi, percentKpi])
      .where("status", "=", "active")
      .execute();
    // The stored values keep their full scale (never rounded by the report).
    expect(Object.fromEntries(stored.map((s) => [s.kpi_definition_id, String(s.target_value)]))).toEqual({
      [countKpi]: "100.000000",
      [percentKpi]: "0.250000",
    });
    const live = ok(
      await call<Body>(
        api.app,
        "GET",
        `${T}/reports/registers/live?parameters=${encodeURIComponent('{"register":"kpis"}')}`,
        { session: p.lead.session },
      ),
      200,
      "live kpis register",
    );
    expect(targetOf(live.document, countKpi)).toMatchObject({ type: "text", value: "100", authored: "system" });
    expect(targetOf(live.document, percentKpi)).toMatchObject({ type: "text", value: "25 %", authored: "system" });
  });

  it("the issued register's CSV export prints 100 and 25 % in English and in Arabic, never the raw decimal", async () => {
    const s = ok(
      await call<Body>(api.app, "POST", `${T}/reports/registers/generate`, {
        session: p.lead.session,
        body: { parameters: { register: "kpis" } },
      }),
      201,
      "generate kpis register",
    );
    expect(targetOf(s.content, countKpi).value).toBe("100");
    expect(targetOf(s.content, percentKpi).value).toBe("25 %");
    // The snapshot still records the KPI's calculation version (unchanged by the formatting).
    const versions = ok(
      await call<Body>(api.app, "GET", `${T}/report-snapshots/${s.id}/versions`, { session: p.lead.session }),
      200,
      "versions",
    );
    expect(versions.items.map((v: Body) => v.referenceId)).toContain(percentVersionId);
    for (const language of ["en", "ar"] as const) {
      const r = await render(s.content, {
        format: "csv",
        language,
        title: language === "en" ? "Registers" : "السجلات",
        branding: { productName: "Mobily Transformation Hub" },
        snapshot: { id: s.id, status: s.status, issueVersion: s.issueVersion },
        labels: REPORT_CONTENT_LABELS,
      });
      const text = new TextDecoder("utf-8").decode(r.bytes);
      const line = (name: string) => text.split("\r\n").find((l) => l.includes(name)) ?? "";
      expect(line("Synthetic activated lines").split(","), language).toContain("100");
      expect(line("Synthetic digital share").split(","), language).toContain("25 %");
      expect(text, language).not.toContain("100.000000");
      expect(text, language).not.toContain("0.250000");
    }
  });
});
