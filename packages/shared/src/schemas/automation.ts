// zod mirrors of the P5 slice D automation components (docs/api/openapi.yaml tag `automation`; ADR-0043 §1-§4, §9;
// T-DG5-BE-H, p5-work-split §D.1): rule content (triggers, conditions, actions, identity, service permissions,
// parameters), the rule and version request bodies, and the response mirrors of the catalogue, rules and versions.
// The OpenAPI file is the source of truth; the contract test parses every success body with these.
// Human decisions stay human (REQ-S12-026, M0242): the six human-only action codes are named here only so the API can
// refuse them by name. Nothing here grants or records a business approval (G1-G6), and nothing here concerns the
// engineering gates DG0-DG7.
import { z } from "zod";
import { freeText, page, permissionCode, roleCode, timestamp, uuid, version } from "./common.ts";

const nullableUuid = uuid.nullable();
const nullableTimestamp = timestamp.nullable();

// ------------------------------------------------------------------------------------------------ codes

/** The action codes catalogued `human_only` by 0074 (ADR-0043 §2): never automated, refused before any write. */
export const HUMAN_ONLY_ACTION_CODES = [
  "approve_gate",
  "decide_approval",
  "decide_investment",
  "attest_finance_value",
  "decide_executive_ask",
  "approve_methodology_migration",
] as const;
export type HumanOnlyActionCode = (typeof HUMAN_ONLY_ACTION_CODES)[number];

export const AUTOMATION_CONDITION_OPS = ["eq", "neq", "in", "gt", "gte", "lt", "lte", "present", "absent"] as const;
export type AutomationConditionOp = (typeof AUTOMATION_CONDITION_OPS)[number];
export const AUTOMATION_RUN_AS = ["initiating_user", "service"] as const;
export const AUTOMATION_RULE_ORIGINS = ["starter", "admin"] as const;
export const AUTOMATION_SCOPE_LEVELS = ["platform", "organization", "transformation"] as const;
export const AUTOMATION_VERSION_STATUSES = [
  "draft",
  "in_review",
  "approved",
  "published",
  "superseded",
  "discarded",
] as const;
export type AutomationVersionStatus = (typeof AUTOMATION_VERSION_STATUSES)[number];

/** `automation_rule.code` (0074 CHECK). */
export const AUTOMATION_RULE_CODE_PATTERN = /^[a-z][a-z0-9_.]{2,63}$/;
/** `automation_trigger.code` (0074 CHECK). */
export const AUTOMATION_TRIGGER_CODE_PATTERN = /^[a-z_]+\.[a-z_.]+$/;
/** An action `type` (OpenAPI AutomationRuleContent; `automation_action_type.code` CHECK). */
export const AUTOMATION_ACTION_CODE_PATTERN = /^[a-z][a-z0-9_]{2,63}$/;
/** A condition `field` (an event payload member; OpenAPI AutomationRuleContent). */
export const AUTOMATION_CONDITION_FIELD_PATTERN = /^[a-z][a-zA-Z0-9]{0,39}$/;
/** A decimal string for the numeric operators (never a float; ADR-0043 §2, §10). */
export const AUTOMATION_DECIMAL_PATTERN = /^-?(0|[1-9][0-9]{0,17})(\.[0-9]{1,6})?$/;

// ------------------------------------------------------------------------------------------------ content (§2)

/** A condition value: a string, a decimal string, a boolean, or up to 50 strings (OpenAPI; no float ever). */
export const automationConditionValue = z.union([
  freeText(1, 500),
  z.boolean(),
  z.array(freeText(1, 500)).min(1).max(50),
]);

export const automationCondition = z.strictObject({
  field: z.string().regex(AUTOMATION_CONDITION_FIELD_PATTERN, "validation.condition_field"),
  op: z.enum(AUTOMATION_CONDITION_OPS),
  value: automationConditionValue.optional(),
});
export type AutomationCondition = z.infer<typeof automationCondition>;

/** One action of a version. `parameters` are validated by the action type's registry schema (ADR-0043 §2). */
export const automationAction = z.strictObject({
  type: z.string().regex(AUTOMATION_ACTION_CODE_PATTERN, "validation.action_type"),
  parameters: z.record(z.string(), z.unknown()).optional(),
  handlers: z.array(z.string().min(1).max(100)).max(6).optional(),
});
export type AutomationAction = z.infer<typeof automationAction>;

