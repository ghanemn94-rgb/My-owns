// Automation rules (OpenAPI tag `automation`; ADR-0043 §1, §4, §8, §9; REQ-S12-001, REQ-S12-002, REQ-S12-026;
// D-142 Q3; p5-work-split §D.1; T-DG5-BE-H):
//   GET   /admin/automation-rules                    listAutomationRules    (automation.read)
//   POST  /admin/automation-rules                    createAutomationRule   (automation.configure; disabled, draft v1)
//   GET   /admin/automation-rules/{ruleId}           getAutomationRule      (automation.read)
//   PATCH /admin/automation-rules/{ruleId}           updateAutomationRule   (automation.configure; If-Match)
//   POST  /admin/automation-rules/{ruleId}/enable    enableAutomationRule   (automation.configure; If-Match)
//   POST  /admin/automation-rules/{ruleId}/disable   disableAutomationRule  (automation.configure; If-Match; reason)
//
// Scope (ADR-0043 §8): a reader sees the platform starters and the admin rules of the organizations where it holds
// `automation.read` (others are 404, existence not disclosed). A write needs `automation.configure` held in the rule's
// organization (also for a transformation-scoped rule, whose transformation must belong to it; configuration rights
// are organization-level, the Studio precedent); a starter is configured by a holder of `automation.configure` in the
// caller's own organization (ADM_METHOD by default). Every write re-checks that on grants
// reloaded inside its transaction (commit-time authorization), validates, requires If-Match (428/409; a create is
// version 1), writes one audit event per row in the same transaction, and does no remote I/O.
//
// The sixteen starters are guarantees (D-142 Q3): they are never disabled (422 automation_rule.guarantee_protected),
// and only their names change here; their settings change in a new version. Nothing here approves anything: a rule
// can never automate a gate approval, an investment decision or a Finance attestation (REQ-S12-026).
import { sql, type AutomationRuleRow, type AutomationRuleVersionRow, type DbOrTx, type Tx } from "@mth/db";
import { PROBLEM_TYPES, type Permission, type RoleCode } from "@mth/shared";
import {
  automationRuleCreate,
  automationRuleDisable,
  automationRuleListQuery,
  automationRuleUpdate,
  type AutomationRule,
} from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import {
  auditContextOf,
  denialOf,
  holdsAnywhere,
  organizationsWith,
  principalOf,
  refreshPrincipal,
  type Principal,
} from "../access/index.ts";
import { record } from "../audit/index.ts";
import {
  cursorSchema,
  decodeCursor,
  filterHash,
  HttpProblem,
  iso,
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
import { automationRefusals, contentOfRow, insertDraftVersion, summarize, validateContent } from "./versions.ts";

const JSON_BODY = ["application/json"] as const;
export const RULES = "/api/v1/admin/automation-rules";
const ONE = `${RULES}/:ruleId`;
const ENABLE = `${ONE}/enable`;
const DISABLE = `${ONE}/disable`;
export const rulePath = (ruleId: string) => `${RULES}/${ruleId}`;
export const ruleParams = z.strictObject({ ruleId: z.uuid() });

// ------------------------------------------------------------------------------------------------ access

/** `automation.read` held at any scope, else 403. */
export function requireRuleReader(principal: Principal): void {
  if (!holdsAnywhere(principal, "automation.read")) throw problems.forbidden();
}

/** The organizations whose admin rules the principal may read. */
function readerOrganizations(principal: Principal): string[] {
  return organizationsWith(principal, "automation.read");
}

/** The rule if the reader may see it (a starter, or an admin rule of a reader organization), else 404. */
export async function loadRuleForRead(db: DbOrTx, principal: Principal, ruleId: string): Promise<AutomationRuleRow> {
  const rule = await db.selectFrom("automation_rule").selectAll().where("id", "=", ruleId).executeTakeFirst();
  if (rule === undefined) throw problems.notFound();
  if (rule.origin !== "starter" && !readerOrganizations(principal).includes(rule.organization_id ?? ""))
    throw problems.notFound();
  return rule;
}

function denyIn(permission: Permission, organizationId: string | null): HttpProblem {
  const denied = problems.forbidden();
  return organizationId === null
    ? denied
    : denied.withDenial(
        denialOf(permission, {
          level: "organization",
          organizationId,
          businessUnitId: null,
          transformationId: null,
          businessUnitAncestry: [],
        }),
      );
}

/** Commit-time: grants reloaded in `tx`; `automation.configure` held somewhere, else 403. */
async function configurer(tx: Tx, request: FastifyRequest): Promise<{ principal: Principal; userId: string }> {
  const principal = await refreshPrincipal(tx, request);
  if (!holdsAnywhere(principal, "automation.configure") || principal.userId === null)
    throw denyIn("automation.configure", principal.organizationId);
  return { principal, userId: principal.userId };
}

/**
 * May the principal configure rules in this organization? Rules are configuration, so `automation.configure` is
 * decided at the rule's ORGANIZATION (held through a grant of that organization; the Studio and TOM precedent): the
 * admin roles that hold it (ADM_METHOD) do not inherit downward, and a transformation-scoped rule is configured by its
 * organization's administrator. The transformation itself must belong to that organization (checked by the caller).
 */
function mayConfigureIn(principal: Principal, organizationId: string): boolean {
  principal.tracker.decisions += 1;
  return principal.grants.some((g) => g.permissions.has("automation.configure") && g.organizationId === organizationId);
}

export interface RuleAccess {
  readonly rule: AutomationRuleRow;
  readonly actor: { readonly userId: string };
}

/**
 * The rule locked FOR UPDATE for a write, after the commit-time check: `automation.configure` in the rule's scope (a
 * starter: in the caller's organization). An unreadable rule is 404; a readable one without the right is 403.
 */
export async function loadRuleForWrite(tx: Tx, request: FastifyRequest, ruleId: string): Promise<RuleAccess> {
  const { principal, userId } = await configurer(tx, request);
  const rule = await tx
    .selectFrom("automation_rule")
    .selectAll()
    .where("id", "=", ruleId)
    .forUpdate()
    .executeTakeFirst();
  if (rule === undefined) throw problems.notFound();
  if (rule.origin === "starter") {
    principal.tracker.decisions += 1;
    const org = principal.organizationId;
    const allowed =
      org !== null &&
      principal.grants.some((g) => g.permissions.has("automation.configure") && g.organizationId === org);
    if (!allowed) throw denyIn("automation.configure", org);
    return { rule, actor: { userId } };
  }
  if (!readerOrganizations(principal).includes(rule.organization_id ?? "")) throw problems.notFound();
  if (!mayConfigureIn(principal, rule.organization_id ?? ""))
    throw denyIn("automation.configure", rule.organization_id);
  return { rule, actor: { userId } };
}

// ------------------------------------------------------------------------------------------------ presenter

interface RuleFacts {
  readonly versions: ReadonlyMap<string, AutomationRuleVersionRow>;
  readonly open: ReadonlyMap<string, number>;
  readonly catalogue: CatalogueRows;
}

async function loadRuleFacts(db: DbOrTx, rules: readonly AutomationRuleRow[]): Promise<RuleFacts> {
  const catalogue = await loadCatalogueRows(db);
  if (rules.length === 0) return { versions: new Map(), open: new Map(), catalogue };
  const effective = rules.map((r) => r.effective_version_id).filter((id): id is string => id !== null);
  const [versions, open] = await Promise.all([
    effective.length === 0
      ? Promise.resolve([] as AutomationRuleVersionRow[])
      : db.selectFrom("automation_rule_version").selectAll().where("id", "in", effective).execute(),
    db
      .selectFrom("automation_rule_version")
      .select(["automation_rule_id", "version_no"])
      .where(
        "automation_rule_id",
        "in",
        rules.map((r) => r.id),
      )
      .where("status", "in", ["draft", "in_review", "approved"])
      .execute(),
  ]);
  return {
    versions: new Map(versions.map((v) => [v.id, v])),
    open: new Map(open.map((o) => [o.automation_rule_id, o.version_no])),
    catalogue,
  };
}

function presentRule(r: AutomationRuleRow, f: RuleFacts): AutomationRule {
  const effective = r.effective_version_id === null ? undefined : f.versions.get(r.effective_version_id);
  return {
    id: r.id,
    code: r.code,
    origin: r.origin as AutomationRule["origin"],
    sourceRef: r.source_ref,
    nameEn: r.name_en,
    nameAr: r.name_ar,
    descriptionEn: r.description_en,
    descriptionAr: r.description_ar,
    scopeLevel: r.scope_level as AutomationRule["scopeLevel"],
    organizationId: r.organization_id,
    transformationId: r.transformation_id,
    ownerUserId: r.owner_user_id,
    ownerRoleCode: r.owner_role_code as RoleCode | null,
    enabled: r.enabled,
    disableAllowed: r.disable_allowed,
    disabledReason: r.disabled_reason,
    effectiveVersionId: r.effective_version_id,
    effectiveVersionNo: effective?.version_no ?? null,
    openVersionNo: f.open.get(r.id) ?? null,
    summary: effective === undefined ? null : summarize(contentOfRow(effective), f.catalogue),
    version: r.version,
    updatedAt: iso(r.updated_at),
  };
}

export async function toRule(db: DbOrTx, row: AutomationRuleRow): Promise<AutomationRule> {
  return presentRule(row, await loadRuleFacts(db, [row]));
}

// ------------------------------------------------------------------------------------------------ writes

async function assertActiveOwner(db: DbOrTx, userId: string, organizationId: string): Promise<void> {
  const user = await db
    .selectFrom("app_user")
    .select("id")
    .where("id", "=", userId)
    .where("organization_id", "=", organizationId)
    .where("status", "=", "active")
    .executeTakeFirst();
  if (user === undefined)
    throw new HttpProblem({
      status: 422,
      type: PROBLEM_TYPES.validation,
      code: "validation.user_invalid",
      title: "Business rule violated",
      detail: "A named person must be an active user of the rule's organization.",
      errors: [{ pointer: "/ownerUserId", code: "validation.user_invalid", message: "Not an active user." }],
    });
}

async function createRule(
  tx: Tx,
  request: FastifyRequest,
): Promise<{ rule: AutomationRuleRow; version: AutomationRuleVersionRow }> {
  const { principal, userId } = await configurer(tx, request);
  const body = parseBody(automationRuleCreate, request.body);
  // REQ-S12-026: refused before anything else is read or written.
  refuseHumanOnlyActions(body.content.actions);
  // Scope (ADR-0043 §1, §8): one organization, or one transformation of it, where the caller configures rules.
  const transformationId = body.transformationId ?? null;
  if ((body.scopeLevel === "transformation") !== (transformationId !== null)) throw automationRefusals.scopeInvalid();
  if (transformationId !== null) {
    const t = await tx
      .selectFrom("transformation")
      .select("organization_id")
      .where("id", "=", transformationId)
      .executeTakeFirst();
    if (t === undefined || t.organization_id !== body.organizationId) throw automationRefusals.scopeInvalid();
  }
  if (!mayConfigureIn(principal, body.organizationId)) throw automationRefusals.scopeInvalid();
  await assertActiveOwner(tx, body.ownerUserId, body.organizationId);
  const content = validateContent(
    { origin: "admin", code: body.code },
    body.content,
    await loadCatalogueRows(tx),
    null,
  );
  const taken = await tx.selectFrom("automation_rule").select("id").where("code", "=", body.code).executeTakeFirst();
  if (taken !== undefined) throw automationRefusals.codeTaken();
  const id = uuidv7();
  const rule = await tx
    .insertInto("automation_rule")
    .values({
      id,
      code: body.code,
      origin: "admin",
      source_ref: null,
      name_en: body.nameEn,
      name_ar: body.nameAr,
      description_en: body.descriptionEn ?? null,
      description_ar: body.descriptionAr ?? null,
      scope_level: body.scopeLevel,
      organization_id: body.organizationId,
      transformation_id: transformationId,
      owner_user_id: body.ownerUserId,
      owner_role_code: null,
      // An admin rule starts disabled (ADR-0043 §4) and is enabled once a version is published.
      enabled: false,
      disable_allowed: true,
      effective_version_id: null,
      created_by: userId,
      updated_by: userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, auditContextOf(request), {
    action: "automation_rule.create",
    recordType: "automation_rule",
    recordId: id,
    organizationId: body.organizationId,
    transformationId,
    newVersion: 1,
    changes: {
      code: { from: null, to: body.code },
      scope_level: { from: null, to: body.scopeLevel },
      owner_user_id: { from: null, to: body.ownerUserId },
      enabled: { from: null, to: false },
    },
  });
  const version = await insertDraftVersion(tx, request, rule, 1, content, null, userId, null);
  return { rule, version };
}

const NAME_COLUMNS = [
  ["nameEn", "name_en"],
  ["nameAr", "name_ar"],
  ["descriptionEn", "description_en"],
  ["descriptionAr", "description_ar"],
  ["ownerUserId", "owner_user_id"],
] as const;

async function updateRule(tx: Tx, request: FastifyRequest, ruleId: string): Promise<AutomationRuleRow> {
  const { rule, actor } = await loadRuleForWrite(tx, request, ruleId);
  const body = parseBody(automationRuleUpdate, request.body);
  const expected = requireIfMatch(request);
  if (rule.version !== expected) throw problems.versionConflict(rule.version);
  // A starter's names change here; its description and owner role are part of the seeded guarantee (OpenAPI).
  if (
    rule.origin === "starter" &&
    (body.descriptionEn !== undefined || body.descriptionAr !== undefined || body.ownerUserId !== undefined)
  )
    throw automationRefusals.starterFixed();
  if (body.ownerUserId !== undefined) await assertActiveOwner(tx, body.ownerUserId, rule.organization_id ?? "");
  const present = new Map(Object.entries(body));
  const set = new Map<string, unknown>();
  for (const [field, column] of NAME_COLUMNS) if (present.has(field)) set.set(column, present.get(field));
  const updated = await tx
    .updateTable("automation_rule")
    .set({
      ...(Object.fromEntries(set) as Partial<Pick<AutomationRuleRow, (typeof NAME_COLUMNS)[number][1]>>),
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: actor.userId,
    })
    .where("id", "=", rule.id)
    .where("version", "=", rule.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  const before = new Map(Object.entries(rule));
  const after = new Map(Object.entries(updated));
  const changes = new Map<string, { from: unknown; to: unknown }>();
  for (const [, column] of NAME_COLUMNS)
    if (before.get(column) !== after.get(column))
      changes.set(column, { from: before.get(column), to: after.get(column) });
  await record(tx, auditContextOf(request), {
    action: "automation_rule.update",
    recordType: "automation_rule",
    recordId: rule.id,
    organizationId: rule.organization_id,
    transformationId: rule.transformation_id,
    priorVersion: rule.version,
    newVersion: updated.version,
    changes: changes.size > 0 ? Object.fromEntries(changes) : null,
  });
  return updated;
}

async function setEnabled(
  tx: Tx,
  request: FastifyRequest,
  ruleId: string,
  enabled: boolean,
): Promise<AutomationRuleRow> {
  const { rule, actor } = await loadRuleForWrite(tx, request, ruleId);
  const body = enabled ? null : parseBody(automationRuleDisable, request.body);
  const expected = requireIfMatch(request);
  if (rule.version !== expected) throw problems.versionConflict(rule.version);
  if (enabled && rule.effective_version_id === null) throw automationRefusals.noEffectiveVersion();
  // D-142 Q3: the sixteen starters implement approved guarantees and are never disabled.
  if (!enabled && !rule.disable_allowed) throw automationRefusals.guaranteeProtected();
  // Already in the requested state: nothing is written (no version step, no audit event).
  if (rule.enabled === enabled) return rule;
  const updated = await tx
    .updateTable("automation_rule")
    .set({
      enabled,
      disabled_reason: enabled ? null : (body?.reason ?? null),
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: actor.userId,
    })
    .where("id", "=", rule.id)
    .where("version", "=", rule.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, auditContextOf(request), {
    action: enabled ? "automation_rule.enable" : "automation_rule.disable",
    recordType: "automation_rule",
    recordId: rule.id,
    organizationId: rule.organization_id,
    transformationId: rule.transformation_id,
    priorVersion: rule.version,
    newVersion: updated.version,
    ...(body !== null ? { reason: body.reason } : {}),
    changes: {
      enabled: { from: rule.enabled, to: enabled },
      disabled_reason: { from: rule.disabled_reason, to: updated.disabled_reason },
    },
  });
  return updated;
}

// ------------------------------------------------------------------------------------------------ routes

const listQuery = automationRuleListQuery.extend({ cursor: cursorSchema, limit: limitSchema });

export function registerAutomationRuleRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const read = { access: { permission: "automation.read" as const } };
  const configure = { access: { permission: "automation.configure" as const } };

  app.get(RULES, { config: read }, async (request) => {
    const query = parseQuery(listQuery, request.query);
    const principal = principalOf(request);
    requireRuleReader(principal);
    const orgs = readerOrganizations(principal);
    const hash = filterHash({ origin: query.origin, enabled: query.enabled, transformationId: query.transformationId });
    const after = decodeCursor(query.cursor, hash, 1);
    let q = db
      .selectFrom("automation_rule")
      .selectAll()
      .where((eb) =>
        eb.or([
          eb("origin", "=", "starter"),
          orgs.length === 0 ? sql<boolean>`false` : eb("organization_id", "in", orgs),
        ]),
      );
    if (query.origin !== undefined) q = q.where("origin", "=", query.origin);
    if (query.enabled !== undefined) q = q.where("enabled", "=", query.enabled === "true");
    if (query.transformationId !== undefined) q = q.where("transformation_id", "=", query.transformationId);
    if (after) q = q.where("code", ">", String(after[0]));
    const rows = await q
      .orderBy("code")
      .limit(query.limit + 1)
      .execute();
    const pageRows = paginate(rows, query.limit, (r) => [r.code], hash);
    const facts = await loadRuleFacts(db, pageRows.items);
    return { items: pageRows.items.map((r) => presentRule(r, facts)), nextCursor: pageRows.nextCursor };
  });

  app.post(RULES, { config: { ...configure, consumes: JSON_BODY } }, async (request, reply) => {
    const { rule } = await db.transaction().execute((tx) => createRule(tx, request));
    return sendVersioned(reply, 201, await toRule(db, rule), rulePath(rule.id));
  });

  app.get(ONE, { config: read }, async (request, reply) => {
    const { ruleId } = parse(ruleParams, request.params, "params");
    const principal = principalOf(request);
    requireRuleReader(principal);
    return sendVersioned(reply, 200, await toRule(db, await loadRuleForRead(db, principal, ruleId)));
  });

  app.patch(ONE, { config: { ...configure, consumes: JSON_BODY } }, async (request, reply) => {
    const { ruleId } = parse(ruleParams, request.params, "params");
    const row = await db.transaction().execute((tx) => updateRule(tx, request, ruleId));
    return sendVersioned(reply, 200, await toRule(db, row));
  });

  app.post(ENABLE, { config: configure }, async (request, reply) => {
    const { ruleId } = parse(ruleParams, request.params, "params");
    const row = await db.transaction().execute((tx) => setEnabled(tx, request, ruleId, true));
    return sendVersioned(reply, 200, await toRule(db, row));
  });

  app.post(DISABLE, { config: { ...configure, consumes: JSON_BODY } }, async (request, reply) => {
    const { ruleId } = parse(ruleParams, request.params, "params");
    const row = await db.transaction().execute((tx) => setEnabled(tx, request, ruleId, false));
    return sendVersioned(reply, 200, await toRule(db, row));
  });

  return [`GET ${RULES}`, `POST ${RULES}`, `GET ${ONE}`, `PATCH ${ONE}`, `POST ${ENABLE}`, `POST ${DISABLE}`];
}
