// code-security-reviewer, DG6 round 7 (T-DG6-REV-CS-R7). NOT part of the candidate: copied into a disposable clone's
// tests/qa/integration by checks.sh repro and removed afterwards. Demo data is SYNTHETIC (illustrative, not Mobily
// actual performance). Marking a record sensitive is an access decision, never a business approval (G1-G6); nothing
// here touches DG0-DG7.
//
// Part A (verification of F-DG6-420, ASSERTED): the round-6 reproduction (zz-cs-r6-id-refs.test.ts) with assertions:
//   a benefit group whose counted member is a sensitive benefit, and a sensitive evidence item linked to an open
//   benefit's measurement. TL (in scope, no grant) must not receive either id anywhere in the group or measurement
//   bodies, and gets the neutral markers; TO (admitted) gets the ids. A TL rename of the group keeps the hidden counted
//   member (re-save rule). The audit trail of the group's API change does not show the hidden id in `changes`.
// Part B (beyond the repair, LOGGED then ASSERTED as a list): reference paths D-218 covers by its words ("a response
//   never names the id of a sensitive record the reader is not admitted to") but that BE-Z10/Z10B did not list:
//   B1 an open benefit whose parent (parent_benefit_id) is the sensitive benefit: getBenefit, listBenefits;
//   B2 a meeting output (kind benefit_view -> benefit; kind evidence -> evidence): listMeetingOutputs, getMeetingMinutes;
//   B3 a launch-plan task whose output is the sensitive benefit: listLaunchTasks, getLaunchTask;
//   B4 a procedure instance evidence link to the sensitive evidence item: getProcedureInstance, listProcedureInstances.
// Every row is inserted directly with its audit event in the same transaction (the 0004 guard), as the in-tree sweep
// does (seedRow), because the leak under test is on the READ path. The final assertion lists every response in which
// TL receives a hidden id; it is EXPECTED to fail if any such path exists, and the log names each one.
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
/** A second TL scoped to the transformation who created and edited nothing (no grant, never a named party). */
let tl2: Session;
let toUserId = "";
const t = () => `/api/v1/transformations/${T}`;
const S = {
  hidden: "",
  open: "",
  groupId: "",
  evId: "",
  measurementId: "",
  child: "",
  parent: "",
  oracle: "",
  meetingId: "",
  taskId: "",
  procedureId: "",
};
const seeded: string[] = [];
const log = (...a: unknown[]) => console.log("[CS-R7-ID]", ...a);
const get = (path: string, session: Session) => call<Body>(api.app, "GET", path, { session, contract: false });
const grantor = DEMO_ANCHORS.users.sp;
const actor = (tag: string) => ({ actorType: "user" as const, actorUserId: grantor, requestId: `cs-r7-id-${tag}`, source: "api" as const });

async function audited(tag: string, fn: (tx: Body) => Promise<{ recordType: string; recordId: string; prior?: number; next: number }>): Promise<boolean> {
  try {
    await api.db.transaction().execute(async (tx: Body) => {
      const r = await fn(tx);
      await insertAuditEvent(tx, actor(tag), {
        action: `${r.recordType}.${r.prior === undefined ? "create" : "update"}`,
        recordType: r.recordType,
        recordId: r.recordId,
        organizationId: ORG,
        transformationId: T,
        ...(r.prior === undefined ? {} : { priorVersion: r.prior }),
        newVersion: r.next,
      });
    });
    seeded.push(tag);
    return true;
  } catch (e) {
    log(`SETUP ${tag} NOT SEEDED: ${(e as Error).message.slice(0, 300)}`);
    return false;
  }
}

