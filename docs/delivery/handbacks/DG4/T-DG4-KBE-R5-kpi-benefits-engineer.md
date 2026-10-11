# Handback T-DG4-KBE-R5 (kpi-benefits-engineer): DG4 round-1 repairs F-DG4-100 (slice B), F-DG4-101, F-DG4-121

- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG4-T-DG4-KBE-R5-kpi-benefits-engineer-20261011T005830Z-9e36a9da","session_id":"9e36a9da-457c-41e7-9f06-dd9c8232e7e6"}`
- **Assignment:** `docs/delivery/assignments/DG4/T-DG4-KBE-R5.md` (sha256 `599cec33…f94f4`, verified at start).
- **Base:** branch `dg4/kbe-r5`, `HEAD f5579e7af2c793cd6dc5b529c9a88f33f815d785`. All changes are **uncommitted**.
- **Time:** start `2026-10-11T00:58:43Z`; end `2026-10-11T02:37Z` (about 99 minutes; inside the ~2 h bound).
- **Ports:** 26100–26149 only (26100–26109 reproductions, 26110–26119 A/B transcripts, 26120–26149 the full integration run). **Disk:** 16–17 GB free before every full run (`evidence/20-disk-before-unit.txt`, `evidence/30-disk-before-integration.txt`); D-104's 3 GB floor was never approached.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG3` → **exit 0**, `PASS gate DG3 (historical)` (`evidence/validate-dg3-historical.log`, run first; re-run at the end: exit 0, `validate-dg3-historical-end.log`).
- Product gates G1–G6 are business approvals inside the product. Nothing here grants a business, Finance or IT approval. All data is synthetic. Nothing touches the engineering gates DG0–DG7.

Evidence directory: `docs/delivery/handbacks/DG4/T-DG4-KBE-R5-evidence/` (called `evidence/` below).

## 1. Files changed

