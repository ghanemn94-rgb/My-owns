# REQ-S20-031 test-level index, DG0–DG7 (T-DG7-QA-D, qa-verifier)

Generated on 2026-11-14 from the repository at `12229e6b69c11105bde0d1693093c608254e1fef` (branch `claude/mobily-transformation-platform-dg6-regate`, DG7 BUILDING, not frozen; see "Tree" in the DG7 section). Generator: `T-DG7-QA-D/build_index.py` and `T-DG7-QA-D/render.py` (run from the repository root with `python3 -I`); machine-readable copy: `test-level-index.json` next to this file.

## How to read this index

- **DG0–DG6 (APPROVED).** For each gate, the rows are the `checks_run` of the three specialist records the gate record cites (the approving round), plus the gate record's own `tests[]` (the release audit). Result, exit status, command and evidence are copied **as recorded**: QA-D did not re-execute them here. Every evidence path was checked to exist as a regular file (column *ev*).
- **Test level** is classified mechanically from the check's id, procedure and command (patterns in `build_index.py`): `unit`, `integration`, `e2e`, `visual` (screenshots, axe, RTL/Arabic, contrast), or `other` (validators, lint, typecheck, provenance, static review). A check can have several levels.
- **Could not run.** Each gate lists (a) every check recorded `BLOCKED` in any earlier round of that gate (superseded by the approving round), and (b) every approving-round check whose recorded result text mentions BLOCKED, not run, skipped or not executed, with an excerpt of the reason. Part (b) is a text scan: a PASS check can appear there because it discloses skipped tests or an environmental residual.
- **Standing environmental residuals** (disclosed in every gate since DG1/DG2): live package registry (D-057), live CI run (D-058), a real Keycloak / enterprise IdP (D-049; only the bundled test issuer ran; the SAML broker is documented, not run), Docker daemon (D-243 Q1), real external systems (no real Mobily system, mail server or connector endpoint). None of these was ever reported as passed.
- **No check is reported as passed here without an executed command in its record.** DG0 has no e2e row: P0 delivered specifications and the gate tooling, not UI.

## Summary per gate

| Gate | Decision | Candidate | Source commit | unit | integration | e2e | visual | other | non-PASS checks in approving round | not-run / BLOCKED entries | missing evidence files |
|---|---|---|---|---|---|---|---|---|---|---|---|
| DG0 | APPROVED | `sha256:84130c624e87…` | `1e4c0226fc50` | 8 | 1 | 0 | 2 | 38 | 0 | 14 | 0 |
| DG1 | APPROVED | `sha256:6e0c0db1a8be…` | `642e6bfb2c90` | 10 | 10 | 17 | 5 | 19 | 0 | 5 | 0 |
| DG2 | APPROVED | `sha256:ddaab3cc264b…` | `805da3e26bed` | 10 | 10 | 10 | 7 | 42 | 0 | 3 | 0 |
| DG3 | APPROVED | `sha256:f55095dbec36…` | `d3e6fe62d9a4` | 10 | 7 | 4 | 6 | 37 | 0 | 13 | 0 |
| DG4 | APPROVED | `sha256:f38274cb6d50…` | `e70ac02f63cd` | 8 | 9 | 5 | 5 | 31 | 0 | 11 | 0 |
| DG5 | APPROVED | `sha256:55a411ae9f4e…` | `660f40c7d141` | 5 | 9 | 9 | 8 | 28 | 0 | 10 | 0 |
| DG6 | APPROVED | `sha256:10f71f241856…` | `d8868b2a5c07` | 9 | 13 | 9 | 5 | 28 | 0 | 19 | 0 |
| DG7 | BUILDING (no gate record) | not frozen | — | see §DG7 | see §DG7 | pending (freeze) | pending (freeze) | see §DG7 | — | see §DG7 | — |

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

## DG0 (APPROVED)

- Gate record: `docs/delivery/gates/DG0.json`; candidate `sha256:84130c624e877424eed6deb91d086249bc1330bda34ff109b0183102533751bd`; source `1e4c0226fc50dc6cc928ce4f16cbf7507afed1ac`.
- domain-reviewer: `docs/delivery/reviews/DG0/round-29/domain-reviewer.json`, verdict PASS, candidate = gate.
- code-security-reviewer: `docs/delivery/reviews/DG0/round-29/code-security-reviewer.json`, verdict PASS, candidate = gate.
- qa-verifier: `docs/delivery/reviews/DG0/round-29/qa-verifier.json`, verdict PASS, candidate = gate.
- Release audit: `docs/delivery/reviews/DG0/round-29/release-auditor.json`.

### DG0 unit (8)

| Role | Check | Result | Exit | Command (truncated) | Evidence (first) | ev |
|---|---|---|---|---|---|---|
| domain | DOM29-11-d045-tests-and-mutation | PASS | 0 | `node --test tools/gates/tests/*.test.mjs; git diff 331407e9..1e4c0226 -- tools/gates/lib/rules.mjs \| git apply -R; node --test --test-name-p` | `docs/delivery/test-evidence/DG0/domain/round-29/11-d045-tests.log` (+1) | ok |
| domain | DOM29-12-d045-wording | PASS | 0 | `git diff 331407e9..1e4c0226 -- docs/delivery/decisions.md; grep terms; python3 (round-28 verdicts); node --test tools/gates/tests/*.test.mjs` | `docs/delivery/test-evidence/DG0/domain/round-29/11-d045-wording.log` | ok |
| code | C2-node-tests | PASS | 0 | `node --test tools/gates/tests/*.test.mjs tools/agents/tests/*.test.mjs` | `docs/delivery/test-evidence/DG0/code-security/round-29/node-tests.log` | ok |
| code | C3-python-unittests | PASS | 0 | `python3 -m unittest discover -v -s tools/agents/tests -p 'test_*.py'` | `docs/delivery/test-evidence/DG0/code-security/round-29/python-unittest.log` | ok |
| qa | QA29-K02 | PASS | 0 | `node --test tools/gates/tests/*.test.mjs` | `docs/delivery/test-evidence/DG0/qa/round-29/02-gates-selftests.log` | ok |
| qa | QA29-K03 | PASS | 0 | `node --test tools/agents/tests/*.test.mjs; (cd tools/agents/tests && python3 -m unittest -v test_agent_settings test_run_meta)` | `docs/delivery/test-evidence/DG0/qa/round-29/03-agents-tests.log` (+1) | ok |
| qa | QA29-K08 | PASS | 0 | `QA_REPO_ROOT=$TMPDIR/nl node --test docs/delivery/test-evidence/DG0/qa/tests/dg0-gate-negative-r29.test.mjs` | `docs/delivery/test-evidence/DG0/qa/round-29/13-qa29-negative-suite.log` (+1) | ok |
| qa | QA29-K09 | PASS | 0 | `QA_REPO_ROOT=$TMPDIR/nl node --test docs/delivery/test-evidence/DG0/qa/tests/dg0-gate-negative-r27.test.mjs; ... dg0-gate-negative-r28.test.` | `docs/delivery/test-evidence/DG0/qa/round-29/11-r27-suite-rerun.log` (+1) | ok |

### DG0 integration (1)

| Role | Check | Result | Exit | Command (truncated) | Evidence (first) | ev |
|---|---|---|---|---|---|---|
| qa | QA29-K07 | PASS | 0 | `git clone --no-local <repo> $TMPDIR/pf && $TMPDIR/pf/tools/gates/prefreeze.sh DG0` | `docs/delivery/test-evidence/DG0/qa/round-29/09-prefreeze.log` | ok |

### DG0 e2e (0)

None recorded at this level. P0 had no UI.

### DG0 visual (2)

| Role | Check | Result | Exit | Command (truncated) | Evidence (first) | ev |
|---|---|---|---|---|---|---|
| domain | DOM29-06-provenance-branding | PASS | 0 | `grep -rniE 'official PMI\|certified\|PMI standard\|official Mobily' CLAUDE.md docs/analysis docs/delivery/requirements.csv docs/delivery/requir` | `docs/delivery/test-evidence/DG0/domain/round-29/06-provenance-branding.log` | ok |
| domain | DOM29-16-glossary-journeys-permissions | PASS | 0 | `grep headings in user-journeys.md; grep glossary terms; grep approve/validate/ADM/T11/RACI in permissions-matrix.md` | `docs/delivery/test-evidence/DG0/domain/round-29/12-glossary-journeys-permissions.log` | ok |

### DG0 other (38)

| Role | Check | Result | Exit | Command (truncated) | Evidence (first) | ev |
|---|---|---|---|---|---|---|
| domain | DOM29-01-candidate | PASS | 0 | `git rev-parse HEAD; git rev-parse --is-shallow-repository; node tools/gates/candidate.mjs --stage DG0; (clone) node tools/gates/candidate.mj` | `docs/delivery/test-evidence/DG0/domain/round-29/01-scope.log` | ok |
| domain | DOM29-02-extraction-fidelity | PASS | 0 | `python3 02-extract.py.txt; python3 02-reverse.py.txt; bash tools/source/check_extraction.sh` | `docs/delivery/test-evidence/DG0/domain/round-29/02-extraction.log` (+2) | ok |
| domain | DOM29-03-source-coverage | PASS | 0 | `python3 03-coverage.py.txt; diff round-28/03-source-coverage.out round-29/03-source-coverage.out` | `docs/delivery/test-evidence/DG0/domain/round-29/03-source-coverage.out` (+1) | ok |
| domain | DOM29-04-templates | PASS | 0 | `python3 04-templates.py.txt; diff round-28/04-template-columns-values.out round-29/04-template-columns-values.out` | `docs/delivery/test-evidence/DG0/domain/round-29/04-template-columns-values.out` (+1) | ok |
| domain | DOM29-05-deliverables | PASS | 0 | `python3 05-deliverables.py.txt; grep -n in docs/analysis/field-inventory.md and requirements.csv for B0084/B0116/B0144, questions 1/2/25 and` | `docs/delivery/test-evidence/DG0/domain/round-29/05-deliverables-substance.out` (+1) | ok |
| domain | DOM29-07-operating-logic | PASS | 0 | `python3 07-operating-logic.py.txt` | `docs/delivery/test-evidence/DG0/domain/round-29/07-operating-logic.out` (+1) | ok |
| domain | DOM29-08-master-prompt-sample | PASS | 0 | `python3 08-master-prompt-sample.py.txt` | `docs/delivery/test-evidence/DG0/domain/round-29/08-master-prompt-sample.out` (+1) | ok |
| domain | DOM29-09-staging | PASS | 0 | `python3 09-staging.py.txt` | `docs/delivery/test-evidence/DG0/domain/round-29/09-staging.log` (+1) | ok |
| domain | DOM29-10-objtype-census | PASS | 0 | `python3 10-objtype-census.py.txt` | `docs/delivery/test-evidence/DG0/domain/round-29/10-objtype-census.log` (+1) | ok |
| domain | DOM29-13-prefreeze | PASS | 0 | `bash tools/gates/prefreeze.sh DG0` | `docs/delivery/test-evidence/DG0/domain/round-29/13-prefreeze.log` | ok |
| domain | DOM29-14-real-repo-forge | PASS | 1 | `node tools/gates/validate.mjs --stage DG0 (baseline); git tag -a r28tag <331407e>; edit stages.json round 28 source_commit=<tag object>; nod` | `docs/delivery/test-evidence/DG0/domain/round-29/14-real-repo-forge-and-dryrun.log` | ok |
| domain | DOM29-15-dlv-rows | PASS | 0 | `grep D-001/D-002; schema stage_id; grep G6/no-approval in CLAUDE.md, agent-protocol.md and .claude/agents/*.md; node tools/gates/validate.mj` | `docs/delivery/test-evidence/DG0/domain/round-29/12-dlv-rows.log` | ok |
| code | C1-candidate-scope | PASS | 0 | `git rev-parse HEAD; git rev-parse --is-shallow-repository; node tools/gates/candidate.mjs --stage DG0; node tools/gates/candidate.mjs --stag` | `docs/delivery/test-evidence/DG0/code-security/round-29/candidate-and-scope.log` | ok |
| code | C4-F-DG0-171-reproduce-baseline | PASS | 0 | `bash docs/delivery/test-evidence/DG0/code-security/round-29/run-sec29-repro.sh /home/user/My-owns 331407e baseline` | `docs/delivery/test-evidence/DG0/code-security/round-29/sec29-repro-baseline.log` (+2) | ok |
| code | C5-F-DG0-171-fixed-candidate | PASS | 0 | `bash docs/delivery/test-evidence/DG0/code-security/round-29/run-sec29-repro.sh /home/user/My-owns 1e4c022 candidate` | `docs/delivery/test-evidence/DG0/code-security/round-29/sec29-repro-candidate.log` (+1) | ok |
| code | C6-objtype-census | PASS | 0 | `node --input-type=module < docs/delivery/test-evidence/DG0/code-security/round-29/objtype-census.mjs.txt` | `docs/delivery/test-evidence/DG0/code-security/round-29/objtype-census.log` (+1) | ok |
| code | C7-real-repo-gate-dryrun | PASS | 0 | `node docs/delivery/test-evidence/DG0/qa/tests/real-repo-gate-blockers.mjs /home/user/My-owns` | `docs/delivery/test-evidence/DG0/code-security/round-29/real-repo-gate-dryrun.log` | ok |
| code | C8-fix-revision | PASS | 0 | `git cat-file -t 83721ced; git merge-base --is-ancestor 83721ced 1e4c022; git merge-base --is-ancestor 331407e 83721ced; git grep rscType 837` | `docs/delivery/test-evidence/DG0/code-security/round-29/fix-revision-check.log` | ok |
| code | C9-source-review-delta | PASS | 0 | `git diff 331407e..1e4c022 -- tools/gates/lib/rules.mjs tools/gates/tests/validator.test.mjs docs/delivery/decisions.md; sed -n 595,830p and ` | `docs/delivery/test-evidence/DG0/code-security/round-29/record-source-commit-census.log` | ok |
| code | C10-prefreeze | PASS | 0 | `bash tools/gates/prefreeze.sh DG0` | `docs/delivery/test-evidence/DG0/code-security/round-29/prefreeze.log` | ok |
| code | C11-validator-cli-determinism | PASS | 0 | `node tools/gates/validate.mjs --register DG0 \| --pipeline \| --reconcile \| --stage DG0 [--historical] \| --stage DG9; node tools/gates/candida` | `docs/delivery/test-evidence/DG0/code-security/round-29/validator-and-determinism.log` | ok |
| code | C12-csv-json-robustness | PASS | 0 | `node -e parseCsv(cases); node tools/gates/validate.mjs --register DG0 (corrupted); checkFindings (truncated findings.json)` | `docs/delivery/test-evidence/DG0/code-security/round-29/csv-json-robustness.log` | ok |
| code | C13-secrets-ci | PASS | 0 | `grep in .github/workflows/delivery-gates.yml; git ls-files \| secret-pattern grep; .claude/settings.json permissions.allow` | `docs/delivery/test-evidence/DG0/code-security/round-29/secrets-ci-scan.log` | ok |
| code | C14-sandbox-writeguard-live | PASS | 0 | `bash docs/delivery/test-evidence/DG0/code-security/round-29/sandbox-probes.sh .` | `docs/delivery/test-evidence/DG0/code-security/round-29/sandbox-probes.log` (+1) | ok |
| code | C15-requirements | PASS | 0 | `python3 docs/delivery/test-evidence/DG0/code-security/round-29/requirements-check.py.txt` | `docs/delivery/test-evidence/DG0/code-security/round-29/requirements-check.log` (+1) | ok |
| qa | QA29-K00 | PASS | 0 | `sha256sum docs/delivery/assignments/DG0/round-29/review-qa-verifier.md; git rev-parse HEAD; git rev-parse --is-shallow-repository; git diff ` | `docs/delivery/test-evidence/DG0/qa/round-29/00-scope.log` (+1) | ok |
| qa | QA29-K01 | PASS | 0 | `tools/source/check_extraction.sh` | `docs/delivery/test-evidence/DG0/qa/round-29/01-check-extraction.log` | ok |
| qa | QA29-K04 | PASS | 0 | `node tools/gates/validate.mjs --register DG0; node tools/gates/validate.mjs --pipeline; node tools/gates/validate.mjs --reconcile` | `docs/delivery/test-evidence/DG0/qa/round-29/04-register-DG0.log` (+2) | ok |
| qa | QA29-K05 | PASS | 0 | `node tools/gates/candidate.mjs --stage DG0` | `docs/delivery/test-evidence/DG0/qa/round-29/07-candidate.log` | ok |
| qa | QA29-K06 | PASS | 0 | `node docs/delivery/test-evidence/DG0/qa/tests/real-repo-gate-blockers.mjs "$TMPDIR/nl"` | `docs/delivery/test-evidence/DG0/qa/round-29/08-real-repo-gate-blockers-nl.log` (+1) | ok |
| qa | QA29-K10 | PASS | 0 | `node docs/delivery/test-evidence/DG0/qa/round-29/real-repo-round-tag-forge.mjs "$TMPDIR/nl"` | `docs/delivery/test-evidence/DG0/qa/round-29/14-real-repo-round-tag-forge.log` (+1) | ok |
| qa | QA29-K11 | PASS | 0 | `node docs/delivery/test-evidence/DG0/qa/round-29/fix-revision-anchors-r29.mjs "$TMPDIR/nl"` | `docs/delivery/test-evidence/DG0/qa/round-29/21-fix-revision-anchors-nl.log` (+1) | ok |
| qa | QA29-K12 | PASS | 0 | `git cat-file -t 83721ced; git merge-base --is-ancestor 83721ced 1e4c0226; git merge-base --is-ancestor 83721ced ffa3fae; git diff --stat 837` | `docs/delivery/test-evidence/DG0/qa/round-29/22-f251-closure-anchors.log` | ok |
| qa | QA29-K13 | PASS | 0 | `python3 -I -B docs/delivery/test-evidence/DG0/qa/round-29/register-integrity-r29.py "$TMPDIR/nl"` | `docs/delivery/test-evidence/DG0/qa/round-29/20-register-integrity.log` (+1) | ok |
| qa | QA29-K14 | PASS | 0 | `(in $TMPDIR/nl) node docs/delivery/test-evidence/DG0/qa/tests/agent-load-evidence.mjs` | `docs/delivery/test-evidence/DG0/qa/round-29/30-agent-load-evidence.log` | ok |
| qa | QA29-K15 | PASS | 0 | `Write docs/source/QA-PROBE.txt; Write docs/delivery/test-evidence/DG0/domain/QA-PROBE.txt; Write tools/gates/lib/QA-PROBE.txt; echo x > {doc` | `docs/delivery/test-evidence/DG0/qa/round-29/31-live-guard-probe.log` | ok |
| qa | QA29-K16 | PASS | 0 | `git diff --stat 331407e9 1e4c0226 -- docs/delivery/agents.md .claude/agents tools/agents; ls .claude/agents; grep model:; grep run-agent.sh ` | `docs/delivery/test-evidence/DG0/qa/round-29/32-agents-md-vs-evidence.log` | ok |
| qa | QA29-K17 | PASS | 0 | `(in $TMPDIR/nl) node docs/delivery/test-evidence/DG0/qa/tests/acceptance-feasibility.mjs` | `docs/delivery/test-evidence/DG0/qa/round-29/40-acceptance-feasibility.log` | ok |

### DG0 release-audit tests (gate record `tests[]`, 7)

| Test | Result | Evidence (first) |
|---|---|---|
| Candidate recomputation and complete-clone check | PASS | `docs/delivery/test-evidence/DG0/audit/round-29/01-candidate-and-validator-tests.log` |
| Gate validator self-tests (60/60, incl. D-045, D-044, shallow refusal, off-branch source_commit, closure anchors) | PASS | `docs/delivery/test-evidence/DG0/audit/round-29/01-candidate-and-validator-tests.log` |
| Sandboxed pre-freeze suite (11/11) | PASS | `docs/delivery/test-evidence/DG0/audit/round-29/02-prefreeze.log` |
| Agent tooling tests (node + python) | PASS | `docs/delivery/test-evidence/DG0/qa/round-29/03-agents-tests.log` |
| Real-repo history integrity: write-once, commit-object census, D-045 tag forge | PASS | `docs/delivery/test-evidence/DG0/audit/round-29/03-real-repo-probes.log` |
| F-DG0-171 / F-DG0-251 reproduction and fix verification | PASS | `docs/delivery/test-evidence/DG0/code-security/round-29/sec29-repro-baseline.log` |
| Source extraction and coverage (domain) | PASS | `docs/delivery/test-evidence/DG0/domain/round-29/02-extraction.log` |

### DG0 tests that could not run, and disclosures (14)

