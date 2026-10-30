# Handback T-DG6-KBE-B: explanation view models (kpi-benefits-engineer)

- **Stage:** DG6 (P6 "Integration and system hardening"), BUILDING. Section: `docs/architecture/p6-work-split.md` §I/K.2.
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG6-T-DG6-KBE-B-kpi-benefits-engineer-20261029T232538Z-a071c620","session_id":"a071c620-0fae-4a79-b0d8-835f68e16fe0"}`.
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-KBE-B.md`, sha256 `70e9e1ac15cabc3ca80e9e32958f89c79f1754aed81b011301b9d2387c910dce` (verified).
- **Base:** branch `dg6/kbe-b` at `50e0242403b77c9508f23f53324b5976329420df`, clean tree at start. The changes are **uncommitted**, as instructed.
- **Time:** started `Thu Oct 29 23:26:03 UTC 2026`; the end time is in the "Time" section at the end.
- **Engineering only:** these are view models. They grant no business, Finance or IT approval. Product gate G6 never implies DG7. The fixtures are synthetic.

## 1. Changed files

| File | Purpose |
|---|---|
| `packages/shared/src/explain/weighted-score.ts` (new) | E1 `explainWeightedScore(sheet, weightSet)`: one row per criterion in weight-set order (score, weight, contribution = score × weight ÷ 100, 4 decimals, exact). Their sum is checked against the shared `weightedScore()` and the server's `result.weightedScore`. Incomplete gives no contributions and lists the missing criteria. Another weight-set version gives Unknown. |
| `packages/shared/src/explain/benefit-realized.ts` (new) | E2 `explainBenefitRealized(values, kpiActual?)`: three groups, validated / sustained / pending (= `submitted`), each with its lines, periods, count and the server's total. There is no combined total. A line without an amount makes its group Unknown. A group without lines is `no_lines`. A total that its lines contradict is Unknown. n/a carries `benefitsP4.value.naLong`. A non-financial benefit gets its KPI actual (known / unknown / stale / n/a). |
| `packages/shared/src/explain/financial-metrics.ts` (new) | E4 `explainFinancialMetrics(cashFlows, metrics)`: per-period rows (net, discount exponent, discount factor, discounted net, cumulative net, payback marker) and totals. It calls the shared `checkCashFlows` and `computeFinancialMetrics` and must match the server. States: disabled, incomplete, unknown (revision, currency or inputs). |
| `packages/shared/src/explain/health-score.ts` (new) | E5 `explainHealthScore(check, scheme)`: answered / 25, unanswered codes, applicable count, per-response count, credit and points, Σ points. It calls the shared `healthAssessmentResult` and must match the server's score, maximum and band. States: incomplete, not_computable (all N/A), unknown (scheme missing, wrong version or inputs inconsistent). |
| `packages/shared/src/explain/index.ts` (new) | Re-exports the four modules. |
| `packages/shared/src/explain/explain.test.ts` (new) | 25 tests with hand-computed worked fixtures, plus a 2,000-case deterministic property test for E1. |
| `packages/shared/src/calc.ts` | One export line (plus its comment line): `export * from "./explain/index.ts";`. |
| `docs/delivery/handbacks/DG6/T-DG6-KBE-B-kpi-benefits-engineer.md`, `docs/delivery/handbacks/DG6/T-DG6-KBE-B-evidence/*` | This handback and its logs. |

I touched nothing outside my ownership (`packages/shared/src/explain/**`, one line in `calc.ts`). The formula engine (`packages/shared/src/formula/**`), `scoring.ts`, `finance/metrics.ts` and `health/scoring.ts` are unchanged (rule 9).

## 2. Behaviour delivered, per requirement

**REQ-S15-014**: acceptance (verbatim): *"A05;A20: the weighted score and benefit realized value show plain-language explanations in en and ar; non-admin screens show no stack traces or infrastructure terms"*. Procedure: *"Every calculated value offers an explanation panel with inputs, formula in words and period; technical details are shown only on admin screens"*.

KBE-B delivers the **decimal-safe view models** these panels display (§I/K.2), so the web never computes a business number. The panels themselves, their en/ar words and the term scan belong to FE-F and QA-D. **The requirement is therefore not complete with this task alone** (§I/K.10: "each needs its implementer work and QA-D").

- **Inputs, period and version:** every model returns the panel's input rows plus its period/version fields:
  - E1: `weightSetVersionNo`, `computedAt`;
  - E2: each line's `periodStart`/`periodEnd`, the first and last period per group and overall;
  - E4: cash-flow `revision`, `periodBasis`, `timing`;
  - E5: `assessmentDate`, `schemeVersionNo`, `scoringAssumption`.

  Each model also returns `messageParams` for FE-F's `explanations.*` keys.
- **The decimal and Unknown rules (ADR-0061 §8):**
  - Every displayed number is the server's decimal string, or an exact decimal.js breakdown that is checked against it.
  - A breakdown that disagrees with the server value never appears. The state becomes `unknown` with an `explain.*` reason instead.
  - Incomplete, `no_lines`, not_computable and n/a are explicit states and never `"0"`.

Section tests (§I/K.2), each covered in `explain.test.ts`:

| Required test | Covered by |
|---|---|
| E1's contributions sum exactly to the server's `weightedScore` for the 25/25/20/15/15 default and two other weight sets | `default 25/25/20/15/15` (4,3,5,2,3 → 1.0000+0.7500+1.0000+0.3000+0.4500 = 3.5000); `six-criterion set` (30/20/12.5/12.5/15/10 → 3.4750); `two-criterion set` (33.33/66.67 → 2.9999, exact); plus 2,000 generated sets against the shared `weightedScore()` |
| an incomplete score gives no contributions and lists the missing criteria | `an incomplete score gives no contributions…` (every `contribution` null, `missingCriteria` = customer_impact, feasibility; no `"0"` anywhere in the model) |
| E2 never adds validated, sustained and pending | `never adds…` (no partial or full sum appears in the serialized model; no top-level `total`; planned, forecast, measured and rejected excluded) |
| a line without an amount makes its total Unknown, never 0 | `a line without an amount…` (also when the server total claims `"0.0000"`) |
| E4 reproduces `computeFinancialMetrics` for its fixtures (no second NPV) | `reproduces computeFinancialMetrics…` (7 fixtures; NPV, NPV exact, ROI, payback and reasons all equal). Hand-worked: 10 % end of period, NPV 37.57, ROI 0.200000, payback at index 2; beginning of period, NPV 41.32 |
| E5 gives no score while any question is unanswered | `gives no score and no band while any question is unanswered` (24/25 → incomplete, `unanswered` = q25; a server that claimed a score is Unknown) |

## 3. Differences between the E4/E5 words of ADR-0061 §8 and the code (reported, code not changed)

I checked the words against `packages/shared/src/finance/metrics.ts` (ADR-0047 §5), `apps/api/src/modules/benefits/financial-metrics.ts` and `packages/shared/src/health/scoring.ts` (ADR-0048 §5–§6). FE-F should resolve these with the architect or orchestrator before it writes the keys.

**E4 (NPV, ROI, payback):**
1. **Payback has a third outcome the words omit.** The words give "not reached" only. The code also returns **`not_computable`** when there is no outflow and when the cumulative net is never negative ("nothing to pay back"). The contract's `paybackReason` carries both.
2. **Out-of-range values.** NPV beyond the contract's 18 integer digits returns `out_of_range` in the shared function, and the API maps it to `npvReason: "not_shown"`. ROI beyond range becomes `not_computable`. The words don't cover this. The E4 model applies the same mapping when it compares.
3. **Rounding and units are not in the words.**
   - NPV is computed at precision 40 and rounded once to 2 decimals (HALF_UP).
   - ROI is a **fraction** rounded to 6 decimals (`0.200000` = 20 %). The words say "ROI = (… − …) ÷ total outflows", which is right, but a panel must not show `0.2` as "0.2 %".
   - Payback is a **0-based period index**. The words say "the first period"; the display must say which numbering it uses.
4. NPV exponent ("counted from 0 for beginning-of-period timing and from 1 for end-of-period timing"): **matches** the code (`e = t` or `t + 1`). ROI "undiscounted; not computable without outflows": **matches**.

**E5 (health check):**
1. **All N/A.** The code gives no score when all 25 are answered but none is applicable (`computable: false`). The words only say "while any question is unanswered there is no score". The E5 model has a separate `not_computable` state for this.
2. **Partial credit.** Schemes may carry a `partial` response with a credit strictly between 0 and 1 (`0.xx`). The words describe scheme 1 (Yes = 1, No = 0) and "the points of the answers", which is consistent, but they don't name partial credit.
3. **Rounding and format.** The score is rounded to 2 decimals (HALF_UP). A whole score is shown without `.00` ("17", "62.50"). Percent of applicable = 100 × Σ credit ÷ applicable, where applicable excludes N/A. The words don't state the rounding.
4. **Band.** The code picks "the band with the highest minScore not above the score". The words say "the scheme's range that contains the score". These are equivalent because the publish rule requires a band at 0. **Not a defect.**

E1's words match `scoring.ts` (Σ score × weight ÷ 100; the 0–100 view (w − 1) ÷ 4 × 100; incomplete never 0). E2's words match `benefits/values.ts` `seriesTotal` (states never added; Unknown when a line has no amount; n/a for an unmonetised benefit). One addition: an empty group, where the server returns a known `"0.0000"` with count 0, is shown as `no_lines`, per ADR-0061 §8 "a value without lines shows the designed incomplete state, never 0".

## 4. Checks (real exit codes; logs in `docs/delivery/handbacks/DG6/T-DG6-KBE-B-evidence/`, summary in `exits.txt`)

Environment: Node 24.21.0, offline, worktree `/home/user/wt/dg6-kbe-b`. The host was heavily loaded by parallel agents (load average about 27).

| Command | Exit | Result / log |
|---|---|---|
| `node tools/gates/validate.mjs --historical --stage DG5` (at start) | 0 | `PASS gate DG5 (historical)` |
| `pnpm -r typecheck` | 0 | `typecheck.log` |
| `pnpm -r build` | 0 | `build.log` |
| `pnpm lint` | 0 | `lint.log` (`eslint . --max-warnings=0`) |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown`, run 1 | **123** | `prettier-run1.log`: 2 of my new files (`explain.test.ts`, `health-score.ts`) were not formatted |
| same, run 2, after `npx prettier --write packages/shared/src/explain/*.ts` | 0 | `prettier.log` (all 16 batches "All matched files use Prettier code style!") |
| `pnpm --filter @mth/shared typecheck && … build`, and `eslint packages/shared/src/explain packages/shared/src/calc.ts`, after the reformat | 0, 0 | `shared-recheck-after-format.log` |
| `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 932 operations` (unchanged) |
| `npx vitest run --project unit-node packages/shared/src/explain` (development run) | 0 | 25/25 |
| `pnpm test`, locale unset (`env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE`) | see §4.1 | `test-locale-unset.log` |
| `pnpm test`, `LANG=C.UTF-8 LC_ALL=C.UTF-8` | see §4.1 | `test-c-utf8.log` |
| `QA_PG_PORT=25150 MTH_PORT_POOL=25151-25199 tests/qa/support/with-pg.sh pnpm test:integration` | see §4.1 | `test-integration.log` |
| `node tools/gates/validate.mjs --historical --stage DG5` (at end) | see §4.1 | `validate-dg5-historical-end.log` |

Disclosures:

- The first `typecheck + build` shell wrapper reported exit 1. That came from my own invalid `tail -3 file1 file2` after both checks had written `typecheck exit=0` and `build exit=0`; it is not a check failure. Typecheck and build were then repeated for `@mth/shared` after the reformat (exit 0).
- Before the tests I removed three empty `.claude/.cc-writes` folders under `packages/shared/` (assignment, Environment).

### 4.1 Test results (acceptance items 2–4): **items 2 and 3 are NOT met on this host. Disclosed in full.**

The host ran several agents in parallel. Load average was 26–37 throughout (`uptime` at 00:31, 00:55 and 00:59 UTC). Every failure below is a timeout (the default 5 s, a 30 s or 60 s test timeout, or a `findBy*` wait), and the set of failing tests changes between runs. I am not calling them passed. I am also not attributing them to my change without evidence; the evidence is the control run below.

**`pnpm test`, locale unset** (`test-locale-unset.log`): **exit 1**.

| Vitest invocation | Files | Tests |
|---|---|---|
| unit-node | 172/172 passed | **2655/2655 passed** (includes the 25 new `explain.test.ts` tests) |
| unit-web | 4 failed, 94 passed (98) | **5 failed**, 1782 passed (1787) |
| unit-formula-nocodegen | 3/3 passed | 259 passed, 2 skipped (261) |

The 5 unit-web failures:
- `ExecutionPanel.test.tsx` (ar) "an answer outside the contract is the panel's error state";
- `portfolio.test.tsx` "creates a draft at any time";
- `traceability.test.tsx` "workstreams list WS-nn codes…" (en and ar);
- `transformations.test.tsx` "effective permissions refresh after create" (ar).

All are `findBy*`/`waitFor` misses at 6–8 s, alongside `[vitest-worker]: Timeout calling "onTaskUpdate"`.

- **Re-run of those 4 files alone** (`test-unset-web-rerun-4-files.log`): **exit 1**, 4 failed / 93 passed. The set differs: ExecutionPanel now passes, and the English transformations test fails instead.
- **Control** (`test-unset-web-4-files-CONTROL-without-kbe-b-export.log`): the same 4 files with `packages/shared/src/calc.ts` reset to `HEAD`, so nothing in the web graph reaches `explain/`. **Exit 1, 6 failed / 91 passed**, including a 22 s portfolio test and a 16 s F-DG1-004 test. The failures occur without my change, at the same or a higher rate, so they are environmental. My line was restored immediately afterwards (`tail calc.ts` shows it). These web pages don't import `explain/**`.

**`pnpm test`, `C.UTF-8`** (`test-c-utf8.log`): **incomplete.** The background command was stopped at its 1-hour limit while unit-web was still running. The unit-web and unit-formula-nocodegen invocations therefore have **no result** under C.UTF-8.

- **unit-node: 6 files failed, 166 passed (172); 7 tests failed, 2648 passed (2655).** All are timeouts:
  - `architecture.test.ts` (dependency direction, 60 s);
  - `server.test.ts` ×2 (route registration);
  - `reporting/branding-layout.test.ts` (PDF);
  - `formula/fuzz.test.ts` (20,000 strings);
  - `kpi.test.ts` and `reporting.test.ts` (module boundary scans).

  Every one of them passed in the locale-unset run 40 minutes earlier.
- **Re-run of those 6 files alone under C.UTF-8** (`test-cutf8-node-rerun-6-files.log`): **exit 1, 2 failed / 310 passed.** Still failing: `server.test.ts` "declares access on every /api route…" (6.1 s against the 5 s default) and `architecture.test.ts` "apps/web never imports @mth/db…" (36.7 s). Both are timeouts. Both are whole-repository scans, and neither involves `explain/**`.

**Integration** (`QA_PG_PORT=25150 MTH_PORT_POOL=25151-25199 tests/qa/support/with-pg.sh pnpm test:integration`, `test-integration.log`): **stopped by the 90-minute background limit** (started 00:31:24 UTC, stopped about 02:01 UTC). It never finished, so there is **no exit code and no Vitest summary**. The counts below come from the per-test lines in the log: **1,574 tests passed and 13 failed** before the stop.

- **6 timeouts:**
  - the contract test "an undeclared request media type is a declared 400" (30 s, twice);
  - REQ-S14-001 "scores 21, 16, 10 and 9 map to the four B0152 texts" (30.5 s);
  - `form_export.too_large` 5000/5001 rows (60 s);
  - bulk-edit commit-time re-authorization (30 s);
  - `report.too_large` 5,001 rows (120 s).
- **7 assertion failures, not timeouts.** I have NOT shown these to be environmental, and I'm not calling them flakes:
  - `apps/worker/test/integration/adoption-below-trajectory.test.ts` "the event-to-queue registry (D-102)…": `connector.run_failed: expected 'integrations.connector_exception' to be 'automation.evaluate'` (12 ms);
  - `apps/worker/test/integration/operations-freshness.test.ts` "version 1 is unchanged published history…; version 2 is effective with the three triggers" (16 ms) and "a KPI older than staleAfterDays → one data_stale exception…" (157 ms), both deep-equal mismatches;
  - search "matching (ADR-0057 §1, §3)": "an Arabic query finds an Arabic title; a code query finds the code" (`expected [] to deeply equal [ Array(1) ]`) and "recordType … includeArchived …" (`expected true to be false`);
  - search "freshness: indexedThrough, stale, 503": "fresh after a feed run…" (`expected true to be false`);
  - contract "P5 BE-J operations (p5-exercises-be-j.ts)": `expected [] to have a length of 1 but got +0`.

  **What I can and can't say:** KBE-B changes only `packages/shared/src/explain/**` (new, pure, no I/O) and one export line in `calc.ts`. It touches no API, worker, database, outbox or search code, and none of these modules imports `explain/**`. The first failure looks like the event-registry seam between the merged BE-K and BE-L (`connector.run_failed` routed to `integrations.connector_exception`), which D-004 assigns to the orchestrator at merge. The search and freshness assertions can also fail when a scan or feed misses a timing window under load. **I did not run a control** (the same files at `HEAD`, without my change), because the run was stopped after the 2-hour limit. **Recommended:** run `QA_PG_PORT=… tests/qa/support/with-pg.sh npx vitest run --project integration apps/worker/test/integration/adoption-below-trajectory.test.ts apps/worker/test/integration/operations-freshness.test.ts <the search integration test> apps/api/test/integration/contract/contract.test.ts` once at `50e0242` and once with this change.

KBE-B adds no integration test, no route, no migration and no pinned count. **Pinned-count change: none** (932 operations).

**`node tools/gates/validate.mjs --historical --stage DG5`, at the end** (`validate-dg5-historical-end.log`): **exit 0**, `PASS gate DG5 (historical)`.

## 5. Operations routed (pending-list delta)

**None.** KBE-B routes no operation. ADR-0061 §8 confirms "No new API operation is needed", and §I/K.0 says "No `explanations/{kind}/{id}` operation". There is no `p6-pending-kbe-b.ts` and no `p6-exercises-kbe-b.ts`. Pinned counts are unchanged: 932 operations; no media-type, rate-limit or CSRF change.

## 6. Contract, schema, migration or dependency needs (for the orchestrator)

- **None.** No contract or schema change, no migration, no new dependency (decimal.js and vitest only, both existing). The input types are structural subsets of the existing zod mirrors (`InitiativeScoreSheet`, `WeightSet`, `BenefitValues`, `BenefitKpiActual`, `BusinessCaseCashFlows`, `FinancialMetrics`, `HealthCheck`, `HealthCheckScheme`). The parsed responses pass straight in.
- **For FE-F (consumer notes):**
  - Use the functions from `@mth/shared/calc`: `explainWeightedScore`, `explainBenefitRealized`, `explainFinancialMetrics`, `explainHealthScore`.
  - E1 needs the active weight set alongside `getInitiativeScores`.
  - E2 needs `getBenefit` → `realized.kpiActual` for non-financial benefits.
  - E4 needs both `getBusinessCaseCashFlows` and `getBusinessCaseFinancialMetrics`.
  - E5 needs the assessment's scheme version from the scheme list (matched on `schemeVersionId`).
  - **New i18n reasons the panels will need to translate (FE-F's `explanations.json`):** `explain.weight_set_missing`, `explain.weight_set_version_mismatch`, `explain.inputs_inconsistent`, `explain.series_missing`, `explain.revision_mismatch`, `explain.currency_mismatch`, `explain.scheme_missing`, `explain.scheme_version_mismatch`. The existing `benefit.value_amount_missing` and `benefitsP4.value.naLong` are reused.
  - Proposed English, for FE-F to adopt or adjust: "The explanation is not available: the weight set could not be loaded." / "…: the weight set version differs from the one used." / "…: the inputs do not match the calculated value." / "…: this value series is missing." / "…: the cash flows changed since the metrics were calculated." / "…: the currency of the cash flows differs." / "…: the scoring scheme could not be loaded." / "…: the scoring scheme version differs." Arabic: provisional, by FE-F.

## 7. User-facing texts made untrue

**None.** I changed no user-facing string. A search of `apps/web/src/i18n/en/*.json` for explanation texts that say planned, later, coming, P6 or P7 found none. The panel words (E1, E2, E4, E5) are new keys owned by FE-F (§I/K.3). §3 above lists what FE-F must reconcile for E4/E5.

## 8. What remains

- **REQ-S15-014 is not complete:** FE-F (panels E1, E2, E4, E5 in en/ar on these view models, with component tests) and QA-D (A05/A20 panels; the infrastructure-term scan on non-admin screens) are still to do.
- **The E4/E5 word differences of §3** need a decision (architect or orchestrator) before FE-F writes the keys. I made no code change, as instructed.
- **Verification not completed on this host (§4.1):**
  - acceptance item 2: unit-web under locale unset has 5 timeout failures, which also occur without my change (control run). Under C.UTF-8, unit-node has 7 timeouts and unit-web and nocodegen were cut off at the 1-hour limit;
  - acceptance item 3: the integration run was stopped at its 90-minute limit. 1,574 passed and 13 failed: 6 timeouts and **7 assertion failures in worker, search and contract tests that this task doesn't touch, but that are not yet shown to pre-date it**. The control run in §4.1 is recommended before merge.

  The orchestrator should re-run `pnpm test` (both locales) and `test:integration` on the merged tree when the host is less loaded. If any failure reproduces there, it is a finding, not a flake (D-201 rule).

## 10. Time

Started `Thu Oct 29 23:26:03 UTC 2026`. The handback was finalized at about 01:13 UTC on 30 Oct (about 107 minutes in, inside the 2-hour limit). The implementation was finished; the remaining time went to verification runs slowed by host load.

## 9. Merge instructions

No migration and no ordering constraint. The only shared-file line is `packages/shared/src/calc.ts` (one export line appended at the end). Expect at most an append conflict if another task also appends to `calc.ts`; keep both lines.
