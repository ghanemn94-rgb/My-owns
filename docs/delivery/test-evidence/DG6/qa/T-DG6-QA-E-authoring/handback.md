# Handback T-DG6-QA-E / T-DG6-QA-EB (qa-verifier, authoring): A22 extension, A01 final run, REQ-DLV-038 evidence run

- **Stage:** DG6 (P6, BUILDING). Kind: **authoring**. This is not the DG6 gate QA review, which is a separate session.
- **Invocation (QA-EB):** `{"kind":"claude-code-cli-session","run_id":"DG6-T-DG6-QA-EB-qa-verifier-20261031T040946Z-b0553a8a","session_id":"b0553a8a-b047-4582-ab48-35ddea6691ee"}`
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-QA-EB.md`, sha256 `546b7a07…a2ea73` (verified).
- **Worktree:** `/home/user/wt/dg6-qa-e`, branch `dg6/qa-e`.
- **Integrated HEAD for every run:** `60535e99ed0d7fb6fbb67b9b7a8ed31aa47b2cdb`.
  - BE-X4, BE-X5 and QA-F had **not** merged when I checked at about 04:35Z: the integrated branch tip `ce5f4099e` is contained in this HEAD.
  - Every suite below ran on `60535e99` plus my uncommitted test files.
- **Time:** start `2026-10-31T04:12:18Z`. The end time is in §9.
- **Data:** all of it is SYNTHETIC. No business, Finance or IT approval was granted. Product gates G1–G6 appear only as synthetic in-product fixture data, and no product text names DG0–DG7.

## 1. Who wrote what

QA-E (killed by a machine restart; WIP commit `a1bb636fd`) wrote:

| File | Purpose |
| --- | --- |
| `tests/qa/support/a22-ops.ts` | The real API on a scratch DB with its log lines captured, the BUILT worker as its own OS process, and the operator log scan. |
| `tests/qa/integration/a22-p6-operability.test.ts` | The A22 P6 extension: structured logs and redaction, the heartbeat (unknown/alive/stale), the `heartbeat_missed` exception, the alert line, the in-app alert and recovery, the connector exception lifecycle, and the post-suite log scan with negative controls. |
| `tests/qa/integration/a01-p6-source-coverage.test.ts` | The A01 final run on the demo seed: six phases, six gates, T01–T16, the catalogue, charter, TOM canvas, business case, launch plan, health check and the roaming example. |
| `e2e/a22-p6-operability.spec.ts` | A22's user-visible path on Administration > Operations in chromium-en and chromium-ar. |
| `screenshots/{en,ar}/a22-p6-*.png` | Screenshots from QA-E's partial run. My run regenerated all 8. |

QA-EB (this session) reviewed QA-E's work critically, then changed and added the following:

| File | Change |
| --- | --- |
| `tests/qa/integration/a22-p6-operability.test.ts` | **Tightened** the conflict statuses to the contract. A stale If-Match must be `409 urn:mth:problem:version-conflict` with `currentVersion` (it accepted 409 or 412). A second acknowledge and a second resolve must each be exactly 409, with `operations.exception_not_open` / `operations.exception_resolved` (they accepted 409 or 422). **Added** "A22 health checks and admin job visibility", 3 tests. The P5 A22 suite never asserted the health endpoints, though A22 names them: `/healthz` returns 200 `{status: ok}` with X-Request-Id; `/readyz` returns 200 ready, with database ok and migrations ok; on an **unmigrated** database `/readyz` returns 503 `not_ready` while `/healthz` stays 200; the jobs view lists `operations.exception_alerts` with its last success and outcome, and a next run or an explicit reason; and a TL gets 403. Updated the header and formatting. |
| `tests/qa/integration/a01-p6-source-coverage.test.ts` | QA-E's header claimed the TOM canvas "accepts a native write", but no test wrote to it. **Added** that test: the lead PATCHes the `technology` box with If-Match, gets 200 at version+1, and reads it back; the read-only auditor gets 403. Fixed the header and formatting. |
| `tests/qa/unit/dlv038-s20-029-load-report.test.ts` (**new**) | An independent check of DO-G's DG6 load report against REQ-S20-029. Every p95 and count (6 groups × 3 repetitions) is recomputed from the raw `samples.csv.gz` with my own parser and nearest-rank code, and must match to the microsecond. Each verdict is checked against 2 s / 4 s, and the misses section against the verdicts. The test also checks that the report states the dataset, infrastructure and workload. This closes the "QA-E's verification is pending" note on REQ-S20-029. |
| `docs/delivery/test-evidence/DG6/qa/T-DG6-QA-E-authoring/**` | `eb-*` logs, `dlv038/` (the DLV-038 run), `mutations/`, and regenerated screenshots. |

`tests/qa/support/a22-ops.ts` and `e2e/a22-p6-operability.spec.ts` are QA-E's and unchanged. I reviewed both: they assert real behaviour (API statuses, DB-visible states, rendered `lang`/`dir`, axe) and contain no implementation shortcuts. The one test-side state manipulation is ageing `worker_heartbeat` rows as superuser to simulate more than 90 s without a beat, and it is disclosed in both files.

## 2. Checks run (real exit codes)

The log paths are relative to this folder. Every run used `PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH` and `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`. Ports were in 27050–27099 only. `df -h .` showed 7.9 G free before each full run (`dlv038/df-*.txt`).

| # | Command (abridged) | Exit | Result | Log |
| --- | --- | --- | --- | --- |
| 1 | `node tools/gates/validate.mjs --historical --stage DG5` (start) | 0 | `PASS gate DG5 (historical)` | `eb-validate-dg5-start.log` |
| 2 | `QA_PG_PORT=27050 MTH_PORT_POOL=27051-27069 tests/qa/support/with-pg.sh pnpm vitest run --project integration <a22-p6, a01-p6>` (first try) | 1 | **Startup error, no test ran.** `node_modules` is read-only in the sandbox, so vite could not write `node_modules/.vite-temp`. All later Vitest runs add `--configLoader runner`, as the QA-A precedent does. | `eb-run0-a22-a01-configloader-enoent.log` |
| 3 | same + `--configLoader runner` (QA-E's files as found) | 0 | 24/24: a22-p6 14, a01-p6 10 | `eb-run1-a22-a01.log` |
| 4 | a22-p6 after the QA-EB edits | 0 | **17/17** | `eb-run2-a22.log` |
| 5 | a01-p6 after the QA-EB edits | 0 | **11/11** | `eb-run3-a01.log` |
| 6 | `E2E_PG_PORT=27070 E2E_API_PORT=27071 MTH_PORT_POOL=27072-27079 apps/web/e2e/support/with-stack.sh npx playwright test e2e/a22-p6-operability.spec.ts --workers=1` | 0 | **2/2**: chromium-en 48.4 s, chromium-ar 1.0 min. axe found 0 serious or critical issues on all 5 checked screens per language (`expectAccessible` fails on any). | `eb-e2e-a22-run1.log`, `screenshots/{en,ar}/` |
| 7 | `npx vitest run --project unit-node tests/qa/unit/dlv038-s20-029-load-report.test.ts` (first version) | 1 | **My own test hit Vitest's 5 s default test timeout** while it parsed about 107,000 rows inside the test, with the host at load average 15 on 4 CPUs. I did not raise the timeout. I moved the parse to module load and removed the per-row `expect` calls. | `eb-unit-load-report-run1-timeout.log` |
| 8 | same, fixed | 0 | **6/6** | `eb-unit-load-report.log` |
| 9 | **Acceptance 1:** `QA_PG_PORT=27050 MTH_PORT_POOL=27051-27069 tests/qa/support/with-pg.sh pnpm vitest run --configLoader runner --project integration tests/qa` | **1** | **430/431 passed. 43 files pass and 1 fails:** `a17-import-and-integration.test.ts`, 9/10. The failure is product defect P-1, §5. Per-file counts are in §3. | `dlv038/integration-tests-qa.log` |
| 10 | `npx vitest run --configLoader runner --project unit-node tests/qa` | 0 | 35/35 (5 files) | `dlv038/unit-node-tests-qa.log` |
| 11 | `pnpm lint` (eslint, whole repository, `--max-warnings=0`) | 0 | clean | `eb-pnpm-lint.log` |
| 12 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | all files formatted. This ran before this handback existed; the handback was checked separately in §9. | `eb-prettier-all.log` |
| 13 | `npx eslint --max-warnings=0` / `npx prettier --check` on the four A22/A01 files | 0 / 0 | clean | `eb-eslint-own.log`, `eb-prettier-own.log` |
| 14 | Mutation checks M1–M7 (§6) | 1 each (expected) | 7/7 detected | `mutations/M*.log` |
| 15 | DLV-038 root e2e (§3) | see §3 | see §3 | `dlv038/e2e-*.log` |
| 16 | A18 clean start, `e2e/clean-start/a18-clean-start.sh` | see §3 | see §3 | `dlv038/a18-clean-start.log` |
| 17 | `node tools/gates/validate.mjs --historical --stage DG5` (end) | see §9 | | `eb-validate-dg5-end.log` |

## 3. REQ-DLV-038 evidence run: every acceptance suite A01–A22 on the integrated tree

Everything ran on HEAD `60535e99` with `--workers=1`, in chromium-en and chromium-ar. The tables below were generated from the logs (`dlv038/table.md`).

#### Integration (`tests/qa/integration`, real API + disposable PostgreSQL)

| File | Tests | Passed | Failed | Result |
| --- | ---: | ---: | ---: | --- |
| `tests/qa/integration/a02-a21-complete-lifecycle.test.ts` | 13 | 13 | 0 | PASS |
| `tests/qa/integration/a07-historical-integrity.test.ts` | 12 | 12 | 0 | PASS |
| `tests/qa/integration/a06-configuration-change.test.ts` | 27 | 27 | 0 | PASS |
| `tests/qa/integration/a08-gate-controls.test.ts` | 31 | 31 | 0 | PASS |
| `tests/qa/integration/a09-decision-escalation.test.ts` | 17 | 17 | 0 | PASS |
| `tests/qa/integration/a12-p6-scope-isolation.test.ts` | 26 | 26 | 0 | PASS |
| `tests/qa/integration/a13-durable-automation.test.ts` | 12 | 12 | 0 | PASS |
| `tests/qa/integration/a17-import-and-integration.test.ts` | 10 | 9 | 1 | FAIL |
| `tests/qa/integration/a22-p6-operability.test.ts` | 17 | 17 | 0 | PASS |
| `tests/qa/integration/a10-benefit-integrity.test.ts` | 16 | 16 | 0 | PASS |
| `tests/qa/integration/a05-calculation-correctness.test.ts` | 17 | 17 | 0 | PASS |
| `tests/qa/integration/a11-bau-sustain.test.ts` | 17 | 17 | 0 | PASS |
| `tests/qa/integration/a11-adoption.test.ts` | 12 | 12 | 0 | PASS |
| `tests/qa/integration/a16-health-check.test.ts` | 13 | 13 | 0 | PASS |
| `tests/qa/integration/a11-value-closure.test.ts` | 11 | 11 | 0 | PASS |
| `tests/qa/integration/a04-kpi-propagation.test.ts` | 8 | 8 | 0 | PASS |
| `tests/qa/integration/a16-launch-plan.test.ts` | 11 | 11 | 0 | PASS |
| `tests/qa/integration/a22-operational-readiness.test.ts` | 8 | 8 | 0 | PASS |
| `tests/qa/integration/a21-p6-adapters-disabled.test.ts` | 10 | 10 | 0 | PASS |
| `tests/qa/integration/a13-jobs-rerun.test.ts` | 5 | 5 | 0 | PASS |
| `tests/qa/integration/a15-snapshots-and-packs.test.ts` | 15 | 15 | 0 | PASS |
| `tests/qa/integration/a13-starter-jobs.test.ts` | 4 | 4 | 0 | PASS |
| `tests/qa/integration/a13-dependency-slip-rule-b.test.ts` | 8 | 8 | 0 | PASS |
| `tests/qa/integration/a13-starters-run.test.ts` | 11 | 11 | 0 | PASS |
| `tests/qa/integration/a03-modular-entry.test.ts` | 12 | 12 | 0 | PASS |
| `tests/qa/integration/a04-a05-a10-partials.test.ts` | 4 | 4 | 0 | PASS |
| `tests/qa/integration/a14-p6-bulk-compare-reapply.test.ts` | 6 | 6 | 0 | PASS |
| `tests/qa/integration/a15-outputs-every-definition.test.ts` | 5 | 5 | 0 | PASS |
| `tests/qa/integration/a15-demo-transformation-outputs.test.ts` | 7 | 7 | 0 | PASS |
| `tests/qa/integration/a12-cross-scope.test.ts` | 14 | 14 | 0 | PASS |
| `tests/qa/integration/a13-job-idempotency.test.ts` | 5 | 5 | 0 | PASS |
| `tests/qa/integration/a02-a08-drafts-before-g2-scale-after-g5.test.ts` | 1 | 1 | 0 | PASS |
| `tests/qa/integration/a01-p6-source-coverage.test.ts` | 11 | 11 | 0 | PASS |
| `tests/qa/integration/a13-p6-connector-run-kill-restart.test.ts` | 1 | 1 | 0 | PASS |
| `tests/qa/integration/a17-s01-005-external-change.test.ts` | 4 | 4 | 0 | PASS |
| `tests/qa/integration/a15-selected-records-and-injection.test.ts` | 7 | 7 | 0 | PASS |
| `tests/qa/integration/a13-p6-channel-send-kill-restart.test.ts` | 1 | 1 | 0 | PASS |
| `tests/qa/integration/a14-concurrency.test.ts` | 5 | 5 | 0 | PASS |
| `tests/qa/integration/a16-s16-021-entities.test.ts` | 6 | 6 | 0 | PASS |
| `tests/qa/integration/a01-one-source-of-truth-scorecard.test.ts` | 2 | 2 | 0 | PASS |
| `tests/qa/integration/a13-p6-import-commit-kill-restart.test.ts` | 1 | 1 | 0 | PASS |
| `tests/qa/integration/a13-p6-reindex-kill-restart.test.ts` | 1 | 1 | 0 | PASS |
| `tests/qa/integration/a13-p6-outbound-write-once.test.ts` | 3 | 3 | 0 | PASS |
| `tests/qa/integration/a20-p6-register-1000.test.ts` | 4 | 4 | 0 | PASS |

Totals: 1 failed | 430 passed (431); log `dlv038/integration-tests-qa.log`.

#### Unit (`tests/qa/unit`, unit-node)

| File | Tests | Result |
| --- | ---: | --- |
| `tests/qa/unit/dlv038-s20-029-load-report.test.ts` | 6 | PASS |
| `tests/qa/unit/a22-s21-001-text-scan.test.ts` | 7 | PASS |
| `tests/qa/unit/a20-p6-token-contrast.test.ts` | 4 | PASS |
| `tests/qa/unit/a20-p6-i18n-catalogue.test.ts` | 3 | PASS |
| `tests/qa/unit/a05-calc-units.test.ts` | 15 | PASS |

#### Root e2e, dev stack (`apps/web/e2e/support/with-stack.sh`), one run, `--workers=1`

('skip' counts Playwright's '-' lines: skipped tests and tests that did not run after a failure in a serial file.)

| Spec | chromium-en pass/fail/skip | chromium-ar pass/fail/skip | Result |
| --- | --- | --- | --- |
| `e2e/a03-modular-entry.spec.ts` | 2/0/0 | 2/0/0 | PASS |
| `e2e/a04-kpi-update.spec.ts` | 1/0/0 | 1/0/0 | PASS |
| `e2e/a06-configuration-change.spec.ts` | 2/0/0 | 2/0/0 | PASS |
| `e2e/a07-historical-integrity.spec.ts` | 1/0/0 | 1/0/0 | PASS |
| `e2e/a08-a09-gates-decisions.spec.ts` | 2/0/0 | 2/0/0 | PASS |
| `e2e/a12-p6-scope-isolation.spec.ts` | 5/1/0 | 4/2/0 | FAIL |
| `e2e/a13-automation-recovery.spec.ts` | 1/0/0 | 1/0/0 | PASS |
| `e2e/a13-connector-run-once.spec.ts` | 1/0/0 | 1/0/0 | PASS |
| `e2e/a14-compare-reapply.spec.ts` | 1/0/0 | 1/0/0 | PASS |
| `e2e/a15-reporting.spec.ts` | 1/0/0 | 1/0/0 | PASS |
| `e2e/a16-health-launch.spec.ts` | 2/0/0 | 2/0/0 | PASS |
| `e2e/a17-failing-connector-exception.spec.ts` | 0/1/0 | 0/1/0 | FAIL |
| `e2e/a17-import-and-integration.spec.ts` | 4/1/0 | 4/1/0 | FAIL |
| `e2e/a20-bilingual-shell.spec.ts` | 2/0/0 | 2/0/0 | PASS |
| `e2e/a20-p6-axe.spec.ts` | 38/0/9 | 38/0/9 | PASS |
| `e2e/a20-p6-layout-brand.spec.ts` | 3/0/0 | 3/0/0 | PASS |
| `e2e/a20-p6-ux.spec.ts` | 7/0/0 | 5/1/1 | FAIL |
| `e2e/a21-p6-degradation.spec.ts` | 0/1/1 | 0/1/1 | FAIL |
| `e2e/a22-operations-jobs.spec.ts` | 1/0/0 | 1/0/0 | PASS |
| `e2e/a22-p6-operability.spec.ts` | 1/0/0 | 1/0/0 | PASS |

Playwright summary: 10 failed; 18 skipped; 3 did not run; 147 passed (34.1m); exit 1; log `dlv038/e2e-dev-stack.log`.

#### Root e2e, demo stack (`e2e/support/with-demo-stack.sh`), `--workers=1`

('skip' counts Playwright's '-' lines: skipped tests and tests that did not run after a failure in a serial file.)

| Spec | chromium-en pass/fail/skip | chromium-ar pass/fail/skip | Result |
| --- | --- | --- | --- |
| `e2e/a02-demo-labels.spec.ts` | 3/0/0 | 3/0/0 | PASS |
| `e2e/a02-demo-users-walkthrough.spec.ts` | 1/0/0 | 1/0/0 | PASS |
| `e2e/a02-guided-walkthrough.spec.ts` | 1/0/0 | 1/0/0 | PASS |
| `e2e/a21-no-ai-operation.spec.ts` | 1/0/0 | 1/0/0 | PASS |

Playwright summary: 12 passed (6.6m); exit 0; log `dlv038/e2e-demo-stack.log`.

#### Root e2e, identity (`e2e/identity/keycloak-login.spec.ts`)

('skip' counts Playwright's '-' lines: skipped tests and tests that did not run after a failure in a serial file.)

| Spec | chromium-en pass/fail/skip | chromium-ar pass/fail/skip | Result |
| --- | --- | --- | --- |
| `e2e/identity/keycloak-login.spec.ts` | 0/0/2 | 0/0/2 | BLOCKED (all skipped) |

Playwright summary: 4 skipped; exit 0; log `dlv038/e2e-keycloak.log`.

#### Re-run alone: `a12-p6-scope-isolation`

('skip' counts Playwright's '-' lines: skipped tests and tests that did not run after a failure in a serial file.)

| Spec | chromium-en pass/fail/skip | chromium-ar pass/fail/skip | Result |
| --- | --- | --- | --- |
| `e2e/a12-p6-scope-isolation.spec.ts` | 5/1/0 | 5/1/0 | FAIL |

Playwright summary: 2 failed; 10 passed (2.5m); exit 1; log `dlv038/e2e-rerun-alone-a12-p6-scope-isolation.log`.

#### Re-run alone: `a17-failing-connector-exception`

('skip' counts Playwright's '-' lines: skipped tests and tests that did not run after a failure in a serial file.)

| Spec | chromium-en pass/fail/skip | chromium-ar pass/fail/skip | Result |
| --- | --- | --- | --- |
| `e2e/a17-failing-connector-exception.spec.ts` | 0/1/0 | 0/1/0 | FAIL |

Playwright summary: 2 failed; exit 1; log `dlv038/e2e-rerun-alone-a17-failing-connector-exception.log`.

#### Re-run alone: `a17-import-and-integration`

('skip' counts Playwright's '-' lines: skipped tests and tests that did not run after a failure in a serial file.)

| Spec | chromium-en pass/fail/skip | chromium-ar pass/fail/skip | Result |
| --- | --- | --- | --- |
| `e2e/a17-import-and-integration.spec.ts` | 5/0/0 | 5/0/0 | PASS |

Playwright summary: 10 passed (2.1m); exit 0; log `dlv038/e2e-rerun-alone-a17-import-and-integration.log`.

#### Re-run alone: `a20-p6-ux`

('skip' counts Playwright's '-' lines: skipped tests and tests that did not run after a failure in a serial file.)

| Spec | chromium-en pass/fail/skip | chromium-ar pass/fail/skip | Result |
| --- | --- | --- | --- |
| `e2e/a20-p6-ux.spec.ts` | 7/0/0 | 7/0/0 | PASS |

Playwright summary: 14 passed (1.8m); exit 0; log `dlv038/e2e-rerun-alone-a20-p6-ux.log`.

#### Re-run alone: `a21-p6-degradation`

('skip' counts Playwright's '-' lines: skipped tests and tests that did not run after a failure in a serial file.)

| Spec | chromium-en pass/fail/skip | chromium-ar pass/fail/skip | Result |
| --- | --- | --- | --- |
| `e2e/a21-p6-degradation.spec.ts` | 2/0/0 | 2/0/0 | PASS |

Playwright summary: 4 passed (34.6s); exit 0; log `dlv038/e2e-rerun-alone-a21-p6-degradation.log`.

#### A18 clean start (`e2e/clean-start/a18-clean-start.sh`, fresh checkout of 60535e99)

`A18 CLEAN START: PASS` (exit 0, 517.5 s). Fresh checkout, `pnpm -r build`, fresh PostgreSQL, migrate (113; re-run no-op), API and worker in production configuration, `/healthz` and `/readyz` 200, SPA `lang="ar" dir="rtl"`, dev login 404, restart ready, unmigrated database `/readyz` 503. The install step is **NOT RUN**: the assignment forbids `pnpm install`, so the installed node_modules were copied. Log `dlv038/a18-clean-start.log`.

**Re-runs.** The rule is to re-run a spec alone and report both runs, and never to raise a timeout. Each spec below was re-run alone on a fresh stack:

| Spec | Full run | Alone | Reading |
| --- | --- | --- | --- |
| `a12-p6-scope-isolation` A12-5 (assistant) | en ✘, ar ✘ | en ✘, ar ✘ | **Product defect P-2**: deterministic. |
| `a12-p6-scope-isolation` A12-6 (ar) | ✘: the dev sign-in field was not visible within 5 s (load average about 15 on 4 CPUs) | ✓ | Fails only under load. Both runs are reported, and the spec was not changed. |
| `a17-failing-connector-exception` | en ✘, ar ✘ | en ✘, ar ✘ | **Product defect P-1**: deterministic. |
| `a17-import-and-integration` REQ-S17-003 (webhook) | en ✘, ar ✘: `QA_A17_WEBHOOK_SIGNING_SECRET must be exported before the stack starts (BLOCKED otherwise)` | ✓ 10/10, with a synthetic secret exported | **My harness omission** in the full run, not a product failure. The full-run result for this test is BLOCKED, and the alone run is the result. |
| `a20-p6-ux` keyboard (ar) | ✘: the language switch was not focused after the Tab sequence; 1 test did not run after it | ✓ 14/14 | Order- or load-dependent, not reproduced alone. Reported as **Q-2**. |
| `a21-p6-degradation` REQ-S17-009 | en ✘, ar ✘: `configured: true` where `false` was expected; 1 test did not run after it per language | ✓ 4/4 | **Test-isolation defect Q-1** in the shared stack. `a12-p6-scope-isolation` (A12-5) leaves the assistant configured, and `a21-p6-degradation` assumes a fresh stack. Not a product defect. |

**Not run or BLOCKED within A01–A22:**

- `e2e/identity/keycloak-login.spec.ts` (REQ-S16-007, A18;A12): **BLOCKED**, 4 skipped. The skip reason is `BLOCKED: no Keycloak test-idp stack configured (MTH_E2E_KEYCLOAK is not 1)`: there is no container runtime or Keycloak in this sandbox.
- `a20-p6-axe`: 9 routes per language are skipped by the spec's own design (`NOT SCANNED: …`, no fixture value). The spec belongs to QA-D and I didn't change it.
- A18 clean start ran without `--install`, because the assignment forbids `pnpm install`. The install step is therefore NOT RUN; the script copies the installed `node_modules`.
- A19 has no root suite of its own here beyond A18 and identity.

## 4. Requirement → test table (DG6 rows citing A22, A01 or DLV-038)

The rows come from `docs/delivery/requirements.csv`: stage DG6, with `acceptance`, `increments` or `notes` citing A22, A01 or DLV-038. Each row is tested literally against its acceptance text.

| Row | Binding acceptance text | Test that proves it | Result on `60535e99` |
| --- | --- | --- | --- |
| REQ-S20-022 | "A22: Health checks, logs, error alerts, admin job visibility and production/demo separation are demonstrated" | `a22-p6-operability.test.ts`: health (`/healthz`, `/readyz` ready and not ready), structured JSON logs with requestId, redaction, the alert line, the in-app alert, heartbeat unknown/alive/stale, exceptions, the jobs view with the P6 sweep, and the log scan. `a22-operational-readiness.test.ts` (P5): the jobs view and production/demo separation. `e2e/a22-p6-operability.spec.ts` and `e2e/a22-operations-jobs.spec.ts`: the screens in en and ar. | **PASS**: 17/17 + 8/8 + e2e 2/2 + 2/2 |
| REQ-S16-029 | "A12;A22: a log scan after the test suite finds no secrets or storage URLs; a job's identity cannot read records outside its scope" | Log scan: `a22-p6-operability.test.ts` "post-suite log scan". `deploy/scripts/log-scan.mjs` runs over this suite's own API and worker logs with 5 canaries set and `--storage-path`, and passes. A leaked canary gives exit 1 without printing the value; no canary, or a delivery path, gives BLOCKED (2). Redaction: the "A22 logs" tests (bearer, cookie, CSRF, deep-link token, OIDC code/state). Scope: `a12-p6-scope-isolation.test.ts` (QA-B; 26/26 in run 9). | **PASS for both clauses.** The scan covers this suite's logs, not the whole integration run's: DO-D's full-run scan is the other evidence. |
| REQ-S12-019 | "A17;A22: a failing test connector produces one exception and the KPI shows Stale with its last value and date" | One exception plus one alert: `a22-p6-operability.test.ts` "operational exceptions …" (PASS). KPI Stale with last value and date: `a17-import-and-integration.test.ts` "failing connector …" and `e2e/a17-failing-connector-exception.spec.ts`. | **FAIL** on the KPI clause, **product defect P-1**. The one-exception clause passes. |
| REQ-S20-001 | "A01: Six phases, six gates, T01–T16, charter, TOM canvas, business case, launch plan, health check and example mapped to working features" | `a01-p6-source-coverage.test.ts`, 11 tests: one per named element, including native writes on the TOM canvas, the launch plan and the health check, and the B0143–B0147 example. Also `a01-one-source-of-truth-scorecard.test.ts` (2/2). | **PASS**: 11/11 + 2/2 |
| REQ-S20-029 | "A22;A13: the load report states the dataset, infrastructure and workload, and gives actual p95 figures for reads/updates and dashboards, with any miss against 2 s/4 s listed as a finding" | `tests/qa/unit/dlv038-s20-029-load-report.test.ts`: an independent recomputation of all 18 group p95 values and counts from the raw samples, equal to the microsecond. Verdicts are checked against 2 s / 4 s (the highest p95 values are read 22.9 ms, update 34.9 ms, dashboard 50.3 ms, so no miss), plus the dataset, infrastructure and workload statements. | **PASS** (6/6). The load was **not re-run** (it needs the dedicated load host and about 40 min). The test proves that the stated figures are what the raw samples give. |
| REQ-DLV-038 | "A12;A13;A14;A17;A21;A22;A23: the applicable A01-A22 executable tests pass on the DG6 candidate and the load report states the actual results against REQ-S20-029" | The whole of §3, plus the REQ-S20-029 row above. | **FAIL** on this tree: P-1 (A17/REQ-S12-019) and P-2 (A12-5/REQ-S17-007) fail deterministically. Keycloak is BLOCKED. Q-1 and Q-2 are suite-level. The load-report clause passes. **This is not the DG6 candidate:** the candidate is not frozen yet, and the gate run must repeat this once BE-X4 and BE-X5 merge. |

## 5. Product defects (failing tests kept; no workaround)

**P-1: REQ-S12-019, linked KPI on an operational exception shows Unknown with no last value (High; mandatory row text).**

This is already known as QA-A2-F1, and BE-X4 is the open repair. It reproduced deterministically on `60535e99`.

- Request: `GET /api/v1/admin/operations/exceptions/{exceptionId}` as KDS (and as AUD), after a failing test connector run, for a KPI whose actual 250.75 is dated 2026-01-31 while a later reporting period is open.
- Response: 200, with
  `linkedKpis[0] = {"kpiDefinitionId":"01a19040-a08f-75e8-9818-331f141a4250","transformationId":"01a19040-5e49-765e-8f9b-c0148f772eb2","name":"Synthetic KPI a5cd91","unitKind":"count","freshness":"unknown","lastValue":null,"lastValueAt":null}`.
- Expected: `freshness: "stale"`, `lastValue: "250.75"`, and `lastValueAt` on 2026-01-31 in Asia/Riyadh.
- Evidence: `dlv038/integration-tests-qa.log`, lines around 128–410.
- The e2e shows the same at the screen: `tr[data-kpi-freshness="unknown"]` where `stale` is expected, in both languages (`dlv038/e2e-dev-stack.log` failures 2 and 7; `dlv038/failures/*a17-failing-connector*`).

**P-2: REQ-S17-007 / A12-5, the assistant launcher is not shown to a signed-in TL while the assistant is on (High).**

BE-X5 is the open repair. It reproduced deterministically: the full run and the alone run, in both languages.

- Step: with the assistant configured and enabled by the spec's admin, the X-scoped TL opens a record page.
- Observed: `getByRole('button', { name: 'Assistant' | 'المساعد' })` is not found within 15 s.
- Expected: the launcher is visible.
- Evidence: `dlv038/e2e-rerun-alone-a12-p6-scope-isolation.log` and `dlv038/failures/*asked-about-X-it-cites-X*` (screenshot and error-context).

No new product defect was found in the A22 or A01 scope. All 17 A22 and 11 A01 assertions hold, including the tightened 409s.

## 6. Mutation checks (each run in a disposable clone under `$TMPDIR`; the product tree was never edited)

Method: `git clone` of this worktree at `60535e99` into `$TMPDIR/mut`, with the installed `node_modules` linked in. Each mutation was applied with an exact-match replacement, the targeted test ran, and the clone file was reverted (`git diff` was clean afterwards). The clone was removed afterwards. Each log holds the diff, the command, the output and the exit code.

| ID | Scenario | Behaviour broken (clone only) | Test that must catch it | Exit | Failing assertion |
| --- | --- | --- | --- | --- | --- |
| M1 | A22 logs / REQ-S16-029 | The deep-link token redaction rule keeps the token (`packages/config/src/load.ts`) | "an Authorization bearer token, … a deep-link token never appear in a log line" | 1 | `deep-link token: expected '{"level":30,…' not to contain 'QaA22SyntheticDeepLinkToken…'` |
| M2 | A22 heartbeat | A beat stays alive for 90,000 s instead of 90 s (`heartbeat.ts`) | "after the worker stops and >90 s pass, status is stale, never alive" | 1 | `expected 'alive' to be 'stale'` |
| M3 | A22 error alerts | The heartbeat watch writes `alert: false` (`heartbeat.ts`) | same test, the alert line | 1 | `expected [] to have a length of 1` (no alert line) |
| M4 | A22 exceptions (optimistic concurrency) | Acknowledge ignores If-Match (`exceptions.ts`) | "acknowledge: … 409 version-conflict on a stale version …" | 1 | `expected 200 to be 409` |
| M5 | A01 example | The demo North Star is changed (`packages/db/src/demo/data/roaming.ts`) | "example (B0143-B0147) …" | 1 | `expected '{"charter":…' to contain 'Make international roaming effortless…'` |
| M6 | A22 log scan / REQ-S16-029 | The scan ignores canary values (`deploy/scripts/log-scan.mjs`) | "negative control: … one leaked canary fail (exit 1)" | 1 | `log-scan: PASS: 3 file(s), … 5 canary value(s)` where exit 1 was expected. (The first scan test also fails under the `-t` filter, because no worker ran in that filtered run. Disclosed; it isn't what this mutation measures.) |
| M7 | DLV-038 / REQ-S20-029 | `summary.json` states rep-3 read p95 1 ms lower (22906 → 21906 µs) | "every stated p95 and count … equals the recomputation" | 1 | `read p95 per repetition: expected [19325, 21478, 21906] to deeply equal [19325, 21478, 22906]` |

## 7. Suite-level findings (not product)

- **Q-1 (Low; tests):** `e2e/a21-p6-degradation.spec.ts` REQ-S17-009 depends on order. It asserts the assistant is `configured: false`, but `e2e/a12-p6-scope-isolation.spec.ts` (A12-5) configures it on the same shared stack and doesn't restore it. It fails after A12 in a full root run (en and ar) and passes alone (4/4). Fix: A21 starts its own stack or resets the setting, or the run order separates them. This needs an orchestrator decision, because both specs are other tasks' work.
- **Q-2 (Low; tests):** `e2e/a20-p6-ux.spec.ts` keyboard test (ar) failed once in the full run: the language switch was not focused after the spec's Tab sequence. It passes alone (14/14). Likely cause: state left by an earlier spec, such as the assistant launcher (Q-1's configuration) adding a focus stop to the header. Not confirmed.
- **Q-3 (Info; my run):** the full-run REQ-S17-003 webhook failures were caused by my not exporting `QA_A17_WEBHOOK_SIGNING_SECRET`. The spec reports this as "BLOCKED otherwise" through a failing `expect`. The alone run with the variable set passes 10/10.

## 8. What remains

1. **The DLV-038 run on the frozen DG6 candidate.** This run is on the pre-freeze integrated tree `60535e99`. After BE-X4 (P-1), BE-X5 (P-2) and QA-F merge, re-run: `with-pg.sh … --project integration tests/qa`, then the root e2e sets as in §3, with `QA_A17_WEBHOOK_SIGNING_SECRET` exported and `a21-p6-degradation` run on its own stack (Q-1).
2. **Keycloak (REQ-S16-007)** remains BLOCKED until a container runtime or Keycloak test-IdP exists.
3. **The load itself was not re-run.** Only DO-G's report and raw samples were verified. Two disclosures stay as DO-G stated them: `getWorkstreamDashboard` was not measured, and the run used a patched `generate.mjs`.

## 9. End of run

- `node tools/gates/validate.mjs --historical --stage DG5` (end): **exit 0**, `PASS gate DG5 (historical)` (`eb-validate-dg5-end.log`).
- `date -u` at the end: `2026-10-31T05:14:47Z`, about 60 minutes after the start, within the 100-minute mark.
- Disposable material is gone: the `$TMPDIR/mut` mutation clone was removed after M1–M7; the e2e outputs and screenshots under `$TMPDIR` were not kept beyond the copies in `dlv038/failures/`.
- Nothing was committed. All changes are uncommitted in `/home/user/wt/dg6-qa-e` for the orchestrator.

Merge instructions: none special. Integrate the uncommitted files above. There are no migrations and no product files.
