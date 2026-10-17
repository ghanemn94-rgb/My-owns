// D-166 Rule A: the intake adopts the transformation it produced (T-DG5-BE-T4; D-QA-E-2; REQ-S06-003; migration 0096),
// through the API and at the database, against the run's disposable PostgreSQL:
//  - when `capture_intake` of an organization-scope `new_transformation_intake` instance completes with its output
//    transformation T, every step that has not started adopts T in the same transaction (version + 1 and one audit
//    event each); the instance keeps its organization scope; a refused completion adopts nothing;
//  - with a Sponsor assigned and mapped on T, `confirm_sponsor` requests its business approval ON T, routed by T's
//    role mappings; the Sponsor decides it and the instance completes;
//  - without a mapped Sponsor the step waits, truthfully "awaiting routing" (no approval, never approved or completed);
//    once T's Sponsor is mapped, the next action on the instance (an inputs update) requests it;
//  - the 0096 guard refuses every other change of `procedure_step_instance.transformation_id`: a direct UPDATE before
//    the capture step linked T, a second adoption, a started step, a non-intake instance, a different transformation,
//    an adoption that changes another column, and any change in a transformation-scope instance.
// Every value is SYNTHETIC. The Sponsor's decision is a demo BUSINESS approval on synthetic records by a synthetic
// business approver; it approves nothing real and has nothing to do with the engineering gates DG0-DG7.
import { createDb, sql, type Db, type Tx } from "@mth/db";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  call,
  createUser,
  grant,
  seedWorld,
  signIn,
  type Session,
  startApi,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { SEEDED_PROCEDURES_VERSION_ID } from "../../support/procedures-fixtures.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const I = "/api/v1/procedure-instances";
const ifm = (v: number) => ({ "if-match": `"${v}"` });
const INPUTS = { transformationName: "Synthetic intake", caseForChange: "Synthetic case for change." };
const IMMUTABLE = "procedure_step_instance_identity_immutable";

let api: TestApi;
let w: World;
let tl: { id: string; session: Session };

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  const u = await createUser(api.db, w.orgA.id);
  // TL in the organization (acts on the organization-scope steps) and at the business unit (creates and staffs there).
  await grant(api.db, w.grantor.id, u.id, "TL", { type: "organization", id: w.orgA.id }, w.orgA.id);
  await grant(api.db, w.grantor.id, u.id, "TL", { type: "business_unit", id: w.a1 }, w.orgA.id);
  tl = { id: u.id, session: await signIn(api.app, u.subject) };
}, 180_000);
afterAll(() => api.close());

const get = async (id: string) => (await call<Body>(api.app, "GET", `${I}/${id}`, { session: tl.session })).body;
const step = (session: Session, id: string, key: string, version: number, body: Body = {}) =>
  call<Body>(api.app, "POST", `${I}/${id}/steps/${key}/complete`, { session, headers: ifm(version), body });

async function newTransformation(name: string): Promise<string> {
  const t = await call<Body>(api.app, "POST", "/api/v1/transformations", {
    session: tl.session,
    body: { businessUnitId: w.a1, name, mode: "end_to_end" },
  });
  expect(t.status, JSON.stringify(t.body)).toBe(201);
  return t.body.id as string;
}

