# Handback T-DG5-KBE-B — the eleven field-type validators (kpi-benefits-engineer)

- **Stage:** P5, gate DG5 (BUILDING). Task T-DG5-KBE-B, `docs/architecture/p5-work-split.md` §B.1.
- **Invocation:** run `DG5-T-DG5-KBE-B-kpi-benefits-engineer-20261014T022835Z-b620d6ae`, session `b620d6ae-b14e-46c8-bfa5-66dc62e1471d`.
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-KBE-B.md`, sha256 `ae77b8a1a43f3f67b793b8d31a71a0484ae9735c479eb604a2cd57eb078ac8bb` (verified).
- **Base:** worktree `/home/user/wt/dg5-kbe-b`, branch `dg5/kbe-b`, `HEAD` `a8185879df98425573557460959752edc23788da` (D-144). Changes are **uncommitted**.
- **Time:** start `2026-10-14T02:28:47Z`, end `2026-10-14T03:33:15Z`; about 65 minutes (`date -u`).
- **Calculation specification:** `docs/architecture/adr/ADR-0041-p5-form-schemas-field-types-custom-fields-form-framework.md` §3, §7, §10 (binding), implemented in `packages/shared/src/forms/**`. The rules this module adds are listed in §6 below.
- **Fixtures:** `packages/shared/src/forms/*.test.ts` (worked fixtures, including the playbook examples Δ attach × customers × ARPU and volume × Δ unit cost, in `calculated.test.ts`).
- **Test output:** `docs/delivery/handbacks/DG5/T-DG5-KBE-B-evidence/` (§3).

Product gates G1–G6 are business approvals inside the product. This task grants none and touches none; it reads and writes no DG0–DG7 record. No fixture is real business data: every value in the tests is synthetic.

## 1. Files changed

| File | Purpose |
|---|---|
| `packages/shared/src/forms/field-types.ts` (new) | The eleven types; the exact ADR-0041 §10 codes and English texts; the Zod settings schema of each type; `parseFieldSettings`/`defineField` (422 `form_schema.field_type_unknown` / `form_schema.field_settings_invalid`). |
| `packages/shared/src/forms/normalize.ts` (new) | `normalizePercentage` (`"12%"`/`"12"`/`"0.12"` → fraction `"0.12"`, decimal.js, never rounded), `normalizeCurrency` (`{amount, currencyCode}`, amount verbatim), `normalizeDate`, `fieldDateOf` (calendar date in the transformation timezone, default Asia/Riyadh), `fractionToPercent`. |
| `packages/shared/src/forms/validate.ts` (new) | `validateFieldValue` (value → `{ok, value, checks}` or the type's field code and exact text) and `validateRecordValues` (record level: 422 unknown/calculated key, 400 field codes, 422 missing required). |
| `packages/shared/src/forms/calculated.ts` (new) | Wrapper over the DG3 formula engine (unchanged): `numericFieldsOf`, `validateCalculatedField` (definition time, 422 `form_schema.calculated_formula_invalid`), `evaluateCalculatedField` (read time; missing input → `not_computable` with the missing names), `toCalculatedEntry` (the OpenAPI `FormCustomValues.calculated` shape). |
| `packages/shared/src/forms/index.ts` (new) | The `forms/**` barrel. |
| `packages/shared/src/calc.ts` | The one `forms/**` export line (p5-plan §5.3), with a comment. Nothing else in the barrel changed. |
| `packages/shared/src/forms/field-types.test.ts` (new) | 39 tests: catalogue, exact texts, defaults, every settings refusal with its path. |
| `packages/shared/src/forms/validate.test.ts` (new) | 103 tests: the REQ-S06-005 fixtures, every type's refusal with its exact code and text, Unknown never 0, record level. |
| `packages/shared/src/forms/normalize.test.ts` (new) | 18 tests: percentage, currency, dates in the timezone. |
| `packages/shared/src/forms/calculated.test.ts` (new) | 22 tests: unknown variable refused, playbook examples, missing input, division by zero, no FX, unit kind. |
| `packages/shared/src/forms/property.test.ts` (new) | 6 seeded property tests (3000 cases each; mulberry32, no new dependency). |
| `docs/delivery/handbacks/DG5/T-DG5-KBE-B-kpi-benefits-engineer.md` (new) | This handback. |
| `docs/delivery/handbacks/DG5/T-DG5-KBE-B-evidence/*.log` (new) | The check logs of §3. |

No file outside my ownership changed. No migration, no route, no OpenAPI change, no dependency. `packages/shared/src/formula/**` is unchanged (shared rule 9; `git diff --stat` lists only `calc.ts`). The untracked `.zshrc` and `CLAUDE.local.md` at the worktree root, like the other untracked dotfiles, are harness files that were there before this run and are not mine.

## 2. Behaviour delivered, per requirement row

### REQ-S06-005 (KBE-B: validators; BE-D: wiring and calculated fields)

Acceptance text (verbatim): *"A05;A06: a percentage field entered as 12% stores 0.12; a currency field stores decimal SAR without float error; a calculated field referencing an unknown field is rejected"*. Description: *"Each type has server-side validation; percentage is stored as a fraction and currency as decimal with currency code; calculated fields use the safe formula engine"*.

| Clause | What the code does | Test |
|---|---|---|
| "a percentage field entered as 12% stores 0.12" | `validateFieldValue(percentage, "12%")` → `"0.12"`; `"12"` typed by a user (`percentageBareAs: "percent"`) → `"0.12"`; `"0.12"` in an API body → `"0.12"`. decimal.js only. A fraction needing more than 6 decimals is refused, never rounded. | `validate.test.ts` "REQ-S06-005 acceptance fixtures"; `normalize.test.ts`; `property.test.ts` (3000 random percents, expected values computed by moving the decimal point in the string) |
| "a currency field stores decimal SAR without float error" | `{amount: "1500000.10", currencyCode: "SAR"}` is returned unchanged and survives a JSON round trip exactly. `"999999999999999.99"` (17 significant digits, beyond a binary float) stays exact. A JSON number amount is refused (`validation.currency_amount`). | `validate.test.ts`; `property.test.ts` (3000 random amounts round-trip; 3000 amounts with a third decimal refused) |
| "a calculated field referencing an unknown field is rejected" | `validateCalculatedField({expression: "volume * unknown_field", …})` → 422 `form_schema.calculated_formula_invalid` with the engine's `formula.undefined_variable`. | `calculated.test.ts` |
| "each type has server-side validation" | Each of the ten stored types refuses with its exact ADR-0041 §10 code and English text; `calculated` is never stored. | `validate.test.ts` (one `describe` per type) |
| "calculated fields use the safe formula engine" | `validateFormula`/`evaluateFormula`/`parseFormula` from `packages/shared/src/formula/**`, unchanged. No eval and no generated code: the engine's no-codegen guarantee covers it. | `calculated.test.ts` (including `eval(volume)` refused as not a function of the language) |
| Arabic-Indic digits (p5-work-split §B.1) | A number with any Arabic-Indic (or Persian or full-width) digit → `validation.decimal`. In a percentage it is `validation.percentage`, and in a currency amount `validation.currency_amount`: each type's own code, see §6 item 1. | `validate.test.ts`; `property.test.ts` (3000 cases, one digit replaced at a random position) |

**REQ-S06-005 is not complete with this task.** It completes when BE-D wires these validators into `forms/custom-values.ts` and `forms/provider.ts` and its API tests pass (p5-work-split §B.7).

### REQ-S16-010 (owned by BE-D; this task supplies the rule)

`validateRecordValues` is the "before persistence" part of ADR-0041 §4: unknown and calculated keys → 422 `form_record.custom_field_unknown`; invalid values → 400 `validation` with each field's code; missing required fields → 422 `form_record.custom_field_required`. The literal acceptance test, and the database refusing the value when the API check is bypassed, belong to BE-D.

## 3. Checks actually run

Environment: Node 24.21.0, pnpm 10.33.0, offline, worktree `/home/user/wt/dg5-kbe-b`. Logs are in `docs/delivery/handbacks/DG5/T-DG5-KBE-B-evidence/`.

| # | Command | Exit | Result / counts | Log |
|---|---|---|---|---|
| 0 | `node tools/gates/validate.mjs --historical --stage DG4` (start) | 0 | `PASS gate DG4 (historical)` | `validate-dg4-start.log` |
| 1 | `pnpm -r typecheck` | 0 | all packages | `typecheck.log` |
| 2 | `pnpm -r build` | 0 | all packages | `build.log` |
| 3 | `pnpm lint` | 0 | `eslint . --max-warnings=0` | `lint.log` |
| 4 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" | `prettier.log` |
| 5 | `pnpm openapi:lint` | 0 | contract unchanged | `openapi-lint.log` |
| 6 | `pnpm test`, locale unset (`env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE`) | 0 | unit-node 96 files / **1806** passed; unit-web 69 / 1358 passed; unit-formula-nocodegen 3 / 259 passed + 2 skipped (by design) | `unit-locale-unset.log` |
| 7 | `pnpm test`, `LANG=C.UTF-8 LC_ALL=C.UTF-8` | 0 | the same: 1806; 1358; 259 + 2 skipped | `unit-c-utf8.log` |
| 8 | `QA_PG_PORT=23850 MTH_PORT_POOL=23851-23899 tests/qa/support/with-pg.sh pnpm test:integration` | 0 | PostgreSQL 16.13 disposable cluster (UTF8, C) on port 23850; **210 files / 2031 tests passed** (equal to the D-144 merged tree: no integration test added or removed); `contract.test.ts` 72/72 green; duration 1571 s | `integration.log` |
| 9 | `node tools/gates/validate.mjs --historical --stage DG4` (end) | 0 | `PASS gate DG4 (historical)` | `validate-dg4-end.log` |

- **Unit delta:** unit-node 1618 (D-144 merged tree) → 1806, that is +188, all of them the new `packages/shared/src/forms/*.test.ts` files (39 + 103 + 18 + 22 + 6). unit-web and nocodegen are unchanged. The forms tests are not in the nocodegen project, whose glob is `packages/shared/src/formula/**`. The engine they call is covered there.
- **Pinned counts:** no change. There is no new operation (contract 724), no media-type triple or rate-limit floor delta, and no catalogue or seed pin.
- **Intermediate failures (disclosed):**
  - My first runs of the new tests failed twice before the final green run, both inside `packages/shared/src/forms`.
  - (a) `parseFieldSettings("percentage", {max: "12%"})` threw a `DecimalError`: Zod 4 runs an object-level refinement even after a member has failed. This was a real defect. `boundsOrdered` and the date-bounds refinement now compare only valid values, and the test stays as a regression test.
  - (b) A test fixture used `resultUnitKind: "number"`, which is not an ADR-0037 N5 unit kind. The fixture was fixed to `"other"`; the code was right to refuse it.
  - No flaky test and no timeout in the cited logs. The property tests carry an explicit 60 s timeout (about 1.5 s idle) so that load cannot make them flaky (F-DG4-143).
- **Harness cleanup before the tests:** removed the empty `packages/shared/src/forms/.claude/.cc-writes` and `packages/shared/.claude/.cc-writes` folders (and their empty `.claude` parents). The write harness had created them in source folders.

## 4. Operations routed (delta to the pending list)

None. §B.1 assigns KBE-B no operation, and there is no `apps/api/test/support/p5-pending-kbe-b.ts` (`ls apps/api/test/support | grep p5`). The pending lists are unchanged, and `contract.test.ts` stays green inside the integration run (§3 #8).

## 5. Contract, schema or dependency needs (for the orchestrator)

1. **Conflict: `choice` with `multiple: true` cannot be stored.** ADR-0041 §3 says a choice value is "one `value` (or an array when `multiple: true`)". The `0068` guard `form_custom_value_type_shape` accepts a choice value only as a string of 1–100 characters (`WHEN 'choice' THEN jsonb_typeof(val) = 'string' …`).
   - The validators follow the ADR: the `multiple` setting is accepted, and an array of unique listed values is validated. Persisting such a value would hit the database guard, which is a programming error per C.6 item 2.
   - **Decision needed** before BE-D wires choice fields, either (a) or (b):
     - (a) a forward-only slice B migration that widens the guard to an array of strings for a `multiple` field (`0068` is merged and is never edited); or
     - (b) refuse `multiple: true` in the settings for P5. That is a one-line change in `choiceSettingsSchema`, and I can make it if the orchestrator chooses (b).
2. **Web problem keys (FE-A owns `apps/web/src/i18n/*/problems.json`, D-144).**
   - Missing in en and ar: `problems.validation__text`, `validation__rich_text`, `validation__currency_amount`, `validation__currency_code`, `validation__percentage`, `validation__attachment`, `validation__lookup`, `validation__choice`, plus the 422 codes the validators return: `form_schema__field_type_unknown`, `form_schema__field_settings_invalid`, `form_schema__calculated_formula_invalid`, `form_record__custom_field_unknown`, `form_record__custom_field_required`. The English texts are in `FIELD_VALUE_MESSAGES`/`FORM_SCHEMA_MESSAGES` (exactly ADR-0041 §10).
   - Three keys already exist with DG2–DG4 texts that differ from ADR-0041 §10:
     - `validation__decimal`: "Enter a number with digits and a dot for decimals." The ADR text is "Enter a number within the allowed range, with at most the allowed decimals."
     - `validation__date`: "Enter a valid date." The ADR text is "Enter a valid date as YYYY-MM-DD."
     - `validation__reference`: an existing DG2 key.
   - These keys are shared with DG2–DG4 forms, so changing them is a cross-stage text decision for the orchestrator or FE-A. I changed nothing. The API `detail` uses the exact ADR text, because the validators return it.
3. **The record-level 400 uses the existing `validation` problem code** (`problems.validation` in `apps/api/src/modules/platform/problem.ts`), with the field codes in `errors[]`. No new code.
4. **No dependency is needed.** decimal.js 10.6.0 and zod 4.1.12 are already `@mth/shared` dependencies. The property tests use the seeded-PRNG precedent.

## 6. Rules this module adds (each needs a reviewer's eye; none contradicts ADR-0041)

1. **Codes per type.** Arabic-Indic digits are refused with the field type's own code: `validation.decimal` for a number, `validation.percentage` for a percentage, `validation.currency_amount` for a currency amount. This follows "every type's refusal returns its exact code". The literal §B.1 test ("refused with `validation.decimal`") is pinned for the number type.
2. **The text code covers every text failure.** Text and rich text return `validation.text`/`validation.rich_text` for every failure, with `params.reason` ∈ `too_short`, `too_long`, `blank`, `invalid_character`, `not_a_string`. The shared predicates `hasVisibleContent` and `hasInvalidCharacter` are reused (rule 1), and text is stored verbatim.
3. **Rich text is the DG2 subset, which is plain text.** No DG2 sanitizer exists. DG2 "rich text" columns such as T03 `gap` are `freeText(1, 20000)` plain text, stored verbatim and rendered escaped. `rich_text` is validated the same way, up to 20000 characters.
4. **One currency per field (no FX).** A currency value whose code differs from the field's `currencyCode` is refused with `validation.currency_code` (`reason: currency_mismatch`). An absent code takes the field's currency, which defaults to the transformation currency and then to SAR. The amount is kept verbatim, and its significant decimals must be within `scale` (default 2).
5. **How a percentage is read.**
   - With a percent sign (`%` or the Arabic `٪`), the value is a percent.
   - A bare value is a fraction in an API body (the default, ADR-0041 §3 "the API body carries the fraction") and a percent when typed by a user (`percentageBareAs: "percent"`, for the web).
   - Bounds are fractions, default 0–1.
6. **Attachments.** An empty attachment array, or a duplicate id, is refused (`validation.attachment`); null clears the field. Ids are lower-cased.
7. **Lookups.**
   - `users` and `business_units` take uuids, and `currencies` takes ISO 4217 letters. The other sets take a 1–100-character token.
   - Membership ("an active member") is checked only when the caller passes the members. Otherwise the caller gets a `checks` entry and must verify it in its transaction.
   - References and attachments always return `checks` entries (same transformation, right record type, evidence). A pure function cannot verify them, and they are never skipped.
8. **Calculated fields.**
   - The variables are the numeric fields the expression references: number → `number`, percentage → `fraction`, currency → `currency` in its code. The period is `none`.
   - Calculated fields are never variables, so there is no chain and no cycle.
   - Declaring only the referenced fields avoids the engine's 30-variable limit on wide record types.
   - The result kind must agree with `resultUnitKind` (ADR-0037 N5): only a currency result is `currency`, and a `percentage` result must be fraction-like.
   - At read time, these give `not_computable`, never 0: a missing, null or malformed input, or a currency input in another currency (named in `missingFields`); division by zero; an out-of-range result.

## 7. User-facing texts made untrue

None. This task ships pure functions and no screen.

- `admin.plannedSections` ("Methodology, forms, workflows, automation and branding settings are planned for later releases.") stays true until FE-B/FE-C ship the Studio and forms screens (D-144 note on BE-A).
- No other en/ar string mentions field types.

The missing problem keys are listed in §5 item 2 for FE-A.

## 8. What remains

- **Inside this task:** nothing.
- **For REQ-S06-005 to complete:** BE-D's wiring (`forms/custom-values.ts`, `forms/provider.ts`) and its literal API tests (p5-work-split §B.2).
- **For the orchestrator:** the decision on §5 item 1 (multi-choice storage).
- **For FE-A:** the problem keys of §5 item 2.

## 9. Merge instructions

- No migration and no ordering constraint. This task is first in slice B, before BE-D.
- The only shared file is `packages/shared/src/calc.ts`: my 3 appended lines (comment and `export * from "./forms/index.ts";`). If another task appends to the barrel, keep both blocks.
- The new exports go through `export *`. Before naming new exports, a later task should check them for collisions with `FD`, `DEFAULT_CURRENCY`, `DEFAULT_TIME_ZONE`, `UUID_PATTERN`, `CurrencyValue`, `FieldProblem`, `DeferredCheck` and `NumericField`. Typecheck and build are green today.
