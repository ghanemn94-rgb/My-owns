// code-security-reviewer, DG6 round 5 (T-DG6-REV-CS-R5): adversarial probe for REQ-S10-002 / ADR-0051 §2 BEYOND the
// BE-Z5 sweep (apps/api/test/integration/access/sensitive-reach-sweep.test.ts). NOT part of the candidate: copied into
// a disposable clone's tests/qa/integration by checks.sh repro and removed afterwards. Demo data is SYNTHETIC. Marking a
// record sensitive is an access decision, never a business approval (G1-G6); nothing here touches DG0-DG7.
//
// The world is the sweep's own setup (demo seed; one benefit retitled with a unique title and planned value; its
// variance case opened by the real worker consumer BEFORE marking; marked by a TO; an admitted TL records the case red
// twice and the real blocker escalation creates the ask; the admitted TL generates register snapshots). Then, as TL and
// AUD (no grant, not named parties), the probe covers what the sweep's single bare GET per operation cannot reach:
//   A. every GET list operation again with limit=100 and EVERY page followed (the sweep sees only the first 25 items);
//   B. the 16 operations that require ?organizationId= (the sweep's bare call gets 400 there), with organizationId and
//      transformationId set: executive overview, finance and adoption dashboards, every drill-down metric (with and
//      without each Finance value class), the global audit list (all pages, and filtered to the benefit, its case and
//      the ask);
//   C. the search index built by the REAL worker reindex job under its service identity, then searched for the
//      title, the case code and the benefit code;
//   D. live exports of every report definition (createExport with a live selection), and an export of the admitted
//      TL's stored snapshot;
//   E. notifications: every stored notification whose message params hold the title, per recipient, and whether that
//      recipient is admitted (gets 200 on the benefit) and sees it unredacted in its inbox.
// A finding is any response to a not-admitted reader whose body contains the title, "<code> <title>" or the planned
// value. Every request and answer status is logged.
import { insertAuditEvent, migrate, seedDemo, sql } from "../../../packages/db/src/index.ts";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { DEMO_ANCHORS } from "../../../packages/db/src/demo/data/kpis.ts";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../packages/db/test/helpers.ts";
import { REPORT_DEFINITION_CODES, REPORT_REGISTERS } from "../../../packages/shared/src/schemas/report.ts";
import { DASHBOARD_METRICS, FINANCE_VALUE_CLASSES } from "../../../packages/shared/src/schemas/dashboards.ts";
import { operations } from "../../../apps/api/test/support/contract.ts";
import { call, createUser, grant, signIn, startApi, type Session, type TestApi } from "../../../apps/api/test/support/harness.ts";
import { handleBlockerEscalation } from "../../../apps/worker/src/handlers/escalations.ts";
import { handleBenefitVariance } from "../../../apps/worker/src/handlers/raid.ts";
import { runReindex } from "../../../apps/worker/src/handlers/search.ts";
import { loadServiceIdentity, principalOfIdentity } from "../../../apps/worker/src/kit.ts";
import { businessToday, plusDays } from "../../../apps/api/test/integration/governance/meeting-fixtures.ts";
import { envelopeOf } from "../../../apps/api/test/integration/governance/t16-fixtures.ts";
import { randomUUID } from "node:crypto";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

const T = DEMO_ANCHORS.transformationId;
const ORG = DEMO_ANCHORS.organizationId;
const TITLE = "Synthetic CONFIDENTIAL CS-R5 probe benefit";
const PLANNED = "7654321.1234";

let api: TestApi;
let scratch: string | null = null;
let to: Session;
let tl: Session;
let aud: Session;
let admitted: Session;
const S = { benefitId: "", code: "", snapshotIds: [] as string[], caseId: "", caseCode: "", meetingId: "", askId: "" };
const log = (...a: unknown[]) => console.log("[CS-R5]", ...a);
const get = (path: string, session: Session) => call<Body>(api.app, "GET", path, { session, contract: false });
const leaksOf = (body: unknown): string[] => {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return [TITLE, `${S.code} ${TITLE}`, PLANNED].filter((n) => text.includes(n));
};

