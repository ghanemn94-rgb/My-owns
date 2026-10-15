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
import { iso, parse, problems, type ModuleDeps } from "../platform/index.ts";

const OFFERS = "/api/v1/transformations/:transformationId/kpi-restatements/:restatementId/reissue-offers";
const itemParams = z.strictObject({ transformationId: z.uuid(), restatementId: z.uuid() });

/** Registers listKpiRestatementReissueOffers and returns it as "METHOD /path" (called from restatements.ts). */
export function registerKpiRestatementOfferRoutes(app: FastifyInstance, deps: ModuleDeps): string[] {
  const { db } = deps;
  app.get(
    OFFERS,
    { config: { access: { permission: "transformation.read" } } },
    async (request): Promise<KpiRestatementReissueOfferList> => {
      const { transformationId, restatementId } = parse(itemParams, request.params, "params");
      await requireTransformationRead(db, principalOf(request), transformationId);
      const restatement = await db
        .selectFrom("kpi_restatement")
        .select("id")
        .where("transformation_id", "=", transformationId)
        .where("id", "=", restatementId)
        .executeTakeFirst();
      if (!restatement) throw problems.notFound();
      // At most one offer per snapshot (UNIQUE (restatement_id, snapshot_id)); a restatement covers at most 24 periods,
      // so the list is bounded by the transformation's issued snapshots and needs no pagination (contract: no cursor).
      const rows = await db
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
        .where("o.restatement_id", "=", restatement.id)
        .orderBy("s.definition_code")
        .orderBy("o.series_id")
        .orderBy("s.issue_version")
        .execute();
      const items: KpiRestatementReissueOffer[] = rows.map((r) => ({
        snapshotId: r.snapshot_id,
        seriesId: r.series_id,
        definitionCode: r.definition_code as KpiRestatementReissueOffer["definitionCode"],
        // Offered snapshots are issued or superseded (kpi_restatement_reissue_offer_valid), so both are set.
        issueVersion: r.issue_version!,
        periodLabel: r.period_label,
        snapshotStatus: r.status as KpiRestatementReissueOffer["snapshotStatus"],
        createdAt: iso(r.created_at),
      }));
      return { items };
    },
  );
  return [`GET ${OFFERS}`];
}
