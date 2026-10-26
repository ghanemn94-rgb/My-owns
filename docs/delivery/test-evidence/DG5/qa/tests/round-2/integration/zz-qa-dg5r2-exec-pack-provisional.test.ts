// qa-verifier DG5 round 2 (T-DG5-RG2-QA-R2; carried from my round-1 probe, unchanged otherwise) probe: REQ-S13-008 "a pending benefit value is labelled provisional in
// the PDF pack", tested literally on a GENERATED EXECUTIVE PACK (the register's partial-coverage note says only the
// benefits-register PDF is proven). Runs in a disposable clone only (copied to tests/qa/integration/ there).
// The database is a scratch database seeded with the real SYNTHETIC International Roaming demo dataset (ADR-0050);
// nothing here approves anything real and nothing names an engineering gate.
//
// Procedure: seed demo -> QA user (TO, TL) -> a reporting period -> generate executive_pack -> find the value
// headlines in the snapshot (value.submitted = pending) -> export PDF en and ar -> the pending value's number appears
// with the Provisional / مؤقت label, and the snapshot labels it `provisional`. If the demo has no pending value in
// the period, the probe submits nothing itself: it reports what it found (no silent pass: it fails).
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { migrate, seedDemo } from "../../../packages/db/src/index.ts";
import { DEMO_ANCHORS } from "../../../packages/db/src/demo/data/kpis.ts";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../packages/db/test/helpers.ts";
import { ifm } from "../../../apps/api/test/support/p2-fixtures.ts";
import { call, createUser, grant, signIn, startApi, type Session, type TestApi } from "../support/api.ts";
import { exportFile, ok, viewOf, type Body } from "../support/a15.ts";

const ORG = DEMO_ANCHORS.organizationId;
const T_ID = DEMO_ANCHORS.transformationId;
const T = `/api/v1/transformations/${T_ID}`;

let api: TestApi;
let scratch: string | null = null;
let qa: Session;
let pack: Body;

type Field = { key: string; labelKey?: string; value: Body };
const allFields = (content: Body): Field[] =>
  ((content.sections ?? []) as Body[]).flatMap((s) => ((s.fields ?? []) as Field[]).map((f) => ({ ...f, section: s.key })));

beforeAll(async () => {
  const { adminUrl } = inject("mthDb");
  scratch = await createScratchDatabase(adminUrl, "mth_qa_r1_execpack");
  await migrate(roleUrl(adminUrl, scratch, "mth_owner"));
  await seedDemo(roleUrl(adminUrl, scratch, "mth_owner"), {
    mthEnv: "demo",
    runKind: "seed",
    requestedVia: "cli",
    requestedBy: null,
  });
  api = await startApi({ database: scratch, env: { MTH_ENV: "demo" } });
  const u = await createUser(api.db, ORG);
  for (const role of ["TO", "TL"])
    await grant(api.db, DEMO_ANCHORS.users.sp, u.id, role, { type: "organization", id: ORG }, ORG);
  qa = await signIn(api.app, u.subject);
  const base = `/api/v1/organizations/${ORG}/reporting-periods`;
  // The demo dataset's pending (Finance-pending) measurement is revenue_uplift.2026-08 (SAR 99,000, submitted
  // 2026-09-01, not decided). Use the demo's own 2026-08 reporting period if it has one; else create it.
  const listed = ok(await call<Body>(api.app, "GET", `${base}?limit=100`, { session: qa }), 200, "periods");
  console.info(`QA-R1 demo periods: ${JSON.stringify((listed.items as Body[]).map((p) => [p.periodLabel, p.periodStart, p.status]))}`);
  let period = (listed.items as Body[]).find((p) => p.periodStart === "2026-08-01");
  if (period === undefined) {
    period = ok(
      await call<Body>(api.app, "POST", base, {
        session: qa,
        body: { frequency: "monthly", periodLabel: "2026-08", periodStart: "2026-08-01", periodEnd: "2026-08-31", updateDueDate: "2026-09-10" },
      }),
      201,
      "period",
    );
    ok(await call<Body>(api.app, "POST", `${base}/${period.id}/open`, { session: qa, headers: ifm(1) }), 200, "open");
  }
  const r = await call<Body>(api.app, "POST", `${T}/reports/executive_pack/generate`, {
    session: qa,
    body: { reportingPeriodId: period.id },
  });
  expect(r.status, JSON.stringify(r.body).slice(0, 400)).toBe(201);
  pack = r.body;
}, 300_000);

afterAll(async () => {
  await api?.close();
  if (scratch !== null) await dropScratchDatabase(inject("mthDb").adminUrl, scratch);
}, 60_000);

describe("QA-R1 REQ-S13-008 on the generated executive pack", () => {
  it("the pack's value headlines: a pending (submitted) value carries a number and the label 'provisional'", () => {
    const value = allFields(pack.content).filter((f) => f.value?.valueBasis != null);
    console.info(
      `QA-R1 exec-pack value fields: ${JSON.stringify(value.map((f) => ({ s: (f as Body).section, k: f.key, v: f.value })))}`,
    );
    const pending = value.filter((f) => f.value.valueBasis === "submitted");
    expect(pending.length, "the pack has a submitted (pending) value headline").toBeGreaterThan(0);
    for (const f of pending) expect(f.value.validation, f.key).toBe("provisional");
    const nonZero = pending.filter((f) => f.value.value != null && Number(f.value.value) > 0);
    expect(nonZero.map((f) => [f.key, f.value.value]), "the pending SAR 99,000 is a submitted headline").toContainEqual([
      "value_submitted_top_line_sar",
      expect.stringMatching(/^99000(\.0+)?$/),
    ]);
    // validated values are never labelled provisional
    for (const f of value.filter((x) => x.value.valueBasis === "validated"))
      expect(f.value.validation, f.key).not.toBe("provisional");
    expect(pack.provisionalValueCount).toBeGreaterThan(0);
  });

  for (const [language, word] of [
    ["en", "Provisional"],
    ["ar", "مؤقت"],
  ] as const)
    it(`PDF (${language}): the pending value is printed with the label '${word}'`, async () => {
      const v = await viewOf("pdf", (await exportFile(api, qa, { snapshotId: pack.id, format: "pdf", language })).bytes);
      const pieces = v.pieces.map((x) => x.trim());
      const figure = /^(?:SAR\s*)?99[,٬]?000(?:[.٫]00)?(?:\s*SAR)?$|^99[,٬]?000|99[,٬]000|٩٩[,٬]?٠٠٠/;
      const hits = pieces.flatMap((p, i) => (figure.test(p) ? [i] : []));
      console.info(
        `QA-R1 exec-pack PDF ${language}: pieces=${pieces.length}; figure hits=${JSON.stringify(hits.map((i) => pieces.slice(Math.max(0, i - 4), i + 5)))}`,
      );
      expect(hits.length, "the pending figure 99,000 is printed").toBeGreaterThan(0);
      const labelled = hits.filter((i) => pieces.slice(Math.max(0, i - 4), i + 5).some((p) => p.includes(word)));
      expect(labelled.length, `the pending figure is printed next to '${word}'`).toBeGreaterThan(0);
    }, 120_000);
});
