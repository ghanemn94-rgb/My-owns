// A sensitive benefit in the Executive Overview, every dashboard drill-down metric, the Finance and adoption
// dashboards, and the report totals (T-DG6-BE-Z7B; F-DG6-360, F-DG6-361, F-DG6-340; ADR-0051 §2 as amended on
// 2026-11-04, "Totals and rollups"; D-195 Q3; REQ-S10-002 "a sensitive benefit is hidden from a workstream member
// without the grant"; M0188), against the run's disposable PostgreSQL seeded with the SYNTHETIC demo dataset.
// Marking a record sensitive is an access decision, never a business approval (G1-G6); nothing here touches DG0-DG7.
//
//   - negative (TL at the transformation, AUD at the organization: no grant, not a named party): no item, input or
//     evidence entry of the benefit (or of its planned and validated lines) on the overview, on any drill-down metric
//     with any value class, on the Finance or adoption dashboards; the figures (headlines, statuses, drill-down values)
//     equal the admitted reader's; `includesRestrictedRecords: true` on the overview and on every drill-down that
//     omitted something;
//   - report totals: the live benefits register and its stored snapshot omit the benefit's row for TL and AUD, keep
//     the totals byte for byte, and carry `includesRestrictedRecords: true` on that section; the TO (admitted) sees the
//     row, the same totals and `false`; a section that references no sensitive record carries no member, and the stored
//     content (and its contentSha256) never holds it;
//   - positive: the TO sees the benefit on the overview and in the value.gap drill-down (`includesRestrictedRecords:
//     false`).
// The overview and value.gap assertions fail on the tree before the T-DG6-BE-Z7 repair (the items were listed), and
// the report assertions fail before T-DG6-BE-Z7B (no member).
import { insertAuditEvent, migrate, seedDemo, sql } from "@mth/db";
import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { DEMO_ANCHORS } from "../../../../../packages/db/src/demo/data/kpis.ts";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../../../packages/db/test/helpers.ts";
import { DASHBOARD_METRICS, FINANCE_VALUE_CLASSES } from "../../../../../packages/shared/src/schemas/dashboards.ts";
import { canonicalReportJson } from "../../../src/modules/reporting/reports/snapshots.ts";
import { call, createUser, grant, signIn, startApi, type Session, type TestApi } from "../../support/harness.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const T = DEMO_ANCHORS.transformationId;
const ORG = DEMO_ANCHORS.organizationId;
const TITLE = "Synthetic CONFIDENTIAL BE-Z7B dashboard benefit";
let api: TestApi;
let scratch: string | null = null;
let to: Session;
let tl: Session;
let aud: Session;
const S = { benefitId: "", code: "", valueClass: "", lineIds: [] as string[], snapshotId: "", workstreamId: "" };
const get = (path: string, session: Session) => call<Body>(api.app, "GET", path, { session, contract: false });
const ok = async (path: string, session: Session): Promise<Body> => {
  const r = await get(path, session);
  expect(r.status, `${path}: ${JSON.stringify(r.body).slice(0, 300)}`).toBe(200);
  return r.body;
};

/** Every object of a body that names the benefit or one of its value lines, or carries its title. */
function mentions(body: Body): Body[] {
  const out: Body[] = [];
  const walk = (x: Body) => {
    if (x === null || typeof x !== "object") return;
    if (
      !Array.isArray(x) &&
      (x.recordId === S.benefitId ||
        S.lineIds.includes(x.recordId) ||
        (typeof x.label === "string" && x.label.includes(TITLE)))
    )
      out.push(x);
    for (const v of Object.values(x)) walk(v);
  };
  walk(body);
  if (JSON.stringify(body).includes(TITLE) && out.length === 0) out.push({ title: TITLE });
  return out;
}

/** The figures of a dashboard response: everything except the listed items and the generation time. */
function figures(body: Body): string {
  return JSON.stringify(body, (k, v) =>
    k === "items" || k === "generatedAt" || k === "includesRestrictedRecords" ? undefined : v,
  );
}

