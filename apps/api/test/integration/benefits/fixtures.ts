// Fixtures for the slice B benefits integration tests and contract exercises (kpi-benefits-engineer, T-DG4-KBE-D;
// reusable by KBE-D2 and KBE-E). All data is SYNTHETIC. A transformation in org A / BU a1 with one user per slice B role
// granted at TRANSFORMATION scope (TL, BO, a second BO, FIN), plus the org-level auditor (AUD) and the technical
// administrator (ADM_ACCESS + ADM_TECH, no business permission) of seedWorld. Initiatives and deliverables are written
// directly with their audit event, as the P2 audit guard demands (their routes belong to other modules); every other
// record goes through the API. Nothing here grants a real business or Finance approval, and nothing touches DG0-DG7.
import { insertAuditEvent, type Db } from "@mth/db";
import { expect } from "vitest";
import { v7 as uuidv7 } from "uuid";
import {
  call,
  createTransformationRow,
  createUser,
  grant,
  signIn,
  type RequestOptions,
  type Res,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";

export type BenefitActor = "tl" | "bo" | "bo2" | "fin" | "auditor" | "admin" | "outsider";

export interface BenefitWorld {
  readonly transformationId: string;
  readonly organizationId: string;
  readonly base: string;
  readonly users: Readonly<Record<BenefitActor, { id: string; subject: string }>>;
  readonly s: Readonly<Record<BenefitActor, Session>>;
  /** An agreed KPI (for non-financial benefits) and a T09 formula, both created through the API. */
  readonly kpiDefinitionId: string;
  readonly benefitFormulaId: string;
}

export type Caller = (method: string, url: string, opts?: RequestOptions) => Promise<Res>;

export async function seedBenefitWorld(api: TestApi, w: World, send?: Caller): Promise<BenefitWorld> {
  const req: Caller = send ?? ((m, u, o) => call(api.app, m, u, o));
  const transformationId = await createTransformationRow(api.db, w.orgA.id, w.a1, w.office.id);
  const scope = { type: "transformation" as const, id: transformationId };
  const mk = async (...roles: string[]) => {
    const u = await createUser(api.db, w.orgA.id);
    for (const role of roles) await grant(api.db, w.grantor.id, u.id, role, scope, w.orgA.id);
    return u;
  };
  const users = {
    tl: await mk("TL"),
    bo: await mk("BO"),
    bo2: await mk("BO"),
    fin: await mk("FIN"),
    auditor: w.auditor,
    admin: w.admin,
    outsider: w.officeB,
  };
  const s = Object.fromEntries(
    await Promise.all(Object.entries(users).map(async ([k, u]) => [k, await signIn(api.app, u.subject)] as const)),
  ) as Record<BenefitActor, Session>;
  const base = `/api/v1/transformations/${transformationId}`;
  const kpi = await req("POST", `${base}/kpi-definitions`, {
    session: s.tl,
    body: { name: "Synthetic NPS (CX)", unitKind: "score", polarity: "higher_is_better" },
  });
  expect(kpi.status, JSON.stringify(kpi.body)).toBe(201);
  const formula = await req("POST", "/api/v1/benefit-formulas", {
    session: s.tl,
    body: { transformationId, benefitName: "Synthetic churn reduction formula" },
  });
  expect(formula.status, JSON.stringify(formula.body)).toBe(201);
  return {
    transformationId,
    organizationId: w.orgA.id,
    base,
    users,
    s,
    kpiDefinitionId: (kpi.body as { id: string }).id,
    benefitFormulaId: (formula.body as { id: string }).id,
  };
}

let initiativeSeq = 10;

/** An initiative written directly (with its audit event); `completed` sets the launch stamps the CHECK needs. */
export async function insertInitiative(
  db: Db,
  b: BenefitWorld,
  opts: { status?: "draft" | "completed" } = {},
): Promise<string> {
  const id = uuidv7();
  const by = b.users.tl.id;
  initiativeSeq += 1;
  await db.transaction().execute(async (tx) => {
    await tx
      .insertInto("initiative")
      .values({
        id,
        organization_id: b.organizationId,
        transformation_id: b.transformationId,
        code: `INI-${String(initiativeSeq).padStart(4, "0")}`,
        name: `Synthetic initiative ${initiativeSeq}`,
        ...(opts.status === "completed" ? { status: "completed", launched_at: new Date(), launched_by: by } : {}),
        created_by: by,
        updated_by: by,
      })
      .execute();
    await insertAuditEvent(
      tx,
      { actorType: "user", actorUserId: by, requestId: `fixture-${id}`, source: "api" },
      {
        action: "initiative.create",
        recordType: "initiative",
        recordId: id,
        organizationId: b.organizationId,
        transformationId: b.transformationId,
        newVersion: 1,
      },
    );
  });
  return id;
}

/** A pending deliverable of an initiative (direct write with its audit event). */
export async function insertDeliverable(db: Db, b: BenefitWorld, initiativeId: string): Promise<string> {
  const id = uuidv7();
  const by = b.users.tl.id;
  await db.transaction().execute(async (tx) => {
    await tx
      .insertInto("deliverable")
      .values({
        id,
        organization_id: b.organizationId,
        transformation_id: b.transformationId,
        initiative_id: initiativeId,
        title: "Synthetic enabling deliverable",
        created_by: by,
        updated_by: by,
      })
      .execute();
    await insertAuditEvent(
      tx,
      { actorType: "user", actorUserId: by, requestId: `fixture-${id}`, source: "api" },
      {
        action: "deliverable.create",
        recordType: "deliverable",
        recordId: id,
        organizationId: b.organizationId,
        transformationId: b.transformationId,
        newVersion: 1,
      },
    );
  });
  return id;
}

/** Marks a deliverable accepted (submitted by TL, accepted by BO; version 1 -> 2, audited). Synthetic acceptance. */
export async function acceptDeliverable(db: Db, b: BenefitWorld, deliverableId: string): Promise<void> {
  await db.transaction().execute(async (tx) => {
    await tx
      .updateTable("deliverable")
      .set({
        acceptance_status: "accepted",
        submitted_by: b.users.tl.id,
        submitted_at: new Date(),
        decided_by: b.users.bo.id,
        decided_at: new Date(),
        version: 2,
        updated_by: b.users.bo.id,
        updated_at: new Date(),
      })
      .where("id", "=", deliverableId)
      .execute();
    await insertAuditEvent(
      tx,
      { actorType: "user", actorUserId: b.users.bo.id, requestId: `fixture-accept-${deliverableId}`, source: "api" },
      {
        action: "deliverable.accept",
        recordType: "deliverable",
        recordId: deliverableId,
        organizationId: b.organizationId,
        transformationId: b.transformationId,
        priorVersion: 1,
        newVersion: 2,
      },
    );
  });
}

/** A minimal valid financial benefit body (Identify; synthetic). */
export function financialBody(b: BenefitWorld, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: "Synthetic churn reduction",
    description: "Lower churn on the synthetic prepaid base.",
    benefitType: "revenue",
    valueClass: "revenue_uplift",
    ownerUserId: b.users.bo.id,
    currency: "SAR",
    financialStatementLine: "Revenue - prepaid",
    ...extra,
  };
}

