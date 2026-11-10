// T-DG6-BE-Z12 (F-DG6-480; D-218; ADR-0051 §2; REQ-S10-002): the references F-DG6-480 names, and the ones the
// schema-derived inventory (test/support/sensitive-reference-inventory.ts) found, against a scratch database seeded
// with the REAL synthetic demo dataset (ADR-0050). Ported from the code-security probe zz-cs-r7-id-refs.test.ts
// (round 7: B1 parent, B2 meeting output, B3 launch-task output and its write oracle) and widened to the business-case
// line, the action register, procedure instances and formula revision proposals.
//
// Readers: `tl` (a TL at the transformation, no grant, the not-admitted WRITER), `tl2` (a second TL that created and
// edited nothing: never a named party; the not-admitted READER), `to` (the TO: admitted through sensitive_record.grant).
// For each reference: tl2 never receives the hidden id and gets `includesRestrictedRecords: true`; the TO does receive
// it (positive control); a write by tl that names the hidden record answers EXACTLY as for an unknown id (status, code
// and errors), and a re-save with null keeps the stored hidden reference (D-218 re-save rule).
// Everything is SYNTHETIC. Marking a record sensitive is an access decision, never a business approval (G1-G6), and
// nothing here touches DG0-DG7.
import { insertAuditEvent, migrate, seedDemo, sql } from "@mth/db";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { DEMO_ANCHORS } from "../../../../../packages/db/src/demo/data/kpis.ts";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../../../packages/db/test/helpers.ts";
import { call, createUser, grant, signIn, startApi, type Session, type TestApi } from "../../support/harness.ts";
import { handleBenefitVariance } from "../../../../worker/src/handlers/raid.ts";
import { randomUUID } from "node:crypto";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

const T = DEMO_ANCHORS.transformationId;
const ORG = DEMO_ANCHORS.organizationId;
const grantor = DEMO_ANCHORS.users.sp;
const t = `/api/v1/transformations/${T}`;

let api: TestApi;
let scratch: string | null = null;
let to: Session;
let tl: Session;
let tl2: Session;
let toUserId = "";
const S = { hidden: "", evId: "" };

const get = (path: string, session: Session) => call<Body>(api.app, "GET", path, { session, contract: false });
const send = (method: "POST" | "PATCH" | "PUT", path: string, session: Session, body: unknown, etag?: string) =>
  call<Body>(api.app, method, path, {
    session,
    body,
    contract: false,
    ...(etag === undefined ? {} : { headers: { "if-match": etag } }),
  });
const mark = async (recordType: string, recordId: string) => {
  const r = await call<Body>(api.app, "PUT", `${t}/records/${recordType}/${recordId}/sensitivity`, {
    session: to,
    headers: { "if-match": '"0"' },
    body: { isSensitive: true, reason: "Synthetic sensitive record (BE-Z12)" },
  });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
};
/** A direct, audited write of SYNTHETIC setup data (the 0004 guard: its audit event in the same transaction). */
async function audited(recordType: string, recordId: string, write: (tx: Body) => Promise<unknown>, prior?: number) {
  await api.db.transaction().execute(async (tx) => {
    await write(tx);
    await insertAuditEvent(
      tx,
      { actorType: "user", actorUserId: grantor, requestId: `be-z12-${recordType}`, source: "api" },
      {
        action: `${recordType}.${prior === undefined ? "create" : "update"}`,
        recordType,
        recordId,
        organizationId: ORG,
        transformationId: T,
        ...(prior === undefined ? {} : { priorVersion: prior }),
        newVersion: prior === undefined ? 1 : prior + 1,
      },
    );
  });
}
/** The answer of a refused write, comparable across two requests (status, code, errors). */
const refusal = (r: { status: number; body: Body }) => ({
  status: r.status,
  code: r.body?.code,
  errors: r.body?.errors,
});

