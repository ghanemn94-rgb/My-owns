// Downstream impact of a record (P4 slice K; ADR-0038 §6; T-DG4-BE-M; REQ-S03-006 "changing a KPI target lists the
// linked benefits and dashboards as affected"; trigger "Record changed -> compute downstream impact list"):
//   GET /api/v1/records/{recordType}/{recordId}/impact[?cursor&limit]   (transformation.read of the record)
//
// - The walk follows `traceability_edge` DOWNSTREAM from the record (for a `kpi_definition`, from each of its active
//   outcome KPIs, which are listed at distance 1), transitively, at most 8 steps, with a visited set. Each reached record
//   carries its distance and the edge kinds of the first path found; benefits are flagged `valueAffected`.
// - `dashboards[]` names the T10 areas (ADR-0037) and dashboards that read the record or a reached record: an outcome,
//   outcome KPI or KPI definition -> `outcomes` (and `people_adoption` when an active adoption metric link names the
//   KPI definition, with the adoption dashboard); a benefit -> `value` and the Finance dashboard; an initiative or
//   deliverable -> `portfolio` (and `dependencies` when an open dependency names the initiative) and, for an initiative
//   in a workstream, that workstream's dashboard; every record -> the transformation dashboard and the Executive
//   Overview (the executive dashboard, ADR-0037 §2).
// - `hiddenCount`: reached records the caller may not read. Every edge of the view joins two records of ONE
//   transformation (composite foreign keys, 0055 TL13), and the caller can read the record's transformation (else 404),
//   so a reached record is always readable and the count is 0 by construction; it is computed, never assumed.
// - Computed on request in one read-only transaction; nothing is stored. It is a live read model, separate from the
//   frozen change-request impact assessment of ADR-0036 §5.
import {
  impactRecordType,
  type ImpactDashboardRef,
  type ImpactRecord,
  type ImpactRecordType,
  type RecordImpact,
} from "@mth/shared/schemas";
import type { DbOrTx } from "@mth/db";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { principalOf, requireTransformationRead } from "../access/index.ts";
import {
  cursorSchema,
  decodeCursor,
  filterHash,
  limitSchema,
  paginate,
  parse,
  parseQuery,
  problems,
  type ModuleDeps,
} from "../platform/index.ts";
import {
  hrefOf,
  indexEdges,
  loadChainRecords,
  loadEdges,
  nodeOrder,
  readOnly,
  TRACE_MAX_DEPTH,
  type ChainRecord,
} from "./traceability.ts";

const PATH = "/api/v1/records/:recordType/:recordId/impact";
const params = z.strictObject({ recordType: impactRecordType, recordId: z.uuid() });
const query = z.strictObject({ cursor: cursorSchema, limit: limitSchema });

/** The table of each impact record type (a Map, so no computed member indexes a record; ADR-0002 checks). */
const TABLE_OF = new Map<ImpactRecordType, "initiative">([
  ["diagnostic_finding", "diagnostic_finding" as "initiative"],
  ["tom_gap", "tom_gap" as "initiative"],
  ["initiative", "initiative"],
  ["deliverable", "deliverable" as "initiative"],
  ["capability", "capability" as "initiative"],
  ["outcome", "outcome" as "initiative"],
  ["outcome_kpi", "outcome_kpi" as "initiative"],
  ["benefit", "benefit" as "initiative"],
  ["kpi_definition", "kpi_definition" as "initiative"],
]);

/** The transformation of a record of `type`, or null when it does not exist. */
async function transformationOf(db: DbOrTx, type: ImpactRecordType, id: string): Promise<string | null> {
  // Every table of TABLE_OF has `id` and `transformation_id` (the cast only narrows Kysely's table union).
  const row = await db
    .selectFrom(TABLE_OF.get(type)!)
    .select("transformation_id")
    .where("id", "=", id)
    .executeTakeFirst();
  return row?.transformation_id ?? null;
}

interface Reached {
  readonly id: string;
  readonly distance: number;
  readonly edgeKinds: readonly string[];
}