beforeAll(async () => {
  const { adminUrl } = inject("mthDb");
  scratch = await createScratchDatabase(adminUrl, "mth_be_z7b");
  await migrate(roleUrl(adminUrl, scratch, "mth_owner"));
  await seedDemo(roleUrl(adminUrl, scratch, "mth_owner"), {
    mthEnv: "demo",
    runKind: "seed",
    requestedVia: "cli",
    requestedBy: null,
  });
  api = await startApi({ database: scratch, env: { MTH_ENV: "demo" } });
  const grantor = DEMO_ANCHORS.users.sp;
  const mk = async (role: string, s: { type: "organization" | "transformation"; id: string }) => {
    const u = await createUser(api.db, ORG);
    await grant(api.db, grantor, u.id, role, s, ORG);
    return u;
  };
  to = await signIn(api.app, (await mk("TO", { type: "organization", id: ORG })).subject);
  tl = await signIn(api.app, (await mk("TL", { type: "transformation", id: T })).subject);
  aud = await signIn(api.app, (await mk("AUD", { type: "organization", id: ORG })).subject);
  const b = await api.db
    .selectFrom("benefit")
    .select(["id", "code", "version", "value_class"])
    .where("transformation_id", "=", T)
    .where("status", "=", "active")
    .orderBy("code")
    .executeTakeFirstOrThrow();
  S.benefitId = b.id;
  S.code = b.code;
  S.valueClass = String(b.value_class);
  S.lineIds = [
    ...(await api.db.selectFrom("benefit_plan_value").select("id").where("benefit_id", "=", b.id).execute()),
    ...(await api.db.selectFrom("benefit_measurement").select("id").where("benefit_id", "=", b.id).execute()),
  ].map((r) => r.id);
  expect(S.lineIds.length, "the demo benefit has planned or measured lines").toBeGreaterThan(0);
  await api.db.transaction().execute(async (tx) => {
    await sql`UPDATE benefit SET title = ${TITLE}, version = version + 1, updated_at = now()
               WHERE id = ${b.id}::uuid`.execute(tx);
    await insertAuditEvent(
      tx,
      { actorType: "user", actorUserId: grantor, requestId: `be-z7b-${b.id}`, source: "api" },
      {
        action: "benefit.update",
        recordType: "benefit",
        recordId: b.id,
        organizationId: ORG,
        transformationId: T,
        priorVersion: b.version,
        newVersion: b.version + 1,
      },
    );
  });
  const mark = await call<Body>(api.app, "PUT", `/api/v1/transformations/${T}/records/benefit/${b.id}/sensitivity`, {
    session: to,
    headers: { "if-match": '"0"' },
    body: { isSensitive: true, reason: "Synthetic commercially sensitive benefit" },
  });
  expect(mark.status, JSON.stringify(mark.body)).toBe(200);
  // A synthetic workstream over every initiative of the transformation (the demo dataset has none), so the workstream
  // dashboard's facts include the benefit (direct writes with their audit events, as the P4 fixtures do).
  S.workstreamId = randomUUID();
  await api.db.transaction().execute(async (tx) => {
    const actor = (id: string) => ({
      actorType: "user" as const,
      actorUserId: grantor,
      requestId: `be-z7b-${id}`,
      source: "api" as const,
    });
    await tx
      .insertInto("workstream")
      .values({
        id: S.workstreamId,
        organization_id: ORG,
        transformation_id: T,
        code: "WS-77",
        name: "Synthetic workstream BE-Z7B",
        created_by: grantor,
        updated_by: grantor,
      })
      .execute();
    await insertAuditEvent(tx, actor(S.workstreamId), {
      action: "workstream.create",
      recordType: "workstream",
      recordId: S.workstreamId,
      organizationId: ORG,
      transformationId: T,
      newVersion: 1,
    });
    const initiatives = await tx.selectFrom("initiative").select("id").where("transformation_id", "=", T).execute();
    for (const { id: initiativeId } of initiatives) {
      const linkId = randomUUID();
      await tx
        .insertInto("workstream_initiative")
        .values({
          id: linkId,
          organization_id: ORG,
          transformation_id: T,
          workstream_id: S.workstreamId,
          initiative_id: initiativeId,
          created_by: grantor,
          updated_by: grantor,
        })
        .execute();
      await insertAuditEvent(tx, actor(linkId), {
        action: "workstream_initiative.create",
        recordType: "workstream_initiative",
        recordId: linkId,
        organizationId: ORG,
        transformationId: T,
        newVersion: 1,
      });
    }
  });
  // A benefits register snapshot generated by the admitted TO (it holds the benefit's row when stored).
  const snap = await call<Body>(api.app, "POST", `/api/v1/transformations/${T}/reports/registers/generate`, {
    session: to,
    body: { parameters: { register: "benefits" } },
    contract: false,
  });
  expect(snap.status, JSON.stringify(snap.body).slice(0, 400)).toBe(201);
  S.snapshotId = snap.body.id;
}, 600_000);

