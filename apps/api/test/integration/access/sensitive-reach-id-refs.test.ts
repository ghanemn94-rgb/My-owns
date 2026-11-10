// Identifiers of restricted records in open records' responses (T-DG6-BE-Z10; F-DG6-420; D-218; ADR-0051 §2
// "existence not disclosed", ADR-0006; REQ-S10-002 "a sensitive benefit is hidden from a workstream member without the
// grant"), against a scratch database of the run's disposable PostgreSQL seeded with the synthetic demo dataset.
// Ported from the code-security probe zz-cs-r6-id-refs.test.ts (round 6), which only logged; this test asserts.
// Everything is SYNTHETIC. Marking a record sensitive is an access decision, never a business approval (G1-G6), and
// nothing here names or touches the engineering gates DG0-DG7.
//
// Setup: a benefit group whose members are an open benefit and a sensitive one (the counted member); a sensitive
// evidence item linked to the open benefit's draft or submitted measurement. Reader TL (scoped to the transformation,
// no grant, not a named party) is not admitted; TO is (it marked them).
//   - TL: the group list and item never name the hidden benefit's id; the counted member is a neutral marker
//     (`countedBenefitId: null`, `countedBenefitRestricted: true`) and `includesRestrictedRecords: true`; the
//     measurement's `evidenceIds` omit the hidden evidence and carry `includesRestrictedRecords: true`.
//   - TO (positive control): every id, no marker.
//   - Writes naming the hidden id keep their existing answers (D-218: "writes that reference a hidden id must keep
//     returning the existing not-found behaviour").
import { insertAuditEvent, migrate, seedDemo, sql } from "@mth/db";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { DEMO_ANCHORS } from "../../../../../packages/db/src/demo/data/kpis.ts";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../../../packages/db/test/helpers.ts";
import { call, createUser, grant, signIn, startApi, type Session, type TestApi } from "../../support/harness.ts";
import { randomUUID } from "node:crypto";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const T = DEMO_ANCHORS.transformationId;
const ORG = DEMO_ANCHORS.organizationId;
const base = `/api/v1/transformations/${T}`;
let api: TestApi;
let scratch: string | null = null;
let to: Session;
let tl: Session;
const S = { hidden: "", open: "", groupId: "", evId: "", measurementId: "" };
const get = (path: string, session: Session) => call<Body>(api.app, "GET", path, { session });

