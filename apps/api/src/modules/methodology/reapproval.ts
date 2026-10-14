// Gate re-approvals after an executed methodology migration (ADR-0040 §3, §4; D-142 Q9; REQ-S06-008 "Migration executed
// -> create reapproval tasks"; p5-work-split §A.5; T-DG5-BE-C):
//   GET /transformations/{transformationId}/gate-reapprovals   listGateReapprovals (transformation.read)
//
// On execution each `reapproval` plan item becomes ONE `gate_reapproval` row (status `required`) naming the gate's
// approved decision, which stays in history untouched with its submission and snapshot. A `gate_reapproval` work item
// is created for every active person holding `gate.submit` on the transformation (My Work, "Assigned actions"),
// exactly once (createWorkItemOnce, dedupe "gate_reapproval:<rowId>:<userId>"). A later migration that requires the same
// gate again marks the earlier required row `superseded` (its open tasks are cancelled). The gate engine
// (workflows/gates.ts) lets the gate be submitted again while the row is required, refuses the next gates with 422
// gate.reapproval_required, and satisfies the row when a person approves the gate again.
// This is a product default (D-142 Q9), not a business approval: nothing here approves a gate; people do.
import { sql, type AuditActor, type DbOrTx, type GateReapprovalTable, type Tx } from "@mth/db";
import type { GateReapproval } from "@mth/shared/schemas";
import type { FastifyInstance } from "fastify";
import type { Selectable } from "kysely";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import {
  grantApplies,
  loadGrants,
  principalOf,
  requireTransformationRead,
  type ResolvedTarget,
} from "../access/index.ts";
import { record, type AuditContext } from "../audit/index.ts";
import {
  cursorSchema,
  decodeCursor,
  filterHash,
  iso,
  isoOrNull,
  limitSchema,
  paginate,
  parse,
  parseQuery,
  problems,
  type ModuleDeps,
} from "../platform/index.ts";

type ReapprovalRow = Selectable<GateReapprovalTable>;

export const GATE_REAPPROVAL_KIND = "gate_reapproval";
export const GATE_REAPPROVAL_TASK_MESSAGE = "methodology.task.gate_reapproval";
const REAPPROVALS = "/api/v1/transformations/:transformationId/gate-reapprovals";

// ------------------------------------------------------------------------------------------------ the work-item port

/** A My Work item to create once (the shape of tasks' WorkItemInput, which methodology cannot import). */
export interface ReapprovalTaskInput {
  readonly organizationId: string;
  readonly transformationId: string | null;
  readonly kind: string;
  readonly assigneeUserId: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly linkPath: string;
  readonly messageKey: string;
  readonly messageParams: Readonly<Record<string, string | number | boolean | null>>;
  readonly dueDate: null;
  readonly dedupeKey: string;
}

/** tasks' createWorkItemOnce and closeWorkItemsOfSubject, as the composition root wires them (migrations.ts). */
export interface ReapprovalTaskPorts {
  readonly createWorkItem: (
    tx: Tx,
    actor: AuditActor,
    input: ReapprovalTaskInput,
  ) => Promise<{ readonly outcome: "created" | "existing"; readonly workItemId: string }>;
  readonly closeWorkItems: (
    tx: Tx,
    actor: AuditActor,
    subject: { organizationId: string; subjectType: string; subjectId: string; kinds?: readonly string[] },
    status: "done" | "cancelled",
  ) => Promise<number>;
}

const userActor = (audit: AuditContext): AuditActor => ({
  actorType: "user",
  actorUserId: audit.actorUserId,
  requestId: audit.requestId,
  source: "api",
});

// ------------------------------------------------------------------------------------------------ holders