/** A minimal valid non-financial (CX) benefit body: Value (SAR) n/a, an agreed KPI. */
export function cxBody(b: BenefitWorld, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: "Synthetic NPS uplift",
    description: "Better customer experience on the synthetic care journey.",
    benefitType: "cx",
    valueClass: "non_financial",
    ownerUserId: b.users.bo.id,
    currency: "SAR",
    measurementKpiDefinitionId: b.kpiDefinitionId,
    ...extra,
  };
}

/** The Plan outputs of a financial benefit (baseline, formula, target). */
export function planOutputs(b: BenefitWorld): Record<string, unknown> {
  return {
    baselineValue: "1000000",
    baselineUnit: "SAR",
    targetValue: "1200000",
    benefitFormulaId: b.benefitFormulaId,
  };
}

/** A fresh user with `role` at the world's transformation (for tests that revoke grants or end sessions). */
export async function extraUser(
  api: TestApi,
  w: World,
  b: BenefitWorld,
  role: string,
): Promise<{ id: string; subject: string; session: Session }> {
  const u = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, u.id, role, { type: "transformation", id: b.transformationId }, w.orgA.id);
  return { ...u, session: await signIn(api.app, u.subject) };
}

/**
 * A SUBMITTED (pending Finance) measurement written directly with its audit event: the measurement routes belong to
 * KBE-E, and the register only reads the value series. The benefit must be at Measure or later (database guard).
 */
