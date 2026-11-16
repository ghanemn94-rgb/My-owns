## DG7 (BUILDING, not frozen)

DG7 has no gate record and no review round yet (`node tools/gates/validate.mjs --stage DG7` exits 1: `gate DG7: file not found (docs/delivery/gates/DG7.json)`, log `T-DG7-QA-D/02-validate--stage_DG7.log`). This section therefore lists only what QA-D **executed**.

**Tree.** The task started at `HEAD` `ce05d1e6307b7946c8fba7db20b1b70194bc4723` (working-tree candidate `sha256:b436cffc…6a1d`, log `00-env-candidate.log`). At 14:19:51Z the orchestrator committed `12229e6b69c11105bde0d1693093c608254e1fef` (the T-DG7-AN-P7 output: `docs/delivery/requirements.csv` and delivery records only, no product code). That commit also swept in this task's first, partial logs. Every check from 14:24Z on ran on the `12229e6b6` tree. The checks that ran earlier (candidate id, the validator self-tests, DG6 historical) were re-run on it: `06-rerun-on-12229e6.log`, exit 0 each, 60/60 tests. The working-tree candidate there is `sha256:c3fd5d9c4bdd5c7fb482902fdf81e9445d41169e667f2dcdbae3344e3f7ce9ef`, computed without `--freeze`, with the T-I12 file untracked. It is not a frozen DG7 candidate. It also lists the pending inputs. Nothing here is the result of a DG7 review, and nothing here approves DG7.

### DG7 checks executed by QA-D (2026-11-14, Node 24.21.0, offline, `MTH_PNPM_OFFLINE=1`)

| Level | Check | Command | Exit | Result | Evidence |
| --- | --- | --- | --- | --- | --- |
| unit (validator) | A23, A24, A25 validator self-tests: 60 tests, 0 failed. They include the A23 tests "a reviewer who authored the scope, or who is an owner, is rejected" and "reviewers sharing one invocation are not independent", the A24 missing-reviewer, failed/BLOCKED-check, unresolved-finding, incomplete-requirement and pipeline tests, and the A25 tests "a source change invalidates the approval; review metadata does not", symlinks/submodules, and tampered manifest / stale review | `node --test tools/gates/tests/validator.test.mjs` | 0 | PASS | `T-DG7-QA-D/01-a23-a25-validator-tests.log` |
| other (gate) | DG6 historical (A23/A24 on the previous gate) | `node tools/gates/validate.mjs --historical --stage DG6` | 0 | PASS | `T-DG7-QA-D/02-validate--historical_--stage_DG6.log` |
| other (gate) | Pipeline: DG0–DG6 APPROVED in order, DG7 BUILDING (A24) | `node tools/gates/validate.mjs --pipeline` | 0 | PASS | `T-DG7-QA-D/02-validate--pipeline.log` |
| other (gate) | Reconcile: `active stage: DG7 (BUILDING)`, `no frozen candidate yet` | `node tools/gates/validate.mjs --reconcile` | 0 | PASS | `T-DG7-QA-D/02-validate--reconcile.log` |
| other (gate) | DG7 current gate (expected to fail before the freeze) | `node tools/gates/validate.mjs --stage DG7` | 1 | FAIL as expected (no gate record) | `T-DG7-QA-D/02-validate--stage_DG7.log` |
| integration | T-I12 `tests/qa/integration/a24-register-rules.test.ts` (A24 clause of REQ-S02-005): 8 tests | `tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration tests/qa/integration/a24-register-rules.test.ts` | 0 | PASS | `T-DG7-QA-D/03-t-i12.log` |
| other | T-I12 file: strict `tsc` and ESLint (no tsconfig covers `tests/qa`) | see log | 0, 0 | PASS | `T-DG7-QA-D/03-t-i12.log` |
| other | Typecheck | `pnpm -r typecheck` | 0 | PASS | `T-DG7-QA-D/10-typecheck.log` |
| other | Lint | `pnpm lint` | 0 | PASS | `T-DG7-QA-D/11-lint.log` |
| other | OpenAPI lint (965 operations) | `pnpm openapi:lint` | 0 | PASS | `T-DG7-QA-D/12-openapi-lint.log` |
| unit | `pnpm test` as is | `pnpm test` | 1 | **BLOCKED** (environment): all three projects stop at config load with `EROFS … node_modules/.vite-temp`, and no test runs | `T-DG7-QA-D/13-pnpm-test.log` |
| unit | The same three projects with the runner config loader. unit-web: 130 files, 2175 passed. nocodegen: 259 passed + 2 skipped (by design, `it.skipIf(NOCODEGEN)`). unit-node: 204/205 files, 3021/3022. The one failure is EROFS writing `test-results/qa-a20/contrast-pairs.txt` (read-only repository root in this sandbox), not an assertion | `npx vitest run --configLoader runner --project unit-node \| unit-web \| unit-formula-nocodegen` | 1 | PASS except the 1 environment failure, re-run below | `T-DG7-QA-D/13b-unit-configloader-runner.log` |
| unit | Re-run of the failing file, with its declared evidence-directory override pointed to scratch | `QA_EVIDENCE_DIR=$TMPDIR/qa-a20 npx vitest run --configLoader runner --project unit-node tests/qa/unit/a20-p6-token-contrast.test.ts` | 0 | PASS (4/4) | `T-DG7-QA-D/13c-a20-contrast-rerun.log` |
| integration | Contract test on a disposable PostgreSQL (135 migrations applied to a fresh database) | `tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration apps/api/test/integration/contract/contract.test.ts` | 0 | PASS (111/111) | `T-DG7-QA-D/15-contract.log` |
| other | Prettier over tracked and untracked files | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | PASS | `T-DG7-QA-D/14-prettier.log` |