/** Multi-source downstream walk with a visited set; the first path found to a record is kept. Pure. */
export function walkDownstream(
  outgoing: ReadonlyMap<string, readonly { to_id: string; edge_kind: string }[]>,
  sources: readonly Reached[],
  maxDepth: number,
): Map<string, Reached> {
  const seen = new Map<string, Reached>(sources.map((s) => [s.id, s]));
  let frontier = [...sources];
  while (frontier.length > 0) {
    const next: Reached[] = [];
    for (const from of frontier) {
      if (from.distance >= maxDepth) continue;
      for (const e of outgoing.get(from.id) ?? []) {
        if (seen.has(e.to_id)) continue;
        const r = { id: e.to_id, distance: from.distance + 1, edgeKinds: [...from.edgeKinds, e.edge_kind] };
        seen.set(e.to_id, r);
        next.push(r);
      }
    }
    frontier = next;
  }
  return seen;
}

/** The dashboards and T10 areas that read the root or a reached record (ADR-0038 §6). */
async function dashboardsOf(
  db: DbOrTx,
  transformationId: string,
  rootType: ImpactRecordType,
  rootKpiDefinitionId: string | null,
  touched: readonly ChainRecord[],
): Promise<ImpactDashboardRef[]> {
  const out = new Map<string, ImpactDashboardRef>();
  const add = (
    dashboard: ImpactDashboardRef["dashboard"],
    areaCode: ImpactDashboardRef["areaCode"],
    workstreamId: string | null = null,
  ) => {
    const ref = {
      dashboard,
      areaCode,
      transformationId: dashboard === "executive" ? null : transformationId,
      workstreamId,
    };
    out.set(`${dashboard}|${areaCode ?? ""}|${workstreamId ?? ""}`, ref);
  };
  const area = (code: NonNullable<ImpactDashboardRef["areaCode"]>) => {
    add("transformation", code);
    add("executive", code);
  };
  add("transformation", null);
  add("executive", null);
  const types = new Set<string>(touched.map((r) => r.type));
  if (rootType === "kpi_definition") types.add("kpi_definition");
  if (types.has("outcome") || types.has("outcome_kpi") || types.has("kpi_definition")) {
    area("outcomes");
    const defs = new Set<string>(
      touched.filter((r) => r.type === "outcome_kpi" && r.kpiDefinitionId).map((r) => r.kpiDefinitionId!),
    );
    if (rootKpiDefinitionId !== null) defs.add(rootKpiDefinitionId);
    if (defs.size > 0) {
      const link = await db
        .selectFrom("adoption_metric_link")
        .select("id")
        .where("transformation_id", "=", transformationId)
        .where("status", "=", "active")
        .where("kpi_definition_id", "in", [...defs])
        .executeTakeFirst();
      if (link) {
        area("people_adoption");
        add("adoption", "people_adoption");
      }
    }
  }
  if (types.has("benefit")) {
    area("value");
    add("finance", "value");
  }
  const initiatives = new Set<string>();
  for (const r of touched) {
    if (r.type === "initiative") initiatives.add(r.id);
    if (r.type === "deliverable" && r.initiativeId) initiatives.add(r.initiativeId);
  }
  if (initiatives.size > 0) {
    area("portfolio");
    const ids = [...initiatives];
    const dep = await db
      .selectFrom("dependency")
      .select("id")
      .where("transformation_id", "=", transformationId)
      .where("status", "in", ["open", "at_risk"])
      .where((eb) => eb.or([eb("from_initiative_id", "in", ids), eb("to_initiative_id", "in", ids)]))
      .executeTakeFirst();
    if (dep) area("dependencies");
    const streams = await db
      .selectFrom("workstream_initiative")
      .select("workstream_id")
      .where("transformation_id", "=", transformationId)
      .where("status", "=", "active")
      .where("initiative_id", "in", ids)
      .orderBy("workstream_id")
      .execute();
    for (const w of new Set(streams.map((s) => s.workstream_id))) add("workstream", "portfolio", w);
  }
  const rank = ["transformation", "executive", "workstream", "finance", "adoption", "personal"];
  return [...out.values()].sort(
    (a, b) =>
      rank.indexOf(a.dashboard) - rank.indexOf(b.dashboard) ||
      (a.areaCode ?? "").localeCompare(b.areaCode ?? "") ||
      (a.workstreamId ?? "").localeCompare(b.workstreamId ?? ""),
  );
}

