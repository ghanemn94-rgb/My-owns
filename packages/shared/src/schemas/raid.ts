// P4 slice E mirrors of the T15 RAID register, the integrated RAID + decision log and the action register
// (backend-workflow-engineer, T-DG4-BE-D; ADR-0031 §1-§4, §10, §11; OpenAPI 1.3.0-p4 RaidEntry*, RaidAction*,
// RaidDecisionLog*). REQ-PB-078, REQ-PB-079, REQ-PB-080, REQ-S16-018 (Risk, Assumption, Issue, Action).
//
// - Type is the closed T15 set (B0128). Any other value is 400 with the error code `raid.type_invalid` at `/type`
//   (ADR-0031 §3); the API sets that code on the error (custom zod messages outside `validation.*` are not codes).
// - Probability is H/M/L for a Risk and n/a (null) otherwise (REQ-PB-080). The 422 refusals are business rules in the
//   API (`raid.probability_required`, `raid.probability_not_applicable`), not part of this shape.
// - A Dependency entry IS the canonical T08 dependency row (REQ-PB-078): `recordTable: "dependency"`, code DEP-nn.
import { z } from "zod";
import { freeText, page, timestamp, uuid, version } from "./common.ts";
import { businessDate } from "./kpi.ts";

const nullableUuid = uuid.nullable();
const nullableDate = businessDate.nullable();
const nullableTimestamp = timestamp.nullable();

/** ADR-0031 §3: the error code of a Type outside Risk/Assumption/Issue/Dependency, and its English text (S-11). */
export const RAID_TYPE_INVALID_CODE = "raid.type_invalid";
export const RAID_TYPE_INVALID_MESSAGE = "Type must be Risk, Assumption, Issue or Dependency.";

export const RAID_ENTRY_TYPES = ["risk", "assumption", "issue", "dependency"] as const;
export type RaidEntryType = (typeof RAID_ENTRY_TYPES)[number];
export const RAID_LEVELS = ["high", "medium", "low"] as const;
export const RAID_STATUSES = ["open", "in_progress", "closed"] as const;
export const ACTION_SOURCE_KINDS = ["workshop", "raid_entry", "dependency", "corrective_case", "none"] as const;
export type ActionSourceKind = (typeof ACTION_SOURCE_KINDS)[number];
export const RAID_ACTION_STATUSES = ["open", "in_progress", "done", "cancelled"] as const;

export const raidEntryType = z.enum(RAID_ENTRY_TYPES, { error: RAID_TYPE_INVALID_CODE });
export const raidLevel = z.enum(RAID_LEVELS);
export const raidStatus = z.enum(RAID_STATUSES);

/** OpenAPI `RaidEntry`: one T15 row (B0128) read from the canonical record through the `raid_register` view. */
export const raidEntry = z.strictObject({
  id: uuid,
  transformationId: uuid,
  type: raidEntryType,
  code: z.string().regex(/^(R|A|I|DEP)-[0-9]{2,6}$/),
  description: z.string().min(1).max(4000),
  impact: raidLevel.nullable(),
  probability: raidLevel.nullable(),
  ownerUserId: nullableUuid,
  dueDate: nullableDate,
  mitigation: z.string().min(1).max(4000).nullable(),
  status: raidStatus,
  recordStatus: z.string(),
  recordTable: z.enum(["raid_entry", "dependency"]),
  initiativeId: nullableUuid,
  closedAt: nullableTimestamp,
  closedBy: nullableUuid,
  closureNote: z.string().min(3).max(2000).nullable(),
  version,
  createdAt: timestamp,
  updatedAt: timestamp,
});
export type RaidEntry = z.infer<typeof raidEntry>;
export const raidEntryPage = page(raidEntry);