/** The content of a rule version (OpenAPI AutomationRuleContent), as a request member. */
export const automationRuleContent = z
  .strictObject({
    triggerCodes: z
      .array(z.string().max(100).regex(AUTOMATION_TRIGGER_CODE_PATTERN, "validation.trigger_code"))
      .min(1)
      .max(6),
    conditions: z.array(automationCondition).max(20).optional(),
    actions: z.array(automationAction).min(1).max(10),
    runAs: z.enum(AUTOMATION_RUN_AS),
    servicePermissionCodes: z.array(permissionCode).max(20).optional(),
    parameters: z.record(z.string(), z.unknown()).optional(),
  })
  .superRefine((c, ctx) => {
    // 0074 CHECK automation_rule_version_service_permissions: only a service identity holds service permissions.
    if (c.runAs === "initiating_user" && (c.servicePermissionCodes?.length ?? 0) > 0)
      ctx.addIssue({
        code: "custom",
        path: ["servicePermissionCodes"],
        message: "validation.service_permissions_need_service",
      });
  });
export type AutomationRuleContentInput = z.infer<typeof automationRuleContent>;

/** The stored, normalized content (every optional member present). */
export interface AutomationRuleContentStored {
  readonly triggerCodes: string[];
  readonly conditions: AutomationCondition[];
  readonly actions: AutomationAction[];
  readonly runAs: (typeof AUTOMATION_RUN_AS)[number];
  readonly servicePermissionCodes: string[];
  readonly parameters: Record<string, unknown>;
}

/** Fills the optional members with their defaults (no conditions, no service permissions, no parameters). */
export function normalizeAutomationContent(c: AutomationRuleContentInput): AutomationRuleContentStored {
  return {
    triggerCodes: [...c.triggerCodes],
    conditions: [...(c.conditions ?? [])],
    actions: c.actions.map((a) => ({ ...a })),
    runAs: c.runAs,
    servicePermissionCodes: [...(c.servicePermissionCodes ?? [])],
    parameters: { ...(c.parameters ?? {}) },
  };
}

// ------------------------------------------------------------------------------------------------ action parameters

/**
 * Message keys an admin action may use (rule 6: work items and notifications store a key and parameters, never a
 * sentence; the web client translates them at render time). Parameters filled by the engine: `ruleName`,
 * `triggerLabel`.
 */
export const AUTOMATION_MESSAGE_KEYS = [
  "automation.message.follow_up",
  "automation.message.review_needed",
  "automation.message.update_due",
  "automation.message.attention_required",
] as const;
export const automationMessageKey = z.enum(AUTOMATION_MESSAGE_KEYS);

/**
 * `create_task` (ADR-0043 §2): one `automation_task` work item (and its in-app notification) for each holder of
 * `assigneeRole` in the target transformation (the event's own, or `targetTransformationId`). `dueInWorkingDays` uses
 * the organization's business calendar; null/absent = no due date.
 */
export const createTaskActionParameters = z.strictObject({
  assigneeRole: roleCode,
  messageKey: automationMessageKey,
  dueInWorkingDays: z.number().int().min(1).max(60).optional(),
  targetTransformationId: uuid.optional(),
});
/** `notify`: one in-app notification (no work item) for each holder of `recipientRole` in the target. */
export const notifyActionParameters = z.strictObject({
  recipientRole: roleCode,
  messageKey: automationMessageKey,
  targetTransformationId: uuid.optional(),
});
/** `escalate`: one `automation_task` work item for each holder of the business role `toRole` in the target. */
export const escalateActionParameters = z.strictObject({
  toRole: roleCode,
  messageKey: automationMessageKey,
  targetTransformationId: uuid.optional(),
});

/**
 * The settings a starter version may change (ADR-0044 §1 "Configurable in a new version"); every other starter takes
 * none (`{}`).
 */
export const STARTER_PARAMETER_SCHEMAS: Readonly<Record<string, z.ZodType>> = {
  "starter.transformation_created": z.strictObject({ roleTaskDueWorkingDays: z.number().int().min(1).max(30) }),
  "starter.dependency_slip": z.strictObject({ minimumSlipDays: z.number().int().min(1).max(90) }),
};
export const emptyStarterParameters = z.strictObject({});

// ------------------------------------------------------------------------------------------------ requests

const optionalDescription = freeText(1, 2000);

export const automationRuleCreate = z.strictObject({
  code: z.string().regex(AUTOMATION_RULE_CODE_PATTERN, "validation.rule_code"),
  nameEn: freeText(1, 200),
  nameAr: freeText(1, 200),
  descriptionEn: optionalDescription.optional(),
  descriptionAr: optionalDescription.optional(),
  scopeLevel: z.enum(["organization", "transformation"]),
  organizationId: uuid,
  transformationId: uuid.optional(),
  ownerUserId: uuid,
  content: automationRuleContent,
});
export type AutomationRuleCreate = z.infer<typeof automationRuleCreate>;

export const automationRuleUpdate = z.strictObject({
  nameEn: freeText(1, 200).optional(),
  nameAr: freeText(1, 200).optional(),
  descriptionEn: optionalDescription.nullable().optional(),
  descriptionAr: optionalDescription.nullable().optional(),
  ownerUserId: uuid.optional(),
});
export type AutomationRuleUpdate = z.infer<typeof automationRuleUpdate>;

