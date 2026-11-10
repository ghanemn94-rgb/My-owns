// The report reissue offers of an approved KPI restatement (ADR-0047 §3 item 4; ADR-0045 §4; M0163 "Previously issued
// reports remain unchanged and can be reissued as a new version"; REQ-S07-016; p5-work-split §G.2; T-DG5-KBE-E2):
//   GET /transformations/{t}/kpi-restatements/{r}/reissue-offers     (transformation.read)
//
// The offers are written once by the worker's restatement run (apps/worker/src/handlers/kpi.ts), one per issued (or
// meanwhile superseded) report snapshot that showed the restated KPI for a restated period. This read lists them with
// the snapshot's current state; it changes nothing. An issued snapshot is never changed by a restatement: a person
// reissues it through reissueReportSnapshot (ADR-0045 §4), and issuing that reissue gives the next issue version.
// A restatement without offers (not yet applied, rejected, withdrawn, or no affected report) lists none.
import type { KpiRestatementReissueOffer, KpiRestatementReissueOfferList } from "@mth/shared/schemas";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { principalOf, requireTransformationRead } from "../access/index.ts";
import {
  iso,
  keysetPage,
  pageQueryFields,
  parse,
  parseQuery,
  problems,
  type ModuleDeps,
  type SortKey,
} from "../platform/index.ts";
import { sql } from "@mth/db";

const OFFERS = "/api/v1/transformations/:transformationId/kpi-restatements/:restatementId/reissue-offers";
const itemParams = z.strictObject({ transformationId: z.uuid(), restatementId: z.uuid() });
const listQuery = z.strictObject({ ...pageQueryFields });
/** The offers' page sort (T-DG6-BE-V): report, series, issue version, then the snapshot (one offer per snapshot). */
const OFFER_SORT: readonly SortKey[] = [
  { name: "s.definition_code", type: "text" },
  { name: "o.series_id", type: "uuid" },
  { name: "s.issue_version", type: "integer", expr: sql`coalesce(s.issue_version, 0)` },
  { name: "o.snapshot_id", type: "uuid" },
];

/** Registers listKpiRestatementReissueOffers and returns it as "METHOD /path" (called from restatements.ts). */
export function registerKpiRestatementOfferRoutes(app: FastifyInstance, deps: ModuleDeps): string[] {
  const { db } = deps;
  app.get(
    OFFERS,
    { config: { access: { permission: "transformation.read" } } },
    async (request): Promise<KpiRestatementReissueOfferList> => {
      const { transformationId, restatementId } = parse(itemParams, request.params, "params");
      const query = parseQuery(listQuery, request.query);
      await requireTransformationRead(db, principalOf(request), transformationId);
      const restatement = await db
        .selectFrom("kpi_restatement")
        .select("id")
        .where("transformation_id", "=", transformationId)
        .where("id", "=", restatementId)
        .executeTakeFirst();
      if (!restatement) throw problems.notFound();
      // At most one offer per snapshot (UNIQUE (restatement_id, snapshot_id)), as many as the transformation's issued
      // snapshots: no constraint caps them, so the list is cursor-paged (ADR-0007 §4a, T-DG6-BE-V).
      const q = db
        .selectFrom("kpi_restatement_reissue_offer as o")
        .innerJoin("report_snapshot as s", "s.id", "o.snapshot_id")
        .select([
          "o.snapshot_id",
          "o.series_id",
          "o.created_at",
          "s.definition_code",
          "s.issue_version",
          "s.period_label",
          "s.status",
        ])
        .where("o.restatement_id", "=", restatement.id);
      const page = await keysetPage(q, OFFER_SORT, query, { list: "reissue-offers", transformationId, restatementId });
      const items: KpiRestatementReissueOffer[] = page.items.map((r) => ({
        snapshotId: r.snapshot_id,
        seriesId: r.series_id,
        definitionCode: r.definition_code as KpiRestatementReissueOffer["definitionCode"],
        // Offered snapshots are issued or superseded (kpi_restatement_reissue_offer_valid), so both are set.
        issueVersion: r.issue_version!,
        periodLabel: r.period_label,
        snapshotStatus: r.status as KpiRestatementReissueOffer["snapshotStatus"],
        createdAt: iso(r.created_at),
      }));
      return { items, nextCursor: page.nextCursor };
    },
  );
  return [`GET ${OFFERS}`];
}
