# Handback T-DG5-BE-X2 (backend-workflow-engineer): DG5 round-2 repair, the demo G4 on a real approved portfolio

- **Stage / gate:** P5, DG5, FIXING after review round 2 (candidate `sha256:c4f70a80…`, D-172).
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG5-T-DG5-BE-X2-backend-workflow-engineer-20261018T151808Z-79d9c165","session_id":"79d9c165-c464-479e-9d83-eee078d5c08a"}`.
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-BE-X2.md`. Its sha256 `1dd87595…ae194e2` was verified at the start.
- **Working tree:** `/home/user/wt/dg5-be-x2`, branch `dg5/be-x2`, base `HEAD` `017c27c`. All changes are **uncommitted**, as the assignment asks.
- **Time:** started `Sun Oct 18 15:18:23 UTC 2026`. The last check finished at `16:31:31 UTC` (about 73 minutes, inside the limit). Section 4 has the `date -u` outputs.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG4` printed `PASS gate DG4 (historical)` and exited 0, at the start and at the end.

**Nothing here grants a real approval.** Every seeded selection, funding decision, Finance validation, milestone approval and G-decision is a synthetic demonstration decision by a demo role user, on demo data, in a demo-initialized database. Each one is labelled "Synthetic demonstration - approves nothing real" (en and ar) where the record has a rationale or note. Seeding stays refused in production (`demo/guard.ts`, unchanged). Product gates G1–G6 are business approvals inside the product, and nothing here touches DG0–DG7.

## 1. Files changed

