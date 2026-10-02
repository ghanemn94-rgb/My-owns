// TOM Canvas (B0062; REQ-PB-041, REQ-S05-003): the ten source boxes, each a tom_canvas_cell row (pre-created by
// p2_instantiate_transformation) with current and target design and owner, aggregated with the records that reference
// the same dimension - T03 gaps, T04 design decisions, dependencies - and the evidence linked to the box. One register
// per record type (no copies): the canvas is a read model over them.
import { diffFields, type Db, type DbOrTx, type TomCanvasCellTable } from "@mth/db";
import { tomCanvasCellUpdate, type TomCanvasCell } from "@mth/shared/schemas";
import type { FastifyInstance } from "fastify";
import type { Selectable } from "kysely";
import { z } from "zod";
import { principalOf, requireTransformationRead } from "../access/index.ts";
import { record } from "../audit/index.ts";
import { toEvidence } from "../evidence/index.ts";
import { toTomDimension } from "../methodology/index.ts";
import { iso, parse, parseBody, problems, requireIfMatch } from "../platform/index.ts";
import { assertActiveUsers, bumpStamps, openWrite, pick, ruleProblem, toTomGap } from "../transformations/index.ts";
import { decisionsWithOptions } from "./decisions.ts";
import { toDependency } from "./design-registers.ts";

const C = "/api/v1/transformations/:transformationId/tom-canvas";
const cellParams = z.strictObject({
  transformationId: z.uuid(),
  dimensionCode: z.string().regex(/^[a-z][a-z0-9_]{0,47}$/),
});

type CellRow = Selectable<TomCanvasCellTable>;
export const toTomCanvasCell = (r: CellRow): TomCanvasCell => ({
  id: r.id,
  organizationId: r.organization_id,
  transformationId: r.transformation_id,
  dimensionCode: r.dimension_code,
  currentDesign: r.current_design,
  targetDesign: r.target_design,
  ownerUserId: r.owner_user_id,
  status: r.status as TomCanvasCell["status"],
  version: r.version,
  createdAt: iso(r.created_at),
  createdBy: r.created_by,
  updatedAt: iso(r.updated_at),
  updatedBy: r.updated_by,
});

/** The canvas of a transformation: one view per TOM dimension in source order (only `dimensionCode` when given). */
export async function canvasViews(db: DbOrTx, transformationId: string, dimensionCode?: string) {
  let cellsQ = db
    .selectFrom("tom_canvas_cell as c")
    .innerJoin("tom_dimension as d", "d.code", "c.dimension_code")
    .selectAll("c")
    .select("d.ordinal")
    .where("c.transformation_id", "=", transformationId);
  if (dimensionCode !== undefined) cellsQ = cellsQ.where("c.dimension_code", "=", dimensionCode);
  const cells = await cellsQ.orderBy("d.ordinal").execute();
  if (cells.length === 0) return [];
  const codes = cells.map((c) => c.dimension_code);
  const [dims, gaps, decisions, dependencies, evidence] = await Promise.all([
    db.selectFrom("tom_dimension").selectAll().where("code", "in", codes).execute(),
    db
      .selectFrom("tom_gap")
      .selectAll()
      .where("transformation_id", "=", transformationId)
      .where("dimension_code", "in", codes)
      .where("status", "<>", "archived")
      .orderBy("id")
      .execute(),
    db
      .selectFrom("decision")
      .selectAll()
      .where("transformation_id", "=", transformationId)
      .where("kind", "=", "design")
      .where("tom_dimension_code", "in", codes)
      .orderBy("id")
      .execute(),
    db
      .selectFrom("dependency")
      .selectAll()
      .where("transformation_id", "=", transformationId)
      .where("tom_dimension_code", "in", codes)
      .where("status", "<>", "archived")
      .orderBy("id")
      .execute(),
    db
      .selectFrom("evidence_link as l")
      .innerJoin("evidence as e", "e.id", "l.evidence_id")
      .selectAll("e")
      .select("l.record_id as linked_cell_id")
      .where("l.transformation_id", "=", transformationId)
      .where("l.record_type", "=", "tom_canvas_cell")
      .where("l.status", "=", "active")
      .where(
        "l.record_id",
        "in",
        cells.map((c) => c.id),
      )
      .orderBy("e.id")
      .execute(),
  ]);
  const decisionViews = await decisionsWithOptions(db, decisions);
  const dimByCode = new Map(dims.map((d) => [d.code, d]));
  return cells.map(({ ordinal: _o, ...cell }) => ({
    cell: toTomCanvasCell(cell),
    dimension: toTomDimension(dimByCode.get(cell.dimension_code)!),
    gaps: gaps.filter((g) => g.dimension_code === cell.dimension_code).map(toTomGap),
    decisions: decisionViews.filter((d) => d.tomDimensionCode === cell.dimension_code),
    dependencies: dependencies.filter((d) => d.tom_dimension_code === cell.dimension_code).map(toDependency),
    evidence: evidence.filter((e) => e.linked_cell_id === cell.id).map(({ linked_cell_id: _l, ...e }) => toEvidence(e)),
  }));
}