async function launchIntake(): Promise<string> {
  const res = await call<Body>(api.app, "POST", I, {
    session: tl.session,
    body: { procedureCode: "new_transformation_intake", transformationId: null, inputValues: INPUTS },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  expect([res.body.transformationId, res.body.currentStepKeys]).toEqual([null, ["capture_intake"]]);
  return res.body.id as string;
}

const stepRows = (instanceId: string) =>
  api.db
    .selectFrom("procedure_step_instance")
    .select(["id", "step_key", "status", "transformation_id", "version"])
    .where("procedure_instance_id", "=", instanceId)
    .orderBy("ordinal")
    .execute();

/** Assigns SP on T to a new synthetic person and maps T's Sponsor party to them (the TL, through the DG4 route). */
async function staffSponsor(transformationId: string): Promise<{ id: string; session: Session }> {
  const u = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, u.id, "SP", { type: "transformation", id: transformationId }, w.orgA.id);
  const m = await call<Body>(api.app, "POST", `/api/v1/transformations/${transformationId}/role-mappings`, {
    session: tl.session,
    body: { partyCode: "SP", targetKind: "user", userId: u.id },
  });
  expect(m.status, JSON.stringify(m.body)).toBe(201);
  return { id: u.id, session: await signIn(api.app, u.subject) };
}

/** capture_intake (creates nothing itself: links T) then draft_charter (T's charter, drafted by the TL). */
async function captureAndDraft(instanceId: string, t: string): Promise<Body> {
  const c1 = await step(tl.session, instanceId, "capture_intake", 1, { outputRecordId: t });
  expect(c1.status, JSON.stringify(c1.body)).toBe(200);
  const drafted = await call<Body>(api.app, "POST", `/api/v1/transformations/${t}/charter`, {
    session: tl.session,
    body: INPUTS,
  });
  expect(drafted.status, JSON.stringify(drafted.body)).toBe(201);
  const charter = await api.db
    .selectFrom("charter")
    .select("id")
    .where("transformation_id", "=", t)
    .executeTakeFirstOrThrow();
  const c2 = await step(tl.session, instanceId, "draft_charter", c1.body.version, { outputRecordId: charter.id });
  expect(c2.status, JSON.stringify(c2.body)).toBe(200);
  expect(c2.body.currentStepKeys).toEqual(["confirm_sponsor"]);
  return c2.body;
}

async function decideAsSponsor(sponsor: { session: Session }, approvalId: string): Promise<void> {
  const a = (await call<Body>(api.app, "GET", `/api/v1/approvals/${approvalId}`, { session: sponsor.session })).body;
  const ok = await call<Body>(api.app, "POST", `/api/v1/approvals/${a.id}/decisions`, {
    session: sponsor.session,
    headers: ifm(a.version),
    body: { outcome: "approve", rationale: "Synthetic demo approval.", subjectVersion: a.subjectVersion },
  });
  expect(ok.status, JSON.stringify(ok.body)).toBe(200);
}

describe("Rule A through the API: the intake adopts its transformation", () => {
  it("capture_intake adopts T on every step not started, with one audit event each; the instance stays organization-scope", async () => {
    const id = await launchIntake();
    const t = await newTransformation("Synthetic intake A");
    const before = await stepRows(id);
    expect(before.map((s) => [s.step_key, s.status, s.transformation_id])).toEqual([
      ["capture_intake", "active", null],
      ["draft_charter", "pending", null],
      ["confirm_sponsor", "pending", null],
    ]);
    // Refused completions adopt nothing: no output (422), and a person without the step's role (403).
    expect((await step(tl.session, id, "capture_intake", 1)).status).toBe(422);
    const outsider = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, outsider.id, "KDS", { type: "organization", id: w.orgA.id }, w.orgA.id);
    const denied = await step(await signIn(api.app, outsider.subject), id, "capture_intake", 1, { outputRecordId: t });
    expect([denied.status, denied.body.code]).toEqual([403, "procedure_step.not_assignee"]);
    expect((await stepRows(id)).map((s) => s.transformation_id)).toEqual([null, null, null]);

    const c1 = await step(tl.session, id, "capture_intake", 1, { outputRecordId: t });
    expect(c1.status, JSON.stringify(c1.body)).toBe(200);
    expect(c1.body.transformationId).toBeNull();
    const after = await stepRows(id);
    expect(after.map((s) => [s.step_key, s.status, s.transformation_id])).toEqual([
      ["capture_intake", "completed", null],
      ["draft_charter", "active", t],
      ["confirm_sponsor", "pending", t],
    ]);
    const instance = await api.db
      .selectFrom("procedure_instance")
      .select("transformation_id")
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    expect(instance.transformation_id).toBeNull();
    // One adoption audit event per adopted step, recording NULL -> T and the version step.
    for (const s of after.slice(1)) {
      const events = await api.db
        .selectFrom("audit_event")
        .select(["action", "transformation_id", "prior_version", "new_version", "changes", "actor_user_id"])
        .where("record_id", "=", s.id)
        .where("action", "=", "procedure_step_instance.adopt_transformation")
        .execute();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ transformation_id: t, prior_version: 1, new_version: 2, actor_user_id: tl.id });
      expect(events[0]!.changes).toEqual({ transformation_id: { from: null, to: t } });
    }
  });

  it("with a Sponsor assigned and mapped on T, confirm_sponsor requests its approval on T; the Sponsor decides; the instance completes", async () => {
    const id = await launchIntake();
    const t = await newTransformation("Synthetic intake B");
    const c1 = await step(tl.session, id, "capture_intake", 1, { outputRecordId: t });
    expect(c1.status, JSON.stringify(c1.body)).toBe(200);
    // T's Sponsor is assigned and mapped BEFORE confirm_sponsor activates (after the capture step created T).
    const sponsor = await staffSponsor(t);
    const drafted = await call<Body>(api.app, "POST", `/api/v1/transformations/${t}/charter`, {
      session: tl.session,
      body: INPUTS,
    });
    expect(drafted.status, JSON.stringify(drafted.body)).toBe(201);
    const charter = await api.db
      .selectFrom("charter")
      .select("id")
      .where("transformation_id", "=", t)
      .executeTakeFirstOrThrow();
    const c2 = await step(tl.session, id, "draft_charter", c1.body.version, { outputRecordId: charter.id });
    expect(c2.status, JSON.stringify(c2.body)).toBe(200);
    const s = c2.body.steps.find((x: Body) => x.stepKey === "confirm_sponsor");
    expect([s.status, typeof s.approvalId]).toEqual(["active", "string"]);
    expect([c2.body.nextAction.kind, c2.body.nextAction.messageKey]).toEqual([
      "await_approval",
      "procedures.next_action.await_approval",
    ]);
    const approval = await api.db
      .selectFrom("approval")
      .select([
        "transformation_id",
        "approval_type",
        "assignee_party_code",
        "assignee_user_id",
        "requested_by",
        "status",
      ])
      .where("id", "=", s.approvalId)
      .executeTakeFirstOrThrow();
    expect(approval).toEqual({
      transformation_id: t,
      approval_type: "procedure_step",
      assignee_party_code: "SP",
      assignee_user_id: sponsor.id,
      requested_by: tl.id,
      status: "pending",
    });
    // Separation of duties holds: the requester (TL) cannot decide it.
    const a = (await call<Body>(api.app, "GET", `/api/v1/approvals/${s.approvalId}`, { session: sponsor.session }))
      .body;
    const self = await call<Body>(api.app, "POST", `/api/v1/approvals/${a.id}/decisions`, {
      session: tl.session,
      headers: ifm(a.version),
      body: { outcome: "approve", rationale: "Synthetic.", subjectVersion: a.subjectVersion },
    });
    expect(self.status).toBeGreaterThanOrEqual(403);
    expect((await get(id)).status).toBe("active");

    await decideAsSponsor(sponsor, s.approvalId);
    const done = await get(id);
    expect([done.status, done.transformationId]).toEqual(["completed", null]);
    expect(
      done.links.filter((l: Body) => l.linkKind === "output").map((l: Body) => [l.stepKey, l.recordType, l.recordId]),
    ).toEqual([
      ["capture_intake", "transformation", t],
      ["draft_charter", "charter", charter.id],
      ["confirm_sponsor", "approval", s.approvalId],
    ]);
  });

  it("without a mapped Sponsor, confirm_sponsor waits truthfully unrouted; once T's Sponsor is mapped the next action requests it", async () => {
    const id = await launchIntake();
    const t = await newTransformation("Synthetic intake C");
    const c2 = await captureAndDraft(id, t);
    const s = c2.steps.find((x: Body) => x.stepKey === "confirm_sponsor");
    expect([s.status, s.approvalId]).toEqual(["active", null]);
    expect([c2.status, c2.nextAction.kind, c2.nextAction.messageKey]).toEqual([
      "active",
      "await_approval",
      "procedures.next_action.await_approval_unrouted",
    ]);
    expect(
      await api.db
        .selectFrom("approval")
        .select("id")
        .where("subject_id", "=", (await stepRows(id))[2]!.id)
        .execute(),
    ).toEqual([]);
    // Still unmapped: an inputs update succeeds and the step keeps waiting (the DG4 refusal wrote nothing).
    const u1 = await call<Body>(api.app, "PATCH", `${I}/${id}/inputs`, {
      session: tl.session,
      headers: ifm(c2.version),
      body: { inputValues: { caseForChange: "Synthetic case for change, revised." } },
    });
    expect(u1.status, JSON.stringify(u1.body)).toBe(200);
    expect(u1.body.nextAction.messageKey).toBe("procedures.next_action.await_approval_unrouted");
    // T's Sponsor is assigned and mapped; the next action routes the approval to them on T.
    const sponsor = await staffSponsor(t);
    const u2 = await call<Body>(api.app, "PATCH", `${I}/${id}/inputs`, {
      session: tl.session,
      headers: ifm(u1.body.version),
      body: { inputValues: { caseForChange: "Synthetic case for change." } },
    });
    expect(u2.status, JSON.stringify(u2.body)).toBe(200);
    const routed = u2.body.steps.find((x: Body) => x.stepKey === "confirm_sponsor");
    expect(typeof routed.approvalId).toBe("string");
    expect(u2.body.nextAction.messageKey).toBe("procedures.next_action.await_approval");
    await decideAsSponsor(sponsor, routed.approvalId);
    expect((await get(id)).status).toBe("completed");
  });
});