| File | Purpose |
|---|---|
| `packages/db/src/demo/data/roaming-portfolio.ts` | **New.** Seeds the approved portfolio INI-01..03 as the product records it, between the G3 approval and the G4 submission: submission, score results and ranking snapshot 1, selection, Finance validation of the initiative cases, funding decisions, resourcing roles, capacity and demand, milestones, demand commitment and milestone approval. After G4 is approved, it launches the three funded initiatives. |
| `packages/db/src/demo/data/roaming-gates.ts` | Removes the two G4 exceptions (`DEMO_GATE_EXCEPTIONS`, `seedGateExceptions` and the snapshot's exception members). Calls `seedApprovedPortfolio` before G4 and `launchApprovedPortfolio` after it. Builds the G4 snapshot member from the seeded records, the way `g4.ts buildG4Snapshot` does. Rewrites the G4 submission note and the GD-04 rationale. |
| `packages/db/src/demo/data/business-cases.ts` | Adds the three initiative business cases BC-02..BC-04 (`DEMO_INITIATIVE_CASES`). Each B0147 chain's benefit line and its cash investment line move to that chain's initiative case; the internal-team line stays on BC-01. |
| `packages/db/src/demo/data/roaming.ts` | Adds `scope_in` to each initiative card, completing the T05 card that G4 reads (name, objective, scope in). |
| `packages/db/src/demo/data/roaming-ids.ts` | Adds id blocks `0x070`–`0x078` for the portfolio records, and a comment that `gateException` (`0x069`) is unused. |
| `apps/api/test/integration/environment/demo-gate-history.test.ts` | Adds the regression test: the reviewer's reproduction, using product operations as demo role users. Also updates the G1–G4 test from "two excepted G4 criteria" to "no criterion incomplete and no exception". |
| `docs/delivery/handbacks/DG5/T-DG5-BE-X2-evidence/*` | The logs cited below. |

There is no migration, no API endpoint, no contract change and no new dependency.

## 2. The findings

### F-DG5-122 (Medium, REQ-PB-019) and F-DG5-120's remaining part (Medium, REQ-S18-002)

**Cause.** BE-V3's demo approved G4 with two accepted exceptions (`g4.initiative_cards`, `g4.prioritization`). INI-01..03 stayed `draft`, and the database held no portfolio selection, ranking snapshot, funding decision, approved milestone, resource demand or capacity. G4's per-initiative criteria (roadmap, owners, funding, capacity, and the per-initiative parts of prioritization, business cases and Finance validation) iterate over the approved portfolio. Over an empty portfolio they read Complete, so GD-04's rationale "The portfolio is executable and value-backed" was not true to the records. I did not edit the evaluator: its fix is T-DG5-BE-X1's.

**Fix (D-172).** The approved portfolio is seeded the way the product records it, on the synthetic clock, between G3 (2026-06-02) and the G4 submission (2026-06-08). Each step is done by the demo user who holds the product permission:

| Step | When (UTC) | Who | Records | Code |
|---|---|---|---|---|
| Submit for prioritization (draft → submitted) | 06-03 07:00 | TL | `initiative.submit` | `roaming-portfolio.ts:226` |
| Score results under weight set v1, ranking snapshot 1, entries; submitted → ranked | 06-03 09:00 | TL | `initiative_score_result` ×3, `ranking_snapshot` 1, `ranking_entry` ×3, `initiative.rank` | `:229` |
| Selection from snapshot 1 (ranked → selected) | 06-04 07:00 | SP | `portfolio_selection` ×3, `initiative.select` | `:280` |
| Finance validation of BC-02..04 baselines (validator never the author) | 06-05 09:30 | FIN | `business_case.validate_baseline` | `:297` |
| Approved funding decision (selected → funded) | 06-05 11:00 | FIN | `decision` DEC-02..04 (executive) + `funding_decision` ×3, `initiative.fund` | `:323` |
| Resourcing roles, capacity Jul–Dec 2026, planned demand | 06-05 13:00 | TL (roles, capacity), WL (demand) | `resource_role` ×3, `capacity` ×18, `resource_demand` ×18 | `:365` |
| Two milestones per initiative | 06-05 14:00 | TL | `milestone` ×6 | `:406` |
| Commit the demand (planned → committed) | 06-06 08:00 | BO | `resource_demand.commit` ×18 | `:426` |
| Approve the milestone dates, with a reason | 06-06 09:00 | TL | `milestone.approve_date` ×6 | `:443` |
| Launch on the planned start (funded → launched), after G4 | 07-03 08:00 | TL | `initiative.launch` | `:467` |

- **Weighted scores.** They are the scoring engine's results of the existing T06 scores: INI-03 4.1000 (rank 1), INI-01 3.9500 (rank 2), INI-02 3.9500 (rank 3, after INI-01 by code). The test recomputes them with `@mth/shared/calc` `weightedScore`.
- **Schedule.** Milestones fall inside each initiative's planned window and after the synthetic clock. INI-03's last milestone (2026-09-28) is before DEP-01's needed-by date (2026-10-01), so G4 lists no needed-by conflict and no Unknown schedule.
- **Capacity.** Committed demand per month is 2.50 / 1.50 / 1.50 FTE against capacity of 3.00 / 2.00 / 2.00, so there is no over-allocation and no Unknown cell. The 5.5 FTE total stays within BC-01's 6.5 internal FTE.
- **Gate wiring** (`roaming-gates.ts:731`, `:734`). The portfolio is seeded just before G4 is submitted, and launched after all approvals.
- **No exception, every criterion complete.** The snapshot criteria are at `roaming-gates.ts:487` and the criterion rows at `:528–531`. The G4 snapshot member is read from the seeded records (`g4SnapshotOf`, `:627`). It names INI-01..03 (status `funded`), ranking snapshot 1, weight set v1, BC-01 and BC-02..04 (validated), the three formula versions (validated), three funding decision ids and 18 committed demand ids. The seed throws if G4 would be submitted on anything other than that portfolio.
- **GD-04** (`roaming-gates.ts:117`). The rationale now reads: "The portfolio is executable and value-backed: INI-01, INI-02 and INI-03 are ranked, selected and funded, each with a Finance-validated initiative business case, owners, approved milestones and committed capacity within the plan; Finance validated the transformation case baseline and the three formulas. Proceed to Transform." It keeps the synthetic label (en and ar) and the 2026-06-10 date.
- **Initiative business cases** (`business-cases.ts:280`, inserted at `:560`). BC-02..04 use the ADR-0024 §1 lighter set, with owners WL and FIN. Their author is TL and their validator is FIN. Each case carries its chain's lines through `caseIdOfLine` (`:337`, `:590`).
- **Initiative cards** (`roaming.ts:734`). `scope_in` is added to each card.

**Keep the totals: no pin changed.** BC-01's totals read its own lines plus those of its active initiative cases, by reference (`kpi/totals.ts`). The same seven lines with the same amounts give the same figures:

- revenue uplift 7,128,000 SAR;
- avoided cost 1,584,000 SAR;
- margin uplift 1,920,000 SAR;
- cash cost 3,660,000 SAR (3 lines);
- non-cash cost 1,170,000 SAR (1 line).

The new test asserts these exact figures through `GET /business-cases/{BC-01}/totals`. The funding amounts are the initiative cases' existing cash lines (2,400,000, 360,000 and 900,000 SAR), so no new figure is added. The benefits, their totals and the KBE-H numbers are unchanged. `demo-numbers*.test.ts`, `table-totals-demo.test.ts` and the three QA files pass unchanged.

**Regression test** (`demo-gate-history.test.ts:174`). It runs as demo role users (TL, SP, FIN), through the product's own GET operations, on the real seed and API (`MTH_ENV=demo`):

- **G4 live:** the 8 mandatory criteria are each `complete` with `missing: []`, and the transformation has no gate exception at all.
- **G4 frozen:** every criterion is complete with no `gateExceptionId`, and the snapshot names INI-01..03. This is the reviewer's final assertion reversed (`:213`).
- **Ranking:** the current ranking snapshot ranks all three, complete, with engine-recomputed scores.
- **Selection:** each initiative's latest selection is by SP, from that snapshot, before the G4 submission.
- **Funding:** exactly one approved funding decision per initiative, by FIN as role FIN, after the selection and before the submission, and named in the snapshot.
- **Card, owners and roadmap facts:** each card has objective and scope in, both owners, wave and planned dates.
- **Milestones:** approved milestone dates by TL, inside the planned window, approved before the submission.
- **Schedule:** no needed-by or Unknown schedule flag.
- **Capacity:** committed demand per initiative by BO, named in the snapshot. Every capacity-plan cell for Jul–Dec 2026 has `flag: null`.
- **Business cases:** one initiative case per initiative, under BC-01, with `missingSections: []`, validated by FIN, whose author is not FIN.
- **Totals:** the BC-01 totals above, unchanged.
- **GD-04:** the rationale contains "The portfolio is executable and value-backed", the label, and no "exception".

The test does not depend on T-DG5-BE-X1's evaluator change: it asserts the portfolio and every per-initiative fact directly. The G1–G4 test (`:100`) now also requires no incomplete criterion and no gate exception on any of G1–G4.

**Failing before** (the original seed, test added first; `T-DG5-BE-X2-evidence/01-regression-before.log`), exit 1, 2 failed and 1 passed:

```
AssertionError: G4 incomplete criteria: expected [ 'g4.initiative_cards', …(1) ] to deeply equal []
+   "g4.initiative_cards",
+   "g4.prioritization",
AssertionError: g4.initiative_cards: expected [ 'g4.initiative_cards', …(2) ] to deeply equal [ 'g4.initiative_cards', …(2) ]
-   "complete",
-   [],
+   "incomplete",
+     { "code": "g4.portfolio_empty", "message": "Initiative cards", "pointer": "/initiatives" },
 Test Files  1 failed (1)
      Tests  2 failed | 1 passed (3)
```

**Passing after** (`02-regression-after.log`), exit 0:

```
 Test Files  1 passed (1)
      Tests  3 passed (3)
```

**Kept unchanged:**

- the G1–G3 history and its dates;
- G5 and G6 not submitted (asserted);
- the REQ-S18-002 coverage, including the seeded pending approval (`demo-pending-approval.test.ts` passes; `coverage complete` on the demo stack);
- the deterministic reset: `demo.test.ts` and `demo-roaming.test.ts` "second seed / reset gives identical counts and checksum" pass;
- the three B0147 chains (`demo-traceability-chains.test.ts` passes);
- the 12-step walkthrough on a new transformation (`walkthrough.test.ts` and the demo e2e pass).

## 3. Contract, schema or dependency needs

None. No new operation, no new response shape, no migration, no new dependency. All writes use existing tables and columns.

## 4. Checks run

Environment: Node 24.21.0, offline. These run one at a time, in this order:

| # | Command | Result | Log |
|---|---|---|---|
| 0 | `node tools/gates/validate.mjs --historical --stage DG4` (start) | `PASS gate DG4 (historical)`, exit 0 | (console) |
| 1 | regression test before the fix (`QA_PG_PORT=23050 MTH_PORT_POOL=23051-23060 tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration apps/api/test/integration/environment/demo-gate-history.test.ts`) | exit 1: 2 failed, 1 passed (expected) | `01-regression-before.log` |
| 2 | `pnpm -r typecheck` | exit 0 | `10-typecheck.log` |
| 3 | `pnpm -r build` | exit 0 | `11-build.log` |
| 4 | `pnpm lint` | exit 0 | `12-lint.log` |
| 5 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | exit 0 | `13-prettier.log` |
| 6 | `pnpm openapi:lint` | exit 0, 846 operations | `14-openapi-lint.log` |
| 7 | `npx vitest run --configLoader runner --project unit-node`, locale unset | exit 0: 144 files, 2335 tests passed | `20-unit-node-unset.log` |
| 8 | the same with `LANG=C.UTF-8` | exit 0: 144 files, 2335 tests passed | `21-unit-node-cutf8.log` |
| 9 | the four demo e2e specs (`E2E_PG_PORT=23070 E2E_API_PORT=23071 MTH_PORT_POOL=23072-23090 e2e/support/with-demo-stack.sh npx playwright test e2e/a02-guided-walkthrough.spec.ts e2e/a02-demo-users-walkthrough.spec.ts e2e/a02-demo-labels.spec.ts e2e/a21-no-ai-operation.spec.ts --workers=1 --reporter=list`) | exit 0: 12 passed (en and ar), 5.1 min; seed `coverage complete` | `30-e2e-demo.log` |
| 10 | `with-pg.sh … --project integration apps/api/test/integration/reporting/report-synthetic.test.ts apps/worker/test/integration/demo-reset-dev-binding.test.ts` (other demo-seeding files) | exit 0: 2 files, 8 tests | `42-other-demo-integration.log` |
| 11 | `with-pg.sh … --project integration apps/api/test/integration/contract/contract.test.ts` (its p5 exercises seed the demo) | exit 0: 83 tests | `43-contract.log` |
| 12 | regression test after the fix | exit 0: 3 passed | `02-regression-after.log` |
| 13 | `with-pg.sh … --project integration packages/db/test/integration` | exit 0: 12 files, 218 tests | `40-db-integration.log` |
| 14 | `with-pg.sh … --project integration apps/api/test/integration/environment` | exit 0: 6 files, 50 tests | `41-env-integration.log` |
| 15 | `with-pg.sh … --project integration apps/api/test/integration/reporting/table-totals-demo.test.ts tests/qa/integration/{a02-a21-complete-lifecycle,a15-demo-transformation-outputs,a22-operational-readiness}.test.ts` | exit 0: 4 files, 30 tests | `44-totals-and-qa.log` |
| 16 | `node tools/gates/validate.mjs --historical --stage DG4` (end) | `PASS gate DG4 (historical)`, exit 0 | (console) |

Notes on the runs:

- **Comment-only edits after rows 2–15.** After the integration runs I corrected two comments in `roaming-gates.ts:123` and `roaming-ids.ts:72` that still mentioned the exceptions. After that I wrote this handback, then re-ran `pnpm -r typecheck`, `pnpm lint` and the prettier check over the whole tree, including this handback. Each exited 0 (`15-typecheck-final.log`, `16-lint-final.log`, `17-prettier-final.log`).
- **Earlier runs.** Rows 13–15 were first run once, with the same counts, before the totals assertion was added to the test. The logs above are from the final runs.
- **Not run, D-164:** `pnpm test`, `pnpm test:integration` and the full e2e suite. They run on the merged tree in the orchestrator's verification. They are not reported as passed.
- **e2e screenshots.** Not committed: 42 uncited PNGs, 13 MB (the D-162 precedent). Their names and SHA-256 are in `31-e2e-screenshots-listing.txt`.
- **No failures to disclose.** Apart from the intended failing-before run (row 1), no command exited non-zero, and no test was flaky, retried or skipped.

`date -u`: 15:18:23 (start), 15:59:07 (e2e start), 16:04:31 (e2e end), 16:16:42 (last integration run), 16:31:31 (end, after the final typecheck, lint, prettier and validator).

## 5. Pins changed

**None.** No test pin in `packages/db/test/integration/demo*.test.ts`, `apps/api/test/integration/environment/demo-*.test.ts` or the three QA files needed to change. The record counts and the checksum do change, by design: there are new rows, and the two `gate_exception` rows are gone. No test pins an absolute count or checksum of the real dataset; the tests compare two seeds, or a seed and its resets.

The only test I changed is `demo-gate-history.test.ts`, which this assignment extends. Its old assertion "only `g4.initiative_cards` and `g4.prioritization` are incomplete and covered" became "no criterion incomplete, no exception", because D-172 removes the exceptions.

## 6. ADR and data-dictionary statements this fix makes untrue or incomplete (for T-DG5-ARCH-R5)

- **ADR-0050 D7, `:319`** ("G4: complete except two accepted exceptions …, expiry 2028-08-31 …"). This is now untrue. G4 is complete on the approved portfolio seeded by `roaming-portfolio.ts`, with no exception.
- **ADR-0050 D7, `:317`.** The module ordering text is incomplete: `roaming.gates` now calls `seedApprovedPortfolio` before G4 and `launchApprovedPortfolio` after it.
- **ADR-0050 D7, `:322`.** "The exception reasons carry the same label" is moot, because there are no exception rows.
- **ADR-0050 D7, `:330`.** "Every seeded G-decision and exception …": there are now no exceptions. The selections, funding decisions, case validations and milestone approvals are synthetic demo decisions too.
- **ADR-0050 D7, `:331`.** This test description is untrue ("only `g4.initiative_cards` and `g4.prioritization` are excepted"). The test now asserts no exception and the real portfolio (`demo-gate-history.test.ts:174`).
- **ADR-0050 D9, `:339`.** "With both G4 gaps covered, it reads '6 of 8 … covered by accepted exceptions'" is untrue for the demo. G4 now reads 8 of 8 complete, with no covered variant.
- **ADR-0050 §4 (dataset content).** It should mention the approved portfolio:
  - INI-01..03 are launched (funded at G4);
  - ranking snapshot 1;
  - three selections and three funding decisions, DEC-02..DEC-04;
  - initiative cases BC-02..BC-04, each holding its chain's lines;
  - three resourcing roles with 18 capacity rows and 18 committed demands;
  - six approved milestones.
- **Data dictionary `:12381`** ("… and two accepted `gate_exception` rows on G4"). This is now untrue. The demo has no `gate_exception` row, and it now writes `initiative_score_result`, `ranking_snapshot`, `ranking_entry`, `portfolio_selection`, `funding_decision`, `resource_role`, `capacity`, `resource_demand` and `milestone` rows, plus three initiative-level `business_case` rows.
- **ADR-0024 / ADR-0021.** Nothing becomes untrue. The demo now exercises the initiative-case and portfolio paths those ADRs describe.

## 7. User-facing texts this work made untrue, and what I did

- **The seeded G4 submission note and GD-04 rationale** (shown on the G4 page and in the decision log, en and ar label). They said selection and ranking were "covered by the accepted exceptions". Both are rewritten to match the records (`roaming-gates.ts:113–120`). The rationale is English with the bilingual synthetic label, as in every seeded rationale (BE-V3).
- **The two exception reasons and the compensating action** (G4 page, exceptions list). They are removed with the exceptions.
- **The G4 readiness line.** On the demo it now reads the plain complete variant, not the "covered by accepted exceptions" variant. The UI strings themselves (`gates.readinessCovered*`) are product strings and stay true for gates that do carry exceptions. They were not changed and are not mine.
- **New seeded texts** (rationales, notes, milestone titles, role labels). They are synthetic English data values, as the rest of the dataset is. The three resourcing roles carry Arabic labels in `label_ar` (`roaming-portfolio.ts`, `DEMO_PORTFOLIO[*].role.labelAr`); like the rest of the dataset's Arabic, they are provisional.

## 8. What remains, and observations for the reviewers

Nothing in the assignment's scope remains. Observations, not fixed:

1. **G5 readiness is not re-checked on the demo stack.** The funding decisions add three decided executive decisions (DEC-02..04) to the T16 decision log, and the initiatives are now launched. This may change G5's live readiness text from D-171's "1 of 4". G5 and G6 stay not submitted (asserted), and no test pins their readiness. I did not render G5 in the UI.
2. **No org-level "portfolio" is seeded.** The reviewer's evidence included `GET /organizations/{o}/portfolios` (0 items). That is the P4 grouping of transformations (`portfolio/structure.ts`), not the G4 approved selection. G4 does not read it, and D-172 does not ask for it.
3. **INI-01 still shows a `schedule.before_predecessor` warning.** INI-01 starts (2026-07-03) before INI-03's finish (2026-09-28), against DEP-01. It is a roadmap warning that G4 does not list. The needed-by date is met, so there is no needed-by conflict. It was there before this change.
4. **The seed writes no outbox events for the new records**, as BE-V3 did not for the gates (D-171 observation (g)): no `ranking`, `funding` or `launch` consumers run from the real clock. Each row has its audit event (`ctx.insert` writes `<table>.create`; status steps use the product's verbs: `initiative.submit/rank/select/fund/launch`, `resource_demand.commit`, `milestone.approve_date`, `business_case.validate_baseline`). One difference from the API: the selection row's audit action is `portfolio_selection.create` (the seed's insert path), where the API writes `portfolio_selection.select`.
5. **No G4 page rendered.** I did not render the G4 page in en and ar. The live readiness is asserted through the API (8 of 8 complete, nothing missing), and the four demo e2e specs pass.

## 9. Merge instructions

- There are no migrations. Apply the five changed files and the new `roaming-portfolio.ts`. The demo dataset then seeds as before (`mth-db seed-demo`, reset), with new counts and a new checksum.
- **Expected conflicts:** none with T-DG5-BE-X1 (`apps/api/src/modules/workflows/**`) or T-DG5-FE-X1 (web). After merging BE-X1's fail-closed evaluator, `demo-gate-history.test.ts` should still pass: the portfolio is not empty, and the test does not depend on the evaluator.
- **Re-verify after the merge:** run `apps/api/test/integration/environment/demo-gate-history.test.ts` on the merged tree.