export function registerCanvasRoutes(app: FastifyInstance, db: Db): string[] {
  const read = { access: { permission: "transformation.read" as const } };

  app.get(C, { config: read }, async (request) => {
    const { transformationId } = parse(z.strictObject({ transformationId: z.uuid() }), request.params, "params");
    await requireTransformationRead(db, principalOf(request), transformationId);
    const cells = await canvasViews(db, transformationId);
    if (cells.length !== 10) throw problems.notFound();
    return { cells };
  });

  app.get(`${C}/:dimensionCode`, { config: read }, async (request, reply) => {
    const { transformationId, dimensionCode } = parse(cellParams, request.params, "params");
    await requireTransformationRead(db, principalOf(request), transformationId);
    const [view] = await canvasViews(db, transformationId, dimensionCode);
    if (!view) throw problems.notFound();
    reply.header("ETag", `"${view.cell.version}"`);
    return view;
  });

  app.patch(`${C}/:dimensionCode`, { config: { access: { permission: "tom.edit" } } }, async (request, reply) => {
    const { transformationId, dimensionCode } = parse(cellParams, request.params, "params");
    await db.transaction().execute(async (tx) => {
      const ctx = await openWrite(tx, request, transformationId, [{ permission: "tom.edit" }], null);
      const body = parseBody(tomCanvasCellUpdate, request.body);
      const expected = requireIfMatch(request);
      const current = await tx
        .selectFrom("tom_canvas_cell")
        .selectAll()
        .where("transformation_id", "=", transformationId)
        .where("dimension_code", "=", dimensionCode)
        .forUpdate()
        .executeTakeFirst();
      if (!current) throw problems.notFound();
      if (current.version !== expected) throw problems.versionConflict(current.version);
      const changes = pick(body, [
        ["currentDesign", "current_design"],
        ["targetDesign", "target_design"],
        ["ownerUserId", "owner_user_id"],
        ["status", "status"],
      ]);
      const merged = { ...current, ...changes } as CellRow;
      // A box is `ready` only with a target design and an owner (tom_canvas_cell_ready_complete; G3 criterion).
      if (merged.status === "ready" && (merged.target_design === null || merged.owner_user_id === null))
        throw ruleProblem(
          "tom_canvas.ready_incomplete",
          "A canvas box can be ready only with a target design and an owner.",
          "/status",
        );
      await assertActiveUsers(tx, ctx.organizationId, [{ id: merged.owner_user_id, pointer: "/ownerUserId" }]);
      const updated = await tx
        .updateTable("tom_canvas_cell")
        .set({ ...changes, ...bumpStamps(ctx.userId) })
        .where("id", "=", current.id)
        .where("version", "=", current.version)
        .returningAll()
        .executeTakeFirstOrThrow();
      await record(tx, ctx.audit, {
        action: "tom_canvas_cell.update",
        recordType: "tom_canvas_cell",
        recordId: current.id,
        organizationId: ctx.organizationId,
        transformationId,
        priorVersion: current.version,
        newVersion: updated.version,
        changes: diffFields(current, updated, ["current_design", "target_design", "owner_user_id", "status"]),
      });
    });
    const [view] = await canvasViews(db, transformationId, dimensionCode);
    if (!view) throw problems.notFound();
    reply.header("ETag", `"${view.cell.version}"`);
    return view;
  });

  return [`GET ${C}`, `GET ${C}/:dimensionCode`, `PATCH ${C}/:dimensionCode`];
}
