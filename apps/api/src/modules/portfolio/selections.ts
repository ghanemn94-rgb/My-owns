// Portfolio selection (ADR-0021 §3, ADR-0023 §7; REQ-S09-003; T-DG3-BE-B):
//   POST /api/v1/initiatives/{id}/select      ranked -> selected            (portfolio.select; rationale; If-Match)
//   POST /api/v1/initiatives/{id}/deselect    selected|funded -> ranked     (portfolio.select; rationale; not launched)
//   GET  /api/v1/initiatives/{id}/selections  the append-only selection history, newest first (transformation.read)
//
// Selecting is a BUSINESS APPROVAL inside the product: a named person's recorded decision with rationale, timestamp
// and audit event, written as an append-only portfolio_selection row. Ranking never selects (a ranking only proposes an
// order); selection never funds (an initiative selected without a current approved funding decision is shown as
// 'Selected - unfunded' and cannot launch). Nothing here approves by itself, and nothing touches DG0-DG7.
//
// Delegation (`onBehalfOfUserId`): NOT offered. One rule for every P3 business approval (ADR-0021 §6, T-DG3-ARCH-03):
// the approver decides in person; `onBehalfOfUserId` is refused with 422 selection.on_behalf_not_supported at
// /onBehalfOfUserId and nothing is written. Uniform delegation arrives with REQ-S10-010 (P4).
import type { InitiativeRow, PortfolioSelectionRow } from "@mth/db";
import { selectionRequest, type PortfolioSelection, type Warning } from "@mth/shared/schemas";
import type { FastifyInstance } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
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
  parseQuery,
  sendVersioned,
  type ModuleDeps,
} from "../platform/index.ts";
import type { WriteContext } from "../transformations/index.ts";
import { loadSequencingFacts } from "./dispensations.ts";
import { applyStatusChange, readableInitiative, runInitiativeAction, transitionProblem } from "./repository.ts";
import { checkG1 } from "./sequencing.ts";

const BASE = "/api/v1/initiatives/:initiativeId";
const JSON_BODY = ["application/json"] as const;
const idParams = z.strictObject({ initiativeId: z.uuid() });

/** The exact English texts of ADR-0021 §3 for selection. */
export const SELECTION_REASONS = {
  "initiative.not_ranked": "The initiative is not in the current proposed ranking",
  "initiative.not_deselectable": "Only a selected or funded initiative that is not launched can be deselected",
} as const;

export function toPortfolioSelection(r: PortfolioSelectionRow): PortfolioSelection {
  return {
    id: r.id,
    organizationId: r.organization_id,
    transformationId: r.transformation_id,
    initiativeId: r.initiative_id,
    action: r.action as PortfolioSelection["action"],
    rationale: r.rationale,
    rankingSnapshotId: r.ranking_snapshot_id,
    decidedBy: r.decided_by,
    onBehalfOfUserId: r.on_behalf_of_user_id,
    decidedAt: iso(r.decided_at),
  };
}

/** The current proposed ranking snapshot that ranks this initiative (complete score), if any (ADR-0022). */
async function currentRankingOf(ctx: WriteContext, initiativeId: string): Promise<string | null> {
  const row = await ctx.tx
    .selectFrom("ranking_snapshot as s")
    .innerJoin("ranking_entry as e", "e.snapshot_id", "s.id")
    .select("s.id")
    .where("s.transformation_id", "=", ctx.transformationId)
    .where("s.status", "=", "current")
    .where("e.initiative_id", "=", initiativeId)
    .where("e.completeness", "=", "complete")
    .executeTakeFirst();
  return row?.id ?? null;
}

/** ADR-0021 §6: a P3 business approval is decided in person; acting on someone's behalf is refused (422). */
function refuseOnBehalf(onBehalfOf: string | undefined): void {
  if (onBehalfOf === undefined) return;
  const detail =
    "A portfolio selection is decided by the approver in person; deciding on someone's behalf is not available.";
  throw new HttpProblem({
    status: 422,
    type: "urn:mth:problem:validation",
    code: "selection.on_behalf_not_supported",
    title: "Business rule violated",
    detail,
    errors: [{ pointer: "/onBehalfOfUserId", code: "selection.on_behalf_not_supported", message: detail }],
  });
}

