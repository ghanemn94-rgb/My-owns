# Assignment T-DG4-ARCH-R4: DG4 round-1 architecture text: the gross/net basis (F-DG4-121) and the `canSubmit` description (solution-architect)

## Stage and working tree

- **Stage:** P4, gate DG4, in review round 1 (repairs before round 2).
- **Working tree:** a separate git worktree on branch `dg4/arch-r4`, at the integrated `HEAD`. `node_modules` is installed and the packages are built. Never run `git worktree add`.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG3` first, and report the result. It must exit 0.
- **Concurrency (D-004):** T-DG4-KBE-R5, T-DG4-BE-R5, T-DG4-FE-R4 and T-DG4-AN-R1 run in their own worktrees. You are the only writer of `docs/api/openapi.yaml` and the ADRs.
- **Time:** about 45 minutes; the hard limit is 2 hours. Run `date -u` at the start and at the end.
- **Your harness ports are 23700–23749 only.**

## Scope

1. **F-DG4-121.**
   - **Read first:** D-117 (the decided rule) and the finding record `docs/delivery/reviews/DG4/round-1/domain-reviewer.findings.json`.
   - **ADR-0030 §7.6:** write a dated amendment that states the rule exactly. The headline gross sums `margin_uplift`, `cash_saving` and `working_capital_release`. `revenue_uplift` (top line) and `avoided_cost` (non-cash) are separate lines and are never summed into gross or net. Net is gross minus implementation cost. Validated totals and the per-class lines are unchanged. Cite M0172 and B0145.
   - **ADR-0037:** amend the Finance dashboard text so it says the same.
   - **Contract:** in `openapi.yaml`, update the descriptions of the `FinanceDashboard` and `BenefitTotals` gross and net members. Descriptions only; no schema change.
2. **`GateView.canSubmit`** (FE-R3 handback):
   - **The gap:** the description says 'every mandatory criterion is complete', but the server also counts criteria covered by an accepted exception and, for a Modular G3, applies the waiver rule.
   - **The fix:** make the description exactly true. Descriptions only.
3. **Code table:** if either item adds or renames a label key, extend the table from row 207.

## Acceptance (real output in the handback)

1. These all exit 0:
   - `pnpm openapi:lint`, still 652 operations;
   - `pnpm -r typecheck`;
   - `pnpm lint`;
   - the prettier check.
2. `git diff` against base touches only ADR files, `openapi.yaml` description lines, and your handback.
3. `node tools/gates/validate.mjs --historical --stage DG3` exits 0.

## Handback

Write `docs/delivery/handbacks/DG4/T-DG4-ARCH-R4-solution-architect.md`. List every changed line with its reason. Leave your changes **uncommitted**.