afterAll(async () => {
  await api?.close();
  if (scratch !== null) await dropScratchDatabase(inject("mthDb").adminUrl, scratch);
}, 60_000);

const NOT_ADMITTED = () =>
  [
    ["TL", tl],
    ["AUD", aud],
  ] as const;

describe("F-DG6-360: the Executive Overview", () => {
  it("TL and AUD: no item of the sensitive benefit, the same figures as the TO, includesRestrictedRecords true; the TO sees it (false)", async () => {
    for (const q of [`organizationId=${ORG}&transformationId=${T}`, `organizationId=${ORG}`]) {
      const admitted = await ok(`/api/v1/overview?${q}`, to);
      expect(mentions(admitted).length, `TO ?${q}`).toBeGreaterThan(0);
      expect(admitted.includesRestrictedRecords, `TO ?${q}`).toBe(false);
      for (const [who, s] of NOT_ADMITTED()) {
        const r = await ok(`/api/v1/overview?${q}`, s);
        expect(mentions(r), `${who} ?${q}`).toEqual([]);
        expect(r.includesRestrictedRecords, `${who} ?${q}`).toBe(true);
        // The TL reads one transformation: its figures are compared on the transformation-narrowed query.
        if (who === "AUD" || q.includes("transformationId")) expect(figures(r), `${who} ?${q}`).toBe(figures(admitted));
      }
    }
  });
});

