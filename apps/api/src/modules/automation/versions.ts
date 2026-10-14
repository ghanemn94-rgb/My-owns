// Automation rule versions (OpenAPI tag `automation`; ADR-0043 §1, §2, §4, §8, §9; REQ-S12-001, REQ-S12-002,
// REQ-S12-026; p5-work-split §D.1; T-DG5-BE-H):
//   GET   /admin/automation-rules/{ruleId}/versions               listAutomationRuleVersions  (automation.read)
//   POST  /admin/automation-rules/{ruleId}/versions               createAutomationRuleVersion (automation.configure;
//                                                                  If-Match = the rule's version)
//   GET   /admin/automation-rules/{ruleId}/versions/{versionNo}   getAutomationRuleVersion    (automation.read)
//   PATCH /admin/automation-rules/{ruleId}/versions/{versionNo}   updateAutomationRuleVersion (automation.configure;
//                                                                  If-Match = the version's version)
// Also the shared parts of rules.ts: content validation (the ADR-0043 §9 refusals, human-only first), the canonical
// content hash, the readable en/ar summary and the version presenter.
//
// Every write: authorization re-checked on grants reloaded inside the transaction; Zod validation; If-Match (428
// missing, 409 stale); one audit event per row written, in the same transaction; no remote I/O. A version's content
// changes only while it is a draft; published versions never change (the 0074 guard refuses it again). A configuration
// review of a rule version is not a business approval, and no rule can automate one (REQ-S12-026).
import { createHash } from "node:crypto";
import { sql, type AutomationRuleRow, type AutomationRuleVersionRow, type DbOrTx, type Tx } from "@mth/db";
import { APPROVAL_CATEGORIES, PERMISSIONS, PROBLEM_TYPES, type Permission } from "@mth/shared";
import {
  AUTOMATION_DECIMAL_PATTERN,
  automationRuleVersionCreate,
  automationRuleVersionUpdate,
  emptyStarterParameters,
  normalizeAutomationContent,
  STARTER_PARAMETER_SCHEMAS,
  type AutomationCondition,
  type AutomationDryRun,
  type AutomationRuleContentInput,
  type AutomationRuleContentStored,
  type AutomationRuleSummary,
  type AutomationRuleVersion,
} from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { auditContextOf, principalOf } from "../access/index.ts";
import { record } from "../audit/index.ts";
import {
  cursorSchema,
  decodeCursor,
  filterHash,
  HttpProblem,
  iso,
  isoOrNull,
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
import { loadCatalogueRows, type CatalogueRows } from "./catalogue.ts";
import { refuseHumanOnlyActions } from "./human-only.ts";
import { automationActionRegistry } from "./registry.ts";
// rules.ts imports this file too; only functions cross the cycle (nothing here reads a rules.ts binding at load time).
import { loadRuleForRead, loadRuleForWrite, requireRuleReader, ruleParams } from "./rules.ts";

const JSON_BODY = ["application/json"] as const;
export const VERSIONS = "/api/v1/admin/automation-rules/:ruleId/versions";
export const VERSION = `${VERSIONS}/:versionNo`;
export const versionPath = (ruleId: string, versionNo: number) =>
  `/api/v1/admin/automation-rules/${ruleId}/versions/${versionNo}`;

// ------------------------------------------------------------------------------------------------ refusals (§9)

/** The ADR-0043 §9 refusals with their exact English texts (p5-work-split §2 rule 15). */
export const automationRefusals = {
  triggerUnknown: () =>
    problems.businessRule("automation_rule.trigger_unknown", "The trigger is not one an automation rule can use."),
  actionUnknown: () =>
    problems.businessRule("automation_rule.action_unknown", "The action is not one an automation rule can use."),
  conditionInvalid: () =>
    problems.businessRule(
      "automation_rule.condition_invalid",
      "A condition must test a field of the trigger with a valid operator and value.",
    ),
  actionParametersInvalid: () =>
    problems.businessRule(
      "automation_rule.action_parameters_invalid",
      "The action's settings are not valid for its type.",
    ),
  initiatingUserUnavailable: () =>
    problems.businessRule(
      "automation_rule.initiating_user_unavailable",
      "This trigger has no initiating user; run the rule as the service identity.",
    ),
  servicePermissionForbidden: () =>
    problems.businessRule(
      "automation_rule.service_permission_forbidden",
      "A rule's service identity cannot hold an approval or Finance validation right.",
    ),
  scopeInvalid: () =>
    problems.businessRule(
      "automation_rule.scope_invalid",
      "A rule applies to one organization or one transformation in your scope.",
    ),
  guaranteeProtected: () =>
    problems.businessRule(
      "automation_rule.guarantee_protected",
      "This starter automation implements a guarantee approved in an earlier stage and cannot be disabled. You can change its settings in a new version.",
    ),
  starterFixed: () =>
    problems.businessRule(
      "automation_rule.starter_fixed",
      "A starter automation keeps its trigger and handler and takes no conditions; only its settings can change.",
    ),
  noEffectiveVersion: () =>
    problems.businessRule("automation_rule.no_effective_version", "Publish a version before enabling the rule."),
  codeTaken: () => problems.duplicate("automation_rule.code_taken", "A rule with this code already exists."),
  draftExists: () =>
    problems.duplicate("automation_rule_version.draft_exists", "This rule already has an open version."),
  notEditable: () =>
    new HttpProblem({
      status: 409,
      type: PROBLEM_TYPES.invalidTransition,
      code: "automation_rule_version.not_editable",
      title: "Not editable",
      detail: "Only a draft version can be changed; published versions never change.",
    }),
} as const;

// ------------------------------------------------------------------------------------------------ content hash (§1)

/** Code-point order (ADR-0039 §1 canonical JSON rules). */
function compareCodePoints(a: string, b: string): number {
  const x = Array.from(a, (c) => c.codePointAt(0) ?? 0);
  const y = Array.from(b, (c) => c.codePointAt(0) ?? 0);
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i += 1) {
    const d = (x.at(i) ?? 0) - (y.at(i) ?? 0);
    if (d !== 0) return d;
  }
  return x.length - y.length;
}

