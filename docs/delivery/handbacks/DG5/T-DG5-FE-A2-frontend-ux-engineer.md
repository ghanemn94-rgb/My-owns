# Handback: T-DG5-FE-A2 (frontend-ux-engineer), P5 repair task (D-149, web files only)

- **Stage:** DG5 (P5), wave W7. **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG5-T-DG5-FE-A2-frontend-ux-engineer-20261014T174650Z-8e39c4a4","session_id":"8e39c4a4-e6be-4471-a76e-befc87dcc6db"}`
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-FE-A2.md`, sha256 `cf8bb06b…3a923`, verified at the start.
- **Base:** branch `dg5/fe-a2`, `HEAD` = `09b7428fd6168963452ee6cd2a5702b156ae05fa`. The changes are **uncommitted**, as the assignment requires.
- **Time:** started `2026-10-14T17:47:04Z`; the last check finished at `18:54:51Z`, about 68 minutes in total. That is inside the roughly 100-minute checkpoint.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG4` printed `PASS gate DG4 (historical)` and exited **0**. Log: `T-DG5-FE-A2-evidence/validate-historical-DG4.txt`.
- **No commit, no dependency, no secret, no CDN.** No business, Finance or IT approval is granted. All e2e data is synthetic seeded dev data.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/web/src/i18n/ar/prioritization.json` | Repair 1. `weights.intro` now writes `التحوّل` (with the shadda), as the glossary does. |
| `apps/web/src/lib/auditChanges.ts` | Repair 2. Adds a new `P5_FIELDS` block (42 field specs) to `FIELDS`, and exports `AUDIT_CONFIG_KINDS`, the seven configuration kinds (from `CONFIG_REVIEW_POLICY_KINDS`).<br>`config_kind` is a closed enum over those seven kinds. `kind` keeps its P3 spec; its value labels now also cover the seven kinds.<br>`scope_level`, `subject_type` and `validation_result` are closed labelled enums. `plan_ready` and `enabled` are shown as yes/no.<br>Ids, hashes, revisions and counts are shown as exact LTR codes. Reviewers and publishers are shown as users. `field_values` is shown as compact JSON. |
| `apps/web/src/i18n/{en,ar}/transformations.json` | Repair 2, en and ar. New labels: 30 actions, 42 fields, the 7 kind values, 3 dry-run outcomes, 2 subject types, 2 validation results, 3 scope levels and 7 statuses (`in_review`, `published`, `discarded`, `executed`, `required`, `satisfied`, `done`).<br>One existing string corrected: `audit.actions.transformation_config_pin_create` (see §6). |
| `apps/web/src/lib/auditChanges.p5.test.ts` (new) | Repair 2's unit test: 15 tests, in en and ar (see §2). |
| `apps/web/e2e/p5-shell.spec.ts` | Repair 3. The 14-page test is now 11 tests: one per area landing page (10), plus one for the navigation and placeholder checks. Every assertion is kept and no timeout is raised. |
| `docs/delivery/handbacks/DG5/T-DG5-FE-A2-evidence/**` | Logs, screenshots and the label-gap scan. |

## 2. Behaviour delivered (D-149's three repairs)

None of the three repairs is a requirement row of its own. Each restores the acceptance of a row that a W6 merge broke.

### Repair 1: glossary (REQ-PB-003, glossary test; REQ-S15-007)

- **Reproduced:** the Arabic `prioritization.weights.intro` contained `عند إنشاء التحول (الافتراضي`, which `glossary.test.ts` › "spells the Transformation term consistently" rejects.
- **Fixed:** it now reads `التحوّل`.
- **Wider check:** I searched every Arabic UI catalogue for `تحول` not followed by a shadda. There are zero hits after the fix. `glossary.test.ts` passes: 8/8, in both test runs (§3).
- **Outside my ownership:** the same spelling appears 84 times in merged SQL migrations. These are Arabic database labels, such as permission names, role names, the `0068` form record names, `0069` procedure names and `0086` health bands. The list is in `T-DG5-FE-A2-evidence/unshadda-term-in-migrations.txt`. Those migrations are forward-only and outside a web-only task, so this goes to the orchestrator (§5). There are also two test fixtures, `apps/api/test/support/procedures-fixtures.ts` and the `invalid-utf8`/request-encoding tests. They are synthetic test strings that no user sees, and I left them alone.

### Repair 2: audit-trail labels (REQ-S15-007)

REQ-S15-007's acceptance text: *"A20;A15: a test finds no missing ar or en key; a validation error returned by the API is shown in the selected language; an Arabic export keeps 'KPI-001' and '12.5%' readable"*. The audit-trail rule behind this repair is M0302 / F-DG1-005: nothing on the trail is "without a translation".

- **Reproduced:** `transformation_config_pin.create`, written by `forms/pin-initializer.ts` at instantiation, carries `kind: form_schema`, `methodology_version_id` and `version_no`. `FIELDS` had no `methodology_version_id`, and `transformations.audit.value.kind` had no `form_schema`. The trail therefore showed both marked as untranslated.
- **How I scoped the gap:**
  - The trail shows every `audit_event` that has a `transformation_id` (`audit/index.ts` `listTransformationAudit`).
  - I scanned every API file changed since the DG4 approval, using the TypeScript AST, for audit events that carry a `transformationId`.
  - From the migrations in scope (`0062`–`0091`), only `0065` writes events with a transformation id. Its `transformation_config_pin.create` has no changes, and its `scoring_weight_set.create` uses the `weights` field, which was already labelled. The other SQL audit inserts in these migrations are organization-level seeds without a transformation id.
  - The P5 events that carry a transformation id come from: `methodology/migrations.ts`, `reapproval.ts` and `revision-impact.ts`; `forms/pin-initializer.ts`, `custom-values.ts`, `comments.ts` and `attachments.ts`; `automation/rules.ts`, `lifecycle.ts` and `dry-run.ts`; and the P5 line in `workflows/gates.ts` (`gate_reapproval.satisfy`).
- **What is labelled now, en and ar:** every action, field and enum value of those events, and all seven configuration kinds (`methodology`, `scoring_defaults`, `form_schema`, `procedure`, `automation_rule_set`, `health_check_scheme`, `benefit_formula`), both as `kind` and as `config_kind`.
- **The unit test (`auditChanges.p5.test.ts`, 15 tests):**
  - It reads those ten API source files.
  - It extracts every action literal on an `action:` line and every literal change key (`key: { from: … }`).
  - It fails when any of them has no label, in either locale. It also fails on any action of the explicit P5 list without a label; that list includes run-time ones such as `methodology_migration.preview` and `${store}.create/remove`.
  - It fails on any of the seven kinds or other P5 enum values without a label, and when an action literal in those files is missing from the list. It also re-creates the exact D-149 event.
- **Proof that the test fails without the fix:** I removed `methodology_version_id` from `P5_FIELDS` and deleted en `value.kind.form_schema`. Result: **9 failed / 6 passed**, exit 1. Both files were then restored. Log: `T-DG5-FE-A2-evidence/unit-p5-audit-mutation.txt`.
- **e2e:** `journeys.spec.ts` › "a business-unit Lead creates a record…" now passes in chromium-en and chromium-ar. On the trail the event reads:
  - EN: "Configuration version pinned · Version: None → 1 · Type: None → Forms configuration · Configuration version: None → 01920005-…0001"
  - AR: "ثُبّت إصدار الإعدادات · النوع: إعدادات النماذج"
  - Screenshots: `T-DG5-FE-A2-evidence/screenshots/en-17-lead-audit-trail.png` and `ar-17-lead-audit-trail.png`. I opened both and checked them.

### Repair 3: the landing-page e2e budget (REQ-S03-007)

REQ-S03-007's acceptance text: *"The shell shows the fourteen areas with their source-defined contents; areas and items the user cannot access are hidden server-side"*.

- The single test that visited 14 pages is now **11 tests**, one per area landing page plus one for the navigation and the reader placeholder.
- **Every assertion is kept:** h1, the "will contain" h2, the §3 contents in order, axe and a screenshot per area; no "planned" tag; the reader placeholder (title, not-available texts, no form or table, axe, screenshot); the seven P5 navigation entries; `dir`; no `DG0–DG7` text; no foreign requests.
- **Added to each area test:** the `dir`, no-`DG` and foreign-request checks, which used to run only on the last page.
- **No timeout was raised.** The slowest area test took 3.0 s, against the 30 s budget.

## 3. Checks actually run (`T-DG5-FE-A2-evidence/`)

| Check | Exit | Result / log |
|---|---|---|
| `node tools/gates/validate.mjs --historical --stage DG4` | 0 | `PASS gate DG4 (historical)`. Log: `validate-historical-DG4.txt` |
| `pnpm -r build` | 0 | `build.txt` |
| `pnpm -r typecheck` | 0 | `typecheck.txt` |
| `pnpm lint` | 0 | `lint.txt` (run again after the prettier fix: exit 0) |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | **123** on the first run, then **0** | The first run flagged my new test file, logged in `prettier-first-run-exit123.txt`. I ran `prettier --write` on that one file and re-ran the check: exit 0, logged in `prettier.txt`. |
| `pnpm openapi:lint` | 0 | `PASS … OpenAPI 3.1.1, 846 operations`. Log: `openapi-lint.txt` |
| `pnpm test`, locale unset (`env -u LANG -u LC_ALL -u LC_CTYPE`) | 0 | Three Vitest invocations: 102 files / **1854** passed; 72 / **1400** passed; 3 / **259** passed + 2 skipped. The 2 skips are pre-existing, in `packages/shared/src/formula/fuzz.test.ts`. Log: `test-locale-unset.txt` |
| `pnpm test`, `LANG=LC_ALL=C.UTF-8` | 0 | Same counts: 1854 / 1400 / 259 + 2 skipped. Log: `test-c-utf8.txt` |
| `QA_PG_PORT=23960 MTH_PORT_POOL=23961-23999 tests/qa/support/with-pg.sh pnpm test:integration` | 0 | 224 files / **2187** passed. No pinned count changed. Log: `integration.txt` |
| `E2E_PG_PORT=23950 E2E_API_PORT=23951 MTH_PORT_POOL=23952-23999 apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e/journeys.spec.ts apps/web/e2e/p5-shell.spec.ts --workers=1` | 0 | **42 passed** (2.8 min), chromium-en and chromium-ar, with axe. The axe summaries show no violations; the files are `screenshots/{en,ar}-axe-summary.json`. Log: `e2e-journeys-p5-shell.txt` |
| Mutation check of the new unit test | 1 (expected) | 9 failed / 6 passed. Log: `unit-p5-audit-mutation.txt` |

- **unit-web count delta:** +15 tests (the new file). The other unit tests are unchanged.
- **Ports:** only 23950–23999 were used. Empty `.claude/.cc-writes` directories were removed before the tests; none were found.
- **Before running:** the unit-web subset (`src/lib/auditChanges*`, `src/i18n`) passed with 182 tests before the full runs.

## 4. Operations routed

None. This task routes no operation and has no `p5-pending-*.ts` list, so the pending-list delta is empty. The `contract.test.ts` pins are unchanged.

## 5. For the orchestrator (contract, schema, dependency, ownership)

- **No contract, schema or dependency need.**
- **`تحول` without the shadda in merged migrations:** 84 lines, listed in `unshadda-term-in-migrations.txt`. They are Arabic labels a user sees in the database, such as role names (`قائد التحول`, `مكتب التحول`), permission names, form record and procedure names, the health-band texts and the `0064` source inventory. Fixing them needs a forward migration that updates the `*_ar` columns, owned by a backend or architecture task. I edited none of them.
- **DG4-era audit-label gaps found by the same scan, outside this task's P5 scope.** Log: `label-gap-scan.txt`; the script is `label-gap-scan.mjs`.
  - `workflows/gates.ts`:
    - actions `gate_decision_scale_scope.create` and `gate_decision_condition.create`;
    - fields `approverUserId`, `supersededBySubmissionNo`, `approverBasis`, `scaleScope` and `gate_decision_id`.
  - `workflows/approvals.ts`, fields: `approval_type`, `assignee_party_code`, `assignee_user_id`, `assignee_group_id`, `due_unknown_reason`, `sod_policy`, `round_no`, `on_behalf_of_user_id`, `defer_until` and `decided_on_behalf_of`.
  - `tasks/service.ts`:
    - action `work_item.reschedule`;
    - fields `assignee_user_id`, `dedupe_key` and `recipient_user_id`.

  These events carry a transformation id, so they would show "without a translation" on a trail once they occur. The journeys e2e doesn't create them. Adding them is a small change to the same two web files. I did not do it, so as to stay inside D-149's scope, and I propose it as a follow-up for a frontend task.
- **Not on any trail:** `methodology/reviews.ts` (`config_review_request.*`) and `automation/versions.ts` write no transformation id, so their unlabelled actions never reach a transformation's trail. A future organization-level audit view would need labels for them.
- **Arabic labels:** the new Arabic labels follow the glossary and the existing nav terms (`استوديو الدليل`, `ترحيل المنهجية`, `فحص سلامة التحوّل`). Like the glossary itself, they still need a review by a Mobily Arabic-language owner.

## 6. User-facing texts made untrue, and what I did

- `transformations.audit.actions.transformation_config_pin_create` said "Methodology version pinned" (ar `ثُبّت إصدار المنهجية`). That has been untrue since W4/W6: the same action now pins the `form_schema` and `scoring_defaults` kinds too.
- I changed it, in both languages, to "Configuration version pinned" / `ثُبّت إصدار الإعدادات`. The trail row now also names the kind in a separate field.
- No other en/ar string calls a shipped feature planned because of this task.

## 7. What remains

- Nothing from the assignment's three repairs.
- The follow-ups in §5 are outside the assigned scope: the migration Arabic spelling, the DG4-era audit labels, and labels for an organization-level audit view.