| Source | Role | Record | Check | Result | Reason (excerpt) |
|---|---|---|---|---|---|
| approving round | qa-verifier | `docs/delivery/reviews/DG0/round-29/qa-verifier.json` | QA29-K03 | PASS | node: tests 39, pass 39, fail 0, skipped 0. Python: Ran 22 tests, OK |
| approving round | qa-verifier | `docs/delivery/reviews/DG0/round-29/qa-verifier.json` | QA29-K11 | PASS | findings 122; with fix_revision 120; CLOSED_VERIFIED with fix 118; anchor-1 skipped 0. fix_revision errors 0; three-anchor errors 0. Object types: run heads {commit:103, ABSENT:3}, review_rounds source_commit {commit:28, ABSENT:1}, fix_revision {commit:120}, gate commit = commit. No |
| approving round | qa-verifier | `docs/delivery/reviews/DG0/round-29/qa-verifier.json` | QA29-K15 | PASS | All three Write calls were BLOCKED by the write guard ('protected path' or 'outside role write scope'). All four shell writes failed with 'Read-only file system' (rc=1). ls shows no probe file. In-scope writes (tests/, round-29/ evide |
| earlier round (superseded by the approving round) | code-security-reviewer | `docs/delivery/reviews/DG0/round-1/code-security-reviewer.json` | C02-candidate-id | BLOCKED | Not executed. Every Bash call in this invocation (9 attempts) was refused: 'The server-side auto mode classifier gave no verdict (error)'. The candidate identity could not be confirmed. |
| earlier round (superseded by the approving round) | code-security-reviewer | `docs/delivery/reviews/DG0/round-1/code-security-reviewer.json` | C03-existing-tests | BLOCKED | Not executed: Bash unavailable (classifier gave no verdict). |
| earlier round (superseded by the approving round) | code-security-reviewer | `docs/delivery/reviews/DG0/round-1/code-security-reviewer.json` | C04-repro | BLOCKED | Script written but NOT executed: Bash unavailable. The findings rest on static source analysis only; no runtime result is claimed. |
| earlier round (superseded by the approving round) | code-security-reviewer | `docs/delivery/reviews/DG0/round-1/code-security-reviewer.json` | C09-secrets | BLOCKED | Not executed: Bash unavailable. None of the ~35 files read in full contained credentials, but that is not a repository-wide scan. |
| earlier round (superseded by the approving round) | code-security-reviewer | `docs/delivery/reviews/DG0/round-1/code-security-reviewer.json` | C10-source-tools | BLOCKED | Source reviewed. check_extraction.sh is fail-closed (set -e, pinned docx SHA, diff -q). merge_register.py silently drops surplus cells (F-DG0-107). extract_docx.py iterates only top-level w:p/w:tbl, so body-level w:sdt content controls, headers, footers and footnotes would be dropped; I could not check whether the docx contains any. The reproducibility script was not run (Bash… |
| earlier round (superseded by the approving round) | qa-verifier | `docs/delivery/reviews/DG0/round-12/qa-verifier.json` | QA12-K19 | BLOCKED | BLOCKED: no network in the agent sandbox. The remaining verification is the source change to --setting-sources project, my own session's live Write/Bash refusals (QA12-K13) and the orchestrator's hash-consistent live probe guard-live-20260928T182513Z (part A with user-level disableAllHooks still produced 5 guard blocks). |
| earlier round (superseded by the approving round) | code-security-reviewer | `docs/delivery/reviews/DG0/round-14/code-security-reviewer.json` | C7-guard-procroot-live | BLOCKED | Not completed: my session's safety classifier stopped the probe and I did not retry. F-DG0-143 rests on the offline reproduction (C6). |
| earlier round (superseded by the approving round) | code-security-reviewer | `docs/delivery/reviews/DG0/round-17/code-security-reviewer.json` | C9-residual-7 | BLOCKED | NOT COMPLETED. My analysis was stopped by the session's safety classifier, and I did not continue it. I cannot confirm that the residual is no larger than stated, so F-DG0-149 stays OPEN. A read-only check shows the host's /proc/sys/kernel/core_pattern still holds the value 'test' left by the round-16 reproduction; it has not been restored. |
| earlier round (superseded by the approving round) | code-security-reviewer | `docs/delivery/reviews/DG0/round-19/code-security-reviewer.json` | C09 | BLOCKED | Not executed. The only non-write evidence (mount flags, access(2)) does not support the claim. |
| earlier round (superseded by the approving round) | code-security-reviewer | `docs/delivery/reviews/DG0/round-21/code-security-reviewer.json` | C16 | BLOCKED | Only rules.mjs, validator.test.mjs and a comment-only agent_sandbox.py change. The live peer probe is BLOCKED: the agent shell is pid 9 in its own PID namespace and cannot see peer runs. The property is covered by the passing process-sandbox test 'F-DG0-152 ... per-run Landlock domain' with its positive control (C10). |
| earlier round (superseded by the approving round) | qa-verifier | `docs/delivery/reviews/DG0/round-21/qa-verifier.json` | QA21-K14 | BLOCKED | NOT EXECUTED. The session's auto-mode permission classifier refused the command before it ran ('Modify Shared Resources'), and I did not retry it, as the classifier instructed. Kernel-sandbox enforcement of shell writes was not re-verified live in this round; the round-20 live probe and the 39 guard/sandbox tests (QA21-K03, K10) are the remaining evidence. |

## DG1 (APPROVED)

- Gate record: `docs/delivery/gates/DG1.json`; candidate `sha256:6e0c0db1a8bea33cd81f05ea8c795d8ede4bfb7f380dfe146556cb4875a6f827`; source `642e6bfb2c905d2c3382035032fa56c84672dcab`.
- domain-reviewer: `docs/delivery/reviews/DG1/round-4/domain-reviewer.json`, verdict PASS, candidate = gate.
- code-security-reviewer: `docs/delivery/reviews/DG1/round-4/code-security-reviewer.json`, verdict PASS, candidate = gate.
- qa-verifier: `docs/delivery/reviews/DG1/round-4/qa-verifier.json`, verdict PASS, candidate = gate.
- Release audit: `docs/delivery/reviews/DG1/round-4/release-auditor.json`.

### DG1 unit (10)

| Role | Check | Result | Exit | Command (truncated) | Evidence (first) | ev |
|---|---|---|---|---|---|---|
| domain | DOM-R4-05-test-node22 | PASS | 0 | `PATH=/opt/node22/bin:$PATH pnpm test` | `docs/delivery/test-evidence/DG1/domain/round-4/05-test-node22.log` | ok |
| domain | DOM-R4-06-test-node24 | PASS | 0 | `PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH pnpm test` | `docs/delivery/test-evidence/DG1/domain/round-4/06-test-node24.log` | ok |
| code | SEC-R4-09-unit-node22 | PASS | 0 | `pnpm test` | `docs/delivery/test-evidence/DG1/code-security/round-4/unit-node22.log` | ok |
| code | SEC-R4-10-unit-node24 | PASS | 0 | `PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH pnpm test` | `docs/delivery/test-evidence/DG1/code-security/round-4/unit-node24.log` | ok |
| code | SEC-R4-13-gates-agents-tests | PASS | 0 | `node --test tools/gates/tests/*.test.mjs tools/agents/tests/*.test.mjs` | `docs/delivery/test-evidence/DG1/code-security/round-4/gates-agents-tests.log` | ok |
| code | SEC-R4-14-deploy-scripts-tests | PASS | 0 | `node --test deploy/scripts/tests/*.test.mjs` | `docs/delivery/test-evidence/DG1/code-security/round-4/deploy-scripts-tests.log` | ok |
| qa | QA-R4-06-unit-node22 | PASS | 0 | `pnpm test` | `docs/delivery/test-evidence/DG1/qa/round-4/10-unit-node22.log` | ok |
| qa | QA-R4-07-unit-node24 | PASS | 0 | `PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH pnpm test` | `docs/delivery/test-evidence/DG1/qa/round-4/11-unit-node24.log` | ok |
| qa | QA-R4-12-db-migrate-probe | PASS | 0 | `tests/qa/support/with-pg.sh bash docs/delivery/test-evidence/DG1/qa/round-2/12-db-probe.sh` | `docs/delivery/test-evidence/DG1/qa/round-4/16-db-migrate-probe.log` | ok |
| qa | QA-R4-18-ci-offline-surface-A24 | PASS | 0 | `bash docs/delivery/test-evidence/DG1/qa/round-4/22-ci-offline.sh $TMPDIR/ci-qa` | `docs/delivery/test-evidence/DG1/qa/round-4/22-ci-offline.log` (+2) | ok |

### DG1 integration (10)

| Role | Check | Result | Exit | Command (truncated) | Evidence (first) | ev |
|---|---|---|---|---|---|---|
| domain | DOM-R4-09-live-scenario | PASS | 0 | `cd $TMPDIR/review-dg1r4 && PATH=/opt/node22/bin:$PATH bash $TMPDIR/scn/run.sh $TMPDIR/ev/screens (scripts saved as 01a/01b/01c/01d *.txt)` | `docs/delivery/test-evidence/DG1/domain/round-4/01-runtime-scenario.out.txt` (+3) | ok |
| code | SEC-R4-11-integration-run1 | PASS | 0 | `TEST_DATABASE_ADMIN_URL=postgresql://postgres@127.0.0.1:55149/postgres with-pg.sh 55149 pnpm test:integration` | `docs/delivery/test-evidence/DG1/code-security/round-4/integration-run1.log` | ok |
| code | SEC-R4-12-integration-run2 | PASS | 0 | `TEST_DATABASE_ADMIN_URL=postgresql://postgres@127.0.0.1:55286/postgres with-pg.sh 55286 pnpm test:integration` | `docs/delivery/test-evidence/DG1/code-security/round-4/integration-run2.log` | ok |
| qa | QA-R4-08-integration-run1 | PASS | 0 | `tests/qa/support/with-pg.sh pnpm test:integration` | `docs/delivery/test-evidence/DG1/qa/round-4/12-integration-run1.log` | ok |
| qa | QA-R4-09-integration-run2 | PASS | 0 | `tests/qa/support/with-pg.sh pnpm test:integration` | `docs/delivery/test-evidence/DG1/qa/round-4/13-integration-run2.log` | ok |
| qa | QA-R4-10-contract-and-bu-guard-verbose | PASS | 0 | `tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/contract apps/api/test/integration/bu-hierarchy-g` | `docs/delivery/test-evidence/DG1/qa/round-4/14-contract-and-bu-guard-verbose.log` | ok |
| qa | QA-R4-11-acceptance-A12-A13-A14 | PASS | 0 | `tests/qa/support/with-pg.sh npx vitest run --project integration tests/qa/integration --reporter=verbose` | `docs/delivery/test-evidence/DG1/qa/round-4/15-qa-a12-a13-a14-verbose.log` | ok |
| qa | QA-R4-12-db-migrate-probe | PASS | 0 | `tests/qa/support/with-pg.sh bash docs/delivery/test-evidence/DG1/qa/round-2/12-db-probe.sh` | `docs/delivery/test-evidence/DG1/qa/round-4/16-db-migrate-probe.log` | ok |
| qa | QA-R4-16-A18-clean-start | PASS | 0 | `e2e/clean-start/a18-clean-start.sh --commit 642e6bfb2c905d2c3382035032fa56c84672dcab --install` | `docs/delivery/test-evidence/DG1/qa/round-4/20-a18-clean-start.log` | ok |
| qa | QA-R4-20-static-requirement-checks | PASS | 0 | `bash docs/delivery/test-evidence/DG1/qa/round-4/25-static-requirement-checks.sh $TMPDIR/review-qa` | `docs/delivery/test-evidence/DG1/qa/round-4/25-static-requirement-checks.log` (+1) | ok |

### DG1 e2e (17)

| Role | Check | Result | Exit | Command (truncated) | Evidence (first) | ev |
|---|---|---|---|---|---|---|
| domain | DOM-R4-01-typecheck | PASS | 0 | `PATH=/opt/node22/bin:$PATH pnpm -r typecheck` | `docs/delivery/test-evidence/DG1/domain/round-4/02-typecheck.log` | ok |
| domain | DOM-R4-02-e2e-typecheck-coverage | PASS | 0 | `echo 'const __domainProbe: number = "not a number"; void __domainProbe;' >> apps/web/e2e/journeys.spec.ts; pnpm --filter ./apps/web run type` | `docs/delivery/test-evidence/DG1/domain/round-4/09-e2e-typecheck-coverage.log` | ok |
| domain | DOM-R4-10-bilingual-screens | PASS | 0 | `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node 01c-screens.mjs <out> (run from 01b-run.sh)` | `docs/delivery/test-evidence/DG1/domain/round-4/01c-screens.mjs.txt` (+8) | ok |
| code | SEC-R4-01-diff-review-no-regression | PASS | 0 | `git diff 4f312cc..642e6bf -- . ':!docs/delivery'; git diff --stat 4f312cc..642e6bf -- apps packages ':!apps/web/package.json' ':!apps/web/ts` | `docs/delivery/test-evidence/DG1/code-security/round-4/00-candidate-identity.log` | ok |
| code | SEC-R4-02-f147-fail-then-pass | PASS | 0 | `cd apps/web && pnpm exec tsc -p tsconfig.e2e.json --listFilesOnly; pnpm --filter @mth/web typecheck (baseline / injected / reverted x3); pnp` | `docs/delivery/test-evidence/DG1/code-security/round-4/f147-fail-then-pass.log` | ok |
| code | SEC-R4-03-typecheck | PASS | 0 | `pnpm -r typecheck` | `docs/delivery/test-evidence/DG1/code-security/round-4/typecheck.log` | ok |
| code | SEC-R4-08-format-check | PASS | 0 | `pnpm format:check` | `docs/delivery/test-evidence/DG1/code-security/round-4/format-check.log` | ok |
| code | SEC-R4-18-ci-yml-config | PASS | 0 | `sha256sum + cmp .github/workflows/ci.yml deploy/ci/ci.yml docs/architecture/ci/ci.yml; git diff --quiet 4f312cc..642e6bf -- .github deploy/c` | `docs/delivery/test-evidence/DG1/code-security/round-4/ci-yml-config.log` | ok |
| code | SEC-R4-19-root-e2e-typecheck-adhoc | PASS | 0 | `cd apps/web && pnpm exec tsc -p tsconfig.root-e2e-review.json (include ../../e2e/**/*.ts; lib ES2023+DOM; types node)` | `docs/delivery/test-evidence/DG1/code-security/round-4/root-e2e-typecheck-adhoc.log` | ok |
| qa | QA-R4-02-typecheck-incl-e2e | PASS | 0 | `pnpm -r typecheck` | `docs/delivery/test-evidence/DG1/qa/round-4/02-typecheck.log` | ok |
| qa | QA-R4-03-e2e-typecheck-negative | PASS | 0 | `bash docs/delivery/test-evidence/DG1/qa/round-4/09-e2e-typecheck-negative.sh` | `docs/delivery/test-evidence/DG1/qa/round-4/09-e2e-typecheck-negative.log` (+1) | ok |
| qa | QA-R4-13-e2e-journeys-en-ar | PASS | 0 | `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e --workers=1 --reporter=list` | `docs/delivery/test-evidence/DG1/qa/round-4/17-e2e-journeys-run1.log` | ok |
| qa | QA-R4-14-e2e-qa-acceptance-A20 | PASS | 0 | `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers e2e/support/qa-stack.sh npx playwright test e2e apps/web/e2e --workers=1 --reporter=list` | `docs/delivery/test-evidence/DG1/qa/round-4/18-e2e-qa-acceptance.log` | ok |
| qa | QA-R4-15-A20-token-propagation | PASS | 0 | `e2e/support/a20-token-propagation.sh $TMPDIR/review-qa` | `docs/delivery/test-evidence/DG1/qa/round-4/19-a20-token-propagation.log` | ok |
| qa | QA-R4-16-A18-clean-start | PASS | 0 | `e2e/clean-start/a18-clean-start.sh --commit 642e6bfb2c905d2c3382035032fa56c84672dcab --install` | `docs/delivery/test-evidence/DG1/qa/round-4/20-a18-clean-start.log` | ok |
| qa | QA-R4-18-ci-offline-surface-A24 | PASS | 0 | `bash docs/delivery/test-evidence/DG1/qa/round-4/22-ci-offline.sh $TMPDIR/ci-qa` | `docs/delivery/test-evidence/DG1/qa/round-4/22-ci-offline.log` (+2) | ok |
| qa | QA-R4-22-regression-probes | PASS | 0 | `e2e/support/qa-stack.sh node docs/delivery/test-evidence/DG1/qa/tests/dg1-r2-blackbox-probe.mjs ; ... dg1-r1-blackbox-probe.mjs ; e2e/suppor` | `docs/delivery/test-evidence/DG1/qa/round-4/28-blackbox-probe-r2-rerun.log` (+2) | ok |

### DG1 visual (5)

| Role | Check | Result | Exit | Command (truncated) | Evidence (first) | ev |
|---|---|---|---|---|---|---|
| domain | DOM-R4-07-contrast | PASS | 0 | `PATH=/opt/node22/bin:$PATH pnpm --filter @mth/design-tokens run check:contrast` | `docs/delivery/test-evidence/DG1/domain/round-4/07-contrast.log` | ok |
| domain | DOM-R4-10-bilingual-screens | PASS | 0 | `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node 01c-screens.mjs <out> (run from 01b-run.sh)` | `docs/delivery/test-evidence/DG1/domain/round-4/01c-screens.mjs.txt` (+8) | ok |
| qa | QA-R4-14-e2e-qa-acceptance-A20 | PASS | 0 | `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers e2e/support/qa-stack.sh npx playwright test e2e apps/web/e2e --workers=1 --reporter=list` | `docs/delivery/test-evidence/DG1/qa/round-4/18-e2e-qa-acceptance.log` | ok |
| qa | QA-R4-16-A18-clean-start | PASS | 0 | `e2e/clean-start/a18-clean-start.sh --commit 642e6bfb2c905d2c3382035032fa56c84672dcab --install` | `docs/delivery/test-evidence/DG1/qa/round-4/20-a18-clean-start.log` | ok |
| qa | QA-R4-21-contrast-and-fonts | PASS | 0 | `pnpm --filter @mth/design-tokens run check:contrast ; grep fontsource licenses/inventory.csv ; ls apps/web/dist/assets/*.woff2` | `docs/delivery/test-evidence/DG1/qa/round-4/26-contrast.log` (+1) | ok |

### DG1 other (19)

| Role | Check | Result | Exit | Command (truncated) | Evidence (first) | ev |
|---|---|---|---|---|---|---|
| domain | DOM-R4-00-candidate | PASS | 0 | `git rev-parse HEAD; node tools/gates/candidate.mjs --stage DG1 (repo, Node 24; $TMPDIR/review-dg1r4, Node 22); python3 manifest entry diff; ` | `docs/delivery/test-evidence/DG1/domain/round-4/00-candidate.log` (+1) | ok |
| domain | DOM-R4-03-build | PASS | 0 | `PATH=/opt/node22/bin:$PATH pnpm -r build` | `docs/delivery/test-evidence/DG1/domain/round-4/03-build.log` | ok |
| domain | DOM-R4-04-lint | PASS | 0 | `PATH=/opt/node22/bin:$PATH pnpm lint` | `docs/delivery/test-evidence/DG1/domain/round-4/04-lint.log` | ok |
| domain | DOM-R4-08-nocdn-openapi-claims | PASS | 0 | `pnpm check:no-cdn; pnpm openapi:lint; grep -rniE 'official (pmi\|mobily)\|pmi[- ]certified\|certified by pmi\|mobily[- ]approved' apps packages ` | `docs/delivery/test-evidence/DG1/domain/round-4/08-nocdn-openapi-claims.log` | ok |
| domain | DOM-R4-11-source-fidelity | PASS | 0 | `git diff --stat 4f312cc 91936e6 -- docs/source packages/shared apps/web/src apps/api/src packages/db; grep PHASES packages/shared/src; sha25` | `docs/delivery/test-evidence/DG1/domain/round-4/10-source-fidelity.log` | ok |
| code | SEC-R4-00-candidate-identity | PASS | 0 | `git rev-parse HEAD; node tools/gates/candidate.mjs --stage DG1 [--ref HEAD in the clone]; git diff --stat 642e6bf..HEAD; manifest entry diff` | `docs/delivery/test-evidence/DG1/code-security/round-4/00-candidate-identity.log` | ok |
| code | SEC-R4-04-build | PASS | 0 | `pnpm -r build` | `docs/delivery/test-evidence/DG1/code-security/round-4/build.log` | ok |
| code | SEC-R4-05-lint | PASS | 0 | `pnpm lint` | `docs/delivery/test-evidence/DG1/code-security/round-4/lint.log` | ok |
| code | SEC-R4-06-openapi-lint | PASS | 0 | `pnpm openapi:lint` | `docs/delivery/test-evidence/DG1/code-security/round-4/openapi-lint.log` | ok |
| code | SEC-R4-07-no-cdn | PASS | 0 | `pnpm check:no-cdn` | `docs/delivery/test-evidence/DG1/code-security/round-4/no-cdn.log` | ok |
| code | SEC-R4-15-install-sandbox-offline | PASS | 0 | `npm_config_store_dir=$TMPDIR/store/v10 bash tools/deps/tests/install-sandbox.test.sh; assertion over its output` | `docs/delivery/test-evidence/DG1/code-security/round-4/install-sandbox.log` (+1) | ok |
| code | SEC-R4-16-sbom-check | PASS | 0 | `node licenses/generate-sbom.mjs --check` | `docs/delivery/test-evidence/DG1/code-security/round-4/sbom-check.log` | ok |
| code | SEC-R4-17-validate-historical-DG0 | PASS | 0 | `node tools/gates/validate.mjs --historical --stage DG0` | `docs/delivery/test-evidence/DG1/code-security/round-4/validate-historical-DG0.log` | ok |
| qa | QA-R4-00-candidate-identity | PASS | 0 | `node tools/gates/candidate.mjs --stage DG1 ; git diff --stat 642e6bf HEAD ; git diff 40dbd24 642e6bf -- . ':!docs/delivery'` | `docs/delivery/test-evidence/DG1/qa/round-4/00-delta-and-candidate.txt` (+1) | ok |
| qa | QA-R4-01-install-offline | PASS | 0 | `npm_config_store_dir=$TMPDIR/pnpm-store/v10 pnpm install --frozen-lockfile --offline` | `docs/delivery/test-evidence/DG1/qa/round-4/01-install-offline.log` | ok |
| qa | QA-R4-04-build | PASS | 0 | `pnpm build` | `docs/delivery/test-evidence/DG1/qa/round-4/03-build.log` | ok |
| qa | QA-R4-05-lint-format-openapi-nocdn | PASS | 0 | `pnpm lint ; pnpm format:check ; pnpm openapi:lint ; pnpm check:no-cdn` | `docs/delivery/test-evidence/DG1/qa/round-4/04-lint.log` (+3) | ok |
| qa | QA-R4-17-validators | PASS | 0 | `node tools/gates/validate.mjs --register DG1 ; node tools/gates/validate.mjs --pipeline ; node tools/gates/validate.mjs --reconcile` | `docs/delivery/test-evidence/DG1/qa/round-4/21-validate-register.log` (+2) | ok |
| qa | QA-R4-19-install-sandbox-offline-REQ-DLV-042 | PASS | 0 | `env npm_config_store_dir=$TMPDIR/pnpm-store/v10 bash tools/deps/tests/install-sandbox.test.sh ; tools/deps/install-sandbox.sh --root $TMPDIR` | `docs/delivery/test-evidence/DG1/qa/round-4/23-install-sandbox-tests.log` (+1) | ok |

### DG1 release-audit tests (gate record `tests[]`, 11)

| Test | Result | Evidence (first) |
|---|---|---|
| Candidate recomputation (working tree, 642e6bf, 91936e6, diff) and complete-clone check | PASS | `docs/delivery/test-evidence/DG1/audit/round-4/01-candidate-and-validators.log` |
| Previous gate DG0 historical validation | PASS | `docs/delivery/test-evidence/DG1/audit/round-4/01-candidate-and-validators.log` |
| Workspace typecheck including the apps/web e2e project (F-DG1-147) | PASS | `docs/delivery/test-evidence/DG1/qa/round-4/02-typecheck.log` |
| Build, lint, format, OpenAPI lint, no-CDN scan | PASS | `docs/delivery/test-evidence/DG1/qa/round-4/03-build.log` |
| Unit tests on Node 22 and Node 24 (326/326 each) | PASS | `docs/delivery/test-evidence/DG1/qa/round-4/10-unit-node22.log` |
| Integration on fresh disposable PostgreSQL 16 (209/209, 9 migrations incl. 0009, bu-hierarchy-guard 7/7), repeated | PASS | `docs/delivery/test-evidence/DG1/qa/round-4/12-integration-run1.log` |
| E2E journeys EN+AR (18/18, no skips) and QA acceptance e2e (22/22) | PASS | `docs/delivery/test-evidence/DG1/qa/round-4/17-e2e-journeys-run1.log` |
| A18 clean start at the candidate commit | PASS | `docs/delivery/test-evidence/DG1/qa/round-4/20-a18-clean-start.log` |
| Install-sandbox offline acceptance (13/14; only AC-1 effect needs the live registry, D-057) and CI offline surface (A24, D-058) | PASS | `docs/delivery/test-evidence/DG1/code-security/round-4/install-sandbox.log` |
| Gate tooling, agent runner and deploy-script test suites; SBOM currency | PASS | `docs/delivery/test-evidence/DG1/code-security/round-4/gates-agents-tests.log` |
| Register, provenance, findings and requirement coverage audit | PASS | `docs/delivery/test-evidence/DG1/audit/round-4/02-provenance-findings-requirements.log` |

### DG1 tests that could not run, and disclosures (5)

| Source | Role | Record | Check | Result | Reason (excerpt) |
|---|---|---|---|---|---|
| approving round | qa-verifier | `docs/delivery/reviews/DG1/round-4/qa-verifier.json` | QA-R4-13-e2e-journeys-en-ar | PASS | 18 passed (42.6s), with 0 skipped, 0 flaky and 0 failed. |
| approving round | qa-verifier | `docs/delivery/reviews/DG1/round-4/qa-verifier.json` | QA-R4-14-e2e-qa-acceptance-A20 | PASS | es A20 'Arabic RTL by default; English LTR after the switch; persisted; switch back' and 'seeded --mth-* colours ... equal the built token source'. Nothing was skipped. |
| approving round | qa-verifier | `docs/delivery/reviews/DG1/round-4/qa-verifier.json` | QA-R4-18-ci-offline-surface-A24 | PASS | ed DG0.json gave 'FAIL pipeline (3 problems)' with exit 1, and the restored record exited 0. ci.yml line 64 has 'run: pnpm typecheck'. The live Actions run was not executed here: residual D-058. |
| earlier round (superseded by the approving round) | qa-verifier | `docs/delivery/reviews/DG1/round-1/qa-verifier.json` | QA-R1-16-ci-live-a24 | BLOCKED | NOT RUN: GitHub Actions cannot be reached from this sandbox, and no live run evidence exists in the repository (the register row also states 'A live CI run with a failing gate record has not been observed'). What was verified instead: the needs-graph and status-function rules (QA-R1-15, including negative mutations). That GitHub skips a job whose needs failed is documented pla… |
| earlier round (superseded by the approving round) | qa-verifier | `docs/delivery/reviews/DG1/round-1/qa-verifier.json` | QA-R1-18-install-sandbox-ac1-effect | BLOCKED | BLOCKED by the environment: 'ERR_PNPM_META_FETCH_FAIL GET https://registry.npmjs.org/is-number … ECONNREFUSED 127.0.0.1:3128' on all attempts, even though the store copy holds is-number@7.0.0 (create resolves metadata online). Not a product defect. Existing evidence for this case: the orchestrator's run on byte-identical code (14/14). |

## DG2 (APPROVED)

- Gate record: `docs/delivery/gates/DG2.json`; candidate `sha256:ddaab3cc264b0e13caadcb17f0d1811eff8ad1ec9364b7ba9c03727b83350750`; source `805da3e26bed3572ca2fc32365934e57b2e84eeb`.
- domain-reviewer: `docs/delivery/reviews/DG2/round-17/domain-reviewer.json`, verdict PASS, candidate = gate.
- code-security-reviewer: `docs/delivery/reviews/DG2/round-17/code-security-reviewer.json`, verdict PASS, candidate = gate.
- qa-verifier: `docs/delivery/reviews/DG2/round-17/qa-verifier.json`, verdict PASS, candidate = gate.
- Release audit: `docs/delivery/reviews/DG2/round-17/release-auditor.json`.

### DG2 unit (10)

| Role | Check | Result | Exit | Command (truncated) | Evidence (first) | ev |
|---|---|---|---|---|---|---|
| domain | DOM-R17-04-test | PASS | 0 | `bash docs/delivery/test-evidence/DG2/domain/round-17/checks.sh` | `docs/delivery/test-evidence/DG2/domain/round-17/test-node22.log` (+1) | ok |
| code | SEC-R17-09-unit-node22 | PASS | 0 | `pnpm test --reporter=verbose` | `docs/delivery/test-evidence/DG2/code-security/round-17/unit-node22.log` | ok |
| code | SEC-R17-10-unit-node24 | PASS | 0 | `pnpm test --reporter=verbose` | `docs/delivery/test-evidence/DG2/code-security/round-17/unit-node24.log` | ok |
| code | SEC-R17-11-unit-under-load | PASS | 0 | `bash docs/delivery/test-evidence/DG2/code-security/round-17/load-repro.sh` | `docs/delivery/test-evidence/DG2/code-security/round-17/unit-under-load-node22.log` (+3) | ok |
| code | SEC-R17-18-class-probe | PASS | 0 | `pnpm vitest run --project unit-web apps/web/src/auth/zz-sec-r17-web-probe.test.tsx (via probe-runs.sh)` | `docs/delivery/test-evidence/DG2/code-security/round-17/probe-r17-web-node22-lang-unset.log` (+3) | ok |
| code | SEC-R17-20-fe10-fe14-guarantees | PASS | 0 | `r14/r15/r16 probes (SEC-R17-17); unit suites (SEC-R17-09/10/11); source review of Shell.tsx, LoginPage.tsx, session.tsx and client.ts (SEC-R` | `docs/delivery/test-evidence/DG2/code-security/round-17/probe-r14-web-node22-lang-unset.log` (+2) | ok |
| code | SEC-R17-22-requirements | PASS | 0 | `grep of both integration logs and unit-node22.log for the covering tests` | `docs/delivery/test-evidence/DG2/code-security/round-17/integration-run1-lang-unset.log` (+2) | ok |
| code | SEC-R17-26-env-live-ci | PASS | 0 | `node deploy/scripts/check-ci-needs.mjs; node --test deploy/scripts/tests/check-ci-needs.test.mjs; grep the workflow steps` | `docs/delivery/test-evidence/DG2/code-security/round-17/env-residuals.log` | ok |
| qa | QA-R17-08-unit-series | PASS | 0 | `unit/run-unit-series.sh (PATH=<node22\|node24>:$PATH env -u LANG -u LC_ALL \| env -u LC_ALL LANG=C.UTF-8 pnpm test)` | `docs/delivery/test-evidence/DG2/qa/round-17/08-unit-series-summary.log` (+5) | ok |
| qa | QA-R17-33-residual-ci-D058 | PASS | 0 | `ls .github/workflows; git diff --stat e3b2375a 805da3e2 -- .github deploy/scripts; node deploy/scripts/check-ci-needs.mjs; node --test deplo` | `docs/delivery/test-evidence/DG2/qa/round-17/33-residual-ci-config.log` | ok |

### DG2 integration (10)

| Role | Check | Result | Exit | Command (truncated) | Evidence (first) | ev |
|---|---|---|---|---|---|---|
| domain | DOM-R17-07-live-scenario | PASS | 0 | `bash with-stack.sh bash runp.sh live-scenario design-registers r13-delta-api r12-delta-api r11-delta-api r10-delta-api regress-d069-api regr` | `docs/delivery/test-evidence/DG2/domain/round-17/stack-run-1.log` (+5) | ok |
| code | SEC-R17-11-unit-under-load | PASS | 0 | `bash docs/delivery/test-evidence/DG2/code-security/round-17/load-repro.sh` | `docs/delivery/test-evidence/DG2/code-security/round-17/unit-under-load-node22.log` (+3) | ok |
| code | SEC-R17-12-integration-run1 | PASS | 0 | `with-pg.sh 30371 pnpm test:integration --reporter=verbose` | `docs/delivery/test-evidence/DG2/code-security/round-17/integration-run1-lang-unset.log` (+1) | ok |
| code | SEC-R17-13-integration-run2 | PASS | 0 | `LANG=C.UTF-8 with-pg.sh 30372 pnpm test:integration --reporter=verbose` | `docs/delivery/test-evidence/DG2/code-security/round-17/integration-run2-lang-c-utf8.log` | ok |
| code | SEC-R17-22-requirements | PASS | 0 | `grep of both integration logs and unit-node22.log for the covering tests` | `docs/delivery/test-evidence/DG2/code-security/round-17/integration-run1-lang-unset.log` (+2) | ok |
| code | SEC-R17-27-env-keycloak | PASS | 0 | `oidc.test.ts in both integration runs` | `docs/delivery/test-evidence/DG2/code-security/round-17/env-residuals.log` | ok |
| qa | QA-R17-10-integration-series | PASS | 0 | `integration/run-integration-series.sh: <locale env> QA_PG_PORT=<25741..25746> tests/qa/support/with-pg.sh npx vitest run --project integrati` | `docs/delivery/test-evidence/DG2/qa/round-17/10-integration-series-summary.log` (+8) | ok |
| qa | QA-R17-12-migrations | PASS | 0 | `env -u LC_ALL LANG=C.UTF-8 QA_PG_PORT=25751 tests/qa/support/with-pg.sh bash $TMPDIR/mig.sh (script inlined in the log)` | `docs/delivery/test-evidence/DG2/qa/round-17/12-migrations.log` | ok |
| qa | QA-R17-15-e2e-product | PASS | 0 | `run-e2e.sh <unset\|cutf8>: apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e e2e/a20-bilingual-shell.spec.ts --workers=1 --` | `docs/delivery/test-evidence/DG2/qa/round-17/run-e2e.sh` (+3) | ok |
| qa | QA-R17-34-residual-keycloak-D049 | PASS | 0 | `part of QA-R17-10, QA-R17-15 and QA-R17-17` | `docs/delivery/test-evidence/DG2/qa/round-17/10-integration-series-summary.log` (+1) | ok |

### DG2 e2e (10)

| Role | Check | Result | Exit | Command (truncated) | Evidence (first) | ev |
|---|---|---|---|---|---|---|
| domain | DOM-R17-08-ui-signin-charter-evidence-team-design-en-ar | PASS | 0 | `bash with-stack.sh bash runp.sh r13-ui r9-ui:ui-upload-alert charter-blank-ui dom-shots walk-ui r12-team-ui r12-journey-steps-ui regress-d06` | `docs/delivery/test-evidence/DG2/domain/round-17/stack-run-2.log` (+25) | ok |
| qa | QA-R17-15-e2e-product | PASS | 0 | `run-e2e.sh <unset\|cutf8>: apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e e2e/a20-bilingual-shell.spec.ts --workers=1 --` | `docs/delivery/test-evidence/DG2/qa/round-17/run-e2e.sh` (+3) | ok |
| qa | QA-R17-16-default-rate-limits | PASS | 0 | `run-e2e.sh: E2E_DEFAULT_RATE_LIMITS=1 apps/web/e2e/support/with-stack.sh npx playwright test e2e/dg2-qa-r14.spec.ts apps/web/e2e/session-end` | `docs/delivery/test-evidence/DG2/qa/round-17/16-e2e-default-limits-unset-chromium-en.log` (+3) | ok |
| qa | QA-R17-17-e2e-full-regression | PASS | 1 | `run-e2e.sh <unset\|cutf8>: e2e/support/qa-stack.sh npx playwright test e2e apps/web/e2e --workers=1 --reporter=list` | `docs/delivery/test-evidence/DG2/qa/round-17/17-e2e-qa-stack-unset.log` (+6) | ok |
| qa | QA-R17-20-r15-04-diagnostic | PASS | 1 | `<locale env> e2e/support/qa-stack.sh npx playwright test e2e/dg2-qa-r17-diag.spec.ts e2e/dg2-qa-r15.spec.ts --grep 'R17-10\|R15-04' --workers` | `docs/delivery/test-evidence/DG2/qa/round-17/20-r15-04-diagnostic-unset.log` (+3) | ok |
| qa | QA-R17-F580-verification | PASS | 0 | `part of QA-R17-17 (e2e/dg2-qa-r16.spec.ts, sha256 408a6a14...)` | `docs/delivery/test-evidence/DG2/qa/round-17/17-e2e-qa-stack-unset.log` (+6) | ok |
| qa | QA-R17-N1-writes-across-identity-change | PASS | 0 | `part of QA-R17-17 (e2e/dg2-qa-r17.spec.ts, sha256 f6b3aaa8...)` | `docs/delivery/test-evidence/DG2/qa/tests/round-17/e2e/dg2-qa-r17.spec.ts` (+7) | ok |
| qa | QA-R17-18-spec-development | PASS | 0 | `e2e/support/qa-stack.sh npx playwright test e2e/dg2-qa-r17.spec.ts [--grep ...] --workers=1` | `docs/delivery/test-evidence/DG2/qa/round-17/18-r17-spec-dev-run1.log` (+5) | ok |
| qa | QA-R17-22-axe | PASS | 0 | `python3 -I summarize-axe.py e2e-product-unset e2e-qa-unset e2e-product-cutf8 e2e-qa-cutf8` | `docs/delivery/test-evidence/DG2/qa/round-17/22-axe-summary.log` (+3) | ok |
| qa | QA-R17-34-residual-keycloak-D049 | PASS | 0 | `part of QA-R17-10, QA-R17-15 and QA-R17-17` | `docs/delivery/test-evidence/DG2/qa/round-17/10-integration-series-summary.log` (+1) | ok |

### DG2 visual (7)

| Role | Check | Result | Exit | Command (truncated) | Evidence (first) | ev |
|---|---|---|---|---|---|---|
| domain | DOM-R17-05-contrast | PASS | 0 | `bash docs/delivery/test-evidence/DG2/domain/round-17/checks.sh` | `docs/delivery/test-evidence/DG2/domain/round-17/contrast-node22.log` (+1) | ok |
| domain | DOM-R17-07-live-scenario | PASS | 0 | `bash with-stack.sh bash runp.sh live-scenario design-registers r13-delta-api r12-delta-api r11-delta-api r10-delta-api regress-d069-api regr` | `docs/delivery/test-evidence/DG2/domain/round-17/stack-run-1.log` (+5) | ok |
| domain | DOM-R17-08-ui-signin-charter-evidence-team-design-en-ar | PASS | 0 | `bash with-stack.sh bash runp.sh r13-ui r9-ui:ui-upload-alert charter-blank-ui dom-shots walk-ui r12-team-ui r12-journey-steps-ui regress-d06` | `docs/delivery/test-evidence/DG2/domain/round-17/stack-run-2.log` (+25) | ok |
| code | SEC-R17-20-fe10-fe14-guarantees | PASS | 0 | `r14/r15/r16 probes (SEC-R17-17); unit suites (SEC-R17-09/10/11); source review of Shell.tsx, LoginPage.tsx, session.tsx and client.ts (SEC-R` | `docs/delivery/test-evidence/DG2/code-security/round-17/probe-r14-web-node22-lang-unset.log` (+2) | ok |
| qa | QA-R17-01-static | PASS | 0 | `run-static.sh: pnpm -r typecheck; pnpm -r build; pnpm lint; pnpm openapi:lint; pnpm check:no-cdn; pnpm format:check; pnpm --filter @mth/desi` | `docs/delivery/test-evidence/DG2/qa/round-17/run-static.sh` (+8) | ok |
| qa | QA-R17-15-e2e-product | PASS | 0 | `run-e2e.sh <unset\|cutf8>: apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e e2e/a20-bilingual-shell.spec.ts --workers=1 --` | `docs/delivery/test-evidence/DG2/qa/round-17/run-e2e.sh` (+3) | ok |
| qa | QA-R17-22-axe | PASS | 0 | `python3 -I summarize-axe.py e2e-product-unset e2e-qa-unset e2e-product-cutf8 e2e-qa-cutf8` | `docs/delivery/test-evidence/DG2/qa/round-17/22-axe-summary.log` (+3) | ok |

### DG2 other (42)

| Role | Check | Result | Exit | Command (truncated) | Evidence (first) | ev |
|---|---|---|---|---|---|---|
| domain | DOM-R17-00-candidate | PASS | 0 | `sha256sum <assignment>; git log 805da3e..HEAD; git diff --name-only 805da3e HEAD; node tools/gates/candidate.mjs --stage DG2 (repo + clone, ` | `docs/delivery/test-evidence/DG2/domain/round-17/candidate-and-dg1.log` (+1) | ok |
| domain | DOM-R17-01-typecheck | PASS | 0 | `bash docs/delivery/test-evidence/DG2/domain/round-17/checks.sh` | `docs/delivery/test-evidence/DG2/domain/round-17/typecheck-node22.log` (+2) | ok |
| domain | DOM-R17-02-build | PASS | 0 | `bash docs/delivery/test-evidence/DG2/domain/round-17/checks.sh` | `docs/delivery/test-evidence/DG2/domain/round-17/build-node22.log` (+1) | ok |
| domain | DOM-R17-03-lint | PASS | 0 | `bash docs/delivery/test-evidence/DG2/domain/round-17/checks.sh` | `docs/delivery/test-evidence/DG2/domain/round-17/lint-node22.log` (+1) | ok |
| domain | DOM-R17-06-source-fidelity-static | PASS | 0 | `node rv/source-fidelity.mjs (round-13 probe, unchanged)` | `docs/delivery/test-evidence/DG2/domain/round-17/source-fidelity.log` (+1) | ok |
| domain | DOM-R17-09-ui-create-edit-archive-en-ar | PASS | 0 | `node rv/r16-edit-archive-ui.mjs (round-16 probe, unchanged), within stack-run-2; creation also in r13-ui and walk-ui` | `docs/delivery/test-evidence/DG2/domain/round-17/r16-edit-archive-ui.log` (+4) | ok |
| domain | DOM-R17-10-ui-withdrawn-and-shutdown | PASS | 0 | `bash with-stack.sh bash runp.sh r13-ui-withdrawn r13-shutdown` | `docs/delivery/test-evidence/DG2/domain/round-17/stack-run-3.log` (+2) | ok |
| domain | DOM-R17-11-F570-identity-navigation-en-ar | PASS | 0 | `bash with-stack.sh bash runp.sh r16-identity-nav r17-identity-residual r16-identity-ui r15-identity-ui r13-session-end-ui r14-session-end-ui` | `docs/delivery/test-evidence/DG2/domain/round-17/r16-identity-nav.log` (+20) | ok |
| domain | DOM-R17-12-D077-residual-challenge-en-ar | PASS | 0 | `node rv/r17-identity-residual.mjs (stack-run-4 attempt 1, stack-run-5 attempt 2, stack-run-6 attempt 3; also stack-run-7 and -8 with default` | `docs/delivery/test-evidence/DG2/domain/round-17/r17-identity-residual.mjs` (+15) | ok |
| domain | DOM-R17-13-session-end-and-language-en-ar | PASS | 0 | `node rv/r13-session-end-ui.mjs, rv/r14-session-end-ui.mjs, rv/r14-language-ui.mjs (stack-run-4); session-end probes again with default limit` | `docs/delivery/test-evidence/DG2/domain/round-17/r13-session-end-ui.log` (+10) | ok |
| domain | DOM-R17-14-invariants | PASS | 0 | `bash docs/delivery/test-evidence/DG2/domain/round-17/invariants.sh; grep -rnE 'useNavigate\|setQueryData\|setQueriesData\|router.navigate' apps` | `docs/delivery/test-evidence/DG2/domain/round-17/invariants.log` (+1) | ok |
| domain | DOM-R17-15-utf8-fail-closed | PASS | 0 | `with-stack.sh UTF8-PROBE lines` | `docs/delivery/test-evidence/DG2/domain/round-17/stack-run-1.log` (+1) | ok |
| domain | DOM-R17-16-env-residuals | PASS | 0 | `see env-residuals.log (offline frozen install; cmp .github/workflows/ci.yml deploy/ci/ci.yml; Keycloak config surface listing)` | `docs/delivery/test-evidence/DG2/domain/round-17/env-residuals.log` | ok |
| code | SEC-R17-00-candidate | PASS | 0 | `sha256sum docs/delivery/assignments/DG2/round-17/code-security-reviewer.md; git rev-parse HEAD; git diff --stat 805da3e..23edabf; node tools` | `docs/delivery/test-evidence/DG2/code-security/round-17/candidate-id.log` | ok |
| code | SEC-R17-01-diff-review | PASS | 0 | `git diff e3b2375..805da3e -- . ':!docs/delivery'; grep -rnE 'setQueryData\|setQueriesData\|\.navigate\(\|<Navigate\|window\.location' apps/web/s` | `docs/delivery/test-evidence/DG2/code-security/round-17/diff-scan.log` (+5) | ok |
| code | SEC-R17-02-install | PASS | 0 | `pnpm install --offline --frozen-lockfile --store-dir $TMPDIR/pstore/v10 (store copied from /root/.local/share/pnpm/store/v10)` | `docs/delivery/test-evidence/DG2/code-security/round-17/install.log` (+1) | ok |
| code | SEC-R17-03-typecheck | PASS | 0 | `pnpm -r typecheck` | `docs/delivery/test-evidence/DG2/code-security/round-17/typecheck.log` | ok |
| code | SEC-R17-04-build | PASS | 0 | `pnpm -r build` | `docs/delivery/test-evidence/DG2/code-security/round-17/build.log` | ok |
| code | SEC-R17-05-lint | PASS | 0 | `pnpm lint (eslint . --max-warnings=0)` | `docs/delivery/test-evidence/DG2/code-security/round-17/lint.log` | ok |
| code | SEC-R17-06-openapi-lint | PASS | 0 | `pnpm openapi:lint; grep -c '^ *operationId:' docs/api/openapi.yaml` | `docs/delivery/test-evidence/DG2/code-security/round-17/openapi-lint.log` (+1) | ok |
| code | SEC-R17-07-no-cdn | PASS | 0 | `pnpm check:no-cdn` | `docs/delivery/test-evidence/DG2/code-security/round-17/no-cdn.log` | ok |
| code | SEC-R17-08-format | PASS | 0 | `pnpm format:check` | `docs/delivery/test-evidence/DG2/code-security/round-17/format-check.log` | ok |
| code | SEC-R17-14-required-suites | PASS | 0 | `bash aux-checks.sh (requirements-suites.log)` | `docs/delivery/test-evidence/DG2/code-security/round-17/requirements-suites.log` | ok |
| code | SEC-R17-15-contract-migrations | PASS | 0 | `bash aux-checks.sh (contract-ops.log)` | `docs/delivery/test-evidence/DG2/code-security/round-17/contract-ops.log` | ok |
| code | SEC-R17-16-aud-403-sweep | PASS | 0 | `bash aux-checks.sh (aud-403-sweep.log)` | `docs/delivery/test-evidence/DG2/code-security/round-17/aud-403-sweep.log` | ok |
| code | SEC-R17-17-prior-probes-rerun | PASS | 0 | `bash docs/delivery/test-evidence/DG2/code-security/round-17/probe-runs.sh` | `docs/delivery/test-evidence/DG2/code-security/round-17/probe-r14-web-node22-lang-unset.log` (+7) | ok |
| code | SEC-R17-19-lint-convention-probe | PASS | 1 | `pnpm exec eslint apps/web/src/pages/zzprobe/zz-sec-r17-lint-bypass.tsx (in $TMPDIR/r17p)` | `docs/delivery/test-evidence/DG2/code-security/round-17/lint-bypass-probe.log` (+1) | ok |
| code | SEC-R17-21-f530-verification | PASS | 0 | `See SEC-R17-01, SEC-R17-17 and SEC-R17-18` | `docs/delivery/reviews/DG2/round-17/code-security-reviewer.verifications.json` | ok |
| code | SEC-R17-23-validate-historical-DG0 | PASS | 0 | `node tools/gates/validate.mjs --historical --stage DG0` | `docs/delivery/test-evidence/DG2/code-security/round-17/validate-historical-DG0.log` | ok |
| code | SEC-R17-24-validate-historical-DG1 | PASS | 0 | `node tools/gates/validate.mjs --historical --stage DG1` | `docs/delivery/test-evidence/DG2/code-security/round-17/validate-historical-DG1.log` | ok |
| code | SEC-R17-25-env-live-registry | PASS | 0 | `pnpm install --offline --frozen-lockfile (install.log, install2.log)` | `docs/delivery/test-evidence/DG2/code-security/round-17/env-residuals.log` (+1) | ok |
| qa | QA-R17-00-candidate | PASS | 0 | `git rev-parse HEAD; git merge-base --is-ancestor 805da3e2 HEAD; node tools/gates/candidate.mjs --stage DG2 [--ref 805da3e2]` | `docs/delivery/test-evidence/DG2/qa/round-17/00-candidate.log` (+3) | ok |
| qa | QA-R17-00-historical-DG1 | PASS | 0 | `node tools/gates/validate.mjs --historical --stage DG1` | `docs/delivery/test-evidence/DG2/qa/round-17/00-historical-DG1.log` | ok |
| qa | QA-R17-00-install | PASS | 0 | `pnpm install --frozen-lockfile --offline --store-dir $TMPDIR/pnpm-store-root/v10` | `docs/delivery/test-evidence/DG2/qa/round-17/00-install-review-dg2.log` (+3) | ok |
| qa | QA-R17-N2-header-data-after-navigation-and-refocus | PASS | 0 | `part of QA-R17-17` | `docs/delivery/test-evidence/DG2/qa/round-17/19-e2e-results-summary.log` (+2) | ok |
| qa | QA-R17-N3-in-app-session-end | PASS | 0 | `part of QA-R17-15 and QA-R17-17` | `docs/delivery/test-evidence/DG2/qa/round-17/19-e2e-results-summary.log` (+2) | ok |
| qa | QA-R17-N4-403-never-session-end | PASS | 0 | `part of QA-R17-17 and QA-R17-20` | `docs/delivery/test-evidence/DG2/qa/round-17/19-e2e-results-summary.log` (+3) | ok |
| qa | QA-R17-N5-same-identity-flows | PASS | 0 | `part of QA-R17-17` | `docs/delivery/test-evidence/DG2/qa/round-17/19-e2e-results-summary.log` (+2) | ok |
| qa | QA-R17-N6-declared-2s-residual | PASS | 0 | `part of QA-R17-17; first seen in spec development runs 1-2 (timeline instrumentation)` | `docs/delivery/test-evidence/DG2/qa/round-17/18-r17-spec-dev-run2.log` (+3) | ok |
| qa | QA-R17-19-static-inspection | PASS | 0 | `grep over apps/web/src (non-test) in the clone; see 19-static-inspection.log` | `docs/delivery/test-evidence/DG2/qa/round-17/19-static-inspection.log` | ok |
| qa | QA-R17-30-validators | PASS | 0 | `node tools/gates/validate.mjs --register DG2; --pipeline; --reconcile` | `docs/delivery/test-evidence/DG2/qa/round-17/30-validate-register.log` (+2) | ok |
| qa | QA-R17-32-residual-registry-D057 | PASS | 124 | `timeout 60 pnpm deps:verify; git diff --stat e3b2375a 805da3e2 -- package.json pnpm-lock.yaml apps/*/package.json packages/*/package.json .n` | `docs/delivery/test-evidence/DG2/qa/round-17/32-residual-registry.log` | ok |

### DG2 release-audit tests (gate record `tests[]`, 11)

| Test | Result | Evidence (first) |
|---|---|---|
| Complete-clone check and candidate recomputation (working tree and clean clone at 805da3e2) | PASS | `docs/delivery/test-evidence/DG2/audit/round-17/01-audit-checks.log` |
| Previous gate DG1 historical validation and register rules at DG2 | PASS | `docs/delivery/test-evidence/DG2/audit/round-17/01-audit-checks.log` |
| Typecheck, build, lint (including FE15's restricted-navigation rule), OpenAPI lint (161 ops), no-CDN, format | PASS | `docs/delivery/test-evidence/DG2/code-security/round-17/typecheck.log` |
| Unit tests on Node 22 and Node 24, and under load (926/926 each) | PASS | `docs/delivery/test-evidence/DG2/code-security/round-17/unit-node22.log` |
| Integration on disposable PostgreSQL 16 in both locale settings (612/612; 652/652 with QA suites, 3 runs per locale; migrations 0001-0019) | PASS | `docs/delivery/test-evidence/DG2/code-security/round-17/integration-run1-lang-unset.log` |
| Product e2e EN+AR on the real stack (74/74 per locale) and the QA regression e2e (210 passed; the 2 failures are qa's own obsolete R15-04 last step, outside the | PASS | `docs/delivery/test-evidence/DG2/qa/round-17/15-e2e-product-unset.log` |
| Round-17 finding verifications: F-DG2-530 (code-security), F-DG2-570 (domain) and F-DG2-580 (qa) on this candidate, each considering the D-077 residual | PASS | `docs/delivery/reviews/DG2/round-17/code-security-reviewer.verifications.json` |
| Auditor reproduction of the round-10 connection-holding defect (F-DG2-410) on this candidate: no longer reproduces (app.close 3 ms vs 64,911 ms) | PASS | `docs/delivery/test-evidence/DG2/audit/round-17/04-f410-repro-on-candidate.log` |
| Disclosure check: grep of every log cited by the round-17 records (and the relied-upon round-11..15 records) for undisclosed non-zero exits, failed suites or ho | PASS | `docs/delivery/test-evidence/DG2/audit/round-17/03-disclosure-grep.log` |
| Provenance, findings (40/40 CLOSED_VERIFIED by non-authors, fixes in the candidate) and requirement coverage audit | PASS | `docs/delivery/test-evidence/DG2/audit/round-17/01-audit-checks.log` |
| Environmental residuals on the offline/config surface: live registry (D-057), live CI (D-058), Keycloak (D-049) | PASS | `docs/delivery/test-evidence/DG2/code-security/round-17/env-residuals.log` |

### DG2 tests that could not run, and disclosures (3)

| Source | Role | Record | Check | Result | Reason (excerpt) |
|---|---|---|---|---|---|
| approving round | domain-reviewer | `docs/delivery/reviews/DG2/round-17/domain-reviewer.json` | DOM-R17-16-env-residuals | PASS | Offline frozen install exit 0 (residual D-057: live registry not reached). The CI files are identical, cmp exit 0 (residual D-058: live CI not run). The Keycloak realm and compose surfaces are present (residual D-049: OIDC sign-in not exercised live; dev sign-in only). |
| approving round | code-security-reviewer | `docs/delivery/reviews/DG2/round-17/code-security-reviewer.json` | SEC-R17-25-env-live-registry | PASS | The offline frozen-lockfile installs exit 0 (the WARNs are explained in SEC-R17-02). Residual (D-057): an install against a live package registry cannot run here because the sandbox has no network. |
| approving round | qa-verifier | `docs/delivery/reviews/DG2/round-17/qa-verifier.json` | QA-R17-18-spec-development | PASS | Run 1 (EN, exit 1): R17-04b failed on 'B is not navigated to A's new organisation', and the 7 later tests did not run (serial). Run 2 (R17-04, exit 1) added timeline instrumentation, which showed the switch and the answer within 2 s of the last /me, D-077's declared residual (QA-R17-N6). The deliver-first probes now |

## DG3 (APPROVED)

- Gate record: `docs/delivery/gates/DG3.json`; candidate `sha256:f55095dbec364594d25a624261512239854f233d3ee0b5c8ecc210d1602bf6e0`; source `d3e6fe62d9a4a3a0e8d08fcf273aef74857b3e81`.
- domain-reviewer: `docs/delivery/reviews/DG3/round-7/domain-reviewer.json`, verdict PASS, candidate = gate.
- code-security-reviewer: `docs/delivery/reviews/DG3/round-7/code-security-reviewer.json`, verdict PASS, candidate = gate.
- qa-verifier: `docs/delivery/reviews/DG3/round-7/qa-verifier.json`, verdict PASS, candidate = gate.
- Release audit: `docs/delivery/reviews/DG3/round-7/release-auditor.json`.

### DG3 unit (10)

| Role | Check | Result | Exit | Command (truncated) | Evidence (first) | ev |
|---|---|---|---|---|---|---|
| domain | DOM-R7-02-typecheck-build-lint-test-contrast | PASS | 0 | `bash docs/delivery/test-evidence/DG3/domain/round-7/checks.sh (invoked from full.sh)` | `docs/delivery/test-evidence/DG3/domain/round-7/checks.sh` (+13) | ok |
| code | SEC-R7-07-unit-node22 | PASS | 0 | `pnpm test --reporter=verbose` | `docs/delivery/test-evidence/DG3/code-security/round-7/unit-node22.log` (+1) | ok |
| code | SEC-R7-08-unit-node24 | PASS | 0 | `pnpm test --reporter=verbose` | `docs/delivery/test-evidence/DG3/code-security/round-7/unit-node24.log` | ok |
| code | SEC-R7-14-F-DG3-280-lint-test-mutations | PASS | 0 | `node probes/lint-mutation-probe.mjs $TMPDIR/review-p3; node probes/lint-ablation-2.mjs $TMPDIR/review-p3; node probes/lint-ablation-full.mjs` | `docs/delivery/test-evidence/DG3/code-security/round-7/lint-mutation-probe.log` (+5) | ok |
| code | SEC-R7-17-formula-engine-unchanged-fuzz | PASS | 0 | `pnpm exec vitest run --project unit-node\|unit-formula-nocodegen zz-sec-r1-fuzz.test.ts [codegen.nocodegen.test.ts]` | `docs/delivery/test-evidence/DG3/code-security/round-7/probe-C-unit-node-node22.log` (+3) | ok |
| code | SEC-R7-20-requirement-acceptance | PASS | 0 | `bash req-acceptance.sh; bash req-acceptance-targeted.sh` | `docs/delivery/test-evidence/DG3/code-security/round-7/requirement-acceptance.log` (+3) | ok |
| qa | QA-R7-01a-repair-lintproof-mutation-probe | PASS | 0 | `$TMPDIR/... scripts/probe-r7-lintproof.sh $TMPDIR/probe-dg3 (npx vitest run --project unit-node packages/shared/src/formula/fuzz.test.ts -t ` | `docs/delivery/test-evidence/DG3/qa/round-7/01e-r7-lintproof-mutation-probe.log` (+2) | ok |
| qa | QA-R7-01b-static-rule-negative-probe | PASS | 1 | `scripts/probe-r7-static.sh $TMPDIR/probe-dg3 (npx eslint <file>; npx vitest run --project unit-node packages/shared/src/formula/fuzz.test.ts` | `docs/delivery/test-evidence/DG3/qa/round-7/01b-r7-rule-static-negative-probe.log` (+3) | ok |
| qa | QA-R7-01c-runtime-mutation-probe | PASS | 0 | `scripts/probe-r7-runtime.sh $TMPDIR/probe-dg3` | `docs/delivery/test-evidence/DG3/qa/round-7/01c-runtime-mutation-probe.log` (+1) | ok |
| qa | QA-R7-02-unit | PASS | 0 | `[env -u LANG -u LC_ALL \| env LANG=C.UTF-8 LC_ALL=C.UTF-8] TZ=UTC CI=1 PATH=<node22\|node24 first> pnpm test (scripts/run-unit.sh)` | `docs/delivery/test-evidence/DG3/qa/round-7/02-unit-summary.txt` (+5) | ok |

### DG3 integration (7)

| Role | Check | Result | Exit | Command (truncated) | Evidence (first) | ev |
|---|---|---|---|---|---|---|
| domain | DOM-R7-09-integration-targeted | PASS | 0 | `bash docs/delivery/test-evidence/DG3/domain/round-7/integ.sh (npx vitest run --project integration apps/api/test/integration/{portfolio,gate` | `docs/delivery/test-evidence/DG3/domain/round-7/integ.sh` (+1) | ok |
| code | SEC-R7-09-integration-lang-unset | PASS | 0 | `bash with-pg.sh 26321 pnpm test:integration --reporter=verbose` | `docs/delivery/test-evidence/DG3/code-security/round-7/integration-run1-lang-unset.log` (+1) | ok |
| code | SEC-R7-10-integration-lang-c-utf8 | PASS | 0 | `LANG=C.UTF-8 bash with-pg.sh 26322 pnpm test:integration --reporter=verbose` | `docs/delivery/test-evidence/DG3/code-security/round-7/integration-run2-lang-c-utf8.log` | ok |
| code | SEC-R7-20-requirement-acceptance | PASS | 0 | `bash req-acceptance.sh; bash req-acceptance-targeted.sh` | `docs/delivery/test-evidence/DG3/code-security/round-7/requirement-acceptance.log` (+3) | ok |
| qa | QA-R7-03-integration-x2 | PASS | 0 | `QA_PG_PORT=26510\|26530 MTH_PORT_POOL=26500-26699 tests/qa/support/with-pg.sh npx vitest run --project integration --reporter=verbose (script` | `docs/delivery/test-evidence/DG3/qa/round-7/03-integration-run1.log` (+3) | ok |
| qa | QA-R7-04-e2e-full | PASS | 1 | `[env -u LANG -u LC_ALL \| env LANG=C.UTF-8 LC_ALL=C.UTF-8] QA_E2E_PG_PORT=26620\|26640 QA_E2E_API_PORT=26625\|26645 MTH_PORT_POOL=26500-26699 e` | `docs/delivery/test-evidence/DG3/qa/round-7/04-e2e-unset.log` (+5) | ok |
| qa | QA-R7-16-S16-entities | PASS | 0 | `python3 scripts/s16.py $TMPDIR/review-dg3; git diff --stat c40232b..d3e6fe6 -- packages/db docs/architecture/erd.md` | `docs/delivery/test-evidence/DG3/qa/round-7/06-s16-entities.txt` (+2) | ok |

### DG3 e2e (4)

| Role | Check | Result | Exit | Command (truncated) | Evidence (first) | ev |
|---|---|---|---|---|---|---|
| domain | DOM-R7-05-F-DG3-120-api-still-holds | PASS | 0 | `node rv/dg3-api-extra.mjs (inside with-stack.sh)` | `docs/delivery/test-evidence/DG3/domain/round-7/dg3-api-extra.mjs` (+2) | ok |
| qa | QA-R7-04-e2e-full | PASS | 1 | `[env -u LANG -u LC_ALL \| env LANG=C.UTF-8 LC_ALL=C.UTF-8] QA_E2E_PG_PORT=26620\|26640 QA_E2E_API_PORT=26625\|26645 MTH_PORT_POOL=26500-26699 e` | `docs/delivery/test-evidence/DG3/qa/round-7/04-e2e-unset.log` (+5) | ok |
| qa | QA-R7-06-inherited-approval | PASS | 0 | `part of QA-R7-04 (IA1, U3, apps/web/e2e/p3-inherited-approval.spec.ts)` | `docs/delivery/test-evidence/DG3/qa/round-7/results/e2e-unset-dg3-qa-r7-checks-en.json` (+1) | ok |
| qa | QA-R7-08-sequencing | PASS | 0 | `part of QA-R7-04 (A1, A2, A6)` | `docs/delivery/test-evidence/DG3/qa/round-7/04-requirement-trace.txt` (+1) | ok |

### DG3 visual (6)

| Role | Check | Result | Exit | Command (truncated) | Evidence (first) | ev |
|---|---|---|---|---|---|---|
| domain | DOM-R7-02-typecheck-build-lint-test-contrast | PASS | 0 | `bash docs/delivery/test-evidence/DG3/domain/round-7/checks.sh (invoked from full.sh)` | `docs/delivery/test-evidence/DG3/domain/round-7/checks.sh` (+13) | ok |
| domain | DOM-R7-04-F-DG3-170-badge-layout-still-holds | PASS | 0 | `PROBES="dg3-api dg3-api-extra dg3-ui-world dg3-ui dg3-ui-inherited dg3-ui-overflow dg3-ui-overflow-r3" bash with-stack.sh bash -c 'bash run-` | `docs/delivery/test-evidence/DG3/domain/round-7/dg3-ui-overflow.mjs` (+5) | ok |
| domain | DOM-R7-08-full-domain-ui | PASS | 0 | `node rv/dg3-ui-world.mjs; node rv/dg3-ui.mjs (inside with-stack.sh)` | `docs/delivery/test-evidence/DG3/domain/round-7/dg3-ui-world.mjs` (+23) | ok |
| domain | DOM-R7-10-source-fidelity-and-hygiene | PASS | 0 | `bash docs/delivery/test-evidence/DG3/domain/round-7/hygiene.sh; sed -n 380,425p docs/source/playbook.md` | `docs/delivery/test-evidence/DG3/domain/round-7/hygiene.log` (+3) | ok |
| qa | QA-R7-01-static | PASS | 0 | `pnpm -r typecheck; pnpm -r build; pnpm lint; pnpm openapi:lint; pnpm check:no-cdn; pnpm format:check; pnpm --filter @mth/design-tokens run c` | `docs/delivery/test-evidence/DG3/qa/round-7/01-pnpm-r-typecheck.log` (+6) | ok |
| qa | QA-R7-17-bilingual-a11y-aud | PASS | 0 | `part of QA-R7-04; python3 scripts/summ.py unset\|cutf8; python3 scripts/trace.py` | `docs/delivery/test-evidence/DG3/qa/round-7/04-axe-summary.txt` (+6) | ok |

### DG3 other (37)

| Role | Check | Result | Exit | Command (truncated) | Evidence (first) | ev |
|---|---|---|---|---|---|---|
| domain | DOM-R7-00-candidate | PASS | 0 | `sha256sum docs/delivery/assignments/DG3/round-7/domain-reviewer.md; git rev-parse HEAD; git merge-base --is-ancestor d3e6fe6 HEAD; git diff ` | `docs/delivery/test-evidence/DG3/domain/round-7/candidate.log` (+1) | ok |
| domain | DOM-R7-01-validators | PASS | 0 | `node tools/gates/validate.mjs --register DG3; node tools/gates/validate.mjs --historical --stage DG2; node tools/gates/validate.mjs --histor` | `docs/delivery/test-evidence/DG3/domain/round-7/validators.log` | ok |
| domain | DOM-R7-03-repair-diff-and-formula-semantics | PASS | 0 | `bash docs/delivery/test-evidence/DG3/domain/round-7/hygiene.sh (includes the full product diff); node rv/dg3-api.mjs (inside with-stack.sh)` | `docs/delivery/test-evidence/DG3/domain/round-7/hygiene.sh` (+2) | ok |
| domain | DOM-R7-06-F-DG3-120-ui-still-holds | PASS | 0 | `node rv/dg3-ui-inherited.mjs (inside with-stack.sh)` | `docs/delivery/test-evidence/DG3/domain/round-7/dg3-ui-inherited.mjs` (+5) | ok |
| domain | DOM-R7-07-full-domain-api | PASS | 0 | `node rv/dg3-api.mjs (inside with-stack.sh)` | `docs/delivery/test-evidence/DG3/domain/round-7/dg3-api.mjs` (+2) | ok |
| domain | DOM-R7-11-run-disclosure | PASS | 0 | `bash docs/delivery/test-evidence/DG3/domain/round-7/full.sh` | `docs/delivery/test-evidence/DG3/domain/round-7/full.sh` (+4) | ok |
| domain | DOM-R7-12-environmental-residuals | PASS | 0 | `None` | `docs/delivery/test-evidence/DG3/domain/round-7/env.txt` | ok |
| code | SEC-R7-00-candidate | PASS | 0 | `sha256sum docs/delivery/assignments/DG3/round-7/code-security-reviewer.md; git rev-parse HEAD; git rev-parse --is-shallow-repository; node t` | `docs/delivery/test-evidence/DG3/code-security/round-7/candidate-id.log` (+2) | ok |
| code | SEC-R7-01-build | PASS | 0 | `pnpm install --offline --frozen-lockfile --store-dir $TMPDIR/pstore/v10; pnpm -r build; pnpm install --offline --frozen-lockfile` | `docs/delivery/test-evidence/DG3/code-security/round-7/install1.log` (+3) | ok |
| code | SEC-R7-02-typecheck | PASS | 0 | `pnpm -r typecheck` | `docs/delivery/test-evidence/DG3/code-security/round-7/typecheck.log` | ok |
| code | SEC-R7-03-lint | PASS | 0 | `pnpm lint` | `docs/delivery/test-evidence/DG3/code-security/round-7/lint.log` (+1) | ok |
| code | SEC-R7-04-openapi-lint | PASS | 0 | `pnpm openapi:lint` | `docs/delivery/test-evidence/DG3/code-security/round-7/openapi-lint.log` | ok |
| code | SEC-R7-05-no-cdn-and-secrets | PASS | 0 | `pnpm check:no-cdn; bash diff-scan.sh (D9)` | `docs/delivery/test-evidence/DG3/code-security/round-7/no-cdn.log` (+1) | ok |
| code | SEC-R7-06-format | PASS | 0 | `pnpm format:check` | `docs/delivery/test-evidence/DG3/code-security/round-7/format-check.log` | ok |
| code | SEC-R7-11-validate-historical-DG2 | PASS | 0 | `node tools/gates/validate.mjs --historical --stage DG2` | `docs/delivery/test-evidence/DG3/code-security/round-7/validate-historical-DG2.log` | ok |
| code | SEC-R7-12-validate-historical-DG1 | PASS | 0 | `node tools/gates/validate.mjs --historical --stage DG1` | `docs/delivery/test-evidence/DG3/code-security/round-7/validate-historical-DG1.log` | ok |
| code | SEC-R7-13-aud-sweep-and-integrity-probes | PASS | 0 | `bash checks-extra.sh` | `docs/delivery/test-evidence/DG3/code-security/round-7/probes-ABD-CSP-E-node22-lang-unset.log` (+3) | ok |
| code | SEC-R7-15-F-DG3-280-adr-sentence-and-row-count | PASS | 0 | `node probes/independent-row-lint.mjs $TMPDIR/rev probes/probes-table-runtime-dump.json` | `docs/delivery/test-evidence/DG3/code-security/round-7/independent-row-lint.log` (+4) | ok |
| code | SEC-R7-16-F-DG3-100-no-regression | PASS | 0 | `bash run-probes.sh; bash run-spellings-r7.sh; node round-6/probes/residual-probe-r6.mjs $TMPDIR/review-p3` | `docs/delivery/test-evidence/DG3/code-security/round-7/probe-verdicts-r6-vs-r7.log` (+10) | ok |
| code | SEC-R7-18-repair-diff-scope | PASS | 0 | `bash diff-scan.sh` | `docs/delivery/test-evidence/DG3/code-security/round-7/diff-scan.log` (+1) | ok |
| code | SEC-R7-19-p3-surface-no-regression | PASS | 0 | `bash surface-counts.sh; bash diff-scan.sh (L1, M1, C1, C2)` | `docs/delivery/test-evidence/DG3/code-security/round-7/p3-surface-counts.log` (+4) | ok |
| code | SEC-R7-21-environment-residuals | PASS | 0 | `bash env-residuals.sh` | `docs/delivery/test-evidence/DG3/code-security/round-7/env-residuals.log` (+1) | ok |
| qa | QA-R7-00-candidate | PASS | 0 | `git rev-parse HEAD; git merge-base --is-ancestor d3e6fe6 HEAD; git diff --name-only d3e6fe6..HEAD \| grep -v ^docs/delivery/; git rev-parse -` | `docs/delivery/test-evidence/DG3/qa/round-7/00-candidate.log` (+1) | ok |
| qa | QA-R7-00-install | PASS | 0 | `pnpm install --offline --frozen-lockfile --store-dir $TMPDIR/pnpm-store-root/v10` | `docs/delivery/test-evidence/DG3/qa/round-7/00-install.log` | ok |
| qa | QA-R7-01d-formatDecimal-unknown | PASS | 0 | `node $TMPDIR/qa/fd.mts (copy of scripts/fd.mts; imports packages/shared/src/value.ts)` | `docs/delivery/test-evidence/DG3/qa/round-7/01d-formatDecimal-unknown-probe.log` (+1) | ok |
| qa | QA-R7-05-formula-api-422 | PASS | 0 | `part of QA-R7-04 (dg3-qa-r7.spec.ts A9: A9-R4-invalid-formulas-422-not-internal, A9-R4-create-syntax-error-422, A9-R4-valid-formula-still-20` | `docs/delivery/test-evidence/DG3/qa/round-7/04-checks-summary.txt` (+2) | ok |
| qa | QA-R7-07-F180-probe | PASS | 0 | `part of QA-R7-04 (test F180)` | `docs/delivery/test-evidence/DG3/qa/round-7/04-f180-summary.txt` (+3) | ok |
| qa | QA-R7-07b-F180b-extended-layout-probe | PASS | 1 | `part of QA-R7-04 (test F180b)` | `docs/delivery/test-evidence/DG3/qa/round-7/04-f180-summary.txt` (+4) | ok |
| qa | QA-R7-09-hierarchy-tom-T05 | PASS | 0 | `part of QA-R7-04 (A1, A3, A4, A6-hierarchy)` | `docs/delivery/test-evidence/DG3/qa/round-7/04-requirement-trace.txt` (+1) | ok |
| qa | QA-R7-10-T06-prioritization | PASS | 0 | `part of QA-R7-04 (A5, U1) plus product p3-journeys.spec.ts` | `docs/delivery/test-evidence/DG3/qa/round-7/04-requirement-trace.txt` (+2) | ok |
| qa | QA-R7-11-roadmap | PASS | 0 | `part of QA-R7-04 (A7) plus product p3-prioritization-roadmap.spec.ts` | `docs/delivery/test-evidence/DG3/qa/round-7/04-requirement-trace.txt` (+1) | ok |
| qa | QA-R7-12-T08-dependencies | PASS | 0 | `part of QA-R7-04 (A8)` | `docs/delivery/test-evidence/DG3/qa/round-7/04-requirement-trace.txt` (+1) | ok |
| qa | QA-R7-13-business-case-T09 | PASS | 0 | `part of QA-R7-04 (A9)` | `docs/delivery/test-evidence/DG3/qa/round-7/04-requirement-trace.txt` (+1) | ok |
| qa | QA-R7-14-capacity-funding-selection | PASS | 0 | `part of QA-R7-04 (A6, A10)` | `docs/delivery/test-evidence/DG3/qa/round-7/04-requirement-trace.txt` (+1) | ok |
| qa | QA-R7-15-G4 | PASS | 0 | `part of QA-R7-04 (A10) plus product p3-g4-refusal.spec.ts and p3-journeys.spec.ts` | `docs/delivery/test-evidence/DG3/qa/round-7/04-requirement-trace.txt` (+1) | ok |
| qa | QA-R7-18-register-pipeline-historical | PASS | 0 | `node tools/gates/validate.mjs --register DG3; --pipeline; --historical --stage DG2; --historical --stage DG1` | `docs/delivery/test-evidence/DG3/qa/round-7/05-validate-register-DG3.log` (+3) | ok |
| qa | QA-R7-19-environmental-residuals | PASS | 0 | `see QA-R7-00-install, QA-R7-01..04` | `docs/delivery/test-evidence/DG3/qa/round-7/00-install.log` (+1) | ok |

### DG3 release-audit tests (gate record `tests[]`, 12)

| Test | Result | Evidence (first) |
|---|---|---|
| Complete-clone check and candidate recomputation (working tree, and a clean clone at d3e6fe62 before and after install/build) | PASS | `docs/delivery/test-evidence/DG3/audit/round-7/01-audit-checks.log` |
| Previous gates DG2 and DG1 historical validation, and register rules at DG3 | PASS | `docs/delivery/test-evidence/DG3/audit/round-7/01-audit-checks.log` |
| Unit tests on Node 22 and Node 24: pnpm test runs both Vitest invocations (1654/1654; unit-formula-nocodegen 259 passed, 2 skipped by design), reproduced by the | PASS | `docs/delivery/test-evidence/DG3/audit/round-7/04-unit-reproduction.log` |
| Integration on disposable PostgreSQL 16 in both locale settings (793/793; migrations 0001-0027; 270 contract operations) | PASS | `docs/delivery/test-evidence/DG3/code-security/round-7/integration-run1-lang-unset.log` |
| e2e EN+AR on the real stack in both locale settings (216 passed per run; every product spec passes; the 2 failures are qa's own F180b probe at 390 px + 200% tex | PASS | `docs/delivery/test-evidence/DG3/qa/round-7/04-e2e-unset.log` |
| Literal acceptance trace of all 32 DG3 requirements in EN and AR (qa), and domain probes of the P3 operating logic (API 139/139, UI 42/42) | PASS | `docs/delivery/test-evidence/DG3/qa/round-7/04-requirement-trace.txt` |
| F-DG3-280 verification (code-security, round 7) and F-DG3-100 no-regression (every probe verdict byte-identical to round 6) | PASS | `docs/delivery/reviews/DG3/round-7/code-security-reviewer.verifications.json` |
| Earlier closures still hold on this candidate: F-DG3-120 (API 33/33, UI EN/AR) and F-DG3-170/180 (badge layout 12/12 and 155/155; qa F180) | PASS | `docs/delivery/test-evidence/DG3/domain/round-7/dg3-api-extra.log` |
| Auditor provenance and findings check: three clean round-7 runs; 5/5 findings CLOSED_VERIFIED by non-owners with ancestor fixes and clean verifying runs; D-082/ | PASS | `docs/delivery/test-evidence/DG3/audit/round-7/02-provenance-findings-incidents.log` |
| Disclosure check: every path cited by the round-7 records and the round-2 domain record exists (282), and every non-zero exit, failed suite or timeout in the ci | PASS | `docs/delivery/test-evidence/DG3/audit/round-7/03-disclosure-grep.log` |
| ADR-0024 §6 claim spot-check, repair scope, and product-vs-engineering gate separation | PASS | `docs/delivery/test-evidence/DG3/audit/round-7/05-adr-0024-and-scope-spotcheck.log` |
| Environmental residuals on the offline/config surface: live registry (D-057), live CI (D-058), Keycloak (D-049) | PASS | `docs/delivery/reviews/DG3/round-7/code-security-reviewer.json` |

### DG3 tests that could not run, and disclosures (13)

| Source | Role | Record | Check | Result | Reason (excerpt) |
|---|---|---|---|---|---|
| approving round | domain-reviewer | `docs/delivery/reviews/DG3/round-7/domain-reviewer.json` | DOM-R7-02-typecheck-build-lint-test-contrast | PASS | probe rows #then and #fromAsync and the new 'excludes from the ESLint test only the named probe rows' test). unit-formula-nocodegen: 3 files, 259 passed and 2 skipped (261). The test 'ESLint refuses the round-5 handler forms (G1, G2, A1, A2), F1 and every lintable probe-table row in an engine source' passed in unit-node on both versions. Disclosures: (1) The 2 ski |
| approving round | code-security-reviewer | `docs/delivery/reviews/DG3/round-7/code-security-reviewer.json` | SEC-R7-07-unit-node22 | PASS | Exit 0. Both invocations ran: - invocation 1: 81 files, 1654 passed; - invocation 2: 3 files, 259 passed + 2 skipped. Round 6 had 1651 and 256. The +3 per invocation are the 2 new private-name probe rows and the exclusion-list test (p3-surface-counts.log: the only per-file difference is fuzz.test.ts, 108→111). Dis |
| approving round | code-security-reviewer | `docs/delivery/reviews/DG3/round-7/code-security-reviewer.json` | SEC-R7-08-unit-node24 | PASS | Exit 0. 1654 passed, then 259 passed + 2 skipped. The same disclosures apply as on Node 22: - the 2 by-design NOCODEGEN skips; - '×' only inside test names; - no FAIL, timeout or unhandled error. |
| approving round | code-security-reviewer | `docs/delivery/reviews/DG3/round-7/code-security-reviewer.json` | SEC-R7-09-integration-lang-unset | PASS | on, validated against the contract'; - migrate.test.ts 'applies every shipped migration, then reports up to date'; - the catalogue 0027 check. It has no ×, no skip and no FAIL. Disclosed: - the 'unhandled error … ECONNRESET' line is the BE17 db-econnreset fault-injection test's own diagnostic stdout, and that test passes; - the other 'error' matches are diagno |
| approving round | code-security-reviewer | `docs/delivery/reviews/DG3/round-7/code-security-reviewer.json` | SEC-R7-13-aud-sweep-and-integrity-probes | PASS | 90/90 passed in both settings (5 files), with exit 0, no ×, no skip and no unhandled error. git status is '' after cleanup. Probe A covers the 64 P3 mutating operations ('[probe-A] P3 mutating operations: 64'). Each gives 403 for an empty and for a plausible body, a |
| approving round | code-security-reviewer | `docs/delivery/reviews/DG3/round-7/code-security-reviewer.json` | SEC-R7-14-F-DG3-280-lint-test-mutations | PASS | import check: all six parts are config-valid and survive the lint test. - lint-ablation-full.log: the 'parseFloat ANCHOR-COUNT=3' line means that mutation was skipped (its text is not unique). It is informational only. Observation, not a finding. - Every L1-L7 part is pinned by some unit-node test. The exception is the computed ["then"] member part, which is redu |
| approving round | code-security-reviewer | `docs/delivery/reviews/DG3/round-7/code-security-reviewer.json` | SEC-R7-16-F-DG3-100-no-regression | PASS | g): 18, 12, 12, 10 and 36 lines. That includes: - G1, G2, A1, A2 and F1 refused by lint + scan; - W1, W2 and W4 refused by lint + scan; - all 18 round-2 forms 'BLOCKED BY BOTH'. Residual: A3 'PASSES ALL THREE LAYERS' (the stated §6 residual) and A4 'REFUSED BY: run-time', identical to round 6. Disclosed non-zero exit: run-spellings-r7 exits 1 with exactly 1 faili |
| approving round | code-security-reviewer | `docs/delivery/reviews/DG3/round-7/code-security-reviewer.json` | SEC-R7-21-environment-residuals | PASS | un against the fake IdP. The residuals that remain are the live registry (D-057), live CI (D-058) and a real Keycloak (D-049). They are environmental, and not BLOCKED. |
| approving round | qa-verifier | `docs/delivery/reviews/DG3/round-7/qa-verifier.json` | QA-R7-01a-repair-lintproof-mutation-probe | PASS | x' (the round-5 handler form, before the probe-table loop). P4 fails at 'const { ["then"]: t } = p; (then)'. The control passes before and after (1 passed, 110 skipped by -t), and git status is clean after each restore. Row count: 'QA-R7 PROBES 101 linted 99 excluded 2 [const s = "unclosed;, function f() {]'. The ADR-0024 §6 sentence and p3-work-split §9 item 29 ma |
| approving round | qa-verifier | `docs/delivery/reviews/DG3/round-7/qa-verifier.json` | QA-R7-01c-runtime-mutation-probe | PASS | ses 280/280 for each mutation (277 in round 6, plus the repair's 3 new tests). After each restore git status is clean, and the nocodegen control passes 259 + 2 skipped (EXIT 0). |
| approving round | qa-verifier | `docs/delivery/reviews/DG3/round-7/qa-verifier.json` | QA-R7-02-unit | PASS | All 4 configurations EXIT 0 on the first run: invocation 1 with 81 files and 1654 passed; invocation 2 with 3 files and 259 passed + 2 skipped. Versus round 6 (1651; 256 + 2 skipped) the only difference is fuzz.test.ts, from 108 to 111 tests in both projects: the 2 new private-name probe rows and the new LINT_EXCLUDED test. The 2 skips are |
| approving round | qa-verifier | `docs/delivery/reviews/DG3/round-7/qa-verifier.json` | QA-R7-04-e2e-full | PASS | Each run: EXIT 1, with 216 passed, 2 failed, 0 skipped and 0 flaky (15.6 and 15.3 min). The 2 failures are my F180b layout probe in chromium-en and chromium-ar, at the single assertion 'expect(bad).toEqual([])' (line 1813); see QA-R7-07b. Every product s |
| approving round | qa-verifier | `docs/delivery/reviews/DG3/round-7/qa-verifier.json` | QA-R7-19-environmental-residuals | PASS | (REQ-DLV-042 AC-1, D-057): not reachable here; the offline frozen-lockfile install from the store passes (QA-R7-00-install). Live CI (REQ-DLV-025 A24, D-058): not run here; the same commands ran locally (QA-R7-01 to 04). Keycloak (D-049): not available; the e2e stack uses AUTH_MODE=dev, and the integration OIDC tests use the in-process test IdP. These are residual |

## DG4 (APPROVED)

- Gate record: `docs/delivery/gates/DG4.json`; candidate `sha256:f38274cb6d50c49857a89876cec1bc4713f69ef84b29a6f5b9af10061317ccc6`; source `e70ac02f63cd1f42487cfa4dae73f68e933da015`.
- domain-reviewer: `docs/delivery/reviews/DG4/round-10/domain-reviewer.json`, verdict PASS, candidate = gate.
- code-security-reviewer: `docs/delivery/reviews/DG4/round-10/code-security-reviewer.json`, verdict PASS, candidate = gate.
- qa-verifier: `docs/delivery/reviews/DG4/round-10/qa-verifier.json`, verdict PASS, candidate = gate.
- Release audit: `docs/delivery/reviews/DG4/round-10/release-auditor.json`.

### DG4 unit (8)

| Role | Check | Result | Exit | Command (truncated) | Evidence (first) | ev |
|---|---|---|---|---|---|---|
| domain | DOM-R10-02-F-DG4-160-status-hint | PASS | 0 | `Source and code reading in the clone at e70ac02; bash docs/delivery/test-evidence/DG4/domain/round-10/with-stack.sh node docs/delivery/test-` | `docs/delivery/test-evidence/DG4/domain/round-10/dom-r10-ui.mjs` (+10) | ok |
| domain | DOM-R10-05-BE-R7-fingerprint-intent | PASS | 0 | `bash be-r7.sh; targeted-tests.sh section [2] (tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration tests/q` | `docs/delivery/test-evidence/DG4/domain/round-10/be-r7.sh` (+7) | ok |
| code | SEC-R10-02-fe-r11-diff-text-and-tests-only | PASS | 0 | `see 03-diff-readers.log, 04-claims-and-delivery-readers.log, 05-sweep-spotcheck.log (grep -rn <key> apps/web/src apps/web/e2e; node flatten/` | `docs/delivery/test-evidence/DG4/code-security/round-10/02-product-diff.patch` (+3) | ok |
| code | SEC-R10-03-web-unit-changed-files | PASS | 0 | `cd apps/web && npx vitest run src/app/app.test.tsx src/pages/transformations/transformations.test.tsx` | `docs/delivery/test-evidence/DG4/code-security/round-10/web-unit-changed.log` | ok |
| code | SEC-R10-15-unit-node22-node24-carried-forward | PASS | 0 | `` | `docs/delivery/test-evidence/DG4/code-security/round-7/unit-node22.log` (+4) | ok |
| qa | QA-R10-02-unit-envelope | PASS | 0 | `bash docs/delivery/test-evidence/DG4/qa/round-10/scripts/run-unit-envelope.sh -r1; ... -r2 (each run: [env -u LANG -u LC_ALL -u LC_CTYPE \| e` | `docs/delivery/test-evidence/DG4/qa/round-10/02-unit-envelope-summary.txt` (+15) | ok |
| qa | QA-R10-03-fe-r11-unit-tests-assert-clauses | PASS | 0 | `git diff f2ae717..e70ac02 -- apps/web/src; npx vitest run --project unit-web --reporter=verbose apps/web/src/app/app.test.tsx apps/web/src/p` | `docs/delivery/test-evidence/DG4/qa/round-10/02e-unit-fe-r11-targeted-and-mutant.log` (+3) | ok |
| qa | QA-R10-04-be-r7-a08-fingerprint | PASS | 0 | `git diff f2ae717..e70ac02 -- tests/qa; CLONE=$TMPDIR/review-dg4r10-mut bash docs/delivery/test-evidence/DG4/qa/round-10/scripts/a08-mutants.` | `docs/delivery/test-evidence/DG4/qa/round-10/06-a08-mutants.log` (+7) | ok |

### DG4 integration (9)

| Role | Check | Result | Exit | Command (truncated) | Evidence (first) | ev |
|---|---|---|---|---|---|---|
| domain | DOM-R10-05-BE-R7-fingerprint-intent | PASS | 0 | `bash be-r7.sh; targeted-tests.sh section [2] (tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration tests/q` | `docs/delivery/test-evidence/DG4/domain/round-10/be-r7.sh` (+7) | ok |
| domain | DOM-R10-11-carry-forward-operating-logic-and-qa-observations | PASS | 0 | `not run this round; round 7: integration-full-run-1.log (with my zz-domain-r7 probe) and dom-api` | `docs/delivery/reviews/DG4/round-9/domain-reviewer.json` (+3) | ok |
| code | SEC-R10-04-be-r7-fingerprint-soundness | PASS | 0 | `node (patch DELIVERY -> $SEC_DELIVERY and insert secMutate() before the final equality into zz-sec-r10-mutant.test.ts); SEC_MUTANT={none,rev` | `docs/delivery/test-evidence/DG4/code-security/round-10/02-product-diff.patch` (+6) | ok |
| code | SEC-R10-05-a08-file-rerun | PASS | 0 | `QA_PG_PORT=26310 MTH_PORT_POOL=26300-26399 tests/qa/support/with-pg.sh npx vitest run --project integration tests/qa/integration/a08-gate-co` | `docs/delivery/test-evidence/DG4/code-security/round-10/a08-integration.log` (+2) | ok |
| code | SEC-R10-16-integration-twice-carried-forward | PASS | 0 | `` | `docs/delivery/test-evidence/DG4/code-security/round-7/integration-run1-lang-unset.log` (+2) | ok |
| qa | QA-R10-04-be-r7-a08-fingerprint | PASS | 0 | `git diff f2ae717..e70ac02 -- tests/qa; CLONE=$TMPDIR/review-dg4r10-mut bash docs/delivery/test-evidence/DG4/qa/round-10/scripts/a08-mutants.` | `docs/delivery/test-evidence/DG4/qa/round-10/06-a08-mutants.log` (+7) | ok |
| qa | QA-R10-05-integration-full | PASS | 0 | `bash docs/delivery/test-evidence/DG4/qa/round-10/scripts/run-integration.sh run1 26510 (= QA_PG_PORT=26510 MTH_PORT_POOL=26500-26699 tests/q` | `docs/delivery/test-evidence/DG4/qa/round-10/04-integration-run1.log` (+4) | ok |
| qa | QA-R10-06-tests-qa-and-dlv036 | PASS | 0 | `QA_PG_PORT=26540 tests/qa/support/with-pg.sh npx vitest run --project integration --reporter=verbose tests/qa; CLONE=... scripts/run-e2e-roo` | `docs/delivery/test-evidence/DG4/qa/round-10/04b-integration-tests-qa-only.log` (+6) | ok |
| qa | QA-R10-12-carry-forward-full-e2e-aud-390-200 | PASS | 0 | `Not re-run this round. Round 7: scripts/run-e2e.sh <unset\|cutf8> ... full; scripts/run-probes.sh; scripts/run-integration.sh run2` | `docs/delivery/test-evidence/DG4/qa/round-7/04-e2e-full-unset-summary.txt` (+8) | ok |

### DG4 e2e (5)

| Role | Check | Result | Exit | Command (truncated) | Evidence (first) | ev |
|---|---|---|---|---|---|---|
| code | SEC-R10-02-fe-r11-diff-text-and-tests-only | PASS | 0 | `see 03-diff-readers.log, 04-claims-and-delivery-readers.log, 05-sweep-spotcheck.log (grep -rn <key> apps/web/src apps/web/e2e; node flatten/` | `docs/delivery/test-evidence/DG4/code-security/round-10/02-product-diff.patch` (+3) | ok |
| qa | QA-R10-06-tests-qa-and-dlv036 | PASS | 0 | `QA_PG_PORT=26540 tests/qa/support/with-pg.sh npx vitest run --project integration --reporter=verbose tests/qa; CLONE=... scripts/run-e2e-roo` | `docs/delivery/test-evidence/DG4/qa/round-10/04b-integration-tests-qa-only.log` (+6) | ok |
| qa | QA-R10-07-e2e-changed-specs-axe | PASS | 0 | `CLONE=$TMPDIR/review-dg4r10-mut bash docs/delivery/test-evidence/DG4/qa/round-10/scripts/run-e2e.sh <unset\|cutf8> 26530 26531 changed apps/w` | `docs/delivery/test-evidence/DG4/qa/round-10/05-e2e-changed-unset.log` (+12) | ok |
| qa | QA-R10-08-f-dg4-160-reproduction-and-probe | PASS | 0 | `grep statusHint / stale phrases / render site / pin / route (09-f-dg4-160-reproduction.log); cp docs/delivery/test-evidence/DG4/qa/tests/rou` | `docs/delivery/test-evidence/DG4/qa/round-10/09-f-dg4-160-reproduction.log` (+12) | ok |
| qa | QA-R10-12-carry-forward-full-e2e-aud-390-200 | PASS | 0 | `Not re-run this round. Round 7: scripts/run-e2e.sh <unset\|cutf8> ... full; scripts/run-probes.sh; scripts/run-integration.sh run2` | `docs/delivery/test-evidence/DG4/qa/round-7/04-e2e-full-unset-summary.txt` (+8) | ok |

### DG4 visual (5)

| Role | Check | Result | Exit | Command (truncated) | Evidence (first) | ev |
|---|---|---|---|---|---|---|
| domain | DOM-R10-02-F-DG4-160-status-hint | PASS | 0 | `Source and code reading in the clone at e70ac02; bash docs/delivery/test-evidence/DG4/domain/round-10/with-stack.sh node docs/delivery/test-` | `docs/delivery/test-evidence/DG4/domain/round-10/dom-r10-ui.mjs` (+10) | ok |
| qa | QA-R10-06-tests-qa-and-dlv036 | PASS | 0 | `QA_PG_PORT=26540 tests/qa/support/with-pg.sh npx vitest run --project integration --reporter=verbose tests/qa; CLONE=... scripts/run-e2e-roo` | `docs/delivery/test-evidence/DG4/qa/round-10/04b-integration-tests-qa-only.log` (+6) | ok |
| qa | QA-R10-07-e2e-changed-specs-axe | PASS | 0 | `CLONE=$TMPDIR/review-dg4r10-mut bash docs/delivery/test-evidence/DG4/qa/round-10/scripts/run-e2e.sh <unset\|cutf8> 26530 26531 changed apps/w` | `docs/delivery/test-evidence/DG4/qa/round-10/05-e2e-changed-unset.log` (+12) | ok |
| qa | QA-R10-08-f-dg4-160-reproduction-and-probe | PASS | 0 | `grep statusHint / stale phrases / render site / pin / route (09-f-dg4-160-reproduction.log); cp docs/delivery/test-evidence/DG4/qa/tests/rou` | `docs/delivery/test-evidence/DG4/qa/round-10/09-f-dg4-160-reproduction.log` (+12) | ok |
| qa | QA-R10-10-static | PASS | 0 | `bash docs/delivery/test-evidence/DG4/qa/round-10/scripts/run-static.sh (pnpm -r build; pnpm -r typecheck; pnpm lint; pnpm openapi:lint; pnpm` | `docs/delivery/test-evidence/DG4/qa/round-10/01-pnpm-r-build.log` (+7) | ok |

### DG4 other (31)

| Role | Check | Result | Exit | Command (truncated) | Evidence (first) | ev |
|---|---|---|---|---|---|---|
| domain | DOM-R10-00-candidate | PASS | 0 | `bash docs/delivery/test-evidence/DG4/domain/round-10/candidate-and-diff.sh (git rev-parse HEAD; node tools/gates/candidate.mjs --stage DG4, ` | `docs/delivery/test-evidence/DG4/domain/round-10/candidate-and-diff.sh` (+1) | ok |
| domain | DOM-R10-01-product-diff-nine-files | PASS | 0 | `git diff --stat / --name-only / --numstat f2ae7170630456a772e1ceac90ab6d96b68e3f5c..e70ac02f63cd1f42487cfa4dae73f68e933da015 -- . ':!docs/de` | `docs/delivery/test-evidence/DG4/domain/round-10/candidate-and-diff.log` | ok |
| domain | DOM-R10-03-sweep-corrected-nav-strings | PASS | 0 | `Code reading (app/nav.ts NAV_AREAS and NAV_SUBPAGES, pages/AreaPages.tsx, reporting/dashboards/*.ts readableTransformations); bash sweep-reg` | `docs/delivery/test-evidence/DG4/domain/round-10/sweep-register.sh` (+16) | ok |
| domain | DOM-R10-04-sweep-kept-rows | PASS | 0 | `bash docs/delivery/test-evidence/DG4/domain/round-10/sweep-kept.sh; bash docs/delivery/test-evidence/DG4/domain/round-10/sweep-register.sh` | `docs/delivery/test-evidence/DG4/domain/round-10/sweep-kept.sh` (+4) | ok |
| domain | DOM-R10-06-decisions-D137-D139 | PASS | 0 | `Reading docs/delivery/decisions.md (D-137..D-139), docs/delivery/reviews/DG4/round-9/release-auditor.{json,findings.json}, both handbacks; c` | `docs/delivery/decisions.md` (+3) | ok |
| domain | DOM-R10-07-validators | PASS | 0 | `bash docs/delivery/test-evidence/DG4/domain/round-10/validators.sh; bash docs/delivery/test-evidence/DG4/domain/round-10/validators-pipeline` | `docs/delivery/test-evidence/DG4/domain/round-10/validators.sh` (+3) | ok |
| domain | DOM-R10-08-static-checks-and-hygiene | PASS | 0 | `bash docs/delivery/test-evidence/DG4/domain/round-10/static.sh (pnpm -r typecheck; pnpm lint; npx prettier --check .; pnpm openapi:lint; nod` | `docs/delivery/test-evidence/DG4/domain/round-10/static.sh` (+10) | ok |
| domain | DOM-R10-09-carry-forward-source-templates-registers | PASS | 0 | `not run this round; round 7: dom-api.mjs via run-probes.sh; round 9: source-seed-static.sh` | `docs/delivery/reviews/DG4/round-9/domain-reviewer.json` (+3) | ok |
| domain | DOM-R10-10-carry-forward-ui-and-kpi-value-semantics | PASS | 0 | `not run this round; round 7: dom-ui.mjs, dom-r5b.mjs, dom-gross4.mjs, dom-pct.mjs, dom-kpiunit.mjs; round 9: targeted-tests.sh` | `docs/delivery/reviews/DG4/round-9/domain-reviewer.json` (+7) | ok |
| domain | DOM-R10-12-environmental-residuals | PASS | 0 | `` | `docs/delivery/test-evidence/DG4/domain/round-10/no-cdn.log` (+1) | ok |
| code | SEC-R10-00-candidate-identity | PASS | 0 | `git clone /home/user/My-owns $TMPDIR/review-r10 && git checkout 01a801e && git rev-parse --is-shallow-repository && node tools/gates/candida` | `docs/delivery/test-evidence/DG4/code-security/round-10/01-candidate-identity.log` (+2) | ok |
| code | SEC-R10-01-product-diff-is-nine-files | PASS | 0 | `git diff --stat f2ae7170630456a772e1ceac90ab6d96b68e3f5c..e70ac02f63cd1f42487cfa4dae73f68e933da015 -- . ':!docs/delivery'; git diff --quiet ` | `docs/delivery/test-evidence/DG4/code-security/round-10/01-candidate-identity.log` (+2) | ok |
| code | SEC-R10-06-no-other-wholesale-delivery-readers | PASS | 0 | `grep -rlnE 'docs/delivery\|\.\./delivery/' tests apps packages --include=*.ts --include=*.tsx --include=*.mjs \| xargs grep -nE 'docs/delivery` | `docs/delivery/test-evidence/DG4/code-security/round-10/04-claims-and-delivery-readers.log` | ok |
| code | SEC-R10-07-judge-D137-D138-D139 | PASS | 0 | `` | `docs/delivery/test-evidence/DG4/code-security/round-10/01-candidate-identity.log` (+4) | ok |
| code | SEC-R10-08-install-build | PASS | 0 | `pnpm install --offline --frozen-lockfile --store-dir $TMPDIR/pstore/v10; pnpm -r build; pnpm install --offline --frozen-lockfile --store-dir` | `docs/delivery/test-evidence/DG4/code-security/round-10/install1.log` (+3) | ok |
| code | SEC-R10-09-typecheck | PASS | 0 | `pnpm -r typecheck` | `docs/delivery/test-evidence/DG4/code-security/round-10/typecheck.log` | ok |
| code | SEC-R10-10-lint | PASS | 0 | `pnpm lint` | `docs/delivery/test-evidence/DG4/code-security/round-10/lint.log` | ok |
| code | SEC-R10-11-format | PASS | 0 | `pnpm format:check` | `docs/delivery/test-evidence/DG4/code-security/round-10/format-check.log` | ok |
| code | SEC-R10-12-openapi-lint | PASS | 0 | `pnpm openapi:lint` | `docs/delivery/test-evidence/DG4/code-security/round-10/openapi-lint.log` | ok |
| code | SEC-R10-13-no-cdn | PASS | 0 | `pnpm check:no-cdn` | `docs/delivery/test-evidence/DG4/code-security/round-10/no-cdn.log` | ok |
| code | SEC-R10-14-validators | PASS | 0 | `node tools/gates/validate.mjs --historical --stage DG3; --historical --stage DG2; --historical --stage DG1; --register DG4; --pipeline` | `docs/delivery/test-evidence/DG4/code-security/round-10/validate-historical-DG3.log` (+5) | ok |
| code | SEC-R10-17-authorization-scope-approvals-carried-forward | PASS | 0 | `` | `docs/delivery/test-evidence/DG4/code-security/round-7/rerun-sec-dg4-r2-sweep-node22-lang-unset.log` (+6) | ok |
| code | SEC-R10-18-integrity-graph-migrations-carried-forward | PASS | 0 | `` | `docs/delivery/test-evidence/DG4/code-security/round-7/commit-time-scan.log` (+5) | ok |
| code | SEC-R10-19-requirement-acceptance-carried-forward | PASS | 0 | `` | `docs/delivery/test-evidence/DG4/code-security/round-7/requirement-acceptance.log` (+2) | ok |
| code | SEC-R10-20-environment-residuals | PASS | 0 | `` | `docs/delivery/test-evidence/DG4/code-security/round-10/install2.log` (+1) | ok |
| code | SEC-R10-21-evidence-honesty-log-scan | PASS | 0 | `grep -iE 'error\|warn\|fail\|skip\|exit_status' docs/delivery/test-evidence/DG4/code-security/round-10/*.log` | `docs/delivery/test-evidence/DG4/code-security/round-10/summary.txt` (+3) | ok |
| qa | QA-R10-00-candidate | PASS | 0 | `git clone /home/user/My-owns $TMPDIR/review-dg4r10 && git checkout 01a801e && git rev-parse --is-shallow-repository && node tools/gates/cand` | `docs/delivery/test-evidence/DG4/qa/round-10/00-candidate.log` (+2) | ok |
| qa | QA-R10-01-diff-nine-files | PASS | 0 | `git diff --stat\|--name-status f2ae7170630456a772e1ceac90ab6d96b68e3f5c..e70ac02f63cd1f42487cfa4dae73f68e933da015 -- . ':!docs/delivery'; pyt` | `docs/delivery/test-evidence/DG4/qa/round-10/01-diff.log` (+2) | ok |
| qa | QA-R10-09-d137-d138-d139-judgement | PASS | 0 | `grep -rniE '<phrases>' apps/web/src/i18n; grep submission_enabled packages/db/migrations; grep gate_definition writes apps/api/src; grep lat` | `docs/delivery/test-evidence/DG4/qa/round-10/03-sweep.log` (+6) | ok |
| qa | QA-R10-11-validate-and-register | PASS | 0 | `node tools/gates/validate.mjs --historical --stage DG3 \| --historical --stage DG2 \| --historical --stage DG1 \| --register DG4 \| --pipeline; ` | `docs/delivery/test-evidence/DG4/qa/round-10/08-validate-historical-stage-DG3.log` (+8) | ok |
| qa | QA-R10-13-environmental-residuals | PASS | 0 | `pnpm check:no-cdn; pnpm -r build; node tools/gates/validate.mjs --pipeline` | `docs/delivery/test-evidence/DG4/qa/round-10/01-pnpm-check-no-cdn.log` (+2) | ok |

### DG4 release-audit tests (gate record `tests[]`, 13)

| Test | Result | Evidence (first) |
|---|---|---|
| Complete-clone check and candidate recomputation (clone --ref e70ac02, clone working tree at HEAD, repository working tree); post-freeze diff meta-only; decisio | PASS | `docs/delivery/test-evidence/DG4/audit/round-10/01-clone-identity-validators.log` |
| Previous gate DG3 and gates DG2, DG1 historical; DG4 register rules | PASS | `docs/delivery/test-evidence/DG4/audit/round-10/01-clone-identity-validators.log` |
| Round-10 specialist provenance and independence (three distinct, successful, sandboxed runs); D-082 across all DG4 review and audit runs (rounds 1-10) | PASS | `docs/delivery/test-evidence/DG4/audit/round-10/02-provenance.log` |
| Three round-10 PASS verdicts on f38274cb with no BLOCKED check; round-10 scope (the 9-file diff re-run, the rest carried forward and labelled) adequate | PASS | `docs/delivery/reviews/DG4/round-10/domain-reviewer.json` |
| 25 DG4 findings: 23 CLOSED_VERIFIED by non-owners with ancestor full fix revisions; F-DG4-160 verified CLOSED by its reporter (release-auditor); F-DG4-148 ACCEP | PASS | `docs/delivery/test-evidence/DG4/audit/round-10/03-findings.log` |
| BE-R7: narrowed A08 G6 delivery fingerprint keeps REQ-S04-008's intent (same set as g5-g6, guards kept, no product writer to docs/delivery); a08 31/31; recordin | PASS | `docs/delivery/test-evidence/DG4/audit/round-10/10-a08-integration.log` |
| pnpm test inside the load envelope, auditor's own run (Node 24, locale unset) and qa's r2 series recomputed | PASS | `docs/delivery/test-evidence/DG4/audit/round-10/07-unit-summary.txt` |
| D-136 history rewrite, write-once and frozen_at (rounds 1-10) | PASS | `docs/delivery/test-evidence/DG4/audit/round-10/04-d136-writeonce-frozenat.log` |
| Incidents: salvages kept with completing runs, killed review runs re-run, D-124 repairs present, product diff since round 9 limited to FE-R11/BE-R7 | PASS | `docs/delivery/test-evidence/DG4/audit/round-10/05-incidents-salvage.log` |
| Decisions D-088 to D-139 recorded with rationale (D-088 to D-136 unchanged since round 9; D-137 to D-139 judged) | PASS | `docs/delivery/test-evidence/DG4/audit/round-10/11-decisions-D088-D139.log` |
| Evidence honesty: all 220 cited paths exist; every round-10 log hit disclosed and explained | PASS | `docs/delivery/test-evidence/DG4/audit/round-10/08-evidence-honesty-scan.log` |
| Product gates G1-G6 separate from engineering gates DG0-DG7; no certification or official claims; G5/G6 decisions in the evidence synthetic | PASS | `docs/delivery/test-evidence/DG4/audit/round-10/12-product-vs-engineering-gates.log` |
| Stage validation of DG4: only the three problems that stem from this in-flight audit run (its meta.json, its listing in review_rounds, the import of its F-DG4-1 | PASS | `docs/delivery/test-evidence/DG4/audit/round-10/14-validate-stage-DG4.log` |

### DG4 tests that could not run, and disclosures (11)

| Source | Role | Record | Check | Result | Reason (excerpt) |
|---|---|---|---|---|---|
| approving round | domain-reviewer | `docs/delivery/reviews/DG4/round-10/domain-reviewer.json` | DOM-R10-05-BE-R7-fingerprint-intent | PASS | restored after each mutant, with 0 tracked changes. Disclosed: my first mutant attempt (targeted-tests.sh section [3]) used -t to select only the G6 test. That skipped the earlier tests of the describe that take the transformation through G1-G5, so the G6 test failed on its precondition (422 gate.out_of_sequence), not on the fingerprint. All three of those runs exi |
| approving round | domain-reviewer | `docs/delivery/reviews/DG4/round-10/domain-reviewer.json` | DOM-R10-06-decisions-D137-D139 | PASS | did not re-run the pre-freeze integration or e2e suites (load envelope; qa runs them). My a08 and unit runs are consistent with them. The round-9 audit's other BLOCKED check (AUD-R9-14, validate --stage DG4) is the auditor's own BLOCKED-decision effect and is outside my scope. |
| approving round | code-security-reviewer | `docs/delivery/reviews/DG4/round-10/code-security-reviewer.json` | SEC-R10-03-web-unit-changed-files | PASS | 2 files, 49/49 tests pass, exit 0, duration 21.8 s. The log has no failed, skipped or error lines. |
| approving round | code-security-reviewer | `docs/delivery/reviews/DG4/round-10/code-security-reviewer.json` | SEC-R10-05-a08-file-rerun | PASS | .0 MB at HEAD. It grows only with reviews/ and the record files, a few hundred KB per round, so it is bounded far below the old 345 MB. The log has no failed, skipped, hook-timeout or error lines. |
| approving round | code-security-reviewer | `docs/delivery/reviews/DG4/round-10/code-security-reviewer.json` | SEC-R10-07-judge-D137-D138-D139 | PASS | out 342 MB, read twice) is consistent with the old code in the diff. The decision (narrow to DELIVERY_RECORDS, keep every assertion, no timeout raised, nothing skipped) is what the diff does. The falsifier 'the narrowed fingerprint misses a gate record that a product G6 approval could change' does not hold: gates, stages, findings, reviews, decisions and the regist |
| approving round | code-security-reviewer | `docs/delivery/reviews/DG4/round-10/code-security-reviewer.json` | SEC-R10-15-unit-node22-node24-carried-forward | PASS | round, by design (load envelope). The changed web unit files were re-run instead: 49/49 (SEC-R10-03). Round-7 results: - Node 24: exit 0 (1589 + 1347 + 259, 2 skipped by design). - Node 22 harness run: exit 1, with 2 unit-web failures: raid.test.tsx 'action register' en and ar, a 5 s findByRole wait under load 23-27. This is the F-DG4-148 class, ACCEPTED_OBSERVATI |
| approving round | code-security-reviewer | `docs/delivery/reviews/DG4/round-10/code-security-reviewer.json` | SEC-R10-16-integration-twice-carried-forward | PASS | ound, by design. The API, worker, db and migrations are byte-identical (SEC-R10-01). In round 7, both runs passed 209 files, 1984/1984, exit 0, with no failed, skipped or hook-timeout lines. Disclosed: each run has one 'unhandled error … ECONNRESET' line. It comes from the passing BE17 db-econnreset test, which injects resets on purpose. This round's a08 rerun ap |
| approving round | code-security-reviewer | `docs/delivery/reviews/DG4/round-10/code-security-reviewer.json` | SEC-R10-21-evidence-honesty-log-scan | PASS | - An initial pnpm install against the shared store failed with EROFS, before the harness ran and outside the logs (SEC-R10-08). There are no hook timeouts, no skipped tests and no e2e runs this round, by design. |
| approving round | qa-verifier | `docs/delivery/reviews/DG4/round-10/qa-verifier.json` | QA-R10-02-unit-envelope | PASS | de24-C (5.12-6.69). Every one of the 8 runs reports unit-node 84 files / 1589 passed, unit-web 69 files / 1358 passed and unit-formula-nocodegen 259 passed + 2 skipped. The 2 skips are by design (it.skipIf(NOCODEGEN) in fuzz.test.ts). The strict scan finds 0 x/FAIL lines, 0 'timed out', 0 failed summaries and 0 top-level errors in all 8 logs. The coarse 'fail/timeo |
| approving round | qa-verifier | `docs/delivery/reviews/DG4/round-10/qa-verifier.json` | QA-R10-04-be-r7-a08-fingerprint | PASS | Run this round. The diff narrows deliveryFingerprint to DELIVERY_RECORDS, identical to g5-g6.test.ts:302-309. A missing entry is recorded as 'missing', never skipped. Lines 827-830 still assert arrayContaining(['stages.json','findings.json','requirements.csv']) and some /^gates\/DG\d\.json$/, and line 848 asserts that the fingerprint is equal after the decision a |
| approving round | qa-verifier | `docs/delivery/reviews/DG4/round-10/qa-verifier.json` | QA-R10-12-carry-forward-full-e2e-aud-390-200 | PASS | d-7 evidence on identical code: integration run 2 had 209 files / 1984 tests, EXIT 0. The full e2e unset run counted 364 tests: 349 passed, 5 failed and 10 did not run, EXIT 1. All 5 failures are 30 s timeouts at load 9-30, and the 10 are their serial followers. The C.UTF-8 re-run counted 364: 360 passed and 1 failed (p2 'Define -> G2' en, 32.1 s timeout), with 3 n |

## DG5 (APPROVED)

- Gate record: `docs/delivery/gates/DG5.json`; candidate `sha256:55a411ae9f4e87473478988f3d9909752a934a547ba40acc1479f2b2bc3a24ce`; source `660f40c7d141b6fb73c145e0ee7a053ceb5905de`.
- domain-reviewer: `docs/delivery/reviews/DG5/round-3/domain-reviewer.json`, verdict PASS, candidate = gate.
- code-security-reviewer: `docs/delivery/reviews/DG5/round-2/code-security-reviewer.json`, verdict PASS, candidate = gate.
- qa-verifier: `docs/delivery/reviews/DG5/round-2/qa-verifier.json`, verdict PASS, candidate = gate.
- Release audit: `docs/delivery/reviews/DG5/round-5/release-auditor.json`.

### DG5 unit (5)

| Role | Check | Result | Exit | Command (truncated) | Evidence (first) | ev |
|---|---|---|---|---|---|---|
| code | SEC-R2-09-unit-node22 | PASS | 0 | `pnpm test; then npx vitest run --project unit-node` | `docs/delivery/test-evidence/DG5/code-security/round-2/20-unit-node22.log` (+2) | ok |
| code | SEC-R2-10-unit-node24 | PASS | 0 | `pnpm test` | `docs/delivery/test-evidence/DG5/code-security/round-2/21-unit-node24.log` | ok |
| qa | QA-R2-02-unit | PASS | 0 | `env -u LC_CTYPE -u LANG -u LC_ALL pnpm test; LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test (PATH with /opt/node22/bin, then /opt/nvm/versions/node/v` | `docs/delivery/test-evidence/DG5/qa/round-2/02-unit-node22-unset.log` (+5) | ok |
| qa | QA-R2-04-tests-qa-and-dlv037 | PASS | 0 | `QA_PG_PORT=26670 QA_A15_DUMP=$TMPDIR/a15dump tests/qa/support/with-pg.sh npx vitest run --project integration tests/qa/integration --reporte` | `docs/delivery/test-evidence/DG5/qa/round-2/04b-integration-tests-qa-only.log` (+2) | ok |
| qa | QA-R2-05-dlv037-sample-inspection | PASS | 0 | `cp …/tests/round-2/unit/zz-qa-dg5r2-inspect-samples.test.ts tests/qa/unit/ && QA_A15_DUMP=$TMPDIR/a15dump npx vitest run --project unit-node` | `docs/delivery/test-evidence/DG5/qa/round-2/11-inspect-samples.log` (+7) | ok |

### DG5 integration (9)

| Role | Check | Result | Exit | Command (truncated) | Evidence (first) | ev |
|---|---|---|---|---|---|---|
| domain | DOM-R3-04-requirements-from-round-2-same-candidate | PASS | 0 | `Round-2 commands (cited, not re-run): targeted-integration.sh, targeted-integration-2.sh, root-e2e.sh, text-scans.sh, run-probe.sh with dom-` | `docs/delivery/test-evidence/DG5/domain/round-2/candidate-verify.log` (+16) | ok |
| code | SEC-R2-11-integration-lang-unset | PASS | 0 | `QA_PG_PORT=26510 tests/qa/support/with-pg.sh pnpm test:integration` | `docs/delivery/test-evidence/DG5/code-security/round-2/30-integration-lang-unset.log` | ok |
| code | SEC-R2-12-integration-lang-c-utf8 | PASS | 0 | `LANG=C.UTF-8 QA_PG_PORT=26530 tests/qa/support/with-pg.sh pnpm test:integration` | `docs/delivery/test-evidence/DG5/code-security/round-2/31-integration-lang-c-utf8.log` | ok |
| code | SEC-R2-13-F-DG5-100-verification | PASS | 0 | `checks.sh ooxml2 (QA_PG_PORT=26572); checks.sh ooxml2-render; the 46c mutants (an inline script; its log records each step); mutants-e2e.sh ` | `docs/delivery/test-evidence/DG5/code-security/round-2/46-ooxml-control-char-e2e.log` (+8) | ok |
| code | SEC-R2-14-p5-role-sweep-and-db-probes | PASS | 0 | `QA_PG_PORT=26550 tests/qa/support/with-pg.sh npx vitest run --project integration tests/qa/integration/zz-sec-rg2-p5-role-sweep.test.ts` | `docs/delivery/test-evidence/DG5/code-security/round-2/45-p5-role-sweep.log` (+1) | ok |
| qa | QA-R2-03-integration-twice | PASS | 0 | `QA_PG_PORT=26601 tests/qa/support/with-pg.sh pnpm test:integration (locale unset); QA_PG_PORT=26602 LANG=LC_ALL=C.UTF-8 tests/qa/support/wit` | `docs/delivery/test-evidence/DG5/qa/round-2/04-integration-run1.log` (+3) | ok |
| qa | QA-R2-04-tests-qa-and-dlv037 | PASS | 0 | `QA_PG_PORT=26670 QA_A15_DUMP=$TMPDIR/a15dump tests/qa/support/with-pg.sh npx vitest run --project integration tests/qa/integration --reporte` | `docs/delivery/test-evidence/DG5/qa/round-2/04b-integration-tests-qa-only.log` (+2) | ok |
| qa | QA-R2-11-exec-pack-provisional | PASS | 0 | `QA_PG_PORT=26641 tests/qa/support/with-pg.sh npx vitest run --project integration tests/qa/integration/zz-qa-dg5r2-exec-pack-provisional.tes` | `docs/delivery/test-evidence/DG5/qa/round-2/06-probe-exec-pack.log` (+1) | ok |
| qa | QA-R2-14-f-dg5-140-verification | PASS | 0 | `20: with-pg.sh npx vitest run --project integration apps/api/test/integration/branding/branding.test.ts tests/qa/integration/a15-outputs-eve` | `docs/delivery/test-evidence/DG5/qa/round-2/20-f140-mutant.log` (+8) | ok |

### DG5 e2e (9)

| Role | Check | Result | Exit | Command (truncated) | Evidence (first) | ev |
|---|---|---|---|---|---|---|
| domain | DOM-R3-04-requirements-from-round-2-same-candidate | PASS | 0 | `Round-2 commands (cited, not re-run): targeted-integration.sh, targeted-integration-2.sh, root-e2e.sh, text-scans.sh, run-probe.sh with dom-` | `docs/delivery/test-evidence/DG5/domain/round-2/candidate-verify.log` (+16) | ok |
| code | SEC-R2-13-F-DG5-100-verification | PASS | 0 | `checks.sh ooxml2 (QA_PG_PORT=26572); checks.sh ooxml2-render; the 46c mutants (an inline script; its log records each step); mutants-e2e.sh ` | `docs/delivery/test-evidence/DG5/code-security/round-2/46-ooxml-control-char-e2e.log` (+8) | ok |
| qa | QA-R2-06-e2e-product | PASS | 0 | `E2E_SCREENSHOT_DIR=$TMPDIR/shots-… apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e --workers=1 --project=chromium-en --p` | `docs/delivery/test-evidence/DG5/qa/round-2/05-e2e-product-unset.log` (+4) | ok |
| qa | QA-R2-07-e2e-root-acceptance | PASS | 0 | `apps/web/e2e/support/with-stack.sh npx playwright test e2e/a03-… e2e/a04-… e2e/a06-… e2e/a07-… e2e/a08-a09-… e2e/a13-… e2e/a15-… e2e/a16-… e` | `docs/delivery/test-evidence/DG5/qa/round-2/05-e2e-root-unset.log` (+4) | ok |
| qa | QA-R2-08-aud-390-200-p5 | PASS | 0 | `with-stack.sh npx playwright test e2e/zz-qa-dg5r2-aud-p5.spec.ts --workers=1 --project=chromium-en --project=chromium-ar (unset and C.UTF-8)` | `docs/delivery/test-evidence/DG5/qa/round-2/08-probe-aud-p5-unset.log` (+2) | ok |
| qa | QA-R2-09-pb093-studio-ui | PASS | 0 | `with-stack.sh npx playwright test e2e/zz-qa-dg5r2-studio-weights.spec.ts --workers=1 --project=chromium-{en,ar} (unset and C.UTF-8)` | `docs/delivery/test-evidence/DG5/qa/round-2/07-probe-pb093-en-unset.log` (+6) | ok |
| qa | QA-R2-10-demo-probes | PASS | 0 | `e2e/support/with-demo-stack.sh npx playwright test e2e/zz-qa-dg5r2-demo.spec.ts --workers=1 --project=chromium-en --project=chromium-ar (uns` | `docs/delivery/test-evidence/DG5/qa/round-2/10-probe-demo-unset.log` (+5) | ok |
| qa | QA-R2-14-f-dg5-140-verification | PASS | 0 | `20: with-pg.sh npx vitest run --project integration apps/api/test/integration/branding/branding.test.ts tests/qa/integration/a15-outputs-eve` | `docs/delivery/test-evidence/DG5/qa/round-2/20-f140-mutant.log` (+8) | ok |
| qa | QA-R2-15-regression-be-rg3-arabic-xml | PASS | 0 | `e2e/support/with-demo-stack.sh bash e2e/zz-qa-f140-real-stack.sh e2e/zz-qa-dg5r2-xmlchars-real-stack.spec.ts --project=chromium-en (unset); ` | `docs/delivery/test-evidence/DG5/qa/round-2/22-xmlchars-ar-real-stack.log` (+3) | ok |

### DG5 visual (8)

| Role | Check | Result | Exit | Command (truncated) | Evidence (first) | ev |
|---|---|---|---|---|---|---|
| domain | DOM-R3-02-judge-F-DG5-120 | PASS | 0 | `bash snippet writing f120-f121-code-inspection.log (grep -rn elementLabel apps/web/src; grep sourceLabelEn 0062; grep studio.criterion Scori` | `docs/delivery/test-evidence/DG5/domain/round-3/f120-f121-code-inspection.log` (+4) | ok |
| domain | DOM-R3-03-judge-F-DG5-121 | PASS | 0 | `same inspection log (grep overridden config-resolver.ts; ElementsSection.tsx change column; studio.json overridden en/ar; scoring-defaults.t` | `docs/delivery/test-evidence/DG5/domain/round-3/f120-f121-code-inspection.log` (+3) | ok |
| qa | QA-R2-01-static | PASS | 0 | `pnpm install --offline --frozen-lockfile; pnpm -r build; pnpm -r typecheck; pnpm lint; pnpm openapi:lint; pnpm check:no-cdn; pnpm format:che` | `docs/delivery/test-evidence/DG5/qa/round-2/00-install.log` (+8) | ok |
| qa | QA-R2-05-dlv037-sample-inspection | PASS | 0 | `cp …/tests/round-2/unit/zz-qa-dg5r2-inspect-samples.test.ts tests/qa/unit/ && QA_A15_DUMP=$TMPDIR/a15dump npx vitest run --project unit-node` | `docs/delivery/test-evidence/DG5/qa/round-2/11-inspect-samples.log` (+7) | ok |
| qa | QA-R2-06-e2e-product | PASS | 0 | `E2E_SCREENSHOT_DIR=$TMPDIR/shots-… apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e --workers=1 --project=chromium-en --p` | `docs/delivery/test-evidence/DG5/qa/round-2/05-e2e-product-unset.log` (+4) | ok |
| qa | QA-R2-07-e2e-root-acceptance | PASS | 0 | `apps/web/e2e/support/with-stack.sh npx playwright test e2e/a03-… e2e/a04-… e2e/a06-… e2e/a07-… e2e/a08-a09-… e2e/a13-… e2e/a15-… e2e/a16-… e` | `docs/delivery/test-evidence/DG5/qa/round-2/05-e2e-root-unset.log` (+4) | ok |
| qa | QA-R2-08-aud-390-200-p5 | PASS | 0 | `with-stack.sh npx playwright test e2e/zz-qa-dg5r2-aud-p5.spec.ts --workers=1 --project=chromium-en --project=chromium-ar (unset and C.UTF-8)` | `docs/delivery/test-evidence/DG5/qa/round-2/08-probe-aud-p5-unset.log` (+2) | ok |
| qa | QA-R2-15-regression-be-rg3-arabic-xml | PASS | 0 | `e2e/support/with-demo-stack.sh bash e2e/zz-qa-f140-real-stack.sh e2e/zz-qa-dg5r2-xmlchars-real-stack.spec.ts --project=chromium-en (unset); ` | `docs/delivery/test-evidence/DG5/qa/round-2/22-xmlchars-ar-real-stack.log` (+3) | ok |

### DG5 other (28)

| Role | Check | Result | Exit | Command (truncated) | Evidence (first) | ev |
|---|---|---|---|---|---|---|
| domain | DOM-R3-00-candidate-start-end | PASS | 0 | `git rev-parse HEAD; git diff --name-only 660f40c HEAD \| grep -v reviews\|test-evidence\|runs\|assignments\|candidates; node tools/gates/candidat` | `docs/delivery/test-evidence/DG5/domain/round-3/candidate-verify-start.log` (+1) | ok |
| domain | DOM-R3-01-validators | PASS | 0 | `for g in DG4 DG3 DG2 DG1: node tools/gates/validate.mjs --historical --stage $g; node tools/gates/validate.mjs --register DG5` | `docs/delivery/test-evidence/DG5/domain/round-3/validate-historical-DG4.log` (+4) | ok |
| domain | DOM-R3-05-environmental-residuals | PASS | 0 | `` | `docs/delivery/test-evidence/DG5/domain/round-2/root-e2e.log` | ok |
| code | SEC-R2-00-candidate-identity | PASS | 0 | `git rev-parse HEAD; git diff --name-only 660f40c 7a02e7d \| grep -v ^docs/delivery/; node tools/gates/candidate.mjs --stage DG5; git clone /h` | `docs/delivery/test-evidence/DG5/code-security/round-2/01-candidate-identity.log` | ok |
| code | SEC-R2-01-install | PASS | 0 | `pnpm install --offline --frozen-lockfile --store-dir $TMPDIR/pstore/v10` | `docs/delivery/test-evidence/DG5/code-security/round-2/05-install.log` (+1) | ok |
| code | SEC-R2-02-build | PASS | 0 | `pnpm -r build` | `docs/delivery/test-evidence/DG5/code-security/round-2/10-build.log` (+1) | ok |
| code | SEC-R2-03-typecheck | PASS | 0 | `pnpm -r typecheck` | `docs/delivery/test-evidence/DG5/code-security/round-2/11-typecheck.log` | ok |
| code | SEC-R2-04-lint | PASS | 0 | `pnpm lint (eslint . --max-warnings=0)` | `docs/delivery/test-evidence/DG5/code-security/round-2/12-lint.log` | ok |
| code | SEC-R2-05-format | PASS | 0 | `pnpm format:check` | `docs/delivery/test-evidence/DG5/code-security/round-2/13-format-check.log` | ok |
| code | SEC-R2-06-openapi-lint | PASS | 0 | `pnpm openapi:lint` | `docs/delivery/test-evidence/DG5/code-security/round-2/14-openapi-lint.log` (+1) | ok |
| code | SEC-R2-07-no-cdn | PASS | 0 | `pnpm check:no-cdn` | `docs/delivery/test-evidence/DG5/code-security/round-2/15-no-cdn.log` (+1) | ok |
| code | SEC-R2-08-validators | PASS | 0 | `node tools/gates/validate.mjs --historical --stage DG4 \| DG3 \| DG2 \| DG1; --register DG5; --pipeline` | `docs/delivery/test-evidence/DG5/code-security/round-2/16-validators.log` | ok |
| code | SEC-R2-15-outbox-registry | PASS | 0 | `node docs/delivery/test-evidence/DG5/code-security/round-2/repro/outbox-registry.mjs (scans.sh outbox)` | `docs/delivery/test-evidence/DG5/code-security/round-2/40-outbox-registry.log` (+2) | ok |
| code | SEC-R2-16-contract-pending-media-types | PASS | 0 | `scans.sh contract` | `docs/delivery/test-evidence/DG5/code-security/round-2/42-contract-pending.log` | ok |
| code | SEC-R2-17-module-graph | PASS | 0 | `scans.sh graph` | `docs/delivery/test-evidence/DG5/code-security/round-2/43-module-graph.log` | ok |
| code | SEC-R2-18-exactly-once-backstops | PASS | 0 | `scans.sh locks` | `docs/delivery/test-evidence/DG5/code-security/round-2/44-exactly-once-backstops.log` (+1) | ok |
| code | SEC-R2-19-commit-time-authorization | PASS | 0 | `scans.sh committime; then reading the flagged files` | `docs/delivery/test-evidence/DG5/code-security/round-2/47-commit-time-scan.log` (+1) | ok |
| code | SEC-R2-20-source-review | PASS | 0 | `git diff 2fe8f85..660f40c; git diff e70ac02..660f40c -- apps packages (the paths in 50-source-review.md)` | `docs/delivery/test-evidence/DG5/code-security/round-2/50-source-review.md` | ok |
| code | SEC-R2-21-secrets-scan | PASS | 0 | `scans.sh secrets` | `docs/delivery/test-evidence/DG5/code-security/round-2/49-secrets-scan.log` | ok |
| code | SEC-R2-22-environment-residuals | PASS | 0 | `the greps in 48-environment-residuals.log` | `docs/delivery/test-evidence/DG5/code-security/round-2/48-environment-residuals.log` | ok |
| code | SEC-R2-23-head-moved | PASS | 0 | `git log 7a02e7d..HEAD; git diff --name-only 7a02e7d..HEAD \| grep -v ^docs/delivery/; node tools/gates/candidate.mjs --stage DG5` | `docs/delivery/test-evidence/DG5/code-security/round-2/47b-head-moved.log` | ok |
| code | SEC-R2-24-cleanup | PASS | 0 | `git -C $TMPDIR/rv status --porcelain; rm -rf $TMPDIR/rv $TMPDIR/pstore $TMPDIR/mut` | `docs/delivery/test-evidence/DG5/code-security/round-2/90-cleanup.log` (+1) | ok |
| code | SEC-R2-25-requirements | PASS | 0 | `python3 csv read of docs/delivery/requirements.csv (req_id, acceptance, notes)` | `docs/delivery/requirements.csv` (+1) | ok |
| qa | QA-R2-00-candidate | PASS | 0 | `git clone /home/user/My-owns $TMPDIR/review && git checkout 660f40c && node tools/gates/candidate.mjs --stage DG5; git checkout 7a02e7d && n` | `docs/delivery/test-evidence/DG5/qa/round-2/00-candidate.log` (+2) | ok |
| qa | QA-R2-12-static-clause-probes | PASS | 0 | `python3 (PyYAML) over docs/api/openapi.yaml; python3 decimal oracle; grep of INT1/INT2` | `docs/delivery/test-evidence/DG5/qa/round-2/14-s05-006-twelve-types.txt` (+3) | ok |
| qa | QA-R2-13-register-and-notes | PASS | 0 | `python3 csv extraction of requirements.csv (final_gate = DG5); 15-requirements-matrix.md` | `docs/delivery/test-evidence/DG5/qa/round-2/15-requirements-matrix.md` | ok |
| qa | QA-R2-16-validators | PASS | 0 | `node tools/gates/validate.mjs --register DG5; --pipeline; --historical --stage DG4; --historical --stage DG3; --historical --stage DG2; --hi` | `docs/delivery/test-evidence/DG5/qa/round-2/09-validate.log` | ok |
| qa | QA-R2-17-environmental-residuals | PASS | None | `` | `docs/delivery/test-evidence/DG5/qa/round-2/00-install.log` (+2) | ok |

### DG5 release-audit tests (gate record `tests[]`, 11)

| Test | Result | Evidence (first) |
|---|---|---|
| Complete-clone check and candidate recomputation (clone --ref 660f40c, clone working tree at HEAD, repository working tree); post-freeze diff meta-only; decisio | PASS | `docs/delivery/test-evidence/DG5/audit/round-5/01-clone-identity.log` |
| Gates DG3, DG2, DG1, DG0 historical; pipeline; DG5 register rules | PASS | `docs/delivery/test-evidence/DG5/audit/round-5/12-validators.log` |
| Specialist provenance and independence (distinct, successful, sandboxed runs bound to their records and sidecars); D-082 across all 17 DG5 review and audit runs | PASS | `docs/delivery/test-evidence/DG5/audit/round-5/02-provenance.log` |
| Three PASS verdicts on 55a411ae (code-security R2, qa R2, domain R3 acceptance round with its R2 full review), all checks PASS, full 40-hex source_commits; D-19 | PASS | `docs/delivery/reviews/DG5/round-3/domain-reviewer.json` |
| 4 DG5 findings terminal: F-DG5-100 and 140 CLOSED_VERIFIED by non-owner reporters at the full ancestor 32fc1ce; F-DG5-120 and 121 ACCEPTED_OBSERVATION by domain | PASS | `docs/delivery/test-evidence/DG5/audit/round-5/03-findings.log` |
| Write-once (no D/M/R/T under reviews/DG5 or runs/DG5 in 601d7d2..HEAD) and the re-gate method (2fe8f85 = 5a7c189 product; 540 base run files kept; only review a | PASS | `docs/delivery/test-evidence/DG5/audit/round-5/05-writeonce-regate.log` |
| Incidents and orchestrator decisions: D-190, D-191 (BE-RG3, ADR-0046 amendment, verification of 7bb7d93: 15/15 rc 0, e2e 470/470 x2), D-192 and its follow-up; e | PASS | `docs/delivery/test-evidence/DG5/audit/round-5/06-incidents-d191.log` |
| Decisions D-141 to D-191 recorded with rationale; D-192 and its follow-up in progress.md | PASS | `docs/delivery/test-evidence/DG5/audit/round-5/09-decisions.log` |
| Evidence honesty: all cited paths exist (43, 78, 30, 79); every log hit disclosed and explained | PASS | `docs/delivery/test-evidence/DG5/audit/round-5/08-evidence-honesty-scan.log` |
| Product gates G1-G6 separate from engineering gates DG0-DG7; no certification or official claims; demo data synthetic and labelled; #0078FF provisional | PASS | `docs/delivery/test-evidence/DG5/audit/round-5/10-product-vs-engineering-gates.log` |
| Stage validation of DG5 with this gate: only the one problem that stems from this in-flight audit run (its meta.json) | PASS | `docs/delivery/test-evidence/DG5/audit/round-5/13-validate-stage-DG5-final.log` |

### DG5 tests that could not run, and disclosures (10)

| Source | Role | Record | Check | Result | Reason (excerpt) |
|---|---|---|---|---|---|
| approving round | domain-reviewer | `docs/delivery/reviews/DG5/round-3/domain-reviewer.json` | DOM-R3-04-requirements-from-round-2-same-candidate | PASS | ssed; no test failure is attributable to it. The integration and e2e logs contain only three npm config warnings about unknown .npmrc keys (config notices). No skip, retry, flaky test or timeout. The two presentation findings from those runs are judged in DOM-R3-02 and DOM-R3-03. Nothing in the candidate changed, so these results stand for round 3. |
| approving round | code-security-reviewer | `docs/delivery/reviews/DG5/round-2/code-security-reviewer.json` | SEC-R2-01-install | PASS | exit 0: 'Lockfile is up to date, resolution step is skipped', 'Done in 2.5s'. The four 'WARN Failed to create bin … mth-db … ENOENT packages/db/dist/cli.js' lines come from installing before @mth/db/dist existed; pnpm -r build creates it. No test uses that . |
| approving round | code-security-reviewer | `docs/delivery/reviews/DG5/round-2/code-security-reviewer.json` | SEC-R2-09-unit-node22 | PASS | own reporting channel. It alone made this project, and so the wrapper, exit 1. - unit-web: 94 files, 1746 tests passed. - nocodegen: 3 files, 259 passed and 2 skipped. The skips are it.skipIf(NOCODEGEN) by design (fuzz.test.ts). Run 2, unit-node alone (20b-unit-node22-rerun-unit-node.log): 147 files, 2366 tests passed, no error, exit 0. Under this load I do not |
| approving round | code-security-reviewer | `docs/delivery/reviews/DG5/round-2/code-security-reviewer.json` | SEC-R2-10-unit-node24 | PASS | exit 0, with no unhandled error. - unit-node: 147 files, 2366 tests passed. - unit-web: 94 files, 1746 tests passed. - nocodegen: 3 files, 259 passed and 2 skipped (by design, as on Node 22). The 18 stderr blocks come from the same five fixture or notice sources listed in SEC-R2-09. Compared with round 1, unit-node has 2 more files and 16 more tests: BE-RG3's |
| approving round | code-security-reviewer | `docs/delivery/reviews/DG5/round-2/code-security-reviewer.json` | SEC-R2-11-integration-lang-unset | PASS | exit 0: Test Files 321 passed (321); Tests 3087 passed, 1 skipped (3088). 'applied 89 migrations to a fresh database'. contract/contract.test.ts passed 83 tests. reporting/exports-xml-chars.test.ts, the new BE-RG3 test, passed. - The one skip is governance/present |
| approving round | code-security-reviewer | `docs/delivery/reviews/DG5/round-2/code-security-reviewer.json` | SEC-R2-12-integration-lang-c-utf8 | PASS | exit 0: Test Files 321 passed (321); Tests 3087 passed, 1 skipped (3088). 89 migrations applied; contract.test.ts passed 83 tests. - The skip is the same by-design runIf branch (presentation.test.ts:170). - No stderr block, unhandled error, timeout, EADDRINUSE or |
| approving round | qa-verifier | `docs/delivery/reviews/DG5/round-2/qa-verifier.json` | QA-R2-02-unit | PASS | with EXIT 0: unit-node 2366/2366 (147 files; +16 tests since round 1, from labels.test.ts and xml-chars.test.ts), unit-web 1746/1746, nocodegen 259 passed + 2 skipped by design (fuzz.test.ts it.skipIf(NOCODEGEN)). node22-unset attempt 1 EXITED 1 with every test passing (2366/1746/259+2). Vitest reported 1 unhandled error, '[vitest-worker]: Timeout calling "onTaskU |
| approving round | qa-verifier | `docs/delivery/reviews/DG5/round-2/qa-verifier.json` | QA-R2-03-integration-twice | PASS | Run this round. INT1 (unset, 00:57-02:09Z): 321 files, 3087 passed + 1 skipped, EXIT 0. INT2 (C.UTF-8, 02:09-03:04Z): same counts, EXIT 0. Each run applied 89 migrations to a fresh database: 0001_identity_access to 0097_p5_config_review_contributors; 0066, 0067, 0073, 0077, 007 |
| approving round | qa-verifier | `docs/delivery/reviews/DG5/round-2/qa-verifier.json` | QA-R2-06-e2e-product | PASS | Run this round. C.UTF-8: 470/470 in 1.2 h, EXIT 0. Unset: 462 passed, 3 failed, 5 did not run, EXIT 1. Each failure was 'Test timeout of 30000ms exceeded' at load up to 25.5, with no assertion failed: p3-seams.spec.ts:38 [en] 33.8 s (inside axe's page.evaluate), p4-benefits.spec.ts:454 '8. Au |
| approving round | qa-verifier | `docs/delivery/reviews/DG5/round-2/qa-verifier.json` | QA-R2-14-f-dg5-140-verification | PASS | self passed under the mutant, so it is not a guard for this behaviour (observation). Probe errors, kept and labelled: the 21 attempt-1 PPTX header rule did not skip the demo label. Result: CLOSED_VERIFIED (qa-verifier.verifications.json). |

## DG6 (APPROVED)

- Gate record: `docs/delivery/gates/DG6.json`; candidate `sha256:10f71f2418567878bffddfb004efbf342347029fd799dd3076af40aca32e2fc5`; source `d8868b2a5c074b13c04693a88644c25ef2792583`.
- domain-reviewer: `docs/delivery/reviews/DG6/round-7/domain-reviewer.json`, verdict PASS, candidate = gate.
- code-security-reviewer: `docs/delivery/reviews/DG6/round-7/code-security-reviewer.json`, verdict PASS, candidate = gate.
- qa-verifier: `docs/delivery/reviews/DG6/round-7/qa-verifier.json`, verdict PASS, candidate = gate.
- Release audit: `docs/delivery/reviews/DG6/round-9/release-auditor.json`.

### DG6 unit (9)

| Role | Check | Result | Exit | Command (truncated) | Evidence (first) | ev |
|---|---|---|---|---|---|---|
| domain | DOM-RG7-03-integration-p6-and-f990-regression | PASS | 0 | `MTH_SECRET_QA_A17_WEBHOOK_SIGNING_SECRET=qa-a17-synthetic-signing-secret-0001 QA_PG_PORT=32400 MTH_PORT_POOL=32401-32419 tests/qa/support/wi` | `docs/delivery/test-evidence/DG6/domain/round-7/integration-p6.log` (+3) | ok |
| code | SEC-R7-02-install-build | PASS | 0 | `scripts/setup.sh: git clone --shared; git sparse-checkout; pnpm install --frozen-lockfile --offline; pnpm -r build` | `docs/delivery/test-evidence/DG6/code-security/round-7/02-install.log` (+2) | ok |
| code | SEC-R7-09-unit-node22 | PASS | 0 | `pnpm test; npx vitest run --project unit-web <5 files>` | `docs/delivery/test-evidence/DG6/code-security/round-7/10-unit-node22.log` (+1) | ok |
| code | SEC-R7-10-unit-node24 | PASS | 0 | `pnpm test; npx vitest run --project unit-node` | `docs/delivery/test-evidence/DG6/code-security/round-7/11-unit-node24.log` (+1) | ok |
| qa | QA-RG-R7-04-unit | PASS | 0 | `run.sh 04-unit-node{22,24}-{unset,cutf8} env [-u LANG -u LC_ALL -u LC_CTYPE \| LANG=C.UTF-8 LC_ALL=C.UTF-8] pnpm test` | `docs/delivery/test-evidence/DG6/qa/round-7/04-unit-node22-unset.log` (+3) | ok |
| qa | QA-RG-R7-06-tests-qa-alone | PASS | 0 | `QA_PG_PORT=32526 tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration tests/qa/integration; npx vitest run` | `docs/delivery/test-evidence/DG6/qa/round-7/12-tests-qa-integration-alone.log` (+1) | ok |
| qa | QA-RG-R7-07-reliability | PASS | 0 | `(integration runs); QA_PG_PORT=32516 with-pg.sh npx vitest run --configLoader runner --project integration apps/worker/test/integration/qa-r` | `docs/delivery/test-evidence/DG6/qa/round-7/10-integration-run1.log` (+3) | ok |
| qa | QA-RG-R7-12-probe-restricted-tokens-and-d229 | PASS | 0 | `QA_PG_PORT=32514 with-pg.sh npx vitest run --configLoader runner --project integration apps/api/test/integration/access/qa-r1-token-sequence` | `docs/delivery/test-evidence/DG6/qa/round-7/35-probe-token-sequences.log` (+3) | ok |
| qa | QA-RG-R7-14-probe-ar-export-literals | PASS | 0 | `npx vitest run --configLoader runner --project unit-node packages/reporting/src/qa-r1-ar-export-literals.test.ts` | `docs/delivery/test-evidence/DG6/qa/round-7/37-probe-ar-export-literals.log` (+1) | ok |

### DG6 integration (13)

| Role | Check | Result | Exit | Command (truncated) | Evidence (first) | ev |
|---|---|---|---|---|---|---|
| domain | DOM-RG7-03-integration-p6-and-f990-regression | PASS | 0 | `MTH_SECRET_QA_A17_WEBHOOK_SIGNING_SECRET=qa-a17-synthetic-signing-secret-0001 QA_PG_PORT=32400 MTH_PORT_POOL=32401-32419 tests/qa/support/wi` | `docs/delivery/test-evidence/DG6/domain/round-7/integration-p6.log` (+3) | ok |
| domain | DOM-RG7-04-root-e2e-p6-en-ar | PASS | 0 | `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers MTH_SECRET_QA_A17_WEBHOOK_SIGNING_SECRET=qa-a17-synthetic-signing-secret-0001 E2E_SCREENSHOT_DIR=$` | `docs/delivery/test-evidence/DG6/domain/round-7/root-p6-e2e.log` (+26) | ok |
| code | SEC-R7-11-integration-lang-unset | PASS | 0 | `LANG/LC_ALL unset; tests/qa/support/with-pg.sh pnpm test:integration --shard=k/2 (ports 32450, 32455); then the failing file alone x3 (port ` | `docs/delivery/test-evidence/DG6/code-security/round-7/12-integration-lang-unset-shard1o2.log` (+4) | ok |
| code | SEC-R7-12-integration-lang-cutf8 | PASS | 0 | `LANG=C.UTF-8 tests/qa/support/with-pg.sh pnpm test:integration --shard=k/2 (ports 32450, 32455)` | `docs/delivery/test-evidence/DG6/code-security/round-7/13-integration-lang-cutf8-shard1o2.log` (+1) | ok |
| code | SEC-R7-13-contract-pending-graph | PASS | 0 | `grep [response-validation] in 12-/13-*.log; node --experimental-strip-types scripts/pending.mts; grep worker imports` | `docs/delivery/test-evidence/DG6/code-security/round-7/20-contract-pending-graph.log` (+2) | ok |
| code | SEC-R7-15-log-scan-and-error-lines | PASS | 0 | `scripts/logscan.sh (node deploy/scripts/log-scan.mjs over $TMPDIR/scan copies; it refuses docs/delivery, D-138); scripts/errlines.sh` | `docs/delivery/test-evidence/DG6/code-security/round-7/42-log-scan.log` (+3) | ok |
| code | SEC-R7-24-open-questions-d228-d229 | PASS | 0 | `repro/zz-sec-r7-dryrun-condition-oracle.test.ts (copied to apps/api/test/integration/access/ and removed); source read of versions.ts:348-52` | `docs/delivery/test-evidence/DG6/code-security/round-7/40-dryrun-oracle-probe.log` (+5) | ok |
| qa | QA-RG-R7-01-open-findings | PASS | 0 | `node tools/gates/validate.mjs --historical --stage DG5\|DG4\|DG3\|DG2\|DG1; --pipeline; scripts/stages-mutants.sh; python3 (stages.json history ` | `docs/delivery/reviews/DG6/round-7/qa-verifier.verifications.json` (+11) | ok |
| qa | QA-RG-R7-05-integration-twice | PASS | 0 | `QA_PG_PORT=32520 tests/qa/support/with-pg.sh pnpm test:integration (unset); QA_PG_PORT=32524 ... (C.UTF-8); grep -c operationId docs/api/ope` | `docs/delivery/test-evidence/DG6/qa/round-7/10-integration-run1.log` (+3) | ok |
| qa | QA-RG-R7-06-tests-qa-alone | PASS | 0 | `QA_PG_PORT=32526 tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration tests/qa/integration; npx vitest run` | `docs/delivery/test-evidence/DG6/qa/round-7/12-tests-qa-integration-alone.log` (+1) | ok |
| qa | QA-RG-R7-07-reliability | PASS | 0 | `(integration runs); QA_PG_PORT=32516 with-pg.sh npx vitest run --configLoader runner --project integration apps/worker/test/integration/qa-r` | `docs/delivery/test-evidence/DG6/qa/round-7/10-integration-run1.log` (+3) | ok |
| qa | QA-RG-R7-12-probe-restricted-tokens-and-d229 | PASS | 0 | `QA_PG_PORT=32514 with-pg.sh npx vitest run --configLoader runner --project integration apps/api/test/integration/access/qa-r1-token-sequence` | `docs/delivery/test-evidence/DG6/qa/round-7/35-probe-token-sequences.log` (+3) | ok |
| qa | QA-RG-R7-15-load-async-export | PASS | 0 | `QA_PG_PORT=32581 API_PORT=32580 SKIP_A=1 OUT=50-load tests/qa/support/with-pg.sh bash docs/delivery/test-evidence/DG6/qa/tests/round-7/load-` | `docs/delivery/test-evidence/DG6/qa/round-7/50-load-export.log` (+5) | ok |

### DG6 e2e (9)

| Role | Check | Result | Exit | Command (truncated) | Evidence (first) | ev |
|---|---|---|---|---|---|---|
| domain | DOM-RG7-04-root-e2e-p6-en-ar | PASS | 0 | `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers MTH_SECRET_QA_A17_WEBHOOK_SIGNING_SECRET=qa-a17-synthetic-signing-secret-0001 E2E_SCREENSHOT_DIR=$` | `docs/delivery/test-evidence/DG6/domain/round-7/root-p6-e2e.log` (+26) | ok |
| code | SEC-R7-25-e2e-targeted | PASS | 0 | `scripts/e2e.sh: e2e/support/qa-stack.sh npx playwright test e2e/a22-operations-jobs.spec.ts e2e/a12-p6-scope-isolation.spec.ts --workers=1; ` | `docs/delivery/test-evidence/DG6/code-security/round-7/50-e2e-a22-a12.log` (+2) | ok |
| qa | QA-RG-R7-02-repair-adversarial | PASS | 0 | `git diff 60787d89ffa2562d491af424bc1024b4e3bc2d57 d8868b2a5c074b13c04693a88644c25ef2792583 -- . ':!docs/delivery'; with-demo-stack.sh / with` | `docs/delivery/test-evidence/DG6/qa/round-7/00-candidate-start-main.log` (+6) | ok |
| qa | QA-RG-R7-08-e2e-product | PASS | 0 | `apps/web/e2e/support/with-stack.sh npx playwright test --workers=1 --trace=off --reporter=list apps/web/e2e` | `docs/delivery/test-evidence/DG6/qa/round-7/20-e2e-product-unset.log` (+2) | ok |
| qa | QA-RG-R7-09-e2e-root-acceptance | PASS | 0 | `e2e/support/a21-connection-log-run.sh npx playwright test --workers=1 e2e/a03-... e2e/a22-p6-operability.spec.ts (22 paths); with-stack.sh n` | `docs/delivery/test-evidence/DG6/qa/round-7/22-e2e-root-unset.log` (+6) | ok |
| qa | QA-RG-R7-10-e2e-demo | PASS | 0 | `e2e/support/with-demo-stack.sh npx playwright test --workers=1 e2e/a02-demo-labels.spec.ts e2e/a02-demo-users-walkthrough.spec.ts e2e/a02-gu` | `docs/delivery/test-evidence/DG6/qa/round-7/23-e2e-demo-unset.log` (+1) | ok |
| qa | QA-RG-R7-11-probe-p6-reflow-aud-xss-s17 | PASS | 0 | `with-stack.sh npx playwright test zz-qa-rg-r1-p6-reflow-aud.spec.ts zz-qa-rg-r1-s17-001-run-ui.spec.ts (copied into the clone, removed after` | `docs/delivery/test-evidence/DG6/qa/round-7/38-probe-p6-reflow-aud-xss-s17.log` (+3) | ok |
| qa | QA-RG-R7-13-probe-keyboard-walkthrough | PASS | 0 | `e2e/support/with-demo-stack.sh npx playwright test apps/web/e2e/p6-walkthrough-keyboard.spec.ts apps/web/e2e/zz-qa-rg-r1-walkthrough-keyboar` | `docs/delivery/test-evidence/DG6/qa/round-7/39-probe-walkthrough-keyboard-demo.log` (+1) | ok |
| qa | QA-RG-R7-16-clause-reading | PASS | 0 | `python3 csv reader over docs/delivery/requirements.csv (final_gate = DG6); reading of tests/qa/** and e2e/** against each row` | `docs/delivery/requirements.csv` (+2) | ok |

### DG6 visual (5)

| Role | Check | Result | Exit | Command (truncated) | Evidence (first) | ev |
|---|---|---|---|---|---|---|
| domain | DOM-RG7-04-root-e2e-p6-en-ar | PASS | 0 | `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers MTH_SECRET_QA_A17_WEBHOOK_SIGNING_SECRET=qa-a17-synthetic-signing-secret-0001 E2E_SCREENSHOT_DIR=$` | `docs/delivery/test-evidence/DG6/domain/round-7/root-p6-e2e.log` (+26) | ok |
| qa | QA-RG-R7-03-static | PASS | 0 | `scripts/seqA1.sh (run.sh 03-static-*); scripts/setup.sh, setup-rv2.sh` | `docs/delivery/test-evidence/DG6/qa/round-7/03-static-typecheck.log` (+9) | ok |
| qa | QA-RG-R7-09-e2e-root-acceptance | PASS | 0 | `e2e/support/a21-connection-log-run.sh npx playwright test --workers=1 e2e/a03-... e2e/a22-p6-operability.spec.ts (22 paths); with-stack.sh n` | `docs/delivery/test-evidence/DG6/qa/round-7/22-e2e-root-unset.log` (+6) | ok |
| qa | QA-RG-R7-11-probe-p6-reflow-aud-xss-s17 | PASS | 0 | `with-stack.sh npx playwright test zz-qa-rg-r1-p6-reflow-aud.spec.ts zz-qa-rg-r1-s17-001-run-ui.spec.ts (copied into the clone, removed after` | `docs/delivery/test-evidence/DG6/qa/round-7/38-probe-p6-reflow-aud-xss-s17.log` (+3) | ok |
| qa | QA-RG-R7-14-probe-ar-export-literals | PASS | 0 | `npx vitest run --configLoader runner --project unit-node packages/reporting/src/qa-r1-ar-export-literals.test.ts` | `docs/delivery/test-evidence/DG6/qa/round-7/37-probe-ar-export-literals.log` (+1) | ok |

### DG6 other (28)

| Role | Check | Result | Exit | Command (truncated) | Evidence (first) | ev |
|---|---|---|---|---|---|---|
| domain | DOM-RG7-00-candidate | PASS | 0 | `git rev-parse HEAD; node tools/gates/candidate.mjs --stage DG6; git diff 3c8b9a3acfe657348249feb297b52cf208324a07 d8868b2a5c074b13c04693a886` | `docs/delivery/test-evidence/DG6/domain/round-7/candidate-check.txt` (+2) | ok |
| domain | DOM-RG7-01-validators-and-stages | PASS | 0 | `for s in DG5 DG4 DG3 DG2 DG1; do node tools/gates/validate.mjs --historical --stage $s; done; node tools/gates/validate.mjs --pipeline; node` | `docs/delivery/test-evidence/DG6/domain/round-7/validate-exits.txt` (+8) | ok |
| domain | DOM-RG7-02-verify-F-DG6-911-951 | PASS | 0 | `STAGES_REV=<rev> node --import ./docs/delivery/test-evidence/DG6/domain/round-7/stages-serve-rev.mjs tools/gates/validate.mjs --historical -` | `docs/delivery/test-evidence/DG6/domain/round-7/validators-by-revision.log` (+3) | ok |
| domain | DOM-RG7-05-operating-logic-and-repair-diff | PASS | 0 | `None (judgement over DOM-RG7-03/04, the source and V18)` | `docs/delivery/test-evidence/DG6/domain/round-7/integration-p6.log` (+6) | ok |
| domain | DOM-RG7-06-d229-d228 | PASS | 0 | `None (judgement over DOM-RG7-03)` | `docs/delivery/test-evidence/DG6/domain/round-7/integration-p6.log` | ok |
| domain | DOM-RG7-07-decisions | PASS | 0 | `None` | `docs/delivery/test-evidence/DG6/domain/round-7/integration-p6.log` (+1) | ok |
| domain | DOM-RG7-08-environmental-residuals | PASS | 0 | `None` | `docs/delivery/test-evidence/DG6/domain/round-7/build.log` | ok |
| code | SEC-R7-00-candidate-identity | PASS | 0 | `git rev-parse HEAD; git merge-base --is-ancestor; git diff 60787d89f..d8868b2a5 / 3c8b9a3ac..d8868b2a5 -- . ':!docs/delivery'; node tools/ga` | `docs/delivery/test-evidence/DG6/code-security/round-7/01-candidate-identity.log` | ok |
| code | SEC-R7-01-environment-and-disclosures | PASS | 0 | `` | `docs/delivery/test-evidence/DG6/code-security/round-7/09-relaunch-note.log` (+1) | ok |
| code | SEC-R7-04-typecheck | PASS | 0 | `pnpm -r typecheck; pnpm -r --workspace-concurrency=1 typecheck` | `docs/delivery/test-evidence/DG6/code-security/round-7/04-typecheck.log` (+2) | ok |
| code | SEC-R7-05-lint-format-openapi-nocdn | PASS | 0 | `pnpm lint; pnpm format:check; pnpm openapi:lint; grep -c operationId docs/api/openapi.yaml; pnpm check:no-cdn` | `docs/delivery/test-evidence/DG6/code-security/round-7/05-lint.log` (+4) | ok |
| code | SEC-R7-14-secrets | PASS | 0 | `git grep -nIE 'sk-...\|AKIA...\|BEGIN ... PRIVATE KEY\|xox..\|ghp_..\|AIza..' d8868b2a5 -- . ':!docs/delivery' ':!trading_agent'` | `docs/delivery/test-evidence/DG6/code-security/round-7/21-secrets-scan.log` | ok |
| code | SEC-R7-16-validators | PASS | 0 | `node tools/gates/validate.mjs --historical --stage DG5\|DG4\|DG3\|DG2\|DG1; --pipeline; --register DG6` | `docs/delivery/test-evidence/DG6/code-security/round-7/45-validators.log` | ok |
| code | SEC-R7-17-f911-f951-verification | PASS | 0 | `node scripts/stages-check.mjs <repo>; validators of SEC-R7-16` | `docs/delivery/test-evidence/DG6/code-security/round-7/46-stages-history.log` (+2) | ok |
| code | SEC-R7-18-f952-judgement | PASS | 0 | `` | `docs/delivery/test-evidence/DG6/code-security/round-7/46-stages-history.log` (+1) | ok |
| code | SEC-R7-19-d240-judgement | PASS | 0 | `` | `docs/delivery/test-evidence/DG6/code-security/round-7/01-candidate-identity.log` (+1) | ok |
| code | SEC-R7-20-f990-regression | PASS | 0 | `scripts/probes.sh; scripts/mutants.sh` | `docs/delivery/test-evidence/DG6/code-security/round-7/30-f990-served-probes.log` (+6) | ok |
| code | SEC-R7-21-repair-diff-0130 | PASS | 0 | `git diff f56f1b3d..d8868b2a5 -- . ':!docs/delivery'; scripts/probes.sh (zz-sec-r5-upgrade-0130.test.ts)` | `docs/delivery/test-evidence/DG6/code-security/round-7/31-upgrade-0130.log` (+3) | ok |
| code | SEC-R7-22-p6-role-sweep | PASS | 0 | `scripts/sweeps.sh (zz-sec-r1-p6-role-sweep.test.ts, zz-sec-r1-p6-aud-valid-bodies.test.ts)` | `docs/delivery/test-evidence/DG6/code-security/round-7/37-p6-role-sweep.log` (+2) | ok |
| code | SEC-R7-23-token-probes | PASS | 0 | `scripts/sweeps.sh (cs-r11-token-key-adversarial.test.ts, zz-qa-dg6r12-condition-token-resave.test.ts)` | `docs/delivery/test-evidence/DG6/code-security/round-7/39-token-probes.log` | ok |
| code | SEC-R7-26-reused-earlier-rounds | PASS | 0 | `` | `docs/delivery/reviews/DG6/round-5/code-security-reviewer.json` (+2) | ok |
| code | SEC-R7-27-environment-residuals | PASS | 0 | `` | `docs/delivery/test-evidence/DG6/code-security/round-7/51-e2e-a17.log` (+1) | ok |
| code | SEC-R7-28-requirements | PASS | 0 | `` | `docs/delivery/requirements.csv` (+3) | ok |
| code | SEC-R7-29-head-moved-and-cleanup | PASS | 0 | `` | `docs/delivery/test-evidence/DG6/code-security/round-7/90-cleanup.log` | ok |
| qa | QA-RG-R7-00-candidate | PASS | 0 | `node tools/gates/candidate.mjs --stage DG6; node tools/gates/candidate.mjs --stage DG6 --ref d8868b2a5c074b13c04693a88644c25ef2792583; git d` | `docs/delivery/test-evidence/DG6/qa/round-7/00-candidate-start-main.log` (+4) | ok |
| qa | QA-RG-R7-17-validators-and-stage-history | PASS | 0 | `node tools/gates/validate.mjs --register DG6 \| --pipeline \| --historical --stage DGn; python3 (stages.json scan)` | `docs/delivery/test-evidence/DG6/qa/round-7/40-validate-register_DG6.log` (+7) | ok |
| qa | QA-RG-R7-18-environmental-residuals | PASS | 0 | `` | `docs/delivery/test-evidence/DG6/qa/round-7/10-integration-run1.log` (+1) | ok |
| qa | QA-RG-R7-19-run-interruptions-disclosed | PASS | 0 | `` | `docs/delivery/test-evidence/DG6/qa/round-7/interrupted-2h-limit/10-integration-run1.partial.log` (+4) | ok |

### DG6 release-audit tests (gate record `tests[]`, 14)

| Test | Result | Evidence (first) |
|---|---|---|
| Complete-clone check and candidate recomputation (clone --ref d8868b2a5 and --ref HEAD, clone and repository working trees: 10f71f24, 2775 files); post-freeze d | PASS | `docs/delivery/test-evidence/DG6/audit/round-9/01a-clone-candidate.log` |
| Gates DG5, DG4, DG3, DG2, DG1, DG0 historical; pipeline; DG6 register rules (also the F-DG6-911/951 reproduction re-run) | PASS | `docs/delivery/test-evidence/DG6/audit/round-9/12-validators.log` |
| Specialist provenance and independence: three distinct, successful, sandboxed round-7 runs bound to their records and sidecars; D-082 across all DG6 review and  | PASS | `docs/delivery/test-evidence/DG6/audit/round-9/02-provenance.log` |
| Three PASS verdicts on 10f71f24 (domain, code-security, qa; round 7), all checks PASS, full 40-hex source_commits, each a full review and not a review of the D- | PASS | `docs/delivery/test-evidence/DG6/audit/round-9/03b-full-review-scope.log` |
| 10 DG6 findings terminal: 9 CLOSED_VERIFIED by non-owners with full 40-hex fix_revision anchors (ancestors of the verifying source, the verifying run head and t | PASS | `docs/delivery/test-evidence/DG6/audit/round-9/03-findings.log` |
| Auditor re-run of the last repaired defects: F-DG6-990 round-4 probe on a real API and PostgreSQL (0 served DG0-DG7 strings; round 4: 24) and the candidate's se | PASS | `docs/delivery/test-evidence/DG6/audit/round-9/04a-repro-setup.log` |
| Write-once: no D/M/R/T/C event and no duplicate add under reviews/DG6, runs/DG6, candidates/DG6, assignments/DG6/round-* since 8480971a2; one commit per assignm | PASS | `docs/delivery/test-evidence/DG6/audit/round-9/05-writeonce.log` |
| Incidents and orchestrator decisions judged from history: the container-restart kills (round-2 qa, first round-3 attempts, round-5 qa); fix_revision and verific | PASS | `docs/delivery/test-evidence/DG6/audit/round-9/06-incidents.log` |
| Final verification V18 on 60787d89f: product tree equal to the candidate's (empty diff outside docs/delivery); 15/15 .rc = 0; logs grepped (integration 4370 pas | PASS | `docs/delivery/test-evidence/DG6/audit/round-9/13-final-verification-v18.log` |
| Requirements: 48/48 final_gate=DG6 rows IMPLEMENTED; each in qa's requirements_checked and in domain's or code-security's | PASS | `docs/delivery/test-evidence/DG6/audit/round-9/07-requirements.log` |
| Decisions D-193 to D-240 recorded with rationale (quoted verbatim); the re-gate rounds and the user's F-DG6-952 decision in progress.md | PASS | `docs/delivery/test-evidence/DG6/audit/round-9/09-decisions.log` |
| Evidence honesty: all cited paths exist (53, 69, 83); every non-zero exit, failed test, kill or timeout in the cited logs disclosed and explained (spot-checked  | PASS | `docs/delivery/test-evidence/DG6/audit/round-9/08-evidence-honesty-scan.log` |
| Product gates G1-G6 separate from engineering gates DG0-DG7; no certification or official PMI/Mobily claims; demo data synthetic and labelled; #0078FF and the w | PASS | `docs/delivery/test-evidence/DG6/audit/round-9/10-product-vs-engineering-gates.log` |
| Stage validation of DG6 with this gate: only problems that stem from this in-flight audit run | PASS | `docs/delivery/test-evidence/DG6/audit/round-9/14-validate-stage-DG6-final.log` |

### DG6 tests that could not run, and disclosures (19)

| Source | Role | Record | Check | Result | Reason (excerpt) |
|---|---|---|---|---|---|
| approving round | domain-reviewer | `docs/delivery/reviews/DG6/round-7/domain-reviewer.json` | DOM-RG7-01-validators-and-stages | PASS | uals the last entry. candidate.frozen_at, the manifest's frozen_at and source_commit, and the round-7 entry all agree. gates/DG6.json still records the round-4 BLOCKED decision. F-DG6-952: my scan agrees that the histories of DG0 and DG5 are not monotone, and that DG1-DG4 and DG6 are. I agree that it is a Low documentation drift in the histories of APPROVED gates, |
| approving round | domain-reviewer | `docs/delivery/reviews/DG6/round-7/domain-reviewer.json` | DOM-RG7-03-integration-p6-and-f990-regression | PASS | ot_bound', in webhooks.test.ts and channel-fanout.test.ts, are refusals the tests provoke on purpose, and both tests pass. (b) The todo, shown as '15 tests \| 1 skipped' for audit-events.test.ts, is the declared it.todo and does not run. (c) Three 'npm warn Unknown project config' lines come from the npm CLI and do not affect the result. I did not re-run the F-DG6-9 |
| approving round | domain-reviewer | `docs/delivery/reviews/DG6/round-7/domain-reviewer.json` | DOM-RG7-04-root-e2e-p6-en-ar | PASS | 266 passed, 18 skipped, 0 failed, exit 0, 32.4 min. No re-run was needed, nothing was flaky and there were no retries. All 18 skips are a20-p6-axe's 9 declared detail screens with route parameters, times 2 languages, as in |
| approving round | domain-reviewer | `docs/delivery/reviews/DG6/round-7/domain-reviewer.json` | DOM-RG7-05-operating-logic-and-repair-diff | PASS | tates, en and ar) and S17-007 (A12-5 and the assistant suites) all pass in my runs. The rest are covered by V18 (15/15 steps exit 0; integration 4370 passed, 1 skipped, 1 todo; e2e 556+556; root 288; demo 10) on the identical product tree. Accepted disclosed limits: - the S15-014 not-found and not-demo states; - LOAD-T20's dataset gap (D-199 item 2); - the REQ-S20 |
| approving round | domain-reviewer | `docs/delivery/reviews/DG6/round-7/domain-reviewer.json` | DOM-RG7-08-environmental-residuals | PASS | C-1, D-057), live CI (REQ-DLV-025, D-058), and Keycloak or a real enterprise IdP (D-049). Only the bundled test issuer was used; the SAML broker is documented, not run. Connectors, outbound writes, notification channels and the assistant ran only through their test adapters and the shipped disabled configuration. The REQ-S20-029/030 figures are provisional sandbox |
| approving round | code-security-reviewer | `docs/delivery/reviews/DG6/round-7/code-security-reviewer.json` | SEC-R7-01-environment-and-disclosures | PASS | (1) Node 22: the assignment names 22.22.2, but /opt/node22/bin holds v22.22.0. Node 22 is present, so the Node 22 runs used v22.22.0, not BLOCKED. (2) My clone has its own node_modules, installed offline into $TMPDIR, so it is writable. Vitest needed no --configLoader runner. E2E_SCREENSHOT_DIR was set to $TMPDIR/shots for the e2e. (3) My firs |
| approving round | code-security-reviewer | `docs/delivery/reviews/DG6/round-7/code-security-reviewer.json` | SEC-R7-09-unit-node22 | PASS | The full run exited 1 (10-unit-node22.log): - unit-node 191/191 files, 2906/2906; - unit-formula-nocodegen 3 files, 259 passed + 2 skipped; - unit-web 120/125 files, 2108/2113. The 5 unit-web failures are all load effects in files that took 37-87 s: - three 'Test timed out in 20000ms': kpiUnit (ar) T10, extension-hosts-twelve (en) contr |
| approving round | code-security-reviewer | `docs/delivery/reviews/DG6/round-7/code-security-reviewer.json` | SEC-R7-10-unit-node24 | PASS | orker and the main process timing out under load, not a test assertion. - unit-web: 125/125 files, 2113/2113. - unit-formula-nocodegen: 3 files, 259 passed + 2 skipped. The unit-node project re-run alone (11b) passed 191/191 files and 2906/2906, with no error, exit 0. The 'unknown format date-time/uuid ignored' lines are ajv notices from the contract unit tests. |
| approving round | code-security-reviewer | `docs/delivery/reviews/DG6/round-7/code-security-reviewer.json` | SEC-R7-11-integration-lang-unset | PASS | Both shards report 'applied 122 migrations to a fresh database'. - Shard 2: 221/221 files, 2287 passed, exit 0. - Shard 1: 220/221 files, 2082 passed + 1 skipped + 1 todo, 1 failed, exit 1. The failure is tests/qa/integration/a13-p6-import-commit-kill-restart.test.ts:153, 'a13c-child-api.ts exited (0) before READY: READY RESPONSE 200 {... status committed, ro |
| approving round | code-security-reviewer | `docs/delivery/reviews/DG6/round-7/code-security-reviewer.json` | SEC-R7-12-integration-lang-cutf8 | PASS | Both shards report 'applied 122 migrations to a fresh database'. - Shard 1: 221/221 files, 2083 passed + 1 skipped + 1 todo, exit 0. - Shard 2: 221/221 files, 2287 passed, exit 0. Union: 442 files, 4370 passed + 1 skipped + 1 todo, equal to orchestrator-final-60787d8 (integration 4370). |
| approving round | code-security-reviewer | `docs/delivery/reviews/DG6/round-7/code-security-reviewer.json` | SEC-R7-25-e2e-targeted | PASS | KPI shows its last value and date, with one exception. The only non-test lines are three 'npm warn Unknown project config' notices from npx. No retry, flake or skip. |
| approving round | code-security-reviewer | `docs/delivery/reviews/DG6/round-7/code-security-reviewer.json` | SEC-R7-27-environment-residuals | PASS | ise IdP (D-049): the OIDC other-realm rejection (REQ-S16-007) passes against the bundled test issuer in both integration passes. The SAML broker is documented, not run. - External systems: there is no real Mobily system, mail server, messaging service or AI provider. Connectors, outbound writes, channels and the assistant ran through their test adapters and the shi |
| approving round | qa-verifier | `docs/delivery/reviews/DG6/round-7/qa-verifier.json` | QA-RG-R7-04-unit | PASS | All four runs exit 0 with identical counts. unit-node: 191 files, 2906 tests. unit-web: 125 files, 2113 tests. unit-formula-nocodegen: 3 files, 259 passed, 2 skipped. The 2 skips are fuzz.test.ts it.skipIf(NOCODEGEN): they run in unit-node and are skipped by design in the no-codegen process. Each log has the same 42 error-like lines inside passing tests, as in ro |
| approving round | qa-verifier | `docs/delivery/reviews/DG6/round-7/qa-verifier.json` | QA-RG-R7-05-integration-twice | PASS | Run 1 (21:09-21:56Z) and run 2 both: 442/442 files, 4370 passed, 1 skipped, 1 todo, exit 0. Both report 'applied 122 migrations to a fresh database' (0001 to 0130, with the historical gaps). Contract test 105/105: '932 of 932 live operations (0 pending excluded) ... operati |
| approving round | qa-verifier | `docs/delivery/reviews/DG6/round-7/qa-verifier.json` | QA-RG-R7-06-tests-qa-alone | PASS | Integration: 45 files, 437 tests passed, exit 0. Unit: 6 files, 61 tests passed, exit 0. No skip, failure or timeout. |
| approving round | qa-verifier | `docs/delivery/reviews/DG6/round-7/qa-verifier.json` | QA-RG-R7-08-e2e-product | PASS | Locale unset: 556 passed, 2 skipped (1.0 h), exit 0. C.UTF-8: 556 passed, 2 skipped (59.5 min), exit 0. Each run covers both projects. The 2 skips are p6-walkthrough-keyboard.spec.ts (en, ar), which needs the demo database and skips on |
| approving round | qa-verifier | `docs/delivery/reviews/DG6/round-7/qa-verifier.json` | QA-RG-R7-09-e2e-root-acceptance | PASS | Locale unset: 288 passed, 18 skipped (39.1 min under load), exit 0. C.UTF-8: 288 passed, 18 skipped (24.0 min), exit 0. Neither run had a failure or timeout, so no re-run was needed. All 18 skips are the declared ones at a20-p6-axe.spec |
| approving round | qa-verifier | `docs/delivery/reviews/DG6/round-7/qa-verifier.json` | QA-RG-R7-10-e2e-demo | PASS | Locale unset: 10 passed (3.6 min), exit 0. C.UTF-8: 10 passed (1.9 min), exit 0. No skip or failure. |
| approving round | qa-verifier | `docs/delivery/reviews/DG6/round-7/qa-verifier.json` | QA-RG-R7-18-environmental-residuals | PASS | -007's OIDC clauses are tested against the bundled test issuer in both integration runs. e2e/identity/keycloak-login.spec.ts needs a Keycloak container and was not run. The SAML broker is documented, not run. External systems: connectors, outbound writes, notification channels and the assistant were exercised only through their test adapters, the local fake model a |

