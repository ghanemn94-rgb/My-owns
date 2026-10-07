// Initiative persistence shared by the BE-B route files (T-DG3-BE-B; ADR-0021 §2-§3): INI-nn codes, row loading and
// locking, the initiative representation (derived funding state, the 'Selected - unfunded' label, warnings), and the
// shared 422 problems of the lifecycle. Pure reads and row helpers; every route keeps its own authorization, validation,
// If-Match and audit event.
//
// The funding state is read ONLY through latestFundingState() (portfolio/funding.ts): ranking, selection and funding
// are three separate records (REQ-S09-003) and the status column only mirrors them. Selection and funding are business
// approvals inside the product; nothing here approves anything, and nothing touches the engineering gates DG0-DG7.
import { diffFields, sql, type Db, type DbOrTx, type InitiativeRow, type Tx } from "@mth/db";
import type { Permission } from "@mth/shared";
import type { FundingState, Initiative, Warning } from "@mth/shared/schemas";
import type { FastifyRequest } from "fastify";
import type { z } from "zod";
import { principalOf, requireTransformationRead, type ResolvedTarget } from "../access/index.ts";
import { record } from "../audit/index.ts";
import { HttpProblem, iso, isoOrNull, parseBody, problems, requireIfMatch } from "../platform/index.ts";
import { bumpStamps, openWrite, type WriteContext } from "../transformations/index.ts";
import { latestFundingState } from "./funding.ts";

export type { InitiativeRow };

/** Statuses in which an initiative is in the approved portfolio selection and has a funding state (ADR-0021 §3, §7). */
const FUNDING_RELEVANT: ReadonlySet<string> = new Set(["selected", "funded", "launched", "completed"]);
/** Terminal or closed statuses: the T05 card and its links are read-only (archive, never delete). */
export const READ_ONLY_STATUSES: ReadonlySet<string> = new Set(["cancelled", "completed"]);

/** Deliverable count outside this range is a warning, never a rejection (B0072, ADR-0021 §3). */
export const DELIVERABLE_RANGE = { min: 3, max: 7 } as const;

// ------------------------------------------------------------------------------------------------ codes

/**
 * Next INI-nn code of the transformation from record_code_counter (prefix INI, 0020). The UPSERT takes the counter row
 * lock inside the creating transaction, so two concurrent creates never get the same code (initiative_code_key backs
 * it up). Same mechanism as workflows/codes.ts, whose prefix set does not include INI.
 */
export async function nextInitiativeCode(tx: Tx, transformationId: string): Promise<string> {
  const row = await sql<{ last_value: number }>`
    INSERT INTO record_code_counter (transformation_id, prefix, last_value) VALUES (${transformationId}::uuid, 'INI', 1)
    ON CONFLICT (transformation_id, prefix) DO UPDATE SET last_value = record_code_counter.last_value + 1
    RETURNING last_value`.execute(tx);
  return `INI-${String(row.rows[0]!.last_value).padStart(2, "0")}`;
}

// ------------------------------------------------------------------------------------------------ rows

/**
 * The initiative, readable by the caller: 404 when it does not exist OR the caller cannot read its transformation
 * (existence is never disclosed). Returns the row and the resolved transformation target.
 */
export async function readableInitiative(
  db: DbOrTx,
  request: FastifyRequest,
  initiativeId: string,
): Promise<{ readonly row: InitiativeRow; readonly target: ResolvedTarget }> {
  const row = await db.selectFrom("initiative").selectAll().where("id", "=", initiativeId).executeTakeFirst();
  if (!row) throw problems.notFound();
  const target = await requireTransformationRead(db, principalOf(request), row.transformation_id);
  return { row, target };
}

/** If-Match (428 / 400), then the row lock and the version check (409); after the read and write gates. */
export async function lockInitiativeForWrite(tx: Tx, request: FastifyRequest, initiativeId: string) {
  const expected = requireIfMatch(request);
  const current = await tx
    .selectFrom("initiative")
    .selectAll()
    .where("id", "=", initiativeId)
    .forUpdate()
    .executeTakeFirst();
  if (!current) throw problems.notFound();
  if (current.version !== expected) throw problems.versionConflict(current.version);
  return current;
}

/** A cancelled or completed initiative is read-only (its card and links); 422 with the status named. */
export function assertEditable(row: InitiativeRow): void {
  if (READ_ONLY_STATUSES.has(row.status))
    throw problems.businessRule(
      "initiative.read_only",
      `A ${row.status} initiative is read-only; its card and links can no longer be changed.`,
    );
}