### DG7 inputs that are other tasks' work or pending (not run by QA-D, not claimed)

| Item | Owner | Status at this index | Path |
| --- | --- | --- | --- |
| A01–A16 on the DG7 tree | QA-B | evidence exists, not re-read or re-run by QA-D | `docs/delivery/test-evidence/DG7/qa/T-DG7-QA-B/` |
| A17–A22, with the A18 and A19 re-runs (seal keys `A18`, `A19`) | QA-C | evidence exists, not re-read or re-run by QA-D | `docs/delivery/test-evidence/DG7/qa/T-DG7-QA-C/` |
| A23: separate domain, code-security and QA review evidence plus an independent release audit **for DG7** | DG7 review round and audit | **PENDING**: no DG7 round exists. A23 is complete only when the DG7 gate is APPROVED (acceptance map, "A23 at DG7"). The validator mechanism is proved by the tests above, and DG0–DG6 have their records (sections below) | `docs/delivery/reviews/DG7/` (empty), `docs/delivery/gates/DG7.json` (absent) |
| A26 repair and re-review drill (seal key `A26`) | orchestrator (p7-work-split §K.1) | **PENDING, not run by QA-D**: the path does not exist yet | `docs/delivery/test-evidence/DG7/orchestrator/a26/drill-report.md` |
| A27 reliable-resumption drill (seal key `A27`) | orchestrator (p7-work-split §K.2) | **PENDING, not run by QA-D**: the path does not exist yet | `docs/delivery/test-evidence/DG7/orchestrator/a27/drill-report.md` |
| Full e2e (Playwright, en and ar) and visual/axe on the merged DG7 tree | orchestrator freeze verification (p7-plan "After W12", D-193), then the DG7 QA review | **PENDING**: not run by QA-D in this task (the time budget, and a single Chromium load envelope) | — |
| `protocol-audit --all --json` at the freeze (seal key `protocol-audit`) | orchestrator (D-249) | PENDING | `docs/delivery/test-evidence/DG7/orchestrator/` |
| A28 sealing | orchestrator, after DG7 APPROVED | PENDING (post-approval, M0411) | — |

### DG7 tests that could not run, with reasons

- **The first run of T-I12, as `npx vitest run --project integration …`:** exit 1, before any test ran. `EROFS: read-only file system, open '/home/user/My-owns/node_modules/.vite-temp/vitest.config.ts.timestamp-…'`. This agent's sandbox mounts `node_modules` read-only, and Vite's default config loader bundles the config into `node_modules/.vite-temp`. Re-run with `--configLoader runner` (no temp file): exit 0. Logs: `T-DG7-QA-D/03a-t-i12-attempt1-EROFS.log`, `T-DG7-QA-D/03-t-i12.log`. This is an environment limit, not a product defect.
- **`pnpm test` as is:** exit 1, for the same EROFS reason in all three projects, before any test ran (`13-pnpm-test.log`). The equivalent runner-loader run is above. Inside it, one unit-node test (`tests/qa/unit/a20-p6-token-contrast.test.ts`) failed only on writing its evidence file to the read-only `test-results/`. It passed when re-run with `QA_EVIDENCE_DIR` set to scratch (`13c-a20-contrast-rerun.log`). On a host with a writable checkout, `pnpm test` should be re-run as is. QA-D could not do that here: **BLOCKED** for the as-is invocation.
- **Docker image build, real Keycloak, live registry and live CI:** not available in the agent sandbox (D-243 Q1, D-049, D-057, D-058). They are not run here and not claimed.
