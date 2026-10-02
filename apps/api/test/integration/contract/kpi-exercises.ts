// Contract exercises for the P2 kpi-module operations (owned by kpi-benefits-engineer; T-DG2-ARCH-01B seam).
// contract.test.ts (owned by backend-workflow-engineer) calls exerciseKpiOperations once, so kpi operations are
// exercised in the same test file whose coverage assertion counts them, without two agents editing one file.
// Every call goes through `ctx.mirrored` (contract + problem-mirror validation), and every successful body is also
// parsed here with its kpi zod mirror from @mth/shared/schemas (lockstep). All 24 kpi operations are exercised with at
// least one success, so p2-pending-kpi.ts is empty. All data is synthetic.
import {
  baseline,
  baselinePage,
  kpiDefinition,
  kpiDefinitionPage,
  outcomeKpi,
  outcomeKpiPage,
  valuePool,
  valuePoolPage,
} from "@mth/shared/schemas";
import { expect } from "vitest";
import type { z } from "zod";
import type { Res, RequestOptions, Session, TestApi, World } from "../../support/harness.ts";
import { ifMatch, seedKpiWorld } from "../kpi/fixtures.ts";

export interface KpiContractContext {
  readonly api: TestApi;
  readonly world: World;
  readonly sessions: { readonly admin: Session; readonly office: Session };
  readonly mirrored: (method: string, url: string, opts?: RequestOptions) => Promise<Res<unknown>>;
}

/** operationId -> zod mirror of its success body. */
const MIRRORS = new Map<string, z.ZodType>([
  ["listKpiDefinitions", kpiDefinitionPage],
  ["createKpiDefinition", kpiDefinition],
  ["getKpiDefinition", kpiDefinition],
  ["updateKpiDefinition", kpiDefinition],
  ["archiveKpiDefinition", kpiDefinition],
  ["activateKpiDefinition", kpiDefinition],
  ["listBaselines", baselinePage],
  ["createBaseline", baseline],
  ["getBaseline", baseline],
  ["updateBaseline", baseline],
  ["archiveBaseline", baseline],
  ["validateBaseline", baseline],
  ["listOutcomeKpis", outcomeKpiPage],
  ["createOutcomeKpi", outcomeKpi],
  ["getOutcomeKpi", outcomeKpi],
  ["updateOutcomeKpi", outcomeKpi],
  ["archiveOutcomeKpi", outcomeKpi],
  ["approveOutcomeKpiTrajectory", outcomeKpi],
  ["listValuePools", valuePoolPage],
  ["createValuePool", valuePool],
  ["getValuePool", valuePool],
  ["updateValuePool", valuePool],
  ["archiveValuePool", valuePool],
  ["validateValuePool", valuePool],
]);

