// Procedure definitions (OpenAPI tag `procedures`; ADR-0042 §1-§2, §9-§10; REQ-S06-001, REQ-S16-015;
// p5-work-split §C.1; T-DG5-BE-F):
//   GET  /procedure-definitions                                            listProcedureDefinitions    (procedure.read)
//   POST /procedure-definitions/validate                                   validateProcedureDefinition (methodology.configure)
//   GET  /procedure-definitions/{procedureCode}                            getProcedureDefinition      (procedure.read)
//   PUT  /admin/procedure-definitions/{versionId}/{procedureCode}          putProcedureDefinition      (methodology.configure; If-Match = the draft's version)
//   POST /admin/procedure-definitions/{versionId}/{procedureCode}/remove   removeProcedureDefinition   (methodology.configure; If-Match = the draft's version)
//
// A definition is a typed, version-scoped row of configuration kind `procedure` (key `procedures`): it is written only
// while its version is a draft being edited and is published, reviewed, diffed and rolled back through the slice A
// pipeline (publishConfigVersion publishes procedures; there is no separate publish operation here).
//
// LINEAGE ROWS. ADR-0039 §2 makes every draft a complete copy of its base. The slice A draft-create and rollback
// transactions copy `methodology_element` rows only (they have no provider copy hook; see the BE-F handback), so this
// module keeps the rule with one invariant: a `procedure` version that has NO procedure_definition row holds exactly
// the content of its lineage source (rollback_of_version_id, else based_on_version_id) - no version can legitimately
// have zero rows, because seeded definitions can never be deleted (CHECK procedure_definition_source_kept). Reads
// resolve such a version to its source's rows (`rowsVersionIdOf`), and the first procedure write into a draft copies
// every definition and step row of the source into the draft first (`materializeDraftRows`, one audited insert per
// row), in the same transaction, before the edit. The content hash of a procedures draft covers its definition and
// step rows (ADR-0042 §1, `procedureContentSha256`) and is recomputed by every write here.
//
// Every write: authorization re-checked on grants reloaded inside the transaction (commit-time authorization); Zod
// validation; If-Match on the DRAFT (428 missing, 409 stale); lock class `configDraft` on "procedure:<key>" (the lock
// the slice A pipeline takes); the ADR-0042 §10 refusals first (the 0069 guards repeat them); one audit event per row
// written, in the same transaction; no remote I/O. A procedure definition is configuration: an approval step NAMES the
// business role that decides through the canonical approval (ADR-0026); nothing here approves anything.
import {
  sql,
  type DbOrTx,
  type MethodologyVersionTable,
  type ProcedureDefinitionRow,
  type ProcedureStepDefinitionRow,
  type Tx,
} from "@mth/db";
import { PROBLEM_TYPES, type Permission } from "@mth/shared";
import { parseFieldSettings } from "@mth/shared/calc";
import {
  conditionShapeValid,
  configKind as configKindSchema,
  PROCEDURE_CODE_PATTERN,
  procedureDefinitionMessage,
  procedureCode as procedureCodeSchema,
  procedureDefinitionInput,
  procedureDefinitionListQuery,
  procedureDefinitionReadQuery,
  procedureInputField,
  type ConfigCheckSummary,
  type ConfigVersion,
  type ProcedureDefinition,
  type ProcedureDefinitionCode,
  type ProcedureDefinitionInput,
  type ProcedureInputField,
  type ProcedureStepDefinition,
  type ProcedureValidationFinding,
} from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Selectable } from "kysely";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import {
  auditContextOf,
  denialOf,
  principalOf,
  refreshPrincipal,
  TECHNICAL_ADMIN_ROLES,
  type Principal,
} from "../access/index.ts";
import { record } from "../audit/index.ts";
import { contentSha256 } from "../methodology/index.ts";
import {
  ADVISORY_LOCK_CLASSES,
  cursorSchema,
  decodeCursor,
  etag,
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

export type VersionRow = Selectable<MethodologyVersionTable>;
type AuditContext = ReturnType<typeof auditContextOf>;
interface Actor {
  readonly userId: string;
  readonly organizationId: string;
}

/** The configuration kind and its one key (ADR-0042 §1; p5-work-split §C.6 item 1). */
export const PROCEDURE_KIND = "procedure";
export const PROCEDURES_KEY = "procedures";

const JSON_BODY = ["application/json"] as const;
const DEFINITIONS = "/api/v1/procedure-definitions";
const VALIDATE = `${DEFINITIONS}/validate`;
const ONE = `${DEFINITIONS}/:procedureCode`;
const ADMIN_ONE = "/api/v1/admin/procedure-definitions/:versionId/:procedureCode";
const ADMIN_REMOVE = `${ADMIN_ONE}/remove`;

// ------------------------------------------------------------------------------------------------ refusals (§10)

/** An ADR-0042 §10 definition refusal with its exact English text (p5-work-split §2 rule 15). */
export function definitionRefusal(code: ProcedureDefinitionCode): HttpProblem {
  return problems.businessRule(code, procedureDefinitionMessage(code));
}

/** ADR-0039 §13 `config_version.not_editable`, with the exact text of the slice A pipeline. */
export function notEditable(): HttpProblem {
  return new HttpProblem({
    status: 409,
    type: PROBLEM_TYPES.invalidTransition,
    code: "config_version.not_editable",
    title: "Not editable",
    detail: "This configuration version is published or no longer being edited. Create a new draft to change it.",
  });
}

// ------------------------------------------------------------------------------------------------ access

/**
 * `permission` held in the caller's organization (configuration is platform-wide; ADR-0039 §9, ADR-0042 §9), else 403
 * with the denial attached for the failed-mutation audit (the Studio rule of methodology/drafts.ts).
 */
export function requireOrgPermission(principal: Principal, permission: Permission): Actor {
  principal.tracker.decisions += 1;
  const org = principal.organizationId;
  const allowed =
    org !== null && principal.grants.some((g) => g.permissions.has(permission) && g.organizationId === org);
  if (!allowed || org === null || principal.userId === null) {
    const denied = problems.forbidden();
    throw org === null
      ? denied
      : denied.withDenial(
          denialOf(permission, {
            level: "organization",
            organizationId: org,
            businessUnitId: null,
            transformationId: null,
            businessUnitAncestry: [],
          }),
        );
  }
  return { userId: principal.userId, organizationId: org };
}

const holds = (principal: Principal, permission: Permission): boolean =>
  principal.organizationId !== null &&
  principal.grants.some((g) => g.permissions.has(permission) && g.organizationId === principal.organizationId);

/** Commit-time authorization of a write: the grants are reloaded inside the write transaction. */
async function requireWrite(tx: Tx, request: FastifyRequest, permission: Permission): Promise<Actor> {
  principalOf(request);
  return requireOrgPermission(await refreshPrincipal(tx, request), permission);
}

// ------------------------------------------------------------------------------------------------ versions and lineage

/** A `procedure` version, or 404 (an id of another kind is not a procedures version). */
export async function loadProcedureVersion(db: DbOrTx, versionId: string, forUpdate = false): Promise<VersionRow> {
  let q = db.selectFrom("methodology_version").selectAll().where("id", "=", versionId);
  if (forUpdate) q = q.forUpdate();
  const row = await q.executeTakeFirst();
  if (row === undefined || row.config_kind !== PROCEDURE_KIND) throw problems.notFound();
  return row;
}

/** The newest published version of the `procedures` key (the default read; ADR-0042 §1), or 404. */
export async function newestPublishedProcedures(db: DbOrTx, key = PROCEDURES_KEY): Promise<VersionRow> {
  const row = await db
    .selectFrom("methodology_version")
    .selectAll()
    .where("config_kind", "=", PROCEDURE_KIND)
    .where("key", "=", key)
    .where("status", "=", "published")
    .orderBy("version_no", "desc")
    .limit(1)
    .executeTakeFirst();
  if (row === undefined) throw problems.notFound();
  return row;
}

/**
 * The version whose procedure rows hold `v`'s content: `v` itself when it has rows, else its lineage source
 * (rollback_of_version_id, else based_on_version_id), recursively (see the header). null: no rows anywhere.
 */
export async function rowsVersionIdOf(db: DbOrTx, v: VersionRow): Promise<string | null> {
  let current: Pick<VersionRow, "id" | "based_on_version_id" | "rollback_of_version_id"> = v;
  for (let depth = 0; depth < 1000; depth += 1) {
    const has = await db
      .selectFrom("procedure_definition")
      .select("id")
      .where("methodology_version_id", "=", current.id)
      .limit(1)
      .executeTakeFirst();
    if (has !== undefined) return current.id;
    const next = current.rollback_of_version_id ?? current.based_on_version_id;
    if (next === null) return null;
    const parent = await db
      .selectFrom("methodology_version")
      .select(["id", "based_on_version_id", "rollback_of_version_id"])
      .where("id", "=", next)
      .executeTakeFirst();
    if (parent === undefined) return null;
    current = parent;
  }
  return null;
}

export interface DefinitionWithSteps {
  readonly row: ProcedureDefinitionRow;
  readonly steps: readonly ProcedureStepDefinitionRow[];
}

/** The definition rows (with steps) holding `v`'s content, in ordinal/code order. */
export async function loadDefinitions(
  db: DbOrTx,
  v: VersionRow,
  o: { readonly includeRemoved?: boolean; readonly includeRemovedSteps?: boolean; readonly code?: string } = {},
): Promise<DefinitionWithSteps[]> {
  const rowsId = await rowsVersionIdOf(db, v);
  if (rowsId === null) return [];
  let q = db.selectFrom("procedure_definition").selectAll().where("methodology_version_id", "=", rowsId);
  if (o.includeRemoved !== true) q = q.where("removed", "=", false);
  if (o.code !== undefined) q = q.where("code", "=", o.code);
  const defs = await q.orderBy("ordinal").orderBy("code").execute();
  if (defs.length === 0) return [];
  let sq = db
    .selectFrom("procedure_step_definition")
    .selectAll()
    .where(
      "procedure_definition_id",
      "in",
      defs.map((d) => d.id),
    );
  if (o.includeRemovedSteps !== true) sq = sq.where("removed", "=", false);
  const steps = await sq.orderBy("ordinal").orderBy("step_key").execute();
  const byDef = new Map<string, ProcedureStepDefinitionRow[]>();
  for (const s of steps) {
    const list = byDef.get(s.procedure_definition_id) ?? [];
    list.push(s);
    byDef.set(s.procedure_definition_id, list);
  }
  return defs.map((row) => ({ row, steps: byDef.get(row.id) ?? [] }));
}

// ------------------------------------------------------------------------------------------------ presenters

const conditionOf = (s: ProcedureStepDefinitionRow): ProcedureStepDefinition["condition"] =>
  s.condition_input_key === null || s.condition_operator === null
    ? null
    : {
        inputKey: s.condition_input_key,
        operator: s.condition_operator as NonNullable<ProcedureStepDefinition["condition"]>["operator"],
        ...(s.condition_value !== null && s.condition_value !== undefined ? { value: s.condition_value } : {}),
      };

export function presentStep(s: ProcedureStepDefinitionRow): ProcedureStepDefinition {
  return {
    stepKey: s.step_key,
    ordinal: s.ordinal,
    parallelGroup: s.parallel_group,
    stepKind: s.step_kind as ProcedureStepDefinition["stepKind"],
    nameEn: s.name_en,
    nameAr: s.name_ar,
    instructionsEn: s.instructions_en,
    instructionsAr: s.instructions_ar,
    responsibleRoleCode: s.responsible_role_code,
    approvalRoleCode: s.approval_role_code,
    slaWorkingDays: s.sla_working_days,
    condition: conditionOf(s),
    requiredInputKeys: [...s.required_input_keys],
    evidenceRequired: s.evidence_required,
    output:
      s.output_record_type === null || s.output_mode === null
        ? null
        : {
            recordType: s.output_record_type as NonNullable<ProcedureStepDefinition["output"]>["recordType"],
            mode: s.output_mode as NonNullable<ProcedureStepDefinition["output"]>["mode"],
          },
    skippable: s.skippable,
    removed: s.removed,
  };
}

const dateOf = (d: unknown): string => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

/**
 * One definition as the contract's ProcedureDefinition, in the REQUESTED version `v` (whose content it is; its `id` is
 * the row holding that content, see the header). `productDefaults` marks the seeded texts (ADR-0042 §5).
 */
export function presentDefinition(v: VersionRow, d: DefinitionWithSteps): ProcedureDefinition {
  const r = d.row;
  return {
    id: r.id,
    code: r.code,
    methodologyVersionId: v.id,
    versionNo: v.version_no,
    versionStatus: v.status as ProcedureDefinition["versionStatus"],
    origin: r.origin as ProcedureDefinition["origin"],
    removed: r.removed,
    productDefaults: r.origin === "source",
    sourceRef: r.source_ref,
    nameEn: r.name_en,
    nameAr: r.name_ar,
    purposeEn: r.purpose_en,
    purposeAr: r.purpose_ar,
    trigger: {
      kind: r.trigger_kind as ProcedureDefinition["trigger"]["kind"],
      event: r.trigger_event,
      descriptionEn: r.trigger_en,
      descriptionAr: r.trigger_ar,
    },
    scope: {
      level: r.scope_level as ProcedureDefinition["scope"]["level"],
      descriptionEn: r.scope_en,
      descriptionAr: r.scope_ar,
    },
    prerequisitesEn: r.prerequisites_en,
    prerequisitesAr: r.prerequisites_ar,
    inputSchema: inputSchemaOf(r),
    launchRoleCodes: [...r.launch_role_codes],
    responsibleRoleCodes: [...r.responsible_role_codes],
    slaWorkingDays: r.sla_working_days,
    validationRulesEn: r.validation_rules_en,
    validationRulesAr: r.validation_rules_ar,
    approval: {
      mode: r.approval_mode as ProcedureDefinition["approval"]["mode"],
      roleCodes: [...r.approval_role_codes],
    },
    escalation:
      r.escalation_role_code === null || r.escalation_after_working_days === null
        ? null
        : { roleCode: r.escalation_role_code, afterWorkingDays: r.escalation_after_working_days },
    expectedOutputsEn: r.expected_outputs_en,
    expectedOutputsAr: r.expected_outputs_ar,
    completion: {
      rule: r.completion_rule as ProcedureDefinition["completion"]["rule"],
      descriptionEn: r.completion_en,
      descriptionAr: r.completion_ar,
    },
    exceptionsEn: r.exceptions_en,
    exceptionsAr: r.exceptions_ar,
    effectiveFrom: dateOf(r.effective_from),
    ordinal: r.ordinal,
    steps: d.steps.map(presentStep),
    version: r.version,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

/** The stored input schema (validated on write; an unreadable entry is dropped, never served raw). */
export function inputSchemaOf(r: Pick<ProcedureDefinitionRow, "input_schema">): ProcedureInputField[] {
  const raw = Array.isArray(r.input_schema) ? (r.input_schema as unknown[]) : [];
  const out: ProcedureInputField[] = [];
  for (const f of raw) {
    const p = procedureInputField.safeParse(f);
    if (p.success) out.push(p.data);
  }
  return out;
}

/** The stored definition as a builder body (re-validated by the compatibility and preview hooks). */
export function toDefinitionInput(d: DefinitionWithSteps): ProcedureDefinitionInput {
  const p = presentDefinition({ id: d.row.methodology_version_id, version_no: 1, status: "draft" } as VersionRow, d);
  return {
    nameEn: p.nameEn,
    nameAr: p.nameAr,
    purposeEn: p.purposeEn,
    purposeAr: p.purposeAr,
    trigger: p.trigger,
    scope: p.scope,
    prerequisitesEn: p.prerequisitesEn,
    prerequisitesAr: p.prerequisitesAr,
    inputSchema: p.inputSchema,
    launchRoleCodes: p.launchRoleCodes,
    responsibleRoleCodes: p.responsibleRoleCodes,
    slaWorkingDays: p.slaWorkingDays,
    validationRulesEn: p.validationRulesEn,
    validationRulesAr: p.validationRulesAr,
    approval: p.approval,
    escalation: p.escalation,
    expectedOutputsEn: p.expectedOutputsEn,
    expectedOutputsAr: p.expectedOutputsAr,
    completion: p.completion,
    exceptionsEn: p.exceptionsEn,
    exceptionsAr: p.exceptionsAr,
    effectiveFrom: p.effectiveFrom,
    ordinal: p.ordinal,
    steps: p.steps
      .filter((s) => !s.removed)
      .map(({ removed: _r, ...s }) => ({
        ...s,
        condition: s.condition,
        output: s.output,
      })),
  };
}

// ------------------------------------------------------------------------------------------------ builder validation

/** The settings attributes of an input as the ADR-0041 §3 validators read them (choice options are plain values). */
export function inputFieldAttributes(f: ProcedureInputField): Record<string, unknown> {
  const attrs = new Map<string, unknown>(Object.entries(f.settings ?? {}));
  if (f.options !== undefined)
    attrs.set(
      "options",
      f.options.map((o) => ({ value: o, labelEn: o, labelAr: o })),
    );
  return Object.fromEntries(attrs);
}

/** The roles no procedure may name (ADR-0042 §1: technical administrators and AUD). */
const roleNotAllowed = (code: string | null | undefined): boolean =>
  code !== null && code !== undefined && (TECHNICAL_ADMIN_ROLES.has(code) || code === "AUD");

/**
 * The builder validation of ADR-0042 §1-§2 over a definition body: returns EVERY finding (validateProcedureDefinition
 * reports them all; putProcedureDefinition refuses with the first). Shape errors are 400s before this runs.
 */
export function validateDefinitionBody(body: ProcedureDefinitionInput): ProcedureValidationFinding[] {
  const out: ProcedureValidationFinding[] = [];
  const add = (code: ProcedureDefinitionCode, pointer: string) =>
    out.push({ code, pointer, message: procedureDefinitionMessage(code) });

  if (body.trigger === undefined) add("procedure_definition.trigger_required", "/trigger");
  else if (body.trigger.kind === "event" && (body.trigger.event ?? null) === null)
    add("procedure_definition.trigger_required", "/trigger/event");
  if (body.completion === undefined) add("procedure_definition.completion_required", "/completion");
  if (body.steps.length === 0) add("procedure_definition.steps_required", "/steps");

  // Roles (launch, responsible, approval, escalation, steps): never a technical administrator or AUD.
  body.launchRoleCodes.forEach((r, i) => {
    if (roleNotAllowed(r)) add("procedure_definition.role_not_allowed", `/launchRoleCodes/${i}`);
  });
  body.responsibleRoleCodes.forEach((r, i) => {
    if (roleNotAllowed(r)) add("procedure_definition.role_not_allowed", `/responsibleRoleCodes/${i}`);
  });
  body.approval.roleCodes.forEach((r, i) => {
    if (roleNotAllowed(r)) add("procedure_definition.role_not_allowed", `/approval/roleCodes/${i}`);
  });
  if (roleNotAllowed(body.escalation?.roleCode)) add("procedure_definition.role_not_allowed", "/escalation/roleCode");
  // The approval path's mode and roles are complete together (CHECK procedure_definition_approval_complete).
  if ((body.approval.mode === "none") !== (body.approval.roleCodes.length === 0))
    add("procedure_definition.approval_step_invalid", "/approval");

  // Inputs: each a valid ADR-0041 §3 field definition; choice options only on a choice field.
  const inputs = body.inputSchema ?? [];
  const inputByKey = new Map(inputs.map((f) => [f.key, f]));
  inputs.forEach((f, i) => {
    const optionsMisplaced = f.options !== undefined && f.fieldType !== "choice";
    if (optionsMisplaced || !parseFieldSettings(f.fieldType, inputFieldAttributes(f)).ok)
      add("procedure_definition.input_schema_invalid", `/inputSchema/${i}`);
  });

  body.steps.forEach((s, i) => {
    const at = `/steps/${i}`;
    if (roleNotAllowed(s.responsibleRoleCode))
      add("procedure_definition.role_not_allowed", `${at}/responsibleRoleCode`);
    if (roleNotAllowed(s.approvalRoleCode)) add("procedure_definition.role_not_allowed", `${at}/approvalRoleCode`);
    const approver = s.approvalRoleCode ?? null;
    if (s.stepKind === "approval" ? approver === null || s.skippable === true : approver !== null)
      add("procedure_definition.approval_step_invalid", at);
    (s.requiredInputKeys ?? []).forEach((k, j) => {
      if (!inputByKey.has(k)) add("procedure_definition.input_unknown", `${at}/requiredInputKeys/${j}`);
    });
    const c = s.condition ?? null;
    if (c !== null) {
      const input = inputByKey.get(c.inputKey);
      if (input === undefined || !conditionShapeValid(c, input.fieldType))
        add("procedure_definition.condition_invalid", `${at}/condition`);
    }
  });

  // Parallel steps share one ordinal and one parallel group; a group belongs to one ordinal only.
  const byOrdinal = new Map<number, { index: number; group: string | null }[]>();
  const ordinalOfGroup = new Map<string, number>();
  body.steps.forEach((s, i) => {
    const list = byOrdinal.get(s.ordinal) ?? [];
    list.push({ index: i, group: s.parallelGroup ?? null });
    byOrdinal.set(s.ordinal, list);
  });
  const badParallel = new Set<number>();
  for (const list of byOrdinal.values()) {
    if (list.length < 2) continue;
    const first = list[0]?.group ?? null;
    if (first === null || list.some((x) => x.group !== first)) for (const x of list) badParallel.add(x.index);
  }
  body.steps.forEach((s, i) => {
    const g = s.parallelGroup ?? null;
    if (g === null) return;
    const seen = ordinalOfGroup.get(g);
    if (seen === undefined) ordinalOfGroup.set(g, s.ordinal);
    else if (seen !== s.ordinal) badParallel.add(i);
  });
  for (const i of [...badParallel].sort((a, b) => a - b))
    add("procedure_definition.parallel_group_invalid", `/steps/${i}/parallelGroup`);
  return out;
}

// ------------------------------------------------------------------------------------------------ content hash

/** The typed columns of a definition in their hashed / diffed shape (ADR-0042 §1). */
export function definitionAttributes(r: ProcedureDefinitionRow): Record<string, unknown> {
  return {
    nameEn: r.name_en,
    nameAr: r.name_ar,
    purposeEn: r.purpose_en,
    purposeAr: r.purpose_ar,
    triggerKind: r.trigger_kind,
    triggerEvent: r.trigger_event,
    triggerEn: r.trigger_en,
    triggerAr: r.trigger_ar,
    scopeLevel: r.scope_level,
    scopeEn: r.scope_en,
    scopeAr: r.scope_ar,
    prerequisitesEn: r.prerequisites_en,
    prerequisitesAr: r.prerequisites_ar,
    inputSchema: r.input_schema,
    launchRoleCodes: [...r.launch_role_codes],
    responsibleRoleCodes: [...r.responsible_role_codes],
    slaWorkingDays: r.sla_working_days,
    validationRulesEn: r.validation_rules_en,
    validationRulesAr: r.validation_rules_ar,
    approvalMode: r.approval_mode,
    approvalRoleCodes: [...r.approval_role_codes],
    escalationRoleCode: r.escalation_role_code,
    escalationAfterWorkingDays: r.escalation_after_working_days,
    expectedOutputsEn: r.expected_outputs_en,
    expectedOutputsAr: r.expected_outputs_ar,
    completionRule: r.completion_rule,
    completionEn: r.completion_en,
    completionAr: r.completion_ar,
    exceptionsEn: r.exceptions_en,
    exceptionsAr: r.exceptions_ar,
    effectiveFrom: dateOf(r.effective_from),
    sourceRef: r.source_ref,
  };
}

/** The typed columns of a step in their hashed / diffed shape. */
export function stepAttributes(s: ProcedureStepDefinitionRow): Record<string, unknown> {
  return {
    parallelGroup: s.parallel_group,
    stepKind: s.step_kind,
    nameEn: s.name_en,
    nameAr: s.name_ar,
    instructionsEn: s.instructions_en,
    instructionsAr: s.instructions_ar,
    responsibleRoleCode: s.responsible_role_code,
    approvalRoleCode: s.approval_role_code,
    slaWorkingDays: s.sla_working_days,
    conditionInputKey: s.condition_input_key,
    conditionOperator: s.condition_operator,
    conditionValue: s.condition_value ?? null,
    requiredInputKeys: [...s.required_input_keys],
    evidenceRequired: s.evidence_required,
    outputRecordType: s.output_record_type,
    outputMode: s.output_mode,
    skippable: s.skippable,
  };
}

export interface ProcedureElement {
  readonly elementType: "procedure" | "procedure_step";
  readonly stableKey: string;
  readonly origin: string;
  readonly removed: boolean;
  readonly ordinal: number;
  readonly attributes: Record<string, unknown>;
}

/** The ADR-0042 §1 `elements` entries of a version: one per definition and one per step (removed ones included). */
export async function procedureElements(db: DbOrTx, v: VersionRow): Promise<ProcedureElement[]> {
  const defs = await loadDefinitions(db, v, { includeRemoved: true, includeRemovedSteps: true });
  const out: ProcedureElement[] = [];
  for (const d of defs) {
    out.push({
      elementType: "procedure",
      stableKey: d.row.code,
      origin: d.row.origin,
      removed: d.row.removed,
      ordinal: d.row.ordinal,
      attributes: definitionAttributes(d.row),
    });
    for (const s of d.steps)
      out.push({
        elementType: "procedure_step",
        stableKey: `${d.row.code}.${s.step_key}`,
        origin: d.row.origin,
        removed: s.removed,
        ordinal: s.ordinal,
        attributes: stepAttributes(s),
      });
  }
  return out;
}

/**
 * The ADR-0039 §1 content hash of a procedures version: its definition, titles and elements, where the elements are
 * the version's methodology_element rows (none are accepted for this kind today) plus its procedure rows.
 */
export async function procedureContentSha256(db: DbOrTx, v: VersionRow): Promise<string> {
  const meta = await db
    .selectFrom("methodology_element")
    .select(["element_type", "stable_key", "origin", "removed", "ordinal", "attributes"])
    .where("methodology_version_id", "=", v.id)
    .execute();
  return contentSha256({
    definition: v.definition,
    titleEn: v.title_en,
    titleAr: v.title_ar,
    elements: [
      ...meta.map((m) => ({
        elementType: m.element_type,
        stableKey: m.stable_key,
        origin: m.origin,
        removed: m.removed,
        ordinal: m.ordinal,
        attributes: m.attributes,
      })),
      ...(await procedureElements(db, v)),
    ],
  });
}

// ------------------------------------------------------------------------------------------------ ConfigVersion

/**
 * The draft as the contract's ConfigVersion (removeProcedureDefinition's response): the presenter of the slice A
 * pipeline (methodology/drafts.ts), repeated here because methodology/index.ts does not export it (handback request).
 */
export async function presentConfigVersion(db: DbOrTx, r: VersionRow): Promise<ConfigVersion> {
  const [runs, pending, policy, newest] = await Promise.all([
    db
      .selectFrom("config_check_run")
      .select(["id", "check_kind", "result", "created_at"])
      .where("methodology_version_id", "=", r.id)
      .where("content_sha256", "=", r.content_sha256)
      .orderBy("created_at", "desc")
      .orderBy("id", "desc")
      .execute(),
    db
      .selectFrom("config_review_request")
      .select("id")
      .where("methodology_version_id", "=", r.id)
      .where("status", "=", "pending")
      .executeTakeFirst(),
    db
      .selectFrom("config_review_policy")
      .select("review_required")
      .where("config_kind", "=", r.config_kind)
      .executeTakeFirst(),
    db
      .selectFrom("methodology_version")
      .select(sql<number>`max(version_no)`.as("n"))
      .where("key", "=", r.key)
      .where("status", "=", "published")
      .executeTakeFirst(),
  ]);
  const check = (kind: string): ConfigCheckSummary | null => {
    const run = runs.find((x) => x.check_kind === kind);
    return run === undefined
      ? null
      : { checkRunId: run.id, result: run.result as ConfigCheckSummary["result"], createdAt: iso(run.created_at) };
  };
  return {
    id: r.id,
    configKind: configKindSchema.parse(r.config_kind),
    key: r.key,
    versionNo: r.version_no,
    status: r.status as ConfigVersion["status"],
    draftStage: r.draft_stage as ConfigVersion["draftStage"],
    origin: r.origin as ConfigVersion["origin"],
    basedOnVersionId: r.based_on_version_id,
    rollbackOfVersionId: r.rollback_of_version_id,
    titleEn: r.title_en,
    titleAr: r.title_ar,
    changeSummary: r.change_summary,
    definition: r.definition as Record<string, unknown>,
    contentSha256: r.content_sha256,
    isNewestPublished: r.status === "published" && Number(newest?.n ?? -1) === r.version_no,
    latestChecks: {
      preview: check("preview"),
      compatibility: check("compatibility"),
      sourceCoverage: check("source_coverage"),
    },
    pendingReviewId: pending?.id ?? null,
    // A missing policy row reads as "review required" (the 0062 guard's coalesce(..., true)).
    reviewRequired: policy?.review_required ?? true,
    publishedAt: isoOrNull(r.published_at),
    publishedBy: r.published_by,
    discardedAt: isoOrNull(r.discarded_at),
    version: r.version,
    createdAt: iso(r.created_at),
    createdBy: r.created_by,
    updatedAt: iso(r.updated_at),
    updatedBy: r.updated_by,
  };
}

// ------------------------------------------------------------------------------------------------ writes

/** Lock class `configDraft` on "procedure:<key>" (ADR-0016 §6; the lock of the slice A draft writes and publish). */
async function lockConfigDraft(tx: Tx, key: string): Promise<void> {
  await sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_CLASSES.configDraft}::int4, hashtext(${`${PROCEDURE_KIND}:${key}`}::text))`.execute(
    tx,
  );
}

/** Locks the draft, re-reads it for update and checks If-Match and editability (the slice A order). */
async function lockedDraft(tx: Tx, versionId: string, expected: number): Promise<VersionRow> {
  const probe = await loadProcedureVersion(tx, versionId);
  await lockConfigDraft(tx, probe.key);
  const current = await loadProcedureVersion(tx, versionId, true);
  if (current.version !== expected) throw problems.versionConflict(current.version);
  if (current.status !== "draft" || (current.draft_stage !== "editing" && current.draft_stage !== "preview"))
    throw notEditable();
  return current;
}

const DEFINITION_COPY_COLUMNS = [
  "code",
  "origin",
  "removed",
  "ordinal",
  "name_en",
  "name_ar",
  "purpose_en",
  "purpose_ar",
  "trigger_kind",
  "trigger_event",
  "trigger_en",
  "trigger_ar",
  "scope_level",
  "scope_en",
  "scope_ar",
  "prerequisites_en",
  "prerequisites_ar",
  "launch_role_codes",
  "responsible_role_codes",
  "sla_working_days",
  "validation_rules_en",
  "validation_rules_ar",
  "approval_mode",
  "approval_role_codes",
  "escalation_role_code",
  "escalation_after_working_days",
  "expected_outputs_en",
  "expected_outputs_ar",
  "completion_rule",
  "completion_en",
  "completion_ar",
  "exceptions_en",
  "exceptions_ar",
  "effective_from",
  "source_ref",
] as const;

/**
 * ADR-0039 §2 copy rule for procedures (see the header): when the draft has no procedure row yet, every definition
 * and step row of its lineage source is copied into it, each as its own audited insert. Returns the number copied.
 */
export async function materializeDraftRows(tx: Tx, audit: AuditContext, actor: Actor, draft: VersionRow) {
  const sourceId = await rowsVersionIdOf(tx, draft);
  if (sourceId === null || sourceId === draft.id) return 0;
  const defs = await tx
    .selectFrom("procedure_definition")
    .selectAll()
    .where("methodology_version_id", "=", sourceId)
    .orderBy("ordinal")
    .orderBy("code")
    .execute();
  let copied = 0;
  for (const d of defs) {
    const id = uuidv7();
    const source = new Map<string, unknown>(Object.entries(d));
    const values = Object.fromEntries(DEFINITION_COPY_COLUMNS.map((c) => [c, source.get(c)]));
    await tx
      .insertInto("procedure_definition")
      .values({
        ...(values as Pick<ProcedureDefinitionRow, (typeof DEFINITION_COPY_COLUMNS)[number]>),
        id,
        methodology_version_id: draft.id,
        input_schema: JSON.stringify(d.input_schema),
        created_by: d.created_by,
        updated_by: actor.userId,
      })
      .execute();
    await record(tx, audit, {
      action: "procedure_definition.copy",
      recordType: "procedure_definition",
      recordId: id,
      organizationId: actor.organizationId,
      newVersion: 1,
      changes: { copied_from: { from: null, to: d.id }, methodology_version_id: { from: null, to: draft.id } },
    });
    copied += 1;
    const steps = await tx
      .selectFrom("procedure_step_definition")
      .selectAll()
      .where("procedure_definition_id", "=", d.id)
      .orderBy("ordinal")
      .orderBy("step_key")
      .execute();
    for (const s of steps) {
      const stepId = uuidv7();
      await tx
        .insertInto("procedure_step_definition")
        .values({
          ...stepColumns(s),
          id: stepId,
          procedure_definition_id: id,
          removed: s.removed,
          created_by: s.created_by,
          updated_by: actor.userId,
        })
        .execute();
      await record(tx, audit, {
        action: "procedure_step_definition.copy",
        recordType: "procedure_step_definition",
        recordId: stepId,
        organizationId: actor.organizationId,
        newVersion: 1,
        changes: { copied_from: { from: null, to: s.id } },
      });
      copied += 1;
    }
  }
  return copied;
}

type StepColumns = Pick<
  ProcedureStepDefinitionRow,
  | "step_key"
  | "ordinal"
  | "parallel_group"
  | "step_kind"
  | "name_en"
  | "name_ar"
  | "instructions_en"
  | "instructions_ar"
  | "responsible_role_code"
  | "approval_role_code"
  | "sla_working_days"
  | "condition_input_key"
  | "condition_operator"
  | "required_input_keys"
  | "evidence_required"
  | "output_record_type"
  | "output_mode"
  | "skippable"
> & { condition_value: string | null };

function stepColumns(s: ProcedureStepDefinitionRow): StepColumns {
  return {
    step_key: s.step_key,
    ordinal: s.ordinal,
    parallel_group: s.parallel_group,
    step_kind: s.step_kind,
    name_en: s.name_en,
    name_ar: s.name_ar,
    instructions_en: s.instructions_en,
    instructions_ar: s.instructions_ar,
    responsible_role_code: s.responsible_role_code,
    approval_role_code: s.approval_role_code,
    sla_working_days: s.sla_working_days,
    condition_input_key: s.condition_input_key,
    condition_operator: s.condition_operator,
    condition_value:
      s.condition_value === null || s.condition_value === undefined ? null : JSON.stringify(s.condition_value),
    required_input_keys: [...s.required_input_keys],
    evidence_required: s.evidence_required,
    output_record_type: s.output_record_type,
    output_mode: s.output_mode,
    skippable: s.skippable,
  };
}

function stepColumnsOf(s: ProcedureDefinitionInput["steps"][number]): StepColumns {
  const c = s.condition ?? null;
  return {
    step_key: s.stepKey,
    ordinal: s.ordinal,
    parallel_group: s.parallelGroup ?? null,
    step_kind: s.stepKind,
    name_en: s.nameEn,
    name_ar: s.nameAr,
    instructions_en: s.instructionsEn ?? null,
    instructions_ar: s.instructionsAr ?? null,
    responsible_role_code: s.responsibleRoleCode,
    approval_role_code: s.approvalRoleCode ?? null,
    sla_working_days: s.slaWorkingDays,
    condition_input_key: c?.inputKey ?? null,
    condition_operator: c?.operator ?? null,
    condition_value: c === null || c.value === undefined || c.value === null ? null : JSON.stringify(c.value),
    required_input_keys: [...(s.requiredInputKeys ?? [])],
    evidence_required: s.evidenceRequired ?? false,
    output_record_type: s.output?.recordType ?? null,
    output_mode: s.output?.mode ?? null,
    skippable: s.skippable ?? false,
  };
}

/** The stored input schema of a body (only the given keys; validated by `validateDefinitionBody`). */
function storedInputSchema(body: ProcedureDefinitionInput): string {
  return JSON.stringify(
    (body.inputSchema ?? []).map((f) => Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined))),
  );
}

function definitionColumnsOf(body: ProcedureDefinitionInput) {
  const trigger = body.trigger;
  const completion = body.completion;
  if (trigger === undefined || completion === undefined) throw new Error("validated body without trigger/completion");
  return {
    name_en: body.nameEn,
    name_ar: body.nameAr,
    purpose_en: body.purposeEn,
    purpose_ar: body.purposeAr,
    trigger_kind: trigger.kind,
    trigger_event: trigger.kind === "event" ? (trigger.event ?? null) : null,
    trigger_en: trigger.descriptionEn,
    trigger_ar: trigger.descriptionAr,
    scope_level: body.scope.level,
    scope_en: body.scope.descriptionEn,
    scope_ar: body.scope.descriptionAr,
    prerequisites_en: body.prerequisitesEn ?? null,
    prerequisites_ar: body.prerequisitesAr ?? null,
    input_schema: storedInputSchema(body),
    launch_role_codes: [...body.launchRoleCodes],
    responsible_role_codes: [...body.responsibleRoleCodes],
    sla_working_days: body.slaWorkingDays,
    validation_rules_en: body.validationRulesEn,
    validation_rules_ar: body.validationRulesAr,
    approval_mode: body.approval.mode,
    approval_role_codes: [...body.approval.roleCodes],
    escalation_role_code: body.escalation?.roleCode ?? null,
    escalation_after_working_days: body.escalation?.afterWorkingDays ?? null,
    expected_outputs_en: body.expectedOutputsEn,
    expected_outputs_ar: body.expectedOutputsAr,
    completion_rule: completion.rule,
    completion_en: completion.descriptionEn,
    completion_ar: completion.descriptionAr,
    exceptions_en: body.exceptionsEn ?? null,
    exceptions_ar: body.exceptionsAr ?? null,
    effective_from: body.effectiveFrom,
  };
}

/** Columns written as JSON text (the stored side reads back parsed). */
const JSON_COLUMNS: ReadonlySet<string> = new Set(["input_schema", "condition_value"]);

/** The changed columns of a row (audit `changes`), or null when nothing changed. */
function changesOf(
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>,
): Record<string, { from: unknown; to: unknown }> | null {
  const b = new Map(Object.entries(before));
  const out = new Map<string, { from: unknown; to: unknown }>();
  for (const [k, raw] of Object.entries(after)) {
    const from = k === "effective_from" ? dateOf(b.get(k)) : (b.get(k) ?? null);
    const to = JSON_COLUMNS.has(k) && typeof raw === "string" ? (JSON.parse(raw) as unknown) : (raw ?? null);
    if (JSON.stringify(from) !== JSON.stringify(to)) out.set(k, { from, to });
  }
  return out.size > 0 ? Object.fromEntries(out) : null;
}

/** Recomputes the draft's hash and steps it (stage back to `editing`), with its own audit event. */
async function stepDraft(
  tx: Tx,
  audit: AuditContext,
  actor: Actor,
  current: VersionRow,
  action: "procedure_put" | "procedure_remove",
  code: string,
): Promise<VersionRow> {
  const hash = await procedureContentSha256(tx, current);
  const updated = await tx
    .updateTable("methodology_version")
    .set({
      content_sha256: hash,
      // A content change in preview returns the draft to editing (ADR-0039 §1; the 0062 guard requires it).
      draft_stage: "editing",
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: actor.userId,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, audit, {
    action: `methodology_version.${action}`,
    recordType: "methodology_version",
    recordId: current.id,
    organizationId: actor.organizationId,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: {
      content_sha256: { from: current.content_sha256, to: hash },
      ...(current.draft_stage !== "editing" ? { draft_stage: { from: current.draft_stage, to: "editing" } } : {}),
      procedure: { from: null, to: code },
    },
  });
  return updated;
}

/** The code of the path, or 422 procedure_definition.code_invalid (ADR-0042 §10). */
function codeOf(raw: string): string {
  if (!PROCEDURE_CODE_PATTERN.test(raw)) throw definitionRefusal("procedure_definition.code_invalid");
  return raw;
}

async function putDefinition(
  tx: Tx,
  request: FastifyRequest,
  versionId: string,
  rawCode: string,
): Promise<{ draft: VersionRow; definition: ProcedureDefinition }> {
  const actor = await requireWrite(tx, request, "methodology.configure");
  const body = parseBody(procedureDefinitionInput, request.body);
  const expected = requireIfMatch(request);
  const current = await lockedDraft(tx, versionId, expected);
  const code = codeOf(rawCode);
  const findings = validateDefinitionBody(body);
  const first = findings[0];
  if (first !== undefined) throw definitionRefusal(first.code as ProcedureDefinitionCode);
  const audit = auditContextOf(request);
  await materializeDraftRows(tx, audit, actor, current);

  const existing = await tx
    .selectFrom("procedure_definition")
    .selectAll()
    .where("methodology_version_id", "=", current.id)
    .where("code", "=", code)
    .forUpdate()
    .executeTakeFirst();
  const columns = definitionColumnsOf(body);
  let definitionId: string;
  if (existing === undefined) {
    const max = await tx
      .selectFrom("procedure_definition")
      .select(sql<number>`coalesce(max(ordinal), 0)`.as("n"))
      .where("methodology_version_id", "=", current.id)
      .executeTakeFirstOrThrow();
    const ordinal = body.ordinal ?? Math.min(999, Number(max.n) + 1);
    definitionId = uuidv7();
    await tx
      .insertInto("procedure_definition")
      .values({
        ...columns,
        id: definitionId,
        methodology_version_id: current.id,
        code,
        origin: "admin",
        removed: false,
        ordinal,
        created_by: actor.userId,
        updated_by: actor.userId,
      })
      .execute();
    await record(tx, audit, {
      action: "procedure_definition.put",
      recordType: "procedure_definition",
      recordId: definitionId,
      organizationId: actor.organizationId,
      newVersion: 1,
      changes: {
        code: { from: null, to: code },
        origin: { from: null, to: "admin" },
        ordinal: { from: null, to: ordinal },
      },
    });
  } else {
    definitionId = existing.id;
    const next = { ...columns, ordinal: body.ordinal ?? existing.ordinal, removed: false };
    const changes = changesOf(existing as unknown as Record<string, unknown>, next);
    if (changes !== null) {
      const updated = await tx
        .updateTable("procedure_definition")
        .set({
          ...next,
          version: sql<number>`version + 1`,
          updated_at: sql<Date>`now()`,
          updated_by: actor.userId,
        })
        .where("id", "=", existing.id)
        .where("version", "=", existing.version)
        .returningAll()
        .executeTakeFirstOrThrow();
      await record(tx, audit, {
        action: "procedure_definition.put",
        recordType: "procedure_definition",
        recordId: existing.id,
        organizationId: actor.organizationId,
        priorVersion: existing.version,
        newVersion: updated.version,
        changes,
      });
    }
  }
  await putSteps(tx, audit, actor, definitionId, body.steps);
  const draft = await stepDraft(tx, audit, actor, current, "procedure_put", code);
  const [saved] = await loadDefinitions(tx, draft, { code });
  if (saved === undefined) throw new Error("the saved definition is not readable");
  return { draft, definition: presentDefinition(draft, saved) };
}

/**
 * Replaces the steps of a definition: absent steps are marked removed (rows are never deleted), present ones inserted
 * or updated. A step whose position (ordinal, parallel group) changes is first set aside as removed, so the 0069
 * parallel-group guard, which checks row by row, only ever sees a consistent set (the body was validated as a whole).
 */
async function putSteps(
  tx: Tx,
  audit: AuditContext,
  actor: Actor,
  definitionId: string,
  steps: ProcedureDefinitionInput["steps"],
): Promise<void> {
  const rows = await tx
    .selectFrom("procedure_step_definition")
    .selectAll()
    .where("procedure_definition_id", "=", definitionId)
    .forUpdate()
    .execute();
  const byKey = new Map(rows.map((r) => [r.step_key, r]));
  const wanted = new Map(steps.map((s) => [s.stepKey, stepColumnsOf(s)]));
  const current = new Map(rows.map((r) => [r.id, r]));

  const update = async (row: ProcedureStepDefinitionRow, next: Record<string, unknown>, action: string) => {
    const changes = changesOf(row as unknown as Record<string, unknown>, next);
    if (changes === null) return row;
    const updated = await tx
      .updateTable("procedure_step_definition")
      .set({
        ...(next as Partial<StepColumns> & { removed?: boolean }),
        version: sql<number>`version + 1`,
        updated_at: sql<Date>`now()`,
        updated_by: actor.userId,
      })
      .where("id", "=", row.id)
      .where("version", "=", row.version)
      .returningAll()
      .executeTakeFirstOrThrow();
    await record(tx, audit, {
      action,
      recordType: "procedure_step_definition",
      recordId: row.id,
      organizationId: actor.organizationId,
      priorVersion: row.version,
      newVersion: updated.version,
      changes,
    });
    current.set(row.id, updated);
    return updated;
  };

  // Phase 1: set aside removed steps and steps whose position changes.
  for (const row of rows) {
    if (row.removed) continue;
    const next = wanted.get(row.step_key);
    if (next === undefined) await update(row, { removed: true }, "procedure_step_definition.remove");
    else if (next.ordinal !== row.ordinal || next.parallel_group !== row.parallel_group)
      await update(row, { removed: true }, "procedure_step_definition.set_aside");
  }
  // Phase 2: write every wanted step in its final form.
  for (const [key, next] of wanted) {
    const row = byKey.get(key);
    if (row === undefined) {
      const id = uuidv7();
      await tx
        .insertInto("procedure_step_definition")
        .values({
          ...next,
          id,
          procedure_definition_id: definitionId,
          removed: false,
          created_by: actor.userId,
          updated_by: actor.userId,
        })
        .execute();
      await record(tx, audit, {
        action: "procedure_step_definition.put",
        recordType: "procedure_step_definition",
        recordId: id,
        organizationId: actor.organizationId,
        newVersion: 1,
        changes: { step_key: { from: null, to: key }, ordinal: { from: null, to: next.ordinal } },
      });
    } else {
      await update(current.get(row.id) ?? row, { ...next, removed: false }, "procedure_step_definition.put");
    }
  }
}

async function removeDefinition(
  tx: Tx,
  request: FastifyRequest,
  versionId: string,
  rawCode: string,
): Promise<VersionRow> {
  const actor = await requireWrite(tx, request, "methodology.configure");
  const expected = requireIfMatch(request);
  const current = await lockedDraft(tx, versionId, expected);
  const code = codeOf(rawCode);
  const [resolved] = await loadDefinitions(tx, current, { code, includeRemoved: true });
  if (resolved === undefined) throw problems.notFound();
  // REQ-S06-003: a seeded procedure is editable but never deleted (CHECK procedure_definition_source_kept).
  if (resolved.row.origin === "source") throw definitionRefusal("procedure_definition.source_protected");
  if (resolved.row.removed) return current; // already removed: nothing to write
  const audit = auditContextOf(request);
  await materializeDraftRows(tx, audit, actor, current);
  const row = await tx
    .selectFrom("procedure_definition")
    .selectAll()
    .where("methodology_version_id", "=", current.id)
    .where("code", "=", code)
    .forUpdate()
    .executeTakeFirstOrThrow();
  const updated = await tx
    .updateTable("procedure_definition")
    .set({ removed: true, version: sql<number>`version + 1`, updated_at: sql<Date>`now()`, updated_by: actor.userId })
    .where("id", "=", row.id)
    .where("version", "=", row.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, audit, {
    action: "procedure_definition.remove",
    recordType: "procedure_definition",
    recordId: row.id,
    organizationId: actor.organizationId,
    priorVersion: row.version,
    newVersion: updated.version,
    changes: { removed: { from: false, to: true } },
  });
  return stepDraft(tx, audit, actor, current, "procedure_remove", code);
}

// ------------------------------------------------------------------------------------------------ reads

/**
 * The version a read is about: the given `procedure` version, else the newest published `procedures` version. A
 * version that is not published is Studio content: it is visible only with methodology.read (else 404).
 */
async function readVersion(db: DbOrTx, principal: Principal, versionId: string | undefined): Promise<VersionRow> {
  const v = versionId === undefined ? await newestPublishedProcedures(db) : await loadProcedureVersion(db, versionId);
  if (v.status !== "published" && !holds(principal, "methodology.read")) throw problems.notFound();
  return v;
}

const listQuery = procedureDefinitionListQuery.extend({ cursor: cursorSchema, limit: limitSchema });
// A malformed code on a read is a 400 at /params/procedureCode (the contract's pattern); on a write it is the ADR-0042
// §10 refusal 422 procedure_definition.code_invalid (codeOf).
const codeParams = z.strictObject({ procedureCode: procedureCodeSchema });
const adminParams = z.strictObject({ versionId: z.uuid(), procedureCode: z.string().min(1).max(64) });

export function registerProcedureDefinitionRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const read = { access: { permission: "procedure.read" as const } };
  const configure = { access: { permission: "methodology.configure" as const } };

  app.get(DEFINITIONS, { config: read }, async (request) => {
    const query = parseQuery(listQuery, request.query);
    const principal = principalOf(request);
    requireOrgPermission(principal, "procedure.read");
    const v = await readVersion(db, principal, query.versionId);
    const hash = filterHash({ versionId: v.id, includeRemoved: query.includeRemoved });
    const after = decodeCursor(query.cursor, hash, 2);
    const all = await loadDefinitions(db, v, { includeRemoved: query.includeRemoved });
    const rows =
      after === null
        ? all
        : all.filter(
            (d) =>
              d.row.ordinal > Number(after[0]) || (d.row.ordinal === Number(after[0]) && d.row.code > String(after[1])),
          );
    const page = paginate(rows.slice(0, query.limit + 1), query.limit, (d) => [d.row.ordinal, d.row.code], hash);
    return { items: page.items.map((d) => presentDefinition(v, d)), nextCursor: page.nextCursor };
  });

  app.post(VALIDATE, { config: { ...configure, consumes: JSON_BODY } }, async (request) => {
    requireOrgPermission(principalOf(request), "methodology.configure");
    const body = parseBody(procedureDefinitionInput, request.body);
    const findings = validateDefinitionBody(body);
    return { valid: findings.length === 0, findings };
  });

  app.get(ONE, { config: read }, async (request, reply) => {
    const { procedureCode } = parse(codeParams, request.params, "params");
    const query = parseQuery(procedureDefinitionReadQuery, request.query);
    const principal = principalOf(request);
    requireOrgPermission(principal, "procedure.read");
    const v = await readVersion(db, principal, query.versionId);
    const [d] = await loadDefinitions(db, v, { code: procedureCode, includeRemoved: true });
    if (d === undefined) throw problems.notFound();
    return sendVersioned(reply, 200, presentDefinition(v, d));
  });

  app.put(ADMIN_ONE, { config: { ...configure, consumes: JSON_BODY } }, async (request, reply) => {
    const { versionId, procedureCode } = parse(adminParams, request.params, "params");
    const out = await db.transaction().execute((tx) => putDefinition(tx, request, versionId, procedureCode));
    // The ETag is the DRAFT's version: the If-Match of the next edit of this draft (OpenAPI putProcedureDefinition).
    reply.header("ETag", etag(out.draft.version));
    return reply.code(200).send(out.definition);
  });

  app.post(ADMIN_REMOVE, { config: configure }, async (request, reply) => {
    const { versionId, procedureCode } = parse(adminParams, request.params, "params");
    const draft = await db.transaction().execute((tx) => removeDefinition(tx, request, versionId, procedureCode));
    return sendVersioned(reply, 200, await presentConfigVersion(db, draft));
  });

  return [`GET ${DEFINITIONS}`, `POST ${VALIDATE}`, `GET ${ONE}`, `PUT ${ADMIN_ONE}`, `POST ${ADMIN_REMOVE}`];
}
