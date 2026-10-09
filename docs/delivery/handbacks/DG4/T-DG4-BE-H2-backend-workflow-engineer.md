# Handback T-DG4-BE-H2 (backend-workflow-engineer): feedback and assessment forms, invitations, assessment records, training records

- **Run:** T-DG4-BE-H2B, the salvage and completion run (D-103). invocation_reference `{"kind":"claude-code-cli-session","run_id":"DG4-T-DG4-BE-H2B-backend-workflow-engineer-20261009T133014Z-ce00ad91","session_id":"ce00ad91-2d3a-4832-b1d9-d704f4bba728"}`.
- **Assignment:** `docs/delivery/assignments/DG4/T-DG4-BE-H2B.md`. sha256 `4f5be642f04641e4b1a711e07a53181af56c92db53ad0cf55063a3a51be0ccc1`, verified at start.
- **Stage:** P4, gate DG4 (BUILDING). Section `docs/architecture/p4-work-split.md` §F+G FG.2.
- **Base:** branch `dg4/be-h2`, `HEAD` = WIP commit `3821c70` (parent `489712f`). All changes are **uncommitted**.
- **Time (UTC):** started 13:30:35 and ended 14:59:44 (`date -u`). About 40 minutes of the run were lost to a host disk outage (§4.1).
- Nothing here grants a G1–G6 business approval, or a Finance or IT approval, and nothing touches DG0–DG7. All test and exercise data is synthetic.

## Status: COMPLETE

All 17 operations are routed and exercised, and every acceptance check was run from scratch on the final tree and exits 0 (§4). One acceptance item needs an orchestrator decision: §6 item 1 (a new form starts at record version 2).

## 1. Salvage

**Kept from WIP `3821c70`.** I reviewed every file critically against ADR-0033 §5, §6 and §9–§11, `0047`, `0049`, `openapi.yaml` and S-1…S-14, and kept it:

- **`packages/shared/src/adoption/form-schema.ts`.** `validateFormSchema` matches `p4_assessment_form_schema_valid` rule for rule: members, the key and option-value regexes, label lengths, options/min/max/pass_min only where they belong, and exactly one required yes/no or scale proficiency question for a proficiency form and none for a feedback form. It also applies the S-1 visible-text rule to labels. `validateAnswers` and `deriveProficiencyResult` follow §5. Its unit tests mirror FM01–FM04.
- **`adoption/assessments.ts` and `adoption/training.ts`.**
  - **Authorization:** the read gate comes first, so ADM-only callers and outsiders get 404. Every write permission is re-checked at commit time with `openWrite(..., { atCommit: true })`, which gives AUD its 403.
  - **Respond rule:** an open invitation, or `proficiency.record` for an observation without an invitation. Otherwise 403 `assessment_record.not_invited`.
  - **Withdraw rule:** `assessment.review`, or the respondent on their own record. Otherwise 403 `assessment_record.not_withdrawable_by_caller`.
  - **Concurrency and audit:** If-Match 428/409, and one audit event per row state in the same transaction.
  - **Work items:** `createWorkItemOnce` with dedupe `assessment.invitation:<id>` and `assessment.review:<id>`, using `messageKey` and `messageParams` (S-6). There is no remote I/O in a transaction.
  - **Records:** answers are checked against the **published** version, and the proficiency result is derived on the server.
  - **Refusals:** the §10 codes and English texts are exact.
- **Mirrors and seams.**
  - The zod mirrors in `schemas/adoption-assessments.ts` match the OpenAPI schemas.
  - The 17 exercises are appended after BE-H's in `p4-exercises-be-h.ts`, and `P4_PENDING_BE_H2` is now `[]`.
  - The four integration test files are kept.

**Changed, and why:**

1. **`platform/db-errors.ts`.** The WIP mapped `training_record_intervention_fkey` to `training_record.intervention_not_training`. That FK fires when the intervention is **not in this transformation**, so it now maps to 422 `validation.reference` at `/interventionId`. It is a race backstop, since the service checks first. `training_record_intervention_training` keeps its §10 code.
2. **`assessment-records.test.ts`: one wrong WIP expectation.** The WIP expected a client-sent `proficiencyResult` to be refused at pointer `/proficiencyResult`. The shared strict parser (S-2; `platform/validation.ts`) reports an unrecognized member at its parent pointer (the body root, `""`) with code `validation.unknown_field`. The service is right: the request is refused with 400 and nothing is written. I corrected the test to assert the shared convention. This was the only first-run failure in my files.
3. **The stale WIP log.** I deleted `T-DG4-BE-H2-evidence/unit-locale-unset.log` and replaced it with this run's fresh output at the same path. Every other log in the folder is from this run.

