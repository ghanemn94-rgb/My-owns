// The optional NPV / ROI / payback extension (REQ-S08-019, M0174; ADR-0047 §5, §6, §8, §9; p5-work-split §G.3,
// T-DG5-KBE-F). An extension, NOT a playbook requirement: off by default, and every body says `extension: true`.
//   GET /benefits/financial-metrics/settings              the organization's settings (session; version 0 when none)
//   PUT /benefits/financial-metrics/settings/enablement   switch it on or off (financial_metrics.enable, ADM_METHOD,
//                                                         through a grant of the caller's organization; "0" creates)
//   PUT /benefits/financial-metrics/settings/assumptions  methodology statement, timing, period basis and discount rate
//                                                         (financial_metrics.define, FIN, organization grant; "0" creates)
//                                                         422 financial_metrics.discount_rate_invalid,
//                                                         financial_metrics.assumptions_incomplete
//   GET /business-cases/{id}/cash-flows                   the current set (transformation.read; version 0 when none)
//   PUT /business-cases/{id}/cash-flows                   replace the set (financial_metrics.define in the case's
//                                                         transformation; "0" creates). 422 financial_cash_flows.*
//   GET /business-cases/{id}/financial-metrics            NPV, ROI, payback with the assumptions used (transformation.read)
//   GET /transformations/{t}/benefits/financial-metrics   the same for every case of the transformation (paged)
//
// - The settings are organization-wide (ADR-0047 Alternatives 5), so switching them and setting the assumptions need
//   the permission through a grant that applies at the ORGANIZATION level (an organization-scoped role assignment); a
//   FIN assignment scoped to one transformation enters that transformation's cash flows but cannot change the
//   organization's assumptions.
// - Every mutation: commit-time authorization (grants reloaded in the transaction), validation, If-Match (428
//   missing, 409 stale; `"0"` creates and is stale once a row exists), one audit event per mutated row of
//   financial_metric_setting / financial_cash_flow_set in the same transaction (the append-only cash-flow rows carry
//   none; the set's event lists them), and no remote I/O.
// - Computation is the pure `@mth/shared/calc` finance functions (decimal.js; NPV precision 40 rounded once to 2
//   decimals, ROI to 6). A metric that is not shown or not computable is null with its reason, never 0. Cash flows are
//   entered explicitly and never derived from benefit values (D-117, D-119, D-122: value bases never mixed).
import {
  sql,
  type BusinessCaseRow,
  type DbOrTx,
  type FinancialCashFlowSetRow,
  type FinancialMetricSettingRow,
  type Tx,
} from "@mth/db";
import { PROBLEM_TYPES, type Permission } from "@mth/shared";
import type { RawBuilder } from "kysely";
import {
  checkCashFlows,
  computeFinancialMetrics,
  isDiscountRate,
  type CashFlowInput,
  type FinancialTiming,
} from "@mth/shared/calc";
import {
  businessCaseCashFlowsPut,
  canonicalDecimal,
  financialMetricAssumptions,
  financialMetricEnablement,
  type BusinessCaseCashFlows,
  type FinancialMetricAssumptionsView,
  type FinancialMetrics,
  type FinancialMetricSettings,
} from "@mth/shared/schemas";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import {
  auditContextOf,
  principalOf,
  readScopeFor,
  refreshPrincipal,
  requireAction,
  requireSensitiveRead,
  requireTransformationRead,
  targetFor,
} from "../access/index.ts";
import { record } from "../audit/index.ts";
import {
  cursorSchema,
  decodeCursor,
  etag,
  filterHash,
  HttpProblem,
  isoOrNull,
  limitSchema,
  paginate,
  parse,
  parseBody,
  parseQuery,
  problems,
  requireIfMatch,
  type ModuleDeps,
} from "../platform/index.ts";
import { openWrite } from "../transformations/index.ts";

export const SETTINGS_PATH = "/api/v1/benefits/financial-metrics/settings";
export const ENABLEMENT_PATH = `${SETTINGS_PATH}/enablement`;
export const ASSUMPTIONS_PATH = `${SETTINGS_PATH}/assumptions`;
export const CASH_FLOWS_PATH = "/api/v1/business-cases/:businessCaseId/cash-flows";
export const CASE_METRICS_PATH = "/api/v1/business-cases/:businessCaseId/financial-metrics";
export const TRANSFORMATION_METRICS_PATH = "/api/v1/transformations/:transformationId/benefits/financial-metrics";
const ENABLE: Permission = "financial_metrics.enable";
const DEFINE: Permission = "financial_metrics.define";
const JSON_BODY = ["application/json"] as const;