describe("F-DG6-361: every drill-down metric and value class", () => {
  const variants = (): string[] => {
    const out: string[] = [];
    for (const metric of DASHBOARD_METRICS) {
      if (metric === "outcomes.kpi_status") continue; // a KPI subject metric: no benefit in it (covered by the sweep)
      const base = `organizationId=${ORG}&transformationId=${T}&metric=${metric}&limit=100`;
      out.push(base);
      if (metric.startsWith("value.") && metric !== "value.investment")
        for (const c of metric === "value.gap" ? ["revenue_uplift", "avoided_cost"] : FINANCE_VALUE_CLASSES)
          out.push(`${base}&valueClass=${c}`, `${base}&valueClass=${c}&currency=SAR`);
    }
    return out;
  };

  it("TL and AUD: no item, input or evidence entry of the benefit or its lines; the same value; flagged when something was omitted", async () => {
    const bad: string[] = [];
    let flagged = 0;
    for (const q of variants()) {
      const path = `/api/v1/dashboard-drilldown?${q}`;
      const a = await get(path, to);
      if (a.status !== 200) {
        // A metric/class combination the contract refuses is refused to every reader alike (never a sensitivity answer).
        for (const [who, s] of NOT_ADMITTED()) expect((await get(path, s)).status, `${who} ${q}`).toBe(a.status);
        continue;
      }
      const admittedSees = mentions(a.body).length > 0;
      for (const [who, s] of NOT_ADMITTED()) {
        const r = await ok(path, s);
        const m = mentions(r);
        if (m.length > 0) bad.push(`${who} ${q}: ${m.map((x: Body) => `${x.recordType}:${x.label}`).join(", ")}`);
        expect(JSON.stringify(r.value), `${who} ${q}: the figure`).toBe(JSON.stringify(a.body.value));
        expect(r.calculation.expression, `${who} ${q}`).toBe(a.body.calculation.expression);
        if (admittedSees) {
          flagged += 1;
          expect(r.includesRestrictedRecords, `${who} ${q}`).toBe(true);
        }
      }
    }
    expect(bad).toEqual([]);
    expect(flagged, "the benefit is in at least one drill-down the admitted reader sees").toBeGreaterThan(0);
  });

  it("the value.gap drill-down of the benefit's class lists its lines to the TO (false) and none to TL or AUD (true)", async () => {
    const gapClass = ["revenue_uplift", "avoided_cost"].includes(S.valueClass) ? S.valueClass : "revenue_uplift";
    const path = `/api/v1/dashboard-drilldown?organizationId=${ORG}&transformationId=${T}&metric=value.gap&valueClass=${gapClass}&limit=100`;
    const a = await ok(path, to);
    if (gapClass === S.valueClass) {
      expect(
        a.items.filter((i: Body) => S.lineIds.includes(i.recordId)).length,
        "the TO sees the benefit's lines",
      ).toBeGreaterThan(0);
      expect(a.includesRestrictedRecords).toBe(false);
    }
    for (const [who, s] of NOT_ADMITTED()) {
      const r = await ok(path, s);
      expect(
        r.items.filter((i: Body) => S.lineIds.includes(i.recordId)),
        who,
      ).toEqual([]);
      expect(mentions(r), who).toEqual([]);
    }
  });
});

describe("F-DG6-361: the Finance, adoption, transformation and workstream dashboards", () => {
  it("TL and AUD: no mention of the benefit, the same figures as the TO, labelled; the TO sees it on the transformation and workstream dashboards", async () => {
    for (const path of [
      `/api/v1/dashboards/finance?organizationId=${ORG}&transformationId=${T}`,
      `/api/v1/dashboards/adoption?organizationId=${ORG}&transformationId=${T}`,
      `/api/v1/transformations/${T}/dashboard`,
      `/api/v1/transformations/${T}/workstreams/${S.workstreamId}/dashboard`,
    ]) {
      const a = await ok(path, to);
      // The transformation and workstream dashboards list the benefit to the admitted reader (the positive control).
      if (!path.includes("/dashboards/")) expect(mentions(a).length, `TO ${path}`).toBeGreaterThan(0);
      for (const [who, s] of NOT_ADMITTED()) {
        const r = await ok(path, s);
        expect(mentions(r), `${who} ${path}`).toEqual([]);
        expect(figures(r), `${who} ${path}`).toBe(figures(a));
        // The adoption dashboard has no such member (its figures hold no benefit value); every other one is labelled.
        if (!path.includes("/dashboards/adoption")) expect(r.includesRestrictedRecords, `${who} ${path}`).toBe(true);
      }
    }
  });
});

