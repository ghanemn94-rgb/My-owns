// Test support of T-DG5-BE-I (p5-work-split §D.3): live admin automation rules for the failure-queue tests and the
// contract exercises. Every person and value is SYNTHETIC; a rule review is a configuration review, never a business
// approval, and no rule decides anything.
import { insertAuditEvent, sql, type Db } from "@mth/db";
import { expect } from "vitest";
import { call, createUser, grant, signIn, uniq, type Session, type TestApi, type World } from "./harness.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const R = "/api/v1/admin/automation-rules";
const ifm = (v: number) => ({ "if-match": `"${v}"` });

export interface RuleAuthor {
  readonly session: Session;
  readonly userId: string;
}

/** A synthetic ADM_METHOD of organization A (configures and repairs rules). */
export async function ruleAuthor(api: TestApi, w: World): Promise<RuleAuthor> {
  const u = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, u.id, "ADM_METHOD", { type: "organization", id: w.orgA.id }, w.orgA.id);
  return { session: await signIn(api.app, u.subject), userId: u.id };
}

export const gateDecidedPayload = (transformationId: string, gateCode = "G3") => ({
  gateInstanceId: crypto.randomUUID(),
  transformationId,
  gateCode,
  submissionId: crypto.randomUUID(),
  submissionNo: 1,
  gateDecisionId: crypto.randomUUID(),
  outcome: "approved",
  decidedBy: crypto.randomUUID(),
  nextPhase: null,
  scaleScopeItemIds: [],
  conditionIds: [],
});

export const gateDecidedEnvelope = (organizationId: string, payload: Record<string, unknown>) => ({
  outboxEventId: crypto.randomUUID(),
  eventType: "gate.decided",
  schemaVersion: 1,
  idempotencyKey: `gate.decided:${crypto.randomUUID()}`,
  organizationId,
  payload,
});

export interface LiveRule {
  readonly id: string;
  readonly code: string;
  readonly versionId: string;
}

/**
 * Creates an admin rule through the API, dry-runs it, has the TO review it, publishes and enables it. `plant`, when
 * given, rewrites the DRAFT's actions directly in the database after its passing dry run, keeping its content hash:
 * the API would refuse such content at the dry run (the planner reports `forbidden`), so this is how a test puts a
 * rule that the engine itself must refuse into service (REQ-S12-003's "a rule configured to create records in a
 * transformation outside its scope").
 */
export async function liveRule(
  api: TestApi,
  w: World,
  author: RuleAuthor,
  opts: {
    readonly content: Record<string, unknown>;
    readonly sampleTransformationId: string;
    readonly scopeLevel?: "organization" | "transformation";
    readonly transformationId?: string;
    readonly plant?: readonly Record<string, unknown>[];
  },
): Promise<LiveRule> {
  const office = await signIn(api.app, w.office.subject);
  const code = `failq.${uniq("f").toLowerCase()}`;
  const created = await call<Body>(api.app, "POST", R, {
    session: author.session,
    body: {
      code,
      nameEn: "Synthetic failure-queue rule",
      nameAr: "قاعدة تجريبية لقائمة الإخفاقات",
      scopeLevel: opts.scopeLevel ?? "organization",
      organizationId: w.orgA.id,
      ...(opts.transformationId !== undefined ? { transformationId: opts.transformationId } : {}),
      ownerUserId: author.userId,
      content: opts.content,
    },
  });
  expect(created.status).toBe(201);
  const id = created.body.id as string;
  const v1 = `${R}/${id}/versions/1`;
  const run = await call<Body>(api.app, "POST", `${v1}/dry-runs`, {
    session: author.session,
    body: { triggerCode: "gate.decided", payload: gateDecidedPayload(opts.sampleTransformationId) },
  });
  expect([run.status, run.body.outcome]).toEqual([201, "pass"]);
  let draftVersion = 1;
  if (opts.plant !== undefined) {
    await plantActions(api.db, id, opts.plant);
    draftVersion = 2;
  }
  expect(
    (await call(api.app, "POST", `${v1}/submit`, { session: author.session, headers: ifm(draftVersion) })).status,
  ).toBe(200);
  expect(
    (
      await call(api.app, "POST", `${v1}/review`, {
        session: office,
        headers: ifm(draftVersion + 1),
        body: { outcome: "approve", note: "Synthetic configuration review." },
      })
    ).status,
  ).toBe(200);
  const pub = await call<Body>(api.app, "POST", `${v1}/publish`, { session: author.session, headers: ifm(1) });
  expect(pub.status).toBe(200);
  expect((await call(api.app, "POST", `${R}/${id}/enable`, { session: author.session, headers: ifm(2) })).status).toBe(
    200,
  );
  return { id, code, versionId: pub.body.id as string };
}

/** See `liveRule`: the draft's actions replaced in the database (hash kept), with its audit event. */
async function plantActions(db: Db, ruleId: string, actions: readonly Record<string, unknown>[]): Promise<void> {
  await db.transaction().execute(async (tx) => {
    const v = await tx
      .selectFrom("automation_rule_version")
      .select(["id", "version"])
      .where("automation_rule_id", "=", ruleId)
      .where("version_no", "=", 1)
      .executeTakeFirstOrThrow();
    const updated = await tx
      .updateTable("automation_rule_version")
      .set({ actions: JSON.stringify(actions), version: v.version + 1, updated_at: sql<Date>`now()` })
      .where("id", "=", v.id)
      .returning("version")
      .executeTakeFirstOrThrow();
    await insertAuditEvent(
      tx,
      { actorType: "system", actorUserId: null, source: "migration", requestId: "test:plant" },
      {
        action: "automation_rule_version.update",
        recordType: "automation_rule_version",
        recordId: v.id,
        organizationId: null,
        priorVersion: v.version,
        newVersion: updated.version,
        changes: { actions: { from: null, to: "synthetic out-of-scope target (test plant)" } },
      },
    );
  });
}
