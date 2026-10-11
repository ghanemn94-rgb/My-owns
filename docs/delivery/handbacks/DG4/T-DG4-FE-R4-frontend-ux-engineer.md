# Handback T-DG4-FE-R4 (frontend-ux-engineer): DG4 round-1 finding repairs F-DG4-120, F-DG4-102, F-DG4-141 and the F-DG4-121 labels

- **Stage:** DG4 (BUILDING). Task T-DG4-FE-R4. Assignment `docs/delivery/assignments/DG4/T-DG4-FE-R4.md` (sha256 `f1feb449…bb5c`, verified).
- **Invocation:** run `DG4-T-DG4-FE-R4-frontend-ux-engineer-20261011T005910Z-d954d347`, session `d954d347-4d27-4311-9202-ba3f6b1a3775`.
- **Base:** worktree `/home/user/wt/dg4-fe-r4`, branch `dg4/fe-r4`, `HEAD` = `f5579e7af2c793cd6dc5b529c9a88f33f815d785`. The changes are **uncommitted**, for the orchestrator to integrate.
- **Started / ended (UTC):** `date -u` gave 2026-10-11 00:59:22 at the start and 2026-10-11 02:37:56 (about 99 minutes) at the end.
- **Read first:** CLAUDE.md, `docs/delivery/agent-protocol.md`, D-117 (verbatim), D-088 to D-090, `p4-work-split.md` §1 (S-1 … S-14), and the four round-1 finding records (reproduction, expected, actual).
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG3` exits **0** (`PASS gate DG3 (historical)`). I ran it at the start and again at the end (see Checks).
- **Engineering only.** I granted no business, Finance or IT approval. Every record the e2e runs create is SYNTHETIC. Product gates G1–G6 are unrelated to DG0–DG7.

Evidence directory: `docs/delivery/handbacks/DG4/T-DG4-FE-R4-evidence/`.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/web/src/pages/decision-rights/DecisionRightsPage.tsx` | F-DG4-120: `DecisionRightsArNotice` (Arabic only, `data-provisional='decision-rights'`) above the T11 table. `SourceLabel` shows each R/A/C/I/SLA label verbatim; in Arabic an English (non-Arabic-script) label is marked `lang="en" dir="ltr"`, and a label the transformation wrote in Arabic is shown as it is. |
| `apps/web/src/i18n/{en,ar}/decisionRights.json` | F-DG4-120: new key `arProvisional`, interpolating the five translated column names. |
| `apps/web/src/pages/raci/governance.test.tsx` | F-DG4-120: 2 new tests × en/ar (notice in Arabic only, before the table; verbatim English labels marked `lang`/`dir`; an Arabic label not marked). |
| `apps/web/e2e/p4-governance.spec.ts` | F-DG4-120 e2e assertion on the real stack: in Arabic the notice text and the five `lang="en" dir="ltr"` cells of the seeded `business_scope_change` row; in English no notice; `5 working days` verbatim in both. |
| `apps/web/src/pages/my-work/messages.ts` (new) | F-DG4-102: `renderMessage` and its private helpers (`CODE_PARAMS`, `DATE_PARAMS`, `isArabicNameOf`), moved **byte-identical** out of `MyWorkPage.tsx`. |
| `apps/web/src/pages/my-work/MyWorkPage.tsx` | F-DG4-102: imports `renderMessage` from `./messages.ts`; three imports no longer used are dropped. |
| `apps/web/src/pages/dashboards/MyWorkSections.tsx` | F-DG4-102: imports `renderMessage` from `../my-work/messages.ts` (it no longer imports the page). |
| `apps/web/src/pages/my-work/message-keys.test.ts` | F-DG4-102: imports `renderMessage` from its new module. |
| `apps/web/src/pages/traceability/selection.ts` (new) | F-DG4-102: `useTraceSelection`, moved **byte-identical** out of `TraceabilityPage.tsx`. |
| `apps/web/src/pages/traceability/TraceabilityPage.tsx`, `TracePanels.tsx` | F-DG4-102: both import `useTraceSelection` from `./selection.ts`; `useSearchParams` is no longer imported by the page. |
| `apps/web/e2e/journeys.spec.ts` | F-DG4-141: "administration screens" searches the users register for `Synthetic Transformation Lead` (the page's labelled search form; it waits for the `GET /api/v1/users?…q=Synthetic Transformation Lead` 200), then keeps its assertion, screenshot and axe check. |
| `apps/web/src/pages/benefits/Totals.tsx` | F-DG4-121 labels: the gross row names its basis (profit and cash: margin uplift, cash saving, working capital release). Two rows beside gross, `beside-revenue_uplift` (top line) and `beside-avoided_cost` (non-cash), read their amounts from the response's own class lines (planned, validated), carry `data-not-summed="true"` and show "No values" when a line is absent (never 0). Net is labelled profit and cash. The web adds nothing up. |
| `apps/web/src/i18n/{en,ar}/benefitsP4.json` | F-DG4-121: `totals.gross`, `totals.net` and `totals.netNote` reworded; new `totals.grossBasis`, `besideRevenue`, `besideAvoided` and `noValues`. |
| `apps/web/src/pages/dashboards/DashboardsPage.tsx` | F-DG4-121 labels: the Finance gross/net table also lists the `revenue_uplift` and `avoided_cost` lines of the planned and validated states, labelled "beside gross: not in gross or net" (`data-not-summed`). They keep their own drill-down and are ordered gross → revenue uplift → avoided cost → net. Margin and cash are not repeated, since they are inside gross. |
| `apps/web/src/i18n/{en,ar}/dashboards.json` | F-DG4-121: `valueClass.gross`, `valueClass.net`, `finance.grossNetIntro` and `finance.netFormula` name the basis; new `finance.besideGross.{revenue_uplift,avoided_cost}`. |
| `apps/web/src/pages/benefits/benefitsFixtures.ts`, `apps/web/src/pages/dashboards/dashboardFixtures.ts` | F-DG4-121: new mocks `grossBasisTotals()` and `grossBasisFinanceDashboard()` (the reviewer's DOM-GROSS example as D-117 computes it: revenue 300, margin 70, cash 20, avoided 45 → gross 90, net 90). The existing fixtures' gross now follows D-117 (`totals()` planned gross 500000 = cash only; `financeDashboard()` gross 0 with revenue uplift only). No existing assertion depended on the old value. |
| `apps/web/src/pages/benefits/benefits.test.tsx`, `apps/web/src/pages/dashboards/dashboards.test.tsx` | F-DG4-121: 2 + 1 new tests × en/ar. |
| `apps/web/e2e/p4-benefits.spec.ts`, `apps/web/e2e/p4-dashboards.spec.ts` | F-DG4-121 e2e label assertions. Benefit totals: the gross basis label; the revenue-uplift row beside gross shows the validated class line `240000.5000` and is marked not summed; the avoided-cost row label. Finance dashboard: the basis intro. Neither asserts a gross amount, so both hold before and after the KBE-R5 merge. |
| `docs/delivery/handbacks/DG4/T-DG4-FE-R4-*` | This handback and its evidence. |

I changed nothing under `apps/api`, `apps/worker`, `packages`, `docs/api`, `tools/**`, `.claude/**`, `docs/source/**`, review or gate records, `stages.json` or `findings.json` (`byte-stability.log`).

## 2. Behaviour delivered, per finding and requirement row

### F-DG4-120 (REQ-PB-065; acceptance: "A01: four rows seeded verbatim; a change request of type Business scope change routes approval to the Sponsor")

D-117 decided the reviewer's alternative: "the Arabic T11 view shows the English source labels under a provisional-Arabic notice, as the forums page does. No contract change." That is what I built.
- **In Arabic**, the T11 page shows `ⓘ decisionRights.arProvisional` right above the table (`data-provisional='decision-rights'`, before it in reading order). The notice names the five translated columns (Recommend, Approve, Consult, Inform, SLA) and says the labels are the English source text of B0099 and that their Arabic translation is provisional and not yet available.
- **The labels** are shown verbatim. In Arabic they are marked `lang="en" dir="ltr"` (`data-verbatim-en=<column>`), so they read left to right and a screen reader pronounces them in English.
- **In English** there is no notice.
- **Unchanged:** the seeded rows, routing and contract. The acceptance text still holds; the seeded rows are verbatim, and the e2e asserts `5 working days`.
- **Reproduction.** Unit before the fix: `f120-unit-before.log`, 4 failed. After: `f120-unit-after.log`, governance file 19/19. Real stack: the `p4-governance.spec.ts` assertion passes in chromium-en and chromium-ar, both in the full run and alone (`e2e-rerun-p4-governance.log`, 16 passed).
- **Screens:** `shots/ar/p4-04-decision-rights.png` (notice and LTR English labels) and `shots/en/p4-04-decision-rights.png`.
- **Not done, by design (D-117):** the template's Arabic texts (`5 أيام عمل`) are not shown, so the domain probe assertion `ar.T11.four-rows` that looks for `5 أيام عمل` would still fail. Showing them needs a contract change, which D-117 rejected.

### F-DG4-102 (REQ-S03-008; acceptance: "A02;A12: a KPI owner with a due actual sees it under Missing updates … another user's items never appear")

- `renderMessage` and its helpers moved to `pages/my-work/messages.ts`, and `useTraceSelection` to `pages/traceability/selection.ts`. Both moves are byte-identical (`f102-moved-code-identical.log`: IDENTICAL ×2).
- **Module-graph check.** madge is not installed offline, so I used the reviewer's own probe, `web-cycles.mjs`, with an absolute path.
  - Before: 3 SCCs (`f102-cycles-before.log`), the two P4 cycles plus the DG2 `UsersPage ↔ AssignmentsPage`.
  - After: 1 SCC (`f102-cycles-after.log`), only the DG2 cycle, which the finding says is "not raised here". It is outside my file ownership and I left it.
  - The probe reports 0 cycles if given a relative path, because it compares against absolute paths. Reviewers should pass an absolute path.
- **Behaviour unchanged:** My Work, dashboards and traceability unit tests pass, and the final unit suite is green.

### F-DG4-141 (REQ-S16-011; the finding is test robustness only)

- The test now fills the labelled search field of the users register's `role="search"` form with `Synthetic Transformation Lead` and applies it. It waits for the `q=` request (200), then asserts the exact link, screenshot and axe check as before.
- **Reproduction on one stack** (`f141-repro-*.log`; seed spec and script kept as `.txt`):
  - 30 synthetic users that sort first were seeded, so page 1 no longer contains the user (asserted through the API);
  - the pre-fix spec (HEAD copy) **fails** in chromium-ar at `expect(getByRole('link', { name: 'Synthetic Transformation Lead' })).toBeVisible()`, the reviewer's failure;
  - the fixed spec **passes** in chromium-ar and chromium-en.
- **Shared stack in both projects:** in the full run (product journeys plus the four root acceptance specs on one stack, en then ar), "administration screens" passed in both projects (tests 7 and 180), and `journeys.spec.ts` passed 9/9 in each project.

### F-DG4-121 labels (REQ-S08-009; acceptance: "A10: the Finance dashboard shows revenue uplift and margin benefit on separate lines; cost avoidance is not counted in cash savings")

Built to the D-117 rule; KBE-R5's response is mocked in the unit tests.
- **Benefit totals** (`Totals.tsx`):
  - "Gross benefit (profit and cash)", with the basis line "Margin uplift, cash saving and working capital release only";
  - beside it, never summed: "Revenue uplift — top line … its margin belongs in margin uplift" and "Avoided cost — non-cash", each from its own class line, with "No values" when absent (never 0);
  - "Net value (profit and cash)", and the reworded net note.
- **Finance dashboard:** the gross and net labels and the section intro name the basis. The gross/net table lists the planned and validated revenue-uplift and avoided-cost lines, labelled "beside gross: not in gross or net", with their drill-downs marked `data-drill-beside`. Each class line keeps exactly one `data-drill-line`, in the per-class table.
- **Unchanged:** the per-class lines and the acceptance text (separate lines; avoided cost separate from cash saving). The web computes no total.
- **Tests:**
  - unit `f121-unit-before.log` (6 failed) → `f121-unit-after.log` (75/75);
  - e2e label assertions in `p4-benefits.spec.ts` and `p4-dashboards.spec.ts` pass in both projects;
  - `p4-dashboards` 4b was re-run after `p4-benefits` with real class lines (annotation "7 class, 2 gross, 2 net" in both projects): 32 passed (`e2e-rerun-benefits-then-dashboards.log`).
- **Screens:** `shots/{en,ar}/p4ben-15-register-validated-totals.png`, `p4dash-07-finance.png` and `p4dash-07b-finance-class-drilldown.png`.

## 3. Checks (real exit codes; logs in the evidence directory)

| Check | Result |
|---|---|
| `node tools/gates/validate.mjs --historical --stage DG3`, start and end | exit 0 both times (`validate-historical-DG3-{start,end}.log`) |
| `pnpm -r typecheck` (final tree) | exit 0 (`typecheck.log`) |
| `pnpm -r build` | exit 0 (`build-1.log`, `build-2.log`, `build-3.log`; build-3 is the final tree, used for the re-runs) |
| `pnpm lint` (final tree) | exit 0 (`lint.log`) |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` (final tree) | exit 0 (`prettier.log`) |
| `pnpm openapi:lint` | exit 0, 652 operations (`openapi-lint.log`) |
| `pnpm test`, locale unset (final tree) | exit 0. unit-node + unit-web: 145 files, 2781 passed. unit-formula-nocodegen: 3 files, 259 passed, 2 skipped (`unit-final-unset.log`; an earlier run before the drill fix had the same counts, `unit-unset.log`) |
| `pnpm test`, `LANG=LC_ALL=C.UTF-8` (final tree) | exit 0, the same counts (`unit-final-cutf8.log`, earlier `unit-cutf8.log`) |
| `QA_PG_PORT=26200 MTH_PORT_POOL=26203-26209 tests/qa/support/with-pg.sh pnpm test:integration` | exit 0: 202 files, 1922 passed (`integration.log`). Run before the last web-only drill fix, which no integration test touches. I changed no pinned count. |
| Full e2e on one stack: `with-stack.sh npx playwright test apps/web/e2e/ e2e/a03… e2e/a04… e2e/a08-a09… e2e/a20… --workers=1`, both projects | **exit 1: 331 passed, 5 failed, 10 did not run** (`e2e-full.log`, `e2e-full.json`, per spec in `e2e-full-per-spec.txt`). See below. |
| Re-runs, each spec alone on one fresh stack (final build), both projects | `p4-dashboards` 14 passed, `p2-journeys` 24, `p4-gates-closure` 18, `p4-governance` 16, `p4-benefits` 18, `journeys` 18, all exit 0 (`e2e-rerun-*.log`). Then `p4-benefits` + `p4-dashboards` together: 32 passed, exit 0. |
| axe | enforced in every `expectAccessible` step (a serious or critical issue fails the test). No failure in any run was an axe failure, so 0 serious or critical issues in every step that ran. |
| Disk (`df -h .`) before the full runs | 16–17 GB free (above the 3 GB stop level) |

**The 5 failures in the full run, disclosed:**
1. **`p4-dashboards` 4b, en and ar: a regression my first F-121 change caused.** The beside-gross rows repeated the `data-drill-line` attribute, so `toHaveCount(1)` saw 2. I fixed it with `data-drill-beside`, added a unit assertion, and re-ran: 14/14 alone, and 32/32 after `p4-benefits` with 7 real class lines.
2. **`p2-journeys` "Define → G2", en and ar (32.0 s and 32.4 s):** `Test timeout of 30000ms exceeded` in `page.goto`, while the machine's load average was 7 to 11 on 4 cores (other agents, plus my niced unit run). Re-run alone: 24/24 passed. I did not raise the timeout.
3. **`p4-gates-closure` 9, en only (30.2 s):** the 30 s timeout under the same load. Re-run alone: 18/18 passed.

The 10 "did not run" tests are the serial followers of these failed tests, and they passed in the re-runs. The full combined run was **not repeated green on the final build**: about 53 minutes did not fit the time limit. The orchestrator or the round-2 QA should re-run it once on the integrated candidate.

**Per spec (full run, both projects):** every spec other than the three above passed fully in both projects, for example `journeys` 9+9, `p4-governance` 8+8, `p4-benefits` 9+9 and the root a03/a04/a08-a09/a20 at 2/1/2/2 per project. See `e2e-full-per-spec.txt`.

## 4. Byte stability, operations, contract

- **API responses:** no file under `apps/api`, `apps/worker`, `packages` or `docs/api` changed (`byte-stability.log`: empty diff and status). Every API response is byte-identical by construction, so I ran no transcript A/B: there is no server source to compare. **Changed members: none.**
- **Operations routed:** none. FE-R4 has no `p4-pending-*` list. Delta: ∅.
- **Contract or schema need:** none. F-121 uses the existing `BenefitTotalsCurrency.lines` and `FinanceValueLine` class lines, as KBE-R5's assignment keeps them ("returned as separate lines").

## 5. What remains, and merge instructions

1. **Merge with KBE-R5 together (F-121).** The labels say "gross (profit and cash)". Until KBE-R5's server change lands, the server's gross still sums all five classes, so on today's stack the label is **wrong**: `shots/ar/p4ben-15-…png` shows a gross validated of 240,000.50 that is the revenue uplift alone. Integrate this task together with, or after, KBE-R5; never alone.
   - After the merge, check that `p4-benefits` and `p4-dashboards` still pass. They assert labels and class-line amounts only, not a gross amount.
   - Optionally, a reviewer can check the real gross = margin + cash + WCR on the stack.
2. **Value-area headlines (open question after the merge).** The Finance dashboard's "Planned value" and "Validated value" headlines (`value.planned` and `value.validated`) currently equal gross (finance.ts drill invariant).
   - If KBE-R5 also moves them to the profit-and-cash basis, their labels (`dashboards.headline.dashboard__headline__value_*`, also used by the T10 Value area) should name the basis too.
   - I did not change them, because I could not see KBE-R5's choice.
3. **Cosmetic (F-120 notice, Arabic).** The Arabic SLA column name already ends in "(SLA)", so the notice reads "…(SLA))". I'll fix it by moving `{{columns}}` out of the parentheses, a one-line i18n change in `decisionRights.json` (both languages). I left it so the final unit runs would not be invalidated near the time limit.
4. **Re-run the full combined e2e once on the integrated candidate.** The final build was verified spec by spec, not in one combined run (section 3).
5. **DG2 cycle `UsersPage ↔ AssignmentsPage`:** not in my scope, and not raised by the finding.
6. **Untracked top-level files not mine** (`.bashrc`, `.zshrc`, `CLAUDE.local.md`, `.mcp.json`, …) appear in `git status`, presumably sandbox or home artifacts. I did not create or touch them. The prettier check passed with them present.

**Merge:** no migrations and no conflicts expected outside `apps/web`. Two new files: `apps/web/src/pages/my-work/messages.ts` and `apps/web/src/pages/traceability/selection.ts`. Changes are uncommitted.

## 6. Interaction checks actually run

- **Real stack, Playwright, en and ar:**
  - T11 page: notice text and `lang`/`dir` on 5 cells in ar; no notice in en;
  - users register: search typed and applied, `q=` request awaited, exact link visible;
  - benefit totals: rows and labels;
  - Finance dashboard: intro text; a class-line drill-down opened from the per-class table, with dialog and axe;
  - axe on every `expectAccessible` step.
- **Unit (jsdom), en and ar:** notice order before the table, an Arabic label not marked English, row order and `data-not-summed`, "No values" for an absent class line, a single `data-drill-line` per class line.

