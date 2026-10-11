# Assignment T-DG4-ARCH-R6: DG4 round-3 architecture: the Value status per basis (F-DG4-126), the portfolio item basis (F-DG4-127) and currency-exact value drill-downs (F-DG4-105) (solution-architect)

## Stage and working tree

- **Stage:** P4, gate DG4, FIXING after review round 3.
- **Working tree:** a separate git worktree on branch `dg4/arch-r6`, at the integrated `HEAD`. `node_modules` is installed and the packages are built. Never run `git worktree add`.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG3` first, and report the result. It must exit 0.
- **Concurrency (D-004):** you run alone. KBE-R7 (engine and API) and FE-R6 (web, and F-DG4-125) follow your design after it is merged. You are the only writer of `docs/api/openapi.yaml` and the ADRs.
- **Time:** about 60 minutes; the hard limit is 2 hours. Run `date -u` at the start and at the end.
- **Your harness ports are 23700–23749 only.**

## Read first

- D-119 to D-122 in `docs/delivery/decisions.md`; D-122 decides this round's repairs.
- The findings, with their reproduction, expected and actual texts: F-DG4-126 and F-DG4-127 in `docs/delivery/reviews/DG4/round-3/domain-reviewer.findings.json`, and F-DG4-105 in `docs/delivery/reviews/DG4/round-3/code-security-reviewer.findings.json`.
- Your ADR-0037 and ADR-0030 amendment N3, and the KBE-R6 handback (§5.3 a–e).
- The as-built code: `apps/api/src/modules/reporting/dashboards/areas.ts` (`valueArea`, `valueGapStatus`), `engine.ts` (`plannedOf`, the Portfolio items and ranking), `drilldown.ts` (`valueDrill`, `oneCurrency`), `finance.ts` (`hrefOf`).

## Decided (D-122; you design it, you do not reopen it)

1. **F-DG4-126, the Value status per basis** (the domain reviewer's rule). A validated-gap ratio is computed **per basis and currency**: profit and cash, top line and non-cash, each only where that basis has a counted benefit in that currency. The ratios are never summed across bases. The Value RAG is the **worst** of them, and its rule parameters list every basis and currency with its own ratio and status. The headline amounts stay as N3 decided them. Each basis may show its own gap headline, labelled with its basis, never a single cross-basis gap.
2. **F-DG4-127, the portfolio item value.** The Portfolio area's initiative value, and its ranking 'by value', use the profit-and-cash basis. An initiative whose allocated benefits are only top line or non-cash shows `not_applicable` with its reason, never 0, and ranks after those with a value. Its top-line and non-cash allocations are not added to that figure. If the item shows them, each is labelled with its basis.
3. **F-DG4-105, currency-exact value drill-downs.** A value-state drill-down that answers a headline or a Finance line of one currency returns only that currency's records and figure. Design how the href carries the currency (for example an optional `currency` query parameter on the value drill-downs), and define the result when that currency holds no record of the basis: `not_applicable` with `dashboard.value.no_profit_and_cash_benefit` and no item, as KBE-R6 §5.3 (a) stated. Every value headline and every Finance gross line then carries an href that names its currency. A drill-down without a currency keeps today's behaviour for a single-currency scope, and `multiple_currencies` otherwise.
4. **Unknown, Stale, n/a and known zero stay distinct**, as in N3.
5. **Unchanged:** the headline amounts of N3, the per-class lines, the Finance validation rules, gross/net/cost, and the DG3 business-case totals.

## Scope

1. **ADR-0037 and ADR-0030:** a dated amendment N4 that states items 1–5 exactly and says which N3 items it supersedes (at least N3 item 2's 'no gap ratio or RAG on them'). Cite B0095, M0248, M0172 and B0145.
2. **Contract (`openapi.yaml` and the zod mirrors):** the members and the parameter needed for items 1–3, additive where possible. List every meaning change in its description and every reader in the handback. If you add a query parameter, add it to the operation and say what the contract test must exercise.
3. **Pending:** list new members and parameters in `p4-pending-arch-r6.ts` (the ARCH-R5 pattern), declared but not yet `required`, so the contract test passes before KBE-R7. **Closing step:** KBE-R7 makes them `required` once emitted (as in D-120), so say exactly which `required` lists and `.optional()` calls it changes.
4. **Code table:** extend it from row 236 for every new label, rule or reason key, with EN and AR texts proposed for FE.
5. **Implementation notes** for KBE-R7 and FE-R6: each surface, its members, the fixtures (the reviewers' R3-6 world: margin 70 validated, revenue uplift 300 planned and unvalidated, so the Value RAG must be Red, and the same with avoided cost; the R3-8 portfolio world; probe GC's SAR margin 70 and USD revenue 11 world), and the expected values.

## Acceptance (real output in the handback)

1. These all exit 0: `pnpm openapi:lint` (report the operation count), `pnpm -r typecheck`, `pnpm lint`, prettier over the tracked files (`git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown`), and the contract test project.
2. `git diff` against base touches only ADR files, `openapi.yaml`, `packages/shared/src/schemas/**`, the pending list, the code table and your handback.
3. `node tools/gates/validate.mjs --historical --stage DG3` exits 0.

## Handback

Write `docs/delivery/handbacks/DG4/T-DG4-ARCH-R6-solution-architect.md`. List every changed line with its reason. Leave your changes **uncommitted**.