describe("F-DG6-340: report totals that include a restricted value", () => {
  const live = (register: string) =>
    `/api/v1/transformations/${T}/reports/registers/live?parameters=${encodeURIComponent(JSON.stringify({ register }))}`;
  const tables = (doc: Body): Body[] => doc.sections.filter((s: Body) => s.kind === "table");
  const totalsOf = (doc: Body) => JSON.stringify(tables(doc).map((s: Body) => [s.key, s.totals]));
  const flagged = (doc: Body) =>
    doc.sections.filter((s: Body) => s.includesRestrictedRecords === true).map((s: Body) => s.key);

  for (const kind of ["live", "snapshot"] as const)
    it(`${kind} benefits register: TL and AUD get no row of the benefit, the same totals and includesRestrictedRecords true on its section; the TO gets the row and false`, async () => {
      const read = async (s: Session) =>
        kind === "live"
          ? (await ok(live("benefits"), s)).document
          : (await ok(`/api/v1/transformations/${T}/report-snapshots/${S.snapshotId}`, s)).content;
      const admitted = await read(to);
      const withRow = admitted.sections.filter((s: Body) =>
        (s.rows ?? []).some((r: Body) => r.recordId === S.benefitId),
      );
      expect(withRow.length, "the TO sees the benefit's row").toBeGreaterThan(0);
      for (const sec of withRow) expect(sec.includesRestrictedRecords, `TO ${sec.key}`).toBe(false);
      expect(flagged(admitted)).toEqual([]);
      for (const [who, s] of NOT_ADMITTED()) {
        const doc = await read(s);
        expect(mentions(doc), who).toEqual([]);
        expect(totalsOf(doc), `${who}: the totals are the same for every reader (D-195 Q3)`).toBe(totalsOf(admitted));
        const keys = flagged(doc);
        for (const sec of withRow) expect(keys, `${who}: ${sec.key} is labelled`).toContain(sec.key);
        // A section that references no sensitive record carries no member at all.
        for (const sec of doc.sections)
          if (!withRow.some((x: Body) => x.key === sec.key) && sec.includesRestrictedRecords !== undefined)
            expect(sec.includesRestrictedRecords, `${who} ${sec.key}`).toBe(true);
      }
    });

  it("a register with no sensitive record (kpis) carries no member; the stored content never holds it and its hash is unchanged", async () => {
    for (const [who, s] of [["TO", to], ...NOT_ADMITTED()] as const) {
      const doc = (await ok(live("kpis"), s)).document;
      expect(JSON.stringify(doc).includes("includesRestrictedRecords"), who).toBe(false);
    }
    const row = await api.db
      .selectFrom("report_snapshot")
      .select(["content", "content_sha256"])
      .where("id", "=", S.snapshotId)
      .executeTakeFirstOrThrow();
    expect(JSON.stringify(row.content).includes("includesRestrictedRecords")).toBe(false);
    expect(
      createHash("sha256")
        .update(canonicalReportJson(row.content as Body), "utf8")
        .digest("hex"),
    ).toBe(row.content_sha256);
  });

  it("benefit-totals: the same totals for TL and TO, flagged true for TL and false for the TO (unchanged BE-B2 behaviour)", async () => {
    const path = `/api/v1/transformations/${T}/benefit-totals`;
    const a = await ok(path, to);
    expect(a.includesRestrictedRecords).toBe(false);
    for (const [who, s] of NOT_ADMITTED()) {
      const r = await ok(path, s);
      expect(r.includesRestrictedRecords, who).toBe(true);
      expect(JSON.stringify({ ...r, includesRestrictedRecords: null, computedAt: null }), who).toBe(
        JSON.stringify({ ...a, includesRestrictedRecords: null, computedAt: null }),
      );
    }
  });
});

