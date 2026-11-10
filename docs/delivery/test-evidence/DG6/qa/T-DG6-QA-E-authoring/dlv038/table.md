### Integration (`tests/qa/integration`, real API + disposable PostgreSQL)

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

### Unit (`tests/qa/unit`, unit-node)

| File | Tests | Result |
| --- | ---: | --- |
| `tests/qa/unit/dlv038-s20-029-load-report.test.ts` | 6 | PASS |
| `tests/qa/unit/a22-s21-001-text-scan.test.ts` | 7 | PASS |
| `tests/qa/unit/a20-p6-token-contrast.test.ts` | 4 | PASS |
| `tests/qa/unit/a20-p6-i18n-catalogue.test.ts` | 3 | PASS |
| `tests/qa/unit/a05-calc-units.test.ts` | 15 | PASS |

### Root e2e, dev stack (`apps/web/e2e/support/with-stack.sh`), one run, `--workers=1`

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

### Root e2e, demo stack (`e2e/support/with-demo-stack.sh`), `--workers=1`

('skip' counts Playwright's '-' lines: skipped tests and tests that did not run after a failure in a serial file.)

| Spec | chromium-en pass/fail/skip | chromium-ar pass/fail/skip | Result |
| --- | --- | --- | --- |
| `e2e/a02-demo-labels.spec.ts` | 3/0/0 | 3/0/0 | PASS |
| `e2e/a02-demo-users-walkthrough.spec.ts` | 1/0/0 | 1/0/0 | PASS |
| `e2e/a02-guided-walkthrough.spec.ts` | 1/0/0 | 1/0/0 | PASS |
| `e2e/a21-no-ai-operation.spec.ts` | 1/0/0 | 1/0/0 | PASS |

Playwright summary: 12 passed (6.6m); exit 0; log `dlv038/e2e-demo-stack.log`.

### Root e2e, identity (`e2e/identity/keycloak-login.spec.ts`)

('skip' counts Playwright's '-' lines: skipped tests and tests that did not run after a failure in a serial file.)

| Spec | chromium-en pass/fail/skip | chromium-ar pass/fail/skip | Result |
| --- | --- | --- | --- |
| `e2e/identity/keycloak-login.spec.ts` | 0/0/2 | 0/0/2 | BLOCKED (all skipped) |

Playwright summary: 4 skipped; exit 0; log `dlv038/e2e-keycloak.log`.

### Re-run alone: `a12-p6-scope-isolation`

('skip' counts Playwright's '-' lines: skipped tests and tests that did not run after a failure in a serial file.)

| Spec | chromium-en pass/fail/skip | chromium-ar pass/fail/skip | Result |
| --- | --- | --- | --- |
| `e2e/a12-p6-scope-isolation.spec.ts` | 5/1/0 | 5/1/0 | FAIL |

Playwright summary: 2 failed; 10 passed (2.5m); exit 1; log `dlv038/e2e-rerun-alone-a12-p6-scope-isolation.log`.

### Re-run alone: `a17-failing-connector-exception`

('skip' counts Playwright's '-' lines: skipped tests and tests that did not run after a failure in a serial file.)

| Spec | chromium-en pass/fail/skip | chromium-ar pass/fail/skip | Result |
| --- | --- | --- | --- |
| `e2e/a17-failing-connector-exception.spec.ts` | 0/1/0 | 0/1/0 | FAIL |

Playwright summary: 2 failed; exit 1; log `dlv038/e2e-rerun-alone-a17-failing-connector-exception.log`.

### Re-run alone: `a17-import-and-integration`

('skip' counts Playwright's '-' lines: skipped tests and tests that did not run after a failure in a serial file.)

| Spec | chromium-en pass/fail/skip | chromium-ar pass/fail/skip | Result |
| --- | --- | --- | --- |
| `e2e/a17-import-and-integration.spec.ts` | 5/0/0 | 5/0/0 | PASS |

Playwright summary: 10 passed (2.1m); exit 0; log `dlv038/e2e-rerun-alone-a17-import-and-integration.log`.

### Re-run alone: `a20-p6-ux`

('skip' counts Playwright's '-' lines: skipped tests and tests that did not run after a failure in a serial file.)

| Spec | chromium-en pass/fail/skip | chromium-ar pass/fail/skip | Result |
| --- | --- | --- | --- |
| `e2e/a20-p6-ux.spec.ts` | 7/0/0 | 7/0/0 | PASS |

Playwright summary: 14 passed (1.8m); exit 0; log `dlv038/e2e-rerun-alone-a20-p6-ux.log`.

### Re-run alone: `a21-p6-degradation`

('skip' counts Playwright's '-' lines: skipped tests and tests that did not run after a failure in a serial file.)

| Spec | chromium-en pass/fail/skip | chromium-ar pass/fail/skip | Result |
| --- | --- | --- | --- |
| `e2e/a21-p6-degradation.spec.ts` | 2/0/0 | 2/0/0 | PASS |

Playwright summary: 4 passed (34.6s); exit 0; log `dlv038/e2e-rerun-alone-a21-p6-degradation.log`.

### A18 clean start (`e2e/clean-start/a18-clean-start.sh`, fresh checkout of 60535e99)

`A18 CLEAN START: PASS` (exit 0, 517.5 s). Fresh checkout, `pnpm -r build`, fresh PostgreSQL, migrate (113; re-run no-op), API and worker in production configuration, `/healthz` and `/readyz` 200, SPA `lang="ar" dir="rtl"`, dev login 404, restart ready, unmigrated database `/readyz` 503. The install step is **NOT RUN**: the assignment forbids `pnpm install`, so the installed node_modules were copied. Log `dlv038/a18-clean-start.log`.
