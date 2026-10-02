// The workflows module's P2 registers (ADR-0015 §3, ADR-0016 §1; REQ-PB-042, REQ-S16-018 P2 subset):
//   dependencies (THE canonical dependency record, DEP-nn), owned actions, TOM workshops (B0063). Workshop mode -
//   participants, contributions / unresolved items and their conversion - lives in workshops.ts.
import { sql, type ActionItemTable, type DependencyTable, type TomWorkshopTable } from "@mth/db";
import {
  actionItemCreate,
  actionItemUpdate,
  dependencyCreate,
  dependencyUpdate,
  tomWorkshopCreate,
  tomWorkshopUpdate,
  type ActionItem,
  type Dependency,
  type TomWorkshop,
} from "@mth/shared/schemas";
import type { Selectable } from "kysely";
import type { z } from "zod";
import { iso, isoOrNull } from "../platform/index.ts";
import {
  assertActiveUsers,
  assertCatalogueCode,
  assertSameTransformation,
  col,
  pick,
  ruleProblem,
  type RegisterSpec,
} from "../transformations/index.ts";
import { nextCode } from "./codes.ts";

const T = "/api/v1/transformations/:transformationId";

const stamps = (r: {
  id: string;
  organization_id: string;
  transformation_id: string;
  version: number;
  created_at: Date;
  created_by: string;
  updated_at: Date;
  updated_by: string;
}) => ({
  id: r.id,
  organizationId: r.organization_id,
  transformationId: r.transformation_id,
  version: r.version,
  createdAt: iso(r.created_at),
  createdBy: r.created_by,
  updatedAt: iso(r.updated_at),
  updatedBy: r.updated_by,
});

// ------------------------------------------------------------------------------------------------ dependencies

type DependencyRow = Selectable<DependencyTable>;
const DEPENDENCY_COLS = [
  ["description", "description"],
  ["fromKind", "from_kind"],
  ["fromLabel", "from_label"],
  ["toKind", "to_kind"],
  ["toLabel", "to_label"],
  ["dependencyType", "dependency_type"],
  ["neededBy", "needed_by"],
  ["ownerUserId", "owner_user_id"],
  ["status", "status"],
  ["mitigation", "mitigation"],
  ["tomDimensionCode", "tom_dimension_code"],
  ["decisionId", "decision_id"],
] as const;
export const toDependency = (r: DependencyRow): Dependency => ({
  ...stamps(r),
  code: r.code,
  description: r.description,
  fromKind: r.from_kind as Dependency["fromKind"],
  fromLabel: r.from_label,
  toKind: r.to_kind as Dependency["toKind"],
  toLabel: r.to_label,
  dependencyType: r.dependency_type as Dependency["dependencyType"],
  neededBy: r.needed_by,
  ownerUserId: r.owner_user_id,
  status: r.status as Dependency["status"],
  mitigation: r.mitigation,
  tomDimensionCode: r.tom_dimension_code,
  decisionId: r.decision_id,
  archivedAt: isoOrNull(r.archived_at),
  archivedBy: r.archived_by,
  archiveReason: r.archive_reason,
});
export const dependencyRegister: RegisterSpec<DependencyRow, Dependency> = {
  table: "dependency",
  path: `${T}/dependencies`,
  idParam: "dependencyId",
  writeRules: [{ permission: "dependency.edit" }],
  createSchema: dependencyCreate,
  updateSchema: dependencyUpdate,
  toApi: toDependency,
  insertValues: (b: z.infer<typeof dependencyCreate>) => pick(b, DEPENDENCY_COLS),
  updateValues: (b: z.infer<typeof dependencyUpdate>) => pick(b, DEPENDENCY_COLS),
  check: async (m, ctx) => {
    await assertCatalogueCode(ctx.tx, "tom_dimension", col(m, "tom_dimension_code"), "/tomDimensionCode");
    await assertSameTransformation(ctx.tx, "decision", ctx.transformationId, col(m, "decision_id"), "/decisionId");
    // An endpoint of kind tom_dimension / decision names its record (P2 subset; initiatives arrive in P3).
    for (const side of ["from", "to"] as const) {
      const kind = col(m, `${side}_kind`);
      const label = col(m, `${side}_label`) ?? null;
      if ((kind === "external" || kind === "other" || kind === "initiative") && label === null)
        throw ruleProblem("dependency.endpoint_label", "Name the other side of the dependency.", `/${side}Label`);
    }
    await assertActiveUsers(ctx.tx, ctx.organizationId, [
      { id: col(m, "owner_user_id") as string | null, pointer: "/ownerUserId" },
    ]);
  },
  beforeInsert: async (values, ctx) => ({ ...values, code: await nextCode(ctx.tx, ctx.transformationId, "DEP") }),
  transitions: new Map([
    ["open", ["at_risk", "resolved"]],
    ["at_risk", ["open", "resolved"]],
    ["resolved", ["open"]],
  ]),
  auditFields: ["code", ...DEPENDENCY_COLS.map(([, c]) => c)],
  archive: {},
};

// ------------------------------------------------------------------------------------------------ actions