// T-DG6-BE-Z9 (F-DG6-400; ADR-0051 §2 "Totals and rollups"; D-195 Q3): a report section whose figures are aggregates
// of the dashboard facts (the executive pack's `metrics_*`, the executive dashboard's `area_value`) references only its
// subject, yet its value headlines include the sensitive benefit's value (and the executive dashboard's items_portfolio
// rows name only initiatives, yet their planned values include the benefits allocated to them). The flag is decided
// from the records the aggregate includes: true for TL and AUD (not admitted), false for the TO, live and in a stored
// snapshot; an area whose
// figures include no benefit or business case (outcomes, portfolio, ...) carries no member; the figures are the same
// for every reader and the stored content never holds the read-time member. Fails before T-DG6-BE-Z9 (no member).
describe("F-DG6-400: report metrics sections whose aggregates include a restricted value", () => {
  let periodId = "";
  const snapshots: Record<string, string> = {};
  const flagOf = (doc: Body, key: string) => doc.sections.find((s: Body) => s.key === key)?.includesRestrictedRecords;
  const fieldsOf = (doc: Body) =>
    JSON.stringify(doc.sections.filter((s: Body) => s.kind === "metrics").map((s: Body) => [s.key, s.fields]));
  const AGGREGATES: Record<string, string[]> = {
    executive_pack: ["metrics_transformation", "metrics_ws_77"],
    // items_portfolio: each initiative row's planned value is Σ its allocated benefits' planned amounts × share, and
    // the demo benefit is allocated to an initiative, so the table's values include it although no row names it.
    executive_dashboard: ["area_value", "items_portfolio"],
  };
  const withoutFlag = (doc: Body, key: string) =>
    JSON.stringify({ ...doc.sections.find((s: Body) => s.key === key), includesRestrictedRecords: null });
  const read = async (code: string, kind: "live" | "snapshot", s: Session): Promise<Body> =>
    kind === "live"
      ? (await ok(`/api/v1/transformations/${T}/reports/${code}/live?reportingPeriodId=${periodId}`, s)).document
      : (await ok(`/api/v1/transformations/${T}/report-snapshots/${snapshots[code]}`, s)).content;

  beforeAll(async () => {
    const today = new Date().toISOString().slice(0, 10);
    const p = await api.db
      .selectFrom("reporting_period")
      .select("id")
      .where("organization_id", "=", ORG)
      .where("period_start", "<=", today)
      .orderBy("period_start", "desc")
      .executeTakeFirstOrThrow();
    periodId = p.id;
    // Generated by the admitted TO: the stored content is the same for every reader.
    for (const code of Object.keys(AGGREGATES)) {
      const r = await call<Body>(api.app, "POST", `/api/v1/transformations/${T}/reports/${code}/generate`, {
        session: to,
        body: { reportingPeriodId: periodId, parameters: {} },
        contract: false,
      });
      expect(r.status, JSON.stringify(r.body).slice(0, 400)).toBe(201);
      snapshots[code] = r.body.id;
    }
  }, 300_000);

  for (const code of Object.keys(AGGREGATES))
    for (const kind of ["live", "snapshot"] as const)
      it(`${kind} ${code}: ${AGGREGATES[code]!.join(", ")} labelled true for TL and AUD, false for the TO; the same figures; non-aggregate sections unchanged`, async () => {
        const admitted = await read(code, kind, to);
        for (const key of AGGREGATES[code]!) expect(flagOf(admitted, key), `TO ${key}`).toBe(false);
        for (const [who, s] of NOT_ADMITTED()) {
          const doc = await read(code, kind, s);
          expect(mentions(doc), who).toEqual([]);
          expect(fieldsOf(doc), `${who}: the metrics are the same for every reader (D-195 Q3)`).toBe(
            fieldsOf(admitted),
          );
          for (const key of AGGREGATES[code]!) {
            expect(flagOf(doc, key), `${who} ${key}`).toBe(true);
            // Nothing is omitted from an aggregate section: the same rows and figures as the TO's, only labelled.
            expect(withoutFlag(doc, key), `${who} ${key}`).toBe(withoutFlag(admitted, key));
          }
          // An area whose figures include no benefit or business case (outcomes, portfolio, ...) carries no member.
          for (const sec of doc.sections)
            if (sec.kind === "metrics" && !AGGREGATES[code]!.includes(sec.key))
              expect(sec.includesRestrictedRecords, `${who} ${sec.key}`).toBeUndefined();
        }
      });

  it("the stored content never holds the member and its hash is unchanged; the included records are kept beside it", async () => {
    for (const code of Object.keys(AGGREGATES)) {
      const row = await api.db
        .selectFrom("report_snapshot")
        .select(["content", "content_sha256"])
        .where("id", "=", snapshots[code]!)
        .executeTakeFirstOrThrow();
      expect(JSON.stringify(row.content).includes("includesRestrictedRecords"), code).toBe(false);
      expect(
        createHash("sha256")
          .update(canonicalReportJson(row.content as Body), "utf8")
          .digest("hex"),
        code,
      ).toBe(row.content_sha256);
      const kept = await api.db
        .selectFrom("report_snapshot_aggregate")
        .select(["section_key", "record_type", "record_id"])
        .where("snapshot_id", "=", snapshots[code]!)
        .where("record_id", "=", S.benefitId)
        .execute();
      expect(kept.map((k) => k.section_key).sort(), code).toEqual([...AGGREGATES[code]!].sort());
    }
  });

  it("an aggregate row is append-only and written only by the snapshot's creating transaction", async () => {
    const id = snapshots["executive_pack"]!;
    await expect(
      sql`UPDATE report_snapshot_aggregate SET section_key = 'x' WHERE snapshot_id = ${id}::uuid`.execute(api.db),
    ).rejects.toThrow();
    await expect(
      sql`DELETE FROM report_snapshot_aggregate WHERE snapshot_id = ${id}::uuid`.execute(api.db),
    ).rejects.toThrow();
    await expect(
      sql`INSERT INTO report_snapshot_aggregate (id, organization_id, transformation_id, snapshot_id, section_key, record_type, record_id)
          VALUES (${randomUUID()}::uuid, ${ORG}::uuid, ${T}::uuid, ${id}::uuid, 'metrics_transformation', 'benefit', ${randomUUID()}::uuid)`.execute(
        api.db,
      ),
    ).rejects.toThrow(/creation_only|only in the transaction/);
  });
});