export const automationRuleDisable = z.strictObject({ reason: freeText(3, 1000) });

export const automationRuleVersionCreate = z.strictObject({ changeSummary: freeText(3, 2000).optional() });

export const automationRuleVersionUpdate = z.strictObject({
  content: automationRuleContent.optional(),
  changeSummary: freeText(3, 2000).nullable().optional(),
});

export const automationRuleListQuery = z.strictObject({
  origin: z.enum(AUTOMATION_RULE_ORIGINS).optional(),
  enabled: z.enum(["true", "false"]).optional(),
  transformationId: uuid.optional(),
});

// ------------------------------------------------------------------------------------------------ responses

export const automationTrigger = z.strictObject({
  code: z.string(),
  triggerKind: z.enum(["event", "schedule", "request"]),
  ownerModule: z.string(),
  labelEn: z.string(),
  labelAr: z.string(),
  conditionFields: z.array(z.string()).max(30),
  hasInitiatingUser: z.boolean(),
  adminSelectable: z.boolean(),
  sourceRef: z.string(),
});

export const automationActionType = z.strictObject({
  code: z.string(),
  actionClass: z.enum(["automatic", "human_only"]),
  ownerModule: z.string(),
  labelEn: z.string(),
  labelAr: z.string(),
  requiredPermissionCode: permissionCode.nullable(),
  adminSelectable: z.boolean(),
  parametersSchema: z.record(z.string(), z.unknown()),
  sourceRef: z.string(),
});

export const automationCatalogue = z.strictObject({
  triggers: z.array(automationTrigger),
  actionTypes: z.array(automationActionType),
});
export type AutomationCatalogue = z.infer<typeof automationCatalogue>;

export const automationRuleSummary = z.strictObject({ en: z.string(), ar: z.string() });
export type AutomationRuleSummary = z.infer<typeof automationRuleSummary>;

export const automationRule = z.strictObject({
  id: uuid,
  code: z.string(),
  origin: z.enum(AUTOMATION_RULE_ORIGINS),
  sourceRef: z.string().nullable(),
  nameEn: z.string(),
  nameAr: z.string(),
  descriptionEn: z.string().nullable(),
  descriptionAr: z.string().nullable(),
  scopeLevel: z.enum(AUTOMATION_SCOPE_LEVELS),
  organizationId: nullableUuid,
  transformationId: nullableUuid,
  ownerUserId: nullableUuid,
  ownerRoleCode: roleCode.nullable(),
  enabled: z.boolean(),
  disableAllowed: z.boolean(),
  disabledReason: z.string().nullable(),
  effectiveVersionId: nullableUuid,
  effectiveVersionNo: z.number().int().nullable(),
  openVersionNo: z.number().int().nullable(),
  summary: automationRuleSummary.nullable(),
  version,
  updatedAt: timestamp,
});
export type AutomationRule = z.infer<typeof automationRule>;
export const automationRulePage = page(automationRule);

/** Response content: the stored members, all present (a superset of the request shape's required members). */
export const automationRuleContentResponse = z.strictObject({
  triggerCodes: z.array(z.string()).min(1).max(6),
  conditions: z
    .array(automationCondition.extend({ value: z.unknown().optional() }))
    .max(20)
    .optional(),
  actions: z
    .array(
      z.strictObject({
        type: z.string(),
        parameters: z.record(z.string(), z.unknown()).optional(),
        handlers: z.array(z.string()).max(6).optional(),
      }),
    )
    .min(1)
    .max(10),
  runAs: z.enum(AUTOMATION_RUN_AS),
  servicePermissionCodes: z.array(permissionCode).max(20).optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
});

export const automationPlannedAction = z.strictObject({
  ordinal: z.number().int().min(1),
  actionType: z.string(),
  outcome: z.enum(["would_run", "forbidden", "invalid"]),
  target: z.record(z.string(), z.unknown()),
  idempotencyKey: z.string(),
  messageKey: z.string().nullable(),
});
export type AutomationPlannedAction = z.infer<typeof automationPlannedAction>;

export const automationDryRunFinding = z.strictObject({
  code: z.string(),
  pointer: z.string().optional(),
  messageEn: z.string(),
  messageAr: z.string(),
});

export const automationDryRun = z.strictObject({
  id: uuid,
  versionId: uuid,
  contentSha256: z.string(),
  outcome: z.enum(["pass", "fail"]),
  conditionsMet: z.boolean().nullable(),
  plannedActions: z.array(automationPlannedAction).max(10),
  findings: z.array(automationDryRunFinding).max(50),
  runBy: uuid,
  createdAt: timestamp,
});
export type AutomationDryRun = z.infer<typeof automationDryRun>;
export const automationDryRunPage = page(automationDryRun);

