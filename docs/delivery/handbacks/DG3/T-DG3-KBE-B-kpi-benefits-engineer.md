# Handback T-DG3-KBE-B: business cases, single-class lines, totals and roll-up, baseline Finance validation (kpi-benefits-engineer)

- **Stage:** P3 / DG3 (BUILDING). **Task:** T-DG3-KBE-B.
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG3-T-DG3-KBE-B-kpi-benefits-engineer-20261007T231304Z-db3bcece","session_id":"db3bcece-4ec7-41cd-87db-1296caa49a6f"}`
- **Assignment:** `/home/user/My-owns/docs/delivery/assignments/DG3/T-DG3-KBE-B.md`. I checked its sha256 at the start: `0d6fddfb…6cc456`, as given.
- **Worktree:** `/home/user/wt/dg3-kbe-b`, branch `dg3/kbe-b`, `HEAD` = `8236d618cf4b36f07bdaa61c64f401314b481bcf`. I committed nothing.
- **Time:** start `Wed Oct  7 23:13:15 UTC 2026`, end `Wed Oct  7 23:52:10 UTC 2026` (`final.log`), about 39 minutes.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG2` → `PASS gate DG2 (historical)`, exit 0, both at the start and at the end (`T-DG3-KBE-B-evidence/validate-historical-DG2.log`).
- **Business approvals:** this is engineering work only. Product gates G1–G6 are business approvals inside the product. Every Finance validation in the tests is a demo decision by a synthetic FIN user and approves nothing real. Nothing here reads or writes the DG0–DG7 records.

All six scope items are done. Three files outside my ownership list had to change; §6 explains each one and asks the orchestrator to confirm them.

## 1. Changed files

| File | Purpose |
|---|---|
| `packages/shared/src/schemas/business-case.ts` (new) | Zod mirrors of the `business-cases` components: sections, case, create/update/page/list query, `FinanceValidationRequest`, line class enum, line, create/update/list, `MoneyTotal`, totals. It also holds the classification vocabulary: `VALUE_BASIS_BY_CLASS`, `kindOfClass`, `lineClassProblem`, and the section codes (`BUSINESS_CASE_SECTION_CODES`, `INITIATIVE_CASE_SECTION_CODES`) |
| `apps/api/src/modules/kpi/business-cases.ts` (new) | Seven operations: list, create, get, update, archive, totals, and baseline validation. It also exports helpers: `missingSections`, `baselineSha256`, `baselineValidationState`, `presentCases`, `includedCaseIds`, `loadCaseTotals`, the WL record-level check `requireCaseEdit`, and `lockCase`/`readCase` |
| `apps/api/src/modules/kpi/business-case-lines.ts` (new) | Four line operations: list, create, update, archive. Value rules and the one-formula-one-line check. Exports `toBusinessCaseLine` and `activeLinesOf` |
| `apps/api/src/modules/kpi/totals.ts` (new) | Pure totals and roll-up: `computeTotals`, `moneyTotals`, `netTotals`, `normaliseTitle`, `periodsOverlap` |
| `apps/api/src/modules/kpi/totals.test.ts` (new) | 20 unit tests with worked fixtures (§4) |
| `apps/api/src/modules/kpi/routes.ts` | Registration lines only: one import pair and one `routes.push(...)` line |
| `apps/api/src/modules/kpi/index.ts` | Export lines only, for KBE-C's G4 fact loader |
| `apps/api/test/integration/kpi/business-cases.test.ts` (new) | 17 integration tests (§4) |
| `apps/api/test/support/p3-pending-kbe-b.ts` | Now empty: all 11 operations are routed and exercised |
| `apps/api/test/integration/contract/p3-exercises-kbe-b.ts` | Exercises all 11 operations through `ctx.mirrored` and fills `P3_MIRRORS_KBE_B`. Also exports two fixtures the integration test reuses: `insertInitiative` (a draft initiative plus its audit event) and `financeUser` |
| `apps/api/test/integration/contract/contract.test.ts` | Only the two pinned counts (§5) |
| `packages/shared/src/schemas/index.ts` | **Not my file.** One export line (§6.1) |
| `apps/api/src/modules/kpi/kpi.test.ts` | **Not in my list.** The kpi module's pinned public surface and operation set (§6.2) |
| `docs/delivery/handbacks/DG3/T-DG3-KBE-B-*` | This handback and its evidence |

I added no migration and no dependency, and I changed neither `openapi.yaml` nor `schema.ts`.

## 2. Behaviour delivered, per requirement

### REQ-PB-053 ("ten sections; one investment class; SAR decimals") and REQ-S05-005 ("one class per line; total = distinct lines once")

**Ten sections.** `business_case` stores every B0085 section in the ADR-0024 §1 typed columns.

- The API takes and returns `sections` with all 17 fields.
- `missingSections` uses the codes `strategic_rationale`, `baseline`, `value_pools`, `interventions`, `investment`, `benefits`, `timing`, `risks`, `ownership` and `decision_ask`. It applies these rules:
  - Text sections must be non-blank.
  - Investment and benefits also need at least one active line of that kind.
  - Timing needs ramp, recurrence and horizon.
  - Risks needs assumptions, downside and upside.
  - Ownership needs all three owners, or for an initiative case the initiative owner and the finance validator.
  - Decision ask needs at least one ask type.
- Test: all ten sections round-trip through create and GET, `missingSections` goes from `[investment, benefits]` to `[]` once lines exist, and clearing a section with `null` brings back `["risks"]`.

**Exactly one class.** The request has a single string `class`.

- `class: ["capex","revenue"]` → **400**, with an error at `/class`.
- `investmentClass` plus `benefitClass` → **400**, again with `/class` among the pointers (strict object, missing `class`).
- A class that does not fit `lineKind` → **422** `business_case.line_class_mismatch` at `/class`.
- A value basis that does not fit the class → **422** `business_case.value_basis_mismatch` at `/valueBasis`. The pairs follow ADR-0024 §2, so revenue uplift stays apart from margin, avoided cost from cash saving, and cash from non-cash.
- The database stores the class in exactly one of `investment_class` / `benefit_class`, and the test reads both columns back. Kind and class cannot change on update; the update schema refuses them with 400.

**Amounts and other value rules.**

- Amounts are decimal strings fitting numeric(20,4): `"1.12345"` → 400, the JSON number `12` → 400, and `"-5"` → 422 `business_case.amount_negative`.
- `null` means Unknown, never 0.
- Currency is per line and configurable. A case defaults to the transformation's currency (SAR by default); a USD case is tested.
- FTE is numeric(6,2), allowed only on `internal_fte` lines (`business_case.fte_only_internal`) and must be greater than 0.
- A `strategic_non_financial` line with an amount → 422 `business_case.non_financial_amount`, because there is no monetisation without an approved valuation method.
- A period that ends before it starts → 422 `business_case.period_range`.

**One formula backs at most one line.** A second active line with the same `benefitFormulaId`, in any case of the transformation, → **409** `business_case.formula_already_linked`. The partial unique index in the database backs this up. A formula on an investment line → 422 `business_case.formula_only_benefit`.

### REQ-PB-054 ("transformation + initiative cases; roll-up without duplication")

**Transformation case.**

- At most one active case per transformation; a second → **409** `business_case.transformation_case_exists`.
- Archiving it while initiative cases link to it → 422 `business_case.has_initiative_cases`.

**Initiative cases.**

- Each needs `initiativeId`, which must name an initiative in the same transformation (otherwise 422 `validation.reference`).
- It needs an active transformation case. Without one → 422 `business_case.transformation_case_required`; with one, `parentCaseId` is set to that case.
- An initiative has at most one active case (409 `business_case.initiative_case_exists`).
- `missingSections` uses the lighter set: 1, 4, 5, 6, 7 and 9.

**Roll-up by reference** (`GET /business-cases/{id}/totals`).

- `includedCaseIds` is the case itself, then its active initiative cases.
- The line set is the active lines of those cases, deduplicated by line id. Nothing is ever copied.
- The test builds a transformation case with an office line and two initiative cases with the B0087 amounts 100000 and 500000:
  - The totals are gross 600000, cost 30200 and net 569800.
  - A direct SQL `count(DISTINCT id)`/`sum` over the same lines agrees.
  - Editing the initiative line to `150000.25` changes the roll-up to 650000.25 on the next read.
  - The table still holds exactly 4 lines.
  - Archiving the line removes it from the roll-up.

**Gross, cost and net are shown separately.**

- `grossBenefits` covers financial benefit lines, broken down by class and by value basis.
- `implementationCost` covers all investment lines, with `implementationCostCash` and `implementationCostNonCash` subtotals.
- `netValue` = gross − implementation cost, per currency. Each line is subtracted once.
- `margin_uplift` and `revenue_uplift` are reported separately, and a case holding both gets the warning `business_case.revenue_and_margin`.
- Non-financial benefits are counted in `nonFinancialBenefitCount` and never summed.
- `business_case.possible_duplicate` warns when a transformation-level line and an initiative line share class, normalised title and an overlapping period. Both lines still count; Finance resolves the overlap.

**Unknown is never 0.**

- A total whose lines are all Unknown has `amount: null`, with `unknownLineCount`.
- A partial total gives the known sum plus the unknown count.
- `netValue` is null unless both gross and cost have a known amount in that currency, because a case without cost lines has an unknown cost, not a zero cost.
- Totals are per currency with no FX. An empty case returns empty arrays, never `"0"`.

### REQ-PB-055 part ("Finance validation before G4; 'Finance validation'"): baseline only

- `POST /business-cases/{id}/baseline-validation` takes `{result, note}` and needs `finance.validate`.
- **The author gets 403** `finance.validator_is_author`, audited as `authorization.denied`. The test author is a FIN+TL user who created the case; this matches the DB CHECK `business_case_validator_not_author`.
- A TL without `finance.validate` → 403, and AUD → 403.
- `If-Match` gives 428/409. An empty baseline → 422 `business_case.baseline_missing`.
- On `validated`, the endpoint stores `baseline_validated_sha256` = SHA-256 (UTF-8) of `baseline_summary`. The test recomputes the hash and compares.
- `baselineValidation` reads `validated` only while the hash matches the current baseline. After a baseline edit it reads **`stale`** (it never counts and is never shown as validated). A title or other section edit keeps it `validated`. Re-validating makes it current again; `rejected` reads as rejected.
- Formula-version validation is KBE-C's and is not part of this task.

### Permissions (ADR-0024 §4) and mutation rules (ADR-0021 §10)

- **`business_case.edit`.**
  - TL and TO edit every case.
  - **WL is record-level:** when the right comes *only* from a WL grant, the caller may create and edit only the initiative case, and its lines, of an initiative whose `workstream_lead_user_id` is the caller. Anything else → 403 `business_case.not_initiative_lead` (tested).
  - Reads need `transformation.read`; without it the answer is 404.
- **AUD gets 403 on all seven mutation types**, audited as `authorization.denied` (tested). An AUD create without a usable `transformationId` is also 403, because the caller holds `business_case.edit` nowhere.
- **Commit-time authorization (BE18A).** Every mutation runs `openWrite(…, { atCommit: true })` inside its transaction.
  - The test blocks the handler on a table lock *after* the request was authenticated, revokes the caller's only grant, then releases the lock. All six item mutations answer 403, audited, with nothing written.
  - **Control run:** the same test with `atCommit` removed from line creation **fails**, answering 201 with the line written (`control-commit-time-without-atCommit.log`), so the test measures the re-check.
  - Create-case authorizes before it reads any `business_case` row, so the lock technique can't race it. It uses the same `openWrite` call with `atCommit`.
- **`If-Match`.** 428 when missing and 409 when stale, on update and archive of cases and lines and on the validation (tested). Creates answer version 1 with `ETag "1"`.
- **Audit.** Exactly one audit event per change: `business_case.create|update|archive|baseline_validate|baseline_reject` and `business_case_line.create|update|archive`, each with the `{field: {from, to}}` diff (tested).
- **Validation.** Zod first (400), then business rules (422).
  - Free text goes through `freeText`; a blank title → 400.
  - Strict UTF-8 parsing is the platform's; there is no route-local parser.
  - `config.consumes: ["application/json"]` is set on all seven body routes.
- **Transactions.** No client or remote I/O happens inside a transaction: the JSON body is fully parsed before the handler runs.
- **Idempotency.** `createBusinessCase` honours `Idempotency-Key` through `maybeIdempotent`, authorized again before the replay lookup.

## 3. Problem codes and English texts

The ADRs give no English text for most of these codes. I wrote the texts below; the architect may want to put them in ADR-0024. The two existing codes reuse the existing texts exactly: `finance.validator_is_author` uses the `db-errors.ts` mapping text, and `validation.reference` uses the register-kit text.

| Code | Status | English detail |
|---|---|---|
| `business_case.line_class_mismatch` | 422 | `The class {class} is not a {lineKind} class.` |
| `business_case.value_basis_mismatch` | 422 | `The value basis {valueBasis} does not fit the class {class}.` |
| `business_case.non_financial_amount` | 422 | `A strategic or non-financial benefit has no amount: it is not monetised without an approved valuation method.` |
| `business_case.amount_negative`, `.fte_only_internal`, `.fte_positive`, `.period_range`, `.formula_only_benefit` | 422 | See `business-case-lines.ts` |
| `business_case.formula_already_linked` | 409 | `This benefit formula already backs another active line; one benefit is counted in one line only.` |
| `business_case.transformation_case_exists`, `.initiative_case_exists` | 409 | See `business-cases.ts` |
| `business_case.transformation_case_required`, `.initiative_required`, `.initiative_not_allowed`, `.has_initiative_cases`, `.baseline_missing`, `.archived`, `.already_archived`; `business_case_line.archived`, `.already_archived` | 422 | See `business-cases.ts` and `business-case-lines.ts` |
| `business_case.not_initiative_lead` | 403 | `A Workstream Lead edits only the business cases of initiatives they lead.` |
| `finance.validator_is_author` | 403 | `Finance validation is done by someone other than the record's author (separation of duties).` (same as `db-errors.ts`) |
| Warnings `business_case.revenue_and_margin`, `business_case.possible_duplicate` | — | See `totals.ts` |

