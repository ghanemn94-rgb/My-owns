// Restricted record ids on the write side and the remaining reads (T-DG6-BE-Z10B; F-DG6-420 second half; D-218;
// ADR-0051 §2 "existence not disclosed", ADR-0006; REQ-S10-002), against a scratch database of the run's disposable
// PostgreSQL seeded with the synthetic demo dataset. Everything is SYNTHETIC. Marking a record sensitive is an access
// decision, never a business approval (G1-G6), and nothing here names or touches the engineering gates DG0-DG7.
//
// Setup: a sensitive evidence item E (marked by the TO) and an open one O. Readers: TL (scoped to the transformation,
// no grant: not admitted to E) and TLA (a TL with an explicit grant on E: admitted). Both hold the same write rights
// (diagnostic.edit, meeting.prepare, day_ninety_test.respond, health_check.assess), so each difference below is the
// sensitivity rule alone.
//   - listEvidenceVersions: 404 for TL on E (as E's own read), 200 for TLA and the TO; 200 for TL on O.
//   - The re-save rule (D-218, documented in keptRestrictedRef): a Day-90 response or a health answer whose stored
//     evidence is E keeps E when TL re-saves it with `evidenceId` null or absent; TL replaces it only by sending another
//     id; TLA (admitted) clears it with null as before. An agenda item's materials keep E when TL re-saves the list.
//   - Write responses (register kit create/update, the health PATCH and answer PUT, the gate-condition close) never
//     echo E to TL: `null` (or omitted from a list) with `includesRestrictedRecords: true`; TLA sees E. (The
//     gate-condition close response: workflows/gate-conditions.test.ts, which has an approved G5 decision.)
import { migrate, seedDemo, sql } from "@mth/db";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { DEMO_ANCHORS } from "../../../../../packages/db/src/demo/data/kpis.ts";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../../../packages/db/test/helpers.ts";
import { call, createUser, grant, signIn, startApi, type Session, type TestApi } from "../../support/harness.ts";
import { businessToday, plusDays } from "../governance/meeting-fixtures.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const T = DEMO_ANCHORS.transformationId;
const ORG = DEMO_ANCHORS.organizationId;
const base = `/api/v1/transformations/${T}`;
let api: TestApi;
let scratch: string | null = null;
let to: Session;
let tl: Session;
let tla: Session;
const S = { e: "", o: "", tlId: "", tlaId: "", grantor: "" };
const ifm = (v: number | string) => ({ "if-match": `"${v}"` });
const get = (path: string, session: Session) => call<Body>(api.app, "GET", path, { session });

