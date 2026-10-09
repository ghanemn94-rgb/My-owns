// The dashboard RAG policy of one organization (ADR-0037 §3, §10, §13; REQ-PB-063 "configurable thresholds"; M0160):
//   GET /organizations/{o}/dashboard-rag-policy    configured thresholds (null = default) + effective values + policySource
//                                                  (organization.read; version 0 and ETag "0" when no row exists)
//   PUT /organizations/{o}/dashboard-rag-policy    set them (dashboard.configure: TO, KDS; If-Match, "0" creates the row)
//
// The defaults are ADR-0037 §3's labelled interpretation (D-106 (a)): no source gives them, so a NULL column means
// "use the documented default" and `policySource` says whether any configured value applies. The only slice J write:
// organization read gate (404), dashboard.configure re-checked on grants reloaded in the transaction (commit-time
// authorization, 403), validation (400 schema ranges; 422 dashboard_rag_policy.threshold_order when amber is beyond red),
// If-Match (428 missing, 409 stale; "0" creates), one audit event in the same transaction, no remote I/O (S-4).
import { sql, type DashboardRagPolicyRow, type DbOrTx, type Tx } from "@mth/db";
import { PROBLEM_TYPES } from "@mth/shared";
import { FORMULA_DECIMAL as D } from "@mth/shared/calc";
import {
  DASHBOARD_RAG_DEFAULTS,
  dashboardRagPolicyUpdate,
  type DashboardRagPolicy,
  type DashboardRagPolicyUpdate,
  type DashboardRagPolicyValues,
} from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import {
  auditContextOf,
  commitTimeDenial,
  principalOf,
  refreshPrincipal,
  requireAction,
  requireRead,
} from "../../access/index.ts";
import { record } from "../../audit/index.ts";
import {
  HttpProblem,
  iso,
  parse,
  parseBody,
  parseQuery,
  problems,
  requireIfMatch,
  type ModuleDeps,
} from "../../platform/index.ts";
import type { DashboardPolicy } from "./areas.ts";
import { dashboardRefusal } from "./filters.ts";

export const RAG_POLICY_PATH = "/api/v1/organizations/:organizationId/dashboard-rag-policy";
const READ = "organization.read" as const;
const CONFIGURE = "dashboard.configure" as const;
const JSON_BODY = ["application/json"] as const;
const orgParams = z.strictObject({ organizationId: z.uuid() });

/** The threshold columns of a row (literal accessors; the order of the contract). */
type Thresholds = Pick<
  DashboardRagPolicyRow,
  | "value_gap_amber_ratio"
  | "value_gap_red_ratio"
  | "milestone_slip_amber_working_days"
  | "milestone_slip_red_working_days"
  | "dependency_due_soon_working_days"
  | "decision_due_soon_working_days"
  | "top_initiative_count"
  | "deadline_horizon_working_days"
>;

function thresholdsOf(row: Partial<Thresholds> | undefined): Thresholds {
  return {
    value_gap_amber_ratio: row?.value_gap_amber_ratio ?? null,
    value_gap_red_ratio: row?.value_gap_red_ratio ?? null,
    milestone_slip_amber_working_days: row?.milestone_slip_amber_working_days ?? null,
    milestone_slip_red_working_days: row?.milestone_slip_red_working_days ?? null,
    dependency_due_soon_working_days: row?.dependency_due_soon_working_days ?? null,
    decision_due_soon_working_days: row?.decision_due_soon_working_days ?? null,
    top_initiative_count: row?.top_initiative_count ?? null,
    deadline_horizon_working_days: row?.deadline_horizon_working_days ?? null,
  };
}

/** The update applied to the stored thresholds: a member left out keeps its value; null resets it to the default. */
function applyUpdate(current: Thresholds, b: DashboardRagPolicyUpdate): Thresholds {
  const pick = <T>(v: T | null | undefined, old: T | null): T | null => (v === undefined ? old : v);
  return {
    value_gap_amber_ratio: pick(b.valueGapAmberRatio, current.value_gap_amber_ratio),
    value_gap_red_ratio: pick(b.valueGapRedRatio, current.value_gap_red_ratio),
    milestone_slip_amber_working_days: pick(b.milestoneSlipAmberWorkingDays, current.milestone_slip_amber_working_days),
    milestone_slip_red_working_days: pick(b.milestoneSlipRedWorkingDays, current.milestone_slip_red_working_days),
    dependency_due_soon_working_days: pick(b.dependencyDueSoonWorkingDays, current.dependency_due_soon_working_days),
    decision_due_soon_working_days: pick(b.decisionDueSoonWorkingDays, current.decision_due_soon_working_days),
    top_initiative_count: pick(b.topInitiativeCount, current.top_initiative_count),
    deadline_horizon_working_days: pick(b.deadlineHorizonWorkingDays, current.deadline_horizon_working_days),
  };
}