| File | Purpose |
|---|---|
| `apps/api/src/modules/benefits/register.ts` | F-100: `requirePermissionSomewhere` is now async. It resolves the transformation and throws `forbidden().withDenial(denialOf(permission, target))`, so `access/denials.ts` writes exactly one `authorization.denied` naming the permission. For an unknown transformation it throws the same 403 with no denial (a missing record is not an authorization event). `openBenefitWrite` awaits it. Every one of the 26 slice B mutations goes through `openBenefitWrite`. |
| `apps/api/src/modules/benefits/finance-validation.ts` | F-100: the separation-of-duties refusals `finance_validation.sod_submitter` and `benefit.baseline_validator_is_owner` carry the `finance.validate` denial on the transformation. |
| `apps/api/src/modules/benefits/overlaps.ts`, `valuation-methods.ts` | F-100: the same for `benefit_overlap.resolver_is_owner` and `benefit_valuation_method.decider_is_proposer`. |
| `apps/api/src/modules/benefits/corrections.ts` | F-101: after inserting the correction rows, `stepOriginal` bumps the ORIGINAL `finance_validation` row's version (`bumpStamps`, `WHERE version = expected`) in the same transaction. This runs under the `financeValidationQueue` advisory lock (class 730233) and the original's `FOR UPDATE`, both taken by `openTarget`. It writes its own audit event `finance_validation.corrected` (actor: the correcting Finance user; prior and new version; the correction's reason). The existing If-Match check on the original then refuses a stale correction with 409 and `currentVersion`. Header comment updated. |
| `packages/db/migrations/0061_p4_finance_validation_correction_step.sql` (**new; number PROPOSED, see §5**) | F-101: 0038's `finance_validation_guard` made a decided validation fully immutable, so the D-117 version step was impossible. `CREATE OR REPLACE` of the function with ONE added branch: an approved `kind = 'validation'` row that already has a correction row may step `version` by exactly 1. Only `version`, `updated_at` and `updated_by` may change. Every other path of the function is 0038's, verbatim. |
| `apps/api/src/modules/benefits/totals.ts` | F-121: `GROSS_TOTAL_CLASSES = [margin_uplift, cash_saving, working_capital_release]` replaces the five-class gross. `revenue_uplift` and `avoided_cost` stay their own lines and never enter gross or net. Net = gross − implementation cost. Header item 5 updated. |
| `apps/api/src/modules/reporting/dashboards/finance.ts` | F-121: `grossNetLines` sums gross over the three classes, using the class lines' own rule (`lineEntersClassSum`), over the Value area's currencies (so the set of gross lines is unchanged). Net = that gross − the investment headline. A gross line keeps its `value.<state>` drill-down only when that drill sums exactly the gross records, i.e. no `revenue_uplift`/`avoided_cost` line enters that state and currency. Otherwise `drilldownHref` is `null` (see §5, contract need 2). The Value area's headlines are unchanged. |
| `apps/api/test/integration/benefits/slice-b-denials.test.ts` (**new**) | F-100 sweep: all 26 slice B mutations of the contract, against existing records, as AUD and as the ADM-only user, plus the six `finance.validate` decisions as a Business Owner. Exactly one `authorization.denied` per request (actor, transformation, `"<METHOD> <route> requires <permission>"`). Also: unknown transformation → 403 with no row; `sod_submitter` and `baseline_validator_is_owner` → one denial each. |
| `apps/api/test/integration/benefits/corrections.test.ts` | F-101: three new cases: the reviewer's F2 (two FIN users holding one ETag), stale amend then reverse, stale reverse then amend. A fourth checks the database guard (a bare version step, an amount change, and a +2 step are all refused). The REQ-S08-017 case that reused one version for the amendment, the unchanged amendment and the reversal now sends `decided.version + 1` and `+ 2`, and asserts the two audited version steps of the original. |
| `apps/api/test/integration/contract/p4-exercises-kbe-e.ts` | F-101: the KBE-E contract exercise reused `decided.body.version` after the amendment, for the unchanged amendment (422), the reversal (201) and the second reversal (422). These now send `+ 1`, `+ 1` and `+ 2`, the ETag each correction leaves, plus a comment. Every status and body it validates is unchanged. |
| `apps/api/src/modules/benefits/totals.test.ts` | F-121 unit: three fixtures that summed revenue or avoided cost into gross now use gross classes, or assert gross without them (10 → 5; USD → working capital; net fixture → margin). New worked fixture (DOM-GROSS + working capital 5 → gross 95, net 95 − 30). An Unknown revenue/avoided amount never makes gross Unknown. Revenue + avoided only → gross 0. |
| `apps/api/test/integration/benefits/totals.test.ts` | F-121: the reviewer's DOM-GROSS case (gross 90, net 90, four class lines unchanged). REQ-PB-058 and REQ-S08-011 cases use `margin_uplift`; the classes case asserts gross 7.1 (was 7.3) and validated gross 0 (the 4800 is revenue). |
| `apps/api/test/integration/reporting/finance-drilldown-k1.test.ts` | F-121 drill-down invariants: the gross ↔ drill test now asserts gross = exact sum of the three class lines (SAR 75.05 / 30.5, USD 0 / 0). It asserts a gross href only where its drill sums exactly the gross records, with that drill's sum checked. Net = gross (X has no investment). New case: gross = Σ three class lines for all 4 gross lines; revenue and avoided cost (non-zero in SAR) are not in it. |
| `apps/api/test/integration/reporting/finance-adoption.test.ts` | F-121: that fixture's value is revenue uplift, so gross and net are 0 and the gross lines carry no href. The revenue class line still shows 1500/900 and drills. |
| `tests/qa/integration/a10-benefit-integrity.test.ts` | **QA-owned file, edited (disclosed).** One line: the REQ-S08-011 case's 3 M SAR benefit becomes `margin_uplift` (it was `revenue_uplift`, which D-117 removes from gross and net), plus a comment. The assertions (gross 3 M, cost 1 M, net 2 M, net before 3 M) are unchanged. Without this the integration suite fails on a fixture the rule makes invalid. qa-verifier may prefer to re-author it. |
| `docs/delivery/handbacks/DG4/T-DG4-KBE-R5-kpi-benefits-engineer.md`, `…-evidence/**` | This handback, logs, the A/B transcripts and their comparison |

## 2. Behaviour delivered, per finding and requirement row

### F-DG4-101 (mandatory): REQ-S08-017

> Acceptance (REQ-S08-017): "A07;A10: an in-place edit of a validated value returns 409; a reversal nets the total and both records remain visible"

Unchanged and still tested (`corrections.test.ts` REQ-S08-017 cases; `updateBenefitMeasurement` on a validated value is still 409). The finding's **expected** text: "A correction made from a view that predates another correction of the same validated value must be refused with 409 and the current version. Either the original validation's version steps on each correction, or the If-Match names the latest state of the correction chain." D-117 chose the first option.

- **Reproduction before** (`evidence/01-repro-before.log`): F2 → FIN-A's stale amendment is accepted (the original's version stayed 2, `expected 2 to be 3`). Stale amend-then-reverse → `201` (the stale reversal was accepted). Stale reverse-then-amend → `422 already_reversed` instead of `409`.
- **After** (`evidence/03-repro-after.log`, and the full run): F2 → FIN-B `201 -100.0000`. The original's ETag goes from `"V"` to `"V+1"`, with one `finance_validation.corrected` audit row (FIN-B, V→V+1, FIN-B's reason). FIN-A with `If-Match "V"` → **`409 version_conflict`, `currentVersion V+1`**. Nothing is written (no correction row, no audit row for that request), and the validated total stays **900.0000**. FIN-A retrying with `V+1` → `201 +200.0000`, total 1100.0000. Stale amend then reverse → `409` with `currentVersion`; with the new ETag → `201`, total 0.0000. Stale reverse then amend → `409`; with the new ETag → `422 finance_validation.already_reversed`.
- **Concurrency.** The version step runs in the correction's own transaction, under the `financeValidationQueue` lock (730233, `lockQueue`) and the original's `FOR UPDATE`, as D-117 requires. The reviewer's F3 (a concurrent amend and reverse) is therefore still serialised; the second now sees the stepped version.
- **Database.** The guard still refuses any change of a decided validation's decision, items, amounts or content. Only a +1 version step of an approved validation that has a correction passes (test "the database still keeps a decided validation final"). No contract change: the correction response is unchanged (the new row, its own ETag `"1"`). The client re-reads the original for its new ETag, which the web already does (`FinanceValidationPages.tsx` sends `fv.version` and refreshes on done).

