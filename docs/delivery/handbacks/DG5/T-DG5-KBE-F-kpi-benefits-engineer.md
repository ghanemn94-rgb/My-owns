# Handback T-DG5-KBE-F (kpi-benefits-engineer): formula preview, the finance functions, settings, cash flows and metrics

- **Stage / gate:** P5 "Configuration automation and outputs", DG5 (BUILDING). Section: `docs/architecture/p5-work-split.md` §G.3.
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-KBE-F.md` (sha256 `6ac479af…9e097e`, verified at start).
- **Invocation:** run `DG5-T-DG5-KBE-F-kpi-benefits-engineer-20261015T165722Z-9208b63d`, session `9208b63d-8ed6-4ed4-915e-b14381726ffe`.
- **Base:** branch `dg5/kbe-f` at `fedb63d` (integrated HEAD). The changes are **uncommitted**, for the orchestrator to integrate.
- **Time:** started 17:01:31Z, ended 19:08:10Z (past the ~2 h limit by about 7 minutes, waiting for the integration run to finish).
- **Two gate systems.** Nothing here reads or writes DG0–DG7 records. Product gates G1–G6 are business approvals inside the product. No agent, seed or test grants a real business, Finance or IT approval. Every value in the tests is synthetic. NPV, ROI and payback are **an extension, not a playbook requirement** (M0174; REQ-S08-019 notes).

## 1. Changed files

| File | Purpose |
|---|---|
| `packages/shared/src/finance/metrics.ts` (new) | Pure NPV, ROI and payback in decimal.js (ADR-0047 §5): `checkCashFlows`, `isCashFlowAmount`, `isDiscountRate`, `netPresentValue` (precision 40, one ROUND_HALF_UP rounding to 2 dp, `exact` kept for lineage), `returnOnInvestment` (6 dp), `paybackPeriod`, `computeFinancialMetrics`. A null/unknown result is `null` with a reason, never 0. |
| `packages/shared/src/finance/index.ts` (new) | Barrel of the finance functions. |
| `packages/shared/src/finance/metrics.test.ts` (new) | 21 tests: the ADR fixture (−21.04 / −19.12 / 0.200000 / index 3), worked edge cases (0 % and 100 % rates, half-up rounding, no `-0.00`, zero outflow, not reached, first crossing, out-of-range), input checks, and 4 seeded property tests (1 500 cases each) against independent oracles (decimal.js at precision 200; a BigInt integer oracle for payback). |
| `packages/shared/src/calc.ts` | **Append-only line** after KBE-B's forms line: `export * from "./finance/index.ts";` (§H.6: KBE-G's health line goes after it). |
| `packages/shared/src/schemas/financial-metrics.ts` (new) | zod mirrors of the `formula-previews` and `financial-metrics` components (request and response). |
| `packages/shared/src/schemas/index.ts` | Barrel line for `financial-metrics.ts` (append-only). |
| `apps/api/src/modules/kpi/formula-preview.ts` | Fills BE-A's stub: `POST /formula-previews` (`previewFormula`). It calls only `validateFormula`/`evaluateFormula` (shared rule 9); the seeded examples come from `benefit_formula_example` through the DG3 `loadExamples`. |
| `apps/api/src/modules/benefits/financial-metrics.ts` | Fills BE-A's stub: the seven settings, cash-flow and metrics operations. |
| `apps/api/src/modules/platform/db-errors.ts` | `mapP5FinancialMetricError` (the `financial_metrics.*` / `financial_cash_flows.*` lines, ADR-0047 §8) and its one chain line after `p5MethodologyReader`. Append-only. |
| `apps/api/test/support/p5-pending-kbe-f.ts` | Emptied: all 8 operations routed. |
| `apps/api/test/integration/contract/p5-exercises-kbe-f.ts` | Exercises all 8 operations through the validating client (a success and every reachable declared refusal), and their zod mirrors. |
| `apps/api/test/integration/contract/contract.test.ts` | (1) The media-type pin `[370, 369, 1]` → `[374, 373, 1]` (+4 JSON bodies), applied in my tree by the KBE-D precedent. (2) **A one-line harness fix:** the local `mirrored` helper now resolves its operation with `findOperation`, the most specific path, as the validating client already does (§5.3). |
| `apps/api/src/modules/kpi/kpi.test.ts` | The kpi module test pins its route list. It now adds `KPI_P5_KBE_F_OPERATIONS = ["previewFormula"]`, the `previewFormula → authenticated` permission exception, and `authenticated` in the write-permission set (§5.4). |
| `apps/api/test/integration/kpi/formula-preview.test.ts` (new) | 9 tests: REQ-S08-005 literally, both B0087 examples worked by hand, every edge case, division by zero, engine refusals unchanged, writes nothing. |
| `apps/api/test/integration/benefits/financial-metrics.test.ts` (new) | 11 tests: REQ-S08-019 literally (each ADR-0047 §5 status), cash-flow revisions and history, 422s, currency mismatch, authorization split, AUD, `If-Match`, audit, commit-time re-authorization, the db-error mapping and the deferred row guard. |
| `docs/delivery/handbacks/DG5/T-DG5-KBE-F-evidence/` | Check logs and the proposed contract patch (§5.1). |

No migration, no new dependency, no web file, and no file outside §G.3 except the two test files named in §5.3/§5.4.

## 2. Behaviour delivered, per requirement

### REQ-S08-005 (KBE-F owns the preview; FE-F completes the screen)

Acceptance (verbatim): *"A05: preview of the revenue uplift example shows SAR as the unit and 'Not computable' for a missing ARPU"*.

`POST /api/v1/formula-previews` accepts either `{exampleCode}` (a seeded B0087 row) or `{expression, variables}` (the DG3 `FormulaCheckRequest` shape), but not both and not neither (400), plus up to 10 named `examples` and `edgeCases` (default true). It returns:
- the engine's verdict, `unit {kind, currency, period, unitLabel}` from the engine's result type;
- `examples[]`: a seeded example contributes "Source example" with its seeded values;
- `edgeCases[]`: `zero`, `missing`, and `negative` (only for kinds that admit a sign: currency, number, fraction_delta, percent_change), per referenced variable.

Every Unknown result is `status: not_computable`, `result: null` and the engine's `reasonCode`, never 0. An invalid expression is 422 with the engine's own first code and text, unchanged. The route writes nothing and needs a session only.

Tested literally (`formula-preview.test.ts`):
- `{exampleCode: "revenue_uplift"}` → unit `{kind: "currency", currency: "SAR", period: "year"}`;
- the source example is 100000 = (0.12 − 0.10) × 100000 × 50;
- edge case `arpu`/`missing` → `{status: "not_computable", result: null, reasonCode: "formula.missing_input"}`;
- the second playbook example: volume × Δ unit cost = 200000 × (12.50 − 10.00) = 500000 SAR.

### REQ-S08-019 (KBE-F owns the finance functions, settings, cash flows and metrics; FE-F completes the screen)

Acceptance (verbatim): *"A05: with no discount rate configured NPV is not shown; with 10% configured, a fixture cash-flow set gives the expected NPV to 2 decimals"*.

**Settings** are one row per organization and **off by default**: there is no row and none is seeded. The operations and permissions:
- `getFinancialMetricSettings`: session; version 0 when none.
- `putFinancialMetricEnablement`: `financial_metrics.enable`, ADM_METHOD.
- `putFinancialMetricAssumptions`: `financial_metrics.define`, FIN. It sets the methodology note, timing, period basis and discount rate, and gives 422 `financial_metrics.discount_rate_invalid` outside [0, 1].

Both writes need the permission through a grant that applies at the **organization** level.

**Cash flows** are replaced as a whole: `putBusinessCaseCashFlows` requires `financial_metrics.define` in the case's transformation. Each replacement steps `revision`, and earlier rows stay as history. The set is always in the case's currency, and a gap or duplicate index gives 422 `financial_cash_flows.periods_invalid`.

**Metrics** are computed on read by the pure functions. The ADR-0047 §5 statuses, in order:
1. `disabled` (no row, or off);
2. `assumptions_missing`;
3. `cash_flows_missing`;
4. `shown`. Here, with no discount rate: `npv: null` and `npvReason: discount_rate_missing`, while ROI and payback are shown.

Every body carries `assumptions` (or null) and `extension: true`.

Tested literally (`financial-metrics.test.ts`, plus the exercises and the unit fixture):
- no settings row → `disabled`, with every metric null and reason `not_shown`;
- off → `disabled`;
- enabled without assumptions → `assumptions_missing`;
- enabled with assumptions but no rate → `npv: null`, `npvReason: discount_rate_missing`, ROI `0.200000`, payback 3;
- rate `0.100000` with `beginning_of_period` → NPV **`-21.04`**; with `end_of_period` → **`-19.12`**; ROI **`0.200000`**; payback index **3**;
- the response names the assumptions, and `extension: true`;
- ADM_METHOD switches the extension but gets 403 on the assumptions; FIN gets 403 on the switch;
- AUD gets 403 on all three writes, each audited as `authorization.denied`;
- `If-Match "0"` creates version 1 and is 409 once a row exists; a missing `If-Match` is 428; a stale one is 409;
- one audit event per mutation;
- commit-time re-authorization: a grant revoked while the PUT waits gives 403, and nothing is written (settings and cash flows).

*"Cash flows in USD for a SAR case give 422 `financial_cash_flows.currency_mismatch`"*: the contract body `BusinessCaseCashFlowsPut` has no currency, and a case's currency never changes after creation. So the API cannot be sent a USD set, and it always writes the case's currency. The refusal is therefore tested where it can occur: a USD set for a SAR case inserted as the application role is refused by the `0085` guard, and the API's error mapping answers 422 with the exact ADR text. The API also checks it first, as defence in depth. See §5.2.

## 3. Checks actually run

Environment: Node 24.21.0, offline, this worktree; harness ports 24360–24399. A disposable PostgreSQL cluster came from `tests/qa/support/with-pg.sh` (UTF8 / C). Start 17:01:31Z, end 19:08:10Z. Logs are in `docs/delivery/handbacks/DG5/T-DG5-KBE-F-evidence/`.

**Load.** The full suites ran at a load average of about 27–34 (four W11 agents, plus my unit and integration suites in parallel to fit the time limit). Memory was 15 GB with about 3 GB free. Every failure below is a timeout of that class (F-DG4-143 to F-DG4-148), in a file I did not change, and each passes when rerun in isolation. They are disclosed, not hidden.

| # | Command | Result | Log |
|---|---|---|---|
| 1 | `node tools/gates/validate.mjs --historical --stage DG4` (start) | **exit 0**, `PASS gate DG4 (historical)` | `validate-historical-DG4-start.txt` |
| 2 | `pnpm -r typecheck` | **exit 0** (final tree, 19:03Z). Earlier attempts: one exit 2, my own TS2352 in `formula-preview.test.ts`, fixed; one **exit 137** at 18:33Z, `apps/api typecheck: Killed`: the kernel killed `tsc` for memory while both suites ran. Neither is the final result. | `typecheck.txt` |
| 3 | `pnpm -r build` | **exit 0** (final tree, after the last source edit) | `build.txt` |
| 4 | `pnpm lint` | **exit 0** (`eslint . --max-warnings=0`; final tree) | `lint.txt` |
| 5 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | **exit 0**, "All matched files use Prettier code style!" | `prettier.txt` |
| 6 | `pnpm openapi:lint` | **exit 0**, `PASS … OpenAPI 3.1.1, 846 operations` | `openapi.txt` |
| 7 | `pnpm test`, locale unset (`env -u LANG -u LC_ALL -u LANGUAGE -u LC_CTYPE`), 18:13–18:38Z | **exit 1**. unit-node **1988/1990** (2 failed: `architecture.test.ts` "every import respects …" 30 s timeout; `server.test.ts` "declares access …" 5 s timeout). unit-web **1423/1429** (6 failed: `app.test.tsx`, `p5-shell.test.tsx` ar, `business-cases.test.tsx` ar ×2, `raid.test.tsx` en+ar; 20 s timeouts or `findBy` waits that expired). unit-formula-nocodegen **259 passed + 2 skipped** (by design). | `unit-nolocale.txt` |
| 8 | `pnpm test`, `LANG=LC_ALL=C.UTF-8`, 18:38–18:51Z | **exit 1**. unit-node **1989/1990** (1 failed: `workflows.test.ts` "its declared boundary holds …" 30 s timeout). unit-web **1428/1429** (1 failed: `raid.test.tsx` en, a `findBy` wait that expired). nocodegen **259 + 2 skipped**. | `unit-cutf8.txt` |
| 9 | Isolated reruns of every failing unit file at load 2.6 (19:05Z), locale unset: `architecture.test.ts`, `server.test.ts`, `workflows.test.ts`; `app.test.tsx`, `p5-shell.test.tsx`, `business-cases.test.tsx`, `raid.test.tsx` | **exit 0**: unit-node **159/159**, unit-web **86/86** | `rerun-unit-node.txt`, `rerun-unit-web.txt` |
| 10 | The two C.UTF-8 failures rerun under C.UTF-8 | **exit 0**: `workflows.test.ts` **14/14**, `raid.test.tsx` **18/18** | `rerun-cutf8-unit-node.txt`, `rerun-cutf8-unit-web.txt` |
| 11 | `QA_PG_PORT=24370 MTH_PORT_POOL=24371-24399 tests/qa/support/with-pg.sh pnpm test:integration`, 18:13–19:04Z | **exit 1**: **249 files, 2408/2409 passed**. 1 failed: `reporting/modular.test.ts` "REQ-S03-005: labelled inherited records > End-to-End → 422 …", a 30 s timeout at 39.8 s, not my file. That is the W10 baseline 2389 (D-155) + 20 new (`formula-preview.test.ts` 9, `financial-metrics.test.ts` 11). | `integration.txt`, `integration-times.txt` |
| 12 | `modular.test.ts` rerun in isolation (`QA_PG_PORT=24375 …`) | **exit 0**, **14/14** | `rerun-integration-modular.txt` |
| 13 | `node tools/gates/validate.mjs --historical --stage DG4` (end) | **exit 0**, `PASS gate DG4 (historical)` | `validate-historical-DG4-end.txt` |
| 14 | Targeted runs during the work (contract 77/77; the two new files 20/20; finance 21/21) | contract: four failing iterations (ETag `"0"` vs the contract; the header omitted; an organization-scoped FIN on cash flows; `getBenefit` path resolution), then **77/77**; new files: one failing iteration (four of my own wrong expectations), then **20/20** | `intermediate-contract1..5.txt`, `intermediate-new1..2.txt` |
| 15 | `vitest … architecture.test.ts --testTimeout=180000` (diagnostic only, not a substitute) | exit 0, 139/139; the boundary test took 27.8 s against its 30 s budget under load | `architecture-diagnostic.txt` |

**Count deltas:** unit-node 1969 → **1990** (+21, `finance/metrics.test.ts`); unit-web and nocodegen unchanged; integration 2389 → **2409** (+20). The single-pass acceptance items 2 (`pnpm test`) and 3 (integration) were **not green in one pass** on this loaded host. Each failure is a timeout in an untouched file, and each passes in isolation. A merged-tree verification at normal load should confirm them.

## 4. Operations routed (delta to `p5-pending-kbe-f.ts`)

Removed, all routed and exercised in `p5-exercises-kbe-f.ts`: `previewFormula`, `getFinancialMetricSettings`, `putFinancialMetricEnablement`, `putFinancialMetricAssumptions`, `getBusinessCaseCashFlows`, `putBusinessCaseCashFlows`, `getBusinessCaseFinancialMetrics`, `listTransformationFinancialMetrics`. The list is now empty (8 → 0).

**Pinned counts (D-079):**
- **Media-type triple:** `[370, 369, 1]` → **`[374, 373, 1]`**: +4 JSON bodies (`previewFormula`, `putFinancialMetricEnablement`, `putFinancialMetricAssumptions`, `putBusinessCaseCashFlows`). The other four are GETs. I applied it in my tree, with a comment line.
- **Rate-limit floor:** unchanged (it is a floor).
- **Operation count (846):** unchanged.

Declared but unreachable refusals (listed in the exercise header):
- `previewFormula`: 403 (session only) and 404 (the seeded rows always exist, and `exampleCode` is an enum);
- `putFinancialMetricEnablement`: 422 (a one-boolean body);
- `putFinancialMetricAssumptions`: 422 `assumptions_incomplete`, because the body requires all three assumptions, so a partial set is a 400. The code is the database's last line.
- `putBusinessCaseCashFlows`: 422 `currency_mismatch` (§5.2);
- 403 on the reads.

## 5. Contract, schema and dependency needs (for the orchestrator)

1. **Contract defect, the BE-L / D-153 precedent.** `getFinancialMetricSettings` and `getBusinessCaseCashFlows` say "version 0 when …". Their PUTs take `IfMatchOrZero`, but their 200 responses declare `ETag` (pattern ≥ 1) instead of `ETagOrZero`. While nothing is stored, no response can satisfy the contract test: `"0"` breaks the pattern, and omitting the header breaks "must send header ETag". I tried both; the logs are in the evidence.
   - **Implemented:** the ARCH-R1 rule: ETag `"0"` while nothing is stored, else the version.
   - **Proposed two-line patch:** `T-DG5-KBE-F-evidence/proposed-openapi-etag-or-zero.patch`. `node scripts/openapi-lint.mjs` on the patched copy gives PASS, 846 operations.
   - **Test workaround until it lands:** the version-0 reads use `contract: false` (`VERSION_ZERO_READ`, documented in both test files). Every other call is contract-validated, including both GETs once a row exists.
2. **Currency mismatch is unreachable through the contract.** `BusinessCaseCashFlowsPut` has no `currency`, and business-case currency is fixed at create. If the product wants a client-declared currency (so the API can say "USD is not this case's SAR"), the body needs an optional `currency`. Then the API compares it to the case's before writing. That is an architect/orchestrator decision; nothing else depends on it.
3. **Harness fix in `contract.test.ts` (outside §G.3, necessary).** `/transformations/{t}/benefits/financial-metrics` (mine) also matches DG4's `getBenefit` path `/transformations/{t}/benefits/{benefitId}`. Fastify serves the static route correctly, and the validating client's `findOperation` already prefers the most specific path. But `contract.test.ts`'s local `mirrored` took the first regex match and checked my page against `getBenefit`'s zod mirror. It now calls `findOperation`, a one-line change. The whole contract file passes with it (77/77), so no other resolution changed.
4. **`kpi.test.ts` (the kpi module's own unit test, outside §G.3, necessary).** It pins the exact route list, the permission per route and the write-permission set of the kpi module, where BE-A placed the preview stub. I added a P5 KBE-F list and an `authenticated` exception for `previewFormula`. **Merge note:** KBE-E also adds kpi routes (restatements), so expect an additive conflict here. Keep both lists.
5. **Proposed text keys (not invented silently; shared rule 15).** I used existing translated keys: `validation.invalid` for "both or neither of exampleCode / expression", and `validation.max_properties` for more than 30 example inputs. A specific key such as `validation.formula_preview_source` ("Give either a seeded example or an expression with its variables, not both.") is proposed for FE-F.
6. **Interpretations, listed for review (ADR-0047 §5):**
   - (a) **Payback** when the cumulative net is never negative, although there is an outflow: `not_computable` ("nothing to pay back"), the generalization of "no outflow". The literal text would give `not_reached`, which would tell a user the investment never pays back.
   - (b) **NPV beyond the contract's 18 integer digits.** This is only possible with Σ cash flows of 10¹⁸ or more, since rows are numeric(20,4) and up to 121 of them. It is answered `npv: null` with `npvReason: not_shown` (the enum has no out-of-range value). An `out_of_range` value is proposed. ROI in the same case is `not_computable`.
   - (c) **Settings permissions** need a grant applying at the organization level. A FIN scoped to one transformation enters that transformation's cash flows but cannot change the organization-wide assumptions (tested).
   - (d) **`unitLabel`** is the engine's own result-type unit, and the engine is unchanged. For the revenue uplift it is `"per customer"`: the engine propagates arpu's unit through count × currency. The kind, currency and period are SAR / year as the acceptance requires. The UI shows "SAR" (ADR-0047 §4), and FE-F should not render `unitLabel` as "SAR per customer" for this total. Observation for the engine's owner; I made no change (shared rule 9).
   - (e) The **transformation list** includes archived cases (their metrics still read). The cash-flow PUT refuses an archived case with the DG3 `business_case.archived` 422.
7. **No migration, no new dependency, no new problem code.** All codes and English texts are ADR-0047 §8's.

## 6. User-facing texts

- **None made untrue.** The web strings for these screens (`nav.p5.formulaPreview`, `nav.p5.financialMetrics`, and `nav.p5.notAvailableBody`: "This screen is part of the current release and is being built …") describe FE-F's screens, which are still not built. No en/ar string calls the preview or the financial-metrics API planned or later.
- **For the web owners (FE-F, or FE-A for problem keys):**
  - en/ar `problems.json` keys for the four ADR-0047 §8 codes: `financial_metrics.assumptions_incomplete`, `financial_metrics.discount_rate_invalid`, `financial_cash_flows.currency_mismatch` and `financial_cash_flows.periods_invalid`. They are not present yet.
  - Audit labels for `financial_cash_flow_set.create` and `financial_cash_flow_set.replace`. These events carry a transformation id, so they appear on the transformation trail. Their fields are `business_case_id`, `currency`, `revision`, `line_count`, `basis_note` and `rows`. `apps/web/src/lib/auditChanges.p5.test.ts` lists the API files it scans, and `benefits/financial-metrics.ts` should be added to it.
  - `financial_metric_setting.*` events are organization-level (no transformation id).
  - The "Not computable" label (`formulaPreview.notComputable`) and "Extension, not a playbook requirement" (H.6 item 6).

## 7. What remains

- The orchestrator: apply the `ETagOrZero` patch (§5.1), then drop `VERSION_ZERO_READ` from my two tests and the exercises. Reconcile the media-type pin (§4).
- Decide §5.2 (an optional `currency` in the cash-flow body) and §5.6 (b)'s `out_of_range` reason.
- FE-F: `pages/formula-preview/**` and `pages/financial-metrics/**`, with the texts of §6.
- **Verification gap (honest status):** acceptance items 2 (`pnpm test` in both locales) and 3 (`test:integration`) did not pass in a single run on this host under load. Seven unit tests and one integration test timed out, all in files I did not change. Each passed when rerun in isolation (§3 rows 9, 10 and 12). The merged-tree verification should confirm a clean single pass at normal load.
- **Merge notes:** additive conflicts are expected in `db-errors.ts` (KBE-E's `kpi_restatement.*` and BE-C2's lines, next to my `mapP5FinancialMetricError` block and chain line), `kpi.test.ts` (KBE-E's restatement routes), `contract.test.ts` (the media-type pin sum) and `calc.ts` (KBE-G's line goes after mine). Keep both sides in each.
- No other §G.3 implementation work is open.
