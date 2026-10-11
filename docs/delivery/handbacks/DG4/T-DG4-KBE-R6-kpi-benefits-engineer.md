# Handback T-DG4-KBE-R6 (kpi-benefits-engineer): the value headlines on one basis (F-DG4-123, D-119, D-120)

- **Stage:** P4 / DG4, FIXING after review round 2, repair wave B.
- **Invocation:** `DG4-T-DG4-KBE-R6-kpi-benefits-engineer-20261011T090332Z-1b406eaa`, session `1b406eaa-42c7-4119-87d4-71c059b896f1`.
- **Assignment:** `docs/delivery/assignments/DG4/T-DG4-KBE-R6.md`, sha256 `1463c563…0aa3f`, verified at the start (`sha256sum`).
- **Base:** branch `dg4/kbe-r6`, `HEAD` `47d1536f2e99a12e16a0d1abab75f928124079cb` (ARCH-R5 merged). `git status` at the start: only untracked sandbox dotfiles.
- **Time:** `date -u` 09:03:42Z at the start; 10:15:35Z (the handback was written last) at the end.
- **State:** all changes **uncommitted**, as asked.
- **Ports:** 26100–26109 (reproductions, contract runs), 26110–26119 (A/B transcripts), 26120–26149 (full integration). **Disk:** 18–20 GB free before every full run (`20-disk-before-unit.txt`, `30-disk-before-integration.txt`); D-104's 3 GB floor was never approached.

This is an engineering record. It grants no product gate (G1–G6) and no business, Finance or IT approval; product gate G6 never implies DG7. All fixture data is synthetic.

Evidence directory: `docs/delivery/handbacks/DG4/T-DG4-KBE-R6-evidence/` (written below as `evidence/`).

## 0. Preceding gate