// ------------------------------------------------------------------------------------------------ problems

/** 422 invalid-transition (ADR-0007) with the transition `code`, its exact English text and every failing precondition. */
export function transitionProblem(code: string, detail: string, errors: readonly Warning[] = []): HttpProblem {
  return new HttpProblem({
    status: 422,
    type: "urn:mth:problem:invalid-transition",
    code,
    title: "Invalid transition",
    detail,
    errors: (errors.length > 0 ? errors : [{ code, message: detail }]).map((e) => ({
      pointer: e.pointer ?? "",
      code: e.code,
      message: e.message,
    })),
  });
}

/** 422 validation with one pointer (a business rule on a field). */
export function fieldRule(code: string, detail: string, pointer: string): HttpProblem {
  return new HttpProblem({
    status: 422,
    type: "urn:mth:problem:validation",
    code,
    title: "Business rule violated",
    detail,
    errors: [{ pointer, code, message: detail }],
  });
}

/** `planned_end >= planned_start` (ADR-0021 §2; CHECK initiative_planned_range backs it up). */
export function assertPlannedRange(start: string | null | undefined, end: string | null | undefined): void {
  if (start !== null && start !== undefined && end !== null && end !== undefined && end < start)
    throw fieldRule(
      "initiative.planned_range",
      "The planned end date must be on or after the planned start date.",
      "/plannedEnd",
    );
}

// ------------------------------------------------------------------------------------------------ presenter

/** A `date` column as YYYY-MM-DD (@mth/db returns dates as text). */
export function dateText(d: string | Date | null): string | null {
  if (d === null) return null;
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
}

/**
 * The funding state shown on the representation: `not_applicable` outside the approved selection (draft, submitted,
 * ranked, cancelled); otherwise the latest funding decision decides (latestFundingState, fail closed).
 */
export async function fundingStateOf(db: DbOrTx, row: Pick<InitiativeRow, "id" | "status">): Promise<FundingState> {
  return FUNDING_RELEVANT.has(row.status) ? latestFundingState(db, row.id) : "not_applicable";
}

/**
 * i18n key of the status label. `selected` without a current approved funding decision is
 * `initiative.status.selected_unfunded` ('Selected - unfunded', ADR-0021 §3; REQ-S09-003).
 */
export function displayStatusOf(status: string, fundingState: FundingState): string {
  return status === "selected" && fundingState !== "funded"
    ? "initiative.status.selected_unfunded"
    : `initiative.status.${status}`;
}

/** Readiness hints, never rejections (ADR-0021 §3): deliverable count outside 3-7, no gap link, no executive owner. */
export function initiativeWarnings(
  row: Pick<InitiativeRow, "executive_owner_user_id">,
  deliverables: number,
  gapLinks: number,
): Warning[] {
  const out: Warning[] = [];
  if (deliverables < DELIVERABLE_RANGE.min || deliverables > DELIVERABLE_RANGE.max)
    out.push({
      code: "initiative.deliverable_count",
      message: `Key deliverables: ${DELIVERABLE_RANGE.min} to ${DELIVERABLE_RANGE.max} are recommended (currently ${deliverables}).`,
      pointer: "/deliverables",
    });
  if (gapLinks === 0)
    out.push({
      code: "initiative.no_gap_link",
      message: "No gap link: link the initiative to at least one TOM gap or diagnosed finding.",
      pointer: "/gapLinks",
    });
  if (row.executive_owner_user_id === null)
    out.push({
      code: "initiative.no_owner",
      message: "No executive owner is named.",
      pointer: "/executiveOwnerUserId",
    });
  return out;
}

async function countsBy(
  db: DbOrTx,
  table: "deliverable" | "initiative_gap_link",
  ids: readonly string[],
): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .selectFrom(table)
    .select(["initiative_id", (eb) => eb.fn.countAll<string>().as("n")])
    .where("initiative_id", "in", [...ids])
    .where("status", "=", "active")
    .groupBy("initiative_id")
    .execute();
  // count(*) arrives as a bigint string; parseInt keeps it an integer count (not a decimal value).
  return new Map(rows.map((r) => [r.initiative_id, Number.parseInt(String(r.n), 10)]));
}