beforeAll(async () => {
  const { adminUrl } = inject("mthDb");
  scratch = await createScratchDatabase(adminUrl, "mth_be_z12_refs");
  await migrate(roleUrl(adminUrl, scratch, "mth_owner"));
  await seedDemo(roleUrl(adminUrl, scratch, "mth_owner"), {
    mthEnv: "demo",
    runKind: "seed",
    requestedVia: "cli",
    requestedBy: null,
  });
  api = await startApi({ database: scratch, env: { MTH_ENV: "demo" } });
  const mk = async (role: string, s: { type: "organization" | "transformation"; id: string }) => {
    const u = await createUser(api.db, ORG);
    await grant(api.db, grantor, u.id, role, s, ORG);
    return u;
  };
  const uTo = await mk("TO", { type: "organization", id: ORG });
  toUserId = uTo.id;
  to = await signIn(api.app, uTo.subject);
  tl = await signIn(api.app, (await mk("TL", { type: "transformation", id: T })).subject);
  tl2 = await signIn(api.app, (await mk("TL", { type: "transformation", id: T })).subject);
  const hidden = await api.db
    .selectFrom("benefit")
    .select("id")
    .where("transformation_id", "=", T)
    .where("status", "=", "active")
    .where("parent_benefit_id", "is", null)
    .orderBy("code")
    .executeTakeFirstOrThrow();
  S.hidden = hidden.id;
  await mark("benefit", S.hidden);
  const ev = await send("POST", `${t}/evidence`, to, {
    ownerUserId: toUserId,
    kind: "note",
    title: "Synthetic CONFIDENTIAL BE-Z12 evidence",
    noteBody: "Synthetic",
  });
  expect(ev.status, JSON.stringify(ev.body)).toBe(201);
  S.evId = ev.body.id;
  await mark("evidence", S.evId);
}, 600_000);

afterAll(async () => {
  await api?.close();
  if (scratch !== null) await dropScratchDatabase(inject("mthDb").adminUrl, scratch);
}, 60_000);