/** OpenAPI `RaidEntryCreate`. The endpoint fields apply to Dependency entries only (ADR-0031 §2). */
export const raidEntryCreate = z.strictObject({
  type: raidEntryType,
  description: freeText(1, 4000),
  impact: raidLevel,
  probability: raidLevel.nullable().optional(),
  ownerUserId: uuid,
  dueDate: nullableDate.optional(),
  mitigation: freeText(1, 4000).nullable().optional(),
  initiativeId: nullableUuid.optional(),
  fromInitiativeId: nullableUuid.optional(),
  toInitiativeId: nullableUuid.optional(),
  dependencyType: z
    .string()
    .regex(/^[a-z][a-z0-9_]{1,47}$/)
    .optional(),
});
export type RaidEntryCreate = z.infer<typeof raidEntryCreate>;

/** OpenAPI `RaidEntryUpdate` (minProperties 1). Closing is `closeRaidEntry`. */
export const raidEntryUpdate = z
  .strictObject({
    description: freeText(1, 4000).optional(),
    impact: raidLevel.optional(),
    probability: raidLevel.nullable().optional(),
    ownerUserId: uuid.optional(),
    dueDate: nullableDate.optional(),
    mitigation: freeText(1, 4000).nullable().optional(),
    initiativeId: nullableUuid.optional(),
    status: z.enum(["open", "in_progress"]).optional(),
  })
  .refine((v) => Object.keys(v).length >= 1, "validation.min_properties");
export type RaidEntryUpdate = z.infer<typeof raidEntryUpdate>;

/** OpenAPI `RaidEntryClose`. */
export const raidEntryClose = z.strictObject({ closureNote: freeText(3, 2000) });

/** OpenAPI `RaidAction`: an owned, person-authored action with its P4 source link and follow-up date. */
export const raidAction = z.strictObject({
  id: uuid,
  transformationId: uuid,
  title: z.string().min(1).max(500),
  description: z.string().min(1).max(4000).nullable(),
  ownerUserId: uuid,
  dueDate: nullableDate,
  followUpDate: nullableDate,
  status: z.enum(RAID_ACTION_STATUSES),
  sourceKind: z.enum(ACTION_SOURCE_KINDS),
  sourceWorkshopItemId: nullableUuid,
  raidEntryId: nullableUuid,
  dependencyId: nullableUuid,
  correctiveCaseId: nullableUuid,
  overdue: z.boolean(),
  version,
  createdAt: timestamp,
  createdBy: uuid,
  updatedAt: timestamp,
  updatedBy: uuid,
});
export type RaidAction = z.infer<typeof raidAction>;
export const raidActionPage = page(raidAction);

/** OpenAPI `RaidActionCreate`. */
export const raidActionCreate = z.strictObject({
  title: freeText(1, 500),
  description: freeText(1, 4000).nullable().optional(),
  ownerUserId: uuid,
  dueDate: nullableDate.optional(),
  followUpDate: nullableDate.optional(),
});
export type RaidActionCreate = z.infer<typeof raidActionCreate>;

/** OpenAPI `RaidActionUpdate` (minProperties 1); status changes follow the DG2 action transitions. */
export const raidActionUpdate = z
  .strictObject({
    title: freeText(1, 500).optional(),
    description: freeText(1, 4000).nullable().optional(),
    ownerUserId: uuid.optional(),
    dueDate: nullableDate.optional(),
    followUpDate: nullableDate.optional(),
    status: z.enum(RAID_ACTION_STATUSES).optional(),
  })
  .refine((v) => Object.keys(v).length >= 1, "validation.min_properties");
export type RaidActionUpdate = z.infer<typeof raidActionUpdate>;

/** OpenAPI `RaidDecisionLogItem`: an open RAID entry or an open design/executive decision, from its canonical row. */
export const raidDecisionLogItem = z.strictObject({
  itemKind: z.enum(["raid_entry", "decision"]),
  id: uuid,
  code: z.string(),
  kind: z.enum(["risk", "assumption", "issue", "dependency", "design", "executive"]),
  title: z.string(),
  ownerUserId: nullableUuid,
  dueDate: nullableDate,
  status: z.string(),
});
export type RaidDecisionLogItem = z.infer<typeof raidDecisionLogItem>;
export const raidDecisionLogPage = page(raidDecisionLogItem);