/** The cluster superuser on this file's scratch database (session_replication_role needs it). */
function superuserUrl(): string {
  const u = new URL(inject("mthDb").adminUrl);
  u.pathname = `/${scratch!}`;
  u.search = "";
  return u.toString();
}

// T-DG6-BE-Z9: a snapshot stored before migration 0126 (`aggregates_recorded` false: its aggregate records were not
// kept) is labelled conservatively from every benefit and business case marked sensitive in its transformation; the
// column never changes after the insert. Simulated on a fresh snapshot by the superuser with the triggers bypassed
// (session_replication_role, as the D-213 race tests do): the API itself can never write it.
describe("F-DG6-400: snapshots stored before the aggregate records were kept", () => {
  let su: pg.Pool;
  let periodId = "";
  beforeAll(async () => {
    su = new pg.Pool({ connectionString: superuserUrl(), max: 1 });
    su.on("error", () => undefined);
    const today = new Date().toISOString().slice(0, 10);
    periodId = (
      await api.db
        .selectFrom("reporting_period")
        .select("id")
        .where("organization_id", "=", ORG)
        .where("period_start", "<=", today)
        .orderBy("period_start", "desc")
        .executeTakeFirstOrThrow()
    ).id;
  });
  afterAll(async () => {
    await su?.end();
  });

  it("the API refuses to change aggregates_recorded", async () => {
    const snap = await api.db.selectFrom("report_snapshot").select("id").limit(1).executeTakeFirstOrThrow();
    await expect(
      sql`UPDATE report_snapshot SET aggregates_recorded = false WHERE id = ${snap.id}::uuid`.execute(api.db),
    ).rejects.toThrow(/aggregates_recorded/);
  });

  it("a legacy executive pack: metrics_* labelled true for TL and AUD, false for the TO; update sections unchanged", async () => {
    const gen = await call<Body>(api.app, "POST", `/api/v1/transformations/${T}/reports/executive_pack/generate`, {
      session: to,
      body: { reportingPeriodId: periodId, parameters: {} },
      contract: false,
    });
    expect(gen.status, JSON.stringify(gen.body).slice(0, 300)).toBe(201);
    const id = gen.body.id as string;
    await su.query(`BEGIN; SET LOCAL session_replication_role = replica;
      UPDATE report_snapshot SET aggregates_recorded = false WHERE id = '${id}'; COMMIT;`);
    const path = `/api/v1/transformations/${T}/report-snapshots/${id}`;
    const flags = (doc: Body) =>
      Object.fromEntries(doc.sections.map((s: Body) => [s.key, s.includesRestrictedRecords ?? "absent"]));
    const admitted = flags((await ok(path, to)).content);
    expect(admitted["metrics_transformation"]).toBe(false);
    expect(admitted["update_transformation"]).toBe("absent");
    for (const [who, s] of NOT_ADMITTED()) {
      const f = flags((await ok(path, s)).content);
      expect(f["metrics_transformation"], who).toBe(true);
      expect(f["metrics_ws_77"], who).toBe(true);
      expect(f["update_transformation"], who).toBe("absent");
    }
  });
});

