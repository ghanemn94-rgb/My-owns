// code-security-reviewer, DG6 round 6 (T-DG6-REV-CS-R6): do open records' responses name the ID of a restricted
// record (existence disclosure, ADR-0051 §2 "Record GET ... 404 (existence not disclosed)")? NOT part of the candidate:
// copied into a disposable clone's tests/qa/integration by checks.sh repro and removed afterwards. Demo data is
// SYNTHETIC. Marking a record sensitive is an access decision, never a business approval (G1-G6); nothing here touches
// DG0-DG7. This probe LOGS what it finds and asserts only the setup; the judgement is in the review record.
//   1. a benefit group whose members are an open benefit and a sensitive one (the counted member): listBenefitGroups /
//      getBenefitGroup as TL (not admitted);
//   2. a sensitive evidence item linked to an open benefit's submitted measurement: getBenefitMeasurement /
//      listBenefitMeasurements as TL (evidenceIds).
import { insertAuditEvent, migrate, seedDemo, sql } from "../../../packages/db/src/index.ts";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { DEMO_ANCHORS } from "../../../packages/db/src/demo/data/kpis.ts";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../packages/db/test/helpers.ts";
import { call, createUser, grant, signIn, startApi, type Session, type TestApi } from "../../../apps/api/test/support/harness.ts";
import { randomUUID } from "node:crypto";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const T = DEMO_ANCHORS.transformationId;
const ORG = DEMO_ANCHORS.organizationId;
let api: TestApi;
let scratch: string | null = null;
let to: Session;
let tl: Session;
const S = { hidden: "", open: "", groupId: "", evId: "", measurementId: "" };
const log = (...a: unknown[]) => console.log("[CS-R6-ID]", ...a);
const get = (path: string, session: Session) => call<Body>(api.app, "GET", path, { session, contract: false });

beforeAll(async () => {
  const { adminUrl } = inject("mthDb");
  scratch = await createScratchDatabase(adminUrl, "mth_cs_r6_id");
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
  const bs = await api.db.selectFrom("benefit").select(["id", "code", "version"]).where("transformation_id", "=", T).where("status", "=", "active").orderBy("code").execute();
  // The open benefit is the one that has a draft or submitted measurement (benefit_evidence accepts only those); the
  // hidden one is another (attempts 1 and 2 hid the only such benefit, so the measurement query found nothing).
  const withDraft = await api.db.selectFrom("benefit_measurement").select("benefit_id").where("transformation_id", "=", T).where("status", "in", ["draft", "submitted"]).orderBy("id").executeTakeFirstOrThrow();
  const openRow = bs.find((b) => b.id === withDraft.benefit_id)!;
  const hiddenRow = bs.find((b) => b.id !== withDraft.benefit_id)!;
  bs.splice(0, bs.length, hiddenRow, openRow);
  S.hidden = bs[0]!.id;
  S.open = bs[1]!.id;
  log(`hidden ${bs[0]!.code}, open ${bs[1]!.code} (has the draft/submitted measurement: ${bs[1]!.id === withDraft.benefit_id})`);
  S.groupId = randomUUID();
  const actor = (id: string) => ({ actorType: "user" as const, actorUserId: grantor, requestId: `cs-r6-id-${id}`, source: "api" as const });
  await api.db.transaction().execute(async (tx) => {
    await tx.insertInto("benefit_group").values({ id: S.groupId, organization_id: ORG, transformation_id: T, code: "BG-77", title: "Synthetic group CS-R6", created_by: grantor, updated_by: grantor }).execute();
    await insertAuditEvent(tx, actor(S.groupId), { action: "benefit_group.create", recordType: "benefit_group", recordId: S.groupId, organizationId: ORG, transformationId: T, newVersion: 1 });
    for (const b of bs.slice(0, 2)) {
      await sql`UPDATE benefit SET benefit_group_id = ${S.groupId}::uuid, version = version + 1, updated_at = now() WHERE id = ${b.id}::uuid`.execute(tx);
      await insertAuditEvent(tx, actor(b.id), { action: "benefit.update", recordType: "benefit", recordId: b.id, organizationId: ORG, transformationId: T, priorVersion: b.version, newVersion: b.version + 1 });
    }
    await sql`UPDATE benefit_group SET counted_benefit_id = ${S.hidden}::uuid, version = version + 1 WHERE id = ${S.groupId}::uuid`.execute(tx);
    await insertAuditEvent(tx, actor(S.groupId), { action: "benefit_group.update", recordType: "benefit_group", recordId: S.groupId, organizationId: ORG, transformationId: T, priorVersion: 1, newVersion: 2 });
  });
  const m = await call<Body>(api.app, "PUT", `/api/v1/transformations/${T}/records/benefit/${S.hidden}/sensitivity`, {
    session: to,
    headers: { "if-match": '"0"' },
    body: { isSensitive: true, reason: "Synthetic sensitive benefit (CS-R6-ID)" },
  });
  expect(m.status, JSON.stringify(m.body)).toBe(200);
  // evidence on an open benefit's submitted measurement, then marked sensitive
  const ev = await call<Body>(api.app, "POST", `/api/v1/transformations/${T}/evidence`, {
    session: to,
    body: { ownerUserId: uTo.id, kind: "note", title: "Synthetic CONFIDENTIAL CS-R6-ID evidence", noteBody: "Synthetic" },
  });
  expect(ev.status).toBe(201);
  S.evId = ev.body.id;
  const mm = await api.db
    .selectFrom("benefit_measurement")
    .select(["id", "benefit_id"])
    .where("transformation_id", "=", T)
    .where("benefit_id", "<>", S.hidden)
    .where("status", "in", ["draft", "submitted"])
    .orderBy("id")
    .executeTakeFirstOrThrow();
  S.measurementId = mm.id;
  await api.db.transaction().execute(async (tx) => {
    const id = randomUUID();
    await tx.insertInto("benefit_evidence").values({ id, organization_id: ORG, transformation_id: T, benefit_id: mm.benefit_id, measurement_id: mm.id, evidence_id: S.evId, created_by: uTo.id }).execute();
    await insertAuditEvent(tx, actor(id), { action: "benefit_evidence.create", recordType: "benefit_evidence", recordId: id, organizationId: ORG, transformationId: T, newVersion: 1 });
  });
  const me = await call<Body>(api.app, "PUT", `/api/v1/transformations/${T}/records/evidence/${S.evId}/sensitivity`, {
    session: to,
    headers: { "if-match": '"0"' },
    body: { isSensitive: true, reason: "Synthetic sensitive evidence (CS-R6-ID)" },
  });
  expect(me.status, JSON.stringify(me.body)).toBe(200);
}, 600_000);