### F-DG4-100, slice B: REQ-S10-003 (and REQ-S10-001)

> Acceptance (REQ-S10-003): "A12: an ADM-only user calling a gate or Finance approval endpoint gets 403"
> Acceptance (REQ-S10-001, DG2): "A12: the eleven roles exist; a read-only auditor can view but every write returns 403"

Both 403s are unchanged; the response bodies are byte-identical (A/B: the 52 AUD/ADM refusals). The finding's **expected** text: "every failed authorization of a mutation writes exactly one audit event … an AUD, ADM-only or Business Owner attempt on the P4 Finance decision should write exactly one authorization.denied naming finance.validate."

- **Before** (`evidence/01-repro-before.log`): AUD, ADM-only and BO attempts write `[]`.
- **After:** `slice-b-denials.test.ts` passes. There is exactly one row per request for all 26 mutations as AUD, all 26 as ADM-only, and the 6 Finance decisions as BO. Each row reads `authorization.denied`, by the caller, on `transformation/<id>`, with reason `POST /api/v1/transformations/:transformationId/finance-validations/:financeValidationId/decision requires finance.validate` (and the like). The SoD refusals (`sod_submitter`, `baseline_validator_is_owner`; also `resolver_is_owner`, `decider_is_proposer` in code) now also write one denial.
- `completeWorkItem` is BE-R5's and is not touched.