**Added.** These close S-4 test gaps the WIP left:

- `assessment-forms.test.ts`:
  - publish: 409 on a stale If-Match;
  - retire: 428 and 409;
  - a new test "commit-time 403 on create, edit, retire, invite and cancel; nothing written". Each call runs as a fresh BO whose grants are revoked between identity resolution and commit.
- `assessment-records.test.ts`:
  - withdraw: 409;
  - a new test "commit-time 403 on a response and on the respondent's own withdrawal; nothing written".
- `training.test.ts`: commit-time 403 on create, with the row count unchanged.

With these, every one of the 11 mutations has tests for 428 (where If-Match applies), 409, the audit event, AUD 403, ADM-only and outsider 404, and commit-time 403.

## 2. Changed files (against `489712f`)

| File | Purpose |
|---|---|
| `apps/api/src/modules/adoption/assessments.ts` | 14 operations: forms and versions, publish and retire, invitations, records, review, withdraw |
| `apps/api/src/modules/adoption/training.ts` | 3 operations: list, create and update training records |
| `apps/api/src/modules/adoption/routes.ts` | Registration lines, after BE-H's |
| `apps/api/src/modules/platform/db-errors.ts` | The BE-H2 forms and records lines of the slices F/G block, after BE-H's (fkey fix in this run) |
| `packages/shared/src/adoption/form-schema.ts` (+ `.test.ts`, 8 unit tests) | Pure form-schema validation, answer validation and the proficiency result |
| `packages/shared/src/calc.ts` | One appended export line |
| `packages/shared/src/schemas/adoption-assessments.ts`, `schemas/index.ts` | zod mirrors and their export line |
| `apps/api/test/support/p4-pending-be-h2.ts` | Emptied (17 → 0) |
| `apps/api/test/integration/contract/p4-exercises-be-h.ts` | 17 exercises and mirrors, after BE-H's |
| `apps/api/test/integration/contract/contract.test.ts` | Media-type pin only (+8) |
| `apps/api/test/integration/adoption/assessment-forms.test.ts` (10), `assessment-records.test.ts` (10), `training.test.ts` (5), `entity-group.test.ts` (4) | 29 integration tests |
| `docs/delivery/handbacks/DG4/T-DG4-BE-H2-evidence/*.log` | This run's logs |

No migration was written. No registration file, `server.ts` or `index.ts` changed.

## 3. Behaviour delivered, per requirement row