/** The active people holding `gate.submit` on the transformation (sorted; technical admins and AUD never hold it). */
export async function gateSubmitHolders(db: DbOrTx, target: ResolvedTarget): Promise<string[]> {
  const candidates = await db
    .selectFrom("scoped_assignment as a")
    .innerJoin("app_user as u", "u.id", "a.user_id")
    .select("a.user_id")
    .distinct()
    .where("a.organization_id", "=", target.organizationId)
    .where("a.revoked_at", "is", null)
    .where("u.status", "=", "active")
    .execute();
  const out: string[] = [];
  for (const userId of candidates.map((c) => c.user_id).sort()) {
    const grants = await loadGrants(db, userId);
    if (grants.some((g) => grantApplies(g, "gate.submit", target))) out.push(userId);
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ execution

export interface ReapprovalItem {
  readonly gateCode: string;
  readonly detail: Readonly<Record<string, unknown>>;
}

/**
 * Creates the gate re-approvals of an executing migration, in its transaction, with one audit event per row written:
 * a required row per gate still approved (an earlier required row of the same gate becomes `superseded`), and its
 * work items. Returns the created rows.
 */
export async function createGateReapprovals(
  tx: Tx,
  audit: AuditContext,
  ports: ReapprovalTaskPorts,
  input: {
    readonly organizationId: string;
    readonly transformationId: string;
    readonly migrationId: string;
    readonly target: ResolvedTarget;
    readonly items: readonly ReapprovalItem[];
  },
): Promise<ReapprovalRow[]> {
  const by = audit.actorUserId;
  if (by === null) throw new Error("createGateReapprovals: a person executes a migration");
  const holders = input.items.length === 0 ? [] : await gateSubmitHolders(tx, input.target);
  const created: ReapprovalRow[] = [];
  for (const item of input.items) {
    const instance = await tx
      .selectFrom("gate_instance")
      .select(["id", "status"])
      .where("transformation_id", "=", input.transformationId)
      .where("gate_code", "=", item.gateCode)
      .forUpdate()
      .executeTakeFirst();
    if (instance === undefined) throw problems.internal();
    // The approved decision being re-approved: the gate's newest approved decision (the plan named the same one; a
    // gate is never decided again while approved without a required re-approval, so it cannot have moved).
    const decision = await tx
      .selectFrom("gate_decision")
      .select("id")
      .where("transformation_id", "=", input.transformationId)
      .where("gate_code", "=", item.gateCode)
      .where("outcome", "=", "approved")
      .orderBy("decided_at", "desc")
      .orderBy("id", "desc")
      .executeTakeFirst();
    if (decision === undefined) continue;
    const earlier = await tx
      .selectFrom("gate_reapproval")
      .selectAll()
      .where("gate_instance_id", "=", instance.id)
      .where("status", "=", "required")
      .forUpdate()
      .executeTakeFirst();
    if (earlier !== undefined) {
      const superseded = await tx
        .updateTable("gate_reapproval")
        .set({
          status: "superseded",
          resolved_at: sql<Date>`now()`,
          version: sql<number>`version + 1`,
          updated_at: sql<Date>`now()`,
          updated_by: by,
        })
        .where("id", "=", earlier.id)
        .where("version", "=", earlier.version)
        .returning("version")
        .executeTakeFirstOrThrow();
      await record(tx, audit, {
        action: "gate_reapproval.supersede",
        recordType: "gate_reapproval",
        recordId: earlier.id,
        organizationId: input.organizationId,
        transformationId: input.transformationId,
        priorVersion: earlier.version,
        newVersion: superseded.version,
        changes: {
          status: { from: "required", to: "superseded" },
          superseded_by_migration: { from: null, to: input.migrationId },
        },
      });
      await ports.closeWorkItems(
        tx,
        userActor(audit),
        {
          organizationId: input.organizationId,
          subjectType: GATE_REAPPROVAL_KIND,
          subjectId: earlier.id,
          kinds: [GATE_REAPPROVAL_KIND],
        },
        "cancelled",
      );
    }
    const id = uuidv7();
    await tx
      .insertInto("gate_reapproval")
      .values({
        id,
        organization_id: input.organizationId,
        transformation_id: input.transformationId,
        migration_id: input.migrationId,
        gate_instance_id: instance.id,
        gate_code: item.gateCode,
        approved_decision_id: decision.id,
        created_by: by,
        updated_by: by,
      })
      .execute();
    await record(tx, audit, {
      action: "gate_reapproval.create",
      recordType: "gate_reapproval",
      recordId: id,
      organizationId: input.organizationId,
      transformationId: input.transformationId,
      newVersion: 1,
      changes: {
        migration_id: { from: null, to: input.migrationId },
        gate_code: { from: null, to: item.gateCode },
        approved_decision_id: { from: null, to: decision.id },
      },
    });
    let firstWorkItem: string | null = null;
    for (const userId of holders) {
      const r = await ports.createWorkItem(tx, userActor(audit), {
        organizationId: input.organizationId,
        transformationId: input.transformationId,
        kind: GATE_REAPPROVAL_KIND,
        assigneeUserId: userId,
        subjectType: GATE_REAPPROVAL_KIND,
        subjectId: id,
        linkPath: `/transformations/${input.transformationId}/gates/${item.gateCode}`,
        messageKey: GATE_REAPPROVAL_TASK_MESSAGE,
        messageParams: { gateCode: item.gateCode },
        dueDate: null,
        dedupeKey: `${GATE_REAPPROVAL_KIND}:${id}:${userId}`,
      });
      firstWorkItem ??= r.workItemId;
    }
    let row = await tx.selectFrom("gate_reapproval").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
    if (firstWorkItem !== null) {
      // The row links the first assignee's task (the work_item_id column holds one; every holder has their own task).
      row = await tx
        .updateTable("gate_reapproval")
        .set({
          work_item_id: firstWorkItem,
          version: sql<number>`version + 1`,
          updated_at: sql<Date>`now()`,
          updated_by: by,
        })
        .where("id", "=", id)
        .where("version", "=", row.version)
        .returningAll()
        .executeTakeFirstOrThrow();
      await record(tx, audit, {
        action: "gate_reapproval.link_task",
        recordType: "gate_reapproval",
        recordId: id,
        organizationId: input.organizationId,
        transformationId: input.transformationId,
        priorVersion: 1,
        newVersion: row.version,
        changes: { work_item_id: { from: null, to: firstWorkItem }, task_count: { from: 0, to: holders.length } },
      });
    }
    created.push(row);
  }
  return created;
}

// ------------------------------------------------------------------------------------------------ read

export function toGateReapproval(r: ReapprovalRow): GateReapproval {
  return {
    id: r.id,
    migrationId: r.migration_id,
    gateInstanceId: r.gate_instance_id,
    gateCode: r.gate_code,
    approvedDecisionId: r.approved_decision_id,
    status: r.status as GateReapproval["status"],
    satisfiedDecisionId: r.satisfied_decision_id,
    workItemId: r.work_item_id,
    resolvedAt: isoOrNull(r.resolved_at),
    version: r.version,
    createdAt: iso(r.created_at),
  };
}

const params = z.strictObject({ transformationId: z.uuid() });
const listQuery = z.strictObject({ cursor: cursorSchema, limit: limitSchema });

/** Registers listGateReapprovals (called by registerMethodologyMigrationRoutes). */
export function registerGateReapprovalRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  app.get(REAPPROVALS, { config: { access: { permission: "transformation.read" } } }, async (request) => {
    const { transformationId } = parse(params, request.params, "params");
    const query = parseQuery(listQuery, request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const hash = filterHash({ transformationId });
    const after = decodeCursor(query.cursor, hash, 1);
    // Newest first: ids are UUIDv7 (time-ordered).
    let q = db.selectFrom("gate_reapproval").selectAll().where("transformation_id", "=", transformationId);
    if (after) q = q.where("id", "<", String(after[0]));
    const rows = await q
      .orderBy("id", "desc")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.id], hash);
    return { items: page.items.map(toGateReapproval), nextCursor: page.nextCursor };
  });
  return [`GET ${REAPPROVALS}`];
}
