// zod mirrors of the P5 slice A methodology-migration and gate re-approval operations (docs/api/openapi.yaml tag
// `methodology-migrations`: listMethodologyMigrations, createMethodologyMigration, getMethodologyMigration,
// previewMethodologyMigration, submitMethodologyMigration, decideMethodologyMigration, executeMethodologyMigration,
// withdrawMethodologyMigration, listGateReapprovals; ADR-0040 §1-§4, §8; REQ-S06-008, REQ-S06-010; p5-work-split §A.5;
// T-DG5-BE-C). The OpenAPI file is the source of truth; the contract test parses every success body with these.
// Approving a migration and re-approving a gate are BUSINESS approvals inside the product, made by people; nothing
// here relates to the engineering delivery gates DG0-DG7.
import { z } from "zod";
import { freeText, page, timestamp, uuid } from "./common.ts";
import { configKind } from "./studio.ts";

const sha256 = z.string().regex(/^[0-9a-f]{64}$/);

// ------------------------------------------------------------------------------------------------ migrations

export const METHODOLOGY_MIGRATION_STATUSES = [
  "draft",
  "submitted",
  "changes_requested",
  "approved",
  "rejected",
  "withdrawn",
  "executed",
] as const;
export type MethodologyMigrationStatus = (typeof METHODOLOGY_MIGRATION_STATUSES)[number];
/** The statuses in which a migration is open (the 0063 unique index `methodology_migration_one_open_key`). */
export const OPEN_METHODOLOGY_MIGRATION_STATUSES = ["draft", "submitted", "changes_requested", "approved"] as const;

export const MIGRATION_ITEM_KINDS = [
  "mapping",
  "new_required_field",
  "invalidated_calculation",
  "reapproval",
  "removed_element",
  "unchanged_history",
] as const;
export type MigrationItemKind = (typeof MIGRATION_ITEM_KINDS)[number];
export const MIGRATION_ITEM_RESOLUTIONS = ["automatic", "needs_input", "provided", "acknowledged"] as const;
export type MigrationItemResolution = (typeof MIGRATION_ITEM_RESOLUTIONS)[number];

/** One plan item of a revision (`MethodologyMigrationItem`; ADR-0040 §2). */
export const methodologyMigrationItem = z.strictObject({
  planRevision: z.number().int().min(1),
  ordinal: z.number().int().min(1),
  itemKind: z.enum(MIGRATION_ITEM_KINDS),
  elementType: z.string().nullable(),
  stableKey: z.string().nullable(),
  recordType: z.string().nullable(),
  recordId: uuid.nullable(),
  gateCode: z
    .string()
    .regex(/^G[1-6]$/)
    .nullable(),
  resolution: z.enum(MIGRATION_ITEM_RESOLUTIONS),
  detail: z.record(z.string(), z.unknown()),
});
export type MethodologyMigrationItem = z.infer<typeof methodologyMigrationItem>;

/** The deliberate, approved move of one pin (`MethodologyMigration`); `items` are the latest plan revision. */
export const methodologyMigration = z.strictObject({
  id: uuid,
  transformationId: uuid,
  configKind,
  fromVersionId: uuid,
  toVersionId: uuid,
  status: z.enum(METHODOLOGY_MIGRATION_STATUSES),
  reason: z.string().min(3).max(4000),
  planRevision: z.number().int().min(1),
  planSha256: sha256.nullable(),
  planReady: z.boolean(),
  items: z.array(methodologyMigrationItem),
  requestedBy: uuid,
  submittedBy: uuid.nullable(),
  submittedAt: timestamp.nullable(),
  approvalId: uuid.nullable(),
  decidedBy: uuid.nullable(),
  decidedAt: timestamp.nullable(),
  executedBy: uuid.nullable(),
  executedAt: timestamp.nullable(),
  withdrawnAt: timestamp.nullable(),
  version: z.number().int().min(1),
  createdAt: timestamp,
  updatedAt: timestamp,
});
export type MethodologyMigration = z.infer<typeof methodologyMigration>;
export const methodologyMigrationPage = page(methodologyMigration);

/** createMethodologyMigration body (`MethodologyMigrationCreate`). */
export const methodologyMigrationCreate = z.strictObject({
  configKind,
  toVersionId: uuid,
  reason: freeText(3, 4000),
});
export type MethodologyMigrationCreate = z.infer<typeof methodologyMigrationCreate>;

/**
 * previewMethodologyMigration body (`MethodologyMigrationPreviewRequest`): the admin's inputs for new required fields,
 * keyed by the item's stable key. `value: null` means "leave empty until the record's next edit" (ADR-0040 §2).
 */
export const methodologyMigrationPreviewRequest = z.strictObject({
  inputs: z
    .array(z.strictObject({ stableKey: z.string().min(1).max(96), value: z.unknown() }))
    .max(200)
    .refine((a) => new Set(a.map((i) => i.stableKey)).size === a.length, "validation.unique_items"),
});
export type MethodologyMigrationPreviewRequest = z.infer<typeof methodologyMigrationPreviewRequest>;

/** decideMethodologyMigration body (`MethodologyMigrationDecision`): a person's decision with a rationale. */
export const methodologyMigrationDecision = z.strictObject({
  outcome: z.enum(["approve", "reject", "request_changes"]),
  rationale: freeText(1, 8000),
});
export type MethodologyMigrationDecision = z.infer<typeof methodologyMigrationDecision>;

// ------------------------------------------------------------------------------------------------ re-approvals

export const GATE_REAPPROVAL_STATUSES = ["required", "satisfied", "superseded"] as const;
export type GateReapprovalStatus = (typeof GATE_REAPPROVAL_STATUSES)[number];

/** A gate that needs business re-approval after a migration (`GateReapproval`); the approved decision stays. */
export const gateReapproval = z.strictObject({
  id: uuid,
  migrationId: uuid,
  gateInstanceId: uuid,
  gateCode: z.string().regex(/^G[1-6]$/),
  approvedDecisionId: uuid,
  status: z.enum(GATE_REAPPROVAL_STATUSES),
  satisfiedDecisionId: uuid.nullable(),
  workItemId: uuid.nullable(),
  resolvedAt: timestamp.nullable(),
  version: z.number().int().min(1),
  createdAt: timestamp,
});
export type GateReapproval = z.infer<typeof gateReapproval>;
export const gateReapprovalPage = page(gateReapproval);