export async function exerciseKpiOperations(ctx: KpiContractContext): Promise<void> {
  const k = await seedKpiWorld(ctx.api, ctx.world);
  const checked = new Set<string>();

  /** A mirrored call that must succeed with `status` and whose body must parse with the operation's zod mirror. */
  const ok = async <T = { id: string; version: number }>(
    operationId: string,
    status: number,
    method: string,
    url: string,
    opts: RequestOptions,
  ): Promise<T> => {
    const res = await ctx.mirrored(method, url, opts);
    expect(res.status, `${operationId}: ${JSON.stringify(res.body).slice(0, 300)}`).toBe(status);
    const parsed = MIRRORS.get(operationId)!.safeParse(res.body);
    expect(parsed.success, `zod mirror for ${operationId}: ${parsed.error?.message ?? ""}`).toBe(true);
    checked.add(operationId);
    return res.body as T;
  };
  const b = k.base;

  // ---- kpi-definitions
  const def = await ok("createKpiDefinition", 201, "POST", `${b}/kpi-definitions`, {
    session: k.s.kds,
    headers: { "idempotency-key": `contract-kpi-${k.transformationId}` },
    body: { name: "Contract churn rate", unitKind: "percentage", polarity: "lower_is_better", unitLabel: "%" },
  });
  await ok("listKpiDefinitions", 200, "GET", `${b}/kpi-definitions?limit=5`, { session: k.s.auditor });
  await ok("getKpiDefinition", 200, "GET", `${b}/kpi-definitions/${def.id}`, { session: k.s.auditor });
  await ok("updateKpiDefinition", 200, "PATCH", `${b}/kpi-definitions/${def.id}`, {
    session: k.s.kds,
    headers: ifMatch(1),
    body: { description: "Share of prepaid lines lost per month (synthetic)." },
  });
  // Declared problems: 428 without If-Match, 409 stale, 422 business rule, 403 for the auditor.
  await ctx.mirrored("PATCH", `${b}/kpi-definitions/${def.id}`, { session: k.s.kds, body: { unitLabel: "pct" } });
  await ctx.mirrored("PATCH", `${b}/kpi-definitions/${def.id}`, {
    session: k.s.kds,
    headers: ifMatch(1),
    body: { unitLabel: "pct" },
  });
  await ctx.mirrored("POST", `${b}/kpi-definitions`, {
    session: k.s.kds,
    body: { name: "No currency", unitKind: "currency", polarity: "higher_is_better" },
  });
  await ctx.mirrored("POST", `${b}/kpi-definitions`, {
    session: k.s.auditor,
    body: { name: "AUD", unitKind: "count", polarity: "higher_is_better" },
  });
  // activate (F-DG2-201): declared 428 / 409 / 403 (auditor) first, then the draft -> active success, then 422 for
  // an already-active definition. def is at version 2 after the update above.
  await ctx.mirrored("POST", `${b}/kpi-definitions/${def.id}/activate`, { session: k.s.kds });
  await ctx.mirrored("POST", `${b}/kpi-definitions/${def.id}/activate`, { session: k.s.kds, headers: ifMatch(1) });
  await ctx.mirrored("POST", `${b}/kpi-definitions/${def.id}/activate`, {
    session: k.s.auditor,
    headers: ifMatch(2),
  });
  const active = await ok<{ status: string; version: number }>(
    "activateKpiDefinition",
    200,
    "POST",
    `${b}/kpi-definitions/${def.id}/activate`,
    { session: k.s.kds, headers: ifMatch(2) },
  );
  expect([active.status, active.version]).toEqual(["active", 3]);
  await ctx.mirrored("POST", `${b}/kpi-definitions/${def.id}/activate`, { session: k.s.kds, headers: ifMatch(3) });
  const spare = await ok("createKpiDefinition", 201, "POST", `${b}/kpi-definitions`, {
    session: k.s.tl,
    body: { name: "Contract spare KPI", unitKind: "currency", currency: "SAR", polarity: "higher_is_better" },
  });
  await ok("archiveKpiDefinition", 200, "POST", `${b}/kpi-definitions/${spare.id}/archive`, {
    session: k.s.tl,
    headers: ifMatch(1),
    body: { reason: "Contract archive" },
  });

  // ---- baselines
  const base = await ok("createBaseline", 201, "POST", `${b}/baselines`, {
    session: k.s.kds,
    body: { metric: "Prepaid churn", unit: "%", scope: "customer", kpiDefinitionId: def.id },
  });
  await ok("listBaselines", 200, "GET", `${b}/baselines?limit=5`, { session: k.s.auditor });
  await ok("getBaseline", 200, "GET", `${b}/baselines/${base.id}`, { session: k.s.auditor });
  // Not measurable yet (Unknown value): a validation is a declared 422.
  await ctx.mirrored("POST", `${b}/baselines/${base.id}/validation`, {
    session: k.s.fin,
    headers: ifMatch(1),
    body: { result: "validated", note: "Too early" },
  });
  await ok("updateBaseline", 200, "PATCH", `${b}/baselines/${base.id}`, {
    session: k.s.kds,
    headers: ifMatch(1),
    body: { value: "2.45", source: "BI churn cube (synthetic)", baselineDate: "2026-06-30" },
  });
  const validated = await ok<{ validationStatus: string }>(
    "validateBaseline",
    200,
    "POST",
    `${b}/baselines/${base.id}/validation`,
    {
      session: k.s.fin,
      headers: ifMatch(2),
      body: { result: "validated", note: "Matches the BI extract." },
    },
  );
  expect(validated.validationStatus).toBe("validated");
  const old = await ok("createBaseline", 201, "POST", `${b}/baselines`, {
    session: k.s.tl,
    body: { metric: "Superseded metric", unit: "u", scope: "operational" },
  });
  await ok("archiveBaseline", 200, "POST", `${b}/baselines/${old.id}/archive`, {
    session: k.s.tl,
    headers: ifMatch(1),
    body: { reason: "Contract archive" },
  });

  // ---- outcome-kpis (T02)
  await ctx.mirrored("POST", `${b}/outcome-kpis`, {
    session: k.s.kds,
    body: { outcomeId: k.outcomeId, kpiDefinitionId: def.id },
  }); // 422: no target date
  const row = await ok("createOutcomeKpi", 201, "POST", `${b}/outcome-kpis`, {
    session: k.s.kds,
    body: {
      outcomeId: k.outcomeId,
      kpiDefinitionId: def.id,
      baselineId: base.id,
      targetValue: "1.9",
      targetDate: "2027-12-31",
      ownerUserId: k.users.bo.id,
      leadingIndicatorText: "Retention offers accepted per week",
      trajectoryPoints: [
        { date: "2026-12-31", value: "2.3" },
        { date: "2027-12-31", value: "1.9" },
      ],
    },
  });
  await ok("listOutcomeKpis", 200, "GET", `${b}/outcome-kpis?limit=5`, { session: k.s.auditor });
  await ok("getOutcomeKpi", 200, "GET", `${b}/outcome-kpis/${row.id}`, { session: k.s.auditor });
  await ok("updateOutcomeKpi", 200, "PATCH", `${b}/outcome-kpis/${row.id}`, {
    session: k.s.kds,
    headers: ifMatch(1),
    body: { ordinal: 2 },
  });
  await ctx.mirrored("POST", `${b}/outcome-kpis/${row.id}/trajectory-approval`, {
    session: k.s.kds,
    headers: ifMatch(2),
    body: {},
  }); // 403: KDS holds no kpi_target.approve
  await ok("approveOutcomeKpiTrajectory", 200, "POST", `${b}/outcome-kpis/${row.id}/trajectory-approval`, {
    session: k.s.sp,
    headers: ifMatch(2),
    body: { note: "Agreed (synthetic)." },
  });
  const spareRow = await ok("createOutcomeKpi", 201, "POST", `${b}/outcome-kpis`, {
    session: k.s.bo,
    body: { outcomeId: k.outcomeId, kpiDefinitionId: def.id, targetDate: "2028-06-30" },
  });
  await ok("archiveOutcomeKpi", 200, "POST", `${b}/outcome-kpis/${spareRow.id}/archive`, {
    session: k.s.bo,
    headers: ifMatch(1),
    body: { reason: "Contract archive" },
  });

  // ---- value pools
  const unq = await ok<{ id: string; upsideAmount: string | null }>(
    "createValuePool",
    201,
    "POST",
    `${b}/value-pools`,
    {
      session: k.s.to, // fresh sign-in: contract.test.ts logs ctx.sessions.office out earlier
      body: { name: "Roaming leakage (synthetic)" },
    },
  );
  expect(unq.upsideAmount).toBeNull();
  await ctx.mirrored("POST", `${b}/value-pools/${unq.id}/validation`, {
    session: k.s.fin,
    headers: ifMatch(1),
    body: { result: "validated", note: "n" },
  }); // 422: unquantified
  await ok("listValuePools", 200, "GET", `${b}/value-pools?limit=5`, { session: k.s.auditor });
  await ok("getValuePool", 200, "GET", `${b}/value-pools/${unq.id}`, { session: k.s.auditor });
  await ok("updateValuePool", 200, "PATCH", `${b}/value-pools/${unq.id}`, {
    session: k.s.to, // fresh sign-in: contract.test.ts logs ctx.sessions.office out earlier
    headers: ifMatch(1),
    body: {
      quantificationStatus: "quantified",
      downsideAmount: "1250000.00",
      upsideAmount: "4000000.5",
      materiality: "material",
    },
  });
  await ok("validateValuePool", 200, "POST", `${b}/value-pools/${unq.id}/validation`, {
    session: k.s.fin,
    headers: ifMatch(2),
    body: { result: "validated", note: "Sized from the roaming settlement data (synthetic)." },
  });
  const sparePool = await ok("createValuePool", 201, "POST", `${b}/value-pools`, {
    session: k.s.tl,
    body: { name: "Duplicate pool", quantificationStatus: "quantified", downsideAmount: "0", upsideAmount: "10" },
  });
  await ok("archiveValuePool", 200, "POST", `${b}/value-pools/${sparePool.id}/archive`, {
    session: k.s.tl,
    headers: ifMatch(1),
    body: { reason: "Contract archive" },
  });

  expect([...MIRRORS.keys()].filter((id) => !checked.has(id))).toEqual([]);
}
