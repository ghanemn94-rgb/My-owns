// Automation execution history (OpenAPI tag `automation`; ADR-0043 §5, §8; REQ-S12-001 "each execution is recorded with
// rule version, trigger event and outcome"; p5-work-split §D.3; T-DG5-BE-I):
//   GET /admin/automation-executions                 listAutomationExecutions (automation.read)
//   GET /admin/automation-executions/{executionId}   getAutomationExecution   (automation.read)
//
// Read-only. The worker writes executions and their action results (apps/worker/src/automation/engine.ts); nothing here
// changes them. Scope (ADR-0043 §8): a reader sees the executions of the organizations where it holds
// `automation.read`; any other execution is 404 (existence not disclosed). Each execution names its rule and version,
// its trigger (code and key), the identity it ran as, its status, attempt and error, and every action result of every
// attempt (outcome, idempotency key, produced record, error). An execution never approves anything (REQ-S12-026).
import { sql, type AutomationActionResultRow, type DbOrTx } from "@mth/db";
import { automationExecutionListQuery, type AutomationExecution } from "@mth/shared/schemas";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { holdsAnywhere, organizationsWith, principalOf, type Principal } from "../access/index.ts";
import {
  cursorSchema,
  decodeCursor,
  filterHash,
  iso,
  limitSchema,
  paginate,
  parse,
  parseQuery,
  problems,
  type ModuleDeps,
} from "../platform/index.ts";

export const EXECUTIONS = "/api/v1/admin/automation-executions";
const ONE = `${EXECUTIONS}/:executionId`;
const executionParams = z.strictObject({ executionId: z.uuid() });
const listQuery = automationExecutionListQuery.extend({ cursor: cursorSchema, limit: limitSchema });

/** `automation.read` held at any scope, else 403. */
function requireReader(principal: Principal): void {
  if (!holdsAnywhere(principal, "automation.read")) throw problems.forbidden();
}

interface ExecutionJoinRow {
  readonly id: string;
  readonly automation_rule_id: string;
  readonly automation_rule_version_id: string;
  readonly trigger_code: string;
  readonly trigger_key: string;
  readonly organization_id: string | null;
  readonly transformation_id: string | null;
  readonly run_as: string;
  readonly initiating_user_id: string | null;
  readonly status: string;
  readonly conditions_met: boolean | null;
  readonly attempt_no: number;
  readonly error_code: string | null;
  readonly error_detail: string | null;
  readonly started_at: Date;
  readonly finished_at: Date | null;
  readonly rule_code: string;
  readonly version_no: number;
}