## 4. Tests

**Unit (`totals.test.ts`, 20 tests).**

- The B0087 playbook examples as line amounts: Δ attach × customers × ARPU = 0.02 × 100000 × 50 = **100000**, and volume × Δ unit cost = 200000 × 2.50 = **500000**. Together with a capex line: gross 600000, cost 150000, net 450000.
- A line handed in twice counts once; lines of cases that aren't included never count.
- 0.1 + 0.2 = 0.3 exactly, and the numeric(20,4) extremes `9999999999999999.9999 + 0.0001` = `10000000000000000`.
- The roll-up by reference, and editing an initiative line.
- The cash and non-cash subtotals, with net subtracting each line once.
- Revenue vs margin with its warning, avoided cost vs cash saving, and non-financial lines counted only.
- Unknown: all lines Unknown gives `null`, a partial total gives the known sum, a known 0 stays `"0"`, net is Unknown without cost, an empty case has no totals, and a negative net is reported as such.
- Per currency with no FX.
- The duplicate warning and its helpers.

**Integration (`business-cases.test.ts`, 17 tests):**

1. The ten sections persist and `missingSections` follows them.
2. One active transformation case (409); configurable currency; blank title → 400; unknown section key → 400.
3. The initiative case links to the transformation case and uses the lighter set; 422/409 cases; the archive guard.
4. **Total = distinct lines once; editing an initiative case line changes the roll-up without duplication.**
5. Unknown is never 0; per currency; revenue vs margin; non-financial.
6. **Two classes → 400; mismatch → 422**; the value rules; the database holds exactly one class column.
7. One formula backs one line (409).
8. **FIN baseline validation; author 403; hash stored; Stale after a baseline change.**
9. **AUD 403** on all seven mutation types, audited.
10. `If-Match` 428/409 and audit events.
11. WL record-level access.
12–17. Commit-time re-authorization for update case, archive case, validate baseline, create line, update line and archive line.