export const automationRuleVersion = z.strictObject({
  id: uuid,
  ruleId: uuid,
  versionNo: z.number().int().min(1),
  status: z.enum(AUTOMATION_VERSION_STATUSES),
  content: automationRuleContentResponse,
  contentSha256: z.string().regex(/^[0-9a-f]{64}$/),
  changeSummary: z.string().nullable(),
  lastDryRun: automationDryRun.nullable(),
  dryRunCurrent: z.boolean(),
  authoredBy: nullableUuid,
  submittedAt: nullableTimestamp,
  reviewedBy: nullableUuid,
  reviewedAt: nullableTimestamp,
  reviewNote: z.string().nullable(),
  publishedBy: nullableUuid,
  publishedAt: nullableTimestamp,
  supersededAt: nullableTimestamp,
  discardedAt: nullableTimestamp,
  summary: automationRuleSummary,
  version,
  updatedAt: timestamp,
});
export type AutomationRuleVersion = z.infer<typeof automationRuleVersion>;
export const automationRuleVersionPage = page(automationRuleVersion);

// ------------------------------------------------------------------------------------------------ executions and the
// failure queue (T-DG5-BE-I; ADR-0043 §5; OpenAPI AutomationExecution, AutomationActionResult, OperationalFailure)

export const automationActionResult = z.strictObject({
  attemptNo: z.number().int().min(1),
  ordinal: z.number().int().min(1),
  actionType: z.string(),
  idempotencyKey: z.string(),
  outcome: z.enum(["done", "existing", "skipped", "failed", "forbidden"]),
  resultRecordType: z.string().nullable(),
  resultRecordId: uuid.nullable(),
  errorCode: z.string().nullable(),
  createdAt: timestamp,
});
export type AutomationActionResult = z.infer<typeof automationActionResult>;

export const automationExecutionStatus = z.enum(["running", "succeeded", "skipped", "failed"]);

export const automationExecution = z.strictObject({
  id: uuid,
  ruleId: uuid,
  ruleCode: z.string(),
  versionId: uuid,
  versionNo: z.number().int().min(1),
  triggerCode: z.string(),
  triggerKey: z.string(),
  organizationId: uuid.nullable(),
  transformationId: uuid.nullable(),
  runAs: z.enum(["initiating_user", "service"]),
  initiatingUserId: uuid.nullable(),
  status: automationExecutionStatus,
  conditionsMet: z.boolean().nullable(),
  attemptNo: z.number().int().min(1),
  errorCode: z.string().nullable(),
  errorDetail: z.string().nullable(),
  startedAt: timestamp,
  finishedAt: nullableTimestamp,
  actionResults: z.array(automationActionResult),
});
export type AutomationExecution = z.infer<typeof automationExecution>;
export const automationExecutionPage = page(automationExecution);

export const automationExecutionListQuery = z.strictObject({
  ruleId: uuid.optional(),
  status: automationExecutionStatus.optional(),
  transformationId: uuid.optional(),
});

export const operationalFailureSource = z.enum(["rule_execution", "job"]);
export const operationalFailureStatus = z.enum(["open", "retrying", "resolved", "dismissed"]);

export const operationalFailure = z.strictObject({
  id: uuid,
  source: operationalFailureSource,
  organizationId: uuid.nullable(),
  executionId: uuid.nullable(),
  jobScheduleCode: z.string().nullable(),
  queueName: z.string(),
  jobId: z.string().nullable(),
  idempotencyKey: z.string(),
  errorCode: z.string(),
  errorMessage: z.string(),
  attempts: z.number().int().min(1),
  firstFailedAt: timestamp,
  lastFailedAt: timestamp,
  status: operationalFailureStatus,
  retryCount: z.number().int().min(0).max(20),
  lastRetryBy: uuid.nullable(),
  lastRetryAt: nullableTimestamp,
  resolvedAt: nullableTimestamp,
  dismissedBy: uuid.nullable(),
  dismissedAt: nullableTimestamp,
  dismissReason: z.string().nullable(),
  allowedActions: z.array(z.enum(["retry", "dismiss"])),
  version,
  updatedAt: timestamp,
});
export type OperationalFailure = z.infer<typeof operationalFailure>;
export const operationalFailurePage = page(operationalFailure);

export const operationalFailureListQuery = z.strictObject({
  source: operationalFailureSource.optional(),
  status: operationalFailureStatus.optional(),
});

/** OpenAPI OperationalFailureDismiss: the reason is free text (shared rule 1), 3-1000 characters. */
export const operationalFailureDismiss = z.strictObject({ reason: freeText(3, 1000) });