describe("T-DG6-BE-Z12: D-218 on every reference to a sensitive record (F-DG6-480)", () => {
  it("control: tl and tl2 get 404 on the hidden benefit and evidence item; the TO reads both", async () => {
    for (const s of [tl, tl2]) {
      expect((await get(`${t}/benefits/${S.hidden}`, s)).status).toBe(404);
      expect((await get(`${t}/evidence/${S.evId}`, s)).status).toBe(404);
    }
    expect((await get(`${t}/benefits/${S.hidden}`, to)).status).toBe(200);
    expect((await get(`${t}/evidence/${S.evId}`, to)).status).toBe(200);
  });

  it("B1 parentBenefitId: hidden from tl2 with the marker, shown to the TO; naming a hidden parent answers as an unknown id; a null re-save keeps it", async () => {
    const bs = await api.db
      .selectFrom("benefit")
      .select(["id", "parent_benefit_id", "currency"])
      .where("transformation_id", "=", T)
      .where("status", "=", "active")
      .orderBy("code")
      .execute();
    const parents = new Set(bs.map((b) => b.parent_benefit_id).filter((x): x is string => x !== null));
    const free = bs.filter((b) => b.id !== S.hidden && b.parent_benefit_id === null && !parents.has(b.id));
    const child = free[0]!;
    const other = free.find((b) => b.id !== child.id && b.currency === child.currency)!;
    expect(other, "two free benefits of one currency in the demo").toBeDefined();
    // The TL creates a parent with no values and makes `child` its child, then the TO marks the parent sensitive.
    const p = await send("POST", `${t}/benefits`, tl, {
      title: "Synthetic CONFIDENTIAL BE-Z12 parent",
      description: "Synthetic.",
      benefitType: "cost",
      valueClass: "avoided_cost",
      ownerUserId: grantor,
      currency: child.currency.trim(),
      financialStatementLine: "Opex",
    });
    expect(p.status, JSON.stringify(p.body)).toBe(201);
    const c0 = await get(`${t}/benefits/${child.id}`, tl);
    const c1 = await send("PATCH", `${t}/benefits/${child.id}`, tl, { parentBenefitId: p.body.id }, c0.headers.etag);
    expect(c1.status, JSON.stringify(c1.body)).toBe(200);
    await mark("benefit", p.body.id);
    // Read: tl2 gets null + marker; the TO gets the id.
    const r = await get(`${t}/benefits/${child.id}`, tl2);
    expect(r.status).toBe(200);
    expect(r.body.parentBenefitId).toBeNull();
    expect(r.body.includesRestrictedRecords).toBe(true);
    expect(JSON.stringify(r.body)).not.toContain(p.body.id);
    const a = await get(`${t}/benefits/${child.id}`, to);
    expect(a.body.parentBenefitId).toBe(p.body.id);
    expect(a.body.includesRestrictedRecords).toBeUndefined();
    // Write oracle: the not-admitted tl2 (tl created the parent, so tl is a named party and admitted) names the hidden parent, then a random id: the same answer.
    const o0 = await get(`${t}/benefits/${other.id}`, tl2);
    const unknown = await send(
      "PATCH",
      `${t}/benefits/${other.id}`,
      tl2,
      { parentBenefitId: randomUUID() },
      o0.headers.etag,
    );
    const hiddenRef = await send(
      "PATCH",
      `${t}/benefits/${other.id}`,
      tl2,
      { parentBenefitId: p.body.id },
      o0.headers.etag,
    );
    expect(unknown.status).toBe(422);
    expect(refusal(hiddenRef)).toEqual(refusal(unknown));
    // Re-save: tl2 was shown null; sending null keeps the stored parent; the response names nothing.
    const c2 = await get(`${t}/benefits/${child.id}`, tl2);
    const resave = await send("PATCH", `${t}/benefits/${child.id}`, tl2, { parentBenefitId: null }, c2.headers.etag);
    expect(resave.status, JSON.stringify(resave.body)).toBe(200);
    expect(resave.body.parentBenefitId).toBeNull();
    expect(JSON.stringify(resave.body)).not.toContain(p.body.id);
    const stored = await api.db
      .selectFrom("benefit")
      .select("parent_benefit_id")
      .where("id", "=", child.id)
      .executeTakeFirstOrThrow();
    expect(stored.parent_benefit_id).toBe(p.body.id);
    // tl, admitted to the parent as a named party (its creator), clears it with null exactly as before.
    const c3 = await get(`${t}/benefits/${child.id}`, tl);
    const clear = await send("PATCH", `${t}/benefits/${child.id}`, tl, { parentBenefitId: null }, c3.headers.etag);
    expect(clear.status).toBe(200);
    expect(clear.body.parentBenefitId).toBeNull();
  });

  it("business-case line: a line of a hidden case is null for tl2 (marked), shown to the TO; naming it answers as an unknown line (no 409 'taken' oracle)", async () => {
    const line = await api.db
      .selectFrom("business_case_line as l")
      .innerJoin("business_case as c", "c.id", "l.business_case_id")
      .select(["l.id", "l.business_case_id"])
      .where("l.transformation_id", "=", T)
      .where("l.line_kind", "=", "benefit")
      // A line that is free, or held by an open active benefit (never the hidden benefit, never an archived one).
      .where(
        sql<boolean>`NOT EXISTS (SELECT 1 FROM benefit b WHERE b.business_case_line_id = l.id
                       AND (b.id = ${S.hidden}::uuid OR b.status <> 'active'))`,
      )
      .orderBy("l.id")
      .executeTakeFirstOrThrow();
    const holder = await api.db
      .selectFrom("benefit")
      .select(["id", "version", "business_case_line_id"])
      .where("transformation_id", "=", T)
      .where("status", "=", "active")
      .where("id", "<>", S.hidden)
      .where((eb) => eb.or([eb("business_case_line_id", "=", line.id), eb("business_case_line_id", "is", null)]))
      .orderBy(sql`business_case_line_id IS NULL`)
      .orderBy("code")
      .executeTakeFirstOrThrow();
    if (holder.business_case_line_id !== line.id)
      await audited(
        "benefit",
        holder.id,
        (tx) =>
          sql`UPDATE benefit SET business_case_line_id = ${line.id}::uuid, version = version + 1, updated_at = now()
              WHERE id = ${holder.id}::uuid`.execute(tx),
        holder.version,
      );
    await mark("business_case", line.business_case_id);
    const r = await get(`${t}/benefits/${holder.id}`, tl2);
    expect(r.body.businessCaseLineId).toBeNull();
    expect(r.body.includesRestrictedRecords).toBe(true);
    expect((await get(`${t}/benefits/${holder.id}`, to)).body.businessCaseLineId).toBe(line.id);
    const other = await api.db
      .selectFrom("benefit")
      .select("id")
      .where("transformation_id", "=", T)
      .where("status", "=", "active")
      .where("id", "not in", [S.hidden, holder.id])
      .where("business_case_line_id", "is", null)
      .orderBy("code")
      .executeTakeFirstOrThrow();
    const o0 = await get(`${t}/benefits/${other.id}`, tl);
    const unknown = await send(
      "PATCH",
      `${t}/benefits/${other.id}`,
      tl,
      { businessCaseLineId: randomUUID() },
      o0.headers.etag,
    );
    const hiddenRef = await send(
      "PATCH",
      `${t}/benefits/${other.id}`,
      tl,
      { businessCaseLineId: line.id },
      o0.headers.etag,
    );
    expect(unknown.status).toBe(422);
    expect(refusal(hiddenRef)).toEqual(refusal(unknown));
  });

  it("B2 meeting output: recordId of a hidden benefit is null for tl2 (marked), shown to the TO; naming it answers as an unknown record", async () => {
    const forum = await sql<{ id: string }>`SELECT id::text AS id FROM forum WHERE transformation_id = ${T}::uuid
      ORDER BY id LIMIT 1`.execute(api.db);
    expect(forum.rows[0], "the demo has a forum").toBeDefined();
    const mid = randomUUID();
    await audited("meeting", mid, (tx) =>
      tx
        .insertInto("meeting")
        .values({
          id: mid,
          organization_id: ORG,
          transformation_id: T,
          forum_id: forum.rows[0]!.id,
          scheduled_date: "2031-10-01",
          starts_at: new Date("2031-10-01T07:00:00Z"),
          ends_at: new Date("2031-10-01T08:00:00Z"),
          status: "scheduled",
          cutoff_unknown_reason: "calendar_not_configured",
          created_source: "api",
          created_by: grantor,
          updated_by: grantor,
        } as Body)
        .execute(),
    );
    const oid = randomUUID();
    await audited("meeting_output", oid, (tx) =>
      tx
        .insertInto("meeting_output")
        .values({
          id: oid,
          organization_id: ORG,
          transformation_id: T,
          meeting_id: mid,
          output_kind: "benefit_view",
          record_type: "benefit",
          record_id: S.hidden,
          note: null,
          created_by: grantor,
        })
        .execute(),
    );
    const r = await get(`${t}/meetings/${mid}/outputs?limit=100`, tl2);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const shown = r.body.items.find((x: Body) => x.id === oid);
    expect(shown).toMatchObject({ outputKind: "benefit_view", recordType: "benefit", recordId: null });
    expect(shown.includesRestrictedRecords).toBe(true);
    expect(JSON.stringify(r.body)).not.toContain(S.hidden);
    const a = await get(`${t}/meetings/${mid}/outputs?limit=100`, to);
    expect(a.body.items.find((x: Body) => x.id === oid).recordId).toBe(S.hidden);
    const body = (recordId: string) => ({ outputKind: "benefit_view", recordType: "benefit", recordId });
    const unknown = await send("POST", `${t}/meetings/${mid}/outputs`, tl, body(randomUUID()));
    const hiddenRef = await send("POST", `${t}/meetings/${mid}/outputs`, tl, body(S.hidden));
    console.log(
      `[BE-Z12] createMeetingOutput unknown ${unknown.status} ${unknown.body?.code}; hidden ${hiddenRef.status} ${hiddenRef.body?.code}`,
    );
    expect(unknown.status).toBeGreaterThanOrEqual(400);
    expect(refusal(hiddenRef)).toEqual(refusal(unknown));
  });

  it("B3 launch task: a hidden output answers 422 exactly as an unknown id (was 200); once the TO sets it, tl2 gets null with the marker and a null re-save keeps it", async () => {
    const task = await sql<{ id: string }>`SELECT id::text AS id FROM launch_task WHERE transformation_id = ${T}::uuid
      AND output_record_type = 'benefit' ORDER BY id LIMIT 1`.execute(api.db);
    expect(task.rows[0], "the demo launch plan has a benefits-register task").toBeDefined();
    const taskId = task.rows[0]!.id;
    const path = `${t}/launch-plan/tasks/${taskId}`;
    const patch = async (s: Session, outputRecordId: string | null) =>
      send("PATCH", path, s, { outputRecordId }, (await get(path, s)).headers.etag);
    const unknown = await patch(tl, randomUUID());
    const hiddenRef = await patch(tl, S.hidden);
    expect(unknown.status).toBe(422);
    expect(unknown.body.code).toBe("launch_task.output_record_invalid");
    expect(refusal(hiddenRef)).toEqual(refusal(unknown));
    const before = await api.db
      .selectFrom("launch_task")
      .select("output_record_id")
      .where("id", "=", taskId)
      .executeTakeFirstOrThrow();
    expect(before.output_record_id).not.toBe(S.hidden);
    // The admitted TO attaches it.
    const set = await patch(to, S.hidden);
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    expect(set.body.outputRecordId).toBe(S.hidden);
    for (const r of [await get(path, tl2), await get(`${t}/launch-plan/tasks?limit=100`, tl2)]) {
      expect(r.status).toBe(200);
      expect(JSON.stringify(r.body)).not.toContain(S.hidden);
    }
    const item = (await get(path, tl2)).body;
    expect(item).toMatchObject({ outputRecordType: "benefit", outputRecordId: null, includesRestrictedRecords: true });
    // Re-save by the not-admitted tl: null keeps the stored output.
    const resave = await patch(tl, null);
    expect(resave.status, JSON.stringify(resave.body)).toBe(200);
    expect(resave.body.outputRecordId).toBeNull();
    const after = await api.db
      .selectFrom("launch_task")
      .select("output_record_id")
      .where("id", "=", taskId)
      .executeTakeFirstOrThrow();
    expect(after.output_record_id).toBe(S.hidden);
  });

  it("action register: an action of the hidden benefit's corrective case keeps its source kind with correctiveCaseId null for tl2 (marked); the TO sees the case", async () => {
    const variance = await handleBenefitVariance(
      api.db,
      {
        outboxEventId: randomUUID(),
        eventType: "benefit.variance_evaluated",
        schemaVersion: 1,
        idempotencyKey: `benefit.variance_evaluated:be-z12-${randomUUID()}`,
        organizationId: ORG,
        payload: {
          benefitId: S.hidden,
          measurementId: randomUUID(),
          periodStart: "2026-09-01",
          periodEnd: "2026-09-28",
          plannedAmount: "100000.0000",
          measuredAmount: "80000.0000",
          variance: "-20000.0000",
          offTrack: true,
        },
      },
      "be-z12",
    );
    const caseId = (variance.signal as Body)?.correctiveCaseId as string;
    expect(caseId, JSON.stringify(variance)).toBeTruthy();
    const created = await send("POST", `${t}/corrective-actions/${caseId}/actions`, to, {
      title: "Synthetic BE-Z12 corrective action",
      ownerUserId: toUserId,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.id as string;
    const item = await get(`${t}/action-register/${id}`, tl2);
    expect(item.status).toBe(200);
    expect(item.body).toMatchObject({
      sourceKind: "corrective_case",
      correctiveCaseId: null,
      includesRestrictedRecords: true,
    });
    const list = await get(`${t}/action-register?limit=100`, tl2);
    expect(JSON.stringify(list.body)).not.toContain(caseId);
    expect((await get(`${t}/action-register/${id}`, to)).body.correctiveCaseId).toBe(caseId);
  });
});