function baseQuery(db: DbOrTx) {
  return db
    .selectFrom("automation_execution as e")
    .innerJoin("automation_rule as r", "r.id", "e.automation_rule_id")
    .innerJoin("automation_rule_version as v", "v.id", "e.automation_rule_version_id")
    .select([
      "e.id",
      "e.automation_rule_id",
      "e.automation_rule_version_id",
      "e.trigger_code",
      "e.trigger_key",
      "e.organization_id",
      "e.transformation_id",
      "e.run_as",
      "e.initiating_user_id",
      "e.status",
      "e.conditions_met",
      "e.attempt_no",
      "e.error_code",
      "e.error_detail",
      "e.started_at",
      "e.finished_at",
      "r.code as rule_code",
      "v.version_no",
      // The cursor key at full (microsecond) precision; a JavaScript Date would round it to milliseconds.
      sql<string>`to_char(e.started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.as("started_key"),
    ]);
}

async function resultsOf(
  db: DbOrTx,
  executionIds: readonly string[],
): Promise<Map<string, AutomationActionResultRow[]>> {
  const out = new Map<string, AutomationActionResultRow[]>();
  if (executionIds.length === 0) return out;
  const rows = await db
    .selectFrom("automation_action_result")
    .selectAll()
    .where("automation_execution_id", "in", [...executionIds])
    .orderBy("automation_execution_id")
    .orderBy("attempt_no")
    .orderBy("ordinal")
    .execute();
  for (const r of rows) {
    const list = out.get(r.automation_execution_id) ?? [];
    list.push(r);
    out.set(r.automation_execution_id, list);
  }
  return out;
}

export function presentExecution(
  e: ExecutionJoinRow,
  results: readonly AutomationActionResultRow[],
): AutomationExecution {
  return {
    id: e.id,
    ruleId: e.automation_rule_id,
    ruleCode: e.rule_code,
    versionId: e.automation_rule_version_id,
    versionNo: e.version_no,
    triggerCode: e.trigger_code,
    triggerKey: e.trigger_key,
    organizationId: e.organization_id,
    transformationId: e.transformation_id,
    runAs: e.run_as as AutomationExecution["runAs"],
    initiatingUserId: e.initiating_user_id,
    status: e.status as AutomationExecution["status"],
    conditionsMet: e.conditions_met,
    attemptNo: e.attempt_no,
    errorCode: e.error_code,
    errorDetail: e.error_detail,
    startedAt: iso(e.started_at),
    finishedAt: e.finished_at === null ? null : iso(e.finished_at),
    actionResults: results.map((r) => ({
      attemptNo: r.attempt_no,
      ordinal: r.ordinal,
      actionType: r.action_type,
      idempotencyKey: r.idempotency_key,
      outcome: r.outcome as AutomationExecution["actionResults"][number]["outcome"],
      resultRecordType: r.result_record_type,
      resultRecordId: r.result_record_id,
      errorCode: r.error_code,
      createdAt: iso(r.created_at),
    })),
  };
}

/** The execution if the reader may see it (its organization is one where the reader holds automation.read), else 404. */
export async function loadExecutionForRead(
  db: DbOrTx,
  principal: Principal,
  executionId: string,
): Promise<AutomationExecution> {
  const row = await baseQuery(db).where("e.id", "=", executionId).executeTakeFirst();
  if (row === undefined) throw problems.notFound();
  const orgs = organizationsWith(principal, "automation.read");
  if (row.organization_id !== null && !orgs.includes(row.organization_id)) throw problems.notFound();
  return presentExecution(row, (await resultsOf(db, [row.id])).get(row.id) ?? []);
}

export function registerAutomationExecutionRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const read = { access: { permission: "automation.read" as const } };

  app.get(EXECUTIONS, { config: read }, async (request) => {
    const query = parseQuery(listQuery, request.query);
    const principal = principalOf(request);
    requireReader(principal);
    const orgs = organizationsWith(principal, "automation.read");
    const hash = filterHash({ ruleId: query.ruleId, status: query.status, transformationId: query.transformationId });
    const after = decodeCursor(query.cursor, hash, 2);
    let q = baseQuery(db).where((eb) =>
      eb.or([
        eb("e.organization_id", "is", null),
        orgs.length === 0 ? sql<boolean>`false` : eb("e.organization_id", "in", orgs),
      ]),
    );
    if (query.ruleId !== undefined) q = q.where("e.automation_rule_id", "=", query.ruleId);
    if (query.status !== undefined) q = q.where("e.status", "=", query.status);
    if (query.transformationId !== undefined) q = q.where("e.transformation_id", "=", query.transformationId);
    if (after)
      q = q.where(sql<boolean>`(e.started_at, e.id) < (${String(after[0])}::timestamptz, ${String(after[1])}::uuid)`);
    const rows = await q
      .orderBy("e.started_at", "desc")
      .orderBy("e.id", "desc")
      .limit(query.limit + 1)
      .execute();
    const pageRows = paginate(rows, query.limit, (r) => [r.started_key, r.id], hash);
    const results = await resultsOf(
      db,
      pageRows.items.map((r) => r.id),
    );
    return {
      items: pageRows.items.map((r) => presentExecution(r, results.get(r.id) ?? [])),
      nextCursor: pageRows.nextCursor,
    };
  });

  app.get(ONE, { config: read }, async (request) => {
    const { executionId } = parse(executionParams, request.params, "params");
    const principal = principalOf(request);
    requireReader(principal);
    return loadExecutionForRead(db, principal, executionId);
  });

  return [`GET ${EXECUTIONS}`, `GET ${ONE}`];
}