beforeAll(async () => {
  const { adminUrl } = inject("mthDb");
  scratch = await createScratchDatabase(adminUrl, "mth_be_z10_idrefs");
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
  const uTo = await mk("TO", { type: "organization", id: ORG });
  to = await signIn(api.app, uTo.subject);
  tl = await signIn(api.app, (await mk("TL", { type: "transformation", id: T })).subject);
  const bs = await api.db
    .selectFrom("benefit")
    .select(["id", "code", "version"])
    .where("transformation_id", "=", T)
    .where("status", "=", "active")
    .orderBy("code")
    .execute();
  // The open benefit has a draft or submitted measurement (benefit_evidence accepts only those); the hidden one is another.
  const withDraft = await api.db
    .selectFrom("benefit_measurement")
    .select(["id", "benefit_id"])
    .where("transformation_id", "=", T)
    .where("status", "in", ["draft", "submitted"])
    .orderBy("id")
    .executeTakeFirstOrThrow();
  const openRow = bs.find((b) => b.id === withDraft.benefit_id)!;
  const hiddenRow = bs.find((b) => b.id !== withDraft.benefit_id)!;
  S.hidden = hiddenRow.id;
  S.open = openRow.id;
  S.measurementId = withDraft.id;
  S.groupId = randomUUID();
  const actor = (id: string) => ({
    actorType: "user" as const,
    actorUserId: grantor,
    requestId: `be-z10-${id === S.hidden ? "hidden" : "row"}`,
    source: "api" as const,
  });
  await api.db.transaction().execute(async (tx) => {
    await tx
      .insertInto("benefit_group")
      .values({
        id: S.groupId,
        organization_id: ORG,
        transformation_id: T,
        code: "BG-77",
        title: "Synthetic group BE-Z10",
        created_by: grantor,
        updated_by: grantor,
      })
      .execute();
    await insertAuditEvent(tx, actor(S.groupId), {
      action: "benefit_group.create",
      recordType: "benefit_group",
      recordId: S.groupId,
      organizationId: ORG,
      transformationId: T,
      newVersion: 1,
    });
    for (const b of [hiddenRow, openRow]) {
      await sql`UPDATE benefit SET benefit_group_id = ${S.groupId}::uuid, version = version + 1, updated_at = now()
                WHERE id = ${b.id}::uuid`.execute(tx);
      await insertAuditEvent(tx, actor(b.id), {
        action: "benefit.update",
        recordType: "benefit",
        recordId: b.id,
        organizationId: ORG,
        transformationId: T,
        priorVersion: b.version,
        newVersion: b.version + 1,
      });
    }
    await sql`UPDATE benefit_group SET counted_benefit_id = ${S.hidden}::uuid, version = version + 1
              WHERE id = ${S.groupId}::uuid`.execute(tx);
    await insertAuditEvent(tx, actor(S.groupId), {
      action: "benefit_group.update",
      recordType: "benefit_group",
      recordId: S.groupId,
      organizationId: ORG,
      transformationId: T,
      priorVersion: 1,
      newVersion: 2,
    });
  });
  const m = await call<Body>(api.app, "PUT", `${base}/records/benefit/${S.hidden}/sensitivity`, {
    session: to,
    headers: { "if-match": '"0"' },
    body: { isSensitive: true, reason: "Synthetic sensitive benefit (BE-Z10)" },
  });
  expect(m.status, JSON.stringify(m.body)).toBe(200);
  const ev = await call<Body>(api.app, "POST", `${base}/evidence`, {
    session: to,
    body: { ownerUserId: uTo.id, kind: "note", title: "Synthetic CONFIDENTIAL BE-Z10 evidence", noteBody: "Synthetic" },
  });
  expect(ev.status).toBe(201);
  S.evId = ev.body.id;
  await api.db.transaction().execute(async (tx) => {
    const id = randomUUID();
    await tx
      .insertInto("benefit_evidence")
      .values({
        id,
        organization_id: ORG,
        transformation_id: T,
        benefit_id: S.open,
        measurement_id: S.measurementId,
        evidence_id: S.evId,
        created_by: uTo.id,
      })
      .execute();
    await insertAuditEvent(tx, actor(id), {
      action: "benefit_evidence.create",
      recordType: "benefit_evidence",
      recordId: id,
      organizationId: ORG,
      transformationId: T,
      newVersion: 1,
    });
  });
  const me = await call<Body>(api.app, "PUT", `${base}/records/evidence/${S.evId}/sensitivity`, {
    session: to,
    headers: { "if-match": '"0"' },
    body: { isSensitive: true, reason: "Synthetic sensitive evidence (BE-Z10)" },
  });
  expect(me.status, JSON.stringify(me.body)).toBe(200);
}, 600_000);

afterAll(async () => {
  await api?.close();
  if (scratch !== null) await dropScratchDatabase(inject("mthDb").adminUrl, scratch);
}, 60_000);

const text = (b: unknown) => JSON.stringify(b);

