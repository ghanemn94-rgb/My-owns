# Assignment T-DG2-KBE: P2 KPI/benefits — baselines, outcome-KPIs (T02), value pools, decimal value helpers (kpi-benefits-engineer)

- **Stage:** P2 "Diagnose, define and design" / gate DG2 (BUILDING) on branch `claude/mobily-transformation-platform-regate`. **Base:** current `HEAD` (`ef99eb0`+). The P2 architecture is frozen and in place: migrations `0010`–`0018`, `schema.ts`, `permissions.ts`, `docs/api/openapi.yaml`, ADR-0015…0020, `docs/architecture/p2-work-split.md`. **Read `docs/architecture/p2-work-split.md` §3 (your column) in full.** Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; Node 22.22.2 floor; run offline.
- **You own only the KPI/benefits slice.** `backend-workflow-engineer` (BE) is building the rest of `apps/api` **concurrently** — do not touch anything outside your column. The `registerKpiModule` hook is already wired in `modules.ts`/`server.ts` from P1; register your routes inside it and **do not edit `modules.ts` or `server.ts`**.

## Own (write) — exactly the KBE column of the work split §3
- `apps/api/src/modules/kpi/**`: routes, services, repository, the module's public interface `index.ts`, and its tests (`kpi.test.ts` etc.).
- `apps/api/test/integration/kpi/**`: your integration tests for kpi resources, including **AUD → 403 on every kpi mutation**.
- `apps/api/test/integration/contract/kpi-exercises.ts`: exercise your kpi operations through `ctx.mirrored` (`contract.test.ts` already calls `exerciseKpiOperations`).
- `apps/api/test/support/p2-pending-kpi.ts`: the 23 pending kpi operations — **remove each as it becomes routed and exercised** (must be empty at DG2 freeze).
- `packages/shared/src/schemas/kpi.ts`: zod mirrors of `KpiDefinition*`, `Baseline*`, `OutcomeKpi*`, `ValuePool*`, `ValidationDecision`, `TrajectoryApproval`, `TrajectoryPoint`, `Decimal`, `BusinessDate` (the stub is already exported from the barrel — fill it in; do not edit `schemas/index.ts`).
- New `packages/shared/src/value.ts` (+ `value.test.ts`): decimal helpers (parse/format/compare at a column scale, **never a float**) and the value-pool total `{ quantifiedTotal: { downside, upside } | null, unquantifiedCount, currency }` (ADR-0019 §5), consumed by the API and by FE.

## Frozen / off-limits (do NOT edit)
`apps/api/src/modules.ts`, `server.ts`; `contract.test.ts`, `test/support/p2-pending.ts`; migrations `0010`–`0018` (and all migrations — schema changes go through BE); `packages/db/src/schema.ts`; `packages/shared/src/{permissions.ts,constants.ts,problem.ts,schemas/index.ts}`; all other `apps/api/src/modules/**` (BE's); all `apps/web/**`; `docs/**`; root config, deps, lockfile. The write guard also blocks `tools/gates/**`, `tools/agents/**`, `.claude/**`, `docs/source/**`, reviews, gate records, `stages.json`, `findings.json`, `candidates/**`, `runs/**`, `test-evidence/**`, `trading_agent/**`. If you need a schema/migration/contract change, **record it in the handback** for BE/the architect — do not make it yourself.

## Resources to route + exercise
- `kpi-definitions`.
- `baselines` (+ `validation`, FIN role): measurable baseline with metric, source and baseline date (REQ-PB-027); Finance validation must include baseline, attribution/counterfactual, calculation, evidence, measurement period and assumptions; measure-only submissions do not increase a validated total until approved; corrections create amendments/reversals linked to the original.
- `outcome-kpis` (T02) (+ `trajectory-approval`, SP/BO): all 7 source columns persist; **a row without a target date is rejected** (targets are time-bound).
- `value-pools` (+ `validation`, FIN): quantified by driver with **decimal** upside/downside, or the explicit **`unquantified`** state that **never reads as 0**; totals carry an unquantified count (ADR-0019).

## Public interface for the gate criteria (BE's `workflows` evaluators consume this)
Export from `apps/api/src/modules/kpi/index.ts` exactly the `KpiGateFacts` interface and `loadKpiGateFacts(db, transformationId)` signature in work split §3. BE codes its G1/G2 evaluators against this; keep the shape exact.

## Non-negotiable conventions (ADRs + CLAUDE.md)
- **Server-side authorization on every mutation** (the single policy function); FIN validates, SP/BO approve trajectories, **AUD → 403 on every kpi mutation** (add the test). Technical admins are not business approvers.
- **Validation** with your zod mirrors; reject out-of-domain values server-side (missing target date → 422, etc.).
- **Optimistic concurrency**: `If-Match`/ETag + 409; `version` steps by exactly 1; the audit event must exist (DB guards enforce it — rely on BE's `platform` problem mapping for the error→HTTP translation; if a guard error you raise is not yet mapped, note it for BE).
- **Audit event per mutation**. **Decimal** for all money/rates/KPI values; **Unknown/Stale** never 0/green. A validated total increases only on approval.

## Self-verification (real output in the handback)
`pnpm -r typecheck`, `pnpm -r build`, `pnpm lint`, `pnpm format:check` on your files, `pnpm test` (unit incl. `value.test.ts`, Node 22 and 24), and the integration suite on a disposable PostgreSQL (`tests/qa/support/with-pg.sh`, unique `QA_PG_PORT`) covering your kpi integration tests + the AUD-403 kpi sweep. Your `kpi-exercises.ts` must exercise every kpi op you route so `contract.test.ts` stays green; `p2-pending-kpi.ts` lists only the still-unrouted kpi ops. `node tools/gates/validate.mjs --historical --stage DG1` must stay exit 0. A missing tool/DB is BLOCKED, not skipped.

## Handback
`docs/delivery/handbacks/DG2/T-DG2-KBE-kpi-benefits-engineer.md` — the diff summary, every check's real output, the remaining `p2-pending-kpi.ts` contents, and any schema/contract change you need from BE/the architect.