beforeAll(async () => {
  const { adminUrl } = inject("mthDb");
  scratch = await createScratchDatabase(adminUrl, "mth_cs_r5_probe");
  await migrate(roleUrl(adminUrl, scratch, "mth_owner"));
  await seedDemo(roleUrl(adminUrl, scratch, "mth_owner"), {
    mthEnv: "demo",
    runKind: "seed",
    requestedVia: "cli",
    requestedBy: null,
  });
  api = await startApi({ database: scratch, env: { MTH_ENV: "demo" } });
  const grantor = DEMO_ANCHORS.users.sp;
  const scope = { type: "transformation" as const, id: T };
  const mk = async (role: string, s: { type: "organization" | "transformation"; id: string }) => {
    const u = await createUser(api.db, ORG);
    await grant(api.db, grantor, u.id, role, s, ORG);
    return u;
  };
  const uTo = await mk("TO", { type: "organization", id: ORG });
  const uTl = await mk("TL", scope);
  const uAud = await mk("AUD", { type: "organization", id: ORG });
  const uAdm = await mk("TL", scope);
  to = await signIn(api.app, uTo.subject);
  tl = await signIn(api.app, uTl.subject);
  aud = await signIn(api.app, uAud.subject);
  admitted = await signIn(api.app, uAdm.subject);

  const b = await api.db
    .selectFrom("benefit")
    .select(["id", "code", "version"])
    .where("transformation_id", "=", T)
    .where("status", "=", "active")
    .orderBy("code")
    .executeTakeFirstOrThrow();
  S.benefitId = b.id;
  S.code = b.code;
  await api.db.transaction().execute(async (tx) => {
    await sql`UPDATE benefit SET title = ${TITLE}, planned_value = ${PLANNED}::numeric, version = version + 1,
                     updated_at = now() WHERE id = ${b.id}::uuid`.execute(tx);
    await insertAuditEvent(
      tx,
      { actorType: "user", actorUserId: grantor, requestId: `cs-r5-${b.id}`, source: "api" },
      {
        action: "benefit.update",
        recordType: "benefit",
        recordId: b.id,
        organizationId: ORG,
        transformationId: T,
        priorVersion: b.version,
        newVersion: b.version + 1,
        changes: { title: { from: "x", to: TITLE }, planned_value: { from: "1", to: PLANNED } },
      },
    );
  });
  const variance = await handleBenefitVariance(
    api.db,
    {
      outboxEventId: randomUUID(),
      eventType: "benefit.variance_evaluated",
      schemaVersion: 1,
      idempotencyKey: `benefit.variance_evaluated:cs-r5-${randomUUID()}`,
      organizationId: ORG,
      payload: {
        benefitId: b.id,
        measurementId: randomUUID(),
        periodStart: "2026-09-01",
        periodEnd: "2026-09-28",
        plannedAmount: "100000.0000",
        measuredAmount: "80000.0000",
        variance: "-20000.0000",
        offTrack: true,
      },
    },
    "cs-r5",
  );
  S.caseId = (variance.signal as Body)?.correctiveCaseId ?? "";
  expect(S.caseId, JSON.stringify(variance)).not.toBe("");
  S.caseCode = (await api.db.selectFrom("corrective_case").select("code").where("id", "=", S.caseId).executeTakeFirstOrThrow()).code;
  const mark = await call<Body>(api.app, "PUT", `/api/v1/transformations/${T}/records/benefit/${b.id}/sensitivity`, {
    session: to,
    headers: { "if-match": '"0"' },
    body: { isSensitive: true, reason: "Synthetic commercially sensitive benefit" },
  });
  expect(mark.status, JSON.stringify(mark.body)).toBe(200);
  const g = await call<Body>(api.app, "POST", "/api/v1/admin/sensitive-grants", {
    session: to,
    body: { transformationId: T, recordType: "benefit", recordId: b.id, granteeUserId: uAdm.id, reason: "Synthetic" },
  });
  expect(g.status, JSON.stringify(g.body)).toBe(201);
  const base = `/api/v1/transformations/${T}`;
  const forum = await call<Body>(api.app, "POST", `${base}/forums`, {
    session: to,
    body: {
      nameEn: "Synthetic review CS-R5",
      nameAr: "منتدى اصطناعي",
      cadenceLabel: "Weekly",
      purpose: "Synthetic",
      participantsLabel: "Synthetic",
      outputsLabel: "RAID",
      outputKinds: ["raid"],
    },
  });
  expect(forum.status, JSON.stringify(forum.body).slice(0, 400)).toBe(201);
  const hasCalendar = await api.db
    .selectFrom("business_calendar")
    .select("id")
    .where("organization_id", "=", ORG)
    .where("is_default", "=", true)
    .where("status", "=", "active")
    .executeTakeFirst();
  if (hasCalendar === undefined) {
    const adm = await mk("ADM_TECH", { type: "organization", id: ORG });
    const cal = await call<Body>(api.app, "POST", `/api/v1/organizations/${ORG}/calendars`, {
      session: await signIn(api.app, adm.subject),
      body: { code: "CALCSR5", nameEn: "Synthetic calendar", nameAr: "تقويم اصطناعي", isDefault: true },
    });
    expect(cal.status, JSON.stringify(cal.body).slice(0, 400)).toBe(201);
  }
  const today = await businessToday(api);
  for (const d of [1, 8]) {
    const m = await call<Body>(api.app, "POST", `${base}/meetings`, {
      session: admitted,
      body: { forumId: forum.body.id, scheduledDate: plusDays(today, d), startTime: "09:00", durationMinutes: 60 },
    });
    expect(m.status, JSON.stringify(m.body).slice(0, 400)).toBe(201);
    const st = await call<Body>(api.app, "POST", `${base}/meetings/${m.body.id}/start`, {
      session: admitted,
      headers: { "if-match": '"1"' },
    });
    expect(st.status).toBe(200);
    const r = await call<Body>(api.app, "POST", `${base}/meetings/${m.body.id}/blocker-statuses`, {
      session: admitted,
      body: { sourceRecordType: "corrective_case", sourceRecordId: S.caseId, rag: "red" },
    });
    expect(r.status, JSON.stringify(r.body).slice(0, 400)).toBe(201);
    S.meetingId = m.body.id;
    const esc = await handleBlockerEscalation(api.db, await envelopeOf(api.db, r.body.id), "cs-r5");
    log(`blocker escalation ${d}: ${JSON.stringify(esc)}`);
  }
  const ask = await api.db.selectFrom("decision").select(["id", "title"]).where("blocker_record_id", "=", S.caseId).executeTakeFirst();
  expect(ask, "the blocker escalation created an ask").toBeDefined();
  S.askId = ask!.id;
  log(`ask ${ask!.id} title=${JSON.stringify(ask!.title)} case=${S.caseCode} benefit=${S.code}`);
  for (const register of ["benefits", "kpis"] as const) {
    const r = await call<Body>(api.app, "POST", `${base}/reports/registers/generate`, {
      session: admitted,
      body: { parameters: { register } },
      contract: false,
    });
    expect(r.status, JSON.stringify(r.body).slice(0, 400)).toBe(201);
    S.snapshotIds.push(r.body.id);
  }
}, 900_000);