describe("F-DG6-420 / D-218: an open record's response never names a restricted record's id", () => {
  it("control: TL gets 404 on the hidden benefit and the hidden evidence; TO reads both", async () => {
    expect((await get(`${base}/benefits/${S.hidden}`, tl)).status).toBe(404);
    expect((await get(`${base}/evidence/${S.evId}`, tl)).status).toBe(404);
    expect((await get(`${base}/benefits/${S.hidden}`, to)).status).toBe(200);
    expect((await get(`${base}/evidence/${S.evId}`, to)).status).toBe(200);
  });

  it("TL (not admitted): the group list and item omit the hidden member and mark the counted member as restricted", async () => {
    const list = await get(`${base}/benefit-groups?limit=100`, tl);
    expect(list.status).toBe(200);
    const g = list.body.items.find((x: Body) => x.id === S.groupId);
    expect(g).toBeDefined();
    const one = await get(`${base}/benefit-groups/${S.groupId}`, tl);
    expect(one.status).toBe(200);
    for (const body of [g, one.body]) {
      expect(text(body)).not.toContain(S.hidden);
      expect(body.countedBenefitId).toBeNull();
      expect(body.countedBenefitRestricted).toBe(true);
      expect(body.memberBenefitIds).toEqual([S.open]);
      expect(body.includesRestrictedRecords).toBe(true);
    }
    expect(text(list.body)).not.toContain(S.hidden);
  });

  it("TO (admitted): the group names every member and the counted member, without a marker", async () => {
    const one = await get(`${base}/benefit-groups/${S.groupId}`, to);
    expect(one.status).toBe(200);
    expect(one.body.countedBenefitId).toBe(S.hidden);
    expect([...one.body.memberBenefitIds].sort()).toEqual([S.hidden, S.open].sort());
    expect(one.body.countedBenefitRestricted).toBeUndefined();
    expect(one.body.includesRestrictedRecords).toBeUndefined();
    const list = await get(`${base}/benefit-groups?limit=100`, to);
    const g = list.body.items.find((x: Body) => x.id === S.groupId);
    expect(g.countedBenefitId).toBe(S.hidden);
  });

  it("TL (not admitted): the open measurement omits the hidden evidence id and is marked; TO sees it", async () => {
    const tlOne = await get(`${base}/benefit-measurements/${S.measurementId}`, tl);
    expect(tlOne.status).toBe(200);
    expect(tlOne.body.evidenceIds).not.toContain(S.evId);
    expect(text(tlOne.body)).not.toContain(S.evId);
    expect(tlOne.body.includesRestrictedRecords).toBe(true);
    const tlList = await get(`${base}/benefits/${S.open}/measurements?limit=100`, tl);
    expect(tlList.status).toBe(200);
    expect(text(tlList.body)).not.toContain(S.evId);
    const row = tlList.body.items.find((x: Body) => x.id === S.measurementId);
    expect(row.includesRestrictedRecords).toBe(true);
    const toOne = await get(`${base}/benefit-measurements/${S.measurementId}`, to);
    expect(toOne.status).toBe(200);
    expect(toOne.body.evidenceIds).toContain(S.evId);
    expect(toOne.body.includesRestrictedRecords).toBeUndefined();
  });

  it("writes naming the hidden id keep their existing answers; a TL rename keeps the hidden counted member", async () => {
    // A TL rename (no countedBenefitId in the body) must not clear the counted member it cannot see.
    const before = await get(`${base}/benefit-groups/${S.groupId}`, to);
    const rename = await call<Body>(api.app, "PATCH", `${base}/benefit-groups/${S.groupId}`, {
      session: tl,
      headers: { "if-match": `"${before.body.version}"` },
      body: { title: "Synthetic group BE-Z10 renamed" },
    });
    expect(rename.status, text(rename.body)).toBe(200);
    expect(text(rename.body)).not.toContain(S.hidden);
    expect(rename.body.countedBenefitRestricted).toBe(true);
    const after = await get(`${base}/benefit-groups/${S.groupId}`, to);
    expect(after.body.countedBenefitId).toBe(S.hidden);
    // A write that names the hidden evidence on a measurement keeps the not-found answer of the evidence routes.
    const link = await call<Body>(api.app, "GET", `${base}/evidence/${S.evId}`, { session: tl });
    expect(link.status).toBe(404);
  });
});