export async function insertSubmittedMeasurement(
  db: Db,
  b: BenefitWorld,
  benefitId: string,
  amount: string | null,
  opts: { kpiValue?: string; periodStart?: string; periodEnd?: string } = {},
): Promise<string> {
  const id = uuidv7();
  const by = b.users.bo.id;
  await db.transaction().execute(async (tx) => {
    const no = await tx
      .selectFrom("benefit_measurement")
      .select((eb) => eb.fn.countAll<string>().as("n"))
      .where("benefit_id", "=", benefitId)
      .executeTakeFirstOrThrow();
    await tx
      .insertInto("benefit_measurement")
      .values({
        id,
        organization_id: b.organizationId,
        transformation_id: b.transformationId,
        benefit_id: benefitId,
        measurement_no: Number(no.n) + 1,
        source: "manual",
        period_start: opts.periodStart ?? "2026-09-01",
        period_end: opts.periodEnd ?? "2026-09-30",
        amount,
        kpi_value: opts.kpiValue ?? null,
        currency: "SAR",
        status: "submitted",
        submitted_by: by,
        submitted_at: new Date(),
        created_by: by,
        updated_by: by,
      })
      .execute();
    await insertAuditEvent(
      tx,
      { actorType: "user", actorUserId: by, requestId: `fixture-${id}`, source: "api" },
      {
        action: "benefit_measurement.submit",
        recordType: "benefit_measurement",
        recordId: id,
        organizationId: b.organizationId,
        transformationId: b.transformationId,
        newVersion: 1,
      },
    );
  });
  return id;
}

/**
 * Marks a benefit's baseline as validated by the world's FIN user (version + 1, audited). A synthetic stand-in for the
 * Finance baseline decision (KBE-E's decideBenefitBaseline); it approves nothing real.
 */
export async function markBaselineValidated(db: Db, b: BenefitWorld, benefitId: string): Promise<number> {
  return db.transaction().execute(async (tx) => {
    const cur = await tx.selectFrom("benefit").select("version").where("id", "=", benefitId).executeTakeFirstOrThrow();
    await tx
      .updateTable("benefit")
      .set({
        baseline_validation_status: "validated",
        baseline_validated_by: b.users.fin.id,
        baseline_validated_at: new Date(),
        version: cur.version + 1,
        updated_by: b.users.fin.id,
        updated_at: new Date(),
      })
      .where("id", "=", benefitId)
      .execute();
    await insertAuditEvent(
      tx,
      { actorType: "user", actorUserId: b.users.fin.id, requestId: `fixture-baseline-${benefitId}`, source: "api" },
      {
        action: "benefit.baseline_decided",
        recordType: "benefit",
        recordId: benefitId,
        organizationId: b.organizationId,
        transformationId: b.transformationId,
        priorVersion: cur.version,
        newVersion: cur.version + 1,
      },
    );
    return cur.version + 1;
  });
}

/** Creates a benefit through the API and moves it to `step` (identify … measure) with its Plan outputs and an enabler. */
export async function benefitAt(
  api: TestApi,
  b: BenefitWorld,
  step: "identify" | "plan" | "enable" | "measure",
  body: Record<string, unknown> = financialBody(b, planOutputs(b)),
): Promise<{ id: string; version: number; code: string }> {
  const send: Caller = (m, u, o) => call(api.app, m, u, o);
  const created = await send("POST", `${b.base}/benefits`, { session: b.s.bo, body });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const c = created.body as { id: string; version: number; code: string };
  let version = c.version;
  const L = `${b.base}/benefits/${c.id}/lifecycle`;
  const order = ["plan", "enable", "measure"] as const;
  for (const toStep of order.slice(0, ["identify", "plan", "enable", "measure"].indexOf(step))) {
    if (toStep === "measure") {
      const ini = await insertInitiative(api.db, b);
      const e = await send("POST", `${b.base}/benefits/${c.id}/enablers`, {
        session: b.s.bo,
        body: { initiativeId: ini },
      });
      expect(e.status, JSON.stringify(e.body)).toBe(201);
    }
    const r = await send("POST", L, { session: b.s.bo, headers: { "if-match": `"${version}"` }, body: { toStep } });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    version = (r.body as { version: number }).version;
  }
  return { id: c.id, version, code: c.code };
}
