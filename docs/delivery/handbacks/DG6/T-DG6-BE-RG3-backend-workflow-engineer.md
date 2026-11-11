# T-DG6-BE-RG3 handback (backend-workflow-engineer)

- **Stage / task:** DG6 (P6, FIXING after the round-4 re-gate release audit), T-DG6-BE-RG3, finding **F-DG6-990** (Low, REQ-S21-001).
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG6-T-DG6-BE-RG3-backend-workflow-engineer-20261111T064732Z-8096c19e","session_id":"8096c19e-49a5-4008-978b-2e418a6f3ec3"}`
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-BE-RG3.md` (sha256 `8d563566…cbe8647`, verified).
- **Base:** branch `dg6/be-rg3` at `76a378f95` (clean tree at start). Changes are left **uncommitted**.
- **Time:** start `2026-11-11T06:47:48Z`, end `2026-11-11T07:29:23Z` (both from `date -u`).
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG5` → `PASS gate DG5 (historical)`, exit 0 (at the start and again at the end).
- **Migration:** **`0130_p6_seeded_text_business_terms.sql`**. This is the next id above 0129, the highest on this branch (D-196). The orchestrator renumbers it at merge if needed.
- **API endpoints added:** none. No route, contract, schema or dependency change.

Nothing here grants or records a business, Finance or IT approval. Product gates G1–G6 are untouched, and nothing reads or writes the engineering gates DG0–DG7.

## 1. Files changed

| File | Purpose |
| --- | --- |
| `packages/db/migrations/0130_p6_seeded_text_business_terms.sql` (new) | Rewrites the stored seeded texts in business terms. Each rewrite is versioned and audited, and applies only while the stored text is still the seeded one (§2). |
| `apps/api/test/integration/text-scan/seeded-texts.test.ts` (new) | Text scan (d) for REQ-S21-001. It runs over every text, char, text-array and JSON column of every public table, on a scratch database migrated from 0001 to the latest. Also: the 0130 audit and version assertions, a self-check of the history exclusion, and a non-vacuity case on a database migrated without 0130. |
| `docs/architecture/data-dictionary.md` | Adds a "Changed by `0130`" line to the five table sections, and a new section "P6 re-gate repair migration 0130". |
| `docs/delivery/handbacks/DG6/T-DG6-BE-RG3-backend-workflow-engineer.md`, `…/T-DG6-BE-RG3-evidence/*` | This handback and its logs. |

## 2. Behaviour delivered

**REQ-S21-001.** Its acceptance text: *"A28;A22: a text scan of UI strings and export templates finds no DG0-DG7 references; demo G-approvals display 'Synthetic demonstration - approves nothing real'"*. F-DG6-990 cites M0007 and M0412: "Source methodology phases are not software delivery stages."

### 2.1 What the search found (all migrations' seed data, en and ar)

The search has three sources:

- **(a)** A scan of the stored values of a database migrated from 0001 to 0129. It reads all 1,000+ text, array and JSON columns, not a chosen list. Log: `before-scan.log`; distinct hits: `before-scan-distinct-hits.txt`, 23 distinct texts and 142 hits.
- **(b)** A grep of the non-comment lines of every migration.
- **(c)** A grep of the string literals in `packages/db/src` (demo and seeds), `apps/api/src`, `apps/worker/src` and `packages/*/src`.

**Fixed in 0130 (stored values, 86 rows):**