afterAll(async () => {
  await api?.close();
  if (scratch !== null) await dropScratchDatabase(inject("mthDb").adminUrl, scratch);
}, 60_000);

describe("CS-R6-ID: identifiers of restricted records in open records' responses", () => {
  it("benefit group and measurement evidence ids, as TL (not admitted) and TO (admitted)", async () => {
    for (const [who, s] of [["TL", tl], ["TO", to]] as const) {
      const b = await get(`/api/v1/transformations/${T}/benefits/${S.hidden}`, s);
      const e = await get(`/api/v1/transformations/${T}/evidence/${S.evId}`, s);
      const list = await get(`/api/v1/transformations/${T}/benefit-groups?limit=100`, s);
      const g = (list.body?.items ?? []).find((x: Body) => x.id === S.groupId);
      const one = await get(`/api/v1/transformations/${T}/benefit-groups/${S.groupId}`, s);
      const m = await get(`/api/v1/transformations/${T}/benefit-measurements/${S.measurementId}`, s);
      log(`${who}: GET hidden benefit ${b.status}; GET sensitive evidence ${e.status}`);
      log(`${who}: listBenefitGroups ${list.status} group countedBenefitId=${g?.countedBenefitId === S.hidden ? "<hidden benefit id>" : g?.countedBenefitId} memberBenefitIds names hidden=${(g?.memberBenefitIds ?? []).includes(S.hidden)} members=${g?.memberBenefitIds?.length}`);
      log(`${who}: getBenefitGroup ${one.status} countedBenefitId is hidden=${one.body?.countedBenefitId === S.hidden} members names hidden=${(one.body?.memberBenefitIds ?? []).includes(S.hidden)}`);
      log(`${who}: getBenefitMeasurement ${m.status} evidenceIds names the sensitive evidence=${JSON.stringify(m.body?.evidenceIds ?? null).includes(S.evId)} body mentions its title=${JSON.stringify(m.body).includes("CS-R6-ID evidence")}`);
    }
  });
});