const ratioText = (v: string | null): string | null => (v === null ? null : new D(v).toFixed());

/** The effective thresholds: each configured value, else the documented default. */
export function effectiveValues(row: Partial<Thresholds> | undefined): DashboardRagPolicyValues {
  return {
    valueGapAmberRatio: ratioText(row?.value_gap_amber_ratio ?? null) ?? DASHBOARD_RAG_DEFAULTS.valueGapAmberRatio,
    valueGapRedRatio: ratioText(row?.value_gap_red_ratio ?? null) ?? DASHBOARD_RAG_DEFAULTS.valueGapRedRatio,
    milestoneSlipAmberWorkingDays:
      row?.milestone_slip_amber_working_days ?? DASHBOARD_RAG_DEFAULTS.milestoneSlipAmberWorkingDays,
    milestoneSlipRedWorkingDays:
      row?.milestone_slip_red_working_days ?? DASHBOARD_RAG_DEFAULTS.milestoneSlipRedWorkingDays,
    dependencyDueSoonWorkingDays:
      row?.dependency_due_soon_working_days ?? DASHBOARD_RAG_DEFAULTS.dependencyDueSoonWorkingDays,
    decisionDueSoonWorkingDays:
      row?.decision_due_soon_working_days ?? DASHBOARD_RAG_DEFAULTS.decisionDueSoonWorkingDays,
    topInitiativeCount: row?.top_initiative_count ?? DASHBOARD_RAG_DEFAULTS.topInitiativeCount,
    deadlineHorizonWorkingDays: row?.deadline_horizon_working_days ?? DASHBOARD_RAG_DEFAULTS.deadlineHorizonWorkingDays,
  };
}

/** `configured` when at least one threshold column holds a value, else `default`. */
export function policySourceOf(row: Partial<Thresholds> | undefined): "default" | "configured" {
  if (!row) return "default";
  return Object.values(thresholdsOf(row)).some((v) => v !== null) ? "configured" : "default";
}

async function policyRow(db: DbOrTx, organizationId: string, forUpdate = false) {
  let q = db.selectFrom("dashboard_rag_policy").selectAll().where("organization_id", "=", organizationId);
  if (forUpdate) q = q.forUpdate();
  return q.executeTakeFirst();
}

/** The policy the area rules use for one organization (read-only). */
export async function loadDashboardPolicy(db: DbOrTx, organizationId: string): Promise<DashboardPolicy> {
  const row = await policyRow(db, organizationId);
  return { values: effectiveValues(row), source: policySourceOf(row) };
}

export function toDashboardRagPolicy(
  organizationId: string,
  row: DashboardRagPolicyRow | undefined,
): DashboardRagPolicy {
  return {
    organizationId,
    policySource: policySourceOf(row),
    valueGapAmberRatio: ratioText(row?.value_gap_amber_ratio ?? null),
    valueGapRedRatio: ratioText(row?.value_gap_red_ratio ?? null),
    milestoneSlipAmberWorkingDays: row?.milestone_slip_amber_working_days ?? null,
    milestoneSlipRedWorkingDays: row?.milestone_slip_red_working_days ?? null,
    dependencyDueSoonWorkingDays: row?.dependency_due_soon_working_days ?? null,
    decisionDueSoonWorkingDays: row?.decision_due_soon_working_days ?? null,
    topInitiativeCount: row?.top_initiative_count ?? null,
    deadlineHorizonWorkingDays: row?.deadline_horizon_working_days ?? null,
    note: row?.note ?? null,
    effective: effectiveValues(row),
    version: row?.version ?? 0,
    updatedAt: row ? iso(row.updated_at) : null,
    updatedBy: row?.updated_by ?? null,
  };
}

/** If-Match of the PUT: `"0"` names "no row yet" (the putChangeControlPolicy precedent). */
function policyIfMatch(request: FastifyRequest): number {
  return request.headers["if-match"] === '"0"' ? 0 : requireIfMatch(request);
}