/** Canonical JSON: keys sorted by code point, no insignificant whitespace, integers only (decimals are strings). */
export function canonicalAutomationJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("automation content hash: numbers must be integers");
    return String(value);
  }
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalAutomationJson(v)).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => compareCodePoints(a, b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalAutomationJson(v)}`).join(",")}}`;
  }
  throw new Error(`automation content hash: unsupported value of type ${typeof value}`);
}

/**
 * `content_sha256` (ADR-0043 §1): SHA-256 (hex) of the UTF-8 canonical JSON of
 * {triggerCodes, conditions, actions, runAs, servicePermissionCodes, parameters}.
 */
export function automationContentSha256(c: AutomationRuleContentStored): string {
  const canonical = canonicalAutomationJson({
    triggerCodes: c.triggerCodes,
    conditions: c.conditions,
    actions: c.actions,
    runAs: c.runAs,
    servicePermissionCodes: c.servicePermissionCodes,
    parameters: c.parameters,
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/** True when a JSON value holds only integers among its numbers (the hash refuses floats). */
function integersOnly(value: unknown): boolean {
  if (typeof value === "number") return Number.isSafeInteger(value);
  if (Array.isArray(value)) return value.every(integersOnly);
  if (value !== null && typeof value === "object") return Object.values(value).every(integersOnly);
  return true;
}

// ------------------------------------------------------------------------------------------------ content (§2, §3)

export function contentOfRow(v: AutomationRuleVersionRow): AutomationRuleContentStored {
  return {
    triggerCodes: [...v.trigger_codes],
    conditions: v.conditions as AutomationCondition[],
    actions: v.actions as AutomationRuleContentStored["actions"],
    runAs: v.run_as as AutomationRuleContentStored["runAs"],
    servicePermissionCodes: [...v.service_permission_codes],
    parameters: v.parameters as Record<string, unknown>,
  };
}

const isApprovalRight = (code: string): boolean => {
  const category = new Map<string, string>(Object.entries(PERMISSIONS)).get(code);
  return category !== undefined && (APPROVAL_CATEGORIES as readonly string[]).includes(category);
};

function conditionValueValid(c: AutomationCondition): boolean {
  switch (c.op) {
    case "present":
    case "absent":
      return c.value === undefined;
    case "eq":
    case "neq":
      return typeof c.value === "string" || typeof c.value === "boolean";
    case "in":
      return Array.isArray(c.value);
    case "gt":
    case "gte":
    case "lt":
    case "lte":
      return typeof c.value === "string" && AUTOMATION_DECIMAL_PATTERN.test(c.value);
    default:
      return false;
  }
}

/** The shape of a starter's fixed part (everything but `parameters`). */
const fixedPartOf = (c: AutomationRuleContentStored) =>
  canonicalAutomationJson({
    triggerCodes: c.triggerCodes,
    conditions: c.conditions,
    actions: c.actions,
    runAs: c.runAs,
    servicePermissionCodes: c.servicePermissionCodes,
  });

/**
 * Validates parsed content for `rule` and returns it normalized. Refusal order: human-only first (REQ-S12-026), then
 * the starter's fixed part, triggers, conditions, actions and their settings, identity and service permissions.
 * `fixed` is the content a starter version must keep (its current content); null for admin rules.
 */
export function validateContent(
  rule: Pick<AutomationRuleRow, "origin" | "code">,
  input: AutomationRuleContentInput,
  catalogue: CatalogueRows,
  fixed: AutomationRuleContentStored | null,
): AutomationRuleContentStored {
  refuseHumanOnlyActions(input.actions);
  const c = normalizeAutomationContent(input);
  if (rule.origin === "starter") {
    // D-142 Q3, ADR-0044 §1: a starter keeps its triggers and handler and takes no condition; only its settings change.
    if (fixed === null || fixedPartOf(c) !== fixedPartOf(fixed)) throw automationRefusals.starterFixed();
    const schema = new Map(Object.entries(STARTER_PARAMETER_SCHEMAS)).get(rule.code) ?? emptyStarterParameters;
    if (!schema.safeParse(c.parameters).success) throw automationRefusals.actionParametersInvalid();
    return c;
  }
  // Triggers: catalogued, offered to admin rules, not repeated.
  const triggers = c.triggerCodes.map((code) => catalogue.triggers.get(code));
  if (
    new Set(c.triggerCodes).size !== c.triggerCodes.length ||
    triggers.some((t) => t === undefined || !t.admin_selectable)
  )
    throw automationRefusals.triggerUnknown();
  const present = triggers.filter((t) => t !== undefined);
  // Conditions test only fields common to every trigger, with an operator and value of the right shape.
  const common = present
    .map((t) => new Set(t.condition_fields))
    .reduce((acc, s) => new Set([...acc].filter((f) => s.has(f))));
  for (const cond of c.conditions)
    if (!common.has(cond.field) || !conditionValueValid(cond)) throw automationRefusals.conditionInvalid();
  // Actions: automatic, admin-selectable, registered by their owning module; settings valid for the type.
  for (const action of c.actions) {
    const type = catalogue.actions.get(action.type);
    const descriptor = automationActionRegistry().get(action.type);
    if (type === undefined || type.action_class !== "automatic" || !type.admin_selectable || descriptor === undefined)
      throw automationRefusals.actionUnknown();
    if (action.handlers !== undefined || !descriptor.parametersSchema.safeParse(action.parameters ?? {}).success)
      throw automationRefusals.actionParametersInvalid();
  }
  // Version-level parameters are starter settings; an admin rule has none.
  if (Object.keys(c.parameters).length > 0 || !integersOnly(c.actions))
    throw automationRefusals.actionParametersInvalid();
  // Identity (ADR-0043 §3).
  if (c.runAs === "initiating_user" && present.some((t) => t.initiating_user_field === null))
    throw automationRefusals.initiatingUserUnavailable();
  if (c.servicePermissionCodes.some(isApprovalRight)) throw automationRefusals.servicePermissionForbidden();
  return c;
}

// ------------------------------------------------------------------------------------------------ summary (en/ar)

const OP_EN: Readonly<Record<string, string>> = {
  eq: "is",
  neq: "is not",
  in: "is one of",
  gt: "is greater than",
  gte: "is at least",
  lt: "is less than",
  lte: "is at most",
  present: "is present",
  absent: "is absent",
};
const OP_AR: Readonly<Record<string, string>> = {
  eq: "يساوي",
  neq: "لا يساوي",
  in: "أحد القيم",
  gt: "أكبر من",
  gte: "لا يقل عن",
  lt: "أقل من",
  lte: "لا يزيد على",
  present: "موجود",
  absent: "غير موجود",
};

const valueText = (v: AutomationCondition["value"], lang: "en" | "ar"): string => {
  if (v === undefined) return "";
  if (Array.isArray(v)) return ` ${v.join(lang === "en" ? ", " : "، ")}`;
  if (typeof v === "boolean") return lang === "en" ? ` ${v ? "true" : "false"}` : ` ${v ? "صحيح" : "خطأ"}`;
  return ` ${v}`;
};

const lookup = (m: Readonly<Record<string, string>>, k: string): string => new Map(Object.entries(m)).get(k) ?? k;

/** The readable summary of content (REQ-S12-002 "readable rule builder"), rendered from the catalogue labels. */
export function summarize(c: AutomationRuleContentStored, catalogue: CatalogueRows): AutomationRuleSummary {
  const trig = (lang: "en" | "ar") =>
    c.triggerCodes
      .map((code) => {
        const t = catalogue.triggers.get(code);
        return t === undefined ? code : lang === "en" ? t.label_en : t.label_ar;
      })
      .join(lang === "en" ? " or " : " أو ");
  const cond = (lang: "en" | "ar") =>
    c.conditions
      .map((x) => `${x.field} ${lookup(lang === "en" ? OP_EN : OP_AR, x.op)}${valueText(x.value, lang)}`)
      .join(lang === "en" ? " and " : " و");
  const act = (lang: "en" | "ar") =>
    c.actions
      .map((a) => {
        const t = catalogue.actions.get(a.type);
        const label = t === undefined ? a.type : lang === "en" ? t.label_en : t.label_ar;
        const p = new Map(Object.entries(a.parameters ?? {}));
        const role = p.get("assigneeRole") ?? p.get("recipientRole") ?? p.get("toRole");
        const detail = typeof role === "string" ? role : a.handlers !== undefined ? a.handlers.join(", ") : null;
        return detail === null ? label : `${label} (${detail})`;
      })
      .join(lang === "en" ? "; " : "؛ ");
  const conditionsEn = c.conditions.length > 0 ? `, if ${cond("en")}` : "";
  const conditionsAr = c.conditions.length > 0 ? `، إذا كان ${cond("ar")}` : "";
  const asEn = c.runAs === "service" ? "the service identity" : "the user who caused the event";
  const asAr = c.runAs === "service" ? "هوية الخدمة" : "المستخدم الذي تسبب في الحدث";
  return {
    en: `When ${trig("en")}${conditionsEn}: ${act("en")}. Runs as ${asEn}.`,
    ar: `عند ${trig("ar")}${conditionsAr}: ${act("ar")}. يعمل بصفة ${asAr}.`,
  };
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

function presentDryRun(d: DryRunRow): AutomationDryRun {
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

/** Versions as the contract's AutomationRuleVersion (newest dry run each; whether a pass run covers the content). */
export async function toRuleVersions(
  db: DbOrTx,
  rows: readonly AutomationRuleVersionRow[],
  catalogue?: CatalogueRows,
): Promise<AutomationRuleVersion[]> {
  if (rows.length === 0) return [];
  const cat = catalogue ?? (await loadCatalogueRows(db));
  const runs = await db
    .selectFrom("automation_dry_run")
    .select([
      "id",
      "automation_rule_version_id",
      "content_sha256",
      "outcome",
      "conditions_met",
      "planned_actions",
      "findings",
      "run_by",
      "created_at",
    ])
    .where(
      "automation_rule_version_id",
      "in",
      rows.map((r) => r.id),
    )
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .execute();
  const latest = new Map<string, DryRunRow>();
  const passFor = new Set<string>();
  for (const r of runs) {
    if (!latest.has(r.automation_rule_version_id)) latest.set(r.automation_rule_version_id, r);
    if (r.outcome === "pass") passFor.add(`${r.automation_rule_version_id}:${r.content_sha256}`);
  }
  return rows.map((v) => {
    const content = contentOfRow(v);
    const last = latest.get(v.id);
    return {
      id: v.id,
      ruleId: v.automation_rule_id,
      versionNo: v.version_no,
      status: v.status as AutomationRuleVersion["status"],
      content: {
        triggerCodes: content.triggerCodes,
        conditions: content.conditions,
        actions: content.actions,
        runAs: content.runAs,
        servicePermissionCodes: content.servicePermissionCodes as Permission[],
        parameters: content.parameters,
      },
      contentSha256: v.content_sha256,
      changeSummary: v.change_summary,
      lastDryRun: last === undefined ? null : presentDryRun(last),
      dryRunCurrent: passFor.has(`${v.id}:${v.content_sha256}`),
      authoredBy: v.authored_by,
      submittedAt: isoOrNull(v.submitted_at),
      reviewedBy: v.reviewed_by,
      reviewedAt: isoOrNull(v.reviewed_at),
      reviewNote: v.review_note,
      publishedBy: v.published_by,
      publishedAt: isoOrNull(v.published_at),
      supersededAt: isoOrNull(v.superseded_at),
      discardedAt: isoOrNull(v.discarded_at),
      summary: summarize(content, cat),
      version: v.version,
      updatedAt: iso(v.updated_at),
    };
  });
}

export async function toRuleVersion(db: DbOrTx, row: AutomationRuleVersionRow): Promise<AutomationRuleVersion> {
  const [one] = await toRuleVersions(db, [row]);
  if (one === undefined) throw new Error("toRuleVersion: no row");
  return one;
}

// ------------------------------------------------------------------------------------------------ writes

/** Inserts draft `versionNo` of `ruleId` with `content` (hash recomputed) and its audit event. */
export async function insertDraftVersion(
  tx: Tx,
  request: FastifyRequest,
  rule: Pick<AutomationRuleRow, "id" | "organization_id">,
  versionNo: number,
  content: AutomationRuleContentStored,
  changeSummary: string | null,
  actorUserId: string,
  basedOn: AutomationRuleVersionRow | null,
): Promise<AutomationRuleVersionRow> {
  const id = uuidv7();
  const row = await tx
    .insertInto("automation_rule_version")
    .values({
      id,
      automation_rule_id: rule.id,
      version_no: versionNo,
      status: "draft",
      trigger_codes: content.triggerCodes,
      conditions: JSON.stringify(content.conditions),
      actions: JSON.stringify(content.actions),
      action_types: content.actions.map((a) => a.type),
      run_as: content.runAs,
      service_permission_codes: content.servicePermissionCodes,
      parameters: JSON.stringify(content.parameters),
      content_sha256: automationContentSha256(content),
      change_summary: changeSummary,
      authored_by: actorUserId,
      created_by: actorUserId,
      updated_by: actorUserId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, auditContextOf(request), {
    action: "automation_rule_version.create",
    recordType: "automation_rule_version",
    recordId: id,
    organizationId: rule.organization_id,
    newVersion: 1,
    changes: {
      automation_rule_id: { from: null, to: rule.id },
      version_no: { from: null, to: versionNo },
      based_on_version_id: { from: null, to: basedOn?.id ?? null },
      content_sha256: { from: null, to: row.content_sha256 },
    },
  });
  return row;
}

async function loadVersionRow(
  db: DbOrTx,
  ruleId: string,
  versionNo: number,
  forUpdate = false,
): Promise<AutomationRuleVersionRow> {
  let q = db
    .selectFrom("automation_rule_version")
    .selectAll()
    .where("automation_rule_id", "=", ruleId)
    .where("version_no", "=", versionNo);
  if (forUpdate) q = q.forUpdate();
  const row = await q.executeTakeFirst();
  if (row === undefined) throw problems.notFound();
  return row;
}

async function createVersion(tx: Tx, request: FastifyRequest, ruleId: string): Promise<AutomationRuleVersionRow> {
  const { rule, actor } = await loadRuleForWrite(tx, request, ruleId);
  const body = parseBody(automationRuleVersionCreate, request.body);
  const expected = requireIfMatch(request);
  if (rule.version !== expected) throw problems.versionConflict(rule.version);
  const open = await tx
    .selectFrom("automation_rule_version")
    .select("id")
    .where("automation_rule_id", "=", rule.id)
    .where("status", "in", ["draft", "in_review", "approved"])
    .executeTakeFirst();
  if (open !== undefined) throw automationRefusals.draftExists();
  // Copied from the effective version; a rule without one (its drafts were discarded) copies its newest version.
  const base =
    rule.effective_version_id !== null
      ? await tx
          .selectFrom("automation_rule_version")
          .selectAll()
          .where("id", "=", rule.effective_version_id)
          .executeTakeFirstOrThrow()
      : await tx
          .selectFrom("automation_rule_version")
          .selectAll()
          .where("automation_rule_id", "=", rule.id)
          .orderBy("version_no", "desc")
          .limit(1)
          .executeTakeFirstOrThrow();
  const max = await tx
    .selectFrom("automation_rule_version")
    .select(sql<number>`max(version_no)`.as("n"))
    .where("automation_rule_id", "=", rule.id)
    .executeTakeFirstOrThrow();
  return insertDraftVersion(
    tx,
    request,
    rule,
    Number(max.n) + 1,
    contentOfRow(base),
    body.changeSummary ?? null,
    actor.userId,
    base,
  );
}

const CONTENT_COLUMNS = [
  "trigger_codes",
  "conditions",
  "actions",
  "action_types",
  "run_as",
  "service_permission_codes",
  "parameters",
  "content_sha256",
  "change_summary",
] as const;

async function updateVersion(
  tx: Tx,
  request: FastifyRequest,
  ruleId: string,
  versionNo: number,
): Promise<AutomationRuleVersionRow> {
  const { rule, actor } = await loadRuleForWrite(tx, request, ruleId);
  const body = parseBody(automationRuleVersionUpdate, request.body);
  // REQ-S12-026: refused before anything is locked or written.
  refuseHumanOnlyActions(body.content?.actions);
  const expected = requireIfMatch(request);
  const current = await loadVersionRow(tx, rule.id, versionNo, true);
  if (current.version !== expected) throw problems.versionConflict(current.version);
  if (current.status !== "draft") throw automationRefusals.notEditable();
  const content =
    body.content === undefined
      ? contentOfRow(current)
      : validateContent(rule, body.content, await loadCatalogueRows(tx), contentOfRow(current));
  const updated = await tx
    .updateTable("automation_rule_version")
    .set({
      trigger_codes: content.triggerCodes,
      conditions: JSON.stringify(content.conditions),
      actions: JSON.stringify(content.actions),
      action_types: content.actions.map((a) => a.type),
      run_as: content.runAs,
      service_permission_codes: content.servicePermissionCodes,
      parameters: JSON.stringify(content.parameters),
      content_sha256: automationContentSha256(content),
      ...(body.changeSummary !== undefined ? { change_summary: body.changeSummary } : {}),
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: actor.userId,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  const before = new Map(Object.entries(current));
  const after = new Map(Object.entries(updated));
  const changes = new Map<string, { from: unknown; to: unknown }>();
  for (const col of CONTENT_COLUMNS) {
    const from = before.get(col);
    const to = after.get(col);
    if (JSON.stringify(from) !== JSON.stringify(to)) changes.set(col, { from, to });
  }
  await record(tx, auditContextOf(request), {
    action: "automation_rule_version.update",
    recordType: "automation_rule_version",
    recordId: current.id,
    organizationId: rule.organization_id,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: changes.size > 0 ? Object.fromEntries(changes) : null,
  });
  return updated;
}

// ------------------------------------------------------------------------------------------------ routes

const versionParams = z.strictObject({
  ruleId: z.uuid(),
  versionNo: z.coerce.number().int().min(1).max(2_147_483_647),
});
const listQuery = z.strictObject({ cursor: cursorSchema, limit: limitSchema });

export function registerAutomationVersionRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const read = { access: { permission: "automation.read" as const } };
  const configure = { access: { permission: "automation.configure" as const } };

  app.get(VERSIONS, { config: read }, async (request) => {
    const { ruleId } = parse(ruleParams, request.params, "params");
    const query = parseQuery(listQuery, request.query);
    const principal = principalOf(request);
    requireRuleReader(principal);
    const rule = await loadRuleForRead(db, principal, ruleId);
    const hash = filterHash({ ruleId });
    const after = decodeCursor(query.cursor, hash, 1);
    let q = db.selectFrom("automation_rule_version").selectAll().where("automation_rule_id", "=", rule.id);
    if (after) q = q.where("version_no", "<", Number(after[0]));
    const rows = await q
      .orderBy("version_no", "desc")
      .limit(query.limit + 1)
      .execute();
    const pageRows = paginate(rows, query.limit, (r) => [r.version_no], hash);
    return { items: await toRuleVersions(db, pageRows.items), nextCursor: pageRows.nextCursor };
  });

  app.post(VERSIONS, { config: { ...configure, consumes: JSON_BODY } }, async (request, reply) => {
    const { ruleId } = parse(ruleParams, request.params, "params");
    const row = await db.transaction().execute((tx) => createVersion(tx, request, ruleId));
    return sendVersioned(reply, 201, await toRuleVersion(db, row), versionPath(ruleId, row.version_no));
  });

  app.get(VERSION, { config: read }, async (request, reply) => {
    const { ruleId, versionNo } = parse(versionParams, request.params, "params");
    const principal = principalOf(request);
    requireRuleReader(principal);
    const rule = await loadRuleForRead(db, principal, ruleId);
    return sendVersioned(reply, 200, await toRuleVersion(db, await loadVersionRow(db, rule.id, versionNo)));
  });

  app.patch(VERSION, { config: { ...configure, consumes: JSON_BODY } }, async (request, reply) => {
    const { ruleId, versionNo } = parse(versionParams, request.params, "params");
    const row = await db.transaction().execute((tx) => updateVersion(tx, request, ruleId, versionNo));
    return sendVersioned(reply, 200, await toRuleVersion(db, row));
  });

  return [`GET ${VERSIONS}`, `POST ${VERSIONS}`, `GET ${VERSION}`, `PATCH ${VERSION}`];
}