/** The whole impact of one record (unpaged records). */
export async function computeImpact(
  db: DbOrTx,
  transformationId: string,
  recordType: ImpactRecordType,
  recordId: string,
): Promise<{ records: (ImpactRecord & { order: number })[]; dashboards: ImpactDashboardRef[]; hiddenCount: number }> {
  const records = await loadChainRecords(db, transformationId);
  const { outgoing } = indexEdges(await loadEdges(db, transformationId));
  let sources: Reached[];
  let rootKpiDefinitionId: string | null = null;
  if (recordType === "kpi_definition") {
    rootKpiDefinitionId = recordId;
    sources = [...records.values()]
      .filter((r) => r.type === "outcome_kpi" && r.status === "active" && r.kpiDefinitionId === recordId)
      .map((r) => ({ id: r.id, distance: 1, edgeKinds: [] }));
  } else {
    sources = [{ id: recordId, distance: 0, edgeKinds: [] }];
  }
  const reached = walkDownstream(outgoing, sources, TRACE_MAX_DEPTH);
  const listed: (ImpactRecord & { order: number })[] = [];
  const touched: ChainRecord[] = [];
  let hiddenCount = 0;
  for (const r of reached.values()) {
    const rec = records.get(r.id);
    if (rec === undefined) {
      hiddenCount += 1; // never listed (§6); 0 by construction, see the header
      continue;
    }
    touched.push(rec);
    if (r.distance === 0) continue; // the record itself
    listed.push({
      recordType: rec.type,
      recordId: rec.id,
      code: rec.code,
      label: rec.label,
      href: hrefOf(rec.type, transformationId, rec.id),
      distance: r.distance,
      edgeKinds: [...r.edgeKinds],
      valueAffected: rec.type === "benefit",
      order: nodeOrder(rec.type),
    });
  }
  if (recordType !== "kpi_definition" && !records.has(recordId)) throw problems.notFound();
  listed.sort(
    (a, b) =>
      a.distance - b.distance || a.order - b.order || (a.recordId < b.recordId ? -1 : a.recordId > b.recordId ? 1 : 0),
  );
  const dashboards = await dashboardsOf(db, transformationId, recordType, rootKpiDefinitionId, touched);
  return { records: listed, dashboards, hiddenCount };
}

/** Registers this file's route and returns it as "METHOD /path". */
export function registerImpactRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  app.get(PATH, { config: { access: { permission: "transformation.read" as const } } }, async (request) => {
    const { recordType, recordId } = parse(params, request.params, "params");
    const q = parseQuery(query, request.query);
    const transformationId = await transformationOf(db, recordType, recordId);
    if (transformationId === null) throw problems.notFound();
    await requireTransformationRead(db, principalOf(request), transformationId);
    const hash = filterHash({ report: "impact", recordType, recordId });
    const after = decodeCursor(q.cursor, hash, 3);
    const impact = await readOnly(db, (tx) => computeImpact(tx, transformationId, recordType, recordId));
    const rest =
      after === null
        ? impact.records
        : impact.records.filter((r) => {
            const [d, o, id] = [Number(after[0]), Number(after[1]), String(after[2])];
            return r.distance > d || (r.distance === d && (r.order > o || (r.order === o && r.recordId > id)));
          });
    const page = paginate(rest.slice(0, q.limit + 1), q.limit, (r) => [r.distance, r.order, r.recordId], hash);
    const body: RecordImpact = {
      recordType,
      recordId,
      records: page.items.map(({ order: _order, ...r }) => r),
      dashboards: impact.dashboards,
      hiddenCount: impact.hiddenCount,
      nextCursor: page.nextCursor,
    };
    return body;
  });
  return [`GET ${PATH}`];
}
