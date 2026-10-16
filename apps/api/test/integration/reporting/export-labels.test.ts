// The export content label table (T-DG5-KBE-D2; D-157 a; p5-work-split §F.11 item 10; REQ-S13-009, REQ-S13-008;
// ADR-0045 §3, ADR-0046 §2-§4). Proves, against the run's disposable PostgreSQL and the real renderers:
//  - the production `reports.export` dependencies (apps/worker handlers/reports.ts `exportRunnerDeps`) carry the en/ar
//    content table `REPORT_CONTENT_LABELS` of @mth/shared;
//  - for EVERY one of the twelve report definitions, generated from seeded synthetic worlds (the P2 world with a submitted
//    G1 and an unsubmitted G2, all six registers, a reporting period; a meeting world with a Transformation Review and an
//    Executive SteerCo meeting; a sustainment world with a BAU handover), every format the definition lists, rendered in
//    English AND in Arabic with those labels, reports no `missingLabels`: no Arabic export prints an English fallback
//    heading, column or code label, and no English one prints a key-derived fallback.
// All data is SYNTHETIC; the G1 submission is a demo action and approves nothing real. No label names DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { REPORT_CONTENT_LABELS } from "@mth/shared";
import { render } from "../../../../../packages/reporting/src/render.ts";
import { exportRunnerDeps } from "../../../../worker/src/handlers/reports.ts";
import { call, seedWorld, signIn, startApi, type TestApi, type World } from "../../support/harness.ts";
import { gateVersion, ifm, makeG1Ready, setupP2World, type P2World } from "../../support/p2-fixtures.ts";
import { seedSustainmentWorld } from "../contract/p4-exercises-be-i.ts";
import { setupMeetingWorld } from "../governance/meeting-fixtures.ts";
import { draftHandover, generated, ok, richMeetings, type Body } from "./kbe-d2-fixtures.ts";

let api: TestApi;
let w: World;
let p: P2World;
const snapshots: Body[] = [];
let definitions: Body[] = [];

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  p = await setupP2World(api, w);
  const T = p.transformationId;
  await makeG1Ready(api, p);
  const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call<Body>(api.app, m, u, o);
  definitions = ok(
    await send("GET", `/api/v1/report-definitions`, { session: p.lead.session }),
    200,
    "definitions",
  ).items;

  // A monthly reporting period of the organization (the executive dashboard and pack need one).
  const office = await signIn(api.app, w.office.subject);
  const base = `/api/v1/organizations/${w.orgA.id}/reporting-periods`;
  const period = ok(
    await send("POST", base, {
      session: office,
      body: {
        frequency: "monthly",
        periodLabel: "2041-03",
        periodStart: "2041-03-01",
        periodEnd: "2041-03-31",
        updateDueDate: "2041-04-10",
      },
    }),
    201,
    "period",
  );
  ok(await send("POST", `${base}/${period.id}/open`, { session: office, headers: ifm(1) }), 200, "open period");
  ok(
    await send("POST", `/api/v1/transformations/${T}/workstreams`, {
      session: p.lead.session,
      body: { name: "Synthetic workstream", leadUserId: null },
    }),
    201,
    "workstream",
  );

  for (const code of ["charter", "diagnostic", "tom", "business_cases", "roadmap"])
    snapshots.push(await generated(api, T, code, p.lead.session));
  for (const register of ["raid", "benefits", "kpis", "decisions", "dependencies", "actions"])
    snapshots.push(await generated(api, T, "registers", p.lead.session, { parameters: { register } }));
  for (const code of ["executive_dashboard", "executive_pack"])
    snapshots.push(await generated(api, T, code, p.lead.session, { reportingPeriodId: period.id }));
  const g2 = ok(await send("GET", `/api/v1/transformations/${T}/gates/G2`, { session: p.lead.session }), 200, "G2");
  snapshots.push(await generated(api, T, "gate_pack", p.lead.session, { subjectId: g2.gate.id }));
  const g1 = ok(await send("GET", `/api/v1/transformations/${T}/gates/G1`, { session: p.lead.session }), 200, "G1");
  ok(
    await send("POST", `/api/v1/transformations/${T}/gates/G1/submissions`, {
      session: p.lead.session,
      headers: ifm(await gateVersion(api, p, "G1")),
      body: {},
    }),
    201,
    "submit G1 (synthetic demo submission)",
  );
  snapshots.push(await generated(api, T, "gate_pack", p.lead.session, { subjectId: g1.gate.id }));

  const x = await setupMeetingWorld(api, w);
  const m = await richMeetings(api, x);
  snapshots.push(
    await generated(api, x.transformationId, "meeting_minutes", x.lead.session, { subjectId: m.review.id }),
  );
  snapshots.push(await generated(api, x.transformationId, "meeting_pack", x.lead.session, { subjectId: m.steerco.id }));

  const s = await seedSustainmentWorld(api, w);
  const h = await draftHandover(api, s);
  snapshots.push(await generated(api, s.b.transformationId, "handover", s.wl.session, { subjectId: h.id }));
}, 300_000);
afterAll(() => api.close());

describe("the export content label table (D-157 a; REQ-S13-009)", () => {
  it("is what the production reports.export handler passes to the export runner", () => {
    expect(exportRunnerDeps().labels).toBe(REPORT_CONTENT_LABELS);
    expect(Object.keys(REPORT_CONTENT_LABELS.en).sort()).toEqual(Object.keys(REPORT_CONTENT_LABELS.ar).sort());
  });

  it("covers all twelve definitions: every format, en and ar, reports no missingLabels", async () => {
    expect(new Set(snapshots.map((s) => s.definitionCode))).toEqual(new Set(definitions.map((d) => d.code)));
    const missing: Record<string, string[]> = {};
    for (const [i, snap] of snapshots.entries()) {
      const def = definitions.find((d) => d.code === snap.definitionCode)!;
      for (const format of def.formats as string[])
        for (const language of ["en", "ar"] as const) {
          const r = await render(snap.content, {
            format: format as Parameters<typeof render>[1]["format"],
            language,
            title: language === "en" ? def.labelEn : def.labelAr,
            branding: { productName: "Mobily Transformation Hub" },
            snapshot: { id: snap.id, status: snap.status, issueVersion: snap.issueVersion },
            labels: REPORT_CONTENT_LABELS,
          });
          if (r.missingLabels.length > 0)
            missing[`${i}:${snap.definitionCode}/${format}/${language}`] = [...r.missingLabels];
        }
    }
    const union = [...new Set(Object.values(missing).flat())].sort();
    expect(union, `missing labels:\n${union.join("\n")}`).toEqual([]);
    expect(missing).toEqual({});
  }, 300_000);
});
