# T-DG5-KBE-H handback: the International Roaming dataset's numbers (kpi-benefits-engineer)

- **Stage:** P5, gate DG5 (BUILDING). Task T-DG5-KBE-H, p5-work-split §J.3. Wave W14 (D-159).
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG5-T-DG5-KBE-H-kpi-benefits-engineer-20261016T070351Z-f5213dab","session_id":"f5213dab-957f-4b16-851c-85be23de5252"}`.
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-KBE-H.md`, sha256 `aa606f550a4bf4d8498079bf9d4a5dc70ff1d2512656fa0fba43bbcf30cd2fb7` (checked).
- **Base:** branch `dg5/kbe-h` at `b2d030f3e82c9b0c61b5f0d8256f575371446d3f`. Changes are **uncommitted**, as asked.
- **Time:** start `2026-10-16T07:04:05Z`, end `2026-10-16T09:21:00Z` (`date -u` at both). This is about 2 h 16 min, past the ~2 h limit: I let the required full integration run finish (it took 39 min under load) and then re-ran the C.UTF-8 unit suite at low load (§3).
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG4` printed `PASS gate DG4 (historical)`, exit 0, at the start; re-run at the end: "PASS gate DG4 (historical)", exit 0 (`validate-dg4-historical-end.log`).
- **Engineering agent only.** Nothing here grants a real business, Finance or IT approval. Every Finance decision and trajectory approval in the dataset is a synthetic decision by a demo user and says "Synthetic demonstration - approves nothing real". Product gate G6 never implies DG7.

## 1. Files changed (all new; nothing existing was edited)

