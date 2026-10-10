// The transformation workspace header (T-DG4-KBE-G2; ADR-0037 §1 item 3, §9, §11; REQ-S03-011; M0114):
//   GET /transformations/{t}/summary   transformation.read; 404 outside the scope (the DG1 rule)
// The eight elements, each with an explicit Unknown where its data is missing (never 0 and never green):
//  1. phase           current phase, mode and entry phase (NOT NULL columns: never Unknown);
//  2. gateReadiness   the gate of the current phase with its LIVE readiness, read through WorkflowsReadPort
//                     (reporting may not import workflows); the port answering null -> state "unknown";
//  3. northStar       the current North Star statement and status; none -> state "unknown";
//  4. owners          sponsor and lead, each separately null (Unknown) when the column is NULL;
//  5. outcomeHealth   the T10 Outcomes area status (engine.ts, the KPI trajectory statuses only, never task
//                     completion) and the count of outcomes per status;
//  6. benefits        planned and validated per currency to the business date (the Value area's window and counting
//                     rules), the active benefit count and the non-financial count; the value status of the
//                     transformation comes from slice G's `valueStatusOf` (sustainment, D-107): `no_benefit` ->
//                     state "unknown" (no benefit is not a value of 0);
//  7. keyDecisions    up to 5 open T16 asks by due date and the overdue count (an empty list with 0 is a fact);
//  8. nextActions     up to 5 of the CALLER's open work items for this transformation by due date (the caller's own
//                     items only), and the gate's missing mandatory count (null when the gate readiness is Unknown).
// Served by `reporting`, not `transformations` (ADR-0037 §11: the elements need kpi, benefits, governance, tasks and the
// gate port, and transformations may not import them). A read model in a READ ONLY transaction; nothing is stored.
// Product gates G1-G6 are business approvals inside the product; nothing here reads or writes DG0-DG7.
import type { DashboardItem, RagStatus, WorkspaceHeader } from "@mth/shared/schemas";
import { RAG_STATUSES } from "@mth/shared/schemas";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { principalOf } from "../access/index.ts";
import { parse, parseQuery, problems, type ModuleDeps } from "../platform/index.ts";
import { valueStatusOf } from "../sustainment/index.ts";
import { loadOpenWorkItems } from "../tasks/index.ts";
import {
  computeAreas,
  loadAreaDefinitions,
  loadDashboardContext,
  presentAreas,
  readOnly,
} from "./dashboards/engine.ts";
import { resolveFilters } from "./dashboards/filters.ts";
import { readableTransformation } from "./dashboards/scope.ts";
import { readableTransformationIds, workItemOf } from "./my-work.ts";
import { workflowsReadPort } from "./ports.ts";

export const WORKSPACE_HEADER = "/api/v1/transformations/:transformationId/summary";
const tParams = z.strictObject({ transformationId: z.uuid() });

/** At most this many key decisions and next actions (OpenAPI WorkspaceHeader maxItems). */
export const HEADER_LIST_MAX = 5;

