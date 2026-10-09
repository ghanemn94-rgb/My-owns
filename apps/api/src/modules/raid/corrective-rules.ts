// The configured severity and persistence rule of the corrective-action cases (P4 slice E; ADR-0031 §5.2, §9-§11;
// T-DG4-BE-D2; REQ-PB-085 "under the configured severity and persistence rule", M0227):
//   GET   /transformations/{t}/corrective-action-rules               the rule in force for each of the four source kinds;
//                                                                    isDefault marks a kind without a stored rule
//                                                                    (transformation.read)
//   POST  /transformations/{t}/corrective-action-rules               store the rule of one kind (corrective_rule.configure)
//   PATCH /transformations/{t}/corrective-action-rules/{sourceKind}  change the stored rule (If-Match; 404 when none)
//
// The defaults (ADR-0031 §5.2: KPI red for 2 consecutive reporting periods; benefit, adoption and control 1 cycle; 5
// working days each) are CORRECTIVE_RULE_DEFAULTS (read through correctiveRuleDefault) in @mth/shared/schemas, shared
// with the worker's consumers, which import no API code (ADR-0002 rule 5). Refusals are exactly ADR-0031 §11 (S-11): 422
// corrective_rule.severity_kpi_only (at /minKpiRag), corrective_rule.persistence_series_only (at /persistenceCycles),
// 409 corrective_rule.exists. Every mutation: the write gate re-checked at commit time (AUD 403; ADM-only and outsiders
// 404), validation, If-Match (428/409; creates are version 1), one audit event in the same transaction, no remote I/O.
// A rule is configuration, never a business approval, and nothing here touches DG0-DG7.
import { diffFields, sql, type CorrectiveActionRuleRow, type Tx } from "@mth/db";
import {
  CORRECTIVE_RULE_KINDS,
  correctiveActionRuleCreate,
  correctiveActionRuleUpdate,
  correctiveRuleDefault,
  correctiveRuleKind,
  type CorrectiveActionRule,
  type CorrectiveMinRag,
  type CorrectiveRuleKind,
} from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { principalOf, requireTransformationRead } from "../access/index.ts";
import { record } from "../audit/index.ts";
import {
  cursorSchema,
  decodeCursor,
  filterHash,
  limitSchema,
  paginate,
  parse,
  parseBody,
  parseQuery,
  problems,
  requireIfMatch,
  sendVersioned,
  type ModuleDeps,
} from "../platform/index.ts";
import { openWrite, type WriteContext } from "../transformations/index.ts";
import { JSON_BODY, parseTransformationParam, raidRule } from "./register.ts";

export const CORRECTIVE_RULES = "/api/v1/transformations/:transformationId/corrective-action-rules";
export const CORRECTIVE_RULE_ITEM = `${CORRECTIVE_RULES}/:sourceKind`;
export const CORRECTIVE_RULE_CONFIGURE = "corrective_rule.configure" as const;

// ------------------------------------------------------------------------------------------------ problems (ADR-0031 §11)

export const SEVERITY_KPI_ONLY = () =>
  raidRule(
    "corrective_rule.severity_kpi_only",
    "A severity applies to KPI deviations only, and a KPI deviation rule needs one.",
    "/minKpiRag",
  );
export const PERSISTENCE_SERIES_ONLY = () =>
  raidRule(
    "corrective_rule.persistence_series_only",
    "A failed check is one event: its persistence is 1 cycle.",
    "/persistenceCycles",
  );
export const RULE_EXISTS = () =>
  problems.duplicate(
    "corrective_rule.exists",
    "A rule for this source already exists in this transformation; update it instead.",
  );

/** ADR-0031 §5.2: a severity for KPI deviations only (and required there); persistence > 1 for the series kinds only. */
export function checkRuleShape(
  kind: CorrectiveRuleKind,
  minKpiRag: CorrectiveMinRag | null,
  persistence: number,
): void {
  if ((kind === "kpi_deviation") !== (minKpiRag !== null)) throw SEVERITY_KPI_ONLY();
  if (persistence > 1 && kind !== "kpi_deviation" && kind !== "benefit_variance") throw PERSISTENCE_SERIES_ONLY();
}

// ------------------------------------------------------------------------------------------------ presentation

export const RULE_AUDIT_FIELDS = [
  "source_kind",
  "min_kpi_rag",
  "persistence_cycles",
  "follow_up_working_days",
  "enabled",
] as const satisfies readonly (keyof CorrectiveActionRuleRow & string)[];

export function toRule(r: CorrectiveActionRuleRow): CorrectiveActionRule {
  return {
    id: r.id,
    sourceKind: r.source_kind as CorrectiveRuleKind,
    minKpiRag: r.min_kpi_rag as CorrectiveMinRag | null,
    persistenceCycles: r.persistence_cycles,
    followUpWorkingDays: r.follow_up_working_days,
    enabled: r.enabled,
    isDefault: false,
    version: r.version,
  };
}

export function defaultRule(kind: CorrectiveRuleKind): CorrectiveActionRule {
  const d = correctiveRuleDefault(kind);
  return {
    id: null,
    sourceKind: kind,
    minKpiRag: d.minKpiRag,
    persistenceCycles: d.persistenceCycles,
    followUpWorkingDays: d.followUpWorkingDays,
    enabled: d.enabled,
    isDefault: true,
    version: null,
  };
}

// ------------------------------------------------------------------------------------------------ writes

/** The write gate: the read gate first (ADM-only and outsiders 404), then corrective_rule.configure at commit time. */
async function openRuleWrite(tx: Tx, request: FastifyRequest, transformationId: string): Promise<WriteContext> {
  await requireTransformationRead(tx, principalOf(request), transformationId);
  return openWrite(tx, request, transformationId, [{ permission: CORRECTIVE_RULE_CONFIGURE }], null, {
    atCommit: true,
  });
}

