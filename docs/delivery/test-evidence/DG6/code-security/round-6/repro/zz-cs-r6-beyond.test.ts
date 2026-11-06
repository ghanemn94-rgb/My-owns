// code-security-reviewer, DG6 round 6 (T-DG6-REV-CS-R6): adversarial probe for REQ-S10-002 / ADR-0051 §2 on the
// surfaces the BE-Z7B tests do not seed (sensitive-reach-dashboards-reports.test.ts marks ONE benefit, the first by
// code, and no business case or evidence item). NOT part of the candidate: copied into a disposable clone's
// tests/qa/integration by checks.sh repro and removed afterwards. Demo data is SYNTHETIC. Marking a record sensitive is
// an access decision, never a business approval (G1-G6); nothing here touches DG0-DG7.
//
// World (demo seed):
//   BC  a business case of the transformation that has investment lines, retitled, marked sensitive by a TO;
//   B2  the LAST active benefit by code that has measurements (a different benefit from the BE-Z7B test's), retitled,
//       marked sensitive;
//   EV  a note evidence item created by the TO, linked (benefit_evidence) to a measurement of an OPEN benefit (B3, not
//       sensitive), retitled, marked sensitive.
// Readers: TL (transformation scope) and AUD (organization scope), neither admitted; TO admitted (organization grant).
// Checks, every answer logged:
//   A. Executive Overview (org; org+t), Finance, adoption, transformation dashboards: no mention for TL/AUD; the same
//      figures as the TO; includesRestrictedRecords true for TL/AUD;
//   B. every drill-down metric x (no class | every Finance class) x (no currency | SAR), EVERY page followed with
//      limit=2: no item/input/evidence entry naming BC, its lines, B2, its lines or EV; the flag is the same on every
//      page; the drill value is the same for TL and TO;
//   C. live reports: every definition (registers x every register; business_cases with and without subjectId=BC):
//      no row/item/source naming BC/B2/EV for TL/AUD; subjectId=BC answers 404; a section that held a restricted row
//      for the TO carries includesRestrictedRecords true for TL;
//   D. EV: the TO sees it in the value.validated drill-down evidence of B3's class; TL does not and the response is
//      flagged true (restrictedFieldAfter).
import { insertAuditEvent, migrate, seedDemo, sql } from "../../../packages/db/src/index.ts";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { DEMO_ANCHORS } from "../../../packages/db/src/demo/data/kpis.ts";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../packages/db/test/helpers.ts";
import { REPORT_DEFINITION_CODES, REPORT_REGISTERS } from "../../../packages/shared/src/schemas/report.ts";
import { DASHBOARD_METRICS, FINANCE_VALUE_CLASSES } from "../../../packages/shared/src/schemas/dashboards.ts";
import { call, createUser, grant, signIn, startApi, type Session, type TestApi } from "../../../apps/api/test/support/harness.ts";
import { randomUUID } from "node:crypto";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const T = DEMO_ANCHORS.transformationId;
const ORG = DEMO_ANCHORS.organizationId;
const CASE_TITLE = "Synthetic CONFIDENTIAL CS-R6 case";
const B2_TITLE = "Synthetic CONFIDENTIAL CS-R6 benefit two";
const EV_TITLE = "Synthetic CONFIDENTIAL CS-R6 evidence";
let api: TestApi;
let scratch: string | null = null;
let to: Session;
let tl: Session;
let aud: Session;
const S = {
  caseId: "",
  caseCode: "",
  caseLineIds: [] as string[],
  b2: "",
  b2Code: "",
  b2Class: "",
  b2LineIds: [] as string[],
  b3: "",
  b3Class: "",
  evId: "",
  b3MeasurementStatus: "",
};
const log = (...a: unknown[]) => console.log("[CS-R6]", ...a);
const get = (path: string, session: Session) => call<Body>(api.app, "GET", path, { session, contract: false });
const ids = () => new Set([S.caseId, ...S.caseLineIds, S.b2, ...S.b2LineIds, S.evId]);
/** Every object of a body naming a restricted record (its id, a line id) or carrying one of the titles. */
function mentions(body: Body): string[] {
  const out: string[] = [];
  const all = ids();
  const walk = (x: Body) => {
    if (x === null || typeof x !== "object") return;
    if (!Array.isArray(x)) {
      for (const k of ["recordId", "id", "evidenceId", "subjectId"])
        if (typeof x[k] === "string" && all.has(x[k])) out.push(`${k}=${x[k]} ${x.recordType ?? ""} ${x.label ?? x.title ?? ""}`);
    }
    for (const v of Object.values(x)) walk(v);
  };
  walk(body);
  const text = JSON.stringify(body ?? null);
  for (const t of [CASE_TITLE, B2_TITLE, EV_TITLE]) if (text.includes(t)) out.push(`title:${t}`);
  return out;
}
const figures = (body: Body) =>
  JSON.stringify(body, (k, v) =>
    k === "items" || k === "generatedAt" || k === "includesRestrictedRecords" || k === "evidence" || k === "nextCursor" ? undefined : v,
  );