/** Registers this file's routes and returns them as "METHOD /path". */
export function registerWorkspaceHeaderRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  app.get(
    WORKSPACE_HEADER,
    { config: { access: { permission: "transformation.read" } } },
    async (request): Promise<WorkspaceHeader> => {
      const { transformationId } = parse(tParams, request.params, "params");
      parseQuery(z.strictObject({}), request.query);
      const principal = principalOf(request);
      return readOnly(db, async (tx) => {
        const t = await readableTransformation(tx, principal, transformationId);
        const row = await tx
          .selectFrom("transformation as t")
          .leftJoin("app_user as s", "s.id", "t.sponsor_user_id")
          .leftJoin("app_user as l", "l.id", "t.lead_user_id")
          .select([
            "t.mode",
            "t.entry_phase",
            "t.sponsor_user_id",
            "t.lead_user_id",
            "s.display_name as sponsor_name",
            "l.display_name as lead_name",
          ])
          .where("t.id", "=", t.id)
          .executeTakeFirst();
        if (!row) throw problems.notFound();

        // 2. Gate readiness through the port (null -> Unknown).
        const gate = await workflowsReadPort().gateReadiness(tx, t.id);

        // 3. The current North Star.
        const northStar = await tx
          .selectFrom("north_star")
          .select(["statement", "status"])
          .where("transformation_id", "=", t.id)
          .where("status", "=", "current")
          .executeTakeFirst();

        // 5-7. The T10 areas of this transformation to the business date (no period, no owner filter).
        const filters = await resolveFilters(tx, { organizationId: t.organizationId, transformationIds: [t.id] });
        const ctx = await loadDashboardContext(tx, [t], filters);
        const results = computeAreas(ctx.facts, ctx.clock, ctx.policy);
        const areas = presentAreas(ctx, results, await loadAreaDefinitions(tx), {
          drillTransformationIds: [t.id],
          workstream: false,
        });
        const outcomesArea = areas.find((a) => a.code === "outcomes")!;
        const counts = RAG_STATUSES.map((status: RagStatus) => ({
          status,
          count: results.outcomes.outcomes.filter((o) => o.status === status).length,
        })).filter((c) => c.count > 0);

        // 6. Benefits: the value status (slice G) decides Unknown; the amounts are the Value area's.
        const value = await valueStatusOf(tx, { kind: "transformation", transformationId: t.id });
        const noBenefit = value.status === "no_benefit";

        // 7. Key decisions: the open T16 asks by due date (undated last).
        const decisionItems: DashboardItem[] = [...(areas.find((a) => a.code === "decisions")?.items ?? [])].sort(
          (a, b) =>
            (a.dueDate ?? "9999-12-31").localeCompare(b.dueDate ?? "9999-12-31") ||
            a.recordId.localeCompare(b.recordId),
        );

        // 8. The caller's own open work items of this transformation (only if the caller can still read it).
        const readable = await readableTransformationIds(tx, principal);
        const own =
          principal.userId === null || !readable.has(t.id) ? [] : await loadOpenWorkItems(tx, principal.userId, t.id);

        return {
          transformationId: t.id,
          code: t.code,
          name: t.name,
          phase: {
            currentPhase: t.currentPhase as WorkspaceHeader["phase"]["currentPhase"],
            mode: row.mode as WorkspaceHeader["phase"]["mode"],
            entryPhase: row.entry_phase as WorkspaceHeader["phase"]["entryPhase"],
          },
          gateReadiness:
            gate === null
              ? {
                  state: "unknown",
                  gateCode: null,
                  status: null,
                  inheritedApproval: null,
                  missingMandatoryCount: null,
                  ready: null,
                }
              : { state: "known", ...gate },
          northStar: northStar
            ? { state: "known", statement: northStar.statement, status: northStar.status }
            : { state: "unknown", statement: null, status: null },
          owners: {
            sponsor:
              row.sponsor_user_id === null
                ? null
                : { userId: row.sponsor_user_id, displayName: row.sponsor_name ?? "" },
            lead: row.lead_user_id === null ? null : { userId: row.lead_user_id, displayName: row.lead_name ?? "" },
          },
          outcomeHealth: { rag: outcomesArea.rag, counts },
          benefits: {
            state: noBenefit ? "unknown" : "known",
            planned: noBenefit ? [] : results.value.currencies.map((c) => ({ currency: c.currency, value: c.planned })),
            validated: noBenefit
              ? []
              : results.value.currencies.map((c) => ({ currency: c.currency, value: c.validated })),
            benefitCount: value.benefits.length,
            nonFinancialCount: ctx.facts.benefits.filter((b) => b.counted && b.unmonetised).length,
          },
          keyDecisions: {
            items: decisionItems.slice(0, HEADER_LIST_MAX),
            overdueCount: results.decisions.overdueCount,
          },
          nextActions: {
            items: own.slice(0, HEADER_LIST_MAX).map((w) => workItemOf(w, filters.businessDate)),
            missingMandatoryCount: gate === null ? null : gate.missingMandatoryCount,
          },
        };
      });
    },
  );
  return [`GET ${WORKSPACE_HEADER}`];
}