async function createRule(tx: Tx, request: FastifyRequest): Promise<CorrectiveActionRuleRow> {
  const transformationId = parseTransformationParam(request.params);
  const ctx = await openRuleWrite(tx, request, transformationId);
  const body = parseBody(correctiveActionRuleCreate, request.body);
  const minKpiRag = body.minKpiRag ?? null;
  checkRuleShape(body.sourceKind, minKpiRag, body.persistenceCycles);
  const existing = await tx
    .selectFrom("corrective_action_rule")
    .select("id")
    .where("transformation_id", "=", transformationId)
    .where("source_kind", "=", body.sourceKind)
    .executeTakeFirst();
  if (existing) throw RULE_EXISTS();
  const id = uuidv7();
  const row = await tx
    .insertInto("corrective_action_rule")
    .values({
      id,
      organization_id: ctx.organizationId,
      transformation_id: transformationId,
      source_kind: body.sourceKind,
      min_kpi_rag: minKpiRag,
      persistence_cycles: body.persistenceCycles,
      follow_up_working_days: body.followUpWorkingDays,
      enabled: body.enabled ?? true,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "corrective_action_rule.create",
    recordType: "corrective_action_rule",
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId,
    newVersion: row.version,
    changes: diffFields({} as CorrectiveActionRuleRow, row, [...RULE_AUDIT_FIELDS]),
  });
  return row;
}

const ruleParams = z.strictObject({ transformationId: z.uuid(), sourceKind: correctiveRuleKind });

async function updateRule(tx: Tx, request: FastifyRequest): Promise<CorrectiveActionRuleRow> {
  const { transformationId, sourceKind } = parse(ruleParams, request.params, "params");
  const ctx = await openRuleWrite(tx, request, transformationId);
  const body = parseBody(correctiveActionRuleUpdate, request.body);
  const expected = requireIfMatch(request);
  const current = await tx
    .selectFrom("corrective_action_rule")
    .selectAll()
    .where("transformation_id", "=", transformationId)
    .where("source_kind", "=", sourceKind)
    .forUpdate()
    .executeTakeFirst();
  if (!current) throw problems.notFound();
  if (current.version !== expected) throw problems.versionConflict(current.version);
  const minKpiRag = body.minKpiRag !== undefined ? body.minKpiRag : (current.min_kpi_rag as CorrectiveMinRag | null);
  const persistence = body.persistenceCycles ?? current.persistence_cycles;
  checkRuleShape(sourceKind, minKpiRag, persistence);
  const updated = await tx
    .updateTable("corrective_action_rule")
    .set({
      ...(body.minKpiRag !== undefined ? { min_kpi_rag: body.minKpiRag } : {}),
      ...(body.persistenceCycles !== undefined ? { persistence_cycles: body.persistenceCycles } : {}),
      ...(body.followUpWorkingDays !== undefined ? { follow_up_working_days: body.followUpWorkingDays } : {}),
      ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: ctx.userId,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "corrective_action_rule.update",
    recordType: "corrective_action_rule",
    recordId: current.id,
    organizationId: ctx.organizationId,
    transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: diffFields(current, updated, [...RULE_AUDIT_FIELDS]),
  });
  return updated;
}

// ------------------------------------------------------------------------------------------------ routes

const pageQuery = z.strictObject({ cursor: cursorSchema, limit: limitSchema });

export function registerCorrectiveRuleRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const read = { access: { permission: "transformation.read" as const } };
  const write = { access: { permission: CORRECTIVE_RULE_CONFIGURE }, consumes: JSON_BODY };

  app.get(CORRECTIVE_RULES, { config: read }, async (request) => {
    const transformationId = parseTransformationParam(request.params);
    const query = parseQuery(pageQuery, request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const hash = filterHash({ table: "corrective_action_rule", transformationId });
    const after = decodeCursor(query.cursor, hash, 1);
    const stored = new Map(
      (
        await db
          .selectFrom("corrective_action_rule")
          .selectAll()
          .where("transformation_id", "=", transformationId)
          .execute()
      ).map((r) => [r.source_kind, r] as const),
    );
    // The four kinds in their fixed order (ADR-0031 §5.2); the cursor is the position of the last item returned.
    const all = CORRECTIVE_RULE_KINDS.map((kind, position) => {
      const row = stored.get(kind);
      return { position, rule: row ? toRule(row) : defaultRule(kind) };
    });
    const start = after ? Number(after[0]) + 1 : 0;
    const page = paginate(all.slice(start, start + query.limit + 1), query.limit, (x) => [x.position], hash);
    return { items: page.items.map((x) => x.rule), nextCursor: page.nextCursor };
  });

  app.post(CORRECTIVE_RULES, { config: write }, async (request, reply) => {
    const row = await db.transaction().execute((tx) => createRule(tx, request));
    return sendVersioned(
      reply,
      201,
      toRule(row) as CorrectiveActionRule & { version: number },
      `${request.url.split("?")[0]!}/${row.source_kind}`,
    );
  });

  app.patch(CORRECTIVE_RULE_ITEM, { config: write }, async (request, reply) => {
    const row = await db.transaction().execute((tx) => updateRule(tx, request));
    return sendVersioned(reply, 200, toRule(row) as CorrectiveActionRule & { version: number });
  });

  return [`GET ${CORRECTIVE_RULES}`, `POST ${CORRECTIVE_RULES}`, `PATCH ${CORRECTIVE_RULE_ITEM}`];
}