// ------------------------------------------------------------------------------------------------ the database

const ROLLBACK = new Error("rollback (test scenario)");

/** Runs `fn` in an owner transaction that is always rolled back; returns its result or the constraint it hit. */
async function inRolledBack(fn: (tx: Tx) => Promise<void>): Promise<string> {
  const owner: Db = createDb(api.owner);
  let outcome = "ok";
  await owner
    .transaction()
    .execute(async (tx) => {
      try {
        await fn(tx);
      } catch (err) {
        outcome = (err as { constraint?: string }).constraint ?? String(err);
      }
      throw ROLLBACK;
    })
    .catch((err: unknown) => {
      if (err !== ROLLBACK) throw err;
    });
  return outcome;
}

interface Scenario {
  readonly instanceId: string;
  readonly capture: string;
  readonly draft: string;
  readonly confirm: string;
}

/**
 * Inside `tx` (rolled back): an organization-scope instance of a published definition copied from the seeded intake
 * under `code`, its capture step activated, linked to T (`linkTo`, or nothing) and completed, as completeStep does,
 * WITHOUT the adoption. The pending steps then still carry no transformation.
 */
async function scenario(tx: Tx, code: string, linkTo: string | null): Promise<Scenario> {
  const by = tl.id;
  const versionId = uuidv7();
  await tx
    .insertInto("methodology_version")
    .values({
      id: versionId,
      key: `test-intake-${versionId.slice(-12)}`,
      version_no: 1,
      status: "published",
      title_en: "Synthetic intake copy",
      title_ar: "نسخة تجريبية",
      source_document: "synthetic test fixture",
      source_sha256: null,
      definition: JSON.stringify({ schema: "mth.test/1", fixture: true }),
      content_sha256: "0".repeat(64),
      published_at: new Date(),
      config_kind: "procedure",
      origin: "seed",
    })
    .execute();
  const src = await tx
    .selectFrom("procedure_definition")
    .selectAll()
    .where("methodology_version_id", "=", SEEDED_PROCEDURES_VERSION_ID)
    .where("code", "=", "new_transformation_intake")
    .executeTakeFirstOrThrow();
  const defId = uuidv7();
  const { id: _i, methodology_version_id: _m, version: _v, created_at: _c, updated_at: _u, ...rest } = src;
  await tx
    .insertInto("procedure_definition")
    .values({
      ...rest,
      id: defId,
      code,
      methodology_version_id: versionId,
      input_schema: JSON.stringify(src.input_schema),
    })
    .execute();
  const sds = await tx
    .selectFrom("procedure_step_definition")
    .selectAll()
    .where("procedure_definition_id", "=", src.id)
    .orderBy("ordinal")
    .execute();
  const instanceId = uuidv7();
  await tx
    .insertInto("procedure_instance")
    .values({
      id: instanceId,
      organization_id: w.orgA.id,
      transformation_id: null,
      procedure_definition_id: defId,
      methodology_version_id: versionId,
      procedure_code: code,
      input_values: JSON.stringify(INPUTS),
      launched_by: by,
      created_by: by,
      updated_by: by,
    })
    .execute();
  const ids = new Map<string, string>();
  for (const s of sds) {
    const sdId = uuidv7();
    const { id: _s, procedure_definition_id: _p, version: _sv, created_at: _sc, updated_at: _su, ...srest } = s;
    await tx
      .insertInto("procedure_step_definition")
      .values({
        ...srest,
        id: sdId,
        procedure_definition_id: defId,
        condition_value: s.condition_value === null ? null : JSON.stringify(s.condition_value),
      })
      .execute();
    const stepId = uuidv7();
    ids.set(s.step_key, stepId);
    await tx
      .insertInto("procedure_step_instance")
      .values({
        id: stepId,
        organization_id: w.orgA.id,
        transformation_id: null,
        procedure_instance_id: instanceId,
        step_definition_id: sdId,
        step_key: s.step_key,
        ordinal: s.ordinal,
        assignee_role_code: s.responsible_role_code,
        created_by: by,
        updated_by: by,
      })
      .execute();
  }
  const capture = ids.get("capture_intake")!;
  await sql`UPDATE procedure_step_instance SET status = 'active', activated_at = now(), version = version + 1
             WHERE id = ${capture}::uuid`.execute(tx);
  if (linkTo !== null)
    await tx
      .insertInto("procedure_instance_link")
      .values({
        id: uuidv7(),
        organization_id: w.orgA.id,
        transformation_id: null,
        procedure_instance_id: instanceId,
        step_instance_id: capture,
        link_kind: "output",
        record_type: "transformation",
        record_id: linkTo,
        created_by: by,
      })
      .execute();
  await sql`UPDATE procedure_step_instance SET status = 'completed', completed_at = now(), completed_by = ${by}::uuid,
             version = version + 1 WHERE id = ${capture}::uuid`.execute(tx);
  return { instanceId, capture, draft: ids.get("draft_charter")!, confirm: ids.get("confirm_sponsor")! };
}