// ------------------------------------------------------------------------------------------------ refusals (ADR-0047 §8)

export const financialMetricRefusals = {
  assumptionsIncomplete: () =>
    problems.businessRule(
      "financial_metrics.assumptions_incomplete",
      "Set the methodology statement, timing and period basis together.",
    ),
  discountRateInvalid: () =>
    problems.businessRule(
      "financial_metrics.discount_rate_invalid",
      "The discount rate is a decimal fraction from 0 to 1 per period (0.10 = 10%).",
    ),
  currencyMismatch: () =>
    problems.businessRule(
      "financial_cash_flows.currency_mismatch",
      "Cash flows are entered in the business case currency.",
    ),
  periodsInvalid: () =>
    problems.businessRule(
      "financial_cash_flows.periods_invalid",
      "Cash flows need one row per period index from 0, with no gap and at most 121 rows.",
    ),
} as const;

/** 409 against the current row, or the "no row yet" form when the client's If-Match names a row that is not there. */
function staleAgainst(current: { version: number } | undefined): HttpProblem {
  if (current) return problems.versionConflict(current.version);
  return new HttpProblem({
    status: 409,
    type: PROBLEM_TYPES.versionConflict,
    code: "version_conflict",
    title: "Version conflict",
    detail: "The record was changed by someone else. Review the current version and re-apply your change.",
  });
}

/** If-Match of a defaulted record: `"0"` names "no row yet" (the putChangeControlPolicy / notification-policy precedent). */
function ifMatchOrZero(request: FastifyRequest): number {
  return request.headers["if-match"] === '"0"' ? 0 : requireIfMatch(request);
}

/**
 * ETag of a defaulted record (the ARCH-R1 rule `ETagOrZero` / `IfMatchOrZero`): `"0"` while nothing is stored (the
 * value the PUT's If-Match "0" takes), else the row version. Contract note for the orchestrator (KBE-F handback, the
 * BE-L precedent): the 200 responses of getFinancialMetricSettings and getBusinessCaseCashFlows declare `ETag` (>= 1)
 * where this rule needs `ETagOrZero`; the proposed patch is in the handback evidence.
 */
function etagOf(reply: FastifyReply, version: number): void {
  reply.header("ETag", version >= 1 ? etag(version) : '"0"');
}

// ------------------------------------------------------------------------------------------------ presenters

const settingRow = (db: DbOrTx, organizationId: string) =>
  db
    .selectFrom("financial_metric_setting")
    .selectAll()
    .where("organization_id", "=", organizationId)
    .executeTakeFirst();

/** A stored discount rate as written (numeric(9,6), e.g. "0.100000"), or null. */
const rateOf = (r: FinancialMetricSettingRow): string | null =>
  r.discount_rate === null ? null : String(r.discount_rate);

export function toSettings(r: FinancialMetricSettingRow | undefined): FinancialMetricSettings {
  return {
    enabled: r?.enabled ?? false,
    methodology: "discounted_net_cash_flow",
    methodologyNote: r?.methodology_note ?? null,
    timing: (r?.timing ?? null) as FinancialMetricSettings["timing"],
    periodBasis: (r?.period_basis ?? null) as FinancialMetricSettings["periodBasis"],
    discountRate: r ? rateOf(r) : null,
    assumptionsSetBy: r?.assumptions_set_by ?? null,
    assumptionsSetAt: r ? isoOrNull(r.assumptions_set_at) : null,
    enabledChangedBy: r?.enabled_changed_by ?? null,
    enabledChangedAt: r ? isoOrNull(r.enabled_changed_at) : null,
    extension: true,
    version: r?.version ?? 0,
  };
}

/** The assumptions a metric names, or null when Finance has not set them. */
function assumptionsOf(r: FinancialMetricSettingRow | undefined): FinancialMetricAssumptionsView | null {
  if (!r || r.timing === null || r.methodology_note === null || r.period_basis === null) return null;
  return {
    methodologyNote: r.methodology_note,
    timing: r.timing as FinancialMetricAssumptionsView["timing"],
    periodBasis: r.period_basis as FinancialMetricAssumptionsView["periodBasis"],
    discountRate: rateOf(r),
  };
}

