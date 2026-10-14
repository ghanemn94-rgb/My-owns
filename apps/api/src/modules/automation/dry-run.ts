// Dry runs of a draft rule version (OpenAPI tag `automation`; ADR-0043 §2, §3, §4, §8, §9; REQ-S12-002 "a dry-run
// creates no tasks"; M0155 "Preview/Test"; p5-work-split §D.2; T-DG5-BE-H2):
//   GET  /admin/automation-rules/{ruleId}/versions/{versionNo}/dry-runs   listAutomationDryRuns (automation.read)
//   POST /admin/automation-rules/{ruleId}/versions/{versionNo}/dry-runs   runAutomationDryRun   (automation.configure)
//
// A dry run evaluates the draft against a SAMPLE event (synthetic data) in two transactions:
//  1. a READ ONLY transaction that is always ROLLED BACK: the sample is validated against the trigger's payload schema,
//     the conditions are evaluated (conditions.ts, decimal.js), and each action's registry planner says what it would
//     do (target, recipients, idempotency key) and whether the acting identity may (ADR-0043 §3). Nothing can be
//     written there: PostgreSQL refuses any write in a read-only transaction, and the transaction is rolled back;
//  2. a write transaction that re-checks authorization on reloaded grants (commit time), locks the version, refuses
//     a version that stopped being a draft (409 not_editable) or whose content changed meanwhile (409 version_conflict),
//     and inserts ONLY the append-only `automation_dry_run` row with its audit event `automation_dry_run.create`.
// Never a work item, notification, execution or business record (the integration test counts them before and after).
//
// Outcome: `pass` when the sample's conditions could be evaluated and every planned action `would_run`; otherwise
// `fail` with its findings (code, pointer, en/ar message). Conditions that are cleanly NOT met still pass
// (`conditionsMet: false`): the rule is valid, it just would not act on this sample; the actions are planned all the
// same, so their permission checks always run. Leaving `draft` needs a `pass` run of the current content hash
// (lifecycle.ts; 0074 automation_rule_version_dry_run_required).
//
// A dry run is a create of an append-only record: no If-Match (the BE-B2 runSourceCoverageCheck precedent, D-146);
// the content-hash binding (0074 automation_dry_run_current_draft) refuses a stale run.
import type { AutomationRuleRow, AutomationRuleVersionRow, Db, DbOrTx } from "@mth/db";
import type { Permission } from "@mth/shared";
import { outboxPayloadSchema, type AutomationDryRun, type AutomationPlannedAction } from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { auditContextOf, holdsAnywhere, principalOf } from "../access/index.ts";
import { record } from "../audit/index.ts";
import {
  cursorSchema,
  decodeCursor,
  filterHash,
  iso,
  limitSchema,
  paginate,
  parse,
  parseBody,
  parseQuery,
  problems,
  type ModuleDeps,
} from "../platform/index.ts";
import { loadCatalogueRows, type CatalogueRows } from "./catalogue.ts";
import { evaluateConditions } from "./conditions.ts";
import { loadVersion, versionParams } from "./lifecycle.ts";
import { automationActionRegistry, type AutomationIdentity, type AutomationPlanContext } from "./registry.ts";
import { loadRuleForRead, loadRuleForWrite, requireRuleReader } from "./rules.ts";
import { automationRefusals, contentOfRow, VERSION, versionPath } from "./versions.ts";

const JSON_BODY = ["application/json"] as const;
const DRY_RUNS = `${VERSION}/dry-runs`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The largest sample payload accepted (bytes of its JSON); a sample is a single synthetic event. */
const MAX_SAMPLE_BYTES = 16_384;

// ------------------------------------------------------------------------------------------------ refusals and findings

export const dryRunRefusals = {
  sampleInvalid: () =>
    problems.businessRule(
      "automation.dry_run_sample_invalid",
      "The sample event does not match the trigger's event fields.",
    ),
} as const;