const readers = () =>
  [
    ["TL", tl],
    ["AUD", aud],
  ] as const;

async function retitle(table: string, id: string, title: string, version: number, actor: string) {
  await api.db.transaction().execute(async (tx) => {
    await sql`UPDATE ${sql.table(table)} SET title = ${title}, version = version + 1, updated_at = now() WHERE id = ${id}::uuid`.execute(tx);
    await insertAuditEvent(
      tx,
      { actorType: "user", actorUserId: actor, requestId: `cs-r6-${id}`, source: "api" },
      { action: `${table}.update`, recordType: table, recordId: id, organizationId: ORG, transformationId: T, priorVersion: version, newVersion: version + 1 },
    );
  });
}
async function mark(type: string, id: string) {
  const r = await call<Body>(api.app, "PUT", `/api/v1/transformations/${T}/records/${type}/${id}/sensitivity`, {
    session: to,
    headers: { "if-match": '"0"' },
    body: { isSensitive: true, reason: "Synthetic commercially sensitive record (CS-R6)" },
  });
  log(`mark ${type} ${id}: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
}

beforeAll(async () => {
  const { adminUrl } = inject("mthDb");
  scratch = await createScratchDatabase(adminUrl, "mth_cs_r6");
  await migrate(roleUrl(adminUrl, scratch, "mth_owner"));
  await seedDemo(roleUrl(adminUrl, scratch, "mth_owner"), { mthEnv: "demo", runKind: "seed", requestedVia: "cli", requestedBy: null });
  api = await startApi({ database: scratch, env: { MTH_ENV: "demo" } });
  const grantor = DEMO_ANCHORS.users.sp;
  const mk = async (role: string, s: { type: "organization" | "transformation"; id: string }) => {
    const u = await createUser(api.db, ORG);
    await grant(api.db, grantor, u.id, role, s, ORG);
    return u;
  };
  const uTo = await mk("TO", { type: "organization", id: ORG });
  to = await signIn(api.app, uTo.subject);
  tl = await signIn(api.app, (await mk("TL", { type: "transformation", id: T })).subject);
  aud = await signIn(api.app, (await mk("AUD", { type: "organization", id: ORG })).subject);

  // BC: a business case of T with investment lines (the one with most lines).
  const bc = await sql<{ id: string; code: string; version: number; n: number }>`
    SELECT c.id::text, c.code, c.version, count(l.id)::int AS n FROM business_case c JOIN business_case_line l ON l.business_case_id = c.id
     WHERE c.transformation_id = ${T}::uuid GROUP BY c.id ORDER BY count(l.id) DESC, c.code LIMIT 1`.execute(api.db);
  const c = bc.rows[0]!;
  S.caseId = c.id;
  S.caseCode = c.code;
  S.caseLineIds = (await api.db.selectFrom("business_case_line").select("id").where("business_case_id", "=", c.id).execute()).map((r) => r.id);
  log(`BC ${c.code} ${c.id} lines=${S.caseLineIds.length}`);
  await retitle("business_case", c.id, CASE_TITLE, c.version, grantor);
  await mark("business_case", c.id);

  // B2: the last active benefit by code with measurements; B3: another active benefit with a measurement (open).
  const withM = await sql<{ id: string; code: string; version: number; value_class: string }>`
    SELECT b.id::text, b.code, b.version, b.value_class FROM benefit b
     WHERE b.transformation_id = ${T}::uuid AND b.status = 'active'
       AND EXISTS (SELECT 1 FROM benefit_measurement m WHERE m.benefit_id = b.id AND m.status = 'validated')
     ORDER BY b.code DESC`.execute(api.db);
  log(`benefits with validated measurements: ${withM.rows.map((r) => `${r.code}/${r.value_class}`).join(", ")}`);
  const b2 = withM.rows[0]!;
  const b3 = withM.rows[withM.rows.length - 1]!;
  S.b2 = b2.id;
  S.b2Code = b2.code;
  S.b2Class = b2.value_class;
  S.b2LineIds = [
    ...(await api.db.selectFrom("benefit_plan_value").select("id").where("benefit_id", "=", b2.id).execute()),
    ...(await api.db.selectFrom("benefit_measurement").select("id").where("benefit_id", "=", b2.id).execute()),
  ].map((r) => r.id);
  log(`B2 ${b2.code} ${b2.id} class=${b2.value_class} lines=${S.b2LineIds.length}; (other: ${b3.code})`);
  await retitle("benefit", b2.id, B2_TITLE, b2.version, grantor);
  await mark("benefit", b2.id);

  // EV: a note evidence item linked to a validated measurement of B3 (open), then marked sensitive.
  const ev = await call<Body>(api.app, "POST", `/api/v1/transformations/${T}/evidence`, {
    session: to,
    body: { ownerUserId: uTo.id, kind: "note", title: EV_TITLE, noteBody: "Synthetic note (CS-R6)" },
  });
  log(`create evidence: ${ev.status} ${JSON.stringify(ev.body).slice(0, 200)}`);
  expect(ev.status).toBe(201);
  S.evId = ev.body.id;
  // benefit_evidence accepts only a draft or submitted measurement (its trigger): the first such of an open benefit.
  const m3 = await api.db
    .selectFrom("benefit_measurement as m")
    .innerJoin("benefit as b", "b.id", "m.benefit_id")
    .select(["m.id", "m.benefit_id", "m.status", "b.value_class", "b.code"])
    .where("b.transformation_id", "=", T)
    .where("m.benefit_id", "<>", b2.id)
    .where("m.status", "in", ["draft", "submitted"])
    .orderBy("m.id")
    .executeTakeFirstOrThrow();
  log(`EV measurement ${m3.id} of ${m3.code} status=${m3.status} class=${m3.value_class}`);
  S.b3 = m3.benefit_id;
  S.b3Class = m3.value_class;
  S.b3MeasurementStatus = m3.status;
  await api.db.transaction().execute(async (tx) => {
    const id = randomUUID();
    await tx
      .insertInto("benefit_evidence")
      .values({ id, organization_id: ORG, transformation_id: T, benefit_id: m3.benefit_id, measurement_id: m3.id, evidence_id: S.evId, created_by: uTo.id })
      .execute();
    await insertAuditEvent(
      tx,
      { actorType: "user", actorUserId: uTo.id, requestId: `cs-r6-be-${id}`, source: "api" },
      { action: "benefit_evidence.create", recordType: "benefit_evidence", recordId: id, organizationId: ORG, transformationId: T, newVersion: 1 },
    );
  });
  await mark("evidence", S.evId);
}, 600_000);

afterAll(async () => {
  await api?.close();
  if (scratch !== null) await dropScratchDatabase(inject("mthDb").adminUrl, scratch);
}, 60_000);

describe("CS-R6 beyond the BE-Z7B tests: a sensitive business case, a second sensitive benefit and a sensitive evidence item", () => {
  it("control: TL and AUD get 404 on BC and B2, TO gets 200", async () => {
    for (const [who, s] of readers()) {
      const a = await get(`/api/v1/transformations/${T}/benefits/${S.b2}`, s);
      const b = await get(`/api/v1/business-cases/${S.caseId}`, s);
      log(`control ${who}: benefit ${a.status} case ${b.status}`);
      expect(a.status).toBe(404);
      expect(b.status).toBe(404);
    }
    expect((await get(`/api/v1/transformations/${T}/benefits/${S.b2}`, to)).status).toBe(200);
    expect((await get(`/api/v1/business-cases/${S.caseId}`, to)).status).toBe(200);
  });

  it("A: overview, Finance, adoption and transformation dashboards", async () => {
    const bad: string[] = [];
    const paths = [
      `/api/v1/overview?organizationId=${ORG}`,
      `/api/v1/overview?organizationId=${ORG}&transformationId=${T}`,
      `/api/v1/dashboards/finance?organizationId=${ORG}`,
      `/api/v1/dashboards/finance?organizationId=${ORG}&transformationId=${T}`,
      `/api/v1/dashboards/adoption?organizationId=${ORG}&transformationId=${T}`,
      `/api/v1/transformations/${T}/dashboard`,
    ];
    for (const p of paths) {
      const ref = await get(p, to);
      log(`A TO ${p} -> ${ref.status} flag=${ref.body?.includesRestrictedRecords} mentions=${mentions(ref.body).length}`);
      for (const [who, s] of readers()) {
        const r = await get(p, s);
        const m = mentions(r.body);
        const same = figures(r.body) === figures(ref.body);
        log(`A ${who} ${p} -> ${r.status} flag=${r.body?.includesRestrictedRecords} sameFigures=${same} mentions=${JSON.stringify(m).slice(0, 600)}`);
        if (r.status !== 200) bad.push(`${who} ${p}: status ${r.status}`);
        if (m.length > 0) bad.push(`${who} ${p}: ${m.join("; ")}`);
        if (!same) bad.push(`${who} ${p}: figures differ from the TO's`);
        if (!p.includes("adoption") && r.body?.includesRestrictedRecords !== true) bad.push(`${who} ${p}: flag ${r.body?.includesRestrictedRecords}`);
      }
    }
    expect(bad).toEqual([]);
  }, 600_000);

  it("B: every drill-down metric, class and currency, every page (limit=2)", async () => {
    const bad: string[] = [];
    const statuses = new Map<string, number>();
    let pages = 0;
    const variants: string[] = [];
    for (const metric of DASHBOARD_METRICS) {
      const base = `organizationId=${ORG}&transformationId=${T}&metric=${metric}`;
      variants.push(base, `${base}&currency=SAR`);
      for (const c of FINANCE_VALUE_CLASSES) variants.push(`${base}&valueClass=${c}`, `${base}&valueClass=${c}&currency=SAR`);
    }
    for (const q of variants) {
      const first = async (s: Session) => get(`/api/v1/dashboard-drilldown?${q}&limit=2`, s);
      const ref = await first(to);
      const refMentions = ref.status === 200 ? mentions(ref.body).length : 0;
      for (const [who, s] of readers()) {
        let r = await first(s);
        statuses.set(`${r.status}`, (statuses.get(`${r.status}`) ?? 0) + 1);
        if (r.status !== ref.status) bad.push(`${who} ${q}: ${r.status} vs TO ${ref.status}`);
        if (r.status !== 200) continue;
        if (figures({ value: r.body.value, calc: r.body.calculation?.ruleKey }) !== figures({ value: ref.body.value, calc: ref.body.calculation?.ruleKey }))
          bad.push(`${who} ${q}: value differs from the TO's`);
        const flag = r.body.includesRestrictedRecords;
        let n = 0;
        for (;;) {
          pages += 1;
          n += 1;
          const m = mentions(r.body);
          if (m.length > 0) bad.push(`${who} ${q} page ${n}: ${m.join("; ")}`);
          if (r.body.includesRestrictedRecords !== flag) bad.push(`${who} ${q} page ${n}: flag ${r.body.includesRestrictedRecords} vs ${flag}`);
          if (r.body.nextCursor === null || n > 200) break;
          r = await get(`/api/v1/dashboard-drilldown?${q}&limit=2&cursor=${encodeURIComponent(r.body.nextCursor)}`, s);
          if (r.status !== 200) {
            bad.push(`${who} ${q} page ${n + 1}: ${r.status}`);
            break;
          }
        }
        if (refMentions > 0 && flag !== true) bad.push(`${who} ${q}: TO page 1 lists restricted entries but TL/AUD flag is ${flag}`);
      }
    }
    log(`B variants=${variants.length} pages read (TL+AUD)=${pages} statuses=${JSON.stringify([...statuses])}`);
    for (const b of bad) log(`B BAD ${b}`);
    expect(bad).toEqual([]);
  }, 1_200_000);

  it("C: live reports of every definition", async () => {
    const bad: string[] = [];
    const answers: string[] = [];
    const reqs: string[] = [];
    for (const code of REPORT_DEFINITION_CODES) {
      if (code === "registers") for (const register of REPORT_REGISTERS) reqs.push(`registers/live?parameters=${encodeURIComponent(JSON.stringify({ register }))}`);
      else reqs.push(`${code}/live`);
    }
    reqs.push(`business_cases/live?subjectId=${S.caseId}`);
    // The definitions whose subject is not the transformation, over every subject row of T (round-6 extension).
    for (const [code, table] of [
      ["meeting_minutes", "meeting"],
      ["meeting_pack", "meeting"],
      ["gate_pack", "gate_instance"],
      ["handover", "bau_handover"],
    ] as const) {
      const rows = await sql<{ id: string }>`SELECT id::text FROM ${sql.table(table)} WHERE transformation_id = ${T}::uuid ORDER BY id`.execute(api.db);
      log(`C subjects ${code}/${table}: ${rows.rows.length}`);
      for (const r of rows.rows) reqs.push(`${code}/live?subjectId=${r.id}`);
    }
    for (const q of reqs) {
      const ref = await get(`/api/v1/transformations/${T}/reports/${q}`, to);
      const refSections = new Map<string, Body>((ref.body?.document?.sections ?? []).map((s: Body) => [s.key, s]));
      for (const [who, s] of readers()) {
        const r = await get(`/api/v1/transformations/${T}/reports/${q}`, s);
        answers.push(`${who} ${q.slice(0, 40)}:${r.status}/TO ${ref.status}`);
        if (q.includes(`subjectId=${S.caseId}`)) {
          // business_cases is a transformation-subject definition (snapshots.ts resolveSubject): a subjectId other than
          // the transformation is 422 report.subject_invalid for EVERY reader (attempt 1 assumed 404). The check is that
          // the restricted case's id gives TL/AUD the same answer as the admitted TO (no existence oracle).
          if (r.status !== ref.status || r.body?.code !== ref.body?.code)
            bad.push(`${who} ${q}: ${r.status} ${r.body?.code} vs TO ${ref.status} ${ref.body?.code}`);
          continue;
        }
        if (r.status !== ref.status) bad.push(`${who} ${q}: ${r.status} vs TO ${ref.status}`);
        if (r.status !== 200) continue;
        const m = mentions(r.body);
        if (m.length > 0) bad.push(`${who} ${q}: ${m.join("; ")}`);
        for (const sec of r.body.document.sections as Body[]) {
          const t = refSections.get(sec.key);
          if (t && mentions(t).length > 0)
            log(`C flagged ${who} ${q.slice(0, 60)} section ${sec.key}: TO names ${mentions(t).length} restricted ref(s), TO flag ${t.includesRestrictedRecords}, ${who} flag ${sec.includesRestrictedRecords}, ${who} names ${mentions(sec).length}`);
          if (t && mentions(t).length > 0 && sec.includesRestrictedRecords !== true)
            bad.push(`${who} ${q} section ${sec.key}: TO section names a restricted record, TL/AUD flag ${sec.includesRestrictedRecords}`);
          if (t && t.kind === "table" && JSON.stringify(t.totals ?? null) !== JSON.stringify(sec.totals ?? null))
            bad.push(`${who} ${q} section ${sec.key}: totals differ from the TO's`);
        }
      }
    }
    log(`C ${answers.join(" | ")}`);
    for (const b of bad) log(`C BAD ${b}`);
    expect(bad).toEqual([]);
  }, 600_000);

  it("D: the sensitive evidence item on an open benefit's draft or submitted line, on every value metric", async () => {
    let seenByTo = 0;
    const bad: string[] = [];
    for (const metric of DASHBOARD_METRICS.filter((m) => m.startsWith("value.") || m.startsWith("finance.")))
      for (const cls of [null, S.b3Class]) {
        const q = `organizationId=${ORG}&transformationId=${T}&metric=${metric}${cls ? `&valueClass=${cls}` : ""}&limit=100`;
        const t = await get(`/api/v1/dashboard-drilldown?${q}`, to);
        const evTo = (t.body?.evidence ?? []).filter((e: Body) => e.evidenceId === S.evId);
        seenByTo += evTo.length;
        log(`D TO ${metric} ${cls} -> ${t.status} evidence=${t.body?.evidence?.length} EV listed=${evTo.length} flag=${t.body?.includesRestrictedRecords}`);
        for (const [who, s] of readers()) {
          const r = await get(`/api/v1/dashboard-drilldown?${q}`, s);
          const ev = (r.body?.evidence ?? []).filter((e: Body) => e.evidenceId === S.evId);
          log(`D ${who} ${metric} ${cls} -> ${r.status} evidence=${r.body?.evidence?.length} EV listed=${ev.length} flag=${r.body?.includesRestrictedRecords} mentions=${mentions(r.body).length}`);
          if (ev.length > 0 || mentions(r.body).length > 0) bad.push(`${who} ${metric} ${cls}: EV listed`);
          if (evTo.length > 0 && r.body?.includesRestrictedRecords !== true) bad.push(`${who} ${metric} ${cls}: flag ${r.body?.includesRestrictedRecords}`);
        }
      }
    log(`D the TO saw EV in ${seenByTo} drill-down(s) (measurement status ${S.b3MeasurementStatus})`);
    expect(seenByTo, "the admitted TO sees EV in at least one drill-down").toBeGreaterThan(0);
    expect(bad).toEqual([]);
  }, 600_000);
});