| File | Purpose |
|---|---|
| `packages/db/src/demo/data/kpis.ts` | The id scheme (`01995000-4<block>-…`), `DEMO_ANCHORS` (the ids of BE-T's records these numbers hang on), the synthetic-clock helper `when`, the guarded-update helper `seedUpdate`, the four monthly reporting periods, the three chain KPIs (definition, P4 version, RAG thresholds, approved target trajectory), and `KPIS_MODULE` (order 400). |
| `packages/db/src/demo/data/actuals.ts` | Nine accepted actuals (three KPIs × June–August 2026), each with its value version, direct-accept review, calculation run, period-basis and cumulative-basis evaluation; the **stale KPI** and its `stale` data-quality finding; June and July closed; `ACTUALS_MODULE` (410); the coverage count `countStaleKpis`. |
| `packages/db/src/demo/data/business-cases.ts` | The three T09 formulas BF-01…03, one version each with typed variables; the transformation-level business case BC-01 (all ten B0085 sections) with three benefit lines and four investment lines; `BUSINESS_CASES_MODULE` (420). |
| `packages/db/src/demo/data/benefits.ts` | The benefit register B01–B03 (three chain benefits, three distinct financial classifications), lifecycle steps, enablers, the **shared benefit** allocation, planned and forecast series, three KPI-bound measurements with calculation lineage; `BENEFITS_MODULE` (430); the coverage count `countSharedBenefits`. |
| `packages/db/src/demo/data/finance.ts` | Finance validation of the formula versions and two baselines, the three Finance queue items, two synthetic approvals and the **pending Finance validation**; `FINANCE_MODULE` (440) and `KBE_H_DATASET_MODULES` (the five modules, for BE-T to list). |
| `packages/db/src/demo/data/dataset-helpers.test.ts` | Unit tests (no engine, no database): ids, synthetic-clock instants, the rounding record, the YTD window, module order. |
| `packages/db/test/demo-numbers-engine.ts` | Test support: the DG3/DG4 engines applied to the dataset's inputs, exactly as the worker and API compute them. |
| `packages/db/test/demo-roaming-anchors.ts` | Test-only stand-ins for BE-T's anchor records (organization, business unit, six demo users, the transformation, three initiatives) with the `DEMO_ANCHORS` ids. Never part of `DEMO_DATASET_MODULES`. |
| `packages/db/test/integration/demo-numbers-spec.test.ts` | Spec-level tests: every literal number recomputed with the engines, worked fixtures, the dataset rules (no database; it imports the engine, so it must live outside `packages/db/src`). |
| `packages/db/test/integration/demo-numbers.test.ts` | Database tests: seed through BE-S's seed transaction, the two coverage conditions, recomputation from the stored rows, value states per class, determinism. |
| `docs/delivery/handbacks/DG5/T-DG5-KBE-H-*` | This handback and its evidence logs. |

Ownership: the five data files are §J.3's. The tests and test support are this task's own (p5-work-split §1, "Every task also owns its tests"). `data/index.ts` and `coverage.ts` are BE-T's and are **not** edited (see §6).

## 2. Behaviour delivered

### REQ-S18-002 (with BE-T): the KPI and benefit numbers of the coverage-complete demo dataset

Acceptance text (`requirements.csv`): "A01;A02: a seed-coverage test finds at least one record for each of T01-T16, G1-G6, the six phases, ten TOM dimensions and six dashboard areas, plus one each of: stale KPI, overdue decision, shared benefit, adoption gap, BAU handover, missing evidence, pending approval". Procedure: "The seed script creates linked records, never unrelated sample cards, and a check verifies each listed condition exists".

§J.3 assigns this task the numbers: "KPI definitions, versions and actuals with one **stale** KPI; the benefit register with a **shared benefit** allocated to two initiatives, and the three chain benefits with distinct financial classifications (M0346); business cases; a pending Finance validation", with the rules "every number is a decimal string and synthetic; value bases are never mixed; Unknown and Stale are never 0", and the tests "the KPI and benefit conditions of `coverage.test.ts` (with BE-T), and recomputed values that equal the seeded values".

What the dataset holds (every number synthetic, B0144; decimal strings; percentages as fractions):

- **KPIs, one per B0147 chain**, monthly, ratio nature with the `weighted_ratio` rule (never an average of percentages), version 1 active, approved linear trajectory (approved by the demo Sponsor, never its creator):
  - K1 Roaming attach rate (higher is better; configured relative thresholds 0.05 / 0.10): June 0.195 green, July 0.2025 green, August 0.19 **amber** (expected 0.21).
  - K2 Roaming complaint rate (lower is better; no configured threshold, so the documented defaults apply): June 0.033 green, July 0.033 green, August 0.035 **red** (expected 0.030).
  - K3 Partner wholesale cost per MB (SAR/MB, lower is better; configured absolute thresholds 0.0003 / 0.0008 SAR): June 0.012 green, July 0.011 green.
  - **The stale KPI:** K3 August, 0.01065 SAR/MB, entered from the latest partner settlement available (data as of 2026-06-30), 63 days before its business date 2026-09-01, more than its 45 days. The value is kept and labelled Stale, the calculated RAG is **Stale** (never green, never 0), and the run records an open `stale` data-quality finding.
  - Each accepted actual has the run the worker writes (trigger `actual_accepted`) with **two** evaluations: the period basis, and the cumulative (YTD) basis. The cumulative value is the weighted ratio Σ numerators / Σ denominators (e.g. attach rate July YTD (39,000 + 43,740) / (200,000 + 216,000) = 0.198894, not the 0.19875 average). Its RAG is **Unknown**, because no cumulative trajectory is approved; expected and variance stay NULL.
- **Business case and T09 formulas** (BC-01, transformation level, all ten B0085 sections):
  - BF-01 revenue uplift, "Δ attach × customers × ARPU": `(measured_attach_rate - baseline_attach_rate) * travelling_customers * pass_arpu`. The preview at target is 594,000 SAR per month.
  - BF-02 avoided care cost: `(baseline_complaint_rate - measured_complaint_rate) * travelling_customers * cost_per_complaint`. The preview is 132,000 SAR per month.
  - BF-03 margin improvement, "volume × Δ unit cost": `roaming_data_mb * (baseline_cost_per_mb - measured_cost_per_mb)`. The preview is 160,000 SAR per month.
  - Benefit lines at the annual run-rate (12 × preview), one class each: revenue uplift 7,128,000; avoided cost 1,584,000; margin uplift 1,920,000 SAR. Investment lines, kept apart by basis: cash 3,660,000 SAR (capex 2,400,000, opex 360,000, vendor cost 900,000) and non-cash 1,170,000 SAR (6.5 internal FTE). Gross benefit, implementation cost and net are never added across bases.
- **Benefit register** (each through the B0121 lifecycle with its enabler initiative):
  - B01 revenue / `revenue_uplift` (chain 1, Measure);
  - B02 cost / `avoided_cost` (chain 2 "CX + care cost", Enable; no measurement, so no measured or validated line at all, never a 0);
  - B03 revenue / `margin_uplift` (chain 3, Measure).

  These are three distinct financial classifications (M0346).
- **The shared benefit:** B01 is allocated 0.7 to INI-01 (pass redesign) and 0.2 to INI-02 (proactive comms). The remaining 0.1 is shown as unallocated, and totals count B01 once (`benefit_counting`).
- **Measurements** (KPI-bound, each with its `benefit_calculation` lineage and its inputs bound to the accepted KPI actual version):
  - B01 July: (0.2025 − 0.18) × 220,000 × 45 = **222,750 SAR**, validated.
  - B03 July: 80,000,000 × (0.012 − 0.011) = **80,000 SAR**, validated. These are the two B0087 playbook shapes.
  - B01 August: (0.19 − 0.18) × 220,000 × 45 = **99,000 SAR**, submitted.
- **Planned and forecast series:** planned = the formula at the trajectory point of each month end; one forecast (September). These stay separate value states and never count as measured or validated.
- **Finance:**
  - the three formula versions and the B01/B03 baselines are Finance-validated (B02's baseline stays unvalidated);
  - three queue items carry the six-key content snapshot built by `buildFinanceContent`, the worker's own function;
  - two are **synthetic approvals** by the demo Finance user, never the submitter: all six items accepted, approved amount = measured amount;
  - **one pending Finance validation:** B01 August, queued. It is submitted value, never validated.

Value states per class, from `benefit_value_line` (asserted): revenue uplift planned 891,000 / forecast 148,500 / measured 321,750 / submitted 99,000 / validated 222,750; margin uplift planned 240,000 / measured 80,000 / validated 80,000; avoided cost planned 184,800 and nothing else.

**"Recomputed values that equal the seeded values"** is tested twice:

1. `demo-numbers-spec.test.ts` recomputes every literal from the dataset's inputs with `@mth/shared/calc`: every KPI evaluation on both bases, its lineage (exact value, threshold source, explanation parameters, rounding record), every formula preview and result type, every line amount, plan value and measurement, and the engine version constants. It also holds hand-worked fixtures.
2. `demo-numbers.test.ts` seeds a scratch database through BE-S's `seedDemo`. Every engine trigger and every deferred constraint of 0033–0039/0061 runs at commit. The test then recomputes every stored KPI evaluation (period and cumulative), formula preview, benefit calculation, measurement and plan value **from the stored rows** with the engines, and compares.

**Coverage conditions** (ADR-0050 §5): `countStaleKpis` (`kpi.stale`) and `countSharedBenefits` (`benefit.shared`) are exported count queries for BE-T's named lines in `coverage.ts`. Through `seedDemo`'s `conditions` option, the integration test gets `{"kpi.stale": 1, "benefit.shared": 1}` with `coverageComplete: true`.

**Determinism:** fixed literal ids; every instant derives from the synthetic clock. A second seed into a fresh database gives identical record counts and checksum (asserted). No row of these modules reads `now()`, `random()` or a generated UUID; see §6 item 4 for the one engine trigger that does.

### Why every number is a literal (ADR-0002 rule 5)

`apps/api/src/architecture.test.ts` enforces "packages/db imports only @mth/config and @mth/shared" (and `@mth/shared/schemas`). My first version computed the lineage with `@mth/shared/calc` at seed time, and that test failed in my first full unit run (disclosed in §3). I then moved every engine call out of `packages/db/src` into the tests, and the dataset now holds literals only. The architecture test passes.

## 3. Checks actually run

Environment: Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline, worktree `/home/user/wt/dg5-kbe-h`, harness ports 23150–23199 only. Other W14 agents were running at the same time; the load average was 11–18 throughout. Logs are in `docs/delivery/handbacks/DG5/T-DG5-KBE-H-evidence/`. Each log starts with its command and ends with `EXIT=<status>`.

**Final run** (`$TMPDIR/checks.sh`, one step after another, 07:48Z onwards, on the final code):

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 1 | `pnpm -r typecheck` | 0 | all packages | `typecheck.log` |
| 2 | `pnpm -r build` | 0 | all packages | `build.log` |
| 3 | `pnpm lint` (`eslint . --max-warnings=0`) | 0 | clean | `lint.log` |
| 4 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" | `prettier.log` |
| 5 | `pnpm openapi:lint` | 0 | "PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 846 operations" (unchanged) | `openapi-lint.log` |
| 6 | `node tools/gates/validate.mjs --historical --stage DG4` | 0 | "PASS gate DG4 (historical)" | `validate-dg4-historical.log` |
| 7 | `pnpm test`, locale unset (`env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE`) | **0** | unit-node 131 files / **2128** passed; unit-web 74 / **1429** passed; unit-formula-nocodegen 3 / **259** passed + 2 skipped by design | `unit-locale-unset.log` |
| 8 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | **1** | unit-node 2127 passed, **1 timed out** (see below); unit-web 1429 passed; nocodegen 259 + 2 skipped | `unit-c-utf8.log` |
| 9 | `QA_PG_PORT=23180 MTH_PORT_POOL=23181-23199 tests/qa/support/with-pg.sh pnpm test:integration` | **0** | 268 files; **2597 passed + 1 skipped** (2598) | `integration.log` |
| 10 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test`, re-run at load average 0.7 (09:15Z) | **0** | unit-node 131 / **2128** passed; unit-web 74 / **1429** passed; nocodegen 3 / **259** passed + 2 skipped | `unit-c-utf8-rerun.log` |

Counts against D-159's verified base (unit 2120 / 1429 / 259 + 2; integration 2536 + 1 skipped):
- unit-node: +8, this task's `dataset-helpers.test.ts`;
- integration: +61, of which 51 are `demo-numbers-spec.test.ts` and 10 are `demo-numbers.test.ts`.

No pinned count (media-type triple, rate-limit floor) changes.

**The C.UTF-8 failure (step 8), disclosed:**
- **What failed:** `apps/api/src/architecture.test.ts` › "API module boundaries (ADR-0002) › every import respects dependsOn, public surfaces and allowed packages": "Test timed out in 30000ms" at 30,926 ms. The same test passed in step 7 at 27,743 ms, which is already close to its 30 s budget.
- **Why I don't think this task caused it:** the test reads the imports of `apps/api/src` modules only, and this task changes nothing under `apps/` (`git diff --stat HEAD -- apps/` is empty).
- **Cause:** a timeout under load, the F-DG4-148 class that D-146 records for this same file.
- **Isolated re-run:** run alone in C.UTF-8 while my integration run (step 9) was going, at load average 11–12, it timed out again at 33,071 ms (`unit-c-utf8-architecture-rerun.log`, exit 1).
- **Low-load re-run:** at load average 0.75 (09:13Z) the same file passed in C.UTF-8, 139/139, with this test at 7,267 ms (`unit-c-utf8-architecture-rerun-2.log`, exit 0). The whole C.UTF-8 `pnpm test` then passed, exit 0 (step 10). Both locales therefore pass in every Vitest invocation of `pnpm test` (steps 7 and 10). This test's margin is thin under load: it already took 27.7 s in step 7. That is for its owner and the orchestrator (D-146 envelope).

**Earlier, superseded runs (disclosed):**
1. **Engine imports.** My first full `pnpm test` (07:34Z, locale unset; its log was replaced by the final run) failed 1 of 2150 unit-node tests. `architecture.test.ts` › "packages/db imports only @mth/config and @mth/shared" listed my four files importing `@mth/shared/calc`. That was a real defect of my first version, fixed as described in §2: no engine import remains under `packages/db/src`, and the test passes in steps 7 and 8.
2. **Preliminary C.UTF-8 pass.** That first run's C.UTF-8 pass (started about 07:38Z, on the pre-fix code) ended with exit 1. Its output went to a file that the final script had already removed, so only its `EXIT=1` line survived, and the final step 8 overwrote it. It ran the pre-fix code, so I take it to be the same import failure, but I cannot show that from its output.
3. **Integration iterations.** During development, `demo-numbers.test.ts` failed twice before passing:
   - an invalid upper-case fixture key, refused by BE-S's `ctx.insert`;
   - the explanation parameters naming the thresholds as `0.0003` where the worker, reading `numeric(24,6)`, writes `0.000300`. The literals now use the stored text form.

   Both were fixed before the final run.
4. **Empty sandbox folders.** Empty `.claude/.cc-writes` folders, created by the sandbox's write tracking under `packages/db/` and `packages/db/src/demo/data/`, were removed before the final run (none under `packages/db/migrations` at that point).

## 4. Operations routed (delta to the pending list)

None. §J.3 assigns no operation, and this task has no `p5-pending-kbe-h.ts` or `p5-exercises-kbe-h.ts`. Pinned-count deltas: media-type triple +0, rate-limit floor +0.

## 5. Contract, schema or dependency needs

- **Contract:** none. **Schema/migration:** none; no number was taken. **Dependency:** none.
- **Refusal codes:** none added.

## 6. For the orchestrator, BE-T and BE-S (decisions or follow-ups)

1. **Wiring (BE-T).** These steps make the numbers part of the shipped dataset:
   - BE-T creates its records with the ids of `DEMO_ANCHORS` (`kpis.ts`: organization `…0002`, business unit `…0003`, the transformation `…0001` of `coverage.ts`, users `roaming.user.{sp,tl,bo,fin,kds,wl}` `…0011`–`…0016`, initiatives INI-01/02/03 `…0021`–`…0023`), or edits that one object, in modules ordered below 400;
   - BE-T adds `...KBE_H_DATASET_MODULES` (from `./finance.ts`) to `DEMO_DATASET_MODULES` in `data/index.ts`;
   - BE-T sets the `kpi.stale` query to `countStaleKpis` and the `benefit.shared` query to `countSharedBenefits` in `coverage.ts`.

   I did not wire the modules, because BE-S's CLI tests seed the default `DEMO_DATASET_MODULES`, and without BE-T's anchors the foreign keys would fail.
2. **`ctx.update` (BE-S).** The engines admit most rows only in their initial state: a KPI version, a trajectory and a benefit start as drafts or at Identify. The seeded state is therefore reached through guarded transitions with `seedUpdate`, which steps `version` and writes the `<table>.<verb>` audit event. The seed context has no update path, so the audit actor of these updates is the CLI actor even in an in-app (worker) reset. Proposal: BE-S adds `ctx.update(table, id, verb, set)` using the seed's own actor, and `seedUpdate` delegates to it. Audit events are outside the checksum, so this affects attribution only.
3. **Read-time staleness after the synthetic clock (decision).** Stored evaluations are relative to the synthetic clock: only K3 August is Stale. The product's read path re-checks staleness against *today's* business date (`withReadTimeStaleness`), so in real time every actual whose `data_as_of` is more than 45 days old displays Stale. For the August actuals (data as of 2026-08-31) that is the case from 2026-10-16, today. This is honest product behaviour, but the demo will show K1/K2 as Stale too. Options:
   - the demo deployment's read paths use the synthetic clock as the business date (BE-S/BE-T);
   - or the orchestrator accepts the ageing.

   I did not lengthen the freshness windows to hide it, because that would misstate a monthly KPI's data-quality rule.
4. **One non-deterministic engine trigger.** The DG4 trigger `benefit_lifecycle_history` (0037) inserts `benefit_lifecycle_event` rows with `mth_uuid_v7()` and `now()`, one per lifecycle step. They are not registered, so they are outside the checksum, and their number is fixed, so the counts are identical (asserted across two seeds). BE-T's benefits will produce the same. ADR-0050 §4 says "nothing seeded reads now(), random() or gen_random_uuid()". This is an engine trigger rather than a seeded value; it is recorded here for the ADR owner.
5. **Audit events on lineage rows.** BE-S's single insert path writes an audit event per registered row, so the seeded `calculation_run`, `kpi_evaluation`, `data_quality_finding` and `benefit_calculation` rows have one, where the product's worker writes none (0035, the system-lineage rule). This is consistent with BE-S's framework and does not affect the checksum. It is noted for review.
6. **KPI submission route.** The demo KPIs use `direct_accept`, so no KPI review queue item is seeded. "Pending approval" (`approval.pending`) is BE-T's condition. The pending Finance validation is a separate pending item and may also serve the walkthrough.
7. **Idempotency keys.** The seeded runs and queue items use `demo:`-prefixed keys (`demo:kpi.actual_accepted:<id>:1`, `demo:benefit.measurement_submitted:<id>`). They cannot collide with the worker's keys, so a later real event for the same slot is still processed.

## 7. User-facing texts made untrue

None. No en/ar string calls the demo dataset or its numbers planned, and the numbers become visible only once BE-T wires the modules (§6 item 1). `source_element` `roaming_example.international_roaming` stays `planned` until BE-T's migration `0093`.

## 8. What remains

- **BE-T:** §6 item 1 (anchors, module list, the two coverage lines) and `coverage.test.ts`. REQ-S18-002 completes with BE-T (§J.7).
- **Orchestrator:** the decisions in §6 items 2–5.
- Nothing else in §J.3 remains. This task has no separable second half.