/** The finding texts (ADR-0043 §9 English; Arabic translated here, rule 6). */
const FINDING_TEXT: Readonly<Record<string, { en: string; ar: string }>> = {
  "automation.condition_unknown_value": {
    en: "A condition could not be evaluated because the event has no usable value.",
    ar: "تعذّر تقييم شرط لأن الحدث لا يحتوي على قيمة صالحة للاستخدام.",
  },
  "automation.action_forbidden": {
    en: "The acting identity lacks the permission for this action, or its target is outside the rule's scope.",
    ar: "تفتقر الهوية المنفِّذة إلى الصلاحية اللازمة لهذا الإجراء، أو أن هدفه يقع خارج نطاق القاعدة.",
  },
  "automation_rule.action_parameters_invalid": {
    en: "The action's settings are not valid for its type.",
    ar: "إعدادات الإجراء غير صالحة لنوعه.",
  },
};

type Finding = AutomationDryRun["findings"][number];
const finding = (code: string, pointer: string): Finding => {
  const t = new Map(Object.entries(FINDING_TEXT)).get(code) ?? { en: code, ar: code };
  return { code, pointer, messageEn: t.en, messageAr: t.ar };
};

// ------------------------------------------------------------------------------------------------ evaluation

const dryRunRequest = z.strictObject({
  triggerCode: z.string().min(1).max(100),
  payload: z.record(z.string(), z.unknown()),
});
type DryRunRequest = z.infer<typeof dryRunRequest>;

interface Evaluation {
  readonly contentSha256: string;
  readonly conditionsMet: boolean | null;
  readonly plannedActions: AutomationPlannedAction[];
  readonly findings: Finding[];
}

/** The sample must name one of the version's triggers and carry that trigger's event fields (422 otherwise). */
function validateSample(version: AutomationRuleVersionRow, sample: DryRunRequest, catalogue: CatalogueRows): void {
  const trigger = catalogue.triggers.get(sample.triggerCode);
  if (trigger === undefined || !version.trigger_codes.includes(sample.triggerCode))
    throw dryRunRefusals.sampleInvalid();
  if (Buffer.byteLength(JSON.stringify(sample.payload), "utf8") > MAX_SAMPLE_BYTES)
    throw dryRunRefusals.sampleInvalid();
  const schema = trigger.trigger_kind === "event" ? outboxPayloadSchema(sample.triggerCode, 1) : null;
  if (schema !== null) {
    if (!schema.safeParse(sample.payload).success) throw dryRunRefusals.sampleInvalid();
    return;
  }
  // No payload schema (a schedule tick, or an event whose schema a later slice adds): only the trigger's condition
  // fields, its initiating-user field and the transformation it concerns, each a scalar.
  const allowed = new Set<string>([...trigger.condition_fields, "transformationId"]);
  if (trigger.initiating_user_field !== null) allowed.add(trigger.initiating_user_field);
  for (const [k, v] of Object.entries(sample.payload)) {
    if (!allowed.has(k)) throw dryRunRefusals.sampleInvalid();
    if (v !== null && !["string", "number", "boolean"].includes(typeof v)) throw dryRunRefusals.sampleInvalid();
  }
}

/** Plans `starter_handler`: it calls the starter's DG4 handler unchanged (ADR-0044 §1); nothing to check here. */
function planStarterHandler(ordinal: number, key: string, handlers: readonly string[]): AutomationPlannedAction {
  return {
    ordinal,
    actionType: "starter_handler",
    outcome: "would_run",
    target: { handlers: [...handlers] },
    idempotencyKey: key,
    messageKey: null,
  };
}