**Contract:** all 11 operations go through `ctx.mirrored`, and each success body is checked against its zod mirror (`P3_MIRRORS_KBE_B`).

## 5. Pinned contract counts (`contract.test.ts`; only these two assertions changed)

- **Media-type triple:** `[90, 89, 1]` → **`[97, 96, 1]`**. The seven new JSON bodies are `createBusinessCase`, `updateBusinessCase`, `archiveBusinessCase`, `validateBusinessCaseBaseline`, `createBusinessCaseLine`, `updateBusinessCaseLine` and `archiveBusinessCaseLine`.
- **Rate-limit floor:** `>= 167` → **`>= 178`**, that is 167 plus 11 KBE-B operations. The live sweep checked all of them.
- P3 pending for KBE-B: 11 → **0**.

## 6. Changes in files I do not own (please confirm or reassign)

1. **`packages/shared/src/schemas/index.ts`** (BE-A's). I added one line: `export * from "./business-case.ts";`, plus a comment. Without it the API can't import my zod mirrors through `@mth/shared/schemas`, because the package exports no deeper subpath, and the tree wouldn't typecheck. The change is additive, and no export name collides (checked). KBE-C will need the same line for `benefit-formula.ts`.
2. **`apps/api/src/modules/kpi/kpi.test.ts`** (the kpi module's P2 suite; not in any P3 owner list). It pins the module's public `index.ts` keys, the exact operation set (24) and the set of write permissions. Routing the 11 operations makes those pins wrong by construction. I added:
   - the 11 operation ids, so the operation count is now 35;
   - `business_case.edit` to the write-permission set;
   - the new export names to the public-surface list.

   The other assertions are unchanged. KBE-C will have to extend the same three pins.
3. **`apps/api/test/integration/contract/contract.test.ts`:** only the two pinned counts, as the assignment allows (§5).

**Requests for other owners:**

- **`@mth/shared/calc` is not on the API boundary allowlist.** `architecture.test.ts` (BE-A) failed `modules/kpi/totals.test.ts: imports package @mth/shared/calc` when my unit test imported `evaluateFormula`. I removed that import and use the engine's stored results `"100000.000000"` and `"500000.000000"` verbatim; the engine is tested in `packages/shared`. **BE-D and KBE-C will hit the same rule** when they import `@mth/shared/calc` in `apps/api/src/modules/**`. The orchestrator or BE-A should add `@mth/shared/calc` to the allowed packages in `architecture.testkit.ts`/`architecture.test.ts`.
- **ADR-0024 texts:** consider recording the §3 English texts, my choice to count the roll-up set for a transformation case's "≥ 1 line" check, and "net Unknown without both sides" (§7).

## 7. Interpretations and gaps

**Interpretations (please confirm):**

- `missingSections` for the *transformation* case counts the lines in its roll-up set (own lines plus initiative case lines) for the "≥ 1 active line" rule, because costs and benefits normally sit at initiative level. An initiative case counts its own lines.
- `netValue` is Unknown (`null`) unless both gross and cost have a known amount in that currency.
- The author for the baseline separation-of-duties rule is `created_by`, matching the DB CHECK. Someone who only edited the baseline later is not barred. ADR-0024 says "did not author the record"; tightening this to "last baseline editor" would need a new column.
- `rejected` stays `rejected` after a baseline edit. Only `validated` can become `stale`, because the DB requires the hash exactly when the status is `validated`.

**Not done:**

- Nothing in scope is left undone.
- The kpi half of `GateFactsProvider` (section completeness, baseline state, totals for G4) is KBE-C's; my `index.ts` exports are ready for it.
- Arabic text for the new codes is the web's job (FE-C), translated from `code`.

**Merge notes:**

- No migration and no dependency changes.
- KBE-C edits `kpi/routes.ts` and `kpi/index.ts` after this, as planned, and will also need the two shared touch points in §6.1 and §6.2.

## 8. Checks run

**Environment:** Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), pnpm, offline, PostgreSQL 16.13 through `tests/qa/support/with-pg.sh`, ports 23350–23399. Logs are in `docs/delivery/handbacks/DG3/T-DG3-KBE-B-evidence/`. The table shows the final run on the final tree.

| Command | Exit | Result | Log |
|---|---|---|---|
| `node tools/gates/validate.mjs --historical --stage DG2` (start and end) | 0 | `PASS gate DG2 (historical)` | `validate-historical-DG2.log` |
| `pnpm -r typecheck` | 0 | — | `typecheck.log` |
| `pnpm -r build` | 0 | — | `build.log` |
| `pnpm lint` | 0 | — | `lint.log` |
| `pnpm openapi:lint` | 0 | `OpenAPI 3.1.1, 270 operations` | `openapi-lint.log` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" (run last, after this file was written) | `prettier-ls-files.log` |
| `env -u LANG -u LC_ALL -u LC_CTYPE pnpm test` | 0 | 56 files, **1146/1146** tests | `unit-locale-unset.log` |
| `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | 0 | 56 files, **1146/1146** tests | `unit-c-utf8.log` |
| `QA_PG_PORT=23370 MTH_PORT_POOL=23371-23399 tests/qa/support/with-pg.sh pnpm test:integration` | 0 | 43 files, **655/655** tests; "applied 25 migrations to a fresh database"; `business-cases.test.ts` 17 tests | `integration.log` |

**Count deltas.** Unit tests went from 1123 (ARCH-02) to 1146 (+23): `totals.test.ts` adds 20, and the existing "never a float" source scan in `kpi.test.ts` now also covers my three new non-test kpi sources (+3). Integration tests went from 638 to 655 (+17).

**Earlier non-zero exits** (all disclosed; each was fixed before the final runs above):

1. **Control runs (deliberate):** `atCommit` was temporarily removed from line creation, and the commit-time test failed as intended (`control-commit-time-without-atCommit.log`: 201 instead of 403). The source was restored, which `grep -c "atCommit: true"` confirmed (3 before and after).
2. **First lock-based attempt:** exit 1, `expected false to be true`. The blocked request was looked for through `pg_stat_activity`, which the owner role can't fully see. I switched to `pg_locks`. An even earlier streamed-body variant passed, but its control answered 404, not 201, because identity resolves in `preValidation` after the JSON body is read. So it didn't isolate the commit-time re-check, and I replaced it.
3. **First full unit run:** exit 1, 6 failed out of 1146.
   - The `@mth/shared/calc` import rule (§6), fixed by removing the import.
   - The kpi pins (§6.2).
   - Empty `.claude/.cc-writes` session directories, created in source folders when my shell's working directory moved into them. I removed them; they were never project files.
4. **First full integration run:** exit 1, 1 failed out of 655. That was the media-type triple, which §5 then updated (`integration-run1-failed.log`).

**Log scan of `integration.log`** for "unhandled", "timeout" and "failed to": the only matches come from passing DG2 tests that print expected output (the BE17 ECONNRESET probe, the requestTimeout 408 probes and the bounded-checkout tests). No suite failed and no hook timed out.

**End:** `date -u` and the final validator and Prettier results are recorded in `final.log`.