| Table.column | Rows | Served / rendered | What it named |
| --- | --- | --- | --- |
| `job_schedule.description_en` | 5 | `listJobSchedules`, `listJobOperations`; the English job name on the Jobs and Job operations pages | `kpi.freshness_scan`: "DG4 freshness rule" (one of the audit's 24). Four more cited ADR sections: `operations.exception_alerts` "(ADR-0053 §6)", `search.index_feed` and `search.reindex` "(ADR-0057 §2)", `integrations.connector_run` "(ADR-0055 §2)". |
| `automation_rule_version.change_summary` | 17 | `listAutomationRuleVersions` | The 16 starter versions 1: "Seeded starter: the DG4 behaviour (D-142 Q3)." (16 of the audit's 24). `starter.job_failed` v2 cited "(ADR-0053 §3)". |
| `procedure_definition.validation_rules_en` (+2 `_ar`) | 12 | `listProcedureDefinitions` and `getProcedureDefinition`; loaded into the Procedure builder | Six definitions × **two** stored configuration versions (0069 v1, superseded; 0095 v2, published). The audit saw 6 served strings. Arabic, not in the audit's list: two texts said "المعتمدة في المرحلة الرابعة/الثالثة" ("approved in the fourth/third stage"). That is an engineering delivery stage a reader could take for a methodology phase (M0412). Both now read like the other four ("… المعتمدة دون تغيير"). |
| `service_identity.reason` | 49 | `listServiceIdentities` and `getServiceIdentity`; "Current reason" on the Service identities page | 40 rows said "(0114; ADR-0053 §1) … the DG5 handler needs". 9 cited migration numbers, ADR sections and **D-199** (0115, 0116, 0117, 0121). The audit could not see these: its bare list call got 400. |
| `form_source_field.storage_ref` | 3 | **Not served** (not in OpenAPI). It is an internal storage note on `computed` fields. | "(DG3 scoring engine)", "(DG3 formula engine)", "(DG4 realized value)". Reworded anyway, so the scan needs no exclusion for it. |

**New wording (en):**

| Old | New |
| --- | --- |
| "(DG4 freshness rule, unchanged)" | "(the KPI freshness rule, unchanged)" |
| "Seeded starter: the DG4 behaviour (D-142 Q3)." | "Seeded starter version 1: the released starter behaviour." |
| "The DG4 actual-submission rules apply unchanged." | "The KPI actual-submission rules apply unchanged." |
| "The DG3 scoring and ranking rules apply unchanged." | "The initiative scoring and ranking rules apply unchanged." |
| "(DG2-DG4 gate rules unchanged)" | "(the gate rules apply unchanged)" |
| "The DG4 change-control and impact-assessment rules apply unchanged." | "The change-control and impact-assessment rules apply unchanged." |
| "Finance validation follows the DG4 rules; …" | "Finance validation follows the benefit validation rules; …" |
| "The DG4 BAU handover rules apply unchanged." | "The BAU handover rules apply unchanged." |
| Service identity reasons (DG5 and engineering ids) | "Seeded declaration: the narrowest set of read permissions this job's handler needs." (and similar) |
| The 0115 reason | Keeps its declared-exception wording, without the ADR and D-199 ids. |
| The ADR citations in the 5 other texts | Removed; the rest of each text is unchanged. |

**Found and NOT changed (for the orchestrator):**

1. **Gate-submission snapshot `note`:** "Product gate (business approval inside the product); unrelated to the engineering delivery gates DG0-DG7."
   - It comes from `apps/api/src/modules/workflows/gates.ts:1041`, a code literal. The demo dataset copies it in `packages/db/src/demo/data/roaming-gates.ts:493`.
   - It is stored in every gate submission's frozen, hashed snapshot.
   - It is a disclaimer, and it is already listed in `REPORTED_EXISTING_FINDINGS` (`apps/api/test/text-scan/scan.ts`; T-DG2-BE). That list "may only shrink" by the orchestrator's decision. It is outside my scope: the workflows module, and the demo data used by the snapshot hash.
   - It does not occur in a database migrated without demo data.
2. **`audit_event.reason`, five texts written by earlier migrations (51 rows):**
   - "Seeded forms configuration v1 (T-DG5-ARCH-02)"
   - "Seeded procedures configuration v1 (T-DG5-ARCH-02)"
   - "Seeded procedures configuration v2 (T-DG5-BE-T3, D-165)"
   - "Seeded procedures configuration v2: record_baseline assigned to TL (T-DG5-BE-T3, D-165)"
   - "Seeded health-check scoring scheme v1 (T-DG5-ARCH-05)"

   **These are user-facing:** the audit trail routes (`apps/api/src/modules/audit/index.ts`, `reason`) serve them to holders of audit read where in scope. But the audit trail is append-only (0003; ADR-0004) and is never rewritten. The scan lists them by exact text in `REPORTED_AUDIT_REASONS`, so any other audit reason with a task, finding, decision or ADR id fails. **Orchestrator decision needed:** accept them as immutable history, or rule otherwise.
3. **`service_identity_change.reason`:** the append-only history of the reasons 0130 replaced. It is served by no route, and the scan checks this: no API literal names the table. Excluded by exact text.
4. **`audit_event.changes.*.from`:** the previous values (including 0130's own `from`) are history by design. The scan skips only the `from` side.
5. **Code comments** in `apps/*/src` and `packages/*/src` that mention DG2–DG5 are not product text (ADR-0049 §7: only string literals are read).

### 2.2 Immutability, versions and audit (how 0130 respects each table's rules)

- **Every table:**
  - Each rewrite matches the exact seeded text, so a text a user has since changed is left alone.
  - Each rewrite sets `version = version + 1` where the table has one, so the `p2_row_guard` version step and the deferred `*_audit_required` triggers both pass.
  - Each rewrite writes one audit event: actor `system`, source `migration`, action `<table>.reword`, `prior_version`/`new_version`, a reason, and `changes = {column: {from, to}}`.
  - Counts asserted by the scan: automation_rule_version 17, form_source_field 3, job_schedule 5, procedure_definition 12, service_identity 49.
- **`automation_rule_version` (published or superseded versions are immutable):**
  - The guard (`automation_rule_version_guard`, 0074 and 0117) freezes the version's **content**: triggers, conditions, actions, action types, run-as, service permissions, parameters and `content_sha256`.
  - `change_summary` is the version's descriptive note, outside that content and outside the hash. The guard therefore allows the edit, and the executed behaviour, the hash and every execution's pinned version are untouched.
  - Superseding the starters with new versions was rejected: version 1 would stay served as history with the same text.
  - The draft-only contributor triggers (0097) do not fire.
- **`procedure_definition` (published versions are immutable to the application by design):**
  - Immutability protects what a launched instance is pinned to. `procedure_definition_guard` admits the migration role (`p5_procedure_version_editable`: "the migration role may seed") for seeded-data corrections.
  - The correction is wording only: the validation behaviour is in code, and the en and ar texts keep their meaning.
  - Both seeded versions change identically, so the v1/v2 comparison is unchanged.
  - The contributor triggers add no contributor, because the user is NULL.
- **`service_identity`:** only rows with `updated_by IS NULL` (never changed by a user) and the seeded reason are rewritten. The declaration and the grant are unchanged. The 0101 history trigger appends a `service_identity_change` row.
- **`form_source_field`:** no version column and no audit trigger, but an audit event is written anyway. Neither the old nor the new text holds a `table.column`, so `compare.ts` `COLUMN_REF` derives nothing from it, before or after.

### 2.3 The extended scan (item 2)

The new file is `apps/api/test/integration/text-scan/seeded-texts.test.ts`, the "REQ-S21-001: text seeded by the migrations (scan d)" suite, with 4 tests.

1. **The scan itself.** On a scratch database migrated from 0001 to the latest (production-initialized), every seeded value must be free of two things:
   - an engineering delivery gate name, by the shared rule `mentionsEngineeringGate` through `scan()`, with its normalized copy. F-/T-DG ids match this rule too.
   - an internal decision or ADR id (`D-nnn`, `ADR-nnnn`).

   The only exclusions are the history items in §2.1 items 2–4. The test also asserts that it read more than 1,000 columns.
2. **0130 audit and versions:** the 0130 audit events and version steps per table, and that the audit keeps the old `kpi.freshness_scan` wording.
3. **History exclusion self-check:** `service_identity_change` is not named by any API source literal.
4. **Non-vacuity:** on a second scratch database migrated **without** 0130, the scan finds the F-DG6-990 texts:

   | Table | Rule | Hits |
   | --- | --- | --- |
   | `job_schedule` | gate | 1 |
   | `automation_rule_version` | gate | 16 |
   | `procedure_definition` | gate | 12 |
   | `service_identity` | gate | 40 |
   | `form_source_field` | gate | 3 |
   | `job_schedule` | internal reference | 4 |

## 3. Checks actually run

Environment: Node v24.21.0, offline. Disposable PostgreSQL 16.15 via `tests/qa/support/with-pg.sh` on ports 31400 and 31410 (pool 31401–31449). The worktree is `/home/user/wt/dg6-be-rg3`. I removed no empty `.cc-writes` directories: none existed.

| # | Command | Result | Exit | Log |
| --- | --- | --- | --- | --- |
| 1 | `node tools/gates/validate.mjs --historical --stage DG5` (start) | `PASS gate DG5 (historical)` | 0 | (console) |
| 2 | **Before fix**, audit probe: `zz-aud-r4-served-dg-labels.test.ts`, copied into `apps/api/test/integration/assistant/`, run with `with-pg.sh npx vitest run --configLoader runner --project integration <file>`, migrations 0001–0129 (0130 set aside) | "served strings naming DG0-DG7: 24"; 1 failed (1) | **1** (expected) | `before-probe.log` |
| 3 | **Before fix**, the scan `seeded-texts.test.ts`, migrations 0001–0129 | 2 failed, 2 passed (4). Test 1: 142 violations. Test 2: no 0130 audit events. Tests 3 and 4 pass because they do not depend on 0130. | **1** (expected) | `before-scan.log`, `before-scan-distinct-hits.txt` |
| 4 | **After fix**, audit probe, migrations 0001–0130 | "served strings naming DG0-DG7: 0"; 1 passed (1) | 0 | `after-probe.log` |
| 5 | **After fix**, the scan | 4 passed (4) | 0 | `after-scan.log` |
| 6 | Touched integration files, one run in `with-pg.sh` (68 files, listed in `integration-files.txt`). It covers every integration file that reads `job_schedule`, `automation_rule_version`/starters, `procedure_definition`, `service_identity` or `form_source_field` (api, worker, db, tests/qa), plus `packages/db` `migrate`, `catalogue`, `protection`, `audit-required-index`, `demo` and `demo-roaming`, all 5 text-scan files, `contract.test.ts`, `freshness-scan` and `a22-p6-operability`. | 68 files passed (68); 853 tests passed (853); 731 s. It ran while typecheck, lint, build and unit tests were also running (loaded host). | 0 | `integration-touched.log` |
| 7 | `pnpm -r typecheck` | Done | 0 | `typecheck.log` |
| 8 | `pnpm -r build` | Done | 0 | `build.log` |
| 9 | `pnpm lint` | `eslint . --max-warnings=0`, clean | 0 | `lint.log` |
| 10 | `pnpm openapi:lint` | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 932 operations` | 0 | `openapi-lint.log` |
| 11 | `pnpm test`, locale unset (`env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE`) | unit-node: 191 files / 2,906 tests passed. unit-web: 125 / 2,113 passed. unit-formula-nocodegen: 3 files, 259 passed, 2 skipped (261). | 0 | `unit-unset.log` |
| 12 | `pnpm test` with `LANG=C.UTF-8 LC_ALL=C.UTF-8` | Same counts: 2,906 / 2,113 / 259 + 2 skipped. | 0 | `unit-cutf8.log` |
| 13 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | All matched files use Prettier code style! | 0 | `prettier.log` |
| 14 | `node tools/gates/validate.mjs --historical --stage DG5` (end) | `PASS gate DG5 (historical)` | 0 | `validate-dg5-end.log` |

The 2 skipped tests are in `packages/shared/src/formula/fuzz.test.ts` (unit-formula-nocodegen). They were skipped before this task, in a file I did not touch. The full `pnpm test:integration` was not run, as the assignment says; the orchestrator runs it on the merged tree. I made one exploratory run of a throwaway discovery test, which I deleted. It is not evidence and is not in the tree.

## 4. Operations routed (pending list delta)

None. No API operation was added or routed, and no `p6-pending-*.ts` or `p6-exercises-*.ts` file changed. `contract.test.ts` passed in run 6.

## 5. Contract, schema or dependency needs

None. There is no OpenAPI, zod or schema change and no new dependency. The migration changes stored data only.

## 6. User-facing texts made untrue

None of the web catalogues (en/ar) describe these seeded texts, so none became untrue. The reworded stored texts are the user-facing change (en, plus two ar procedure texts).

## 7. What remains / merge notes

- **Orchestrator decisions:**
  - The five append-only `audit_event.reason` texts with engineering task ids and D-165 (§2.1 item 2). They are user-visible in the audit trail and cannot be rewritten.
  - The gate-snapshot disclaimer note (§2.1 item 1), already in `REPORTED_EXISTING_FINDINGS`.
- **Requirements register:** `docs/delivery/requirements.csv`, row REQ-S21-001, could cite `apps/api/test/integration/text-scan/seeded-texts.test.ts` as evidence. The register belongs to the analyst and orchestrator, so I did not edit it.
- **Merge:**
  - One new migration, `0130`. If another task ships a 0130 first, renumber it. The file depends only on rows seeded by 0068, 0069, 0075, 0095, 0114–0117 and 0121.
  - The scan's non-vacuity case finds the rewording migration by its name suffix (`_p6_seeded_text_business_terms.sql`) and applies every file before it, so a renumbering needs no test change.
  - Expected audit counts after deploy: 86 audit events with action `*.reword`, and a version step on 83 rows.
- **Not done:** nothing in the assignment's scope is open.

## 8. Final checks

- **Test file edit after the first runs.** I changed one part of `seeded-texts.test.ts` after runs 3 and 6. The non-vacuity case now finds the rewording migration by its name suffix instead of the fixed bound `< "0130"`; the rest of the file is unchanged. Runs 3 and 6 used the earlier version. The final file was re-run in `after-scan.log` (4 passed, exit 0; its sha256 is in the log), and `pnpm -r typecheck` and `pnpm lint` were re-run after the edit (exit 0 each).
- **Prettier (run 13):** `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown`. Result in `prettier.log`; the exit code is on its last line.
- **Validator (run 14):** `node tools/gates/validate.mjs --historical --stage DG5` at the end. Result in `validate-dg5-end.log`; the exit code is on its last line.
