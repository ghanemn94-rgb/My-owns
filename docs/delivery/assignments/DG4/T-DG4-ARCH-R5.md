# Assignment T-DG4-ARCH-R5: DG4 round-2 architecture: one basis for the value headlines (F-DG4-123) (solution-architect)

## Stage and working tree

- **Stage:** P4, gate DG4, in review round 2 (repairs before round 3).
- **Working tree:** a separate git worktree on branch `dg4/arch-r5`, at the integrated `HEAD`. `node_modules` is installed and the packages are built. Never run `git worktree add`.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG3` first, and report the result. It must exit 0.
- **Concurrency (D-004):** you run alone. KBE-R6 (engine and API) and FE-R5 (screens, and F-DG4-122) follow your design after your work is merged. You are the only writer of `docs/api/openapi.yaml` and the ADRs.
- **Time:** about 60 minutes; the hard limit is 2 hours. Run `date -u` at the start and at the end.
- **Your harness ports are 23700–23749 only.**

## Read first

- D-117 (the gross/net rule), D-119 (this round's decision) and the finding `docs/delivery/reviews/DG4/round-2/domain-reviewer.findings.json` (F-DG4-123), with its check `DOM-R2-07` in `domain-reviewer.json`.
- ADR-0030 N1 and ADR-0037 N2 (your round-1 amendments). Item 5 of N1 and item 2 of N2 kept these headlines on five classes; D-119 supersedes that.
- The as-built code: `apps/api/src/modules/reporting/dashboards/areas.ts` (`valueArea`, `valueGapStatus`, `lineEligible`), `engine.ts` (the Finance and overview headlines), `drilldown.ts`, and the workspace summary (`benefits.planned`/`validated`).

## Decided (D-119; you design it, you do not reopen it)

1. **The value headlines use the profit-and-cash basis.** 'Planned value', 'Forecast', 'Submitted', 'Validated value' and the value-gap ratio and Value RAG, on T10, the Executive Overview, the workspace header and the Finance dashboard, sum only `margin_uplift`, `cash_saving` and `working_capital_release`, per currency. That is the basis of the D-117 gross.
2. **`revenue_uplift` (top line) and `avoided_cost` (non-cash)** are shown as headlines or lines of their own, in each state that the screen shows for the profit-and-cash headline, each labelled with its basis. They are never added into a profit-and-cash figure, and no unlabelled sum crosses bases.
3. **Every headline drills to records that sum to it.** Use the K1 class drill-downs; where a basis headline covers three classes, define its drill-down so that its rows sum to the headline (or state exactly when it is null, as the N2 note does for gross).
4. **Unknown, Stale, n/a and known zero stay distinct.** A transformation whose only financial benefits are revenue uplift or avoided cost has a profit-and-cash headline of `not_applicable` ('nothing planned on this basis'), never 0 or green.
5. **Labels name the basis**, in EN and AR.
6. **Not changed:** the per-class lines, the Finance validation rules, and the DG3 business-case totals (`kpi/totals.ts`), which report gross by value basis and warn `business_case.revenue_and_margin`. The domain reviewer recorded that as an observation; state in the ADR that the two bases differ on purpose and why.

## Scope

1. **ADR-0037 and ADR-0030:** a dated amendment N3 (or the next free label) that states items 1–6 exactly and supersedes N1 item 5 and N2 item 2. Cite M0172 and B0145.
2. **Contract (`openapi.yaml` and the shared zod mirrors):** design the members that carry the separate revenue-uplift and avoided-cost headlines on the four surfaces. Prefer additive members; if a member's meaning changes (for example `planned` now meaning profit-and-cash), say so in its description and list every reader in the handback. Name the zod exports KBE-R6 and FE must use.
3. **Pending list:** add the new members to a `p4-pending-arch-r5.ts` list (the ARCH-R3 pattern) so the contract test passes before KBE-R6 implements them, and say so in the handback.
4. **Code table:** extend it from its last row for every new label or reason key (for example the `not_applicable` reason in item 4), with EN and AR texts proposed for FE.
5. **For KBE-R6 and FE:** a short section in the handback, 'Implementation notes', that lists each surface, its members, the drill-down rule and the test fixture to use (the domain reviewer's: revenue uplift 300, margin uplift 70, cash saving 20, avoided cost 45 SAR planned, so the profit-and-cash planned headline is 90).

## Acceptance (real output in the handback)

1. These all exit 0: `pnpm openapi:lint` (report the operation count), `pnpm -r typecheck`, `pnpm lint`, the prettier check, and the contract test project.
2. `git diff` against base touches only ADR files, `openapi.yaml`, `packages/shared/src/schemas/**`, the pending list, the code table and your handback.
3. `node tools/gates/validate.mjs --historical --stage DG3` exits 0.

## Handback

Write `docs/delivery/handbacks/DG4/T-DG4-ARCH-R5-solution-architect.md`. List every changed line with its reason. Leave your changes **uncommitted**.
