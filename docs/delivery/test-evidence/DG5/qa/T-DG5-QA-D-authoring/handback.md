# Handback T-DG5-QA-D: executable acceptance suites A16 "Health and launch" (qa-verifier, authoring)

- **Stage:** P5 / DG5 (BUILDING). **Kind:** authoring, not a gate review (T-DG1-QA precedent). This does not make me the DG5 QA gate reviewer.
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG5-T-DG5-QA-D-qa-verifier-20261016T211556Z-7ae9007b","session_id":"7ae9007b-5de9-472b-8b72-c4aa78be8c1b"}`
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-QA-D.md`, sha256 `954d304d5961ee590c312b206830f2753773572ff99cde3082e047b73392c5e9` (I checked it).
- **Working tree:** `/home/user/wt/dg5-qa-d`, branch `dg5/qa-d`, HEAD `bb0601f6a03feb789c4532d7a88e88dc88e43c5e`.
- **Time:** start `Fri Oct 16 21:16:11 UTC 2026`, end `Fri Oct 16 21:46:57 UTC 2026` (about 31 minutes).
- **Independence:** I authored no product implementation. I edited no file under `apps/**`, `packages/**`, `tools/**`, `.claude/**`, `docs/source/**` or any delivery record.
- **Changes:** uncommitted, left for the orchestrator to integrate.

## 1. Files written (all new)

| File | Purpose |
|---|---|
| `tests/qa/support/a16.ts` | Setup and source parsing only. It parses the expected texts from `docs/source/playbook.md`: B0150 (25 questions), B0152 (4 bands), B0134 (windows, cells, and `;`-split actions and outputs) and B0136–B0141 (Day-90 questions). It also has `addDays` and `QUESTION_CODES`, and re-exports the production worker's `handleTransformationCreated`, `wireWorkerLaunchPlanPort` and the A11 `envelopesOf`. |
| `tests/qa/integration/a16-health-check.test.ts` | 13 tests: REQ-PB-091, REQ-PB-092, REQ-S14-001, REQ-S14-002, REQ-S14-003 and the HealthAssessment part of REQ-S16-021. Also checks authorization, If-Match 428/409 and audit rows per request id. |
| `tests/qa/integration/a16-launch-plan.test.ts` | 11 tests: REQ-PB-086, REQ-PB-087, REQ-S14-004, and the plan flag, retry and no-duplicates parts of REQ-S12-004. Also checks authorization, If-Match and audit. |
| `tests/qa/integration/a16-s16-021-entities.test.ts` | 6 tests: REQ-S16-021. It creates and reads BAUHandover, Control, ControlCheck, ImprovementItem, Lesson and HealthAssessment through the API and checks: AUD gets 403 on create and no row is written; another organization gets 404; no session gets 401. |
| `e2e/a16-health-launch.spec.ts` | Root Playwright spec with 2 tests, each run in chromium-en and chromium-ar. It covers the health check (25 questions, "Incomplete (24/25)" with no band, the 25th answer giving 17 and "16-20" with the B0152 text) and the launch plan generated in the UI from 2026-10-01. It also checks `lang`/`dir` and axe. |
| `docs/delivery/test-evidence/DG5/qa/T-DG5-QA-D-authoring/**` | This handback, the logs, the mutation scripts and the screenshots (en/ar). |

All data is synthetic. Every in-product action in the fixtures is a synthetic action on test data and approves nothing real:
- health-check scores;
- Day-90 answers;
- scheme publication by a synthetic ADM_METHOD user, reviewed by a synthetic TO user.

No DG0–DG7 gate is named in product text.

## 2. Checks run (real exit codes)

Environment:
- Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline, PostgreSQL 16.13 (disposable clusters);
- Chromium from `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`;
- harness ports 23750–23799 only;
- disk 7.9 G free before each full run;
- empty `.cc-writes` directories checked before the runs: none found.

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 0 | `node tools/gates/validate.mjs --historical --stage DG4` (start, 21:16 UTC) | 0 | `PASS gate DG4 (historical)` | console output, quoted here |
| 1 | `QA_PG_PORT=23750 MTH_PORT_POOL=23751-23769 tests/qa/support/with-pg.sh pnpm vitest run --configLoader runner --project integration tests/qa` | 0 | **18 files, 202/202 tests passed** | `01-integration-tests-qa.log` (final, after formatting); `01a-…-before-format.log` (the same result before prettier) |
| 2 | `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers E2E_PG_PORT=23770 E2E_API_PORT=23771 MTH_PORT_POOL=23772-23799 QA_EVIDENCE_DIR=<evidence>/screenshots apps/web/e2e/support/with-stack.sh npx playwright test e2e/a16-health-launch.spec.ts --workers=1 --reporter=list --output=$TMPDIR/pw-out` | 0 | **4/4 passed** (2 tests × chromium-en, chromium-ar), 37.4 s. axe: 0 serious or critical on all 3 screens per language. | `02-e2e-a16.log`, `screenshots/{en,ar}/` |
| 3 | `pnpm lint` | 0 | `eslint . --max-warnings=0` clean | `03-lint.log` |
| 4 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" | `04-prettier-all.log` |
| 5 | `MUT_DIR=$TMPDIR/mut 05-mutation-checks.sh` and `05b-mutation-m8b-double.sh` (disposable copy) | 0 (script) | 7/8 single mutants killed; the 8th was killed as a double mutant (see §4) | `05-mutation-checks.log`, `05b-mutation-m8b-double.log` |
| 6 | `node tools/gates/validate.mjs --historical --stage DG4` (end, 21:46 UTC) | 0 | `PASS gate DG4 (historical)` | `06-validate-dg4-historical-end.log` |

**Per-file counts (row 1):**

| File | Tests passed |
|---|---|
| a16-health-check | 13 |
| a16-launch-plan | 11 |
| a16-s16-021-entities | 6 |
| a08-gate-controls | 31 |
| a09-decision-escalation | 17 |
| a10-benefit-integrity | 16 |
| a05-calculation-correctness | 17 |
| a11-bau-sustain | 17 |
| a11-adoption | 12 |
| a11-value-closure | 11 |
| a04-kpi-propagation | 8 |
| a03-modular-entry | 12 |
| a04-a05-a10-partials | 4 |
| a12-cross-scope | 14 |
| a13-job-idempotency | 5 |
| a02-a08-drafts-before-g2-scale-after-g5 | 1 |
| a14-concurrency | 5 |
| a01-one-source-of-truth-scorecard | 2 |

**Disclosures:**
- **`--configLoader runner`.** My sandbox mounts `node_modules` read-only. The default Vite config loader failed at startup with `ENOENT … mkdir node_modules/.vite-temp`, before any test ran. I used `--configLoader runner`, the D-113 QA-A precedent. Apart from that flag, the command is exactly the assignment's.
- **Debug runs during authoring.** These were not evidence runs:
  - one health-check run failed 1 test because my own expectation was wrong. A 403 writes one `authorization.denied` audit row, which is a correct denial log, and I had expected zero rows. The test now asserts exactly that row and nothing else.
  - one S16-021 run failed 4 tests because my test used `GET …/{id}` for controls, improvement items and lessons. The contract has no single-record GET for those three, and the harness's contract check caught it. The test now reads them through the collection list.
  - No e2e run failed or timed out. No flaky test was seen.
- **Untracked files not written by me.** `.bash_profile`, `.bashrc`, `.gitconfig`, `.gitmodules`, `.idea`, `.mcp.json`, `.profile`, `.ripgreprc`, `.vscode`, `.zprofile`, `.zshrc` and `CLAUDE.local.md` are untracked at the repository root. They are environment artefacts of the worktree. Most were there when I started; `git status` was truncated then, so I can't say for sure about `.zshrc` and `CLAUDE.local.md`. Do not integrate them.

## 3. Requirement → test table

The acceptance texts are those of `docs/delivery/requirements.csv`; the tests assert each one literally.

| Row | Acceptance (abridged) | Proving test(s) | Status |
|---|---|---|---|
| REQ-PB-086 | start 2026-10-01: Days 31-60 tasks between 2026-11-01 and 2026-11-30; all B0134 actions appear | `a16-launch-plan` › "start 2026-10-01: Days 31-60 tasks fall between …; every B0134 action and output appears; Day-90 test on day 90". It checks every task window range (day d = start + d), compares the 17 actions and 15 outputs per window verbatim with the playbook, checks the Day-90 test task due 2026-12-30, and checks a second generate gives 409 `launch_plan.exists`. Also the template test (B0134 cells verbatim) and the AUD 403 / other-org 404 tests. UI: `e2e/a16-health-launch.spec.ts` "REQ-PB-086 …": the plan is generated in the form, Days 31-60 rows have `data-start`/`data-due` in November, 2026-12-30 is present, and in English all 17 actions appear in the table (en + ar). | COVERED |
| REQ-PB-087 | six questions verbatim; unanswered → incomplete | `a16-launch-plan` › "all six questions render verbatim (B0136-B0141) …" (0/6, `scheduledDate` = start + 90); "five answers: incomplete (5/6) and completion is refused" (422 `day_ninety_test.incomplete`, AUD 403, 428, 409); "the sixth answer completes the test; a completed test is final" (422 `day_ninety_test.completed`). | COVERED through the API. The Day-90 screen is not in my e2e spec. |
| REQ-PB-091 | 25 questions verbatim; unanswered → incomplete, no band; without three actions → rejected | `a16-health-check` › "GET /health-check-questions returns the 25 playbook questions verbatim"; "24 answers: … band null"; "an incomplete assessment cannot be submitted (422 health_check.incomplete)"; "no actions -> 422 health_check.actions_required; two actions -> still 422; three -> submitted". UI: the e2e health test (25 rows; English text equal to B0150; incomplete with no band). | COVERED |
| REQ-PB-092 | 21, 16, 10, 9 → the four band texts verbatim | `a16-health-check` › "each submitted score shows the band whose text is the playbook's, verbatim" (range label plus `textEn` equal to B0152, origin `source`). Also "reassessments are kept in sequence, each linked to the previous submitted one" (M0288). UI: e2e checks the band "16-20" text (en verbatim; ar `textAr`). | COVERED |
| REQ-DLV-037 | A06, A07, A15, A16 tests pass on DG5; export samples inspected in both languages | A16 part: all files above. A06, A07, A15 and the export-sample inspection belong to the other QA tasks and reviewers. | PARTIAL (A16 only, by assignment) |
| REQ-S12-004 | one set of checklists and role tasks; retry creates no duplicates; with the plan flag the 90-day tasks are dated from the start date | `a16-launch-plan` › "starter 1 generates the plan from launchPlan.startDate once; replaying the event duplicates nothing". The steps: POST /transformations with `launchPlan`; the real outbox envelope (schema v2) goes to the production `handleTransformationCreated` after the worker composition's `wireWorkerLaunchPlanPort()`; the plan is `generatedVia: automation` and dated from 2026-10-01; the same job and a redelivery both return `duplicate`; the counts of tasks, phase_step rows and role_assignment work items are unchanged; there is one `launch_plan`. Also "without the flag no plan is generated". | COVERED for the A16 clause. The A13 clause is asserted as "unchanged on retry" (count > 0), not as an exact expected count of entry-phase steps. The relay/pg-boss path itself is A13's suite. |
| REQ-S14-001 | 25 answers with 17 Yes → 17 and '16-20'; method shown as an implementation assumption | `a16-health-check` › "the 25th answer (17 Yes in all) gives score 17 of 25 and the band '16-20' …": `score "17"`, `scoreMax "25"`, `scoringAssumption true`; scheme v1 has `implementationAssumption: true`, yes = "1", no = "0". UI: e2e `[data-state='scoring-assumption']` is visible, and the browser answer gives `data-score='17'` and `data-band='16-20'` (en + ar). | COVERED |
| REQ-S14-002 | 24 answers → 'Incomplete (24/25)' and no band; API band = null | API: `a16-health-check` › "24 answers: completion 24/25 … band null" (single read and list). UI: e2e asserts the text "Incomplete (24/25)" (ar: the shipped catalogue's label with 24/25), and `data-band='none'` and `data-score='none'`, with no band element. | COVERED |
| REQ-S14-003 | publishing a scheme that adds N/A without new bands is rejected; existing assessments keep their original scheme version and band | `a16-health-check` › "a draft that adds N/A and keeps the four source bands is refused at preview (422 health_scheme.own_bands_required) and publishing it is rejected": publish gives 422, the draft stays a draft, it is not listed, and GET gives 404. Then "with its own bands … it publishes; v1 and every existing assessment keep their scheme, score and band": the full pipeline runs (preview, compatibility, submit-review, TO approve, publish 200); v1 is byte-identical; all ≥ 5 earlier submitted assessments keep v1, their score and their band; a new assessment still uses v1. | COVERED for "publishing". Pin migration of the transformation to v2 (ADR-0040) is not exercised; see §6. |
| REQ-S14-004 | +7 days moves every unstarted task by 7 and leaves completed tasks unchanged; incomplete predecessor → 'blocked by' | `a16-launch-plan` › "owners are assigned; a task whose predecessor is incomplete shows 'blocked by' …" (also 422 `validation.user_invalid` for a foreign owner and 422 `launch_task.predecessor_cycle`); "completing the predecessor clears 'blocked by'"; "+7 days moves every unstarted task by 7 days and leaves completed (and started) tasks unchanged; the open Day-90 test moves too" (also 428, 409, AUD 403, `lastShiftDays` 7, and 422 `launch_task.completed_dates_fixed`). | COVERED through the API. "Blocked by" in the UI is not in my e2e spec. |
| REQ-S16-021 | entities with PK, owner, status; an integration test creates and reads each through the API with authorization enforced | `a16-s16-021-entities` (6 tests: Control, BAUHandover, ImprovementItem, Lesson, HealthAssessment, ControlCheck). The ERD/migration half of the row is a design artefact that the domain reviewer inspects; the API reads show the id, owner and status fields. | COVERED (API half). ControlCheck has no create operation in the contract, so it is "created" by the production control-check job and then read and recorded through the API (AUD 403 on record). |
| REQ-S20-016 | A16 executable test (unit; e2e) passes | all of the above: 30 integration tests plus 4 e2e runs. No unit-level A16 file was added, because the scoring is covered end to end through the real API and database. | COVERED (integration + e2e) |

## 4. Mutation checks (disposable copy only)

Method:
- **Copy:** `$TMPDIR/mut`, a copy of `apps`, `packages`, `tests`, `e2e`, `tools`, the root configs, `node_modules`, `docs/source/playbook.md` and `docs/api/openapi.yaml`. It was deleted after use.
- **Per mutant:** one `sed` changes the copy, the A16 file runs in full, and the file is restored.
- **Baseline in the copy:** 30/30 passed.

| Mutant | Behaviour broken (copy only) | Killed by (failing assertion) |
|---|---|---|
| M1 REQ-S14-002 | `scoring.ts`: score an assessment with 24 answers | "24 answers …": `expected '17' to be null` → KILLED |
| M2 REQ-PB-092 | `scoring.ts`: band boundary `greaterThan` → `greaterThanOrEqualTo` | the band tests: submit returns 500 (the database's score/band guard refuses the mismatching band) → KILLED |
| M3 REQ-PB-091 | `questions.ts`: question text changed ("3-5" → "3 to 5") | "25 playbook questions verbatim": `expected [...] to deeply equal [...]` → KILLED |
| M4 REQ-PB-086 | `launch/plan.ts`: day d = start + d + 1 | "Confirm sponsor 2026-10-02..2026-11-01: expected false"; Day-90 date `2026-12-31` ≠ `2026-12-30` → KILLED |
| M5 REQ-S14-004 | `launch/plan.ts`: re-dating also moves `in_progress` tasks | "in_progress Roadmap: expected ['2026-12-08','2027-01-06'] to deeply equal ['2026-12-01','2026-12-30']" → KILLED |
| M6 REQ-PB-087 | `day-ninety.ts`: complete with 5 of 6 | "five answers: incomplete (5/6)": completion object differs → KILLED |
| M7 REQ-S12-004 | worker `launch-plan-generator.ts`: tasks one day late | "Agree North Star/outcomes: expected false to be true" (Days 31-60 range) → KILLED |
| M8 REQ-PB-091 | API three-action check removed | SURVIVED. The database guard `health_assessment_three_actions` (0086) refuses with the same code, so the behaviour is intact. |
| M8b REQ-PB-091 | API check **and** the 0086 guard (`<> 3` → `< 0`) both disabled | "no actions -> 422 …": `expected [200, undefined] to deeply equal [422, 'health_check.actions_required']` → KILLED |

**Disclosure:** the first mutation pass (`05-mutation-checks-run1-filtered.log`) used `-t` filters. M5 and M6 then "failed" only because the filter skipped the serial setup test that generates the plan (404). That pass is kept as a log but is **not** counted. The counted pass (`05-mutation-checks.log`) runs each file in full, and every kill above is attributed to the targeted assertion.

The e2e spec was not mutation-tested, because that would need a rebuilt `apps/web/dist` in a copy. Its assertions mirror the API assertions killed above.

## 5. Product defects found

**None.** Every A16 acceptance behaviour I tested holds on HEAD `bb0601f`.

Observations, not defects:
- A refused write (AUD 403) writes one `authorization.denied` audit row. This is a security denial log, and nothing about the target record is written.
- Under mutant M2 only, the database score-match guard surfaced as HTTP 500 `internal`. In the real code the API and the database compute the same result, so this cannot happen without a code defect.

## 6. What remains / not covered

- **REQ-S14-003:** moving a transformation's `health_check_scheme` pin to v2 (ADR-0040 migration) is not exercised. What is tested: after v2 is published, every existing assessment keeps v1, its score and its band, and a new assessment still uses v1.
- **REQ-DLV-037:** only the A16 part. A06, A07, A15 and the bilingual export-sample inspection are for the other QA tasks and the DG5 reviewers.
- **UI coverage gaps:** the e2e spec does not drive the Day-90 test screen, task "Blocked by" or re-dating in the UI; all three are proven through the API. In Arabic the B0134 action check is the row count and dates, because the titles are provisional Arabic translations; the English project checks the 17 actions verbatim.
- **REQ-S12-004 A13 clause:** asserted as "a retry adds nothing", not as an exact expected number of phase steps and role tasks.

## 7. Merge instructions

- Add the five new files and the evidence directory. They do not collide with the other W17 QA tasks (all prefixed `a16-`), and no existing file was changed.
- No migrations.
- `tests/qa/support/a16.ts` only adds new exports. It re-exports existing `apps/**` symbols, the same pattern as `a11.ts`.
- Do not integrate the untracked root files listed in §2.