/** Amber is reached no later than red, on the EFFECTIVE pair (a configured amber beyond a default red is refused). */
export function thresholdOrderViolation(
  v: DashboardRagPolicyValues,
): "/valueGapAmberRatio" | "/milestoneSlipAmberWorkingDays" | null {
  if (new D(v.valueGapAmberRatio).gt(new D(v.valueGapRedRatio))) return "/valueGapAmberRatio";
  if (v.milestoneSlipAmberWorkingDays > v.milestoneSlipRedWorkingDays) return "/milestoneSlipAmberWorkingDays";
  return null;
}

async function putPolicy(tx: Tx, request: FastifyRequest, organizationId: string): Promise<DashboardRagPolicy> {
  const target = await requireRead(tx, principalOf(request), READ, { type: "organization", id: organizationId });
  const fresh = await refreshPrincipal(tx, request);
  try {
    await requireAction(tx, fresh, CONFIGURE, target);
  } catch (err) {
    throw commitTimeDenial(err);
  }
  const body = parseBody(dashboardRagPolicyUpdate, request.body);
  const expected = policyIfMatch(request);
  const current = await policyRow(tx, organizationId, true);
  if ((current?.version ?? 0) !== expected) {
    if (current) throw problems.versionConflict(current.version);
    // No row yet (version 0): the Problem schema's currentVersion starts at 1, so it is left out.
    throw new HttpProblem({
      status: 409,
      type: PROBLEM_TYPES.versionConflict,
      code: "version_conflict",
      title: "Version conflict",
      detail: "The record was changed by someone else. Review the current version and re-apply your change.",
    });
  }
  const thresholds = applyUpdate(thresholdsOf(current), body);
  const note = body.note === undefined ? (current?.note ?? null) : body.note;
  const order = thresholdOrderViolation(effectiveValues(thresholds));
  if (order !== null) throw dashboardRefusal("dashboard_rag_policy.threshold_order", order);
  const userId = fresh.userId!;
  const values = { ...thresholds, note };
  const row = current
    ? await tx
        .updateTable("dashboard_rag_policy")
        .set({ ...values, version: sql<number>`version + 1`, updated_at: sql<Date>`now()`, updated_by: userId })
        .where("id", "=", current.id)
        .where("version", "=", current.version)
        .returningAll()
        .executeTakeFirstOrThrow()
    : await tx
        .insertInto("dashboard_rag_policy")
        .values({ id: uuidv7(), organization_id: organizationId, ...values, created_by: userId, updated_by: userId })
        .returningAll()
        .executeTakeFirstOrThrow();
  const before = { ...thresholdsOf(current), note: current?.note ?? null };
  const after = { ...thresholdsOf(row), note: row.note };
  const changes = Object.fromEntries(
    Object.entries(after).map(([k, to]) => [k, { from: new Map(Object.entries(before)).get(k) ?? null, to }]),
  );
  await record(tx, auditContextOf(request), {
    action: current ? "dashboard_rag_policy.update" : "dashboard_rag_policy.create",
    recordType: "dashboard_rag_policy",
    recordId: row.id,
    organizationId,
    priorVersion: current?.version ?? null,
    newVersion: row.version,
    changes,
  });
  return toDashboardRagPolicy(organizationId, row);
}

export function registerRagPolicyRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  app.get(RAG_POLICY_PATH, { config: { access: { permission: READ } } }, async (request, reply) => {
    const { organizationId } = parse(orgParams, request.params, "params");
    parseQuery(z.strictObject({}), request.query);
    await requireRead(db, principalOf(request), READ, { type: "organization", id: organizationId });
    const policy = toDashboardRagPolicy(organizationId, await policyRow(db, organizationId));
    // Version 0 (none configured) answers ETag "0", the value the PUT's If-Match "0" takes (the BE-L precedent).
    reply.header("ETag", `"${policy.version}"`);
    return policy;
  });

  app.put(
    RAG_POLICY_PATH,
    { config: { access: { permission: CONFIGURE }, consumes: JSON_BODY } },
    async (request, reply) => {
      const { organizationId } = parse(orgParams, request.params, "params");
      const policy = await db.transaction().execute((tx) => putPolicy(tx, request, organizationId));
      reply.header("ETag", `"${policy.version}"`);
      return policy;
    },
  );

  return [`GET ${RAG_POLICY_PATH}`, `PUT ${RAG_POLICY_PATH}`];
}