/** Rows -> API representations (warnings, funding state, display status). Flags: none in this task (BE-C's schedule). */
export async function presentInitiatives(db: DbOrTx, rows: readonly InitiativeRow[]): Promise<Initiative[]> {
  const ids = rows.map((r) => r.id);
  const deliverables = await countsBy(db, "deliverable", ids);
  const gapLinks = await countsBy(db, "initiative_gap_link", ids);
  const out: Initiative[] = [];
  for (const r of rows) {
    const fundingState = await fundingStateOf(db, r);
    out.push({
      id: r.id,
      organizationId: r.organization_id,
      transformationId: r.transformation_id,
      code: r.code,
      name: r.name,
      executiveOwnerUserId: r.executive_owner_user_id,
      workstreamLeadUserId: r.workstream_lead_user_id,
      problemStatement: r.problem_statement,
      objective: r.objective,
      scopeIn: r.scope_in,
      scopeOut: r.scope_out,
      financialBenefitSummary: r.financial_benefit_summary,
      customerBenefitSummary: r.customer_benefit_summary,
      risksSummary: r.risks_summary,
      waveId: r.wave_id,
      plannedStart: dateText(r.planned_start),
      plannedEnd: dateText(r.planned_end),
      status: r.status as Initiative["status"],
      fundingState,
      displayStatus: displayStatusOf(r.status, fundingState),
      launchedAt: isoOrNull(r.launched_at),
      launchedBy: r.launched_by,
      cancelledAt: isoOrNull(r.cancelled_at),
      cancelledBy: r.cancelled_by,
      cancelReason: r.cancel_reason,
      warnings: initiativeWarnings(r, deliverables.get(r.id) ?? 0, gapLinks.get(r.id) ?? 0),
      flags: [],
      version: r.version,
      createdAt: iso(r.created_at),
      createdBy: r.created_by,
      updatedAt: iso(r.updated_at),
      updatedBy: r.updated_by,
    });
  }
  return out;
}

export async function presentInitiative(db: DbOrTx, row: InitiativeRow): Promise<Initiative> {
  return (await presentInitiatives(db, [row]))[0]!;
}

/** Reads the initiative again and presents it (after a committed write). */
export async function loadInitiative(db: DbOrTx, initiativeId: string): Promise<Initiative> {
  const row = await db.selectFrom("initiative").selectAll().where("id", "=", initiativeId).executeTakeFirstOrThrow();
  return presentInitiative(db, row);
}

// ------------------------------------------------------------------------------------------------ status changes

/**
 * Writes one lifecycle step of the initiative (version + 1; the initiative_status_step trigger guarantees the edge) and
 * its single audit event with the status diff (plus `extra` columns). Callers have already authorized at commit,
 * validated, checked If-Match and every precondition.
 */
export async function applyStatusChange(
  ctx: WriteContext,
  current: InitiativeRow,
  to: string,
  action: string,
  options: { readonly set?: Readonly<Record<string, unknown>>; readonly reason?: string | null } = {},
): Promise<InitiativeRow> {
  const updated = await ctx.tx
    .updateTable("initiative")
    .set({ ...(options.set ?? {}), status: to, ...bumpStamps(ctx.userId) })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(ctx.tx, ctx.audit, {
    action,
    recordType: "initiative",
    recordId: current.id,
    organizationId: ctx.organizationId,
    transformationId: ctx.transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    ...(options.reason ? { reason: options.reason } : {}),
    changes: diffFields(current, updated, [
      "status",
      "launched_at",
      "launched_by",
      "cancelled_at",
      "cancelled_by",
      "cancel_reason",
    ]),
  });
  return updated;
}

/**
 * One initiative action sub-resource in ONE transaction, in the platform order: read gate (404), write gate re-checked
 * at commit (403; BE18A, so a read-only auditor gets 403 for any body), validation (400), If-Match + lock + version
 * (428/409), then `step` (preconditions -> 422, the write and its audit event). Returns the committed representation.
 */
export async function runInitiativeAction<S extends z.ZodType>(
  db: Db,
  request: FastifyRequest,
  initiativeId: string,
  permission: Permission,
  schema: S,
  step: (ctx: WriteContext, current: InitiativeRow, body: z.infer<S>) => Promise<void>,
): Promise<Initiative> {
  return db.transaction().execute(async (tx) => {
    const { row: seen } = await readableInitiative(tx, request, initiativeId);
    const ctx = await openWrite(tx, request, seen.transformation_id, [{ permission }], null, { atCommit: true });
    const body = parseBody(schema, request.body);
    const current = await lockInitiativeForWrite(tx, request, initiativeId);
    await step(ctx, current, body);
    return loadInitiative(tx, initiativeId);
  });
}