/** Steps 1: validation, conditions and planning inside a read-only transaction that is rolled back. */
async function evaluate(
  tx: DbOrTx,
  rule: AutomationRuleRow,
  version: AutomationRuleVersionRow,
  sample: DryRunRequest,
  callerOrganizationId: string | null,
  dryRunId: string,
): Promise<Evaluation> {
  const catalogue = await loadCatalogueRows(tx);
  validateSample(version, sample, catalogue);
  const trigger = catalogue.triggers.get(sample.triggerCode);
  const content = contentOfRow(version);
  const payload = sample.payload;
  const payloadMember = (k: string): unknown => new Map(Object.entries(payload)).get(k);
  // The identity the rule would run as (ADR-0043 §3).
  let identity: AutomationIdentity;
  if (content.runAs === "initiating_user") {
    const field = trigger?.initiating_user_field ?? null;
    const userId = field === null ? undefined : payloadMember(field);
    if (typeof userId !== "string" || !UUID.test(userId)) throw dryRunRefusals.sampleInvalid();
    identity = { runAs: "initiating_user", userId };
  } else identity = { runAs: "service", permissions: content.servicePermissionCodes as Permission[] };
  const sampleTransformation = payloadMember("transformationId");
  const transformationId =
    typeof sampleTransformation === "string" && UUID.test(sampleTransformation)
      ? sampleTransformation
      : rule.transformation_id;
  const conditions = evaluateConditions(content.conditions, payload);
  const findings: Finding[] = conditions.findings.map((f) => finding(f.code, f.pointer));
  const triggerKey = `dry-run:${dryRunId}`;
  const plannedActions: AutomationPlannedAction[] = [];
  for (const [i, action] of content.actions.entries()) {
    const ordinal = i + 1;
    const key = `automation:${rule.code}:${triggerKey}:${ordinal}`;
    if (action.type === "starter_handler") {
      plannedActions.push(planStarterHandler(ordinal, key, action.handlers ?? []));
      continue;
    }
    const descriptor = automationActionRegistry().get(action.type);
    const parsed = descriptor?.parametersSchema.safeParse(action.parameters ?? {});
    let planned: AutomationPlannedAction;
    if (descriptor === undefined || parsed === undefined || !parsed.success) {
      planned = {
        ordinal,
        actionType: action.type,
        outcome: "invalid",
        target: {},
        idempotencyKey: key,
        messageKey: null,
      };
    } else {
      const ctx: AutomationPlanContext = {
        ruleCode: rule.code,
        triggerCode: sample.triggerCode,
        triggerKey,
        ordinal,
        scope: {
          level: rule.scope_level as AutomationPlanContext["scope"]["level"],
          organizationId: rule.organization_id,
          transformationId: rule.transformation_id,
        },
        organizationId: rule.organization_id ?? callerOrganizationId,
        transformationId,
        payload,
        parameters: parsed.data,
        identity,
      };
      planned = await descriptor.plan(tx, ctx);
    }
    plannedActions.push(planned);
    if (planned.outcome === "forbidden") findings.push(finding("automation.action_forbidden", `/actions/${i}`));
    if (planned.outcome === "invalid")
      findings.push(finding("automation_rule.action_parameters_invalid", `/actions/${i}`));
  }
  return {
    contentSha256: version.content_sha256,
    conditionsMet: conditions.findings.length > 0 ? null : conditions.met,
    plannedActions,
    findings,
  };
}

/** Thrown to roll the read-only evaluation transaction back with its result. */
class RolledBack {
  readonly evaluation: Evaluation;
  constructor(evaluation: Evaluation) {
    this.evaluation = evaluation;
  }
}

// ------------------------------------------------------------------------------------------------ presenter

type DryRunRow = {
  id: string;
  automation_rule_version_id: string;
  content_sha256: string;
  outcome: string;
  conditions_met: boolean | null;
  planned_actions: unknown;
  findings: unknown;
  run_by: string;
  created_at: Date;
};

export function toDryRun(d: DryRunRow): AutomationDryRun {
  return {
    id: d.id,
    versionId: d.automation_rule_version_id,
    contentSha256: d.content_sha256,
    outcome: d.outcome as AutomationDryRun["outcome"],
    conditionsMet: d.conditions_met,
    plannedActions: d.planned_actions as AutomationDryRun["plannedActions"],
    findings: d.findings as AutomationDryRun["findings"],
    runBy: d.run_by,
    createdAt: iso(d.created_at),
  };
}

// ------------------------------------------------------------------------------------------------ run

