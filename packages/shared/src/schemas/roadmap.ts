// P3 roadmap, T08 dependency and capacity view mirrors (solution-architect, T-DG3-ARCH-04; ADR-0023 §1-§6; FE-B handback
// §4.2, FE-A handback §5.4). They used to live only in the API route files (portfolio/waves.ts, capacity.ts,
// resource-demands.ts, workflows/t08-dependencies.ts, dependency-types.ts), and the web typed them again by hand. They
// are here now, so the API (response mirrors and the contract seam) and the web import ONE definition from
// `@mth/shared/schemas`. The API route files re-export these under their old names, so their imports are unchanged.
//
// They mirror these docs/api/openapi.yaml components: RoadmapWave(+List), RoadmapView, DependencyTypeCode,
// DependencyType(+List), T08Dependency(+Page), PeriodMonth, ResourceRole(+List), Capacity(+Page), CapacityPlanCell,
// CapacityPlan and ResourceDemand(+Page). The request schemas stay with their routes.
//
// Rules carried by these schemas (ADR-0019, ADR-0023 §6):
//  - FTE is a decimal string (`fte`, numeric(6,2)), never a JSON number;
//  - Unknown is null, never 0: `CapacityPlanCell.availableFte` and `shortfallFte` are null when no capacity row exists,
//    and `flag` is then `capacity.unknown`;
//  - schedule and capacity flags are warnings (`scheduleFlag`), never rejections.
import { z } from "zod";
import { timestamp, uuid, version } from "./common.ts";
import { fte } from "./business-case.ts";
import { DEPENDENCY_ENDPOINT_KINDS } from "./design.ts";
import { businessDate } from "./kpi.ts";
import { deliverable, initiative, milestone, scheduleFlag } from "./portfolio.ts";

const nullableUuid = uuid.nullable();
const nullableDate = businessDate.nullable();
const nullableTimestamp = timestamp.nullable();
const stamps = { version, createdAt: timestamp, createdBy: uuid, updatedAt: timestamp, updatedBy: uuid };
const recordCode = z.string().regex(/^[a-z][a-z0-9_]{0,47}$/);

// ------------------------------------------------------------------------------------------------ T07 waves

const weeks = z.number().int().min(0).max(520);

/** OpenAPI `RoadmapWave`. For the four seeded waves the *En texts are the B0079 source verbatim; Arabic is provisional. */
export const roadmapWave = z.strictObject({
  id: uuid,
  organizationId: uuid,
  transformationId: uuid,
  code: recordCode,
  ordinal: z.number().int().min(0).max(99),
  isSourceSeeded: z.boolean(),
  sourceRef: z.string().nullable(),
  nameEn: z.string(),
  nameAr: z.string(),
  purposeEn: z.string(),
  purposeAr: z.string(),
  horizonEn: z.string(),
  horizonAr: z.string(),
  entryCriteriaEn: z.string(),
  entryCriteriaAr: z.string(),
  exitEvidenceEn: z.string(),
  exitEvidenceAr: z.string(),
  horizonFromWeeks: weeks,
  horizonToWeeks: weeks,
  plannedStart: nullableDate,
  plannedEnd: nullableDate,
  ownerUserId: nullableUuid,
  notes: z.string().min(1).max(4000).nullable(),
  status: z.enum(["active", "archived"]),
  ...stamps,
});
export type RoadmapWave = z.infer<typeof roadmapWave>;
export const roadmapWaveList = z.strictObject({ items: z.array(roadmapWave) });

// ------------------------------------------------------------------------------------------------ T08 dependencies

/** OpenAPI `DependencyTypeCode`: an active catalogue code (an unknown or retired one is 422 dependency.unknown_type). */
export const dependencyTypeCode = z.string().regex(/^[a-z][a-z0-9_]{1,47}$/);

/** OpenAPI `DependencyType`: the global dependency-type catalogue (ADR-0023 §4, §8). */
export const dependencyType = z.strictObject({
  id: uuid,
  code: dependencyTypeCode,
  labelEn: z.string().min(1).max(100),
  labelAr: z.string().min(1).max(100),
  isSystem: z.boolean(),
  sourceRef: z.string().nullable(),
  ordinal: z.number().int().min(1).max(999),
  status: z.enum(["active", "retired"]),
  version,
});
export type DependencyType = z.infer<typeof dependencyType>;
export const dependencyTypeList = z.strictObject({ items: z.array(dependencyType) });

export const T08_DEPENDENCY_STATUSES = ["open", "at_risk", "resolved", "archived"] as const;