beforeAll(async () => {
  const { adminUrl } = inject("mthDb");
  scratch = await createScratchDatabase(adminUrl, "mth_cs_r7_id");
  await migrate(roleUrl(adminUrl, scratch, "mth_owner"));
  await seedDemo(roleUrl(adminUrl, scratch, "mth_owner"), { mthEnv: "demo", runKind: "seed", requestedVia: "cli", requestedBy: null });
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
  const bs = await api.db
    .selectFrom("benefit")
    .select(["id", "code", "version", "parent_benefit_id", "currency"])
    .where("transformation_id", "=", T)
    .where("status", "=", "active")
    .orderBy("code")
    .execute();
  const parents = new Set(bs.map((b) => b.parent_benefit_id).filter((x): x is string => x !== null));
  const withDraft = await api.db
    .selectFrom("benefit_measurement")
    .select("benefit_id")
    .where("transformation_id", "=", T)
    .where("status", "in", ["draft", "submitted"])
    .orderBy("id")
    .executeTakeFirstOrThrow();
  const openRow = bs.find((b) => b.id === withDraft.benefit_id)!;
  // The hidden benefit: a top-level benefit (no parent) that is not the open one, so an open benefit can be its child.
  const hiddenRow = bs.find((b) => b.id !== openRow.id && b.parent_benefit_id === null)!;
  S.hidden = hiddenRow.id;
  S.open = openRow.id;
  // A child candidate: open, no parent, no children, same currency, not the open (measurement) benefit.
  const childRow = bs.find(
    (b) => b.id !== S.hidden && b.id !== S.open && b.parent_benefit_id === null && !parents.has(b.id) && b.currency === hiddenRow.currency,
  );
  log(`hidden ${hiddenRow.code}, open ${openRow.code}, child candidate ${childRow?.code ?? "none"}`);

  // ---- Part A setup (as round 6), the group via direct insert, then a TO API change of the counted member
  S.groupId = randomUUID();
  await api.db.transaction().execute(async (tx) => {
    await tx.insertInto("benefit_group").values({ id: S.groupId, organization_id: ORG, transformation_id: T, code: "BG-78", title: "Synthetic group CS-R7", created_by: grantor, updated_by: grantor }).execute();
    await insertAuditEvent(tx, actor("group"), { action: "benefit_group.create", recordType: "benefit_group", recordId: S.groupId, organizationId: ORG, transformationId: T, newVersion: 1 });
    for (const b of [hiddenRow, openRow]) {
      await sql`UPDATE benefit SET benefit_group_id = ${S.groupId}::uuid, version = version + 1, updated_at = now() WHERE id = ${b.id}::uuid`.execute(tx);
      await insertAuditEvent(tx, actor("member"), { action: "benefit.update", recordType: "benefit", recordId: b.id, organizationId: ORG, transformationId: T, priorVersion: b.version, newVersion: b.version + 1 });
    }
  });
  // counted member set through the API by the TL (benefit_group.manage; before marking), so the audit event carries
  // `changes` (attempt 1 used the TO, who does not hold benefit_group.manage: 403)
  const g1 = await get(`/api/v1/transformations/${T}/benefit-groups/${S.groupId}`, tl);
  const pg = await call<Body>(api.app, "PATCH", `/api/v1/transformations/${T}/benefit-groups/${S.groupId}`, {
    session: tl,
    headers: { "if-match": g1.headers.etag as string },
    body: { countedBenefitId: S.hidden },
    contract: false,
  });
  log(`TL PATCH group countedBenefitId (before marking) -> ${pg.status} ${pg.status === 200 ? "" : JSON.stringify(pg.body).slice(0, 300)}`);
  expect(pg.status).toBe(200);
  const m = await call<Body>(api.app, "PUT", `/api/v1/transformations/${T}/records/benefit/${S.hidden}/sensitivity`, {
    session: to,
    headers: { "if-match": '"0"' },
    body: { isSensitive: true, reason: "Synthetic sensitive benefit (CS-R7-ID)" },
  });
  expect(m.status, JSON.stringify(m.body)).toBe(200);
  const ev = await call<Body>(api.app, "POST", `/api/v1/transformations/${T}/evidence`, {
    session: to,
    body: { ownerUserId: uTo.id, kind: "note", title: "Synthetic CONFIDENTIAL CS-R7-ID evidence", noteBody: "Synthetic" },
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
  await audited("benefit_evidence", async (tx) => {
    const id = randomUUID();
    await tx.insertInto("benefit_evidence").values({ id, organization_id: ORG, transformation_id: T, benefit_id: mm.benefit_id, measurement_id: mm.id, evidence_id: S.evId, created_by: uTo.id }).execute();
    return { recordType: "benefit_evidence", recordId: id, next: 1 };
  });
  const me = await call<Body>(api.app, "PUT", `/api/v1/transformations/${T}/records/evidence/${S.evId}/sensitivity`, {
    session: to,
    headers: { "if-match": '"0"' },
    body: { isSensitive: true, reason: "Synthetic sensitive evidence (CS-R7-ID)" },
  });
  expect(me.status, JSON.stringify(me.body)).toBe(200);

  // ---- Part B setup
  // B1 (attempt 3, all through the API: the demo has no parent/child pair, and a benefit with values cannot become a
  // parent). The TL creates a benefit P (no values), makes an open benefit C its child (PATCH parentBenefitId), then
  // the TO marks P sensitive. A second TL, not admitted, reads C.
  if (childRow !== undefined) {
    const p = await call<Body>(api.app, "POST", `${t()}/benefits`, {
      session: tl,
      body: { title: "Synthetic CONFIDENTIAL CS-R7 parent", description: "Synthetic.", benefitType: "cost", valueClass: "avoided_cost", ownerUserId: grantor, currency: childRow.currency.trim(), financialStatementLine: "Opex" },
      contract: false,
    });
    log(`B1 TL POST parent benefit -> ${p.status} ${p.status === 201 ? p.body.code : JSON.stringify(p.body).slice(0, 300)}`);
    if (p.status === 201) {
      const c0 = await get(`${t()}/benefits/${childRow.id}`, tl);
      const c1 = await call<Body>(api.app, "PATCH", `${t()}/benefits/${childRow.id}`, {
        session: tl,
        headers: { "if-match": c0.headers.etag as string },
        body: { parentBenefitId: p.body.id },
        contract: false,
      });
      log(`B1 TL PATCH ${childRow.code} parentBenefitId -> ${c1.status} ${c1.status === 200 ? "" : JSON.stringify(c1.body).slice(0, 300)}`);
      if (c1.status === 200) {
        const mp = await call<Body>(api.app, "PUT", `${t()}/records/benefit/${p.body.id}/sensitivity`, {
          session: to,
          headers: { "if-match": '"0"' },
          body: { isSensitive: true, reason: "Synthetic sensitive parent benefit (CS-R7-ID)" },
        });
        log(`B1 TO marks the parent sensitive -> ${mp.status}`);
        if (mp.status === 200) {
          S.child = childRow.id;
          S.parent = p.body.id;
          seeded.push("B1-parent");
        }
      }
    }
  } else log("SETUP B1 NOT SEEDED: no child candidate");
  // B2 (attempt 3: the demo has no meeting, so one scheduled meeting (a new meeting starts scheduled) of a demo forum is inserted, with its audit event)
  const forum = await sql<{ id: string }>`SELECT id::text AS id FROM forum WHERE transformation_id = ${T}::uuid ORDER BY id LIMIT 1`.execute(api.db);
  if (forum.rows[0]) {
    const mid = randomUUID();
    const ok = await audited("B2-meeting", async (tx) => {
      await tx.insertInto("meeting").values({ id: mid, organization_id: ORG, transformation_id: T, forum_id: forum.rows[0]!.id, scheduled_date: "2026-10-01", starts_at: new Date("2026-10-01T07:00:00Z"), ends_at: new Date("2026-10-01T08:00:00Z"), status: "scheduled", cutoff_unknown_reason: "calendar_not_configured", created_source: "api", created_by: grantor, updated_by: grantor } as Body).execute();
      return { recordType: "meeting", recordId: mid, next: 1 };
    });
    if (ok) {
      S.meetingId = mid;
      for (const [kind, type, id] of [
        ["benefit_view", "benefit", S.hidden],
        ["evidence", "evidence", S.evId],
      ] as const)
        await audited(`B2-meeting_output-${kind}`, async (tx) => {
          const oid = randomUUID();
          await tx.insertInto("meeting_output").values({ id: oid, organization_id: ORG, transformation_id: T, meeting_id: S.meetingId, output_kind: kind, record_type: type, record_id: id, note: null, created_by: grantor }).execute();
          return { recordType: "meeting_output", recordId: oid, next: 1 };
        });
    }
  } else log("SETUP B2 NOT SEEDED: no forum in the demo transformation");
  // B3 (attempt 3, through the API, AFTER the benefit is marked): the template task whose output type is benefit
  // (w3_o4 "benefits register"). The NOT-admitted TL (launch_plan.edit) names a random id (expected 422) and then the
  // sensitive benefit's id as the task's output: does the write check reach (404/422) or accept it (an existence oracle)?
  const task = await sql<{ id: string }>`SELECT id::text AS id FROM launch_task WHERE transformation_id = ${T}::uuid AND output_record_type = 'benefit' ORDER BY id LIMIT 1`.execute(api.db);
  if (task.rows[0]) {
    S.taskId = task.rows[0].id;
    const put = async (outputRecordId: string) => {
      const cur = await get(`${t()}/launch-plan/tasks/${S.taskId}`, tl);
      return call<Body>(api.app, "PATCH", `${t()}/launch-plan/tasks/${S.taskId}`, {
        session: tl,
        headers: { "if-match": cur.headers.etag as string },
        body: { outputRecordId },
        contract: false,
      });
    };
    const r1 = await put(randomUUID());
    log(`B3 oracle: TL PATCH outputRecordId=<random uuid> -> ${r1.status} ${r1.body?.code ?? ""}`);
    const r2 = await put(S.hidden);
    log(`B3 oracle: TL PATCH outputRecordId=<sensitive benefit the TL gets 404 on> -> ${r2.status} ${r2.body?.code ?? ""}`);
    S.oracle = `${r1.status}/${r2.status}`;
    if (r2.status === 200) seeded.push("B3-launch_task-output(API, by the not-admitted TL)");
  } else log("SETUP B3 NOT SEEDED: no launch task with output type benefit");
  const proc = await sql<{ id: string }>`SELECT id::text AS id FROM procedure_instance WHERE transformation_id = ${T}::uuid ORDER BY id LIMIT 1`.execute(api.db);
  if (proc.rows[0]) {
    S.procedureId = proc.rows[0].id;
    await audited("B4-procedure_instance_link-evidence", async (tx) => {
      const lid = randomUUID();
      await tx.insertInto("procedure_instance_link").values({ id: lid, organization_id: ORG, transformation_id: T, procedure_instance_id: S.procedureId, step_instance_id: null, link_kind: "evidence", record_type: "evidence", record_id: S.evId, created_by: grantor }).execute();
      return { recordType: "procedure_instance_link", recordId: lid, next: 1 };
    });
  } else log("SETUP B4 NOT SEEDED: no procedure instance in the demo transformation");
  log(`seeded: ${seeded.join(", ")}`);
}, 900_000);

afterAll(async () => {
  await api?.close();
  if (scratch !== null) await dropScratchDatabase(inject("mthDb").adminUrl, scratch);
}, 60_000);

const names = (body: unknown) => {
  const text = JSON.stringify(body);
  return { hidden: text.includes(S.hidden) || (S.parent !== "" && text.includes(S.parent)), ev: text.includes(S.evId) };
};

describe("CS-R7-ID part A: F-DG6-420 re-verification", () => {
  it("TL gets 404 on both records and no id in the group or measurement bodies; TO gets the ids", async () => {
    expect((await get(`${t()}/benefits/${S.hidden}`, tl)).status).toBe(404);
    expect((await get(`${t()}/evidence/${S.evId}`, tl)).status).toBe(404);
    expect((await get(`${t()}/benefits/${S.hidden}`, to)).status).toBe(200);
    expect((await get(`${t()}/evidence/${S.evId}`, to)).status).toBe(200);
    for (const [who, s, admitted] of [
      ["TL", tl, false],
      ["TO", to, true],
    ] as const) {
      const list = await get(`${t()}/benefit-groups?limit=100`, s);
      const g = (list.body?.items ?? []).find((x: Body) => x.id === S.groupId);
      const one = await get(`${t()}/benefit-groups/${S.groupId}`, s);
      const ms = await get(`${t()}/benefit-measurements/${S.measurementId}`, s);
      const ml = await get(`${t()}/benefit-measurements?limit=100`, s);
      const reg = await get(`${t()}/benefits?limit=100`, s);
      log(`${who}: listBenefitGroups ${list.status} counted=${g?.countedBenefitId === S.hidden ? "<hidden id>" : g?.countedBenefitId} countedBenefitRestricted=${g?.countedBenefitRestricted} members=${g?.memberBenefitIds?.length} includesRestrictedRecords=${g?.includesRestrictedRecords}`);
      log(`${who}: getBenefitGroup ${one.status} names=${JSON.stringify(names(one.body))} countedBenefitRestricted=${one.body?.countedBenefitRestricted}`);
      log(`${who}: getBenefitMeasurement ${ms.status} names=${JSON.stringify(names(ms.body))} includesRestrictedRecords=${ms.body?.includesRestrictedRecords}`);
      log(`${who}: listBenefitMeasurements ${ml.status} names=${JSON.stringify(names(ml.body))}; listBenefits ${reg.status} names=${JSON.stringify(names(reg.body))}`);
      expect(list.status).toBe(200);
      expect(one.status).toBe(200);
      expect(ms.status).toBe(200);
      if (admitted) {
        expect(g.countedBenefitId).toBe(S.hidden);
        expect(g.memberBenefitIds).toContain(S.hidden);
        expect(ms.body.evidenceIds).toContain(S.evId);
        expect(one.body.includesRestrictedRecords).toBeUndefined();
      } else {
        expect(names(list.body).hidden).toBe(false);
        expect(names(one.body)).toEqual({ hidden: false, ev: false });
        expect(names(ms.body)).toEqual({ hidden: false, ev: false });
        expect(names(ml.body).ev).toBe(false);
        expect(g.countedBenefitId).toBeNull();
        expect(g.countedBenefitRestricted).toBe(true);
        expect(g.includesRestrictedRecords).toBe(true);
        expect(g.memberBenefitIds).toEqual([S.open]);
        expect(ms.body.includesRestrictedRecords).toBe(true);
        expect(ms.body.evidenceIds).not.toContain(S.evId);
      }
    }
  });

  it("a TL rename (no countedBenefitId) keeps the hidden counted member; the response names no hidden id", async () => {
    const one = await get(`${t()}/benefit-groups/${S.groupId}`, tl);
    const r = await call<Body>(api.app, "PATCH", `${t()}/benefit-groups/${S.groupId}`, {
      session: tl,
      headers: { "if-match": one.headers.etag as string },
      body: { title: "Synthetic group CS-R7 renamed" },
      contract: false,
    });
    log(`TL PATCH group title -> ${r.status} names=${JSON.stringify(names(r.body))} ${r.status >= 400 ? JSON.stringify(r.body).slice(0, 300) : ""}`);
    const row = await api.db.selectFrom("benefit_group").select(["counted_benefit_id", "title"]).where("id", "=", S.groupId).executeTakeFirstOrThrow();
    log(`DB after TL PATCH: counted is hidden=${row.counted_benefit_id === S.hidden} title=${row.title}`);
    if (r.status === 200) {
      expect(names(r.body)).toEqual({ hidden: false, ev: false });
      expect(row.counted_benefit_id).toBe(S.hidden);
    } else expect([403, 404]).toContain(r.status);
  });

  it("the group's audit trail (an OPEN record's events) does not show the hidden id in changes to TL", async () => {
    const r = await get(`${t()}/audit?limit=100&recordType=benefit_group&recordId=${S.groupId}`, tl);
    const all = await get(`${t()}/audit?limit=100`, tl);
    log(`TL listTransformationAudit(group) ${r.status} names=${JSON.stringify(names(r.body))}; unfiltered ${all.status}`);
    if (r.status === 200) {
      const ev = (r.body.items ?? []) as Body[];
      log(`group events: ${ev.map((e: Body) => `${e.action}:redacted=${e.redacted ?? (e.changes === null)}`).join(" ")}`);
      expect(JSON.stringify(ev.map((e: Body) => e.changes))).not.toContain(S.hidden);
    }
    if (all.status === 200) {
      const recIds = new Set(((all.body.items ?? []) as Body[]).map((e: Body) => e.recordId));
      log(`D-219: the unfiltered trail names the hidden benefit as a recordId: ${recIds.has(S.hidden)}; its changes: ${JSON.stringify(((all.body.items ?? []) as Body[]).filter((e: Body) => e.recordId !== S.hidden).map((e: Body) => e.changes)).includes(S.hidden)}`);
    }
  });
});

describe("CS-R7-ID part B: reference paths outside the BE-Z10/Z10B list", () => {
  it("a not-admitted TL (tl2) never receives a hidden id from an open record's response", async () => {
    const reads: [string, string][] = [];
    if (S.child) reads.push(["B1 getBenefit(open child of the sensitive parent)", `${t()}/benefits/${S.child}`], ["B1 listBenefits", `${t()}/benefits?limit=100`]);
    if (S.meetingId)
      reads.push(["B2 listMeetingOutputs", `${t()}/meetings/${S.meetingId}/outputs?limit=100`], ["B2 getMeetingMinutes", `${t()}/meetings/${S.meetingId}/minutes`]);
    if (S.taskId) reads.push(["B3 listLaunchTasks", `${t()}/launch-plan/tasks?limit=100`], ["B3 getLaunchTask", `${t()}/launch-plan/tasks/${S.taskId}`]);
    if (S.procedureId)
      reads.push(["B4 getProcedureInstance", `/api/v1/procedure-instances/${S.procedureId}`], ["B4 listProcedureInstances", `/api/v1/procedure-instances?transformationId=${T}&limit=100`]);
    const leaks: string[] = [];
    // attempt 4: the reader is tl2 (the TL who created the parent benefit B1 is its named party, created_by, so admitted).
    for (const [label, id] of [["hidden benefit", S.hidden], ["sensitive parent benefit", S.parent], ["sensitive evidence", S.evId]] as const)
      if (id !== "") log(`tl2 GET ${label}: ${(await get(`${t()}/${label.includes("evidence") ? "evidence" : "benefits"}/${id}`, tl2)).status}`);
    for (const [label, path] of reads) {
      const a = await get(path, tl2);
      const c = await get(path, to);
      const n = names(a.body);
      log(`${label}: tl2 ${a.status} names hidden benefit=${n.hidden} sensitive evidence=${n.ev} | TO ${c.status} ${JSON.stringify(names(c.body))}`);
      if (n.hidden || n.ev) {
        const text = JSON.stringify(a.body);
        const pos = [S.hidden, S.parent, S.evId].filter((x) => x !== "").map((x) => text.indexOf(x)).filter((i) => i >= 0);
        const at = Math.max(Math.min(...pos) - 160, 0);
        log(`  tl2 excerpt: ...${text.slice(at, at + 260)}...`);
        leaks.push(`${label} (${path}) -> ${n.hidden ? "hidden benefit id " : ""}${n.ev ? "sensitive evidence id" : ""}`);
      }
    }
    log(`part B leaks (${leaks.length}):\n${leaks.join("\n")}`);
    log(`B3 write oracle (random id / sensitive id, as the not-admitted TL): ${S.oracle}`);
    expect(seeded.length, "setup seeded the part B rows").toBeGreaterThan(1);
    expect(leaks).toEqual([]);
  });
});