### F-DG4-121: REQ-S08-009, REQ-S08-011

> Acceptance (REQ-S08-009): "A10: the Finance dashboard shows revenue uplift and margin benefit on separate lines; cost avoidance is not counted in cash savings"
> Acceptance (REQ-S08-011): "A10: a 1 million SAR cost recorded on an initiative reduces transformation net value by exactly 1 million SAR, not 2 million"

Both still hold and are tested: the class lines are unchanged, and the 1 M cost reduces net by exactly 1 M (`totals.test.ts`, `a10`). The D-117 rule as written:

- The headline gross sums only `margin_uplift`, `cash_saving` and `working_capital_release`.
- `revenue_uplift` and `avoided_cost` are returned as their own lines and never summed into gross or net.
- Net = gross − implementation cost.
- Validated totals and the per-class lines are unchanged.

Reproduction before: DOM-GROSS gross/net `435.0000` (`evidence/01-repro-before.log`), and the Finance dashboard's SAR gross `1975.05`. After: **90.0000 / 90.0000**, and dashboard SAR gross **75.05** (= 70.05 margin + 5 cash). This applies to `getBenefitTotals`, `getPortfolioBenefitTotals`, the initiative view (same `computeTotals`) and `getFinanceDashboard`. No schema change: the class lines were already returned. FE-R4 labels them.

**Byte stability (response-transcript method, `evidence/ab/`).** A = HEAD with this diff reversed; B = this tree. The same 217 requests were recorded, covering:

- totals of X (all five classes, USD, an overlap hold), of G (gross classes only) and of the organization;
- the Finance dashboard of X, G and the organization; the overview; the X and G dashboards;
- 189 drill-downs (every value-state metric × no class + 6 classes × 3 scopes);
- a correction chain (approve, then amend and reverse, each with the ETag a GET just returned);
- all 26 slice B mutations refused as AUD and as ADM.

`compare.txt`: **209 byte-identical, 8 differ**, and only in these members:

| Response | Changed members (A → B) |
|---|---|
| `getBenefitTotals` X, `getPortfolioBenefitTotals`, `getBenefitTotals` C | `currencies[*].gross.planned/validated.amount`, `currencies[*].net.planned/validated.amount` (e.g. X SAR 1477.55 → 77.55, 930.5 → 30.5; USD 2000 → 0; C 1000 → 0) |
| `getFinanceDashboard` X and org-wide | `lines[gross,*].total` (value, and `state` value→zero for USD), `lines[gross,*].drilldownHref` (→ `null` where revenue/avoided lines enter), `lines[net,*].total` |
| `getFinanceValidation` of the corrected original (after the amendment; after the reversal), `listFinanceValidationQueue` | `version` and `ETag`: 2 → 3 → 4 (A stays 2) |

Everything else is byte-identical: G's totals and Finance dashboard (gross classes only, including its gross hrefs), the overview and both transformation dashboards (the Value area), every drill-down, the amendment and reversal responses themselves, the values and measurements, and all 52 refusal bodies. Normalisation: ids, instants and hashes (`response-transcript.ts`), plus the harness's random `TX…` transformation codes (the KBE-R4 precedent).

## 3. Checks run (real exit codes)