/** OpenAPI `T08Dependency`: a T08 row on THE canonical dependency record (shared with RAID; ADR-0023 §4). */
export const t08Dependency = z.strictObject({
  id: uuid,
  organizationId: uuid,
  transformationId: uuid,
  code: z.string().regex(/^DEP-[0-9]{2,6}$/),
  description: z.string().min(1).max(2000),
  fromKind: z.enum(DEPENDENCY_ENDPOINT_KINDS),
  fromLabel: z.string().min(1).max(300).nullable(),
  fromInitiativeId: nullableUuid,
  toKind: z.enum(DEPENDENCY_ENDPOINT_KINDS),
  toLabel: z.string().min(1).max(300).nullable(),
  toInitiativeId: nullableUuid,
  dependencyType: dependencyTypeCode,
  neededBy: nullableDate,
  ownerUserId: nullableUuid,
  status: z.enum(T08_DEPENDENCY_STATUSES),
  mitigation: z.string().min(1).max(4000).nullable(),
  decisionId: nullableUuid,
  flags: z.array(scheduleFlag),
  archivedAt: nullableTimestamp,
  archivedBy: nullableUuid,
  archiveReason: z.string().min(3).max(1000).nullable(),
  ...stamps,
});
export type T08Dependency = z.infer<typeof t08Dependency>;
export const t08DependencyPage = z.strictObject({ items: z.array(t08Dependency), nextCursor: z.string().nullable() });

// ------------------------------------------------------------------------------------------------ roadmap view

/** OpenAPI `RoadmapView`: the single read model behind the timeline, initiative table and work board (REQ-S09-006). */
export const roadmapView = z.strictObject({
  transformationId: uuid,
  waves: z.array(roadmapWave),
  initiatives: z.array(initiative),
  milestones: z.array(milestone),
  deliverables: z.array(deliverable),
  dependencies: z.array(t08Dependency),
});
export type RoadmapView = z.infer<typeof roadmapView>;

// ------------------------------------------------------------------------------------------------ capacity

/** OpenAPI `PeriodMonth`: the first day of a month (`YYYY-MM-01`). */
export const periodMonth = z.string().regex(/^[0-9]{4}-(0[1-9]|1[0-2])-01$/, "validation.period_month");

/** OpenAPI `ResourceRole`: a resourcing role ("Data engineer"), not an access role (ADR-0023 §6). */
export const resourceRole = z.strictObject({
  id: uuid,
  organizationId: uuid,
  transformationId: uuid,
  code: recordCode,
  labelEn: z.string().min(1).max(200),
  labelAr: z.string().min(1).max(200),
  status: z.enum(["active", "archived"]),
  ...stamps,
});
export type ResourceRole = z.infer<typeof resourceRole>;
export const resourceRoleList = z.strictObject({ items: z.array(resourceRole) });

/** OpenAPI `Capacity`: available FTE of one role in one month. */
export const capacity = z.strictObject({
  id: uuid,
  organizationId: uuid,
  transformationId: uuid,
  resourceRoleId: uuid,
  periodMonth,
  availableFte: fte,
  ownerUserId: nullableUuid,
  note: z.string().min(1).max(2000).nullable(),
  status: z.enum(["active", "archived"]),
  ...stamps,
});
export type Capacity = z.infer<typeof capacity>;
export const capacityPage = z.strictObject({ items: z.array(capacity), nextCursor: z.string().nullable() });

/** ADR-0023 §6 conflict flags of a capacity-plan cell. */
export const CAPACITY_FLAGS = { overAllocated: "capacity.over_allocated", unknown: "capacity.unknown" } as const;

/** OpenAPI `CapacityPlanCell`: `availableFte`/`shortfallFte` null = Unknown (no capacity row), never 0. */
export const capacityPlanCell = z.strictObject({
  resourceRoleId: uuid,
  periodMonth,
  availableFte: fte.nullable(),
  demandFte: fte,
  committedDemandFte: fte,
  shortfallFte: fte.nullable(),
  flag: z.enum([CAPACITY_FLAGS.overAllocated, CAPACITY_FLAGS.unknown]).nullable(),
});
export type CapacityPlanCell = z.infer<typeof capacityPlanCell>;

/** OpenAPI `CapacityPlan`: the role × month grid of GET /transformations/{id}/capacity-plan. */
export const capacityPlan = z.strictObject({
  transformationId: uuid,
  roles: z.array(resourceRole),
  cells: z.array(capacityPlanCell),
});
export type CapacityPlan = z.infer<typeof capacityPlan>;

export const RESOURCE_DEMAND_STATUSES = ["planned", "committed", "released", "archived"] as const;

/** OpenAPI `ResourceDemand`: `committed` is the capacity commitment G4 counts (capacity.commit; ADR-0023 §6, §9). */
export const resourceDemand = z.strictObject({
  id: uuid,
  organizationId: uuid,
  transformationId: uuid,
  initiativeId: uuid,
  resourceRoleId: uuid,
  periodMonth,
  demandFte: fte,
  ownerUserId: nullableUuid,
  note: z.string().min(1).max(2000).nullable(),
  status: z.enum(RESOURCE_DEMAND_STATUSES),
  committedBy: nullableUuid,
  committedAt: nullableTimestamp,
  ...stamps,
});
export type ResourceDemand = z.infer<typeof resourceDemand>;
export const resourceDemandPage = z.strictObject({
  items: z.array(resourceDemand),
  nextCursor: z.string().nullable(),
});