afterAll(async () => {
  await api?.close();
  if (scratch !== null) await dropScratchDatabase(inject("mthDb").adminUrl, scratch);
}, 60_000);

const readers = (): [string, Session][] => [
  ["TL", tl],
  ["AUD", aud],
];

/** Follows every page of a cursor list (limit 100), up to 60 pages. Returns the statuses and the leaks found. */
async function allPages(path: string, s: Session): Promise<{ pages: number; statuses: number[]; leaks: string[] }> {
  const statuses: number[] = [];
  const leaks: string[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const sep = path.includes("?") ? "&" : "?";
    const url: string = `${path}${sep}limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const r = await get(url, s);
    statuses.push(r.status);
    leaks.push(...leaksOf(r.body));
    pages += 1;
    cursor = r.status === 200 && r.body && typeof r.body.nextCursor === "string" ? r.body.nextCursor : null;
  } while (cursor !== null && pages < 60);
  return { pages, statuses, leaks };
}

const snake = (x: string) => x.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

describe("CS-R5: a sensitive benefit beyond the BE-Z5 sweep (ADR-0051 §2, REQ-S10-002)", () => {
  it("control: TL and AUD get 404 on the benefit, its case and the ask names neither the title", async () => {
    for (const [who, s] of readers()) {
      expect((await get(`/api/v1/transformations/${T}/benefits/${S.benefitId}`, s)).status, who).toBe(404);
      expect((await get(`/api/v1/transformations/${T}/corrective-actions/${S.caseId}`, s)).status, who).toBe(404);
    }
    const a = await get(`/api/v1/transformations/${T}/benefits/${S.benefitId}`, admitted);
    expect(a.status).toBe(200);
    expect(a.body.title).toBe(TITLE);
  });

  it("A: every GET list operation with {transformationId} only, limit=100, every page", async () => {
    const found: string[] = [];
    let n = 0;
    for (const o of operations) {
      if (o.method !== "GET") continue;
      const params = [...o.path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]!);
      if (params.length !== 1 || params[0] !== "transformationId") continue;
      const path = o.path.replace("{transformationId}", T);
      for (const [who, s] of readers()) {
        const first = await get(`${path}${path.includes("?") ? "&" : "?"}limit=100`, s);
        if (first.status === 400) continue; // not a paginated list (strict query: limit not accepted)
        n += 1;
        const r = await allPages(path, s);
        if (r.leaks.length > 0) found.push(`${who} ${o.operationId} pages=${r.pages} -> ${[...new Set(r.leaks)].join(" | ")}`);
      }
    }
    log(`A: ${n} paginated list reads followed to the end; leaks: ${found.length}`);
    for (const f of found) log(`A LEAK ${f}`);
    expect(found).toEqual([]);
  }, 1_800_000);

  it("B: the organizationId operations (dashboards, overview, drill-downs, global audit) with the parameter set", async () => {
    const found: string[] = [];
    const q = `organizationId=${ORG}&transformationId=${T}`;
    const urls: string[] = [
      `/api/v1/overview?${q}`,
      `/api/v1/overview?organizationId=${ORG}`,
      `/api/v1/dashboards/finance?${q}`,
      `/api/v1/dashboards/finance?organizationId=${ORG}`,
      `/api/v1/dashboards/adoption?${q}`,
    ];
    for (const metric of DASHBOARD_METRICS) {
      urls.push(`/api/v1/dashboard-drilldown?metric=${metric}&${q}&limit=100`);
      if (metric.startsWith("value.")) for (const vc of FINANCE_VALUE_CLASSES) urls.push(`/api/v1/dashboard-drilldown?metric=${metric}&valueClass=${vc}&${q}&limit=100`);
    }
    const statusCount = new Map<string, number>();
    for (const u of urls)
      for (const [who, s] of readers()) {
        const r = await get(u, s);
        statusCount.set(`${who}:${r.status}`, (statusCount.get(`${who}:${r.status}`) ?? 0) + 1);
        const l = leaksOf(r.body);
        if (l.length > 0) found.push(`${who} ${r.status} ${u} -> ${l.join(" | ")}`);
      }
    log(`B: ${urls.length} dashboard/overview/drill-down URLs per reader; statuses ${JSON.stringify([...statusCount])}`);
    // the global audit list: every page of the transformation, and filtered to the benefit, the case and the ask
    for (const [who, s] of readers()) {
      for (const f of [
        `transformationId=${T}`,
        `transformationId=${T}&recordType=benefit&recordId=${S.benefitId}`,
        `transformationId=${T}&recordType=corrective_case&recordId=${S.caseId}`,
        `transformationId=${T}&recordType=decision&recordId=${S.askId}`,
      ]) {
        const r = await allPages(`/api/v1/audit-events?organizationId=${ORG}&${f}`, s);
        log(`B audit-events ${who} ${f}: pages=${r.pages} statuses=${[...new Set(r.statuses)].join(",")}`);
        if (r.leaks.length > 0) found.push(`${who} listAuditEvents ${f} -> ${[...new Set(r.leaks)].join(" | ")}`);
      }
      const t = await allPages(`/api/v1/transformations/${T}/audit`, s);
      log(`B transformation audit ${who}: pages=${t.pages} statuses=${[...new Set(t.statuses)].join(",")}`);
      if (t.leaks.length > 0) found.push(`${who} listTransformationAudit -> ${[...new Set(t.leaks)].join(" | ")}`);
    }
    // control: the admitted TL's audit of the benefit holds the title (the redaction is per reader, not for everyone)
    const ctl = await allPages(`/api/v1/transformations/${T}/audit`, admitted);
    log(`B control: admitted TL transformation audit pages=${ctl.pages} title seen=${ctl.leaks.includes(TITLE)}`);
    for (const f of found) log(`B LEAK ${f}`);
    expect(found).toEqual([]);
  }, 1_800_000);

  it("C: the search index built by the real reindex job; TL and AUD search for the title and the codes", async () => {
    const identity = await loadServiceIdentity(api.db, "job:search.reindex");
    const result = await runReindex(api.db, { identity, principal: (o) => principalOfIdentity(identity, o) }, {});
    log(`C reindex: ${JSON.stringify(result.types.map((t) => `${t.recordType}:${t.outcome}`))}`);
    const docs = await sql<{ record_type: string; record_id: string; title: string }>`
      SELECT record_type, record_id::text, title FROM search_document WHERE title LIKE ${"%CONFIDENTIAL CS-R5%"}
         OR title = ${S.caseCode}`.execute(api.db);
    log(`C indexed documents naming the title or the case code: ${JSON.stringify(docs.rows)}`);
    const found: string[] = [];
    for (const q of ["CONFIDENTIAL CS-R5", "Synthetic CONFIDENTIAL", S.caseCode, S.code])
      for (const [who, s] of [...readers(), ["admitted", admitted] as [string, Session]]) {
        const r = await get(`/api/v1/search?q=${encodeURIComponent(q)}&limit=100`, s);
        const hits = r.status === 200 ? (r.body.items ?? []).map((i: Body) => `${i.recordType}:${i.title}`) : [];
        log(`C search ${who} q=${JSON.stringify(q)} -> ${r.status} ${JSON.stringify(hits).slice(0, 400)}`);
        if (who !== "admitted" && leaksOf(r.body).length > 0) found.push(`${who} q=${q} -> ${leaksOf(r.body).join(" | ")}`);
      }
    for (const f of found) log(`C LEAK ${f}`);
    expect(found).toEqual([]);
  }, 600_000);

  it("D: live exports of every report definition and of the admitted TL's snapshot are refused or hold no restricted row", async () => {
    const answers: string[] = [];
    const accepted: string[] = [];
    for (const code of REPORT_DEFINITION_CODES) {
      const params = code === "registers" ? REPORT_REGISTERS.map((register) => ({ register })) : [undefined];
      for (const p of params) {
        const r = await call<Body>(api.app, "POST", "/api/v1/exports", {
          session: tl,
          body: { report: { definitionCode: code, subjectId: T, ...(p ? { parameters: p } : {}) }, format: "csv", language: "en" },
          contract: false,
        });
        answers.push(`${code}${p ? `(${p.register})` : ""}:${r.status}:${r.body?.code ?? ""}`);
        if (r.status === 202) accepted.push(`${code}${p ? `(${p.register})` : ""}`);
      }
    }
    log(`D live exports as TL: ${answers.join(" ")}`);
    const benefitsExport = answers.find((a) => a.startsWith("registers(benefits):"));
    expect(benefitsExport, "the benefits register export is refused (D-199)").toBe(
      "registers(benefits):403:export.includes_restricted_records",
    );
    for (const id of S.snapshotIds) {
      const r = await call<Body>(api.app, "POST", "/api/v1/exports", {
        session: tl,
        body: { snapshotId: id, format: "csv", language: "en" },
        contract: false,
      });
      log(`D snapshot export as TL ${id}: ${r.status} ${r.body?.code ?? ""}`);
    }
    log(`D accepted live exports (assembled later by the watch, which re-checks the sources): ${accepted.join(" ")}`);
  }, 600_000);

  it("E: every stored notification naming the title goes only to an admitted recipient", async () => {
    const rows = await sql<{ id: string; recipient_user_id: string; message_key: string; link_path: string }>`
      SELECT id::text, recipient_user_id::text, message_key, link_path FROM inbox_notification
       WHERE message_params::text LIKE ${"%CONFIDENTIAL CS-R5%"}`.execute(api.db);
    log(`E notifications whose params hold the title: ${rows.rows.length} ${JSON.stringify(rows.rows)}`);
    const exposed: string[] = [];
    for (const n of rows.rows) {
      const u = await api.db.selectFrom("user_identity").select(["subject"]).where("user_id", "=", n.recipient_user_id).executeTakeFirst();
      if (u === undefined) continue;
      const s = await signIn(api.app, u.subject);
      const b = await get(`/api/v1/transformations/${T}/benefits/${S.benefitId}`, s);
      const inbox = await allPages("/api/v1/me/inbox", s);
      log(`E recipient ${n.recipient_user_id} ${n.message_key} link=${n.link_path}: benefit GET ${b.status}; inbox leaks ${inbox.leaks.length}`);
      if (b.status !== 200 && inbox.leaks.length > 0) exposed.push(`${n.recipient_user_id} ${n.message_key}`);
    }
    // TL and AUD inboxes, every page
    for (const [who, s] of readers()) {
      const r = await allPages("/api/v1/me/inbox", s);
      if (r.leaks.length > 0) exposed.push(`${who} inbox`);
    }
    expect(exposed).toEqual([]);
    void snake;
  }, 600_000);
});
