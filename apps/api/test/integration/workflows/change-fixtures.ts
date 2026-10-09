// Fixtures of the slice H change-control tests and contract exercises (T-DG4-BE-L; ADR-0036). All data is SYNTHETIC.
// The world is the slice C approval world (TL lead, SP sponsor, TO office, WL contributor, AUD auditor, two BOs and a
// FIN user; the four T11 rows; a default calendar; BO and SP mapped to named people) plus a KDS user and FIN mapped to
// its person. Approved subjects are written through the API where a route exists (KPI definitions and versions, benefit
// formulas, budget lines) and directly with their audit event where the route belongs to another stage (initiatives at
// `selected`, milestones with an approved date, outcomes). `approveGate` stages an approved product gate WITH a real
// gate_decision row and a fixture snapshot (the state the gate engine writes), so an impact item can name the preserved
// decision. Every decision here is a demo BUSINESS decision on synthetic data; it approves nothing real and nothing
// touches the engineering gates DG0-DG7.
import { createHash } from "node:crypto";
import { insertAuditEvent, sql, type Db, type Tx } from "@mth/db";
import { v7 as uuidv7 } from "uuid";
import { expect } from "vitest";
import { call, uniq, type RequestOptions, type Res, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { mapParty, person, setupApprovalWorld, type ApprovalWorld, type Person } from "../approvals/approval-world.ts";

// Responses are asserted structurally; the body type is deliberately loose (the harness P3ExerciseContext precedent).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Caller = (method: string, url: string, opts?: RequestOptions) => Promise<Res<any>>;

export const RATIONALE = "Synthetic demo decision; approves nothing real.";

export interface ChangeWorld extends ApprovalWorld {
  readonly organizationId: string;
  readonly kds: Person;
  readonly base: string;
}

export async function setupChangeWorld(api: TestApi, w: World, send?: Caller): Promise<ChangeWorld> {
  const req: Caller = send ?? ((m, u, o) => call(api.app, m, u, o));
  const p = await setupApprovalWorld(api, w, req);
  const kds = await person(api, w, p.transformationId, "KDS");
  await mapParty(req, p, "FIN", p.fin.id);
  return { ...p, organizationId: w.orgA.id, kds, base: `/api/v1/transformations/${p.transformationId}` };
}

async function audited(
  tx: Tx,
  by: string,
  c: ChangeWorld,
  action: string,
  table: string,
  id: string,
  prior: number | null,
  next: number | null,
) {
  await insertAuditEvent(
    tx,
    { actorType: "user", actorUserId: by, requestId: `fixture-${uuidv7()}`, source: "api" },
    {
      action,
      recordType: table,
      recordId: id,
      organizationId: c.organizationId,
      transformationId: c.transformationId,
      ...(prior !== null ? { priorVersion: prior } : {}),
      ...(next !== null ? { newVersion: next } : {}),
    },
  );
}

/** Inserts one transformation-scoped row with its audit event (as the lead). */
export async function insertAudited(
  db: Db,
  c: ChangeWorld,
  table: string,
  values: Record<string, unknown>,
): Promise<string> {
  const id = uuidv7();
  await db.transaction().execute(async (tx) => {
    await tx
      .insertInto(table as never)
      .values({
        id,
        organization_id: c.organizationId,
        transformation_id: c.transformationId,
        created_by: c.lead.id,
        updated_by: c.lead.id,
        ...values,
      } as never)
      .execute();
    await audited(tx, c.lead.id, c, `${table}.create`, table, id, null, 1);
  });
  return id;
}

let initiativeSeq = 7000;

/** An initiative at `selected` (an approved record for business-scope and cost changes). */
export function selectedInitiative(db: Db, c: ChangeWorld, name = "Synthetic initiative"): Promise<string> {
  return insertAudited(db, c, "initiative", {
    code: `INI-${String(++initiativeSeq).padStart(4, "0")}`,
    name,
    objective: "Synthetic objective",
    scope_in: "Synthetic prepaid base",
    status: "selected",
  });
}

/** A milestone with an approved and a forecast date (the approval stamps are synthetic). */
export function approvedMilestone(
  db: Db,
  c: ChangeWorld,
  initiativeId: string,
  approved: string,
  forecast: string | null,
) {
  return insertAudited(db, c, "milestone", {
    initiative_id: initiativeId,
    title: "Synthetic go-live",
    approved_date: approved,
    approved_by: c.lead.id,
    approved_at: new Date(),
    approval_reason: "Synthetic baseline",
    forecast_date: forecast,
  });
}

/**
 * Stages product gate `gateCode` as APPROVED with a real decision (decision + gate_decision rows, the submission
 * decided), each write with its audit event. The submission is the lead's and the decision the sponsor's (SoD), with
 * the fixture snapshot `{ schema, gateCode, fixture, ...extra }`. Returns the submission and gate-decision ids.
 */
export async function approveGate(
  db: Db,
  c: ChangeWorld,
  gateCode: string,
  extra: Record<string, unknown> = {},
): Promise<{ submissionId: string; gateDecisionId: string; snapshotSha256: string }> {
  return db.transaction().execute(async (tx) => {
    const inst = await tx
      .selectFrom("gate_instance")
      .selectAll()
      .where("transformation_id", "=", c.transformationId)
      .where("gate_code", "=", gateCode)
      .executeTakeFirstOrThrow();
    const submissionId = uuidv7();
    const no = inst.latest_submission_no + 1;
    const snapshot = JSON.stringify({ schema: "mth.gate-submission/1", gateCode, fixture: true, ...extra });
    const sha = createHash("sha256").update(snapshot).digest("hex");
    await tx
      .insertInto("gate_submission")
      .values({
        id: submissionId,
        organization_id: c.organizationId,
        transformation_id: c.transformationId,
        gate_instance_id: inst.id,
        gate_code: gateCode,
        submission_no: no,
        submitted_by: c.lead.id,
        submission_note: "Synthetic fixture submission",
        approver_role_code: inst.approver_role_code,
        approver_user_id: inst.approver_user_id,
        due_date: null,
        charter_id: null,
        charter_version_no: null,
        snapshot,
        snapshot_sha256: sha,
        created_by: c.lead.id,
        updated_by: c.lead.id,
      })
      .execute();
    await audited(tx, c.lead.id, c, "gate_submission.create", "gate_submission", submissionId, null, 1);
    const decisionId = uuidv7();
    const code = await sql<{ last_value: number }>`
      INSERT INTO record_code_counter (transformation_id, prefix, last_value) VALUES (${c.transformationId}::uuid, 'GD', 1)
      ON CONFLICT (transformation_id, prefix) DO UPDATE SET last_value = record_code_counter.last_value + 1
      RETURNING last_value`.execute(tx);
    await tx
      .insertInto("decision")
      .values({
        id: decisionId,
        organization_id: c.organizationId,
        transformation_id: c.transformationId,
        kind: "gate",
        code: `GD-${String(code.rows[0]!.last_value).padStart(2, "0")}`,
        title: `${gateCode}: submission ${no}`,
        owner_user_id: c.sponsor.id,
        status: "decided",
        outcome_text: `approved: ${RATIONALE}`,
        decided_by: c.sponsor.id,
        decided_at: new Date(),
        created_by: c.sponsor.id,
        updated_by: c.sponsor.id,
      } as never)
      .execute();
    await audited(tx, c.sponsor.id, c, "decision.create", "decision", decisionId, null, 1);
    const gateDecisionId = uuidv7();
    await tx
      .insertInto("gate_decision")
      .values({
        id: gateDecisionId,
        organization_id: c.organizationId,
        transformation_id: c.transformationId,
        gate_submission_id: submissionId,
        decision_id: decisionId,
        gate_code: gateCode,
        submission_no: no,
        outcome: "approved",
        rationale: RATIONALE,
        decided_by: c.sponsor.id,
        approver_basis: "default_role",
        approver_role_code: inst.approver_role_code,
      })
      .execute();
    await audited(tx, c.sponsor.id, c, "gate_decision.create", "gate_decision", gateDecisionId, null, null);
    await tx
      .updateTable("gate_submission")
      .set({ status: "decided", version: sql<number>`version + 1`, updated_by: c.sponsor.id })
      .where("id", "=", submissionId)
      .execute();
    await audited(tx, c.sponsor.id, c, "gate_submission.decide", "gate_submission", submissionId, 1, 2);
    await tx
      .updateTable("gate_instance")
      .set({
        status: "approved",
        current_submission_id: submissionId,
        latest_submission_no: no,
        approved_at: new Date(),
        version: sql<number>`version + 1`,
        updated_by: c.sponsor.id,
      })
      .where("id", "=", inst.id)
      .execute();
    await audited(
      tx,
      c.sponsor.id,
      c,
      "gate_instance.fixture_status",
      "gate_instance",
      inst.id,
      inst.version,
      inst.version + 1,
    );
    return { submissionId, gateDecisionId, snapshotSha256: sha };
  });
}

/** The minimal direct-accept KPI version body with a target (ADR-0027 version content). */
export const KPI_VERSION = Object.freeze({
  measureType: "higher_is_better",
  valueNature: "flow",
  aggregationRule: "sum",
  submissionRoute: "direct_accept",
  targetValue: "100",
  targetDate: "2027-12-31",
});

/** An active KPI with an active version 1 (target 100) and a draft version 2 (target 120), through the API. */
export async function kpiWithDraft(send: Caller, c: ChangeWorld) {
  const def = await send("POST", `${c.base}/kpi-definitions`, {
    session: c.lead.session,
    body: {
      name: `Synthetic churn KPI ${uniq("K")}`,
      unitKind: "count",
      unitLabel: "lines",
      polarity: "higher_is_better",
      frequency: "monthly",
    },
  });
  expect(def.status, JSON.stringify(def.body)).toBe(201);
  const act = await send("POST", `${c.base}/kpi-definitions/${def.body.id}/activate`, {
    session: c.lead.session,
    headers: ifm(def.body.version),
  });
  expect(act.status, JSON.stringify(act.body)).toBe(200);
  const v1 = await send("POST", `${c.base}/kpi-definitions/${def.body.id}/versions`, {
    session: c.kds.session,
    body: KPI_VERSION,
  });
  expect(v1.status, JSON.stringify(v1.body)).toBe(201);
  const a1 = await send("POST", `${c.base}/kpi-versions/${v1.body.id}/activate`, {
    session: c.kds.session,
    headers: ifm(v1.body.version),
  });
  expect(a1.status, JSON.stringify(a1.body)).toBe(200);
  const v2 = await send("POST", `${c.base}/kpi-definitions/${def.body.id}/versions`, {
    session: c.kds.session,
    body: { ...KPI_VERSION, targetValue: "120", changeReason: "Synthetic target uplift" },
  });
  expect(v2.status, JSON.stringify(v2.body)).toBe(201);
  const kpi = await send("GET", `${c.base}/kpi-definitions/${def.body.id}`, { session: c.lead.session });
  return { kpiId: def.body.id as string, kpiVersion: kpi.body.version as number, v1: a1.body, v2: v2.body };
}

/** An outcome linked to the KPI (direct writes with audit events). */
export async function outcomeOf(db: Db, c: ChangeWorld, kpiId: string): Promise<string> {
  const outcomeId = await insertAudited(db, c, "outcome", { statement: "Synthetic: fewer prepaid customers churn" });
  await insertAudited(db, c, "outcome_kpi", {
    outcome_id: outcomeId,
    kpi_definition_id: kpiId,
    target_date: "2027-12-31",
  });
  return outcomeId;
}

/** A non-financial benefit measured by the KPI, through the benefits API (TL). */
export async function benefitOn(send: Caller, c: ChangeWorld, kpiId: string): Promise<string> {
  const res = await send("POST", `${c.base}/benefits`, {
    session: c.lead.session,
    body: {
      title: "Synthetic NPS uplift",
      description: "Better customer experience on the synthetic care journey.",
      benefitType: "cx",
      valueClass: "non_financial",
      ownerUserId: c.bo.id,
      currency: "SAR",
      measurementKpiDefinitionId: kpiId,
    },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as string;
}

/** A T09 formula instantiated from the revenue-uplift example (version 1), through the DG3 API. */
export async function exampleFormula(send: Caller, c: ChangeWorld) {
  const res = await send("POST", "/api/v1/benefit-formulas", {
    session: c.lead.session,
    body: {
      transformationId: c.transformationId,
      benefitName: "Synthetic revenue uplift",
      fromExample: "revenue_uplift",
    },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as {
    id: string;
    version: number;
    currentVersion: { expression: string; variables: Record<string, unknown>[] };
  };
}

/** The next formula version through DG3 `POST /benefit-formulas/{id}/versions` (one variable value changed). */
export function newFormulaVersion(
  send: Caller,
  c: ChangeWorld,
  f: { id: string; version: number; currentVersion: { expression: string; variables: Record<string, unknown>[] } },
  note = "Synthetic: updated assumption",
) {
  const variables = f.currentVersion.variables.map((v, i) => {
    const out = Object.fromEntries(
      Object.entries(v).filter(
        ([k, val]) =>
          ["name", "kind", "unit", "currency", "period", "value", "description", "source"].includes(k) && val !== null,
      ),
    );
    return i === 0 && typeof out["value"] === "string" ? { ...out, value: String(Number(out["value"]) + 1) } : out;
  });
  return send("POST", `/api/v1/benefit-formulas/${f.id}/versions`, {
    session: c.lead.session,
    headers: ifm(f.version),
    body: { expression: f.currentVersion.expression, variables, changeNote: note },
  });
}

/** Decides a change request's approval as `session` (If-Match the approval's version). */
export async function decide(
  send: Caller,
  approvalId: string,
  session: ChangeWorld["lead"]["session"],
  outcome = "approve",
) {
  const a = await send("GET", `/api/v1/approvals/${approvalId}`, { session });
  return send("POST", `/api/v1/approvals/${approvalId}/decisions`, {
    session,
    headers: ifm(a.body?.version ?? 1),
    body: { outcome, rationale: RATIONALE, subjectVersion: a.body?.subjectVersion ?? 1 },
  });
}