| Check | Command | Result |
|---|---|---|
| Preceding gate | `node tools/gates/validate.mjs --historical --stage DG3` | exit 0, `PASS gate DG3 (historical)` (`validate-dg3-historical.log`); re-run at the end: exit 0 (`validate-dg3-historical-end.log`) |
| Reproductions, before | `QA_PG_PORT=26100 MTH_PORT_POOL=26101-26149 tests/qa/support/with-pg.sh npx vitest run --project integration <4 files>` | exit 1 as expected: 10 failed, 22 passed (`01-repro-before.log`) |
| Reproductions, after (first) | same | exit 1: 9 failed. The DB guard refused the step (→ migration 0061), and the pinned-gross tests needed updating (`02-repro-after-first.log`) |
| Reproductions, after | same over `benefits/`, K1, finance-adoption, a10 | exit 0, 18 files, **149/149** (`03-repro-after.log`) |
| A/B transcripts | `ab/ab-commands.txt` | A exit 0; B exit 0 (B re-recorded at 02:35Z on the final code; the same 8 responses differ, in the same members); compare exit 0 (`ab/ab-run-A.log`, `ab/ab-run-B.log`, `ab/compare.txt`, `ab/sha256.txt`) |
| `pnpm -r typecheck` | | exit 0 (`10-typecheck.log`) (re-run at 02:13Z on the final code, after every source edit; the log is that run) |
| `pnpm lint` | | exit 0 (`11-lint.log`) (re-run at 02:13Z on the final code, after every source edit; the log is that run) |
| prettier | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | exit 0 (`12-prettier.log`) (re-run at 02:13Z on the final code, after every source edit; the log is that run) |
| `pnpm openapi:lint` | | exit 0, `OpenAPI 3.1.1, 652 operations` (unchanged) (`13-openapi-lint.log`) |
| `pnpm -r build` | | exit 0 (`14-build.log`) |
| `pnpm test`, locale unset | `env -u LANG -u LC_ALL -u LC_CTYPE pnpm test` | exit 0: unit-node + unit-web **2772/2772** (145 files); no-codegen **259 passed, 2 skipped** (`21-unit-locale-unset.log`) |
| `pnpm test`, C.UTF-8 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | exit 0: **2772/2772**; **259 passed, 2 skipped** (`22-unit-c-utf8.log`) |
| Integration, run 1 | `QA_PG_PORT=26120 MTH_PORT_POOL=26121-26149 tests/qa/support/with-pg.sh pnpm test:integration` | exit 1: 2 failed, 1933 passed (1935); 202/203 files (`31a-integration-run1-contract-exercise-stale-etag.log`); see disclosure 4 |
| Integration, run 2 (final code) | `QA_PG_PORT=26130 MTH_PORT_POOL=26131-26149 tests/qa/support/with-pg.sh pnpm test:integration` | **exit 0: 203/203 files, 1935/1935 tests** (`31-integration.log`) |

**Disclosed non-zero exits.**

1. **First `pnpm test` (locale unset), exit 1, 3 failed** (`21a-unit-locale-unset-FIRST-RUN-3-failed.log`). These were real defects of my first draft, caught by the architecture tests:
   - `advisory-locks.test.ts`: my corrections.ts comment spelled the lock number 730233;
   - `architecture.test.ts` and `reporting.test.ts`: two computed members (`totals[state]`, `g[state]`) in finance.ts tripped the module-interface scanner.

   I fixed all three. The re-runs above are on the fixed code, after which typecheck, lint and prettier were re-run on the final code (`10-typecheck.log`, `11-lint.log` and `12-prettier.log` are those runs).
2. That first background job's C.UTF-8 pass (on the pre-fix code) overlapped the start of the second job's locale-unset pass. Its log was overwritten by the second job's C.UTF-8 pass; the two logs above are both from the second job, on the final code. No timeout was hit in either.
3. The reproduction runs exiting 1 before the fix are the required "failing before" evidence.
4. **First full integration run, exit 1: 2 failed, 1933 passed of 1935** (`31a-integration-run1-contract-exercise-stale-etag.log`). Both failures are in `contract.test.ts`:
   - "P4 KBE-E operations": `expected 409 to be 422`. The KBE-E exercise reused the pre-amendment ETag, which F-101 now correctly refuses;
   - "covers every operation …", which fails as a consequence.

   I fixed the exercise (§1) and ran the full suite again on the final code (row above). This was my own miss: I had not checked that exercise before the first full run.

**Pinned counts.**