const setOf = (db: DbOrTx, businessCaseId: string) =>
  db
    .selectFrom("financial_cash_flow_set")
    .selectAll()
    .where("business_case_id", "=", businessCaseId)
    .executeTakeFirst();

async function currentRows(db: DbOrTx, set: FinancialCashFlowSetRow) {
  return db
    .selectFrom("financial_cash_flow")
    .select(["period_index", "outflow", "inflow", "note"])
    .where("set_id", "=", set.id)
    .where("revision", "=", set.revision)
    .orderBy("period_index")
    .execute();
}

type StoredRow = Awaited<ReturnType<typeof currentRows>>[number];
const toRow = (r: StoredRow) => ({
  periodIndex: Number(r.period_index),
  outflow: canonicalDecimal(String(r.outflow)),
  inflow: canonicalDecimal(String(r.inflow)),
  note: r.note,
});

async function toCashFlows(
  db: DbOrTx,
  c: Pick<BusinessCaseRow, "id" | "currency">,
  set: FinancialCashFlowSetRow | undefined,
): Promise<BusinessCaseCashFlows> {
  return {
    businessCaseId: c.id,
    currency: (set?.currency ?? c.currency).trim(),
    revision: set?.revision ?? 0,
    basisNote: set?.basis_note ?? null,
    rows: set ? (await currentRows(db, set)).map(toRow) : [],
    version: set?.version ?? 0,
    updatedAt: set ? isoOrNull(set.updated_at) : null,
  };
}

/** The ADR-0047 §5 "what is shown" rules for one case, from already loaded settings. */
async function metricsOf(
  db: DbOrTx,
  c: Pick<BusinessCaseRow, "id" | "currency">,
  setting: FinancialMetricSettingRow | undefined,
): Promise<FinancialMetrics> {
  const set = await setOf(db, c.id);
  const assumptions = assumptionsOf(setting);
  const notShown = {
    npv: null,
    npvReason: "not_shown",
    roi: null,
    roiReason: "not_shown",
    paybackPeriodIndex: null,
    paybackReason: "not_shown",
  } as const;
  const common = {
    businessCaseId: c.id,
    currency: (set?.currency ?? c.currency).trim(),
    assumptions,
    cashFlowRevision: set?.revision ?? null,
    extension: true as const,
  };
  if (!setting?.enabled) return { ...common, status: "disabled", ...notShown };
  if (assumptions === null) return { ...common, status: "assumptions_missing", ...notShown };
  if (!set) return { ...common, status: "cash_flows_missing", ...notShown };
  const rows: CashFlowInput[] = (await currentRows(db, set)).map((r) => ({
    periodIndex: Number(r.period_index),
    outflow: String(r.outflow),
    inflow: String(r.inflow),
  }));
  const m = computeFinancialMetrics({
    rows,
    discountRate: assumptions.discountRate,
    timing: assumptions.timing as FinancialTiming,
  });
  return {
    ...common,
    status: "shown",
    npv: m.npv,
    // A value beyond the contract's 18 integer digits is not shown (the contract has no out-of-range reason; handback).
    npvReason: m.npvReason === "out_of_range" ? "not_shown" : m.npvReason,
    roi: m.roi,
    roiReason: m.roiReason,
    paybackPeriodIndex: m.paybackPeriodIndex,
    paybackReason: m.paybackReason,
  };
}

// ------------------------------------------------------------------------------------------------ settings writes

/**
 * Commit-time authorization of an organization-wide settings write: the session is re-resolved and the grants are
 * reloaded in `tx`, and the permission must apply at the caller's organization (403 otherwise, audited as a denial).
 */
async function openOrganizationWrite(tx: Tx, request: FastifyRequest, permission: Permission) {
  const principal = await refreshPrincipal(tx, request);
  if (principal.userId === null || principal.organizationId === null) throw problems.forbidden();
  const target = await targetFor(tx, "organization", { organizationId: principal.organizationId });
  await requireAction(tx, principal, permission, target);
  return { userId: principal.userId, organizationId: principal.organizationId };
}

/**
 * Locks the organization's settings row and checks If-Match. Two concurrent `"0"` creates both see no row; the second
 * insert hits UNIQUE financial_metric_setting_org_key, which db-errors.ts answers 409 version_conflict.
 */
async function lockSetting(tx: Tx, organizationId: string, expected: number) {
  const current = await tx
    .selectFrom("financial_metric_setting")
    .selectAll()
    .where("organization_id", "=", organizationId)
    .forUpdate()
    .executeTakeFirst();
  if ((current?.version ?? 0) !== expected) throw staleAgainst(current);
  return current;
}