async function newEvidence(title: string, owner: string): Promise<string> {
  const r = await call<Body>(api.app, "POST", `${base}/evidence`, {
    session: to,
    body: { ownerUserId: owner, kind: "note", title, noteBody: "Synthetic" },
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.id as string;
}

beforeAll(async () => {
  const { adminUrl } = inject("mthDb");
  scratch = await createScratchDatabase(adminUrl, "mth_be_z10b_writes");
  await migrate(roleUrl(adminUrl, scratch, "mth_owner"));
  await seedDemo(roleUrl(adminUrl, scratch, "mth_owner"), {
    mthEnv: "demo",
    runKind: "seed",
    requestedVia: "cli",
    requestedBy: null,
  });
  api = await startApi({ database: scratch, env: { MTH_ENV: "demo" } });
  S.grantor = DEMO_ANCHORS.users.sp;
  const mk = async (role: string, s: { type: "organization" | "transformation"; id: string }) => {
    const u = await createUser(api.db, ORG);
    await grant(api.db, S.grantor, u.id, role, s, ORG);
    return u;
  };
  const uTo = await mk("TO", { type: "organization", id: ORG });
  const uTl = await mk("TL", { type: "transformation", id: T });
  const uTla = await mk("TL", { type: "transformation", id: T });
  S.tlId = uTl.id;
  S.tlaId = uTla.id;
  to = await signIn(api.app, uTo.subject);
  tl = await signIn(api.app, uTl.subject);
  tla = await signIn(api.app, uTla.subject);
  S.e = await newEvidence("Synthetic CONFIDENTIAL BE-Z10B write evidence", uTo.id);
  S.o = await newEvidence("Synthetic open BE-Z10B evidence", uTo.id);
  const mark = await call<Body>(api.app, "PUT", `${base}/records/evidence/${S.e}/sensitivity`, {
    session: to,
    headers: ifm(0),
    body: { isSensitive: true, reason: "Synthetic sensitive evidence (BE-Z10B)" },
  });
  expect(mark.status, JSON.stringify(mark.body)).toBe(200);
  const g = await call<Body>(api.app, "POST", "/api/v1/admin/sensitive-grants", {
    session: to,
    body: { transformationId: T, recordType: "evidence", recordId: S.e, granteeUserId: uTla.id, reason: "Synthetic" },
  });
  expect(g.status, JSON.stringify(g.body)).toBe(201);
}, 600_000);

afterAll(async () => {
  await api?.close();
  if (scratch !== null) await dropScratchDatabase(inject("mthDb").adminUrl, scratch);
}, 60_000);

describe("listEvidenceVersions: the sensitivity reach check (T-DG6-BE-Z10B)", () => {
  it("TL (not admitted) gets 404 on the sensitive item's versions, as on the item; TLA and the TO read them; TL reads an open item's", async () => {
    expect((await get(`${base}/evidence/${S.e}`, tl)).status).toBe(404);
    const denied = await get(`${base}/evidence/${S.e}/versions`, tl);
    expect(denied.status, JSON.stringify(denied.body)).toBe(404);
    expect(JSON.stringify(denied.body)).not.toContain("CONFIDENTIAL");
    for (const s of [tla, to]) expect((await get(`${base}/evidence/${S.e}/versions`, s)).status).toBe(200);
    expect((await get(`${base}/evidence/${S.o}/versions`, tl)).status).toBe(200);
  });
});

describe("the Day-90 re-save rule (keptRestrictedRef; D-218)", () => {
  const stored = async (code: string) =>
    (
      await sql<{ evidence_id: string | null }>`SELECT r.evidence_id::text AS evidence_id FROM day_ninety_response r
        JOIN day_ninety_test t ON t.id = r.test_id WHERE t.transformation_id = ${T}::uuid AND r.question_code = ${code}`.execute(
        api.db,
      )
    ).rows[0]?.evidence_id ?? null;
  const put = async (s: Session, code: string, body: Record<string, unknown>) => {
    const t = await get(`${base}/day-90-test`, s);
    expect(t.status, JSON.stringify(t.body).slice(0, 300)).toBe(200);
    return call<Body>(api.app, "PUT", `${base}/day-90-test/responses/${code}`, {
      session: s,
      headers: ifm(t.body.version),
      body,
    });
  };
  const responseOf = (body: Body, code: string) => body.questions.find((q: Body) => q.code === code)?.response;

  it("TL's re-save (null or absent) keeps the hidden evidence; another id replaces it; the admitted writer clears it", async () => {
    const t0 = await get(`${base}/day-90-test`, tla);
    expect(t0.status, JSON.stringify(t0.body).slice(0, 300)).toBe(200);
    expect(t0.body.status).toBe("open");
    const code = (t0.body.questions as Body[]).find((q) => q.response === null)?.code ?? t0.body.questions[0].code;

    const linked = await put(tla, code, { answer: "yes", evidenceId: S.e });
    expect(linked.status, JSON.stringify(linked.body).slice(0, 400)).toBe(200);
    expect(responseOf(linked.body, code).evidenceId).toBe(S.e);
    expect(await stored(code)).toBe(S.e);

    // TL reads it as null with the marker, and the write response says the same.
    const seen = await get(`${base}/day-90-test`, tl);
    expect(responseOf(seen.body, code).evidenceId).toBeNull();
    expect(seen.body.includesRestrictedRecords).toBe(true);
    expect(JSON.stringify(seen.body)).not.toContain(S.e);

    const resaveNull = await put(tl, code, { answer: "yes", comment: "Synthetic re-save by TL", evidenceId: null });
    expect(resaveNull.status, JSON.stringify(resaveNull.body).slice(0, 400)).toBe(200);
    expect(JSON.stringify(resaveNull.body)).not.toContain(S.e);
    expect(await stored(code)).toBe(S.e);

    const resaveAbsent = await put(tl, code, { answer: "no", comment: "Synthetic second re-save" });
    expect(resaveAbsent.status).toBe(200);
    expect(await stored(code)).toBe(S.e);
    // The re-saves did not record an evidence change in the audit trail.
    const changes = await sql<{ changes: Record<string, unknown> | null }>`SELECT changes FROM audit_event
      WHERE action = 'day_ninety_response.update' AND actor_user_id = ${S.tlId}::uuid`.execute(api.db);
    expect(changes.rows.length).toBeGreaterThan(0);
    for (const r of changes.rows) expect(Object.keys(r.changes ?? {})).not.toContain("evidence_id");

    // An explicit change by TL replaces it.
    const replaced = await put(tl, code, { answer: "no", evidenceId: S.o });
    expect(replaced.status).toBe(200);
    expect(responseOf(replaced.body, code).evidenceId).toBe(S.o);
    expect(await stored(code)).toBe(S.o);

    // The admitted writer links E again, then clears it with null (unchanged DG5 behaviour).
    expect((await put(tla, code, { answer: "no", evidenceId: S.e })).status).toBe(200);
    expect(await stored(code)).toBe(S.e);
    expect((await put(tla, code, { answer: "no", evidenceId: null })).status).toBe(200);
    expect(await stored(code)).toBeNull();
  });
});

describe("health checks: answer re-save rule and write responses (T-DG6-BE-Z10B)", () => {
  it("TL's answer re-save keeps the hidden evidence; the PATCH and answer responses never name it to TL; TLA sees it", async () => {
    const today = await businessToday(api);
    const created = await call<Body>(api.app, "POST", `${base}/health-checks`, {
      session: tla,
      body: { assessmentDate: today },
    });
    expect(created.status, JSON.stringify(created.body).slice(0, 400)).toBe(201);
    const id = created.body.id as string;
    const q = "q01";
    const answer = await call<Body>(api.app, "PUT", `${base}/health-checks/${id}/answers/${q}`, {
      session: tla,
      headers: ifm(created.body.version),
      body: { response: "yes", evidenceId: S.e },
    });
    expect(answer.status, JSON.stringify(answer.body).slice(0, 400)).toBe(200);
    expect(answer.body.answers.find((a: Body) => a.questionCode === q).evidenceId).toBe(S.e);

    // The PATCH response (a write) does not echo E to TL.
    const patched = await call<Body>(api.app, "PATCH", `${base}/health-checks/${id}`, {
      session: tl,
      headers: ifm(answer.body.version),
      body: { assessmentDate: plusDays(today, -1) },
    });
    expect(patched.status, JSON.stringify(patched.body).slice(0, 400)).toBe(200);
    expect(JSON.stringify(patched.body)).not.toContain(S.e);
    const tlAnswer = patched.body.answers.find((a: Body) => a.questionCode === q);
    expect(tlAnswer.evidenceId).toBeNull();
    expect(tlAnswer.includesRestrictedRecords).toBe(true);

    // TL re-saves the answer without evidence: the stored link stays, and the response hides it.
    const resave = await call<Body>(api.app, "PUT", `${base}/health-checks/${id}/answers/${q}`, {
      session: tl,
      headers: ifm(patched.body.version),
      body: { response: "no", evidenceId: null },
    });
    expect(resave.status, JSON.stringify(resave.body).slice(0, 400)).toBe(200);
    expect(JSON.stringify(resave.body)).not.toContain(S.e);
    const row = await sql<{ evidence_id: string | null; response: string }>`SELECT evidence_id::text AS evidence_id,
      response FROM health_assessment_answer WHERE assessment_id = ${id}::uuid AND question_code = ${q}`.execute(
      api.db,
    );
    expect(row.rows[0]).toEqual({ evidence_id: S.e, response: "no" });

    // The admitted reader sees E; the admitted writer clears it with null.
    const adm = await get(`${base}/health-checks/${id}`, tla);
    expect(adm.body.answers.find((a: Body) => a.questionCode === q).evidenceId).toBe(S.e);
    const cleared = await call<Body>(api.app, "PUT", `${base}/health-checks/${id}/answers/${q}`, {
      session: tla,
      headers: ifm(adm.body.version),
      body: { response: "no", evidenceId: null },
    });
    expect(cleared.status).toBe(200);
    expect(cleared.body.answers.find((a: Body) => a.questionCode === q).evidenceId).toBeNull();
    expect(cleared.body.answers.find((a: Body) => a.questionCode === q).includesRestrictedRecords).toBeUndefined();
  });
});

describe("agenda materials: list redaction and the re-save rule (T-DG6-BE-Z10B)", () => {
  it("TL reads the materials without E (marked) and a re-save of the list keeps E; TLA sees E", async () => {
    const forum = await call<Body>(api.app, "POST", `${base}/forums`, {
      session: to,
      body: {
        nameEn: "Synthetic forum BE-Z10B",
        nameAr: "منتدى اصطناعي",
        cadenceLabel: "Weekly",
        purpose: "Synthetic",
        participantsLabel: "Synthetic",
        outputsLabel: "RAID",
        outputKinds: ["raid"],
      },
    });
    expect(forum.status, JSON.stringify(forum.body).slice(0, 300)).toBe(201);
    const today = await businessToday(api);
    const m = await call<Body>(api.app, "POST", `${base}/meetings`, {
      session: tla,
      body: { forumId: forum.body.id, scheduledDate: plusDays(today, 20), startTime: "10:00", durationMinutes: 60 },
    });
    expect(m.status, JSON.stringify(m.body).slice(0, 300)).toBe(201);
    const items = `${base}/meetings/${m.body.id}/agenda-items`;
    const created = await call<Body>(api.app, "POST", items, {
      session: tla,
      body: { itemKind: "information", title: "Synthetic item BE-Z10B", materialsEvidenceIds: [S.e, S.o] },
    });
    expect(created.status, JSON.stringify(created.body).slice(0, 300)).toBe(201);
    expect(created.body.materialsEvidenceIds).toEqual([S.e, S.o]);

    const seen = await get(items, tl);
    const mine = seen.body.items.find((i: Body) => i.id === created.body.id);
    expect(mine.materialsEvidenceIds).toEqual([S.o]);
    expect(mine.includesRestrictedRecords).toBe(true);
    expect(JSON.stringify(seen.body)).not.toContain(S.e);

    // TL removes the only material it can see: E stays stored, and the response does not name it.
    const patched = await call<Body>(api.app, "PATCH", `${items}/${created.body.id}`, {
      session: tl,
      headers: ifm(created.body.version),
      body: { materialsEvidenceIds: [] },
    });
    expect(patched.status, JSON.stringify(patched.body).slice(0, 300)).toBe(200);
    expect(patched.body.materialsEvidenceIds).toEqual([]);
    expect(patched.body.includesRestrictedRecords).toBe(true);
    const row = await sql<{ ids: string[] }>`SELECT materials_evidence_ids::text[] AS ids FROM agenda_item
      WHERE id = ${created.body.id}::uuid`.execute(api.db);
    expect(row.rows[0]!.ids).toEqual([S.e]);
    const adm = await get(items, tla);
    const admItem = adm.body.items.find((i: Body) => i.id === created.body.id);
    expect(admItem.materialsEvidenceIds).toEqual([S.e]);
    expect(admItem.includesRestrictedRecords).toBeUndefined();
  });
});

describe("register-kit write responses: a workstream output (T-DG6-BE-Z10B)", () => {
  it("TL's PATCH response and reads show evidenceId null with the marker; the stored link stays; TLA sees it", async () => {
    const ws = (
      await sql<{ code: string }>`SELECT code FROM diagnostic_workstream ORDER BY code LIMIT 1`.execute(api.db)
    ).rows[0]!.code;
    const created = await call<Body>(api.app, "POST", `${base}/workstream-outputs`, {
      session: tla,
      body: { workstreamCode: ws, title: "Synthetic output BE-Z10B", evidenceId: S.e },
    });
    expect(created.status, JSON.stringify(created.body).slice(0, 300)).toBe(201);
    expect(created.body.evidenceId).toBe(S.e);
    const one = `${base}/workstream-outputs/${created.body.id}`;
    const patched = await call<Body>(api.app, "PATCH", one, {
      session: tl,
      headers: ifm(created.body.version),
      body: { title: "Synthetic output BE-Z10B (renamed by TL)" },
    });
    expect(patched.status, JSON.stringify(patched.body).slice(0, 300)).toBe(200);
    expect(patched.body.evidenceId).toBeNull();
    expect(patched.body.includesRestrictedRecords).toBe(true);
    const row = await sql<{ id: string }>`SELECT evidence_id::text AS id FROM diagnostic_workstream_output
      WHERE id = ${created.body.id}::uuid`.execute(api.db);
    expect(row.rows[0]!.id).toBe(S.e);
    const tlRead = await get(one, tl);
    expect(tlRead.body.evidenceId).toBeNull();
    expect(JSON.stringify((await get(`${base}/workstream-outputs?limit=100`, tl)).body)).not.toContain(S.e);
    const admRead = await get(one, tla);
    expect(admRead.body.evidenceId).toBe(S.e);
    expect(admRead.body.includesRestrictedRecords).toBeUndefined();
  });
});

// The gate-condition close's write response is tested in workflows/gate-conditions.test.ts: the demo dataset has no
// approved G5 decision to hang a condition on (the database admits conditions only on one).