const adopt = (tx: Tx, stepId: string, t: string, extra = sql``) =>
  sql`UPDATE procedure_step_instance SET transformation_id = ${t}::uuid, version = version + 1 ${extra}
       WHERE id = ${stepId}::uuid`.execute(tx);

describe("Rule A at the database (0096): every other transformation_id change is refused", () => {
  let t: string;
  let t2: string;
  beforeAll(async () => {
    t = await newTransformation("Synthetic intake D");
    t2 = await newTransformation("Synthetic intake E");
  });

  it("allows exactly the adoption: a pending step of the intake, NULL -> the transformation its capture step linked", async () => {
    expect(
      await inRolledBack(async (tx) => {
        const s = await scenario(tx, "new_transformation_intake", t);
        await adopt(tx, s.draft, t);
        await adopt(tx, s.confirm, t);
      }),
    ).toBe("ok");
  });

  it("refuses a direct UPDATE before the capture step linked a transformation", async () => {
    expect(
      await inRolledBack(async (tx) => {
        const s = await scenario(tx, "new_transformation_intake", null);
        await adopt(tx, s.draft, t);
      }),
    ).toBe(IMMUTABLE);
  });

  it("refuses a different transformation than the one the capture step linked", async () => {
    expect(
      await inRolledBack(async (tx) => {
        const s = await scenario(tx, "new_transformation_intake", t);
        await adopt(tx, s.draft, t2);
      }),
    ).toBe(IMMUTABLE);
  });

  it("refuses a second adoption (T -> T2, or T -> NULL)", async () => {
    for (const to of ["t2", "null"] as const)
      expect(
        await inRolledBack(async (tx) => {
          const s = await scenario(tx, "new_transformation_intake", t);
          await adopt(tx, s.draft, t);
          if (to === "t2") await adopt(tx, s.draft, t2);
          else
            await sql`UPDATE procedure_step_instance SET transformation_id = NULL, version = version + 1
                       WHERE id = ${s.draft}::uuid`.execute(tx);
        }),
        to,
      ).toBe(IMMUTABLE);
  });

  it("refuses a started step (the completed capture step; an active step)", async () => {
    // A closed step is refused first by the 0069 guard (a closed step never changes), which fires before the row guard.
    expect(
      await inRolledBack(async (tx) => {
        const s = await scenario(tx, "new_transformation_intake", t);
        await adopt(tx, s.capture, t);
      }),
    ).toBe("procedure_step_instance_status_transition");
    expect(
      await inRolledBack(async (tx) => {
        const s = await scenario(tx, "new_transformation_intake", t);
        await sql`UPDATE procedure_step_instance SET status = 'active', activated_at = now(), version = version + 1
                   WHERE id = ${s.draft}::uuid`.execute(tx);
        await adopt(tx, s.draft, t);
      }),
    ).toBe(IMMUTABLE);
  });

  it("refuses an adoption that also changes another column, or starts the step at the same time", async () => {
    expect(
      await inRolledBack(async (tx) => {
        const s = await scenario(tx, "new_transformation_intake", t);
        await adopt(tx, s.draft, t, sql`, assignee_user_id = ${tl.id}::uuid`);
      }),
    ).toBe(IMMUTABLE);
    expect(
      await inRolledBack(async (tx) => {
        const s = await scenario(tx, "new_transformation_intake", t);
        await adopt(tx, s.draft, t, sql`, status = 'active', activated_at = now()`);
      }),
    ).toBe(IMMUTABLE);
  });

  it("refuses a non-intake organization-scope instance with the same shape", async () => {
    expect(
      await inRolledBack(async (tx) => {
        const s = await scenario(tx, "synthetic_org_procedure", t);
        await adopt(tx, s.draft, t);
      }),
    ).toBe(IMMUTABLE);
  });

  it("refuses, as the runtime role, a direct UPDATE of committed rows (adopted steps, capture step) after the API flow", async () => {
    const id = await launchIntake();
    const produced = await newTransformation("Synthetic intake F"); // created since the launch (the create adapter)
    const c1 = await step(tl.session, id, "capture_intake", 1, { outputRecordId: produced });
    expect(c1.status, JSON.stringify(c1.body)).toBe(200);
    const rows = await stepRows(id);
    const attempt = (stepId: string, to: string | null) =>
      sql`UPDATE procedure_step_instance SET transformation_id = ${to}::uuid, version = version + 1
           WHERE id = ${stepId}::uuid`
        .execute(api.db)
        .then(() => "ok")
        .catch((e: unknown) => (e as { constraint?: string }).constraint);
    // A second adoption of the pending confirm_sponsor (to another transformation, or back to NULL); the active
    // draft_charter; the completed capture step (refused first by the 0069 closed-step guard).
    expect(await attempt(rows[2]!.id, t2)).toBe(IMMUTABLE);
    expect(await attempt(rows[2]!.id, null)).toBe(IMMUTABLE);
    expect(await attempt(rows[1]!.id, t2)).toBe(IMMUTABLE);
    expect(await attempt(rows[0]!.id, produced)).toBe("procedure_step_instance_status_transition");
    expect((await stepRows(id)).map((s) => s.transformation_id)).toEqual([null, produced, produced]);
  });

  it("refuses any transformation_id change in a transformation-scope instance (a seeded non-intake procedure)", async () => {
    const office = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, office.id, "TO", { type: "transformation", id: t2 }, w.orgA.id);
    const launched = await call<Body>(api.app, "POST", I, {
      session: await signIn(api.app, office.subject),
      body: { procedureCode: "baseline_validation", transformationId: t2 },
    });
    expect(launched.status, JSON.stringify(launched.body)).toBe(201);
    const rows = await stepRows(launched.body.id);
    const pending = rows.find((r) => r.status === "pending") ?? rows[0]!;
    for (const to of [t, null]) {
      const err = await sql`UPDATE procedure_step_instance SET transformation_id = ${to}::uuid, version = version + 1
                             WHERE id = ${pending.id}::uuid`
        .execute(api.db)
        .then(() => "ok")
        .catch((e: unknown) => (e as { constraint?: string }).constraint);
      expect(err, String(to)).toBe(IMMUTABLE);
    }
  });
});
