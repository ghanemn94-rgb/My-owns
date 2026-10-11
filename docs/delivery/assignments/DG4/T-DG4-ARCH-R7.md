# Assignment T-DG4-ARCH-R7: DG4 dashboard value units: the KPI unit kind on dashboard values (solution-architect)

## Stage and working tree

- **Stage:** P4, gate DG4, FIXING after review round 3.
- **Working tree:** a separate git worktree on branch `dg4/arch-r7`, at the integrated `HEAD`. `node_modules` is installed and the packages are built. Never run `git worktree add`.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG3` first, and report the result. It must exit 0.
- **Concurrency (D-004):** you run alone. KBE-R8 (API) and FE-R7 (web) follow your design after it is merged. You are the only writer of `docs/api/openapi.yaml` and the ADRs.
- **Time:** about 45 minutes; the hard limit is 2 hours. Run `date -u` at the start and at the end.
- **Your harness ports are 23700–23749 only.**

## Read first

- D-122 to D-124 in `docs/delivery/decisions.md`; D-124 decides this repair.
- F-DG4-122 and F-DG4-125 (`docs/delivery/reviews/DG4/round-2/` and `round-3/domain-reviewer.findings.json`).
- The FE-R6 handback §5 items 2 and 3 (`docs/delivery/handbacks/DG4/T-DG4-FE-R6-frontend-ux-engineer.md`).
- ADR-0028 §3 (a percentage is stored as a fraction), ADR-0037 (the dashboard value shape), the KPI pages' formatter `apps/web/src/pages/kpi/ui.tsx` (`formatKpiValue`), the dashboard formatter `apps/web/src/pages/dashboards/ui.tsx` (`formatValue`), and the API's KPI value emission `apps/api/src/modules/kpi/dashboard-facts.ts` (`unit: def.unit_label ?? def.unit_kind`).

## The defect (confirmed by the orchestrator in the merged tree)

`DashboardValue.unit` carries the KPI's free-text `unit_label` when one is set, and its `unit_kind` otherwise. The web therefore cannot tell what the number is:
- a `ratio`-kind KPI of 1.5 is sent with unit `ratio`, the same unit as the computed value gap, so the dashboard shows '150 %' where the KPI page shows '1.5';
- a `percentage`-kind KPI with a label such as '% of users' is sent with that label, so 0.12 renders unscaled as '0.12 % of users' instead of '12 % of users'.

## Decided (D-124; you design it, you do not reopen it)

1. **A dashboard value that comes from a KPI says its unit kind,** separately from its display label. The web formats it exactly as the KPI pages do (`formatKpiValue`): a `percentage` is a fraction shown × 100 with '%', a `ratio` is a plain decimal, a `currency` is money, and the others are decimals with their label.
2. **A computed ratio that the dashboards present as a percentage** (the value gap of F-DG4-122) stays distinguishable from a `ratio`-kind KPI, and keeps rendering as a percentage.
3. **The display label is kept**, for example '12 % of users', but it never decides the scaling.
4. **Unknown, Stale, n/a and known zero** are unchanged.

## Scope

1. **ADR-0037:** a dated amendment (the next free label) stating items 1–4, the members and their meaning, and how each dashboard value is classified (KPI-derived, money, computed ratio, count).
2. **Contract:** `DashboardValue` (and any other value shape the dashboards render) in `openapi.yaml` and the zod mirrors. Prefer additive members, pending in `p4-pending-arch-r7.ts` until KBE-R8 emits them; spell out the closing step (which `required` lists and `.optional()` calls change, and the wording to update) as ARCH-R6 did in its §4.1 item 6.
3. **Readers:** list every API emitter of `DashboardValue` with a KPI or ratio value (dashboards, the Executive Overview, adoption, drill-downs, the workspace header, my-work if relevant), and every web reader.
4. **Code table:** extend it for any new key, with EN and AR texts proposed for FE.
5. **Implementation notes** for KBE-R8 and FE-R7, with fixtures: a `percentage` KPI with no label (0.12 → '12 %'), with the label '% of users' (0.12 → '12 % of users'), a `ratio` KPI 1.5 (→ '1.5'), and the value gap 1 (→ '100 %'), each in EN and AR.

## Acceptance (real output in the handback)

1. These all exit 0: `pnpm openapi:lint` (report the operation count), `pnpm -r typecheck`, `pnpm lint`, prettier over the tracked files (`git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown`), and the contract test project.
2. `git diff` against base touches only ADR files, `openapi.yaml`, `packages/shared/src/schemas/**`, the pending list, the code table and your handback.
3. `node tools/gates/validate.mjs --historical --stage DG3` exits 0.

## Handback

Write `docs/delivery/handbacks/DG4/T-DG4-ARCH-R7-solution-architect.md`. List every changed line with its reason. Leave your changes **uncommitted**.