type SettingValues = {
  enabled?: boolean;
  enabled_changed_by?: string;
  enabled_changed_at?: RawBuilder<Date>;
  methodology_note?: string;
  timing?: string;
  period_basis?: string;
  discount_rate?: string | null;
  assumptions_set_by?: string;
  assumptions_set_at?: RawBuilder<Date>;
};

async function writeSetting(
  tx: Tx,
  request: FastifyRequest,
  who: { userId: string; organizationId: string },
  current: FinancialMetricSettingRow | undefined,
  values: SettingValues,
): Promise<FinancialMetricSettings> {
  const row = current
    ? await tx
        .updateTable("financial_metric_setting")
        .set({ ...values, version: sql<number>`version + 1`, updated_at: sql<Date>`now()`, updated_by: who.userId })
        .where("id", "=", current.id)
        .where("version", "=", current.version)
        .returningAll()
        .executeTakeFirstOrThrow()
    : await tx
        .insertInto("financial_metric_setting")
        .values({
          id: uuidv7(),
          organization_id: who.organizationId,
          ...values,
          created_by: who.userId,
          updated_by: who.userId,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
  const before = toSettings(current);
  const after = toSettings(row);
  // Each column with its value before (null on create) and after; on an update only the changed ones.
  const pairs: [string, unknown, unknown][] = [
    ["enabled", before.enabled, after.enabled],
    ["methodology_note", before.methodologyNote, after.methodologyNote],
    ["timing", before.timing, after.timing],
    ["period_basis", before.periodBasis, after.periodBasis],
    ["discount_rate", before.discountRate, after.discountRate],
  ];
  const changes = Object.fromEntries(
    pairs
      .filter(([, from, to]) => !current || from !== to)
      .map(([k, from, to]) => [k, { from: current ? from : null, to }]),
  );
  await record(tx, auditContextOf(request), {
    action: current ? "financial_metric_setting.update" : "financial_metric_setting.create",
    recordType: "financial_metric_setting",
    recordId: row.id,
    organizationId: who.organizationId,
    priorVersion: current?.version ?? null,
    newVersion: row.version,
    changes,
  });
  return after;
}

async function putEnablement(tx: Tx, request: FastifyRequest): Promise<FinancialMetricSettings> {
  const who = await openOrganizationWrite(tx, request, ENABLE);
  const body = parseBody(financialMetricEnablement, request.body);
  const current = await lockSetting(tx, who.organizationId, ifMatchOrZero(request));
  return writeSetting(tx, request, who, current, {
    enabled: body.enabled,
    enabled_changed_by: who.userId,
    enabled_changed_at: sql<Date>`now()`,
  });
}

async function putAssumptions(tx: Tx, request: FastifyRequest): Promise<FinancialMetricSettings> {
  const who = await openOrganizationWrite(tx, request, DEFINE);
  const body = parseBody(financialMetricAssumptions, request.body);
  if (body.discountRate !== null && !isDiscountRate(body.discountRate))
    throw financialMetricRefusals.discountRateInvalid();
  const current = await lockSetting(tx, who.organizationId, ifMatchOrZero(request));
  return writeSetting(tx, request, who, current, {
    methodology_note: body.methodologyNote,
    timing: body.timing,
    period_basis: body.periodBasis,
    discount_rate: body.discountRate,
    assumptions_set_by: who.userId,
    assumptions_set_at: sql<Date>`now()`,
  });
}

// ------------------------------------------------------------------------------------------------ cash flows

const caseParams = z.strictObject({ businessCaseId: z.uuid() });
const transformationParams = z.strictObject({ transformationId: z.uuid() });
const none = z.strictObject({});
const listQuery = z.strictObject({ cursor: cursorSchema, limit: limitSchema });

/** The case for a read: 404 when it does not exist or the caller cannot read its transformation. */
async function readCase(db: DbOrTx, request: FastifyRequest, id: string): Promise<BusinessCaseRow> {
  const row = await db.selectFrom("business_case").selectAll().where("id", "=", id).executeTakeFirst();
  if (!row) throw problems.notFound();
  const principal = principalOf(request);
  const target = await requireTransformationRead(db, principal, row.transformation_id);
  // P6 (ADR-0051 §2; T-DG6-BE-B2): a sensitive business case the caller is not admitted to is 404 here too.
  await requireSensitiveRead(db, principal, "business_case", row.id, target, [
    row.benefit_owner_user_id,
    row.initiative_owner_user_id,
    row.finance_validator_user_id,
    row.created_by,
  ]);
  return row;
}

async function putCashFlows(tx: Tx, request: FastifyRequest, businessCaseId: string): Promise<BusinessCaseCashFlows> {
  const located = await tx
    .selectFrom("business_case")
    .select("transformation_id")
    .where("id", "=", businessCaseId)
    .executeTakeFirst();
  if (!located) throw problems.notFound();
  const ctx = await openWrite(tx, request, located.transformation_id, [{ permission: DEFINE }], null, {
    atCommit: true,
  });
  const body = parseBody(businessCaseCashFlowsPut, request.body);
  const checked = checkCashFlows(body.rows);
  if (!checked.ok) throw financialMetricRefusals.periodsInvalid();
  // The case is locked FOR SHARE (its currency is read under the lock), then the set FOR UPDATE.
  const c = await tx
    .selectFrom("business_case")
    .selectAll()
    .where("id", "=", businessCaseId)
    .where("transformation_id", "=", ctx.transformationId)
    .forShare()
    .executeTakeFirst();
  if (!c) throw problems.notFound();
  if (c.status === "archived")
    throw problems.businessRule("business_case.archived", "Archived business cases and their lines are read-only.");
  // Two concurrent `"0"` creates: the second insert hits UNIQUE financial_cash_flow_set_case_key -> 409 (db-errors.ts).
  const current = await tx
    .selectFrom("financial_cash_flow_set")
    .selectAll()
    .where("business_case_id", "=", businessCaseId)
    .forUpdate()
    .executeTakeFirst();
  if ((current?.version ?? 0) !== ifMatchOrZero(request)) throw staleAgainst(current);
  const currency = c.currency.trim();
  if (current && current.currency.trim() !== currency) throw financialMetricRefusals.currencyMismatch();
  const before = current ? (await currentRows(tx, current)).map(toRow) : [];
  const basisNote = body.basisNote ?? null;
  const set = current
    ? await tx
        .updateTable("financial_cash_flow_set")
        .set({
          revision: current.revision + 1,
          line_count: checked.rows.length,
          basis_note: basisNote,
          version: sql<number>`version + 1`,
          updated_at: sql<Date>`now()`,
          updated_by: ctx.userId,
        })
        .where("id", "=", current.id)
        .where("version", "=", current.version)
        .returningAll()
        .executeTakeFirstOrThrow()
    : await tx
        .insertInto("financial_cash_flow_set")
        .values({
          id: uuidv7(),
          organization_id: ctx.organizationId,
          transformation_id: ctx.transformationId,
          business_case_id: businessCaseId,
          currency,
          revision: 1,
          line_count: checked.rows.length,
          basis_note: basisNote,
          created_by: ctx.userId,
          updated_by: ctx.userId,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
  const notes = new Map(body.rows.map((r) => [r.periodIndex, r.note ?? null]));
  await tx
    .insertInto("financial_cash_flow")
    .values(
      checked.rows.map((r) => ({
        id: uuidv7(),
        organization_id: ctx.organizationId,
        transformation_id: ctx.transformationId,
        set_id: set.id,
        revision: set.revision,
        period_index: r.periodIndex,
        outflow: r.outflow,
        inflow: r.inflow,
        note: notes.get(r.periodIndex) ?? null,
      })),
    )
    .execute();
  const view = await toCashFlows(tx, c, set);
  await record(tx, ctx.audit, {
    action: current ? "financial_cash_flow_set.replace" : "financial_cash_flow_set.create",
    recordType: "financial_cash_flow_set",
    recordId: set.id,
    organizationId: ctx.organizationId,
    transformationId: ctx.transformationId,
    priorVersion: current?.version ?? null,
    newVersion: set.version,
    changes: {
      business_case_id: { from: current ? businessCaseId : null, to: businessCaseId },
      currency: { from: current ? currency : null, to: currency },
      revision: { from: current?.revision ?? null, to: set.revision },
      line_count: { from: current?.line_count ?? null, to: set.line_count },
      basis_note: { from: current?.basis_note ?? null, to: set.basis_note },
      rows: { from: current ? before : null, to: view.rows },
    },
  });
  return view;
}

// ------------------------------------------------------------------------------------------------ routes

/** Registers this file's routes and returns them as "METHOD /path". */
export function registerFinancialMetricRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const read = { access: { permission: "transformation.read" as const } };
  const session = { access: { permission: "authenticated" as const } };

  // An organization-wide configuration shown beside every metric: every signed-in user reads it (ADR-0047 §6).
  app.get(SETTINGS_PATH, { config: session }, async (request, reply) => {
    const principal = principalOf(request);
    parseQuery(none, request.query);
    if (principal.organizationId === null) throw problems.forbidden();
    const view = toSettings(await settingRow(db, principal.organizationId));
    etagOf(reply, view.version);
    return view;
  });

  app.put(
    ENABLEMENT_PATH,
    { config: { access: { permission: ENABLE }, consumes: JSON_BODY } },
    async (request, reply) => {
      const view = await db.transaction().execute((tx) => putEnablement(tx, request));
      etagOf(reply, view.version);
      return view;
    },
  );

  app.put(
    ASSUMPTIONS_PATH,
    { config: { access: { permission: DEFINE }, consumes: JSON_BODY } },
    async (request, reply) => {
      const view = await db.transaction().execute((tx) => putAssumptions(tx, request));
      etagOf(reply, view.version);
      return view;
    },
  );

  app.get(CASH_FLOWS_PATH, { config: read }, async (request, reply) => {
    const { businessCaseId } = parse(caseParams, request.params, "params");
    parseQuery(none, request.query);
    const c = await readCase(db, request, businessCaseId);
    const view = await toCashFlows(db, c, await setOf(db, c.id));
    etagOf(reply, view.version);
    return view;
  });

  app.put(
    CASH_FLOWS_PATH,
    { config: { access: { permission: DEFINE }, consumes: JSON_BODY } },
    async (request, reply) => {
      const { businessCaseId } = parse(caseParams, request.params, "params");
      const view = await db.transaction().execute((tx) => putCashFlows(tx, request, businessCaseId));
      etagOf(reply, view.version);
      return view;
    },
  );

  app.get(CASE_METRICS_PATH, { config: read }, async (request) => {
    const { businessCaseId } = parse(caseParams, request.params, "params");
    parseQuery(none, request.query);
    const c = await readCase(db, request, businessCaseId);
    return metricsOf(db, c, await settingRow(db, c.organization_id));
  });

  app.get(TRANSFORMATION_METRICS_PATH, { config: read }, async (request) => {
    const { transformationId } = parse(transformationParams, request.params, "params");
    const query = parseQuery(listQuery, request.query);
    const principal = principalOf(request);
    await requireTransformationRead(db, principal, transformationId);
    const hash = filterHash({ table: "financial_metrics", transformationId });
    const after = decodeCursor(query.cursor, hash, 1);
    // P6 (ADR-0051 §1; T-DG6-BE-B2): one item per case, so a case the caller is not admitted to is absent.
    const scope = await readScopeFor(db, principal, "transformation.read");
    let q = db
      .selectFrom("business_case")
      .selectAll()
      .where("transformation_id", "=", transformationId)
      .where(
        scope.predicate({
          recordType: "business_case",
          recordId: sql.ref("business_case.id"),
          organizationId: sql.ref("business_case.organization_id"),
          transformationId: sql.ref("business_case.transformation_id"),
          partyUserIds: [
            sql.ref("business_case.benefit_owner_user_id"),
            sql.ref("business_case.initiative_owner_user_id"),
            sql.ref("business_case.finance_validator_user_id"),
            sql.ref("business_case.created_by"),
          ],
        }),
      );
    if (after) q = q.where("id", ">", String(after[0]));
    const rows = await q
      .orderBy("id")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.id], hash);
    const t = await db
      .selectFrom("transformation")
      .select("organization_id")
      .where("id", "=", transformationId)
      .executeTakeFirstOrThrow();
    const setting = await settingRow(db, t.organization_id);
    const items: FinancialMetrics[] = [];
    for (const c of page.items) items.push(await metricsOf(db, c, setting));
    return { items, nextCursor: page.nextCursor };
  });

  return [
    `GET ${SETTINGS_PATH}`,
    `PUT ${ENABLEMENT_PATH}`,
    `PUT ${ASSUMPTIONS_PATH}`,
    `GET ${CASH_FLOWS_PATH}`,
    `PUT ${CASH_FLOWS_PATH}`,
    `GET ${CASE_METRICS_PATH}`,
    `GET ${TRANSFORMATION_METRICS_PATH}`,
  ];
}