// T-DG6-BE-Z9 sweep (gate pack): a criterion row's `unverified_evidence_count` counts evidence items the row does not
// name. When one of them is marked sensitive, the criteria section is labelled for a reader who is not admitted to
// it (the count is the same for every reader). The demo dataset records no unverified evidence, so the superuser sets
// one demo criterion's recorded detail (triggers bypassed, as above); the evidence is marked through the API. Runs last
// in this file: marking evidence sensitive changes what later reads would see.
describe("F-DG6-400 sweep: the gate pack's unverified-evidence counts", () => {
  it("criteria labelled true for TL and AUD, false for the TO, with the same counts", async () => {
    const su = new pg.Pool({ connectionString: superuserUrl(), max: 1 });
    su.on("error", () => undefined);
    try {
      const sub = await api.db
        .selectFrom("gate_submission as g")
        .innerJoin("gate_submission_criterion as c", "c.gate_submission_id", "g.id")
        .select(["g.gate_instance_id", "g.id as submissionId", "c.id as criterionId"])
        .where("g.transformation_id", "=", T)
        .orderBy("g.gate_instance_id")
        .orderBy("g.submission_no", "desc")
        .orderBy("c.ordinal")
        .executeTakeFirstOrThrow();
      const ev = await api.db
        .selectFrom("evidence")
        .select("id")
        .where("transformation_id", "=", T)
        .orderBy("id")
        .executeTakeFirstOrThrow();
      await su.query(`BEGIN; SET LOCAL session_replication_role = replica;
        UPDATE gate_submission_criterion SET detail = '${JSON.stringify({ missing: [], unverifiedEvidenceIds: [ev.id] })}'::jsonb
         WHERE id = '${sub.criterionId}'; COMMIT;`);
      const path = `/api/v1/transformations/${T}/reports/gate_pack/live?subjectId=${sub.gate_instance_id}`;
      const criteria = async (s: Session) =>
        (await ok(path, s)).document.sections.find((x: Body) => x.key === "criteria");
      expect((await criteria(to)).includesRestrictedRecords, "nothing marked yet").toBeUndefined();
      const mark = await call<Body>(
        api.app,
        "PUT",
        `/api/v1/transformations/${T}/records/evidence/${ev.id}/sensitivity`,
        {
          session: to,
          headers: { "if-match": '"0"' },
          body: { isSensitive: true, reason: "Synthetic sensitive evidence (gate pack count)" },
        },
      );
      expect(mark.status, JSON.stringify(mark.body)).toBe(200);
      const admitted = await criteria(to);
      expect(admitted.includesRestrictedRecords).toBe(false);
      for (const [who, s] of NOT_ADMITTED()) {
        const sec = await criteria(s);
        expect(sec.includesRestrictedRecords, who).toBe(true);
        expect(JSON.stringify(sec.rows), `${who}: the same criterion rows and counts`).toBe(
          JSON.stringify(admitted.rows),
        );
      }
    } finally {
      await su.end();
    }
  });
});