- **Unit:** +1 test (the F-121 worked fixture): 2772 (vs 2771).
- **Integration:** +13 tests and +1 file over the frozen candidate's 1922:
  - `slice-b-denials.test.ts`: 7;
  - `corrections.test.ts`: 4;
  - benefits `totals.test.ts`: 1;
  - K1: 1.
- No pinned count in a test changed (`contract.test.ts` still pins 652 operations; the migration contiguity test sees 1..61).

## 4. Operations routed (pending-list delta)

None. Every `p4-pending-kbe-*.ts` list was already empty and stays empty. No operation was added or routed, and `contract.test.ts` is unchanged. `p4-exercises-kbe-e.ts` needed its post-amendment ETags corrected (§1). It still exercises `amendFinanceValidation` and `reverseFinanceValidation` with a success, and every success body against its zod mirror.

## 5. Contract, schema and integration needs (for the orchestrator)

1. **Schema need: migration `0061_p4_finance_validation_correction_step.sql`.** p4-work-split §B says an implementer's schema need goes to the orchestrator, who assigns a repair-range number. D-117's "bumps the original finance_validation row's version" is impossible under 0038's guard (a decided row raises `finance_validation_status_step`), so F-101 cannot close without it. I wrote it with the next free repair number (0058–0060 are used) and marked it **PROPOSED** in its header. Please confirm `0061` or renumber it, keeping S-12 contiguity. No other DG4 repair task in D-117 owns a migration. The change is one narrow branch; the rest of the function is 0038's verbatim (diff it against 0038 lines 370–420).
2. **Contract text: `FinanceValueLine.drilldownHref`.** It says "every class line and gross line carries one; null only on a net line". After D-117, a gross line whose state and currency include revenue-uplift or avoided-cost records cannot carry the five-class `value.<state>` drill. That drill would sum more than the line, breaking ADR-0037 K1's invariant, and no single `valueClass` covers three classes. I return `null` there (gross is then the exact sum of its three class lines, each of which drills), and keep the href where the drill sums exactly the gross records. ARCH-R4 is descriptions-only and runs in parallel. Either:
   - the description should say so ("null on a net line, and on a gross line whose value-state drill-down would include revenue uplift or avoided cost; that gross line is the sum of its three class lines"); or
   - a later contract change adds a multi-class drill (e.g. a `gross` drill metric or a repeatable `valueClass`). That is a schema change and was not made here.
3. **New audit action `finance_validation.corrected`.** It is on the original validation, with prior and new version and the correction's reason. No web label catalogue lists slice B audit actions today (the existing actions `finance_validation.amendment`/`.reversal` have none either), so nothing was added. FE may add EN/AR labels.
4. **Observation, not changed:** the DG3 business-case totals (`kpi/totals.ts`, `grossBenefits`) still sum all financial value bases into one gross per currency. They also report them apart (`grossBenefitsByValueBasis`). They are a DG3-approved operation outside D-117's scope ("the totals and the Finance dashboard"), so they were left byte-stable. The round-2 domain reviewer may want D-117's rule considered there too.
5. **Merge notes:**
   - ARCH-R4 edits only ADR text and `openapi.yaml` descriptions, so no file overlaps with this task.
   - FE-R4's labels read the existing class lines.
   - BE-R5 owns `tasks/routes.ts` (`completeWorkItem`), which I did not touch.
   - Run the migrations (`0061`) before the API.
   - `git status` in this worktree also lists `.bashrc`, `.gitconfig`, `.mcp.json`, `.vscode`, `CLAUDE.local.md` and similar untracked entries. They are the sandbox's `/dev/null` character-device mounts, not files of this task, so do not add them.

## 6. What remains

- The orchestrator's confirmation of migration number `0061` (§5.1) and the `drilldownHref` description (§5.2).
- qa-verifier's review of the one-line `a10` fixture change (§1).
- Nothing else in my section remains: F-101, F-100 (slice B) and F-121 are implemented, tested before and after, and byte-stability is evidenced.