async function runDryRun(db: Db, request: FastifyRequest, ruleId: string, versionNo: number) {
  const principal = principalOf(request);
  requireRuleReader(principal);
  if (!holdsAnywhere(principal, "automation.configure")) throw problems.forbidden();
  const sample = parseBody(dryRunRequest, request.body);
  const id = uuidv7();
  // 1. Read-only, rolled back.
  let evaluation: Evaluation;
  try {
    await db
      .transaction()
      .setAccessMode("read only")
      .execute(async (tx) => {
        const rule = await loadRuleForRead(tx, principal, ruleId);
        const version = await loadVersion(tx, rule.id, versionNo);
        if (version.status !== "draft") throw automationRefusals.notEditable();
        throw new RolledBack(await evaluate(tx, rule, version, sample, principal.organizationId, id));
      });
    throw new Error("dry run: the evaluation transaction must roll back");
  } catch (err) {
    if (!(err instanceof RolledBack)) throw err;
    evaluation = err.evaluation;
  }
  const outcome = evaluation.findings.length === 0 ? "pass" : "fail";
  // 2. Commit-time authorization; the version must still be this draft; only the dry-run row and its audit event.
  return db.transaction().execute(async (tx) => {
    const { rule, actor } = await loadRuleForWrite(tx, request, ruleId);
    const version = await loadVersion(tx, rule.id, versionNo, true);
    if (version.status !== "draft") throw automationRefusals.notEditable();
    if (version.content_sha256 !== evaluation.contentSha256) throw problems.versionConflict(version.version);
    const row = await tx
      .insertInto("automation_dry_run")
      .values({
        id,
        automation_rule_version_id: version.id,
        content_sha256: version.content_sha256,
        sample_event: JSON.stringify({ triggerCode: sample.triggerCode, payload: sample.payload }),
        outcome,
        conditions_met: evaluation.conditionsMet,
        planned_actions: JSON.stringify(evaluation.plannedActions),
        findings: JSON.stringify(evaluation.findings),
        run_by: actor.userId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await record(tx, auditContextOf(request), {
      action: "automation_dry_run.create",
      recordType: "automation_dry_run",
      recordId: id,
      organizationId: rule.organization_id,
      transformationId: rule.transformation_id,
      newVersion: 1,
      changes: {
        automation_rule_version_id: { from: null, to: version.id },
        content_sha256: { from: null, to: version.content_sha256 },
        outcome: { from: null, to: outcome },
      },
    });
    return row;
  });
}

// ------------------------------------------------------------------------------------------------ routes

const listQuery = z.strictObject({ cursor: cursorSchema, limit: limitSchema });

/** Registers this file's routes and returns them as "METHOD /path". */
export function registerAutomationDryRunRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const read = { access: { permission: "automation.read" as const } };
  const configure = { access: { permission: "automation.configure" as const } };

  app.get(DRY_RUNS, { config: read }, async (request) => {
    const { ruleId, versionNo } = parse(versionParams, request.params, "params");
    const query = parseQuery(listQuery, request.query);
    const principal = principalOf(request);
    requireRuleReader(principal);
    const rule = await loadRuleForRead(db, principal, ruleId);
    const version = await loadVersion(db, rule.id, versionNo);
    const hash = filterHash({ ruleId, versionNo });
    const after = decodeCursor(query.cursor, hash, 1);
    // Newest first by id: ids are UUIDv7, time-ordered (ADR-0003), so the order is the creation order without the
    // microsecond loss of a timestamp cursor.
    let q = db.selectFrom("automation_dry_run").selectAll().where("automation_rule_version_id", "=", version.id);
    if (after) q = q.where("id", "<", String(after[0]));
    const rows = await q
      .orderBy("id", "desc")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.id], hash);
    return { items: page.items.map(toDryRun), nextCursor: page.nextCursor };
  });

  app.post(DRY_RUNS, { config: { ...configure, consumes: JSON_BODY } }, async (request, reply) => {
    const { ruleId, versionNo } = parse(versionParams, request.params, "params");
    const row = await runDryRun(db, request, ruleId, versionNo);
    reply.header("Location", `${versionPath(ruleId, versionNo)}/dry-runs/${row.id}`);
    return reply.status(201).send(toDryRun(row));
  });

  return [`GET ${DRY_RUNS}`, `POST ${DRY_RUNS}`];
}