`node tools/gates/validate.mjs --historical --stage DG3`: **exit 0**, `PASS gate DG3 (historical)`, at the start (`evidence/validate-dg3-historical.log`) and at the end (`evidence/validate-dg3-historical-end.log`).

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/api/src/modules/reporting/dashboards/areas.ts` | The Value area on the profit-and-cash basis (`margin_uplift` + `cash_saving` + `working_capital_release`, from the shared `HEADLINE_BASIS_CLASSES`). It adds the top-line and non-cash sums per currency, the `no_profit_and_cash_benefit` n/a, the Value RAG rule `dashboard.rag.value.no_profit_and_cash_benefit`, and `ruleParams.headlineBasis`. New exports: `VALUE_BASES`, `NO_PROFIT_AND_CASH`, `basisClasses`, `basisOfClass`, `BasisSums`; `valueLinesOf` gains an optional `classes` argument |
| `apps/api/src/modules/reporting/dashboards/engine.ts` | `headline()` emits `headlineBasis`, and drills with `valueClass` for `top_line`/`non_cash`. The Value block emits per currency: profit_and_cash planned, forecast, submitted, validated and gap; then top_line ×4 and non_cash ×4 where present; then the investment. All with the new label keys |
| `apps/api/src/modules/reporting/dashboards/drilldown.ts` | Without `valueClass`, a value-state drill-down sums the three profit-and-cash classes, over the currencies of the eligible profit-and-cash benefits (the `asBuilt` branch is removed). Rule key `dashboard.value.sum_<state>_profit_and_cash`. n/a `no_profit_and_cash_benefit` or `no_financial_benefit`. `value.gap` lists profit-and-cash lines only. Every response carries `headlineBasis` |
| `apps/api/src/modules/reporting/dashboards/finance.ts` | The gross line always drills (the N2 condition is removed, along with `BESIDE_GROSS_CLASSES`). `GROSS_VALUE_CLASSES` = `HEADLINE_BASIS_CLASSES.profit_and_cash`. The pending-validation headline has `headlineBasis: null`. Header comment updated |
| `apps/api/src/modules/reporting/workspace-header.ts` | `benefits.planned`/`.validated` are profit-and-cash (from the Value area). `benefits.headlines` = the T10 planned and validated headlines with a non-null basis (`[]` when the value status is `no_benefit`) |
| `apps/api/test/support/p4-pending-arch-r5.ts` | `P4_PENDING_ARCH_R5_MEMBERS` is now **empty**, with a comment recording the three members removed |
| `docs/api/openapi.yaml` | **Closing step (D-120), 3 lines only:** `headlineBasis` added to `required` of `DashboardHeadline` and `DashboardDrilldown`, and `headlines` added to `WorkspaceHeader.benefits.required` |
| `packages/shared/src/schemas/dashboards.ts` | **Closing step (D-120), 3 lines only:** the three `.optional()` calls dropped |
| `apps/api/test/integration/reporting/headline-basis.test.ts` (new) | The F-DG4-123 acceptance and reproduction test: the four surfaces, variants A–C, the drill invariant per currency (SAR and USD) for every value headline, the drill-down basis per class |
| `apps/api/src/modules/reporting/dashboards/areas.test.ts` | The fixture's default class becomes `margin_uplift` (the existing Value examples keep their values). 9 new N3 unit tests, including a 300-set property test per basis and currency |
| `apps/api/test/integration/contract/p4-exercises-kbe-g.ts` | `validatedBenefit` takes an optional `{ valueClass }`. The default (revenue uplift) is unchanged, so the contract exercises are unchanged |
| `apps/api/test/integration/reporting/{drilldown,filters,workspace-header,finance-adoption,finance-drilldown-k1}.test.ts` | Re-baselined (§2.3) |
| `tests/qa/integration/a04-a05-a10-partials.test.ts`, `tests/qa/integration/a04-kpi-propagation.test.ts` | Re-baselined (§2.3). ARCH-R5 §6 names both as readers |
| `docs/delivery/handbacks/DG4/T-DG4-KBE-R6-kpi-benefits-engineer.md`, `…-evidence/**` | This handback, the logs, the A/B transcripts, and the web fixture patch for FE |

Not changed: `benefits/totals.ts` and `kpi/totals.ts` (the DG3 business-case totals, as D-119 says), the class lines, the Finance validation rules, `value.investment`, the filters and scope, every migration. Not changed either: every web file. `apps/web/src/pages/dashboards/dashboardFixtures.ts` is FE-owned (§5).

## 2. Behaviour delivered

### 2.1 F-DG4-123, against the finding's **expected** text and the assignment

The reviewer's expected text: "each money headline uses one compatible basis … 'Planned value' and 'Validated value' (and the value gap) use the same profit-and-cash basis as gross … with revenue uplift (top line) and avoided cost (non-cash) as headlines … of their own … no single SAR headline adds top line to profit or non-cash to cash, and no unlabelled sum does … the drill invariant can hold per class."

| Assignment item | Delivered | Test |
|---|---|---|
| Value headlines (planned, forecast, submitted, validated, gap, RAG) sum only margin + cash saving + working capital, per currency, on T10, the Overview, the header and Finance | yes | `headline-basis.test.ts` test 1, all four surfaces |
| DOM-GROSS fixture: profit-and-cash planned **90**, revenue uplift **300**, avoided cost **45**, on all four surfaces | yes. Also: validated `zero`, gap `1`, RAG **red** (`validated_gap`, `ruleParams.headlineBasis: profit_and_cash`), Finance gross planned 90 = the headline, with the same href. `"435"` occurs in no response body | test 1 |
| Revenue uplift or avoided cost only → `not_applicable` on the profit-and-cash headline, never 0 or green | yes: all four states, the gap, the header's planned/validated (`no_profit_and_cash_benefit`), the Value RAG (`dashboard.rag.value.no_profit_and_cash_benefit`), the Overview row's Value status `not_applicable`; 300 and 45 still shown | test 3 (variant A), unit "variant A", "variant A per currency" |
| Variant B (zero vs n/a) | profit-and-cash planned `zero`, gap n/a `nothing_planned`, RAG `nothing_due` | test 4, unit |
| Variant C (Unknown isolation) | top-line planned `unknown` `benefit.value_amount_missing`; profit-and-cash 70, gap 1, red | test 5, unit |
| The drill-down of each headline follows ARCH-R5's rule; the drill invariant is extended to every new headline | profit_and_cash: no `valueClass`; top_line: `revenue_uplift`; non_cash: `avoided_cost`. For **every** value headline on T10, the Overview, Finance and the header, the decimal sum of the drill items in the headline's currency equals its value (or both unknown; n/a: no item), with SAR **and USD**, in all four states: 3 × 5 × 4 = 60 headlines + 10 header headlines. Finance: gross = the profit-and-cash headline = its drill sum, per state and currency | test 6; tests 1, 3–5 run the same check; unit property test (300 sets) |
| `p4-pending-arch-r5.ts` emptied | `P4_PENDING_ARCH_R5_MEMBERS = []` | contract test (§3) |
| Every test that pinned the old five-class headline updated, each listed with old and new value | §2.3 | |

**Reproduction, before and after.**
- `evidence/01-repro-before.log` (exit 1, 7/7 failed). The first assertion is the reviewer's own reading: "T10 first SAR value.planned: expected '435' to be '90'".
- `evidence/06-repro-after.log` (exit 0, 7/7).
- The reviewer's own probe, `zz-domain-r2.test.ts`, copied in for one run and removed: `evidence/07-reviewer-dom-gross-after.log` (exit 0, 4/4). It logs `value.planned` `dashboard.headline.value_planned_profit_and_cash` `"90"`, and no `"435"`. Their round-2 logs show it (`dom-gross-run3.log`, `integration-run-1.log`).

### 2.2 Requirement rows (acceptance texts quoted)

- **REQ-S08-009:** "A10: the Finance dashboard shows revenue uplift and margin benefit on separate lines; cost avoidance is not counted in cash savings". The class lines are unchanged and still separate. The headlines now also keep them apart: no headline adds revenue to margin or avoided cost to cash saving (test 1).
- **REQ-S13-003:** "A04;A05: the validated benefit total drills to its benefit records; a KPI with no data shows Unknown, not 0". 'Validated value (profit and cash)' drills to exactly its benefit records, and their sum equals it (`drilldown.test.ts`, `a04-a05-a10-partials.test.ts`, test 6). Unknown stays Unknown (variant C). The KPI part is unchanged (`drilldown.test.ts`, passing).
- **REQ-S03-009:** "A04: after an accepted KPI actual the overview's outcome tile shows the new actual once and its drill-down lists the source record". Unchanged; still passing. The Overview's Value tile and its rows now use the profit-and-cash basis.
- **REQ-S03-011:** "A02: … the header shows the eight elements with Unknown where data is missing". The eight elements are unchanged. `benefits` gains `headlines`. With no benefit: state `unknown`, `planned`/`validated`/`headlines` `[]` (`workspace-header.test.ts`).

### 2.3 Tests that pinned the old five-class headline (old → new)

| Test | What it pinned | Change and values |
|---|---|---|
| `areas.test.ts` (unit, 6 Value tests) | The fixture `benefit()` defaulted to `revenue_uplift`. Under N3 that is top line, so every 'Value' example became n/a `no_profit_and_cash_benefit` | Fixture default → `margin_uplift`. **Values unchanged:** gap 0.1 amber, the strict policy red, validated 20 / planned 150 / submitted 70 / forecast 500, zero, SAR 10 / USD 20 |
| `drilldown.test.ts`, 3 tests | 'Validated value' 1233.43, planned 1570.25, gap 0.214501, `empty` validated `zero`, rule key `dashboard.value.sum_validated`, all on revenue-uplift benefits (new engine: n/a) | Benefits → `margin_uplift`. Values unchanged (1233.43, 1570.25, 0.214501, zero). Rule key `dashboard.value.sum_validated` → **`dashboard.value.sum_validated_profit_and_cash`**, plus `headlineBasis: profit_and_cash` |
| `filters.test.ts` 'all six areas differ …' | planned 3000 → 1000 in Q1, validated 900, gap 0.7/0.1, red/amber on revenue (new engine: n/a) | Benefit → `margin_uplift`; values unchanged |
| `workspace-header.test.ts`, 2 tests | Empty header `benefits` without `headlines`; planned SAR 1000 / validated 400 on revenue (new engine: n/a) | Empty: `headlines: []` added. Benefit → `margin_uplift`; 1000/400 unchanged; new: `headlines` = profit_and_cash planned 1000 and validated 400 with their label keys |
| `finance-adoption.test.ts` 'class lines and headlines drill …' | Gross `drilldownHref` **null** (planned, validated) | → **`value.<state>` href without valueClass**. The drill sum 0 = gross 0, and the drill is n/a `no_profit_and_cash_benefit` with no item (the fixture is revenue only) |
| `finance-drilldown-k1.test.ts` 'gross line drills …' | Gross hrefs SAR planned/validated and USD planned **null**; only USD validated drilled | → **all four gross lines drill**, each drill sum = the line (75.05, 30.5, 0, 0), `headlineBasis: profit_and_cash` |
| `finance-drilldown-k1.test.ts` 'value.measured/rejected/sustained without a class …' | Five-class sums: measured SAR **1412.75**, rejected **40**, sustained **120**; value n/a `multiple_currencies`; rule key `dashboard.value.sum_<state>`; inputs `[total_SAR, total_USD]` | → profit-and-cash: measured **42.75**, rejected **0**, sustained **0**. Value = the SAR sum (USD holds revenue only). Rule key `…_profit_and_cash`. Inputs `[total_SAR]` |
| `finance-drilldown-k1.test.ts` 'the three metrics take a benefit subjectId' | subjectId = the revenue benefit, no class → 1 item | → with `valueClass=revenue_uplift`: 1 item. The margin subject without a class: 1 item. The revenue subject without a class: **no item, n/a `no_profit_and_cash_benefit`** |
| `finance-drilldown-k1.test.ts` fixture Y (scope sweep 'auditor sees Y') | Y's benefit was revenue uplift, so it was listed by the no-class drills | Y → `margin_uplift` (its figures 66666.6 / 55555.5 / 44444.4 unchanged), so the sweep can still fail |
| `tests/qa/…/a04-a05-a10-partials.test.ts` REQ-S13-003 | 'Validated value' **3000.75** on three revenue benefits (new engine: n/a) | Benefits → `margin_uplift`; 3000.75 unchanged |
| `tests/qa/…/a04-kpi-propagation.test.ts` REQ-S13-002 Q1 | The `value.planned` headline 3000 / 1000 (revenue benefit) | Reads the **`top_line`** `value.planned` headline: 3000 / 1000 unchanged. The profit-and-cash headline is n/a there |

No other test needed a change. These passed unchanged: `finance.test.ts`, `k1-value-class.test.ts`, `dashboards.test.ts`, `scope.test.ts`, `bu-scope.test.ts`, and the contract exercises (§3).

### 2.4 ARCH-R5 §6 readers, each one

| Reader | Outcome |
|---|---|
| `areas.ts` `valueArea` | changed (three bases) |
| `areas.ts` `valueGapStatus` | unchanged; it is now fed the profit-and-cash sums |
| `areas.ts` `lineEligible` | unchanged (count, monetisation and overlap rules kept) |
| `areas.ts` `valueLinesOf` | gains an optional `classes` argument (default five, so the old callers are unchanged) |
| `areas.ts` `valueCurrencies`, `FINANCIAL_VALUE_CLASSES` | unchanged (five classes define the currencies, as ARCH-R5 §7 says) |
| `engine.ts` `presentAreas` Value block | changed |
| `engine.ts` `benefitValidated` | unchanged: a per-benefit item value of the benefit's own class, not a sum across classes |
| `finance.ts` headlines | changed through `presentAreas`; pending basis null |
| `finance.ts` `hrefOf` / the N2 condition | removed: gross always drills |
| `executive-overview.ts` | no code change. Its areas and `transformations[].areaStatuses` come from `computeAreas`, so the Value status per row is now profit-and-cash (test 1: red; variant A: `not_applicable`) |
| `drilldown.ts` `valueDrill` | changed; the `asBuilt` branch is removed |
| `drilldown.ts` `benefitInClass`, `lineEntersClassSum` | unchanged functions, now called once per profit-and-cash class |
| `drilldown.ts` `value.gap` case | changed |
| `workspace-header.ts` | changed |
| API tests | `areas.test.ts`, `finance.test.ts`, `dashboards.test.ts`, `filters.test.ts`, `scope.test.ts`, `bu-scope.test.ts`, `finance-adoption.test.ts`, `drilldown.test.ts`, `finance-drilldown-k1.test.ts`, `k1-value-class.test.ts`, `p4-exercises-kbe-g.ts` and `workspace-header.test.ts` each run green. The changed ones are listed in §2.3 |
| QA tests | `a04-a05-a10-partials.test.ts` and `a04-kpi-propagation.test.ts`: changed (§2.3), green |
| Web (`ui.tsx`, `DashboardsPage.tsx`, `api.ts`, `dashboardFixtures.ts`, `dashboards.test.tsx`, `closure.test.tsx`, `WorkspaceHeader.tsx`, i18n) | FE-R5's; **not touched**. See §5 for the fixture typecheck consequence of the closing step |

### 2.5 Byte stability (response-transcript method; `evidence/ab/`)

**Method:**
- **A** = a copy of this tree in which every changed file was replaced by `git show HEAD:<file>` (each checked with `cmp`), with the new test removed and `@mth/shared` rebuilt. **B** = this tree.
- `ab/kbe-r6-transcript.test.ts` records **236 requests**, the same in A and B:
  - **five worlds:** X (all five classes, USD, an overlap hold, a valued CX benefit, every state), G (profit-and-cash only), R (revenue + avoided cost only), N (non-financial only) and E (no benefit). For each: T10, header, Finance, Overview;
  - **organization-wide:** the Overview, the Finance dashboard and the adoption dashboard;
  - a workstream dashboard;
  - **a fixed list of drill-downs:** 7 value metrics × (no class + 6 classes), plus `value.gap`, `value.investment`, `outcomes.area` and `finance.pending_validation`, each for X, G, R and the organization.
- **Normalisation:** the shared `response-transcript.ts` normaliser. The fixture transformations' random `TX…` codes are pinned to fixed codes, with their audit event, on both sides (the lists sorted by code were otherwise ordered differently per run).
- **Runs:** A exit 0; B exit 0 (`ab-run-A.log`, `ab-run-B.log`). `compare.py` (KBE-R5's, unchanged) gives the raw report `compare.txt`; `summary.py` classifies it into `summary.txt`.

**Result:**
- **0 responses are byte-identical.** Every dashboard headline and every drill-down gains `headlineBasis`, which the contract now requires on every response of these operations, so no response of these 7 operations can stay byte-identical.
- **184 responses differ only by the added members:** `headlineBasis` (null on non-value headlines, `investment` and `pending_validation`; the basis on value ones and on each drill-down) and `benefits.headlines`.
  - For 169 of them this holds under strict normalisation.
  - For the other 15 it holds once id placeholders are numbered per response. The profit-and-cash drill-downs list fewer benefits, which shifts the global first-appearance numbering of later ids. This is a numbering artefact, explained in `summary.py`.
  - Among the 184 are every `valueClass`-narrowed drill-down (K1, unchanged apart from the member), `value.investment`, `outcomes.area` and `finance.pending_validation`.
- **52 responses carry other changes, all of them value-basis members** (`summary.txt` lists every path, A → B):
  - **T10 / Overview / workstream** `areas[value].headlines` (length and order; e.g. X 10 → 22) and `.labelKey` (the A2 keys are replaced by the `_profit_and_cash` / `_top_line` / `_non_cash` keys);
  - **Value values:** e.g. X SAR planned 1477.55 → 77.55, validated 930.5 → 30.5; USD `value` → n/a `no_profit_and_cash_benefit`;
  - `areas[value].rag` `.status`, `.ruleKey` and `.ruleParams.lines[].gapRatio/status` (X SAR gap 0.370241 → 0.606705; USD 1/red → null/n/a; R red → n/a `no_profit_and_cash_benefit`), plus `ruleParams.headlineBasis`;
  - `transformations[].areaStatuses[value].status` on the Overview, Finance and adoption (R: red → `not_applicable`);
  - **header** `benefits.planned/validated[].value`;
  - **Finance** `headlines[]` (as T10) and `lines[gross,*].drilldownHref` (null → href);
  - **value-state drill-downs without `valueClass`** and `value.gap`: `value`, `items`, `evidence`, `calculation.ruleKey` (`…_profit_and_cash`) and `calculation.inputs`.

**Byte-identical:** no other member changes. The class lines and their hrefs, gross/net/cost totals, `value.investment`, every non-value area, every item list and all K1 class drill-downs are unchanged apart from the added member.

## 3. Checks run (real exit codes)

Environment: this worktree; Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline; `@mth/shared` rebuilt after the schema change; empty `.cc-writes` directories removed before the test runs. Logs are under `evidence/`.

| # | Check | Command | Result |
|---|---|---|---|
| 1 | Preceding gate (start, end) | `node tools/gates/validate.mjs --historical --stage DG3` | **exit 0** both times (`validate-dg3-historical.log`, `validate-dg3-historical-end.log`) |
| 2 | Reproduction, before | `QA_PG_PORT=26100 MTH_PORT_POOL=26101-26109 tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/reporting/headline-basis.test.ts` on unchanged source | **exit 1 as expected**, 7/7 failed; first failure `expected '435' to be '90'` (`01-repro-before.log`) |
| 3 | Affected suites, first run after the engine change | reporting + contract + qa a04/a10 files | exit 1: 13 failed, 172 passed. These are the tests that pinned the five-class headline, re-baselined in §2.3 (`02-affected-after-first.log`) |
| 4 | Affected suites, after re-baselining | same | **exit 0**, 22 files, 185/185 (`03-affected-after.log`) |
| 5 | Contract project, members required | `… with-pg.sh npx vitest run --project integration apps/api/test/integration/contract/` | **exit 0**, 2 files, 46/46 (`04-contract-required-pass.log`) |
| 6 | Contract project, temporary mutations (each reverted with `cp` and checked with `cmp`) | the same, with (a) `headlineBasis` dropped from every headline, (b) `benefits.headlines` dropped, (c) `headlineBasis` dropped from the drill-down | **exit 1 each, as required**: (a) "getTransformationDashboard 200 body violates the schema: data/areas/0/headlines/0 must have required property 'headlineBasis'" (`05-…`); (b) "getWorkspaceHeader … data/benefits must have required property 'headlines'" (`05b-…`); (c) "getDashboardDrilldown … data must have required property 'headlineBasis'" (`05c-…`) |
| 7 | Reproduction, after | as row 2 | **exit 0**, 7/7 (`06-repro-after.log`) |
| 8 | The reviewer's DOM-GROSS probe, after | `zz-domain-r2.test.ts` copied in for one run, then removed; `npx vitest run --configLoader runner --project integration` | **exit 0**, 4/4; logs profit-and-cash planned "90", no "435" (`07-reviewer-dom-gross-after.log`) |
| 9 | A/B transcripts | `ab/ab-commands.txt` | A **exit 0**, B **exit 0**, 236 responses each; `compare.py`/`summary.py` exit 0 (§2.5) |
| 10 | `pnpm -r typecheck` | | **exit 2 — FAILED, at `apps/web` only:** 10 errors, all in FE-owned `apps/web/src/pages/dashboards/dashboardFixtures.ts`, caused by the required members (§5.1) (`10-typecheck.log`). `pnpm -r --no-bail typecheck`: 6 of 7 projects pass (`design-tokens`, `shared`, `config`, `db`, `worker`, `api`); `web` fails with the same 10 errors (`10b-typecheck-no-bail.log`). With `evidence/web-fixtures-for-fe.patch` applied temporarily: web `tsc` (both configs) **0 errors** |
| 11 | `pnpm lint` | | **exit 0** (`11-lint.log`) |
| 12 | Prettier | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | **exit 0**, "All matched files use Prettier code style!" (`12-prettier.log`) |
| 13 | `pnpm openapi:lint` | | **exit 0**, `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 652 operations` (`13-openapi-lint.log`) |
| 14 | `pnpm -r build` | | **exit 2 — FAILED, at `apps/web` only** (its build runs `tsc` first; same 10 fixture errors) (`14-build.log`). `--no-bail`: 6 of 7 projects build (`14b-build-no-bail.log`) |
| 15 | `pnpm test`, locale unset | `env -u LANG -u LC_ALL -u LC_CTYPE pnpm test` | **exit 0**: first Vitest invocation 145 files, **2791/2791**; second 3 files, **259 passed, 2 skipped** (`21-unit-locale-unset.log`) |
| 16 | `pnpm test`, `C.UTF-8` | `LC_ALL=C.UTF-8 pnpm test` | **exit 0**: 145 files, **2791/2791**; 3 files, **259 passed, 2 skipped** (`22-unit-c-utf8.log`) |
| 17 | Integration, first attempt | `QA_PG_PORT=26120 MTH_PORT_POOL=26121-26149 tests/qa/support/with-pg.sh pnpm test:integration`, log written **under `docs/delivery/`** | **ABORTED by me** after `a08-gate-controls.test.ts` "REQ-S04-008: a product G6 approval … changes nothing under docs/delivery/" failed. That test hashes every file under `docs/delivery/`, and my growing log was one of them. Not a product failure. Partial log kept: `31a-integration-ABORTED-log-written-under-docs-delivery.log`. The `pkill` that stopped it also ended my own shell (exit 143) |
| 18 | Integration, full | the same, log under `$TMPDIR` and copied afterwards; nothing written under `docs/delivery/` during the run | **exit 0**: **206 files, 1960/1960**, 1221 s (`31-integration.log`). **Pinned-count change:** 1953 (round-2 QA) → **1960**; the +7 are the new `headline-basis.test.ts`. No timeout, no retry, no flaky test |

Not run: e2e (not in this assignment's acceptance).

## 4. Operations routed (delta to my pending list)

- **Operations:** none added or moved. `P4_PENDING_ARCH_R5` was and is `[]`; ARCH-R5's repair adds no operation, and the operation count stays 652.
- **Members:** `P4_PENDING_ARCH_R5_MEMBERS`: 3 → **0**. Removed:
  - `DashboardHeadline.headlineBasis`: `getTransformationDashboard`, `getWorkstreamDashboard`, `getExecutiveOverview`, `getFinanceDashboard`, `getAdoptionDashboard`, `getWorkspaceHeader`;
  - `DashboardDrilldown.headlineBasis`: `getDashboardDrilldown`;
  - `WorkspaceHeader.benefits.headlines`: `getWorkspaceHeader`.
- Each is exercised by the existing `p4-exercises-kbe-g.ts` calls of those operations, which are now validated with the members `required`. No exercise needed adding.

## 5. Contract or schema needs, for the orchestrator

1. **The closing step breaks the FE-owned web fixtures (a contradiction in the assignment; raised, not guessed around).**
   - **What breaks:** dropping the three `.optional()` calls (D-120, required by this assignment) makes `apps/web/src/pages/dashboards/dashboardFixtures.ts` fail `tsc`, with 10 errors (missing `headlineBasis` / `headlines`). So `pnpm -r typecheck` and `pnpm -r build` exit 2 in this tree, at `apps/web` only. Every other package typechecks and builds (`--no-bail` runs: 6 of 7 pass).
   - **Why I did not fix it:** the file is FE-owned ("neither owns the other's files"), and the acceptance asks for exit 0. I can't satisfy both.
   - **The fix:** I wrote and **verified** the fixture patch: `evidence/web-fixtures-for-fe.patch`, 10 added lines and 1 replaced line, `headlineBasis` on each fixture headline and drill-down, `headlines: []` in the two header fixtures.
     - With it applied (temporarily, then reverted with `cp`, so `git diff -- apps/web` is empty), `tsc -p tsconfig.json` and `tsc -p tsconfig.e2e.json` gave 0 errors.
     - `vitest --project unit-web apps/web/src/pages/dashboards`: 27/27.
     - Prettier: clean.
   - **Options:** FE-R5's own fixtures may already carry the members. If not, apply this patch at integration. Alternatively, revert only my three zod lines until FE-R5 lands; the `openapi.yaml` `required` edits alone already make the contract test enforce the members (§3, the mutation runs).
2. **Stale description text** (I was told to change nothing else in either file):
   - the `openapi.yaml` descriptions of `DashboardHeadline.headlineBasis`, `DashboardDrilldown.headlineBasis`, `WorkspaceHeader.benefits` and the info paragraph still say "Not yet required: pending in p4-pending-arch-r5.ts";
   - so do the zod comments for `dashboardHeadline`, `dashboardDrilldown` and `workspaceHeader.benefits`.
   
   A one-line text edit for the solution-architect.
3. **Design gaps I implemented one way. Please confirm or redirect; the ADR is silent on each.**
   - **(a) Finance gross with no profit-and-cash benefit.** In a currency with no profit-and-cash benefit (e.g. revenue-only USD), the Finance **gross line stays a known zero**, as ADR-0030 N1 kept it ("gross, net and cost unchanged"). The profit-and-cash headline beside it is `not_applicable`. The gross drill-down (now always given) is n/a `no_profit_and_cash_benefit` with no item, so its sum (0) still equals the line. The ARCH-R5 contract says headline = gross "where both exist". I did not change gross/net, because that would change the D-117 lines; the domain reviewer recorded `DOM-GROSS-ONLYREV` as gross 0.
   - **(b) Currency on the new n/a values.** The `no_profit_and_cash_benefit` n/a values carry their **currency**, for both the state headlines and the gap, so a multi-currency screen can say which currency is n/a. The existing `nothing_planned` gap n/a keeps `currency: null`, unchanged.
   - **(c) The header without a benefit.** `benefits.headlines` is `[]` when the value status is `no_benefit` (state `unknown`), like `planned`/`validated`.
   - **(d) Portfolio ranking.** The Portfolio area's 'planned value allocated' ranking still uses the five financial classes. N3 does not list it as a value headline, and it is byte-stable.
   - **(e) A top-line subject without a class.** A `subjectId` drill-down of a top-line or non-cash benefit **without** `valueClass` is n/a `no_profit_and_cash_benefit` with no item. It is reachable with its `valueClass`.

## 6. What remains

- The web fixture typecheck (§5.1) needs FE-R5's fixtures or the provided patch at integration. Until then `pnpm -r typecheck` / `pnpm -r build` exit 2 in this tree, at `apps/web` only.
- The stale "Not yet required" text (§5.2).
- **Not run:** e2e (not in this assignment's acceptance). The web screens and EN/AR labels are FE-R5's. Until FE-R5 lands, the web still has the retired A2 label keys in its catalogue, and the new keys the API now sends may render as raw keys.

## 7. Merge instructions

- **No migration.** Rebuild `@mth/shared` after the merge (`pnpm --filter @mth/shared build`).
- **Conflicts to expect:** none with FE-R5 in file terms; I touched no web file. `dashboardFixtures.ts` must carry the members (§5.1) for the web to typecheck.
- **Check after merging both:** `pnpm -r typecheck`, `pnpm -r build`, `pnpm test`, and the contract project.