- **REQ-S11-002.** Acceptance: *"A11: a proficiency observation submitted via the form links to the stakeholder group and counts in the proficiency indicator"*.
  - **Done (this task's half):** owners (BO, WL) create, version, publish and retire forms, and invite respondents, each of whom gets one My Work item. Invited users respond, and an assessor holding `proficiency.record` observes without an invitation. The record stores `stakeholder_group_id` and the derived `proficiency_result`, the invitation becomes `responded`, and the form's creator gets an `assessment_to_review` item. BO reviews.
  - **Proof:** `assessment-records.test.ts`, "invited respondent; group link; derived result; invitation responded; review item for the form's creator". It includes the group's count query over non-withdrawn observations; a withdrawal drops the record from it.
  - **Not this task's:** "counts in the proficiency indicator" is KBE-F's `getAdoptionIndicators`.
- **REQ-PB-072 (records).** Acceptance: *"A11: 100% training completion with no proficiency observations shows proficiency Unknown, not adopted"*.
  - **Done (this task's half):** training records are separate from observations. A completed record needs `completedOn` (400 `validation.required` at `/completedOn`), and completed, no_show and withdrawn are final (422 `training_record.final`). Only a training intervention can be linked (422 `training_record.intervention_not_training`).
  - **Proof:** `training.test.ts`, "REQ-PB-072: 100% training completion records no proficiency observation".
  - **Not this task's:** the Unknown value of the measure is KBE-F's.
- **REQ-S16-020 (Training/AssessmentRecord and the entity-group test).** Acceptance: *"A11: the ERD and migrations contain every entity listed (StakeholderGroup, AdoptionIntervention, Training/AssessmentRecord, AdoptionMetricLink) with primary keys, owner and status where applicable, and an integration test creates and reads each one through the API with authorization enforced"*.
  - **Done:** `entity-group.test.ts` creates and reads StakeholderGroup, AdoptionIntervention, a training record and an assessment record through the API. Each case checks the primary key, the owner and the status, AUD 403 on the write with nothing written, and 404 for ADM-only users, for outsiders and under another transformation.
  - **Not this task's:** the AdoptionMetricLink case is KBE-F's, in its own file (D-102 (3)).

**FG.2 proofs, and where they pass:**

| Proof | Where |
|---|---|
| Unknown member or duplicate key → 400 `assessment_form.schema_invalid` at the failing pointer, with no write | `assessment-forms.test.ts`, plus unit FM03/FM04 |
| A response to a draft form → 422 `assessment_form.not_published` | `assessment-records.test.ts` |
| An uninvited non-assessor → 403 `assessment_record.not_invited` | `assessment-records.test.ts` |
| An observation links to its group | `assessment-records.test.ts` |
| A completed training record needs its completion date | `training.test.ts` |
| The entity group | `entity-group.test.ts` |

## 4. Checks actually run (final tree, Node 24.21.0, offline; logs in `T-DG4-BE-H2-evidence/`)

| # | Command | Exit | Result |
|---|---|---|---|
| 1 | `node tools/gates/validate.mjs --historical --stage DG3` | **0** | `PASS gate DG3 (historical)` (`validate-historical-DG3.log`) |
| 2 | `pnpm -r typecheck` | **0** | `typecheck.log` |
| 3 | `pnpm -r build` | **0** | `build.log` |
| 4 | `pnpm lint` | **0** | `lint.log` |
| 5 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | **0** | `prettier.log` (re-run last, after this handback) |
| 6 | `pnpm openapi:lint` | **0** | 607 operations (`openapi-lint.log`) |
| 7 | `pnpm test`, locale unset (`LANG`, `LC_ALL`, `LC_CTYPE`, `LC_MESSAGES`, `LANGUAGE` unset) | **0** | unit-node + unit-web: 119 files, **2266 passed**; nocodegen: 3 files, **259 passed, 2 skipped** (`unit-locale-unset.log`) |
| 8 | `pnpm test`, `LANG=C.UTF-8 LC_ALL=C.UTF-8` | **0** | the same counts: **2266**; **259 + 2 skipped** (`unit-c-utf8.log`) |
| 9 | `QA_PG_PORT=24150 MTH_PORT_POOL=24151-24199 tests/qa/support/with-pg.sh pnpm test:integration` | **0** | **120 files, 1312/1312 passed**. PostgreSQL 16.13 on port 24150 (attempt 1); UTF8, C locale (`integration.log`) |

**Count deltas against D-102's merged tree:**

- Unit: 2258 → 2266 (+8, the form-schema tests).
- Integration: 1283 → 1312 (+29: forms 10, records 10, training 5, entity group 4).
- Pinned counts: the operation pin (607) is unchanged. The media-type pin is §5.

### 4.1 Disclosures (every non-zero exit, failure and blocked attempt)

**A. Host disk exhaustion, 13:35–14:24.**

- The host root filesystem filled up from outside this sandbox. It had 47 MB free at 13:35 and 0 bytes at about 14:02. `/tmp` and `/var/tmp` are read-only to this run.
- What failed during the outage:
  - the first disposable PostgreSQL (`initdb`: `could not write to file "pg_wal/xlogtemp.21": No space left on device`);
  - a first `pnpm test` attempt (its output was lost to ENOSPC; the partial log was deleted and no counts are claimed from it);
  - one Write of this handback (ENOSPC).
- To get room for that Write, I deleted only my own regenerable files: `$TMPDIR` scratch, this worktree's `.tsbuildinfo` and Vitest caches, and `apps/web/dist`. `pnpm -r build` (check 3) later regenerated the build output.
- Space returned at 14:24 (5.3 GB, then 13 GB). Every check in the table above ran after that, from scratch.

**B. Earlier non-zero exits and runs not counted.**

- Before the outage, one prettier check exited **123**. Its only error was the deleted stale log, which was still in the index; the git index is read-only to this run, so `git rm` failed. Check 5 reran it after the path was regenerated, and it passes. Its log was overwritten.
- My first targeted integration attempt passed absolute paths, which Vitest's filter did not match ("No test files found"), and the database was down at the time. It is not counted.

**C. One test failure in my own files.** The first targeted run of my four files ran 28 passed and 1 failed. The failure was the WIP's wrong pointer expectation (§1 item 2). After the fix, the adoption folder plus `contract.test.ts` passed 98/98.

**D. One flaky failure in the first `C.UTF-8` unit run.**

- It ran 2265 passed and 1 failed, with exit 1 (`unit-c-utf8-run1-flaky.log`).
- The failing test was `apps/web/src/auth/session-identity.test.tsx` › "F-DG2-500 sign-out here and 403 (en) › signing out here clears everything; B signing in afterwards never sees A's records". It is a UI `findByText("No transformations yet.")` timing failure in a file this task does not touch.
- It passed alone in `C.UTF-8` (18/18, `unit-c-utf8-session-identity-rerun.log`) and in the full `C.UTF-8` rerun (check 8). I classify it as **flaky, not caused by this change**, and leave it for the owner of that file.

## 5. Operations routed (delta to `p4-pending-be-h2.ts`)

The list went from 17 to 0. All 17 are registered in `adoption/routes.ts` and exercised through the validating client in `p4-exercises-be-h.ts`; `contract.test.ts` is green:

- `listAssessmentForms`, `createAssessmentForm`, `getAssessmentForm`, `updateAssessmentForm`, `publishAssessmentForm`, `retireAssessmentForm`;
- `listAssessmentInvitations`, `createAssessmentInvitations`, `cancelAssessmentInvitation`;
- `listAssessmentRecords`, `createAssessmentRecord`, `getAssessmentRecord`, `reviewAssessmentRecord`, `withdrawAssessmentRecord`;
- `listTrainingRecords`, `createTrainingRecord`, `updateTrainingRecord`.

**Media-type pin** (`contract.test.ts`): `[257, 256, 1]` at base `489712f` → `[265, 264, 1]`, so **+8 JSON bodies**: `createAssessmentForm`, `updateAssessmentForm`, `createAssessmentInvitations`, `createAssessmentRecord`, `reviewAssessmentRecord`, `withdrawAssessmentRecord`, `createTrainingRecord` and `updateTrainingRecord`. `publishAssessmentForm`, `retireAssessmentForm` and `cancelAssessmentInvitation` are bodiless and declare no `consumes` (S-3). The orchestrator reconciles this against the concurrent pins of BE-I2, BE-G and KBE-F at merge.

## 6. Contract and schema needs for the orchestrator

1. **A created form is at record version 2.** The frozen `0047` and `0010` force it:
   - `assessment_form_guard` requires a new form to have `current_version_no = 0` and no versions;
   - `assessment_form_version_guard` requires `version_no = current_version_no + 1`, so the form row must exist first (FK);
   - stepping `current_version_no` to 1 is an update, and `p2_row_guard` requires `version + 1` on every update.

   So `createAssessmentForm` returns `version: 2` (ETag `"2"`) with `currentVersion.versionNo: 1`, and writes three audit events: form create v1, version create, form step v2. OpenAPI says "Created (draft, version 1)", which is accurate if "version 1" means the question version. S-4 says "creates are version 1". **Decision needed:** accept this reading (no change), or have the architect allocate a repair migration from `0058`–`0069` so the form and its first version are created at form version 1. I wrote no migration.
2. **i18n (FE-E/FE-A).** These need EN/AR translations:
   - the work-item message keys `adoption.task.assessment_invitation` and `adoption.task.assessment_to_review` (param `formName`), which follow BE-H's `adoption.task.*` convention;
   - every ADR-0033 §10 forms and records code;
   - `validation.not_applicable`, from the shared validation family and not listed in §10. It is used for a subject on a feedback form or invitation, or for both `subjectUserId` and `subjectLabel`.
3. **`db-errors.ts` merge.** The BE-H2 cases sit inside BE-H's `mapP4AdoptionSustainmentError` switch, after BE-H's last case and before `default: return null`. No case label is duplicated. KBE-F's metric-link lines go after them (FG.3).

## 7. What remains

- The orchestrator's decision on §6 item 1.
- KBE-F's AdoptionMetricLink case completes the REQ-S16-020 entity group. KBE-F's measures complete the "counts in the indicator" half of REQ-S11-002 and the Unknown half of REQ-PB-072. Neither belongs to this task.
- Nothing else in FG.2 remains.