async function writeSelection(
  ctx: WriteContext,
  current: InitiativeRow,
  action: "selected" | "deselected",
  rationale: string,
  rankingSnapshotId: string | null,
  onBehalfOf: string | undefined,
): Promise<void> {
  const id = uuidv7();
  await ctx.tx
    .insertInto("portfolio_selection")
    .values({
      id,
      organization_id: ctx.organizationId,
      transformation_id: ctx.transformationId,
      initiative_id: current.id,
      action,
      rationale,
      ranking_snapshot_id: rankingSnapshotId,
      decided_by: ctx.userId,
      on_behalf_of_user_id: onBehalfOf ?? null,
    })
    .execute();
  const audit = onBehalfOf !== undefined ? { ...ctx.audit, onBehalfOfUserId: onBehalfOf } : ctx.audit;
  await record(ctx.tx, audit, {
    action: `portfolio_selection.${action === "selected" ? "select" : "deselect"}`,
    recordType: "portfolio_selection",
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId: ctx.transformationId,
    reason: rationale,
    changes: {
      initiativeId: { from: null, to: current.id },
      action: { from: null, to: action },
      rankingSnapshotId: { from: null, to: rankingSnapshotId },
    },
  });
  await applyStatusChange(
    { ...ctx, audit },
    current,
    action === "selected" ? "selected" : "ranked",
    `initiative.${action === "selected" ? "select" : "deselect"}`,
    { reason: rationale },
  );
}

/** ranked -> selected: 1. in the current proposed ranking; 2. G1 approved (or inherited, Modular). All failing listed. */
async function select(
  ctx: WriteContext,
  current: InitiativeRow,
  body: { rationale: string; onBehalfOfUserId?: string | undefined },
): Promise<void> {
  refuseOnBehalf(body.onBehalfOfUserId);
  const snapshot = current.status === "ranked" ? await currentRankingOf(ctx, current.id) : null;
  const failures: Warning[] = [];
  if (snapshot === null)
    failures.push({
      code: "initiative.not_ranked",
      message: SELECTION_REASONS["initiative.not_ranked"],
      pointer: "/status",
    });
  const g1 = checkG1(await loadSequencingFacts(ctx.tx, ctx.transformationId));
  if (!g1.ok) failures.push({ code: g1.code, message: g1.reasonEn, pointer: "" });
  if (failures.length > 0) throw transitionProblem(failures[0]!.code, failures[0]!.message, failures);
  await writeSelection(ctx, current, "selected", body.rationale, snapshot, body.onBehalfOfUserId);
}

/** selected|funded -> ranked (never once launched). */
async function deselect(
  ctx: WriteContext,
  current: InitiativeRow,
  body: { rationale: string; onBehalfOfUserId?: string | undefined },
): Promise<void> {
  refuseOnBehalf(body.onBehalfOfUserId);
  if (current.status !== "selected" && current.status !== "funded")
    throw transitionProblem("initiative.not_deselectable", SELECTION_REASONS["initiative.not_deselectable"]);
  await writeSelection(ctx, current, "deselected", body.rationale, null, body.onBehalfOfUserId);
}

export function registerSelectionRoutes(app: FastifyInstance, { db }: ModuleDeps): readonly string[] {
  const read = { access: { permission: "transformation.read" as const } };
  const approve = { access: { permission: "portfolio.select" as const }, consumes: JSON_BODY };
  const listQuery = z.strictObject({ cursor: cursorSchema, limit: limitSchema });

  app.post(`${BASE}/select`, { config: approve }, async (request, reply) => {
    const { initiativeId } = parse(idParams, request.params, "params");
    const body = await runInitiativeAction(db, request, initiativeId, "portfolio.select", selectionRequest, select);
    return sendVersioned(reply, 200, body);
  });

  app.post(`${BASE}/deselect`, { config: approve }, async (request, reply) => {
    const { initiativeId } = parse(idParams, request.params, "params");
    const body = await runInitiativeAction(db, request, initiativeId, "portfolio.select", selectionRequest, deselect);
    return sendVersioned(reply, 200, body);
  });

  app.get(`${BASE}/selections`, { config: read }, async (request) => {
    const { initiativeId } = parse(idParams, request.params, "params");
    const query = parseQuery(listQuery, request.query);
    await readableInitiative(db, request, initiativeId);
    const hash = filterHash({ initiativeId });
    const after = decodeCursor(query.cursor, hash, 2);
    let q = db.selectFrom("portfolio_selection").selectAll().where("initiative_id", "=", initiativeId);
    if (after)
      q = q.where((eb) =>
        eb.or([
          eb("decided_at", "<", new Date(String(after[0]))),
          eb.and([eb("decided_at", "=", new Date(String(after[0]))), eb("id", "<", String(after[1]))]),
        ]),
      );
    const rows = await q
      .orderBy("decided_at", "desc")
      .orderBy("id", "desc")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.decided_at.toISOString(), r.id], hash);
    return { items: page.items.map(toPortfolioSelection), nextCursor: page.nextCursor };
  });

  return [`POST ${BASE}/select`, `POST ${BASE}/deselect`, `GET ${BASE}/selections`];
}