type ActionRow = Selectable<ActionItemTable>;
const ACTION_COLS = [
  ["title", "title"],
  ["description", "description"],
  ["ownerUserId", "owner_user_id"],
  ["dueDate", "due_date"],
  ["status", "status"],
] as const;
export const toActionItem = (r: ActionRow): ActionItem => ({
  ...stamps(r),
  title: r.title,
  description: r.description,
  ownerUserId: r.owner_user_id,
  dueDate: r.due_date,
  status: r.status as ActionItem["status"],
  sourceWorkshopItemId: r.source_workshop_item_id,
});
export const actionItemRegister: RegisterSpec<ActionRow, ActionItem> = {
  table: "action_item",
  path: `${T}/actions`,
  idParam: "actionItemId",
  // action.edit: any action; action.update_own: only actions the caller owns (ADR-0020 §3).
  writeRules: [{ permission: "action.edit" }, { permission: "action.update_own", scope: "own" }],
  // An update_own holder may create an action only for themselves (the new row's owner must be the caller).
  createOwnership: (raw) => ({
    ownerUserId:
      raw !== null && typeof raw === "object" && typeof (raw as { ownerUserId?: unknown }).ownerUserId === "string"
        ? (raw as { ownerUserId: string }).ownerUserId
        : null,
  }),
  createSchema: actionItemCreate,
  updateSchema: actionItemUpdate,
  toApi: toActionItem,
  insertValues: (b: z.infer<typeof actionItemCreate>) => pick(b, ACTION_COLS),
  updateValues: (b: z.infer<typeof actionItemUpdate>) => pick(b, ACTION_COLS),
  check: (m, ctx) =>
    assertActiveUsers(ctx.tx, ctx.organizationId, [
      { id: col(m, "owner_user_id") as string | null, pointer: "/ownerUserId" },
    ]),
  transitions: new Map([
    ["open", ["in_progress", "done", "cancelled"]],
    ["in_progress", ["open", "done", "cancelled"]],
    ["done", ["in_progress"]],
    ["cancelled", ["open"]],
  ]),
  auditFields: ACTION_COLS.map(([, c]) => c),
  archive: false,
  ops: { archive: false },
};

// ------------------------------------------------------------------------------------------------ workshops

type WorkshopRow = Selectable<TomWorkshopTable>;
const WORKSHOP_COLS = [
  ["title", "title"],
  ["workshopDate", "workshop_date"],
  ["durationMinutes", "duration_minutes"],
  ["agenda", "agenda"],
  ["facilitatorUserId", "facilitator_user_id"],
  ["status", "status"],
] as const;
export const toTomWorkshop = (r: WorkshopRow): TomWorkshop => ({
  ...stamps(r),
  title: r.title,
  workshopDate: r.workshop_date,
  durationMinutes: r.duration_minutes,
  agenda: r.agenda,
  facilitatorUserId: r.facilitator_user_id,
  status: r.status as TomWorkshop["status"],
  closedAt: isoOrNull(r.closed_at),
  closedBy: r.closed_by,
});
export const tomWorkshopRegister: RegisterSpec<WorkshopRow, TomWorkshop> = {
  table: "tom_workshop",
  path: `${T}/tom-workshops`,
  idParam: "workshopId",
  writeRules: [{ permission: "workshop.facilitate" }],
  createSchema: tomWorkshopCreate,
  updateSchema: tomWorkshopUpdate,
  toApi: toTomWorkshop,
  insertValues: (b: z.infer<typeof tomWorkshopCreate>) => pick(b, WORKSHOP_COLS),
  updateValues: (b: z.infer<typeof tomWorkshopUpdate>, current, ctx) => {
    const changes = pick(b, WORKSHOP_COLS);
    // Closing records who and when (tom_workshop_closed_complete); the close guard refuses open unresolved items.
    return b.status === "closed" && current.status !== "closed"
      ? { ...changes, closed_at: sql<Date>`now()`, closed_by: ctx.userId }
      : changes;
  },
  check: async (m, ctx, current) => {
    if (current !== null && current.status !== "closed" && col(m, "status") === "closed") {
      const open = await ctx.tx
        .selectFrom("tom_workshop_item")
        .select("id")
        .where("workshop_id", "=", current.id)
        .where("kind", "=", "unresolved")
        .where("status", "=", "open")
        .executeTakeFirst();
      if (open)
        throw ruleProblem(
          "workshop.unresolved_items",
          "Convert every unresolved item into a design decision or an owned action before closing the workshop.",
          "/status",
        );
    }
    if (current === null && col(m, "status") !== undefined && col(m, "status") !== "planned")
      throw ruleProblem("workshop.initial_status", "A new workshop starts planned.", "/status");
    await assertActiveUsers(ctx.tx, ctx.organizationId, [
      { id: col(m, "facilitator_user_id") as string, pointer: "/facilitatorUserId" },
    ]);
  },
  transitions: new Map([
    ["planned", ["in_progress", "closed"]],
    ["in_progress", ["planned", "closed"]],
  ]),
  auditFields: [...WORKSHOP_COLS.map(([, c]) => c), "closed_by"],
  archive: false,
  ops: { archive: false },
};
